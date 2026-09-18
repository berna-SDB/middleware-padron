require('./helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatLocal, parsePadronDate } = require('../src/utils/dateUtils');

test('parsePadronDate convierte DDMMYYYY a ISO', () => {
  assert.equal(parsePadronDate('27082026'), '2026-08-27');
  assert.equal(parsePadronDate('2708202'), null);
});

test('formatLocal muestra lo que guarda SQLite (UTC sin zona) en hora de Argentina', () => {
  assert.equal(formatLocal('2026-09-18 19:21:04'), '18/09/2026 16:21');
  assert.equal(formatLocal('2026-09-17 22:05:52'), '17/09/2026 19:05');
  // Cambio de día: las 02:30 UTC son las 23:30 del día anterior en Argentina.
  assert.equal(formatLocal('2026-09-18 02:30:00'), '17/09/2026 23:30');
});

test('formatLocal acepta ISO con zona y devuelve vacío para valores inválidos', () => {
  assert.equal(formatLocal('2026-09-17T22:05:52.000Z'), '17/09/2026 19:05');
  assert.equal(formatLocal(null), '');
  assert.equal(formatLocal(''), '');
  assert.equal(formatLocal('no es una fecha'), '');
});
