import { SlashCommandBuilder } from "discord.js";

export const slashDefinitions = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Show link status and quick actions")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show full link info (account, messages, server)")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("List all commands")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("wired")
    .setDescription("Link this DM with a web code")
    .addStringOption((opt) =>
      opt.setName("code").setDescription("Code from the web (XXXX-XXXX)").setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("newcode")
    .setDescription("Show a code to enter on the web")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Close the link on both sides")
    .toJSON(),
];
