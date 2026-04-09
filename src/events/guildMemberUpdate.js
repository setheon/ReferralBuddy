// src/events/guildMemberUpdate.js
// ReferralBuddy — Automatic level milestone detection
//
// This event fires whenever a guild member's roles change. If a levelling bot
// (MEE6, Arcane, Lurkr, etc.) assigns a role when a member hits level 1 or
// level 10, configure those role IDs below and this handler will automatically
// award the referral milestone points to the inviter.
//
// ── Configuration ────────────────────────────────────────────────────────────
// Set LEVEL_1_ROLE_ID and LEVEL_10_ROLE_ID in your .env file.
// If you don't use a levelling bot, leave them blank and use /level manually.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { processMilestone } = require('../commands/level');
const { logToChannel }     = require('../utils/logger');

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember) {
    // Only care about role additions
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (!addedRoles.size) return;

    const level1RoleId  = process.env.LEVEL_1_ROLE_ID  ?? null;
    const level10RoleId = process.env.LEVEL_10_ROLE_ID ?? null;

    // No level roles configured — nothing to do
    if (!level1RoleId && !level10RoleId) return;

    for (const [roleId] of addedRoles) {
      let targetLevel = null;

      if (level10RoleId && roleId === level10RoleId) targetLevel = 10;
      else if (level1RoleId  && roleId === level1RoleId)  targetLevel = 1;

      if (!targetLevel) continue;

      const result = await processMilestone(newMember.guild, newMember.id, targetLevel);

      if (result.ok) {
        await logToChannel(
          newMember.guild,
          'level',
          `Level ${targetLevel} Milestone Detected`,
          `<@${newMember.id}> was assigned <@&${roleId}> — milestone points awarded automatically.`,
          [
            { name: '👤 Member',   value: `<@${newMember.id}>`,      inline: true },
            { name: '🎯 Level',    value: String(targetLevel),        inline: true },
            { name: '⭐ Points',   value: `+${result.points}`,        inline: true },
            { name: '📨 Inviter',  value: `<@${result.inviterId}>`,   inline: true },
          ]
        );
      }
      // Non-ok results (already rewarded, no inviter, etc.) are silently ignored
      // to avoid spam — the awardPoints logger already captures successful awards.
    }
  },
};
