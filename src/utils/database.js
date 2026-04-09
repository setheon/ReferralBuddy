// src/utils/database.js
// ReferralBuddy — SQLite database layer
// Uses the built-in `node:sqlite` module (Node.js 22.5+) — zero npm dependencies.
// API is fully synchronous, identical surface to the previous better-sqlite3 layer.

'use strict';

const { DatabaseSync } = require('node:sqlite');
const path             = require('path');
const fs               = require('fs');

let _db = null;

// ─── Connection ───────────────────────────────────────────────────────────────

function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || './data/referralbuddy.db';
  const dir    = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys  = ON');
  _initSchema();
  return _db;
}

// ─── Thin prepared-statement wrapper ─────────────────────────────────────────
// node:sqlite's prepared statements work slightly differently from better-sqlite3.
// We wrap them to provide the same .get() / .all() / .run() interface.

function _stmt(sql) {
  const s = getDb().prepare(sql);
  return {
    get:  (...args) => s.get(...args)  ?? null,
    all:  (...args) => s.all(...args),
    run:  (...args) => s.run(...args),
  };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function _initSchema() {
  getDb().exec(`
    -- Per-guild configuration
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id              TEXT PRIMARY KEY,
      log_channel_id        TEXT,
      referral_channel_id   TEXT,
      referral_message_id   TEXT,
      configured_at         INTEGER DEFAULT (strftime('%s','now'))
    );

    -- Reward roles: assign a Discord role when a member passes a points threshold
    CREATE TABLE IF NOT EXISTS reward_roles (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id         TEXT    NOT NULL,
      role_id          TEXT    NOT NULL,
      role_name        TEXT    NOT NULL,
      points_required  INTEGER NOT NULL,
      UNIQUE(guild_id, role_id)
    );

    -- Snapshot of every invite code seen in a guild
    CREATE TABLE IF NOT EXISTS invites (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id     TEXT    NOT NULL,
      invite_code  TEXT    NOT NULL,
      inviter_id   TEXT,
      uses         INTEGER DEFAULT 0,
      max_uses     INTEGER DEFAULT 0,
      created_at   INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(guild_id, invite_code)
    );

    -- One personal referral invite per member per guild
    CREATE TABLE IF NOT EXISTS referral_invites (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id     TEXT NOT NULL,
      member_id    TEXT NOT NULL,
      invite_code  TEXT NOT NULL,
      invite_url   TEXT NOT NULL,
      created_at   INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(guild_id, member_id)
    );

    -- Every join event with attribution
    CREATE TABLE IF NOT EXISTS join_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id     TEXT NOT NULL,
      joiner_id    TEXT NOT NULL,
      joiner_tag   TEXT,
      inviter_id   TEXT,
      invite_code  TEXT,
      joined_at    INTEGER DEFAULT (strftime('%s','now'))
    );

    -- Immutable points ledger — never update rows, only insert
    CREATE TABLE IF NOT EXISTS points_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id          TEXT    NOT NULL,
      member_id         TEXT    NOT NULL,
      points            INTEGER NOT NULL,
      reason            TEXT    NOT NULL,
      related_member_id TEXT,
      earned_at         INTEGER DEFAULT (strftime('%s','now'))
    );

    -- Running totals cache (derived from points_log, kept in sync via triggers)
    CREATE TABLE IF NOT EXISTS member_points (
      guild_id      TEXT NOT NULL,
      member_id     TEXT NOT NULL,
      total_points  INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, member_id)
    );

    -- Prevent double-awarding level milestones
    CREATE TABLE IF NOT EXISTS level_milestones (
      guild_id     TEXT    NOT NULL,
      member_id    TEXT    NOT NULL,
      inviter_id   TEXT    NOT NULL,
      milestone    INTEGER NOT NULL,
      rewarded_at  INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, member_id, milestone)
    );
  `);
}

// ─── Guild config ─────────────────────────────────────────────────────────────

function getConfig(guildId) {
  return _stmt('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
}

function setConfig(guildId, data) {
  const cur = getConfig(guildId);
  if (cur) {
    const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
    _stmt(`UPDATE guild_config SET ${sets} WHERE guild_id = ?`)
      .run(...Object.values(data), guildId);
  } else {
    const cols = ['guild_id', ...Object.keys(data)].join(', ');
    const vals = Array(Object.keys(data).length + 1).fill('?').join(', ');
    _stmt(`INSERT INTO guild_config (${cols}) VALUES (${vals})`)
      .run(guildId, ...Object.values(data));
  }
}

// ─── Reward roles ─────────────────────────────────────────────────────────────

function getRewardRoles(guildId) {
  return _stmt('SELECT * FROM reward_roles WHERE guild_id = ? ORDER BY points_required ASC').all(guildId);
}

function setRewardRoles(guildId, roles) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    _stmt('DELETE FROM reward_roles WHERE guild_id = ?').run(guildId);
    for (const r of roles) {
      _stmt('INSERT INTO reward_roles (guild_id, role_id, role_name, points_required) VALUES (?, ?, ?, ?)')
        .run(guildId, r.roleId, r.roleName, r.pointsRequired);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ─── Invite snapshots ─────────────────────────────────────────────────────────

function upsertInvite(guildId, code, inviterId, uses, maxUses) {
  _stmt(`
    INSERT INTO invites (guild_id, invite_code, inviter_id, uses, max_uses)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, invite_code)
    DO UPDATE SET uses = excluded.uses, inviter_id = COALESCE(excluded.inviter_id, inviter_id)
  `).run(guildId, code, inviterId ?? null, uses ?? 0, maxUses ?? 0);
}

function getInvites(guildId) {
  return _stmt('SELECT * FROM invites WHERE guild_id = ?').all(guildId);
}

// ─── Referral invites ─────────────────────────────────────────────────────────

function getReferralInvite(guildId, memberId) {
  return _stmt('SELECT * FROM referral_invites WHERE guild_id = ? AND member_id = ?').get(guildId, memberId);
}

function saveReferralInvite(guildId, memberId, code, url) {
  _stmt(`
    INSERT INTO referral_invites (guild_id, member_id, invite_code, invite_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, member_id)
    DO UPDATE SET invite_code = excluded.invite_code, invite_url = excluded.invite_url
  `).run(guildId, memberId, code, url);
}

function getAllReferralCodes(guildId) {
  return _stmt('SELECT * FROM referral_invites WHERE guild_id = ?').all(guildId);
}

// ─── Join events ──────────────────────────────────────────────────────────────

function recordJoin(guildId, joinerId, joinerTag, inviterId, inviteCode) {
  _stmt(`
    INSERT INTO join_events (guild_id, joiner_id, joiner_tag, inviter_id, invite_code)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, joinerId, joinerTag ?? null, inviterId ?? null, inviteCode ?? null);
}

function getInviterForMember(guildId, joinerId) {
  return _stmt(`
    SELECT * FROM join_events
    WHERE guild_id = ? AND joiner_id = ?
    ORDER BY joined_at DESC LIMIT 1
  `).get(guildId, joinerId);
}

// ─── Points ledger ────────────────────────────────────────────────────────────

function addPoints(guildId, memberId, points, reason, relatedMemberId = null) {
  _stmt(`
    INSERT INTO points_log (guild_id, member_id, points, reason, related_member_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, memberId, points, reason, relatedMemberId);

  _stmt(`
    INSERT INTO member_points (guild_id, member_id, total_points)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, member_id)
    DO UPDATE SET total_points = total_points + excluded.total_points
  `).run(guildId, memberId, points);
}

function getMemberPoints(guildId, memberId) {
  const row = _stmt('SELECT total_points FROM member_points WHERE guild_id = ? AND member_id = ?').get(guildId, memberId);
  return row ? row.total_points : 0;
}

function getPointsInRange(guildId, memberId, fromTs, toTs) {
  const row = _stmt(`
    SELECT COALESCE(SUM(points), 0) AS total
    FROM points_log
    WHERE guild_id = ? AND member_id = ? AND earned_at BETWEEN ? AND ?
  `).get(guildId, memberId, fromTs, toTs);
  return row ? row.total : 0;
}

function getPointsLog(guildId, memberId, limit = 20) {
  return _stmt(`
    SELECT * FROM points_log
    WHERE guild_id = ? AND member_id = ?
    ORDER BY earned_at DESC LIMIT ?
  `).all(guildId, memberId, limit);
}

// ─── Invite counts ────────────────────────────────────────────────────────────

function getInviteCount(guildId, memberId) {
  const row = _stmt(`
    SELECT COUNT(*) AS cnt FROM join_events WHERE guild_id = ? AND inviter_id = ?
  `).get(guildId, memberId);
  return row ? row.cnt : 0;
}

function getInviteCountInRange(guildId, memberId, fromTs, toTs) {
  const row = _stmt(`
    SELECT COUNT(*) AS cnt FROM join_events
    WHERE guild_id = ? AND inviter_id = ? AND joined_at BETWEEN ? AND ?
  `).get(guildId, memberId, fromTs, toTs);
  return row ? row.cnt : 0;
}

// ─── Server-wide stats ────────────────────────────────────────────────────────

function getGuildStats(guildId, fromTs, toTs) {
  const topInviters = _stmt(`
    SELECT inviter_id, COUNT(*) AS cnt
    FROM join_events
    WHERE guild_id = ? AND inviter_id IS NOT NULL AND joined_at BETWEEN ? AND ?
    GROUP BY inviter_id ORDER BY cnt DESC LIMIT 10
  `).all(guildId, fromTs, toTs);

  const topEarners = _stmt(`
    SELECT member_id, COALESCE(SUM(points), 0) AS total
    FROM points_log
    WHERE guild_id = ? AND earned_at BETWEEN ? AND ?
    GROUP BY member_id ORDER BY total DESC LIMIT 10
  `).all(guildId, fromTs, toTs);

  const totalJoins  = _stmt(`SELECT COUNT(*) AS cnt FROM join_events WHERE guild_id = ? AND joined_at BETWEEN ? AND ?`).get(guildId, fromTs, toTs);
  const totalPoints = _stmt(`SELECT COALESCE(SUM(points), 0) AS total FROM points_log WHERE guild_id = ? AND earned_at BETWEEN ? AND ?`).get(guildId, fromTs, toTs);

  return {
    topInviters,
    topEarners,
    totalJoins:  totalJoins?.cnt   ?? 0,
    totalPoints: totalPoints?.total ?? 0,
  };
}

// ─── Level milestones ─────────────────────────────────────────────────────────

function hasMilestone(guildId, memberId, inviterId, milestone) {
  return !!_stmt(`
    SELECT 1 FROM level_milestones
    WHERE guild_id = ? AND member_id = ? AND inviter_id = ? AND milestone = ?
  `).get(guildId, memberId, inviterId, milestone);
}

function recordMilestone(guildId, memberId, inviterId, milestone) {
  _stmt(`
    INSERT OR IGNORE INTO level_milestones (guild_id, member_id, inviter_id, milestone)
    VALUES (?, ?, ?, ?)
  `).run(guildId, memberId, inviterId, milestone);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getDb,
  // Config
  getConfig, setConfig,
  // Reward roles
  getRewardRoles, setRewardRoles,
  // Invites
  upsertInvite, getInvites,
  // Referral invites
  getReferralInvite, saveReferralInvite, getAllReferralCodes,
  // Join events
  recordJoin, getInviterForMember,
  // Points
  addPoints, getMemberPoints, getPointsInRange, getPointsLog,
  // Invite counts
  getInviteCount, getInviteCountInRange,
  // Guild stats
  getGuildStats,
  // Milestones
  hasMilestone, recordMilestone,
};
