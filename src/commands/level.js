// src/commands/level.js
// ReferralBuddy — /level  (admin command to manually trigger a level milestone)
//
// ── Integration note ────────────────────────────────────────────────────────
// Most servers use a levelling bot (MEE6, Arcane, etc.) that assigns a role
// when a member reaches a certain level.  To automate milestone detection,
// listen to guildMemberUpdate and call processMilestone() when the member
// gains one of those level roles.  See src/events/guildMemberUpdate.js.
//
// This slash command is the manual fallback / admin override.
// ────────────────────────────────────────────────────────────────────────────

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const db                          = require('../utils/database');
const { awardPoints }             = require('../utils/points');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { logToChannel }            = require('../utils/logger');

// Points awarded per milestone level
const MILESTONE_POINTS = { 1: 10, 10: 100 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Manually trigger a level milestone for a member (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o =>
      o.setName('member')
        .setDescription('The member who levelled up')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('level')
        .setDescription('The level they reached (1 and 10 trigger point rewards)')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getMember('member');
    const level  = interaction.options.getInteger('level');

    if (!target) {
      return interaction.editReply({ embeds: [errorEmbed('Member not found in this server.')] });
    }

    const result = await processMilestone(interaction.guild, target.id, level);

    if (!result.ok) {
      return interaction.editReply({ embeds: [errorEmbed(result.reason)] });
    }

    await logToChannel(
      interaction.guild,
      'level',
      'Level Milestone Manually Triggered',
      `Admin <@${interaction.user.id}> triggered Level ${level} for <@${target.id}>`,
      [
        { name: '👤 Member',  value: `<@${target.id}>`,       inline: true },
        { name: '🎯 Level',   value: String(level),            inline: true },
        { name: '⭐ Points',  value: `+${result.points}`,      inline: true },
        { name: '📨 Inviter', value: `<@${result.inviterId}>`, inline: true },
      ]
    );

    return interaction.editReply({
      embeds: [successEmbed(
        `Milestone recorded!\n\n` +
        `<@${result.inviterId}> earned **+${result.points} pts** because ` +
        `<@${target.id}> reached **Level ${level}**.`
      )],
    });
  },
};

// ─── Shared milestone processor ───────────────────────────────────────────────

/**
 * Award the correct points for a level milestone to the member's original inviter.
 * Idempotent — calling twice for the same member+level is a no-op.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} memberId   The member who levelled up
 * @param {number} level      The level they reached
 * @returns {Promise<{ok:boolean, reason?:string, points?:number, inviterId?:string}>}
 */
async function processMilestone(guild, memberId, level) {
  const points = MILESTONE_POINTS[level] ?? null;
  if (!points) {
    return {
      ok:     false,
      reason: `Level ${level} has no milestone reward. Only levels **1** (+10 pts) and **10** (+100 pts) award points.`,
    };
  }

  const joinEvent = db.getInviterForMember(guild.id, memberId);
  if (!joinEvent?.inviter_id) {
    return {
      ok:     false,
      reason: `No invite record found for <@${memberId}>. Points cannot be attributed — the member may have joined organically.`,
    };
  }

  const inviterId = joinEvent.inviter_id;

  if (db.hasMilestone(guild.id, memberId, inviterId, level)) {
    return {
      ok:     false,
      reason: `Level ${level} milestone has already been rewarded for <@${memberId}>. No duplicate points awarded.`,
    };
  }

  db.recordMilestone(guild.id, memberId, inviterId, level);

  await awardPoints(
    guild,
    inviterId,
    points,
    `Referral milestone — <@${memberId}> reached **Level ${level}**`,
    memberId
  );

  return { ok: true, points, inviterId };
}

module.exports.processMilestone = processMilestone;
