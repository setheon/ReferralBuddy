'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { runBackup } = require('../utils/backup');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup-db')
    .setDescription('Manually trigger a database backup'),

  async execute(interaction, client) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral

    try {
      const filename  = await runBackup(client);
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      return interaction.editReply(`✅ Database backed up to \`${filename}\` at \`${timestamp} UTC\`.`);
    } catch (err) {
      return interaction.editReply(`❌ Backup failed: ${err.message}`);
    }
  },
};
