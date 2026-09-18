require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLayoutPolicy,
  validateLayoutPolicy,
  checkLayoutPolicy,
  getLayoutPolicy,
} = require('../src/services/layoutPolicy');

// ARBA se carga con sus padrones de regímenes generales (RGS, prefijo P/R con
// grupo), AGIP con el unificado de 12 campos y Córdoba con su listado único de
// alícuotas (LUA, prefijo P/R sin grupo). Con eso el default frena cualquier
// archivo subido bajo el tipo equivocado entre esos tres.
const DEFAULT_POLICY = {
  ARBA: ['RGS_PERCEPCION', 'RGS_RETENCION'],
  AGIP: ['UNIFICADO'],
  IIBB_CORDOBA: ['LUA_PERCEPCION', 'LUA_RETENCION'],
};
const KNOWN = ['UNIFICADO', 'RGS_PERCEPCION', 'RGS_RETENCION', 'LUA_PERCEPCION', 'LUA_RETENCION', 'PERCEPCION', 'RETENCION'];

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
    allowedTypes: ['ARBA', 'AGIP', 'IIBB_CABA', 'IIBB_CORDOBA'],
    knownLayouts: KNOWN,
  }));
});

test('validateLayoutPolicy acepta los nombres de familia PERCEPCION y RETENCION como layouts', () => {
  assert.doesNotThrow(() => validateLayoutPolicy({ ARBA: ['PERCEPCION', 'RETENCION'] }, {
    allowedTypes: ['ARBA'],
    knownLayouts: KNOWN,
  }));
});

test('checkLayoutPolicy permite los P/R de ARBA (RGS) para ARBA y rechaza los de Córdoba (LUA)', () => {
  const expected = ['RGS_PERCEPCION', 'RGS_RETENCION'];
  assert.deepEqual(checkLayoutPolicy('ARBA', 'RGS_PERCEPCION', DEFAULT_POLICY), { allowed: true, expected });
  assert.deepEqual(checkLayoutPolicy('ARBA', 'RGS_RETENCION', DEFAULT_POLICY), { allowed: true, expected });
  assert.deepEqual(checkLayoutPolicy('ARBA', 'LUA_PERCEPCION', DEFAULT_POLICY), { allowed: false, expected });
  assert.deepEqual(checkLayoutPolicy('ARBA', 'LUA_RETENCION', DEFAULT_POLICY), { allowed: false, expected });
});

test('checkLayoutPolicy permite los P/R de Córdoba (LUA) para IIBB_CORDOBA y rechaza los de ARBA (RGS)', () => {
  const expected = ['LUA_PERCEPCION', 'LUA_RETENCION'];
  assert.deepEqual(checkLayoutPolicy('IIBB_CORDOBA', 'LUA_PERCEPCION', DEFAULT_POLICY), { allowed: true, expected });
  assert.deepEqual(checkLayoutPolicy('IIBB_CORDOBA', 'RGS_RETENCION', DEFAULT_POLICY), { allowed: false, expected });
  assert.deepEqual(checkLayoutPolicy('IIBB_CORDOBA', 'UNIFICADO', DEFAULT_POLICY), { allowed: false, expected });
});

test('checkLayoutPolicy acepta el nombre de familia en la política: PERCEPCION cubre RGS y LUA', () => {
  const policy = { ARBA: ['PERCEPCION', 'RETENCION'] };
  assert.equal(checkLayoutPolicy('ARBA', 'RGS_PERCEPCION', policy).allowed, true);
  assert.equal(checkLayoutPolicy('ARBA', 'LUA_PERCEPCION', policy).allowed, true);
  assert.equal(checkLayoutPolicy('ARBA', 'LUA_RETENCION', policy).allowed, true);
  assert.equal(checkLayoutPolicy('ARBA', 'UNIFICADO', policy).allowed, false);
});

test('checkLayoutPolicy permite el layout UNIFICADO para AGIP (es el que publica AGIP)', () => {
  assert.deepEqual(checkLayoutPolicy('AGIP', 'UNIFICADO', DEFAULT_POLICY), { allowed: true, expected: ['UNIFICADO'] });
});

test('checkLayoutPolicy rechaza el UNIFICADO para ARBA: es el archivo de AGIP subido con el tipo equivocado', () => {
  assert.deepEqual(checkLayoutPolicy('ARBA', 'UNIFICADO', DEFAULT_POLICY), { allowed: false, expected: ['RGS_PERCEPCION', 'RGS_RETENCION'] });
});

test('checkLayoutPolicy rechaza cualquier P/R para AGIP', () => {
  for (const layout of ['RGS_PERCEPCION', 'RGS_RETENCION', 'LUA_PERCEPCION', 'LUA_RETENCION']) {
    assert.deepEqual(checkLayoutPolicy('AGIP', layout, DEFAULT_POLICY), { allowed: false, expected: ['UNIFICADO'] });
  }
});

test('checkLayoutPolicy permite cualquier layout para un tipo sin política', () => {
  assert.deepEqual(checkLayoutPolicy('IIBB_SANTA_FE', 'UNIFICADO', DEFAULT_POLICY), { allowed: true, expected: null });
});

test('la política por defecto admite RGS para ARBA, UNIFICADO para AGIP y LUA para IIBB_CORDOBA', () => {
  assert.deepEqual(getLayoutPolicy(), DEFAULT_POLICY);
});
