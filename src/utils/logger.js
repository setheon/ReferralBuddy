'use strict';

const { EmbedBuilder } = require('discord.js');

// ─── Console colours ──────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  grey:    '\x1b[90m',
};

const TYPE_META = {
  info:    { color: 0x5865F2, emoji: 'ℹ️',  console: C.blue    },
  success: { color: 0x57F287, emoji: '✅', console: C.green   },
  warn:    { color: 0xFEE75C, emoji: '⚠️',  console: C.yellow  },
  error:   { color: 0xED4245, emoji: '❌', console: C.red     },
  points:  { color: 0xFEE75C, emoji: '⭐', console: C.yellow  },
  invite:  { color: 0x5865F2, emoji: '🔗', console: C.cyan    },
  leave:   { color: 0x95A5A6, emoji: '📤', console: C.grey    },
  backup:  { color: 0x00B0F4, emoji: '💾', console: C.cyan    },
  admin:   { color: 0xEB459E, emoji: '🔧', console: C.magenta },
};

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function consoleLog(type, message) {
  const meta   = TYPE_META[type] ?? TYPE_META.info;
  const colour = meta.console;
  console.log(`${C.grey}[${ts()}]${C.reset} ${colour}${C.bold}${meta.emoji}  ${message}${C.reset}`);
}

// ─── Discord channel logger ───────────────────────────────────────────────────

/**
 * Post a plain-text message to the configured log channel.
 * Falls back to console-only if the log channel is not configured or unreachable.
 *
 * @param {import('discord.js').Client} client
 * @param {string} type  — key from TYPE_META
 * @param {string} message
 */
async function log(client, type, message) {
  consoleLog(type, message);

  try {
    const { getConfig } = require('./database');
    const channelId     = getConfig('log_channel_id');
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const meta  = TYPE_META[type] ?? TYPE_META.info;
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setDescription(`${meta.emoji}  ${message}`)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    consoleLog('error', `Failed to send log to channel: ${err.message}`);
  }
}

module.exports = { log, consoleLog };
