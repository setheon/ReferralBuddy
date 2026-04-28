'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const db      = require('../utils/database');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

// ─── Shared helpers (imported by debugHandlers too) ───────────────────────────

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function buildDebugEmbed(guild, client) {
  const raw = db.getDb();

  const memberCount = raw.prepare('SELECT COUNT(*) AS c FROM guild_members').get().c;
  const joinedCount = raw.prepare('SELECT COUNT(*) AS c FROM guild_members WHERE joined = 1').get().c;
  const codeCount   = raw.prepare('SELECT COUNT(*) AS c FROM invite_codes').get().c;
  const totalPts    = raw.prepare('SELECT COALESCE(SUM(points), 0) AS t FROM referral_points').get().t;
  const milestones  = db.listRoleRewards().length;
  const cooldowns   = raw.prepare('SELECT COUNT(*) AS c FROM referral_button_cooldowns').get().c;

  const logChannelId      = db.getConfig('log_channel_id');
  const referralChannelId = db.getConfig('referral_channel_id');

  const ping   = client.ws.ping;
  const memMB  = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  const uptime = formatUptime(process.uptime() * 1000);

  return new EmbedBuilder()
    .setColor(0xEB459E)
    .setTitle('🔧  ReferralBuddy Debug Panel')
    .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
    .addFields(
      { name: '👥 Members',         value: `**${memberCount}** tracked\n**${joinedCount}** joined`,                          inline: true },
      { name: '🔗 Invites',         value: `**${codeCount}** codes\n**${cooldowns}** active cooldowns`,                      inline: true },
      { name: '⭐ Points',          value: `**${totalPts.toLocaleString()}** total\n**${milestones}** milestone role(s)`,     inline: true },
      { name: '📋 Log Channel',     value: logChannelId      ? `<#${logChannelId}>`      : '*Not set*', inline: true },
      { name: '🔗 Referral Ch.',    value: referralChannelId ? `<#${referralChannelId}>` : '*Not set*', inline: true },
      { name: '📡 Ping',            value: `**${ping}ms** WS`,                                          inline: true },
      { name: '⏱️ Uptime',          value: `**${uptime}**`,       inline: true },
      { name: '💾 Memory',          value: `**${memMB} MB** heap`, inline: true },
      { name: '🟢 Status',          value: '**Online**',           inline: true },
    )
    .setFooter({ text: `Node ${process.version}` })
    .setTimestamp();
}

function buildDebugRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('debug_btn_catalogue').setLabel('Catalogue Members').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
    new ButtonBuilder().setCustomId('debug_btn_backup').setLabel('Backup DB').setStyle(ButtonStyle.Secondary).setEmoji('💾'),
    new ButtonBuilder().setCustomId('debug_btn_sync_invites').setLabel('Sync Invites').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
    new ButtonBuilder().setCustomId('debug_btn_clear_cooldowns').setLabel('Clear Cooldowns').setStyle(ButtonStyle.Danger).setEmoji('🧹'),
    new ButtonBuilder().setCustomId('debug_btn_refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('♻️'),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('debug_btn_check_points').setLabel('Check Points').setStyle(ButtonStyle.Primary).setEmoji('🔍'),
    new ButtonBuilder().setCustomId('debug_btn_check_referrals').setLabel('Check Referrals').setStyle(ButtonStyle.Primary).setEmoji('👥'),
    new ButtonBuilder().setCustomId('debug_btn_adjust_points').setLabel('Adjust Points').setStyle(ButtonStyle.Primary).setEmoji('➕'),
    new ButtonBuilder().setCustomId('debug_btn_set_referrer').setLabel('Set Referrer').setStyle(ButtonStyle.Primary).setEmoji('🔧'),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('debug_btn_test_logs').setLabel('Test All Logs').setStyle(ButtonStyle.Success).setEmoji('🧪'),
    new ButtonBuilder().setCustomId('debug_btn_test_channel').setLabel('Test Referral Ch.').setStyle(ButtonStyle.Success).setEmoji('📢'),
    new ButtonBuilder().setCustomId('debug_btn_bot_status').setLabel('Bot Status').setStyle(ButtonStyle.Success).setEmoji('📊'),
    new ButtonBuilder().setCustomId('debug_btn_view_config').setLabel('View Config').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
  );

  return [row1, row2, row3];
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug')
    .setDescription('Open the bot debug panel'),

  buildDebugEmbed,
  buildDebugRows,
  formatUptime,

  async execute(interaction, client) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);
    await interaction.deferReply({ flags: 1 << 6 });

    const embed = await buildDebugEmbed(interaction.guild, client);
    const rows  = buildDebugRows();
    return interaction.editReply({ embeds: [embed], components: rows });
  },
};
