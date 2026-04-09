// src/commands/leaderboard.js
// ReferralBuddy — /leaderboard  quick top-10 snapshot

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');
const { COLORS } = require('../utils/embeds');
const { getPeriodRange } = require('../utils/time');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top referrers and point earners')
    .addStringOption(o =>
      o.setName('period')
        .setDescription('Time period')
        .setRequired(false)
        .addChoices(
          { name: 'All Time',   value: 'alltime' },
          { name: 'Today',      value: 'day'     },
          { name: 'This Week',  value: 'week'    },
          { name: 'This Month', value: 'month'   },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const period  = interaction.options.getString('period') ?? 'alltime';
    const range   = getPeriodRange(period);
    const guildId = interaction.guild.id;

    const { topInviters, topEarners } = db.getGuildStats(guildId, range.from, range.to);

    const medals  = ['🥇', '🥈', '🥉'];
    const fmt     = (arr, valueKey, suffix) =>
      arr.length
        ? arr.slice(0, 10).map((r, i) => {
            const medal = medals[i] ?? `\`${(i + 1).toString().padStart(2)}.\``;
            const id    = r.inviter_id ?? r.member_id;
            return `${medal} <@${id}> — **${r[valueKey].toLocaleString()}** ${suffix}`;
          }).join('\n')
        : '*No data for this period*';

    const embed = new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🏆  Referral Leaderboard')
      .setDescription(`**${interaction.guild.name}** — \`${range.label}\``)
      .setThumbnail(interaction.guild.iconURL())
      .addFields(
        { name: '📥  Top Inviters',  value: fmt(topInviters, 'cnt',   'joins'), inline: true },
        { name: '⭐  Top Earners',   value: fmt(topEarners,  'total', 'pts'),   inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'ReferralBuddy • Use /stats me for your personal breakdown' });

    return interaction.editReply({ embeds: [embed] });
  },
};
