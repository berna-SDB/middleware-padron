/**
 * Test de consultas con datos reales del padrón ARBA.
 */
const http = require('http');
require('../src/database/schema').initializeSchema();
const createApp = require('../src/app');

const API_KEY = 'change-me-in-production';
const PORT = 3002;

function request(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: PORT, path: urlPath, method,
      headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const app = createApp();
  const server = app.listen(PORT);

  try {
    // 1. Health check - verificar total de registros
    console.log('\n--- Health Check ---');
    const health = await request('GET', '/api/v1/health');
    console.log(`Total registros: ${health.body.data.totalRecords.toLocaleString()}`);

    // 2. Consultar el primer CUIT del archivo
    console.log('\n--- Consulta CUIT 20000000028 ---');
    const q1 = await request('GET', '/api/v1/padron/20000000028?fecha=2025-09-15');
    console.log(`Status: ${q1.status}`);
    console.log(`Registros: ${q1.body.data.count}`);
    if (q1.body.data.records.length > 0) {
      const r = q1.body.data.records[0];
      console.log(`  Percepción: ${r.alicuotaPercepcion}% | Retención: ${r.alicuotaRetencion}%`);
      console.log(`  Tipo: ${r.tipoContribuyente} | Grupo Perc: ${r.grupoPercepcion} | Grupo Ret: ${r.grupoRetencion}`);
    }

    // 3. Batch query
    console.log('\n--- Batch Query (3 CUITs) ---');
    const batch = await request('POST', '/api/v1/padron/batch', {
      cuits: ['20000000028', '20000021742', '99999999999'],
      fecha: '2025-09-15',
    });
    console.log(`Encontrados: ${batch.body.data.totalFound} | No encontrados: ${batch.body.data.totalNotFound}`);

    // 4. Tiempo de respuesta
    console.log('\n--- Benchmark: 100 consultas individuales ---');
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      await request('GET', '/api/v1/padron/20000000028?fecha=2025-09-15');
    }
    const elapsed = Date.now() - start;
    console.log(`100 consultas en ${elapsed}ms (${(elapsed / 100).toFixed(1)}ms promedio)`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    server.closeAllConnections && server.closeAllConnections();
    server.close();
    require('../src/database/connection').closeConnection();
    process.exit(0);
  }
}

run();
