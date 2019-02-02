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
// import * as Proxyquire from "proxyquire";
import { DiscordStore, CURRENT_SCHEMA } from "../src/store";
import { DbEmoji } from "../src/db/dbdataemoji";
import { DbEvent } from "../src/db/dbdataevent";
import { Log } from "../src/log";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

const expect = Chai.expect;

const TEST_SCHEMA = CURRENT_SCHEMA;

// const assert = Chai.assert;

describe("DiscordStore", () => {
    describe("init", () => {
        it("can create a db", async () => {
            const store = new DiscordStore(":memory:");
            return store.init();
        });
    });
    describe("add_user_token", () => {
        it("should not throw when adding an entry", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            await store.add_user_token("userid", "token", "discordid");
        });
    });
    describe("Get|Insert|Update<DbEmoji>", () => {
        it("should insert successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const emoji = new DbEmoji();
            emoji.EmojiId = "123";
            emoji.Animated = false;
            emoji.Name = "TestEmoji";
            emoji.MxcUrl = "TestUrl";
            await store.Insert(emoji);
        });
        it("should get successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const insertEmoji = new DbEmoji();
            insertEmoji.EmojiId = "123";
            insertEmoji.Animated = false;
            insertEmoji.Name = "TestEmoji";
            insertEmoji.MxcUrl = "TestUrl";
            await store.Insert(insertEmoji);
            const getEmoji = await store.Get(DbEmoji, {emoji_id: "123"});
            Chai.assert.equal(getEmoji!.Name, "TestEmoji");
            Chai.assert.equal(getEmoji!.MxcUrl, "TestUrl");
        });
        it("should not return nonexistant emoji", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const getEmoji = await store.Get(DbEmoji, {emoji_id: "123"});
            Chai.assert.isFalse(getEmoji!.Result);
        });
        it("should update successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const insertEmoji = new DbEmoji();
            insertEmoji.EmojiId = "123";
            insertEmoji.Animated = false;
            insertEmoji.Name = "TestEmoji";
            insertEmoji.MxcUrl = "TestUrl";
            await store.Insert(insertEmoji);
            insertEmoji.EmojiId = "123";
            insertEmoji.Animated = false;
            insertEmoji.Name = "TestEmoji2";
            insertEmoji.MxcUrl = "NewURL";
            await store.Update(insertEmoji);
            const getEmoji = await store.Get(DbEmoji, {emoji_id: "123"});
            Chai.assert.equal(getEmoji!.Name, "TestEmoji2");
            Chai.assert.equal(getEmoji!.MxcUrl, "NewURL");
            Chai.assert.notEqual(getEmoji!.CreatedAt, getEmoji!.UpdatedAt);
        });
    });
    describe("Get|Insert|Delete<DbEvent>", () => {
        it("should insert successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const event = new DbEvent();
            event.MatrixId = "123";
            event.DiscordId = "456";
            event.GuildId = "123";
            event.ChannelId = "123";
            await store.Insert(event);
        });
        it("should get successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const event = new DbEvent();
            event.MatrixId = "123";
            event.DiscordId = "456";
            event.GuildId = "123";
            event.ChannelId = "123";
            await store.Insert(event);
            const getEventDiscord = await store.Get(DbEvent, {discord_id: "456"});
            getEventDiscord!.Next();
            Chai.assert.equal(getEventDiscord!.MatrixId, "123");
            Chai.assert.equal(getEventDiscord!.DiscordId, "456");
            Chai.assert.equal(getEventDiscord!.GuildId, "123");
            Chai.assert.equal(getEventDiscord!.ChannelId, "123");
            const getEventMatrix = await store.Get(DbEvent, {matrix_id: "123"});
            getEventMatrix!.Next();
            Chai.assert.equal(getEventMatrix!.MatrixId, "123");
            Chai.assert.equal(getEventMatrix!.DiscordId, "456");
            Chai.assert.equal(getEventMatrix!.GuildId, "123");
            Chai.assert.equal(getEventMatrix!.ChannelId, "123");
        });
        const MSG_COUNT = 5;
        it("should get multiple discord msgs successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            for (let i = 0; i < MSG_COUNT; i++) {
                const event = new DbEvent();
                event.MatrixId = "123";
                event.DiscordId = "456" + i;
                event.GuildId = "123";
                event.ChannelId = "123";
                await store.Insert(event);
            }
            const getEventDiscord = await store.Get(DbEvent, {matrix_id: "123"});
            Chai.assert.equal(getEventDiscord!.ResultCount, MSG_COUNT);
        });
        it("should get multiple matrix msgs successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            for (let i = 0; i < MSG_COUNT; i++) {
                const event = new DbEvent();
                event.MatrixId = "123" + i;
                event.DiscordId = "456";
                event.GuildId = "123";
                event.ChannelId = "123";
                await store.Insert(event);
            }
            const getEventMatrix = await store.Get(DbEvent, {discord_id: "456"});
            Chai.assert.equal(getEventMatrix!.ResultCount, MSG_COUNT);
        });
        it("should not return nonexistant event", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const getMessage = await store.Get(DbEvent, {matrix_id: "123"});
            Chai.assert.isFalse(getMessage!.Result);
        });
        it("should delete successfully", async () => {
            const store = new DiscordStore(":memory:");
            await store.init();
            const event = new DbEvent();
            event.MatrixId = "123";
            event.DiscordId = "456";
            event.GuildId = "123";
            event.ChannelId = "123";
            await store.Insert(event);
            await store.Delete(event);
            const getEvent = await store.Get(DbEvent, {matrix_id: "123"});
            getEvent!.Next();
            Chai.assert.isFalse(getEvent!.Result);
        });
    });
});
