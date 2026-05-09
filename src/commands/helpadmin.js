'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('helpadmin')
    .setDescription('View all admin commands and panel buttons'),

  async execute(interaction) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🛠️  ReferralBuddy | Admin Commands')
      .setDescription('All commands below require the configured `ADMIN_ROLE_ID`.')
      .addFields(
        {
          name: '👥  `/referrals user:@User`',
          value: 'Pull up a member\'s full referral history — every invite code they\'ve generated, every member they\'ve referred, and a live cross-reference against Discord\'s current invite data via the **Fetch All Invites** button.',
          inline: false,
        },
        {
          name: '─────────────────────────────',
          value: '**`/setup` — Bot Configuration Panel**',
          inline: false,
        },
        {
          name: '📋 Log Channel',
          value: 'Opens a channel picker. The selected channel receives all bot event logs.',
          inline: true,
        },
        {
          name: '🔗 Referral Channel',
          value: 'Opens a channel picker. The selected channel is where the referral panel is posted.',
          inline: true,
        },
        {
          name: '📢 Post Panel',
          value: 'Posts the referral banner + embed with the **Get My Referral Link** button into the configured referral channel.',
          inline: true,
        },
        {
          name: '🎯 Join Points',
          value: 'Opens a sub-panel with three buttons:\n✅ **Enable** — turn on join point awards\n❌ **Disable** — turn off join point awards\n🔢 **Customise** — set how many points are awarded per join (modal, pre-filled with current value)',
          inline: true,
        },
        {
          name: '➕ Add Milestone Role',
          value: 'Opens a modal — type a role name or ID, then the points to award the referrer whenever their invitee receives that role. Works with servers of any size.',
          inline: true,
        },
        {
          name: '➖ Remove Milestone Role',
          value: 'Opens a modal — type the role name or ID to remove it from the milestone list.',
          inline: true,
        },
        {
          name: '─────────────────────────────',
          value: '**`/debug` — System Buttons (Row 1)**',
          inline: false,
        },
        {
          name: '👥 Catalogue Members',
          value: 'Scans all current guild members and upserts any not yet in the database. Reports new vs already-tracked count.',
          inline: true,
        },
        {
          name: '💾 Backup DB',
          value: 'Triggers an immediate hot backup to `/backups`. Filename and timestamp reported. 10-backup rolling retention applies.',
          inline: true,
        },
        {
          name: '🔄 Sync Invites',
          value: 'Re-fetches all guild invites from Discord, syncs them into `invite_codes`, and rebuilds the in-memory cache. Use after the bot misses downtime.',
          inline: true,
        },
        {
          name: '🧹 Clear Cooldowns',
          value: 'Wipes all referral button cooldowns instantly. Useful for testing without waiting an hour.',
          inline: true,
        },
        {
          name: '♻️ Refresh',
          value: 'Re-renders the debug embed in-place with live stats — members tracked, points, ping, uptime, memory.',
          inline: true,
        },
        {
          name: '─────────────────────────────',
          value: '**`/debug` — Data Buttons (Row 2)**',
          inline: false,
        },
        {
          name: '🔍 Check Points',
          value: 'Modal: enter any User ID to view their current point total and who referred them.',
          inline: true,
        },
        {
          name: '👥 Check Referrals',
          value: 'Modal: enter any User ID to view their full list of referred members and invite codes.',
          inline: true,
        },
        {
          name: '➕ Adjust Points',
          value: 'Modal: enter a User ID + amount (positive or negative) to manually add or subtract points. Every adjustment is logged to the admin log channel.',
          inline: true,
        },
        {
          name: '🔧 Set Referrer',
          value: 'Modal: enter a Member ID + Referrer ID to manually override referral attribution. Used for dispute resolution. Self-referral is blocked.',
          inline: true,
        },
        {
          name: '─────────────────────────────',
          value: '**`/debug` — Debug Tools (Row 3)**',
          inline: false,
        },
        {
          name: '🧪 Test All Logs',
          value: 'Fires one test message per log type (`info → success → warn → error → points → invite → leave → backup → admin`) to the log channel, each labelled DEBUG TESTING.',
          inline: true,
        },
        {
          name: '📢 Test Referral Ch.',
          value: 'Posts a clearly-labelled DEBUG embed to the configured referral channel to verify the bot can reach it.',
          inline: true,
        },
        {
          name: '📊 Bot Status',
          value: 'Full system report: all DB table counts, point ledger size, invite cache size, uptime, WS latency, heap + RSS memory, Node.js version, and all config values.',
          inline: true,
        },
        {
          name: '⚙️ View Config',
          value: 'Dumps every key-value pair in `bot_config` as a quick reference — channel IDs, join point settings, and any other stored config.',
          inline: true,
        },
      )
      .setFooter({ text: 'Use /help for public commands' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: 1 << 6 });
  },
};
