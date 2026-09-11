require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeSchema } = require('../src/database/schema');
const { getConnection, closeConnection } = require('../src/database/connection');

test.after(() => closeConnection());

function indexNames(db) {
  return db.prepare(`PRAGMA index_list(padron_entries)`).all().map((i) => i.name).sort();
}

test('la migración elimina los índices redundantes idx_cuit e idx_padron_type de una base vieja', () => {
  const db = getConnection();

  // Base creada por una versión anterior: tabla con los cuatro índices originales.
  db.exec(`
    CREATE TABLE padron_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      padron_type TEXT NOT NULL, regimen TEXT,
      fecha_publicacion TEXT NOT NULL, fecha_desde TEXT NOT NULL, fecha_hasta TEXT NOT NULL,
      cuit TEXT NOT NULL, tipo_contribuyente TEXT, marca_alta TEXT, marca_baja TEXT,
      alicuota_percepcion REAL NOT NULL DEFAULT 0, alicuota_retencion REAL NOT NULL DEFAULT 0,
      grupo_percepcion INTEGER, grupo_retencion INTEGER, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_cuit ON padron_entries (cuit);
    CREATE INDEX idx_cuit_type_dates ON padron_entries (cuit, padron_type, fecha_desde, fecha_hasta);
    CREATE INDEX idx_padron_type ON padron_entries (padron_type);
    CREATE INDEX idx_type_regimen_periodo ON padron_entries (padron_type, regimen, fecha_desde, fecha_hasta);
  `);
  assert.deepEqual(indexNames(db), ['idx_cuit', 'idx_cuit_type_dates', 'idx_padron_type', 'idx_type_regimen_periodo']);

  initializeSchema();

  assert.deepEqual(indexNames(db), ['idx_cuit_type_dates', 'idx_type_regimen_periodo']);
});

test('una base nueva se crea solo con los dos índices necesarios', () => {
  const db = getConnection();
  db.exec(`DROP TABLE IF EXISTS padron_entries; DROP TABLE IF EXISTS padron_metadata;`);

  initializeSchema();

  assert.deepEqual(indexNames(db), ['idx_cuit_type_dates', 'idx_type_regimen_periodo']);
});
