const config = require('../config');
const { errorResponse } = require('../utils/responseBuilder');

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== config.API_KEY) {
    return res.status(401).json(errorResponse('UNAUTHORIZED', 'API key inválida o faltante'));
  }
  next();
}

module.exports = apiKeyAuth;
