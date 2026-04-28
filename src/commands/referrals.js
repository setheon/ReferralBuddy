'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { isAuthorized, denyUnauthorized } = require('../utils/auth');
const { buildReferralReply } = require('../utils/inviteInfoHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('referrals')
    .setDescription('Check a user\'s invite codes and referred members')
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true)),

  async execute(interaction) {
    if (!isAuthorized(interaction.member)) return denyUnauthorized(interaction);
    await interaction.deferReply({ flags: 1 << 6 });

    const target = interaction.options.getUser('user');
    const reply  = await buildReferralReply(target.id, interaction.client);
    return interaction.editReply(reply);
  },
};
