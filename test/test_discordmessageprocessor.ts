/*
Copyright 2017, 2018 matrix-appservice-discord

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

import * as Chai from "chai";
import * as Discord from "discord.js";
import { DiscordMessageProcessor, DiscordMessageProcessorOpts } from "../src/discordmessageprocessor";
import { DiscordBot } from "../src/bot";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import { MockMessage } from "./mocks/message";
import { MockRole } from "./mocks/role";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const bot = {
    GetEmoji: async (name: string, animated: boolean, id: string): Promise<string> => {
        if (id === "3333333") {
            return "mxc://image";
        } else {
            throw new Error("Emoji not found");
        }
    },
};

describe("DiscordMessageProcessor", () => {
    describe("init", () => {
        it("constructor", () => {
            const mp = new DiscordMessageProcessor(new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
        });
    });
    describe("FormatMessage", () => {
        it("processes plain text messages correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "Hello World!";
            const result = await processor.FormatMessage(msg);
            Chai.assert(result.body, "Hello World!");
            Chai.assert(result.formattedBody, "Hello World!");
        });
        it("processes markdown messages correctly.", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "Hello *World*!";
            const result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "Hello *World*!");
            Chai.assert.equal(result.formattedBody, "Hello <em>World</em>!");
        });
        it("processes non-discord markdown correctly.", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "> inb4 tests";
            let result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "> inb4 tests");
            Chai.assert.equal(result.formattedBody, "&gt; inb4 tests");

            msg.embeds = [];
            msg.content = "[test](http://example.com)";
            result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "[test](http://example.com)");
            Chai.assert.equal(result.formattedBody,
                "[test](<a href=\"http://example.com\">http://example.com</a>)");
        });
        it("processes discord-specific markdown correctly.", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "_ italic _";
            const result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "_ italic _");
            Chai.assert.equal(result.formattedBody, "<em> italic </em>");
        });
        it("replaces @everyone correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "hey @everyone!";
            let result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "hey @everyone!");
            Chai.assert.equal(result.formattedBody, "hey @everyone!");

            msg.mentions.everyone = true;
            result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "hey @room!");
            Chai.assert.equal(result.formattedBody, "hey @room!");
        });
        it("replaces @here correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "hey @here!";
            let result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "hey @here!");
            Chai.assert.equal(result.formattedBody, "hey @here!");

            msg.mentions.everyone = true;
            result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "hey @room!");
            Chai.assert.equal(result.formattedBody, "hey @room!");
        });
    });
    describe("FormatEmbeds", () => {
        it("should format embeds correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                {
                    author: {} as any,
                    client: {} as any,
                    color: {} as any,
                    createdAt: {} as any,
                    createdTimestamp: {} as any,
                    description: "Description",
                    fields: {} as any,
                    footer: {} as any,
                    hexColor: {} as any,
                    image: {} as any,
                    message: {} as any,
                    provider: {} as any,
                    thumbnail: {} as any,
                    title: "Title",
                    type: {} as any,
                    url: "http://example.com",
                    video: {} as any,
                },
            ];
            msg.content = "message";
            const result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "message\n\n----\n##### [Title](http://example.com)\nDescription");
            Chai.assert.equal(result.formattedBody, "message<hr><h5><a href=\"http://example.com\">Title</a>" +
                "</h5>Description");
        });
        it("should ignore same-url embeds", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                {
                    author: {} as any,
                    client: {} as any,
                    color: {} as any,
                    createdAt: {} as any,
                    createdTimestamp: {} as any,
                    description: "Description",
                    fields: {} as any,
                    footer: {} as any,
                    hexColor: {} as any,
                    image: {} as any,
                    message: {} as any,
                    provider: {} as any,
                    thumbnail: {} as any,
                    title: "Title",
                    type: {} as any,
                    url: "http://example.com",
                    video: {} as any,
                },
            ];
            msg.content = "message http://example.com";
            const result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.body, "message http://example.com");
            Chai.assert.equal(result.formattedBody, "message <a href=\"http://example.com\">" +
                "http://example.com</a>");
        });
    });
    describe("FormatEdit", () => {
        it("should format basic edits appropriately", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const oldMsg = new MockMessage() as any;
            const newMsg = new MockMessage() as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated but not changed
            oldMsg.content = "a";
            newMsg.content = "b";

            const result = await processor.FormatEdit(oldMsg, newMsg);
            Chai.assert.equal(result.body, "*edit:* ~~a~~ -> b");
            Chai.assert.equal(result.formattedBody, "<em>edit:</em> <del>a</del> -&gt; b");
        });
        it("should format markdown heavy edits apropriately", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const oldMsg = new MockMessage() as any;
            const newMsg = new MockMessage() as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated but not changed
            oldMsg.content = "a slice of **cake**";
            newMsg.content = "*a* slice of cake";

            const result = await processor.FormatEdit(oldMsg, newMsg);
            Chai.assert.equal(result.body, "*edit:* ~~a slice of **cake**~~ -> *a* slice of cake");
            Chai.assert.equal(result.formattedBody, "<em>edit:</em> <del>a slice of <strong>" +
              "cake</strong></del> -&gt; <em>a</em> slice of cake");
        });
        it("should format discord fail edits correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const oldMsg = new MockMessage() as any;
            const newMsg = new MockMessage() as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated but not changed
            oldMsg.content = "~~fail~";
            newMsg.content = "~~fail~~";

            const result = await processor.FormatEdit(oldMsg, newMsg);
            Chai.assert.equal(result.body, "*edit:* ~~~~fail~~~ -> ~~fail~~");
            Chai.assert.equal(result.formattedBody, "<em>edit:</em> <del>~~fail~</del> -&gt; <del>fail</del>");
        });
        it("should format multiline edits correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const oldMsg = new MockMessage() as any;
            const newMsg = new MockMessage() as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated but not changed
            oldMsg.content = "multi\nline";
            newMsg.content = "multi\nline\nfoxies";

            const result = await processor.FormatEdit(oldMsg, newMsg);
            Chai.assert.equal(result.body, "*edit:* ~~multi\nline~~ -> multi\nline\nfoxies");
            Chai.assert.equal(result.formattedBody, "<p><em>edit:</em></p><p><del>multi<br>line</del></p><hr>" +
                "<p>multi<br>line<br>foxies</p>");
        });
        it("should add old message link", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const oldMsg = new MockMessage() as any;
            const newMsg = new MockMessage() as any;
            oldMsg.embeds = [];
            newMsg.embeds = [];

            // Content updated but not changed
            oldMsg.content = "fox";
            newMsg.content = "foxies";

            const result = await processor.FormatEdit(oldMsg, newMsg, "https://matrix.to/#/old");
            Chai.assert.equal(result.body, "*edit:* ~~fox~~ -> foxies");
            Chai.assert.equal(result.formattedBody, "<a href=\"https://matrix.to/#/old\"><em>edit:</em></a>" +
                " <del>fox</del> -&gt; foxies");
        });
    });

    describe("InsertUser / HTML", () => {
        it("processes members missing from the guild correctly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {});
            const msg = new MockMessage(channel) as any;
            const content = { id: "12345" };
            let reply = processor.InsertUser(content, msg);
            Chai.assert.equal(reply, "@_discord_12345:localhost");

            reply = processor.InsertUser(content, msg, true);
            Chai.assert.equal(reply,
                "<a href=\"https://matrix.to/#/@_discord_12345:localhost\">@_discord_12345:localhost</a>");
        });
        it("processes members with usernames correctly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername"));
            const channel = new Discord.TextChannel(guild, {});
            const msg = new MockMessage(channel) as any;
            const content = { id: "12345" };
            let reply = processor.InsertUser(content, msg);
            Chai.assert.equal(reply, "TestUsername");

            reply = processor.InsertUser(content, msg, true);
            Chai.assert.equal(reply,
                "<a href=\"https://matrix.to/#/@_discord_12345:localhost\">TestUsername</a>");
        });
        it("processes members with nickname correctly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            guild._mockAddMember(new MockMember("12345", "TestUsername", null, "TestNickname"));
            const channel = new Discord.TextChannel(guild, {});
            const msg = new MockMessage(channel) as any;
            const content = { id: "12345" };
            let reply = processor.InsertUser(content, msg);
            Chai.assert.equal(reply, "TestNickname");

            reply = processor.InsertUser(content, msg, true);
            Chai.assert.equal(reply,
                "<a href=\"https://matrix.to/#/@_discord_12345:localhost\">TestNickname</a>");
        });
    });
    describe("InsertChannel / HTML", () => {
        it("processes unknown channel correctly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            const msg = new MockMessage(channel) as any;
            const content = { id: "123456789" };
            let reply = processor.InsertChannel(content, msg);
            Chai.assert.equal(reply, "<#123456789>");

            reply = processor.InsertChannel(content, msg, true);
            Chai.assert.equal(reply,
                "&lt;#123456789&gt;");
        });
        it("processes channels correctly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const msg = new MockMessage(channel) as any;
            const content = { id: "456" };
            let reply = processor.InsertChannel(content, msg);
            Chai.assert.equal(reply, "#TestChannel");

            reply = processor.InsertChannel(content, msg, true);
            Chai.assert.equal(reply,
                "<a href=\"https://matrix.to/#/#_discord_123_456:localhost\">#TestChannel</a>");
        });
    });
    describe("InsertRole / HTML", () => {
        it("ignores unknown roles", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const role = new MockRole("5678", "role");
            guild.roles.set("5678", role);
            const msg = new MockMessage(channel) as any;
            const content = { id: "1234" };
            let reply = processor.InsertRole(content, msg);
            Chai.assert.equal(reply, "<@&1234>");

            reply = processor.InsertRole(content, msg, true);
            Chai.assert.equal(reply, "&lt;@&amp;1234&gt;");
        });
        it("parses known roles", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const ROLE_COLOR = 0xDEAD88;
            const role = new MockRole("1234", "role", ROLE_COLOR);
            guild.roles.set("1234", role);
            const msg = new MockMessage(channel) as any;
            const content = { id: "1234" };
            let reply = processor.InsertRole(content, msg);
            Chai.assert.equal(reply, "@role");

            reply = processor.InsertRole(content, msg, true);
            Chai.assert.equal(reply, "<span data-mx-color=\"#dead88\"><strong>@role</strong></span>");
        });
    });
    describe("InsertEmoji", () => {
        it("inserts static emojis to their post-parse flag", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const content = {
                animated: false,
                id: "1234",
                name: "blah",
            };
            const reply = processor.InsertEmoji(content);
            Chai.assert.equal(reply, "\x01blah\x010\x011234\x01");
        });
        it("inserts animated emojis to their post-parse flag", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const content = {
                animated: true,
                id: "1234",
                name: "blah",
            };
            const reply = processor.InsertEmoji(content);
            Chai.assert.equal(reply, "\x01blah\x011\x011234\x01");
        });
    });
    describe("InsertMxcImages / HTML", () => {
        it("processes unknown emoji correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            const msg = new MockMessage(channel) as any;
            const content = "Hello \x01hello\x010\x01123456789\x01";
            let reply = await processor.InsertMxcImages(content, msg);
            Chai.assert.equal(reply, "Hello <:hello:123456789>");

            reply = await processor.InsertMxcImages(content, msg, true);
            Chai.assert.equal(reply, "Hello &lt;:hello:123456789&gt;");
        });
        it("processes emoji correctly", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const guild: any = new MockGuild("123", []);
            const channel = new Discord.TextChannel(guild, {id: "456", name: "TestChannel"});
            guild.channels.set("456", channel);
            const msg = new MockMessage(channel) as any;
            const content = "Hello \x01hello\x010\x013333333\x01";
            let reply = await processor.InsertMxcImages(content, msg);
            Chai.assert.equal(reply, "Hello :hello:");

            reply = await processor.InsertMxcImages(content, msg, true);
            Chai.assert.equal(reply, "Hello <img alt=\"hello\" title=\"hello\" height=\"32\" src=\"mxc://image\" />");
        });
    });
    describe("InsertEmbeds", () => {
        it("processes titleless embeds properly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    description: "TestDescription",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "\n\n----\nTestDescription");
        });
        it("processes urlless embeds properly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    description: "TestDescription",
                    title: "TestTitle",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "\n\n----\n##### TestTitle\nTestDescription");
        });
        it("processes linked embeds properly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    description: "TestDescription",
                    title: "TestTitle",
                    url: "testurl",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "\n\n----\n##### [TestTitle](testurl)\nTestDescription");
        });
        it("rejects titleless and descriptionless embeds", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    url: "testurl",
                }),
            ];
            const inContent = "Some content...";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(content, "Some content...");
        });
        it("processes multiple embeds properly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    description: "TestDescription",
                    title: "TestTitle",
                    url: "testurl",
                }),
                new Discord.MessageEmbed(msg, {
                    description: "TestDescription2",
                    title: "TestTitle2",
                    url: "testurl2",
                }),
            ];
            const inContent = "";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(
                content,
"\n\n----\n##### [TestTitle](testurl)\nTestDescription\n\n----\n##### [TestTitle2](testurl2)\nTestDescription2",
            );
        });
        it("inserts embeds properly", () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [
                new Discord.MessageEmbed(msg, {
                    description: "TestDescription",
                    title: "TestTitle",
                    url: "testurl",
                }),
            ];
            const inContent = "Content that goes in the message";
            const content = processor.InsertEmbeds(inContent, msg);
            Chai.assert.equal(
                content,
`Content that goes in the message

----
##### [TestTitle](testurl)
TestDescription`,
            );
        });
    });
    describe("Message Type", () => {
        it("sets non-bot messages as m.text", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "no bot";
            msg.author.bot = false;
            const result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.msgtype, "m.text");
        });
        it("sets bot messages as m.notice", async () => {
            const processor = new DiscordMessageProcessor(
                new DiscordMessageProcessorOpts("localhost"), bot as DiscordBot);
            const msg = new MockMessage() as any;
            msg.embeds = [];
            msg.content = "a bot";
            msg.author.bot = true;
            const result = await processor.FormatMessage(msg);
            Chai.assert.equal(result.msgtype, "m.notice");
        });
    });
});
