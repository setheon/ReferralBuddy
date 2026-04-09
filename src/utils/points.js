// src/utils/points.js
// ReferralBuddy — Award points and check reward thresholds

'use strict';

const db                 = require('./database');
const { logToChannel }   = require('./logger');

/**
 * Award `points` to `memberId` and check whether any reward roles are now unlocked.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string}  memberId          Discord user ID to credit
 * @param {number}  points            Points to add (may be negative for deductions)
 * @param {string}  reason            Human-readable description for the ledger
 * @param {string|null} relatedId     User ID that triggered the award (e.g. the new member)
 */
async function awardPoints(guild, memberId, points, reason, relatedId = null) {
  db.addPoints(guild.id, memberId, points, reason, relatedId);

  const newTotal = db.getMemberPoints(guild.id, memberId);

  await logToChannel(
    guild,
    'points',
    'Points Awarded',
    `<@${memberId}> earned **${points > 0 ? '+' : ''}${points} pts**\n${reason}`,
    [
      { name: 'New Total',       value: `${newTotal.toLocaleString()} pts`, inline: true },
      { name: 'Transaction',     value: `${points > 0 ? '+' : ''}${points} pts`,        inline: true },
      ...(relatedId ? [{ name: 'Triggered By', value: `<@${relatedId}>`, inline: true }] : []),
    ]
  );

  // Check whether any reward roles are now unlocked
  await _checkRewards(guild, memberId, newTotal);
}

/**
 * Compare total points against configured reward thresholds and assign any
 * roles the member hasn't already received.
 */
async function _checkRewards(guild, memberId, totalPoints) {
  const rewards = db.getRewardRoles(guild.id);
  if (!rewards.length) return;

  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return;

  for (const reward of rewards) {
    if (totalPoints < reward.points_required) continue;
    if (member.roles.cache.has(reward.role_id)) continue;

    const role = guild.roles.cache.get(reward.role_id);
    if (!role) continue;

    try {
      await member.roles.add(role, `ReferralBuddy: reached ${reward.points_required} pts`);

      await logToChannel(
        guild,
        'reward',
        '🏆 Reward Role Granted!',
        `<@${memberId}> unlocked **${role.name}** by reaching **${reward.points_required.toLocaleString()} pts**!`,
        [
          { name: 'Member',    value: `<@${memberId}>`,           inline: true },
          { name: 'Role',      value: `<@&${reward.role_id}>`,   inline: true },
          { name: 'Threshold', value: `${reward.points_required.toLocaleString()} pts`, inline: true },
        ]
      );

      // Try to DM the member
      try {
        await member.send({
          content: `🏆 Congratulations! You've unlocked **${role.name}** in **${guild.name}** by reaching **${reward.points_required.toLocaleString()}** referral points!`,
        });
      } catch { /* DMs disabled — not a problem */ }

    } catch (err) {
      await logToChannel(
        guild, 'error',
        'Role Assignment Failed',
        `Could not assign <@&${reward.role_id}> to <@${memberId}>: ${err.message}`
      );
    }
  }
}

module.exports = { awardPoints };
