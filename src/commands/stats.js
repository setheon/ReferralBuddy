'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View your referral stats'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral — personal data

    const userId = interaction.user.id;

    // ── Gather data ──────────────────────────────────────────────────────────
    const points     = db.getPoints(userId);
    const rank       = db.getRank(userId);
    const referrerId = db.getReferrer(userId);
    const referred   = db.getMembersByReferrer(userId);  // people this user has referred
    const codes      = db.getInviteCodesByUser(userId);

    // ── Referrer display ─────────────────────────────────────────────────────
    let referrerText = '*None*';
    if (referrerId) {
      const referrerUser = await interaction.client.users.fetch(referrerId).catch(() => null);
      referrerText = referrerUser ? `<@${referrerId}>` : `\`${referrerId}\``;
    }

    // ── Rank display ─────────────────────────────────────────────────────────
    const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
    const rankText  = points > 0 ? `${rankEmoji} #${rank} overall` : '*Unranked*';

    // ── Build embed ──────────────────────────────────────────────────────────
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊  Your Referral Stats')
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        {
          name:   '⭐ Points',
          value:  `**${points.toLocaleString()}** pt(s)`,
          inline: true,
        },
        {
          name:   '🏆 Rank',
          value:  rankText,
          inline: true,
        },
        {
          name:   '​',
          value:  '​',
          inline: true,
        },
        {
          name:   '👥 People Referred',
          value:  referred.length > 0
            ? referred.map(m => `• <@${m.user_id}>`).join('\n')
            : '*Nobody yet — share your link!*',
          inline: false,
        },
        {
          name:   '🔗 Invite Links',
          value:  `**${codes.length}** code(s) generated`,
          inline: true,
        },
        {
          name:   '📨 Referred By',
          value:  referrerText,
          inline: true,
        },
      )
      .setFooter({ text: 'Use the referral panel to get your personal invite link' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
