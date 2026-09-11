const path = require('path');
const { Worker } = require('worker_threads');
const { getStatements } = require('../database/queries');
const logger = require('../logger');

/**
 * Totales de registros por tipo, régimen y período, cacheados en memoria.
 *
 * Contarlos exige recorrer un índice entero, que en producción son millones
 * de filas y minutos de disco. Por eso nunca se calculan en el hilo que
 * atiende requests: los calcula el worker al terminar cada carga y un worker
 * dedicado al arrancar el servidor. Hasta que exista un cálculo, `getStats()`
 * devuelve null y las rutas informan que los totales están pendientes.
 */

let stats = null;
let refreshing = null;

function getStats() {
  return stats;
}

function setStats(value) {
  stats = value;
}

/** Arma la estructura de estadísticas a partir de las filas de `statsByPeriod`. */
function buildStats(rows) {
  const byPeriod = rows.map((r) => ({
    padronType: r.padron_type,
    regimen: r.regimen,
    fechaDesde: r.fecha_desde,
    fechaHasta: r.fecha_hasta,
    total: r.total,
  }));

  const totalsByType = new Map();
  for (const p of byPeriod) {
    totalsByType.set(p.padronType, (totalsByType.get(p.padronType) || 0) + p.total);
  }
  const byType = Array.from(totalsByType, ([padronType, total]) => ({ padronType, total }));

  return {
    computedAt: new Date().toISOString(),
    total: byType.reduce((sum, t) => sum + t.total, 0),
    byType,
    byPeriod,
  };
}

/**
 * Calcula las estadísticas con la conexión del hilo actual. Recorre el índice
 * entero: solo para el worker.
 */
function computeStats() {
  return buildStats(getStatements().statsByPeriod.all());
}

/**
 * Recalcula las estadísticas en un worker aparte y las deja en caché.
 * Si ya hay un recálculo en curso, devuelve esa misma promesa.
 */
function refreshStats() {
  if (refreshing) return refreshing;

  refreshing = new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'loadWorker.js'), { workerData: { task: 'stats' } });
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      refreshing = null;
      if (err) reject(err); else resolve(value);
    };

    worker.on('message', (msg) => {
      if (msg.type === 'stats') {
        setStats(msg.stats);
        logger.info({ total: msg.stats.total, tipos: msg.stats.byType.length }, 'Estadísticas de padrones recalculadas');
        finish(null, msg.stats);
      } else if (msg.type === 'error') {
        finish(new Error(msg.message));
      }
    });
    worker.on('error', (err) => finish(err));
    worker.on('exit', (code) => finish(new Error(`el worker de estadísticas terminó con código ${code} sin responder`)));
  });

  return refreshing;
}

module.exports = { getStats, setStats, buildStats, computeStats, refreshStats };
