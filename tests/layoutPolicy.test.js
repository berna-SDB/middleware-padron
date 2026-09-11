require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLayoutPolicy,
  validateLayoutPolicy,
  checkLayoutPolicy,
  getLayoutPolicy,
} = require('../src/services/layoutPolicy');

const POLICY = { ARBA: ['UNIFICADO'], AGIP: ['PERCEPCION', 'RETENCION'] };

test('parseLayoutPolicy convierte "tipo:layout,layout|tipo:layout" en un mapa por tipo', () => {
  assert.deepEqual(parseLayoutPolicy('ARBA:UNIFICADO|AGIP:PERCEPCION,RETENCION'), POLICY);
});

test('parseLayoutPolicy normaliza espacios y minúsculas', () => {
  assert.deepEqual(parseLayoutPolicy(' arba : unificado | agip: percepcion , retencion '), POLICY);
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
  assert.doesNotThrow(() => validateLayoutPolicy(POLICY, {
    allowedTypes: ['ARBA', 'AGIP', 'IIBB_CABA'],
    knownLayouts: ['UNIFICADO', 'PERCEPCION', 'RETENCION'],
  }));
});

test('checkLayoutPolicy permite el layout UNIFICADO para ARBA', () => {
  assert.deepEqual(checkLayoutPolicy('ARBA', 'UNIFICADO', POLICY), { allowed: true, expected: ['UNIFICADO'] });
});

test('checkLayoutPolicy rechaza el layout UNIFICADO para AGIP', () => {
  assert.deepEqual(checkLayoutPolicy('AGIP', 'UNIFICADO', POLICY), { allowed: false, expected: ['PERCEPCION', 'RETENCION'] });
});

test('checkLayoutPolicy permite PERCEPCION y RETENCION para AGIP', () => {
  assert.equal(checkLayoutPolicy('AGIP', 'PERCEPCION', POLICY).allowed, true);
  assert.equal(checkLayoutPolicy('AGIP', 'RETENCION', POLICY).allowed, true);
});

test('checkLayoutPolicy permite cualquier layout para un tipo sin política', () => {
  assert.deepEqual(checkLayoutPolicy('IIBB_SANTA_FE', 'UNIFICADO', POLICY), { allowed: true, expected: null });
});

test('la política por defecto asigna UNIFICADO a ARBA y PERCEPCION/RETENCION a AGIP', () => {
  assert.deepEqual(getLayoutPolicy(), POLICY);
});
