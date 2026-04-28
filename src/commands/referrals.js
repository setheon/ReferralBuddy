'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/database');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('referrals')
    .setDescription('Check a user\'s invite codes and referred members')
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true)),

  async execute(interaction) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);
    await interaction.deferReply({ flags: 1 << 6 });

    const target  = interaction.options.getUser('user');
    const codes   = db.getInviteCodesByUser(target.id);
    const members = db.getMembersByReferrer(target.id);

    let reply = `<@${target.id}> has **${codes.length}** invite code(s) and has successfully referred **${members.length}** member(s).`;

    if (members.length > 0) {
      const names = await Promise.all(
        members.map(async m => {
          const u = await interaction.client.users.fetch(m.user_id).catch(() => null);
          return u ? `• ${u.tag} (\`${m.user_id}\`)` : `• \`${m.user_id}\``;
        })
      );
      reply += `\n\n**Referred members:**\n${names.join('\n')}`;
    }

    return interaction.editReply(reply);
  },
};
