'use strict';

const db                        = require('./database');
const inviteCache               = require('./inviteCache');
const { log }                   = require('./logger');
const { findInviteChannel }     = require('./invitePurge');

const COOLDOWN_HOURS = 1;

/**
 * Handles the "Get My Referral Link" button press for a given member.
 */
async function handleReferralButton(interaction, client) {
  const member = interaction.member;
  const guild  = interaction.guild;

  // ── Check for an existing permanent referral link (sync) ──────────────────
  // If the member already has one marked in the DB, skip generation entirely.
  const existingRow = db.getExistingLinkCode(member.id);

  if (existingRow) {
    await interaction.deferReply({ flags: 1 << 6 });

    const existingUrl = `https://discord.gg/${existingRow.code}`;

    // DM the existing link
    let dmOk = false;
    try {
      await member.user.send(
        `🔗 **Your referral link:**\n${existingUrl}\n\nShare it with friends — every milestone they reach earns you points!`
      );
      dmOk = true;
    } catch (_) { /* DMs may be closed */ }

    await interaction.editReply(
      dmOk
        ? `📨 You already have a referral link — it's been resent to your DMs!\n🔗 ${existingUrl}`
        : `🔗 You already have a referral link: **${existingUrl}**\nShare it with friends to earn points!\n*(Enable DMs from server members to receive it there next time.)*`
    );

    await log(client, 'invite', `Member \`${member.id}\` retrieved their existing referral code \`${existingRow.code}\`.`);
    return;
  }

  // ── Rate limit check (sync — fast, safe to do before deferring) ──────────
  const cooldownRow = db.getCooldown(member.id);
  if (cooldownRow) {
    const lastUsed    = new Date(cooldownRow.last_used + 'Z'); // SQLite datetime() is UTC
    const elapsed     = Date.now() - lastUsed.getTime();
    const limitMs     = COOLDOWN_HOURS * 60 * 60 * 1000;

    if (elapsed < limitMs) {
      const remainingMs  = limitMs - elapsed;
      const remainingMin = Math.ceil(remainingMs / 60_000);
      return interaction.reply({
        content: `⏳ You can only generate a new referral link once per hour. Try again in **${remainingMin}** minute(s).`,
        flags: 1 << 6,
      });
    }
  }

  // ── Defer immediately — all subsequent work is async ─────────────────────
  await interaction.deferReply({ flags: 1 << 6 });

  // Update cooldown now that we're committed to generating
  db.upsertCooldown(member.id);

  // ── Sync existing guild invites created by this member ────────────────────
  // We fetch all guild invites once here and reuse the collection for channel
  // selection — avoids a second API call inside findInviteChannel.
  let existingInvites;
  try {
    existingInvites = await guild.invites.fetch();
    for (const [, inv] of existingInvites) {
      if (inv.inviter?.id === member.id) {
        db.upsertInviteCode(inv.code, member.id, false);
      }
    }
  } catch (err) {
    await log(client, 'error', `Failed to fetch invites for referral button: ${err.message}`);
    return interaction.editReply('❌ Could not fetch server invites. Please try again.');
  }

  // ── Resolve invite channel (with multi-channel rotation) ─────────────────
  const targetChannel = await findInviteChannel(guild, existingInvites);

  if (!targetChannel) {
    return interaction.editReply(
      '❌ No invite channel available. All configured channels are at capacity (50 invites each), or no referral channel has been set. Ask an admin to add a new invite channel via `/setup`.'
    );
  }

  // ── Create a new personal referral invite ─────────────────────────────────
  let invite;
  try {
    invite = await targetChannel.createInvite({
      maxAge:  0,
      maxUses: 0,
      unique:  true,
      reason:  `Referral link for ${member.user.tag}`,
    });
  } catch (err) {
    return interaction.editReply(`❌ Failed to create invite: ${err.message}`);
  }

  // Store the new code and mark it as this member's permanent referral link
  db.upsertInviteCode(invite.code, member.id, false);
  db.markExistingLink(invite.code);
  inviteCache.set(invite.code, 0);

  // ── DM the link to the member ─────────────────────────────────────────────
  let dmOk = false;
  try {
    await member.user.send(
      `🔗 **Your personal referral link:**\n${invite.url}\n\nShare it with friends — every milestone they reach earns you points!`
    );
    dmOk = true;
  } catch (_) { /* DMs may be closed */ }

  // ── Ephemeral reply in channel ────────────────────────────────────────────
  await interaction.editReply(
    dmOk
      ? `✅ Your referral link has been sent to your DMs!\n🔗 ${invite.url}`
      : `🔗 Your personal referral link: **${invite.url}**\nShare it with friends to earn points!\n*(Enable DMs from server members to receive it there next time.)*`
  );

  // ── Log ───────────────────────────────────────────────────────────────────
  await log(client, 'invite', `Member \`${member.id}\` generated referral code \`${invite.code}\`.`);
}

module.exports = { handleReferralButton };
