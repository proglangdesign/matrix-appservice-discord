import * as Discord from "discord.js";
import { IMatrixMessage, IMatrixEvent } from "./matrixtypes";
import * as Parser from "node-html-parser";
import { Util } from "./util";
import { DiscordBot } from "./bot";

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const MATRIX_TO_LINK = "https://matrix.to/#/";

export class MatrixMessageProcessorOpts {
    constructor(readonly disableEveryone: boolean = true, readonly disableHere: boolean = true) { }
}

export class MatrixMessageProcessor {
    private guild: Discord.Guild;
    constructor(public bot: DiscordBot, public opts: MatrixMessageProcessorOpts) { }
    public async FormatMessage(
        msg: IMatrixMessage,
        guild: Discord.Guild,
        profile?: IMatrixEvent | null,
    ): Promise<string> {
        this.guild = guild;
        let reply = "";
        if (msg.formatted_body) {
            // parser needs everything wrapped in html elements
            // so we wrap everything in <div> just to be sure stuff is wrapped
            // as <div> will be un-touched anyways
            const parsed = Parser.parse(`<div>${msg.formatted_body}</div>`, {
                lowerCaseTagName: true,
                pre: true,
            // tslint:disable-next-line no-any
            } as any);
            reply = await this.walkNode(parsed);
        } else {
            reply = this.escapeDiscord(msg.body);
        }

        if (msg.msgtype === "m.emote") {
            if (profile &&
                profile.displayname &&
                profile.displayname.length >= MIN_NAME_LENGTH &&
                profile.displayname.length <= MAX_NAME_LENGTH) {
                reply = `_${profile.displayname} ${reply}_`;
            } else {
                reply = `_${reply}_`;
            }
        }
        return reply;
    }

    private escapeDiscord(msg: string): string {
        if (this.opts.disableEveryone) {
            msg = msg.replace(/@everyone/g, "@ everyone");
        }
        if (this.opts.disableHere) {
            msg = msg.replace(/@here/g, "@ here");
        }
        msg = msg.replace(/@room/g, "@here");
        const escapeChars = ["\\", "*", "_", "~", "`"];
        escapeChars.forEach((char) => {
            msg = msg.replace(new RegExp("\\" + char, "g"), "\\" + char);
        });
        return msg;
    }

    private parsePreContent(node: Parser.HTMLElement): string {
        let text = node.text;
        const match = text.match(/^<code([^>]*)>/i);
        if (!match) {
            if (text[0] !== "\n") {
                text = "\n" + text;
            }
            return text;
        }
        // remove <code> opening-tag
        text = text.substr(match[0].length);
        // remove </code> closing tag
        text = text.replace(/<\/code>$/i, "");
        if (text[0] !== "\n") {
            text = "\n" + text;
        }
        const language = match[1].match(/language-(\w*)/i);
        if (language) {
            text = language[1] + text;
        }
        return text;
    }

    private parseUser(id: string): string {
        const USER_REGEX = /^@_discord_([0-9]*)/;
        const match = id.match(USER_REGEX);
        if (!match || !this.guild.members.get(match[1])) {
            return "";
        }
        return `<@${match[1]}>`;
    }

    private parseChannel(id: string): string {
        const CHANNEL_REGEX = /^#_discord_[0-9]*_([0-9]*)/;
        const match = id.match(CHANNEL_REGEX);
        if (!match || !this.guild.channels.get(match[1])) {
            return MATRIX_TO_LINK + id;
        }
        return `<#${match[1]}>`;
    }

    private async parsePillContent(node: Parser.HTMLElement): Promise<string> {
        const attrs = node.attributes;
        if (!attrs.href || !attrs.href.startsWith(MATRIX_TO_LINK)) {
            return await this.walkChildNodes(node);
        }
        const id = attrs.href.replace(MATRIX_TO_LINK, "");
        let reply = "";
        switch (id[0]) {
            case "@":
                // user pill
                reply = this.parseUser(id);
                break;
            case "#":
                reply = this.parseChannel(id);
                break;
        }
        if (!reply) {
            return await this.walkChildNodes(node);
        }
        return reply;
    }

    private async parseImageContent(node: Parser.HTMLElement): Promise<string> {
        const EMOTE_NAME_REGEX = /^:?(\w+):?/;
        const attrs = node.attributes;
        const name = attrs.alt || attrs.title || "";
        let emoji: Discord.Emoji | null = null;
        // first check for matching mxc url
        if (attrs.src) {
            let id = "";
            try {
                const emojiDb = await this.bot.GetEmojiByMxc(attrs.src);
                id = emojiDb.EmojiId;
                emoji = this.guild.emojis.find((e) => e.id === id);
            } catch (e) {
                emoji = null;
            }
        }
        // nexc check for matching alt text / title
        if (!emoji) {
            const match = name.match(EMOTE_NAME_REGEX);
            let emojiName = "";
            if (match) {
                emojiName = match[1];
                emoji = this.guild.emojis.find((e) => e.name === emojiName);
            }
        }

        if (!emoji) {
            return this.escapeDiscord(name);
        }
        return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    }

    private async walkChildNodes(node: Parser.Node): Promise<string> {
        let reply = "";
        await Util.AsyncForEach(node.childNodes, async (child) => {
            reply += await this.walkNode(child);
        });
        return reply;
    }

    private async walkNode(node: Parser.Node): Promise<string> {
        if (node.nodeType === Parser.NodeType.TEXT_NODE) {
            return this.escapeDiscord((node as Parser.TextNode).text);
        } else if (node.nodeType === Parser.NodeType.ELEMENT_NODE) {
            const nodeHtml = node as Parser.HTMLElement;
            switch (nodeHtml.tagName) {
                case "em":
                case "i":
                    return `*${await this.walkChildNodes(nodeHtml)}*`;
                case "strong":
                case "b":
                    return `**${await this.walkChildNodes(nodeHtml)}**`;
                case "u":
                    return `__${await this.walkChildNodes(nodeHtml)}__`;
                case "del":
                    return `~~${await this.walkChildNodes(nodeHtml)}~~`;
                case "code":
                    return `\`${nodeHtml.text}\``;
                case "pre":
                    return `\`\`\`${this.parsePreContent(nodeHtml)}\`\`\``;
                case "a":
                    return await this.parsePillContent(nodeHtml);
                case "img":
                    return await this.parseImageContent(nodeHtml);
                case "br":
                    return "\n";
                default:
                    return await this.walkChildNodes(nodeHtml);
            }
        }
        return "";
    }
}