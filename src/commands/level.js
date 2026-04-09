// src/commands/level.js
// ReferralBuddy — /levelroles  manage which roles trigger inviter point awards
//
// This replaces the old manual /level command. Points are now awarded
// automatically via guildMemberUpdate whenever Friend B receives a
// configured level role from any levelling bot.

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db                           = require('../utils/database');
const { successEmbed, errorEmbed, COLORS } = require('../utils/embeds');
const { logToChannel }             = require('../utils/logger');

const MAX_LEVEL_ROLES = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelroles')
    .setDescription('Configure which level roles award points to inviters')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a level role (Friend B gets role → Member A earns points)')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('The level role to watch (managed by your levelling bot)')
            .setRequired(true)
        )
        .addIntegerOption(o =>
          o.setName('points')
            .setDescription('Points awarded to the inviter when a member receives this role')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100000)
        )
    )

    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a level role from tracking')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('The role to stop tracking')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all currently tracked level roles')
    )

    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Remove all tracked level roles')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // ── /levelroles add ───────────────────────────────────────────────────────
    if (sub === 'add') {
      const role   = interaction.options.getRole('role');
      const points = interaction.options.getInteger('points');

      // Check cap
      const existing = db.getLevelRoles(guildId);
      if (existing.length >= MAX_LEVEL_ROLES) {
        return interaction.editReply({
          embeds: [errorEmbed(`Maximum of **${MAX_LEVEL_ROLES}** level roles reached. Remove one first.`)],
        });
      }

      // Check duplicate
      if (existing.find(r => r.role_id === role.id)) {
        return interaction.editReply({
          embeds: [errorEmbed(`<@&${role.id}> is already tracked. Use \`/levelroles remove\` first if you want to change its points.`)],
        });
      }

      db.setLevelRoles(guildId, [
        ...existing.map(r => ({ roleId: r.role_id, roleName: r.role_name, points: r.points })),
        { roleId: role.id, roleName: role.name, points },
      ]);

      await logToChannel(
        interaction.guild, 'setup',
        'Level Role Added',
        `<@${interaction.user.id}> added <@&${role.id}> as a level role.`,
        [
          { name: '🎯 Role',   value: `<@&${role.id}>`, inline: true },
          { name: '⭐ Points', value: `+${points}`,      inline: true },
        ]
      );

      return interaction.editReply({
        embeds: [successEmbed(
          `Added <@&${role.id}> as a level role.\n` +
          `When any member receives this role, their **inviter earns +${points} pts**.`
        )],
      });
    }

    // ── /levelroles remove ────────────────────────────────────────────────────
    if (sub === 'remove') {
      const role     = interaction.options.getRole('role');
      const existing = db.getLevelRoles(guildId);
      const filtered = existing.filter(r => r.role_id !== role.id);

      if (filtered.length === existing.length) {
        return interaction.editReply({
          embeds: [errorEmbed(`<@&${role.id}> is not currently tracked as a level role.`)],
        });
      }

      db.setLevelRoles(guildId, filtered.map(r => ({
        roleId: r.role_id, roleName: r.role_name, points: r.points,
      })));

      await logToChannel(
        interaction.guild, 'setup',
        'Level Role Removed',
        `<@${interaction.user.id}> removed <@&${role.id}> from level role tracking.`
      );

      return interaction.editReply({
        embeds: [successEmbed(`<@&${role.id}> removed. It will no longer award points to inviters.`)],
      });
    }

    // ── /levelroles list ──────────────────────────────────────────────────────
    if (sub === 'list') {
      const roles = db.getLevelRoles(guildId);

      if (!roles.length) {
        return interaction.editReply({
          embeds: [errorEmbed(
            'No level roles configured yet.\n' +
            'Use `/levelroles add` to add roles from your levelling bot.'
          )],
        });
      }

      const lines = roles.map((r, i) =>
        `\`${(i + 1).toString().padStart(2)}.\` <@&${r.role_id}> — **+${r.points} pts** to inviter`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle('🎯  Tracked Level Roles')
        .setDescription(
          `When **Friend B** receives one of these roles, **Member A** (their inviter) earns the listed points.\n\n${lines}`
        )
        .setFooter({ text: `${roles.length}/${MAX_LEVEL_ROLES} slots used • ReferralBuddy` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /levelroles clear ─────────────────────────────────────────────────────
    if (sub === 'clear') {
      const existing = db.getLevelRoles(guildId);
      if (!existing.length) {
        return interaction.editReply({ embeds: [errorEmbed('No level roles are configured.')] });
      }

      db.setLevelRoles(guildId, []);

      await logToChannel(
        interaction.guild, 'setup',
        'All Level Roles Cleared',
        `<@${interaction.user.id}> cleared all ${existing.length} level role(s).`
      );

      return interaction.editReply({
        embeds: [successEmbed(`All **${existing.length}** level role(s) removed.`)],
      });
    }
  },
};
