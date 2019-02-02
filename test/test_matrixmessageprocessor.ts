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

import * as Chai from "chai";
import * as Discord from "discord.js";
import { MockGuild } from "./mocks/guild";
import { MockMember } from "./mocks/member";
import { MockChannel } from "./mocks/channel";
import { MockEmoji } from "./mocks/emoji";
import { DiscordBot } from "../src/bot";
import { DbEmoji } from "../src/db/dbdataemoji";
import { MatrixMessageProcessor } from "../src/matrixmessageprocessor";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

const mxClient = {
    getStateEvent: async (roomId, stateType, _) => {
        if (stateType === "m.room.power_levels") {
            return {
                notifications: {
                    room: 50,
                },
                users: {
                    "@nopower:localhost": 0,
                    "@power:localhost": 100,
                },
            };
        }
        return null;
    },
};

const bot = {
    GetEmojiByMxc: async (mxc: string): Promise<DbEmoji> => {
        if (mxc === "mxc://real_emote:localhost") {
            const emoji = new DbEmoji();
            emoji.Name = "real_emote";
            emoji.EmojiId = "123456";
            emoji.Animated = false;
            emoji.MxcUrl = mxc;
            return emoji;
        }
        throw new Error("Couldn't fetch from store");
    },
} as DiscordBot;

function getPlainMessage(msg: string, msgtype: string = "m.text") {
    return {
        body: msg,
        msgtype,
    };
}

function getHtmlMessage(msg: string, msgtype: string = "m.text") {
    return {
        body: msg,
        formatted_body: msg,
        msgtype,
    };
}

describe("MatrixMessageProcessor", () => {
    describe("FormatMessage / body / simple", () => {
        it("leaves blank stuff untouched", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hello world!");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hello world!");
        });
        it("escapes simple stuff", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hello *world* how __are__ you?");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hello \\*world\\* how \\_\\_are\\_\\_ you?");
        });
        it("escapes more complex stuff", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("wow \\*this\\* is cool");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("wow \\\\\\*this\\\\\\* is cool");
        });
    });
    describe("FormatMessage / formatted_body / simple", () => {
        it("leaves blank stuff untouched", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("hello world!");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hello world!");
        });
        it("un-escapes simple stuff", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("foxes &amp; foxes");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("foxes & foxes");
        });
        it("converts italic formatting", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("this text is <em>italic</em> and so is <i>this one</i>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("this text is *italic* and so is *this one*");
        });
        it("converts bold formatting", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("wow some <b>bold</b> and <strong>more</strong> boldness!");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("wow some **bold** and **more** boldness!");
        });
        it("converts underline formatting", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("to be <u>underlined</u> or not to be?");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("to be __underlined__ or not to be?");
        });
        it("converts strike formatting", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("does <del>this text</del> exist?");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("does ~~this text~~ exist?");
        });
        it("converts code", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("WOW this is <code>some awesome</code> code");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("WOW this is `some awesome` code");
        });
        it("converts multiline-code", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<p>here</p><pre><code>is\ncode\n</code></pre><p>yay</p>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("here```\nis\ncode\n```yay");
        });
        it("converts multiline language code", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage(`<p>here</p>
<pre><code class="language-js">is
code
</code></pre>
<p>yay</p>`);
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("here```js\nis\ncode\n```yay");
        });
        it("handles linebreaks", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("line<br>break");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("line\nbreak");
        });
        it("handles <hr>", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("test<hr>foxes");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("test\n----------\nfoxes");
        });
        it("handles headings", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage(`<h1>fox</h1>
<h2>floof</h2>
<h3>pony</h3>
<h4>hooves</h4>
<h5>tail</h5>
<h6>foxies</h6>`);
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal(`**# fox**
**## floof**
**### pony**
**#### hooves**
**##### tail**
**###### foxies**`);
        });
    });
    describe("FormatMessage / formatted_body / complex", () => {
        it("html unescapes stuff inside of code", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<code>is &lt;em&gt;italic&lt;/em&gt;?</code>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("`is <em>italic</em>?`");
        });
        it("html unescapes inside of pre", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<pre><code>wow &amp;</code></pre>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("```\nwow &```");
        });
        it("doesn't parse inside of code", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<code>*yay*</code>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("`*yay*`");
        });
        it("doesn't parse inside of pre", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<pre><code>*yay*</code></pre>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("```\n*yay*```");
        });
        it("parses new lines", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<em>test</em><br><strong>ing</strong>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("*test*\n**ing**");
        });
        it("drops mx-reply", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<mx-reply><blockquote>message</blockquote></mx-reply>test reply");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("test reply");
        });
        it("parses links", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<a href=\"http://example.com\">link</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("[link](http://example.com)");
        });
        it("parses links with same content", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<a href=\"http://example.com\">http://example.com</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("http://example.com");
        });
        it("doesn't discord-escape links", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<a href=\"http://example.com/_blah_/\">link</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("[link](http://example.com/_blah_/)");
        });
        it("doesn't discord-escape links with same content", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<a href=\"http://example.com/_blah_/\">http://example.com/_blah_/</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("http://example.com/_blah_/");
        });
    });
    describe("FormatMessage / formatted_body / discord", () => {
        it("Parses user pills", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const member = new MockMember("12345", "TestUsername", guild);
            guild.members.set("12345", member);
            const msg = getHtmlMessage("<a href=\"https://matrix.to/#/@_discord_12345:localhost\">TestUsername</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("<@12345>");
        });
        it("Ignores invalid user pills", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const member = new MockMember("12345", "TestUsername", guild);
            guild.members.set("12345", member);
            const msg = getHtmlMessage("<a href=\"https://matrix.to/#/@_discord_789:localhost\">TestUsername</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("[TestUsername](https://matrix.to/#/@_discord_789:localhost)");
        });
        it("Parses channel pills", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const channel = new MockChannel("12345", guild, "text", "SomeChannel");
            guild.channels.set("12345", channel as any);
            const msg = getHtmlMessage("<a href=\"https://matrix.to/#/#_discord_1234_12345:" +
                "localhost\">#SomeChannel</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("<#12345>");
        });
        it("Handles invalid channel pills", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const channel = new MockChannel("12345", guild, "text", "SomeChannel");
            guild.channels.set("12345", channel as any);
            const msg = getHtmlMessage("<a href=\"https://matrix.to/#/#_discord_1234_789:localhost\">#SomeChannel</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("https://matrix.to/#/#_discord_1234_789:localhost");
        });
        it("Handles external channel pills", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<a href=\"https://matrix.to/#/#matrix:matrix.org\">#SomeChannel</a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("https://matrix.to/#/#matrix:matrix.org");
        });
        it("Ignores links without href", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<a><em>yay?</em></a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("*yay?*");
        });
        it("Ignores links with non-matrix href", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<a href=\"http://example.com\"><em>yay?</em></a>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("[*yay?*](http://example.com)");
        });
    });
    describe("FormatMessage / formatted_body / emoji", () => {
        it("Inserts emoji by name", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const emoji = new MockEmoji("123456", "test_emoji");
            guild.emojis.set("123456", emoji);
            const msg = getHtmlMessage("<img alt=\"test_emoji\">");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("<:test_emoji:123456>");
        });
        it("Inserts emojis by mxc url", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const emoji = new MockEmoji("123456", "test_emoji");
            guild.emojis.set("123456", emoji);
            const msg = getHtmlMessage("<img src=\"mxc://real_emote:localhost\">");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("<:test_emoji:123456>");
        });
        it("parses unknown mxc urls", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const emoji = new MockEmoji("123456", "test_emoji");
            guild.emojis.set("123456", emoji);
            const msg = getHtmlMessage("<img alt=\"yay\" src=\"mxc://unreal_emote:localhost\">");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("[yay](mxc://unreal_emote:localhost)");
        });
        it("ignores with no alt / title, too", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const emoji = new MockEmoji("123456", "test_emoji");
            guild.emojis.set("123456", emoji);
            const msg = getHtmlMessage("<img>");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("");
        });
    });
    describe("FormatMessage / formatted_body / matrix", () => {
        it("escapes @everyone", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hey @everyone");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hey @\u200Beveryone");
        });
        it("escapes @here", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hey @here");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("hey @\u200Bhere");
        });
        it("converts @room to @here, if sufficient power", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hey @room");
            const params = {
                mxClient,
                roomId: "!123456:localhost",
                userId: "@power:localhost",
            };
            const result = await mp.FormatMessage(msg, guild as any, params as any);
            expect(result).is.equal("hey @here");
        });
        it("ignores @room to @here conversion, if insufficient power", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("hey @room");
            const params = {
                mxClient,
                roomId: "!123456:localhost",
                userId: "@nopower:localhost",
            };
            const result = await mp.FormatMessage(msg, guild as any, params as any);
            expect(result).is.equal("hey @room");
        });
        it("handles /me for normal names", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("floofs", "m.emote");
            const params = {
                displayname: "fox",
            };
            const result = await mp.FormatMessage(msg, guild as any, params as any);
            expect(result).is.equal("_fox floofs_");
        });
        it("handles /me for short names", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("floofs", "m.emote");
            const params = {
                displayname: "f",
            };
            const result = await mp.FormatMessage(msg, guild as any, params as any);
            expect(result).is.equal("_floofs_");
        });
        it("handles /me for long names", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getPlainMessage("floofs", "m.emote");
            const params = {
                displayname: "foxfoxfoxfoxfoxfoxfoxfoxfoxfoxfoxfox",
            };
            const result = await mp.FormatMessage(msg, guild as any, params as any);
            expect(result).is.equal("_floofs_");
        });
    });
    describe("FormatMessage / formatted_body / blockquotes", () => {
        it("parses single blockquotes", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<blockquote>hey</blockquote>there");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("> hey\n\nthere");
        });
        it("parses double blockquotes", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<blockquote><blockquote>hey</blockquote>you</blockquote>there");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("> > hey\n> \n> you\n\nthere");
        });
        it("parses blockquotes with <p>", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage("<blockquote>\n<p>spoky</p>\n</blockquote>\n<p>test</p>\n");
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("> spoky\n\ntest");
        });
        it("parses double blockquotes with <p>", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage(`<blockquote>
<blockquote>
<p>spoky</p>
</blockquote>
<p>testing</p>
</blockquote>
<p>test</p>
`);
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("> > spoky\n> \n> testing\n\ntest");
        });
    });
    describe("FormatMessage / formatted_body / lists", () => {
        it("parses simple unordered lists", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage(`<p>soru</p>
<ul>
<li>test</li>
<li>ing</li>
</ul>
<p>more</p>
`);
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("soru\n● test\n● ing\n\nmore");
        });
        it("parses nested unordered lists", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage(`<p>foxes</p>
<ul>
<li>awesome</li>
<li>floofy
<ul>
<li>fur</li>
<li>tail</li>
</ul>
</li>
</ul>
<p>yay!</p>
`);
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("foxes\n● awesome\n● floofy\n    ○ fur\n    ○ tail\n\nyay!");
        });
        it("parses more nested unordered lists", async () => {
            const mp = new MatrixMessageProcessor(bot);
            const guild = new MockGuild("1234");
            const msg = getHtmlMessage(`<p>foxes</p>
<ul>
<li>awesome</li>
<li>floofy
<ul>
<li>fur</li>
<li>tail</li>
</ul>
</li>
<li>cute</li>
</ul>
<p>yay!</p>
`);
            const result = await mp.FormatMessage(msg, guild as any);
            expect(result).is.equal("foxes\n● awesome\n● floofy\n    ○ fur\n    ○ tail\n● cute\n\nyay!");
        });
    });
    it("parses simple ordered lists", async () => {
        const mp = new MatrixMessageProcessor(bot);
        const guild = new MockGuild("1234");
        const msg = getHtmlMessage(`<p>oookay</p>
<ol>
<li>test</li>
<li>test more</li>
</ol>
<p>ok?</p>
`);
        const result = await mp.FormatMessage(msg, guild as any);
        expect(result).is.equal("oookay\n1. test\n2. test more\n\nok?");
    });
    it("parses nested ordered lists", async () => {
        const mp = new MatrixMessageProcessor(bot);
        const guild = new MockGuild("1234");
        const msg = getHtmlMessage(`<p>and now</p>
<ol>
<li>test</li>
<li>test more
<ol>
<li>and more</li>
<li>more?</li>
</ol>
</li>
<li>done!</li>
</ol>
<p>ok?</p>
`);
        const result = await mp.FormatMessage(msg, guild as any);
        expect(result).is.equal("and now\n1. test\n2. test more\n    1. and more\n    2. more?\n3. done!\n\nok?");
    });
    it("parses ordered lists with different start", async () => {
        const mp = new MatrixMessageProcessor(bot);
        const guild = new MockGuild("1234");
        const msg = getHtmlMessage(`<ol start="5">
<li>test</li>
<li>test more</li>
</ol>`);
        const result = await mp.FormatMessage(msg, guild as any);
        expect(result).is.equal("\n5. test\n6. test more");
    });
    it("parses ul in ol", async () => {
        const mp = new MatrixMessageProcessor(bot);
        const guild = new MockGuild("1234");
        const msg = getHtmlMessage(`<ol>
<li>test</li>
<li>test more
<ul>
<li>asdf</li>
<li>jklö</li>
</ul>
</li>
</ol>`);
        const result = await mp.FormatMessage(msg, guild as any);
        expect(result).is.equal("\n1. test\n2. test more\n    ○ asdf\n    ○ jklö");
    });
    it("parses ol in ul", async () => {
        const mp = new MatrixMessageProcessor(bot);
        const guild = new MockGuild("1234");
        const msg = getHtmlMessage(`<ul>
<li>test</li>
<li>test more
<ol>
<li>asdf</li>
<li>jklö</li>
</ol>
</li>
</ul>`);
        const result = await mp.FormatMessage(msg, guild as any);
        expect(result).is.equal("\n● test\n● test more\n    1. asdf\n    2. jklö");
    });
});
