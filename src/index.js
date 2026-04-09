// src/index.js
// ReferralBuddy — Entry point

'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const path = require('path');
const fs   = require('fs');

// ─── Validate environment ─────────────────────────────────────────────────────

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌  DISCORD_TOKEN is not set. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

// ─── Initialise database (runs schema migrations) ────────────────────────────

require('./utils/database').getDb();

// ─── Discord client ───────────────────────────────────────────────────────────
// GuildInvites intent is required to read invite use-counts.
// GuildMembers intent is required to detect joins/leaves.

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.GuildMember,
    Partials.User,
  ],
});

// ─── Load commands ────────────────────────────────────────────────────────────

client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  if (!cmd.data || !cmd.execute) {
    console.warn(`⚠️  Skipping ${file} — missing data or execute export`);
    continue;
  }
  client.commands.set(cmd.data.name, cmd);
  console.log(`  ✔  Command loaded: /${cmd.data.name}`);
}

// ─── Load events ──────────────────────────────────────────────────────────────

const eventsDir = path.join(__dirname, 'events');

for (const file of fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  if (!event.name || !event.execute) {
    console.warn(`⚠️  Skipping event ${file} — missing name or execute export`);
    continue;
  }

  const handler = (...args) => event.execute(...args, client);

  if (event.once) {
    client.once(event.name, handler);
  } else {
    client.on(event.name, handler);
  }

  console.log(`  ✔  Event registered: ${event.name}${event.once ? ' (once)' : ''}`);
}

// ─── Global error handlers ────────────────────────────────────────────────────

process.on('unhandledRejection', err => {
  console.error('⚠️  Unhandled promise rejection:', err);
});

process.on('uncaughtException', err => {
  console.error('💥  Uncaught exception:', err);
  // Don't exit — let the bot keep running for non-fatal errors
});

// ─── Login ────────────────────────────────────────────────────────────────────

client.login(TOKEN).catch(err => {
  console.error('❌  Login failed:', err.message);
  process.exit(1);
});
