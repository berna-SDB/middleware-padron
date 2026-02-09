const { Router } = require('express');
const { success } = require('../utils/responseBuilder');
const { getStatements } = require('../database/queries');
const { getConnection } = require('../database/connection');

const router = Router();

// GET /api/v1/health
router.get('/', (req, res) => {
  const stmts = getStatements();
  const totalRecords = stmts.totalCount.get().total;
  const countByType = stmts.countByType.all();
  const metadata = stmts.getMetadata.all();

  const memUsage = process.memoryUsage();

  res.json(success({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    database: 'connected',
    totalRecords,
    padronesLoaded: countByType.map(r => ({
      tipo: r.padron_type,
      registros: r.total,
    })),
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
  const stmts = getStatements();
  const metadata = stmts.getMetadata.all();
  const countByType = stmts.countByType.all();

  res.json(success({
    padrones: countByType.map(r => {
      const meta = metadata.find(m => m.padron_type === r.padron_type);
      return {
        padronType: r.padron_type,
        totalRegistros: r.total,
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
