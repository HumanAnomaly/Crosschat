import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { discordConfig } from "./config.js";
import { createLogger, printBanner } from "@crosschat/core";
import { translate } from "./i18n.js";
import { handleDeleted, handleInbound } from "./bridge.js";
import { deploySlashCommands } from "./deploy-commands.js";
import { createLinkedHandler, createNotifyHandler, handleDisconnect } from "./disconnect.js";
import {
  actionRow,
  fetchLinkStatus,
  handleCodeInput,
  handleCreateCode,
  handleWiredRequest,
  isWired,
  markUnwired,
  markWired,
  usernameOf,
  type LinkStatus,
} from "./wired.js";

if (!discordConfig.token) {
  createLogger("discord").warn("DISCORD_BOT_TOKEN is empty. Discord treated as not installed; other platforms keep running.");
  process.exit(0);
}

const log = createLogger("discord");

let dcActive = true;

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(discordConfig.locale, key, vars);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function accountOf(status: LinkStatus): string {
  const name = status.user?.name?.trim();
  const email = status.user?.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || t("wired.unknownAccount");
}

function statusText(status: LinkStatus): string {
  return t("status.wired", {
    account: accountOf(status),
    since: fmtDate(status.connection?.createdAt),
    total: status.stats?.total ?? 0,
    fromWeb: status.stats?.fromWeb ?? 0,
    fromDiscord: status.stats?.fromDiscord ?? status.stats?.fromTelegram ?? 0,
    last: fmtDate(status.stats?.lastMessageAt),
  });
}

async function reconcile(userId: string): Promise<LinkStatus | null> {
  const status = await fetchLinkStatus(userId);
  if (status?.wired) markWired(userId);
  else if (status && !status.wired && isWired(userId)) markUnwired(userId);
  return status;
}

client.on(Events.ClientReady, () => {
  log.info(`discord service logged in as ${client.user?.tag}\n`);
  const derivedId = client.user?.id ?? "";
  const configuredId = discordConfig.clientId;
  const effectiveId = configuredId || derivedId;
  if (!effectiveId) {
    log.error("slash deploy skipped: DISCORD_CLIENT_ID is empty");
    return;
  }
  if (configuredId && configuredId !== derivedId) {
    log.error(`slash deploy skipped: DISCORD_CLIENT_ID ${configuredId} != logged-in ${derivedId}`);
    return;
  }
  deploySlashCommands(effectiveId).catch((err) => {
    log.error("slash deploy failed:", err);
  });
});

client.on(Events.MessageDelete, (message) => {
  void (async () => {
    try {
      if (message.author?.bot) return;
      await handleDeleted(message.author?.id ?? null, message.id);
    } catch (err) {
      log.error("discord delete failed:", err);
    }
  })();
});

client.on(Events.MessageCreate, (message) => {
  void (async () => {
    try {
      if (message.author.bot) return;
      const isDm = message.channel.type === ChannelType.DM;
      if (!isDm) return;
      const raw = message.content.trim();
      if (raw.startsWith("!")) {
        await message.reply(t("help.text"));
        return;
      }
      const userId = message.author.id;
      const username = usernameOf(message.author);
      const target = {
        userId,
        username,
        reply: async (text: string, wired: boolean) => {
          await message.reply({ content: text, components: [actionRow(wired).toJSON() as never] }).catch(async () => {
            await message.reply(text);
          });
        },
      };
      if (await handleCodeInput(target, raw)) return;
      await handleInbound(message);
    } catch (err) {
      log.error("discord update failed:", err);
    }
  })();
});

client.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    try {
      if (interaction.isButton()) {
        const userId = interaction.user.id;
        const username = usernameOf(interaction.user);
        const target = {
          userId,
          username,
          reply: async (text: string, wired: boolean) => {
            if (interaction.replied || interaction.deferred) await interaction.followUp({ content: text, ephemeral: true });
            else await interaction.reply({ content: text, ephemeral: true, components: [actionRow(wired).toJSON() as never] });
          },
        };
        if (interaction.customId === "wire") {
          await interaction.deferReply({ ephemeral: true }).catch(() => {
          });
          await handleWiredRequest(target);
        } else if (interaction.customId === "newcode") {
          await interaction.deferReply({ ephemeral: true }).catch(() => {
          });
          await handleCreateCode(target);
        } else if (interaction.customId === "unwire") {
          await interaction.deferReply({ ephemeral: true }).catch(() => {

          });
          await handleDisconnect(userId, async (text) => {
            if (interaction.replied || interaction.deferred) await interaction.followUp({ content: text, ephemeral: true });
            else await interaction.reply({ content: text, ephemeral: true });
          });
        }
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.channel?.type !== ChannelType.DM && interaction.channel) {
        await interaction.reply({ content: t("media.guildOnly"), ephemeral: true });
        return;
      }
      const userId = interaction.user.id;
      const username = usernameOf(interaction.user);
      const target = {
        userId,
        username,
        reply: async (text: string, wired: boolean) => {
          if (interaction.replied || interaction.deferred) await interaction.followUp({ content: text, ephemeral: true });
          else await interaction.reply({ content: text, ephemeral: true, components: [actionRow(wired).toJSON() as never] });
        },
      };
      const say = async (text: string) => {
        if (interaction.replied || interaction.deferred) await interaction.followUp({ content: text, ephemeral: true });
        else await interaction.reply({ content: text, ephemeral: true });
      };
      switch (interaction.commandName) {
        case "start": {
          await interaction.deferReply({ ephemeral: true });
          const status = await reconcile(userId);
          const wired = status ? status.wired : isWired(userId);
          if (wired && status?.wired) await say(statusText(status));
          else await say(t(wired ? "start.connected" : "start.hello"));
          break;
        }
        case "status": {
          await interaction.deferReply({ ephemeral: true });
          const status = await fetchLinkStatus(userId);
          if (!status) {
            await say(t(isWired(userId) ? "status.offlineWired" : "status.offlineUnwired"));
            break;
          }
          if (!status.wired) {
            if (isWired(userId)) markUnwired(userId);
            await say(t("status.unwired"));
            break;
          }
          markWired(userId);
          await say(statusText(status));
          break;
        }
        case "help": {
          await say(t("help.text"));
          break;
        }
        case "wired": {
          await interaction.deferReply({ ephemeral: true });
          const code = interaction.options.getString("code", false)?.trim();
          if (code) {
            await handleCodeInput(target, code, { skipPending: true });
            break;
          }
          await handleWiredRequest(target);
          break;
        }
        case "newcode": {
          await interaction.deferReply({ ephemeral: true });
          await handleCreateCode(target);
          break;
        }
        case "disconnect": {
          await interaction.deferReply({ ephemeral: true });
          await handleDisconnect(userId, async (text) => {
            await say(text);
          });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      log.error("discord interaction failed:", err);
    }
  })();
});

const notifyHandler = createNotifyHandler(client);
const linkedHandler = createLinkedHandler(client);

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    if (req.method === "POST" && req.url === "/notify/disconnect") {
      await notifyHandler(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/notify/linked") {
      await linkedHandler(req, res);
      return;
    }
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, platform: "discord", active: dcActive }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })();
});

server.listen(discordConfig.port, () => {
  printBanner("discord", [["port", String(discordConfig.port)]]);
  client.login(discordConfig.token).catch((err) => {
    dcActive = false;
    log.error("discord login failed, discord inactive", err);
  });
});
