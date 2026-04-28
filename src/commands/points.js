'use strict';

const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/database');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('points')
    .setDescription('Check a user\'s referral points and referrer')
    .addUserOption(o => o
      .setName('user')
      .setDescription('User to check')
      .setRequired(true)
    ),

  async execute(interaction) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);

    await interaction.deferReply({ flags: 1 << 6 }); // ephemeral

    const target     = interaction.options.getUser('user');
    const points     = db.getPoints(target.id);
    const referrerId = db.getReferrer(target.id);

    let referrerText = 'None';
    if (referrerId) {
      const referrerUser = await interaction.client.users.fetch(referrerId).catch(() => null);
      referrerText = referrerUser ? `<@${referrerId}> (${referrerUser.tag})` : `\`${referrerId}\``;
    }

    return interaction.editReply(
      `<@${target.id}> has **${points}** referral point(s).\nReferred by: ${referrerText}`
    );
  },
};
