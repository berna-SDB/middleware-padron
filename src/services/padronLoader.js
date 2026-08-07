const path = require('path');
const fs = require('fs');
const { getConnection } = require('../database/connection');
const { getStatements } = require('../database/queries');
const { parsePadronFile } = require('./padronParser');
const logger = require('../logger');

const BATCH_SIZE = 10000;
const PROGRESS_EVERY = 100000;

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

      // Períodos ya limpiados en esta corrida. Cada uno se borra la primera vez
      // que aparece un registro suyo, siempre antes de que se inserte ninguna de
      // sus filas, y una sola vez: de lo contrario el segundo lote del mismo
      // período borraría lo que insertó el primero.
      //
      // La clave incluye el régimen para que un padrón de percepción no elimine
      // el de retención del mismo tipo y período.
      const purgedPeriods = new Set();

      function purgePeriodOnce(record) {
        if (replace) return; // ya se borró el tipo entero más arriba
        const key = `${record.regimen}|${record.fechaDesde}|${record.fechaHasta}`;
        if (purgedPeriods.has(key)) return;
        purgedPeriods.add(key);

        const deleted = stmts.deleteByTypeAndPeriod.run(
          padronType, record.fechaDesde, record.fechaHasta, record.regimen
        );
        if (deleted.changes > 0) {
          logger.info(
            { padronType, regimen: record.regimen, desde: record.fechaDesde, hasta: record.fechaHasta, deleted: deleted.changes },
            'Período duplicado eliminado antes de insertar'
          );
        }
      }

      // Se inserta a medida que se parsea: en memoria solo vive un lote, no el
      // archivo entero. Un padrón de varios millones de registros ya no depende
      // de que entre completo en el heap.
      let batch = [];
      let totalLoaded = 0;
      let nextProgressLog = PROGRESS_EVERY;

      function flush() {
        if (batch.length === 0) return;
        insertBatch(batch);
        totalLoaded += batch.length;
        job.recordsLoaded = totalLoaded;
        batch = [];

        if (totalLoaded >= nextProgressLog) {
          logger.info({ padronType, totalLoaded }, 'Progreso de carga');
          nextProgressLog += PROGRESS_EVERY;
        }
      }

      for await (const record of parsePadronFile(filePath, padronType)) {
        purgePeriodOnce(record);
        batch.push(record);
        if (batch.length >= BATCH_SIZE) flush();
      }
      flush();

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
