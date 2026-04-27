'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('catalogue-members')
    .setDescription('Manually catalogue all guild members into the database (Administrator only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral

    let newCount      = 0;
    let existingCount = 0;

    try {
      const members = await interaction.guild.members.fetch();
      for (const [, member] of members) {
        if (member.user.bot) continue;
        const existing = db.getMember(member.id);
        if (existing) {
          existingCount++;
        } else {
          db.upsertMember(member.id);
          newCount++;
        }
      }
    } catch (err) {
      return interaction.editReply(`❌ Failed to catalogue members: ${err.message}`);
    }

    return interaction.editReply(
      `✅ Catalogued **${newCount}** new member(s). **${existingCount}** already existed in the database.`
    );
  },
};
