const { getStatements } = require('../database/queries');
const { todayISO } = require('../utils/dateUtils');

function formatRecord(row) {
  return {
    padronType: row.padron_type,
    regimen: row.regimen,
    fechaPublicacion: row.fecha_publicacion,
    fechaDesde: row.fecha_desde,
    fechaHasta: row.fecha_hasta,
    tipoContribuyente: row.tipo_contribuyente,
    marcaAlta: row.marca_alta,
    marcaBaja: row.marca_baja,
    alicuotaPercepcion: row.alicuota_percepcion,
    alicuotaRetencion: row.alicuota_retencion,
    grupoPercepcion: row.grupo_percepcion,
    grupoRetencion: row.grupo_retencion,
  };
}

/**
 * Busca registros por CUIT, opcionalmente filtrando por tipo y fecha.
 */
function queryByCuit(cuit, options = {}) {
  const { tipo, fecha } = options;
  const stmts = getStatements();
  const referenceDate = fecha || todayISO();

  let rows;
  if (tipo) {
    rows = stmts.findByCuitTypeDateRange.all(cuit, tipo, referenceDate, referenceDate);
  } else {
    rows = stmts.findByCuitAndDate.all(cuit, referenceDate, referenceDate);
  }

  return {
    cuit,
    records: rows.map(formatRecord),
    count: rows.length,
  };
}

/**
 * Busca registros por CUIT en un rango de fechas.
 */
function queryByCuitRange(cuit, desde, hasta, options = {}) {
  const { tipo } = options;
  const stmts = getStatements();

  let rows;
  if (tipo) {
    rows = stmts.findByCuitTypeDateRangeOverlap.all(cuit, tipo, hasta, desde);
  } else {
    rows = stmts.findByCuitDateRangeOverlap.all(cuit, hasta, desde);
  }

  return {
    cuit,
    records: rows.map(formatRecord),
    count: rows.length,
  };
}

/**
 * Consulta batch de múltiples CUITs.
 */
function queryBatch(cuits, options = {}) {
  const results = {};
  let totalFound = 0;
  let totalNotFound = 0;

  for (const cuit of cuits) {
    const result = queryByCuit(cuit, options);
    const found = result.count > 0;
    results[cuit] = { found, records: result.records };
    if (found) totalFound++;
    else totalNotFound++;
  }

  return { results, totalFound, totalNotFound };
}

module.exports = { queryByCuit, queryByCuitRange, queryBatch };
