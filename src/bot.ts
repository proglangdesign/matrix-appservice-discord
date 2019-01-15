import { DiscordBridgeConfig } from "./config";
import { DiscordClientFactory } from "./clientfactory";
import { DiscordStore } from "./store";
import { DbEmoji } from "./db/dbdataemoji";
import { DbEvent } from "./db/dbdataevent";
import { MatrixUser, RemoteUser, Bridge, Entry } from "matrix-appservice-bridge";
import { Util } from "./util";
import { MessageProcessor, MessageProcessorOpts, MessageProcessorMatrixResult } from "./messageprocessor";
import { MatrixEventProcessor, MatrixEventProcessorOpts } from "./matrixeventprocessor";
import { PresenceHandler } from "./presencehandler";
import { Provisioner } from "./provisioner";
import { UserSyncroniser } from "./usersyncroniser";
import { ChannelSyncroniser } from "./channelsyncroniser";
import { MatrixRoomHandler } from "./matrixroomhandler";
import { Log } from "./log";
import * as Discord from "discord.js";
import * as Bluebird from "bluebird";
import * as mime from "mime";

const log = new Log("DiscordBot");

const MIN_PRESENCE_UPDATE_DELAY = 250;

// TODO: This is bad. We should be serving the icon from the own homeserver.
const MATRIX_ICON_URL = "https://matrix.org/_matrix/media/r0/download/matrix.org/mlxoESwIsTbJrfXyAAogrNxA";
class ChannelLookupResult {
  public channel: Discord.TextChannel;
  public botUser: boolean;
}

export class DiscordBot {
  private config: DiscordBridgeConfig;
  private clientFactory: DiscordClientFactory;
  private store: DiscordStore;
  private bot: Discord.Client;
  private bridge: Bridge;
  private presenceInterval: any;
  private sentMessages: string[];
  private msgProcessor: MessageProcessor;
  private mxEventProcessor: MatrixEventProcessor;
  private presenceHandler: PresenceHandler;
  private userSync: UserSyncroniser;
  private channelSync: ChannelSyncroniser;
  private roomHandler: MatrixRoomHandler;

  /* Handles messages queued up to be sent to discord. */
  private discordMessageQueue: { [channelId: string]: Promise<any> };

  constructor(config: DiscordBridgeConfig, store: DiscordStore, private provisioner: Provisioner) {
    this.config = config;
    this.store = store;
    this.sentMessages = [];
    this.clientFactory = new DiscordClientFactory(store, config.auth);
    this.msgProcessor = new MessageProcessor(
      new MessageProcessorOpts(this.config.bridge.domain, this),
    );
    this.presenceHandler = new PresenceHandler(this);
    this.discordMessageQueue = {};
  }

  public setBridge(bridge: Bridge) {
    this.bridge = bridge;
    this.mxEventProcessor = new MatrixEventProcessor(
        new MatrixEventProcessorOpts(this.config, bridge, this),
    );
  }

  public setRoomHandler(roomHandler: MatrixRoomHandler) {
    this.roomHandler = roomHandler;
  }

  get ClientFactory(): DiscordClientFactory {
     return this.clientFactory;
  }

  get UserSyncroniser(): UserSyncroniser {
    return this.userSync;
  }

  get ChannelSyncroniser(): ChannelSyncroniser {
    return this.channelSync;
  }

  public GetIntentFromDiscordMember(member: Discord.GuildMember | Discord.User): any {
      return this.bridge.getIntentFromLocalpart(`_discord_${member.id}`);
  }

  public run(): Promise<void> {
    return this.clientFactory.init().then(() => {
      return this.clientFactory.getClient();
    }).then((client: any) => {
      if (!this.config.bridge.disableTypingNotifications) {
        client.on("typingStart", (c, u) => { this.OnTyping(c, u, true); });
        client.on("typingStop", (c, u) => { this.OnTyping(c, u, false);  });
      }
      if (!this.config.bridge.disablePresence) {
        client.on("presenceUpdate", (_, newMember: Discord.GuildMember) => {
          this.presenceHandler.EnqueueUser(newMember.user);
        });
      }
      this.channelSync = new ChannelSyncroniser(this.bridge, this.config, this);
      client.on("channelUpdate", (_, newChannel) => { this.channelSync.OnUpdate(newChannel); });
      client.on("channelDelete", (channel) => { this.channelSync.OnDelete(channel); });
      client.on("guildUpdate", (_, newGuild) => { this.channelSync.OnGuildUpdate(newGuild); });
      client.on("guildDelete", (guild) => { this.channelSync.OnGuildDelete(guild); });

      // Due to messages often arriving before we get a response from the send call,
      // messages get delayed from discord. We use Bluebird.delay to handle this.

      client.on("messageDelete", async (msg: Discord.Message) => {
          // tslint:disable-next-line:await-promise
          await Bluebird.delay(this.config.limits.discordSendDelay);
          this.discordMessageQueue[msg.channel.id] = (async () => {
              await (this.discordMessageQueue[msg.channel.id] || Promise.resolve());
              try {
                  await this.DeleteDiscordMessage(msg);
              } catch (err) {
                  log.error("Caught while handing 'messageDelete'", err);
              }
          })();
      });
      client.on("messageUpdate", async (oldMessage: Discord.Message, newMessage: Discord.Message) => {
          // tslint:disable-next-line:await-promise
          await Bluebird.delay(this.config.limits.discordSendDelay);
          this.discordMessageQueue[newMessage.channel.id] = (async () => {
              await (this.discordMessageQueue[newMessage.channel.id] || Promise.resolve());
              try {
                  await this.OnMessageUpdate(oldMessage, newMessage);
              } catch (err) {
                  log.error("Caught while handing 'messageUpdate'", err);
              }
          })();
      });
      client.on("message", async (msg: Discord.Message) => {
        // tslint:disable-next-line:await-promise
        await Bluebird.delay(this.config.limits.discordSendDelay);
        this.discordMessageQueue[msg.channel.id] = (async () => {
            await (this.discordMessageQueue[msg.channel.id] || Promise.resolve());
            try {
                await this.OnMessage(msg);
            } catch (err) {
                log.error("Caught while handing 'message'", err);
            }
        })();
      });
      const jsLog = new Log("discord.js");

      this.userSync = new UserSyncroniser(this.bridge, this.config, this);
      client.on("userUpdate", (_, user) => this.userSync.OnUpdateUser(user));
      client.on("guildMemberAdd", (user) => this.userSync.OnAddGuildMember(user));
      client.on("guildMemberRemove", (user) =>  this.userSync.OnRemoveGuildMember(user));
      client.on("guildMemberUpdate", (oldUser, newUser) =>  this.userSync.OnUpdateGuildMember(oldUser, newUser));
      client.on("debug", (msg) => { jsLog.verbose(msg); });
      client.on("error", (msg) => { jsLog.error(msg); });
      client.on("warn", (msg) => { jsLog.warn(msg); });
      log.info("Discord bot client logged in.");
      this.bot = client;

      if (!this.config.bridge.disablePresence) {
        if (!this.config.bridge.presenceInterval) {
          this.config.bridge.presenceInterval = MIN_PRESENCE_UPDATE_DELAY;
        }
        this.bot.guilds.forEach((guild) => {
            guild.members.forEach((member) => {
                if (member.id !== this.GetBotId()) {
                  this.presenceHandler.EnqueueUser(member.user);
                }
            });
        });
        this.presenceHandler.Start(
            Math.max(this.config.bridge.presenceInterval, MIN_PRESENCE_UPDATE_DELAY),
        );
      }
    });
  }

  public GetBotId(): string {
    return this.bot.user.id;
  }

  public GetGuilds(): Discord.Guild[] {
    return this.bot.guilds.array();
  }

  public ThirdpartySearchForChannels(guildId: string, channelName: string): any[] {
    if (channelName.startsWith("#")) {
      channelName = channelName.substr(1);
    }
    if (this.bot.guilds.has(guildId) ) {
      const guild = this.bot.guilds.get(guildId);
      return guild.channels.filter((channel) => {
        return channel.name.toLowerCase() === channelName.toLowerCase(); // Implement searching in the future.
      }).map((channel) => {
        return {
          alias: `#_discord_${guild.id}_${channel.id}:${this.config.bridge.domain}`,
          protocol: "discord",
          fields: {
            guild_id: guild.id,
            channel_name: channel.name,
            channel_id: channel.id,
          },
        };
      });
    } else {
      log.info("Tried to do a third party lookup for a channel, but the guild did not exist");
      return [];
    }
  }

  public LookupRoom(server: string, room: string, sender?: string): Promise<ChannelLookupResult> {
    const hasSender = sender !== null;
    return this.clientFactory.getClient(sender).then((client) => {
      const guild = client.guilds.get(server);
      if (!guild) {
        throw new Error(`Guild "${server}" not found`);
      }
      const channel = guild.channels.get(room);
      if (channel) {
        const lookupResult = new ChannelLookupResult();
        lookupResult.channel = channel;
        lookupResult.botUser = this.bot.user.id === client.user.id;
        return lookupResult;
      }
      throw new Error(`Channel "${room}" not found`);
    }).catch((err) => {
      log.verbose("LookupRoom => ", err);
      if (hasSender) {
        log.verbose(`Couldn't find guild/channel under user account. Falling back.`);
        return this.LookupRoom(server, room, null);
      }
      throw err;
    });
  }

  public async ProcessMatrixStateEvent(event: any): Promise<void> {
      log.verbose(`Got state event from ${event.room_id} ${event.type}`);
      const channel = await this.GetChannelFromRoomId(event.room_id) as Discord.TextChannel;
      const msg = this.mxEventProcessor.StateEventToMessage(event, channel);
      if (!msg) {
          return;
      }
      let res = await channel.send(msg);
      if (!Array.isArray(res)) {
        res = [res];
      }
      res.forEach((m: Discord.Message) => {
        log.verbose("Sent (state msg) ", m);
        this.sentMessages.push(m.id);
        const evt = new DbEvent();
        evt.MatrixId = event.event_id + ";" + event.room_id;
        evt.DiscordId = m.id;
        evt.GuildId = channel.guild.id;
        evt.ChannelId = channel.id;
        return this.store.Insert(evt);
      });
  }

  public async ProcessMatrixMsgEvent(event: any, guildId: string, channelId: string): Promise<null> {
    const mxClient = this.bridge.getClientFactory().getClientAs();
    log.verbose(`Looking up ${guildId}_${channelId}`);
    const result = await this.LookupRoom(guildId, channelId, event.sender);
    const chan = result.channel;
    const botUser = result.botUser;
    let profile = null;
    if (result.botUser) {
        // We are doing this through webhooks so fetch the user profile.
        profile = await mxClient.getStateEvent(event.room_id, "m.room.member", event.sender);
        if (profile === null) {
          log.warn(`User ${event.sender} has no member state. That's odd.`);
        }
    }
    const embedSet = await this.mxEventProcessor.EventToEmbed(event, profile, chan);
    const embed = embedSet.messageEmbed;
    const opts: Discord.MessageOptions = {};
    const file = await this.mxEventProcessor.HandleAttachment(event, mxClient);
    if (typeof(file) === "string") {
        embed.description += " " + file;
    } else {
        opts.file = file;
    }

    let msg = null;
    let hook: Discord.Webhook ;
    if (botUser) {
      const webhooks = await chan.fetchWebhooks();
      hook = webhooks.filterArray((h) => h.name === "_matrix").pop();
      // Create a new webhook if none already exists
      try {
        if (!hook) {
          hook = await chan.createWebhook("_matrix", MATRIX_ICON_URL, "Matrix Bridge: Allow rich user messages");
        }
      } catch (err) {
        log.error("Unable to create \"_matrix\" webhook. ", err);
      }
    }
    try {
      if (!botUser) {
        opts.embed = embedSet.replyEmbed;
        msg = await chan.send(embed.description, opts);
      } else if (hook) {
        msg = await hook.send(embed.description, {
            username: embed.author.name,
            avatarURL: embed.author.icon_url,
            files: opts.file ? [opts.file] : undefined,
            embeds: embedSet.replyEmbed ? [embedSet.replyEmbed] : undefined,
        } as any);
      } else {
        if (embedSet.replyEmbed) {
            embed.addField("Replying to", embedSet.replyEmbed.author.name);
            embed.addField("Reply text", embedSet.replyEmbed.description);
        }
        opts.embed = embed;
        msg = await chan.send("", opts);
      }
    } catch (err) {
      log.error("Couldn't send message. ", err);
    }
    if (!Array.isArray(msg)) {
      msg = [msg];
    }
    msg.forEach((m: Discord.Message) => {
      log.verbose("Sent ", m);
      this.sentMessages.push(m.id);
      const evt = new DbEvent();
      evt.MatrixId = event.event_id + ";" + event.room_id;
      evt.DiscordId = m.id;
      // Webhooks don't send guild info.
      evt.GuildId = guildId;
      evt.ChannelId = channelId;
      return this.store.Insert(evt);
    });
    return;
  }

  public async ProcessMatrixRedact(event: any) {
    if (this.config.bridge.disableDeletionForwarding) {
      return;
    }
    log.info(`Got redact request for ${event.redacts}`);
    log.verbose(`Event:`, event);

    const storeEvent = await this.store.Get(DbEvent, {matrix_id: event.redacts + ";" + event.room_id});

    if (!storeEvent.Result) {
      log.warn(`Could not redact because the event was not in the store.`);
      return;
    }
    log.info(`Redact event matched ${storeEvent.ResultCount} entries`);
    while (storeEvent.Next()) {
      log.info(`Deleting discord msg ${storeEvent.DiscordId}`);
      const result = await this.LookupRoom(storeEvent.GuildId, storeEvent.ChannelId, event.sender);
      const chan = result.channel;

      const msg = await chan.fetchMessage(storeEvent.DiscordId);
      try {
        await msg.delete();
        log.info(`Deleted message`);
      } catch (ex) {
        log.warn(`Failed to delete message`, ex);
      }
    }
  }

  public OnUserQuery(userId: string): any {
    return false;
  }

  public GetDiscordUserOrMember(
      userId: Discord.Snowflake, guildId?: Discord.Snowflake,
  ): Promise<Discord.User|Discord.GuildMember> {
        try {
            if (guildId && this.bot.guilds.has(guildId)) {
               return this.bot.guilds.get(guildId).fetchMember(userId);
            }
            return this.bot.fetchUser(userId);
        } catch (ex) {
            log.warn(`Could not fetch user data for ${userId} (guild: ${guildId})`);
            return undefined;
        }
  }

  public GetChannelFromRoomId(roomId: string): Promise<Discord.Channel> {
    return this.bridge.getRoomStore().getEntriesByMatrixId(
      roomId,
    ).then((entries) => {
      if (entries.length === 0) {
        log.verbose(`Couldn"t find channel for roomId ${roomId}.`);
        return Promise.reject("Room(s) not found.");
      }
      const entry = entries[0];
      const guild = this.bot.guilds.get(entry.remote.get("discord_guild"));
      if (guild) {
        const channel = this.bot.channels.get(entry.remote.get("discord_channel"));
        if (channel) {
          return channel;
        }
        throw Error("Channel given in room entry not found");
      }
      throw Error("Guild given in room entry not found");
    });
  }

  public async GetEmoji(name: string, animated: boolean, id: string): Promise<string> {
    if (!id.match(/^\d+$/)) {
      throw new Error("Non-numerical ID");
    }
    const dbEmoji: DbEmoji = await this.store.Get(DbEmoji, {emoji_id: id});
    if (!dbEmoji.Result) {
      const url = "https://cdn.discordapp.com/emojis/" + id + (animated ? ".gif" : ".png");
      const intent = this.bridge.getIntent();
      const mxcUrl = (await Util.UploadContentFromUrl(url, intent, name)).mxcUrl;
      dbEmoji.EmojiId = id;
      dbEmoji.Name = name;
      dbEmoji.Animated = animated;
      dbEmoji.MxcUrl = mxcUrl;
      await this.store.Insert(dbEmoji);
    }
    return dbEmoji.MxcUrl;
  }

  public GetRoomIdsFromGuild(guild: String): Promise<string[]> {
    return this.bridge.getRoomStore().getEntriesByRemoteRoomData({
      discord_guild: guild,
    }).then((rooms) => {
      if (rooms.length === 0) {
        log.verbose(`Couldn't find room(s) for guild id:${guild}.`);
        return Promise.reject("Room(s) not found.");
      }
      return rooms.map((room) => room.matrix.getId());
    });
  }

  private async SendMatrixMessage(matrixMsg: MessageProcessorMatrixResult, chan: Discord.Channel,
                                  guild: Discord.Guild, author: Discord.User,
                                  msgID: string): Promise<boolean> {
    const rooms = await this.channelSync.GetRoomIdsFromChannel(chan);
    const intent = this.GetIntentFromDiscordMember(author);

    rooms.forEach((room) => {
      intent.sendMessage(room, {
        body: matrixMsg.body,
        msgtype: "m.text",
        formatted_body: matrixMsg.formattedBody,
        format: "org.matrix.custom.html",
      }).then((res) => {
        const evt = new DbEvent();
        evt.MatrixId = res.event_id + ";" + room;
        evt.DiscordId = msgID;
        evt.ChannelId = chan.id;
        evt.GuildId = guild.id;
        return this.store.Insert(evt);
      });
    });

    // Sending was a success
    return true;
  }

  private OnTyping(channel: Discord.Channel, user: Discord.User, isTyping: boolean) {
    this.channelSync.GetRoomIdsFromChannel(channel).then((rooms) => {
      const intent = this.GetIntentFromDiscordMember(user);
      return Promise.all(rooms.map((room) => {
        return intent.sendTyping(room, isTyping);
      }));
    }).catch((err) => {
      log.warn("Failed to send typing indicator.", err);
    });
  }

  private async OnMessage(msg: Discord.Message) {
    const indexOfMsg = this.sentMessages.indexOf(msg.id);
    const chan = msg.channel as Discord.TextChannel;
    if (indexOfMsg !== -1) {
      log.verbose("Got repeated message, ignoring.");
      delete this.sentMessages[indexOfMsg];
      return; // Skip *our* messages
    }
    if (msg.author.id === this.bot.user.id) {
      // We don't support double bridging.
      return;
    }
    // Issue #57: Detect webhooks
    if (msg.webhookID != null) {
      const webhook = (await chan.fetchWebhooks())
                      .filterArray((h) => h.name === "_matrix").pop();
      if (webhook != null && msg.webhookID === webhook.id) {
        // Filter out our own webhook messages.
        return;
      }
    }

    // Check if there's an ongoing bridge request
    if ((msg.content === "!approve" || msg.content === "!deny") && this.provisioner.HasPendingRequest(chan)) {
      try {
        const isApproved = msg.content === "!approve";
        const successfullyBridged = await this.provisioner.MarkApproved(chan, msg.member, isApproved);
        if (successfullyBridged && isApproved) {
          msg.channel.sendMessage("Thanks for your response! The matrix bridge has been approved");
        } else if (successfullyBridged && !isApproved) {
          msg.channel.sendMessage("Thanks for your response! The matrix bridge has been declined");
        } else {
          msg.channel.sendMessage("Thanks for your response, however the time for responses has expired - sorry!");
        }
      } catch (err) {
        if (err.message === "You do not have permission to manage webhooks in this channel") {
          msg.channel.sendMessage(err.message);
        } else {
          log.error("Error processing room approval");
          log.error(err);
        }
      }

      return; // stop processing - we're approving/declining the bridge request
    }

    // check if it is a command to process by the bot itself
    if (msg.content.startsWith("!matrix")) {
      await this.roomHandler.HandleDiscordCommand(msg);
      return;
    }

    // Update presence because sometimes discord misses people.
    return this.userSync.OnUpdateUser(msg.author).then(() => {
      return this.channelSync.GetRoomIdsFromChannel(msg.channel).catch((err) => {
        log.verbose("No bridged rooms to send message to. Oh well.");
        return null;
      });
    }).then((rooms) => {
      if (rooms === null) {
        return null;
      }
      const intent = this.GetIntentFromDiscordMember(msg.author);
      // Check Attachements
      msg.attachments.forEach((attachment) => {
        Util.UploadContentFromUrl(attachment.url, intent, attachment.filename).then((content) => {
          const fileMime = mime.lookup(attachment.filename);
          const msgtype = attachment.height ? "m.image" : "m.file";
          const info = {
            mimetype: fileMime,
            size: attachment.filesize,
            w: null,
            h: null,
          };
          if (msgtype === "m.image") {
            info.w = attachment.width;
            info.h = attachment.height;
          }
          rooms.forEach((room) => {
            intent.sendMessage(room, {
              body: attachment.filename,
              info,
              msgtype,
              url: content.mxcUrl,
              external_url: attachment.url,
            }).then((res) => {
              const evt = new DbEvent();
              evt.MatrixId = res.event_id + ";" + room;
              evt.DiscordId = msg.id;
              evt.ChannelId = msg.channel.id;
              evt.GuildId = msg.guild.id;
              return this.store.Insert(evt);
            });
          });
        });
      });
      if (msg.content !== null && msg.content !== "") {
        this.msgProcessor.FormatDiscordMessage(msg).then((result) => {
            rooms.forEach((room) => {
              const trySend = () => intent.sendMessage(room, {
                body: result.body,
                msgtype: "m.text",
                formatted_body: result.formattedBody,
                format: "org.matrix.custom.html",
              });
              const afterSend = (res) => {
                const evt = new DbEvent();
                evt.MatrixId = res.event_id + ";" + room;
                evt.DiscordId = msg.id;
                evt.ChannelId = msg.channel.id;
                evt.GuildId = msg.guild.id;
                return this.store.Insert(evt);
              };
              trySend().then(afterSend).catch((e) => {
                if (e.errcode !== "M_FORBIDDEN") {
                  log.error("DiscordBot", "Failed to send message into room.", e);
                  return;
                }
                return this.userSync.EnsureJoin(msg.member, room).then(() => trySend()).then(afterSend);
              });
            });
        });
      }
    }).catch((err) => {
      log.verbose("Failed to send message into room.", err);
    });
  }

  private async OnMessageUpdate(oldMsg: Discord.Message, newMsg: Discord.Message) {
    /*// Check if an edit was actually made
    if (oldMsg.content === newMsg.content) {
      return;
    }

    // Create a new edit message using the old and new message contents
    const editedMsg = await this.msgProcessor.FormatEdit(oldMsg, newMsg);

    // Send the message to all bridged matrix rooms
    if (!await this.SendMatrixMessage(editedMsg, newMsg.channel, newMsg.guild, newMsg.author, newMsg.id)) {
      log.error("Unable to announce message edit for msg id:", newMsg.id);
    }*/
    return;
  }

  private async DeleteDiscordMessage(msg: Discord.Message) {
    log.info(`Got delete event for ${msg.id}`);
    const storeEvent = await this.store.Get(DbEvent, {discord_id: msg.id});
    if (!storeEvent.Result) {
      log.warn(`Could not redact because the event was not in the store.`);
      return;
    }
    while (storeEvent.Next()) {
      log.info(`Deleting discord msg ${storeEvent.DiscordId}`);
      const intent = this.GetIntentFromDiscordMember(msg.author);
      const matrixIds = storeEvent.MatrixId.split(";");
      await intent.getClient().redactEvent(matrixIds[1], matrixIds[0]);
    }
  }
}
