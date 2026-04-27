'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db      = require('../utils/database');
const { log } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('points')
    .setDescription('Referral points management (Administrator only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s
      .setName('check')
      .setDescription('Check a user\'s referral points and referrer')
      .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('leaderboard')
      .setDescription('Show the top 10 referral point earners')
    )
    .addSubcommand(s => s
      .setName('adjust')
      .setDescription('Add or subtract points from a user')
      .addUserOption(o => o.setName('user').setDescription('User to adjust').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to add (positive) or subtract (negative)').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral

    if (sub === 'check') {
      const target     = interaction.options.getUser('user');
      const points     = db.getPoints(target.id);
      const referrerId = db.getReferrer(target.id);

      let referrerText = 'None';
      if (referrerId) {
        const referrerUser = await interaction.client.users.fetch(referrerId).catch(() => null);
        referrerText = referrerUser ? `<@${referrerId}> (${referrerUser.tag})` : `\`${referrerId}\``;
      }

      return interaction.editReply(
        `<@${target.id}> has **${points}** referral point(s).\nReferred by: ${referrerText}`
      );
    }

    if (sub === 'leaderboard') {
      const rows = db.getLeaderboard(10);

      if (!rows.length) {
        return interaction.editReply({ flags: 0, content: 'No referral points on record yet.' });
      }

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = await Promise.all(
        rows.map(async (r, i) => {
          const user  = await interaction.client.users.fetch(r.user_id).catch(() => null);
          const name  = user ? user.tag : r.user_id;
          const medal = medals[i] ?? `\`${String(i + 1).padStart(2)}.\``;
          return `${medal} ${name} — **${r.points.toLocaleString()}** pts`;
        })
      );

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🏆  Referral Leaderboard')
        .setDescription(lines.join('\n'))
        .setTimestamp();

      // Leaderboard is public
      await interaction.editReply({ flags: 0, embeds: [embed] });
      return;
    }

    if (sub === 'adjust') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');

      const current  = db.getPoints(target.id);
      const newTotal = db.setPoints(target.id, current + amount);
      const sign     = amount >= 0 ? '+' : '';

      await log(client, 'admin',
        `🔧 Admin \`${interaction.user.id}\` adjusted \`${target.id}\`'s points by **${sign}${amount}** (new total: **${newTotal}**).`
      );

      return interaction.editReply(
        `Adjusted <@${target.id}>'s points by **${sign}${amount}**. New total: **${newTotal}**.`
      );
    }
  },
};
