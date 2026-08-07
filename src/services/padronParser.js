const readline = require('readline');
const fs = require('fs');
const { parsePadronDate } = require('../utils/dateUtils');
const logger = require('../logger');

/**
 * Layouts de archivo soportados.
 *
 * Los padrones con prefijo de régimen (P/R) comparten la misma cabecera
 * (regimen;fechaPublicacion;fechaDesde;fechaHasta;cuit;tipo;alta;baja) y solo
 * difieren en la cola de alícuotas.
 *
 * `regimen` indica qué alícuotas trae el archivo: 'P' percepción, 'R' retención,
 * 'AMBOS' las dos. Se guarda en cada registro para que padrones de percepción y
 * retención de la misma jurisdicción puedan convivir bajo un mismo padronType.
 */
const FORMATS = {
  // ARBA / padrón unificado, sin prefijo. El campo 12 (denominación) es opcional.
  // fechaPub;desde;hasta;cuit;tipo;alta;baja;alicPerc;alicRet;grupoPerc;grupoRet[;denominacion]
  ARBA: {
    name: 'ARBA',
    regimen: 'AMBOS',
    minFields: 11,
    fields: {
      fechaPublicacion: 0,
      fechaDesde: 1,
      fechaHasta: 2,
      cuit: 3,
      tipoContribuyente: 4,
      marcaAlta: 5,
      marcaBaja: 6,
      alicuotaPercepcion: 7,
      alicuotaRetencion: 8,
      grupoPercepcion: 9,
      grupoRetencion: 10,
    },
  },

  // Régimen de percepción. Sin códigos de grupo.
  // P;fechaPub;desde;hasta;cuit;tipo;alta;baja;alicPerc
  PERCEPCION: {
    name: 'PERCEPCION',
    regimen: 'P',
    minFields: 9,
    fields: {
      fechaPublicacion: 1,
      fechaDesde: 2,
      fechaHasta: 3,
      cuit: 4,
      tipoContribuyente: 5,
      marcaAlta: 6,
      marcaBaja: 7,
      alicuotaPercepcion: 8,
    },
  },

  // Régimen de retención.
  // R;fechaPub;desde;hasta;cuit;tipo;alta;baja;alicRet;grupoRet
  RETENCION: {
    name: 'RETENCION',
    regimen: 'R',
    minFields: 10,
    fields: {
      fechaPublicacion: 1,
      fechaDesde: 2,
      fechaHasta: 3,
      cuit: 4,
      tipoContribuyente: 5,
      marcaAlta: 6,
      marcaBaja: 7,
      alicuotaRetencion: 8,
      grupoRetencion: 9,
    },
  },
};

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
 * Determina el layout de una línea a partir de su primer campo.
 * Retorna null si no coincide con ninguno (típicamente, una línea de header).
 */
function detectFormat(fields) {
  const first = (fields[0] || '').trim().toUpperCase();
  if (first === 'P') return FORMATS.PERCEPCION;
  if (first === 'R') return FORMATS.RETENCION;
  if (/^\d{8}$/.test(first)) return FORMATS.ARBA;
  return null;
}

/**
 * Valida la estructura de una línea según el layout detectado.
 * Retorna null si es válida, o un string con el error.
 */
function validateLine(fields, lineNum, format) {
  const { fields: idx, minFields, name } = format;

  if (fields.length < minFields) {
    return `Línea ${lineNum}: tiene ${fields.length} campos, el formato ${name} requiere ${minFields}`;
  }

  const fechas = ['fechaPublicacion', 'fechaDesde', 'fechaHasta'];
  for (const campo of fechas) {
    const value = fields[idx[campo]];
    if (!isValidDate(value)) {
      return `Línea ${lineNum}: ${campo} inválida "${value}" (debe ser DDMMYYYY)`;
    }
  }

  const cuit = fields[idx.cuit];
  if (!isValidCuit(cuit)) {
    return `Línea ${lineNum}: CUIT inválido "${cuit}" (debe ser 11 dígitos)`;
  }

  return null;
}

/**
 * Construye el registro a insertar a partir de una línea ya validada.
 */
function buildRecord(fields, format, padronType) {
  const idx = format.fields;
  const at = (campo) => (idx[campo] === undefined ? null : fields[idx[campo]]);

  const fechaDesde = parsePadronDate(fields[idx.fechaDesde].trim());
  const fechaPublicacion = parsePadronDate(fields[idx.fechaPublicacion].trim());

  const grupo = (campo) => {
    const raw = at(campo);
    if (raw === null) return null;
    return parseInt(raw, 10) || null;
  };

  return {
    padronType,
    regimen: format.regimen,
    fechaPublicacion: fechaPublicacion || fechaDesde,
    fechaDesde,
    fechaHasta: parsePadronDate(fields[idx.fechaHasta].trim()),
    cuit: fields[idx.cuit].trim(),
    tipoContribuyente: (at('tipoContribuyente') || '').trim(),
    marcaAlta: (at('marcaAlta') || '').trim(),
    marcaBaja: (at('marcaBaja') || '').trim(),
    alicuotaPercepcion: parseAlicuota(at('alicuotaPercepcion')),
    alicuotaRetencion: parseAlicuota(at('alicuotaRetencion')),
    grupoPercepcion: grupo('grupoPercepcion'),
    grupoRetencion: grupo('grupoRetencion'),
  };
}

/**
 * Valida las primeras N líneas de un archivo sin cargarlo.
 * Retorna un reporte de validación incluyendo el formato detectado.
 */
async function validatePadronFile(filePath, maxLines = 100) {
  const stream = fs.createReadStream(filePath, { encoding: 'latin1' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const errors = [];
  let lineNum = 0;
  let valid = 0;
  let format = null;
  let sampleFields = null;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    const fields = line.split(';');

    // La primera línea útil define el formato del archivo. Si no matchea ningún
    // layout conocido asumimos que es un header y seguimos con la siguiente.
    if (!format) {
      format = detectFormat(fields);
      if (!format) {
        if (lineNum === 1) continue;
        errors.push(`Línea ${lineNum}: no coincide con ningún formato conocido (esperado DDMMYYYY, "P" o "R" en el primer campo, se encontró "${fields[0]}")`);
        break;
      }
      sampleFields = fields.length;
    }

    const error = validateLine(fields, lineNum, format);
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
    valid: errors.length === 0 && valid > 0,
    formato: format ? format.name : null,
    regimen: format ? format.regimen : null,
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
  let format = null;
  const skipReasons = {};

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    const fields = line.split(';');

    if (!format) {
      format = detectFormat(fields);
      if (!format) {
        logger.info({ lineNum }, 'Línea sin formato reconocible al inicio, se asume header');
        continue;
      }
      logger.info({ filePath, formato: format.name, regimen: format.regimen }, 'Formato de padrón detectado');
    }

    const error = validateLine(fields, lineNum, format);
    if (error) {
      skipped++;
      const reason = error.split(':')[1]?.trim().split('"')[0]?.trim() || 'desconocido';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      if (skipped <= 5) {
        logger.warn({ lineNum, error }, 'Línea inválida, saltando');
      }
      continue;
    }

    parsed++;
    yield buildRecord(fields, format, padronType);
  }

  logger.info({ filePath, formato: format?.name, lineNum, parsed, skipped, skipReasons }, 'Archivo parseado completamente');
}

module.exports = { parsePadronFile, validatePadronFile, detectFormat, FORMATS };
