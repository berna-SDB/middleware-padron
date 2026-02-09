const path = require('path');
const { getConnection } = require('../database/connection');
const { getStatements } = require('../database/queries');
const { parsePadronFile } = require('./padronParser');
const logger = require('../logger');

const BATCH_SIZE = 10000;

// Job tracking en memoria
const jobs = new Map();

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function getAllJobs() {
  return Array.from(jobs.values());
}

/**
 * Carga un archivo de padrón en la base de datos.
 * Retorna el jobId inmediatamente y procesa en background.
 */
function loadPadronFile(filePath, padronType, options = {}) {
  const { replace = true } = options;
  const jobId = `load-${padronType.toLowerCase()}-${Date.now()}`;

  jobs.set(jobId, {
    jobId,
    padronType,
    filename: path.basename(filePath),
    status: 'loading',
    recordsLoaded: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  });

  // Procesar async sin bloquear el response
  setImmediate(async () => {
    const job = jobs.get(jobId);
    try {
      const db = getConnection();
      const stmts = getStatements();

      if (replace) {
        const deleted = stmts.deleteByType.run(padronType);
        logger.info({ padronType, deleted: deleted.changes }, 'Registros anteriores eliminados');
      }

      const insertBatch = db.transaction((records) => {
        for (const r of records) {
          stmts.insertEntry.run(
            r.padronType, r.fechaPublicacion, r.fechaDesde, r.fechaHasta,
            r.cuit, r.tipoContribuyente, r.marcaAlta, r.marcaBaja,
            r.alicuotaPercepcion, r.alicuotaRetencion,
            r.grupoPercepcion, r.grupoRetencion
          );
        }
      });

      let batch = [];
      let totalLoaded = 0;

      for await (const record of parsePadronFile(filePath, padronType)) {
        batch.push(record);
        if (batch.length >= BATCH_SIZE) {
          insertBatch(batch);
          totalLoaded += batch.length;
          job.recordsLoaded = totalLoaded;
          batch = [];

          if (totalLoaded % 100000 === 0) {
            logger.info({ padronType, totalLoaded }, 'Progreso de carga');
          }
        }
      }

      // Insertar batch restante
      if (batch.length > 0) {
        insertBatch(batch);
        totalLoaded += batch.length;
      }

      // Checkpoint WAL para liberar espacio
      db.pragma('wal_checkpoint(TRUNCATE)');

      // Registrar metadata
      stmts.insertMetadata.run(padronType, path.basename(filePath), totalLoaded, 'completed');

      job.status = 'completed';
      job.recordsLoaded = totalLoaded;
      job.completedAt = new Date().toISOString();

      logger.info({ padronType, totalLoaded, jobId }, 'Carga de padrón completada');
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      logger.error({ err, jobId, padronType }, 'Error al cargar padrón');
    }
  });

  return jobId;
}

module.exports = { loadPadronFile, getJob, getAllJobs };
