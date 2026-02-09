const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const apiKeyAuth = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const padronRoutes = require('./routes/padron.routes');
const uploadRoutes = require('./routes/upload.routes');
const healthRoutes = require('./routes/health.routes');
const panelRoutes = require('./routes/panel.routes');

function createApp() {
  const app = express();

  // Middleware global
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(compression());
  app.use(express.json());

  // Panel web (protegido por API key via prompt del navegador)
  app.use('/panel', panelRoutes);

  // Autenticación por API key
  app.use('/api/v1', apiKeyAuth);

  // Rutas
  app.use('/api/v1/padron', padronRoutes);
  app.use('/api/v1/upload', uploadRoutes);
  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1', healthRoutes);

  // Error handler global
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
