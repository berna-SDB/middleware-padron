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
 * Valida que una fecha tenga formato DDMMYYYY (8 dígitos).
 */
function isValidDate(value) {
  return /^\d{8}$/.test(value.trim());
}

/**
 * Valida que un CUIT tenga 11 dígitos.
 */
function isValidCuit(value) {
  return /^\d{11}$/.test(value.trim());
}

/**
 * Detecta si una línea es un header (contiene texto no numérico en los campos de fecha).
 */
function isHeaderLine(fields) {
  return /[a-zA-Z]/.test(fields[0]);
}

/**
 * Valida la estructura de una línea del padrón.
 * Retorna null si es válida, o un string con el error.
 */
function validateLine(fields, lineNum) {
  if (fields.length < 11) {
    return `Línea ${lineNum}: solo tiene ${fields.length} campos, se requieren 11`;
  }

  if (!isValidDate(fields[0])) {
    return `Línea ${lineNum}: fechaPublicacion inválida "${fields[0]}" (debe ser DDMMYYYY)`;
  }

  if (!isValidDate(fields[1])) {
    return `Línea ${lineNum}: fechaDesde inválida "${fields[1]}" (debe ser DDMMYYYY)`;
  }

  if (!isValidDate(fields[2])) {
    return `Línea ${lineNum}: fechaHasta inválida "${fields[2]}" (debe ser DDMMYYYY)`;
  }

  if (!isValidCuit(fields[3])) {
    return `Línea ${lineNum}: CUIT inválido "${fields[3]}" (debe ser 11 dígitos)`;
  }

  return null;
}

/**
 * Valida las primeras N líneas de un archivo sin cargarlo.
 * Retorna un reporte de validación.
 */
async function validatePadronFile(filePath, maxLines = 100) {
  const stream = fs.createReadStream(filePath, { encoding: 'latin1' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const errors = [];
  let lineNum = 0;
  let valid = 0;
  let sampleFields = null;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    const fields = line.split(';');

    // Saltar línea de header
    if (lineNum === 1 && isHeaderLine(fields)) {
      continue;
    }

    // Guardar primera línea como muestra
    if (!sampleFields) {
      sampleFields = fields.length;
    }

    const error = validateLine(fields, lineNum);
    if (error) {
      errors.push(error);
      if (errors.length >= 10) break;
    } else {
      valid++;
    }

    if (lineNum >= maxLines) break;
  }

  stream.destroy();

  return {
    valid: errors.length === 0,
    linesChecked: lineNum,
    validLines: valid,
    errors,
    fieldsPerLine: sampleFields,
  };
}

/**
 * Parser streaming de archivos de padrón.
 * Genera un objeto por cada línea válida del archivo.
 */
async function* parsePadronFile(filePath, padronType) {
  const stream = fs.createReadStream(filePath, { encoding: 'latin1' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNum = 0;
  let parsed = 0;
  let skipped = 0;
  const skipReasons = {};

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    const fields = line.split(';');

    // Saltar línea de header
    if (lineNum === 1 && isHeaderLine(fields)) {
      logger.info('Header detectado, saltando primera línea');
      continue;
    }

    const error = validateLine(fields, lineNum);
    if (error) {
      skipped++;
      const reason = error.split(':')[1]?.trim().split('"')[0]?.trim() || 'desconocido';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      if (skipped <= 5) {
        logger.warn({ lineNum, error }, 'Línea inválida, saltando');
      }
      continue;
    }

    const fechaPublicacion = parsePadronDate(fields[0].trim());
    const fechaDesde = parsePadronDate(fields[1].trim());
    const fechaHasta = parsePadronDate(fields[2].trim());

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

  logger.info({ filePath, lineNum, parsed, skipped, skipReasons }, 'Archivo parseado completamente');
}

module.exports = { parsePadronFile, validatePadronFile };
