// src/commands/setup.js
// ReferralBuddy — /setup  (admin-only, interactive wizard via channel messages)

'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const db = require('../utils/database');
const {
  setupStepEmbed,
  referralPanelEmbed,
  referralPanelRow,
  successEmbed,
  errorEmbed,
} = require('../utils/embeds');
const { logToChannel } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure ReferralBuddy for this server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    // The wizard uses message collectors in the same channel, so the initial
    // reply must be visible (not ephemeral) so members don't accidentally
    // hijack it — but we check author ID in the filter.
    await interaction.reply({ embeds: [setupStepEmbed(0)], ephemeral: false });

    const ch      = interaction.channel;
    const filter  = m => m.author.id === interaction.user.id;
    const TIMEOUT = 5 * 60_000; // 5 minutes

    const collect = () =>
      ch.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] });

    const wizardData = { rewardRoles: [] };

    // ── Step 0 — Log channel ─────────────────────────────────────────────────
    let logChannelId;
    try {
      const coll = await collect();
      const msg  = coll.first();
      await msg.delete().catch(() => {});

      logChannelId = _resolveChannel(msg, interaction.guild, ChannelType.GuildText);
      if (!logChannelId) {
        return ch.send({ embeds: [errorEmbed('Invalid channel. Please run `/setup` again.')] });
      }
      wizardData.logChannelId = logChannelId;
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Step 1 — Referral channel ────────────────────────────────────────────
    await ch.send({ embeds: [setupStepEmbed(1, wizardData)] });

    let referralChannelId;
    try {
      const coll = await collect();
      const msg  = coll.first();
      await msg.delete().catch(() => {});

      referralChannelId = _resolveChannel(msg, interaction.guild, ChannelType.GuildText);
      if (!referralChannelId) {
        return ch.send({ embeds: [errorEmbed('Invalid channel. Please run `/setup` again.')] });
      }
      wizardData.referralChannelId = referralChannelId;
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Step 2 — Reward roles ────────────────────────────────────────────────
    await ch.send({ embeds: [setupStepEmbed(2, wizardData)] });

    try {
      const coll = await collect();
      const msg  = coll.first();
      await msg.delete().catch(() => {});

      const text = msg.content.trim();

      if (text.toLowerCase() !== 'skip') {
        const parsed = _parseRewardRoles(text, interaction.guild);
        wizardData.rewardRoles = parsed;

        if (!parsed.length) {
          return ch.send({
            embeds: [errorEmbed(
              'Could not parse any valid reward roles.\n' +
              'Format: `<points> @RoleName` (one per line)\n' +
              'Run `/setup` again.'
            )],
          });
        }
      }
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Step 3 — Confirm ─────────────────────────────────────────────────────
    await ch.send({ embeds: [setupStepEmbed(3, wizardData)] });

    try {
      const coll = await collect();
      const msg  = coll.first();
      await msg.delete().catch(() => {});

      if (msg.content.trim().toLowerCase() !== 'confirm') {
        return ch.send({ embeds: [errorEmbed('Setup cancelled. No changes were saved.')] });
      }
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Persist configuration ────────────────────────────────────────────────
    db.setConfig(interaction.guild.id, {
      log_channel_id:      wizardData.logChannelId,
      referral_channel_id: wizardData.referralChannelId,
    });

    if (wizardData.rewardRoles.length) {
      db.setRewardRoles(interaction.guild.id, wizardData.rewardRoles);
    }

    // ── Post referral panel ──────────────────────────────────────────────────
    let postedMsgId = null;
    const refCh = interaction.guild.channels.cache.get(wizardData.referralChannelId);

    if (refCh) {
      try {
        const posted = await refCh.send({
          embeds:     [referralPanelEmbed()],
          components: [referralPanelRow()],
        });
        postedMsgId = posted.id;
        db.setConfig(interaction.guild.id, { referral_message_id: postedMsgId });
      } catch (err) {
        await ch.send({ embeds: [errorEmbed(`Could not post in <#${wizardData.referralChannelId}>: ${err.message}`)] });
      }
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const rolesSummary = wizardData.rewardRoles.length
      ? wizardData.rewardRoles.map(r => `• **${r.pointsRequired.toLocaleString()} pts** → ${r.roleName}`).join('\n')
      : '*None configured*';

    await ch.send({
      embeds: [successEmbed(
        `**ReferralBuddy is live!**\n\n` +
        `📋 **Log channel:** <#${wizardData.logChannelId}>\n` +
        `🔗 **Referral panel:** <#${wizardData.referralChannelId}>\n` +
        `🏆 **Reward roles:**\n${rolesSummary}`
      )],
    });

    await logToChannel(
      interaction.guild,
      'setup',
      'ReferralBuddy Setup Complete',
      `Server configured by <@${interaction.user.id}>`,
      [
        { name: '📋 Log Channel',      value: `<#${wizardData.logChannelId}>`,      inline: true },
        { name: '🔗 Referral Channel', value: `<#${wizardData.referralChannelId}>`, inline: true },
        { name: '🏆 Reward Roles',     value: String(wizardData.rewardRoles.length), inline: true },
      ]
    );
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _resolveChannel(msg, guild, type) {
  // Try mention first
  const mentioned = msg.mentions.channels.first();
  if (mentioned && mentioned.type === type) return mentioned.id;

  // Try raw ID
  const rawId = msg.content.trim();
  const ch    = guild.channels.cache.get(rawId);
  if (ch && ch.type === type) return ch.id;

  // Try by name
  const byName = guild.channels.cache.find(
    c => c.type === type && c.name.toLowerCase() === rawId.toLowerCase().replace(/^#/, '')
  );
  return byName?.id ?? null;
}

function _parseRewardRoles(text, guild) {
  const results = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match:  <points>  @RoleMention | <@&id> | role name
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;

    const pts     = parseInt(match[1], 10);
    const roleStr = match[2].trim();

    // Try mention <@&ID>
    const mentionMatch = roleStr.match(/^<@&(\d+)>$/);
    if (mentionMatch) {
      const role = guild.roles.cache.get(mentionMatch[1]);
      if (role) { results.push({ pointsRequired: pts, roleId: role.id, roleName: role.name }); continue; }
    }

    // Try bare ID
    if (/^\d{15,}$/.test(roleStr)) {
      const role = guild.roles.cache.get(roleStr);
      if (role) { results.push({ pointsRequired: pts, roleId: role.id, roleName: role.name }); continue; }
    }

    // Try name (strip leading @)
    const name = roleStr.replace(/^@/, '');
    const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (role) { results.push({ pointsRequired: pts, roleId: role.id, roleName: role.name }); }
  }

  // Sort ascending by threshold
  return results.sort((a, b) => a.pointsRequired - b.pointsRequired);
}
