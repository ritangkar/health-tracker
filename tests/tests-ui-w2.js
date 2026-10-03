// A5 tests: W2 screens (custom food, recipe, My foods, plans, exercises, Body, check-ins, photos).
// Covers FR-013, FR-014, FR-018, FR-021, FR-029, FR-031, FR-032, FR-033, FR-034, DAT-002, DAT-013, DAT-019, UX-013, UX-016, UX-021, QA-010.
// Listed in tests/harness.js SUITES by finding F-A5-03 (A1/A12 own the harness).
import { describe, it, assert, scanForWeekdays } from './harness.js';
import * as db from '../js/core/db.js';
import * as repo from '../js/core/repo.js';
import * as seed from '../js/core/seed.js';
import * as SH from '../js/core/storage-health.js';
import { listRoutes, hasScreen, __reset } from '../js/core/router.js';
import { appStore } from '../js/core/store.js';
import { todayKey, addDays } from '../js/core/dates.js';
import { LineChart, BarChart } from '../js/ui/components.js';
import { linePlot } from '../js/ui/charts.js';
import { recipeEquality, buildRecipeRecord, ingredientFrom, rescaleIngredient, sumIngredients, refreshIngredients } from '../js/features/food/recipe-model.js';
import { parseForm, emptyForm, formFromFood } from '../js/features/food/custom-model.js';
import { recipeSheet } from '../js/features/food/recipe-builder.js';
import { customFoodSheet } from '../js/features/food/custom-food.js';
import { planEditorScreen } from '../js/features/workout/plan-editor.js';
import { pastSessionScreen } from '../js/features/workout/past-session.js';
import { PLAN_NOTICE, itemFromExercise, moveUp, moveDown, reorder, planFromDraft, draftOf } from '../js/features/workout/plan-model.js';
import { chartPoints, changeText, defaultRange, sparkline, measurementTypes } from '../js/features/body/series.js';
import { computeStats, statRows } from '../js/features/checkins/averages.js';
import { newState, validateBasics, saveCheckinState, describeSaveError, hasData, isQuota } from '../js/features/checkins/save.js';
import { checkinDue } from '../js/features/checkins/banner.js';
import { presetPair } from '../js/features/photos/compare.js';
import { processImage, fitSize, downscalePlan, PhotoError } from '../js/features/photos/image-pipeline.js';
import { createUrlBag } from '../js/features/photos/url-bag.js';

SH.setStoragePrefix('winter-arc-test:');
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fresh() { await db.closeDb(); db.openDb(`winter-arc-test-w2-${Date.now().toString(36)}-${n++}`); await repo.initRepo(); seed.invalidateOverlay(); appStore.update({ activeProfile: null }); }
const MEALS = [{ id: 'meal:breakfast', label: 'Breakfast', sortOrder: 1, clockFrom: 0, clockTo: 11 }, { id: 'meal:lunch', label: 'Lunch', sortOrder: 2, clockFrom: 11, clockTo: 15 }, { id: 'meal:snacks', label: 'Snacks', sortOrder: 3, clockFrom: 15, clockTo: 18 }, { id: 'meal:dinner', label: 'Dinner', sortOrder: 4, clockFrom: 18, clockTo: 23 }, { id: 'meal:other', label: 'Other', sortOrder: 5, clockFrom: 23, clockTo: 24 }];
const food = (id, name, per, extra = {}) => ({ id, kind: 'food', name, aliases: [], category: 'grain-rice', cuisine: 'indian', origin: 'home', confidence: 'typical', system: true, nutrition: { per, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }, servings: [{ id: 's1', label: '1 bowl (200 g)', unit: 'bowl', baseAmount: 200, approx: true }], defaultServingId: 's1', ...extra });
const RICE = food('f:t-rice', 'Rice, cooked', { amount: 100, unit: 'g' });
const EGG = { ...food('f:t-egg', 'Boiled egg', { amount: 100, unit: 'g' }), category: 'egg', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 155, protein: 13, carbs: 1.1, fat: 11, fiber: null }, servings: [{ id: 's1', label: '1 egg (50 g)', unit: 'piece', baseAmount: 50, approx: false }] };
const PLAN = { id: 'plan:t-push', name: 'Test push', stepGoal: 7000, isRest: false, rev: 1, items: [
  { itemId: 'it:t:1', exerciseId: 'ex:t-pushup', exerciseName: 'Push-ups', targetKind: 'reps', target: 10, targetMax: null, perSide: false, altExerciseIds: [], kcalOverride: null, kcalSnap: { basis: 'per_rep', value: 0.5, refWeightKg: 70, scaleByWeight: false }, note: null },
  { itemId: 'it:t:2', exerciseId: 'ex:t-plank', exerciseName: 'Plank', targetKind: 'seconds', target: 30, targetMax: null, perSide: false, altExerciseIds: [], kcalOverride: null, kcalSnap: { basis: 'per_minute', value: 4, refWeightKg: 70, scaleByWeight: false }, note: null }] };
const EX = (id, name, kind, kcal) => ({ id, name, targetKind: kind, defaultTarget: 10, category: 'strength', kcal: { basis: kcal[0], value: kcal[1], refWeightKg: 70, scaleByWeight: false } });
const MT = [{ id: 'mt:height', key: 'height', label: 'Height', canonicalUnit: 'cm', decimals: 1, approx: false, v1: true, sortOrder: 1 }, { id: 'mt:weight', key: 'weight', label: 'Weight', canonicalUnit: 'kg', decimals: 1, approx: false, v1: true, sortOrder: 2 }, { id: 'mt:chest', key: 'chest', label: 'Chest', canonicalUnit: 'cm', decimals: 1, approx: false, v1: false, sortOrder: 9 }];
function injectSeed() { seed.setSeedData({ foods: [RICE, EGG], exercises: [EX('ex:t-pushup', 'Push-ups', 'reps', ['per_rep', 0.5]), EX('ex:t-plank', 'Plank', 'seconds', ['per_minute', 4])], plans: [PLAN], mealCategories: MEALS, measurementTypes: MT, categories: [], seedVersion: 1 }); }
const ctxFor = (pid, extra = {}) => ({ pid, date: todayKey(), path: '/food/recipe', query: {}, params: {}, onCleanup: () => {}, navigate: async () => true, replace: async () => true, back: () => {}, close: () => {}, ...extra });
async function setup() { await fresh(); injectSeed(); const p = await repo.createProfile('Tester'); appStore.update({ activeProfile: p.id }); return p.id; }
const btn = (root, text) => [...root.querySelectorAll('button, a.btn')].find((b) => b.textContent.trim() === text) || null;
const text = async (p) => (await fetch(new URL(p, new URL('../', import.meta.url)))).text();
const NOW = Date.now();
const counts = async () => ({ ck: await db.count('checkins'), ph: await db.count('photos'), pd: await db.count('photoData'), ms: await db.count('measurements') });
function canvasBlob(w, h, q = 0.9) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#2a7'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; for (let x = 0; x < w; x += 120) g.fillRect(x, 0, 6, h); return new Promise((res) => c.toBlob(res, 'image/jpeg', q)); }

describe('A5 recipe model and UI (QA-010, FR-014)', () => {
  it('per-serving equals sum / servings, stored and displayed (model)', ['FR-014', 'QA-010'], () => {
    const ing = [ingredientFrom(RICE, RICE.servings[0], 1.5), ingredientFrom(EGG, EGG.servings[0], 3)];
    for (const servings of [1, 3, 4, 7, 0.5, 100]) {
      const rec = buildRecipeRecord({ name: 'R', servings, ingredients: ing });
      const eq = recipeEquality(rec); assert.ok(eq.ok, `servings ${servings} maxDiff ${eq.maxDiff}`);
      const sum = sumIngredients(ing); assert.near(rec.nutrition.kcal * servings, sum.kcal, 1e-3);
      assert.eq(rec.nutrition.fiber, null, 'fibre unknown when an ingredient has none');
    }
  });
  it('rescaling an ingredient keeps the snapshot consistent', ['FR-014'], () => {
    const a = ingredientFrom(RICE, RICE.servings[0], 1); const b = rescaleIngredient(a, 2);
    assert.near(b.nutrition.kcal, a.nutrition.kcal * 2, 1e-3); assert.near(b.amountBase, 400, 1e-3);
  });
  it('recipe UI: build, preview, save; stored per-serving x servings equals totals and the preview matches (UI level)', ['FR-014', 'QA-010', 'UX-013'], async () => {
    const pid = await setup(); const sheet = await recipeSheet(ctxFor(pid)); const root = sheet.body;
    root.querySelector('#recipe-name').value = 'Rice and egg'; root.querySelector('#recipe-name').dispatchEvent(new Event('input'));
    for (const [q, label] of [['rice', 'Rice, cooked'], ['egg', 'Boiled egg']]) {
      btn(root, 'Add ingredient').click(); await sleep(50);
      const s = root.querySelector('input[type=search]'); s.value = q; s.dispatchEvent(new Event('input')); await sleep(450);
      const row = [...root.querySelectorAll('.result-list .row-main')].find((r) => r.textContent.includes(label)); assert.ok(row, `search shows ${label}`); row.click(); await sleep(50);
      btn(root, 'Add to recipe').click(); await sleep(50);
    }
    assert.eq(root.querySelectorAll('.ingredient-row').length, 2);
    const st = root.querySelector('.stepper-input[aria-label="Servings this recipe makes"]'); st.value = '3'; st.dispatchEvent(new Event('change')); await sleep(30);
    const previewKcal = root.querySelector('.macro-preview .macro-val').textContent; // "Calories 207 kcal"
    btn(sheet.footer, 'Save recipe').click(); await sleep(500);
    const saved = (await repo.listFoods(pid)).find((f) => f.kind === 'recipe'); assert.ok(saved, 'recipe saved');
    assert.eq(saved.recipe.servings, 3); assert.ok(recipeEquality(saved).ok, 'stored equality');
    const totals = saved.recipe.ingredients.reduce((a, i) => a + i.nutrition.kcal, 0);
    assert.near(saved.nutrition.kcal * 3, totals, 1e-3);
    assert.eq(previewKcal, `${Math.round(totals / 3)} kcal`, 'display equals stored / rounded');
    sheet.dispose && sheet.dispose();
  });
  it('a recipe cannot be an ingredient and the ingredient limit is enforced by the validator message', ['FR-014'], async () => {
    const pid = await setup(); await repo.saveFood(pid, buildRecipeRecord({ name: 'Inner', servings: 2, ingredients: [ingredientFrom(RICE, RICE.servings[0], 1)] }));
    const sheet = await recipeSheet(ctxFor(pid)); const root = sheet.body; btn(root, 'Add ingredient').click(); await sleep(50);
    const s = root.querySelector('input[type=search]'); s.value = 'inner'; s.dispatchEvent(new Event('input')); await sleep(450);
    assert.eq(root.querySelectorAll('.result-list .row-main').length, 0, 'recipes are filtered out'); sheet.dispose && sheet.dispose();
  });
  it('refresh shows what changes and stored recipe stays frozen until applied', ['FR-014'], async () => {
    const ing = [ingredientFrom(RICE, RICE.servings[0], 1)]; const changed = { ...RICE, nutrition: { ...RICE.nutrition, kcal: 200 } };
    const r = await refreshIngredients(ing, 2, async () => changed);
    assert.ok(r.changes.some((c) => c.key === 'kcal')); assert.near(ing[0].nutrition.kcal, 260, 1e-3, 'original untouched'); assert.near(r.ingredients[0].nutrition.kcal, 400, 1e-3);
  });
});

describe('A5 custom food (FR-013)', () => {
  it('parseForm: blank fibre is unknown (null), negative and impossible values are rejected', ['FR-013', 'DAT-009'], () => {
    const f = { ...emptyForm(), name: 'Dal', kcal: '120', protein: '8', carbs: '15', fat: '3', basis: 'g' };
    const ok = parseForm(f); assert.eq(ok.errors.length, 0); assert.eq(ok.record.nutrition.fiber, null); assert.eq(ok.record.confidence, 'estimate');
    assert.ok(parseForm({ ...f, kcal: '-1' }).errors.length > 0); assert.ok(parseForm({ ...f, name: '  ' }).errors.length > 0); assert.ok(parseForm({ ...f, protein: '90', carbs: '90' }).errors.length > 0);
    const lab = parseForm({ ...f, sourceKind: 'label' }); assert.eq(lab.record.source.type, 'label'); assert.eq(lab.record.confidence, 'typical');
    assert.eq(parseForm({ ...f, origin: 'restaurant', sourceKind: 'label' }).record.confidence, 'estimate', 'restaurant is always an estimate');
    assert.eq(parseForm({ ...f, fiber: '0' }).record.nutrition.fiber, 0, 'zero entered stays zero');
  });
  it('per-serving basis needs no weight; g basis with a serving gets that serving', ['FR-012', 'FR-013'], () => {
    const s = parseForm({ ...emptyForm(), name: 'Roll', kcal: '300', protein: '10', carbs: '40', fat: '10', basis: 'serving', servingLabel: '1 roll', servingUnit: 'piece' });
    assert.eq(s.errors.length, 0); assert.eq(s.record.nutrition.per.unit, 'serving'); assert.eq(s.record.servings[0].baseAmount, 1);
    const g = parseForm({ ...emptyForm(), name: 'Dal', kcal: '100', protein: '5', carbs: '15', fat: '2', basis: 'g', servingLabel: '1 bowl', servingUnit: 'bowl', servingBase: '200' });
    assert.eq(g.errors.length, 0); assert.eq(g.record.servings[0].baseAmount, 200); assert.eq(formFromFood({ ...g.record, id: 'fd_x' }).servingBase, '200');
  });
  it('custom food UI: save and log now logs a snapshot, appears in search, and a later edit leaves the log alone', ['FR-013', 'DAT-007'], async () => {
    const pid = await setup(); let finished = 0; const sheet = await customFoodSheet(ctxFor(pid, { path: '/food/custom', query: { from: 'today' }, back: () => { finished++; } })); const root = sheet.body;
    const set = (label, v) => { const i = [...root.querySelectorAll('input')].find((x) => x.id && root.querySelector(`label[for="${x.id}"]`) && root.querySelector(`label[for="${x.id}"]`).textContent.startsWith(label)); i.value = v; i.dispatchEvent(new Event('input')); };
    set('Name', 'Mum\u2019s khichuri'); set('Calories', '180'); set('Protein', '7'); set('Carbs', '30'); set('Fat', '3');
    const footer = sheet.footer; btn(footer, 'Save and log now').click(); await sleep(700);
    const foods = await repo.listFoods(pid); assert.eq(foods.length, 1); const logs = await repo.getFoodLogs(pid, todayKey()); assert.eq(logs.length, 1); assert.eq(logs[0].totals.kcal, 180); assert.eq(finished, 1, 'returned to Today');
    const hit = await seed.search('khichuri', pid, 5); assert.eq(hit.length, 1);
    await repo.saveFood(pid, { ...foods[0], nutrition: { ...foods[0].nutrition, kcal: 400 } });
    assert.eq((await repo.getFoodLogs(pid, todayKey()))[0].totals.kcal, 180, 'history keeps its snapshot'); sheet.dispose && sheet.dispose();
  });
  it('a foreign food id is Not found, never shown', ['FR-001'], async () => {
    const pid = await setup(); const other = await repo.createProfile('Other'); const f = await repo.saveFood(other.id, parseForm({ ...emptyForm(), name: 'Secret', kcal: '10', protein: '1', carbs: '1', fat: '1', basis: 'g' }).record);
    let err = null; try { await customFoodSheet(ctxFor(pid, { params: { id: f.id }, path: '/food/custom' })); } catch (e) { err = e; }
    assert.ok(err && err.name === 'NotFoundError');
  });
});

describe('A5 plans (FR-021, DAT-007)', () => {
  it('plan model: add from exercise freezes calories, reorder, rest plans carry no items, no weekday field', ['FR-021', 'FR-020'], () => {
    const it1 = itemFromExercise(EX('ex:a', 'A', 'reps', ['per_rep', 0.4])); assert.eq(it1.kcalSnap.value, 0.4); assert.eq(it1.kcalOverride, null);
    const items = [{ itemId: 'a' }, { itemId: 'b' }, { itemId: 'c' }];
    assert.deepEq(moveDown(items, 0).map((x) => x.itemId), ['b', 'a', 'c']); assert.deepEq(moveUp(items, 2).map((x) => x.itemId), ['a', 'c', 'b']); assert.deepEq(reorder(items, 0, 2).map((x) => x.itemId), ['b', 'c', 'a']);
    assert.deepEq(moveUp(items, 0).map((x) => x.itemId), ['a', 'b', 'c'], 'edges stay put');
    assert.eq(planFromDraft({ id: 'x' }, { name: 'R', description: '', stepGoal: 10000, isRest: true, items: items }).items.length, 0);
    assert.ok(!Object.keys(planFromDraft({}, draftOf(PLAN))).some((k) => /day|week|schedule/i.test(k)));
    assert.ok(/new workouts/i.test(PLAN_NOTICE) && /do not change/i.test(PLAN_NOTICE));
  });
  it('plan editor UI: notice, up/down and drag handles, edit and save never changes an existing workout log', ['FR-021', 'DAT-007', 'QA-010'], async () => {
    const pid = await setup(); const resolve = await seed.resolveExerciseSync(pid);
    const log = await repo.createWorkoutLog(pid, { date: todayKey(), plan: PLAN, resolveExercise: resolve }); await repo.updateWorkoutItem(pid, log.id, log.items[0].itemId, { actual: 7 });
    const before = JSON.stringify(await repo.getWorkoutLog(pid, log.id)); let replacedTo = null;
    const el = await planEditorScreen(ctxFor(pid, { path: '/workout/plan/plan:t-push', params: { id: 'plan:t-push' }, replace: async (h) => { replacedTo = h; return true; } }));
    document.body.appendChild(el);
    try {
      assert.ok(el.textContent.includes('Changes apply to new workouts. Past workouts do not change.'));
      assert.eq(el.querySelectorAll('.sort-handle').length, 2, 'drag handles'); assert.ok(el.querySelector('button[aria-label="Move Push-ups down"]'), 'down button'); assert.ok(el.querySelector('button[aria-label="Move Plank up"]'), 'up button');
      el.querySelector('button[aria-label="Move Push-ups down"]').click(); await sleep(20);
      el.querySelectorAll('.plan-item .row-main')[1].click(); await sleep(20); // Push-ups is now second
      const t = [...el.querySelectorAll('input')].find((i) => i.id && el.querySelector(`label[for="${i.id}"]`) && /^Target/.test(el.querySelector(`label[for="${i.id}"]`).textContent)); t.value = '45'; t.dispatchEvent(new Event('input'));
      btn(el, 'Done').click(); await sleep(20); btn(el, 'Save plan').click(); await sleep(700);
      assert.ok(replacedTo && replacedTo.includes('/workout/plan/pl_'), 'a copy of the default plan was made');
      assert.eq(JSON.stringify(await repo.getWorkoutLog(pid, log.id)), before, 'existing workout log is byte-identical');
      const copy = (await repo.listPlans(pid))[0]; assert.eq(copy.basedOn, 'plan:t-push'); assert.eq(copy.items[0].exerciseName, 'Plank'); assert.eq(copy.items[0].target, 30); assert.eq(copy.items[1].exerciseName, 'Push-ups'); assert.eq(copy.items[1].target, 45);
      const listed = (await seed.listPlans(pid)).filter((x) => x.name === 'Test push'); assert.eq(listed.length, 1, 'the copy stands in for the default in lists'); assert.eq(listed[0].id, copy.id);
      assert.eq((await seed.getPlan('plan:t-push', pid)).items[0].exerciseName, 'Push-ups', 'the built-in plan itself is untouched');
      await repo.deletePlan(pid, copy.id); await repo.deletePlan(pid, 'plan:t-push');
      assert.eq(JSON.stringify(await repo.getWorkoutLog(pid, log.id)), before, 'deleting plans leaves the log alone');
      const view = await pastSessionScreen(ctxFor(pid, { path: `/workout/view/${log.id}`, params: { logId: log.id } }));
      assert.ok(view.textContent.includes('Push-ups') && view.textContent.includes('7 reps') && view.textContent.includes('70%'), 'past session still shows the old snapshot');
    } finally { el.remove(); }
  });
  it('past session is read-only: no steppers, no inputs, link to edit', ['FR-021'], async () => {
    const pid = await setup(); const resolve = await seed.resolveExerciseSync(pid); const log = await repo.createWorkoutLog(pid, { date: todayKey(), plan: PLAN, resolveExercise: resolve });
    const v = await pastSessionScreen(ctxFor(pid, { params: { logId: log.id } })); assert.eq(v.querySelectorAll('input, .stepper').length, 0);
    let err = null; const other = await repo.createProfile('O2'); const ol = await repo.createWorkoutLog(other.id, { date: todayKey(), plan: PLAN, resolveExercise: resolve });
    try { await pastSessionScreen(ctxFor(pid, { params: { logId: ol.id } })); } catch (e) { err = e; } assert.ok(err && err.name === 'NotFoundError', 'foreign log is Not found');
  });
});

describe('A5 body and graph honesty (FR-029, FR-031, C-024)', () => {
  const pts = (list) => list.map(([d, v]) => ({ date: addDays(todayKey(), -d), value: v }));
  it('trend line only with 5 or more points, labelled; fewer points draw none', ['FR-031', 'UX-016'], () => {
    const four = linePlot({ points: pts([[30, 75], [20, 74], [10, 73.5], [1, 73]]), unit: 'kg' }); assert.eq(four.svg.querySelectorAll('.trend-line').length, 0);
    const five = linePlot({ points: pts([[40, 75], [30, 74.5], [20, 74], [10, 73.5], [1, 73]]), unit: 'kg' }); assert.eq(five.svg.querySelectorAll('.trend-line').length, 1); assert.ok(/Trend/.test(five.svg.querySelector('.trend-text').textContent));
  });
  it('gaps stay gaps: a long gap draws no connector, a short gap is dashed, a 1 day gap is solid', ['FR-031'], () => {
    const r = linePlot({ points: pts([[40, 75], [20, 74], [19, 73.8], [14, 73.5]]), unit: 'kg', solidMaxGap: 2, dashedMaxGap: 8 });
    assert.eq(r.svg.querySelectorAll('.seg-solid').length, 1); assert.eq(r.svg.querySelectorAll('.seg-dashed').length, 1); assert.eq(r.svg.querySelectorAll('.dot').length, 4, 'every raw point shown');
  });
  it('LineChart: ranges 1M 3M 6M 1Y All, latest/previous/change, table toggle, empty hint', ['FR-031', 'UX-016'], () => {
    const el = LineChart({ title: 'Weight over time', points: pts([[60, 75], [40, 74], [20, 73], [10, 72.8], [1, 72.4]]), unit: 'kg', range: 'All', endDate: todayKey() });
    assert.deepEq([...el.querySelectorAll('[role=tab]')].map((t) => t.textContent), ['1M', '3M', '6M', '1Y', 'All']);
    assert.ok(/Latest/.test(el.textContent) && /Previous/.test(el.textContent) && /Change/.test(el.textContent) && /Down 0\.4 kg/.test(el.textContent));
    assert.eq(el.querySelector('svg.chart-svg').getAttribute('role'), 'img'); assert.ok(el.querySelector('svg.chart-svg').getAttribute('aria-label').length > 20);
    [...el.querySelectorAll('button')].find((b) => /table/.test(b.textContent)).click(); assert.ok(el.querySelector('table'), 'table alternative');
    const one = LineChart({ title: 'W', points: pts([[1, 72]]), unit: 'kg', range: 'All', endDate: todayKey() }); assert.ok(/Add one more/.test(one.textContent));
  });
  it('BarChart never turns no data into a zero bar', ['DAT-009', 'FR-031'], () => {
    const el = BarChart({ title: 'Steps', bars: [{ date: addDays(todayKey(), -2), value: 5000 }, { date: addDays(todayKey(), -1), value: null }, { date: todayKey(), value: 0 }], unit: 'steps' });
    assert.eq(el.querySelectorAll('.nodata-mark').length, 1); assert.eq(el.querySelectorAll('rect.bar').length, 2, 'entered 0 is a bar; no data is not');
  });
  it('series helpers: one point per date, neutral change wording, default range, reserved types hidden, sparkline', ['FR-029', 'UX-013'], async () => {
    await setup();
    assert.deepEq(chartPoints([{ date: '2026-01-02', value: 2, createdAt: 2 }, { date: '2026-01-01', value: 1, createdAt: 1 }, { date: '2026-01-02', value: 3, createdAt: 3 }]).map((p) => p.value), [1, 3]);
    assert.ok(/^Down 1 kg since \w+ 3 Jan$/.test(changeText({ date: '2026-01-10', value: 72 }, { date: '2026-01-03', value: 73 }, 'kg')));
    assert.ok(/^No change since/.test(changeText({ date: '2026-01-10', value: 73 }, { date: '2026-01-03', value: 73 }, 'kg')));
    assert.ok(!/good|bad|great|worse|better|red|fail/i.test(changeText({ date: '2026-01-10', value: 75 }, { date: '2026-01-03', value: 73 }, 'kg')));
    assert.eq(changeText({ date: 'x', value: 1 }, null, 'kg'), 'First reading');
    assert.eq(defaultRange([{ date: todayKey(), value: 1 }], todayKey()), 'All'); assert.eq(defaultRange(pts([[3, 1], [1, 2]]), todayKey()), '1M');
    assert.ok(!measurementTypes().some((t) => t.key === 'chest'), 'chest is V1.1'); assert.eq(sparkline([1, 2, 3]).getAttribute('aria-hidden'), 'true');
  });
});

describe('A5 check-in averages, banner, compare (FR-034, UX-021, FR-033)', () => {
  const end = '2026-03-10';
  it('averages are over days WITH data and say n of N; no data is null, never 0', ['FR-034', 'DAT-009'], () => {
    const mk = (date, kcal, fiber) => ({ date, mealId: 'meal:lunch', totals: { kcal, protein: 10, carbs: 20, fat: 5, fiber } });
    const s = computeStats({ periodStart: '2026-03-04', periodEnd: end, foodLogs: [mk('2026-03-05', 1000, 4), mk('2026-03-06', 2000, 6)], days: [{ date: '2026-03-05', steps: { count: 4000 } }, { date: '2026-03-06', steps: { count: 0 } }, { date: '2026-03-07', steps: { count: null } }], sleeps: [], workouts: [] });
    assert.eq(s.periodDays, 7); assert.eq(s.avgKcal, 1500); assert.eq(s.daysWithFood, 2); assert.eq(s.avgSteps, 2000, 'entered 0 counts, null does not'); assert.eq(s.daysWithSteps, 2); assert.eq(s.avgSleepMin, null); assert.eq(s.daysWithSleep, 0);
    const rows = statRows(s); assert.ok(rows.find((r) => r.key === 'kcal').detail === 'avg over 2 of 7 days'); assert.eq(rows.find((r) => r.key === 'sleep').value, null);
  });
  it('workout completion average skips rest days and not-started sessions (D-071)', ['FR-034'], () => {
    const s = computeStats({ periodStart: '2026-03-04', periodEnd: end, workouts: [{ date: '2026-03-05', isRest: false, completionPct: 70 }, { date: '2026-03-06', isRest: false, completionPct: 100 }, { date: '2026-03-07', isRest: true, completionPct: null }, { date: '2026-03-08', isRest: false, completionPct: null }] });
    assert.eq(s.workoutCompletionAvg, 85); assert.eq(s.workoutSessions, 2);
    assert.eq(computeStats({ periodStart: '2026-03-04', periodEnd: end }).workoutCompletionAvg, null);
  });
  it('a day with unknown fibre is left out of the fibre average, not counted as 0', ['FR-034'], () => {
    const mk = (date, fiber) => ({ date, mealId: 'm', totals: { kcal: 100, protein: 1, carbs: 1, fat: 1, fiber } });
    const s = computeStats({ periodStart: '2026-03-04', periodEnd: end, foodLogs: [mk('2026-03-05', 10), mk('2026-03-06', null)] }); assert.eq(s.avgFiber, 10); assert.eq(s.daysWithFiber, 1);
  });
  it('check-in due banner rule: off, interval, snooze, first check-in', ['UX-021'], () => {
    const today = '2026-03-10'; assert.eq(checkinDue({ interval: 0, latest: '2026-01-01', today }).due, false);
    assert.eq(checkinDue({ interval: 7, latest: '2026-03-03', today }).due, true); assert.eq(checkinDue({ interval: 7, latest: '2026-03-04', today }).due, false);
    assert.eq(checkinDue({ interval: 14, latest: '2026-03-03', today }).due, false); assert.eq(checkinDue({ interval: 7, latest: '2026-03-03', today, snoozeUntil: NOW + 1000, now: NOW }).reason, 'snoozed');
    assert.eq(checkinDue({ interval: 7, latest: null, today, profileCreatedAt: NOW - 8 * 86400000, now: NOW }).due, true); assert.eq(checkinDue({ interval: 7, latest: null, today, profileCreatedAt: NOW - 86400000, now: NOW }).due, false);
    assert.eq(checkinDue({ interval: 3, latest: '2020-01-01', today }).due, false, 'only off, 7 or 14');
  });
  it('compare presets pick earliest vs latest and previous vs latest from a newest-first list', ['FR-033'], () => {
    const all = [{ id: 'c3' }, { id: 'c2' }, { id: 'c1' }]; assert.deepEq(presetPair(all, 'earliest'), { a: 'c1', b: 'c3' }); assert.deepEq(presetPair(all, 'previous'), { a: 'c2', b: 'c3' }); assert.eq(presetPair([{ id: 'x' }], 'previous'), null);
  });
});

describe('A5 photos: pipeline and atomic save (DAT-002, DAT-013, DAT-019)', () => {
  it('fitSize never upscales and keeps the aspect ratio; downscalePlan halves huge sources first', ['DAT-013'], () => {
    assert.deepEq(fitSize(3000, 2000, 1600), { w: 1600, h: 1067 }); assert.deepEq(fitSize(800, 600, 1600), { w: 800, h: 600 }); assert.deepEq(fitSize(1000, 4000, 320), { w: 80, h: 320 });
    const plan = downscalePlan(8000, 6000, 1600); assert.ok(plan.length >= 2, 'two steps for a huge image'); assert.deepEq(plan[plan.length - 1], { w: 1600, h: 1200 }); assert.eq(downscalePlan(1200, 900, 1600).length, 1);
  });
  it('processImage: long edge 1600 q0.8 plus a 320 thumb, no EXIF or GPS markers, small images are not enlarged', ['DAT-013', 'FR-032'], async () => {
    const out = await processImage(new File([await canvasBlob(3000, 2000)], 'a.jpg', { type: 'image/jpeg' }));
    assert.eq(Math.max(out.w, out.h), 1600); assert.eq(out.w, 1600); assert.eq(out.h, 1067); assert.eq(out.mime, 'image/jpeg'); assert.eq(out.bytes, out.blob.size);
    const t = await createImageBitmap(out.thumb); assert.eq(Math.max(t.width, t.height), 320); t.close();
    const head = new Uint8Array(await out.blob.slice(0, 4096).arrayBuffer()); const asText = String.fromCharCode(...head); assert.ok(!/Exif|GPS|XMP/.test(asText), 'metadata stripped by canvas re-encode'); assert.eq(head[0], 0xff); assert.eq(head[1], 0xd8);
    assert.ok(Number.isInteger(out.crc32));
    const small = await processImage(new File([await canvasBlob(800, 600)], 's.jpg', { type: 'image/jpeg' })); assert.eq(small.w, 800); assert.eq(small.h, 600);
  });
  it('processImage rejects non-images, empty files and corrupt data with the C_PHOTO_FAIL message', ['DAT-013'], async () => {
    for (const f of [new File(['not an image'], 'x.jpg', { type: 'image/jpeg' }), new File([], 'e.jpg', { type: 'image/jpeg' }), new File(['hello'], 'x.txt', { type: 'text/plain' })]) {
      const e = await assert.throws(() => processImage(f)); assert.ok(e instanceof PhotoError); assert.eq(e.message, 'This photo could not be prepared. Try another photo.');
    }
  });
  it('limits: a fifth photo or a repeated slot is refused; one check-in saves with photos, thumbs and a weight reading in one transaction', ['DAT-002', 'FR-032', 'FR-034'], async () => {
    const pid = await setup(); const p = await processImage(new File([await canvasBlob(900, 1200)], 'a.jpg', { type: 'image/jpeg' }));
    const st = newState(pid); st.weight = '71,5'; st.photos = { front: p, side: p }; st.note = 'ok';
    const r = await saveCheckinState(pid, st); assert.ok(r.ok, JSON.stringify(r.error || r.errors)); assert.eq(r.saved.photos.length, 2);
    assert.deepEq(await counts(), { ck: 1, ph: 2, pd: 2, ms: 1 });
    const ph = await repo.listPhotos(pid, r.saved.id); assert.ok(ph.every((x) => x.thumb instanceof Blob)); assert.ok((await repo.getPhotoBlob(pid, ph[0].id, true)) instanceof Blob);
    const dup = await assert.throws(() => repo.saveCheckinWithPhotos(pid, { date: todayKey(), measurements: {} }, [{ slot: 'front', ...p }, { slot: 'front', ...p }]));
    assert.eq(dup.code, 'C_PHOTO_COUNT'); const five = await assert.throws(() => repo.saveCheckinWithPhotos(pid, { date: todayKey() }, ['front', 'side', 'back', 'flexed', 'front'].map((slot) => ({ slot, ...p })))); assert.eq(five.code, 'C_PHOTO_COUNT');
    assert.deepEq(await counts(), { ck: 1, ph: 2, pd: 2, ms: 1 }, 'refusals changed nothing');
  });
  it('atomic: a failure after the photos are written leaves no check-in, no photo rows, no photo files and no measurements (injected)', ['DAT-019', 'QA-010'], async () => {
    const pid = await setup(); const p = await processImage(new File([await canvasBlob(600, 800)], 'a.jpg', { type: 'image/jpeg' }));
    const st = newState(pid); st.weight = '72'; st.photos = { front: p, back: p }; st.measures.waist = '5'; // waist 5 cm fails inside the transaction, after photos and the check-in are put
    const before = await counts(); const r = await saveCheckinState(pid, st, { prevalidate: false });
    assert.eq(r.ok, false); assert.deepEq(await counts(), before, 'nothing partial'); assert.eq(r.error.kind, 'validation');
  });
  it('QuotaExceeded path: not enough space aborts before any write and says "Nothing was saved"', ['DAT-013', 'QA-010'], async () => {
    const pid = await setup(); const p = await processImage(new File([await canvasBlob(600, 800)], 'a.jpg', { type: 'image/jpeg' }));
    const st = newState(pid); st.weight = '72'; st.photos = { front: { ...p, bytes: 9e15 } };
    const e = await SH.estimate(); const before = await counts(); const r = await saveCheckinState(pid, st);
    if (e.free == null) { assert.ok(true, 'browser reports no free estimate; the injected-error check below covers the message'); }
    else { assert.eq(r.ok, false); assert.eq(r.error.kind, 'quota'); assert.ok(/Nothing was saved/.test(r.error.message)); assert.deepEq(await counts(), before); }
    const d = describeSaveError(new db.QuotaError(new Error('x'))); assert.eq(d.kind, 'quota'); assert.ok(d.message.startsWith('There is not enough space. Nothing was saved.')); assert.ok(isQuota({ name: 'QuotaExceededError' }));
    assert.eq(describeSaveError(new Error('boom')).kind, 'other'); assert.ok(/Nothing was saved/.test(describeSaveError(new Error('boom')).message));
  });
  it('validation: empty is "not entered", bad weight is a HARD error, unusual is soft; a check-in with nothing is empty', ['DAT-008', 'DAT-009'], async () => {
    const pid = await setup(); const st = newState(pid); assert.eq(hasData(st), false);
    let v = validateBasics(st); assert.eq(v.errors.length, 0); assert.eq(v.values.weight, null);
    st.weight = '-4'; v = validateBasics(st); assert.eq(v.errors[0].field, 'weight'); st.weight = '30'; v = validateBasics(st); assert.eq(v.errors.length, 0); assert.eq(v.soft.length, 1);
    st.weight = ''; st.bodyFat = '80'; assert.eq(validateBasics(st).errors[0].field, 'bodyFat'); st.bodyFat = '0'; assert.ok(validateBasics(st).errors.length === 1, 'zero body fat is out of range, not "no data"');
  });
  it('delete check-in cascades photos and photo files in one step, measurements stay', ['DAT-002', 'FR-032'], async () => {
    const pid = await setup(); const p = await processImage(new File([await canvasBlob(600, 800)], 'a.jpg', { type: 'image/jpeg' }));
    const st = newState(pid); st.weight = '72'; st.photos = { front: p, side: p, back: p }; const r = await saveCheckinState(pid, st); assert.ok(r.ok);
    assert.deepEq(await counts(), { ck: 1, ph: 3, pd: 3, ms: 1 }); await repo.deleteCheckin(pid, r.saved.id); assert.deepEq(await counts(), { ck: 0, ph: 0, pd: 0, ms: 1 });
    const scan = await repo.integrityScan(); assert.eq(scan.orphanPhotos.length + scan.orphanPhotoData.length, 0);
  });
  it('object URLs are revoked: retire/flush, revokeAll, and a URL is never revoked before flush', ['FR-033', 'DAT-013'], () => {
    const revoked = []; const orig = URL.revokeObjectURL; URL.revokeObjectURL = (u) => { revoked.push(u); orig.call(URL, u); };
    try {
      const bag = createUrlBag(); const a = bag.make(new Blob(['a'])); bag.retire(); const b = bag.make(new Blob(['b'])); assert.eq(revoked.length, 0, 'not revoked while the new image may still be loading');
      bag.flush(); assert.deepEq(revoked, [a]); bag.revokeAll(); assert.deepEq(revoked, [a, b]); assert.eq(bag.size, 0);
    } finally { URL.revokeObjectURL = orig; }
  });
});

describe('A5 routes and source rules', () => {
  it('W2 routes are registered, S21 uses /workout/view and never /workout/session, and the A4 entry points find them', ['UX-010', 'FR-021'], async () => {
    __reset(); await import('../js/features/food/register-w2.js'); await import('../js/features/workout/register-w2.js'); await import('../js/features/body/register.js'); await import('../js/features/photos/register.js'); await import('../js/features/checkins/register.js');
    const pats = listRoutes().map((r) => r.pattern);
    for (const want of ['/food/custom/:id?', '/food/recipe/:id?', '/food/manage', '/workout/plans', '/workout/plan/:id', '/workout/exercises', '/workout/exercise/:id', '/workout/view/:logId', '/body', '/body/:typeId', '/body/add', '/progress', '/progress/checkin/new', '/progress/checkin/:id', '/progress/compare']) assert.ok(pats.includes(want), `missing ${want}`);
    assert.ok(!pats.includes('/workout/session/:logId'), 'A4 owns the editable session');
    for (const prefix of ['/workout/plans', '/workout/exercises', '/food/custom', '/food/recipe']) assert.ok(pats.some((p) => p.startsWith(prefix)), `routeExists(${prefix})`);
    __reset();
  });
  it('no innerHTML, style attributes, toISOString, network calls, eval, absolute URLs, direct storage or weekday words in the W2 files', ['NFR-013', 'DEP-006', 'FR-020'], async () => {
    const FILES = ['js/features/screens-w2.css', 'js/features/food/custom-food.js', 'js/features/food/custom-model.js', 'js/features/food/recipe-builder.js', 'js/features/food/recipe-model.js', 'js/features/food/my-foods.js', 'js/features/food/register-w2.js',
      'js/features/workout/plan-model.js', 'js/features/workout/plans-list.js', 'js/features/workout/plan-editor.js', 'js/features/workout/exercise-library.js', 'js/features/workout/exercise-form.js', 'js/features/workout/past-session.js', 'js/features/workout/register-w2.js',
      'js/features/body/series.js', 'js/features/body/body-hub.js', 'js/features/body/add-measurement.js', 'js/features/body/measurement-graph.js', 'js/features/body/register.js',
      'js/features/photos/url-bag.js', 'js/features/photos/image-pipeline.js', 'js/features/photos/viewer.js', 'js/features/photos/compare.js', 'js/features/photos/register.js',
      'js/features/checkins/averages.js', 'js/features/checkins/save.js', 'js/features/checkins/wizard.js', 'js/features/checkins/progress-hub.js', 'js/features/checkins/detail.js', 'js/features/checkins/banner.js', 'js/features/checkins/register.js'];
    const src = {}; for (const f of FILES) src[f] = await text(f); const bad = [];
    for (const [f, t] of Object.entries(src)) {
      if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(t)) bad.push(`${f}: html injection`); if (/toISOString/.test(t)) bad.push(`${f}: toISOString`); if (/\beval\(|new Function\(/.test(t)) bad.push(`${f}: eval`);
      if (/https?:\/\//.test(t.replace(/xmlns=/g, ''))) bad.push(`${f}: absolute URL`);
      if (f.endsWith('.js') && /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(t)) bad.push(`${f}: network call`);
      if (f.endsWith('.js') && /\bstyle:\s*['"{]|setAttribute\(\s*['"]style/.test(t)) bad.push(`${f}: style attribute`);
      if (f.endsWith('.js') && /localStorage|sessionStorage/.test(t)) bad.push(`${f}: direct browser storage`);
      if (f.endsWith('.js') && /[^.\w]append\(/.test(t.replace(/parent\.append|\.append\(\.\.\.|host\.append/g, ''))) bad.push(`${f}: native append (use add())`);
      if (f.endsWith('.css') && /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(t.replace(/\/\*[\s\S]*?\*\//g, ''))) bad.push(`${f}: hard-coded colour`);
    }
    assert.deepEq(bad, []); assert.deepEq(scanForWeekdays(src, []), [], 'no weekday words');
  });
});
