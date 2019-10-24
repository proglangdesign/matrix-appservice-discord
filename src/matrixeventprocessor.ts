/*
Copyright 2018 matrix-appservice-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as Discord from "discord.js";
import { DiscordBot } from "./bot";
import { DiscordBridgeConfig } from "./config";
import * as escapeStringRegexp from "escape-string-regexp";
import { Util } from "./util";
import * as path from "path";
import * as mime from "mime";
import { MatrixUser, Bridge } from "matrix-appservice-bridge";
import { Client as MatrixClient } from "matrix-js-sdk";
import { IMatrixEvent, IMatrixEventContent, IMatrixMessage } from "./matrixtypes";
import { MatrixMessageProcessor, IMatrixMessageProcessorParams } from "./matrixmessageprocessor";

import { Log } from "./log";
const log = new Log("MatrixEventProcessor");

const MaxFileSize = 8000000;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const DISCORD_AVATAR_WIDTH = 128;
const DISCORD_AVATAR_HEIGHT = 128;

export class MatrixEventProcessorOpts {
    constructor(
        readonly config: DiscordBridgeConfig,
        readonly bridge: Bridge,
        readonly discord: DiscordBot,
        ) {

    }
}

export interface IMatrixEventProcessorResult {
    messageEmbed: Discord.RichEmbed;
    replyEmbed?: Discord.RichEmbed;
}

export class MatrixEventProcessor {
    private config: DiscordBridgeConfig;
    private bridge: Bridge;
    private discord: DiscordBot;
    private matrixMsgProcessor: MatrixMessageProcessor;

    constructor(opts: MatrixEventProcessorOpts) {
        this.config = opts.config;
        this.bridge = opts.bridge;
        this.discord = opts.discord;
        this.matrixMsgProcessor = new MatrixMessageProcessor(this.discord);
    }

    public StateEventToMessage(event: IMatrixEvent, channel: Discord.TextChannel): string | undefined {
        return;
    }

    public async EventToEmbed(
        event: IMatrixEvent, channel: Discord.TextChannel, getReply: boolean = true,
    ): Promise<IMatrixEventProcessorResult> {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        let profile: IMatrixEvent | null = null;
        try {
            profile = await mxClient.getStateEvent(event.room_id, "m.room.member", event.sender);
            if (!profile) {
                profile = await mxClient.getProfileInfo(event.sender);
            }
            if (!profile) {
                log.warn(`User ${event.sender} has no member state and no profile. That's odd.`);
            }
        } catch (err) {
            log.warn(`Trying to fetch member state or profile for ${event.sender} failed`, err);
        }

        const params = {
            mxClient,
            roomId: event.room_id,
            userId: event.sender,
        } as IMatrixMessageProcessorParams;
        if (profile) {
            params.displayname = profile.displayname;
        }

        let body: string = "";
        if (event.type !== "m.sticker") {
            body = await this.matrixMsgProcessor.FormatMessage(event.content as IMatrixMessage, channel.guild, params);
        }

        const messageEmbed = new Discord.RichEmbed();
        messageEmbed.setDescription(body);
        await this.SetEmbedAuthor(messageEmbed, event.sender, profile);
        const replyEmbed = getReply ? (await this.GetEmbedForReply(event, channel)) : undefined;
        if (replyEmbed && replyEmbed.fields) {
            for (let i = 0; i < replyEmbed.fields.length; i++) {
                const f = replyEmbed.fields[i];
                if (f.name === "ping") {
                    messageEmbed.description += `\n(${f.value})`;
                    replyEmbed.fields.splice(i, 1);
                    break;
                }
            }
        }
        return {
            messageEmbed,
            replyEmbed,
        };
    }

    public async HandleAttachment(event: IMatrixEvent, mxClient: MatrixClient): Promise<string|Discord.FileOptions> {
        if (!this.HasAttachment(event)) {
            return "";
        }

        if (!event.content) {
            event.content = {};
        }

        if (!event.content.info) {
            // Fractal sends images without an info, which is technically allowed
            // but super unhelpful:  https://gitlab.gnome.org/World/fractal/issues/206
            event.content.info = {size: 0};
        }

        if (!event.content.url) {
            log.info("Event was an attachment type but was missing a content.url");
            return "";
        }

        let size = event.content.info.size || 0;
        const url = mxClient.mxcUrlToHttp(event.content.url);
        const name = this.GetFilenameForMediaEvent(event.content);
        if (size < MaxFileSize) {
            const attachment = await Util.DownloadFile(url);
            size = attachment.byteLength;
            if (size < MaxFileSize) {
                return {
                    attachment,
                    name,
                } as Discord.FileOptions;
            }
        }
        return `[${name}](${url})`;
    }

    public async GetEmbedForReply(
        event: IMatrixEvent,
        channel: Discord.TextChannel,
    ): Promise<Discord.RichEmbed|undefined> {
        if (!event.content) {
            event.content = {};
        }

        const relatesTo = event.content["m.relates_to"];
        let eventId = "";
        if (relatesTo && relatesTo["m.in_reply_to"]) {
            eventId = relatesTo["m.in_reply_to"].event_id;
        } else {
            return;
        }

        const intent = this.bridge.getIntent();
        // Try to get the event.
        try {
            const sourceEvent = await intent.getEvent(event.room_id, eventId);
            sourceEvent.content.body = sourceEvent.content.body  || "Reply with unknown content";
            const replyEmbed = (await this.EventToEmbed(sourceEvent, channel, false)).messageEmbed;

            // if we reply to a discord member, ping them!
            if (this.bridge.getBot().isRemoteUser(sourceEvent.sender)) {
                const uid = new MatrixUser(sourceEvent.sender.replace("@", "")).localpart.substring("_discord".length);
                replyEmbed.addField("ping", `<@${uid}>`);
            }

            replyEmbed.setTimestamp(new Date(sourceEvent.origin_server_ts));

            if (this.HasAttachment(sourceEvent)) {
                const mxClient = this.bridge.getClientFactory().getClientAs();
                const url = mxClient.mxcUrlToHttp(sourceEvent.content.url);
                if (["m.image", "m.sticker"].includes(sourceEvent.content.msgtype as string)
                    || sourceEvent.type === "m.sticker") {
                    // we have an image reply
                    replyEmbed.setImage(url);
                } else {
                    const name = this.GetFilenameForMediaEvent(sourceEvent.content);
                    replyEmbed.description = `[${name}](${url})`;
                }
            }
            return replyEmbed;
        } catch (ex) {
            log.warn("Failed to handle reply, showing a unknown embed:", ex);
        }
        // For some reason we failed to get the event, so using fallback.
        const embed = new Discord.RichEmbed();
        embed.setDescription("Reply with unknown content");
        embed.setAuthor("Unknown");
        return embed;
    }

    private HasAttachment(event: IMatrixEvent): boolean {
        if (!event.content) {
            event.content = {};
        }

        const hasAttachment = [
            "m.image",
            "m.audio",
            "m.video",
            "m.file",
            "m.sticker",
        ].includes(event.content.msgtype as string) || [
            "m.sticker",
        ].includes(event.type);
        return hasAttachment;
    }

    private async SetEmbedAuthor(embed: Discord.RichEmbed, sender: string, profile?: IMatrixEvent | null) {
        const intent = this.bridge.getIntent();
        let displayName = sender;
        let avatarUrl;

        // Are they a discord user.
        if (this.bridge.getBot().isRemoteUser(sender)) {
            const localpart = new MatrixUser(sender.replace("@", "")).localpart;
            const userOrMember = await this.discord.GetDiscordUserOrMember(localpart.substring("_discord".length));
            if (userOrMember instanceof Discord.User) {
                embed.setAuthor(
                    userOrMember.username,
                    userOrMember.avatarURL,
                );
                return;
            } else if (userOrMember instanceof Discord.GuildMember) {
                embed.setAuthor(
                    userOrMember.displayName,
                    userOrMember.user.avatarURL,
                );
                return;
            }
            // Let it fall through.
        }
        if (!profile) {
            try {
                profile = await intent.getProfileInfo(sender);
            } catch (ex) {
                log.warn(`Failed to fetch profile for ${sender}`, ex);
            }
        }

        if (profile) {
            if (profile.displayname &&
                profile.displayname.length >= MIN_NAME_LENGTH &&
                profile.displayname.length <= MAX_NAME_LENGTH) {
                displayName = profile.displayname;
            }

            if (profile.avatar_url) {
                const mxClient = this.bridge.getClientFactory().getClientAs();
                avatarUrl = mxClient.mxcUrlToHttp(profile.avatar_url, DISCORD_AVATAR_WIDTH, DISCORD_AVATAR_HEIGHT);
            }
        }
        embed.setAuthor(
            displayName.substr(0, MAX_NAME_LENGTH),
            avatarUrl,
            `https://matrix.to/#/${sender}`,
        );
    }

    private GetFilenameForMediaEvent(content: IMatrixEventContent): string {
        if (content.body) {
            if (path.extname(content.body) !== "") {
                return content.body;
            }
            return `${path.basename(content.body)}.${mime.extension(content.info.mimetype)}`;
        }
        return "matrix-media." + mime.extension(content.info.mimetype);
    }
}
