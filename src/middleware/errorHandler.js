const logger = require('../logger');

function errorHandler(err, req, res, _next) {
  logger.error({ err, path: req.path }, 'Error no manejado');

  if (err.body) {
    return res.status(err.statusCode || 500).json(err.body);
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    data: null,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Error interno del servidor',
    },
    meta: { timestamp: new Date().toISOString() },
  });
}

module.exports = errorHandler;
