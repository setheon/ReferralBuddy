'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');

/**
 * Builds the referral summary text + a "Fetch All Invites" button row
 * for a given target user. Used by /referrals and the debug Check Referrals modal.
 */
async function buildReferralReply(targetId, client) {
  const codes   = db.getInviteCodesByUser(targetId);
  const members = db.getMembersByReferrer(targetId);

  let content = `<@${targetId}> has **${codes.length}** invite code(s) and has successfully referred **${members.length}** member(s).`;

  if (members.length > 0) {
    const lines = await Promise.all(
      members.map(async m => {
        const u = await client.users.fetch(m.user_id).catch(() => null);
        return u ? `• ${u.tag} (\`${m.user_id}\`)` : `• \`${m.user_id}\``;
      })
    );
    content += `\n\n**Referred members:**\n${lines.join('\n')}`;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`referrals_fetch_invites:${targetId}`)
      .setLabel('Fetch All Invites')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋'),
  );

  return { content, components: [row] };
}

/**
 * Handles the "Fetch All Invites" button click.
 * custom ID format: referrals_fetch_invites:<userId>
 */
async function handleFetchInvitesButton(interaction, client) {
  await interaction.deferReply({ flags: 1 << 6 });

  const userId = interaction.customId.split(':')[1];
  const codes  = db.getInviteCodesByUser(userId);
  const user   = await client.users.fetch(userId).catch(() => null);
  const name   = user ? user.tag : `\`${userId}\``;

  if (!codes.length) {
    return interaction.editReply(`No invite codes found for **${name}** in the database.`);
  }

  // Fetch live invite data from Discord and index by code
  const liveInvites = new Map();
  try {
    const fetched = await interaction.guild.invites.fetch();
    for (const [code, inv] of fetched) liveInvites.set(code, inv);
  } catch (_) { /* live data is best-effort */ }

  const lines = codes.map(r => {
    const live    = liveInvites.get(r.code);
    const url     = `https://discord.gg/${r.code}`;
    const status  = live ? '🟢' : '🔴';
    const uses    = live != null ? `**${live.uses}** use(s)` : '*expired*';
    const addedAt = r.added_at ? r.added_at.slice(0, 10) : '?';
    const owner   = r.created_by_bot ? '*(bot-created)*' : '*(member)*';
    return `${status} [\`${r.code}\`](${url}) — ${uses} — added \`${addedAt}\` ${owner}`;
  });

  const activeCount  = codes.filter(r => liveInvites.has(r.code)).length;
  const expiredCount = codes.length - activeCount;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📋  Invite Codes — ${name}`)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: '🟢 Active',  value: `**${activeCount}**`,  inline: true },
      { name: '🔴 Expired', value: `**${expiredCount}**`, inline: true },
      { name: '📊 Total',   value: `**${codes.length}**`, inline: true },
    )
    .setFooter({ text: '🟢 = still live in Discord  •  🔴 = no longer found' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

module.exports = { buildReferralReply, handleFetchInvitesButton };
