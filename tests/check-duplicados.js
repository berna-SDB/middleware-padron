/**
 * Diagnóstico de duplicados (solo lectura). Para un tipo y período lista las
 * últimas cargas registradas y cuenta, por régimen, cuántas filas hay de más
 * respecto de los CUITs distintos. Usa DB_PATH del .env, como el servidor.
 *
 * Uso: node tests/check-duplicados.js AGIP 2026-09-01 2026-09-30
 *
 * Lee el período entero por el índice (tipo, régimen, desde, hasta): con
 * millones de filas y disco lento puede tardar unos minutos. Conviene correrlo
 * sin cargas en curso; no bloquea las consultas.
 */
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../src/config');

const [padronType, desde, hasta] = process.argv.slice(2);
if (!padronType || !desde || !hasta) {
  console.error('Uso: node tests/check-duplicados.js TIPO YYYY-MM-DD YYYY-MM-DD');
  process.exit(1);
}

const db = new Database(path.resolve(config.DB_PATH), { readonly: true });
const tipo = padronType.toUpperCase();

console.log('Últimas cargas registradas (padron_metadata):');
console.table(db.prepare(`
  SELECT id, padron_type, filename, records_loaded, loaded_at, status
  FROM padron_metadata ORDER BY id DESC LIMIT 15
`).all());

console.log(`Filas de ${tipo} en el período ${desde}..${hasta}, por régimen:`);
const resumen = [];
for (const regimen of ['AMBOS', 'P', 'R']) {
  const started = Date.now();
  const r = db.prepare(`
    SELECT COUNT(*) AS filas, COUNT(DISTINCT cuit) AS cuits_distintos
    FROM padron_entries
    WHERE padron_type = ? AND regimen = ? AND fecha_desde = ? AND fecha_hasta = ?
  `).get(tipo, regimen, desde, hasta);
  if (r.filas === 0) continue;
  resumen.push({ regimen, filas: r.filas, cuits_distintos: r.cuits_distintos, filas_de_mas: r.filas - r.cuits_distintos, segundos: Math.round((Date.now() - started) / 1000) });

  if (r.filas > r.cuits_distintos) {
    const ejemplos = db.prepare(`
      SELECT cuit, COUNT(*) AS veces, MIN(id) AS primer_id, MAX(id) AS ultimo_id
      FROM padron_entries
      WHERE padron_type = ? AND regimen = ? AND fecha_desde = ? AND fecha_hasta = ?
      GROUP BY cuit HAVING veces > 1 LIMIT 5
    `).all(tipo, regimen, desde, hasta);
    console.log(`Ejemplos de CUITs repetidos (régimen ${regimen}):`);
    console.table(ejemplos);
  }
}
console.table(resumen.length ? resumen : [{ regimen: '-', filas: 0, cuits_distintos: 0, filas_de_mas: 0 }]);
db.close();
