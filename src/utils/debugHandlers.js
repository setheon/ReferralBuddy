'use strict';

const {
  ActionRowBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle,
  EmbedBuilder,
} = require('discord.js');

const db                                 = require('./database');
const { log }                            = require('./logger');
const { isAuthorized, denyUnauthorized } = require('./auth');
const { runBackup }                      = require('./backup');
const inviteCache                        = require('./inviteCache');
const { buildDebugEmbed, buildDebugRows, formatUptime } = require('../commands/debug');

// ─── Button handlers ──────────────────────────────────────────────────────────

async function handleDebugButton(interaction, client) {
  if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);

  const id = interaction.customId;

  // ── Refresh Panel ─────────────────────────────────────────────────────────
  if (id === 'debug_btn_refresh') {
    await interaction.deferUpdate();
    const embed = await buildDebugEmbed(interaction.guild, client);
    const rows  = buildDebugRows();
    return interaction.editReply({ embeds: [embed], components: rows });
  }

  // ── Catalogue Members ─────────────────────────────────────────────────────
  if (id === 'debug_btn_catalogue') {
    await interaction.deferUpdate();
    let newCount = 0, existingCount = 0;
    try {
      const members = await interaction.guild.members.fetch();
      for (const [, member] of members) {
        if (member.user.bot) continue;
        if (db.getMember(member.id)) { existingCount++; }
        else { db.upsertMember(member.id); newCount++; }
      }
    } catch (err) {
      return interaction.followUp({ content: `❌ Failed: ${err.message}`, flags: 1 << 6 });
    }
    return interaction.followUp({
      content: `✅ Catalogued **${newCount}** new member(s). **${existingCount}** already existed.`,
      flags: 1 << 6,
    });
  }

  // ── Backup DB ─────────────────────────────────────────────────────────────
  if (id === 'debug_btn_backup') {
    await interaction.deferUpdate();
    try {
      const filename  = await runBackup(client);
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      return interaction.followUp({
        content: `✅ Database backed up to \`${filename}\` at \`${timestamp} UTC\`.`,
        flags: 1 << 6,
      });
    } catch (err) {
      return interaction.followUp({ content: `❌ Backup failed: ${err.message}`, flags: 1 << 6 });
    }
  }

  // ── Sync Invites ──────────────────────────────────────────────────────────
  if (id === 'debug_btn_sync_invites') {
    await interaction.deferUpdate();
    try {
      const invites = await interaction.guild.invites.fetch();
      for (const [, inv] of invites) {
        db.syncInviteCode(inv.code, inv.inviter?.id ?? null, inv.inviter?.bot ?? false);
        inviteCache.set(inv.code, inv.uses ?? 0);
      }
      return interaction.followUp({
        content: `✅ Synced **${invites.size}** invite(s) into the database and cache.`,
        flags: 1 << 6,
      });
    } catch (err) {
      return interaction.followUp({ content: `❌ Sync failed: ${err.message}`, flags: 1 << 6 });
    }
  }

  // ── Clear Cooldowns ───────────────────────────────────────────────────────
  if (id === 'debug_btn_clear_cooldowns') {
    await interaction.deferUpdate();
    const count = db.clearCooldowns();
    return interaction.followUp({
      content: `✅ Cleared **${count}** referral button cooldown(s).`,
      flags: 1 << 6,
    });
  }

  // ── Check Points → modal ──────────────────────────────────────────────────
  if (id === 'debug_btn_check_points') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('debug_modal_check_points')
        .setTitle('Check Points')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('user_input')
            .setLabel('User ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 413494385351852033')
            .setRequired(true),
        )),
    );
  }

  // ── Check Referrals → modal ───────────────────────────────────────────────
  if (id === 'debug_btn_check_referrals') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('debug_modal_check_referrals')
        .setTitle('Check Referrals')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('user_input')
            .setLabel('User ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 413494385351852033')
            .setRequired(true),
        )),
    );
  }

  // ── Adjust Points → modal ─────────────────────────────────────────────────
  if (id === 'debug_btn_adjust_points') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('debug_modal_adjust_points')
        .setTitle('Adjust Points')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('user_input')
              .setLabel('User ID')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('e.g. 413494385351852033')
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('amount_input')
              .setLabel('Amount (positive to add, negative to subtract)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('e.g. 10 or -5')
              .setRequired(true),
          ),
        ),
    );
  }

  // ── Set Referrer → modal ──────────────────────────────────────────────────
  if (id === 'debug_btn_set_referrer') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('debug_modal_set_referrer')
        .setTitle('Set Referrer')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('user_input')
              .setLabel('Member User ID (who was referred)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('e.g. 413494385351852033')
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('referrer_input')
              .setLabel('Referrer User ID (who referred them)')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('e.g. 413494385351852033')
              .setRequired(true),
          ),
        ),
    );
  }

  // ── Test All Logs ─────────────────────────────────────────────────────────
  if (id === 'debug_btn_test_logs') {
    await interaction.deferUpdate();

    const types = ['info', 'success', 'warn', 'error', 'points', 'invite', 'leave', 'backup', 'admin'];
    for (const type of types) {
      await log(client, type, `DEBUG TESTING — \`${type}\` log channel is working correctly.`);
      await new Promise(r => setTimeout(r, 250)); // preserve ordering in Discord
    }

    return interaction.followUp({
      content: `✅ Fired **${types.length}** test log messages in order. Check your log channel.`,
      flags: 1 << 6,
    });
  }

  // ── Test Referral Channel ─────────────────────────────────────────────────
  if (id === 'debug_btn_test_channel') {
    await interaction.deferUpdate();

    const channelId = db.getConfig('referral_channel_id');
    if (!channelId) {
      return interaction.followUp({ content: '❌ No referral channel configured.', flags: 1 << 6 });
    }

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.followUp({ content: '❌ Referral channel not found or not a text channel.', flags: 1 << 6 });
    }

    const embed = new EmbedBuilder()
      .setColor(0xEB459E)
      .setTitle('🔧  DEBUG — Referral Channel Test')
      .setDescription(
        'This is a test message from the **ReferralBuddy** debug panel.\n' +
        'If you can see this, the referral channel is configured and reachable correctly.'
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    return interaction.followUp({
      content: `✅ Debug message posted in <#${channelId}>.`,
      flags: 1 << 6,
    });
  }

  // ── Bot Status ────────────────────────────────────────────────────────────
  if (id === 'debug_btn_bot_status') {
    await interaction.deferUpdate();

    const raw         = db.getDb();
    const memberCount = raw.prepare('SELECT COUNT(*) AS c FROM guild_members').get().c;
    const joinedCount = raw.prepare('SELECT COUNT(*) AS c FROM guild_members WHERE joined = 1').get().c;
    const leftCount   = raw.prepare('SELECT COUNT(*) AS c FROM guild_members WHERE has_left = 1').get().c;
    const codeCount   = raw.prepare('SELECT COUNT(*) AS c FROM invite_codes').get().c;
    const ledgerCount = raw.prepare('SELECT COUNT(*) AS c FROM point_ledger').get().c;
    const totalPts    = raw.prepare('SELECT COALESCE(SUM(points), 0) AS t FROM referral_points').get().t;
    const milestones  = db.listRoleRewards().length;
    const cooldowns   = raw.prepare('SELECT COUNT(*) AS c FROM referral_button_cooldowns').get().c;
    const backups     = raw.prepare('SELECT COUNT(*) AS c FROM db_backup_log').get().c;
    const cacheSize   = inviteCache.entries().size;

    const uptime   = formatUptime(process.uptime() * 1000);
    const heapMB   = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const rssMB    = (process.memoryUsage().rss       / 1024 / 1024).toFixed(1);

    const logChannelId      = db.getConfig('log_channel_id');
    const referralChannelId = db.getConfig('referral_channel_id');

    const embed = new EmbedBuilder()
      .setColor(0xEB459E)
      .setTitle('📊  Bot Status Report')
      .addFields(
        {
          name: '🗄️ Database',
          value: [
            `Members tracked:     **${memberCount}**`,
            `Joined (w/ referrer): **${joinedCount}**`,
            `Left members:        **${leftCount}**`,
            `Invite codes:        **${codeCount}**`,
            `Point ledger rows:   **${ledgerCount}**`,
            `Total pts awarded:   **${totalPts.toLocaleString()}**`,
            `Milestone roles:     **${milestones}**`,
            `Active cooldowns:    **${cooldowns}**`,
            `Backup log entries:  **${backups}**`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '🤖 Runtime',
          value: [
            `Uptime:      **${uptime}**`,
            `WS latency:  **${client.ws.ping}ms**`,
            `Heap:        **${heapMB} MB**`,
            `RSS:         **${rssMB} MB**`,
            `Node.js:     **${process.version}**`,
            `Invite cache:**${cacheSize}** code(s)`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '⚙️ Config',
          value: [
            `Log channel:      ${logChannelId      ? `<#${logChannelId}>`      : '*Not set*'}`,
            `Referral channel: ${referralChannelId ? `<#${referralChannelId}>` : '*Not set*'}`,
          ].join('\n'),
          inline: true,
        },
      )
      .setTimestamp();

    return interaction.followUp({ embeds: [embed], flags: 1 << 6 });
  }

  // ── View Config ───────────────────────────────────────────────────────────
  if (id === 'debug_btn_view_config') {
    await interaction.deferUpdate();

    const configs = db.getAllConfig();
    const value   = configs.length
      ? configs.map(r => `\`${r.key}\`  →  \`${r.value}\``).join('\n')
      : '*No config values set.*';

    const embed = new EmbedBuilder()
      .setColor(0xEB459E)
      .setTitle('⚙️  Bot Config')
      .setDescription(value)
      .setTimestamp();

    return interaction.followUp({ embeds: [embed], flags: 1 << 6 });
  }
}

// ─── Modal handlers ───────────────────────────────────────────────────────────

async function handleDebugModal(interaction, client) {
  if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);

  const id = interaction.customId;

  // ── Check Points ──────────────────────────────────────────────────────────
  if (id === 'debug_modal_check_points') {
    const userId     = interaction.fields.getTextInputValue('user_input').trim().replace(/[<@!>]/g, '');
    const points     = db.getPoints(userId);
    const referrerId = db.getReferrer(userId);
    const user       = await client.users.fetch(userId).catch(() => null);

    let referrerText = '*None*';
    if (referrerId) {
      const ref = await client.users.fetch(referrerId).catch(() => null);
      referrerText = ref ? `<@${referrerId}> (${ref.tag})` : `\`${referrerId}\``;
    }

    const name = user ? `${user.tag}` : `\`${userId}\``;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle(`⭐  Points — ${name}`)
          .addFields(
            { name: 'Points',      value: `**${points.toLocaleString()}**`, inline: true },
            { name: 'Referred by', value: referrerText,                     inline: true },
          )
          .setTimestamp(),
      ],
      flags: 1 << 6,
    });
  }

  // ── Check Referrals ───────────────────────────────────────────────────────
  if (id === 'debug_modal_check_referrals') {
    const userId  = interaction.fields.getTextInputValue('user_input').trim().replace(/[<@!>]/g, '');
    const codes   = db.getInviteCodesByUser(userId);
    const members = db.getMembersByReferrer(userId);
    const user    = await client.users.fetch(userId).catch(() => null);
    const name    = user ? user.tag : `\`${userId}\``;

    let referredText = '*Nobody yet.*';
    if (members.length) {
      const lines = await Promise.all(members.map(async m => {
        const u = await client.users.fetch(m.user_id).catch(() => null);
        return u ? `• ${u.tag} (\`${m.user_id}\`)` : `• \`${m.user_id}\``;
      }));
      referredText = lines.join('\n');
    }

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`👥  Referrals — ${name}`)
          .addFields(
            { name: 'Invite Codes',     value: `**${codes.length}** code(s)`,    inline: true },
            { name: 'People Referred',  value: `**${members.length}** member(s)`, inline: true },
            { name: 'Referred Members', value: referredText,                       inline: false },
          )
          .setTimestamp(),
      ],
      flags: 1 << 6,
    });
  }

  // ── Adjust Points ─────────────────────────────────────────────────────────
  if (id === 'debug_modal_adjust_points') {
    const userId = interaction.fields.getTextInputValue('user_input').trim().replace(/[<@!>]/g, '');
    const amount = parseInt(interaction.fields.getTextInputValue('amount_input').trim(), 10);

    if (isNaN(amount)) {
      return interaction.reply({ content: '❌ Amount must be a valid integer.', flags: 1 << 6 });
    }

    const newTotal = db.addPoints(userId, amount, 'admin_adjust');
    const sign     = amount >= 0 ? '+' : '';
    const user     = await client.users.fetch(userId).catch(() => null);
    const name     = user ? `${user.tag} (<@${userId}>)` : `\`${userId}\``;

    await log(client, 'admin',
      `Admin \`${interaction.user.id}\` adjusted \`${userId}\`'s points by **${sign}${amount}** (new total: **${newTotal}**).`
    );

    return interaction.reply({
      content: `✅ Adjusted ${name}'s points by **${sign}${amount}**. New total: **${newTotal}**.`,
      flags: 1 << 6,
    });
  }

  // ── Set Referrer ──────────────────────────────────────────────────────────
  if (id === 'debug_modal_set_referrer') {
    const userId     = interaction.fields.getTextInputValue('user_input').trim().replace(/[<@!>]/g, '');
    const referrerId = interaction.fields.getTextInputValue('referrer_input').trim().replace(/[<@!>]/g, '');

    if (userId === referrerId) {
      return interaction.reply({ content: '❌ A user cannot be their own referrer.', flags: 1 << 6 });
    }

    db.setMemberReferrer(userId, referrerId);

    await log(client, 'admin',
      `Admin \`${interaction.user.id}\` manually set referrer for \`${userId}\` to \`${referrerId}\`.`
    );

    return interaction.reply({
      content: `✅ Referrer for <@${userId}> set to <@${referrerId}>.`,
      flags: 1 << 6,
    });
  }
}

// ─── Route helpers ────────────────────────────────────────────────────────────

const DEBUG_BUTTON_IDS = new Set([
  'debug_btn_refresh',
  'debug_btn_catalogue',
  'debug_btn_backup',
  'debug_btn_sync_invites',
  'debug_btn_clear_cooldowns',
  'debug_btn_check_points',
  'debug_btn_check_referrals',
  'debug_btn_adjust_points',
  'debug_btn_set_referrer',
  'debug_btn_test_logs',
  'debug_btn_test_channel',
  'debug_btn_bot_status',
  'debug_btn_view_config',
]);

const DEBUG_MODAL_IDS = new Set([
  'debug_modal_check_points',
  'debug_modal_check_referrals',
  'debug_modal_adjust_points',
  'debug_modal_set_referrer',
]);

function isDebugButton(id) { return DEBUG_BUTTON_IDS.has(id); }
function isDebugModal(id)  { return DEBUG_MODAL_IDS.has(id); }

module.exports = { handleDebugButton, handleDebugModal, isDebugButton, isDebugModal };
