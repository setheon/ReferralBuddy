// src/events/guildMemberUpdate.js
// ReferralBuddy — Watch for level roles being assigned to Friend B.
//
// When a levelling bot (MEE6, Arcane, Lurkr, etc.) assigns a role to Friend B
// that is configured as a "level role" in ReferralBuddy, we:
//   1. Find who originally invited Friend B (Member A).
//   2. Check this milestone hasn't already been rewarded (idempotency).
//   3. Award Member A the configured points.
//   4. Log everything to the guild's log channel.

'use strict';

const db               = require('../utils/database');
const { awardPoints }  = require('../utils/points');
const { logToChannel } = require('../utils/logger');

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember) {
    // Only care about role additions
    const addedRoleIds = [...newMember.roles.cache.keys()]
      .filter(id => !oldMember.roles.cache.has(id));

    if (!addedRoleIds.length) return;

    const guildId = newMember.guild.id;

    for (const roleId of addedRoleIds) {
      // Is this a tracked level role?
      const levelRole = db.getLevelRoleByRoleId(guildId, roleId);
      if (!levelRole) continue;

      // Find who invited Friend B
      const joinEvent = db.getInviterForMember(guildId, newMember.id);
      if (!joinEvent?.inviter_id) {
        await logToChannel(
          newMember.guild, 'info',
          'Level Role — No Inviter Found',
          `<@${newMember.id}> received <@&${roleId}> (${levelRole.role_name}, +${levelRole.points} pts) but has no invite record — joined organically or before the bot was set up.`
        );
        continue;
      }

      const inviterId  = joinEvent.inviter_id;
      // Use role_id as the milestone key so each role can only reward once per referral
      const milestone  = roleId;

      // Idempotency — don't award twice for the same role on the same member
      if (db.hasMilestone(guildId, newMember.id, inviterId, milestone)) continue;

      db.recordMilestone(guildId, newMember.id, inviterId, milestone);

      await awardPoints(
        newMember.guild,
        inviterId,
        levelRole.points,
        `Level role — <@${newMember.id}> received **${levelRole.role_name}**`,
        newMember.id
      );

      await logToChannel(
        newMember.guild,
        'level',
        'Level Role Milestone',
        `<@${newMember.id}> received <@&${roleId}> — <@${inviterId}> earned **+${levelRole.points} pts**`,
        [
          { name: '👤 Member (B)',  value: `<@${newMember.id}>`,  inline: true },
          { name: '🎯 Role',        value: `<@&${roleId}>`,        inline: true },
          { name: '⭐ Points to A', value: `+${levelRole.points}`, inline: true },
          { name: '📨 Inviter (A)', value: `<@${inviterId}>`,      inline: true },
        ]
      );
    }
  },
};
