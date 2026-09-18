/**
 * Borra un período de un tipo y régimen en lotes de 50.000 filas, cada lote en
 * su propia transacción, como hace el worker de carga: el WAL no crece al
 * tamaño del período y las consultas por CUIT siguen respondiendo. No subir
 * ningún padrón mientras corre. Sin --si solo cuenta y no borra nada.
 *
 * Uso: node tests/borrar-periodo.js ARBA AMBOS 2026-09-01 2026-09-30 --si
 */
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../src/config');

const args = process.argv.slice(2);
const confirm = args.includes('--si');
const [tipo, regimen, desde, hasta] = args.filter((a) => a !== '--si');
if (!tipo || !regimen || !desde || !hasta) {
  console.error('Uso: node tests/borrar-periodo.js TIPO REGIMEN YYYY-MM-DD YYYY-MM-DD [--si]');
  process.exit(1);
}

const CHUNK = 50000;
const db = new Database(path.resolve(config.DB_PATH));
const where = 'padron_type = ? AND regimen = ? AND fecha_desde = ? AND fecha_hasta = ?';
const params = [tipo.toUpperCase(), regimen.toUpperCase(), desde, hasta];

const total = db.prepare(`SELECT COUNT(*) AS n FROM padron_entries WHERE ${where}`).get(...params).n;
console.log(`${total.toLocaleString()} filas de ${params.join(' ')}`);
if (!confirm) {
  console.log('Sin --si no se borra nada.');
  process.exit(0);
}
if (total === 0) process.exit(0);

const del = db.prepare(`
  DELETE FROM padron_entries
  WHERE rowid IN (SELECT rowid FROM padron_entries WHERE ${where} LIMIT ?)
`);
const chunk = db.transaction(() => del.run(...params, CHUNK).changes);

const started = Date.now();
let borradas = 0;
for (;;) {
  const n = chunk.immediate();
  borradas += n;
  console.log(`borradas ${borradas.toLocaleString()} / ${total.toLocaleString()}`);
  if (n < CHUNK) break;
}
db.pragma('wal_checkpoint(TRUNCATE)');
console.log(`Listo: ${borradas.toLocaleString()} filas en ${Math.round((Date.now() - started) / 1000)} s. Los totales del panel se actualizan en la próxima carga o con pm2 restart.`);
db.close();
