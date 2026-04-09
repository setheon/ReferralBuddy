// src/commands/stats.js
// ReferralBuddy — /stats  (personal, member lookup, and server leaderboard)

'use strict';

const { SlashCommandBuilder } = require('discord.js');

const db                                                 = require('../utils/database');
const { memberStatsEmbed, serverStatsEmbed, errorEmbed } = require('../utils/embeds');
const { getPeriodRange }                                 = require('../utils/time');

function addPeriodOptions(sub) {
  return sub
    .addStringOption(o =>
      o.setName('period')
        .setDescription('Time period to show (default: all time)')
        .setRequired(false)
        .addChoices(
          { name: '📅  All Time',   value: 'alltime' },
          { name: '🕐  Today',      value: 'day'     },
          { name: '📆  This Week',  value: 'week'    },
          { name: '🗓️  This Month', value: 'month'   },
          { name: '🔎  Custom',     value: 'custom'  },
        )
    )
    .addStringOption(o =>
      o.setName('from')
        .setDescription('Custom start date (YYYY-MM-DD) — only used when period = Custom')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('to')
        .setDescription('Custom end date (YYYY-MM-DD) — defaults to today')
        .setRequired(false)
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View referral stats and points')
    .addSubcommand(sub =>
      addPeriodOptions(
        sub.setName('me').setDescription('View your own referral stats')
      )
    )
    .addSubcommand(sub =>
      addPeriodOptions(
        sub
          .setName('member')
          .setDescription('View referral stats for a specific member')
          .addUserOption(o =>
            o.setName('user').setDescription('The member to look up').setRequired(true)
          )
      )
    )
    .addSubcommand(sub =>
      addPeriodOptions(
        sub.setName('server').setDescription('Server-wide referral leaderboard')
      )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const sub        = interaction.options.getSubcommand();
    const period     = interaction.options.getString('period')  ?? 'alltime';
    const customFrom = interaction.options.getString('from')    ?? null;
    const customTo   = interaction.options.getString('to')      ?? null;
    const guildId    = interaction.guild.id;

    const range = getPeriodRange(period, customFrom, customTo);
    if (!range) {
      return interaction.editReply({
        embeds: [errorEmbed('Invalid date format. Use `YYYY-MM-DD`, e.g. `2024-01-15`.')],
      });
    }

    if (sub === 'me') {
      return _replyMemberStats(interaction, interaction.member, guildId, range);
    }

    if (sub === 'member') {
      const target = interaction.options.getMember('user');
      if (!target) {
        return interaction.editReply({ embeds: [errorEmbed('That member was not found in this server.')] });
      }
      return _replyMemberStats(interaction, target, guildId, range);
    }

    if (sub === 'server') {
      const { topInviters, topEarners, totalJoins, totalPoints } =
        db.getGuildStats(guildId, range.from, range.to);

      const embed = serverStatsEmbed({
        guildName:   interaction.guild.name,
        guildIcon:   interaction.guild.iconURL(),
        periodLabel: range.label,
        topInviters,
        topEarners,
        totalJoins,
        totalPoints,
      });

      return interaction.editReply({ embeds: [embed] });
    }
  },
};

async function _replyMemberStats(interaction, member, guildId, range) {
  const memberId      = member.id;
  const totalPoints   = db.getMemberPoints(guildId, memberId);
  const periodPoints  = db.getPointsInRange(guildId, memberId, range.from, range.to);
  const totalInvites  = db.getInviteCount(guildId, memberId);
  const periodInvites = db.getInviteCountInRange(guildId, memberId, range.from, range.to);
  const rewards       = db.getRewardRoles(guildId);
  const nextReward    = rewards.find(r => totalPoints < r.points_required) ?? null;

  const embed = memberStatsEmbed({
    member,
    tag:          member.user?.tag ?? member.user?.username ?? 'Unknown',
    periodLabel:  range.label,
    totalPoints,
    periodPoints,
    totalInvites,
    periodInvites,
    nextReward,
  });

  return interaction.editReply({ embeds: [embed] });
}
