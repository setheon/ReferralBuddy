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
const {
  handleDebugButton,
  handleDebugModal,
  isDebugButton,
  isDebugModal,
} = require('../utils/debugHandlers');

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
          const p = { content: '❌ Could not create your link. Please try again.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(p).catch(() => {});
          else await interaction.reply(p).catch(() => {});
        }
        return;
      }

      if (isSetupButton(interaction.customId)) {
        try {
          await handleSetupButton(interaction, client);
        } catch (err) {
          console.error('[BUTTON ERROR] setup:', err);
          await log(client, 'error', `Setup button error \`${interaction.customId}\`: ${err.message}`);
          const p = { content: '❌ Something went wrong.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(p).catch(() => {});
          else await interaction.reply(p).catch(() => {});
        }
        return;
      }

      if (isDebugButton(interaction.customId)) {
        try {
          await handleDebugButton(interaction, client);
        } catch (err) {
          console.error('[BUTTON ERROR] debug:', err);
          await log(client, 'error', `Debug button error \`${interaction.customId}\`: ${err.message}`);
          const p = { content: '❌ Something went wrong.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(p).catch(() => {});
          else await interaction.reply(p).catch(() => {});
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
          const p = { content: '❌ Something went wrong.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(p).catch(() => {});
          else await interaction.reply(p).catch(() => {});
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
          const p = { content: '❌ Something went wrong.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(p).catch(() => {});
          else await interaction.reply(p).catch(() => {});
        }
        return;
      }

      if (isDebugModal(interaction.customId)) {
        try {
          await handleDebugModal(interaction, client);
        } catch (err) {
          console.error('[MODAL ERROR] debug:', err);
          await log(client, 'error', `Debug modal error \`${interaction.customId}\`: ${err.message}`);
          const p = { content: '❌ Something went wrong.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(p).catch(() => {});
          else await interaction.reply(p).catch(() => {});
        }
        return;
      }
    }
  },
};
