'use strict';

const { log }                  = require('../utils/logger');
const { handleReferralButton } = require('../utils/referralButton');
const {
  handleSetupButton,
  handleSetupSelect,
  handleSetupModal,
  isSetupButton,
  isSetupSelect,
  isSetupModal,
} = require('../utils/setupHandlers');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {

    // ── Slash commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);

      if (!cmd) {
        return interaction.reply({ content: '❌ Unknown command.', flags: 1 << 6 });
      }

      try {
        await cmd.execute(interaction, client);
      } catch (err) {
        console.error(`[CMD ERROR] /${interaction.commandName}:`, err);
        await log(client, 'error', `Command Error: \`/${interaction.commandName}\` — ${err.message}`);

        const payload = { content: '❌ Something went wrong. Please try again.', flags: 1 << 6 };
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
        try {
          await handleReferralButton(interaction, client);
        } catch (err) {
          console.error('[BUTTON ERROR] referral_get_link:', err);
          await log(client, 'error', `Referral button error for \`${interaction.user.id}\`: ${err.message}`);
          await interaction.reply({ content: '❌ Could not create your link. Please try again.', flags: 1 << 6 }).catch(() => {});
        }
        return;
      }

      if (isSetupButton(interaction.customId)) {
        try {
          await handleSetupButton(interaction, client);
        } catch (err) {
          console.error('[BUTTON ERROR] setup:', err);
          await log(client, 'error', `Setup button error \`${interaction.customId}\`: ${err.message}`);
          const errPayload = { content: '❌ Something went wrong.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(errPayload).catch(() => {});
          } else {
            await interaction.reply(errPayload).catch(() => {});
          }
        }
        return;
      }
    }

    // ── Select menu interactions ──────────────────────────────────────────────
    if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      if (isSetupSelect(interaction.customId)) {
        try {
          await handleSetupSelect(interaction, client);
        } catch (err) {
          console.error('[SELECT ERROR] setup:', err);
          await log(client, 'error', `Setup select error \`${interaction.customId}\`: ${err.message}`);
          await interaction.reply({ content: '❌ Something went wrong.', flags: 1 << 6 }).catch(() => {});
        }
        return;
      }
    }

    // ── Modal submissions ─────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      if (isSetupModal(interaction.customId)) {
        try {
          await handleSetupModal(interaction, client);
        } catch (err) {
          console.error('[MODAL ERROR] setup:', err);
          await log(client, 'error', `Setup modal error \`${interaction.customId}\`: ${err.message}`);
          await interaction.reply({ content: '❌ Something went wrong.', flags: 1 << 6 }).catch(() => {});
        }
        return;
      }
    }
  },
};
