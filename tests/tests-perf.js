// A11 performance suite. Listed in tests/harness.js SUITES already, so tests/index.html picks it up.
// Light scale by default (about 6 s). Add ?perf=full to the tests URL for the full scale: 2 profiles x 730 days, 26 check-ins x 4 photos each,
// and a ~150 MB backup round trip (about 1 minute). All data is synthetic (tests/fixtures/perf-generator.js) and goes to a throwaway database.
// Tests named "OPEN F-A11-nn" are OPEN FINDINGS: they fail on purpose until A12 fixes the app. Do not weaken them.
// Time limits are the plan targets (NFR-014, D-041) applied to a desktop-class machine. Real phones are slower: see docs/QA-PERF.md.
import { describe, it, assert, scanForWeekdays } from './harness.js';
import * as db from '../js/core/db.js';
import * as repo from '../js/core/repo.js';
import * as seed from '../js/core/seed.js';
import * as SH from '../js/core/storage-health.js';
import { levelFor } from '../js/core/storage-health.js';
import { todayKey, addDays } from '../js/core/dates.js';
import * as G from './fixtures/perf-generator.js';
import { loadMetricData } from '../js/features/analytics/load.js';
import { metricById, periodRange } from '../js/features/analytics/metrics.js';
import { notesScreen } from '../js/features/analytics/notes.js';
import { progressScreen } from '../js/features/checkins/progress-hub.js';
import { todayScreen } from '../js/features/daily/today.js';
import { processImage } from '../js/features/photos/image-pipeline.js';
import { prepareBackup } from '../js/core/backup.js';
import { openBackupFile, applyImport } from '../js/core/import.js';
import { MB, STORAGE } from '../config.js';

const FULL = new URLSearchParams(location.search).get('perf') === 'full';
SH.setStoragePrefix('winter-arc-test:');
let n = 0;
async function fresh() { await db.closeDb(); db.openDb(`winter-arc-test-perf-${Date.now().toString(36)}-${n++}`); await repo.initRepo(); seed.invalidateOverlay(); }
const text = async (p) => { const r = await fetch(new URL(p, new URL('../', import.meta.url))); if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`); return r.text(); };
const rawJson = async (p) => (JSON.parse(await text('data/' + p))).items;
const q95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const ctxFor = (pid, extra = {}) => ({ pid, date: todayKey(), path: '/', query: {}, params: {}, onCleanup: () => {}, navigate: async () => true, replace: async () => true, back: () => {}, close: () => {}, ...extra });
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
async function restoreSeed() { await seed.loadSeed({ base: new URL('../data/', import.meta.url).href }); }

// shared dataset, built once on first use
let DS = null;
async function dataset() {
  if (DS) return DS;
  await fresh(); await restoreSeed();
  const foods = await rawJson('foods-starter.json'), plans = await rawJson('plans.json'), exercises = await rawJson('exercises.json');
  const scale = FULL ? {} : { foodLogs: 1000, workoutLogs: 120, sleepLogs: 170, measurements: 80, checkins: 8, noteDays: 60 };
  const days = FULL ? 730 : 180; const end = todayKey();
  const variants = await G.makePhotoVariants(FULL ? 6 : 2, FULL ? {} : { w: 400, h: 520, targetBytes: 24 * 1024 });
  const pids = []; let bad = 0; const sets = [];
  for (const name of ['Perf A', 'Perf B']) {
    const p = await repo.createProfile(name); pids.push(p.id);
    const h = G.generateHistory({ pid: p.id, foods, plans, exercises, endDate: end, days, counts: scale });
    bad += G.validateAll(h).length; sets.push(h);
    const ph = G.photoRecords(h.photoSlots, variants);
    await G.bulkInsert(db, { days: h.days, foodLogs: h.foodLogs, workoutLogs: h.workoutLogs, sleepLogs: h.sleepLogs, measurements: h.measurements, checkins: h.checkins });
    await G.bulkInsert(db, { photos: ph.photos }); await G.bulkInsert(db, { photoData: ph.photoData });
  }
  DS = { pids, days, end, bad, sets, variants };
  return DS;
}

describe('A11 budgets (NFR-004, NFR-005)', () => {
  it('shell JS+CSS+HTML stays under a 750 KB raw guard; 500 KB target is reported in QA-PERF.md', ['NFR-004'], async () => {
    const vj = await text('version.js'); const body = vj.slice(vj.indexOf('self.WA_PRECACHE')); const list = [...body.slice(0, body.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const files = list.filter((p) => /\.(js|css|html)$/.test(p) && !p.startsWith('data/'));
    let total = 0, biggest = 0;
    for (const f of files) { const t = new Blob([await text(f)]).size; total += t; biggest = Math.max(biggest, t); }
    assert.ok(total <= 750 * 1024, `shell is ${Math.round(total / 1024)} KB raw`);
    assert.ok(biggest <= 100 * 1024, `largest shell file is ${Math.round(biggest / 1024)} KB`);
  });
  it('seed files total at most 2 MB, none near the 25 MB upload rule', ['NFR-005', 'COST-004'], async () => {
    const man = JSON.parse(await text('data/seed-manifest.json')); let total = 0;
    for (const f of man.files) { const p = typeof f === 'string' ? f : f.path; const sz = new Blob([await text('data/' + p)]).size; total += sz; assert.ok(sz < 25 * MB, p); }
    assert.ok(total <= 2 * MB, `seed is ${Math.round(total / 1024)} KB`);
  });
});

describe('A11 food search at scale (D-041, NFR-014)', () => {
  for (const N of [1400, 2500]) {
    it(`${N} seed foods + 200 custom: every keystroke under 50 ms, index build under 500 ms`, ['NFR-014', 'D-041'], async () => {
      await fresh();
      const real = await rawJson('foods-starter.json'); const foods = [...real, ...G.syntheticFoods(N - real.length)];
      const t0 = performance.now(); seed.setSeedData({ foods, exercises: [], plans: [], mealCategories: [], measurementTypes: [], categories: [], seedVersion: 1 });
      const build = performance.now() - t0; assert.ok(build < 500, `index build ${Math.round(build)} ms`);
      const pid = (await repo.createProfile('S')).id;
      for (let i = 0; i < 200; i++) await repo.saveFood(pid, { kind: 'food', name: `My dish ${i} paneer`, category: 'other', cuisine: 'indian', origin: 'home', source: { type: 'user' }, confidence: 'typical', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 150, protein: 8, carbs: 15, fat: 6, fiber: 2 }, servings: [{ id: 's1', label: '1 bowl (200 g)', unit: 'bowl', baseAmount: 200 }], defaultServingId: 's1' });
      seed.invalidateOverlay(pid); await seed.search('dal', pid);
      const times = {};
      for (const [k, qs] of Object.entries({ one: ['d', 'c', 'a'], two: ['da', 'ch', 'ro'], three: ['dal', 'chi', 'mac'], multi: ['chicken curry', 'aloo posto'], alias: ['bhat', 'chawal', 'milkh bowl'] })) {
        times[k] = []; for (const q of qs) for (let i = 0; i < 25; i++) { const a = performance.now(); await seed.search(q, pid, 80); times[k].push(performance.now() - a); }
        assert.ok(q95(times[k]) < 50, `${k}-keystroke p95 ${q95(times[k]).toFixed(1)} ms`);
      }
      await restoreSeed();
    });
  }
});

describe('A11 reads with two years of history (D-041)', () => {
  it('generator output passes the shared validator', ['DAT-008'], async () => { const d = await dataset(); assert.eq(d.bad, 0); });
  it('Today reads one day row plus the logs of that date only', ['NFR-014', 'D-041'], async () => {
    const d = await dataset(); const pid = d.pids[0]; const date = d.end;
    const orig = IDBDatabase.prototype.transaction; let tx = 0; IDBDatabase.prototype.transaction = function (...a) { tx++; return orig.apply(this, a); };
    let rows = 0; const t0 = performance.now();
    try { const r = await Promise.all([repo.getSettings(pid), repo.getDay(pid, date), repo.getFoodLogs(pid, date), repo.getWorkoutLogs(pid, date), repo.getSleep(pid, date)]); rows = r.flat().length; }
    finally { IDBDatabase.prototype.transaction = orig; }
    const ms = performance.now() - t0;
    assert.ok(tx <= 5, `${tx} transactions`); assert.ok(rows <= 40, `${rows} rows`); assert.ok(ms < 100, `${ms.toFixed(0)} ms`);
  });
  it('3-month range reads touch only the range, only this profile, each under 150 ms', ['NFR-005', 'DAT-021'], async () => {
    const d = await dataset(); const pid = d.pids[0]; const to = d.end, from = addDays(to, -91);
    for (const metric of ['calories', 'protein', 'steps', 'water', 'sleep', 'workout', 'exercise-kcal', 'weight', 'body-fat', 'waist']) {
      const m = metricById(metric); const r = periodRange('3m', to, undefined); const t0 = performance.now();
      const data = await loadMetricData(pid, m, r.from, r.to); const ms = performance.now() - t0;
      assert.ok(ms < 150, `${metric} ${ms.toFixed(0)} ms`);
      for (const list of [data.foodLogs, data.days, data.sleeps, data.workouts, data.points]) if (list) for (const rec of list.slice(0, 50)) { if (rec.pid) assert.eq(rec.pid, pid, metric); if (rec.date) assert.ok(rec.date >= r.from && rec.date <= r.to, metric); }
    }
    const logs = await repo.getFoodLogsRange(pid, from, to); assert.ok(logs.every((l) => l.pid === pid));
  });
  it('a data-layer write (water +1) stays under 100 ms at p95 with the full history present', ['NFR-014'], async () => {
    const d = await dataset(); const pid = d.pids[0]; const ts = [];
    for (let i = 0; i < 20; i++) { const a = performance.now(); await repo.addWater(pid, d.end, 1); ts.push(performance.now() - a); }
    assert.ok(q95(ts) < 100, `p95 ${q95(ts).toFixed(1)} ms`);
  });
});

describe('A11 long lists and photo lists', () => {
  it('Notes list paints at most 40 cards at first and keeps a Show more button', ['NFR-014'], async () => {
    const d = await dataset(); const el = await notesScreen(ctxFor(d.pids[0], { path: '/progress/notes' })); document.body.append(el);
    try { const cards = el.querySelectorAll('.note-card').length; assert.ok(cards > 0 && cards <= 40, `${cards} cards`); assert.ok([...el.querySelectorAll('button')].some((b) => /Show more/.test(b.textContent))); }
    finally { el.remove(); }
  });
  it('Progress list loads thumbnails only, paints at most 30 check-ins, revokes object URLs on leave', ['DAT-013', 'NFR-005'], async () => {
    const d = await dataset(); const cleanups = []; const made = []; let revoked = 0;
    const cu = URL.createObjectURL, ru = URL.revokeObjectURL;
    URL.createObjectURL = function (b) { made.push(b.size); return cu.call(URL, b); }; URL.revokeObjectURL = function (u) { revoked++; return ru.call(URL, u); };
    let el;
    try {
      el = await progressScreen(ctxFor(d.pids[0], { path: '/progress', onCleanup: (f) => cleanups.push(f) })); document.body.append(el); await wait(80);
      assert.ok(el.querySelectorAll('.checkin-card').length <= 30);
      const full = Math.min(...d.variants.map((v) => v.bytes)); const maxThumb = Math.max(...d.variants.map((v) => v.thumbBytes));
      assert.ok(made.length > 0, 'no thumbnails requested'); assert.ok(made.every((s) => s <= maxThumb + 1 && s < full), 'a full-size blob was loaded in a list view');
      for (const f of cleanups) f(); assert.ok(revoked >= made.length, `${revoked} of ${made.length} object URLs revoked`);
    } finally { URL.createObjectURL = cu; URL.revokeObjectURL = ru; if (el) el.remove(); }
  });
});

describe('A11 photo pipeline (D-018)', () => {
  it(`12 MP photo to 1600 px JPEG under 3 s each, ${FULL ? 'five' : 'two'} in a row, within limits`, ['DAT-013', 'FR-032'], async () => {
    const big = await G.makeSyntheticImage({ w: 4000, h: 3000, quality: 0.92, noise: 30 }); const file = new File([big], 'big.jpg', { type: 'image/jpeg' });
    for (let i = 0; i < (FULL ? 5 : 2); i++) {
      const a = performance.now(); const r = await processImage(file); const ms = performance.now() - a;
      assert.ok(ms < 3000, `${ms.toFixed(0)} ms`); assert.eq(Math.max(r.w, r.h), 1600); assert.ok(r.bytes <= 600 * 1024 && r.bytes > 0);
      const t = await createImageBitmap(r.thumb); assert.ok(Math.max(t.width, t.height) <= 320); t.close();
    }
  });
});

describe('A11 storage thresholds (D-017)', () => {
  it('amber at 250 MB or 50%, red at 400 MB or 80%', ['DAT-014'], () => {
    const GB = 1024 * MB;
    assert.eq(levelFor(100 * MB, 10 * GB), 'ok'); assert.eq(levelFor(STORAGE.amberBytes, 10 * GB), 'amber'); assert.eq(levelFor(255 * MB, 500 * MB), 'amber');
    assert.eq(levelFor(240 * MB, 500 * MB), 'ok'); assert.eq(levelFor(STORAGE.redBytes, 10 * GB), 'red'); assert.eq(levelFor(325 * MB, 400 * MB), 'red'); assert.eq(levelFor(null, null), 'unknown');
  });
});

describe(`A11 backup round trip (${FULL ? '~150 MB' : '~6 MB'}) (DAT-020, R-027)`, () => {
  it('prepare, open, apply into an empty database: counts and photo bytes equal, one photo at a time', ['DAT-020', 'DAT-003'], async () => {
    const count = FULL ? 440 : 20; const size = FULL ? 340 * 1024 : 300 * 1024;
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; // private windows report a tiny quota; the app's own pre-flight (I_SPACE) would refuse, which is correct behaviour
    if (est && est.quota && est.quota < count * size * 3.2) { console.warn(`SKIPPED: needs about ${Math.round(count * size * 3.2 / MB)} MB of quota, this window has ${Math.round(est.quota / MB)} MB. Use a normal (not private) window.`); return; }
    await fresh(); const p = (await repo.createProfile('B')).id;
    const recs = []; const slots = ['front', 'side', 'back', 'flexed']; const cks = [];
    for (let i = 0; i < count / 4; i++) cks.push({ id: `ck_perf_${i}`, pid: p, date: addDays(todayKey(), -i * 14), periodDays: 14, periodStart: addDays(todayKey(), -i * 14 - 13), periodEnd: addDays(todayKey(), -i * 14), weight: 80, bodyFat: null, measurements: {}, photos: slots.map((s, j) => ({ photoId: `ph_perf_${i * 4 + j}`, slot: s })), autoStats: null, note: null, createdAt: 1700000000000 + i, updatedAt: 1700000000000 + i });
    const photos = [], photoData = [];
    for (let i = 0; i < count; i++) { const ck = cks[Math.floor(i / 4)]; photos.push({ id: `ph_perf_${i}`, pid: p, checkinId: ck.id, slot: slots[i % 4], date: ck.date, w: 1200, h: 1600, bytes: size, thumbBytes: 9000, mime: 'image/jpeg', crc32: 0, thumb: G.randomBlob(9000, i + 1), createdAt: ck.createdAt }); photoData.push({ id: `ph_perf_${i}`, blob: G.randomBlob(size, i + 100) }); }
    await G.bulkInsert(db, { checkins: cks }); await G.bulkInsert(db, { photos }); await G.bulkInsert(db, { photoData });
    const before = await repo.countStores();
    const t0 = performance.now(); const prep = await prepareBackup({ includePhotos: true }); const prepMs = performance.now() - t0;
    assert.eq(prep.kind, 'zip'); assert.ok(prep.size >= count * size); assert.ok(prepMs < (FULL ? 30000 : 5000), `prepare ${prepMs.toFixed(0)} ms`);
    await fresh();
    const t1 = performance.now(); const handle = await openBackupFile(prep.file); const res = await applyImport(handle, { mode: 'merge', invalid: 'skip', damagedPhotos: 'import-without' }); const impMs = performance.now() - t1;
    assert.ok(res.verification.ok, 'post-import verification'); assert.ok(impMs < (FULL ? 60000 : 8000), `import ${impMs.toFixed(0)} ms`);
    const after = await repo.countStores();
    for (const s of ['checkins', 'photos', 'photoData']) assert.eq(after[s], before[s], s);
    assert.eq(res.verification.photoBytes.actual, res.verification.photoBytes.expected);
  });
});

describe('A11 interaction and re-rendering', () => {
  it('Today water +1 gives feedback in under 100 ms', ['NFR-014'], async () => {
    const d = await dataset(); const el = await todayScreen(ctxFor(d.pids[1], { path: '/today' })); document.body.append(el);
    try {
      const btn = el.querySelector('.tile.tone-water .tile-actions button'); const t0 = performance.now(); let first = null;
      const mo = new MutationObserver(() => { if (first === null) first = performance.now(); }); mo.observe(el, { childList: true, subtree: true, characterData: true });
      btn.click(); await wait(300); mo.disconnect(); assert.ok(first !== null, 'no DOM change after +1'); assert.ok(first - t0 < 100, `${(first - t0).toFixed(0)} ms`);
    } finally { el.remove(); }
  });
  it('F-A11-07: a single water +1 must not replace the calories hero or the other tiles', ['UX-004', 'NFR-004'], async () => {
    const d = await dataset(); const el = await todayScreen(ctxFor(d.pids[1], { path: '/today' })); document.body.append(el);
    try {
      const hero = el.querySelector('.hero'), steps = el.querySelector('.tile.tone-steps');
      el.querySelector('.tile.tone-water .tile-actions button').click(); await wait(300);
      assert.ok(el.querySelector('.hero') === hero, 'calories hero was rebuilt'); assert.ok(el.querySelector('.tile.tone-steps') === steps, 'steps tile was rebuilt');
    } finally { el.remove(); }
  });
});

describe('A11 open load-time findings (NFR-014)', () => {
  it('F-A11-01a: boot must not import every feature register before the picker shows', ['NFR-014', 'NFR-004'], async () => {
    const app = await text('js/app.js'); const a = app.indexOf('async function loadFeatures'); const body = app.slice(a, app.indexOf('\n}\n', a));
    assert.ok(!/import\(|Promise\.all|IMPORTERS|GROUPS/.test(body), 'loadFeatures must only install the route loader, not import register files');
    assert.ok(/setRouteLoader\(loadRoutesFor\)/.test(body), 'boot installs the lazy route loader');
    assert.ok(/const GROUPS = \{[\s\S]*pick:[\s\S]*today:[\s\S]*food:[\s\S]*workout:[\s\S]*body:[\s\S]*progress:[\s\S]*settings:/.test(app), 'route groups defined: each area loads on first visit');
    assert.ok(!/await fetch\(url\)|fetch\(url\)/.test(app), 'no redundant pre-fetch before each import');
  });
  it('F-A11-01b: no feature file awaits a stylesheet at module top level; feature CSS is linked from index.html', ['NFR-014'], async () => {
    const html = await text('index.html'); for (const f of ['js/features/screens-w1.css', 'js/features/screens-w2.css', 'js/features/analytics/screens-w3.css']) assert.ok(html.includes(`href="${f}"`), `${f} must be linked from index.html`);
    for (const f of ['js/features/styles.js', 'js/features/styles-w2.js', 'js/features/analytics/styles-w3.js']) assert.ok(!(await fetch(new URL('../' + f, import.meta.url))).ok, `${f} should be gone`);
  });
});

describe('A11 hygiene (QA-010 no-weekday grep)', () => {
  it('A11 sources contain no weekday words', ['FR-020', 'QA-010'], async () => {
    const files = { 'tests/tests-perf.js': await text('tests/tests-perf.js'), 'tests/fixtures/perf-generator.js': await text('tests/fixtures/perf-generator.js') };
    assert.deepEq(scanForWeekdays(files), []);
  });
});

describe('A11 cleanup', () => { it('restores the real seed for later suites', [], async () => { await restoreSeed(); assert.ok(seed.seedCounts().foods > 0); }); });
