// A11 synthetic data generator for performance tests. SYNTHETIC ONLY: no real user data (COMMON rule 12).
// Deterministic (seeded PRNG), so two runs produce the same records. Works in a browser page served from the repo root.
// Records are built with the app's own calc.js, so snapshots have the real shape; every record can be checked with validateAll().
//
// API
//   prng(seed) -> () => float in [0,1)
//   syntheticFoods(n, {seed}) -> seed-shaped food records (ids f:pf-<n>) with aliases, for search-latency tests
//   generateHistory({pid, foods, plans, exercises, endDate, days, counts, seed, glassMl}) -> {days, foodLogs, workoutLogs, sleepLogs, measurements, checkins, photoSlots}
//   validateAll(history) -> [{store, id, codes[]}]   (empty array = every record passes validate.js)
//   makePhotoVariants(n, {w, h, targetBytes, quality}) -> Promise<[{blob, thumb, w, h, bytes, thumbBytes, mime, crc32}]>   (browser only)
//   makeSyntheticImage({w, h, quality, noise}) -> Promise<Blob>   (browser only; used for the 12 MP test)
//   photoRecords(photoSlots, variants) -> {photos[], photoData[]}   (meta carries the thumb Blob, like repo.saveCheckinWithPhotos)
//   randomBlob(bytes, seed) -> Blob   (not a JPEG; for backup-size tests where bytes are never decoded)
//   bulkInsert(db, {store: [records]}) -> Promise<number>   (single readwrite transaction per store group)
import * as C from '../../js/core/calc.js';
import * as V from '../../js/core/validate.js';
import { addDays, durationFromTimes } from '../../js/core/dates.js';
import { crc32Blob } from '../../js/lib/zip.js';

export function prng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const round1 = (x) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ synthetic seed foods (search tests)
const BASES = ['chicken', 'mutton', 'fish', 'egg', 'paneer', 'aloo', 'gobi', 'dal', 'rice', 'roti', 'paratha', 'luchi', 'potato', 'spinach', 'okra', 'brinjal', 'pumpkin', 'cabbage', 'mushroom', 'prawn', 'hilsa', 'rohu', 'katla', 'bhetki', 'soy', 'noodle', 'momo', 'burger', 'pizza', 'sandwich', 'biryani', 'khichuri', 'cholar', 'moong', 'masoor', 'rajma', 'chana', 'curd', 'milk', 'lassi', 'tea', 'coffee', 'banana', 'mango', 'apple', 'papaya', 'guava', 'oats', 'poha', 'upma', 'idli', 'dosa', 'sambar', 'rasgulla', 'sandesh', 'mishti', 'jalebi', 'samosa', 'kachori', 'pakora'];
const STYLES = ['curry', 'fry', 'masala', 'bhaja', 'jhol', 'bhapa', 'shorshe', 'korma', 'kebab', 'tikka', 'roll', 'salad', 'soup', 'stew', 'bowl', 'wrap', 'sabzi', 'bharta', 'tarkari', 'dry'];
const VARIANTS = ['', 'home style', 'restaurant', 'light', 'spicy', 'with gravy', 'dry', 'small plate', 'family pack', 'street style'];
const CATS = ['grain-rice', 'bread-roti', 'dal-legume', 'veg-dish', 'paneer-dairy-dish', 'egg', 'chicken', 'mutton-red-meat', 'fish-seafood', 'fruit', 'veg-raw', 'dairy', 'beverage', 'snack', 'sweet-dessert', 'fast-food', 'pizza-burger-sandwich', 'noodles-rice-dish', 'soup-salad', 'oil-spice-condiment', 'packaged', 'other'];
const CUIS = ['indian', 'bengali', 'chinese', 'japanese', 'thai', 'continental', 'italian', 'american', 'other'];
const respell = (w, r) => {
  const subs = [['sh', 's'], ['aa', 'a'], ['a', 'aa'], ['ch', 'c'], ['th', 't'], ['v', 'b'], ['oo', 'u'], ['jh', 'j'], ['ee', 'i']];
  let o = w;
  for (let i = 0; i < 2; i++) { const [f, t] = pick(r, subs); if (o.includes(f)) { o = o.replace(f, t); break; } }
  return o === w ? w + 'h' : o;
};

/** n seed-shaped foods. Names are unique. Average ~3 aliases each, like the real Bengali/Hindi rows. */
export function syntheticFoods(n, { seed = 7 } = {}) {
  const r = prng(seed); const seen = new Set(); const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    const base = pick(r, BASES), style = pick(r, STYLES), v = pick(r, VARIANTS);
    let name = `${base[0].toUpperCase()}${base.slice(1)} ${style}${v ? ` (${v})` : ''}`;
    if (seen.has(name.toLowerCase())) name = `${name} ${out.length}`;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const aliases = [respell(base, r) + ' ' + style, `${base} ${respell(style, r)}`, respell(base, r)].slice(0, int(r, 1, 4));
    const kcal = int(r, 40, 420), protein = round1(r() * 20), fat = round1(r() * 20), carbs = round1(Math.min(100 - protein - fat, r() * 60)), fiber = r() < 0.2 ? null : round1(Math.min(carbs, r() * 8));
    const i = out.length;
    out.push({
      id: `f:pf-${i}`, kind: 'food', name, aliases, category: pick(r, CATS), cuisine: pick(r, CUIS), origin: v === 'restaurant' ? 'restaurant' : 'home',
      source: { type: v === 'restaurant' ? 'restaurant-estimate' : 'author-typical', ref: 'src-author' }, confidence: v === 'restaurant' ? 'estimate' : 'typical', system: true,
      nutrition: { per: { amount: 100, unit: 'g' }, kcal, protein, carbs, fat, fiber },
      servings: [{ id: 's1', label: '1 bowl (200 g)', unit: 'bowl', baseAmount: 200, approx: true }, { id: 's2', label: '1 piece (60 g)', unit: 'piece', baseAmount: 60, approx: true }],
      defaultServingId: 's1', notes: null
    });
  }
  return out;
}

// ------------------------------------------------------------------ history
const MEALS = [{ id: 'meal:breakfast', label: 'Breakfast' }, { id: 'meal:lunch', label: 'Lunch' }, { id: 'meal:snacks', label: 'Snacks' }, { id: 'meal:dinner', label: 'Dinner' }, { id: 'meal:other', label: 'Other' }];
const MEAL_W = [0.22, 0.3, 0.16, 0.3, 0.02];
const pickMeal = (r) => { let x = r(), i = 0; for (; i < MEAL_W.length - 1; i++) { if (x < MEAL_W[i]) break; x -= MEAL_W[i]; } return MEALS[i]; };
const TAGS = ['ate-outside', 'travel', 'poor-sleep', 'busy', 'skipped-workout', 'illness', 'special-occasion', 'restaurant-meal'];
const SLOTS = ['front', 'side', 'back', 'flexed'];
let idn = 0;
const gid = (type, r) => `${type}_${(1700000000000 + (idn++) * 1000).toString(36)}_${Math.floor(r() * 36 ** 5).toString(36).padStart(5, '0')}`;
const dayKeys = (endDate, days) => Array.from({ length: days }, (_, i) => addDays(endDate, -(days - 1 - i)));

/**
 * counts (per profile): foodLogs 4000, workoutLogs 500, sleepLogs 700, measurements 300, checkins 26, noteDays 150. days = 730 day rows.
 * foods: array of seed-shaped foods with servings (use syntheticFoods or the real seed). plans/exercises: the real seed rows.
 */
export function generateHistory({ pid, foods, plans, exercises, endDate, days = 730, counts = {}, seed = 11, glassMl = 500 }) {
  const N = { foodLogs: 4000, workoutLogs: 500, sleepLogs: 700, measurements: 300, checkins: 26, noteDays: 150, ...counts };
  const r = prng(seed + pid.length * 31 + (pid.charCodeAt(pid.length - 1) || 0));
  const keys = dayKeys(endDate, days); const t0 = 1700000000000;
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const out = { days: [], foodLogs: [], workoutLogs: [], sleepLogs: [], measurements: [], checkins: [], photoSlots: [] };

  // day rows: every day, water + steps + goal, a note on noteDays
  const noteSet = new Set(); while (noteSet.size < Math.min(N.noteDays, days)) noteSet.add(int(r, 0, days - 1));
  keys.forEach((date, i) => {
    const tags = noteSet.has(i) ? [pick(r, TAGS)] : [];
    const glasses = r() < 0.08 ? null : int(r, 2, 10) / (r() < 0.2 ? 2 : 1);
    out.days.push({
      pid, date, water: { glasses: glasses === null ? null : Math.round(glasses * 2) / 2, glassMl, ml: glasses === null ? null : Math.round(glasses * 2) / 2 * glassMl }, steps: { count: r() < 0.06 ? null : int(r, 1500, 14000) },
      stepGoal: 7000, stepGoalSource: 'default', note: noteSet.has(i) ? { text: `Synthetic note ${i}: ${'steady day '.repeat(int(r, 1, 8))}`.trim(), tags } : null, flags: {}, createdAt: t0 + i, updatedAt: t0 + i
    });
  });

  // food logs: exact count spread over ~90% of days
  const eligible = keys.filter(() => r() < 0.9); const pool = foods.length ? foods : [];
  for (let n = 0; n < N.foodLogs; n++) {
    const date = pick(r, eligible), food = pick(r, pool), meal = pickMeal(r);
    const sv = (food.servings || [])[0] || null; const qty = [0.5, 1, 1, 1, 1.5, 2][int(r, 0, 5)];
    const snap = C.foodLogSnapshot(food, sv, qty, meal); const t = t0 + n * 60000;
    out.foodLogs.push({ id: gid('fl', r), pid, date, loggedAt: t, ...snap, servingId: sv ? sv.id : null, quick: false, note: null, createdAt: t, updatedAt: t });
  }

  // workout logs: distinct days, random plan (rest included), actuals 50-110% of target
  const wdays = [...keys].sort(() => r() - 0.5).slice(0, Math.min(N.workoutLogs, days));
  const realPlans = plans.length ? plans : [];
  for (const date of wdays) {
    const plan = pick(r, realPlans); const bw = round1(82 - (keys.indexOf(date) / days) * 8);
    let items = (plan.items || []).map((it) => {
      const ex = exMap.get(it.exerciseId); const basis = it.kcalOverride ? { basis: it.kcalOverride.basis, value: it.kcalOverride.value, refWeightKg: 70, scaleByWeight: false } : (ex?.kcal || it.kcalSnap || null);
      const actual = Math.max(0, Math.round(it.target * (0.5 + r() * 0.6)));
      return C.computeItem({ itemId: it.itemId, exerciseRef: it.exerciseId, exerciseName: ex?.name ?? it.exerciseName, targetKind: it.targetKind, target: it.target, targetMax: it.targetMax ?? null, perSide: !!it.perSide, altExerciseIds: it.altExerciseIds || [], kcalOverride: it.kcalOverride || null, kcalOverrideUsed: !!it.kcalOverride, kcalBasis: basis, actual, manualPct: null, pct: null, pctSource: null, kcalEst: null, kcalFinal: null, kcalLogOverride: null, note: null }, bw);
    });
    const ks = items.map((i) => i.kcalFinal).filter((k) => k != null); const t = t0 + keys.indexOf(date) * 86400000;
    out.workoutLogs.push({ id: gid('wl', r), pid, date, startedAt: t, planRef: plan.id, planName: plan.name, planRev: plan.rev ?? 1, isRest: !!plan.isRest, stepGoalSnap: plan.stepGoal ?? null, items, completionPct: C.sessionCompletion(items), kcalTotal: ks.length ? C.round1(ks.reduce((a, b) => a + b, 0)) : null, bodyWeightKg: bw, weightSource: 'on-or-before', weightDate: date, weightStale: false, note: null, createdAt: t, updatedAt: t });
  }

  // sleep: one row per wake date (unique index pid_date)
  const sdays = [...keys].sort(() => r() - 0.5).slice(0, Math.min(N.sleepLogs, days));
  for (const date of sdays) {
    const bedH = int(r, 21, 24) % 24, bedM = int(r, 0, 59), wakeH = int(r, 5, 8), wakeM = int(r, 0, 59);
    const pad = (x) => String(x).padStart(2, '0'); const d = durationFromTimes(date, `${pad(bedH)}:${pad(bedM)}`, `${pad(wakeH)}:${pad(wakeM)}`); const t = t0 + keys.indexOf(date) * 86400000;
    out.sleepLogs.push({ id: gid('sl', r), pid, date, bedAt: d.bedAt, wakeAt: d.wakeAt, durationMin: d.durationMin, durationSource: 'times', quality: int(r, 1, 5), napMin: r() < 0.15 ? int(r, 10, 60) : null, note: null, createdAt: t, updatedAt: t });
  }

  // measurements: weight 50%, waist 17%, body fat 13%, biceps 10%, thigh 10%
  const mix = [['mt:weight', 'kg', 0.5, (p) => round1(82 - p * 8 + (r() - 0.5))], ['mt:waist', 'cm', 0.17, (p) => round1(94 - p * 9 + (r() - 0.5))], ['mt:bodyFat', '%', 0.13, (p) => round1(24 - p * 4 + (r() - 0.5))], ['mt:biceps', 'cm', 0.1, (p) => round1(32 + p * 2 + (r() - 0.5) * 0.4)], ['mt:thigh', 'cm', 0.1, (p) => round1(56 - p * 2 + (r() - 0.5))]];
  let made = 0;
  for (const [typeId, unit, share, fn] of mix) {
    const k = Math.round(N.measurements * share);
    for (let i = 0; i < k && made < N.measurements; i++, made++) {
      const di = Math.min(days - 1, Math.round((i + r() * 0.8) / k * days)); const t = t0 + di * 86400000;
      out.measurements.push({ id: gid('ms', r), pid, typeId, date: keys[di], value: fn(di / days), unit, entered: null, note: null, checkinId: null, createdAt: t, updatedAt: t });
    }
  }

  // check-ins evenly spaced, 4 slots each (photo bytes come from makePhotoVariants + photoRecords)
  const step = Math.max(1, Math.floor(days / Math.max(1, N.checkins)));
  for (let i = 0; i < N.checkins; i++) {
    const di = Math.min(days - 1, i * step + (step - 1)); const date = keys[di]; const id = gid('ck', r); const t = t0 + di * 86400000;
    const photos = SLOTS.map((slot) => ({ photoId: gid('ph', r), slot }));
    out.checkins.push({
      id, pid, date, periodDays: 14, periodStart: addDays(date, -13), periodEnd: date, weight: round1(82 - di / days * 8), bodyFat: round1(24 - di / days * 4), measurements: { 'mt:waist': round1(94 - di / days * 9) }, photos,
      autoStats: { avgKcal: int(r, 1500, 2200), avgProtein: int(r, 70, 130), avgCarbs: int(r, 150, 260), avgFat: int(r, 40, 80), avgFiber: int(r, 12, 30), avgSteps: int(r, 4000, 9000), avgSleepMin: int(r, 380, 480), workoutCompletionAvg: int(r, 50, 100), workoutSessions: int(r, 2, 6), daysWithFood: 12, daysWithSteps: 13, daysWithSleep: 13, periodDays: 14, computedAt: t },
      note: `Synthetic check-in ${i + 1}`, createdAt: t, updatedAt: t
    });
    photos.forEach((p) => out.photoSlots.push({ id: p.photoId, pid, checkinId: id, slot: p.slot, date, createdAt: t }));
  }
  return out;
}

/** Runs every record through the shared validator. Returns [] when all pass. */
export function validateAll(h) {
  const bad = [];
  const map = { days: h.days, foodLogs: h.foodLogs, workoutLogs: h.workoutLogs, sleepLogs: h.sleepLogs, measurements: h.measurements, checkins: h.checkins };
  for (const [store, list] of Object.entries(map)) for (const rec of list) { const res = V.validateRecord(store, rec); if (!res.ok) bad.push({ store, id: rec.id || `${rec.pid}/${rec.date}`, codes: res.hard.map((x) => x.code) }); }
  return bad;
}

// ------------------------------------------------------------------ images (browser only)
function noiseCanvas(w, h, seed, noise) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const img = g.createImageData(w, h); const d = img.data; const r = prng(seed);
  const cx = w * (0.4 + r() * 0.2), cy = h * 0.5, rx = w * 0.18, ry = h * 0.38;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const dx = (x - cx) / rx, dy = (y - cy) / ry; const body = dx * dx + dy * dy < 1 ? 1 : 0;
      const base = body ? 150 : 90 + (y / h) * 80; const n = (r() - 0.5) * noise;
      d[i] = base + n + (body ? 30 : 0); d[i + 1] = base + n * 0.9; d[i + 2] = base + n * 0.8 + (body ? 0 : 20); d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); return c;
}
const toBlob = (c, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q));

/** A JPEG of the given size; `noise` (0-255) controls how big the file is. Used for the 12 MP input test. */
export async function makeSyntheticImage({ w = 4000, h = 3000, quality = 0.92, noise = 40, seed = 3 } = {}) {
  const c = noiseCanvas(w, h, seed, noise); const b = await toBlob(c, quality); c.width = 0; c.height = 0; return b;
}

/** n distinct photo variants near targetBytes (default 300 KB at 1200x1600 q0.8) plus a 240x320 q0.7 thumb. Calibrates noise once. */
export async function makePhotoVariants(n = 6, { w = 1200, h = 1600, targetBytes = 300 * 1024, quality = 0.8 } = {}) {
  let lo = 2, hi = 80, noise = 20;
  for (let i = 0; i < 7; i++) { // bisection on noise amplitude
    const c = noiseCanvas(w, h, 99, noise); const b = await toBlob(c, quality); c.width = 0; c.height = 0;
    if (b.size > targetBytes) hi = noise; else lo = noise; noise = (lo + hi) / 2;
    if (Math.abs(b.size - targetBytes) < targetBytes * 0.08) break;
  }
  const out = [];
  for (let v = 0; v < n; v++) {
    const c = noiseCanvas(w, h, 1000 + v, noise); const blob = await toBlob(c, quality);
    const t = document.createElement('canvas'); t.width = 240; t.height = 320; t.getContext('2d').drawImage(c, 0, 0, 240, 320); const thumb = await toBlob(t, 0.7);
    c.width = 0; c.height = 0; t.width = 0; t.height = 0;
    out.push({ blob, thumb, w, h, bytes: blob.size, thumbBytes: thumb.size, mime: 'image/jpeg', crc32: await crc32Blob(blob) });
  }
  return out;
}

/** Turns photoSlots into stored records. Variants are reused round-robin; every photo gets its own Blob object. */
export function photoRecords(photoSlots, variants) {
  const photos = [], photoData = [];
  photoSlots.forEach((s, i) => {
    const v = variants[i % variants.length];
    photos.push({ id: s.id, pid: s.pid, checkinId: s.checkinId, slot: s.slot, date: s.date, w: v.w, h: v.h, bytes: v.bytes, thumbBytes: v.thumbBytes, mime: v.mime, crc32: v.crc32, thumb: new Blob([v.thumb], { type: 'image/jpeg' }), createdAt: s.createdAt });
    photoData.push({ id: s.id, blob: new Blob([v.blob], { type: 'image/jpeg' }) });
  });
  return { photos, photoData };
}

/** Non-JPEG filler of an exact size (backup size tests never decode it). */
export function randomBlob(bytes, seed = 5) {
  const chunk = new Uint8Array(Math.min(bytes, 1 << 20)); const r = prng(seed);
  for (let i = 0; i < chunk.length; i += 4) { const x = Math.floor(r() * 4294967296); chunk[i] = x; chunk[i + 1] = x >>> 8; chunk[i + 2] = x >>> 16; chunk[i + 3] = x >>> 24; }
  const parts = []; let left = bytes; while (left > 0) { const n = Math.min(left, chunk.length); parts.push(n === chunk.length ? chunk : chunk.subarray(0, n)); left -= n; }
  return new Blob(parts, { type: 'image/jpeg' });
}

/** Writes {store: records[]} through db.tx. One transaction per store. Returns the number of records written. */
export async function bulkInsert(db, sets) {
  let n = 0;
  for (const [store, list] of Object.entries(sets)) {
    if (!list || !list.length) continue;
    await db.tx([store], 'readwrite', async (t) => { const s = t.store(store); for (const rec of list) { await s.put(rec); n++; } });
  }
  return n;
}
