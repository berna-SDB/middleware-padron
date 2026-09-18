const { tmpRoot } = require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { initializeSchema } = require('../src/database/schema');
const { getConnection, closeConnection } = require('../src/database/connection');
const createApp = require('../src/app');

const FIXTURE_UNIFICADO = path.join(__dirname, 'fixtures', 'sample-padron.txt');
const FIXTURE_PERCEPCION = path.join(__dirname, 'fixtures', 'sample-percepcion.txt');
const FIXTURE_AGIP = path.join(__dirname, 'fixtures', 'sample-agip.txt');
const UPLOAD_DIR = process.env.UPLOAD_DIR;

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

async function upload(padronType, fixturePath, query = '') {
  const form = new FormData();
  form.append('padronFile', new Blob([fs.readFileSync(fixturePath)]), path.basename(fixturePath));
  const res = await fetch(`${baseUrl}/upload/${padronType}${query}`, {
    method: 'POST',
    headers: { 'x-api-key': 'test-key' },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

async function reload(padronType, filePath, query = '') {
  const res = await fetch(`${baseUrl}/upload/reload/${padronType}${query}`, {
    method: 'POST',
    headers: { 'x-api-key': 'test-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  return { status: res.status, body: await res.json() };
}

async function waitForJob(jobId) {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${baseUrl}/upload/status/${jobId}`, { headers: { 'x-api-key': 'test-key' } });
    const { data } = await res.json();
    if (data.status === 'completed') return data;
    if (data.status === 'error') throw new Error(`job ${jobId} falló: ${data.error}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`job ${jobId} no terminó a tiempo`);
}

function countRows(padronType) {
  return getConnection()
    .prepare('SELECT COUNT(*) AS n FROM padron_entries WHERE padron_type = ?')
    .get(padronType).n;
}

function uploadedFiles() {
  return fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : [];
}

test('subir el padrón de percepción (prefijo P) como AGIP se rechaza con LAYOUT_MISMATCH y no deja archivo en disco', async () => {
  const before = uploadedFiles();
  const { status, body } = await upload('AGIP', FIXTURE_PERCEPCION);

  assert.equal(status, 400);
  assert.equal(body.error.code, 'LAYOUT_MISMATCH');
  assert.match(body.error.message, /PERCEPCION/);
  assert.match(body.error.message, /UNIFICADO/);
  assert.deepEqual(uploadedFiles(), before, 'el archivo rechazado debe borrarse del UPLOAD_DIR');
});

test('subir el padrón de percepción (prefijo P) como ARBA se acepta y carga: ARBA se carga con sus P/R', async () => {
  const { status, body } = await upload('ARBA', FIXTURE_PERCEPCION);
  assert.equal(status, 202);
  const job = await waitForJob(body.data.jobId);
  assert.equal(job.recordsLoaded, 3);
});

test('subir el padrón UNIFICADO como ARBA se rechaza con LAYOUT_MISMATCH: es el layout de AGIP', async () => {
  const { status, body } = await upload('ARBA', FIXTURE_UNIFICADO);
  assert.equal(status, 400);
  assert.equal(body.error.code, 'LAYOUT_MISMATCH');
  assert.match(body.error.message, /PERCEPCION, RETENCION/);
});

test('subir el padrón de AGIP (layout UNIFICADO con denominación) como AGIP se acepta y carga', async () => {
  const { status, body } = await upload('AGIP', FIXTURE_AGIP);
  assert.equal(status, 202);
  const job = await waitForJob(body.data.jobId);
  assert.equal(job.recordsLoaded, 3);
});

test('un tipo sin política acepta cualquier layout', async () => {
  const { status, body } = await upload('IIBB_SANTA_FE', FIXTURE_UNIFICADO);
  assert.equal(status, 202);
  await waitForJob(body.data.jobId);
});

test('reload con layout equivocado y replace=true se rechaza antes de borrar los datos existentes', async () => {
  const antes = countRows('AGIP');
  assert.ok(antes > 0, 'precondición: AGIP ya tiene datos cargados');

  const { status, body } = await reload('AGIP', FIXTURE_PERCEPCION, '?replace=true');

  assert.equal(status, 400);
  assert.equal(body.error.code, 'LAYOUT_MISMATCH');
  assert.equal(countRows('AGIP'), antes, 'el reload rechazado no debe tocar la base');
});

test('reload con un archivo sin formato reconocible se rechaza con INVALID_FILE', async () => {
  const garbage = path.join(tmpRoot, 'basura.txt');
  fs.writeFileSync(garbage, 'esto;no;es;un;padron\notra;linea;cualquiera\n');

  const antes = countRows('AGIP');
  const { status, body } = await reload('AGIP', garbage, '?replace=true');

  assert.equal(status, 400);
  assert.equal(body.error.code, 'INVALID_FILE');
  assert.equal(countRows('AGIP'), antes);
});
