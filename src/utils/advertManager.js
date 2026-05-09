'use strict';

const { EmbedBuilder } = require('discord.js');
const db               = require('./database');
const { log }          = require('./logger');

const BOT_ID      = '1491695725820772424';
const ADVERT_IMAGE = 'https://media.discordapp.net/attachments/1311207930833408091/1498621103961018388/Advert_01.png?ex=69f1d32a&is=69f081aa&hm=6b05785db39e6002fe863b72c4fde4ccd59d7a8880441c8fe0e643fa8644630f&=&format=webp&quality=lossless&width=1672&height=469';

// channelId → NodeJS.Timeout
const timers = new Map();

// ─── Embed builder ────────────────────────────────────────────────────────────

function buildAdvertEmbed() {
  const description = db.getConfig('advert_message') ?? 'Go to <#1498627201631916092> to get started!';
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setImage(ADVERT_IMAGE)
    .setDescription(description);
}

// ─── Core check / post logic ──────────────────────────────────────────────────

/**
 * Scans the last 100 messages in a channel for the bot's own ID.
 * Returns true if the bot was found (skip posting), false if not (proceed).
 */
async function botRecentlyPosted(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    return messages.some(m => m.author.id === BOT_ID);
  } catch {
    return true; // on error, play it safe and skip
  }
}

/**
 * Checks a single channel and posts the advert embed if the bot hasn't
 * appeared in the last 100 messages. Returns true if the embed was posted.
 */
async function checkAndPost(channelId, client) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const skip = await botRecentlyPosted(channel);
  if (skip) return false;

  await channel.send({ embeds: [buildAdvertEmbed()] });
  await log(client, 'info', `Chat advert posted in <#${channelId}>.`);
  return true;
}

/**
 * Force-posts the advert embed in a channel, skipping the recent-message check.
 */
async function forcePost(channelId, client) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  await channel.send({ embeds: [buildAdvertEmbed()] });
  await log(client, 'admin', `Chat advert force-posted in <#${channelId}>.`);
  return true;
}

// ─── Cycle (all channels) ─────────────────────────────────────────────────────

/**
 * Runs the full advert check across every configured channel.
 * Called automatically by each channel's timer, and manually by the debug panel.
 */
async function runAdvertCycle(client) {
  const channels = db.listAdvertChannels();
  if (!channels.length) return { posted: 0, skipped: 0 };

  let posted = 0, skipped = 0;

  for (const { channel_id } of channels) {
    try {
      const didPost = await checkAndPost(channel_id, client);
      if (didPost) posted++; else skipped++;
    } catch (err) {
      await log(client, 'warn', `Chat advert check failed for <#${channel_id}>: ${err.message}`);
      skipped++;
    }
  }

  await log(client, 'info',
    `Chat advert cycle complete — **${posted}** posted, **${skipped}** skipped (bot already active in channel).`
  );

  return { posted, skipped };
}

// ─── Timer management ─────────────────────────────────────────────────────────

function getIntervalMs() {
  const hours = Math.max(0.1, parseFloat(db.getConfig('advert_interval_hours') ?? '1'));
  return hours * 60 * 60 * 1000;
}

/** Starts (or restarts) the interval timer for a single channel. */
function startChannelTimer(channelId, client) {
  if (timers.has(channelId)) clearInterval(timers.get(channelId));

  const timer = setInterval(async () => {
    if (db.getConfig('advert_enabled') === '0') return;
    await checkAndPost(channelId, client).catch(() => {});
  }, getIntervalMs());

  timers.set(channelId, timer);
}

/** Stops the timer for a single channel. */
function stopChannelTimer(channelId) {
  if (timers.has(channelId)) {
    clearInterval(timers.get(channelId));
    timers.delete(channelId);
  }
}

/** Starts timers for all configured advert channels. */
function startAdvert(client) {
  if (db.getConfig('advert_enabled') === '0') return;
  for (const { channel_id } of db.listAdvertChannels()) {
    startChannelTimer(channel_id, client);
  }
}

/** Stops all advert timers. */
function stopAdvert() {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}

/** Stops all timers and restarts them with the current config. */
function restartAdvert(client) {
  stopAdvert();
  startAdvert(client);
}

/** Returns how many channel timers are currently running. */
function activeTimerCount() {
  return timers.size;
}

module.exports = {
  buildAdvertEmbed,
  checkAndPost,
  forcePost,
  runAdvertCycle,
  startChannelTimer,
  stopChannelTimer,
  startAdvert,
  stopAdvert,
  restartAdvert,
  activeTimerCount,
};
