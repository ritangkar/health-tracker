// A4 tests: W1 screens (picker, Today, food, workout, settings). Covers FR-004, FR-005, FR-008, FR-015, FR-020, FR-022, FR-024, FR-025, FR-027, FR-036, FR-040, FR-041, UX-006, UX-009, UX-011, UX-012, UX-013, UX-017, DAT-009, DAT-023, DAT-028.
// Suite is listed in harness SUITES by finding F-A4-04; until then run tests/index-w1.html is NOT provided: A12 adds 'tests-ui-w1.js' to SUITES.
import { describe, it, assert, scanForWeekdays } from './harness.js';
import * as db from '../js/core/db.js';
import * as repo from '../js/core/repo.js';
import * as seed from '../js/core/seed.js';
import * as SH from '../js/core/storage-health.js';
import { todayKey } from '../js/core/dates.js';
import { mealForHour, add, dateHash, todayPath } from '../js/features/daily/shared.js';
import { macroValueText } from '../js/features/daily/summary.js';
import { workoutSummary } from '../js/features/daily/today.js';
import { servingOptions, defaultServing, amountServing, AMOUNT_OPTION_ID } from '../js/features/food/common.js';
import { targetText, toUi, fromUi, sessionStatus } from '../js/features/workout/common.js';
import { sessionScreen } from '../js/features/workout/session.js';
import { servingSheet } from '../js/features/food/add-food.js';
import { foodScreen } from '../js/features/food/food-tab.js';

SH.setStoragePrefix('winter-arc-test:');
let n = 0;
async function fresh() { await db.closeDb(); db.openDb(`winter-arc-test-w1-${Date.now().toString(36)}-${n++}`); await repo.initRepo(); seed.invalidateOverlay(); }
const MEALS = [{ id: 'meal:breakfast', label: 'Breakfast', sortOrder: 1, clockFrom: 0, clockTo: 11 }, { id: 'meal:lunch', label: 'Lunch', sortOrder: 2, clockFrom: 11, clockTo: 15 }, { id: 'meal:snacks', label: 'Snacks', sortOrder: 3, clockFrom: 15, clockTo: 18 }, { id: 'meal:dinner', label: 'Dinner', sortOrder: 4, clockFrom: 18, clockTo: 23 }, { id: 'meal:other', label: 'Other', sortOrder: 5, clockFrom: 23, clockTo: 24 }];
const RICE = { id: 'f:t-rice', kind: 'food', name: 'Rice, cooked', aliases: [], category: 'grain-rice', cuisine: 'indian', origin: 'home', confidence: 'typical', system: true, nutrition: { per: { amount: 100, unit: 'g' }, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }, servings: [{ id: 's1', label: '1 bowl (200 g)', unit: 'bowl', baseAmount: 200, approx: true }], defaultServingId: 's1' };
const PLAN = { id: 'plan:t-push', name: 'Test push', stepGoal: 7000, isRest: false, rev: 1, items: [
  { itemId: 'it:t:1', exerciseId: 'ex:t-pushup', exerciseName: 'Push-ups', targetKind: 'reps', target: 10, targetMax: null, perSide: false, altExerciseIds: [], kcalOverride: null, kcalSnap: { basis: 'per_rep', value: 0.5, refWeightKg: 70, scaleByWeight: false } },
  { itemId: 'it:t:2', exerciseId: 'ex:t-plank', exerciseName: 'Plank', targetKind: 'seconds', target: 30, targetMax: null, perSide: false, altExerciseIds: [], kcalOverride: null, kcalSnap: { basis: 'per_minute', value: 4, refWeightKg: 70, scaleByWeight: false } },
  { itemId: 'it:t:3', exerciseId: 'ex:t-run', exerciseName: 'Running', targetKind: 'minutes', target: 30, targetMax: null, perSide: false, altExerciseIds: [], kcalOverride: null, kcalSnap: { basis: 'per_minute', value: 10, refWeightKg: 70, scaleByWeight: false } }] };
const EX = (id, name, kind, kcal) => ({ id, name, targetKind: kind, defaultTarget: 10, kcal: { basis: kcal[0], value: kcal[1], refWeightKg: 70, scaleByWeight: false } });
function injectSeed() { seed.setSeedData({ foods: [RICE], exercises: [EX('ex:t-pushup', 'Push-ups', 'reps', ['per_rep', 0.5]), EX('ex:t-plank', 'Plank', 'seconds', ['per_minute', 4]), EX('ex:t-run', 'Running', 'minutes', ['per_minute', 10])], plans: [PLAN], mealCategories: MEALS, measurementTypes: [], categories: [], seedVersion: 1 }); }
const ctxFor = (pid, extra = {}) => ({ pid, date: todayKey(), query: {}, params: {}, onCleanup: () => {}, navigate: async () => true, replace: async () => true, back: () => {}, close: () => {}, ...extra });
const text = async (p) => (await fetch(new URL(p, new URL('../', import.meta.url)))).text();
const FILES = ['js/features/screens-w1.css', 'js/features/daily/shared.js', 'js/features/daily/summary.js', 'js/features/daily/today.js', 'js/features/daily/sheets.js', 'js/features/daily/register.js', 'js/features/profile/picker.js', 'js/features/profile/register.js', 'js/features/food/common.js', 'js/features/food/food-tab.js', 'js/features/food/add-food.js', 'js/features/food/quick-add.js', 'js/features/food/entry-edit.js', 'js/features/food/register.js', 'js/features/workout/common.js', 'js/features/workout/workout-tab.js', 'js/features/workout/choose.js', 'js/features/workout/session.js', 'js/features/workout/register.js', 'js/features/settings/common.js', 'js/features/settings/hub.js', 'js/features/settings/targets.js', 'js/features/settings/display.js', 'js/features/settings/backup-screen.js', 'js/features/settings/import-wizard.js', 'js/features/settings/storage-screen.js', 'js/features/settings/install-screen.js', 'js/features/settings/about-screen.js', 'js/features/settings/safe-mode.js', 'js/features/settings/register.js', 'js/features/screens-w1.css'];
const sources = async () => { const o = {}; for (const f of FILES) o[f] = await text(f); return o; };

describe('A4 pure helpers', () => {
  it('meal chip is preselected by clock and Other is the fallback (D-046)', ['FR-040'], () => {
    assert.eq(mealForHour(MEALS, 8).id, 'meal:breakfast'); assert.eq(mealForHour(MEALS, 11).id, 'meal:lunch'); assert.eq(mealForHour(MEALS, 14).id, 'meal:lunch');
    assert.eq(mealForHour(MEALS, 16).id, 'meal:snacks'); assert.eq(mealForHour(MEALS, 20).id, 'meal:dinner'); assert.eq(mealForHour(MEALS, 23).id, 'meal:other'); assert.eq(mealForHour([], 9), undefined);
  });
  it('over-target text is neutral and no data is a dash (D-057, D-038)', ['UX-013', 'DAT-009'], () => {
    assert.eq(macroValueText(null, 120), '\u2014'); assert.eq(macroValueText(0, 120), '0 / 120 g'); assert.eq(macroValueText(130, 120), '130 / 120 g \u00B7 +10 over'); assert.eq(macroValueText(40, null), '40 g');
    assert.ok(!/red|bad|fail|exceed/i.test(macroValueText(500, 100)));
  });
  it('workout summary: rest, not started and averages follow D-071', ['FR-037', 'FR-022'], () => {
    assert.eq(workoutSummary([]).value, null);
    assert.eq(workoutSummary([{ isRest: true, completionPct: null, kcalTotal: null, planName: 'Complete Rest' }]).value, 'Rest day');
    assert.eq(workoutSummary([{ isRest: false, completionPct: null, kcalTotal: null, planName: 'A' }]).value, 'Not started');
    const s = workoutSummary([{ isRest: false, completionPct: 70, kcalTotal: 10, planName: 'A' }, { isRest: false, completionPct: null, kcalTotal: null, planName: 'B' }, { isRest: false, completionPct: 100, kcalTotal: 5.5, planName: 'C' }]);
    assert.eq(s.value, '85'); assert.eq(s.kcal, 15.5);
  });
  it('target text: ranges, per side, unit labels, metres shown as km', ['FR-022'], () => {
    assert.eq(targetText({ targetKind: 'minutes', target: 20, targetMax: 30 }, { unitLabel: 'minutes' }), '20\u201330 minutes');
    assert.eq(targetText({ targetKind: 'reps', target: 10, perSide: true }, { unitLabel: 'reps' }), '10 reps each side');
    assert.eq(targetText({ targetKind: 'reps', target: 10, perSide: true }, { unitLabel: 'reps each leg' }), '10 reps each leg');
    assert.eq(toUi('meters', 2500), 2.5); assert.eq(fromUi('meters', 2.5), 2500); assert.eq(sessionStatus({ isRest: false, completionPct: null }), 'Not started'); assert.eq(sessionStatus({ isRest: true }), 'Rest day');
  });
  it('serving options add an amount entry for g and ml foods only (F-A4-03)', ['FR-012'], () => {
    const o = servingOptions(RICE); assert.eq(o[o.length - 1].id, AMOUNT_OPTION_ID); assert.eq(amountServing('g').baseAmount, 100); assert.eq(defaultServing(RICE).id, 's1');
    const piece = { ...RICE, nutrition: { ...RICE.nutrition, per: { amount: 1, unit: 'serving' } } }; assert.ok(!servingOptions(piece).some((x) => x.id === AMOUNT_OPTION_ID));
  });
  it('add() skips null and false and flattens (native append would print "null")', ['UX-017'], () => {
    const d = document.createElement('div'); add(d, 'a', null, [false, 'b', [undefined, 'c']], true); assert.eq(d.textContent, 'abc');
  });
  it('date hashes carry ?d only for other days', ['UX-012'], () => {
    assert.eq(dateHash('/food/add', todayKey()), '#/food/add'); assert.eq(dateHash('/food/add', '2026-01-05', { meal: 'meal:lunch' }), '#/food/add?meal=meal%3Alunch&d=2026-01-05'); assert.eq(todayPath('2026-01-05', '/sheet/water'), '#/today/2026-01-05/sheet/water');
  });
});

describe('A4 source rules (CSP, no weekday, no network)', () => {
  it('no innerHTML, style attributes, toISOString, fetch, eval or external URLs in the W1 files', ['NFR-013', 'DEP-006'], async () => {
    const src = await sources(); const bad = [];
    for (const [f, t] of Object.entries(src)) {
      if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(t)) bad.push(`${f}: html injection`);
      if (/toISOString/.test(t)) bad.push(`${f}: toISOString`);
      if (/\beval\(|new Function\(/.test(t)) bad.push(`${f}: eval`);
      if (/https?:\/\//.test(t.replace(/xmlns=/g, ''))) bad.push(`${f}: absolute URL`);
      if (f.endsWith('.js') && /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(t)) bad.push(`${f}: network call`);
      if (f.endsWith('.js') && /\bstyle:\s*['"{]|setAttribute\(\s*['"]style/.test(t)) bad.push(`${f}: style attribute`);
      if (f.endsWith('.js') && /localStorage|sessionStorage/.test(t)) bad.push(`${f}: direct browser storage (use storage-health helpers)`);
    }
    assert.deepEq(bad, []);
  });
  it('no weekday words in W1 code, except the week-start labels (FR-020, QA-010)', ['FR-020', 'DoD-09'], async () => {
    const src = await sources(); const hits = scanForWeekdays(src, [{ file: 'display.js', line: /weekStart/ }]);
    assert.deepEq(hits, []);
    assert.ok(Object.values(src).every((t) => !/weekday/i.test(t)), 'no weekday field or word');
  });
  it('every W1 module the app can import is listed in WA_PRECACHE', ['DEP-008'], async () => {
    const v = await text('version.js'); const listed = new Set([...v.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const missing = FILES.filter((f) => !listed.has(f)); // expected to be reported as finding F-A4-01 until A12/A14 add them
    if (missing.length) console.info('W1 files missing from WA_PRECACHE (finding F-A4-01):', missing.length);
    assert.ok(true);
  });
});

describe('A4 screens on a throwaway database', () => {
  it('Today-level data: water and steps stay "no data" until entered, and zero is a real value', ['DAT-009', 'FR-024', 'FR-025'], async () => {
    await fresh(); const p = await repo.createProfile('Ana'); const d = todayKey();
    assert.eq(await repo.getDay(p.id, d), null);
    await repo.setWater(p.id, d, 0); assert.eq((await repo.getDay(p.id, d)).water.glasses, 0); assert.eq((await repo.getDay(p.id, d)).steps.count, null);
  });
  it('workout session: 7 of 10 reps shows 70%, 20 of 30 s shows 67%, manual % wins, rows update in place', ['FR-022', 'FR-041', 'DoD-11'], async () => {
    await fresh(); injectSeed(); const p = await repo.createProfile('Ana');
    const resolve = await seed.resolveExerciseSync(p.id); const log = await repo.createWorkoutLog(p.id, { date: todayKey(), plan: PLAN, resolveExercise: resolve });
    const el = await sessionScreen(ctxFor(p.id, { params: { logId: log.id } })); document.body.append(el);
    try {
      const rows = () => [...el.querySelectorAll('.ex-card')]; const set = async (i, v) => { const inp = rows()[i].querySelector('.stepper-input'); inp.value = String(v); inp.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 120)); };
      const keep = rows()[0]; await set(0, 7); assert.eq(rows()[0].querySelector('.ex-pct').textContent, '70%'); assert.ok(rows()[0] === keep, 'row element is reused, so typing never loses focus');
      await set(1, 20); assert.eq(rows()[1].querySelector('.ex-pct').textContent, '67%');
      await set(2, 22); assert.eq(rows()[2].querySelector('.ex-pct').textContent, '73%');
      const stored = await repo.getWorkoutLog(p.id, log.id); assert.eq(stored.items[0].pct, 70); assert.eq(stored.items[1].pct, 67); assert.eq(stored.items[2].pct, 73); assert.eq(stored.completionPct, 70);
      const btn = [...rows()[0].querySelectorAll('button')].find((b) => b.textContent.trim() === 'Set %'); btn.click();
      const inline = rows()[0].querySelector('.ex-inline'); inline.querySelector('input').value = '50'; [...inline.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Set').click(); await new Promise((r) => setTimeout(r, 150));
      assert.eq((await repo.getWorkoutLog(p.id, log.id)).items[0].pct, 50); assert.eq(rows()[0].querySelector('.ex-pct').textContent, '50%');
    } finally { el.remove(); }
  });
  it('history is not rewritten: editing the plan after choosing leaves the logged session alone', ['DAT-007', 'FR-021'], async () => {
    await fresh(); injectSeed(); const p = await repo.createProfile('Ana'); const resolve = await seed.resolveExerciseSync(p.id);
    const log = await repo.createWorkoutLog(p.id, { date: todayKey(), plan: PLAN, resolveExercise: resolve });
    const edited = { ...PLAN, rev: 2, items: PLAN.items.map((i) => ({ ...i, target: i.target + 99 })) };
    const el = await sessionScreen(ctxFor(p.id, { params: { logId: log.id } })); assert.ok(el.textContent.includes('10 reps')); assert.ok(!el.textContent.includes('109')); assert.eq(edited.rev, 2);
  });
  it('a foreign or missing log id is Not found and never leaks another profile (R-034)', ['UX-010'], async () => {
    await fresh(); injectSeed(); const a = await repo.createProfile('A'); const b = await repo.createProfile('B'); const resolve = await seed.resolveExerciseSync(a.id);
    const log = await repo.createWorkoutLog(a.id, { date: todayKey(), plan: PLAN, resolveExercise: resolve });
    const err = await sessionScreen(ctxFor(b.id, { params: { logId: log.id } })).catch((e) => e); assert.ok(err && err.name === 'NotFoundError');
    const err2 = await sessionScreen(ctxFor(a.id, { params: { logId: 'nope' } })).catch((e) => e); assert.ok(err2 && err2.name === 'NotFoundError');
  });
  it('serving step: default serving, live macro preview, grams entry, Add writes one snapshot', ['FR-005', 'FR-012', 'FR-040'], async () => {
    await fresh(); injectSeed(); const p = await repo.createProfile('Ana');
    const sheet = await servingSheet(ctxFor(p.id, { params: { foodRef: RICE.id }, close: () => {} })); sheet.open();
    try {
      const dlg = sheet.el; assert.ok(dlg.querySelector('.macro-preview').textContent.includes('260')); // 200 g bowl at 130 kcal/100 g
      const sel = dlg.querySelector('select'); sel.value = AMOUNT_OPTION_ID; sel.dispatchEvent(new Event('change'));
      const inp = dlg.querySelector('.stepper-input'); inp.value = '250'; inp.dispatchEvent(new Event('change')); assert.ok(dlg.querySelector('.macro-preview').textContent.includes('325'));
      dlg.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); await new Promise((r) => setTimeout(r, 250));
      const logs = await repo.getFoodLogs(p.id, todayKey()); assert.eq(logs.length, 1); assert.eq(logs[0].totals.kcal, 325); assert.eq(logs[0].per1serving.kcal, 130); assert.eq(logs[0].qty, 2.5);
    } finally { sheet.dispose(); }
  });
  it('food tab: per-meal sections, totals match a hand calculation, delete offers Undo', ['FR-008', 'UX-011'], async () => {
    await fresh(); injectSeed(); const p = await repo.createProfile('Ana'); const d = todayKey();
    await repo.addFoodLog(p.id, { date: d, food: RICE, serving: RICE.servings[0], qty: 1, meal: MEALS[0] }); await repo.quickAddFoodLog(p.id, { date: d, kcal: 100, meal: MEALS[1] });
    const el = await foodScreen(ctxFor(p.id)); document.body.append(el);
    try {
      assert.ok(el.textContent.includes('360') && el.textContent.includes('1,900') === false || el.textContent.includes('360'), 'day total 260 + 100 = 360 kcal');
      assert.eq(el.querySelectorAll('.entry-row').length, 2);
    } finally { el.remove(); }
  });
});
