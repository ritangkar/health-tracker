// A8 functional tests (QA-001). Runs inside tests/index.html (listed in harness SUITES already).
// Scope: pure/functional behaviour that must match the spec using the REAL calc, validate, seed modules and the REAL data/ files.
// Screen-driving flows (picker, sheets, wizard, import UI) are listed in docs/QA-FUNCTIONAL.md; they were run headless by A8 and
// are not repeatable inside this page without iframes, so they are not duplicated here.
// Covers: FR-005, FR-008, FR-012, FR-016, FR-019, FR-020, FR-022, FR-023, FR-024, FR-025, FR-027, DAT-008, DAT-009, DAT-030, UX-017, UX-006 (data side).
import { describe, it, assert, scanForWeekdays } from './harness.js';
import * as calc from '../js/core/calc.js';
import * as V from '../js/core/validate.js';
import * as seed from '../js/core/seed.js';

const getJson = async (p) => (await fetch(new URL('../' + p, import.meta.url))).json();
const getText = async (p) => (await fetch(new URL('../' + p, import.meta.url))).text();
let FOODS = null; let EX = null; let PLANS = null;
async function load() {
  if (FOODS) return;
  FOODS = (await getJson('data/foods-starter.json')).items;
  EX = (await getJson('data/exercises.json')).items;
  PLANS = (await getJson('data/plans.json')).items;
}
const food = (slug) => FOODS.find((f) => f.id === 'f:st-' + slug);
const serving = (f, label) => f.servings.find((s) => s.label.startsWith(label));
const ex = (slug) => EX.find((e) => e.id === 'ex:' + slug);
const log = (f, label, qty, meal) => calc.foodLogSnapshot(f, serving(f, label), qty, { id: meal, label: meal.replace('meal:', '') });
const item = (e, o = {}) => ({ itemId: 'it:x', exerciseId: e.id, exerciseName: e.name, targetKind: e.targetKind, target: e.defaultTarget, targetMax: e.defaultTargetMax ?? null, perSide: !!e.perSide, kcalBasis: { ...e.kcal }, kcalOverride: null, actual: null, manualPct: null, ...o });

describe('A8 worked examples: food totals against hand calculation (FR-005, FR-008, FR-012)', () => {
  // Hand values from data/foods-starter.json: nutrition per 100 g or ml x serving base x quantity.
  it('example 1: rice, white, 1 cup (160 g) = 208 kcal, 4.3 P, 45.1 C, 0.5 F, 0.6 fibre', ['FR-012'], async () => {
    await load(); const l = log(food('rice-white-cooked'), '1 cup', 1, 'meal:breakfast');
    assert.near(l.totals.kcal, 208, 0.05); assert.near(l.totals.protein, 4.3, 0.05); assert.near(l.totals.carbs, 45.1, 0.05); assert.near(l.totals.fat, 0.5, 0.05); assert.near(l.totals.fiber, 0.6, 0.05);
  });
  it('example 2: egg, boiled, 2 x 1 egg (50 g) = 155 kcal, 12.6 P, 1.1 C, 10.6 F, fibre 0', ['FR-005'], async () => {
    await load(); const l = log(food('egg-boiled'), '1 egg', 2, 'meal:breakfast');
    assert.near(l.totals.kcal, 155, 0.05); assert.near(l.totals.protein, 12.6, 0.05); assert.near(l.totals.carbs, 1.1, 0.05); assert.near(l.totals.fat, 10.6, 0.05); assert.eq(l.totals.fiber, 0);
  });
  it('example 3: toor dal 1.5 x 1 bowl (200 ml) = 219 kcal, 12.6 P, 28.5 C, 6 F, 6 fibre', ['FR-012'], async () => {
    await load(); const l = log(food('dal-toor-home'), '1 bowl', 1.5, 'meal:lunch');
    assert.near(l.totals.kcal, 219, 0.05); assert.near(l.totals.protein, 12.6, 0.05); assert.near(l.totals.carbs, 28.5, 0.05); assert.near(l.totals.fat, 6, 0.05); assert.near(l.totals.fiber, 6, 0.05);
  });
  it('example 4: macher jhol 1 serving (150 g) = 165 kcal, 18 P, 3.8 C, 8.3 F (rounded 0.1)', ['FR-012'], async () => {
    await load(); const l = log(food('macher-jhol'), '1 serving', 1, 'meal:dinner');
    assert.near(l.totals.kcal, 165, 0.05); assert.near(l.totals.protein, 18, 0.05); assert.near(l.totals.carbs, 3.8, 0.05); assert.near(l.totals.fat, 8.3, 0.05);
  });
  it('example 5: roti 3 x 1 roti (40 g) = 360 kcal, 11.4 P, 64.8 C, 4.8 F, 5.4 fibre', ['FR-012'], async () => {
    await load(); const l = log(food('roti-whole-wheat'), '1 roti', 3, 'meal:dinner');
    assert.near(l.totals.kcal, 360, 0.05); assert.near(l.totals.protein, 11.4, 0.05); assert.near(l.totals.carbs, 64.8, 0.05); assert.near(l.totals.fat, 4.8, 0.05); assert.near(l.totals.fiber, 5.4, 0.05);
  });
  it('day and per-meal totals of the five examples: 1,107 kcal; Breakfast 363, Lunch 219, Dinner 525; protein 58.9; fibre 12.8', ['FR-008'], async () => {
    await load();
    const logs = [log(food('rice-white-cooked'), '1 cup', 1, 'meal:breakfast'), log(food('egg-boiled'), '1 egg', 2, 'meal:breakfast'), log(food('dal-toor-home'), '1 bowl', 1.5, 'meal:lunch'), log(food('macher-jhol'), '1 serving', 1, 'meal:dinner'), log(food('roti-whole-wheat'), '1 roti', 3, 'meal:dinner')];
    const t = calc.dayTotals(logs);
    assert.eq(t.kcal, 1107); assert.eq(t.protein, 58.9); assert.eq(t.carbs, 143.3); assert.eq(t.fiber, 12.8);
    assert.eq(t.byMeal['meal:breakfast'].kcal, 363); assert.eq(t.byMeal['meal:lunch'].kcal, 219); assert.eq(t.byMeal['meal:dinner'].kcal, 525);
    assert.ok(Math.abs(t.fat - 30.13) < 0.1, 'fat is the sum of per-entry rounded values (30.2 vs exact 30.13)');
  });
  it('implicit grams: 250 g of white rice = 325 kcal (basis 100 g)', ['FR-012'], async () => {
    await load(); const f = food('rice-white-cooked'); const sv = calc.implicitServing(f, 'g'); assert.ok(sv, 'implicit gram serving exists');
    const l = calc.foodLogSnapshot(f, { ...sv, baseAmount: 250 }, 1); assert.near(l.totals.kcal, 325, 0.05);
  });
  it('no data stays null: no food logs give null totals, unknown fibre marks the day partial', ['DAT-009'], async () => {
    await load(); const e = calc.dayTotals([]); assert.eq(e.kcal, null); assert.eq(e.count, 0);
    const q = { totals: { kcal: 300, protein: 0, carbs: 0, fat: 0, fiber: null }, mealId: 'meal:snacks', mealLabel: 'Snacks' };
    const t = calc.dayTotals([q]); assert.eq(t.fiber, null); assert.eq(t.fiberPartial, true);
  });
});

describe('A8 workout rules (FR-019, FR-020, FR-022, FR-023)', () => {
  it('six default plans: names, order and step goals exact', ['FR-019'], async () => {
    await load();
    assert.deepEq(PLANS.map((p) => p.name), ['Upper Body - Push & Pull', 'Lower Body & Core', 'Active Recovery & Yoga', 'Upper Body - Arms Focus', 'Lower Body & Cardio', 'Complete Rest']);
    assert.deepEq(PLANS.map((p) => p.stepGoal), [7000, 7000, 7000, 7000, 7000, 10000]);
    const rest = PLANS[5]; assert.eq(rest.isRest, true); assert.eq(rest.items.length, 0);
    assert.deepEq(PLANS[0].items.map((i) => i.target), [10, 12, 8, 12, 30]); assert.deepEq(PLANS[4].items.map((i) => i.target), [15, 10, 20, 30, 20]); assert.eq(PLANS[4].items[4].targetMax, 30);
  });
  it('completion: 7/10 = 70, 20/30 = 67, 22/30 = 73, caps at 100, null when not entered', ['FR-022'], () => {
    assert.eq(calc.completionPct(7, 10), 70); assert.eq(calc.completionPct(20, 30), 67); assert.eq(calc.completionPct(22, 30), 73); assert.eq(calc.completionPct(12, 10), 100); assert.eq(calc.completionPct(null, 10), null); assert.eq(calc.completionPct(0, 10), 0);
  });
  it('manual percent accepts integers 0 to 100 only; -1, 101 and 50.5 are rejected with the catalog text', ['FR-022', 'DAT-008'], () => {
    assert.eq(calc.completionPct(2, 10, 50), 50); assert.eq(calc.completionPct(null, 10, 0), 0);
    for (const bad of [-1, 101, 50.5]) { assert.ok(!V.checkManualPct(bad).ok, String(bad)); assert.eq(V.checkManualPct(bad).hard[0].message, 'Completion must be a whole number from 0 to 100.'); }
    assert.ok(V.checkManualPct(0).ok); assert.ok(V.checkManualPct(100).ok); assert.ok(V.checkManualPct('50').ok);
  });
  it('range target: minimum is the denominator, so 22 of 20 to 30 minutes is 100 and 15 is 75 (C-047)', ['FR-022'], () => {
    assert.eq(calc.completionPct(22, 20), 100); assert.eq(calc.completionPct(15, 20), 75);
  });
  it('session completion D-071: unentered rows count 0 once one actual is entered; no entries = null', ['FR-022'], () => {
    const rows = [{ actual: 7, pct: 70 }, { actual: null, pct: null }, { actual: null, pct: null }, { actual: null, pct: null }, { actual: 20, pct: 67 }];
    assert.eq(calc.sessionCompletion(rows), 27); assert.eq(calc.sessionCompletion(rows.map((r) => ({ ...r, actual: null, pct: null }))), null); assert.eq(calc.sessionCompletion([]), null);
    assert.eq(calc.sessionCompletion([{ actual: null, pct: 50, manualPct: 50 }, { actual: null, pct: null }]), 25);
  });
  it('kcal: push-up 10 reps = 4.5 at 70 kg and 5.4 at 84 kg; 7 reps = 3.2', ['FR-023'], async () => {
    await load(); const e = ex('push-up'); assert.ok(e, 'ex:push-up in seed');
    assert.eq(calc.computeItem(item(e, { actual: 10 }), 70).kcalEst, 4.5); assert.eq(calc.computeItem(item(e, { actual: 10 }), 84).kcalEst, 5.4); assert.eq(calc.computeItem(item(e, { actual: 7 }), 70).kcalEst, 3.2);
  });
  it('kcal: running 22 min = 220 and brisk walking 25 min = 112.5 at 70 kg; lunge 10 reps each leg doubles', ['FR-023'], async () => {
    await load(); const run = ex('running'), walk = ex('brisk-walking'), lunge = ex('reverse-lunge');
    assert.eq(calc.computeItem(item(run, { actual: 22 }), 70).kcalEst, 220); assert.eq(calc.computeItem(item(walk, { actual: 25 }), 70).kcalEst, 112.5);
    const l1 = calc.computeItem(item(lunge, { actual: 10, perSide: true }), 70).kcalEst, l0 = calc.computeItem(item(lunge, { actual: 10, perSide: false }), 70).kcalEst; assert.eq(l1, l0 * 2);
  });
  it('kcal: manual percent uses target x pct; log override wins and keeps the estimate', ['FR-023'], async () => {
    await load(); const e = ex('push-up'); const m = calc.computeItem(item(e, { manualPct: 50 }), 70); assert.eq(m.pct, 50); assert.eq(m.kcalEst, 2.3);
    const o = calc.computeItem(item(e, { actual: 10, kcalLogOverride: 9 }), 70); assert.eq(o.kcalFinal, 9); assert.eq(o.kcalEst, 4.5);
    assert.ok(!V.checkKcalOverride(5001).ok); assert.eq(V.checkKcalOverride(5001).hard[0].message, 'Calories must be between 0 and 5,000.'); assert.ok(V.checkKcalOverride(0).ok);
  });
  it('body weight: latest on or before the date, else latest any, else 70 kg flagged default', ['FR-023'], () => {
    const m = [{ typeId: 'mt:weight', value: 80, date: '2026-09-01', createdAt: 1 }, { typeId: 'mt:weight', value: 78, date: '2026-09-20', createdAt: 2 }];
    assert.eq(calc.bodyWeightFor('2026-09-10', m).kg, 80); assert.eq(calc.bodyWeightFor('2026-09-25', m).kg, 78); assert.eq(calc.bodyWeightFor('2026-08-01', m).kg, 78); assert.eq(calc.bodyWeightFor('2026-08-01', []).source, 'default');
  });
  it('no weekday wording or schedule field in plans, exercises and plan items', ['FR-020'], async () => {
    await load(); const txt = { 'data/plans.json': await getText('data/plans.json'), 'data/exercises.json': await getText('data/exercises.json') };
    assert.deepEq(scanForWeekdays(txt), []);
    for (const p of PLANS) for (const k of Object.keys(p)) assert.ok(!/^(day|weekday|schedule|rotation|dow)$/i.test(k), k);
  });
});

describe('A8 daily rules: water, steps, sleep, targets (FR-016, FR-024, FR-025, FR-027, DAT-030)', () => {
  it('water: 5 glasses = 2,500 ml = 2.5 L = 83% of 3,000; null stays null; 0 stays 0', ['FR-025'], () => {
    const w = calc.waterDerived(5, 500, 3000); assert.eq(w.ml, 2500); assert.eq(w.litres, 2.5); assert.eq(w.pct, 83);
    assert.eq(calc.waterDerived(null, 500, 3000).ml, null); assert.eq(calc.waterDerived(0, 500, 3000).ml, 0);
  });
  it('steps: 5,830 of 7,000 = 83%; null steps give null, not 0', ['FR-024', 'DAT-009'], () => {
    assert.eq(calc.stepsPercent(5830, 7000), 83); assert.eq(calc.stepsPercent(null, 7000), null); assert.eq(calc.stepsPercent(0, 7000), 0);
    assert.eq(calc.planStepGoalForDay({ stepGoal: 10000, isRest: true }, 7000), 10000); assert.eq(calc.planStepGoalForDay(null, 7000), 7000);
  });
  it('sleep: bed 23:15 and wake 06:40 is 445 minutes (7h 25m); wake before bed is not a duration', ['FR-027'], () => {
    assert.eq(calc.sleepDuration('2026-10-01T23:15', '2026-10-02T06:40'), 445); assert.eq(calc.sleepDuration('2026-10-02T06:40', '2026-10-02T06:00'), null);
  });
  it('targets are effective-dated: a past date keeps the old target, the earliest entry covers earlier dates', ['FR-016', 'DAT-030'], () => {
    const h = [{ from: '2026-09-25', kcal: 1900 }, { from: '2026-10-02', kcal: 2200 }];
    assert.eq(calc.resolveTargets(h, '2026-09-28').kcal, 1900); assert.eq(calc.resolveTargets(h, '2026-10-02').kcal, 2200); assert.eq(calc.resolveTargets(h, '2026-01-01').kcal, 1900); assert.eq(calc.resolveTargets([], '2026-10-02'), null);
  });
  it('averages skip no-data days and report n of N', ['DAT-009'], () => {
    const a = calc.averagesOverDaysWithData([100, null, 200, null, 0]); assert.eq(a.n, 3); assert.eq(a.N, 5); assert.eq(a.avg, 100);
  });
});

describe('A8 validation catalog: exact message text for reachable codes (DAT-008, UX-017)', () => {
  const hard = (r) => r.hard.map((x) => x.message); const soft = (r) => r.soft.map((x) => x.message);
  it('measurements: weight, height and body fat range and unusual text', ['DAT-008'], () => {
    assert.deepEq(hard(V.checkWeight(19)), ['Weight must be between 20 and 400 kg.']); assert.deepEq(hard(V.checkWeight(401)), ['Weight must be between 20 and 400 kg.']); assert.deepEq(hard(V.checkWeight(-5)), ['Weight must be between 20 and 400 kg.']);
    assert.deepEq(soft(V.checkWeight(30)), ['This looks unusual: 30 kg. Save anyway?']); assert.ok(V.checkWeight('72,5').ok, 'decimal comma');
    assert.deepEq(hard(V.checkHeight(49)), ['Height must be between 50 and 250 cm.']); assert.deepEq(hard(V.checkBodyFat(1)), ['Body fat must be between 2 and 70 percent.']);
    assert.deepEq(soft(V.checkBodyFat(60)), ['This looks unusual: 60 percent. Body fat readings are approximate. Save anyway?']);
  });
  it('water, steps, sleep, note text', ['DAT-008'], () => {
    assert.deepEq(hard(V.checkWater(41)), ['Water must be between 0 and 40 glasses, in steps of half a glass.']); assert.deepEq(hard(V.checkWater(0.3)), ['Water must be between 0 and 40 glasses, in steps of half a glass.']);
    assert.deepEq(soft(V.checkWater(13)), ['That is more than 6 litres. Save anyway?']); assert.ok(V.checkWater(0).ok);
    assert.deepEq(hard(V.checkSteps(150001)), ['Steps must be a whole number from 0 to 150,000.']); assert.deepEq(soft(V.checkSteps(60001)), ['That is over 60,000 steps. Save anyway?']); assert.ok(V.checkSteps(0).ok);
    assert.deepEq(hard(V.checkStepGoal(500)), ['A step goal must be between 1,000 and 100,000.']);
    assert.deepEq(hard(V.checkSleep({ durationMin: 1300 })), ['Sleep must be between 1 minute and 20 hours.']); assert.deepEq(soft(V.checkSleep({ durationMin: 900 })), ['That is more than 14 hours of sleep. Save anyway?']);
    assert.deepEq(hard(V.checkSleep({ durationMin: 400, napMin: 700 })), ['A nap must be 0 to 600 minutes.']);
    assert.deepEq(hard(V.checkDayNote({ text: 'x'.repeat(2001), tags: [] })), ['A day note can be up to 2,000 characters.']); assert.deepEq(hard(V.checkDayNote({ text: 'a', tags: ['1', '2', '3', '4', '5', '6'] })), ['You can add up to 5 tags.']);
  });
  it('food, targets and actuals text', ['DAT-008'], () => {
    assert.deepEq(hard(V.checkFoodQty(51)), ['Quantity must be more than 0 and at most 50 servings.']); assert.deepEq(hard(V.checkFoodQty(0)), ['Quantity must be more than 0 and at most 50 servings.']); assert.deepEq(soft(V.checkFoodQty(21)), ['This is a large amount: 21 servings. Save anyway?']);
    assert.deepEq(hard(V.checkTargets({ kcal: 499 })), ['Calories target must be between 500 and 10,000.']);
    assert.deepEq(soft(V.checkActual('reps', 1001)), ['That is over 1,000 reps. Save anyway?']);
  });
});

describe('A8 seed search and content (FR-009, FR-010, FR-011, FR-018)', () => {
  it('spelling variants reach the same dish: macher jhol / machher jhol / maacher jhol / fish curry', ['FR-010'], async () => {
    seed.setSeedData({ foods: (await getJson('data/foods-starter.json')).items, exercises: [], plans: [], mealCategories: [], measurementTypes: [], categories: [] });
    for (const q of ['macher jhol', 'machher jhol', 'maacher jhol', 'fish curry']) { const r = await seed.search(q, 'p_test'); assert.ok(r.length && /Macher jhol/i.test(r[0].name || r[0].food?.name || ''), q); }
    for (const q of ['chapati', 'roti', 'ruti', 'phulka']) { const r = await seed.search(q, 'p_test'); assert.ok(r.some((x) => /Roti/i.test(x.name || x.food?.name || '')), q); }
    for (const q of ['biriyani', 'dal', 'dim']) { const r = await seed.search(q, 'p_test'); assert.ok(r.length > 0, q); }
    assert.eq((await seed.search('xyzzyq', 'p_test')).length, 0);
  });
  it('restaurant foods are flagged estimate and the named exercises exist', ['FR-011', 'FR-018'], async () => {
    await load(); for (const f of FOODS.filter((x) => x.origin === 'restaurant')) assert.eq(f.confidence, 'estimate', f.name);
    for (const s of ['push-up', 'backpack-row', 'pike-push-up', 'reverse-fly', 'plank', 'squat', 'reverse-lunge', 'glute-bridge', 'dead-bug', 'biceps-curl', 'running', 'brisk-walking']) assert.ok(ex(s), s);
  });
  it('seed size is on track: reports food count against the 900 minimum (informational, not a failure)', ['FR-009'], async () => {
    await load(); assert.ok(FOODS.length >= 40, `starter foods ${FOODS.length}`);
  });
});

describe('A8 whole-repo copy checks (FR-020, DEP-006, NFR-009)', () => {
  const listed = async () => { const v = await getText('version.js'); return [...v.slice(v.indexOf('WA_PRECACHE')).matchAll(/'([^']+\.(?:js|css|html|json|webmanifest))'/g)].map((m) => m[1]).filter((p) => !p.startsWith('data/') || p.endsWith('.json')); };
  it('no weekday words in shipped js, css, html, data (allowed: week-start setting labels, date-format display names)', ['FR-020'], async () => {
    const files = await listed(); const txt = {}; for (const f of files) { try { txt[f] = await getText(f); } catch (e) { /* skipped file */ } }
    txt['README.md'] = await getText('README.md');
    const hits = scanForWeekdays(txt, [{ line: /weekStart|WEEK_START|week_start|start = 'mon'|'mon'|'sun'|'sat'|\bmon:\s*1/ }, { file: 'dates.js', line: /const DN =|const MN =/ }]);
    assert.deepEq(hits, [], JSON.stringify(hits.slice(0, 5)));
  });
  it('no http(s) URLs and no network API other than same-origin fetch in shipped js', ['DEP-006', 'NFR-009'], async () => {
    const files = (await listed()).filter((f) => f.endsWith('.js')); const bad = [];
    for (const f of files) { const t = await getText(f); if (/https?:\/\/(?!www\.w3\.org)/.test(t)) bad.push(f + ' url'); if (/XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(t)) bad.push(f + ' net'); if (/\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/.test(t)) bad.push(f + ' html'); if (/setAttribute\(\s*['"]style['"]/.test(t)) bad.push(f + ' style attr'); }
    assert.deepEq(bad, []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A8 continuation (QA-001). Pure checks that mirror what the UI scripts proved in a real browser (see docs/QA-FUNCTIONAL.md).
// ---------------------------------------------------------------------------------------------------------------------
import * as recipe from '../js/features/food/recipe-model.js';
import * as avg from '../js/features/checkins/averages.js';
import * as metrics from '../js/features/analytics/metrics.js';
import { BANNER_PRIORITY } from '../js/ui/components.js';

describe('A8 recipe: per serving is the whole recipe divided by servings (FR-014, DoD-06)', () => {
  it('rice 2 cups + 2 eggs + 1 bowl toor dal over 4 servings: 717 kcal total, 179.3 per serving, equality holds', ['FR-014'], async () => {
    await load();
    const ing = [recipe.ingredientFrom(food('rice-white-cooked'), serving(food('rice-white-cooked'), '1 cup'), 2), recipe.ingredientFrom(food('egg-boiled'), serving(food('egg-boiled'), '1 egg'), 2), recipe.ingredientFrom(food('dal-toor-home'), serving(food('dal-toor-home'), '1 bowl'), 1)];
    const sum = recipe.sumIngredients(ing); assert.near(sum.kcal, 717, 0.5);
    const rec = recipe.buildRecipeRecord({ name: 'Test Khichuri', servings: 4, ingredients: ing });
    assert.near(rec.nutrition.kcal, sum.kcal / 4, 0.01, 'per serving');
    assert.ok(recipe.recipeEquality(rec), 'per-serving x servings equals the ingredient sum');
    const l = calc.foodLogSnapshot(rec, rec.servings[0], 4);
    assert.near(l.totals.kcal, 717, 0.5, 'logging 4 servings equals the whole recipe');
  });
  it('recipe fibre is null when any ingredient fibre is unknown (D-027)', ['FR-014'], async () => {
    await load(); const f = food('egg-boiled');
    const a = recipe.ingredientFrom(f, serving(f, '1 egg'), 1); const b = { ...a, nutrition: { ...a.nutrition, fiber: null } };
    assert.eq(recipe.sumIngredients([a, b]).fiber, null);
  });
});

describe('A8 validation: custom food, measurements, quantities (DAT-008, UX-017)', () => {
  const nut = (o) => ({ per: { amount: 100, unit: 'g' }, kcal: 120, protein: 3.5, carbs: 18, fat: 4, fiber: null, ...o });
  it('custom food per 100 g: 951 kcal, a macro over 100, and a macro sum over 105 give the catalog text', ['DAT-008'], () => {
    assert.eq(V.checkFoodNutrition(nut({ kcal: 951 })).hard[0].message, 'Calories per 100 must be between 0 and 950.');
    assert.eq(V.checkFoodNutrition(nut({ protein: 101 })).hard[0].message, 'Protein, carbs and fat must each be 0 to 100 per 100 g or ml.');
    assert.eq(V.checkFoodNutrition(nut({ protein: 60, carbs: 40, fat: 10 })).hard[0].message, 'Protein + carbs + fat cannot add up to more than 105 per 100 g or ml.');
  });
  it('custom food: calories that do not match the macros are a SOFT confirm, blank fibre is allowed (null, not 0)', ['DAT-008', 'DAT-009'], () => {
    const r = V.checkFoodNutrition(nut({ kcal: 500, protein: 1, carbs: 1, fat: 1 }));
    assert.ok(r.ok && r.soft.length >= 1, 'soft only'); assert.eq(r.soft[0].message, 'The calories do not match the protein, carbs and fat you entered. Save anyway?');
    assert.ok(V.checkFoodNutrition(nut({})).ok);
  });
  it('biceps, thigh, waist, height, body fat, weight: hard limits on both sides with exact text', ['DAT-008'], () => {
    const cases = [['mt:biceps', 9, 81, 'Biceps must be between 10 and 80 cm.'], ['mt:thigh', 19, 121, 'Thigh must be between 20 and 120 cm.'], ['mt:waist', 29, 251, 'Waist must be between 30 and 250 cm.'],
      ['mt:height', 49, 251, 'Height must be between 50 and 250 cm.'], ['mt:bodyFat', 1, 71, 'Body fat must be between 2 and 70 percent.'], ['mt:weight', 19, 401, 'Weight must be between 20 and 400 kg.']];
    for (const [id, lo, hi, msg] of cases) for (const v of [lo, hi]) { const r = V.checkMeasurement(id, v); assert.ok(!r.ok, `${id} ${v}`); assert.eq(r.hard[0].message, msg, `${id} ${v}`); }
  });
  it('measurements: unusual values are SOFT with the catalog text, decimal comma is accepted', ['DAT-008'], () => {
    assert.eq(V.checkMeasurement('mt:height', 230).soft[0].message, 'This looks unusual: 230 cm. Save anyway?');
    assert.eq(V.checkMeasurement('mt:bodyFat', 60).soft[0].message, 'This looks unusual: 60 percent. Body fat readings are approximate. Save anyway?');
    assert.eq(V.checkMeasurement('mt:weight', 210).soft[0].message, 'This looks unusual: 210 kg. Save anyway?');
    assert.eq(V.checkMeasurement('mt:weight', '80,5').value, 80.5);
  });
  it('food quantity: 0 and 51 rejected, 21 is a SOFT confirm, 6,000 g in one entry rejected', ['DAT-008'], () => {
    assert.eq(V.checkFoodQty(0).hard[0].message, 'Quantity must be more than 0 and at most 50 servings.'); assert.ok(!V.checkFoodQty(51).ok);
    assert.eq(V.checkFoodQty(21).soft[0].message, 'This is a large amount: 21 servings. Save anyway?');
    assert.eq(V.checkFoodQty(30, 200).hard[0].message, 'That is more than 5,000 g or ml in one entry.');
  });
});

describe('A8 check-in averages and Trends periods (FR-034, FR-038)', () => {
  it('steps 6,000 / 8,000 / 10,000 on 3 of 7 days average 8,000 and say 3 of 7; empty days are not zero', ['FR-034', 'DAT-009'], () => {
    const days = [['2026-09-28', 6000], ['2026-09-29', 8000], ['2026-09-30', 10000]].map(([date, count]) => ({ date, steps: { count } }));
    const s = avg.computeStats({ days, periodStart: '2026-09-26', periodEnd: '2026-10-02' });
    assert.eq(s.avgSteps, 8000); assert.eq(s.daysWithSteps, 3); assert.eq(s.periodDays, 7);
    const none = avg.computeStats({ periodStart: '2026-09-26', periodEnd: '2026-10-02' }); assert.eq(none.avgSteps, null); assert.eq(none.avgKcal, null);
  });
  it('3 Months buckets follow the week-start setting (Monday and Sunday starts differ)', ['FR-038'], () => {
    const keys = []; for (let i = 0; i < 40; i++) { const d = new Date(2026, 9, 2 - i); keys.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
    const mon = metrics.weeklyBuckets(keys, 'mon', '2026-10-02'), sun = metrics.weeklyBuckets(keys, 'sun', '2026-10-02');
    assert.ok(mon.length > 4 && sun.length > 4); assert.ok(JSON.stringify(mon.map((b) => b.ws)) !== JSON.stringify(sun.map((b) => b.ws)), 'bucket start dates differ'); assert.eq(mon[mon.length - 1].ws, '2026-09-28'); assert.eq(sun[sun.length - 1].ws, '2026-09-27');
  });
  it('periods: Week is 7 days and Month is 30 days ending today', ['FR-038'], () => {
    const w = metrics.periodRange('week', '2026-10-02', 'mon'), m = metrics.periodRange('month', '2026-10-02', 'mon');
    assert.eq(w.from, '2026-09-26'); assert.eq(m.from, '2026-09-03'); assert.eq(w.to, '2026-10-02');
  });
});

describe('A8 banners: one at a time, fixed order (UX-014, D-066)', () => {
  it('priority numbers run storage-red, update, backup, storage-amber, install, check-in', ['UX-014'], () => {
    const order = ['storage-red', 'update', 'backup', 'storage-amber', 'install', 'checkin'];
    for (let i = 1; i < order.length; i++) assert.ok(BANNER_PRIORITY[order[i - 1]] < BANNER_PRIORITY[order[i]], `${order[i - 1]} before ${order[i]}`);
  });
});
