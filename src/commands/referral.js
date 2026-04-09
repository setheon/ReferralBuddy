// src/commands/referral.js
// ReferralBuddy — /referral command + "Get My Referral Link" button handler

'use strict';

const { SlashCommandBuilder } = require('discord.js');

const db                = require('../utils/database');
const { myLinkEmbed, errorEmbed } = require('../utils/embeds');
const { logToChannel }  = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('referral')
    .setDescription('Get your personal referral invite link'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await _deliverLink(interaction);
  },

  /** Called from interactionCreate when the panel button is pressed */
  async handleButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await _deliverLink(interaction);
  },
};

// ─── Core logic ───────────────────────────────────────────────────────────────

async function _deliverLink(interaction) {
  const { guild, member } = interaction;

  // Bot must be configured first
  const cfg = db.getConfig(guild.id);
  if (!cfg) {
    return interaction.editReply({
      embeds: [errorEmbed('ReferralBuddy is not set up yet. Ask an admin to run `/setup`.')],
    });
  }

  // Return existing link if already created
  const existing = db.getReferralInvite(guild.id, member.id);
  if (existing) {
    return interaction.editReply({
      embeds: [myLinkEmbed(member, existing.invite_url, existing.invite_code, true)],
    });
  }

  // Find a channel we can create invites in
  const targetChannel =
    guild.channels.cache.get(cfg.referral_channel_id) ??
    guild.channels.cache.find(c =>
      c.isTextBased() &&
      guild.members.me.permissionsIn(c).has('CreateInstantInvite')
    );

  if (!targetChannel) {
    return interaction.editReply({
      embeds: [errorEmbed('Could not create an invite — I have no channels with the `Create Invite` permission.')],
    });
  }

  // Create the personal invite
  let invite;
  try {
    invite = await targetChannel.createInvite({
      maxAge:  0,       // never expires
      maxUses: 0,       // unlimited uses
      unique:  true,
      reason:  `ReferralBuddy personal invite for ${member.user.tag}`,
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [errorEmbed(`Failed to create invite: ${err.message}`)],
    });
  }

  // Persist
  db.saveReferralInvite(guild.id, member.id, invite.code, invite.url);
  db.upsertInvite(guild.id, invite.code, member.id, 0, 0);

  // Log
  await logToChannel(
    guild,
    'invite',
    'Referral Invite Generated',
    `<@${member.id}> created their personal referral link.`,
    [
      { name: '🔗 Code',    value: `\`${invite.code}\``, inline: true },
      { name: '🌐 URL',     value: invite.url,           inline: true },
      { name: '👤 Member',  value: `<@${member.id}>`,    inline: true },
    ]
  );

  return interaction.editReply({
    embeds: [myLinkEmbed(member, invite.url, invite.code, false)],
  });
}
