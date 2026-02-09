const { Router } = require('express');
const { validateCuit } = require('../utils/cuitValidator');
const { success, errorResponse } = require('../utils/responseBuilder');
const { queryByCuit, queryByCuitRange, queryBatch } = require('../services/padronQuery');
const config = require('../config');

const router = Router();

// GET /api/v1/padron/:cuit - Consultar por CUIT
router.get('/:cuit', (req, res) => {
  const validation = validateCuit(req.params.cuit);
  if (!validation.valid) {
    return res.status(400).json(errorResponse('INVALID_CUIT', validation.error));
  }

  const { tipo, fecha } = req.query;
  const result = queryByCuit(validation.cuit, { tipo, fecha });

  if (result.count === 0) {
    return res.status(404).json(errorResponse('CUIT_NOT_FOUND', `No se encontraron registros para CUIT ${validation.cuit}`));
  }

  res.json(success(result));
});

// GET /api/v1/padron/:cuit/rango - Consultar por CUIT con rango de fechas
router.get('/:cuit/rango', (req, res) => {
  const validation = validateCuit(req.params.cuit);
  if (!validation.valid) {
    return res.status(400).json(errorResponse('INVALID_CUIT', validation.error));
  }

  const { desde, hasta, tipo } = req.query;
  if (!desde || !hasta) {
    return res.status(400).json(errorResponse('MISSING_DATES', 'Los parámetros "desde" y "hasta" son requeridos (YYYY-MM-DD)'));
  }

  const result = queryByCuitRange(validation.cuit, desde, hasta, { tipo });

  if (result.count === 0) {
    return res.status(404).json(errorResponse('CUIT_NOT_FOUND', `No se encontraron registros para CUIT ${validation.cuit} en el rango indicado`));
  }

  res.json(success(result));
});

// POST /api/v1/padron/batch - Consulta batch de múltiples CUITs
router.post('/batch', (req, res) => {
  const { cuits, tipo, fecha } = req.body;

  if (!cuits || !Array.isArray(cuits) || cuits.length === 0) {
    return res.status(400).json(errorResponse('INVALID_REQUEST', 'Se requiere un array "cuits" no vacío'));
  }

  if (cuits.length > config.MAX_BATCH_CUITS) {
    return res.status(400).json(errorResponse('TOO_MANY_CUITS', `Máximo ${config.MAX_BATCH_CUITS} CUITs por consulta`));
  }

  // Validar y normalizar todos los CUITs
  const normalizedCuits = [];
  for (const cuit of cuits) {
    const validation = validateCuit(cuit);
    if (!validation.valid) {
      return res.status(400).json(errorResponse('INVALID_CUIT', `CUIT inválido: ${cuit}`));
    }
    normalizedCuits.push(validation.cuit);
  }

  const result = queryBatch(normalizedCuits, { tipo, fecha });
  res.json(success(result));
});

module.exports = router;
