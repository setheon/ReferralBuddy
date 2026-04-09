// src/deploy-commands.js
// ReferralBuddy — Register slash commands with Discord's API
// Run:  node src/deploy-commands.js

'use strict';

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;  // optional — omit for global deploy

if (!TOKEN || !CLIENT_ID) {
  console.error('❌  DISCORD_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

// Load all command files
const commandsDir = path.join(__dirname, 'commands');
const commandData = [];

for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  if (cmd.data) {
    commandData.push(cmd.data.toJSON());
    console.log(`  📦  Loaded: /${cmd.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`\n🚀  Deploying ${commandData.length} command(s)…`);

    let data;
    if (GUILD_ID) {
      // Guild-scoped: instant registration (great for development)
      data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commandData }
      );
      console.log(`✅  Registered ${data.length} guild command(s) in guild ${GUILD_ID}`);
    } else {
      // Global: can take up to 1 hour to propagate across all guilds
      data = await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commandData }
      );
      console.log(`✅  Registered ${data.length} global command(s)`);
    }
  } catch (err) {
    console.error('❌  Deploy failed:', err);
  }
})();
