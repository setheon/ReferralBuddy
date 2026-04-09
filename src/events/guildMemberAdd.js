// src/events/guildMemberAdd.js
// ReferralBuddy — Detect which invite was used, record the join, award +1 to the inviter

'use strict';

const db                 = require('../utils/database');
const { awardPoints }    = require('../utils/points');
const { logToChannel }   = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    const { guild } = member;

    // ── Diff cached vs fresh invite use-counts ───────────────────────────────
    let usedCode  = null;
    let inviterId = null;

    try {
      const cachedRows    = db.getInvites(guild.id);
      const cachedMap     = new Map(cachedRows.map(r => [r.invite_code, r.uses]));

      const freshInvites  = await guild.invites.fetch();

      // Look for a code whose use-count increased by exactly 1
      for (const [, fresh] of freshInvites) {
        const prevUses = cachedMap.get(fresh.code) ?? 0;
        if (fresh.uses > prevUses) {
          usedCode  = fresh.code;
          inviterId = fresh.inviter?.id ?? null;
          break;
        }
      }

      // Refresh the entire cache with current counts
      for (const [, fresh] of freshInvites) {
        db.upsertInvite(guild.id, fresh.code, fresh.inviter?.id ?? null, fresh.uses, fresh.maxUses);
      }

      // ── Referral invite fallback ─────────────────────────────────────────
      // If we still don't know the code, check if it matches a known referral code
      // (referral invites can be deleted after first use on some server configs)
      if (!usedCode || !inviterId) {
        const referralRows = db.getAllReferralCodes(guild.id);
        for (const row of referralRows) {
          const stillExists = freshInvites.has(row.invite_code);
          if (!stillExists) {
            // The invite disappeared between the join and our fetch — it was probably just used
            // Only attribute if it's the only missing one; otherwise we can't be sure
            const missingReferrals = referralRows.filter(r => !freshInvites.has(r.invite_code));
            if (missingReferrals.length === 1) {
              usedCode  = missingReferrals[0].invite_code;
              inviterId = missingReferrals[0].member_id;
            }
            break;
          }
        }
      }
    } catch (err) {
      await logToChannel(guild, 'error', 'Invite Detection Failed', err.message);
    }

    // ── Record join event ────────────────────────────────────────────────────
    db.recordJoin(guild.id, member.id, member.user.tag, inviterId, usedCode);

    await logToChannel(
      guild,
      'join',
      'New Member Joined',
      `Welcome <@${member.id}> to **${guild.name}**!`,
      [
        { name: '👤  Member',      value: `<@${member.id}>\n\`${member.user.tag}\``,     inline: true },
        { name: '🔗  Used Invite', value: usedCode  ? `\`${usedCode}\``     : '`Unknown`',         inline: true },
        { name: '📨  Invited By',  value: inviterId ? `<@${inviterId}>`      : 'Unknown / Organic', inline: true },
      ]
    );

    // ── Award +1 to the inviter ──────────────────────────────────────────────
    if (inviterId) {
      await awardPoints(
        guild,
        inviterId,
        1,
        `Referral join — **${member.user.tag}** joined using your invite`,
        member.id
      );
    }
  },
};
