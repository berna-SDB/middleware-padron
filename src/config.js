require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  API_KEY: process.env.API_KEY || 'change-me-in-production',
  DB_PATH: process.env.DB_PATH || './data/padron.db',
  UPLOAD_DIR: process.env.UPLOAD_DIR || './data/padrones',
  MAX_BATCH_CUITS: parseInt(process.env.MAX_BATCH_CUITS, 10) || 100,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ALLOWED_PADRON_TYPES: (process.env.ALLOWED_PADRON_TYPES || 'ARBA,AGIP,IIBB_CABA,IIBB_SANTA_FE,IIBB_CORDOBA').split(','),
};
