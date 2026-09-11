const config = require('../config');
const { FORMATS } = require('./padronParser');

/**
 * Política de layouts: qué layouts de archivo admite cada padronType.
 *
 * Se configura con PADRON_LAYOUTS, con formato `TIPO:LAYOUT[,LAYOUT]|TIPO:LAYOUT`,
 * por ejemplo `ARBA:UNIFICADO|AGIP:PERCEPCION,RETENCION`. Un tipo sin entrada
 * acepta cualquier layout: sirve para jurisdicciones de las que todavía no se
 * conoce el archivo.
 *
 * El layout de un archivo no dice nada sobre su jurisdicción (no trae ningún
 * campo que la identifique), así que esta política es la única barrera contra
 * subir, por ejemplo, el padrón unificado de ARBA como si fuera de AGIP.
 */

/**
 * Parsea el string de configuración a un mapa { TIPO: [LAYOUT, ...] }.
 * Lanza si alguna entrada no respeta el formato.
 */
function parseLayoutPolicy(raw) {
  const policy = {};
  if (!raw || !raw.trim()) return policy;

  for (const entry of raw.split('|')) {
    if (!entry.trim()) continue;

    const parts = entry.split(':');
    const padronType = (parts[0] || '').trim().toUpperCase();
    const layouts = (parts[1] || '')
      .split(',')
      .map((l) => l.trim().toUpperCase())
      .filter(Boolean);

    if (parts.length !== 2 || !padronType || layouts.length === 0) {
      throw new Error(`PADRON_LAYOUTS: entrada inválida "${entry.trim()}" (formato esperado TIPO:LAYOUT[,LAYOUT])`);
    }

    policy[padronType] = layouts;
  }

  return policy;
}

/**
 * Verifica que la política solo mencione tipos permitidos y layouts que el
 * parser conoce. Lanza con todos los problemas encontrados.
 */
function validateLayoutPolicy(policy, { allowedTypes, knownLayouts }) {
  const problems = [];

  for (const [padronType, layouts] of Object.entries(policy)) {
    if (!allowedTypes.includes(padronType)) {
      problems.push(`el tipo "${padronType}" no está en ALLOWED_PADRON_TYPES (${allowedTypes.join(', ')})`);
    }
    for (const layout of layouts) {
      if (!knownLayouts.includes(layout)) {
        problems.push(`el layout "${layout}" del tipo ${padronType} no existe (conocidos: ${knownLayouts.join(', ')})`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`PADRON_LAYOUTS inválida: ${problems.join('; ')}`);
  }
}

/**
 * Decide si un archivo con el layout detectado puede cargarse bajo padronType.
 * `expected` es null cuando el tipo no tiene política y acepta cualquier layout.
 */
function checkLayoutPolicy(padronType, formato, policy = getLayoutPolicy()) {
  const expected = policy[padronType] || null;
  if (!expected) return { allowed: true, expected: null };
  return { allowed: expected.includes(formato), expected };
}

let cachedPolicy = null;

/**
 * Política efectiva, parseada y validada una sola vez a partir de la config.
 * Llamarla al arrancar hace que una configuración inválida impida levantar el
 * servidor en lugar de fallar (o aceptar cualquier cosa) en el primer upload.
 */
function getLayoutPolicy() {
  if (cachedPolicy) return cachedPolicy;

  const policy = parseLayoutPolicy(config.PADRON_LAYOUTS);
  validateLayoutPolicy(policy, {
    allowedTypes: config.ALLOWED_PADRON_TYPES,
    knownLayouts: Object.keys(FORMATS),
  });

  cachedPolicy = policy;
  return cachedPolicy;
}

module.exports = { parseLayoutPolicy, validateLayoutPolicy, checkLayoutPolicy, getLayoutPolicy };
