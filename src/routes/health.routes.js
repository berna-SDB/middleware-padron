const { Router } = require('express');
const { success } = require('../utils/responseBuilder');
const { getStatements } = require('../database/queries');
const { getStats } = require('../services/padronStats');
const { acceptedLayouts } = require('../services/layoutPolicy');

const router = Router();

// Los totales salen de la caché de estadísticas (ver padronStats.js), nunca de
// un COUNT sobre la tabla: con millones de filas eso bloqueaba el servidor.
function statsInfo(stats) {
  return {
    status: stats ? 'ok' : 'pendiente',
    computedAt: stats ? stats.computedAt : null,
  };
}

// GET /api/v1/health
router.get('/', (req, res) => {
  const stats = getStats();
  const metadata = getStatements().getMetadata.all();
  const memUsage = process.memoryUsage();

  res.json(success({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    database: 'connected',
    totalRecords: stats ? stats.total : null,
    padronesLoaded: (stats ? stats.byType : []).map(t => ({
      tipo: t.padronType,
      registros: t.total,
    })),
    stats: statsInfo(stats),
    ultimasCargas: metadata.slice(0, 5).map(m => ({
      tipo: m.padron_type,
      archivo: m.filename,
      registros: m.records_loaded,
      fecha: m.loaded_at,
      estado: m.status,
    })),
    memoria: {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
    },
  }));
});

// GET /api/v1/padron-info
router.get('/padron-info', (req, res) => {
  const stats = getStats();
  const metadata = getStatements().getMetadata.all();

  res.json(success({
    stats: statsInfo(stats),
    layoutsAdmitidos: acceptedLayouts(),
    padrones: (stats ? stats.byType : []).map(t => {
      const meta = metadata.find(m => m.padron_type === t.padronType);
      return {
        padronType: t.padronType,
        totalRegistros: t.total,
        periodos: stats.byPeriod
          .filter(p => p.padronType === t.padronType)
          .map(p => ({ regimen: p.regimen, desde: p.fechaDesde, hasta: p.fechaHasta, registros: p.total })),
        ultimaCarga: meta ? {
          archivo: meta.filename,
          registros: meta.records_loaded,
          fecha: meta.loaded_at,
          estado: meta.status,
        } : null,
      };
    }),
  }));
});

module.exports = router;
