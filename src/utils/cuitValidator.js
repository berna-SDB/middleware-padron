/**
 * Normaliza un CUIT removiendo guiones y espacios.
 * Retorna null si el formato es inválido.
 */
function normalizeCuit(cuit) {
  if (!cuit) return null;
  const cleaned = cuit.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Valida un CUIT y retorna resultado con el CUIT normalizado.
 */
function validateCuit(cuit) {
  const normalized = normalizeCuit(cuit);
  if (!normalized) {
    return { valid: false, error: 'CUIT debe ser de 11 dígitos' };
  }
  return { valid: true, cuit: normalized };
}

module.exports = { normalizeCuit, validateCuit };
