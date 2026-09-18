require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { initializeSchema } = require('../src/database/schema');
const { getConnection, closeConnection } = require('../src/database/connection');
const createApp = require('../src/app');

const FIXTURE_AGIP = path.join(__dirname, 'fixtures', 'sample-agip.txt');
const HEADERS = { 'x-api-key': 'test-key' };

let server;
let baseUrl;

test.before(async () => {
  initializeSchema();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeConnection();
});

async function getJson(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`, { headers: HEADERS });
  return { status: res.status, body: await res.json() };
}

async function uploadAndWait(padronType, fixturePath) {
  const form = new FormData();
  form.append('padronFile', new Blob([fs.readFileSync(fixturePath)]), path.basename(fixturePath));
  const res = await fetch(`${baseUrl}/upload/${padronType}`, { method: 'POST', headers: HEADERS, body: form });
  const { data } = await res.json();
  for (let i = 0; i < 200; i++) {
    const { body } = await getJson(`/upload/status/${data.jobId}`);
    if (body.data.status === 'completed') return body.data;
    if (body.data.status === 'error') throw new Error(body.data.error);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('la carga no terminó');
}

test('health sin estadísticas calculadas responde igual, con los totales pendientes', async () => {
  const { status, body } = await getJson('/health');
  assert.equal(status, 200);
  assert.equal(body.data.status, 'healthy');
  assert.equal(body.data.totalRecords, null);
  assert.equal(body.data.stats.status, 'pendiente');
});

test('tras una carga, health y padron-info devuelven los totales desde la caché de estadísticas', async () => {
  await uploadAndWait('AGIP', FIXTURE_AGIP);
  const esperado = getConnection().prepare(`SELECT COUNT(*) AS n FROM padron_entries`).get().n;
  assert.ok(esperado > 0);

  const health = await getJson('/health');
  assert.equal(health.body.data.totalRecords, esperado);
  assert.equal(health.body.data.stats.status, 'ok');
  assert.ok(typeof health.body.data.stats.computedAt === 'string');
  assert.deepEqual(health.body.data.padronesLoaded, [{ tipo: 'AGIP', registros: esperado }]);

  const info = await getJson('/padron-info');
  assert.equal(info.body.data.padrones[0].padronType, 'AGIP');
  assert.equal(info.body.data.padrones[0].totalRegistros, esperado);
});
