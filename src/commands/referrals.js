'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db      = require('../utils/database');
const { log } = require('../utils/logger');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('referrals')
    .setDescription('Referral management')
    .addSubcommand(s => s
      .setName('check')
      .setDescription('Check a user\'s invite codes and referred members')
      .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('set-referrer')
      .setDescription('Manually set or correct the referrer for a member')
      .addUserOption(o => o.setName('user').setDescription('Member to update').setRequired(true))
      .addUserOption(o => o.setName('referrer').setDescription('Who referred this member').setRequired(true))
    ),

  async execute(interaction, client) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral

    if (sub === 'check') {
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
    }

    if (sub === 'set-referrer') {
      const target   = interaction.options.getUser('user');
      const referrer = interaction.options.getUser('referrer');

      if (target.id === referrer.id) {
        return interaction.editReply('❌ A user cannot be their own referrer.');
      }

      db.setMemberReferrer(target.id, referrer.id);

      await log(client, 'admin',
        `🔧 Admin \`${interaction.user.id}\` manually set referrer for \`${target.id}\` to \`${referrer.id}\`.`
      );

      return interaction.editReply(`✅ Referrer for <@${target.id}> manually set to <@${referrer.id}>.`);
    }
  },
};
