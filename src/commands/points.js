'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db      = require('../utils/database');
const { log } = require('../utils/logger');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a UTC datetime string N days before now, formatted for SQLite. */
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Builds a leaderboard embed from rows [{user_id, points}]. */
async function buildLeaderboardEmbed(rows, title, client) {
  const medals = ['🥇', '🥈', '🥉'];
  const lines  = await Promise.all(
    rows.map(async (r, i) => {
      const user  = await client.users.fetch(r.user_id).catch(() => null);
      const name  = user ? user.tag : `\`${r.user_id}\``;
      const medal = medals[i] ?? `\`${String(i + 1).padStart(2)}.\``;
      return `${medal} ${name} — **${r.points.toLocaleString()}** pts`;
    })
  );

  return new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`🏆  ${title}`)
    .setDescription(lines.join('\n'))
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
      .setDescription('Show referral point leaders (defaults to Last 30 Days + All Time)')
      .addStringOption(o => o
        .setName('period')
        .setDescription('Time period to filter by')
        .setRequired(false)
        .addChoices(
          { name: 'Today',      value: 'day'   },
          { name: 'This Week',  value: 'week'  },
          { name: 'This Month', value: 'month' },
          { name: 'This Year',  value: 'year'  },
          { name: 'All Time',   value: 'all'   },
          { name: 'Custom',     value: 'custom'},
        )
      )
      .addStringOption(o => o
        .setName('start')
        .setDescription('Custom range start date (YYYY-MM-DD) — required when period is Custom')
        .setRequired(false)
      )
      .addStringOption(o => o
        .setName('end')
        .setDescription('Custom range end date (YYYY-MM-DD) — defaults to today')
        .setRequired(false)
      )
    )

    .addSubcommand(s => s
      .setName('adjust')
      .setDescription('Add or subtract points from a user')
      .addUserOption(o => o.setName('user').setDescription('User to adjust').setRequired(true))
      .addIntegerOption(o => o
        .setName('amount')
        .setDescription('Amount to add (positive) or subtract (negative)')
        .setRequired(true)
      )
    ),

  async execute(interaction, client) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral

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

      // ── Default: no period → Last 30 Days + All Time ─────────────────────────
      if (!period) {
        const periodRows  = db.getLeaderboardByPeriod(10, daysAgo(30));
        const allTimeRows = db.getLeaderboard(10);

        if (!periodRows.length && !allTimeRows.length) {
          return interaction.editReply({ flags: 0, content: 'No referral points on record yet.' });
        }

        const embeds = [];

        if (periodRows.length) {
          embeds.push(await buildLeaderboardEmbed(periodRows, 'Referral Leaderboard — Last 30 Days', client));
        } else {
          embeds.push(
            new EmbedBuilder()
              .setColor(0xFEE75C)
              .setTitle('🏆  Referral Leaderboard — Last 30 Days')
              .setDescription('*No points earned in the last 30 days.*')
              .setTimestamp()
          );
        }

        if (allTimeRows.length) {
          embeds.push(await buildLeaderboardEmbed(allTimeRows, 'Referral Leaderboard — All Time', client));
        }

        return interaction.editReply({ flags: 0, embeds });
      }

      // ── All Time ──────────────────────────────────────────────────────────────
      if (period === 'all') {
        const rows = db.getLeaderboard(10);
        if (!rows.length) {
          return interaction.editReply({ flags: 0, content: 'No referral points on record yet.' });
        }
        const embed = await buildLeaderboardEmbed(rows, 'Referral Leaderboard — All Time', client);
        return interaction.editReply({ flags: 0, embeds: [embed] });
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
        const label = `Referral Leaderboard — ${startStr}${endStr && endStr !== startStr ? ` → ${endStr}` : ''}`;

        const rows = db.getLeaderboardByPeriod(10, since, until);
        if (!rows.length) {
          return interaction.editReply({ flags: 0, content: 'No points earned in that date range.' });
        }
        const embed = await buildLeaderboardEmbed(rows, label, client);
        return interaction.editReply({ flags: 0, embeds: [embed] });
      }

      // ── Named periods: day / week / month / year ──────────────────────────────
      const periodMap = {
        day:   { days: 1,   label: 'Today'      },
        week:  { days: 7,   label: 'This Week'  },
        month: { days: 30,  label: 'This Month' },
        year:  { days: 365, label: 'This Year'  },
      };

      const { days, label } = periodMap[period];
      const rows = db.getLeaderboardByPeriod(10, daysAgo(days));

      if (!rows.length) {
        return interaction.editReply({ flags: 0, content: `No points earned ${label.toLowerCase()}.` });
      }

      const embed = await buildLeaderboardEmbed(rows, `Referral Leaderboard — ${label}`, client);
      return interaction.editReply({ flags: 0, embeds: [embed] });
    }

    // ── adjust ──────────────────────────────────────────────────────────────────
    if (sub === 'adjust') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const sign   = amount >= 0 ? '+' : '';

      const newTotal = db.addPoints(target.id, amount, 'admin_adjust');

      await log(client, 'admin',
        `🔧 Admin \`${interaction.user.id}\` adjusted \`${target.id}\`'s points by **${sign}${amount}** (new total: **${newTotal}**).`
      );

      return interaction.editReply(
        `Adjusted <@${target.id}>'s points by **${sign}${amount}**. New total: **${newTotal}**.`
      );
    }
  },
};
