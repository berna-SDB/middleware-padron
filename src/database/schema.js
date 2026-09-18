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

    -- Consultas por CUIT (con o sin tipo y fechas): el prefijo (cuit) cubre
    -- también las búsquedas que solo filtran por CUIT.
    CREATE INDEX IF NOT EXISTS idx_cuit_type_dates
      ON padron_entries (cuit, padron_type, fecha_desde, fecha_hasta);

    CREATE TABLE IF NOT EXISTS padron_metadata (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      padron_type     TEXT    NOT NULL,
      filename        TEXT    NOT NULL,
      records_loaded  INTEGER NOT NULL DEFAULT 0,
      loaded_at       TEXT    DEFAULT (datetime('now')),
      status          TEXT    NOT NULL DEFAULT 'completed'
    );

    -- Candado de carga (ver src/services/loadLock.js). Una sola fila posible:
    -- quien logra insertarla es el único que puede borrar e insertar en
    -- padron_entries. Vive en la base, no en memoria, para que valga entre
    -- procesos (varias instancias de PM2) y no solo dentro de uno.
    CREATE TABLE IF NOT EXISTS load_lock (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      job_id        TEXT    NOT NULL,
      padron_type   TEXT    NOT NULL,
      host          TEXT    NOT NULL,
      pid           INTEGER NOT NULL,
      acquired_at   INTEGER NOT NULL,
      heartbeat_at  INTEGER NOT NULL
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

  // Borrados y estadísticas por tipo, régimen y período. Su prefijo
  // (padron_type) cubre también los borrados de un tipo entero.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_type_regimen_periodo
      ON padron_entries (padron_type, regimen, fecha_desde, fecha_hasta);
  `);

  // Índices de versiones anteriores que son prefijo de otro índice y por lo
  // tanto redundantes: idx_cuit ⊂ idx_cuit_type_dates, idx_padron_type ⊂
  // idx_type_regimen_periodo. Cada uno costaba una escritura extra por fila
  // insertada o borrada y cerca de un cuarto del tamaño de la base.
  const indexes = db.prepare(`PRAGMA index_list(padron_entries)`).all().map(i => i.name);
  for (const redundant of ['idx_cuit', 'idx_padron_type']) {
    if (indexes.includes(redundant)) {
      const started = Date.now();
      db.exec(`DROP INDEX ${redundant}`);
      logger.info({ index: redundant, ms: Date.now() - started }, 'Migración: índice redundante eliminado');
    }
  }
}

module.exports = { initializeSchema };
