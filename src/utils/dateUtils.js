const config = require('../config');

/**
 * Convierte fecha de formato padrón (ddMMyyyy) a ISO (YYYY-MM-DD)
 */
function parsePadronDate(ddMMyyyy) {
  if (!ddMMyyyy || ddMMyyyy.length !== 8) return null;
  const dd = ddMMyyyy.substring(0, 2);
  const mm = ddMMyyyy.substring(2, 4);
  const yyyy = ddMMyyyy.substring(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Retorna la fecha de hoy en formato ISO (YYYY-MM-DD)
 */
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Muestra un instante en la zona horaria de la empresa (config.TIMEZONE), como
 * "18/09/2026 16:21". Acepta lo que guarda SQLite con datetime('now'), que es
 * UTC sin indicador ("2026-09-18 19:21:04"), y también ISO con zona. Devuelve
 * "" si el valor viene vacío o no es una fecha. Los valores guardados no se
 * tocan: siguen en UTC.
 */
function formatLocal(value) {
  if (!value) return '';
  const text = String(value);
  // SQLite: "YYYY-MM-DD HH:MM:SS" sin zona => es UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: config.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

module.exports = { parsePadronDate, todayISO, formatLocal };
