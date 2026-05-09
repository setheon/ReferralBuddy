'use strict';

const { log }                      = require('../utils/logger');
const { handleReferralButton }     = require('../utils/referralButton');
const { handleFetchInvitesButton } = require('../utils/inviteInfoHandler');
const {
  handleLeaderboardButton,
  handleStatsButton,
  isPanelButton,
} = require('../utils/panelButtonHandlers');
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
  handleDebugSelect,
  isDebugButton,
  isDebugModal,
  isDebugSelect,
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

      if (isPanelButton(interaction.customId)) {
        try {
          if (interaction.customId === 'referral_btn_leaderboard') {
            await handleLeaderboardButton(interaction, client);
          } else {
            await handleStatsButton(interaction, client);
          }
        } catch (err) {
          console.error('[BUTTON ERROR] panel:', err);
          await log(client, 'error', `Panel button error \`${interaction.customId}\`: ${err.message}`);
          const p = { content: '❌ Something went wrong. Please try again.', flags: 1 << 6 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(p).catch(() => {});
          else await interaction.reply(p).catch(() => {});
        }
        return;
      }

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

      if (interaction.customId.startsWith('referrals_fetch_invites:')) {
        try {
          await handleFetchInvitesButton(interaction, client);
        } catch (err) {
          console.error('[BUTTON ERROR] fetch_invites:', err);
          await log(client, 'error', `Fetch invites error: ${err.message}`);
          const p = { content: '❌ Could not fetch invite data.', flags: 1 << 6 };
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

      if (isDebugSelect(interaction.customId)) {
        try {
          await handleDebugSelect(interaction, client);
        } catch (err) {
          console.error('[SELECT ERROR] debug:', err);
          await log(client, 'error', `Debug select error \`${interaction.customId}\`: ${err.message}`);
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
