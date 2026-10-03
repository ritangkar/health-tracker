// Data access layer. EVERY user query is filtered by pid (DAT-021). (A1)
// Unfiltered reads are only allowed where marked "ALLOW-UNFILTERED" (integrity + backup helpers).
// PUBLIC API (all async unless noted; pid = profile id)
//  ids:       newId(type) sync, nameKey(s) sync, ValidationError
//  init:      initRepo() -> {schemaVersion}
//  profiles:  listProfiles({includeArchived}), getProfile(id), createProfile(name,{targets?}), renameProfile(id,name), archiveProfile(id)
//  settings:  getSettings(pid), updateSettings(pid,patch), setTargets(pid,targets,dateKey?), hideSeed(pid,kind,ref), unhideSeed(pid,kind,ref), setUiPrefs(pid,patch)
//  masters:   saveFood(pid,food) / saveExercise(pid,ex) / savePlan(pid,plan) -> saved rec (new id fd_/xe_/pl_; seed id => copy-on-edit with basedOn+supersedes; custom => rev++)
//             listFoods(pid) listExercises(pid) listPlans(pid) (custom + copies only)  getFood/getExercise/getPlan(pid,id)
//             archiveFood(pid,id) deleteFood/deleteExercise/deletePlan(pid,id) (custom; seed ids => hidden via hiddenSeed)
//             resetToDefault(store,pid,id)  duplicatePlanFor(pid,plan) -> new plan
//  prefs:     listPrefs(pid), toggleFavourite(pid,foodRef), recentFoodRefs(pid,limit), frequentFoodRefs(pid,limit), rebuildPrefs(pid)
//  foodLogs:  addFoodLog(pid,{date,food,serving,qty,meal,note}), quickAddFoodLog(pid,{date,name,kcal,protein,carbs,fat,fiber,meal,sourceType,note}),
//             editFoodLog(pid,id,{qty,mealId,mealLabel,note}), changeFoodLogServing(pid,id,{food,serving,qty}), deleteFoodLog(pid,id)->deletedRec,
//             restoreFoodLog(pid,rec), getFoodLogs(pid,date), getFoodLogsRange(pid,from,to), getFoodLog(pid,id)
//  workouts:  createWorkoutLog(pid,{date,plan,resolveExercise,altPicks}), getWorkoutLog(pid,id), getWorkoutLogs(pid,date), getWorkoutLogsRange(pid,from,to),
//             updateWorkoutItem(pid,logId,itemId,patch), markAllAsTarget(pid,logId), setWorkoutBodyWeight(pid,logId,kg), switchWorkoutAlt(pid,logId,itemId,exercise),
//             setWorkoutNote(pid,logId,note), deleteWorkoutLog(pid,id)->rec, restoreWorkoutLog(pid,rec)
//  days:      getDay(pid,date), getDaysRange(pid,from,to), setWater(pid,date,glasses|null), addWater(pid,date,delta), setSteps(pid,date,count|null),
//             setStepGoalManual(pid,date,goal), applyPlanStepGoal(pid,date,plan), setDayNote(pid,date,{text,tags}), effectiveStepGoal(pid,date)
//  sleep:     upsertSleep(pid,wakeDate,{bed,wake,durationMin,quality,napMin,note}), getSleep(pid,date), getSleepRange(pid,from,to), deleteSleep(pid,date)
//  body:      addMeasurement(pid,{typeId,date,value,note}), editMeasurement(pid,id,patch), deleteMeasurement(pid,id), measurementSeries(pid,typeId,from?,to?),
//             latestMeasurements(pid), getWeightMeasurements(pid)
//  checkins:  saveCheckinWithPhotos(pid,checkin,photos,{removeSlots,writeMeasurements}), getCheckin(pid,id), listCheckins(pid), deleteCheckin(pid,id),
//             listPhotos(pid,checkinId), getPhotoBlob(pid,photoId,full)
//  integrity: integrityScan(pid?), cleanupOrphans(scan)
//  backup:    EXPORT_STORES, USER_STORES, readStoreAll(name), countStores(), txAll(mode,fn)   (A2 builds backup/import on these)
import * as db from './db.js';
import { tx, prefixRange, keyRange } from './db.js';
import * as C from './calc.js';
import * as V from './validate.js';
import { migrateLiveDb } from './migrate.js';
import { noteWrite, check as storageCheck } from './storage-health.js';
import { fromKey, durationFromTimes, todayKey, addDays } from './dates.js';
import { CURRENT_SCHEMA, DEFAULT_TARGETS, DEFAULT_STEP_GOAL, DEFAULT_GLASS_ML, PHOTO } from '../../config.js';

export class ValidationError extends Error { constructor(result) { super(result.hard[0]?.message || 'Invalid'); this.name = 'ValidationError'; this.result = result; this.code = result.hard[0]?.code; } }
const need = (r) => { if (!r.ok) throw new ValidationError(r); return r; };
const now = () => Date.now();
const only = (pid) => IDBKeyRange.only(pid);
export function newId(type) { return `${type}_${now().toString(36)}_${Math.random().toString(36).slice(2, 7).padEnd(5, '0')}`; }
export function nameKey(s) { return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
const own = (rec, pid) => { if (rec && rec.pid !== pid) throw new Error('Record belongs to another profile'); return rec; };
const listByPid = (store, pid) => db.getAll(store, { index: 'pid', range: only(pid) });
const inRange = (store, pid, from, to) => db.getAll(store, { index: 'pid_date', range: keyRange([pid, from], [pid, to]) });
const done = async (v) => { await noteWrite(); return v; };

export const EXPORT_STORES = ['profiles', 'settings', 'foods', 'foodPrefs', 'exercises', 'plans', 'foodLogs', 'workoutLogs', 'days', 'sleepLogs', 'measurementTypes', 'measurements', 'checkins', 'photos'];
export const USER_STORES = [...EXPORT_STORES, 'photoData'];
export async function readStoreAll(name) { return db.getAll(name); } // ALLOW-UNFILTERED (backup)
export async function countStores() { const o = {}; for (const s of USER_STORES) o[s] = await db.count(s); return o; }
export const txAll = (mode, fn) => tx([...USER_STORES, 'meta'], mode, fn);

export async function initRepo() {
  await db.openDb();
  await migrateLiveDb();
  const m = await db.get('meta', 'schemaVersion');
  if (!m) await db.put('meta', { k: 'schemaVersion', v: CURRENT_SCHEMA });
  return { schemaVersion: CURRENT_SCHEMA };
}

// ---------------- profiles ----------------
export async function listProfiles({ includeArchived = false } = {}) {
  const all = await db.getAll('profiles'); // ALLOW-UNFILTERED (profiles are the partition root)
  return all.filter((p) => includeArchived || !p.archivedAt).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt);
}
export const getProfile = (id) => db.get('profiles', id);
function defaultSettings(pid) {
  return { pid, units: 'metric', weekStart: 'mon', glassMl: DEFAULT_GLASS_ML, defaultStepGoal: DEFAULT_STEP_GOAL, targetsHistory: [], hiddenSeed: { foods: [], exercises: [], plans: [] }, mealCategories: null, reminder: { intervalDays: 7 }, uiPrefs: { openLastProfile: false, checkinIntervalDays: 7 }, updatedAt: now() };
}
export async function createProfile(name, { targets } = {}) {
  need(V.checkName(name, 40));
  const existing = await db.getAll('profiles'); // ALLOW-UNFILTERED
  const t = now();
  const p = { id: newId('p'), name: V.cleanText(name), createdAt: t, updatedAt: t, sortOrder: existing.length, archivedAt: null };
  const s = defaultSettings(p.id);
  if (targets) { need(V.checkTargets(targets)); s.targetsHistory = [{ from: todayKey(), ...targets }]; }
  await tx(['profiles', 'settings'], 'readwrite', async (x) => { await x.store('profiles').put(p); await x.store('settings').put(s); });
  return done(p);
}
export async function renameProfile(id, name) {
  need(V.checkName(name, 40));
  const p = await db.get('profiles', id); if (!p) throw new Error('No such profile');
  const n = { ...p, name: V.cleanText(name), updatedAt: now() }; await db.put('profiles', n); return done(n);
}
export async function archiveProfile(id) {
  const p = await db.get('profiles', id); if (!p) throw new Error('No such profile');
  const n = { ...p, archivedAt: now(), updatedAt: now() }; await db.put('profiles', n); return done(n);
}

// ---------------- settings ----------------
export async function getSettings(pid) { return (await db.get('settings', pid)) || defaultSettings(pid); }
export async function updateSettings(pid, patch) {
  const cur = await getSettings(pid);
  const n = { ...cur, ...patch, pid, updatedAt: now() };
  need(V.validateRecord('settings', n));
  await db.put('settings', n); return done(n);
}
export async function setTargets(pid, targets, dateKey = todayKey()) {
  need(V.checkTargets(targets));
  const cur = await getSettings(pid);
  const hist = cur.targetsHistory.filter((e) => e.from !== dateKey);
  hist.push({ from: dateKey, ...targets }); hist.sort((a, b) => (a.from < b.from ? -1 : 1));
  return updateSettings(pid, { targetsHistory: hist });
}
export async function hideSeed(pid, kind, ref) {
  const cur = await getSettings(pid); const list = new Set(cur.hiddenSeed[kind] || []); list.add(ref);
  return updateSettings(pid, { hiddenSeed: { ...cur.hiddenSeed, [kind]: [...list] } });
}
export async function unhideSeed(pid, kind, ref) {
  const cur = await getSettings(pid);
  return updateSettings(pid, { hiddenSeed: { ...cur.hiddenSeed, [kind]: (cur.hiddenSeed[kind] || []).filter((x) => x !== ref) } });
}
export async function setUiPrefs(pid, patch) { const cur = await getSettings(pid); return updateSettings(pid, { uiPrefs: { ...cur.uiPrefs, ...patch } }); }

// ---------------- masters (foods / exercises / plans) ----------------
const M = {
  foods: { prefix: 'fd', seedPrefix: 'f:', hidden: 'foods', type: 'food' },
  exercises: { prefix: 'xe', seedPrefix: 'ex:', hidden: 'exercises', type: 'exercise' },
  plans: { prefix: 'pl', seedPrefix: 'plan:', hidden: 'plans', type: 'plan' }
};
async function saveMaster(store, pid, rec) {
  const m = M[store]; const t = now();
  if (rec.pid && rec.pid !== pid) throw new Error('Record belongs to another profile');
  const base = { ...rec, pid, name: V.cleanText(rec.name), nameKey: nameKey(rec.name) };
  if (store === 'foods' && base.nutrition) { base.confidence = base.origin === 'restaurant' ? 'estimate' : base.confidence; }
  let out;
  if (!rec.id) out = { ...base, id: newId(m.prefix), system: false, createdAt: t, updatedAt: t, rev: 1 };
  else if (String(rec.id).startsWith(m.seedPrefix)) {
    const copies = (await listByPid(store, pid)).filter((c) => c.basedOn === rec.id);
    if (copies.length) out = { ...base, id: copies[0].id, basedOn: rec.id, supersedes: rec.id, system: false, createdAt: copies[0].createdAt, updatedAt: t, rev: (copies[0].rev || 1) + 1 };
    else out = { ...base, id: newId(m.prefix), basedOn: rec.id, supersedes: rec.id, system: false, createdAt: t, updatedAt: t, rev: (rec.rev || 1) + 1 };
  } else {
    const cur = await db.get(store, rec.id); own(cur, pid);
    out = { ...base, createdAt: cur?.createdAt ?? t, updatedAt: t, rev: (cur?.rev || 0) + 1 };
  }
  need(V.validateRecord(store, out));
  await db.put(store, out); return done(out);
}
export const saveFood = (pid, f) => saveMaster('foods', pid, f);
export const saveExercise = (pid, x) => saveMaster('exercises', pid, x);
export const savePlan = (pid, p) => saveMaster('plans', pid, p);
export const listFoods = (pid) => listByPid('foods', pid);
export const listExercises = (pid) => listByPid('exercises', pid);
export const listPlans = (pid) => listByPid('plans', pid);
const getOwn = async (store, pid, id) => own(await db.get(store, id), pid) || null;
export const getFood = (pid, id) => getOwn('foods', pid, id);
export const getExercise = (pid, id) => getOwn('exercises', pid, id);
export const getPlan = (pid, id) => getOwn('plans', pid, id);
export async function archiveFood(pid, id) { const f = await getFood(pid, id); if (!f) throw new Error('No such food'); const n = { ...f, archivedAt: now(), updatedAt: now() }; await db.put('foods', n); return done(n); }
async function deleteMaster(store, pid, id) {
  const m = M[store];
  if (String(id).startsWith(m.seedPrefix)) return hideSeed(pid, m.hidden, id);
  await tx(store === 'foods' ? ['foods', 'foodPrefs'] : [store], 'readwrite', async (x) => {
    const cur = await x.store(store).get(id); own(cur, pid);
    if (!cur) return;
    await x.store(store).del(id);
    if (store === 'foods') await x.store('foodPrefs').del([pid, id]);
  });
  return done(true);
}
export const deleteFood = (pid, id) => deleteMaster('foods', pid, id);
export const deleteExercise = (pid, id) => deleteMaster('exercises', pid, id);
export const deletePlan = (pid, id) => deleteMaster('plans', pid, id);
/** Deletes the profile's copy so the seed original shows again. Also un-hides a hidden seed id. */
export async function resetToDefault(store, pid, id) {
  const m = M[store];
  const rec = String(id).startsWith(m.seedPrefix) ? null : await db.get(store, id);
  if (rec) own(rec, pid);
  const seedId = rec ? rec.basedOn : id;
  if (rec) await deleteMaster(store, pid, id);
  if (seedId) await unhideSeed(pid, m.hidden, seedId);
  return done(seedId || null);
}
export async function duplicatePlanFor(pid, plan) {
  const copy = C.duplicatePlan({ ...plan, pid }, newId);
  delete copy.basedOn; delete copy.supersedes; copy.nameKey = nameKey(copy.name); copy.system = false;
  need(V.validateRecord('plans', copy));
  await db.put('plans', copy); return done(copy);
}

// ---------------- foodPrefs ----------------
export const listPrefs = (pid) => db.getAll('foodPrefs', { range: prefixRange([pid]) });
async function refreshPref(x, pid, foodRef) {
  if (!foodRef) return;
  const logs = await x.store('foodLogs').getAll({ index: 'pid_foodRef', range: keyRange([pid, foodRef], [pid, foodRef]) });
  const cur = await x.store('foodPrefs').get([pid, foodRef]);
  if (!logs.length && !(cur && cur.fav)) { await x.store('foodPrefs').del([pid, foodRef]); return; }
  logs.sort((a, b) => (a.loggedAt || 0) - (b.loggedAt || 0));
  const last = logs[logs.length - 1];
  await x.store('foodPrefs').put({ pid, foodRef, fav: cur?.fav ? 1 : 0, useCount: logs.length, lastUsedAt: last?.loggedAt ?? null, lastServingId: last?.servingId ?? null, lastQty: last?.qty ?? null, lastMealId: last?.mealId ?? null, updatedAt: now() });
}
export async function toggleFavourite(pid, foodRef) {
  let res;
  await tx(['foodPrefs'], 'readwrite', async (x) => {
    const cur = await x.store('foodPrefs').get([pid, foodRef]);
    res = { ...(cur || { pid, foodRef, useCount: 0, lastUsedAt: null }), fav: cur?.fav ? 0 : 1, updatedAt: now() };
    await x.store('foodPrefs').put(res);
  });
  return done(res);
}
export async function recentFoodRefs(pid, limit = 20) { return (await listPrefs(pid)).filter((p) => p.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, limit); }
export async function frequentFoodRefs(pid, limit = 20) { return (await listPrefs(pid)).filter((p) => p.useCount > 0).sort((a, b) => b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt).slice(0, limit); }
export async function rebuildPrefs(pid) {
  await tx(['foodLogs', 'foodPrefs'], 'readwrite', async (x) => {
    const logs = await x.store('foodLogs').getAll({ index: 'pid', range: only(pid) });
    const prefs = await x.store('foodPrefs').getAll({ range: prefixRange([pid]) });
    const refs = new Set(logs.map((l) => l.foodRef).filter(Boolean));
    for (const p of prefs) { if (p.fav) refs.add(p.foodRef); else if (!refs.has(p.foodRef)) await x.store('foodPrefs').del([pid, p.foodRef]); }
    for (const r of refs) await refreshPref(x, pid, r);
  });
  return done(true);
}

// ---------------- food logs ----------------
const OTHER = { id: 'meal:other', label: 'Other' };
export async function addFoodLog(pid, { date, food, serving, qty, meal = OTHER, note = null }) {
  need(V.checkDate(date));
  const snap = C.foodLogSnapshot(food, serving, V.num(qty), meal);
  const sv = serving || C.implicitServing(food);
  need(V.checkFoodQty(snap.qty, snap.servingBaseAmount, snap.totals.kcal, food.nutrition.per.unit !== 'serving' && sv?.implicit !== false));
  const t = now();
  const rec = { id: newId('fl'), pid, date, loggedAt: t, ...snap, servingId: sv?.id ?? null, quick: false, note, createdAt: t, updatedAt: t };
  need(V.validateRecord('foodLogs', rec));
  await tx(['foodLogs', 'foodPrefs'], 'readwrite', async (x) => { await x.store('foodLogs').put(rec); await refreshPref(x, pid, rec.foodRef); });
  return done(rec);
}
export async function quickAddFoodLog(pid, { date, name = 'Quick add', kcal, protein = null, carbs = null, fat = null, fiber = null, meal = OTHER, sourceType = 'user', note = null }) {
  need(V.checkDate(date));
  const kc = V.num(kcal);
  if (kc === null || !Number.isFinite(kc)) need({ ok: false, hard: [{ code: 'V_REQUIRED', field: 'Calories', message: V.msg('V_REQUIRED', { field: 'Calories' }) }], soft: [] });
  const nz = (v) => { const n = V.num(v); return n === null || !Number.isFinite(n) ? null : n; };
  const per1serving = { kcal: kc, protein: nz(protein), carbs: nz(carbs), fat: nz(fat), fiber: nz(fiber) }; // untyped macros stay null = not entered (F-A8-04, D-038)
  need(V.checkFoodNutrition({ per: { unit: 'serving', amount: 1 }, kcal: kc, protein: per1serving.protein ?? 0, carbs: per1serving.carbs ?? 0, fat: per1serving.fat ?? 0, fiber: per1serving.fiber }));
  const t = now();
  const rec = { id: newId('fl'), pid, date, loggedAt: t, mealId: meal.id, mealLabel: meal.label, foodRef: null, foodKind: 'food', foodName: V.cleanText(name) || 'Quick add', origin: null, confidence: sourceType === 'label' ? 'typical' : 'estimate', servingLabel: '1 serving', servingUnit: 'serving', servingBaseAmount: 1, basisUnit: 'serving', servingId: null, qty: 1, per1serving, totals: C.totalsFor(per1serving, 1), quick: true, sourceType, source: { type: sourceType === 'label' ? 'label' : 'user' }, note, createdAt: t, updatedAt: t };
  await db.put('foodLogs', rec); return done(rec);
}
export const getFoodLog = (pid, id) => getOwn('foodLogs', pid, id);
export const getFoodLogs = (pid, date) => inRange('foodLogs', pid, date, date);
export const getFoodLogsRange = (pid, from, to) => inRange('foodLogs', pid, from, to);
/** Recomputes from the log's OWN snapshot only. */
export async function editFoodLog(pid, id, { qty, mealId, mealLabel, note }) {
  const cur = await getFoodLog(pid, id); if (!cur) throw new Error('No such entry');
  const n = { ...cur, updatedAt: now() };
  if (qty !== undefined) { const q = V.num(qty); need(V.checkFoodQty(q, cur.servingBaseAmount, C.totalsFor(cur.per1serving, q).kcal, cur.basisUnit !== 'serving')); n.qty = q; n.totals = C.totalsFor(cur.per1serving, q); }
  if (mealId !== undefined) { n.mealId = mealId; n.mealLabel = mealLabel ?? n.mealLabel; }
  if (note !== undefined) n.note = note;
  await db.put('foodLogs', n); return done(n);
}
/** Explicit: takes a NEW snapshot from the current master. */
export async function changeFoodLogServing(pid, id, { food, serving, qty }) {
  const cur = await getFoodLog(pid, id); if (!cur) throw new Error('No such entry');
  const snap = C.foodLogSnapshot(food, serving, V.num(qty ?? cur.qty), { id: cur.mealId, label: cur.mealLabel });
  const sv = serving || C.implicitServing(food);
  const n = { ...cur, ...snap, servingId: sv?.id ?? null, quick: false, updatedAt: now() };
  need(V.checkFoodQty(n.qty, n.servingBaseAmount, n.totals.kcal));
  await tx(['foodLogs', 'foodPrefs'], 'readwrite', async (x) => { await x.store('foodLogs').put(n); await refreshPref(x, pid, cur.foodRef); await refreshPref(x, pid, n.foodRef); });
  return done(n);
}
export async function deleteFoodLog(pid, id) {
  let rec = null;
  await tx(['foodLogs', 'foodPrefs'], 'readwrite', async (x) => { rec = await x.store('foodLogs').get(id); own(rec, pid); if (!rec) return; await x.store('foodLogs').del(id); await refreshPref(x, pid, rec.foodRef); });
  await done(true); return rec;
}
export async function restoreFoodLog(pid, rec) {
  own(rec, pid);
  await tx(['foodLogs', 'foodPrefs'], 'readwrite', async (x) => { await x.store('foodLogs').put(rec); await refreshPref(x, pid, rec.foodRef); });
  return done(rec);
}

// ---------------- workouts ----------------
export const getWorkoutLog = (pid, id) => getOwn('workoutLogs', pid, id);
export const getWorkoutLogs = (pid, date) => inRange('workoutLogs', pid, date, date);
export const getWorkoutLogsRange = (pid, from, to) => inRange('workoutLogs', pid, from, to);
export async function getWeightMeasurements(pid) { return measurementSeries(pid, 'mt:weight'); }
function recomputeLog(log) {
  const items = log.items.map((i) => C.computeItem(i, log.bodyWeightKg));
  const ks = items.map((i) => i.kcalFinal).filter((k) => k != null);
  return { ...log, items, completionPct: C.sessionCompletion(items), kcalTotal: ks.length ? C.round1(ks.reduce((a, b) => a + b, 0)) : null, updatedAt: now() };
}
/** resolveExercise(id) -> exercise master (seed or custom), sync. altPicks {itemId: exerciseId}. */
export async function createWorkoutLog(pid, { date, plan, resolveExercise = () => null, altPicks = {} }) {
  need(V.checkDate(date));
  const bw = C.bodyWeightFor(date, await getWeightMeasurements(pid));
  const items = (plan.items || []).map((it) => {
    const exId = altPicks[it.itemId] || it.exerciseId;
    const ex = resolveExercise(exId) || resolveExercise(it.exerciseId);
    const basis = it.kcalOverride ? { basis: it.kcalOverride.basis, value: it.kcalOverride.value, refWeightKg: 70, scaleByWeight: false } : (ex?.kcal || it.kcalSnap || null);
    return {
      itemId: it.itemId, exerciseRef: exId, exerciseName: ex?.name ?? it.exerciseName, targetKind: it.targetKind, target: it.target, targetMax: it.targetMax ?? null, perSide: !!it.perSide,
      altExerciseIds: it.altExerciseIds || [], kcalBasis: basis, kcalOverrideUsed: !!it.kcalOverride, actual: null, manualPct: null, pct: null, pctSource: null, kcalEst: null, kcalFinal: null, kcalLogOverride: null, note: it.note ?? null
    };
  });
  const t = now();
  const log = { id: newId('wl'), pid, date, startedAt: t, planRef: plan.id, planName: plan.name, planRev: plan.rev ?? 1, isRest: !!plan.isRest, stepGoalSnap: plan.stepGoal ?? null, items, completionPct: null, kcalTotal: null, bodyWeightKg: bw.kg, weightSource: bw.source, weightDate: bw.date, weightStale: bw.stale, note: null, createdAt: t, updatedAt: t };
  need(V.validateRecord('workoutLogs', log));
  await db.put('workoutLogs', log); return done(log);
}
async function mutateLog(pid, id, fn) {
  let out;
  await tx(['workoutLogs'], 'readwrite', async (x) => {
    const cur = await x.store('workoutLogs').get(id); own(cur, pid); if (!cur) throw new Error('No such workout');
    out = recomputeLog(fn(structuredClone(cur))); need(V.validateRecord('workoutLogs', out));
    await x.store('workoutLogs').put(out);
  });
  return done(out);
}
export function updateWorkoutItem(pid, logId, itemId, patch) {
  return mutateLog(pid, logId, (log) => {
    const it = log.items.find((i) => i.itemId === itemId); if (!it) throw new Error('No such exercise');
    if ('actual' in patch) { const r = V.checkActual(it.targetKind, patch.actual); need(r); it.actual = r.value; }
    if ('manualPct' in patch) { const r = V.checkManualPct(patch.manualPct); need(r); it.manualPct = r.value; }
    if ('kcalLogOverride' in patch) { const r = V.checkKcalOverride(patch.kcalLogOverride); need(r); it.kcalLogOverride = r.value; }
    if ('note' in patch) it.note = patch.note;
    return log;
  });
}
export function markAllAsTarget(pid, logId) {
  return mutateLog(pid, logId, (log) => { for (const it of log.items) if (it.manualPct == null) it.actual = it.target; return log; });
}
export function setWorkoutBodyWeight(pid, logId, kg) {
  const r = V.checkWeight(kg); need(r);
  return mutateLog(pid, logId, (log) => { log.bodyWeightKg = r.value; log.weightSource = 'manual'; log.weightDate = null; log.weightStale = false; return log; });
}
export function switchWorkoutAlt(pid, logId, itemId, exercise) {
  return mutateLog(pid, logId, (log) => {
    const it = log.items.find((i) => i.itemId === itemId); if (!it) throw new Error('No such exercise');
    it.exerciseRef = exercise.id; it.exerciseName = exercise.name;
    if (!it.kcalOverrideUsed && exercise.kcal) it.kcalBasis = exercise.kcal;
    if (exercise.targetKind && exercise.targetKind !== it.targetKind) { it.targetKind = exercise.targetKind; it.target = exercise.defaultTarget ?? it.target; it.targetMax = exercise.defaultTargetMax ?? null; it.actual = null; it.manualPct = null; }
    return log;
  });
}
export const setWorkoutNote = (pid, logId, note) => mutateLog(pid, logId, (l) => { l.note = note; return l; });
export async function deleteWorkoutLog(pid, id) { const rec = await getWorkoutLog(pid, id); if (!rec) return null; await db.del('workoutLogs', id); await done(true); return rec; }
export async function restoreWorkoutLog(pid, rec) { own(rec, pid); await db.put('workoutLogs', rec); return done(rec); }

// ---------------- days ----------------
async function emptyDay(pid, date) {
  const s = await getSettings(pid); const t = now();
  return { pid, date, water: { glasses: null, glassMl: s.glassMl, ml: null }, steps: { count: null }, stepGoal: s.defaultStepGoal, stepGoalSource: 'default', note: null, flags: {}, createdAt: t, updatedAt: t };
}
export async function getDay(pid, date) { return (await db.get('days', [pid, date])) || null; }
export const getDaysRange = (pid, from, to) => db.getAll('days', { range: keyRange([pid, from], [pid, to]) });
async function mutateDay(pid, date, fn) {
  need(V.checkDate(date));
  const cur = (await getDay(pid, date)) || (await emptyDay(pid, date));
  const n = fn(structuredClone(cur)); n.updatedAt = now(); need(V.validateRecord('days', n));
  await db.put('days', n); return done(n);
}
export function setWater(pid, date, glasses) {
  const r = V.checkWater(glasses); need(r);
  return mutateDay(pid, date, (d) => { d.water.glasses = r.value; d.water.ml = r.value === null ? null : r.value * d.water.glassMl; return d; });
}
export async function addWater(pid, date, delta) {
  const cur = await getDay(pid, date); const base = cur?.water?.glasses ?? 0;
  return setWater(pid, date, Math.max(0, base + delta));
}
export function setSteps(pid, date, count) { const r = V.checkSteps(count); need(r); return mutateDay(pid, date, (d) => { d.steps.count = r.value; return d; }); }
export function setStepGoalManual(pid, date, goal) { const r = V.checkStepGoal(goal); need(r); return mutateDay(pid, date, (d) => { if (r.value === null) { d.stepGoal = null; d.stepGoalSource = 'default'; } else { d.stepGoal = r.value; d.stepGoalSource = 'manual'; } return d; }); }
/** Choosing a plan sets the goal, unless the user set it manually (C-027). */
export async function applyPlanStepGoal(pid, date, plan) {
  return mutateDay(pid, date, (d) => { if (d.stepGoalSource !== 'manual' && plan?.stepGoal) { d.stepGoal = plan.stepGoal; d.stepGoalSource = 'plan'; } return d; });
}
export function setDayNote(pid, date, note) {
  need(V.checkDayNote(note));
  return mutateDay(pid, date, (d) => { d.note = note && (note.text || (note.tags || []).length) ? { text: note.text ?? '', tags: note.tags || [] } : null; return d; });
}
export async function effectiveStepGoal(pid, date) { const d = await getDay(pid, date); if (d?.stepGoal) return { goal: d.stepGoal, source: d.stepGoalSource }; return { goal: (await getSettings(pid)).defaultStepGoal, source: 'default' }; }

// ---------------- sleep ----------------
export const getSleep = async (pid, date) => (await inRange('sleepLogs', pid, date, date))[0] || null;
export const getSleepRange = (pid, from, to) => inRange('sleepLogs', pid, from, to);
export async function upsertSleep(pid, wakeDate, { bed, wake, durationMin, quality = null, napMin = null, note = null }) {
  need(V.checkDate(wakeDate));
  let bedAt = null, wakeAt = null, dur = V.num(durationMin), source = 'manual';
  if (bed && wake) {
    need(V.checkTime(bed)); need(V.checkTime(wake));
    const d = durationFromTimes(wakeDate, bed, wake);
    bedAt = d.bedAt; wakeAt = d.wakeAt; dur = d.durationMin; source = 'times';
  }
  const q = V.num(quality), nap = V.num(napMin);
  need(V.checkSleep({ durationMin: dur, napMin: nap, quality: q, bedAt, wakeAt }));
  if (dur === null) need(V.checkSleep({ durationMin: null }));
  const cur = await getSleep(pid, wakeDate); const t = now();
  const rec = { id: cur?.id ?? newId('sl'), pid, date: wakeDate, bedAt, wakeAt, durationMin: dur, durationSource: source, quality: q, napMin: nap, note, createdAt: cur?.createdAt ?? t, updatedAt: t };
  await db.put('sleepLogs', rec); return done(rec);
}
export async function deleteSleep(pid, date) { const cur = await getSleep(pid, date); if (cur) await db.del('sleepLogs', cur.id); return done(cur); }

// ---------------- measurements ----------------
const UNITS = { weight: 'kg', height: 'cm', bodyFat: '%' };
const unitFor = (typeId) => UNITS[String(typeId).replace(/^mt:/, '')] || 'cm';
const byDate = (a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1);
export async function measurementSeries(pid, typeId, from = '0000-01-01', to = '9999-12-31') {
  return (await db.getAll('measurements', { index: 'pid_typeId_date', range: keyRange([pid, typeId, from], [pid, typeId, to]) })).sort(byDate);
}
export async function addMeasurement(pid, { typeId, date, value, note = null, entered = null, checkinId = null }) {
  need(V.checkDate(date)); const r = V.checkMeasurement(typeId, value); need(r);
  const t = now();
  const rec = { id: newId('ms'), pid, typeId, date, value: r.value, unit: unitFor(typeId), entered, note, checkinId, createdAt: t, updatedAt: t };
  await db.put('measurements', rec); return done(rec);
}
export async function editMeasurement(pid, id, patch) {
  const cur = await getOwn('measurements', pid, id); if (!cur) throw new Error('No such measurement');
  const n = { ...cur, ...patch, updatedAt: now() };
  need(V.checkDate(n.date)); const r = V.checkMeasurement(n.typeId, n.value); need(r); n.value = r.value;
  await db.put('measurements', n); return done(n);
}
export async function deleteMeasurement(pid, id) { const cur = await getOwn('measurements', pid, id); if (cur) await db.del('measurements', id); return done(cur); }
export async function latestMeasurements(pid) {
  const all = (await listByPid('measurements', pid)).sort(byDate); const out = {};
  for (const m of all) { const l = out[m.typeId] || (out[m.typeId] = { latest: null, previous: null }); l.previous = l.latest; l.latest = m; }
  return out;
}

// ---------------- check-ins + photos ----------------
export const getCheckin = (pid, id) => getOwn('checkins', pid, id);
export async function listCheckins(pid) { return (await listByPid('checkins', pid)).sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)); }
/** All photo metadata of one profile in ONE read (F-A11-04), newest date first not guaranteed; group by checkinId in memory. */
export const listAllPhotos = (pid) => db.getAll('photos', { index: 'pid_date', range: prefixRange([pid]) });
export const listPhotos = (pid, checkinId) => db.getAll('photos', { index: 'checkinId', range: IDBKeyRange.only(checkinId) }).then((l) => l.filter((p) => p.pid === pid));
export async function getPhotoBlob(pid, photoId, full = false) {
  const meta = await getOwn('photos', pid, photoId); if (!meta) return null;
  if (!full) return meta.thumb || null;
  const d = await db.get('photoData', photoId); return d ? d.blob : null;
}
/** photos: [{slot, blob, thumb, w, h, bytes, thumbBytes, mime, crc32}]; one multi-store tx (D-032). */
export async function saveCheckinWithPhotos(pid, checkin, photos = [], { removeSlots = [], writeMeasurements = false } = {}) {
  need(V.checkDate(checkin.date));
  if (typeof checkin.note === 'string' && checkin.note.length > 2000) need({ ok: false, hard: [{ code: 'C_NOTE_LONG', field: 'Note', message: V.msg('C_NOTE_LONG') }], soft: [] });
  need(V.checkCheckinPhotos(photos));
  if (checkin.weight != null) need(V.checkWeight(checkin.weight));
  if (checkin.bodyFat != null) need(V.checkBodyFat(checkin.bodyFat));
  const bytes = photos.reduce((a, p) => a + (p.bytes || 0) + (p.thumbBytes || 0), 0);
  if (bytes) { const h = await storageCheck('photo-add', bytes); if (!h.allow) throw new db.QuotaError(new Error('low free space')); }
  const t = now(); const id = checkin.id || newId('ck');
  let saved;
  await tx(['checkins', 'photos', 'photoData', 'measurements'], 'readwrite', async (x) => {
    const cur = checkin.id ? await x.store('checkins').get(id) : null; own(cur, pid);
    const existing = cur ? await x.store('photos').getAll({ index: 'checkinId', range: IDBKeyRange.only(id) }) : [];
    const replace = new Set([...photos.map((p) => p.slot), ...removeSlots]);
    const keep = [];
    for (const ph of existing) { if (replace.has(ph.slot)) { await x.store('photos').del(ph.id); await x.store('photoData').del(ph.id); } else keep.push({ photoId: ph.id, slot: ph.slot }); }
    const added = [];
    for (const p of photos) {
      const pid_ = newId('ph');
      await x.store('photos').put({ id: pid_, pid, checkinId: id, slot: p.slot, date: checkin.date, w: p.w, h: p.h, bytes: p.bytes, thumbBytes: p.thumbBytes, mime: p.mime || 'image/jpeg', crc32: p.crc32 ?? null, thumb: p.thumb, createdAt: t });
      await x.store('photoData').put({ id: pid_, blob: p.blob });
      added.push({ photoId: pid_, slot: p.slot });
    }
    saved = { ...checkin, id, pid, photos: [...keep, ...added], createdAt: cur?.createdAt ?? t, updatedAt: t };
    need(V.validateRecord('checkins', saved));
    await x.store('checkins').put(saved);
    if (writeMeasurements) {
      const vals = { 'mt:weight': checkin.weight, 'mt:bodyFat': checkin.bodyFat, ...(checkin.measurements || {}) };
      for (const [typeId, value] of Object.entries(vals)) {
        if (value == null) continue; const r = V.checkMeasurement(typeId, value); need(r);
        await x.store('measurements').put({ id: newId('ms'), pid, typeId, date: checkin.date, value: r.value, unit: unitFor(typeId), entered: null, note: null, checkinId: id, createdAt: t, updatedAt: t });
      }
    }
  });
  return done(saved);
}
export async function deleteCheckin(pid, id) {
  await tx(['checkins', 'photos', 'photoData'], 'readwrite', async (x) => {
    const cur = await x.store('checkins').get(id); own(cur, pid); if (!cur) return;
    const ph = await x.store('photos').getAll({ index: 'checkinId', range: IDBKeyRange.only(id) });
    for (const p of ph) { await x.store('photos').del(p.id); await x.store('photoData').del(p.id); }
    await x.store('checkins').del(id);
  });
  return done(true);
}

// ---------------- integrity ----------------
/** Global by design (Self-check). Nothing is deleted here. */
export async function integrityScan() {
  const photos = await db.getAll('photos'); // ALLOW-UNFILTERED
  const dataKeys = await tx(['photoData'], 'readonly', (x) => x.store('photoData').getAllKeys());
  const checkins = await db.getAll('checkins'); // ALLOW-UNFILTERED
  const cIds = new Set(checkins.map((c) => c.id)), pIds = new Set(photos.map((p) => p.id)), dIds = new Set(dataKeys);
  return {
    orphanPhotoData: dataKeys.filter((k) => !pIds.has(k)),
    orphanPhotos: photos.filter((p) => !cIds.has(p.checkinId)).map((p) => p.id),
    photosMissingData: photos.filter((p) => !dIds.has(p.id)).map((p) => p.id),
    checkinsMissingPhotos: checkins.flatMap((c) => (c.photos || []).filter((r) => !pIds.has(r.photoId)).map((r) => ({ checkinId: c.id, photoId: r.photoId })))
  };
}
export async function cleanupOrphans(scan) {
  const s = scan || await integrityScan();
  await tx(['photos', 'photoData'], 'readwrite', async (x) => {
    for (const id of s.orphanPhotoData) await x.store('photoData').del(id);
    for (const id of s.orphanPhotos) { await x.store('photos').del(id); await x.store('photoData').del(id); }
  });
  return done(s.orphanPhotoData.length + s.orphanPhotos.length);
}
