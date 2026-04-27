'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db      = require('../utils/database');
const { log } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Bot configuration (Administrator only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s
      .setName('set-log-channel')
      .setDescription('Set the channel where the bot posts log messages')
      .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('set-referral-channel')
      .setDescription('Set the channel where referral panel and links are posted')
      .addChannelOption(o => o.setName('channel').setDescription('Referral channel').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('add-role-reward')
      .setDescription('Award referrers points when their invitee receives a specific role')
      .addRoleOption(o => o.setName('role').setDescription('Role to watch').setRequired(true))
      .addIntegerOption(o => o.setName('points').setDescription('Points to award the referrer').setRequired(true).setMinValue(1))
    )
    .addSubcommand(s => s
      .setName('remove-role-reward')
      .setDescription('Remove a role reward')
      .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('list-role-rewards')
      .setDescription('List all configured role rewards')
    )
    .addSubcommand(s => s
      .setName('post-panel')
      .setDescription('Post the referral panel embed in the referral channel')
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral

    if (sub === 'set-log-channel') {
      const channel = interaction.options.getChannel('channel');
      db.setConfig('log_channel_id', channel.id);
      await log(client, 'admin', `Admin \`${interaction.user.id}\` set log channel to <#${channel.id}>.`);
      return interaction.editReply(`✅ Log channel set to <#${channel.id}>.`);
    }

    if (sub === 'set-referral-channel') {
      const channel = interaction.options.getChannel('channel');
      db.setConfig('referral_channel_id', channel.id);
      await log(client, 'admin', `Admin \`${interaction.user.id}\` set referral channel to <#${channel.id}>.`);
      return interaction.editReply(`✅ Referral channel set to <#${channel.id}>.`);
    }

    if (sub === 'add-role-reward') {
      const role   = interaction.options.getRole('role');
      const points = interaction.options.getInteger('points');
      db.upsertRoleReward(role.id, points);
      await log(client, 'admin', `Admin \`${interaction.user.id}\` added role reward: role \`${role.id}\` → **${points}** pts to referrer.`);
      return interaction.editReply(`✅ <@&${role.id}> will now award **${points}** point(s) to referrers when their invitee receives it.`);
    }

    if (sub === 'remove-role-reward') {
      const role = interaction.options.getRole('role');
      db.deleteRoleReward(role.id);
      await log(client, 'admin', `Admin \`${interaction.user.id}\` removed role reward for role \`${role.id}\`.`);
      return interaction.editReply(`✅ Role reward for <@&${role.id}> has been removed.`);
    }

    if (sub === 'list-role-rewards') {
      const rewards = db.listRoleRewards();
      if (!rewards.length) return interaction.editReply('No role rewards are currently set up.');
      const lines = rewards.map(r => `• <@&${r.role_id}> → **${r.points_awarded}** pt(s)`).join('\n');
      return interaction.editReply(`**Configured role rewards:**\n${lines}`);
    }

    if (sub === 'post-panel') {
      const channelId = db.getConfig('referral_channel_id');
      if (!channelId) return interaction.editReply('❌ No referral channel configured. Run `/setup set-referral-channel` first.');

      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) return interaction.editReply('❌ Referral channel not found or not a text channel.');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🔗  Get Your Referral Link')
        .setDescription([
          'Click the button below to receive your **personal invite link**.',
          'Share it with friends — every milestone they reach earns you points!',
        ].join('\n'))
        .setFooter({ text: 'Your link is unique — do not share it with bots' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('referral_get_link')
          .setLabel('Get My Referral Link')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔗')
      );

      await channel.send({ embeds: [embed], components: [row] });
      return interaction.editReply(`✅ Panel posted in <#${channelId}>.`);
    }
  },
};
