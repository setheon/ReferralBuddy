'use strict';

const db      = require('../utils/database');
const { log } = require('../utils/logger');

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember, client) {
    // Find newly added roles
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (addedRoles.size === 0) return;

    for (const [roleId] of addedRoles) {
      const reward = db.getRoleReward(roleId);
      if (!reward) continue;

      // Already awarded this role reward to this member?
      if (db.hasRoleRewardLog(newMember.id, roleId)) continue;

      // Resolve referrer via the single source of truth
      const referrerId = db.getReferrer(newMember.id);

      if (!referrerId) {
        await log(client, 'info',
          `ℹ️ Role reward triggered for \`${newMember.id}\` (role \`${roleId}\`) but no referrer on record.`
        );
        continue;
      }

      const newTotal = db.addPoints(referrerId, reward.points_awarded);
      db.insertRoleRewardLog(newMember.id, roleId);

      await log(client, 'points',
        `⭐ \`${newMember.id}\` received role \`${roleId}\` — referrer \`${referrerId}\` awarded **${reward.points_awarded}** point(s) (total: **${newTotal}**).`
      );
    }
  },
};
