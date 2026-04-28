'use strict';

const db          = require('../utils/database');
const inviteCache = require('../utils/inviteCache');
const { log }     = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member, client) {
    const { guild } = member;

    // ── Identify which invite was used ────────────────────────────────────────
    let usedCode   = null;
    let inviteRow  = null;
    let ambiguous  = false;

    try {
      const freshInvites = await guild.invites.fetch();
      const changed      = [];

      for (const [, inv] of freshInvites) {
        const prev = inviteCache.get(inv.code);
        if ((inv.uses ?? 0) > prev) {
          changed.push(inv);
        }
      }

      // Rebuild cache with fresh counts
      inviteCache.rebuild(freshInvites);

      if (changed.length === 1) {
        usedCode  = changed[0].code;
        inviteRow = db.getInviteCode(usedCode);
      } else {
        // 0 changes (bot was offline) or >1 simultaneous — ambiguous
        ambiguous = true;
      }
    } catch (err) {
      ambiguous = true;
      await log(client, 'error', `Invite detection error for \`${member.id}\`: ${err.message}`);
    }

    // ── Ambiguous / unresolvable join ─────────────────────────────────────────
    if (ambiguous || !usedCode) {
      db.upsertMember(member.id, { referrer_id: null });
      await log(client, 'warn',
        `Could not determine invite code for new member \`${member.id}\`. Catalogued with no referrer. Manual review may be needed.`
      );
      return;
    }

    // ── Self-referral check ───────────────────────────────────────────────────
    if (inviteRow && inviteRow.created_by_id === member.id) {
      await log(client, 'warn',
        `Self-referral attempt detected: \`${member.id}\` tried to join using their own invite code \`${usedCode}\`. No action taken.`
      );
      return;
    }

    // ── Catalogue the member ──────────────────────────────────────────────────
    const referrerId = inviteRow?.created_by_id ?? null;
    db.upsertMember(member.id, { referrer_id: referrerId });

    // ── Skip point award checks ───────────────────────────────────────────────
    if (member.user.bot) return;
    if (!inviteRow) return;

    // Bot-created invite with no human owner on record.
    // This means the invite exists in Discord (created by the bot on someone's
    // behalf) but the member never clicked "Get My Referral Link", so we have
    // no entry in invite_codes mapping this code to a real user. If the member
    // DID click the button, syncInviteCode preserves their ID across restarts
    // and created_by_bot will be false — so this branch is only hit for
    // truly unowned bot-created invites.
    if (inviteRow.created_by_bot) {
      await log(client, 'warn',
        `Member \`${member.id}\` joined via bot-created invite \`${usedCode}\` but no referral button owner is on record. No points awarded.`
      );
      return;
    }

    const existing = db.getMember(member.id);
    if (existing?.joined === 1)        return;

    // ── Verify referrer via getReferrer ───────────────────────────────────────
    const confirmedReferrer = db.getReferrer(member.id);

    if (!confirmedReferrer) {
      await log(client, 'warn', `No referrer resolved for \`${member.id}\` after cataloguing — skipping point award.`);
      return;
    }

    if (confirmedReferrer !== inviteRow.created_by_id) {
      await log(client, 'warn',
        `Referrer mismatch for \`${member.id}\`: invite says \`${inviteRow.created_by_id}\`, getReferrer returned \`${confirmedReferrer}\`. No points awarded.`
      );
      return;
    }

    // ── Award point ───────────────────────────────────────────────────────────
    const newTotal = db.addPoints(confirmedReferrer, 1, 'join');
    db.upsertMember(member.id, { joined: 1 });

    await log(client, 'success',
      `Member \`${member.id}\` joined via \`${usedCode}\` — referrer \`${confirmedReferrer}\` awarded 1 point (total: **${newTotal}**).`
    );
  },
};
