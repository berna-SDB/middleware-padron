/**
 * Entorno aislado para tests. Se requiere antes que cualquier módulo de src/
 * para que config.js lea estos valores en lugar de los del .env local.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'padron-test-'));

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.API_KEY = 'test-key';
process.env.DB_PATH = path.join(tmpRoot, 'padron.db');
process.env.UPLOAD_DIR = path.join(tmpRoot, 'padrones');
process.env.ALLOWED_PADRON_TYPES = 'ARBA,AGIP,IIBB_CABA,IIBB_SANTA_FE,IIBB_CORDOBA';
delete process.env.PADRON_LAYOUTS;

module.exports = { tmpRoot };
