// src/events/inviteDelete.js
// ReferralBuddy — Log invite deletions (DB row kept for attribution history)

'use strict';

const { logToChannel } = require('../utils/logger');

module.exports = {
  name: 'inviteDelete',

  async execute(invite) {
    await logToChannel(
      invite.guild,
      'info',
      'Invite Deleted',
      `Invite \`${invite.code}\` was deleted or expired.`,
      [{ name: 'Code', value: `\`${invite.code}\``, inline: true }]
    );
  },
};
