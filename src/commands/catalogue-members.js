'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/database');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('catalogue-members')
    .setDescription('Manually catalogue all guild members into the database'),

  async execute(interaction) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);
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
