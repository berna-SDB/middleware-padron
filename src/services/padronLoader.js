const path = require('path');
const fs = require('fs');
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

      // Leer todos los registros para detectar períodos
      const records = [];
      const periods = new Set();

      for await (const record of parsePadronFile(filePath, padronType)) {
        records.push(record);
        periods.add(`${record.regimen}|${record.fechaDesde}|${record.fechaHasta}`);
      }

      // Eliminar períodos duplicados antes de insertar. La clave incluye el
      // régimen: un padrón de percepción no debe borrar el de retención del
      // mismo tipo y período.
      if (!replace) {
        for (const period of periods) {
          const [regimen, desde, hasta] = period.split('|');
          const deleted = stmts.deleteByTypeAndPeriod.run(padronType, desde, hasta, regimen);
          if (deleted.changes > 0) {
            logger.info({ padronType, regimen, desde, hasta, deleted: deleted.changes }, 'Período duplicado eliminado antes de insertar');
          }
        }
      }

      const insertBatch = db.transaction((batch) => {
        for (const r of batch) {
          stmts.insertEntry.run(
            r.padronType, r.regimen, r.fechaPublicacion, r.fechaDesde, r.fechaHasta,
            r.cuit, r.tipoContribuyente, r.marcaAlta, r.marcaBaja,
            r.alicuotaPercepcion, r.alicuotaRetencion,
            r.grupoPercepcion, r.grupoRetencion
          );
        }
      });

      let totalLoaded = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        insertBatch(batch);
        totalLoaded += batch.length;
        job.recordsLoaded = totalLoaded;

        if (totalLoaded % 100000 === 0) {
          logger.info({ padronType, totalLoaded }, 'Progreso de carga');
        }
      }

      // Checkpoint WAL para liberar espacio
      db.pragma('wal_checkpoint(TRUNCATE)');

      // Registrar metadata
      stmts.insertMetadata.run(padronType, path.basename(filePath), totalLoaded, 'completed');

      job.status = 'completed';
      job.recordsLoaded = totalLoaded;
      job.completedAt = new Date().toISOString();

      // Borrar archivo temporal para no duplicar espacio en disco
      try {
        fs.unlinkSync(filePath);
        logger.info({ filePath }, 'Archivo temporal eliminado');
      } catch (unlinkErr) {
        logger.warn({ filePath, err: unlinkErr.message }, 'No se pudo eliminar archivo temporal');
      }

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
