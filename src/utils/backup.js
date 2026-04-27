'use strict';

const fs   = require('fs');
const path = require('path');

const MAX_BACKUPS = 10;

/**
 * Backs up the SQLite database file to /backups with a timestamped filename.
 * Prunes oldest backups beyond MAX_BACKUPS.
 *
 * @param {import('discord.js').Client} client
 * @returns {string} backup filename
 */
async function runBackup(client) {
  const db       = require('./database');
  const { log }  = require('./logger');

  const dbPath    = process.env.DB_PATH || path.join(process.cwd(), 'data', 'referralbuddy.db');
  const backupDir = path.join(process.cwd(), 'backups');

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename  = `backup-${timestamp}.db`;
  const destPath  = path.join(backupDir, filename);

  // Use better-sqlite3's built-in backup method for a safe hot backup
  await db.getDb().backup(destPath);

  db.insertBackupLog(filename);

  // Prune oldest backups beyond limit
  const logs = db.getBackupLogs(); // ordered ASC
  if (logs.length > MAX_BACKUPS) {
    const toDelete = logs.slice(0, logs.length - MAX_BACKUPS);
    for (const entry of toDelete) {
      const filePath = path.join(backupDir, entry.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      db.deleteBackupLog(entry.rowid);
    }
  }

  await log(client, 'backup', `Database backed up to \`${filename}\`.`);
  return filename;
}

module.exports = { runBackup };
