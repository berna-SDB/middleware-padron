const os = require('os');

/**
 * Candado de carga guardado en la base (tabla load_lock).
 *
 * Cada carga borra el período que trae el archivo y después inserta. Si dos
 * cargas del mismo período corren a la vez, la purga de la segunda solo
 * elimina lo que la primera ya insertó y todo lo que la primera inserta
 * después queda duplicado. La cola de padronLoader.js evita eso dentro de un
 * proceso; este candado lo evita entre procesos (varias instancias de PM2, un
 * proceso viejo que todavía termina) porque vive en la base y no en memoria.
 *
 * La fila tiene id fijo 1: insertarla es atómico, así que solo una carga la
 * consigue. Quien la tiene la refresca (heartbeat) mientras avanza y la borra
 * al terminar, incluso con error. Si el proceso muere sin liberarla, el
 * candado queda huérfano: se considera vencido cuando su proceso ya no existe
 * en este mismo host o cuando lleva LOCK_STALE_MS sin latir, y la siguiente
 * carga lo toma.
 */

const LOCK_STALE_MS = 30 * 60 * 1000;

/** El candado dejó de ser de este job: otro lo dio por vencido y lo tomó. */
class LoadLockLostError extends Error {
  constructor(jobId) {
    super(`El candado de carga ya no pertenece al job ${jobId}: otra carga lo dio por vencido y lo tomó`);
    this.code = 'LOAD_LOCK_LOST';
  }
}

const statementsByDb = new WeakMap();

function statements(db) {
  let stmts = statementsByDb.get(db);
  if (stmts) return stmts;

  stmts = {
    get: db.prepare(`SELECT * FROM load_lock WHERE id = 1`),
    insert: db.prepare(`
      INSERT INTO load_lock (id, job_id, padron_type, host, pid, acquired_at, heartbeat_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
    `),
    deleteAny: db.prepare(`DELETE FROM load_lock WHERE id = 1`),
    deleteOwn: db.prepare(`DELETE FROM load_lock WHERE id = 1 AND job_id = ?`),
    heartbeat: db.prepare(`UPDATE load_lock SET heartbeat_at = ? WHERE id = 1 AND job_id = ?`),
  };
  statementsByDb.set(db, stmts);
  return stmts;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: el proceso existe pero es de otro usuario.
    return err.code === 'EPERM';
  }
}

/** Un candado está vencido si su dueño ya no existe o dejó de latir. */
function isStale(holder, now = Date.now()) {
  if (now - holder.heartbeat_at > LOCK_STALE_MS) return true;
  if (holder.host === os.hostname() && !isProcessAlive(holder.pid)) return true;
  return false;
}

/**
 * Intenta tomar el candado para jobId.
 *
 * Primero mira con un SELECT simple: en modo WAL leer nunca bloquea ni se
 * bloquea, así que sondear mientras otro carga no molesta al dueño aunque
 * esté en medio de una transacción larga. Solo si el candado está libre o
 * vencido se abre una transacción inmediata, que vuelve a mirar y lo toma;
 * dos intentos simultáneos no pueden tomarlo los dos. Si esa transacción no
 * consigue el lock de escritura (SQLITE_BUSY: otro está escribiendo), se
 * informa `busy` y el llamador reintenta más tarde.
 *
 * Retorna { acquired: true, tookOverFrom } o { acquired: false, holder, busy }.
 */
function tryAcquireLoadLock(db, { jobId, padronType }) {
  const stmts = statements(db);

  const seen = stmts.get.get();
  if (seen && !isStale(seen)) {
    return { acquired: false, holder: seen, busy: false };
  }

  const attempt = db.transaction(() => {
    const holder = stmts.get.get();
    if (holder && !isStale(holder)) {
      return { acquired: false, holder, busy: false };
    }
    if (holder) stmts.deleteAny.run();
    const now = Date.now();
    stmts.insert.run(jobId, padronType, os.hostname(), process.pid, now, now);
    return { acquired: true, tookOverFrom: holder || null };
  });

  try {
    return attempt.immediate();
  } catch (err) {
    if (err.code === 'SQLITE_BUSY') {
      return { acquired: false, holder: seen || null, busy: true };
    }
    throw err;
  }
}

/**
 * Renueva el latido del candado de jobId y comprueba que sigue siendo suyo.
 * Debe llamarse como primera sentencia de cada transacción que escriba en
 * padron_entries: así la comprobación y la escritura son atómicas y una carga
 * que perdió el candado no puede escribir ni una fila más.
 */
function assertLoadLockOwner(db, jobId) {
  const { changes } = statements(db).heartbeat.run(Date.now(), jobId);
  if (changes === 0) throw new LoadLockLostError(jobId);
}

/** Libera el candado solo si sigue siendo de jobId. */
function releaseLoadLock(db, jobId) {
  return statements(db).deleteOwn.run(jobId).changes > 0;
}

function getLoadLock(db) {
  return statements(db).get.get() || null;
}

module.exports = {
  tryAcquireLoadLock, assertLoadLockOwner, releaseLoadLock, getLoadLock, isStale,
  LoadLockLostError, LOCK_STALE_MS,
};
