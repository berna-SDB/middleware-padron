const readline = require('readline');
const fs = require('fs');
const { parsePadronDate } = require('../utils/dateUtils');
const logger = require('../logger');

/**
 * Convierte alícuota de formato argentino (coma decimal) a float.
 */
function parseAlicuota(value) {
  if (!value || !value.trim()) return 0;
  return parseFloat(value.replace(',', '.')) || 0;
}

/**
 * Parser streaming de archivos de padrón.
 * Genera un objeto por cada línea válida del archivo.
 *
 * Formato esperado (separado por ;):
 * fechaPublicacion;fechaDesde;fechaHasta;cuit;tipoContribuyente;marcaAlta;marcaBaja;alicuotaPercepcion;alicuotaRetencion;grupoPercepcion;grupoRetencion
 */
async function* parsePadronFile(filePath, padronType) {
  const stream = fs.createReadStream(filePath, { encoding: 'latin1' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNum = 0;
  let parsed = 0;
  let skipped = 0;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    const fields = line.split(';');
    if (fields.length < 11) {
      skipped++;
      if (skipped <= 5) {
        logger.warn({ lineNum, fieldCount: fields.length }, 'Línea con campos insuficientes, saltando');
      }
      continue;
    }

    const fechaPublicacion = parsePadronDate(fields[0].trim());
    const fechaDesde = parsePadronDate(fields[1].trim());
    const fechaHasta = parsePadronDate(fields[2].trim());

    if (!fechaDesde || !fechaHasta) {
      skipped++;
      continue;
    }

    parsed++;
    yield {
      padronType,
      fechaPublicacion: fechaPublicacion || fechaDesde,
      fechaDesde,
      fechaHasta,
      cuit: fields[3].trim(),
      tipoContribuyente: fields[4].trim(),
      marcaAlta: fields[5].trim(),
      marcaBaja: fields[6].trim(),
      alicuotaPercepcion: parseAlicuota(fields[7]),
      alicuotaRetencion: parseAlicuota(fields[8]),
      grupoPercepcion: parseInt(fields[9], 10) || null,
      grupoRetencion: parseInt(fields[10], 10) || null,
    };
  }

  logger.info({ filePath, lineNum, parsed, skipped }, 'Archivo parseado completamente');
}

module.exports = { parsePadronFile };
