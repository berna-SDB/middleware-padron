const { tmpRoot } = require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { initializeSchema } = require('../src/database/schema');
const { getConnection, closeConnection } = require('../src/database/connection');
const { loadPadronFile, getJob } = require('../src/services/padronLoader');
const { getStats } = require('../src/services/padronStats');

const FIXTURE_PERCEPCION = path.join(__dirname, 'fixtures', 'sample-percepcion.txt');
const BIG_ROWS = 150000;

test.before(() => {
  initializeSchema();
});

test.after(() => {
  closeConnection();
});

/** Padrón UNIFICADO sintético de `rows` CUITs distintos, todos del mismo período. */
function writeBigUnificado(name, rows) {
  const file = path.join(tmpRoot, name);
  const lines = [];
  for (let i = 0; i < rows; i++) {
    lines.push(`27082025;01092025;30092025;${20000000000 + i};D;N;N;6,00;5,00;25;24;`);
  }
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'latin1');
  return file;
}

function writeRetencion(name) {
  const file = path.join(tmpRoot, name);
  fs.writeFileSync(file, [
    'R;22062026;01072026;31072026;20000000028;L;X;N;03,00;5',
    'R;22062026;01072026;31072026;30500001234;C;N;N;02,50;3',
    'R;22062026;01072026;31072026;27123456789;I;N;N;01,00;1',
    '',
  ].join('\n'), 'latin1');
  return file;
}

function copyFixture(src, name) {
  const dst = path.join(tmpRoot, name);
  fs.copyFileSync(src, dst);
  return dst;
}

async function waitForJob(jobId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getJob(jobId);
    if (job.status === 'completed') return job;
    if (job.status === 'error') throw new Error(`job ${jobId} falló: ${job.error}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job ${jobId} no terminó en ${timeoutMs} ms`);
}

/** Mayor retraso del event loop (ms) observado hasta que la promesa termina. */
async function maxEventLoopLagDuring(promise) {
  const TICK = 5;
  let max = 0;
  let last = Date.now();
  const interval = setInterval(() => {
    const now = Date.now();
    max = Math.max(max, now - last - TICK);
    last = now;
  }, TICK);
  try {
    await promise;
  } finally {
    clearInterval(interval);
  }
  return max;
}

function count(where = '', params = []) {
  return getConnection().prepare(`SELECT COUNT(*) AS n FROM padron_entries ${where}`).get(...params).n;
}

test('recargar un período existente de 150 mil filas no bloquea el event loop del proceso', async () => {
  const first = writeBigUnificado('arba-grande-1.txt', BIG_ROWS);
  await waitForJob(loadPadronFile(first, 'ARBA', { replace: false }));
  assert.equal(count(`WHERE padron_type = 'ARBA'`), BIG_ROWS);

  // Segunda carga del mismo período: borra las 150 mil filas anteriores y las vuelve a insertar.
  const second = writeBigUnificado('arba-grande-2.txt', BIG_ROWS);
  const jobId = loadPadronFile(second, 'ARBA', { replace: false });
  const lag = await maxEventLoopLagDuring(waitForJob(jobId));

  assert.ok(lag < 200, `el event loop estuvo bloqueado ${lag} ms durante la recarga`);
  assert.equal(count(`WHERE padron_type = 'ARBA'`), BIG_ROWS, 'sin duplicados ni filas perdidas tras la recarga');
});

test('dos cargas simultáneas se ejecutan de a una: la segunda espera en cola', async () => {
  const big = writeBigUnificado('arba-grande-3.txt', BIG_ROWS);
  const small = copyFixture(FIXTURE_PERCEPCION, 'agip-cola.txt');

  const firstJob = loadPadronFile(big, 'ARBA', { replace: true });
  const secondJob = loadPadronFile(small, 'AGIP', { replace: true });

  assert.equal(getJob(secondJob).status, 'queued');

  await waitForJob(firstJob);
  await waitForJob(secondJob);

  assert.equal(count(`WHERE padron_type = 'ARBA'`), BIG_ROWS);
  assert.equal(count(`WHERE padron_type = 'AGIP'`), 3);
});

test('recargar percepción de un período no toca la retención del mismo tipo y período', async () => {
  await waitForJob(loadPadronFile(copyFixture(FIXTURE_PERCEPCION, 'agip-p1.txt'), 'AGIP', { replace: true }));
  await waitForJob(loadPadronFile(writeRetencion('agip-r1.txt'), 'AGIP', { replace: false }));
  assert.equal(count(`WHERE padron_type = 'AGIP'`), 6);

  await waitForJob(loadPadronFile(copyFixture(FIXTURE_PERCEPCION, 'agip-p2.txt'), 'AGIP', { replace: false }));

  assert.equal(count(`WHERE padron_type = 'AGIP' AND regimen = 'P'`), 3);
  assert.equal(count(`WHERE padron_type = 'AGIP' AND regimen = 'R'`), 3);
});

test('al terminar una carga las estadísticas en caché reflejan los totales por tipo y período', async () => {
  await waitForJob(loadPadronFile(copyFixture(FIXTURE_PERCEPCION, 'agip-stats.txt'), 'AGIP', { replace: true }));

  const stats = getStats();
  assert.ok(stats, 'debe haber estadísticas calculadas tras una carga');
  assert.ok(typeof stats.computedAt === 'string');
  assert.equal(stats.total, count());

  const agip = stats.byType.find((t) => t.padronType === 'AGIP');
  assert.equal(agip.total, 3);

  const periodo = stats.byPeriod.find((p) => p.padronType === 'AGIP' && p.regimen === 'P');
  assert.deepEqual(
    { desde: periodo.fechaDesde, hasta: periodo.fechaHasta, total: periodo.total },
    { desde: '2026-07-01', hasta: '2026-07-31', total: 3 }
  );
});

test('el archivo cargado se borra del disco al terminar', async () => {
  const file = copyFixture(FIXTURE_PERCEPCION, 'agip-borrar.txt');
  await waitForJob(loadPadronFile(file, 'AGIP', { replace: true }));
  assert.equal(fs.existsSync(file), false);
});
