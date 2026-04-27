'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runBackup } = require('../utils/backup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup-db')
    .setDescription('Manually trigger a database backup (Administrator only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, client) {
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
