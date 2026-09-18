const { tmpRoot } = require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const os = require('os');
const { spawnSync } = require('child_process');

const { initializeSchema } = require('../src/database/schema');
const { getConnection, closeConnection } = require('../src/database/connection');
const { loadPadronFile, getJob } = require('../src/services/padronLoader');
const { getLoadLock, LOCK_STALE_MS } = require('../src/services/loadLock');

const WORKER = path.join(__dirname, '..', 'src', 'services', 'loadWorker.js');
const ROWS = 80000;

test.before(() => {
  initializeSchema();
});

test.after(() => {
  closeConnection();
});

/** Padrón UNIFICADO sintético de `rows` CUITs distintos, todos del mismo período. */
function writeUnificado(name, rows) {
  const file = path.join(tmpRoot, name);
  const lines = [];
  for (let i = 0; i < rows; i++) {
    lines.push(`26082026;01092026;30092026;${30000000000 + i};D;S;N;1,00;1,00;00;00;EMPRESA ${i}`);
  }
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'latin1');
  return file;
}

/**
 * Corre una carga en un worker thread propio, como lo haría otro proceso de
 * PM2: conexión SQLite aparte y sin pasar por la cola en memoria del loader.
 */
function runLoadInWorker(jobId, filePath, { onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { task: 'load', jobId, filePath, padronType: 'AGIP', replace: false },
    });
    const result = { loaded: 0, deleted: 0, waited: false };
    worker.on('message', (msg) => {
      if (msg.type === 'deleting') result.deleted = msg.deleted;
      if (msg.type === 'progress') onProgress(msg.recordsLoaded);
      if (msg.type === 'waiting') result.waited = true;
      if (msg.type === 'done') { result.loaded = msg.totalLoaded; resolve(result); }
      if (msg.type === 'error') reject(new Error(msg.message));
    });
    worker.on('error', reject);
  });
}

function count(where = '', params = []) {
  return getConnection().prepare(`SELECT COUNT(*) AS n FROM padron_entries ${where}`).get(...params).n;
}

function duplicatedCuits() {
  return getConnection().prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT cuit FROM padron_entries WHERE padron_type = 'AGIP'
      GROUP BY cuit, regimen, fecha_desde, fecha_hasta HAVING COUNT(*) > 1
    )
  `).get().n;
}

test('dos procesos que cargan el mismo período a la vez no duplican filas: el segundo espera al primero', async () => {
  const first = writeUnificado('agip-proceso-1.txt', ROWS);
  const second = writeUnificado('agip-proceso-2.txt', ROWS);

  // El segundo proceso arranca con el primero a mitad de camino: es el caso
  // de volver a subir el archivo mientras la carga anterior sigue corriendo.
  let secondLoad = null;
  const firstLoad = runLoadInWorker('proceso-1', first, {
    onProgress: (n) => {
      if (!secondLoad && n >= 20000) secondLoad = runLoadInWorker('proceso-2', second);
    },
  });

  const r1 = await firstLoad;
  assert.ok(secondLoad, 'la segunda carga debió arrancar durante la primera');
  const r2 = await secondLoad;

  assert.equal(r1.loaded, ROWS);
  assert.equal(r2.loaded, ROWS);
  assert.equal(r2.waited, true, 'el segundo proceso debió esperar el candado del primero');
  assert.equal(count(`WHERE padron_type = 'AGIP'`), ROWS, 'la base debe quedar con exactamente las filas del archivo');
  assert.equal(duplicatedCuits(), 0, 'ningún CUIT puede quedar dos veces para el mismo período');
  assert.equal(getLoadLock(getConnection()), null, 'al terminar no debe quedar candado');
});

/** Deja en la base un candado ajeno con los datos indicados. */
function plantLock({ jobId = 'otro-proceso', host = os.hostname(), pid = process.pid, heartbeatAt = Date.now() } = {}) {
  const db = getConnection();
  db.prepare(`DELETE FROM load_lock`).run();
  db.prepare(`
    INSERT INTO load_lock (id, job_id, padron_type, host, pid, acquired_at, heartbeat_at)
    VALUES (1, ?, 'ARBA', ?, ?, ?, ?)
  `).run(jobId, host, pid, heartbeatAt, heartbeatAt);
}

/** PID de un proceso que ya terminó. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

async function waitForJob(jobId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getJob(jobId);
    if (job.status === 'completed') return job;
    if (job.status === 'error') throw new Error(`job ${jobId} falló: ${job.error}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job ${jobId} no terminó en ${timeoutMs} ms`);
}

async function waitUntil(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condición no alcanzada a tiempo');
}

test('una carga que falla libera el candado', async () => {
  await assert.rejects(
    runLoadInWorker('falla', path.join(tmpRoot, 'no-existe.txt')),
    /no-existe/
  );
  assert.equal(getLoadLock(getConnection()), null);
});

test('un candado huérfano de un proceso muerto en este host se toma y la carga sigue', async () => {
  plantLock({ jobId: 'proceso-muerto', pid: deadPid() });

  const result = await runLoadInWorker('tras-muerto', writeUnificado('agip-tras-muerto.txt', 100));

  assert.equal(result.waited, false, 'no debe esperar a un proceso que ya no existe');
  assert.equal(result.loaded, 100);
  assert.equal(getLoadLock(getConnection()), null);
});

test('un candado de otro host que dejó de latir se considera vencido y se toma', async () => {
  plantLock({ jobId: 'proceso-remoto', host: 'otro-host', pid: 1, heartbeatAt: Date.now() - LOCK_STALE_MS - 1000 });

  const result = await runLoadInWorker('tras-remoto', writeUnificado('agip-tras-remoto.txt', 100));

  assert.equal(result.waited, false);
  assert.equal(result.loaded, 100);
  assert.equal(getLoadLock(getConnection()), null);
});

test('mientras otro proceso vivo tiene el candado el job figura en cola y arranca cuando se libera', async () => {
  // Candado de un proceso vivo (este mismo) con latido reciente: no está vencido.
  plantLock({ jobId: 'otro-proceso' });

  // Tipo que ningún otro test carga, para poder afirmar que la base no se toca.
  const jobId = loadPadronFile(writeUnificado('caba-en-cola.txt', 100), 'IIBB_CABA', { replace: false });

  try {
    await waitUntil(() => getJob(jobId).status === 'queued' && getJob(jobId).waitingFor);
    assert.equal(getJob(jobId).waitingFor.jobId, 'otro-proceso');
    assert.equal(count(`WHERE padron_type = 'IIBB_CABA'`), 0, 'no debe tocar la base mientras espera');
  } finally {
    // Liberar siempre: si no, el worker espera para siempre y el proceso no termina.
    getConnection().prepare(`DELETE FROM load_lock`).run();
  }

  const job = await waitForJob(jobId);
  assert.equal(job.status, 'completed');
  assert.equal(job.waitingFor, null);
  assert.equal(job.recordsLoaded, 100);
  assert.equal(count(`WHERE padron_type = 'IIBB_CABA'`), 100);
  assert.equal(getLoadLock(getConnection()), null);
});

test('esperar el candado no falla aunque su dueño tenga abierta una transacción de escritura larga', async () => {
  plantLock({ jobId: 'dueno-lento' });
  const db = getConnection();

  const jobId = loadPadronFile(writeUnificado('caba-lento.txt', 100), 'IIBB_CABA', { replace: false });

  try {
    await waitUntil(() => getJob(jobId).status === 'queued' && getJob(jobId).waitingFor);

    // El dueño escribe durante más que el sondeo del candado (2 s) más el busy
    // timeout de better-sqlite3 (5 s): un DELETE por lotes o un checkpoint en
    // el disco lento de producción.
    db.exec('BEGIN IMMEDIATE');
    await new Promise((r) => setTimeout(r, 9000));
    db.exec('COMMIT');

    assert.equal(getJob(jobId).status, 'queued', 'el job debe seguir esperando, no fallar con SQLITE_BUSY');
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.prepare(`DELETE FROM load_lock`).run();
  }

  const job = await waitForJob(jobId);
  assert.equal(job.status, 'completed');
  assert.equal(job.recordsLoaded, 100);
});

test('una carga que pierde el candado se detiene sin escribir una fila más', async () => {
  const db = getConnection();
  db.prepare(`DELETE FROM load_lock`).run();

  // Otro proceso da el candado por vencido y lo toma con la carga a mitad de camino.
  const steal = db.transaction(() => {
    db.prepare(`DELETE FROM load_lock`).run();
    db.prepare(`
      INSERT INTO load_lock (id, job_id, padron_type, host, pid, acquired_at, heartbeat_at)
      VALUES (1, 'ladron', 'AGIP', ?, ?, ?, ?)
    `).run(os.hostname(), process.pid, Date.now(), Date.now());
  });
  let stolen = false;
  const load = runLoadInWorker('victima', writeUnificado('agip-victima.txt', ROWS), {
    onProgress: (n) => {
      if (!stolen && n >= 20000) { stolen = true; steal.immediate(); }
    },
  });

  await assert.rejects(load, /candado/);
  assert.equal(stolen, true);

  const rowsAtFailure = count(`WHERE padron_type = 'AGIP'`);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(count(`WHERE padron_type = 'AGIP'`), rowsAtFailure, 'no debe seguir insertando tras perder el candado');
  assert.ok(rowsAtFailure < ROWS, `debió detenerse antes de terminar (insertó ${rowsAtFailure})`);
  assert.equal(getLoadLock(db).job_id, 'ladron', 'no debe borrar el candado ajeno al salir');

  db.prepare(`DELETE FROM load_lock`).run();
});
