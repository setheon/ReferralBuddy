'use strict';

const { EmbedBuilder } = require('discord.js');
const db = require('./database');

// ─── Shared leaderboard helpers (mirrors leaderboard.js) ─────────────────────

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function filterBots(rows, client) {
  const results = [];
  for (const row of rows) {
    const user = client.users.cache.get(row.user_id)
      ?? await client.users.fetch(row.user_id).catch(() => null);
    if (!user?.bot) results.push(row);
  }
  return results;
}

function renderInviters(rows) {
  const filtered = rows.filter(r => r.join_count > 0).slice(0, 10);
  if (!filtered.length) return '*No data yet.*';
  const medals = ['🥇', '🥈', '🥉'];
  return filtered.map((r, i) => {
    const medal = medals[i] ?? `\`${String(i + 1).padStart(2)}.\``;
    const noun  = r.join_count === 1 ? 'join' : 'joins';
    return `${medal} <@${r.user_id}> — **${r.join_count}** ${noun}`;
  }).join('\n');
}

function renderEarners(rows) {
  const filtered = rows.filter(r => r.points > 0).slice(0, 10);
  if (!filtered.length) return '*No data yet.*';
  const medals = ['🥇', '🥈', '🥉'];
  return filtered.map((r, i) => {
    const medal = medals[i] ?? `\`${String(i + 1).padStart(2)}.\``;
    return `${medal} <@${r.user_id}> — **${r.points.toLocaleString()}** pts`;
  }).join('\n');
}

// ─── Button handlers ──────────────────────────────────────────────────────────

/**
 * "Leaderboard" button — ephemeral reply with the default leaderboard view:
 * This Month top inviters | All Time top earners.
 */
async function handleLeaderboardButton(interaction, client) {
  await interaction.deferReply({ flags: 1 << 6 });

  const guild    = interaction.guild;
  const DB_LIMIT = 20;
  const since    = daysAgo(30);

  const [inviterRows, earnerRows] = await Promise.all([
    filterBots(db.getTopInviters(DB_LIMIT, since), client),
    filterBots(db.getLeaderboard(DB_LIMIT), client),
  ]);

  if (!inviterRows.length && !earnerRows.length) {
    return interaction.editReply({ content: 'No referral data on record yet.' });
  }

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle('🏆  Referral Leaderboard')
    .setDescription(`**${guild.name}** Global Community`)
    .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
    .addFields(
      { name: '🌱  __Top Inviters — This Month__', value: renderInviters(inviterRows), inline: true },
      { name: '⭐  __Top Earners — All Time__',    value: renderEarners(earnerRows),   inline: true },
    )
    .setFooter({ text: 'Use /stats for your personal breakdown' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

/**
 * "My Stats" button — ephemeral reply with the caller's personal stats,
 * identical to /stats output.
 */
async function handleStatsButton(interaction, client) {
  await interaction.deferReply({ flags: 1 << 6 });

  const userId = interaction.user.id;

  const points     = db.getPoints(userId);
  const rank       = db.getRank(userId);
  const referrerId = db.getReferrer(userId);
  const referred   = db.getMembersByReferrer(userId);
  const codes      = db.getInviteCodesByUser(userId);

  let referrerText = '*None*';
  if (referrerId) {
    const referrerUser = await client.users.fetch(referrerId).catch(() => null);
    referrerText = referrerUser ? `<@${referrerId}>` : `\`${referrerId}\``;
  }

  const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
  const rankText  = points > 0 ? `${rankEmoji} #${rank} overall` : '*Unranked*';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊  Your Referral Stats')
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '⭐ Points',         value: `**${points.toLocaleString()}** pt(s)`, inline: true },
      { name: '🏆 Rank',           value: rankText,                               inline: true },
      { name: '​',                 value: '​',                                    inline: true },
      {
        name:   '👥 People Referred',
        value:  referred.length > 0
          ? referred.map(m => `• <@${m.user_id}>`).join('\n')
          : '*Nobody yet — share your link!*',
        inline: false,
      },
      { name: '🔗 Invite Links', value: `**${codes.length}** code(s) generated`, inline: true },
      { name: '📨 Referred By',  value: referrerText,                            inline: true },
    )
    .setFooter({ text: 'Use the referral panel to get your personal invite link' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ─── Route helpers ────────────────────────────────────────────────────────────

const PANEL_BUTTON_IDS = new Set([
  'referral_btn_leaderboard',
  'referral_btn_stats',
]);

function isPanelButton(id) { return PANEL_BUTTON_IDS.has(id); }

module.exports = { handleLeaderboardButton, handleStatsButton, isPanelButton };
