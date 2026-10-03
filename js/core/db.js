// Promise wrapper over raw IndexedDB. (A1)
// API: openDb(name?), closeDb(), tx(stores, mode, fn) -> Promise<result of fn>, get, put, add, del, getAll(store,{index,range}), count, clear,
//  range helpers: keyRange(lower, upper), prefixRange(arr), onDbEvent(fn), isDbBlocked(), DbError, QuotaError, STORE_DEFS
// tx(): fn receives {store(name)-> helper with get/put/add/del/getAll/count/clear}; throw inside fn aborts whole tx and rejects.
import { DB_NAME, DB_VERSION } from '../../config.js';

export class DbError extends Error { constructor(m, cause) { super(m); this.name = 'DbError'; this.cause = cause; } }
export class QuotaError extends DbError { constructor(cause) { super('Storage is full. Nothing was saved.', cause); this.name = 'QuotaError'; } }

export const STORE_DEFS = [
  { name: 'meta', keyPath: 'k', indexes: [] },
  { name: 'profiles', keyPath: 'id', indexes: [] },
  { name: 'settings', keyPath: 'pid', indexes: [] },
  { name: 'foods', keyPath: 'id', indexes: [['pid', 'pid'], ['pid_nameKey', ['pid', 'nameKey']], ['pid_basedOn', ['pid', 'basedOn']]] },
  { name: 'foodPrefs', keyPath: ['pid', 'foodRef'], indexes: [['pid_fav', ['pid', 'fav']], ['pid_lastUsedAt', ['pid', 'lastUsedAt']], ['pid_useCount', ['pid', 'useCount']], ['pid', 'pid']] },
  { name: 'exercises', keyPath: 'id', indexes: [['pid', 'pid'], ['pid_nameKey', ['pid', 'nameKey']]] },
  { name: 'plans', keyPath: 'id', indexes: [['pid', 'pid'], ['pid_nameKey', ['pid', 'nameKey']]] },
  { name: 'foodLogs', keyPath: 'id', indexes: [['pid_date', ['pid', 'date']], ['pid_foodRef', ['pid', 'foodRef']], ['pid', 'pid']] },
  { name: 'workoutLogs', keyPath: 'id', indexes: [['pid_date', ['pid', 'date']], ['pid', 'pid']] },
  { name: 'days', keyPath: ['pid', 'date'], indexes: [['pid', 'pid']] },
  { name: 'sleepLogs', keyPath: 'id', indexes: [['pid_date', ['pid', 'date'], { unique: true }], ['pid', 'pid']] },
  { name: 'measurementTypes', keyPath: 'id', indexes: [['pid', 'pid']] },
  { name: 'measurements', keyPath: 'id', indexes: [['pid_typeId_date', ['pid', 'typeId', 'date']], ['pid_date', ['pid', 'date']], ['pid', 'pid']] },
  { name: 'checkins', keyPath: 'id', indexes: [['pid_date', ['pid', 'date']], ['pid', 'pid']] },
  { name: 'photos', keyPath: 'id', indexes: [['pid_date', ['pid', 'date']], ['checkinId', 'checkinId'], ['checkinId_slot', ['checkinId', 'slot'], { unique: true }], ['pid', 'pid']] },
  { name: 'photoData', keyPath: 'id', indexes: [] }
];

let dbp = null, dbName = DB_NAME, blocked = false;
const listeners = new Set();
function emit(ev) { for (const fn of [...listeners]) { try { fn(ev); } catch (e) { console.error(e); } } }
export function onDbEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isDbBlocked() { return blocked; }

function mapError(e) {
  const err = e && e.target && e.target.error ? e.target.error : e;
  if (err && err.name === 'QuotaExceededError') return new QuotaError(err);
  if (err instanceof DbError) return err;
  return err instanceof Error ? err : new DbError(String(err), err);
}
function upgrade(db, tx) {
  for (const d of STORE_DEFS) {
    const os = db.objectStoreNames.contains(d.name) ? tx.objectStore(d.name) : db.createObjectStore(d.name, { keyPath: d.keyPath });
    for (const [n, kp, opt] of d.indexes) if (!os.indexNames.contains(n)) os.createIndex(n, kp, opt || {});
  }
}
export function openDb(name) {
  if (name && name !== dbName) { dbName = name; dbp = null; }
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, req.transaction);
    req.onblocked = () => { blocked = true; emit({ type: 'blocked' }); };
    req.onsuccess = () => {
      blocked = false;
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; emit({ type: 'versionchange' }); };
      db.onclose = () => { dbp = null; emit({ type: 'close' }); };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(mapError(req.error)); };
  });
  return dbp;
}
export async function closeDb() { if (dbp) { try { (await dbp).close(); } catch { /* ignore */ } dbp = null; } }
export async function deleteDb(name = dbName) {
  await closeDb();
  return new Promise((res, rej) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => res(); r.onerror = () => rej(mapError(r.error)); r.onblocked = () => res(); });
}
const p = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = (e) => { e.preventDefault?.(); rej(mapError(req.error)); }; });
export const keyRange = (lower, upper, lo = false, uo = false) => IDBKeyRange.bound(lower, upper, lo, uo);
/** All keys starting with prefix array, e.g. ['p1'] covers ['p1', anything]. */
export const prefixRange = (arr) => IDBKeyRange.bound([...arr], [...arr, []]);

function helper(os) {
  return {
    get: (k) => p(os.get(k)),
    put: (v) => p(os.put(v)),
    add: (v) => p(os.add(v)),
    del: (k) => p(os.delete(k)),
    clear: () => p(os.clear()),
    count: (range) => p(os.count(range)),
    getAll: (opts = {}) => {
      const src = opts.index ? os.index(opts.index) : os;
      return p(src.getAll(opts.range ?? null, opts.limit));
    },
    getAllKeys: (opts = {}) => { const src = opts.index ? os.index(opts.index) : os; return p(src.getAllKeys(opts.range ?? null)); }
  };
}
async function withRetry(run) {
  try { return await run(await openDb()); }
  catch (e) {
    const retry = (e && (e.name === 'InvalidStateError' || e.name === 'TransactionInactiveError')) || (!dbp);
    if (!retry || e instanceof QuotaError) throw e;
    dbp = null; return run(await openDb());
  }
}
/** Multi-store transaction. fn({store}) may be async but must only await IDB operations. */
export function tx(stores, mode, fn) {
  const names = Array.isArray(stores) ? stores : [stores];
  const run = (db) => new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(names, mode === 'readwrite' ? 'readwrite' : 'readonly'); }
    catch (e) { reject(e); return; }
    let result, failed = null, done = false;
    t.oncomplete = () => { done = true; resolve(result); };
    t.onabort = () => { if (!done) reject(failed || mapError(t.error) || new DbError('Transaction aborted')); };
    t.onerror = () => { if (!failed) failed = mapError(t.error); };
    const api = { store: (n) => helper(t.objectStore(n)) };
    Promise.resolve().then(() => fn(api)).then((r) => { result = r; }, (err) => { failed = mapError(err); try { t.abort(); } catch { /* already finished */ } });
  });
  return withRetry(run);
}
const one = (store, mode, f) => tx([store], mode, (t) => f(t.store(store)));
export const get = (store, key) => one(store, 'readonly', (s) => s.get(key));
export const put = (store, val) => one(store, 'readwrite', (s) => s.put(val));
export const add = (store, val) => one(store, 'readwrite', (s) => s.add(val));
export const del = (store, key) => one(store, 'readwrite', (s) => s.del(key));
export const clear = (store) => one(store, 'readwrite', (s) => s.clear());
export const count = (store, range) => one(store, 'readonly', (s) => s.count(range));
export const getAll = (store, opts) => one(store, 'readonly', (s) => s.getAll(opts));
