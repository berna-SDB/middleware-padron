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

module.exports = { parsePadronDate, todayISO };
