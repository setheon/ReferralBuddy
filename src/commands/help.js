'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View all public commands'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔗  ReferralBuddy | Commands')
      .setDescription('Refer your friends, earn points, and climb the leaderboard.')
      .addFields(
        {
          name: '🏆  `/leaderboard [period]`',
          value: 'View the public referral leaderboard.\nShows **Top Inviters** and **Top Earners** side by side. Defaults to This Month vs All Time. Filter by Today, This Week, This Month, This Year, All Time, or a Custom date range.',
          inline: false,
        },
        {
          name: '⭐  `/stats`',
          value: 'View your own referral stats, your points, all-time rank, who you\'ve referred, how many invite links you\'ve generated, and who referred you.',
          inline: false,
        },
        {
          name: '🔍  `/points user:@User`',
          value: 'Check any member\'s referral point total and see who referred them.',
          inline: false,
        },
        {
          name: '❓  `/help`',
          value: 'Shows this message.',
          inline: false,
        },
      )
      .setFooter({ text: 'Admins: use /helpadmin for the full admin reference' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: 1 << 6 });
  },
};
