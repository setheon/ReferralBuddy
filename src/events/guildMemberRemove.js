'use strict';

const db      = require('../utils/database');
const { log } = require('../utils/logger');

module.exports = {
  name: 'guildMemberRemove',

  async execute(member, client) {
    if (member.user.bot) return;

    // Upsert into left_members and mark has_left in guild_members.
    // joined is never reset to 0 on leave.
    db.recordLeave(member.id);
    db.upsertMember(member.id, { has_left: 1 });

    await log(client, 'leave', `📤 Member \`${member.id}\` (${member.user.tag}) left the server.`);
  },
};
