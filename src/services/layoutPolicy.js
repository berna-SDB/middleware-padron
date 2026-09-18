const config = require('../config');
const { LAYOUTS, layoutFamily } = require('./padronParser');

/**
 * Política de layouts: qué layouts de archivo admite cada padronType.
 *
 * Se configura con PADRON_LAYOUTS, con formato `TIPO:LAYOUT[,LAYOUT]|TIPO:LAYOUT`,
 * por ejemplo `ARBA:RGS_PERCEPCION,RGS_RETENCION|AGIP:UNIFICADO`. Un tipo sin
 * entrada acepta cualquier layout: sirve para jurisdicciones de las que todavía
 * no se conoce el archivo. Los nombres de familia PERCEPCION y RETENCION valen
 * como comodín de sus dos variantes (RGS y LUA).
 *
 * El archivo no trae ningún campo que identifique la jurisdicción, así que esta
 * política es la única barrera contra subir un padrón bajo el tipo equivocado.
 * Alcanza porque los tres organismos publican diseños distintos: ARBA sus
 * padrones de regímenes generales (RGS, P/R con grupo), AGIP el unificado de 12
 * campos y Córdoba su listado único de alícuotas (LUA, P/R sin grupo).
 */

const FAMILIES = ['PERCEPCION', 'RETENCION'];
const KNOWN_LAYOUTS = [...LAYOUTS, ...FAMILIES];

/** Qué es cada layout, para el panel y los mensajes de error. */
const LAYOUT_INFO = {
  UNIFICADO: {
    organismo: 'AGIP',
    archivo: 'ARDJU008MMAAAA.TXT',
    descripcion: 'Padrón unificado de 12 campos sin prefijo: fecha de publicación primero, alícuotas de percepción y retención en la misma línea, grupos en 00 y razón social al final.',
  },
  RGS_PERCEPCION: {
    organismo: 'ARBA',
    archivo: 'PadronRGSPerMMAAAA.txt',
    descripcion: 'Padrón de regímenes generales de ARBA, percepción: prefijo P, alícuota y número de grupo, termina en ";".',
  },
  RGS_RETENCION: {
    organismo: 'ARBA',
    archivo: 'PadronRGSRetMMAAAA.txt',
    descripcion: 'Padrón de regímenes generales de ARBA, retención: prefijo R, alícuota y número de grupo, termina en ";".',
  },
  LUA_PERCEPCION: {
    organismo: 'Rentas Córdoba',
    archivo: 'LUA Percepción',
    descripcion: 'Listado único de alícuotas de Córdoba, percepción: prefijo P, 9 campos, sin grupo, marca de sujeto X.',
  },
  LUA_RETENCION: {
    organismo: 'Rentas Córdoba',
    archivo: 'LUA Retención',
    descripcion: 'Listado único de alícuotas de Córdoba, retención: prefijo R, 9 campos, sin grupo, marca de sujeto X.',
  },
  PERCEPCION: {
    organismo: 'ARBA o Córdoba',
    archivo: null,
    descripcion: 'Cualquier padrón de percepción con prefijo P, sea RGS o LUA.',
  },
  RETENCION: {
    organismo: 'ARBA o Córdoba',
    archivo: null,
    descripcion: 'Cualquier padrón de retención con prefijo R, sea RGS o LUA.',
  },
};

/** Texto corto para nombrar un layout en un mensaje: "Rentas Córdoba, LUA Percepción". */
function describeLayout(name) {
  const info = LAYOUT_INFO[name];
  if (!info) return name;
  return info.archivo ? `${info.organismo}, ${info.archivo}` : info.organismo;
}

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
 * Un nombre de familia en la política (PERCEPCION, RETENCION) admite sus dos
 * variantes.
 */
function checkLayoutPolicy(padronType, formato, policy = getLayoutPolicy()) {
  const expected = policy[padronType] || null;
  if (!expected) return { allowed: true, expected: null };
  const allowed = expected.includes(formato) || expected.includes(layoutFamily(formato));
  return { allowed, expected };
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
    knownLayouts: KNOWN_LAYOUTS,
  });

  cachedPolicy = policy;
  return cachedPolicy;
}

/**
 * Qué acepta cada tipo permitido, para mostrarlo en el panel y en padron-info.
 * `layouts` es null cuando el tipo no tiene política y acepta cualquier archivo.
 */
function acceptedLayouts(policy = getLayoutPolicy()) {
  return config.ALLOWED_PADRON_TYPES.map((padronType) => {
    const names = policy[padronType] || null;
    return {
      padronType,
      layouts: names ? names.map((name) => ({ name, ...LAYOUT_INFO[name] })) : null,
    };
  });
}

module.exports = {
  parseLayoutPolicy, validateLayoutPolicy, checkLayoutPolicy, getLayoutPolicy,
  acceptedLayouts, describeLayout, LAYOUT_INFO, KNOWN_LAYOUTS,
};
