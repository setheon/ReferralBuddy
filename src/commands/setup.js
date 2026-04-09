// src/commands/setup.js
// ReferralBuddy — /setup  (admin-only, interactive channel wizard)

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

const MAX_LEVEL_ROLES = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure ReferralBuddy for this server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.reply({ embeds: [setupStepEmbed(0)], ephemeral: false });

    const ch      = interaction.channel;
    const filter  = m => m.author.id === interaction.user.id;
    const TIMEOUT = 5 * 60_000;
    const collect = () => ch.awaitMessages({ filter, max: 1, time: TIMEOUT, errors: ['time'] });

    const wizardData = { rewardRoles: [], levelRoles: [] };

    // ── Step 0 — Log channel ──────────────────────────────────────────────────
    try {
      const coll = await collect();
      const msg  = coll.first();
      await msg.delete().catch(() => {});
      const id = _resolveChannel(msg, interaction.guild, ChannelType.GuildText);
      if (!id) return ch.send({ embeds: [errorEmbed('Invalid channel. Please run `/setup` again.')] });
      wizardData.logChannelId = id;
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Step 1 — Referral channel ─────────────────────────────────────────────
    await ch.send({ embeds: [setupStepEmbed(1, wizardData)] });
    try {
      const coll = await collect();
      const msg  = coll.first();
      await msg.delete().catch(() => {});
      const id = _resolveChannel(msg, interaction.guild, ChannelType.GuildText);
      if (!id) return ch.send({ embeds: [errorEmbed('Invalid channel. Please run `/setup` again.')] });
      wizardData.referralChannelId = id;
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Step 2 — Level roles ──────────────────────────────────────────────────
    await ch.send({ embeds: [setupStepEmbed(2, wizardData)] });
    try {
      const coll = await collect();
      const msg  = coll.first();
      await msg.delete().catch(() => {});
      const text = msg.content.trim();

      if (text.toLowerCase() !== 'skip') {
        const parsed = _parseLevelRoles(text, interaction.guild);
        if (!parsed.length) {
          return ch.send({
            embeds: [errorEmbed(
              'Could not parse any valid level roles.\n' +
              'Format: `<role_id_or_mention> <points>` — one per line.\n' +
              'Run `/setup` again, or type `skip`.'
            )],
          });
        }
        if (parsed.length > MAX_LEVEL_ROLES) {
          return ch.send({ embeds: [errorEmbed(`Maximum ${MAX_LEVEL_ROLES} level roles allowed.`)] });
        }
        wizardData.levelRoles = parsed;
      }
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Step 3 — Reward roles (for Member A) ─────────────────────────────────
    await ch.send({ embeds: [setupStepEmbed(3, wizardData)] });
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
              'Format: `<points> @RoleName` — one per line.\n' +
              'Run `/setup` again, or type `skip`.'
            )],
          });
        }
      }
    } catch {
      return ch.send({ embeds: [errorEmbed('Setup timed out. Run `/setup` again when ready.')] });
    }

    // ── Step 4 — Confirm ──────────────────────────────────────────────────────
    await ch.send({ embeds: [setupStepEmbed(4, wizardData)] });
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

    // ── Persist ───────────────────────────────────────────────────────────────
    db.setConfig(interaction.guild.id, {
      log_channel_id:      wizardData.logChannelId,
      referral_channel_id: wizardData.referralChannelId,
    });

    db.setLevelRoles(interaction.guild.id, wizardData.levelRoles);

    if (wizardData.rewardRoles.length) {
      db.setRewardRoles(interaction.guild.id, wizardData.rewardRoles);
    }

    // ── Post referral panel ───────────────────────────────────────────────────
    const refCh = interaction.guild.channels.cache.get(wizardData.referralChannelId);
    if (refCh) {
      try {
        const posted = await refCh.send({
          embeds: [referralPanelEmbed()], components: [referralPanelRow()],
        });
        db.setConfig(interaction.guild.id, { referral_message_id: posted.id });
      } catch (err) {
        await ch.send({ embeds: [errorEmbed(`Could not post panel in <#${wizardData.referralChannelId}>: ${err.message}`)] });
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const levelRoleSummary = wizardData.levelRoles.length
      ? wizardData.levelRoles.map(r => `• <@&${r.roleId}> → **+${r.points} pts** to inviter`).join('\n')
      : '*None configured*';

    const rewardRoleSummary = wizardData.rewardRoles.length
      ? wizardData.rewardRoles.map(r => `• **${r.pointsRequired} pts** → ${r.roleName}`).join('\n')
      : '*None configured*';

    await ch.send({
      embeds: [successEmbed(
        `**ReferralBuddy is live!**\n\n` +
        `📋 **Log channel:** <#${wizardData.logChannelId}>\n` +
        `🔗 **Referral panel:** <#${wizardData.referralChannelId}>\n\n` +
        `🎯 **Level roles (Friend B → points to Member A):**\n${levelRoleSummary}\n\n` +
        `🏆 **Reward roles (Member A earns role):**\n${rewardRoleSummary}`
      )],
    });

    await logToChannel(
      interaction.guild, 'setup',
      'ReferralBuddy Setup Complete',
      `Server configured by <@${interaction.user.id}>`,
      [
        { name: '📋 Log Channel',      value: `<#${wizardData.logChannelId}>`,      inline: true },
        { name: '🔗 Referral Channel', value: `<#${wizardData.referralChannelId}>`, inline: true },
        { name: '🎯 Level Roles',      value: String(wizardData.levelRoles.length),  inline: true },
        { name: '🏆 Reward Roles',     value: String(wizardData.rewardRoles.length), inline: true },
      ]
    );
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _resolveChannel(msg, guild, type) {
  const mentioned = msg.mentions.channels.first();
  if (mentioned && mentioned.type === type) return mentioned.id;
  const rawId = msg.content.trim();
  const byId  = guild.channels.cache.get(rawId);
  if (byId && byId.type === type) return byId.id;
  const byName = guild.channels.cache.find(
    c => c.type === type && c.name.toLowerCase() === rawId.toLowerCase().replace(/^#/, '')
  );
  return byName?.id ?? null;
}

// Parse level roles: each line is  <role_id_or_mention>  <points>
function _parseLevelRoles(text, guild) {
  const results = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Accept both orderings: "<role> <pts>" and "<pts> <role>"
    // Normalise to always extract the role part and the number part
    const mentionMatch = trimmed.match(/^<@&(\d+)>\s+(\d+)$/) ||
                         trimmed.match(/^(\d+)\s+<@&(\d+)>$/);

    let roleId, pts;

    if (mentionMatch) {
      // figure out which capture is the role ID and which is points
      const a = mentionMatch[1], b = mentionMatch[2];
      // the role mention group that started the outer match will be in group 1 for first pattern
      if (trimmed.startsWith('<@&')) {
        roleId = a; pts = parseInt(b, 10);
      } else {
        pts = parseInt(a, 10); roleId = b;
      }
    } else {
      // bare ID + points
      const parts = trimmed.split(/\s+/);
      if (parts.length !== 2) continue;
      // figure out which is the snowflake and which is points
      const [p1, p2] = parts;
      if (/^\d{15,}$/.test(p1) && /^\d+$/.test(p2)) {
        roleId = p1; pts = parseInt(p2, 10);
      } else if (/^\d+$/.test(p1) && /^\d{15,}$/.test(p2)) {
        pts = parseInt(p1, 10); roleId = p2;
      } else {
        continue;
      }
    }

    if (!roleId || isNaN(pts) || pts < 1) continue;
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    if (results.find(r => r.roleId === roleId)) continue; // dedupe

    results.push({ roleId: role.id, roleName: role.name, points: pts });
  }
  return results;
}

// Parse reward roles: each line is  <points>  @RoleName | <@&id> | bare id
function _parseRewardRoles(text, guild) {
  const results = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pts     = parseInt(match[1], 10);
    const roleStr = match[2].trim();
    const mentionMatch = roleStr.match(/^<@&(\d+)>$/);
    if (mentionMatch) {
      const role = guild.roles.cache.get(mentionMatch[1]);
      if (role) { results.push({ pointsRequired: pts, roleId: role.id, roleName: role.name }); continue; }
    }
    if (/^\d{15,}$/.test(roleStr)) {
      const role = guild.roles.cache.get(roleStr);
      if (role) { results.push({ pointsRequired: pts, roleId: role.id, roleName: role.name }); continue; }
    }
    const name = roleStr.replace(/^@/, '');
    const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (role) results.push({ pointsRequired: pts, roleId: role.id, roleName: role.name });
  }
  return results.sort((a, b) => a.pointsRequired - b.pointsRequired);
}
