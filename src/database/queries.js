const { getConnection } = require('./connection');

let stmts = null;

function getStatements() {
  if (stmts) return stmts;

  const db = getConnection();

  stmts = {
    findByCuit: db.prepare(`
      SELECT * FROM padron_entries
      WHERE cuit = ?
      ORDER BY padron_type, fecha_desde DESC
    `),

    findByCuitAndType: db.prepare(`
      SELECT * FROM padron_entries
      WHERE cuit = ? AND padron_type = ?
      ORDER BY fecha_desde DESC
    `),

    findByCuitAndDate: db.prepare(`
      SELECT * FROM padron_entries
      WHERE cuit = ?
        AND fecha_desde <= ?
        AND fecha_hasta >= ?
      ORDER BY padron_type, fecha_desde DESC
    `),

    findByCuitTypeDateRange: db.prepare(`
      SELECT * FROM padron_entries
      WHERE cuit = ?
        AND padron_type = ?
        AND fecha_desde <= ?
        AND fecha_hasta >= ?
      ORDER BY fecha_desde DESC
    `),

    findByCuitDateRange: db.prepare(`
      SELECT * FROM padron_entries
      WHERE cuit = ?
        AND fecha_desde <= ?
        AND fecha_hasta >= ?
      ORDER BY padron_type, fecha_desde DESC
    `),

    findByCuitTypeDateRangeOverlap: db.prepare(`
      SELECT * FROM padron_entries
      WHERE cuit = ?
        AND padron_type = ?
        AND fecha_desde <= ?
        AND fecha_hasta >= ?
      ORDER BY fecha_desde
    `),

    findByCuitDateRangeOverlap: db.prepare(`
      SELECT * FROM padron_entries
      WHERE cuit = ?
        AND fecha_desde <= ?
        AND fecha_hasta >= ?
      ORDER BY padron_type, fecha_desde
    `),

    insertEntry: db.prepare(`
      INSERT INTO padron_entries
        (padron_type, regimen, fecha_publicacion, fecha_desde, fecha_hasta, cuit,
         tipo_contribuyente, marca_alta, marca_baja,
         alicuota_percepcion, alicuota_retencion,
         grupo_percepcion, grupo_retencion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    // Los borrados masivos van por lotes (LIMIT) para que cada uno sea una
    // transacción corta: el WAL no crece al tamaño de todo el período y los
    // checkpoints automáticos corren entre lote y lote. El llamador repite
    // hasta que un lote borra menos filas que el límite.
    deleteByTypeChunk: db.prepare(`
      DELETE FROM padron_entries
      WHERE rowid IN (
        SELECT rowid FROM padron_entries
        WHERE padron_type = ?
        LIMIT ?
      )
    `),

    // Acotado al régimen del archivo entrante para que percepción y retención
    // del mismo tipo y período no se pisen. Usa el índice completo
    // (padron_type, regimen, fecha_desde, fecha_hasta); la migración garantiza
    // que ninguna fila tenga regimen NULL.
    deleteByTypeAndPeriodChunk: db.prepare(`
      DELETE FROM padron_entries
      WHERE rowid IN (
        SELECT rowid FROM padron_entries
        WHERE padron_type = ?
          AND regimen = ?
          AND fecha_desde = ?
          AND fecha_hasta = ?
        LIMIT ?
      )
    `),

    insertMetadata: db.prepare(`
      INSERT INTO padron_metadata (padron_type, filename, records_loaded, status)
      VALUES (?, ?, ?, ?)
    `),

    getMetadata: db.prepare(`
      SELECT * FROM padron_metadata ORDER BY loaded_at DESC
    `),

    // Recorre el índice (padron_type, regimen, fecha_desde, fecha_hasta) entero:
    // solo debe ejecutarse en el worker, nunca en el hilo que atiende requests.
    statsByPeriod: db.prepare(`
      SELECT padron_type, regimen, fecha_desde, fecha_hasta, COUNT(*) AS total
      FROM padron_entries
      GROUP BY padron_type, regimen, fecha_desde, fecha_hasta
      ORDER BY padron_type, regimen, fecha_desde
    `),
  };

  return stmts;
}

module.exports = { getStatements };
