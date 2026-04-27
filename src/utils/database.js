'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// ─── Connection ───────────────────────────────────────────────────────────────

let _db = null;

function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'referralbuddy.db');
  const dir    = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _initSchema();
  return _db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function _initSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS bot_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code           TEXT PRIMARY KEY,
      created_by_id  TEXT,
      created_by_bot INTEGER NOT NULL DEFAULT 0,
      added_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referral_points (
      user_id TEXT PRIMARY KEY,
      points  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS guild_members (
      user_id     TEXT PRIMARY KEY,
      joined      INTEGER NOT NULL DEFAULT 0,
      has_left    INTEGER NOT NULL DEFAULT 0,
      referrer_id TEXT
    );

    CREATE TABLE IF NOT EXISTS left_members (
      user_id TEXT PRIMARY KEY,
      left_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_point_rewards (
      role_id       TEXT PRIMARY KEY,
      points_awarded INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_reward_log (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS referral_button_cooldowns (
      user_id   TEXT PRIMARY KEY,
      last_used TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS db_backup_log (
      backup_at TEXT NOT NULL,
      filename  TEXT NOT NULL
    );
  `);
}

// ─── Bot config ───────────────────────────────────────────────────────────────

function getConfig(key) {
  return getDb().prepare('SELECT value FROM bot_config WHERE key = ?').get(key)?.value ?? null;
}

function setConfig(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)').run(key, value);
}

// ─── getReferrer — single source of truth ────────────────────────────────────

/**
 * Returns the referrer_id for a given userId, or null if none on record.
 * Every feature that needs referral attribution must call this.
 */
function getReferrer(userId) {
  const row = getDb().prepare('SELECT referrer_id FROM guild_members WHERE user_id = ?').get(userId);
  return row?.referrer_id ?? null;
}

// ─── Invite codes ─────────────────────────────────────────────────────────────

function upsertInviteCode(code, createdById, createdByBot) {
  getDb().prepare(`
    INSERT INTO invite_codes (code, created_by_id, created_by_bot)
    VALUES (?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      created_by_id  = excluded.created_by_id,
      created_by_bot = excluded.created_by_bot
  `).run(code, createdById ?? null, createdByBot ? 1 : 0);
}

function getInviteCode(code) {
  return getDb().prepare('SELECT * FROM invite_codes WHERE code = ?').get(code) ?? null;
}

function getInviteCodesByUser(userId) {
  return getDb().prepare('SELECT * FROM invite_codes WHERE created_by_id = ?').all(userId);
}

// ─── Referral points ──────────────────────────────────────────────────────────

function getPoints(userId) {
  return getDb().prepare('SELECT points FROM referral_points WHERE user_id = ?').get(userId)?.points ?? 0;
}

function addPoints(userId, delta) {
  getDb().prepare(`
    INSERT INTO referral_points (user_id, points) VALUES (?, MAX(0, ?))
    ON CONFLICT(user_id) DO UPDATE SET points = MAX(0, points + ?)
  `).run(userId, Math.max(0, delta), delta);
  return getPoints(userId);
}

function setPoints(userId, value) {
  const clamped = Math.max(0, value);
  getDb().prepare(`
    INSERT INTO referral_points (user_id, points) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET points = ?
  `).run(userId, clamped, clamped);
  return clamped;
}

function getLeaderboard(limit = 10) {
  return getDb().prepare('SELECT user_id, points FROM referral_points ORDER BY points DESC LIMIT ?').all(limit);
}

// ─── Guild members ────────────────────────────────────────────────────────────

function getMember(userId) {
  return getDb().prepare('SELECT * FROM guild_members WHERE user_id = ?').get(userId) ?? null;
}

/**
 * Upsert a member record. Never overwrites existing joined, has_left, or referrer_id
 * unless explicitly passed as non-null values.
 */
function upsertMember(userId, { joined, has_left, referrer_id } = {}) {
  const existing = getMember(userId);
  if (!existing) {
    getDb().prepare(`
      INSERT INTO guild_members (user_id, joined, has_left, referrer_id)
      VALUES (?, ?, ?, ?)
    `).run(
      userId,
      joined    ?? 0,
      has_left  ?? 0,
      referrer_id ?? null,
    );
  } else {
    const updates = {};
    if (joined    !== undefined && joined    !== null) updates.joined      = joined;
    if (has_left  !== undefined && has_left  !== null) updates.has_left    = has_left;
    if (referrer_id !== undefined && referrer_id !== null) updates.referrer_id = referrer_id;

    if (Object.keys(updates).length === 0) return existing;

    const sets   = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    getDb().prepare(`UPDATE guild_members SET ${sets} WHERE user_id = ?`).run(...values);
  }
  return getMember(userId);
}

function getMembersByReferrer(referrerId) {
  return getDb().prepare('SELECT * FROM guild_members WHERE referrer_id = ?').all(referrerId);
}

function setMemberReferrer(userId, referrerId) {
  getDb().prepare(`
    INSERT INTO guild_members (user_id, referrer_id) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET referrer_id = excluded.referrer_id
  `).run(userId, referrerId);
}

// ─── Left members ─────────────────────────────────────────────────────────────

function recordLeave(userId) {
  getDb().prepare(`
    INSERT INTO left_members (user_id, left_at) VALUES (?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET left_at = excluded.left_at
  `).run(userId);
}

// ─── Role point rewards ───────────────────────────────────────────────────────

function getRoleReward(roleId) {
  return getDb().prepare('SELECT * FROM role_point_rewards WHERE role_id = ?').get(roleId) ?? null;
}

function listRoleRewards() {
  return getDb().prepare('SELECT * FROM role_point_rewards ORDER BY points_awarded DESC').all();
}

function upsertRoleReward(roleId, pointsAwarded) {
  getDb().prepare(`
    INSERT INTO role_point_rewards (role_id, points_awarded) VALUES (?, ?)
    ON CONFLICT(role_id) DO UPDATE SET points_awarded = excluded.points_awarded
  `).run(roleId, pointsAwarded);
}

function deleteRoleReward(roleId) {
  getDb().prepare('DELETE FROM role_point_rewards WHERE role_id = ?').run(roleId);
}

function hasRoleRewardLog(userId, roleId) {
  return !!getDb().prepare('SELECT 1 FROM role_reward_log WHERE user_id = ? AND role_id = ?').get(userId, roleId);
}

function insertRoleRewardLog(userId, roleId) {
  getDb().prepare(`
    INSERT OR IGNORE INTO role_reward_log (user_id, role_id) VALUES (?, ?)
  `).run(userId, roleId);
}

// ─── Referral button cooldowns ────────────────────────────────────────────────

function getCooldown(userId) {
  return getDb().prepare('SELECT last_used FROM referral_button_cooldowns WHERE user_id = ?').get(userId) ?? null;
}

function upsertCooldown(userId) {
  getDb().prepare(`
    INSERT INTO referral_button_cooldowns (user_id, last_used) VALUES (?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET last_used = excluded.last_used
  `).run(userId);
}

// ─── Backup log ───────────────────────────────────────────────────────────────

function insertBackupLog(filename) {
  getDb().prepare(`
    INSERT INTO db_backup_log (backup_at, filename) VALUES (datetime('now'), ?)
  `).run(filename);
}

function getBackupLogs() {
  return getDb().prepare('SELECT rowid, * FROM db_backup_log ORDER BY backup_at ASC').all();
}

function deleteBackupLog(rowid) {
  getDb().prepare('DELETE FROM db_backup_log WHERE rowid = ?').run(rowid);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getDb,
  // Config
  getConfig, setConfig,
  // Core referrer resolution
  getReferrer,
  // Invite codes
  upsertInviteCode, getInviteCode, getInviteCodesByUser,
  // Points
  getPoints, addPoints, setPoints, getLeaderboard,
  // Guild members
  getMember, upsertMember, getMembersByReferrer, setMemberReferrer,
  // Left members
  recordLeave,
  // Role rewards
  getRoleReward, listRoleRewards, upsertRoleReward, deleteRoleReward,
  hasRoleRewardLog, insertRoleRewardLog,
  // Cooldowns
  getCooldown, upsertCooldown,
  // Backup log
  insertBackupLog, getBackupLogs, deleteBackupLog,
};
