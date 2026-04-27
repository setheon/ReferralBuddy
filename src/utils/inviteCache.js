'use strict';

/**
 * In-memory invite cache: Map<code, uses>
 * Rebuilt on ready, updated after each guildMemberAdd.
 */
const cache = new Map();

function rebuild(invites) {
  cache.clear();
  for (const [, inv] of invites) {
    cache.set(inv.code, inv.uses ?? 0);
  }
}

function get(code) {
  return cache.get(code) ?? 0;
}

function set(code, uses) {
  cache.set(code, uses);
}

function remove(code) {
  cache.delete(code);
}

function entries() {
  return cache;
}

module.exports = { rebuild, get, set, remove, entries };
