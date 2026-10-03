// Migration pipeline. Steps are pure, idempotent, ordered. (A1)
// API: CURRENT_SCHEMA, STEPS, migrateData(data, fromSchema) -> {data, from, to, applied}, migrateLiveDb(), safeModeSignal, registerTestStep(n, fn), clearTestSteps()
// data shape: { storeName: [records...] }. Step N converts schema N -> N+1.
import { CURRENT_SCHEMA } from '../../config.js';
import { tx, get } from './db.js';
import { msg } from './validate.js';
import { appStore } from './store.js';
export { CURRENT_SCHEMA };
export const STEPS = {}; // e.g. STEPS[1] = (data) => newData   (schema 1 -> 2). Empty for schema 1.
const testSteps = {};
export function registerTestStep(n, fn) { testSteps[n] = fn; }
export function clearTestSteps() { for (const k of Object.keys(testSteps)) delete testSteps[k]; }
export const safeModeSignal = { active: false, reason: null };
export class MigrationError extends Error { constructor(code, m) { super(m || msg(code)); this.code = code; this.name = 'MigrationError'; } }
const deepClone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
function stepFor(n) { return testSteps[n] || STEPS[n]; }
/** Pure in-memory migration. target defaults to max(CURRENT_SCHEMA, highest registered test step + 1). */
export function migrateData(data, fromSchema, target) {
  if (!Number.isInteger(fromSchema) || fromSchema < 1) throw new MigrationError('I_DAMAGED');
  const maxTest = Object.keys(testSteps).map(Number).reduce((a, b) => Math.max(a, b + 1), 0);
  const to = target ?? Math.max(CURRENT_SCHEMA, maxTest);
  if (fromSchema > to) throw new MigrationError('I_NEWER');
  let cur = deepClone(data); const applied = [];
  for (let n = fromSchema; n < to; n++) {
    const fn = stepFor(n);
    if (!fn) throw new MigrationError('I_DAMAGED', `Missing migration step ${n}`);
    cur = fn(cur); applied.push(n);
  }
  return { data: cur, from: fromSchema, to, applied };
}
/** Runs steps over the live DB in ONE readwrite tx. On failure: abort, schemaVersion unchanged, safe mode. */
export async function migrateLiveDb(allStores) {
  const stores = allStores || ['meta', 'profiles', 'settings', 'foods', 'foodPrefs', 'exercises', 'plans', 'foodLogs', 'workoutLogs', 'days', 'sleepLogs', 'measurementTypes', 'measurements', 'checkins', 'photos'];
  const rec = await get('meta', 'schemaVersion');
  const from = rec ? rec.v : CURRENT_SCHEMA;
  if (from > CURRENT_SCHEMA) { safeModeSignal.active = true; safeModeSignal.reason = 'I_NEWER'; appStore.set('safeMode', true); throw new MigrationError('I_NEWER'); }
  try {
    return await tx(stores, 'readwrite', async (t) => {
      if (from === CURRENT_SCHEMA && !Object.keys(testSteps).length) {
        if (!rec) await t.store('meta').put({ k: 'schemaVersion', v: CURRENT_SCHEMA });
        return { from, to: from, applied: [] };
      }
      const data = {};
      for (const s of stores) if (s !== 'meta') data[s] = await t.store(s).getAll();
      const out = migrateData(data, from);
      for (const s of Object.keys(out.data)) {
        if (s === 'meta') continue;
        await t.store(s).clear();
        for (const r of out.data[s]) await t.store(s).put(r);
      }
      await t.store('meta').put({ k: 'schemaVersion', v: out.to });
      return out;
    });
  } catch (e) {
    safeModeSignal.active = true; safeModeSignal.reason = e.code || e.name; appStore.set('safeMode', true);
    throw e;
  }
}
