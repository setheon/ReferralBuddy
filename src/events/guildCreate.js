// src/events/guildCreate.js
// ReferralBuddy — Cache invites when the bot is added to a new guild

'use strict';

const { upsertInvite } = require('../utils/database');
const { consoleLog }   = require('../utils/logger');

module.exports = {
  name: 'guildCreate',

  async execute(guild) {
    consoleLog('setup', `Joined new guild: ${guild.name}  (${guild.id})`);
    try {
      const invites = await guild.invites.fetch();
      for (const [, inv] of invites) {
        upsertInvite(guild.id, inv.code, inv.inviter?.id ?? null, inv.uses ?? 0, inv.maxUses ?? 0);
      }
      consoleLog('invite', `Cached ${invites.size} invites for new guild`, guild.name);
    } catch (err) {
      consoleLog('error', `Could not cache invites for ${guild.name}`, err.message);
    }
  },
};
