const { getConnection } = require('./connection');
const logger = require('../logger');

function initializeSchema() {
  const db = getConnection();

  db.exec(`
    CREATE TABLE IF NOT EXISTS padron_entries (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      padron_type         TEXT    NOT NULL,
      regimen             TEXT,
      fecha_publicacion   TEXT    NOT NULL,
      fecha_desde         TEXT    NOT NULL,
      fecha_hasta         TEXT    NOT NULL,
      cuit                TEXT    NOT NULL,
      tipo_contribuyente  TEXT,
      marca_alta          TEXT,
      marca_baja          TEXT,
      alicuota_percepcion REAL    NOT NULL DEFAULT 0,
      alicuota_retencion  REAL    NOT NULL DEFAULT 0,
      grupo_percepcion    INTEGER,
      grupo_retencion     INTEGER,
      created_at          TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cuit
      ON padron_entries (cuit);

    CREATE INDEX IF NOT EXISTS idx_cuit_type_dates
      ON padron_entries (cuit, padron_type, fecha_desde, fecha_hasta);

    CREATE INDEX IF NOT EXISTS idx_padron_type
      ON padron_entries (padron_type);

    CREATE TABLE IF NOT EXISTS padron_metadata (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      padron_type     TEXT    NOT NULL,
      filename        TEXT    NOT NULL,
      records_loaded  INTEGER NOT NULL DEFAULT 0,
      loaded_at       TEXT    DEFAULT (datetime('now')),
      status          TEXT    NOT NULL DEFAULT 'completed'
    );
  `);

  runMigrations(db);

  logger.info('Database schema initialized');
}

/**
 * Migraciones incrementales sobre tablas ya existentes.
 * Cada una debe ser idempotente: el arranque las corre siempre.
 */
function runMigrations(db) {
  const columns = db.prepare(`PRAGMA table_info(padron_entries)`).all().map(c => c.name);

  // Régimen del padrón de origen: 'P' percepción, 'R' retención, 'AMBOS'.
  // Permite que percepción y retención de una misma jurisdicción convivan bajo
  // un mismo padron_type sin pisarse al deduplicar por período.
  if (!columns.includes('regimen')) {
    db.exec(`ALTER TABLE padron_entries ADD COLUMN regimen TEXT`);
    // Lo ya cargado proviene del layout completo, que trae ambas alícuotas.
    const updated = db.prepare(`UPDATE padron_entries SET regimen = 'AMBOS' WHERE regimen IS NULL`).run();
    logger.info({ filas: updated.changes }, 'Migración: columna "regimen" agregada a padron_entries');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_type_regimen_periodo
      ON padron_entries (padron_type, regimen, fecha_desde, fecha_hasta);
  `);
}

module.exports = { initializeSchema };
