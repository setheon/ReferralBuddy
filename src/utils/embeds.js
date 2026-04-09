// src/utils/embeds.js
// ReferralBuddy — Shared embed & component factory

'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// ─── Brand colours ────────────────────────────────────────────────────────────

const COLORS = {
  brand:   0x5865F2,   // Discord blurple
  gold:    0xFEE75C,
  green:   0x57F287,
  red:     0xED4245,
  blue:    0x00B0F4,
  magenta: 0xEB459E,
  grey:    0x2B2D31,
};

// ─── Referral panel (posted in the referral channel) ─────────────────────────

function referralPanelEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle('🔗  ReferralBuddy — Invite & Earn')
    .setDescription([
      '## Get your unique referral link and start earning!',
      '',
      'Click the button below to receive your **personal invite link**.',
      'Share it with friends — every milestone they hit earns you points.',
      '',
      '**── Point Milestones ──**',
      '> 📥  Friend **joins** the server          → `+1 pt`',
      '> 🥉  Friend reaches **Level 1**            → `+10 pts`',
      '> 🥇  Friend reaches **Level 10**           → `+100 pts`',
      '',
      '**── Rewards ──**',
      '> Accumulate points to unlock exclusive roles!',
      '> Use `/stats me` to check your current standing.',
    ].join('\n'))
    .setFooter({ text: 'ReferralBuddy • Your link is unique — do not share it with bots' })
    .setTimestamp();
}

function referralPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('referral_get_link')
      .setLabel('Get My Referral Link')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔗')
  );
}

// ─── Personal link embed (ephemeral reply) ────────────────────────────────────

function myLinkEmbed(member, url, code, isExisting) {
  return new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle('🔗  Your Personal Referral Link')
    .setThumbnail(member.displayAvatarURL())
    .setDescription([
      isExisting ? '> ℹ️  You already have a link — here it is!\n' : '',
      `## ${url}`,
      `\`Code: ${code}\``,
      '',
      '**Share this with friends to earn points:**',
      '> 📥  They join                 → `+1 pt`',
      '> 🥉  They reach Level 1        → `+10 pts`',
      '> 🥇  They reach Level 10       → `+100 pts`',
    ].join('\n'))
    .setFooter({ text: 'ReferralBuddy • This link is permanently yours' })
    .setTimestamp();
}

// ─── Stats embed ──────────────────────────────────────────────────────────────

function memberStatsEmbed({ member, tag, periodLabel, totalPoints, periodPoints, totalInvites, periodInvites, nextReward }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`📊  Referral Stats — ${tag}`)
    .setTimestamp()
    .setFooter({ text: 'ReferralBuddy' });

  if (member?.displayAvatarURL) embed.setThumbnail(member.displayAvatarURL());

  embed.addFields(
    {
      name:   '📅  Period',
      value:  `\`${periodLabel}\``,
      inline: false,
    },
    {
      name:   '⭐  Points',
      value:  [`**All-time:** ${totalPoints.toLocaleString()} pts`, `**Period:**   ${periodPoints.toLocaleString()} pts`].join('\n'),
      inline: true,
    },
    {
      name:   '📥  Invites',
      value:  [`**All-time:** ${totalInvites} joins`, `**Period:**   ${periodInvites} joins`].join('\n'),
      inline: true,
    }
  );

  if (nextReward) {
    const needed = nextReward.points_required - totalPoints;
    embed.addFields({
      name:   '🏆  Next Reward',
      value:  `**${nextReward.role_name}** — need \`${needed.toLocaleString()}\` more pts (threshold: ${nextReward.points_required.toLocaleString()})`,
      inline: false,
    });
  } else {
    embed.addFields({ name: '🏆  Rewards', value: 'All rewards unlocked!  🎉', inline: false });
  }

  return embed;
}

// ─── Server stats embed ───────────────────────────────────────────────────────

function serverStatsEmbed({ guildName, guildIcon, periodLabel, topInviters, topEarners, totalJoins, totalPoints }) {
  const fmtInviters = topInviters.length
    ? topInviters.map((r, i) => `\`${(i + 1).toString().padStart(2)}.\` <@${r.inviter_id}> — **${r.cnt}** joins`).join('\n')
    : '*No data for this period*';

  const fmtEarners = topEarners.length
    ? topEarners.map((r, i) => `\`${(i + 1).toString().padStart(2)}.\` <@${r.member_id}> — **${r.total.toLocaleString()}** pts`).join('\n')
    : '*No data for this period*';

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`🏅  Server Referral Stats`)
    .setDescription(`**${guildName}** — Period: \`${periodLabel}\``)
    .addFields(
      { name: '📊  Overview', value: [`**Total joins:** ${totalJoins}`, `**Total points awarded:** ${totalPoints.toLocaleString()}`].join('\n'), inline: false },
      { name: '📥  Top Inviters',  value: fmtInviters, inline: true },
      { name: '⭐  Top Earners',   value: fmtEarners,  inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'ReferralBuddy' });

  if (guildIcon) embed.setThumbnail(guildIcon);

  return embed;
}

// ─── Setup wizard embeds ──────────────────────────────────────────────────────

const SETUP_STEPS = ['Log Channel', 'Referral Channel', 'Reward Roles', 'Confirm'];

function _stepBar(current) {
  return SETUP_STEPS.map((s, i) => {
    if (i < current)  return `~~${s}~~`;
    if (i === current) return `**▶ ${s}**`;
    return s;
  }).join('  →  ');
}

function setupStepEmbed(step, data = {}) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle('⚙️  ReferralBuddy Setup Wizard')
    .setDescription(`**Progress:** ${_stepBar(step)}`)
    .setFooter({ text: 'Type your answer below • Wizard times out after 5 minutes' });

  const done = (name, val) => ({ name: `✅  ${name}`, value: val, inline: true });

  if (step === 0) {
    embed.addFields({
      name:  '📋  Step 1 — Log Channel',
      value: [
        'Which channel should ReferralBuddy post its activity logs in?',
        '',
        '**Accepted formats:**',
        '• Mention: `#bot-logs`',
        '• Channel ID: `123456789012345678`',
      ].join('\n'),
    });
  }

  if (step === 1) {
    embed.addFields(
      done('Log Channel', `<#${data.logChannelId}>`),
      {
        name:  '📋  Step 2 — Referral Channel',
        value: [
          'Which channel should the **referral panel** be posted in?',
          'Members visit this channel to get their invite link.',
          '',
          '• Mention: `#referrals`',
          '• Channel ID: `123456789012345678`',
        ].join('\n'),
      }
    );
  }

  if (step === 2) {
    embed.addFields(
      done('Log Channel',      `<#${data.logChannelId}>`),
      done('Referral Channel', `<#${data.referralChannelId}>`),
      {
        name:  '📋  Step 3 — Reward Roles',
        value: [
          'Define roles members unlock when they hit a points threshold.',
          'Enter **one reward per line** in this format:',
          '```',
          '<points> @RoleName',
          '```',
          '**Example:**',
          '```',
          '50   @Newcomer Recruiter',
          '250  @Active Recruiter',
          '1000 @Elite Recruiter',
          '```',
          '',
          'Type `skip` to set no reward roles right now.',
          '*(You can re-run `/setup` later to add them)*',
        ].join('\n'),
      }
    );
  }

  if (step === 3) {
    const roleLines = data.rewardRoles?.length
      ? data.rewardRoles.map(r => `• **${r.pointsRequired.toLocaleString()} pts** → <@&${r.roleId}> (${r.roleName})`).join('\n')
      : '*None configured*';

    embed.addFields(
      done('Log Channel',      `<#${data.logChannelId}>`),
      done('Referral Channel', `<#${data.referralChannelId}>`),
      done('Reward Roles',     roleLines),
      {
        name:  '📋  Step 4 — Confirm',
        value: [
          'Does everything look correct?',
          '',
          'Type **`confirm`** to save and post the referral panel.',
          'Type **`cancel`** to abort without saving.',
        ].join('\n'),
      }
    );
  }

  return embed;
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

function successEmbed(msg) {
  return new EmbedBuilder()
    .setColor(COLORS.green)
    .setDescription(`✅  ${msg}`)
    .setTimestamp();
}

function errorEmbed(msg) {
  return new EmbedBuilder()
    .setColor(COLORS.red)
    .setDescription(`❌  ${msg}`)
    .setTimestamp();
}

function infoEmbed(title, msg) {
  return new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle(`ℹ️  ${title}`)
    .setDescription(msg)
    .setTimestamp();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  COLORS,
  referralPanelEmbed, referralPanelRow,
  myLinkEmbed,
  memberStatsEmbed, serverStatsEmbed,
  setupStepEmbed,
  successEmbed, errorEmbed, infoEmbed,
};
