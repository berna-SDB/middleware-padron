const config = require('./src/config');
const logger = require('./src/logger');
const { initializeSchema } = require('./src/database/schema');
const { closeConnection } = require('./src/database/connection');
const createApp = require('./src/app');

// Inicializar base de datos
initializeSchema();

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Middleware Padrón iniciado');
  logger.info(`Endpoints disponibles:`);
  logger.info(`  GET  /api/v1/padron/:cuit          - Consultar por CUIT`);
  logger.info(`  GET  /api/v1/padron/:cuit/rango     - Consultar por CUIT con rango de fechas`);
  logger.info(`  POST /api/v1/padron/batch            - Consulta batch de CUITs`);
  logger.info(`  POST /api/v1/upload/:padronType      - Subir archivo de padrón`);
  logger.info(`  POST /api/v1/upload/reload/:padronType - Recargar desde disco`);
  logger.info(`  GET  /api/v1/upload/status/:jobId    - Estado de carga`);
  logger.info(`  GET  /api/v1/health                  - Health check`);
  logger.info(`  GET  /api/v1/padron-info             - Info de padrones cargados`);
});

// Graceful shutdown
function shutdown(signal) {
  logger.info({ signal }, 'Señal de cierre recibida');
  server.close(() => {
    closeConnection();
    logger.info('Servidor cerrado correctamente');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
