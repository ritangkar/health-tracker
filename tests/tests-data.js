// A9 data-integrity QA: persistence, pid isolation, snapshot immutability, numbers, backup/import at scale, photos, migration, whole-repo greps. (A9)
// Every DB test uses its own throwaway database winter-arc-test-a9-* and the LS prefix winter-arc-test: (D-077). Synthetic data only (rule 12).
// Seed tests live in tests-seed.js and are loaded from here because the harness SUITES list names tests-data.js.
import { describe, it, assert, scanForWeekdays } from './harness.js';
import './tests-seed.js';
import * as db from '../js/core/db.js';
import * as repo from '../js/core/repo.js';
import * as C from '../js/core/calc.js';
import * as seed from '../js/core/seed.js';
import { setStoragePrefix, getMeta, setMeta, detectLoss, lsGet, lsSet, writeSentinel, getLastBackupAt } from '../js/core/storage-health.js';
import { registerTestStep, clearTestSteps, migrateData, migrateLiveDb } from '../js/core/migrate.js';
import { createZip, openZip, crc32, crc32Blob } from '../js/lib/zip.js';
import { prepareBackup, sha256Hex } from '../js/core/backup.js';
import { openBackupFile, buildPreview, applyImport, importBackupFile, verifyAfterImport } from '../js/core/import.js';
import { processImage } from '../js/features/photos/image-pipeline.js';
import { buildRecipeRecord, ingredientFrom, recipeEquality, refreshIngredients } from '../js/features/food/recipe-model.js';
import { todayKey, addDays } from '../js/core/dates.js';
import { validateRecord } from '../js/core/validate.js';
import { appStore } from '../js/core/store.js';
import { DB_VERSION, CURRENT_SCHEMA, PHOTO } from '../config.js';

const report = (window.__a9 = window.__a9 || {});
const enc = new TextEncoder();
const FIX = new URL('./fixtures/', import.meta.url);
const REPO = new URL('../', import.meta.url);
const clone = (x) => JSON.parse(JSON.stringify(x));
const dbNames = []; let dbCount = 0;

// ------------------------------------------------------------------ helpers
async function freshDb(tag = 'x') {
  setStoragePrefix('winter-arc-test:');
  for (const k of Object.keys(localStorage)) if (k.startsWith('winter-arc-test:')) localStorage.removeItem(k);
  const name = `winter-arc-test-a9-${tag}-${Date.now().toString(36)}-${++dbCount}`; dbNames.push(name);
  await db.closeDb(); await db.openDb(name); await repo.initRepo();
  return name;
}
let seedReady = false;
async function ensureSeed() { if (!seedReady || !seed.seedLoaded()) { await seed.loadSeed({ base: '../data/' }); seedReady = true; } }
function randBytes(n, s) { const out = new Uint8Array(n); let x = (s >>> 0) || 1; for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 255; } return out; }
const jpeg = (n, s) => new Blob([randBytes(n, s)], { type: 'image/jpeg' });
async function canon(v) {
  if (v instanceof Blob) return { $blob: v.size, type: v.type, crc: await crc32Blob(v) };
  if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await canon(x)); return o; }
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = await canon(v[k]); return o; }
  return v;
}
/** counts + SHA-256 content hash per store (Blob contents included). meta only when asked. */
async function snapshot({ meta = false } = {}) {
  const stores = [...repo.USER_STORES, ...(meta ? ['meta'] : [])]; const raw = {};
  await db.tx(stores, 'readonly', async (t) => { for (const s of stores) raw[s] = await t.store(s).getAll(); });
  const counts = {}, hashes = {};
  for (const s of stores) { const rows = []; for (const r of raw[s]) rows.push(JSON.stringify(await canon(r))); rows.sort(); counts[s] = rows.length; const text = rows.join('\n'); hashes[s] = (await sha256Hex(enc.encode(text))) ?? text; }
  return { counts, hashes };
}
const sumCounts = (c) => Object.values(c).reduce((a, b) => a + b, 0);
const meals = () => seed.listMealCategories();
const mealOf = (i) => { const m = meals(); const x = m[i % m.length]; return { id: x.id, label: x.label }; };
const D = (n) => addDays(todayKey(), -n);

/** A custom food cloned from a seed food (so it passes the shared validator), per 100 g with a bowl serving. */
async function makeCustomFood(pid, name, over = {}) {
  const base = await seed.getFood('f:st-rice-white-cooked', pid);
  const f = clone(base); for (const k of ['id', 'basedOn', 'supersedes', 'system', 'pid', 'createdAt', 'updatedAt', 'rev']) delete f[k];
  f.name = name; f.aliases = []; f.source = { type: 'user', ref: null }; f.confidence = 'estimate'; f.origin = 'home';
  f.nutrition = { per: { amount: 100, unit: 'g' }, kcal: 200, protein: 10, carbs: 30, fat: 5, fiber: 4, ...over };
  f.servings = [{ id: 's1', label: '1 bowl (150 g)', unit: 'bowl', baseAmount: 150, approx: true }]; f.defaultServingId = 's1';
  const saved = await repo.saveFood(pid, f); seed.invalidateOverlay(pid); return saved;
}
async function runWorkout(pid, date, planId, fraction = 1) {
  const plan = await seed.getPlan(planId, pid); const resolve = await seed.resolveExerciseSync(pid);
  let log = await repo.createWorkoutLog(pid, { date, plan, resolveExercise: resolve });
  await repo.applyPlanStepGoal(pid, date, plan);
  for (const it of log.items) log = await repo.updateWorkoutItem(pid, log.id, it.itemId, { actual: Math.round(it.target * fraction) });
  return log;
}
function photoInput(slot, n, s) { const blob = jpeg(n, s), thumb = jpeg(2000 + (s % 50), s + 1000); return { slot, blob, thumb, w: 1200, h: 1600, bytes: blob.size, thumbBytes: thumb.size, mime: 'image/jpeg', crc32: null }; }

/** Two profiles, 400 food logs, 60 workout logs, 8 check-ins with 4 photos each, plus everything else (see QA plan). */
async function buildRich({ logsPer = 199, workoutsPer = 30, daysPer = 30 } = {}) {
  await ensureSeed();
  const foodRefs = ['f:st-rice-white-cooked', 'f:st-roti-whole-wheat', 'f:st-egg-boiled', 'f:st-dal-toor-home', 'f:st-macher-jhol', 'f:st-banana-ripe', 'f:st-curd-dahi-plain', 'f:st-chai-milk-sugar'];
  const planIds = ['plan:upper-push-pull', 'plan:lower-core', 'plan:recovery-yoga', 'plan:upper-arms', 'plan:lower-cardio', 'plan:rest'];
  const pids = [];
  for (const [pi, name] of ['Me A9', 'Partner A9'].entries()) {
    const p = await repo.createProfile(name, { targets: { kcal: 1900 + pi * 100, protein: 120, carbs: 220, fat: 60, fiber: 25, waterMl: 3000, steps: 7000 } }); const pid = p.id; pids.push(pid);
    await seed.prepare(pid, { force: true });
    const c1 = await makeCustomFood(pid, `A9 granola ${pi}`); const c2 = await makeCustomFood(pid, `A9 shake ${pi}`, { kcal: 90, protein: 8, carbs: 9, fat: 2, fiber: null });
    const rice = await seed.getFood('f:st-rice-white-cooked', pid), egg = await seed.getFood('f:st-egg-boiled', pid);
    await repo.saveFood(pid, buildRecipeRecord({ name: `A9 recipe ${pi}`, servings: 3, ingredients: [ingredientFrom(rice, rice.servings[0], 2), ingredientFrom(egg, egg.servings[0], 3)] }));
    await repo.saveFood(pid, { ...(await seed.getFood('f:st-apple', pid)), nutrition: { ...(await seed.getFood('f:st-apple', pid)).nutrition, kcal: 60 } }); // copy-on-edit
    await repo.hideSeed(pid, 'foods', 'f:st-orange');
    const refs = [...foodRefs, c1.id, c2.id];
    for (let i = 0; i < logsPer; i++) {
      const food = await seed.getFood(refs[i % refs.length], pid); const sv = food.servings && food.servings.length ? food.servings[i % food.servings.length] : null;
      await repo.addFoodLog(pid, { date: D(i % daysPer), food, serving: sv, qty: 1 + (i % 4) * 0.5, meal: mealOf(i) });
    }
    await repo.quickAddFoodLog(pid, { date: D(0), name: 'Quick A9', kcal: 321, protein: 12, meal: mealOf(1) });
    await repo.toggleFavourite(pid, 'f:st-egg-boiled');
    for (let i = 0; i < workoutsPer; i++) await runWorkout(pid, D(i % daysPer), planIds[i % planIds.length], 0.5 + (i % 3) * 0.25);
    for (let i = 0; i < daysPer; i++) { await repo.setWater(pid, D(i), (i % 9) + 1); await repo.setSteps(pid, D(i), 4000 + i * 100); if (i % 5 === 0) await repo.setDayNote(pid, D(i), { text: `A9 note ${i}`, tags: ['travel'] }); await repo.upsertSleep(pid, D(i), { bed: '23:00', wake: '06:30', quality: (i % 5) + 1, napMin: i % 4 ? null : 20 }); }
    for (let i = 0; i < 12; i++) { await repo.addMeasurement(pid, { typeId: 'mt:weight', date: D(i * 3), value: 70 + i * 0.4 }); await repo.addMeasurement(pid, { typeId: 'mt:waist', date: D(i * 3), value: 80 + i * 0.2 }); }
    for (let i = 0; i < 4; i++) {
      const photos = PHOTO.slots.map((slot, j) => photoInput(slot, 6000 + ((pi * 4 + i) * 4 + j) * 700, 11 + pi * 100 + i * 10 + j));
      for (const ph of photos) ph.crc32 = await crc32Blob(ph.blob);
      await repo.saveCheckinWithPhotos(pid, { date: D(i * 7), periodDays: 7, periodStart: D(i * 7 + 6), periodEnd: D(i * 7), weight: 72 - i * 0.3, bodyFat: null, measurements: {}, autoStats: null, note: `A9 check-in ${pi}-${i}` }, photos);
    }
    const ex = await seed.getExercise('ex:plank', pid); await repo.saveExercise(pid, { ...ex, kcal: { ...ex.kcal, value: 0.08 } });
    await repo.duplicatePlanFor(pid, await seed.getPlan('plan:lower-core', pid));
  }
  return pids;
}

describe('A9 persistence (DAT-001, DAT-014, DAT-017)', () => {
  it('data survives closing the database and opening it again (same name, new connection)', ['DAT-001', 'NFR-010'], async () => {
    const name = await freshDb('persist'); await ensureSeed();
    const p = await repo.createProfile('Persist'); await repo.setWater(p.id, D(0), 5); await repo.setSteps(p.id, D(0), 6543); await repo.upsertSleep(p.id, D(0), { bed: '23:30', wake: '07:00', quality: 4 });
    const f = await seed.getFood('f:st-egg-boiled', p.id); await repo.addFoodLog(p.id, { date: D(0), food: f, serving: f.servings[0], qty: 2, meal: mealOf(0) });
    const before = await snapshot({ meta: true });
    await db.closeDb(); await db.openDb(name);
    const after = await snapshot({ meta: true }); assert.deepEq(after, before, 'identical after reopen');
    assert.eq((await repo.getDay(p.id, D(0))).steps.count, 6543);
    assert.eq((await repo.getFoodLogs(p.id, D(0))).length, 1);
  });
  it('write-through: once a save has resolved, an independent raw connection already sees it', ['DAT-017'], async () => {
    const name = await freshDb('wt'); const p = await repo.createProfile('WT');
    await repo.setWater(p.id, D(0), 7);
    const raw = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    try {
      const row = await new Promise((res, rej) => { const q = raw.transaction('days', 'readonly').objectStore('days').get([p.id, D(0)]); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      assert.eq(row.water.glasses, 7, 'visible to a second connection straight away');
    } finally { raw.close(); }
  });
  it('the app keeps working after the browser drops the connection under it (iOS case): the next call reopens', ['DAT-017', 'R-022'], async () => {
    await freshDb('drop'); const p = await repo.createProfile('Drop');
    const handle = await db.openDb(); handle.close(); // connection gone, module still holds the closed handle
    await repo.setSteps(p.id, D(0), 1234);           // must retry once on InvalidStateError and succeed
    assert.eq((await repo.getDay(p.id, D(0))).steps.count, 1234);
    handle.close(); const got = await repo.getDay(p.id, D(0)); assert.eq(got.steps.count, 1234, 'and reads too');
  });
  it('another tab asking for a newer version makes this connection close politely (versionchange event, no data touched)', ['DAT-017'], async () => {
    const name = await freshDb('vc'); const p = await repo.createProfile('VC'); await repo.setWater(p.id, D(0), 3);
    const events = []; const off = db.onDbEvent((e) => events.push(e.type));
    const up = await new Promise((res) => { const r = indexedDB.open(name, DB_VERSION + 1); r.onupgradeneeded = () => {}; r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => {}; });
    off(); assert.ok(events.includes('versionchange'), `events: ${events.join(',')}`);
    if (up) up.close(); await db.deleteDb(name);
  });
  it('loss detection: sentinel present + IndexedDB empty -> loss; with profiles -> no loss; no sentinel -> no loss', ['DAT-014', 'DAT-017'], async () => {
    await freshDb('loss'); assert.eq(await detectLoss(), false, 'fresh install');
    await repo.createProfile('Sent'); assert.ok(lsGet('sentinel') && lsGet('sentinel').hadData, 'sentinel written by the first save');
    assert.eq(await detectLoss(), false, 'data present');
    await freshDb('loss2'); lsSet('sentinel', { hadData: true, firstWriteAt: Date.now(), installId: 'in_a9' });
    assert.eq(await detectLoss(), true, 'sentinel but empty IDB = loss -> Restore screen');
    localStorage.removeItem('winter-arc-test:sentinel'); assert.eq(await detectLoss(), false);
  });
  it('the sentinel is written once (first save) and keeps its installId', ['DAT-014'], async () => {
    await freshDb('sent2'); const p = await repo.createProfile('Once'); const s1 = lsGet('sentinel'); await repo.setWater(p.id, D(0), 1); await writeSentinel(); const s2 = lsGet('sentinel');
    assert.eq(s2.installId, s1.installId, 'installId stable'); assert.ok((await getMeta('installId')) === s1.installId);
  });
  it('LocalStorage never holds user data: names, notes, measurements and logs stay in IndexedDB', ['DAT-001', 'DAT-028'], async () => {
    await freshDb('ls'); await ensureSeed(); const p = await repo.createProfile('Zq Marker Name'); await repo.setDayNote(p.id, D(0), { text: 'zq-note-marker', tags: ['travel'] });
    await repo.addMeasurement(p.id, { typeId: 'mt:weight', date: D(0), value: 71.123 }); await repo.setWater(p.id, D(0), 4);
    const dump = Object.keys(localStorage).filter((k) => k.startsWith('winter-arc-test:')).map((k) => k + '=' + localStorage.getItem(k)).join('\n');
    for (const m of ['Zq Marker', 'zq-note-marker', '71.123']) assert.ok(!dump.includes(m), `LocalStorage leaks ${m}`);
  });
});

describe('A9 pid isolation (DAT-021, FR-001, FR-002)', () => {
  it('STATIC: every getAll in repo.js filters by pid/range or carries an ALLOW-UNFILTERED marker; direct db access outside core is listed', ['DAT-021'], async () => {
    const text = await (await fetch(new URL('js/core/repo.js', REPO))).text(); const bad = [], marked = [];
    text.split('\n').forEach((line, i) => {
      if (!/getAll\(/.test(line) || /^\s*\/\//.test(line)) return;
      if (/ALLOW-UNFILTERED/.test(line)) { marked.push(i + 1); return; }
      if (/pid/.test(line) || /range:/.test(line) || /inRange|prefixRange|keyRange|IDBKeyRange/.test(line)) return;
      bad.push(`repo.js:${i + 1} ${line.trim().slice(0, 110)}`);
    });
    report.unfilteredMarked = marked; assert.eq(bad.length, 0, bad.join(' | '));
  });
  it('STATIC: feature screens never import db.js directly (they must go through repo.js)', ['DAT-021'], async () => {
    const list = (await (await fetch(new URL('a9-repo-files.json', FIX))).json()).files.filter((f) => /^js\/(features|ui)\/.*\.js$/.test(f)); const bad = [];
    for (const f of list) { const t = await (await fetch(new URL(f, REPO))).text(); if (/from\s+['"][./]*core\/db\.js['"]/.test(t) && /\bdb\.(get|put|add|del|clear|count|getAll|tx|openDb|closeDb)\s*\(/.test(t)) bad.push(f); }
    report.directDb = bad; assert.eq(bad.length, 0, bad.join(', '));
  });
  it('two profiles with a rich history never see each other through any repo reader', ['FR-001', 'DAT-021', 'QA-002'], async () => {
    await freshDb('iso'); const [A, B] = await buildRich({ logsPer: 24, workoutsPer: 6, daysPer: 8 });
    const lo = D(40), hi = D(-1);
    const readers = {
      foodLogs: (p) => repo.getFoodLogsRange(p, lo, hi), workoutLogs: (p) => repo.getWorkoutLogsRange(p, lo, hi), days: (p) => repo.getDaysRange(p, lo, hi), sleep: (p) => repo.getSleepRange(p, lo, hi),
      foods: (p) => repo.listFoods(p), exercises: (p) => repo.listExercises(p), plans: (p) => repo.listPlans(p), prefs: (p) => repo.listPrefs(p), checkins: (p) => repo.listCheckins(p),
      weight: (p) => repo.measurementSeries(p, 'mt:weight'), waist: (p) => repo.measurementSeries(p, 'mt:waist')
    };
    for (const [name, fn] of Object.entries(readers)) {
      const a = await fn(A), b = await fn(B); assert.ok(a.length > 0 && b.length > 0, `${name} empty`);
      assert.ok(a.every((r) => r.pid === A) && b.every((r) => r.pid === B), `${name} leaked across profiles`);
      const ida = new Set(a.map((r) => r.id || r.foodRef || r.date)); assert.ok(a.length + b.length >= ida.size);
    }
    for (const c of await repo.listCheckins(A)) assert.ok((await repo.listPhotos(A, c.id)).every((p) => p.pid === A && p.checkinId === c.id), 'photos');
    assert.eq((await repo.listCheckins(A)).length, 4); assert.eq((await repo.listCheckins(B)).length, 4);
    const denied = async (fn) => { try { const r = await fn(); return r == null || (Array.isArray(r) && r.length === 0); } catch { return true; } }; // a foreign id is refused (throw) or empty: never returned (D-100 maps it to Not found)
    const bCk = (await repo.listCheckins(B))[0]; assert.ok(await denied(() => repo.getCheckin(A, bCk.id)), 'getCheckin across profiles'); assert.ok(await denied(() => repo.listPhotos(A, bCk.id)), 'listPhotos across profiles');
    const bPh = (await repo.listPhotos(B, bCk.id))[0]; assert.ok(await denied(() => repo.getPhotoBlob(A, bPh.id, true)), 'photo bytes across profiles'); assert.ok(await denied(() => repo.getPhotoBlob(A, bPh.id, false)), 'thumb across profiles');
    assert.ok((await repo.getPhotoBlob(B, bPh.id, true)) instanceof Blob);
    assert.ok((await seed.listPlans(A)).every((p) => !p.pid || p.pid === A), 'seed overlay plans'); assert.ok((await seed.search('a9', A, 50)).every((r) => !r.food.pid || r.food.pid === A), 'search overlay');
  });
  it('writes through the wrong profile are rejected and change nothing (edit, delete, update, restore)', ['DAT-021', 'QA-002'], async () => {
    await freshDb('iso2'); const [A, B] = await buildRich({ logsPer: 6, workoutsPer: 3, daysPer: 4 });
    const bLog = (await repo.getFoodLogsRange(B, D(10), D(0)))[0], bWk = (await repo.getWorkoutLogsRange(B, D(10), D(0)))[0], bCk = (await repo.listCheckins(B))[0], bFood = (await repo.listFoods(B))[0], bMs = (await repo.measurementSeries(B, 'mt:weight'))[0], bSl = (await repo.getSleepRange(B, D(10), D(0)))[0];
    const before = await snapshot({ meta: true });
    const tries = {
      editFoodLog: () => repo.editFoodLog(A, bLog.id, { qty: 9 }), deleteFoodLog: () => repo.deleteFoodLog(A, bLog.id), restoreFoodLog: () => repo.restoreFoodLog(A, bLog), updateWorkoutItem: () => repo.updateWorkoutItem(A, bWk.id, bWk.items[0].itemId, { actual: 1 }),
      deleteWorkoutLog: () => repo.deleteWorkoutLog(A, bWk.id), deleteCheckin: () => repo.deleteCheckin(A, bCk.id), saveFood: () => repo.saveFood(A, { ...bFood, name: 'hijack' }), deleteFood: () => repo.deleteFood(A, bFood.id),
      editMeasurement: () => repo.editMeasurement(A, bMs.id, { value: 99 }), deleteMeasurement: () => repo.deleteMeasurement(A, bMs.id), saveCheckin: () => repo.saveCheckinWithPhotos(A, { ...bCk, note: 'hijack' }, [])
    };
    const outcome = {};
    for (const [k, fn] of Object.entries(tries)) { try { const r = await fn(); outcome[k] = r == null || r === true ? 'noop' : 'ACCEPTED'; } catch { outcome[k] = 'rejected'; } }
    assert.deepEq(await snapshot({ meta: true }), before, `a cross-profile write changed data: ${JSON.stringify(outcome)}`);
    report.crossWriteOutcome = outcome; assert.ok(!Object.values(outcome).includes('ACCEPTED'), JSON.stringify(outcome));
    void bSl; // sleep is keyed by [pid,date], so another pid can never address it
  });
  it('FR-002: a third profile needs no schema change; three-way isolation holds; archived profile keeps its data', ['FR-002', 'DAT-021'], async () => {
    await freshDb('three'); await ensureSeed(); const names0 = db.STORE_DEFS.map((s) => s.name).join(','), v0 = DB_VERSION;
    const ids = []; for (const n of ['One', 'Two', 'Three']) { const p = await repo.createProfile(n); ids.push(p.id); await repo.setSteps(p.id, D(0), 1000 * (ids.length)); await repo.setWater(p.id, D(0), ids.length); }
    for (const [i, pid] of ids.entries()) assert.eq((await repo.getDay(pid, D(0))).steps.count, 1000 * (i + 1));
    assert.eq(db.STORE_DEFS.map((s) => s.name).join(','), names0, 'store list unchanged'); assert.eq(DB_VERSION, v0);
    const h = await db.openDb(); assert.eq(h.version, DB_VERSION, 'IDB version unchanged by adding a profile');
    await repo.archiveProfile(ids[2]); assert.eq((await repo.listProfiles()).length, 2); assert.eq((await repo.listProfiles({ includeArchived: true })).length, 3);
    assert.eq((await repo.getDay(ids[2], D(0))).steps.count, 3000, 'archived profile data intact');
  });
});

describe('A9 snapshot immutability (DAT-006, DAT-007, DAT-022, DoD-07, DoD-10, QA-010)', () => {
  it('editing, deleting or hiding any master leaves every old food log deep-equal and displayable', ['DAT-007', 'DAT-006', 'QA-010'], async () => {
    await freshDb('snapf'); await ensureSeed(); const p = await repo.createProfile('Snap'); const pid = p.id; await seed.prepare(pid, { force: true });
    const rice = await seed.getFood('f:st-rice-white-cooked', pid), banana = await seed.getFood('f:st-banana-ripe', pid), cust = await makeCustomFood(pid, 'A9 snack bar'), cust2 = await makeCustomFood(pid, 'A9 to archive');
    const ing = [ingredientFrom(rice, rice.servings[0], 1), ingredientFrom(cust, cust.servings[0], 1)];
    const rec = await repo.saveFood(pid, buildRecipeRecord({ name: 'A9 recipe', servings: 2, ingredients: ing }));
    const mk = async (f, sv, q, i) => repo.addFoodLog(pid, { date: D(3), food: f, serving: sv, qty: q, meal: mealOf(i) });
    await mk(rice, rice.servings[1], 1.5, 0); await mk(banana, banana.servings[0], 2, 1); await mk(cust, cust.servings[0], 1, 2); await mk(cust2, cust2.servings[0], 3, 3); await mk(rec, rec.servings[0], 1, 4);
    await repo.quickAddFoodLog(pid, { date: D(3), name: 'Quick', kcal: 250, protein: 10 });
    const before = (await repo.getFoodLogs(pid, D(3))).sort((a, b) => a.id.localeCompare(b.id)); assert.eq(before.length, 6);
    // edits
    await repo.saveFood(pid, { ...cust, nutrition: { ...cust.nutrition, kcal: 900, protein: 77, carbs: 1 }, servings: [{ id: 's1', label: '1 bowl (300 g)', unit: 'bowl', baseAmount: 300 }] });
    await repo.saveFood(pid, { ...rice, nutrition: { ...rice.nutrition, kcal: 777, protein: 50 } });            // seed copy-on-edit
    await repo.hideSeed(pid, 'foods', 'f:st-banana-ripe');                                                         // hide a seed item
    await repo.archiveFood(pid, cust2.id);
    await repo.deleteFood(pid, cust.id);                                                                           // delete a custom food that is an ingredient and logged
    await repo.saveFood(pid, { ...rec, name: 'A9 recipe renamed' });
    await repo.setTargets(pid, { kcal: 1500, protein: 90, carbs: 150, fat: 40, fiber: 20, waterMl: 2500, steps: 5000 });
    const after = (await repo.getFoodLogs(pid, D(3))).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEq(after, before, 'old food logs changed after master edits');
    for (const l of after) { assert.ok(l.foodName && l.servingLabel && l.per1serving, 'self-contained'); assert.deepEq(C.totalsFor(l.per1serving, l.qty), l.totals, `totals recompute from snapshot (${l.foodName})`); assert.ok(V_ok(l), 'still valid'); }
    const totals = C.dayTotals(after); assert.ok(totals.kcal > 0 && totals.count === 6);
    // editing a log uses its OWN snapshot, not the (now different) master
    const riceLog = after.find((l) => l.foodName === rice.name); const e = await repo.editFoodLog(pid, riceLog.id, { qty: 2 });
    assert.deepEq(e.per1serving, riceLog.per1serving, 'per-serving snapshot kept'); assert.eq(e.totals.kcal, Math.round(riceLog.per1serving.kcal * 2 * 10) / 10);
    // deleting a log whose master is gone must not resurrect a favourite/recent for a missing food
    const custLog = after.find((l) => l.foodName === 'A9 snack bar'); await repo.deleteFoodLog(pid, custLog.id);
    assert.ok(!(await repo.listPrefs(pid)).some((x) => x.foodRef === cust.id && !x.fav && x.useCount === 0), 'no empty pref row');
    // recipe ingredients keep their snapshots when an ingredient food disappears
    const rr = await repo.getFood(pid, rec.id); assert.ok(recipeEquality(rr).ok, 'recipe equality'); const rf = await refreshIngredients(rr.recipe.ingredients, rr.recipe.servings, async (ref) => seed.getFood(ref, pid));
    assert.ok(rf.missing.includes('A9 snack bar') || rf.ingredients.length === 2, 'missing ingredient kept, not dropped');
  });
  it('editing or deleting exercises and plans, changing a plan step goal and targets leaves workout logs and days deep-equal (DoD-10)', ['DAT-007', 'FR-021', 'QA-010'], async () => {
    await freshDb('snapw'); await ensureSeed(); const p = await repo.createProfile('SnapW'); const pid = p.id; await seed.prepare(pid, { force: true });
    await repo.addMeasurement(pid, { typeId: 'mt:weight', date: D(9), value: 80 });
    const w1 = await runWorkout(pid, D(5), 'plan:upper-push-pull', 0.7); const w2 = await runWorkout(pid, D(5), 'plan:lower-cardio', 1); const w3 = await runWorkout(pid, D(4), 'plan:rest');
    await repo.setSteps(pid, D(5), 6100); const dayBefore = await repo.getDay(pid, D(5)); assert.eq(dayBefore.stepGoal, 7000);
    const goalBefore = await repo.effectiveStepGoal(pid, D(4)); assert.eq(goalBefore.goal, 10000, 'rest day goal');
    const logsBefore = [...(await repo.getWorkoutLogsRange(pid, D(10), D(0)))].sort((a, b) => a.id.localeCompare(b.id));
    // exercise edit (copy-on-edit) and a custom exercise delete
    const push = await seed.getExercise('ex:push-up', pid); await repo.saveExercise(pid, { ...push, kcal: { ...push.kcal, value: 0.9 }, defaultTarget: 99 });
    await repo.hideSeed(pid, 'exercises', 'ex:squat');
    // plan edit: rename, change targets, add an item, new step goal; then delete the copy and hide the seed plan
    const plan = await seed.getPlan('plan:upper-push-pull', pid); const copy = await repo.savePlan(pid, { ...plan, name: 'A9 renamed', stepGoal: 9000, items: [{ ...plan.items[0], target: 50, kcalOverride: { basis: 'per_rep', value: 5 } }, ...plan.items.slice(1, 3)] });
    assert.ok(copy.rev >= 2 && copy.basedOn === 'plan:upper-push-pull', 'copy-on-edit with rev');
    await repo.deletePlan(pid, copy.id); await repo.hideSeed(pid, 'plans', 'plan:upper-push-pull'); await repo.hideSeed(pid, 'plans', 'plan:lower-cardio');
    await repo.setTargets(pid, { kcal: 1400, protein: 80, carbs: 150, fat: 40, fiber: 20, waterMl: 2000, steps: 4000 });
    await repo.setStepGoalManual(pid, D(1), 3000);
    const logsAfter = [...(await repo.getWorkoutLogsRange(pid, D(10), D(0)))].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEq(logsAfter, logsBefore, 'workout logs changed after master/plan edits'); assert.deepEq(await repo.getDay(pid, D(5)), dayBefore, 'day record changed');
    assert.deepEq(await repo.effectiveStepGoal(pid, D(4)), goalBefore, 'old day keeps its goal');
    for (const l of logsAfter) {
      assert.ok(l.planName && (l.isRest || l.items.length), 'plan contents are inside the log');
      for (const it of l.items) { const n = C.computeItem({ ...it }, l.bodyWeightKg); assert.eq(n.pct, it.pct, `${it.exerciseName} pct`); assert.eq(n.kcalEst, it.kcalEst, `${it.exerciseName} kcal recompute`); }
      assert.eq(C.sessionCompletion(l.items), l.completionPct, 'completion recompute');
    }
    assert.eq(logsAfter.find((l) => l.id === w1.id).planName, 'Upper Body - Push & Pull', 'deleted plan still named in its old log');
    assert.eq(logsAfter.find((l) => l.id === w1.id).items[0].exerciseName, 'Push-ups'); void w2; void w3;
    assert.eq((await repo.effectiveStepGoal(pid, D(1))).goal, 3000, 'manual goal for another day still works');
  });
});

const V_ok = (rec) => validateRecord('foodLogs', rec).ok;

describe('A9 numbers (FR-022, FR-023, FR-012, FR-014, FR-016, DAT-009, DAT-030)', () => {
  it('completion: 7/10=70, 20/30=67, 22/30=73, manual wins, 150%=100 cap, no actual = no data', ['FR-022', 'DoD-11', 'QA-010'], () => {
    assert.eq(C.completionPct(7, 10, null), 70); assert.eq(C.completionPct(20, 30, null), 67); assert.eq(C.completionPct(22, 30, null), 73);
    assert.eq(C.completionPct(7, 10, 55), 55, 'manual override wins'); assert.eq(C.completionPct(null, 10, null), null); assert.eq(C.completionPct(0, 10, null), 0, '0 is data'); assert.eq(C.completionPct(15, 10, null), 100);
    assert.eq(C.completionPct(5, 10, 0), 0, 'manual 0 is a value'); for (const bad of [101, -1, 5.5, '70']) { let threw = false; try { C.completionPct(1, 10, bad); } catch { threw = true; } assert.ok(threw, `manual ${bad} must be rejected`); }
    const it1 = C.computeItem({ targetKind: 'minutes', target: 30, actual: 22, kcalBasis: { basis: 'per_minute', value: 10, refWeightKg: 70, scaleByWeight: true }, perSide: false }, 70); assert.eq(it1.pct, 73); assert.eq(it1.kcalEst, 220);
    const it2 = C.computeItem({ targetKind: 'seconds', target: 30, actual: 20, kcalBasis: { basis: 'per_second', value: 0.1, refWeightKg: 70, scaleByWeight: false } }, 70); assert.eq(it2.pct, 67);
  });
  it('session completion rule D-071: unentered rows count 0 once something is entered; nothing entered = null (excluded)', ['FR-022', 'D-071'], () => {
    const row = (o) => ({ targetKind: 'reps', target: 10, kcalBasis: null, ...o });
    const items = [C.computeItem(row({ actual: 7 }), 70), C.computeItem(row({}), 70), C.computeItem(row({ manualPct: 100 }), 70), C.computeItem(row({}), 70)];
    assert.eq(C.sessionCompletion(items), Math.round((70 + 0 + 100 + 0) / 4)); assert.eq(C.sessionCompletion([C.computeItem(row({}), 70)]), null); assert.eq(C.sessionCompletion([]), null);
  });
  it('kcal formula: per-side doubles, weight scaling, override order (log > item > estimate), actual units, manual-only uses target x pct', ['FR-023', 'QA-010'], () => {
    const b = { basis: 'per_rep', value: 0.5, refWeightKg: 70, scaleByWeight: true };
    assert.eq(C.kcalEstimate({ kcalBasis: b, perSide: false }, 10, 70), 5); assert.eq(C.kcalEstimate({ kcalBasis: b, perSide: true }, 10, 70), 10, 'each side x2');
    assert.eq(C.kcalEstimate({ kcalBasis: b }, 10, 140), 10, 'scales with body weight'); assert.eq(C.kcalEstimate({ kcalBasis: { ...b, scaleByWeight: false } }, 10, 140), 5, 'no scaling');
    assert.eq(C.kcalEstimate({ kcalBasis: b, kcalOverride: { basis: 'per_rep', value: 1 } }, 10, 140), 10, 'item override replaces estimate and is not weight scaled');
    assert.eq(C.finalKcal({ kcalBasis: b }, 10, 70, 42), 42, 'log override wins'); assert.eq(C.finalKcal({ kcalBasis: b }, 10, 70, 0), 0, 'log override 0 is a value'); assert.eq(C.finalKcal({ kcalBasis: b }, 10, 70, null), 5);
    const m = C.computeItem({ targetKind: 'reps', target: 20, manualPct: 50, kcalBasis: b }, 70); assert.eq(m.kcalEst, 5, 'manual only: 20 x 50% x 0.5'); const a = C.computeItem({ targetKind: 'reps', target: 20, actual: 4, manualPct: 50, kcalBasis: b }, 70); assert.eq(a.kcalEst, 2, 'actual units win over manual %');
    assert.eq(C.toBasisUnits({ kcalBasis: { basis: 'per_minute' }, targetKind: 'seconds' }, 90), 1.5); assert.eq(C.toBasisUnits({ kcalBasis: { basis: 'per_km' }, targetKind: 'meters' }, 2500), 2.5);
    assert.eq(C.bodyWeightFor(D(0), []).kg, 70); assert.eq(C.bodyWeightFor(D(0), []).source, 'default');
    const ws = [{ typeId: 'mt:weight', value: 80, date: D(10), createdAt: 1 }, { typeId: 'mt:weight', value: 75, date: D(2), createdAt: 1 }, { typeId: 'mt:weight', value: 60, date: D(-1), createdAt: 1 }];
    assert.eq(C.bodyWeightFor(D(5), ws).kg, 80, 'on or before'); assert.eq(C.bodyWeightFor(D(0), ws).kg, 75); assert.eq(C.bodyWeightFor(D(0), ws).stale, false); assert.eq(C.bodyWeightFor(D(0), [{ typeId: 'mt:weight', value: 90, date: D(100), createdAt: 1 }]).stale, true, 'older than 60 days is flagged');
  });
  it('recipe per-serving equality before rounding; totals rounded to 0.1; fiber null when any ingredient fiber is unknown; confidence worst-of', ['FR-014', 'FR-005', 'QA-010'], async () => {
    const ings = [{ nutrition: { kcal: 33.3, protein: 1.1, carbs: 7.7, fat: 0.3, fiber: 1 }, confidence: 'typical' }, { nutrition: { kcal: 66.7, protein: 2.2, carbs: 3.3, fat: 1.9, fiber: 0.5 }, confidence: 'typical' }, { nutrition: { kcal: 100, protein: 5.55, carbs: 10.05, fat: 3.35, fiber: 2 }, confidence: 'verified' }];
    const r = C.recipeTotals(ings, 3); for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber']) assert.near(r.perServing[k] * 3, r.totals[k], 1e-9, `${k} per-serving x servings = total`);
    assert.eq(r.confidence, 'typical'); assert.eq(C.recipeTotals([...ings, { nutrition: { kcal: 1, protein: 0, carbs: 0, fat: 0, fiber: null }, confidence: 'estimate' }], 3).perServing.fiber, null, 'unknown fiber poisons recipe fiber'); assert.eq(C.recipeTotals([...ings, { nutrition: { kcal: 1, protein: 0, carbs: 0, fat: 0, fiber: null }, confidence: 'estimate' }], 3).confidence, 'estimate');
    const t = C.totalsFor({ kcal: 66.666667, protein: 3.333, carbs: 7.05, fat: 1.25, fiber: null }, 2.5); assert.deepEq(t, { kcal: 166.7, protein: 8.3, carbs: 17.6, fat: 3.1, fiber: null }, 'rounded to 0.1, null fiber stays null');
    await freshDb('rcp'); await ensureSeed(); const p = await repo.createProfile('R'); const rice = await seed.getFood('f:st-rice-white-cooked', p.id), egg = await seed.getFood('f:st-egg-boiled', p.id);
    const rec = await repo.saveFood(p.id, buildRecipeRecord({ name: 'Eq recipe', servings: 7, ingredients: [ingredientFrom(rice, rice.servings[1], 3), ingredientFrom(egg, egg.servings[0], 5)] })); assert.ok(recipeEquality(rec, 7 * 1e-6).ok, `maxDiff ${recipeEquality(rec).maxDiff} (stored per-serving has 6 decimals, so at most servings x 5e-7)`);
    assert.ok(C.dayTotals([]).kcal === null, 'no logs = no data, not 0');
  });
  it('serving math: per100 x baseAmount, implicit g/ml, qty step 0.25', ['FR-012'], async () => {
    await ensureSeed(); const rice = await seed.getFood('f:st-rice-white-cooked', 'a9-x'); const cup = rice.servings.find((s) => s.unit === 'cup');
    const per = C.servingNutrition(rice, cup); assert.near(per.kcal, rice.nutrition.kcal * cup.baseAmount / 100, 1e-3); assert.deepEq(C.implicitServing(rice, 'g'), { id: 'g', label: '1 g', unit: 'g', baseAmount: 1, implicit: true });
    assert.eq(C.totalsFor(per, 0.25).kcal, Math.round(per.kcal * 0.25 * 10) / 10); assert.eq(C.implicitServing({ nutrition: { per: { unit: 'serving', amount: 1 } } }), null);
  });
  it('effective-dated targets: a date resolves to the latest entry that started on or before it; earlier dates use the earliest', ['FR-016', 'DAT-030', 'QA-010'], async () => {
    const h = [{ from: '2026-03-01', kcal: 2000 }, { from: '2026-01-01', kcal: 1800 }, { from: '2026-06-01', kcal: 1500 }];
    assert.eq(C.resolveTargets(h, '2026-02-28').kcal, 1800); assert.eq(C.resolveTargets(h, '2026-03-01').kcal, 2000); assert.eq(C.resolveTargets(h, '2026-12-31').kcal, 1500); assert.eq(C.resolveTargets(h, '2025-01-01').kcal, 1800, 'before the first entry'); assert.eq(C.resolveTargets([], '2026-01-01'), null);
    await freshDb('tg'); const p = await repo.createProfile('T'); await repo.setTargets(p.id, { kcal: 1900, protein: 120, carbs: 220, fat: 60, fiber: 25, waterMl: 3000, steps: 7000 }, D(5));
    await repo.setTargets(p.id, { kcal: 1700, protein: 110, carbs: 200, fat: 55, fiber: 25, waterMl: 3000, steps: 8000 }, D(0)); const s = await repo.getSettings(p.id);
    assert.eq(C.resolveTargets(s.targetsHistory, D(0)).kcal, 1700); assert.eq(C.resolveTargets(s.targetsHistory, D(1)).kcal, 1900, 'yesterday keeps the old target'); assert.eq(C.resolveTargets(s.targetsHistory, D(30)).kcal, 1900, 'before the first entry = earliest');
    await repo.setTargets(p.id, { kcal: 1750, protein: 110, carbs: 200, fat: 55, fiber: 25, waterMl: 3000, steps: 8000 }, D(0)); const s2 = await repo.getSettings(p.id); assert.eq(s2.targetsHistory.filter((e) => e.from === D(0)).length, 1, 'same-day edit replaces, not duplicates');
  });
  it('null vs 0: averages skip no-data days; 0 counts; water/steps 0 differ from null; no logs = no data', ['DAT-009', 'FR-038', 'QA-010'], async () => {
    assert.deepEq(C.averagesOverDaysWithData([null, 0, 10, undefined, 20]), { avg: 10, n: 3, N: 5 }); assert.deepEq(C.averagesOverDaysWithData([null, null]), { avg: null, n: 0, N: 2 }); assert.deepEq(C.averagesOverDaysWithData([]), { avg: null, n: 0, N: 0 });
    assert.deepEq(C.waterDerived(null), { glasses: null, ml: null, litres: null, pct: null }); assert.deepEq(C.waterDerived(0, 500, 3000), { glasses: 0, ml: 0, litres: 0, pct: 0 }); assert.eq(C.waterDerived(5, 500, 3000).litres, 2.5);
    assert.eq(C.stepsPercent(null, 7000), null); assert.eq(C.stepsPercent(0, 7000), 0); assert.eq(C.stepsPercent(5830, 7000), 83);
    await freshDb('nul'); const p = await repo.createProfile('N'); assert.eq(await repo.getDay(p.id, D(0)), null, 'absent day = no data'); await repo.setWater(p.id, D(0), 0); const d = await repo.getDay(p.id, D(0)); assert.eq(d.water.glasses, 0, 'explicit 0'); assert.eq(d.steps.count, null, 'untouched steps stay null');
    await repo.setSteps(p.id, D(0), null); assert.eq((await repo.getDay(p.id, D(0))).steps.count, null, 'clearing stores null, not 0');
  });
});

// ------------------------------------------------------------------ backup / import helpers
const exportBackup = async (includePhotos = true) => (await prepareBackup({ includePhotos, now: new Date(2026, 9, 2, 10, 0) })).file;
const textOf = (f) => f.text();
/** Opens a zip backup, lets fn edit {manifest, wrapper, entries(Map name->Blob)}, rebuilds it. rehash:true recomputes size/CRC/SHA-256 of backup.json (so ONLY the validator can object). */
async function craftZip(file, fn, { rehash = true, rehashEntries = [] } = {}) {
  const z = await openZip(file); const manifest = JSON.parse(await z.text('manifest.json')); const wrapper = JSON.parse(await z.text('backup.json'));
  const entries = new Map(); for (const n of z.names()) if (n !== 'manifest.json' && n !== 'backup.json') entries.set(n, z.blob(n, n.endsWith('.jpg') ? 'image/jpeg' : ''));
  const ctx = { manifest, wrapper, entries }; await fn(ctx);
  const bj = enc.encode(JSON.stringify(ctx.wrapper)); const files = manifest.files || (manifest.files = []);
  const setFile = async (path, bytes) => { const f = files.find((x) => x.path === path); const rec = { path, bytes: bytes.length, crc32: crc32(bytes), sha256: await sha256Hex(bytes) }; if (f) Object.assign(f, rec); else files.push(rec); };
  if (rehash) await setFile('backup.json', bj);
  for (const n of rehashEntries) { const b = new Uint8Array(await ctx.entries.get(n).arrayBuffer()); await setFile(n, b); }
  for (let i = files.length - 1; i >= 0; i--) if (files[i].path !== 'backup.json' && !ctx.entries.has(files[i].path) && !ctx.keepListed) files.splice(i, 1);
  const list = [{ path: 'manifest.json', data: enc.encode(JSON.stringify(ctx.manifest)) }, { path: 'backup.json', data: bj }, ...[...ctx.entries].map(([path, data]) => ({ path, data }))];
  const { blob } = await createZip(list); return new File([blob], 'crafted.zip', { type: 'application/zip' });
}
/** JSON-only backup edited with a recomputed data checksum. */
async function craftJson(file, fn) {
  const o = JSON.parse(await textOf(file)); await fn(o);
  o.manifest.dataChecksum = { algo: 'sha256', value: await sha256Hex(enc.encode(JSON.stringify(o.data))) }; for (const s of repo.EXPORT_STORES) o.manifest.counts[s] = (o.data[s] || []).length;
  return new File([JSON.stringify(o)], 'crafted.json', { type: 'application/json' });
}
async function expectRejected(file, code, label) {
  const before = await snapshot({ meta: true }); let err = null;
  try { await importBackupFile(file, { mode: 'merge' }); } catch (e) { err = e; }
  assert.ok(err, `${label}: must be rejected`); assert.eq(err.code, code, `${label}: code (message: ${err && err.message})`);
  assert.deepEq(await snapshot({ meta: true }), before, `${label}: zero writes (stores and meta)`);
}
const exportData = async (includePhotos = false) => JSON.parse(await textOf(await exportBackup(includePhotos)));
const dropMeta = (s) => ({ counts: s.counts, hashes: s.hashes });

describe('A9 backup / import at scale (DAT-003..005, DAT-023, NFR-006, QA-010)', () => {
  it('the rich dataset is what the plan says: 2 profiles, 400 food logs, 60 workouts, 8 check-ins, 32 photos', ['QA-002'], async () => {
    await freshDb('rich'); const t0 = performance.now(); await buildRich(); const c = await repo.countStores(); report.richBuildMs = Math.round(performance.now() - t0);
    assert.eq(c.profiles, 2); assert.eq(c.foodLogs, 400); assert.eq(c.workoutLogs, 60); assert.eq(c.checkins, 8); assert.eq(c.photos, 32); assert.eq(c.photoData, 32); assert.ok(c.days >= 60 && c.sleepLogs === 60 && c.measurements === 48, JSON.stringify(c));
  });
  it('ROUND TRIP: export, import into an empty DB: counts and values identical per store; a second export is identical', ['DAT-003', 'DAT-004', 'NFR-006', 'DoD-18', 'QA-010'], async () => {
    await freshDb('rt-src'); await buildRich(); const s1 = dropMeta(await snapshot()); const file = await exportBackup(true);
    const m = JSON.parse(await (await openZip(file)).text('manifest.json')); for (const st of repo.EXPORT_STORES) assert.eq(m.counts[st], s1.counts[st], `manifest count ${st}`);
    assert.eq(m.includesPhotos, true); assert.eq(m.profiles.length, 2);
    await freshDb('rt-dst'); const res = await importBackupFile(file, { mode: 'merge' });
    assert.ok(res.verification.ok, 'post-import verification'); const s2 = dropMeta(await snapshot());
    assert.deepEq(s2.counts, s1.counts, 'counts per store'); assert.deepEq(s2.hashes, s1.hashes, 'content hash per store (photo bytes included)');
    const file2 = await exportBackup(true); const z1 = await openZip(file), z2 = await openZip(file2);
    assert.eq(await z2.text('backup.json'), await z1.text('backup.json'), 'second export has identical data'); assert.deepEq(z2.names().sort(), z1.names().sort(), 'same files');
    for (const n of z1.names().filter((x) => x.startsWith('photos/'))) assert.eq(await z2.crcOf(n), await z1.crcOf(n), `photo bytes ${n}`);
  });
  it('MERGE TWICE: importing the same backup again writes nothing and changes nothing', ['DAT-005', 'QA-010'], async () => {
    await freshDb('mt'); await buildRich({ logsPer: 20, workoutsPer: 6, daysPer: 10 }); const file = await exportBackup(true); const before = await snapshot();
    const r1 = await importBackupFile(file, { mode: 'merge' }); assert.eq(r1.writes, 0, 'into the DB it came from'); assert.eq(r1.changed, false); assert.deepEq(await snapshot(), before);
    await freshDb('mt2'); await importBackupFile(file, { mode: 'merge' }); const once = await snapshot();
    const r2 = await importBackupFile(file, { mode: 'merge' }); assert.eq(r2.writes, 0, 'second merge'); assert.deepEq(await snapshot(), once); for (const [st, t] of Object.entries(r2.totals)) assert.eq(t.new, 0, `${st} new on 2nd merge`);
  });
  it('CONFLICT RULES on foodLogs, workoutLogs, days, settings, foods and checkins: newer / older / tie x newest / mine / backup', ['DAT-005', 'QA-010'], async () => {
    await freshDb('cf'); const pids = await buildRich({ logsPer: 8, workoutsPer: 3, daysPer: 5 }); const baseFile = await exportBackup(false); const base = await snapshot();
    const [pid] = pids; const pick = {
      foodLogs: async () => (await repo.getFoodLogsRange(pid, D(30), D(0)))[0], workoutLogs: async () => (await repo.getWorkoutLogsRange(pid, D(30), D(0)))[0], days: async () => (await repo.getDaysRange(pid, D(30), D(0)))[0],
      settings: async () => repo.getSettings(pid), foods: async () => (await repo.listFoods(pid)).find((f) => !f.basedOn && f.kind === 'food'), checkins: async () => (await repo.listCheckins(pid))[0]
    };
    const edit = { foodLogs: (r) => { r.note = 'BACKUP-EDIT'; }, workoutLogs: (r) => { r.note = 'BACKUP-EDIT'; }, days: (r) => { r.note = { text: 'BACKUP-EDIT', tags: [] }; }, settings: (r) => { r.weekStart = 'sun'; }, foods: (r) => { r.notes = 'BACKUP-EDIT'; }, checkins: (r) => { r.note = 'BACKUP-EDIT'; } };
    const val = { foodLogs: (r) => r.note, workoutLogs: (r) => r.note, days: (r) => r.note && r.note.text, settings: (r) => r.weekStart, foods: (r) => r.notes, checkins: (r) => r.note };
    const wins = (pref, rel) => (pref === 'mine' ? 'local' : pref === 'backup' ? 'backup' : rel === 'newer' ? 'backup' : 'local'); const matrix = [];
    for (const store of Object.keys(pick)) {
      const local = await pick[store](); assert.ok(local, `no ${store} row to test`); const localVal = val[store](local);
      for (const rel of ['newer', 'older', 'tie']) for (const pref of ['newest', 'mine', 'backup']) {
        const f = await craftJson(baseFile, (o) => { const rec = o.data[store].find((r) => (store === 'days' ? r.pid === local.pid && r.date === local.date : store === 'settings' ? r.pid === local.pid : r.id === local.id)); edit[store](rec); rec.updatedAt = (local.updatedAt || 1e12) + (rel === 'newer' ? 5000 : rel === 'older' ? -5000 : 0); });
        const res = await importBackupFile(f, { mode: 'merge', preference: pref }); const now = await pick[store](); const got = [val[store](now)].some((v) => v === 'BACKUP-EDIT' || (store === 'settings' && v === 'sun')) ? 'backup' : 'local';
        matrix.push(`${store}/${rel}/${pref}=${got}`); assert.eq(got, wins(pref, rel), `${store} ${rel} ${pref}`); if (got === 'local') assert.eq(val[store](now), localVal, 'local value untouched'); void res;
        await importBackupFile(baseFile, { mode: 'replace', safetyBackup: 'skipped' }); assert.deepEq(dropMeta(await snapshot()).hashes, base.hashes, 'reset to baseline');
      }
    }
    report.conflictMatrix = matrix.length;
  });
  it('same-name custom foods with different ids are both kept; merge never deletes local-only rows', ['QA-010', 'DAT-005'], async () => {
    await freshDb('nm'); await ensureSeed(); const p = await repo.createProfile('NM'); const a = await makeCustomFood(p.id, 'Twin food');
    const file = await exportBackup(false); const f2 = await craftJson(file, (o) => { const c = clone(o.data.foods.find((x) => x.id === a.id)); c.id = 'fd_other_00001'; o.data.foods.push(c); });
    await repo.saveFood(p.id, { ...(await seed.getFood('f:st-egg-boiled', p.id)), id: undefined, basedOn: undefined, supersedes: undefined, name: 'Local only food', pid: p.id, system: false });
    await importBackupFile(f2, { mode: 'merge' }); const names = (await repo.listFoods(p.id)).map((x) => x.name).sort(); assert.eq(names.filter((n) => n === 'Twin food').length, 2); assert.ok(names.includes('Local only food'), 'local-only kept');
  });
  it('PROFILE MAPPING: backup profile ids that differ are re-homed by name in every store; skip drops that profile; create keeps its own id', ['QA-010', 'R-029'], async () => {
    await freshDb('pm-src'); const [A, B] = await buildRich({ logsPer: 6, workoutsPer: 3, daysPer: 4 }); const file = await exportBackup(true); const src = await snapshot();
    await freshDb('pm-dst'); const L = await repo.createProfile('Me A9'); const before = await repo.countStores(); const backupIds = new Set([A, B]);
    const res = await importBackupFile(file, { mode: 'merge', profileMap: { [A]: { action: 'map', targetPid: L.id }, [B]: { action: 'create', targetPid: B } } });
    assert.ok(res.verification.ok); const all = {}; for (const s of repo.USER_STORES.filter((x) => x !== 'photoData')) all[s] = await repo.readStoreAll(s);
    for (const s of Object.keys(all)) if (s !== 'profiles') for (const r of all[s]) assert.ok(r.pid !== A, `${s} still has the backup's old pid`);
    assert.eq(all.foodLogs.filter((r) => r.pid === L.id).length, (await src.counts.foodLogs) / 2, 'A logs re-homed'); assert.eq(all.profiles.length, 2, 'one existing + one created'); assert.ok(all.profiles.some((p) => p.id === B));
    for (const c of all.checkins.filter((x) => x.pid === L.id)) for (const ph of c.photos) assert.ok(all.photos.find((p) => p.id === ph.photoId && p.pid === L.id), 'photo meta re-homed');
    assert.ok(all.settings.some((x) => x.pid === L.id) && all.days.every((d) => d.pid === L.id || d.pid === B), 'composite keys re-homed'); assert.ok(sumCounts(await repo.countStores()) > sumCounts(before));
    await freshDb('pm-skip'); const L2 = await repo.createProfile('Only'); await importBackupFile(file, { mode: 'merge', profileMap: { [A]: { action: 'map', targetPid: L2.id }, [B]: { action: 'skip' } } });
    for (const s of ['foodLogs', 'workoutLogs', 'days', 'checkins', 'photos', 'measurements']) assert.ok((await repo.readStoreAll(s)).every((r) => r.pid === L2.id), `${s}: skipped profile leaked in`); assert.eq((await repo.listProfiles()).length, 1); void backupIds;
  });
  it('REPLACE is exact: extra local data and extra photos are removed, photo bytes restored, snapshot equals the backup', ['DAT-023', 'QA-010'], async () => {
    await freshDb('rp'); await buildRich({ logsPer: 10, workoutsPer: 4, daysPer: 6 }); const file = await exportBackup(true); const exact = await snapshot();
    const extra = await repo.createProfile('Extra'); await repo.setSteps(extra.id, D(0), 999); const pid = (await repo.listProfiles())[0].id;
    await repo.saveCheckinWithPhotos(pid, { date: D(1), periodDays: 7, periodStart: D(7), periodEnd: D(1), weight: 70, bodyFat: null, measurements: {}, autoStats: null, note: 'extra' }, [photoInput('front', 5000, 777)]);
    await repo.deleteFoodLog(pid, (await repo.getFoodLogsRange(pid, D(40), D(0)))[0].id);
    await importBackupFile(file, { mode: 'replace', safetyBackup: 'skipped' }); const after = await snapshot(); assert.deepEq(after.counts, exact.counts, 'counts'); assert.deepEq(after.hashes, exact.hashes, 'content incl. photo bytes');
    assert.deepEq(await repo.integrityScan(), { orphanPhotoData: [], orphanPhotos: [], photosMissingData: [], checkinsMissingPhotos: [] }, 'no orphans after replace');
  });
  it('REPLACE without a safety backup is refused with zero writes; a failing safety function also refuses; a passing one is accepted', ['DAT-023', 'QA-010'], async () => {
    await freshDb('sb-src'); await buildRich({ logsPer: 4, workoutsPer: 1, daysPer: 3 }); const file = await exportBackup(false); await freshDb('sb'); const keep = await repo.createProfile('Keep'); await repo.setWater(keep.id, D(0), 2); const before = await snapshot({ meta: true });
    for (const [label, sb, code] of [['missing', undefined, 'E_SAFETY_REQUIRED'], ['unknown string', 'later', 'E_SAFETY_REQUIRED'], ['function returns false', async () => false, 'E_SAFETY_FAILED'], ['function throws', async () => { throw new Error('x'); }, 'E_SAFETY_FAILED']]) {
      const e = await assert.throws(async () => applyImport(await openBackupFile(file), { mode: 'replace', safetyBackup: sb }), `${label}: must refuse`); assert.eq(e.code, code, label); assert.deepEq(await snapshot({ meta: true }), before, `${label}: zero writes`);
    }
    const ok = await applyImport(await openBackupFile(file), { mode: 'replace', safetyBackup: async () => true }); assert.ok(ok.verification.ok); assert.eq((await repo.listProfiles()).some((p) => p.name === 'Keep'), false, 'replace removed the local-only profile');
  });
  it('INJECTED FAILURE during apply (merge and replace, first / middle / last write, beforeCommit): every store AND meta unchanged', ['DAT-005', 'DAT-019', 'QA-010'], async () => {
    await freshDb('inj-src'); await buildRich({ logsPer: 15, workoutsPer: 4, daysPer: 8 }); const file = await exportBackup(true);
    await freshDb('inj-dst'); const seedProfile = await repo.createProfile('Local keep'); await repo.setWater(seedProfile.id, D(0), 2); const before = await snapshot({ meta: true });
    const probe = await buildPreview(await openBackupFile(file), { mode: 'merge' }); const n = probe.writeCount; assert.ok(n > 50, `writes ${n}`);
    for (const mode of ['merge', 'replace']) for (const at of [1, Math.floor(n / 2), n, 'commit']) {
      const handle = await openBackupFile(file); let err = null;
      try { await applyImport(handle, { mode, safetyBackup: 'skipped', hooks: at === 'commit' ? { beforeCommit: () => { throw new Error('INJECTED-COMMIT'); } } : { onWrite: (i) => { if (i === at) throw new Error('INJECTED'); } } }); } catch (e) { err = e; }
      assert.ok(err && /INJECTED/.test(err.message), `${mode}@${at}: the injected error must surface (got ${err && err.message})`);
      assert.deepEq(await snapshot({ meta: true }), before, `${mode}@${at}: DB changed after a failed import`);
    }
    const ok = await applyImport(await openBackupFile(file), { mode: 'merge' }); assert.ok(ok.verification.ok, 'the same backup still imports cleanly afterwards (no stuck busy flag)');
  });
  it('REJECTED with zero writes: truncated zip, flipped byte in zip, bad JSON checksum, wrong format, newer schema, unknown formatVersion, count mismatch, garbage, empty', ['DAT-005', 'DoD-19', 'QA-010'], async () => {
    await freshDb('rej-src'); await buildRich({ logsPer: 6, workoutsPer: 2, daysPer: 4 }); const zipFile = await exportBackup(true), jsonFile = await exportBackup(false);
    await freshDb('rej'); const keep = await repo.createProfile('Keep me'); await repo.setWater(keep.id, D(0), 3);
    await expectRejected(zipFile.slice(0, Math.floor(zipFile.size / 2)), 'I_DAMAGED', 'truncated zip');
    const z = await openZip(zipFile); const info = z.info('backup.json'); const flipped = new Blob([zipFile.slice(0, info.start + 40), new Uint8Array([(new Uint8Array(await zipFile.slice(info.start + 40, info.start + 41).arrayBuffer())[0]) ^ 0xFF]), zipFile.slice(info.start + 41)]);
    await expectRejected(new File([flipped], 'f.zip'), 'I_CHECKSUM', 'flipped byte inside backup.json');
    const jo = JSON.parse(await textOf(jsonFile)); const mut = (fn) => { const o = clone(jo); fn(o); return new File([JSON.stringify(o)], 'm.json'); };
    await expectRejected(mut((o) => { o.data.foodLogs[0].note = 'tampered'; }), 'I_CHECKSUM', 'JSON edited after checksum');
    await expectRejected(mut((o) => { o.manifest.format = 'something-else'; }), 'I_NOT_BACKUP', 'wrong manifest.format');
    await expectRejected(mut((o) => { o.manifest.schemaVersion = CURRENT_SCHEMA + 1; }), 'I_NEWER', 'newer schemaVersion');
    await expectRejected(mut((o) => { o.manifest.formatVersion = 99; }), 'I_NEWER', 'unknown formatVersion');
    await expectRejected(mut((o) => { o.manifest.formatVersion = 'x'; }), 'I_NOT_BACKUP', 'non-numeric formatVersion');
    await expectRejected(mut((o) => { o.manifest.counts.foodLogs += 1; delete o.manifest.dataChecksum; }), 'I_DAMAGED', 'count mismatch');
    await expectRejected(mut((o) => { o.data.foodLogs = 'nope'; delete o.manifest.dataChecksum; }), 'I_DAMAGED', 'store is not an array');
    await expectRejected(new File(['{ not json'], 'g.json'), 'I_DAMAGED', 'broken JSON'); await expectRejected(new File(['hello world'], 'g.txt'), 'I_NOT_BACKUP', 'not JSON at all'); await expectRejected(new File([''], 'e.json'), 'I_NOT_BACKUP', 'empty file');
    await expectRejected(await craftZip(zipFile, (c) => { c.manifest.format = 'nope'; }), 'I_NOT_BACKUP', 'zip with wrong manifest.format');
    await expectRejected(await craftZip(zipFile, (c) => { c.manifest.schemaVersion = 99; }), 'I_NEWER', 'zip with newer schemaVersion');
    for (const name of ['zip-python-deflate.zip', 'zip-truncated.zip']) await expectRejected(new File([await (await fetch(new URL(name, FIX))).blob()], name), 'I_DAMAGED', name);
  });
  it('INVALID RECORDS with a recomputed checksum are caught by the validator: preview counts them, apply needs explicit skip, nothing partial', ['DAT-008', 'DAT-005', 'QA-010'], async () => {
    await freshDb('inv-src'); const [pid] = await buildRich({ logsPer: 6, workoutsPer: 2, daysPer: 4 }); const jsonFile = await exportBackup(false);
    const injected = {};
    const bad = await craftJson(jsonFile, (o) => {
      const d = o.data; const m = clone(d.measurements[0]); m.id = 'ms_bad_neg'; m.value = -5; d.measurements.push(m); injected.negWeight = m.id;
      const w = clone(d.measurements[0]); w.id = 'ms_bad_huge'; w.value = 9999; d.measurements.push(w);
      const fl = clone(d.foodLogs[0]); fl.id = 'fl_bad_qty'; fl.qty = 0; d.foodLogs.push(fl);
      const fd = clone(d.foodLogs[0]); fd.id = 'fl_bad_date'; fd.date = '2026-13-45'; d.foodLogs.push(fd);
      const dy = clone(d.days[0]); dy.date = D(60); dy.water = { glasses: 99, glassMl: 500, ml: 49500 }; d.days.push(dy);
      const sl = clone(d.sleepLogs[0]); sl.id = 'sl_bad_dur'; sl.date = D(70); sl.durationMin = 0; d.sleepLogs.push(sl);
      const orph = clone(d.foodLogs[0]); orph.id = 'fl_orphan_pid'; orph.pid = 'p_unknown_profile'; d.foodLogs.push(orph);
      const dup = clone(d.foodLogs[1]); d.foodLogs.push(dup);
      d.foodLogs.push('not-an-object'); d.measurements.push(null);
    });
    const n = 10; await freshDb('inv'); const before = await snapshot({ meta: true });
    const h = await openBackupFile(bad); const pv = await buildPreview(h, { mode: 'merge' }); report.invalidFlagged = pv.invalidCount; assert.ok(pv.invalidCount >= n - 1, `validator flagged ${pv.invalidCount} of ${n} injected bad items`);
    let err = null; try { await applyImport(h, { mode: 'merge' }); } catch (e) { err = e; } assert.eq(err && err.code, 'I_INVALID_RECORDS', 'must demand an explicit choice'); assert.deepEq(await snapshot({ meta: true }), before, 'zero writes without the choice');
    const res = await applyImport(await openBackupFile(bad), { mode: 'merge', invalid: 'skip' }); assert.ok(res.verification.ok); assert.ok(res.summary.invalidSkipped >= n - 1);
    const logs = await repo.readStoreAll('foodLogs'); assert.ok(!logs.some((l) => /bad|orphan/.test(l.id)), 'bad food logs imported'); assert.ok(!(await repo.readStoreAll('measurements')).some((x) => x.value < 0 || x.value > 400), 'bad measurements imported');
    assert.ok((await repo.readStoreAll('days')).every((x) => !x.water || x.water.glasses == null || x.water.glasses <= 40), 'bad day imported');
    const clean = await snapshot(); await freshDb('inv2'); await importBackupFile(jsonFile, { mode: 'merge' }); assert.deepEq(clean.counts, (await snapshot()).counts, 'the good records are exactly the clean backup'); void pid;
  });
  it('DAMAGED PHOTOS (flipped byte, missing file, missing thumb, hash mismatch): user must choose; Import without keeps metadata and the good photos; zero writes before the choice', ['DAT-004', 'DAT-005', 'QA-010'], async () => {
    await freshDb('dp-src'); await buildRich({ logsPer: 4, workoutsPer: 1, daysPer: 3 }); const zipFile = await exportBackup(true); const z = await openZip(zipFile);
    const photoNames = z.names().filter((n) => /^photos\/[^/]+\.jpg$/.test(n)); assert.eq(photoNames.length, 32); const [n1, n2, n3, n4] = photoNames; const id = (n) => n.replace('photos/', '').replace('.jpg', '');
    const flip = async (blob, at) => { const b = new Uint8Array(await blob.arrayBuffer()); b[at] ^= 0xFF; return new Blob([b], { type: 'image/jpeg' }); };
    const bad = await craftZip(zipFile, async (c) => { c.entries.set(n1, await flip(c.entries.get(n1), 5)); c.entries.delete(n2); c.entries.delete('photos/thumbs/' + id(n3) + '.jpg'); c.entries.set(n4, await flip(c.entries.get(n4), 9)); c.keepListed = true; }, { rehashEntries: [n4] });
    // n1: bytes changed, zip CRC recomputed by createZip, manifest sha256/crc32 no longer match -> damaged. n2: file missing. n3: thumb missing. n4: manifest rehashed to the new bytes -> accepted (hash cannot know).
    await freshDb('dp'); const before = await snapshot({ meta: true }); const h = await openBackupFile(bad);
    const dmg = new Set(h.damagedPhotoIds); assert.ok(dmg.has(id(n1)) && dmg.has(id(n2)) && dmg.has(id(n3)), `damaged ids ${[...dmg].join(',')}`); assert.ok(!dmg.has(id(photoNames[10])), 'good photo not flagged'); report.damagedFlagged = dmg.size;
    let err = null; try { await applyImport(h, { mode: 'merge' }); } catch (e) { err = e; } assert.eq(err && err.code, 'I_PHOTOS_DAMAGED'); assert.deepEq(await snapshot({ meta: true }), before, 'zero writes before the user chooses');
    const res = await applyImport(await openBackupFile(bad), { mode: 'merge', damagedPhotos: 'import-without' }); assert.ok(res.verification.ok, 'verification'); const photos = await repo.readStoreAll('photos'), scan = await repo.integrityScan();
    assert.eq(photos.length, 32, 'metadata of damaged photos kept'); assert.ok(scan.photosMissingData.length >= 3 && scan.photosMissingData.includes(id(n1)), `photosMissingData ${scan.photosMissingData.length}`); assert.eq((await repo.countStores()).photoData, 32 - dmg.size, 'good photo bytes imported');
    assert.ok(scan.orphanPhotoData.length === 0 && scan.orphanPhotos.length === 0, 'no orphans created'); assert.eq(await repo.getPhotoBlob(photos[0].pid, id(n1), true), null, 'damaged photo has no bytes (UI shows "Photo not in this backup")');
  });
  it('JSON-only import never wipes photo bytes (merge and replace)', ['DAT-004', 'QA-010'], async () => {
    await freshDb('jo'); await buildRich({ logsPer: 4, workoutsPer: 1, daysPer: 3 }); const before = await snapshot(); const jsonFile = await exportBackup(false);
    await importBackupFile(jsonFile, { mode: 'merge' }); assert.deepEq(await snapshot(), before, 'merge'); await importBackupFile(jsonFile, { mode: 'replace', safetyBackup: 'skipped' }); const a = await snapshot();
    assert.eq(a.counts.photoData, 32, 'photo bytes kept by Replace from a JSON-only file'); assert.deepEq(a.hashes.photoData, before.hashes.photoData, 'photo bytes identical'); assert.deepEq(a.counts, before.counts);
  });
  it('post-import verification catches an injected mismatch (count and photo bytes)', ['DAT-005', 'QA-010'], async () => {
    await freshDb('vf-src'); await buildRich({ logsPer: 4, workoutsPer: 1, daysPer: 3 }); const file = await exportBackup(true); await freshDb('vf'); const res = await importBackupFile(file, { mode: 'merge' }); assert.ok(res.verification.ok);
    const fl = (await repo.readStoreAll('foodLogs'))[0]; await db.del('foodLogs', fl.id); const v = await verifyAfterImport({ expected: res.expected, writes: [] }); assert.eq(v.ok, false); assert.eq(v.checks.find((c) => c.store === 'foodLogs').ok, false);
    const ph = (await repo.readStoreAll('photoData'))[0]; const v2 = await verifyAfterImport({ expected: { ...res.expected, foodLogs: res.expected.foodLogs - 1 }, writes: [{ store: 'photoData', op: 'put', key: ph.id, rec: { id: ph.id, blob: new Blob([new Uint8Array(ph.blob.size + 7)]) } }] });
    assert.eq(v2.photoBytes.ok, false, 'byte mismatch detected'); assert.eq(v2.ok, false);
  });
  it('bookkeeping: import never sets lastBackupAt; changesSinceBackup rises; lastImportSummary saved; Prepare alone does not record a backup', ['DAT-015', 'QA-010'], async () => {
    await freshDb('bk-src'); await buildRich({ logsPer: 4, workoutsPer: 1, daysPer: 3 }); const file = await exportBackup(true); assert.eq(await getLastBackupAt(), null, 'Prepare does not record');
    await freshDb('bk'); const c0 = (await getMeta('changesSinceBackup', 0)); await importBackupFile(file, { mode: 'merge' }); assert.eq(await getLastBackupAt(), null); assert.eq(lsGet('lastBackupAt'), null); assert.ok((await getMeta('changesSinceBackup', 0)) > c0); const s = await getMeta('lastImportSummary'); assert.ok(s && s.mode === 'merge' && s.verificationOk === true);
  });
  it('EXPORT CONTENT: no meta, no seed, no LocalStorage; photoData only as files; exportCategories map covers every category in the brief', ['DAT-003', 'DAT-021', 'DAT-028'], async () => {
    await freshDb('ex'); await buildRich({ logsPer: 6, workoutsPer: 2, daysPer: 4 }); lsSet('sentinel', { hadData: true, firstWriteAt: 1, installId: 'in_ls_marker' }); await setMeta('reminderState', { marker: 'META-MARKER' });
    const file = await exportBackup(true); const z = await openZip(file); const manifest = JSON.parse(await z.text('manifest.json')); const text = await z.text('backup.json'); const data = JSON.parse(text).data;
    assert.deepEq(Object.keys(data).sort(), [...repo.EXPORT_STORES].sort(), 'only exported stores'); assert.ok(!('meta' in data) && !('photoData' in data)); assert.ok(!/META-MARKER|in_ls_marker|winter-arc:|sentinel/.test(text), 'no meta or LocalStorage content');
    assert.ok(data.foods.every((f) => !String(f.id).startsWith('f:') && f.system !== true), 'seed foods are not exported (copies only)'); assert.ok(data.plans.every((p) => !String(p.id).startsWith('plan:')) && data.exercises.every((p) => !String(p.id).startsWith('ex:')));
    assert.ok(data.photos.every((p) => !p.thumb || !(p.thumb instanceof Object) || Object.keys(p.thumb).length === 0), 'no Blob objects inside JSON');
    const need = ['users', 'goals', 'custom foods/recipes', 'exercise library', 'workout plans', 'daily/step/water logs, notes', 'food logs', 'exercise logs', 'sleep logs', 'measurements', 'check-ins', 'photos', 'settings', 'favourites/recents'];
    const cats = manifest.exportCategories || {}; const miss = need.filter((k) => !(k in cats)); assert.eq(miss.length, 0, `exportCategories missing: ${miss.join(' | ')} (have: ${Object.keys(cats).join(' | ')})`);
    for (const f of ['formatVersion', 'schemaVersion', 'appVersion', 'seedVersion', 'createdAt', 'installId', 'includesPhotos', 'profiles', 'counts', 'files']) assert.ok(f in manifest, `manifest.${f}`);
    assert.eq(manifest.format, 'winter-arc-backup'); assert.ok(manifest.files.every((f) => f.sha256 && f.bytes >= 0), 'SHA-256 for every file'); assert.ok(/^winter-arc-backup-\d{4}-\d{2}-\d{2}\.zip$/.test((await prepareBackup({ now: new Date(2026, 9, 2) })).filename), 'filename uses the local date');
  });
  it('FINDING F-A9-01: applyImport must leave the seed overlay (custom foods, hidden seed, plan copies) fresh, otherwise imported data is invisible until reload', ['DAT-005', 'UX-020', 'FR-013'], async () => {
    await freshDb('ov-src'); await ensureSeed(); const p = await repo.createProfile('Overlay'); await makeCustomFood(p.id, 'Zzoverlay Imported Food'); const file = await exportBackup(false);
    await db.del('foods', (await repo.listFoods(p.id))[0].id); seed.invalidateOverlay(); await seed.prepare(p.id, { force: true });
    assert.eq((await seed.search('zzoverlay', p.id, 5)).length, 0, 'precondition: the overlay is loaded and empty'); await importBackupFile(file, { mode: 'merge' });
    const hit = await seed.search('zzoverlay', p.id, 5); assert.ok(hit.length === 1, 'imported custom food is not searchable right after import (stale overlay: nothing calls invalidateOverlay)');
  });
});

describe('A9 findings that need a fix (red until A12)', () => {
  it('FINDING F-A9-02: a hash-valid backup cannot smuggle impossible values: negative or inconsistent food totals, kcalTotal < 0, item pct > 100, absurd body weight, non-canonical unit, glass size 100000 ml', ['DAT-008', 'DAT-022', 'DoD-14'], async () => {
    const fx = await (await fetch(new URL('backup-v1.json', FIX))).json(); const D1 = fx.data; const probes = {};
    const t = (name, store, rec) => { probes[name] = validateRecord(store, rec).ok; };
    let x = clone(D1.foodLogs[0]); x.totals.kcal = -10; t('foodLog totals.kcal = -10', 'foodLogs', x);
    x = clone(D1.foodLogs[0]); x.totals.kcal = 99999; t('foodLog totals.kcal = 99999 (not qty x per1serving)', 'foodLogs', x);
    x = clone(D1.foodLogs[0]); x.per1serving.protein = -3; t('foodLog per1serving.protein = -3', 'foodLogs', x);
    x = clone(D1.workoutLogs[0]); x.kcalTotal = -50; t('workoutLog kcalTotal = -50', 'workoutLogs', x);
    x = clone(D1.workoutLogs[0]); x.items[0].pct = 250; t('workoutLog item pct = 250', 'workoutLogs', x);
    x = clone(D1.workoutLogs[0]); x.items[0].manualPct = 150; t('workoutLog item manualPct = 150', 'workoutLogs', x);
    x = clone(D1.workoutLogs[0]); x.bodyWeightKg = 2; t('workoutLog bodyWeightKg = 2', 'workoutLogs', x);
    x = clone(D1.measurements[0]); x.unit = 'lbs'; t('measurement unit = lbs', 'measurements', x);
    x = clone(D1.settings[0]); x.glassMl = 100000; t('settings glassMl = 100000', 'settings', x);
    const accepted = Object.entries(probes).filter(([, ok]) => ok).map(([k]) => k); report.validatorAccepted = accepted; assert.eq(accepted.length, 0, `validateRecord accepts: ${accepted.join(' | ')}`);
  });
  it('FINDING F-A9-03: after a Merge, every check-in photo reference resolves and every photo of a check-in is listed in it (photo slot clash vs check-in newer)', ['DAT-005', 'DAT-024', 'FR-032'], async () => {
    await freshDb('clash'); const p = await repo.createProfile('Cl'); const ckBase = { date: D(0), periodDays: 7, periodStart: D(6), periodEnd: D(0), weight: 70, bodyFat: null, measurements: {}, autoStats: null, note: 'orig' };
    const saved = await repo.saveCheckinWithPhotos(p.id, ckBase, [photoInput('front', 4000, 31)]); const A = saved.photos[0].photoId;
    const file = await exportBackup(true); const z = await openZip(file); const wrapper = JSON.parse(await z.text('backup.json')); const mf = JSON.parse(await z.text('manifest.json'));
    // device 2 retook the front photo (new id B, OLDER than A) and edited the check-in afterwards (newer than local): check-in wins, photo loses the slot clash
    const B = 'ph_clash_other'; const crafted = await craftZip(file, async (c) => {
      const pa = c.wrapper.data.photos[0]; const pb = { ...clone(pa), id: B, createdAt: pa.createdAt - 10000 }; c.wrapper.data.photos = [pb]; c.entries.delete(`photos/${A}.jpg`); c.entries.delete(`photos/thumbs/${A}.jpg`);
      c.entries.set(`photos/${B}.jpg`, jpeg(4100, 77)); c.entries.set(`photos/thumbs/${B}.jpg`, jpeg(900, 78)); const ck = c.wrapper.data.checkins[0]; ck.photos = [{ photoId: B, slot: 'front' }]; ck.updatedAt += 50000; ck.note = 'edited on device 2';
    }, { rehashEntries: [`photos/${B}.jpg`, `photos/thumbs/${B}.jpg`] }); void mf; void wrapper;
    const res = await importBackupFile(crafted, { mode: 'merge', preference: 'newest' }); assert.ok(res.verification.ok, 'import itself succeeds');
    const ck = (await repo.listCheckins(p.id))[0], photos = await repo.listPhotos(p.id, ck.id), scan = await repo.integrityScan(); const listed = new Set(ck.photos.map((r) => r.photoId));
    const dangling = ck.photos.filter((r) => !photos.some((x) => x.id === r.photoId)).map((r) => r.photoId), hidden = photos.filter((x) => !listed.has(x.id)).map((x) => x.id);
    report.photoClash = { dangling, hidden, scan }; assert.ok(dangling.length === 0 && hidden.length === 0 && scan.checkinsMissingPhotos.length === 0, `check-in lists ${JSON.stringify(dangling)} which is missing; photo(s) ${JSON.stringify(hidden)} exist but the check-in does not list them`);
  });
  it('photo slot clash with a NEWER backup photo replaces the old photo and its bytes (no unique-index failure, no orphan)', ['DAT-005', 'DAT-024'], async () => {
    await freshDb('clash2'); const p = await repo.createProfile('Cl2'); const saved = await repo.saveCheckinWithPhotos(p.id, { date: D(0), periodDays: 7, periodStart: D(6), periodEnd: D(0), weight: 70, bodyFat: null, measurements: {}, autoStats: null, note: 'o' }, [photoInput('front', 4000, 41)]); const A = saved.photos[0].photoId;
    const file = await exportBackup(true); const B = 'ph_clash_newer';
    const crafted = await craftZip(file, async (c) => { const pa = c.wrapper.data.photos[0]; c.wrapper.data.photos = [{ ...clone(pa), id: B, createdAt: pa.createdAt + 10000 }]; c.entries.delete(`photos/${A}.jpg`); c.entries.delete(`photos/thumbs/${A}.jpg`); c.entries.set(`photos/${B}.jpg`, jpeg(4200, 79)); c.entries.set(`photos/thumbs/${B}.jpg`, jpeg(800, 80)); const ck = c.wrapper.data.checkins[0]; ck.photos = [{ photoId: B, slot: 'front' }]; ck.updatedAt += 50000; }, { rehashEntries: [`photos/${B}.jpg`, `photos/thumbs/${B}.jpg`] });
    const res = await importBackupFile(crafted, { mode: 'merge', preference: 'newest' }); assert.ok(res.verification.ok); const c = await repo.countStores(); assert.eq(c.photos, 1); assert.eq(c.photoData, 1); assert.eq((await repo.listPhotos(p.id, saved.id))[0].id, B);
    assert.deepEq(await repo.integrityScan(), { orphanPhotoData: [], orphanPhotos: [], photosMissingData: [], checkinsMissingPhotos: [] });
  });
});

describe('A9 migration fixtures (DAT-026, NFR-010, D-034)', () => {
  it('every released schemaVersion has a fixture and (below current) a golden file; the shipped fixture matches its manifest', ['DAT-026'], async () => {
    for (let n = 1; n <= CURRENT_SCHEMA; n++) { const r = await fetch(new URL(`backup-v${n}.json`, FIX)); assert.ok(r.ok, `fixture backup-v${n}.json`); if (n < CURRENT_SCHEMA) assert.ok((await fetch(new URL(`golden-v${n + 1}.json`, FIX))).ok, `golden-v${n + 1}.json`); }
    const fx = await (await fetch(new URL('backup-v1.json', FIX))).json(); assert.eq(fx.manifest.schemaVersion, 1); for (const s of repo.EXPORT_STORES) assert.eq(fx.manifest.counts[s], (fx.data[s] || []).length, `fixture count ${s}`);
  });
  it('the schema-1 fixture imports with counts equal to its manifest, values untouched', ['DAT-026', 'DoD-19'], async () => {
    await freshDb('fx'); const text = await (await fetch(new URL('backup-v1.json', FIX))).text(); const fx = JSON.parse(text); const res = await importBackupFile(new File([text], 'backup-v1.json'), { mode: 'merge' }); assert.ok(res.verification.ok);
    const c = await repo.countStores(); for (const s of repo.EXPORT_STORES) if (s !== 'photos') assert.eq(c[s], fx.manifest.counts[s], s); const logs = await repo.readStoreAll('foodLogs'); assert.deepEq(logs.sort((a, b) => a.id.localeCompare(b.id)), clone(fx.data.foodLogs).sort((a, b) => a.id.localeCompare(b.id)), 'food logs equal the fixture');
  });
  it('SYNTHETIC schema 2 proves the framework: test-only step on a copy renames a field; idempotent; input untouched; live DB migrates in one tx; a failing step leaves the DB unchanged', ['DAT-026', 'D-034'], async () => {
    const fx = await (await fetch(new URL('backup-v1.json', FIX))).json(); const step = (d) => { for (const r of d.foodLogs) if ('note' in r) { r.remarks = r.note; delete r.note; } return d; };
    registerTestStep(1, step);
    try {
      const orig = clone(fx.data); const m = migrateData(fx.data, 1, 2); assert.deepEq(fx.data, orig, 'input not mutated'); assert.deepEq(m.applied, [1]); assert.ok(m.data.foodLogs.every((r) => !('note' in r) && 'remarks' in r));
      const again = migrateData(m.data, 1, 2); assert.deepEq(again.data, m.data, 'idempotent');
      await freshDb('mg'); await ensureSeed(); const p = await repo.createProfile('Mig'); const f = await seed.getFood('f:st-egg-boiled', p.id); await repo.addFoodLog(p.id, { date: D(1), food: f, serving: f.servings[0], qty: 1, meal: mealOf(0), note: 'keep me' });
      const before = await snapshot(); await db.tx(['meta'], 'readwrite', (t) => t.store('meta').put({ k: 'schemaVersion', v: 1 })); const r = await migrateLiveDb(); assert.deepEq(r.applied, [1]); assert.eq((await db.get('meta', 'schemaVersion')).v, 2);
      const log = (await repo.readStoreAll('foodLogs'))[0]; assert.eq(log.remarks, 'keep me'); assert.ok(!('note' in log)); assert.eq((await snapshot()).counts.foodLogs, before.counts.foodLogs);
      registerTestStep(1, () => { throw new Error('STEP-BROKEN'); }); await db.tx(['meta'], 'readwrite', (t) => t.store('meta').put({ k: 'schemaVersion', v: 1 })); const mid = await snapshot({ meta: true }); let err = null; try { await migrateLiveDb(); } catch (e) { err = e; }
      assert.ok(err, 'failing migration must throw'); assert.deepEq(await snapshot({ meta: true }), mid, 'failed live migration leaves every store and meta unchanged'); assert.eq((await db.get('meta', 'schemaVersion')).v, 1, 'schemaVersion not advanced');
    } finally { clearTestSteps(); const { safeModeSignal } = await import('../js/core/migrate.js'); safeModeSignal.active = false; safeModeSignal.reason = null; appStore.set('safeMode', false); }
  });
  it('a backup from a newer schema is refused by the migration pipeline too (not only by the manifest check)', ['DAT-005', 'D-034'], () => { let e = null; try { migrateData({}, CURRENT_SCHEMA + 1, CURRENT_SCHEMA); } catch (x) { e = x; } assert.ok(e && e.code === 'I_NEWER'); });
});

describe('A9 photos (DAT-002, DAT-013, DAT-024, D-018, D-032)', () => {
  const ck = (extra = {}) => ({ date: D(0), periodDays: 7, periodStart: D(6), periodEnd: D(0), weight: 70, bodyFat: null, measurements: {}, autoStats: null, note: null, ...extra });
  it('limits: at most 4 photos, one per slot, only the four slots; every refusal writes nothing; the unique [checkinId,slot] index backs it up', ['DAT-013', 'FR-032'], async () => {
    await freshDb('pl'); const p = await repo.createProfile('PL'); const before = await snapshot(); const chg = await getMeta('changesSinceBackup', 0);
    const five = [...PHOTO.slots, 'front'].map((s, i) => photoInput(s, 3000, 40 + i)); for (const [label, list] of [['5 photos', five], ['duplicate slot', [photoInput('front', 3000, 1), photoInput('front', 3000, 2)]], ['bad slot', [photoInput('selfie', 3000, 3)]]]) {
      let err = null; try { await repo.saveCheckinWithPhotos(p.id, ck(), list); } catch (e) { err = e; } assert.ok(err, `${label} must be refused`); assert.deepEq(await snapshot(), before, `${label}: nothing written`); assert.eq(await getMeta('changesSinceBackup', 0), chg, `${label}: no change counted`);
    }
    const saved = await repo.saveCheckinWithPhotos(p.id, ck(), PHOTO.slots.map((s, i) => photoInput(s, 3000, 60 + i))); assert.eq(saved.photos.length, 4); assert.eq((await repo.listPhotos(p.id, saved.id)).length, 4);
    const re = await repo.saveCheckinWithPhotos(p.id, { ...saved }, [photoInput('front', 3500, 99)]); assert.eq(re.photos.length, 4, 'retaking a slot replaces, never adds a fifth'); assert.eq((await repo.countStores()).photoData, 4, 'old bytes removed with the replaced photo');
    const m = (await repo.listPhotos(p.id, saved.id))[0]; let raw = null; try { await db.put('photos', { ...m, id: 'ph_clash_x' }); } catch (e) { raw = e; } assert.ok(raw, 'unique index must refuse a second photo for the same slot');
  });
  async function exifJpeg(w, h, { orientation = null, marker = 'GPSMARK-A9-LAT-12.34' } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, w, h); g.fillStyle = '#39f'; g.fillRect(0, 0, w / 2, h / 4);
    const base = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const body = []; const t = (...x) => body.push(...x); t(0x45, 0x78, 0x69, 0x66, 0, 0); // 'Exif\0\0'
    t(0x49, 0x49, 0x2A, 0x00, 8, 0, 0, 0); const ifd = [0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, orientation || 1, 0, 0, 0, 0, 0, 0, 0]; t(...ifd);
    for (const ch of marker) t(ch.charCodeAt(0)); const len = body.length + 2; const seg = new Uint8Array([0xFF, 0xE1, len >> 8, len & 255, ...body]);
    const out = new Uint8Array(base.length + seg.length); out.set(base.subarray(0, 2), 0); out.set(seg, 2); out.set(base.subarray(2), 2 + seg.length); return new File([out], 'exif.jpg', { type: 'image/jpeg' });
  }
  const dims = async (blob) => { const b = await createImageBitmap(blob, { imageOrientation: 'none' }); const d = { w: b.width, h: b.height }; b.close(); return d; };
  const hasBytes = async (blob, text) => { const hay = new Uint8Array(await blob.arrayBuffer()); const nd = enc.encode(text); outer: for (let i = 0; i <= hay.length - nd.length; i++) { for (let j = 0; j < nd.length; j++) if (hay[i + j] !== nd[j]) continue outer; return true; } return false; };
  it('pipeline: a 3000x2000 photo with EXIF + GPS becomes <=1600 px long edge, thumb <=320, JPEG, and no EXIF/GPS survives', ['DAT-013', 'D-018'], async () => {
    const src = await exifJpeg(3000, 2000); assert.ok(await hasBytes(src, 'GPSMARK-A9-LAT'), 'precondition: the test file carries the marker'); const out = await processImage(src);
    assert.ok(Math.max(out.w, out.h) <= PHOTO.longEdge && Math.max(out.w, out.h) >= 1590, `full ${out.w}x${out.h}`); assert.eq(out.mime, 'image/jpeg'); const td = await dims(out.thumb); assert.ok(Math.max(td.w, td.h) <= 320 && Math.max(td.w, td.h) >= 310, `thumb ${td.w}x${td.h}`);
    for (const b of [out.blob, out.thumb]) { assert.ok(!(await hasBytes(b, 'GPSMARK-A9-LAT')), 'GPS marker survived'); assert.ok(!(await hasBytes(b, 'Exif')), 'EXIF segment survived'); assert.eq(b.type, 'image/jpeg'); }
    assert.eq(out.bytes, out.blob.size); assert.eq(out.crc32, await crc32Blob(out.blob)); assert.ok(out.bytes < 900 * 1024, `size ${out.bytes}`);
  });
  it('pipeline: portrait 2000x3000 keeps its aspect; a small image is not upscaled; non-images and empty files are refused', ['D-018'], async () => {
    const p = await processImage(await exifJpeg(2000, 3000)); assert.ok(p.h <= 1600 && p.w < p.h && Math.abs(p.w / p.h - 2 / 3) < 0.01, `${p.w}x${p.h}`);
    const s = await processImage(await exifJpeg(400, 300)); assert.eq(s.w, 400); assert.eq(s.h, 300, 'never upscaled');
    for (const bad of [new File(['hello'], 'x.txt', { type: 'text/plain' }), new File([], 'e.jpg', { type: 'image/jpeg' }), new File([randBytes(500, 3)], 'junk.jpg', { type: 'image/jpeg' })]) { const e = await assert.throws(() => processImage(bad)); assert.eq(e.code, 'C_PHOTO_FAIL'); }
  });
  it('pipeline: EXIF orientation 6 (phone held upright) is honoured: a 300x200 file comes out 200x300', ['D-018', 'R-035'], async () => {
    const o = await processImage(await exifJpeg(300, 200, { orientation: 6 })); assert.ok(o.h > o.w, `orientation ignored: ${o.w}x${o.h}`);
  });
  it('orphan scan finds every injected orphan; Clean up removes only orphans (and their bytes) and nothing else', ['DAT-024', 'QA-010'], async () => {
    await freshDb('orph'); const p = await repo.createProfile('Or'); const good = await repo.saveCheckinWithPhotos(p.id, ck(), [photoInput('front', 4000, 5), photoInput('side', 4000, 6)]);
    const t = Date.now(); const meta = (id, ckId, slot) => ({ id, pid: p.id, checkinId: ckId, slot, date: D(0), w: 10, h: 10, bytes: 3, thumbBytes: 3, mime: 'image/jpeg', crc32: 0, thumb: jpeg(10, 3), createdAt: t });
    await db.tx(['photos', 'photoData', 'checkins'], 'readwrite', async (x) => {
      await x.store('photoData').put({ id: 'ph_orphan_data', blob: jpeg(10, 1) });                                       // bytes without metadata
      await x.store('photos').put(meta('ph_orphan_meta', 'ck_gone', 'front')); await x.store('photoData').put({ id: 'ph_orphan_meta', blob: jpeg(10, 2) }); // metadata + bytes, check-in missing
      await x.store('photos').put(meta('ph_nodata', good.id, 'back'));                                                  // metadata without bytes
      await x.store('checkins').put({ ...good, id: 'ck_dangling', photos: [{ photoId: 'ph_nowhere', slot: 'front' }] }); // check-in pointing at a missing photo
    });
    const scan = await repo.integrityScan(); assert.deepEq(scan.orphanPhotoData, ['ph_orphan_data']); assert.deepEq(scan.orphanPhotos, ['ph_orphan_meta']); assert.deepEq(scan.photosMissingData, ['ph_nodata']); assert.deepEq(scan.checkinsMissingPhotos, [{ checkinId: 'ck_dangling', photoId: 'ph_nowhere' }]);
    const keepBefore = (await snapshot()); const goodRows = [await db.get('photos', good.photos[0].photoId), await db.get('photoData', good.photos[0].photoId)];
    const removed = await repo.cleanupOrphans(scan); assert.eq(removed, 2); const after = await repo.integrityScan();
    assert.deepEq(after.orphanPhotoData, []); assert.deepEq(after.orphanPhotos, []); assert.deepEq(after.photosMissingData, ['ph_nodata'], 'not an orphan: kept'); assert.eq(after.checkinsMissingPhotos.length, 1, 'not an orphan: kept');
    assert.deepEq(await canon([await db.get('photos', good.photos[0].photoId), await db.get('photoData', good.photos[0].photoId)]), await canon(goodRows), 'good photo untouched'); const a = await snapshot(); assert.eq(a.counts.photoData, keepBefore.counts.photoData - 2); assert.eq(a.counts.checkins, keepBefore.counts.checkins);
  });
  it('cascade delete: deleting a check-in removes its photos and bytes in one step and leaves other check-ins alone', ['DAT-024', 'FR-032'], async () => {
    await freshDb('casc'); const p = await repo.createProfile('Ca'); const a = await repo.saveCheckinWithPhotos(p.id, ck(), [photoInput('front', 4000, 7), photoInput('side', 4000, 8)]); const b = await repo.saveCheckinWithPhotos(p.id, ck({ date: D(7) }), [photoInput('front', 4000, 9)]);
    await repo.deleteCheckin(p.id, a.id); const c = await repo.countStores(); assert.eq(c.checkins, 1); assert.eq(c.photos, 1); assert.eq(c.photoData, 1); assert.deepEq(await repo.integrityScan(), { orphanPhotoData: [], orphanPhotos: [], photosMissingData: [], checkinsMissingPhotos: [] }); assert.ok((await repo.getPhotoBlob(p.id, b.photos[0].photoId, true)) instanceof Blob);
  });
  it('QuotaExceeded: low free space refuses before writing; a real QuotaExceededError mid-transaction leaves nothing (check-in, photos, bytes, measurements)', ['DAT-013', 'DAT-019', 'DAT-017'], async () => {
    await freshDb('quota'); const p = await repo.createProfile('Q'); const before = await snapshot(); const chg = await getMeta('changesSinceBackup', 0); const list = [photoInput('front', 60000, 21), photoInput('side', 60000, 22)];
    const est = navigator.storage.estimate; navigator.storage.estimate = async () => ({ usage: 1e9 - 10000, quota: 1e9 });
    try { let err = null; try { await repo.saveCheckinWithPhotos(p.id, ck(), list, { writeMeasurements: true }); } catch (e) { err = e; } assert.ok(err && err.name === 'QuotaError', `low space: ${err && err.name}`); assert.deepEq(await snapshot(), before, 'nothing saved (low space)'); assert.eq(await getMeta('changesSinceBackup', 0), chg); } finally { navigator.storage.estimate = est; delete navigator.storage.estimate; }
    const put = IDBObjectStore.prototype.put; let n = 0; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'photoData' && ++n === 2) throw new DOMException('quota', 'QuotaExceededError'); return put.apply(this, a); };
    try { let err = null; try { await repo.saveCheckinWithPhotos(p.id, ck({ weight: 71 }), list, { writeMeasurements: true }); } catch (e) { err = e; } assert.ok(err, 'must fail'); assert.ok(err.name === 'QuotaError' || /quota/i.test(err.message || err.name), `error is ${err.name}: ${err.message}`); } finally { IDBObjectStore.prototype.put = put; }
    assert.deepEq(await snapshot(), before, 'nothing saved after a quota failure in the middle of the transaction'); assert.eq(await getMeta('changesSinceBackup', 0), chg, 'failed save is not counted as a change');
  });
});

describe('A9 no fixed weekday, whole repo (FR-020, DoD-09, QA-010)', () => {
  const TEXT = /\.(js|css|json|html|md|txt|webmanifest|svg)$/i;
  async function repoFiles() { const j = await (await fetch(new URL('a9-repo-files.json', FIX))).json(); return j.files; }
  const ALLOW = [
    { file: 'js/core/dates.js', line: /const WS =|export function weekStart|export function weeksBetween|const DN =/ },   // week-start maths and display-only day names (formatDay/formatLong)
    { file: 'js/features/settings/display.js', line: /WEEK_START_OPTIONS|weekStart/ },                                       // the week-start setting labels
    { file: 'js/core/validate.js', line: /weekStart/ }, { file: 'js/core/repo.js', line: /weekStart/ }                      // settings enum and default
  ];
  it('PRODUCT FILES (js, css, data, html, manifest, sw, version, config, README): every weekday word is an allow-listed week-start setting or date display; the rest is 0', ['FR-020', 'DoD-09', 'QA-010'], async () => {
    const files = (await repoFiles()).filter((f) => TEXT.test(f) && !/^(tests|docs)\//.test(f) && !/^tools\//.test(f)); const texts = {};
    for (const f of files) texts[f] = await (await fetch(new URL(f, REPO))).text(); assert.ok(Object.keys(texts).length > 100, `scanned ${Object.keys(texts).length}`);
    const hits = scanForWeekdays(texts, ALLOW); report.weekdayProductHits = hits; report.weekdayFilesScanned = Object.keys(texts).length; assert.eq(hits.length, 0, hits.slice(0, 5).map((h) => `${h.file}:${h.line} "${h.match}"`).join(' | '));
  });
  it('structural: nothing maps a plan to a day; getDay() appears only in dates.js; no weekday/schedule key in any stored record or plan', ['FR-020', 'DoD-09'], async () => {
    const files = (await repoFiles()).filter((f) => /^js\/.*\.js$/.test(f)); const bad = [];
    for (const f of files) { const t = await (await fetch(new URL(f, REPO))).text(); if (f !== 'js/core/dates.js' && /\.getDay\s*\(/.test(t)) bad.push(`${f} uses getDay()`); if (/\bweekday|dayOfWeek|\bdow\b/i.test(t.replace(/\/\/.*$/gm, ''))) bad.push(`${f} mentions weekday outside comments`); }
    assert.eq(bad.length, 0, bad.join(' | '));
  });
  it('behaviour: any of the six plans can be logged on any of 7 consecutive dates, twice a day, in any order; logs carry no weekday field', ['FR-020', 'DoD-09'], async () => {
    await freshDb('nwd'); await ensureSeed(); const p = await repo.createProfile('NWD'); const ids = ['plan:upper-push-pull', 'plan:lower-core', 'plan:recovery-yoga', 'plan:upper-arms', 'plan:lower-cardio', 'plan:rest']; let n = 0;
    for (let d = 0; d < 7; d++) for (let k = 0; k < ids.length; k++) { const id = ids[(k + d * 2) % ids.length]; const l = await runWorkout(p.id, D(d), id, 1); assert.eq(l.planRef, id); n++; }
    assert.eq((await repo.countStores()).workoutLogs, n); for (const l of await repo.readStoreAll('workoutLogs')) assert.ok(!Object.keys(l).some((k) => /week|dow|schedule|weekday/i.test(k)), 'weekday key in a log');
    const plans = await seed.listPlans(p.id); assert.ok(plans.every((x) => !Object.keys(x).some((k) => /week|dow|schedule|weekday/i.test(k))));
  });
  it('INFO: tests/ and docs/ weekday matches are counted (they test the grep or the week-start setting) but do not fail', async () => {
    const files = (await repoFiles()).filter((f) => TEXT.test(f) && /^(tests|docs)\//.test(f)); let n = 0; for (const f of files) n += scanForWeekdays({ [f]: await (await fetch(new URL(f, REPO))).text() }).length; report.weekdayTestDocHits = n; assert.ok(n >= 0);
  });
  it('the offline precache lists every runtime file (js, css, icons, html, manifest) and nothing from tests/, tools/ or docs/ (D-073)', ['NFR-003', 'DEP-008', 'R-036'], async () => {
    const vj = await (await fetch(new URL('version.js', REPO))).text(); const body = vj.slice(vj.indexOf('self.WA_PRECACHE')); const listed = new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const need = (await repoFiles()).filter((f) => /^(js|css|icons)\//.test(f) && !/\.md$/.test(f) || ['index.html', 'manifest.webmanifest', 'config.js', 'version.js'].includes(f)); const missing = need.filter((f) => !listed.has(f)); report.precacheMissing = missing;
    assert.eq(missing.length, 0, `not precached: ${missing.join(', ')}`); assert.ok([...listed].every((f) => !/^(tests|tools|docs)\//.test(f)), 'tests/tools/docs must not be precached');
    const all = await repoFiles(); const phantom = [...listed].filter((f) => f !== './' && !f.startsWith('data/') && !all.includes(f)); assert.eq(phantom.length, 0, `precache lists files that do not exist: ${phantom.join(', ')}`);
  });
  it('cleanup: delete throwaway databases', async () => { for (const n of dbNames) { try { await db.deleteDb(n); } catch { /* ignore */ } } });
});
