// src/events/interactionCreate.js
// ReferralBuddy — Route slash commands and button interactions

'use strict';

const { logToChannel } = require('../utils/logger');
const { errorEmbed }   = require('../utils/embeds');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {

    // ── Slash commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);

      if (!cmd) {
        return interaction.reply({ embeds: [errorEmbed('Unknown command.')], ephemeral: true });
      }

      try {
        await cmd.execute(interaction, client);
      } catch (err) {
        console.error(`[CMD ERROR] /${interaction.commandName}:`, err);

        if (interaction.guild) {
          await logToChannel(
            interaction.guild,
            'error',
            `Command Error: /${interaction.commandName}`,
            err.message
          );
        }

        const payload = { embeds: [errorEmbed('Something went wrong. Please try again.')], ephemeral: true };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }

      return;
    }

    // ── Button interactions ───────────────────────────────────────────────────
    if (interaction.isButton()) {
      if (interaction.customId === 'referral_get_link') {
        const referralCmd = client.commands.get('referral');
        if (referralCmd?.handleButton) {
          try {
            await referralCmd.handleButton(interaction);
          } catch (err) {
            console.error('[BUTTON ERROR] referral_get_link:', err);
            await interaction.reply({ embeds: [errorEmbed('Could not create your link. Please try again.')], ephemeral: true }).catch(() => {});
          }
        }
      }
    }
  },
};
