/**
 * Script de test integral para el middleware de padrones.
 * Levanta el servidor, carga un archivo de prueba y ejecuta consultas.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Inicializar DB
require('../src/database/schema').initializeSchema();
const createApp = require('../src/app');

const API_KEY = 'change-me-in-production';
const PORT = 3001;

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      method,
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function uploadFile(padronType, filePath) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="padronFile"; filename="${fileName}"\r\n`,
      `Content-Type: text/plain\r\n\r\n`,
      fileContent,
      `\r\n--${boundary}--\r\n`,
    ];

    const bodyBuffer = Buffer.concat(bodyParts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p)));

    const options = {
      hostname: 'localhost',
      port: PORT,
      path: `/api/v1/upload/${padronType}`,
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTests() {
  const app = createApp();
  const server = app.listen(PORT);

  let passed = 0;
  let failed = 0;

  function assert(name, condition, detail = '') {
    if (condition) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.log(`  FAIL: ${name} ${detail}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    console.log('\n--- Test: Health Check ---');
    const health = await request('GET', '/api/v1/health');
    assert('Status 200', health.status === 200);
    assert('success=true', health.body.success === true);
    assert('totalRecords=0 (vacío)', health.body.data.totalRecords === 0);

    // 2. Auth sin API key
    console.log('\n--- Test: Auth sin API key ---');
    const noAuth = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: 'localhost', port: PORT, path: '/api/v1/health', headers: {} }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });
    assert('Status 401 sin API key', noAuth.status === 401);

    // 3. Upload de archivo de prueba
    console.log('\n--- Test: Upload archivo ---');
    const fixtureFile = path.join(__dirname, 'fixtures', 'sample-padron.txt');
    const upload = await uploadFile('ARBA', fixtureFile);
    assert('Status 202', upload.status === 202);
    assert('jobId presente', !!upload.body.data.jobId);
    const jobId = upload.body.data.jobId;

    // Esperar a que termine la carga
    await wait(2000);

    // 4. Status del job
    console.log('\n--- Test: Status de carga ---');
    const jobStatus = await request('GET', `/api/v1/upload/status/${jobId}`);
    assert('Status 200', jobStatus.status === 200);
    assert('Job completed', jobStatus.body.data.status === 'completed');
    assert('7 registros cargados', jobStatus.body.data.recordsLoaded === 7, `Got: ${jobStatus.body.data.recordsLoaded}`);

    // 5. Consultar CUIT existente
    console.log('\n--- Test: Consulta por CUIT ---');
    const query1 = await request('GET', '/api/v1/padron/20000000028?fecha=2025-09-15');
    assert('Status 200', query1.status === 200);
    assert('Tiene registros', query1.body.data.count > 0, `Got: ${query1.body.data.count}`);
    assert('Alícuota percepción = 6', query1.body.data.records[0].alicuotaPercepcion === 6);
    assert('Alícuota retención = 5', query1.body.data.records[0].alicuotaRetencion === 5);

    // 6. Consultar CUIT con tipo
    console.log('\n--- Test: Consulta por CUIT + Tipo ---');
    const query2 = await request('GET', '/api/v1/padron/20000000028?tipo=ARBA&fecha=2025-09-15');
    assert('Status 200', query2.status === 200);
    assert('Tipo correcto', query2.body.data.records[0].padronType === 'ARBA');

    // 7. CUIT no encontrado
    console.log('\n--- Test: CUIT no encontrado ---');
    const query3 = await request('GET', '/api/v1/padron/99999999999');
    assert('Status 404', query3.status === 404);
    assert('CUIT_NOT_FOUND', query3.body.error.code === 'CUIT_NOT_FOUND');

    // 8. CUIT inválido
    console.log('\n--- Test: CUIT inválido ---');
    const query4 = await request('GET', '/api/v1/padron/123');
    assert('Status 400', query4.status === 400);
    assert('INVALID_CUIT', query4.body.error.code === 'INVALID_CUIT');

    // 9. Consulta por rango
    console.log('\n--- Test: Consulta por rango ---');
    const query5 = await request('GET', '/api/v1/padron/20000000028/rango?desde=2025-08-01&hasta=2025-10-31');
    assert('Status 200', query5.status === 200);
    assert('Múltiples registros en rango', query5.body.data.count >= 2, `Got: ${query5.body.data.count}`);

    // 10. Batch query
    console.log('\n--- Test: Batch query ---');
    const batchResult = await request('POST', '/api/v1/padron/batch', {
      cuits: ['20000000028', '30500001234', '99999999999'],
      fecha: '2025-09-15',
    });
    assert('Status 200', batchResult.status === 200);
    assert('2 encontrados', batchResult.body.data.totalFound === 2);
    assert('1 no encontrado', batchResult.body.data.totalNotFound === 1);
    assert('CUIT existente found=true', batchResult.body.data.results['20000000028'].found === true);
    assert('CUIT inexistente found=false', batchResult.body.data.results['99999999999'].found === false);

    // 11. Health check con datos
    console.log('\n--- Test: Health check con datos ---');
    const health2 = await request('GET', '/api/v1/health');
    assert('totalRecords = 7', health2.body.data.totalRecords === 7, `Got: ${health2.body.data.totalRecords}`);

    // Resumen
    console.log(`\n========================================`);
    console.log(`  Resultados: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);
  } catch (err) {
    console.error('Error en tests:', err);
  } finally {
    server.closeAllConnections && server.closeAllConnections();
    server.close();
    // Limpiar DB de test
    require('../src/database/connection').closeConnection();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
