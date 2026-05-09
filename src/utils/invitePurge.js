'use strict';

const db          = require('./database');
const inviteCache = require('./inviteCache');
const { log }     = require('./logger');

/**
 * Finds the best channel to create a new invite in.
 *
 * Cycles through configured invite_channels (oldest first), picking the first
 * one that has fewer than 50 active invites. Falls back to referral_channel_id
 * if no invite channels are configured.
 *
 * @param {Guild}      guild             - Discord.js Guild
 * @param {Collection} [prefetchedInvites] - Already-fetched guild invite collection
 *                                          (passed in to avoid a redundant API call)
 * @returns {Promise<TextChannel|null>}
 */
async function findInviteChannel(guild, prefetchedInvites = null) {
  const channels = db.listInviteChannels();

  // No dedicated invite channels configured — fall back to referral channel
  if (!channels.length) {
    const channelId = db.getConfig('referral_channel_id');
    if (!channelId) return null;
    return guild.channels.fetch(channelId).catch(() => null);
  }

  // Use pre-fetched invites if provided, otherwise fetch now
  let guildInvites = prefetchedInvites;
  if (!guildInvites) {
    try {
      guildInvites = await guild.invites.fetch();
    } catch {
      // Can't count — try the first configured channel as best guess
      const ch = await guild.channels.fetch(channels[0].channel_id).catch(() => null);
      return ch?.isTextBased() ? ch : null;
    }
  }

  // Count active invites per channel
  const countPerChannel = new Map();
  for (const [, inv] of guildInvites) {
    if (!inv.channel?.id) continue;
    countPerChannel.set(inv.channel.id, (countPerChannel.get(inv.channel.id) ?? 0) + 1);
  }

  // Return first channel under the 50-invite cap
  for (const { channel_id } of channels) {
    if ((countPerChannel.get(channel_id) ?? 0) < 50) {
      const ch = await guild.channels.fetch(channel_id).catch(() => null);
      if (ch?.isTextBased()) return ch;
    }
  }

  return null; // every configured channel is at capacity
}

/**
 * Purges invite codes that are 15+ days old with 0 uses.
 * Deletes from Discord, the database, and the in-memory cache.
 *
 * @param {Guild}  guild
 * @param {Client} client
 * @returns {Promise<{ purged: number, kept: number, errors: number }>}
 */
async function purgeUnusedInvites(guild, client) {
  const oldCodes = db.getOldInviteCodes(15);
  if (!oldCodes.length) return { purged: 0, kept: 0, errors: 0 };

  // Fetch live invite data from Discord
  let guildInvites;
  try {
    guildInvites = await guild.invites.fetch();
  } catch (err) {
    throw new Error(`Could not fetch guild invites: ${err.message}`);
  }

  // Build map of code → live Discord invite object
  const liveMap = new Map();
  for (const [, inv] of guildInvites) {
    liveMap.set(inv.code, inv);
  }

  let purged = 0, kept = 0, errors = 0;

  for (const row of oldCodes) {
    const liveInvite = liveMap.get(row.code);

    if (!liveInvite) {
      // Already gone from Discord — clean up DB and cache
      db.deleteInviteCode(row.code);
      inviteCache.remove(row.code);
      purged++;
      continue;
    }

    if ((liveInvite.uses ?? 0) === 0) {
      // Only delete if the bot itself created this invite on Discord.
      // Never touch invites that an admin or regular user created manually.
      if (liveInvite.inviter?.id !== client.user.id) {
        kept++;
        continue;
      }

      try {
        await liveInvite.delete('Purging unused referral invite (15+ days old, 0 uses)');
        db.deleteInviteCode(row.code);
        inviteCache.remove(row.code);
        purged++;
      } catch (err) {
        errors++;
        await log(client, 'warn', `Failed to delete unused invite \`${row.code}\`: ${err.message}`);
      }
    } else {
      // Has uses — leave it alone
      kept++;
    }
  }

  if (purged > 0 || errors > 0) {
    await log(client, 'admin',
      `Invite purge complete — **${purged}** removed, **${kept}** kept (in use), **${errors}** error(s).`
    );
  }

  return { purged, kept, errors };
}

module.exports = { findInviteChannel, purgeUnusedInvites };
