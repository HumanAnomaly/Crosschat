import { REST, Routes } from "discord.js";
import { createLogger } from "@crosschat/core";
import { discordConfig } from "./config.js";
import { slashDefinitions } from "./commands.js";

const log = createLogger("discord");

export async function deploySlashCommands(clientIdOverride?: string): Promise<void> {
  const token = discordConfig.token;
  const clientId = clientIdOverride || discordConfig.clientId;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is empty");
  if (!clientId) throw new Error("DISCORD_CLIENT_ID is empty (or login first so it can be derived)");
  const rest = new REST({ version: "10" }).setToken(token);
  if (discordConfig.guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, discordConfig.guildId), {
      body: slashDefinitions,
    });
    log.success(`slash commands deployed to guild ${discordConfig.guildId}`);
    return;
  }
  await rest.put(Routes.applicationCommands(clientId), { body: slashDefinitions });
  log.success(`slash commands deployed globally for ${clientId}`);
}

const invokedDirectly =
  process.argv[1] != null && /deploy-commands\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  deploySlashCommands().catch((err) => {
    log.error("slash deploy failed", err);
    process.exit(1);
  });
}
