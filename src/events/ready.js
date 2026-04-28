'use strict';

const db           = require('../utils/database');
const inviteCache  = require('../utils/inviteCache');
const { log, consoleLog } = require('../utils/logger');
const { runBackup } = require('../utils/backup');

module.exports = {
  name: 'ready',
  once: true,

  async execute(client) {
    consoleLog('info', `Logged in as ${client.user.tag}  (${client.user.id})`);

    // ── Rebuild invite cache ──────────────────────────────────────────────────
    for (const [, guild] of client.guilds.cache) {
      try {
        const invites = await guild.invites.fetch();
        inviteCache.rebuild(invites);

        // Sync invite codes into the DB.
        // Uses syncInviteCode so a restart never overwrites a human-claimed
        // record with the bot's ID (the bot creates invites on members' behalf).
        for (const [, inv] of invites) {
          db.syncInviteCode(
            inv.code,
            inv.inviter?.id  ?? null,
            inv.inviter?.bot ?? false,
          );
        }

        consoleLog('invite', `Cached ${invites.size} invite(s) for ${guild.name}`);
      } catch (err) {
        consoleLog('error', `Could not fetch invites for ${guild.name}: ${err.message}`);
      }
    }

    // ── Catalogue all guild members ───────────────────────────────────────────
    let newCount      = 0;
    let existingCount = 0;

    for (const [, guild] of client.guilds.cache) {
      try {
        const members = await guild.members.fetch();
        for (const [, member] of members) {
          if (member.user.bot) continue;
          const existing = db.getMember(member.id);
          if (existing) {
            existingCount++;
          } else {
            db.upsertMember(member.id);
            newCount++;
          }
        }
      } catch (err) {
        consoleLog('error', `Could not catalogue members for ${guild.name}: ${err.message}`);
      }
    }

    await log(client, 'info', `Bot online. Catalogued **${newCount}** new member(s). **${existingCount}** already existed.`);

    // ── Automatic database backup ─────────────────────────────────────────────
    try {
      await runBackup(client);
    } catch (err) {
      consoleLog('error', `Startup backup failed: ${err.message}`);
    }
  },
};
