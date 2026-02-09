const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');

let db = null;

function getConnection() {
  if (db) return db;

  const dbPath = path.resolve(config.DB_PATH);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');

  logger.info({ dbPath }, 'SQLite connection established');
  return db;
}

function closeConnection() {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite connection closed');
  }
}

module.exports = { getConnection, closeConnection };
