const { Router } = require('express');
const { getStatements } = require('../database/queries');
const { getAllJobs } = require('../services/padronLoader');
const { getStats } = require('../services/padronStats');
const { acceptedLayouts } = require('../services/layoutPolicy');
const { formatLocal } = require('../utils/dateUtils');
const config = require('../config');

const router = Router();

router.get('/', (req, res) => {
  // Los totales salen de la caché que mantiene el worker de carga: contar la
  // tabla en cada pedido bloqueaba el servidor con millones de filas.
  const stats = getStats();
  const countByType = stats ? stats.byType : [];
  const periods = stats ? stats.byPeriod : [];
  const metadata = getStatements().getMetadata.all().slice(0, 10);
  const jobs = getAllJobs().reverse().slice(0, 5);
  const memUsage = process.memoryUsage();
  const pendiente = '<span title="Se calcula en segundo plano al arrancar y al terminar cada carga">calculando…</span>';

  const padronTypes = config.ALLOWED_PADRON_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');

  // Qué archivo acepta cada tipo (ver src/services/layoutPolicy.js): se muestra
  // como tarjeta y, al subir, debajo del selector, para no cargar el archivo de
  // una jurisdicción bajo el tipo de otra.
  const formatos = acceptedLayouts();
  const formatoRows = formatos.map((f) => (f.layouts
    ? f.layouts.map((l, i) => `
    <tr>
      ${i === 0 ? `<td rowspan="${f.layouts.length}"><strong>${f.padronType}</strong></td>` : ''}
      <td><code>${l.name}</code></td><td>${l.organismo}</td><td>${l.archivo || '-'}</td><td>${l.descripcion}</td>
    </tr>`).join('')
    : `
    <tr><td><strong>${f.padronType}</strong></td><td colspan="4" class="hint">Sin politica: acepta cualquier layout</td></tr>`
  )).join('');

  const countRows = countByType.map(r => `
    <tr><td>${r.padronType}</td><td>${r.total.toLocaleString()}</td></tr>
  `).join('');

  const periodRows = periods.map(p => `
    <tr><td>${p.padronType}</td><td>${p.regimen}</td><td>${p.fechaDesde}</td><td>${p.fechaHasta}</td><td>${p.total.toLocaleString()}</td></tr>
  `).join('');

  const metaRows = metadata.map(m => `
    <tr>
      <td>${m.padron_type}</td>
      <td>${m.filename}</td>
      <td>${m.records_loaded.toLocaleString()}</td>
      <td title="${m.loaded_at} UTC">${formatLocal(m.loaded_at)}</td>
      <td><span class="badge ${m.status === 'completed' ? 'ok' : 'err'}">${m.status}</span></td>
    </tr>
  `).join('');

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Middleware Padron - Panel</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #2c3e50; margin-bottom: 5px; }
    .subtitle { color: #7f8c8d; margin-bottom: 30px; }
    .card { background: white; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h2 { color: #2c3e50; margin-bottom: 16px; font-size: 18px; }
    .stats { display: flex; gap: 20px; flex-wrap: wrap; }
    .stat { background: #f8f9fa; border-radius: 8px; padding: 16px 24px; text-align: center; flex: 1; min-width: 120px; }
    .stat .number { font-size: 28px; font-weight: bold; color: #2c3e50; }
    .stat .label { font-size: 13px; color: #7f8c8d; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; font-size: 13px; color: #7f8c8d; text-transform: uppercase; }
    td { font-size: 14px; }
    .badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge.ok { background: #d4edda; color: #155724; }
    .badge.err { background: #f8d7da; color: #721c24; }
    .badge.loading { background: #fff3cd; color: #856404; }
    .upload-area { border: 2px dashed #ccc; border-radius: 8px; padding: 40px; text-align: center; cursor: pointer; transition: all 0.3s; }
    .upload-area:hover, .upload-area.dragover { border-color: #3498db; background: #ebf5fb; }
    .upload-area p { color: #7f8c8d; margin-top: 8px; }
    .upload-area .icon { font-size: 48px; }
    select, button { padding: 10px 20px; border-radius: 6px; border: 1px solid #ddd; font-size: 14px; }
    select { background: white; margin-right: 10px; }
    button { background: #3498db; color: white; border: none; cursor: pointer; font-weight: 600; }
    button:hover { background: #2980b9; }
    button:disabled { background: #bdc3c7; cursor: not-allowed; }
    .form-row { display: flex; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .progress { display: none; margin-top: 16px; }
    .progress-bar { height: 8px; background: #ecf0f1; border-radius: 4px; overflow: hidden; }
    .progress-bar .fill { height: 100%; background: #3498db; transition: width 0.5s; border-radius: 4px; }
    .progress-text { font-size: 14px; color: #7f8c8d; margin-top: 8px; }
    .search-box { display: flex; gap: 10px; }
    .search-box input { flex: 1; padding: 10px 16px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
    .result { margin-top: 16px; padding: 16px; background: #f8f9fa; border-radius: 6px; font-family: monospace; font-size: 13px; white-space: pre-wrap; display: none; }
    input[type="file"] { display: none; }
    .hint { font-size: 12px; color: #95a5a6; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Middleware Padron</h1>
    <p class="subtitle">Panel de administracion</p>

    <div class="card">
      <h2>Estado</h2>
      <div class="stats">
        <div class="stat">
          <div class="number">${stats ? stats.total.toLocaleString() : pendiente}</div>
          <div class="label">Registros totales${stats ? '' : ' (pendiente)'}</div>
        </div>
        <div class="stat">
          <div class="number">${stats ? countByType.length : pendiente}</div>
          <div class="label">Tipos de padron</div>
        </div>
        <div class="stat">
          <div class="number">${Math.round(memUsage.rss / 1024 / 1024)} MB</div>
          <div class="label">Memoria</div>
        </div>
        <div class="stat">
          <div class="number">${Math.floor(process.uptime() / 3600)}h</div>
          <div class="label">Uptime</div>
        </div>
      </div>
      ${countByType.length > 0 ? `
      <table style="margin-top:16px">
        <tr><th>Tipo</th><th>Registros</th></tr>
        ${countRows}
      </table>` : ''}
      ${stats ? `<p class="hint">Totales calculados ${formatLocal(stats.computedAt)} (hora Argentina)</p>` : ''}
    </div>

    ${periods.length > 0 ? `
    <div class="card">
      <h2>Periodos cargados</h2>
      <table>
        <tr><th>Tipo</th><th>Regimen</th><th>Desde</th><th>Hasta</th><th>Registros</th></tr>
        ${periodRows}
      </table>
    </div>` : ''}

    <div class="card">
      <h2>Subir Padron</h2>
      <div class="form-row">
        <select id="padronType">${padronTypes}</select>
      </div>
      <p class="hint" id="layoutHint"></p>
      <div class="upload-area" id="dropZone" onclick="document.getElementById('fileInput').click()">
        <div class="icon">📁</div>
        <p><strong>Click para seleccionar</strong> o arrastra el archivo aqui</p>
        <p id="fileName" style="color:#3498db; font-weight:600; margin-top:8px"></p>
      </div>
      <input type="file" id="fileInput" accept=".txt,.csv">
      <div class="form-row">
        <button id="uploadBtn" onclick="uploadFile()" disabled>Subir Padron</button>
      </div>
      <div class="progress" id="progress">
        <div class="progress-bar"><div class="fill" id="progressFill" style="width:0%"></div></div>
        <p class="progress-text" id="progressText">Subiendo archivo...</p>
      </div>
    </div>

    <div class="card">
      <h2>Formatos admitidos por tipo</h2>
      <table>
        <tr><th>Tipo</th><th>Layout</th><th>Organismo</th><th>Archivo</th><th>Como reconocerlo</th></tr>
        ${formatoRows}
      </table>
      <p class="hint">Un archivo con otro layout se rechaza con LAYOUT_MISMATCH antes de tocar la base. Se configura con PADRON_LAYOUTS en el .env.</p>
    </div>

    <div class="card">
      <h2>Consultar CUIT</h2>
      <div class="search-box">
        <input type="text" id="cuitInput" placeholder="Ej: 20-12345678-9" maxlength="13">
        <input type="date" id="fechaInput">
        <button onclick="searchCuit()">Buscar</button>
      </div>
      <div class="result" id="searchResult"></div>
    </div>

    ${metadata.length > 0 ? `
    <div class="card">
      <h2>Historial de cargas</h2>
      <table>
        <tr><th>Tipo</th><th>Archivo</th><th>Registros</th><th>Fecha (hora Argentina)</th><th>Estado</th></tr>
        ${metaRows}
      </table>
    </div>` : ''}
  </div>

  <script>
    var API_KEY = prompt('Ingresa tu API Key:');
    if (!API_KEY) API_KEY = '';

    var selectedFile = null;

    // Formatos admitidos por tipo, para el aviso debajo del selector
    var FORMATOS = ${JSON.stringify(formatos)};
    function updateLayoutHint() {
      var tipo = document.getElementById('padronType').value;
      var entry = FORMATOS.filter(function(f) { return f.padronType === tipo; })[0];
      var el = document.getElementById('layoutHint');
      if (!entry || !entry.layouts) { el.textContent = tipo + ' acepta cualquier layout (sin politica).'; return; }
      el.textContent = tipo + ' acepta: ' + entry.layouts.map(function(l) {
        return (l.archivo ? l.archivo + ' ' : '') + '(' + l.name + ')';
      }).join(', ');
    }
    document.getElementById('padronType').addEventListener('change', updateLayoutHint);
    updateLayoutHint();

    // Drag & drop
    var dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) selectFile(e.dataTransfer.files[0]);
    });

    document.getElementById('fileInput').addEventListener('change', function(e) {
      if (e.target.files.length > 0) selectFile(e.target.files[0]);
    });

    function selectFile(file) {
      selectedFile = file;
      document.getElementById('fileName').textContent = file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB)';
      document.getElementById('uploadBtn').disabled = false;
    }

    function uploadFile() {
      if (!selectedFile) return;
      var tipo = document.getElementById('padronType').value;
      var formData = new FormData();
      formData.append('padronFile', selectedFile);

      document.getElementById('uploadBtn').disabled = true;
      var progress = document.getElementById('progress');
      progress.style.display = 'block';
      document.getElementById('progressText').textContent = 'Subiendo archivo...';
      document.getElementById('progressFill').style.width = '30%';

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/v1/upload/' + tipo);
      xhr.setRequestHeader('x-api-key', API_KEY);

      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 50);
          document.getElementById('progressFill').style.width = pct + '%';
          document.getElementById('progressText').textContent = 'Subiendo... ' + pct * 2 + '%';
        }
      };

      xhr.onload = function() {
        var body = JSON.parse(xhr.responseText);
        if (body.success) {
          document.getElementById('progressFill').style.width = '50%';
          document.getElementById('progressText').textContent = 'Procesando registros...';
          pollJob(body.data.jobId);
        } else {
          document.getElementById('progressText').textContent = 'Error: ' + body.error.message;
          document.getElementById('uploadBtn').disabled = false;
        }
      };

      xhr.send(formData);
    }

    function pollJob(jobId) {
      var interval = setInterval(function() {
        fetch('/api/v1/upload/status/' + jobId, { headers: { 'x-api-key': API_KEY } })
          .then(function(r) { return r.json(); })
          .then(function(body) {
            if (!body.success) {
              clearInterval(interval);
              document.getElementById('progressText').textContent = 'Error: ' + body.error.message;
              document.getElementById('uploadBtn').disabled = false;
              return;
            }
            if (body.data.status === 'completed') {
              clearInterval(interval);
              document.getElementById('progressFill').style.width = '100%';
              document.getElementById('progressText').textContent =
                'Completado! ' + body.data.recordsLoaded.toLocaleString() + ' registros cargados.';
              setTimeout(function() { location.reload(); }, 2000);
            } else if (body.data.status === 'error') {
              clearInterval(interval);
              document.getElementById('progressText').textContent = 'Error: ' + body.data.error;
              document.getElementById('uploadBtn').disabled = false;
            } else if (body.data.status === 'queued') {
              document.getElementById('progressText').textContent = 'En cola: esperando que termine otra carga...';
            } else if (body.data.recordsLoaded === 0 && body.data.recordsDeleted > 0) {
              document.getElementById('progressText').textContent =
                'Borrando registros anteriores... ' + body.data.recordsDeleted.toLocaleString();
            } else {
              var pct = 50 + Math.min(45, (body.data.recordsLoaded / 4000000) * 45);
              document.getElementById('progressFill').style.width = pct + '%';
              document.getElementById('progressText').textContent =
                'Procesando... ' + body.data.recordsLoaded.toLocaleString() + ' registros';
            }
          })
          .catch(function() {
            clearInterval(interval);
            document.getElementById('progressText').textContent = 'Se perdio la conexion con el servidor. Recarga la pagina.';
            document.getElementById('uploadBtn').disabled = false;
          });
      }, 2000);
    }

    function searchCuit() {
      var cuit = document.getElementById('cuitInput').value;
      var fecha = document.getElementById('fechaInput').value;
      if (!cuit) return;

      var url = '/api/v1/padron/' + cuit;
      if (fecha) url += '?fecha=' + fecha;

      fetch(url, { headers: { 'x-api-key': API_KEY } })
        .then(function(r) { return r.json(); })
        .then(function(body) {
          var el = document.getElementById('searchResult');
          el.style.display = 'block';
          el.textContent = JSON.stringify(body, null, 2);
        });
    }

    // Enter para buscar
    document.getElementById('cuitInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') searchCuit();
    });

    // Fecha default = hoy
    document.getElementById('fechaInput').valueAsDate = new Date();
  </script>
</body>
</html>`);
});

module.exports = router;
