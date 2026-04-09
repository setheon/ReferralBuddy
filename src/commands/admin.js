// src/commands/admin.js
// ReferralBuddy — /admin  server admin tools

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');
const { awardPoints } = require('../utils/points');
const { successEmbed, errorEmbed, COLORS } = require('../utils/embeds');
const { logToChannel } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('ReferralBuddy admin tools')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // ── points subcommand group ──────────────────────────────────────────────
    .addSubcommandGroup(group =>
      group
        .setName('points')
        .setDescription('Manage member points')
        .addSubcommand(sub =>
          sub.setName('add')
            .setDescription('Add points to a member')
            .addUserOption(o => o.setName('member').setDescription('Target member').setRequired(true))
            .addIntegerOption(o => o.setName('amount').setDescription('Points to add').setRequired(true).setMinValue(1))
            .addStringOption(o => o.setName('reason').setDescription('Reason for adjustment').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Remove points from a member')
            .addUserOption(o => o.setName('member').setDescription('Target member').setRequired(true))
            .addIntegerOption(o => o.setName('amount').setDescription('Points to remove').setRequired(true).setMinValue(1))
            .addStringOption(o => o.setName('reason').setDescription('Reason for adjustment').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('set')
            .setDescription('Set a member\'s total points to an exact value')
            .addUserOption(o => o.setName('member').setDescription('Target member').setRequired(true))
            .addIntegerOption(o => o.setName('amount').setDescription('New total').setRequired(true).setMinValue(0))
            .addStringOption(o => o.setName('reason').setDescription('Reason for adjustment').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('history')
            .setDescription('View a member\'s recent points history')
            .addUserOption(o => o.setName('member').setDescription('Target member').setRequired(true))
        )
    )

    // ── config subcommand ────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub.setName('config')
        .setDescription('View the current ReferralBuddy configuration')
    )

    // ── resetpanel subcommand ────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub.setName('resetpanel')
        .setDescription('Re-post the referral panel in the configured channel')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    // ── points group ─────────────────────────────────────────────────────────
    if (group === 'points') {
      const target  = interaction.options.getMember('member');
      const amount  = interaction.options.getInteger('amount');
      const reason  = interaction.options.getString('reason') ?? 'Manual admin adjustment';
      const guildId = interaction.guild.id;

      if (!target) return interaction.editReply({ embeds: [errorEmbed('Member not found.')] });

      if (sub === 'add') {
        await awardPoints(interaction.guild, target.id, amount, `[Admin] ${reason}`, null);
        const total = db.getMemberPoints(guildId, target.id);
        return interaction.editReply({
          embeds: [successEmbed(`Added **+${amount} pts** to <@${target.id}>.\nNew total: **${total.toLocaleString()} pts**`)],
        });
      }

      if (sub === 'remove') {
        const current = db.getMemberPoints(guildId, target.id);
        const deduct  = Math.min(amount, current); // never go below 0
        await awardPoints(interaction.guild, target.id, -deduct, `[Admin] ${reason}`, null);
        const newTotal = db.getMemberPoints(guildId, target.id);
        return interaction.editReply({
          embeds: [successEmbed(`Removed **${deduct} pts** from <@${target.id}>.\nNew total: **${newTotal.toLocaleString()} pts**`)],
        });
      }

      if (sub === 'set') {
        const current = db.getMemberPoints(guildId, target.id);
        const diff    = amount - current;
        if (diff !== 0) {
          await awardPoints(interaction.guild, target.id, diff, `[Admin] Set to ${amount} — ${reason}`, null);
        }
        return interaction.editReply({
          embeds: [successEmbed(`Set <@${target.id}>'s points to **${amount.toLocaleString()} pts**.`)],
        });
      }

      if (sub === 'history') {
        const logs = db.getPointsLog(interaction.guild.id, target.id, 15);
        if (!logs.length) {
          return interaction.editReply({ embeds: [errorEmbed('No points history found for this member.')] });
        }

        const lines = logs.map(l => {
          const sign = l.points > 0 ? '+' : '';
          const time = `<t:${l.earned_at}:R>`;
          return `${sign}${l.points} pts — ${l.reason.slice(0, 60)} — ${time}`;
        });

        const embed = new EmbedBuilder()
          .setColor(COLORS.gold)
          .setTitle(`📋  Points History — ${target.user.tag}`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `Showing last ${logs.length} transactions • ReferralBuddy` })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }
    }

    // ── /admin config ─────────────────────────────────────────────────────────
    if (sub === 'config') {
      const cfg     = db.getConfig(interaction.guild.id);
      const rewards = db.getRewardRoles(interaction.guild.id);

      if (!cfg) {
        return interaction.editReply({ embeds: [errorEmbed('Not configured yet. Run `/setup` first.')] });
      }

      const roleLines = rewards.length
        ? rewards.map(r => `• **${r.points_required.toLocaleString()} pts** → <@&${r.role_id}> (${r.role_name})`).join('\n')
        : '*None configured*';

      const embed = new EmbedBuilder()
        .setColor(COLORS.blue)
        .setTitle('⚙️  ReferralBuddy Configuration')
        .addFields(
          { name: '📋 Log Channel',      value: cfg.log_channel_id      ? `<#${cfg.log_channel_id}>`      : '`Not set`', inline: true },
          { name: '🔗 Referral Channel', value: cfg.referral_channel_id ? `<#${cfg.referral_channel_id}>` : '`Not set`', inline: true },
          { name: '🏆 Reward Roles',     value: roleLines, inline: false },
        )
        .setTimestamp()
        .setFooter({ text: 'ReferralBuddy • Run /setup to reconfigure' });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /admin resetpanel ─────────────────────────────────────────────────────
    if (sub === 'resetpanel') {
      const cfg = db.getConfig(interaction.guild.id);
      if (!cfg?.referral_channel_id) {
        return interaction.editReply({ embeds: [errorEmbed('No referral channel configured. Run `/setup` first.')] });
      }

      const ch = interaction.guild.channels.cache.get(cfg.referral_channel_id);
      if (!ch) {
        return interaction.editReply({ embeds: [errorEmbed('Referral channel not found. It may have been deleted.')] });
      }

      const { referralPanelEmbed, referralPanelRow } = require('../utils/embeds');

      try {
        const msg = await ch.send({ embeds: [referralPanelEmbed()], components: [referralPanelRow()] });
        db.setConfig(interaction.guild.id, { referral_message_id: msg.id });

        await logToChannel(
          interaction.guild,
          'setup',
          'Referral Panel Re-Posted',
          `<@${interaction.user.id}> reposted the referral panel in <#${cfg.referral_channel_id}>`
        );

        return interaction.editReply({ embeds: [successEmbed(`Referral panel re-posted in <#${cfg.referral_channel_id}>.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(`Failed to post: ${err.message}`)] });
      }
    }
  },
};
