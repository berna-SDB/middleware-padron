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
        (padron_type, fecha_publicacion, fecha_desde, fecha_hasta, cuit,
         tipo_contribuyente, marca_alta, marca_baja,
         alicuota_percepcion, alicuota_retencion,
         grupo_percepcion, grupo_retencion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    deleteByType: db.prepare(`
      DELETE FROM padron_entries WHERE padron_type = ?
    `),

    deleteByTypeAndPeriod: db.prepare(`
      DELETE FROM padron_entries
      WHERE padron_type = ? AND fecha_desde = ? AND fecha_hasta = ?
    `),

    insertMetadata: db.prepare(`
      INSERT INTO padron_metadata (padron_type, filename, records_loaded, status)
      VALUES (?, ?, ?, ?)
    `),

    getMetadata: db.prepare(`
      SELECT * FROM padron_metadata ORDER BY loaded_at DESC
    `),

    countByType: db.prepare(`
      SELECT padron_type, COUNT(*) as total FROM padron_entries GROUP BY padron_type
    `),

    totalCount: db.prepare(`
      SELECT COUNT(*) as total FROM padron_entries
    `),
  };

  return stmts;
}

module.exports = { getStatements };
