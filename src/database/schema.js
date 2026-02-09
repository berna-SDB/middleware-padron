const { getConnection } = require('./connection');
const logger = require('../logger');

function initializeSchema() {
  const db = getConnection();

  db.exec(`
    CREATE TABLE IF NOT EXISTS padron_entries (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      padron_type         TEXT    NOT NULL,
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

  logger.info('Database schema initialized');
}

module.exports = { initializeSchema };
