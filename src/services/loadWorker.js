/**
 * Worker thread que ejecuta el trabajo pesado contra SQLite: cargar un padrón
 * (borrar lo anterior, parsear e insertar) o recalcular las estadísticas.
 *
 * Corre en un hilo aparte con su propia conexión, así el hilo principal sigue
 * atendiendo consultas mientras un DELETE o un INSERT masivo espera al disco.
 * Se comunica con el hilo principal por mensajes: deleting, progress, stats,
 * done y error.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { getConnection, closeConnection } = require('../database/connection');
const { getStatements } = require('../database/queries');
const { parsePadronFile } = require('./padronParser');
const { computeStats } = require('./padronStats');
const { tryAcquireLoadLock, assertLoadLockOwner, releaseLoadLock } = require('./loadLock');
const logger = require('../logger');

const BATCH_SIZE = 10000;
const DELETE_CHUNK = 50000;
const PROGRESS_EVERY = 100000;
const LOCK_POLL_MS = 2000;

const post = (msg) => parentPort.postMessage(msg);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repite un DELETE con LIMIT hasta que borre menos filas que el límite.
 * Cada lote es su propia transacción, corta y con WAL acotado, que empieza
 * comprobando que el candado sigue siendo de este job (y renovando su latido).
 */
function deleteInChunks(db, jobId, runChunk) {
  const chunk = db.transaction(() => {
    assertLoadLockOwner(db, jobId);
    return runChunk();
  });
  let total = 0;
  for (;;) {
    const { changes } = chunk.immediate();
    total += changes;
    if (changes > 0) post({ type: 'deleting', deleted: total });
    if (changes < DELETE_CHUNK) return total;
  }
}

/**
 * Toma el candado de carga o espera a que se libere. Mientras espera avisa
 * una vez al hilo principal ('waiting') para que el job figure en cola, y al
 * conseguirlo avisa 'started'.
 */
async function acquireLoadLockOrWait(db, { jobId, padronType }) {
  let waiting = false;
  for (;;) {
    const result = tryAcquireLoadLock(db, { jobId, padronType });
    if (result.acquired) {
      if (result.tookOverFrom) {
        const { job_id, host, pid, heartbeat_at } = result.tookOverFrom;
        logger.warn({ jobId, staleJobId: job_id, host, pid, heartbeatAt: heartbeat_at }, 'Candado de carga vencido: se toma');
      }
      if (waiting) post({ type: 'started' });
      return;
    }
    if (!waiting) {
      waiting = true;
      const holder = result.holder
        ? { jobId: result.holder.job_id, padronType: result.holder.padron_type, host: result.holder.host, pid: result.holder.pid }
        : null;
      post({ type: 'waiting', holder });
      logger.info({ jobId, holder, busy: result.busy }, 'Otra carga tiene el candado: se espera');
    }
    await sleep(LOCK_POLL_MS);
  }
}

async function runLoad(task) {
  const db = getConnection();
  const { jobId } = task;

  await acquireLoadLockOrWait(db, task);
  let outcome;
  try {
    outcome = await runLoadLocked(db, task);
  } finally {
    releaseLoadLock(db, jobId);
  }
  // Se avisa después de liberar: cuando el hilo principal recibe 'done', el
  // candado ya está disponible para la siguiente carga.
  post({ type: 'done', ...outcome });
}

/** Cuerpo de la carga. Solo se ejecuta con el candado tomado. */
async function runLoadLocked(db, { jobId, filePath, padronType, replace }) {
  const stmts = getStatements();

  if (replace) {
    const deleted = deleteInChunks(db, jobId, () => stmts.deleteByTypeChunk.run(padronType, DELETE_CHUNK));
    logger.info({ padronType, deleted, jobId }, 'Registros anteriores eliminados');
  }

  const insertBatch = db.transaction((batch) => {
    assertLoadLockOwner(db, jobId);
    for (const r of batch) {
      stmts.insertEntry.run(
        r.padronType, r.regimen, r.fechaPublicacion, r.fechaDesde, r.fechaHasta,
        r.cuit, r.tipoContribuyente, r.marcaAlta, r.marcaBaja,
        r.alicuotaPercepcion, r.alicuotaRetencion,
        r.grupoPercepcion, r.grupoRetencion
      );
    }
  });

  // Períodos ya limpiados en esta corrida. Cada uno se borra la primera vez
  // que aparece un registro suyo, antes de insertar ninguna de sus filas, y
  // una sola vez: si no, el segundo lote del mismo período borraría lo que
  // insertó el primero. La clave incluye el régimen para que un padrón de
  // percepción no elimine el de retención del mismo tipo y período.
  const purgedPeriods = new Set();

  function purgePeriodOnce(record) {
    if (replace) return; // ya se borró el tipo entero más arriba
    const key = `${record.regimen}|${record.fechaDesde}|${record.fechaHasta}`;
    if (purgedPeriods.has(key)) return;
    purgedPeriods.add(key);

    const deleted = deleteInChunks(db, jobId, () => stmts.deleteByTypeAndPeriodChunk.run(
      padronType, record.regimen, record.fechaDesde, record.fechaHasta, DELETE_CHUNK
    ));
    if (deleted > 0) {
      logger.info(
        { padronType, regimen: record.regimen, desde: record.fechaDesde, hasta: record.fechaHasta, deleted, jobId },
        'Período duplicado eliminado antes de insertar'
      );
    }
  }

  // Se inserta a medida que se parsea: en memoria solo vive un lote.
  let batch = [];
  let totalLoaded = 0;
  let nextProgressLog = PROGRESS_EVERY;

  function flush() {
    if (batch.length === 0) return;
    insertBatch.immediate(batch);
    totalLoaded += batch.length;
    batch = [];
    post({ type: 'progress', recordsLoaded: totalLoaded });

    if (totalLoaded >= nextProgressLog) {
      logger.info({ padronType, totalLoaded, jobId }, 'Progreso de carga');
      nextProgressLog += PROGRESS_EVERY;
    }
  }

  for await (const record of parsePadronFile(filePath, padronType)) {
    purgePeriodOnce(record);
    batch.push(record);
    if (batch.length >= BATCH_SIZE) flush();
  }
  flush();

  // Checkpoint del WAL para liberar espacio. Si hay lectores activos en el
  // hilo principal puede quedar parcial; el checkpoint automático lo completa.
  const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)');
  if (checkpoint && checkpoint.busy) {
    logger.warn({ jobId }, 'Checkpoint del WAL parcial: había lectores activos');
  }

  stmts.insertMetadata.run(padronType, path.basename(filePath), totalLoaded, 'completed');

  // Borrar archivo temporal para no duplicar espacio en disco
  try {
    fs.unlinkSync(filePath);
    logger.info({ filePath, jobId }, 'Archivo temporal eliminado');
  } catch (unlinkErr) {
    logger.warn({ filePath, jobId, err: unlinkErr.message }, 'No se pudo eliminar archivo temporal');
  }

  logger.info({ padronType, totalLoaded, jobId }, 'Carga de padrón completada');

  return { totalLoaded, stats: computeStats() };
}

async function main() {
  const { task } = workerData;
  if (task === 'stats') {
    post({ type: 'stats', stats: computeStats() });
  } else if (task === 'load') {
    await runLoad(workerData);
  } else {
    throw new Error(`Tarea de worker desconocida: ${task}`);
  }
}

main()
  .catch((err) => {
    logger.error({ err, task: workerData.task, jobId: workerData.jobId }, 'Error en worker de padrón');
    post({ type: 'error', message: err.message });
  })
  .finally(() => closeConnection());
