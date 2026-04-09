// src/events/inviteCreate.js
// ReferralBuddy — Track newly created invites

'use strict';

const { upsertInvite } = require('../utils/database');
const { logToChannel } = require('../utils/logger');

module.exports = {
  name: 'inviteCreate',

  async execute(invite) {
    upsertInvite(
      invite.guild.id,
      invite.code,
      invite.inviter?.id ?? null,
      invite.uses   ?? 0,
      invite.maxUses ?? 0
    );

    await logToChannel(
      invite.guild,
      'invite',
      'Invite Created',
      `A new invite was created.`,
      [
        { name: 'Code',      value: `\`${invite.code}\``,                                  inline: true },
        { name: 'Creator',   value: invite.inviter ? `<@${invite.inviter.id}>` : 'Unknown', inline: true },
        { name: 'Max Uses',  value: invite.maxUses ? String(invite.maxUses) : '∞',          inline: true },
      ]
    );
  },
};
