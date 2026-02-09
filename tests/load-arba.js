/**
 * Script para cargar el padrón ARBA desde disco y monitorear progreso.
 */
require('../src/config');
const { initializeSchema } = require('../src/database/schema');
const { loadPadronFile, getJob } = require('../src/services/padronLoader');
const { closeConnection } = require('../src/database/connection');
const path = require('path');

initializeSchema();

const filePath = path.resolve(__dirname, '../data/padrones/PADRON_UNIFICADO_ARBA.txt');
console.log(`Cargando: ${filePath}`);
console.log(`Inicio: ${new Date().toISOString()}`);

const jobId = loadPadronFile(filePath, 'ARBA', { replace: true });
console.log(`Job ID: ${jobId}`);

// Monitorear progreso cada 5 segundos
const interval = setInterval(() => {
  const job = getJob(jobId);
  if (!job) return;

  if (job.status === 'completed') {
    console.log(`\nCompletado! ${job.recordsLoaded.toLocaleString()} registros cargados`);
    console.log(`Fin: ${job.completedAt}`);
    clearInterval(interval);
    setTimeout(() => {
      closeConnection();
      process.exit(0);
    }, 1000);
  } else if (job.status === 'error') {
    console.log(`\nError: ${job.error}`);
    clearInterval(interval);
    closeConnection();
    process.exit(1);
  } else {
    process.stdout.write(`\r  Progreso: ${job.recordsLoaded.toLocaleString()} registros...`);
  }
}, 5000);
