// src/commands/postpanel.js
// ReferralBuddy — /postpanel
// Manually re-post the referral embed in the configured referral channel.
// Useful if the original message was deleted or the channel was recreated.

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db                                           = require('../utils/database');
const { referralPanelEmbed, referralPanelRow, successEmbed, errorEmbed } = require('../utils/embeds');
const { logToChannel } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('postpanel')
    .setDescription('Re-post the referral panel embed in the referral channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Override: post to a different channel instead of the configured one')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cfg = db.getConfig(interaction.guild.id);

    // Resolve target channel — override option takes priority, then configured channel
    const overrideChannel = interaction.options.getChannel('channel');
    const targetChannelId = overrideChannel?.id ?? cfg?.referral_channel_id ?? null;

    if (!targetChannelId) {
      return interaction.editReply({
        embeds: [errorEmbed(
          'No referral channel configured.\n' +
          'Run `/setup` first, or pass a channel using the `channel` option.'
        )],
      });
    }

    const channel = interaction.guild.channels.cache.get(targetChannelId)
      ?? await interaction.guild.channels.fetch(targetChannelId).catch(() => null);

    if (!channel?.isTextBased()) {
      return interaction.editReply({
        embeds: [errorEmbed(`<#${targetChannelId}> not found or is not a text channel.`)],
      });
    }

    // Check bot can send in that channel
    if (!channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
      return interaction.editReply({
        embeds: [errorEmbed(`I don't have permission to send messages in <#${targetChannelId}>.`)],
      });
    }

    // Post the panel
    let postedMsg;
    try {
      postedMsg = await channel.send({
        embeds:     [referralPanelEmbed()],
        components: [referralPanelRow()],
      });
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed(`Failed to post in <#${targetChannelId}>: ${err.message}`)],
      });
    }

    // Save the new message ID and (if overriding) the new channel ID
    db.setConfig(interaction.guild.id, {
      referral_message_id:  postedMsg.id,
      ...(overrideChannel ? { referral_channel_id: channel.id } : {}),
    });

    await logToChannel(
      interaction.guild,
      'setup',
      'Referral Panel Re-Posted',
      `<@${interaction.user.id}> manually reposted the referral panel.`,
      [
        { name: '📢 Channel',    value: `<#${channel.id}>`,   inline: true },
        { name: '🆔 Message ID', value: `\`${postedMsg.id}\``, inline: true },
        ...(overrideChannel ? [{ name: '⚠️ Note', value: 'Channel override used — config updated to new channel.', inline: false }] : []),
      ]
    );

    return interaction.editReply({
      embeds: [successEmbed(
        `Referral panel posted in <#${channel.id}>.\n` +
        (overrideChannel ? '> ℹ️ Config updated to use this channel going forward.' : '')
      )],
    });
  },
};
