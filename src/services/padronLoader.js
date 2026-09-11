const path = require('path');
const { Worker } = require('worker_threads');
const { setStats } = require('./padronStats');
const logger = require('../logger');

/**
 * Cola de cargas de padrón. Cada carga corre en un worker thread (ver
 * loadWorker.js) para que el hilo principal siga atendiendo consultas, y de a
 * una por vez: SQLite admite un solo escritor y el disco rinde mejor sin dos
 * cargas peleando por él.
 */

// Job tracking en memoria
const jobs = new Map();
const queue = [];
let running = null;

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function getAllJobs() {
  return Array.from(jobs.values());
}

function newJobId(padronType) {
  const base = `load-${padronType.toLowerCase()}-${Date.now()}`;
  let jobId = base;
  for (let n = 1; jobs.has(jobId); n++) jobId = `${base}-${n}`;
  return jobId;
}

/**
 * Encola la carga de un archivo de padrón.
 * Retorna el jobId inmediatamente; el estado se consulta con getJob().
 */
function loadPadronFile(filePath, padronType, options = {}) {
  const { replace = true } = options;
  const jobId = newJobId(padronType);

  jobs.set(jobId, {
    jobId,
    padronType,
    filename: path.basename(filePath),
    status: 'queued',
    recordsDeleted: 0,
    recordsLoaded: 0,
    queuedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
  });

  queue.push({ jobId, filePath, padronType, replace });
  runNext();

  return jobId;
}

function fail(job, message) {
  job.status = 'error';
  job.error = message;
  job.completedAt = new Date().toISOString();
  logger.error({ jobId: job.jobId, padronType: job.padronType, err: message }, 'Error al cargar padrón');
}

function runNext() {
  if (running || queue.length === 0) return;

  const item = queue.shift();
  const job = jobs.get(item.jobId);
  running = item;
  job.status = 'loading';
  job.startedAt = new Date().toISOString();

  const worker = new Worker(path.join(__dirname, 'loadWorker.js'), {
    workerData: { task: 'load', ...item },
  });

  worker.on('message', (msg) => {
    switch (msg.type) {
      case 'deleting':
        job.recordsDeleted = msg.deleted;
        break;
      case 'progress':
        job.recordsLoaded = msg.recordsLoaded;
        break;
      case 'done':
        job.status = 'completed';
        job.recordsLoaded = msg.totalLoaded;
        job.completedAt = new Date().toISOString();
        if (msg.stats) setStats(msg.stats);
        break;
      case 'error':
        fail(job, msg.message);
        break;
      default:
        break;
    }
  });

  worker.on('error', (err) => fail(job, err.message));

  worker.on('exit', (code) => {
    if (job.status === 'loading') {
      fail(job, `el worker de carga terminó con código ${code} sin completar`);
    }
    running = null;
    runNext();
  });
}

module.exports = { loadPadronFile, getJob, getAllJobs };
