function success(data) {
  return {
    success: true,
    data,
    error: null,
    meta: { timestamp: new Date().toISOString() },
  };
}

function error(code, message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.body = {
    success: false,
    data: null,
    error: { code, message },
    meta: { timestamp: new Date().toISOString() },
  };
  return err;
}

function errorResponse(code, message) {
  return {
    success: false,
    data: null,
    error: { code, message },
    meta: { timestamp: new Date().toISOString() },
  };
}

module.exports = { success, error, errorResponse };
