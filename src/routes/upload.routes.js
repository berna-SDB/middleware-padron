const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { success, errorResponse } = require('../utils/responseBuilder');
const { loadPadronFile, getJob } = require('../services/padronLoader');
const { validatePadronFile } = require('../services/padronParser');
const { checkLayoutPolicy, describeLayout } = require('../services/layoutPolicy');
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

/**
 * Valida un archivo antes de cargarlo bajo padronType: primero la estructura
 * (fechas, CUIT, cantidad de campos) y después que el layout detectado sea uno
 * de los que ese tipo admite. Retorna null si puede cargarse, o el error a
 * responder. Nada toca la base hasta pasar por acá, así que un archivo
 * equivocado con replace=true no borra nada.
 */
async function rejectIfInvalid(filePath, padronType) {
  const validation = await validatePadronFile(filePath);
  if (!validation.valid) {
    return errorResponse('INVALID_FILE', `El archivo no tiene el formato correcto. Errores encontrados: ${validation.errors.join(' | ')}`);
  }

  const policy = checkLayoutPolicy(padronType, validation.formato);
  if (!policy.allowed) {
    logger.warn({ padronType, formato: validation.formato, expected: policy.expected }, 'Layout de archivo no admitido para el tipo de padrón');
    return errorResponse(
      'LAYOUT_MISMATCH',
      `El archivo tiene layout ${validation.formato} (${describeLayout(validation.formato)}), pero el tipo ${padronType} solo admite: ${policy.expected.join(', ')}. ` +
      'Verificá que estés subiendo el padrón correcto para esa jurisdicción.'
    );
  }

  if (policy.expected === null) {
    logger.warn({ padronType, formato: validation.formato }, 'Tipo de padrón sin política de layout, se acepta cualquier formato');
  }

  return null;
}

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

  const rejection = await rejectIfInvalid(req.file.path, upperType);
  if (rejection) {
    // Borrar archivo si no es válido
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(400).json(rejection);
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
router.post('/reload/:padronType', async (req, res) => {
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

  // El archivo es del usuario y vive fuera del UPLOAD_DIR: se rechaza pero no se borra.
  const rejection = await rejectIfInvalid(resolvedPath, upperType);
  if (rejection) {
    return res.status(400).json(rejection);
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
