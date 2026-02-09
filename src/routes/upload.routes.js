const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { success, errorResponse } = require('../utils/responseBuilder');
const { loadPadronFile, getJob } = require('../services/padronLoader');
const { validatePadronFile } = require('../services/padronParser');
const logger = require('../logger');

const router = Router();

// Configurar multer para guardar archivos en disco
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.resolve(config.UPLOAD_DIR);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

// POST /api/v1/upload/:padronType - Subir archivo de padrón
router.post('/:padronType', upload.single('padronFile'), async (req, res) => {
  const { padronType } = req.params;
  const upperType = padronType.toUpperCase();

  if (!config.ALLOWED_PADRON_TYPES.includes(upperType)) {
    return res.status(400).json(errorResponse('INVALID_PADRON_TYPE', `Tipo de padrón no permitido: ${padronType}. Permitidos: ${config.ALLOWED_PADRON_TYPES.join(', ')}`));
  }

  if (!req.file) {
    return res.status(400).json(errorResponse('NO_FILE', 'Se requiere un archivo en el campo "padronFile"'));
  }

  // Validar estructura del archivo antes de cargar
  const validation = await validatePadronFile(req.file.path);
  if (!validation.valid) {
    // Borrar archivo si no es válido
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(400).json(errorResponse('INVALID_FILE', `El archivo no tiene el formato correcto. Errores encontrados: ${validation.errors.join(' | ')}`));
  }

  const replace = req.query.replace === 'true';
  const jobId = loadPadronFile(req.file.path, upperType, { replace });

  logger.info({ padronType: upperType, filename: req.file.originalname, jobId, replace }, 'Carga de padrón iniciada');

  res.status(202).json(success({
    message: replace ? 'Archivo recibido, reemplazando datos anteriores' : 'Archivo recibido, acumulando datos históricos',
    padronType: upperType,
    filename: req.file.originalname,
    jobId,
  }));
});

// POST /api/v1/reload/:padronType - Recargar archivo desde disco
router.post('/reload/:padronType', (req, res) => {
  const { padronType } = req.params;
  const upperType = padronType.toUpperCase();

  if (!config.ALLOWED_PADRON_TYPES.includes(upperType)) {
    return res.status(400).json(errorResponse('INVALID_PADRON_TYPE', `Tipo de padrón no permitido: ${padronType}`));
  }

  const { filePath } = req.body;
  if (!filePath) {
    return res.status(400).json(errorResponse('NO_FILE_PATH', 'Se requiere "filePath" en el body'));
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json(errorResponse('FILE_NOT_FOUND', `Archivo no encontrado: ${filePath}`));
  }

  const replace = req.query.replace === 'true';
  const jobId = loadPadronFile(resolvedPath, upperType, { replace });

  logger.info({ padronType: upperType, filePath: resolvedPath, jobId }, 'Recarga de padrón iniciada');

  res.status(202).json(success({
    message: 'Recarga iniciada',
    padronType: upperType,
    filename: path.basename(resolvedPath),
    jobId,
  }));
});

// GET /api/v1/upload/status/:jobId - Estado de carga
router.get('/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json(errorResponse('JOB_NOT_FOUND', `Job no encontrado: ${req.params.jobId}`));
  }
  res.json(success(job));
});

module.exports = router;
