require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { detectFormat, validatePadronFile, FORMATS } = require('../src/services/padronParser');

const FIXTURE_UNIFICADO = path.join(__dirname, 'fixtures', 'sample-padron.txt');

test('el layout de 11 campos sin prefijo se llama UNIFICADO, no ARBA', () => {
  assert.ok(FORMATS.UNIFICADO, 'FORMATS.UNIFICADO debe existir');
  assert.equal(FORMATS.ARBA, undefined, 'FORMATS.ARBA no debe existir: es un nombre de jurisdicción, no de layout');
  assert.equal(FORMATS.UNIFICADO.name, 'UNIFICADO');
});

test('detectFormat reconoce una línea que arranca con fecha DDMMYYYY como UNIFICADO', () => {
  const format = detectFormat('27082025;01092025;30092025;20000000028;D;N;N;6,00;5,00;25;24;'.split(';'));
  assert.equal(format.name, 'UNIFICADO');
});

test('validatePadronFile informa formato UNIFICADO para el fixture de 11 campos', async () => {
  const report = await validatePadronFile(FIXTURE_UNIFICADO);
  assert.equal(report.valid, true);
  assert.equal(report.formato, 'UNIFICADO');
});
