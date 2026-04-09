// src/utils/logger.js
// ReferralBuddy — Fancy Discord channel logging + styled console output

'use strict';

const { EmbedBuilder } = require('discord.js');
const { getConfig }    = require('./database');

// ─── Console colours ──────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  grey:    '\x1b[90m',
  white:   '\x1b[37m',
};

// ─── Type → visual mappings ───────────────────────────────────────────────────

const TYPE_META = {
  join:    { color: 0x57F287, emoji: '📥', console: C.green   },
  leave:   { color: 0xED4245, emoji: '📤', console: C.red     },
  points:  { color: 0xFEE75C, emoji: '⭐', console: C.yellow  },
  invite:  { color: 0x5865F2, emoji: '🔗', console: C.cyan    },
  reward:  { color: 0xEB459E, emoji: '🏆', console: C.magenta },
  setup:   { color: 0x00B0F4, emoji: '⚙️',  console: C.blue    },
  error:   { color: 0xFF0000, emoji: '❌', console: C.red     },
  info:    { color: 0x95A5A6, emoji: 'ℹ️',  console: C.grey    },
  level:   { color: 0xF1C40F, emoji: '🎯', console: C.yellow  },
};

// ─── Console logger ───────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function consoleLog(type, title, details = '') {
  const meta   = TYPE_META[type] || TYPE_META.info;
  const colour = meta.console;
  const line   = `${C.grey}[${ts()}]${C.reset} ${colour}${C.bold}${meta.emoji} ${title}${C.reset}`;
  console.log(line + (details ? `\n  ${C.grey}↳ ${details}${C.reset}` : ''));
}

// ─── Discord channel logger ───────────────────────────────────────────────────

/**
 * Send a styled embed to the guild's configured log channel.
 *
 * @param {import('discord.js').Guild} guild
 * @param {'join'|'leave'|'points'|'invite'|'reward'|'setup'|'error'|'info'|'level'} type
 * @param {string} title
 * @param {string} description
 * @param {Array<{name:string, value:string, inline?:boolean}>} [fields]
 */
async function logToChannel(guild, type, title, description = '', fields = []) {
  // Always log to console
  consoleLog(type, `[${guild?.name ?? 'unknown'}] ${title}`, description.replace(/<[^>]+>/g, '').slice(0, 120));

  if (!guild) return;

  try {
    const cfg = getConfig(guild.id);
    if (!cfg?.log_channel_id) return;

    const channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;

    const meta  = TYPE_META[type] || TYPE_META.info;
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(`${meta.emoji}  ${title}`)
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields);

    embed.setFooter({ text: 'ReferralBuddy' });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    consoleLog('error', 'Failed to send log embed', err.message);
  }
}

module.exports = { logToChannel, consoleLog };
