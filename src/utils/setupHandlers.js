'use strict';

const {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');

const db                                 = require('./database');
const { log }                            = require('./logger');
const { isAuthorized, denyUnauthorized } = require('./auth');

// ─── Button handlers ──────────────────────────────────────────────────────────

async function handleSetupButton(interaction, client) {
  if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);

  const id = interaction.customId;

  // ── Log Channel ──────────────────────────────────────────────────────────────
  if (id === 'setup_btn_log_channel') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('setup_select_log_channel')
      .setPlaceholder('Select a text channel for logs')
      .setChannelTypes(ChannelType.GuildText);

    return interaction.reply({
      content: '**Select the log channel:**',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: 1 << 6,
    });
  }

  // ── Referral Channel ─────────────────────────────────────────────────────────
  if (id === 'setup_btn_referral_channel') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId('setup_select_referral_channel')
      .setPlaceholder('Select a text channel for the referral panel')
      .setChannelTypes(ChannelType.GuildText);

    return interaction.reply({
      content: '**Select the referral channel:**',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: 1 << 6,
    });
  }

  // ── Post Panel ───────────────────────────────────────────────────────────────
  if (id === 'setup_btn_post_panel') {
    await interaction.deferUpdate();

    const channelId = db.getConfig('referral_channel_id');
    if (!channelId) {
      return interaction.followUp({
        content: '❌ No referral channel set. Configure it first.',
        flags: 1 << 6,
      });
    }

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.followUp({
        content: '❌ Referral channel not found or is not a text channel.',
        flags: 1 << 6,
      });
    }

    const panelEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔗  VILTROX REFERRAL BUDDY')
      .setDescription([
        '# REFER YOUR FRIENDS TO THE VILTROX COMMUNITY TO UNLOCK EXCLUSIVE REWARDS!',
        '',
        '**Click the button below to receive your personal invite link.**',
        'Share it with your photography friends — every milestone they hit in the community earns you points.',
        '',
        '**── Point Milestones ──**',
        '> 📥 **Friend joins the server & reaches 25 XP Points (Freshman Role)**',
        '> `→ +1 pt`',
        '> 2️⃣ **Friend reaches 500 XP Points (Frequent Chatter Role)**',
        '> `→ +5 pts`',
        '> 3️⃣ **Friend reaches 1,000 XP Points (Active Contributor)**',
        '> `→ +10 pts`',
        '> 4️⃣ **Friend reaches 10,000 XP Points (Viltrox Elite)**',
        '> `→ +100 pts`',
        '',
        '**── Rewards ──**',
        'Accumulate points to unlock exclusive rewards!',
        'Use `/stats` to check your current standing.',
      ].join('\n'))
      .setImage('https://media.discordapp.net/attachments/1491698407830720694/1491784039235977346/viltrox.png?ex=69f005e6&is=69eeb466&hm=8b43f44f666c66b60ab1e89b5c8843bcccad0e409cc0061861b33b14a73f52d6&=&format=webp&quality=lossless')
      .setFooter({ text: 'Your link is unique — do not share it with bots' });

    const panelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('referral_get_link')
        .setLabel('Get My Referral Link')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔗')
    );

    await channel.send({ embeds: [panelEmbed], components: [panelRow] });
    await log(client, 'admin', `Admin \`${interaction.user.id}\` posted the referral panel in <#${channelId}>.`);

    return interaction.followUp({
      content: `✅ Panel posted in <#${channelId}>.`,
      flags: 1 << 6,
    });
  }

  // ── Add Milestone Role ───────────────────────────────────────────────────────
  if (id === 'setup_btn_add_milestone') {
    const modal = new ModalBuilder()
      .setCustomId('setup_modal_add_milestone')
      .setTitle('Add Milestone Role');

    const roleInput = new TextInputBuilder()
      .setCustomId('role_input')
      .setLabel('Role name or Role ID')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. Verified  or  123456789012345678')
      .setRequired(true);

    const pointsInput = new TextInputBuilder()
      .setCustomId('points_input')
      .setLabel('Points to award the referrer')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 10')
      .setRequired(true)
      .setMaxLength(6);

    modal.addComponents(
      new ActionRowBuilder().addComponents(roleInput),
      new ActionRowBuilder().addComponents(pointsInput),
    );

    return interaction.showModal(modal);
  }

  // ── Remove Milestone Role ────────────────────────────────────────────────────
  if (id === 'setup_btn_remove_milestone') {
    const rewards = db.listRoleRewards();
    if (!rewards.length) {
      return interaction.reply({
        content: '❌ No milestone roles are currently configured.',
        flags: 1 << 6,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('setup_modal_remove_milestone')
      .setTitle('Remove Milestone Role');

    const roleInput = new TextInputBuilder()
      .setCustomId('role_input')
      .setLabel('Role name or Role ID to remove')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. Verified  or  123456789012345678')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(roleInput));
    return interaction.showModal(modal);
  }
}

// ─── Select menu handlers ─────────────────────────────────────────────────────

async function handleSetupSelect(interaction, client) {
  if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);

  const id = interaction.customId;

  if (id === 'setup_select_log_channel') {
    const channelId = interaction.values[0];
    db.setConfig('log_channel_id', channelId);
    await log(client, 'admin', `Admin \`${interaction.user.id}\` set log channel to <#${channelId}>.`);
    return interaction.update({ content: `✅ Log channel set to <#${channelId}>.`, components: [] });
  }

  if (id === 'setup_select_referral_channel') {
    const channelId = interaction.values[0];
    db.setConfig('referral_channel_id', channelId);
    await log(client, 'admin', `Admin \`${interaction.user.id}\` set referral channel to <#${channelId}>.`);
    return interaction.update({ content: `✅ Referral channel set to <#${channelId}>.`, components: [] });
  }
}

// ─── Modal handlers ───────────────────────────────────────────────────────────

async function handleSetupModal(interaction, client) {
  if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);

  // ── Add Milestone Role ───────────────────────────────────────────────────────
  if (interaction.customId === 'setup_modal_add_milestone') {
    const roleRaw   = interaction.fields.getTextInputValue('role_input').trim();
    const pointsRaw = interaction.fields.getTextInputValue('points_input').trim();
    const points    = parseInt(pointsRaw, 10);

    if (isNaN(points) || points < 1) {
      return interaction.reply({ content: '❌ Points must be a positive whole number.', flags: 1 << 6 });
    }

    const role = await resolveRole(interaction.guild, roleRaw);
    if (!role) {
      return interaction.reply({
        content: `❌ Could not find a role matching \`${roleRaw}\`. Try using the exact role ID (right-click → Copy ID).`,
        flags: 1 << 6,
      });
    }

    db.upsertRoleReward(role.id, points);
    await log(client, 'admin',
      `Admin \`${interaction.user.id}\` added milestone role: <@&${role.id}> → **${points}** pts to referrer.`
    );

    return interaction.reply({
      content: `✅ <@&${role.id}> will now award **${points}** point(s) to referrers when their invitee receives it.`,
      flags: 1 << 6,
    });
  }

  // ── Remove Milestone Role ────────────────────────────────────────────────────
  if (interaction.customId === 'setup_modal_remove_milestone') {
    const roleRaw = interaction.fields.getTextInputValue('role_input').trim();

    const role = await resolveRole(interaction.guild, roleRaw);
    if (!role) {
      return interaction.reply({
        content: `❌ Could not find a role matching \`${roleRaw}\`. Try using the exact role ID (right-click → Copy ID).`,
        flags: 1 << 6,
      });
    }

    const existing = db.listRoleRewards().find(r => r.role_id === role.id);
    if (!existing) {
      return interaction.reply({
        content: `❌ <@&${role.id}> is not configured as a milestone role.`,
        flags: 1 << 6,
      });
    }

    db.deleteRoleReward(role.id);
    await log(client, 'admin', `Admin \`${interaction.user.id}\` removed milestone role <@&${role.id}>.`);
    return interaction.reply({
      content: `✅ Milestone role <@&${role.id}> has been removed.`,
      flags: 1 << 6,
    });
  }
}

// ─── Helper: resolve a role by ID or name (case-insensitive) ─────────────────

async function resolveRole(guild, input) {
  // Try as ID first
  if (/^\d{17,20}$/.test(input)) {
    const byId = guild.roles.cache.get(input)
      ?? await guild.roles.fetch(input).catch(() => null);
    if (byId) return byId;
  }

  // Try case-insensitive name match
  await guild.roles.fetch(); // ensure cache is populated
  const lower = input.toLowerCase();
  return guild.roles.cache.find(r => r.name.toLowerCase() === lower) ?? null;
}

// ─── Route helpers ────────────────────────────────────────────────────────────

const SETUP_BUTTON_IDS = new Set([
  'setup_btn_log_channel',
  'setup_btn_referral_channel',
  'setup_btn_post_panel',
  'setup_btn_add_milestone',
  'setup_btn_remove_milestone',
]);

const SETUP_SELECT_IDS = new Set([
  'setup_select_log_channel',
  'setup_select_referral_channel',
]);

const SETUP_MODAL_IDS = new Set([
  'setup_modal_add_milestone',
  'setup_modal_remove_milestone',
]);

function isSetupButton(id) { return SETUP_BUTTON_IDS.has(id); }
function isSetupSelect(id) { return SETUP_SELECT_IDS.has(id); }
function isSetupModal(id)  { return SETUP_MODAL_IDS.has(id); }

module.exports = {
  handleSetupButton,
  handleSetupSelect,
  handleSetupModal,
  isSetupButton,
  isSetupSelect,
  isSetupModal,
};
