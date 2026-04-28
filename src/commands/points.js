'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a UTC datetime string N days before now, formatted for SQLite. */
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Renders the "Top Inviters" column value (join count). */
function renderInviters(rows) {
  if (!rows.length) return '*No data yet.*';
  const medals = ['🥇', '🥈', '🥉'];
  return rows.map((r, i) => {
    const medal = medals[i] ?? `\`${String(i + 1).padStart(2)}.\``;
    const noun  = r.join_count === 1 ? 'join' : 'joins';
    return `${medal} <@${r.user_id}> — **${r.join_count}** ${noun}`;
  }).join('\n');
}

/** Renders the "Top Earners" column value (points). */
function renderEarners(rows) {
  if (!rows.length) return '*No data yet.*';
  const medals = ['🥇', '🥈', '🥉'];
  return rows.map((r, i) => {
    const medal = medals[i] ?? `\`${String(i + 1).padStart(2)}.\``;
    return `${medal} <@${r.user_id}> — **${r.points.toLocaleString()}** pts`;
  }).join('\n');
}

/**
 * Builds the two-column leaderboard embed.
 * @param {string} leftLabel   – e.g. "This Month"
 * @param {string} leftValue   – rendered inviters column
 * @param {string} rightLabel  – e.g. "All Time"
 * @param {string} rightValue  – rendered earners column
 * @param {Guild}  guild
 */
function buildEmbed(leftLabel, leftValue, rightLabel, rightValue, guild) {
  return new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle('🏆  Referral Leaderboard')
    .setDescription(`**${guild.name}** Global Community`)
    .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
    .addFields(
      { name: `🌱  __Top Inviters — ${leftLabel}__`,  value: leftValue,  inline: true },
      { name: `⭐  __Top Earners — ${rightLabel}__`,   value: rightValue, inline: true },
    )
    .setFooter({ text: 'Use /stats for your personal breakdown' })
    .setTimestamp();
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('points')
    .setDescription('Referral points management')

    .addSubcommand(s => s
      .setName('check')
      .setDescription('Check a user\'s referral points and referrer')
      .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true))
    )

    .addSubcommand(s => s
      .setName('leaderboard')
      .setDescription('Show the referral leaderboard (defaults to This Month vs All Time)')
      .addStringOption(o => o
        .setName('period')
        .setDescription('Filter both columns to a specific time period')
        .setRequired(false)
        .addChoices(
          { name: 'Today',      value: 'day'    },
          { name: 'This Week',  value: 'week'   },
          { name: 'This Month', value: 'month'  },
          { name: 'This Year',  value: 'year'   },
          { name: 'All Time',   value: 'all'    },
          { name: 'Custom',     value: 'custom' },
        )
      )
      .addStringOption(o => o
        .setName('start')
        .setDescription('Custom range start date (YYYY-MM-DD) — required for Custom')
        .setRequired(false)
      )
      .addStringOption(o => o
        .setName('end')
        .setDescription('Custom range end date (YYYY-MM-DD) — defaults to today')
        .setRequired(false)
      )
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // leaderboard is public — all other subcommands are admin-only
    if (sub !== 'leaderboard' && !isAuthorized(interaction.member)) {
      return denyUnauthorized(interaction);
    }

    await interaction.deferReply({ flags: sub === 'leaderboard' ? 0 : 1 << 6 });

    // ── check ───────────────────────────────────────────────────────────────────
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

    // ── leaderboard ─────────────────────────────────────────────────────────────
    if (sub === 'leaderboard') {
      const period = interaction.options.getString('period');
      const guild  = interaction.guild;

      // ── Default: no period → This Month inviters | All Time earners ───────────
      if (!period) {
        const since       = daysAgo(30);
        const inviterRows = db.getTopInviters(10, since);
        const earnerRows  = db.getLeaderboard(10);

        if (!inviterRows.length && !earnerRows.length) {
          return interaction.editReply('No referral data on record yet.');
        }

        const embed = buildEmbed(
          'This Month', renderInviters(inviterRows),
          'All Time',   renderEarners(earnerRows),
          guild,
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // ── All Time ──────────────────────────────────────────────────────────────
      if (period === 'all') {
        const inviterRows = db.getTopInviters(10);
        const earnerRows  = db.getLeaderboard(10);

        const embed = buildEmbed(
          'All Time', renderInviters(inviterRows),
          'All Time', renderEarners(earnerRows),
          guild,
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // ── Custom range ──────────────────────────────────────────────────────────
      if (period === 'custom') {
        const startStr = interaction.options.getString('start');
        const endStr   = interaction.options.getString('end');

        if (!startStr) {
          return interaction.editReply('❌ Provide a `start` date when using the Custom period (YYYY-MM-DD).');
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) {
          return interaction.editReply('❌ Invalid `start` date — use YYYY-MM-DD format.');
        }
        if (endStr && !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
          return interaction.editReply('❌ Invalid `end` date — use YYYY-MM-DD format.');
        }

        const since = `${startStr} 00:00:00`;
        const until = endStr ? `${endStr} 23:59:59` : null;
        const label = endStr && endStr !== startStr ? `${startStr} → ${endStr}` : startStr;

        const inviterRows = db.getTopInviters(10, since, until);
        const earnerRows  = db.getLeaderboardByPeriod(10, since, until);

        const embed = buildEmbed(
          label, renderInviters(inviterRows),
          label, renderEarners(earnerRows),
          guild,
        );
        return interaction.editReply({ embeds: [embed] });
      }

      // ── Named periods: day / week / month / year ──────────────────────────────
      const periodMap = {
        day:   { days: 1,   label: 'Today'      },
        week:  { days: 7,   label: 'This Week'  },
        month: { days: 30,  label: 'This Month' },
        year:  { days: 365, label: 'This Year'  },
      };

      const { days, label } = periodMap[period];
      const since       = daysAgo(days);
      const inviterRows = db.getTopInviters(10, since);
      const earnerRows  = db.getLeaderboardByPeriod(10, since);

      const embed = buildEmbed(
        label, renderInviters(inviterRows),
        label, renderEarners(earnerRows),
        guild,
      );
      return interaction.editReply({ embeds: [embed] });
    }

  },
};
