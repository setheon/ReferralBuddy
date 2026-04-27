'use strict';

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const path = require('path');
const fs   = require('fs');

const TOKEN     = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌  BOT_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

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

    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    const data = await rest.put(route, { body: commandData });
    console.log(`✅  Registered ${data.length} command(s)${GUILD_ID ? ` in guild ${GUILD_ID}` : ' globally'}.`);
  } catch (err) {
    console.error('❌  Deploy failed:', err);
  }
})();
