const { tmpRoot } = require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  detectFormat, detectLayout, validatePadronFile, parsePadronFile, FORMATS, LAYOUTS, layoutFamily,
} = require('../src/services/padronParser');

const FIXTURE_UNIFICADO = path.join(__dirname, 'fixtures', 'sample-padron.txt');
const FIXTURE_ARBA_RET = path.join(__dirname, 'fixtures', 'sample-arba-retencion.txt');
const FIXTURE_ARBA_PER = path.join(__dirname, 'fixtures', 'sample-arba-percepcion.txt');
const FIXTURE_CORDOBA_PER = path.join(__dirname, 'fixtures', 'sample-percepcion.txt');

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

// ARBA y Córdoba publican percepción y retención con el mismo prefijo P/R pero
// con diseños distintos: el de ARBA (padrón de regímenes generales, "RGS") trae
// grupo en el campo 10 y termina en ";"; el de Córdoba (listado único de
// alícuotas, "LUA") tiene 9 campos, sin grupo, con marca de sujeto fija "X".

test('detectLayout distingue el P/R de ARBA (con grupo) del de Córdoba (sin grupo)', () => {
  assert.equal(detectLayout('R;27082026;01092026;30092026;20000282465;D;N;N;3,00;21;'.split(';')), 'RGS_RETENCION');
  assert.equal(detectLayout('P;27082026;01092026;30092026;20000282465;C;S;N;1,50;07;'.split(';')), 'RGS_PERCEPCION');
  assert.equal(detectLayout('P;22062026;01072026;31072026;20000780333;N;X;N;00,00'.split(';')), 'LUA_PERCEPCION');
  assert.equal(detectLayout('R;22062026;01072026;31072026;20000780333;L;X;N;02,50'.split(';')), 'LUA_RETENCION');
  assert.equal(detectLayout('27082025;01092025;30092025;20000000028;D;N;N;6,00;5,00;25;24;'.split(';')), 'UNIFICADO');
  assert.equal(detectLayout('CABECERA;x'.split(';')), null);
});

test('LAYOUTS lista los cinco layouts y layoutFamily agrupa los P/R por régimen', () => {
  assert.deepEqual(LAYOUTS, ['UNIFICADO', 'RGS_PERCEPCION', 'RGS_RETENCION', 'LUA_PERCEPCION', 'LUA_RETENCION']);
  assert.equal(layoutFamily('RGS_PERCEPCION'), 'PERCEPCION');
  assert.equal(layoutFamily('LUA_RETENCION'), 'RETENCION');
  assert.equal(layoutFamily('UNIFICADO'), 'UNIFICADO');
});

test('validatePadronFile informa el layout específico y su familia', async () => {
  const arba = await validatePadronFile(FIXTURE_ARBA_RET);
  assert.equal(arba.valid, true);
  assert.equal(arba.formato, 'RGS_RETENCION');
  assert.equal(arba.familia, 'RETENCION');
  assert.equal(arba.regimen, 'R');

  const cordoba = await validatePadronFile(FIXTURE_CORDOBA_PER);
  assert.equal(cordoba.valid, true);
  assert.equal(cordoba.formato, 'LUA_PERCEPCION');
  assert.equal(cordoba.familia, 'PERCEPCION');
  assert.equal(cordoba.regimen, 'P');
});

test('un archivo de retención de 9 campos (LUA de Córdoba) es válido: el grupo es opcional', async () => {
  const file = path.join(tmpRoot, 'cordoba-ret.txt');
  fs.writeFileSync(file, 'R;22062026;01072026;31072026;20000780333;L;X;N;02,50\n', 'latin1');
  const report = await validatePadronFile(file);
  assert.equal(report.valid, true, report.errors.join(' | '));
  assert.equal(report.formato, 'LUA_RETENCION');
});

async function collect(filePath, padronType) {
  const out = [];
  for await (const r of parsePadronFile(filePath, padronType)) out.push(r);
  return out;
}

test('el padrón de percepción de ARBA conserva el grupo de percepción del campo 10', async () => {
  const rows = await collect(FIXTURE_ARBA_PER, 'ARBA');
  assert.deepEqual(rows.map((r) => [r.regimen, r.alicuotaPercepcion, r.grupoPercepcion, r.grupoRetencion]), [
    ['P', 1.5, 7, null],
    ['P', 3, 15, null],
    ['P', 0, null, null],
  ]);
});

test('el padrón de percepción de Córdoba no trae grupo y lo deja en null', async () => {
  const rows = await collect(FIXTURE_CORDOBA_PER, 'IIBB_CORDOBA');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.regimen === 'P' && r.grupoPercepcion === null));
});
