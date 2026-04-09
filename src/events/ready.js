// src/events/ready.js
// ReferralBuddy — Cache every invite in every guild on startup

'use strict';

const { upsertInvite } = require('../utils/database');
const { consoleLog }   = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,

  async execute(client) {
    consoleLog('setup', `Logged in as ${client.user.tag}  (${client.user.id})`);
    consoleLog('setup', `Connected to ${client.guilds.cache.size} guild(s)`);

    let totalCached = 0;

    for (const [, guild] of client.guilds.cache) {
      try {
        const invites = await guild.invites.fetch();
        for (const [, inv] of invites) {
          upsertInvite(guild.id, inv.code, inv.inviter?.id ?? null, inv.uses ?? 0, inv.maxUses ?? 0);
        }
        totalCached += invites.size;
        consoleLog('invite', `Cached ${invites.size} invites`, guild.name);
      } catch (err) {
        consoleLog('error', `Could not fetch invites for ${guild.name}`, err.message);
      }
    }

    consoleLog('setup', `Invite cache complete — ${totalCached} total invites loaded`);
    consoleLog('setup', '───────────────────────────── ReferralBuddy is ready ─────────────────────────────');
  },
};
