require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLayoutPolicy,
  validateLayoutPolicy,
  checkLayoutPolicy,
  getLayoutPolicy,
} = require('../src/services/layoutPolicy');

// ARBA y AGIP publican el mismo layout de 11/12 campos sin prefijo. Los layouts
// con prefijo P/R son de otras jurisdicciones (por ejemplo Córdoba).
const DEFAULT_POLICY = { ARBA: ['UNIFICADO'], AGIP: ['UNIFICADO'] };

test('parseLayoutPolicy convierte "tipo:layout,layout|tipo:layout" en un mapa por tipo', () => {
  assert.deepEqual(
    parseLayoutPolicy('ARBA:UNIFICADO|IIBB_CORDOBA:PERCEPCION,RETENCION'),
    { ARBA: ['UNIFICADO'], IIBB_CORDOBA: ['PERCEPCION', 'RETENCION'] }
  );
});

test('parseLayoutPolicy normaliza espacios y minúsculas', () => {
  assert.deepEqual(
    parseLayoutPolicy(' arba : unificado | iibb_cordoba: percepcion , retencion '),
    { ARBA: ['UNIFICADO'], IIBB_CORDOBA: ['PERCEPCION', 'RETENCION'] }
  );
});

test('parseLayoutPolicy con string vacío o ausente devuelve un mapa vacío', () => {
  assert.deepEqual(parseLayoutPolicy(''), {});
  assert.deepEqual(parseLayoutPolicy(undefined), {});
});

test('parseLayoutPolicy rechaza una entrada sin layouts', () => {
  assert.throws(() => parseLayoutPolicy('ARBA:'), /ARBA/);
  assert.throws(() => parseLayoutPolicy('ARBA'), /ARBA/);
});

test('validateLayoutPolicy rechaza un tipo que no está en la lista de tipos permitidos', () => {
  assert.throws(
    () => validateLayoutPolicy({ AGIP: ['PERCEPCION'] }, { allowedTypes: ['ARBA'], knownLayouts: ['PERCEPCION'] }),
    /AGIP/
  );
});

test('validateLayoutPolicy rechaza un layout que el parser no conoce', () => {
  assert.throws(
    () => validateLayoutPolicy({ ARBA: ['UNIFICADO', 'INVENTADO'] }, { allowedTypes: ['ARBA'], knownLayouts: ['UNIFICADO'] }),
    /INVENTADO/
  );
});

test('validateLayoutPolicy acepta una política consistente', () => {
  assert.doesNotThrow(() => validateLayoutPolicy(DEFAULT_POLICY, {
    allowedTypes: ['ARBA', 'AGIP', 'IIBB_CABA'],
    knownLayouts: ['UNIFICADO', 'PERCEPCION', 'RETENCION'],
  }));
});

test('checkLayoutPolicy permite el layout UNIFICADO para ARBA', () => {
  assert.deepEqual(checkLayoutPolicy('ARBA', 'UNIFICADO', DEFAULT_POLICY), { allowed: true, expected: ['UNIFICADO'] });
});

test('checkLayoutPolicy permite el layout UNIFICADO para AGIP (es el que publica AGIP)', () => {
  assert.deepEqual(checkLayoutPolicy('AGIP', 'UNIFICADO', DEFAULT_POLICY), { allowed: true, expected: ['UNIFICADO'] });
});

test('checkLayoutPolicy rechaza PERCEPCION y RETENCION para ARBA y AGIP', () => {
  for (const tipo of ['ARBA', 'AGIP']) {
    assert.deepEqual(checkLayoutPolicy(tipo, 'PERCEPCION', DEFAULT_POLICY), { allowed: false, expected: ['UNIFICADO'] });
    assert.deepEqual(checkLayoutPolicy(tipo, 'RETENCION', DEFAULT_POLICY), { allowed: false, expected: ['UNIFICADO'] });
  }
});

test('checkLayoutPolicy permite cualquier layout para un tipo sin política', () => {
  assert.deepEqual(checkLayoutPolicy('IIBB_SANTA_FE', 'UNIFICADO', DEFAULT_POLICY), { allowed: true, expected: null });
});

test('la política por defecto asigna UNIFICADO tanto a ARBA como a AGIP', () => {
  assert.deepEqual(getLayoutPolicy(), DEFAULT_POLICY);
});
