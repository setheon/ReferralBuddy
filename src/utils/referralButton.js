'use strict';

const db          = require('./database');
const inviteCache = require('./inviteCache');
const { log }     = require('./logger');

const COOLDOWN_HOURS = 1;

/**
 * Handles the "Get My Referral Link" button press for a given member.
 */
async function handleReferralButton(interaction, client) {
  const member = interaction.member;
  const guild  = interaction.guild;

  // ── Rate limit check ──────────────────────────────────────────────────────
  const cooldownRow = db.getCooldown(member.id);
  if (cooldownRow) {
    const lastUsed   = new Date(cooldownRow.last_used + 'Z'); // SQLite datetime() is UTC
    const elapsed    = Date.now() - lastUsed.getTime();
    const limitMs    = COOLDOWN_HOURS * 60 * 60 * 1000;

    if (elapsed < limitMs) {
      const remainingMs  = limitMs - elapsed;
      const remainingMin = Math.ceil(remainingMs / 60_000);
      return interaction.reply({
        content: `You can only generate a new referral code once per hour. Please try again in **${remainingMin}** minute(s).`,
        flags: 1 << 6,
      });
    }
  }

  // Update cooldown
  db.upsertCooldown(member.id);

  // ── Sync existing guild invites created by this member ─────────────────────
  let existingInvites;
  try {
    existingInvites = await guild.invites.fetch();
  } catch (err) {
    await log(client, 'error', `Failed to fetch invites for referral button: ${err.message}`);
    return interaction.reply({ content: '❌ Could not fetch server invites. Please try again.', flags: 1 << 6 });
  }

  for (const [, inv] of existingInvites) {
    if (inv.inviter?.id === member.id) {
      db.upsertInviteCode(inv.code, member.id, false);
    }
  }

  // ── Create a new personal referral invite ─────────────────────────────────
  const channelId = db.getConfig('referral_channel_id');
  const targetChannel = channelId
    ? await guild.channels.fetch(channelId).catch(() => null)
    : guild.channels.cache.find(c => c.isTextBased() && guild.members.me.permissionsIn(c).has('CreateInstantInvite'));

  if (!targetChannel) {
    return interaction.reply({ content: '❌ No referral channel configured or no channel available to create an invite in.', flags: 1 << 6 });
  }

  let invite;
  try {
    invite = await targetChannel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Referral link for ${member.user.tag}` });
  } catch (err) {
    return interaction.reply({ content: `❌ Failed to create invite: ${err.message}`, flags: 1 << 6 });
  }

  // Store the new code — created_by_id is the real member, NOT the bot
  db.upsertInviteCode(invite.code, member.id, false);

  // Update invite cache
  inviteCache.set(invite.code, 0);

  // ── Reply ephemerally to the member ──────────────────────────────────────
  await interaction.reply({
    content: `🔗 Your personal referral link: **${invite.url}**\nShare it with friends to earn points!`,
    flags: 1 << 6,
  });

  // ── Post in referral channel ──────────────────────────────────────────────
  try {
    await targetChannel.send(`🔗 <@${member.id}> just generated their referral link! **${invite.url}**`);
  } catch (_) { /* channel post is best-effort */ }

  // ── Log ───────────────────────────────────────────────────────────────────
  await log(client, 'invite', `Member \`${member.id}\` generated a new referral code: \`${invite.code}\`.`);
}

module.exports = { handleReferralButton };
