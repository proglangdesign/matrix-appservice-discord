/*
Copyright 2018, 2019 matrix-appservice-discord

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
import { MatrixUser, Bridge, BridgeContext } from "matrix-appservice-bridge";
import { Client as MatrixClient } from "matrix-js-sdk";
import { IMatrixEvent, IMatrixEventContent, IMatrixMessage } from "./matrixtypes";
import { MatrixMessageProcessor, IMatrixMessageProcessorParams } from "./matrixmessageprocessor";
import { MatrixCommandHandler } from "./matrixcommandhandler";

import { Log } from "./log";
import { TimedCache } from "./structures/timedcache";
import { MetricPeg } from "./metrics";
const log = new Log("MatrixEventProcessor");

const MaxFileSize = 8000000;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const DISCORD_AVATAR_WIDTH = 128;
const DISCORD_AVATAR_HEIGHT = 128;
const ROOM_NAME_PARTS = 2;
const AGE_LIMIT = 900000; // 15 * 60 * 1000
const PROFILE_CACHE_LIFETIME = 900000;

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
    private mxCommandHandler: MatrixCommandHandler;
    private mxUserProfileCache: TimedCache<string, {displayname: string, avatar_url: string|undefined}>;

    constructor(opts: MatrixEventProcessorOpts, cm?: MatrixCommandHandler) {
        this.config = opts.config;
        this.bridge = opts.bridge;
        this.discord = opts.discord;
        this.matrixMsgProcessor = new MatrixMessageProcessor(this.discord);
        this.mxUserProfileCache = new TimedCache(PROFILE_CACHE_LIFETIME);
        if (cm) {
            this.mxCommandHandler = cm;
        } else {
            this.mxCommandHandler = new MatrixCommandHandler(this.discord, this.bridge, this.config);
        }
    }

    public async OnEvent(request, context: BridgeContext): Promise<void> {
        const event = request.getData() as IMatrixEvent;
        if (event.unsigned.age > AGE_LIMIT) {
            log.warn(`Skipping event due to age ${event.unsigned.age} > ${AGE_LIMIT}`);
            MetricPeg.get.requestOutcome(event.event_id, false, "dropped");
            return;
        }
        if (
            event.type === "m.room.member" &&
            event.content!.membership === "invite" &&
            event.state_key === this.bridge.getClientFactory()._botUserId
        ) {
            await this.mxCommandHandler.HandleInvite(event);
            return;
        } else if (event.type === "m.room.member" && this.bridge.getBot().isRemoteUser(event.state_key)) {
            if (["leave", "ban"].includes(event.content!.membership!) && event.sender !== event.state_key) {
                // Kick/Ban handling
                let prevMembership = "";
                if (event.content!.membership === "leave") {
                    const intent = this.bridge.getIntent();
                    prevMembership = (await intent.getEvent(event.room_id, event.replaces_state)).content.membership;
                }
                await this.discord.HandleMatrixKickBan(
                    event.room_id,
                    event.state_key,
                    event.sender,
                    event.content!.membership as "leave"|"ban",
                    prevMembership,
                    event.content!.reason,
                );
            }
            return;
        } else if (["m.room.member", "m.room.name", "m.room.topic"].includes(event.type)) {
            await this.ProcessStateEvent(event);
            return;
        } else if (event.type === "m.room.redaction" && context.rooms.remote) {
            await this.discord.ProcessMatrixRedact(event);
            return;
        } else if (event.type === "m.room.message" || event.type === "m.sticker") {
            log.verbose(`Got ${event.type} event`);
            const isBotCommand = event.type === "m.room.message" &&
                event.content!.body &&
                event.content!.body!.startsWith("!discord");
            if (isBotCommand) {
                await this.mxCommandHandler.Process(event, context);
            } else if (context.rooms.remote) {
                const srvChanPair = context.rooms.remote.roomId.substr("_discord".length).split("_", ROOM_NAME_PARTS);
                try {
                    await this.ProcessMsgEvent(event, srvChanPair[0], srvChanPair[1]);
                } catch (err) {
                    log.warn("There was an error sending a matrix event", err);
                }
            }
            return;
        } else if (event.type === "m.room.encryption" && context.rooms.remote) {
            try {
                await this.HandleEncryptionWarning(event.room_id);
                return;
            } catch (err) {
                throw new Error(`Failed to handle encrypted room, ${err}`);
            }
        }
        log.verbose("Event not processed by bridge");
        MetricPeg.get.requestOutcome(event.event_id, false, "dropped");
    }

    public async HandleEncryptionWarning(roomId: string): Promise<void> {
        const intent = this.bridge.getIntent();
        log.info(`User has turned on encryption in ${roomId}, so leaving.`);
        /* N.B 'status' is not specced but https://github.com/matrix-org/matrix-doc/pull/828
         has been open for over a year with no resolution. */
        const sendPromise = intent.sendMessage(roomId, {
            body: "You have turned on encryption in this room, so the service will not bridge any new messages.",
            msgtype: "m.notice",
            status: "critical",
        });
        const channel = await this.discord.GetChannelFromRoomId(roomId);
        await (channel as Discord.TextChannel).send(
          "Someone on Matrix has turned on encryption in this room, so the service will not bridge any new messages",
        );
        await sendPromise;
        await intent.leave(roomId);
        await this.bridge.getRoomStore().removeEntriesByMatrixRoomId(roomId);
    }

    public async ProcessMsgEvent(event: IMatrixEvent, guildId: string, channelId: string) {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        log.verbose(`Looking up ${guildId}_${channelId}`);
        const roomLookup = await this.discord.LookupRoom(guildId, channelId, event.sender);
        const chan = roomLookup.channel;

        const embedSet = await this.EventToEmbed(event, chan);
        const opts: Discord.MessageOptions = {};
        const file = await this.HandleAttachment(event, mxClient);
        if (typeof(file) === "string") {
            embedSet.messageEmbed.description += " " + file;
        } else {
            opts.file = file;
        }

        await this.discord.send(embedSet, opts, roomLookup, event);
        // Don't await this.
        this.sendReadReceipt(event).catch((ex) => {
            log.verbose("Failed to send read reciept for ", event.event_id, ex);
        });
    }

    public async ProcessStateEvent(event: IMatrixEvent) {
        return;
    }

    public async EventToEmbed(
        event: IMatrixEvent, channel: Discord.TextChannel, getReply: boolean = true,
    ): Promise<IMatrixEventProcessorResult> {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        const profile = await this.GetUserProfileForRoom(event.room_id, event.sender);
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

    private async GetUserProfileForRoom(roomId: string, userId: string) {
        const mxClient = this.bridge.getClientFactory().getClientAs();
        const intent = this.bridge.getIntent();
        let profile: {displayname: string, avatar_url: string|undefined} | undefined;
        try {
            // First try to pull out the room-specific profile from the cache.
            profile = this.mxUserProfileCache.get(`${roomId}:${userId}`);
            if (profile) {
                return profile;
            }
            log.verbose(`Profile ${userId}:${roomId} not cached`);

            // Failing that, try fetching the state.
            profile = await mxClient.getStateEvent(roomId, "m.room.member", userId);
            if (profile) {
                this.mxUserProfileCache.set(`${roomId}:${userId}`, profile);
                return profile;
            }

            // Try fetching the users profile from the cache
            profile = this.mxUserProfileCache.get(userId);
            if (profile) {
                return profile;
            }

            // Failing that, try fetching the profile.
            log.verbose(`Profile ${userId} not cached`);
            profile = await intent.getProfileInfo(userId);
            if (profile) {
                this.mxUserProfileCache.set(userId, profile);
                return profile;
            }
            log.warn(`User ${userId} has no member state and no profile. That's odd.`);
        } catch (err) {
            log.warn(`Trying to fetch member state or profile for ${userId} failed`, err);
        }
        return undefined;
    }

    private async sendReadReceipt(event: IMatrixEvent) {
        if (!this.config.bridge.disableReadReceipts) {
            try {
                await this.bridge.getIntent().sendReadReceipt(event.room_id, event.event_id);
            } catch (err) {
                log.error(`Failed to send read receipt for ${event}. `, err);
            }
        }
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

    private async SetEmbedAuthor(embed: Discord.RichEmbed, sender: string, profile?: {
        displayname: string,
        avatar_url: string|undefined }) {
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
