// src/events/guildMemberRemove.js
// ReferralBuddy — Log member departures

'use strict';

const { logToChannel } = require('../utils/logger');

module.exports = {
  name: 'guildMemberRemove',

  async execute(member) {
    await logToChannel(
      member.guild,
      'leave',
      'Member Left',
      `**${member.user.tag}** has left the server.`,
      [
        { name: '👤  Member', value: `${member.user.tag}\n\`${member.id}\``, inline: true },
        { name: '📅  Joined', value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
      ]
    );
  },
};
