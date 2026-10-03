// Core data-layer tests (A1). Each test lists the requirement IDs it covers.
import { describe, it, assert, scanForWeekdays } from './harness.js';
import * as db from '../js/core/db.js';
import * as repo from '../js/core/repo.js';
import * as C from '../js/core/calc.js';
import * as V from '../js/core/validate.js';
import * as D from '../js/core/dates.js';
import * as U from '../js/core/units.js';
import * as M from '../js/core/migrate.js';
import * as SH from '../js/core/storage-health.js';
import * as seed from '../js/core/seed.js';
import { createStore } from '../js/core/store.js';

SH.setStoragePrefix('winter-arc-test:');
try { for (const k of Object.keys(localStorage)) if (k.startsWith('winter-arc-test:')) localStorage.removeItem(k); sessionStorage.clear(); } catch { /* ignore */ }
let n = 0;
async function fresh() { await db.closeDb(); db.openDb(`winter-arc-test-${Date.now()}-${n++}`); await repo.initRepo(); M.safeModeSignal.active = false; M.clearTestSteps(); return null; }
const fetchText = async (p) => { const r = await fetch(p); if (!r.ok) throw new Error('fetch ' + p); return r.text(); };
const hard = (r) => r.hard.map((h) => h.code);
const soft = (r) => r.soft.map((h) => h.code);

const RICE = { kind: 'food', name: 'Test Rice', category: 'grain-rice', cuisine: 'indian', origin: 'home', source: { type: 'user' }, confidence: 'typical', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }, servings: [{ id: 's1', label: '1 cup (160 g)', unit: 'cup', baseAmount: 160 }, { id: 's2', label: '1 bowl (200 g)', unit: 'bowl', baseAmount: 200 }], defaultServingId: 's1' };
const EXK = { basis: 'per_rep', value: 0.45, refWeightKg: 70, scaleByWeight: true };
const mkItem = (itemId, exId, name, kind, target, kcal = EXK, extra = {}) => ({ itemId, exerciseId: exId, exerciseName: name, targetKind: kind, target, targetMax: null, perSide: false, altExerciseIds: [], kcalOverride: null, kcalSnap: kcal, note: null, ...extra });
const mkEx = (name, extra = {}) => ({ name, category: 'strength', muscleGroups: ['chest'], type: 'bodyweight', targetKind: 'reps', defaultTarget: 10, perSide: false, kcal: EXK, difficulty: 'beginner', ...extra });

describe('completion percentage', () => {
  it('7/10=70, 20/30=67, 22/30=73', ['FR-022', 'DoD-11'], () => {
    assert.eq(C.completionPct(7, 10, null), 70); assert.eq(C.completionPct(20, 30, null), 67); assert.eq(C.completionPct(22, 30, null), 73);
  });
  it('caps at 100, zero actual is 0, null actual is no data', ['FR-022', 'DAT-009'], () => {
    assert.eq(C.completionPct(15, 10, null), 100); assert.eq(C.completionPct(0, 10, null), 0); assert.eq(C.completionPct(null, 10, null), null);
  });
  it('manual 0 and 100 accepted; -1, 101, 50.5 rejected', ['FR-022'], async () => {
    assert.eq(C.completionPct(null, 10, 0), 0); assert.eq(C.completionPct(3, 10, 100), 100);
    for (const bad of [-1, 101, 50.5]) { await assert.throws(() => C.completionPct(5, 10, bad)); assert.ok(!V.checkManualPct(bad).ok); }
    assert.ok(V.checkManualPct(0).ok && V.checkManualPct(100).ok);
  });
  it('session completion per D-071', ['FR-022', 'D-071'], () => {
    assert.eq(C.sessionCompletion([{ actual: 10, pct: 100 }, { actual: null, manualPct: null, pct: null }]), 50);
    assert.eq(C.sessionCompletion([{ actual: null, manualPct: null }, { actual: null, manualPct: null }]), null);
    assert.eq(C.sessionCompletion([]), null);
    assert.eq(C.sessionCompletion([{ manualPct: 40, pct: 40 }, { actual: 0, pct: 0 }]), 20);
  });
});

describe('calories estimate', () => {
  const base = (over = {}) => ({ targetKind: 'reps', target: 10, perSide: false, kcalBasis: { basis: 'per_rep', value: 0.5, refWeightKg: 70, scaleByWeight: true }, ...over });
  it('basic, perSide x2, weight scaling', ['FR-023'], () => {
    assert.eq(C.kcalEstimate(base(), 10, 70), 5);
    assert.eq(C.kcalEstimate(base({ perSide: true }), 10, 70), 10);
    assert.eq(C.kcalEstimate(base(), 10, 80), 5.7);
    assert.eq(C.kcalEstimate(base({ kcalBasis: { basis: 'per_rep', value: 0.5, refWeightKg: 70, scaleByWeight: false } }), 10, 80), 5);
  });
  it('override order: log override > item override > estimate', ['FR-023'], () => {
    const it = base({ kcalOverride: { basis: 'per_rep', value: 1 } });
    assert.eq(C.kcalEstimate(it, 10, 80), 10);
    assert.eq(C.finalKcal(it, 10, 80, 42), 42); assert.eq(C.finalKcal(it, 10, 80, 0), 0); assert.eq(C.finalKcal(it, 10, 80, null), 10);
  });
  it('units: actual, or target x pct when only manual pct; minutes/seconds/km conversion', ['FR-023'], () => {
    assert.eq(C.itemUnits(base({ actual: 7 })), 7); assert.eq(C.itemUnits(base({ manualPct: 50 })), 5); assert.eq(C.itemUnits(base()), null);
    const plank = { targetKind: 'seconds', target: 30, kcalBasis: { basis: 'per_minute', value: 4, refWeightKg: 70, scaleByWeight: false }, actual: 30 };
    assert.eq(C.computeItem(plank, 70).kcalEst, 2);
    const run = { targetKind: 'minutes', target: 20, kcalBasis: { basis: 'per_minute', value: 10, refWeightKg: 70, scaleByWeight: true }, actual: 22 };
    assert.eq(C.computeItem(run, 70).kcalEst, 220); assert.eq(C.computeItem(run, 70).pct, 110 > 100 ? 100 : 0);
    const man = C.computeItem(base({ manualPct: 50 }), 70); assert.eq(man.pct, 50); assert.eq(man.kcalEst, 2.5); assert.eq(man.pctSource, 'manual');
  });
  it('body weight rule Q-007', ['FR-023', 'Q-007'], () => {
    const ms = [{ typeId: 'mt:weight', date: '2025-01-01', value: 80, createdAt: 1 }, { typeId: 'mt:weight', date: '2025-03-01', value: 78, createdAt: 2 }, { typeId: 'mt:waist', date: '2025-03-02', value: 90 }];
    assert.deepEq(C.bodyWeightFor('2025-02-01', ms), { kg: 80, source: 'on-or-before', date: '2025-01-01', stale: false });
    assert.eq(C.bodyWeightFor('2025-03-01', ms).kg, 78); assert.eq(C.bodyWeightFor('2025-06-30', ms).stale, true);
    assert.deepEq(C.bodyWeightFor('2024-01-01', ms).source, 'latest'); assert.eq(C.bodyWeightFor('2024-01-01', ms).kg, 78);
    assert.deepEq(C.bodyWeightFor('2025-01-01', []), { kg: 70, source: 'default', date: null, stale: false });
  });
});

describe('food math', () => {
  it('rounding to 0.1 and cup/bowl documented examples', ['FR-012', 'FR-005'], () => {
    const rice = { id: 'f:rice', name: 'Rice', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 } };
    const cup = { id: 's1', label: '1 cup (160 g)', unit: 'cup', baseAmount: 160 };
    const p = C.servingNutrition(rice, cup); assert.near(p.kcal, 208); assert.near(p.protein, 4.32, 1e-6);
    const snap = C.foodLogSnapshot(rice, cup, 1.5, { id: 'meal:lunch', label: 'Lunch' });
    assert.eq(snap.totals.kcal, 312); assert.eq(snap.totals.protein, 6.5); assert.eq(snap.per1serving.kcal, 208);
    const implicit = C.foodLogSnapshot(rice, null, 150, {}); assert.eq(implicit.totals.kcal, 195); assert.eq(implicit.servingUnit, 'g');
    const dal = { id: 'f:dal', name: 'Dal', nutrition: { per: { amount: 100, unit: 'ml' }, kcal: 90, protein: 6, carbs: 12, fat: 2, fiber: null } };
    const bowl = C.foodLogSnapshot(dal, { id: 's1', label: '1 bowl', unit: 'bowl', baseAmount: 200 }, 1, {}); assert.eq(bowl.totals.kcal, 180); assert.eq(bowl.totals.fiber, null);
    const egg = { id: 'f:egg', name: 'Egg', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0 } };
    assert.eq(C.foodLogSnapshot(egg, { id: 's1', label: '1 piece', unit: 'piece', baseAmount: 50 }, 2, {}).totals.kcal, 155);
    assert.eq(C.implicitServing({ nutrition: { per: { amount: 1, unit: 'serving' } } }), null);
  });
  it('recipe per-serving equals totals/servings before rounding; fiber null; confidence', ['FR-014', 'DoD-06'], () => {
    const ing = [{ nutrition: { kcal: 208, protein: 4.32, carbs: 44.8, fat: 0.48, fiber: 0.64 }, confidence: 'typical' }, { nutrition: { kcal: 165.5, protein: 31.1, carbs: 0, fat: 3.6, fiber: 0 }, confidence: 'typical' }, { nutrition: { kcal: 120, protein: 0, carbs: 0, fat: 13.3, fiber: 0 }, confidence: 'verified' }];
    const r = C.recipeTotals(ing, 3);
    assert.near(r.totals.kcal, 493.5, 1e-9); assert.near(r.perServing.kcal, 493.5 / 3, 1e-12); assert.near(r.perServing.protein, (4.32 + 31.1) / 3, 1e-12);
    assert.eq(r.confidence, 'typical'); assert.eq(r.fiberKnown, true);
    const r2 = C.recipeTotals([...ing, { nutrition: { kcal: 10, protein: 0, carbs: 2, fat: 0, fiber: null }, confidence: 'estimate' }], 4);
    assert.eq(r2.perServing.fiber, null); assert.eq(r2.confidence, 'estimate');
    assert.eq(C.recipeTotals(ing.slice(2), 1).confidence, 'verified');
  });
  it('dayTotals: no logs = null not 0; fiber partial flag; per meal', ['DAT-009', 'FR-008'], () => {
    const e = C.dayTotals([]); assert.eq(e.kcal, null); assert.eq(e.count, 0);
    const logs = [{ mealId: 'meal:lunch', mealLabel: 'Lunch', totals: { kcal: 300, protein: 10, carbs: 30, fat: 10, fiber: 2 } }, { mealId: 'meal:lunch', mealLabel: 'Lunch', totals: { kcal: 100.04, protein: 1, carbs: 1, fat: 1, fiber: null } }, { mealId: 'meal:dinner', mealLabel: 'Dinner', totals: { kcal: 50, protein: 0, carbs: 0, fat: 0, fiber: null } }];
    const t = C.dayTotals(logs); assert.eq(t.kcal, 450); assert.eq(t.fiber, 2); assert.eq(t.fiberPartial, true); assert.eq(t.byMeal['meal:lunch'].kcal, 400); assert.eq(t.byMeal['meal:dinner'].fiber, null);
  });
  it('averages skip no-data days; 0 is data', ['DAT-009'], () => {
    assert.deepEq(C.averagesOverDaysWithData([null, 0, 100, undefined]), { avg: 50, n: 2, N: 4 });
    assert.deepEq(C.averagesOverDaysWithData([null, null]), { avg: null, n: 0, N: 2 });
  });
  it('water, steps, sleep derived', ['FR-025', 'FR-024', 'FR-027'], () => {
    assert.deepEq(C.waterDerived(5, 500, 3000), { glasses: 5, ml: 2500, litres: 2.5, pct: 83 });
    assert.deepEq(C.waterDerived(null, 500, 3000), { glasses: null, ml: null, litres: null, pct: null });
    assert.eq(C.stepsPercent(5830, 7000), 83); assert.eq(C.stepsPercent(null, 7000), null); assert.eq(C.stepsPercent(0, 7000), 0);
    assert.eq(C.sleepDuration('2025-03-09T23:15', '2025-03-10T06:40'), 445); assert.eq(U.fmtDuration(445), '7h 25m');
    assert.eq(U.fmtDuration(null), U.DASH); assert.eq(U.fmtNum(null), U.DASH); assert.eq(U.fmtPct(null), U.DASH); assert.eq(U.fmtNum(0), '0');
  });
  it('plan helpers: duplicate and reorder', ['FR-021'], () => {
    let i = 0; const idFn = (t) => `${t}_${i++}`;
    const plan = { id: 'plan:x', pid: 'p', name: 'Upper', rev: 5, stepGoal: 7000, items: [{ itemId: 'a' }, { itemId: 'b' }, { itemId: 'c' }] };
    const d = C.duplicatePlan(plan, idFn); assert.eq(d.name, 'Upper (copy)'); assert.eq(d.rev, 1); assert.ok(d.id !== plan.id); assert.ok(d.items[0].itemId !== 'a'); assert.eq(plan.items[0].itemId, 'a');
    assert.deepEq(C.reorderItems(plan.items, 0, 2).map((x) => x.itemId), ['b', 'c', 'a']); assert.deepEq(C.moveItem(plan.items, 2, -1).map((x) => x.itemId), ['a', 'c', 'b']);
    assert.deepEq(C.reorderItems(plan.items, 0, 9).map((x) => x.itemId), ['a', 'b', 'c']);
  });
});

describe('targets and dates', () => {
  it('effective-dated targets', ['FR-016', 'DAT-030'], () => {
    const h = [{ from: '2025-03-01', kcal: 2000 }, { from: '2025-01-01', kcal: 1800 }, { from: '2025-06-01', kcal: 2200 }];
    assert.eq(C.resolveTargets(h, '2024-12-31').kcal, 1800); assert.eq(C.resolveTargets(h, '2025-01-01').kcal, 1800); assert.eq(C.resolveTargets(h, '2025-02-28').kcal, 1800);
    assert.eq(C.resolveTargets(h, '2025-03-01').kcal, 2000); assert.eq(C.resolveTargets(h, '2025-07-01').kcal, 2200); assert.eq(C.resolveTargets(h, '2099-01-01').kcal, 2200); assert.eq(C.resolveTargets([], '2025-01-01'), null);
  });
  it('local keys, add/range, validity, allowed range', ['D-030', 'DAT-008'], () => {
    assert.eq(D.toKey(new Date(2025, 2, 9, 23, 59, 59)), '2025-03-09'); assert.eq(D.toKey(new Date(2025, 0, 1, 0, 0, 0)), '2025-01-01');
    assert.eq(D.addDays('2025-03-09', 1), '2025-03-10'); assert.eq(D.addDays('2025-03-01', -1), '2025-02-28'); assert.eq(D.addDays('2024-02-28', 1), '2024-02-29');
    assert.deepEq(D.rangeKeys('2025-02-27', '2025-03-02'), ['2025-02-27', '2025-02-28', '2025-03-01', '2025-03-02']); assert.deepEq(D.rangeKeys('2025-03-02', '2025-03-01'), []);
    assert.ok(D.isValidKey('2024-02-29')); assert.ok(!D.isValidKey('2025-02-29')); assert.ok(!D.isValidKey('2025-13-01')); assert.ok(!D.isValidKey('2025-1-1')); assert.ok(!D.isValidKey(null));
    const now = new Date(2025, 5, 15, 10); assert.eq(D.clampToAllowedRange('1990-01-01', now), '2000-01-01'); assert.eq(D.clampToAllowedRange('2030-01-01', now), '2025-06-16'); assert.eq(D.clampToAllowedRange('2025-06-10', now), '2025-06-10');
    assert.eq(D.daysBetween('2025-03-01', '2025-03-31'), 30);
  });
  it('week start mon/sun/sat', ['D-030', 'Q-011'], () => {
    assert.eq(D.weekStart('2025-03-12', 'mon'), '2025-03-10'); assert.eq(D.weekStart('2025-03-12', 'sun'), '2025-03-09'); assert.eq(D.weekStart('2025-03-12', 'sat'), '2025-03-08');
    assert.eq(D.weekStart('2025-03-10', 'mon'), '2025-03-10'); assert.eq(D.weekStart('2025-03-09', 'mon'), '2025-03-03'); assert.eq(D.weeksBetween('2025-03-03', '2025-03-17', 'mon'), 2);
  });
  it('sleep wake-date rule: bed 23:15 wake 06:40 = 7h 25m on wake date', ['FR-027', 'Q-013'], () => {
    const d = D.durationFromTimes('2025-03-10', '23:15', '06:40'); assert.eq(d.bedAt, '2025-03-09T23:15'); assert.eq(d.wakeAt, '2025-03-10T06:40'); assert.eq(d.durationMin, 445);
    const e = D.durationFromTimes('2025-03-10', '01:00', '07:00'); assert.eq(e.bedAt, '2025-03-10T01:00'); assert.eq(e.durationMin, 360);
    assert.eq(D.durationFromTimes('2025-03-10', '06:40', '06:40').valid, false); assert.eq(D.minutesBetween('2025-03-09T23:15', '2025-03-10T06:40'), 445); assert.eq(D.minutesBetween('bad', '2025-03-10T06:40'), null);
  });
});

describe('validator', () => {
  const tableRange = (label, fn, cases) => it(`${label} boundaries`, ['DAT-008', 'DAT-027'], () => {
    for (const [v, h, s] of cases) { const r = fn(v); assert.deepEq([hard(r), soft(r)], [h, s], `${label}(${v})`); }
  });
  tableRange('weight', V.checkWeight, [[19.99, ['M_WEIGHT_RANGE'], []], [20, [], ['M_WEIGHT_UNUSUAL(SOFT)']], [34.9, [], ['M_WEIGHT_UNUSUAL(SOFT)']], [35, [], []], [200, [], []], [200.1, [], ['M_WEIGHT_UNUSUAL(SOFT)']], [400, [], ['M_WEIGHT_UNUSUAL(SOFT)']], [400.1, ['M_WEIGHT_RANGE'], []], ['72,5', [], []], ['abc', ['V_NOT_NUMBER'], []], ['', ['V_REQUIRED'], []], [-5, ['M_WEIGHT_RANGE'], []]]);
  tableRange('height', V.checkHeight, [[49.9, ['M_HEIGHT_RANGE'], []], [50, [], ['M_HEIGHT_UNUSUAL(SOFT)']], [119, [], ['M_HEIGHT_UNUSUAL(SOFT)']], [120, [], []], [220, [], []], [221, [], ['M_HEIGHT_UNUSUAL(SOFT)']], [250, [], ['M_HEIGHT_UNUSUAL(SOFT)']], [250.1, ['M_HEIGHT_RANGE'], []]]);
  tableRange('body fat', V.checkBodyFat, [[1.9, ['M_BF_RANGE'], []], [2, [], ['M_BF_UNUSUAL(SOFT)']], [4.9, [], ['M_BF_UNUSUAL(SOFT)']], [5, [], []], [50, [], []], [50.1, [], ['M_BF_UNUSUAL(SOFT)']], [70, [], ['M_BF_UNUSUAL(SOFT)']], [70.1, ['M_BF_RANGE'], []]]);
  it('other measurement ranges', ['DAT-008', 'FR-029'], () => {
    const t = [['mt:biceps', 10, 80, 'M_BICEPS_RANGE'], ['mt:thigh', 20, 120, 'M_THIGH_RANGE'], ['mt:waist', 30, 250, 'M_WAIST_RANGE'], ['mt:chest', 40, 250, 'V_RANGE'], ['mt:hips', 40, 250, 'V_RANGE'], ['mt:neck', 15, 80, 'V_RANGE'], ['mt:calf', 15, 80, 'V_RANGE']];
    for (const [id, lo, hi, code] of t) { assert.ok(V.checkMeasurement(id, lo).ok, id + ' lo'); assert.ok(V.checkMeasurement(id, hi).ok, id + ' hi'); assert.deepEq(hard(V.checkMeasurement(id, lo - 0.1)), [code]); assert.deepEq(hard(V.checkMeasurement(id, hi + 0.1)), [code]); }
    assert.ok(!V.checkMeasurement('mt:unknown', 5).ok);
  });
  it('food quantity and amount', ['DAT-008', 'FR-012'], () => {
    assert.deepEq(hard(V.checkFoodQty(0)), ['F_QTY_RANGE']); assert.ok(V.checkFoodQty(0.01).ok); assert.deepEq(soft(V.checkFoodQty(20)), []); assert.deepEq(soft(V.checkFoodQty(20.5)), ['F_QTY_UNUSUAL(SOFT)']);
    assert.ok(V.checkFoodQty(50).ok); assert.deepEq(hard(V.checkFoodQty(50.1)), ['F_QTY_RANGE']); assert.deepEq(hard(V.checkFoodQty(1, 5001)), ['F_AMOUNT_TOO_BIG']); assert.ok(V.checkFoodQty(50, 100).ok); assert.deepEq(hard(V.checkFoodQty(50, 101)), ['F_AMOUNT_TOO_BIG']);
    assert.deepEq(soft(V.checkFoodQty(1, 100, 3000)), []); assert.deepEq(soft(V.checkFoodQty(1, 100, 3000.1)), ['F_KCAL_UNUSUAL(SOFT)']); assert.deepEq(hard(V.checkFoodQty(-1)), ['F_QTY_RANGE']);
  });
  it('custom food per 100 nutrition', ['DAT-008', 'FR-013'], () => {
    const n = (o) => ({ per: { amount: 100, unit: 'g' }, kcal: 100, protein: 5, carbs: 15, fat: 3, fiber: 1, ...o });
    assert.ok(V.checkFoodNutrition(n({})).ok); assert.deepEq(hard(V.checkFoodNutrition(n({ kcal: 950.1 }))), ['F_KCAL_RANGE100']); assert.deepEq(hard(V.checkFoodNutrition(n({ kcal: -1 }))), ['F_KCAL_RANGE100']);
    assert.ok(V.checkFoodNutrition(n({ kcal: 950, protein: 0, carbs: 0, fat: 100, fiber: 0 })).ok); assert.deepEq(hard(V.checkFoodNutrition(n({ protein: 100.1, carbs: 0, fat: 0, fiber: 0, kcal: 400 }))), ['F_MACRO_RANGE100']);
    assert.ok(V.checkFoodNutrition(n({ protein: 50, carbs: 50, fat: 5, fiber: 0, kcal: 445 })).ok); assert.deepEq(hard(V.checkFoodNutrition(n({ protein: 50, carbs: 50, fat: 5.1, fiber: 0, kcal: 446 }))), ['F_MACRO_SUM']);
    assert.deepEq(soft(V.checkFoodNutrition(n({ kcal: 300 }))), ['F_ATWATER(SOFT)']); assert.deepEq(soft(V.checkFoodNutrition(n({ kcal: 131 }))), []); assert.deepEq(soft(V.checkFoodNutrition(n({ fiber: 16 }))), ['F_FIBER_GT_CARBS(SOFT)']);
    const s = (o) => ({ per: { amount: 1, unit: 'serving' }, kcal: 200, protein: 10, carbs: 20, fat: 5, fiber: 2, ...o });
    assert.deepEq(hard(V.checkFoodNutrition(s({ kcal: 5001 }))), ['F_SERVING_BASIS_RANGE']); assert.deepEq(hard(V.checkFoodNutrition(s({ fiber: 301 }))), ['F_SERVING_BASIS_RANGE']);
    assert.ok(V.checkFoodNutrition(n({ fiber: null })).ok);
  });
  it('serving and recipe rules', ['DAT-008', 'FR-012', 'FR-014'], () => {
    assert.ok(V.checkServing({ label: '1 bowl (200 g)', unit: 'bowl', baseAmount: 200 }).ok); assert.deepEq(hard(V.checkServing({ label: '1 bowl', unit: 'bowl', baseAmount: 0 })), ['F_SERVING_BASE']);
    assert.ok(V.checkServing({ label: '1 bowl', unit: 'bowl', baseAmount: 5000 }).ok); assert.deepEq(hard(V.checkServing({ label: '1 bowl', unit: 'bowl', baseAmount: 5001 })), ['F_SERVING_BASE']); assert.deepEq(hard(V.checkServing({ label: 'big', unit: 'bowl', baseAmount: 100 })), ['F_SERVING_LABEL']);
    const ing = (k) => Array.from({ length: k }, () => ({ foodRef: 'f:x' }));
    for (const [sv, k, h] of [[0.25, 1, []], [100, 60, []], [0.24, 1, ['R_SERVINGS_RANGE']], [100.1, 1, ['R_SERVINGS_RANGE']], [2, 0, ['R_INGREDIENTS']], [2, 61, ['R_INGREDIENTS']]]) assert.deepEq(hard(V.checkRecipe({ servings: sv, ingredients: ing(k) })), h, `${sv}/${k}`);
    assert.deepEq(hard(V.checkRecipe({ servings: 2, ingredients: [{ kind: 'recipe' }] })), ['R_NESTED']);
  });
  it('water, steps, goal', ['DAT-008', 'FR-024', 'FR-025'], () => {
    for (const [v, h, s] of [[0, [], []], [40, [], ['W_GLASS_UNUSUAL(SOFT)']], [40.5, ['W_GLASS_RANGE'], []], [0.25, ['W_GLASS_RANGE'], []], [-0.5, ['W_GLASS_RANGE'], []], [12, [], []], [12.5, [], ['W_GLASS_UNUSUAL(SOFT)']], ['2,5', [], []]]) { const r = V.checkWater(v); assert.deepEq([hard(r), soft(r)], [h, s], 'water ' + v); }
    assert.eq(V.checkWater('').value, null);
    for (const [v, h, s] of [[0, [], []], [150000, [], ['S_STEPS_UNUSUAL(SOFT)']], [150001, ['S_STEPS_RANGE'], []], [1.5, ['S_STEPS_RANGE'], []], [-1, ['S_STEPS_RANGE'], []], [60000, [], []], [60001, [], ['S_STEPS_UNUSUAL(SOFT)']]]) { const r = V.checkSteps(v); assert.deepEq([hard(r), soft(r)], [h, s], 'steps ' + v); }
    for (const [v, h] of [[999, ['S_GOAL_RANGE']], [1000, []], [100000, []], [100001, ['S_GOAL_RANGE']], [7000.5, ['S_GOAL_RANGE']]]) assert.deepEq(hard(V.checkStepGoal(v)), h);
  });
  it('sleep', ['DAT-008', 'FR-027'], () => {
    for (const [d, h, s] of [[0, ['SL_DURATION_RANGE'], []], [1, [], []], [840, [], []], [841, [], ['SL_DURATION_UNUSUAL(SOFT)']], [1200, [], ['SL_DURATION_UNUSUAL(SOFT)']], [1201, ['SL_DURATION_RANGE'], []]]) { const r = V.checkSleep({ durationMin: d }); assert.deepEq([hard(r), soft(r)], [h, s], 'sleep ' + d); }
    assert.ok(V.checkSleep({ durationMin: 400, napMin: 0 }).ok && V.checkSleep({ durationMin: 400, napMin: 600 }).ok); assert.deepEq(hard(V.checkSleep({ durationMin: 400, napMin: 601 })), ['SL_NAP_RANGE']);
    for (const [q, h] of [[0, ['SL_QUALITY']], [1, []], [5, []], [6, ['SL_QUALITY']], [2.5, ['SL_QUALITY']]]) assert.deepEq(hard(V.checkSleep({ durationMin: 400, quality: q })), h);
    assert.deepEq(hard(V.checkSleep({ bedAt: '2025-03-10T07:00', wakeAt: '2025-03-10T06:00', durationMin: 10 })), ['SL_ORDER']);
  });
  it('actuals, kcal override, targets, dates, notes, photos', ['DAT-008', 'FR-022', 'FR-023', 'FR-016'], () => {
    const A = (k, v) => V.checkActual(k, v);
    for (const [k, v, h, s] of [['reps', 0, [], []], ['reps', 1000, [], []], ['reps', 1001, [], ['X_REPS_UNUSUAL(SOFT)']], ['reps', 10000, [], ['X_REPS_UNUSUAL(SOFT)']], ['reps', 10001, ['X_ACTUAL_RANGE'], []], ['reps', 7.5, ['X_ACTUAL_RANGE'], []], ['seconds', 36000, [], []], ['seconds', 36001, ['X_ACTUAL_RANGE'], []], ['minutes', 1440, [], []], ['minutes', 1441, ['X_ACTUAL_RANGE'], []], ['meters', 500000, [], []], ['meters', 500001, ['X_ACTUAL_RANGE'], []], ['reps', -1, ['X_ACTUAL_RANGE'], []]]) { const r = A(k, v); assert.deepEq([hard(r), soft(r)], [h, s], `${k} ${v}`); }
    assert.eq(A('reps', '').value, null);
    for (const [v, h] of [[0, []], [5000, []], [5001, ['X_KCAL_RANGE']], [-1, ['X_KCAL_RANGE']]]) assert.deepEq(hard(V.checkKcalOverride(v)), h);
    const T = { kcal: [500, 10000, 'T_KCAL'], protein: [0, 500, 'T_PROTEIN'], carbs: [0, 1000, 'T_CARBS'], fat: [0, 500, 'T_FAT'], fiber: [0, 200, 'T_FIBER'], waterMl: [250, 20000, 'T_WATER'], steps: [1000, 100000, 'T_STEPS'] };
    for (const [k, [lo, hi, code]] of Object.entries(T)) { assert.ok(V.checkTargets({ [k]: lo }).ok && V.checkTargets({ [k]: hi }).ok, k); assert.deepEq(hard(V.checkTargets({ [k]: lo - 1 })), [code]); assert.deepEq(hard(V.checkTargets({ [k]: hi + 1 })), [code]); }
    const now = new Date(2025, 5, 15); assert.deepEq(hard(V.checkDate('1999-12-31', now)), ['V_DATE_RANGE']); assert.ok(V.checkDate('2000-01-01', now).ok); assert.ok(V.checkDate('2025-06-16', now).ok); assert.deepEq(hard(V.checkDate('2025-06-17', now)), ['V_DATE_RANGE']); assert.deepEq(hard(V.checkDate('2025-02-30', now)), ['V_DATE_INVALID']);
    assert.ok(V.checkTime('23:15').ok); assert.deepEq(hard(V.checkTime('24:00')), ['V_TIME_INVALID']); assert.deepEq(hard(V.checkTime('7:5')), ['V_TIME_INVALID']);
    assert.ok(V.checkDayNote({ text: 'x'.repeat(2000), tags: [1, 2, 3, 4, 5] }).ok); assert.deepEq(hard(V.checkDayNote({ text: 'x'.repeat(2001) })), ['N_NOTE_LONG']); assert.deepEq(hard(V.checkDayNote({ tags: [1, 2, 3, 4, 5, 6] })), ['N_TAGS']);
    assert.ok(V.checkCheckinPhotos([{ slot: 'front' }, { slot: 'side' }, { slot: 'back' }, { slot: 'flexed' }]).ok); assert.deepEq(hard(V.checkCheckinPhotos([{ slot: 'front' }, { slot: 'front' }])), ['C_PHOTO_COUNT']); assert.deepEq(hard(V.checkCheckinPhotos([{ slot: 'front' }, { slot: 'side' }, { slot: 'back' }, { slot: 'flexed' }, { slot: 'front' }])), ['C_PHOTO_COUNT']);
    assert.deepEq(hard(V.checkName('', 80)), ['V_NAME_EMPTY']); assert.ok(V.checkName('a'.repeat(80), 80).ok); assert.deepEq(hard(V.checkName('a'.repeat(81), 80)), ['V_NAME_EMPTY']); assert.deepEq(hard(V.checkName('x'.repeat(61), 60, 'P_NAME')), ['P_NAME']);
  });
  it('decimal comma and trimming', ['DAT-008'], () => {
    assert.eq(V.num('1,5'), 1.5); assert.eq(V.num(' 72,25 '), 72.25); assert.eq(V.num('1,234'), 1.234); assert.eq(V.num(''), null); assert.eq(V.num(null), null); assert.ok(Number.isNaN(V.num('x'))); assert.eq(V.num(7), 7); assert.eq(V.cleanText('  a   b '), 'a b');
  });
  it('catalog text and params', ['DAT-027', 'UX-017'], () => {
    assert.eq(V.msg('M_WEIGHT_RANGE'), 'Weight must be between 20 and 400 kg.'); assert.eq(V.msg('M_WEIGHT_UNUSUAL(SOFT)', { value: 19 }), 'This looks unusual: 19 kg. Save anyway?');
    assert.eq(V.msg('F_MACRO_SUM'), 'Protein + carbs + fat cannot add up to more than 105 per 100 g or ml.'); assert.eq(V.msg('SL_ORDER'), 'Wake time must be after bed time.');
    assert.eq(V.msg('I_INVALID_RECORDS', { n: 3 }), '3 items in this backup are not valid. Skip them or cancel.'); assert.eq(V.msg('I_NEWER'), 'This backup was made by a newer Winter Arc. Update the app first.');
    assert.eq(V.checkWeight(10).hard[0].message, 'Weight must be between 20 and 400 kg.'); assert.eq(V.msg('V_RANGE', { field: 'Chest', min: 40, max: 250 }), 'Chest must be between 40 and 250.');
    assert.eq(Object.keys(V.CATALOG).length, 70);
  });
});

describe('store', () => {
  it('observable store', [], () => {
    const s = createStore({ a: 1 }); let calls = 0; const off = s.subscribe(() => calls++);
    s.set('a', 2); assert.eq(calls, 1); s.set('a', 2); assert.eq(calls, 1); s.batch(() => { s.set('a', 3); s.set('b', 1); }); assert.eq(calls, 2); off(); s.set('a', 9); assert.eq(calls, 2); assert.eq(s.get('a'), 9);
  });
});

describe('database', () => {
  it('tx atomicity: throw inside tx writes nothing', ['DAT-019', 'D-067'], async () => {
    await fresh();
    await assert.throws(() => db.tx(['profiles', 'foods'], 'readwrite', async (t) => { await t.store('profiles').put({ id: 'p_x', name: 'x' }); await t.store('foods').put({ id: 'fd_y', pid: 'p_x' }); throw new Error('boom'); }));
    assert.eq(await db.count('profiles'), 0); assert.eq(await db.count('foods'), 0);
    await db.tx(['profiles', 'foods'], 'readwrite', async (t) => { await t.store('profiles').put({ id: 'p_x', name: 'x' }); await t.store('foods').put({ id: 'fd_y', pid: 'p_x' }); });
    assert.eq(await db.count('profiles'), 1); assert.eq(await db.count('foods'), 1);
  });
  it('unique indexes enforce sleep [pid,date] and photo [checkinId,slot]', ['DAT-021', 'D-032'], async () => {
    await fresh();
    await db.put('sleepLogs', { id: 'sl_1', pid: 'p', date: '2025-01-01' });
    const e = await assert.throws(() => db.put('sleepLogs', { id: 'sl_2', pid: 'p', date: '2025-01-01' })); assert.ok(e);
    await db.put('photos', { id: 'ph_1', pid: 'p', checkinId: 'c', slot: 'front', date: '2025-01-01' });
    await assert.throws(() => db.put('photos', { id: 'ph_2', pid: 'p', checkinId: 'c', slot: 'front', date: '2025-01-01' }));
    assert.eq(await db.count('sleepLogs'), 1);
  });
  it('object stores match the spec list', ['DAT-001'], async () => {
    await fresh(); const d = await db.openDb();
    assert.deepEq([...d.objectStoreNames].sort(), ['checkins', 'days', 'exercises', 'foodLogs', 'foodPrefs', 'foods', 'measurementTypes', 'measurements', 'meta', 'photoData', 'photos', 'plans', 'profiles', 'settings', 'sleepLogs', 'workoutLogs']);
  });
  it('auto-reopen after the browser closes the connection', ['DAT-017', 'R-022'], async () => {
    await fresh(); const p = await repo.createProfile('Test A'); const raw = await db.openDb(); raw.close();
    const got = await repo.getProfile(p.id); assert.eq(got.name, 'Test A'); await repo.renameProfile(p.id, 'Test A2'); assert.eq((await repo.getProfile(p.id)).name, 'Test A2');
  });
  it('quota error maps to typed error', ['DAT-013'], () => { const e = new db.QuotaError(new Error('x')); assert.ok(e instanceof db.DbError); assert.eq(e.name, 'QuotaError'); });
});

describe('repo: profiles, pid isolation, null vs 0', () => {
  it('two profiles never see each other', ['FR-001', 'DAT-021'], async () => {
    await fresh(); const a = await repo.createProfile('Test A'); const b = await repo.createProfile('Test B');
    const fa = await repo.saveFood(a.id, RICE); await repo.addFoodLog(a.id, { date: '2025-03-10', food: fa, serving: fa.servings[0], qty: 1 });
    await repo.setWater(a.id, '2025-03-10', 4); await repo.setSteps(a.id, '2025-03-10', 5000); await repo.upsertSleep(a.id, '2025-03-10', { bed: '23:00', wake: '06:00' }); await repo.addMeasurement(a.id, { typeId: 'mt:weight', date: '2025-03-10', value: 70 });
    assert.eq((await repo.getFoodLogs(b.id, '2025-03-10')).length, 0); assert.eq(await repo.getDay(b.id, '2025-03-10'), null); assert.eq(await repo.getSleep(b.id, '2025-03-10'), null);
    assert.eq((await repo.listFoods(b.id)).length, 0); assert.eq((await repo.measurementSeries(b.id, 'mt:weight')).length, 0); assert.eq((await repo.listPrefs(b.id)).length, 0);
    assert.eq((await repo.getFoodLogs(a.id, '2025-03-10')).length, 1); assert.eq((await repo.listProfiles()).length, 2);
    await assert.throws(() => repo.getFood(b.id, fa.id)); const victim = (await repo.getFoodLogs(a.id, '2025-03-10'))[0].id; await assert.throws(() => repo.deleteFoodLog(b.id, victim));
    assert.eq((await repo.getFoodLogs(a.id, '2025-03-10')).length, 1);
    await repo.setWater(b.id, '2025-03-10', null); assert.eq((await repo.getDay(b.id, '2025-03-10')).water.glasses, null);
  });
  it('repo.js source: every getAll is pid-filtered or marked', ['DAT-021'], async () => {
    const src = await fetchText('../js/core/repo.js');
    const withOpts = src.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => /getAll\(\{/.test(l) && !/index:|range:/.test(l));
    assert.deepEq(withOpts.map((x) => x[1]), []);
    const unmarked = src.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => /getAll\(\)/.test(l) && !/ALLOW-UNFILTERED/.test(l) && !/^\s*\/\//.test(l));
    assert.deepEq(unmarked.map((x) => x[1]), []);
  });
  it('no data vs zero in days', ['DAT-009', 'FR-025', 'FR-024'], async () => {
    await fresh(); const p = await repo.createProfile('Test A');
    let d = await repo.setWater(p.id, '2025-03-10', null); assert.eq(d.water.glasses, null); assert.eq(d.water.ml, null); assert.eq(d.steps.count, null);
    d = await repo.setWater(p.id, '2025-03-10', 0); assert.eq(d.water.glasses, 0); assert.eq(d.water.ml, 0);
    d = await repo.setSteps(p.id, '2025-03-10', '0'); assert.eq(d.steps.count, 0); d = await repo.setSteps(p.id, '2025-03-10', ''); assert.eq(d.steps.count, null);
    d = await repo.addWater(p.id, '2025-03-10', 1); assert.eq(d.water.glasses, 1); assert.eq(d.water.ml, 500); d = await repo.addWater(p.id, '2025-03-10', -0.5); assert.eq(d.water.glasses, 0.5); d = await repo.addWater(p.id, '2025-03-10', -5); assert.eq(d.water.glasses, 0);
    await assert.throws(() => repo.setWater(p.id, '2025-03-10', 41)); await assert.throws(() => repo.setSteps(p.id, '2025-03-10', -4)); await assert.throws(() => repo.setWater(p.id, '2030-01-01', 1));
  });
  it('step goal: plan sets it, manual wins (C-027)', ['FR-024', 'C-027'], async () => {
    await fresh(); const p = await repo.createProfile('Test A'); const date = '2025-03-10';
    assert.deepEq(await repo.effectiveStepGoal(p.id, date), { goal: 7000, source: 'default' });
    let d = await repo.applyPlanStepGoal(p.id, date, { stepGoal: 10000 }); assert.eq(d.stepGoal, 10000); assert.eq(d.stepGoalSource, 'plan');
    d = await repo.applyPlanStepGoal(p.id, date, { stepGoal: 7000 }); assert.eq(d.stepGoal, 7000);
    d = await repo.setStepGoalManual(p.id, date, 8000); assert.eq(d.stepGoalSource, 'manual');
    d = await repo.applyPlanStepGoal(p.id, date, { stepGoal: 10000 }); assert.eq(d.stepGoal, 8000); assert.eq(d.stepGoalSource, 'manual');
    await repo.updateSettings(p.id, { defaultStepGoal: 5000 }); assert.eq((await repo.getDay(p.id, date)).stepGoal, 8000);
  });
  it('sleep upsert: wake date, unique per day', ['FR-027', 'Q-013', 'DAT-021'], async () => {
    await fresh(); const p = await repo.createProfile('Test A');
    const s1 = await repo.upsertSleep(p.id, '2025-03-10', { bed: '23:15', wake: '06:40', quality: 4 });
    assert.eq(s1.durationMin, 445); assert.eq(s1.bedAt, '2025-03-09T23:15'); assert.eq(s1.date, '2025-03-10');
    const s2 = await repo.upsertSleep(p.id, '2025-03-10', { bed: '23:30', wake: '07:00', napMin: 20 }); assert.eq(s2.id, s1.id); assert.eq(s2.durationMin, 450); assert.eq((await repo.getSleepRange(p.id, '2025-03-01', '2025-03-31')).length, 1);
    await assert.throws(() => repo.upsertSleep(p.id, '2025-03-11', { bed: '06:40', wake: '06:40' })); const m = await repo.upsertSleep(p.id, '2025-03-12', { durationMin: 480 }); assert.eq(m.durationSource, 'manual'); assert.eq(m.bedAt, null);
    await assert.throws(() => repo.upsertSleep(p.id, '2025-03-13', { durationMin: 2000 }));
  });
  it('measurements series ordering and validation', ['FR-029', 'FR-031'], async () => {
    await fresh(); const p = await repo.createProfile('Test A');
    await repo.addMeasurement(p.id, { typeId: 'mt:weight', date: '2025-03-05', value: '71,5' }); await repo.addMeasurement(p.id, { typeId: 'mt:weight', date: '2025-03-01', value: 72 }); await repo.addMeasurement(p.id, { typeId: 'mt:waist', date: '2025-03-01', value: 85 });
    const s = await repo.measurementSeries(p.id, 'mt:weight'); assert.deepEq(s.map((x) => x.value), [72, 71.5]); assert.eq(s[0].unit, 'kg');
    const l = await repo.latestMeasurements(p.id); assert.eq(l['mt:weight'].latest.value, 71.5); assert.eq(l['mt:weight'].previous.value, 72); assert.eq(l['mt:waist'].previous, null);
    await assert.throws(() => repo.addMeasurement(p.id, { typeId: 'mt:weight', date: '2025-03-05', value: 10 }));
    assert.eq((await repo.measurementSeries(p.id, 'mt:weight')).length, 2);
  });
  it('targets add/replace from date, settings', ['FR-016', 'DAT-030'], async () => {
    await fresh(); const p = await repo.createProfile('Test A', { targets: { kcal: 1900, protein: 120, carbs: 220, fat: 60, fiber: 25, waterMl: 3000, steps: 7000 } });
    let s = await repo.getSettings(p.id); assert.eq(s.targetsHistory.length, 1);
    s = await repo.setTargets(p.id, { kcal: 2100, protein: 130, carbs: 240, fat: 65, fiber: 25, waterMl: 3000, steps: 8000 }, '2099-01-01'); assert.eq(s.targetsHistory.length, 2);
    s = await repo.setTargets(p.id, { kcal: 2200, protein: 130, carbs: 240, fat: 65, fiber: 25, waterMl: 3000, steps: 8000 }, '2099-01-01'); assert.eq(s.targetsHistory.length, 2);
    assert.eq(C.resolveTargets(s.targetsHistory, '2050-01-01').kcal, 1900); assert.eq(C.resolveTargets(s.targetsHistory, '2099-06-01').kcal, 2200);
    await assert.throws(() => repo.setTargets(p.id, { kcal: 100 })); assert.eq((await repo.getSettings(p.id)).targetsHistory.length, 2);
  });
});

describe('snapshot immutability', () => {
  it('food logs survive master edits, delete, hide, seed copy-on-edit', ['DAT-007', 'DAT-006', 'DoD-07'], async () => {
    await fresh(); seed.setSeedData({ seedVersion: 1, foods: [{ id: 'f:test-dal', kind: 'food', name: 'Test Dal', aliases: [], category: 'dal-legume', cuisine: 'indian', origin: 'home', confidence: 'typical', nutrition: { per: { amount: 100, unit: 'ml' }, kcal: 90, protein: 6, carbs: 12, fat: 2, fiber: 3 }, servings: [{ id: 's1', label: '1 bowl (200 ml)', unit: 'bowl', baseAmount: 200 }], defaultServingId: 's1' }] });
    const p = await repo.createProfile('Test A'); const food = await repo.saveFood(p.id, RICE); const sdal = await seed.getFood('f:test-dal', p.id);
    const l1 = await repo.addFoodLog(p.id, { date: '2025-03-10', food, serving: food.servings[0], qty: 1.5, meal: { id: 'meal:lunch', label: 'Lunch' } });
    const l2 = await repo.addFoodLog(p.id, { date: '2025-03-10', food: sdal, serving: sdal.servings[0], qty: 1 }); const l3 = await repo.quickAddFoodLog(p.id, { date: '2025-03-10', kcal: 250 });
    const before = structuredClone(await repo.getFoodLogs(p.id, '2025-03-10'));
    const edited = await repo.saveFood(p.id, { ...food, nutrition: { ...food.nutrition, kcal: 200, protein: 9 }, servings: [{ id: 's1', label: '1 cup (100 g)', unit: 'cup', baseAmount: 100 }] }); assert.eq(edited.id, food.id); assert.eq(edited.rev, 2);
    const copy = await repo.saveFood(p.id, { ...sdal, nutrition: { ...sdal.nutrition, kcal: 400 } }); assert.ok(copy.id.startsWith('fd_')); assert.eq(copy.basedOn, 'f:test-dal'); assert.eq(copy.supersedes, 'f:test-dal');
    await repo.saveFood(p.id, { ...copy, name: 'Test Dal v2' }); assert.eq((await repo.listFoods(p.id)).length, 2);
    await repo.deleteFood(p.id, food.id); await repo.deleteFood(p.id, 'f:test-dal'); await repo.archiveFood(p.id, copy.id);
    assert.deepEq(await repo.getFoodLogs(p.id, '2025-03-10'), before); assert.eq(before[0].totals.kcal, 312);
    const after = await repo.getFoodLogs(p.id, '2025-03-10'); for (const l of after) { assert.ok(l.foodName && l.totals && l.servingLabel); }
    assert.eq(C.dayTotals(after).kcal, 312 + 180 + 250);
    const e = await repo.editFoodLog(p.id, l1.id, { qty: 2 }); assert.eq(e.totals.kcal, 416); assert.eq(e.per1serving.kcal, 208);
    const r = await repo.deleteFoodLog(p.id, l3.id); assert.eq((await repo.getFoodLogs(p.id, '2025-03-10')).length, 2); await repo.restoreFoodLog(p.id, r); assert.eq((await repo.getFoodLogs(p.id, '2025-03-10')).length, 3);
    await assert.throws(() => repo.addFoodLog(p.id, { date: '2025-03-10', food, serving: food.servings[0], qty: 51 })); await assert.throws(() => repo.addFoodLog(p.id, { date: '2025-03-10', food, serving: food.servings[0], qty: 0 }));
    assert.ok(l2.id);
  });
  it('workout logs survive exercise, plan and plan-delete changes', ['DAT-007', 'FR-021', 'DoD-10', 'DoD-07'], async () => {
    await fresh(); seed.setSeedData({ seedVersion: 1, plans: [{ id: 'plan:seed-upper', name: 'Seed Upper', description: '', stepGoal: 7000, isRest: false, rev: 1, items: [mkItem('it_s1', 'ex:push-up', 'Push-ups', 'reps', 10)] }], exercises: [{ id: 'ex:push-up', name: 'Push-ups', ...mkEx('Push-ups') }] });
    const p = await repo.createProfile('Test A'); const ex = await repo.saveExercise(p.id, mkEx('Test Curl')); const ex2 = await repo.saveExercise(p.id, mkEx('Test Plank', { targetKind: 'seconds', defaultTarget: 30, kcal: { basis: 'per_minute', value: 4, refWeightKg: 70, scaleByWeight: false } }));
    const plan = await repo.savePlan(p.id, { name: 'Test Plan', description: '', stepGoal: 7000, isRest: false, items: [mkItem('it_1', ex.id, ex.name, 'reps', 10), mkItem('it_2', ex2.id, ex2.name, 'seconds', 30, ex2.kcal)] });
    const resolve = (id) => ({ [ex.id]: ex, [ex2.id]: ex2 })[id] || null;
    let log = await repo.createWorkoutLog(p.id, { date: '2025-03-10', plan, resolveExercise: resolve });
    log = await repo.updateWorkoutItem(p.id, log.id, 'it_1', { actual: 7 }); log = await repo.updateWorkoutItem(p.id, log.id, 'it_2', { actual: 20 });
    assert.eq(log.items[0].pct, 70); assert.eq(log.items[1].pct, 67); assert.eq(log.completionPct, 69); assert.eq(log.items[0].kcalEst, 3.2); assert.eq(log.items[1].kcalEst, 1.3); assert.eq(log.kcalTotal, 4.5);
    const srcLog = await repo.createWorkoutLog(p.id, { date: '2025-03-11', plan: (await seed.getPlan('plan:seed-upper', p.id)), resolveExercise: resolve });
    const before = structuredClone([await repo.getWorkoutLog(p.id, log.id), await repo.getWorkoutLog(p.id, srcLog.id)]);
    await repo.saveExercise(p.id, { ...ex, kcal: { ...EXK, value: 0.6 }, name: 'Renamed Curl' });
    const p2 = await repo.savePlan(p.id, { ...plan, name: 'Renamed', stepGoal: 9000, items: [{ ...plan.items[0], target: 99 }, mkItem('it_3', ex.id, ex.name, 'reps', 5)] }); assert.eq(p2.rev, plan.rev + 1);
    const copy = await repo.savePlan(p.id, { ...(await seed.getPlan('plan:seed-upper', p.id)), name: 'My Upper' }); assert.eq(copy.basedOn, 'plan:seed-upper');
    await repo.deletePlan(p.id, plan.id); await repo.deletePlan(p.id, 'plan:seed-upper'); await repo.deleteExercise(p.id, ex.id);
    const after = [await repo.getWorkoutLog(p.id, log.id), await repo.getWorkoutLog(p.id, srcLog.id)];
    assert.deepEq(after, before); assert.eq(after[0].planName, 'Test Plan'); assert.eq(after[0].items[0].exerciseName, 'Test Curl'); assert.eq(after[0].items[0].target, 10); assert.eq(after[0].stepGoalSnap, 7000); assert.eq(after[1].planName, 'Seed Upper');
    assert.eq((await repo.getWorkoutLogs(p.id, '2025-03-10')).length, 1);
    const dup = await repo.duplicatePlanFor(p.id, p2); assert.eq(dup.name, 'Renamed (copy)'); assert.eq(dup.rev, 1);
  });
  it('workout log: weight scaling, log override, manual pct, rest, alt, mark all', ['FR-023', 'FR-022', 'Q-007', 'C-017'], async () => {
    await fresh(); const p = await repo.createProfile('Test A'); const ex = await repo.saveExercise(p.id, mkEx('Test Push')); const alt = await repo.saveExercise(p.id, mkEx('Test Walk', { targetKind: 'minutes', defaultTarget: 20, kcal: { basis: 'per_minute', value: 4.5, refWeightKg: 70, scaleByWeight: true } }));
    await repo.addMeasurement(p.id, { typeId: 'mt:weight', date: '2025-03-01', value: 80 });
    const plan = await repo.savePlan(p.id, { name: 'Test Plan', stepGoal: 7000, isRest: false, items: [mkItem('it_1', ex.id, ex.name, 'reps', 10, EXK, { altExerciseIds: [alt.id] }), mkItem('it_2', ex.id, ex.name, 'reps', 10, EXK, { perSide: true })] });
    const resolve = (id) => ({ [ex.id]: ex, [alt.id]: alt })[id];
    let log = await repo.createWorkoutLog(p.id, { date: '2025-03-10', plan, resolveExercise: resolve });
    assert.eq(log.bodyWeightKg, 80); assert.eq(log.weightSource, 'on-or-before'); assert.eq(log.completionPct, null); assert.eq(log.kcalTotal, null);
    log = await repo.updateWorkoutItem(p.id, log.id, 'it_1', { actual: 10 }); assert.eq(log.items[0].kcalEst, 5.1); assert.eq(log.completionPct, 50);
    log = await repo.updateWorkoutItem(p.id, log.id, 'it_2', { actual: 10 }); assert.eq(log.items[1].kcalEst, 10.3); assert.eq(log.completionPct, 100);
    log = await repo.updateWorkoutItem(p.id, log.id, 'it_1', { kcalLogOverride: 50 }); assert.eq(log.items[0].kcalFinal, 50); assert.eq(log.items[0].kcalEst, 5.1); assert.eq(log.kcalTotal, 60.3);
    log = await repo.updateWorkoutItem(p.id, log.id, 'it_2', { actual: null, manualPct: 40 }); assert.eq(log.items[1].pct, 40); assert.eq(log.items[1].pctSource, 'manual'); assert.eq(log.items[1].kcalEst, 4.1);
    await assert.throws(() => repo.updateWorkoutItem(p.id, log.id, 'it_2', { manualPct: 101 })); await assert.throws(() => repo.updateWorkoutItem(p.id, log.id, 'it_2', { manualPct: 12.5 }));
    log = await repo.setWorkoutBodyWeight(p.id, log.id, 70); assert.eq(log.items[0].kcalEst, 4.5); assert.eq(log.weightSource, 'manual');
    log = await repo.switchWorkoutAlt(p.id, log.id, 'it_1', alt); assert.eq(log.items[0].exerciseRef, alt.id); assert.eq(log.items[0].targetKind, 'minutes'); assert.eq(log.items[0].actual, null);
    log = await repo.markAllAsTarget(p.id, log.id); assert.eq(log.items[0].actual, 20); assert.eq(log.items[1].actual, null);
    const rest = await repo.createWorkoutLog(p.id, { date: '2025-03-12', plan: { id: 'plan:rest', name: 'Complete Rest', isRest: true, stepGoal: 10000, items: [] } });
    assert.eq(rest.isRest, true); assert.eq(rest.items.length, 0); assert.eq(rest.completionPct, null);
  });
  it('unentered rows count 0 once any entered (D-071) via repo', ['D-071', 'FR-022'], async () => {
    await fresh(); const p = await repo.createProfile('Test A'); const ex = await repo.saveExercise(p.id, mkEx('Test Push'));
    const plan = await repo.savePlan(p.id, { name: 'Test Plan', stepGoal: 7000, items: [mkItem('a', ex.id, 'x', 'reps', 10), mkItem('b', ex.id, 'x', 'reps', 10), mkItem('c', ex.id, 'x', 'reps', 10), mkItem('d', ex.id, 'x', 'reps', 10)] });
    let log = await repo.createWorkoutLog(p.id, { date: '2025-03-10', plan, resolveExercise: () => ex }); assert.eq(log.completionPct, null);
    log = await repo.updateWorkoutItem(p.id, log.id, 'a', { actual: 10 }); assert.eq(log.completionPct, 25); log = await repo.updateWorkoutItem(p.id, log.id, 'b', { actual: 0 }); assert.eq(log.completionPct, 25);
  });
});

describe('food prefs', () => {
  it('prefs update in the same tx as logs; favourites; rebuild', ['FR-015'], async () => {
    await fresh(); const p = await repo.createProfile('Test A'); const f = await repo.saveFood(p.id, RICE);
    const a = await repo.addFoodLog(p.id, { date: '2025-03-10', food: f, serving: f.servings[0], qty: 1, meal: { id: 'meal:lunch', label: 'Lunch' } });
    await repo.addFoodLog(p.id, { date: '2025-03-11', food: f, serving: f.servings[1], qty: 2, meal: { id: 'meal:dinner', label: 'Dinner' } });
    let pr = (await repo.listPrefs(p.id))[0]; assert.eq(pr.useCount, 2); assert.eq(pr.lastServingId, 's2'); assert.eq(pr.lastQty, 2); assert.eq(pr.lastMealId, 'meal:dinner'); assert.eq(pr.fav, 0);
    await repo.toggleFavourite(p.id, f.id); assert.eq((await repo.listPrefs(p.id))[0].fav, 1);
    await repo.deleteFoodLog(p.id, a.id); assert.eq((await repo.listPrefs(p.id))[0].useCount, 1);
    await db.put('foodPrefs', { pid: p.id, foodRef: f.id, fav: 1, useCount: 99, lastUsedAt: 1 }); await repo.rebuildPrefs(p.id); pr = (await repo.listPrefs(p.id))[0]; assert.eq(pr.useCount, 1); assert.eq(pr.fav, 1);
    assert.eq((await repo.recentFoodRefs(p.id)).length, 1); assert.eq((await repo.frequentFoodRefs(p.id))[0].foodRef, f.id);
    await repo.deleteFood(p.id, f.id); assert.eq((await repo.listPrefs(p.id)).length, 0);
  });
});

describe('check-ins and photos', () => {
  const photo = (slot, bytes = 300) => ({ slot, blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), thumb: new Blob([new Uint8Array(20)], { type: 'image/jpeg' }), w: 1200, h: 1600, bytes, thumbBytes: 20, mime: 'image/jpeg', crc32: 1 });
  it('atomic save, cascade delete, orphans listed not deleted', ['FR-032', 'FR-034', 'D-032', 'DAT-024'], async () => {
    await fresh(); const p = await repo.createProfile('Test A');
    const ck = await repo.saveCheckinWithPhotos(p.id, { date: '2025-03-08', periodDays: 7, weight: 72, note: 'Synthetic' }, [photo('front'), photo('side')], { writeMeasurements: true });
    assert.eq(ck.photos.length, 2); assert.eq(await db.count('photos'), 2); assert.eq(await db.count('photoData'), 2); assert.eq((await repo.measurementSeries(p.id, 'mt:weight')).length, 1);
    const thumb = await repo.getPhotoBlob(p.id, ck.photos[0].photoId, false); assert.ok(thumb instanceof Blob); const full = await repo.getPhotoBlob(p.id, ck.photos[0].photoId, true); assert.eq(full.size, 300);
    await assert.throws(() => repo.saveCheckinWithPhotos(p.id, { date: '2025-03-09' }, ['front', 'side', 'back', 'flexed', 'front'].map((s) => photo(s)))); assert.eq(await db.count('checkins'), 1);
    await assert.throws(() => repo.saveCheckinWithPhotos(p.id, { date: '2025-03-09', measurements: { 'mt:waist': 5 } }, [photo('front')], { writeMeasurements: true }));
    assert.eq(await db.count('checkins'), 1); assert.eq(await db.count('photos'), 2); assert.eq(await db.count('photoData'), 2);
    const upd = await repo.saveCheckinWithPhotos(p.id, { ...ck, note: 'Edited' }, [photo('back')], { removeSlots: ['side'] }); assert.deepEq(upd.photos.map((x) => x.slot).sort(), ['back', 'front']); assert.eq(await db.count('photos'), 2);
    await db.put('photoData', { id: 'ph_orphan_x', blob: new Blob(['x']) }); const scan = await repo.integrityScan(); assert.deepEq(scan.orphanPhotoData, ['ph_orphan_x']); assert.eq(await db.count('photoData'), 3);
    assert.eq(await repo.cleanupOrphans(scan), 1); assert.eq(await db.count('photoData'), 2);
    const other = await repo.createProfile('Test B'); await assert.throws(() => repo.deleteCheckin(other.id, ck.id)); assert.eq(await db.count('checkins'), 1);
    await repo.deleteCheckin(p.id, ck.id); assert.eq(await db.count('checkins'), 0); assert.eq(await db.count('photos'), 0); assert.eq(await db.count('photoData'), 0);
  });
});

describe('migrations', () => {
  it('pipeline leaves the v1 fixture unchanged and all fixture records validate', ['DAT-026', 'NFR-010', 'D-034'], async () => {
    const fx = JSON.parse(await fetchText('./fixtures/backup-v1.json')); assert.eq(fx.manifest.schemaVersion, 1);
    const out = M.migrateData(fx.data, 1); assert.deepEq(out.data, fx.data); assert.eq(out.to, 1); assert.deepEq(out.applied, []);
    for (const [s, list] of Object.entries(fx.data)) for (const r of list) { const v = V.validateRecord(s, r); assert.ok(v.ok, `${s} ${r.id || r.pid}: ${JSON.stringify(v.hard)}`); }
    assert.eq(new Set(fx.data.profiles.map((x) => x.id)).size, 2); assert.ok(fx.data.foodLogs.every((l) => fx.data.profiles.some((pp) => pp.id === l.pid)));
  });
  it('test-only step proves the framework; idempotent; newer rejected', ['DAT-026', 'D-034'], async () => {
    const fx = JSON.parse(await fetchText('./fixtures/backup-v1.json'));
    M.registerTestStep(1, (d) => ({ ...d, profiles: d.profiles.map((p) => ({ ...p, migratedFlag: true })) }));
    const out = M.migrateData(fx.data, 1); assert.eq(out.to, 2); assert.deepEq(out.applied, [1]); assert.ok(out.data.profiles.every((p) => p.migratedFlag)); assert.ok(!fx.data.profiles[0].migratedFlag);
    const again = M.migrateData(fx.data, 1); assert.deepEq(again.data, out.data);
    const step = (d) => ({ ...d, profiles: d.profiles.map((p) => ({ ...p, migratedFlag: true })) }); assert.deepEq(step(step(fx.data)), step(fx.data));
    M.clearTestSteps();
    const e = await assert.throws(() => M.migrateData(fx.data, 2)); assert.eq(e.code, 'I_NEWER'); assert.eq(e.message, V.msg('I_NEWER'));
    const e2 = await assert.throws(() => M.migrateData(fx.data, 'x')); assert.eq(e2.code, 'I_DAMAGED');
  });
  it('live migration: success, and failure aborts with safe-mode signal', ['DAT-026', 'D-034'], async () => {
    await fresh(); const p = await repo.createProfile('Test A');
    M.registerTestStep(1, (d) => ({ ...d, profiles: d.profiles.map((x) => ({ ...x, migratedFlag: true })) }));
    const r = await M.migrateLiveDb(); assert.eq(r.to, 2); assert.eq((await repo.getProfile(p.id)).migratedFlag, true); assert.eq((await db.get('meta', 'schemaVersion')).v, 2);
    await fresh(); const q = await repo.createProfile('Test B'); await db.put('meta', { k: 'schemaVersion', v: 1 });
    M.registerTestStep(1, (d) => { d.profiles = []; throw new Error('step failed'); });
    await assert.throws(() => M.migrateLiveDb()); assert.eq(M.safeModeSignal.active, true); assert.eq((await repo.getProfile(q.id)).name, 'Test B'); assert.eq((await db.get('meta', 'schemaVersion')).v, 1);
    M.clearTestSteps(); M.safeModeSignal.active = false;
    await db.put('meta', { k: 'schemaVersion', v: 99 }); const e = await assert.throws(() => M.migrateLiveDb()); assert.eq(e.code, 'I_NEWER'); assert.eq(M.safeModeSignal.active, true); M.safeModeSignal.active = false;
  });
});

describe('storage health', () => {
  it('levels: amber 250 MB/50%, red 400 MB/80%', ['DAT-013', 'DAT-014'], () => {
    const MB = 1024 * 1024, Q = 100000 * MB;
    assert.eq(SH.levelFor(249 * MB, Q), 'ok'); assert.eq(SH.levelFor(250 * MB, Q), 'amber'); assert.eq(SH.levelFor(399 * MB, Q), 'amber'); assert.eq(SH.levelFor(400 * MB, Q), 'red');
    assert.eq(SH.levelFor(50 * MB, 100 * MB), 'amber'); assert.eq(SH.levelFor(49 * MB, 100 * MB), 'ok'); assert.eq(SH.levelFor(80 * MB, 100 * MB), 'red'); assert.eq(SH.levelFor(null, null), 'unknown');
  });
  it('write counter, sentinel, loss detection, backup reminder logic', ['DAT-015', 'DAT-017', 'D-017'], async () => {
    await fresh(); SH.lsRemove('sentinel'); const DAY = 86400000; const now = Date.now();
    assert.eq(await SH.detectLoss(), false); assert.deepEq(await SH.reminderDecision(now), { due: false, reason: 'no-changes' });
    const p = await repo.createProfile('Test A'); await repo.setWater(p.id, '2025-03-10', 2);
    assert.ok((await SH.getChangesSinceBackup()) >= 2); assert.ok(SH.lsGet('sentinel').hadData); assert.eq(await SH.detectLoss(), false);
    assert.deepEq(await SH.reminderDecision(now), { due: false, reason: 'too-early' }); assert.deepEq(await SH.reminderDecision(now + 4 * DAY), { due: true, reason: 'never' });
    await SH.recordBackup(now); assert.eq(await SH.getChangesSinceBackup(), 0); assert.eq(await SH.getLastBackupAt(), now); assert.deepEq(await SH.reminderDecision(now + 30 * DAY), { due: false, reason: 'no-changes' });
    await repo.setSteps(p.id, '2025-03-10', 100); assert.deepEq(await SH.reminderDecision(now + 6 * DAY), { due: false, reason: 'too-early' }); assert.deepEq(await SH.reminderDecision(now + 7 * DAY), { due: true, reason: 'interval' });
    SH.snoozeReminder(now + 7 * DAY); assert.deepEq(await SH.reminderDecision(now + 7 * DAY + 3600000), { due: false, reason: 'snoozed' }); assert.eq((await SH.reminderDecision(now + 9 * DAY)).due, true);
    await SH.setReminderInterval(14); assert.eq((await SH.reminderDecision(now + 10 * DAY)).due, false); assert.eq((await SH.reminderDecision(now + 14 * DAY)).due, true);
    await SH.setReminderInterval(0); assert.deepEq(await SH.reminderDecision(now + 100 * DAY), { due: false, reason: 'off' }); await assert.throws(() => SH.setReminderInterval(5));
    await db.clear('profiles'); assert.eq(await SH.detectLoss(), true);
  });
  it('install nudge, session helper, LocalStorage safety', ['DAT-014', 'CR-003'], () => {
    const now = Date.now(); SH.lsRemove('installNudge'); assert.eq(SH.installNudgeDue(now), !SH.isStandalone()); SH.dismissInstallNudge(now); assert.eq(SH.installNudgeDue(now + 6 * 86400000), false); assert.eq(SH.installNudgeDue(now + 7 * 86400000), !SH.isStandalone());
    SH.sessionSet({ pid: 'p_1' }); assert.deepEq(SH.sessionGet(), { pid: 'p_1' }); SH.sessionRemove(); assert.eq(SH.sessionGet(), null);
    assert.eq(SH.lsSet('k', { a: 1 }), true); assert.deepEq(SH.lsGet('k'), { a: 1 }); SH.lsRemove('k'); assert.eq(SH.lsGet('k', 'def'), 'def');
  });
});

describe('seed search', () => {
  const FOODS = [
    { id: 'f:macher-jhol', name: 'Macher Jhol', aliases: ['Machher Jhol', 'Fish Curry', 'Bengali fish curry'], category: 'fish-seafood', cuisine: 'bengali', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 110, protein: 12, carbs: 3, fat: 5, fiber: 1 }, servings: [{ id: 's1', label: '1 piece (60 g)', unit: 'piece', baseAmount: 60 }] },
    { id: 'f:fish-fry', name: 'Fish Fry', aliases: ['Macher Bhaja'], category: 'fish-seafood', cuisine: 'bengali', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 220, protein: 18, carbs: 6, fat: 14, fiber: 0 }, servings: [{ id: 's1', label: '1 piece (80 g)', unit: 'piece', baseAmount: 80 }] },
    { id: 'f:plain-rice', name: 'Rice, cooked', aliases: ['Bhat', 'Steamed rice'], category: 'grain-rice', cuisine: 'indian', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }, servings: [] },
    { id: 'f:rice-pudding', name: 'Rice Pudding', aliases: ['Payesh'], category: 'sweet-dessert', cuisine: 'bengali', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 160, protein: 3, carbs: 26, fat: 5, fiber: 0 }, servings: [] },
    { id: 'f:old', name: 'Old Fish Curry', deprecated: true, aliases: [], category: 'fish-seafood', cuisine: 'bengali', nutrition: { per: { amount: 100, unit: 'g' }, kcal: 1, protein: 1, carbs: 1, fat: 0, fiber: 0 }, servings: [] }
  ].map((f) => ({ kind: 'food', origin: 'home', confidence: 'typical', ...f }));
  it('spelling variants and aliases map to the same item', ['FR-010', 'FR-009', 'R-028'], async () => {
    await fresh(); seed.setSeedData({ foods: FOODS, seedVersion: 1 }); const p = await repo.createProfile('Test A');
    for (const q of ['machher jhol', 'macher jhol', 'fish curry', 'MACHER JHOL', 'macher jol', 'bengali fish', 'maher']) { const r = await seed.search(q, p.id); assert.ok(r.length >= 1 || q === 'maher', q); if (q !== 'maher') assert.eq(r[0].food.id, 'f:macher-jhol', q); }
    assert.eq((await seed.search('fish curry', p.id))[0].matchedAlias, 'Fish Curry'); assert.eq((await seed.search('macher jhol', p.id))[0].matchedAlias, null);
    assert.ok(!(await seed.search('fish curry', p.id)).some((r) => r.food.id === 'f:old')); assert.deepEq(await seed.search('', p.id), []); assert.deepEq(await seed.search('zzzz', p.id), []);
  });
  it('ranking: exact > prefix > token-prefix > alias; ties by favourite', ['FR-015', 'FR-040'], async () => {
    await fresh(); seed.setSeedData({ foods: FOODS, seedVersion: 1 }); const p = await repo.createProfile('Test A');
    let r = await seed.search('rice', p.id); assert.eq(r.length, 2);
    r = await seed.search('rice pudding', p.id); assert.eq(r[0].food.id, 'f:rice-pudding'); r = await seed.search('payesh', p.id); assert.eq(r[0].food.id, 'f:rice-pudding'); assert.eq(r[0].matchedAlias, 'Payesh');
    r = await seed.search('bhat', p.id); assert.eq(r[0].food.id, 'f:plain-rice');
    await repo.toggleFavourite(p.id, 'f:rice-pudding'); await seed.prepare(p.id, { force: true });
    const r2 = await seed.search('rice', p.id); assert.eq(r2[0].food.id, 'f:rice-pudding'); // same rank tier: favourite first
    const r3 = await seed.search('rice pudding', p.id); assert.eq(r3[0].food.id, 'f:rice-pudding'); const r4 = await seed.search('bhat', p.id); assert.eq(r4[0].food.id, 'f:plain-rice'); // alias-only match still found
  });
  it('custom foods index incrementally; hidden and superseded seed items excluded', ['FR-013', 'D-025'], async () => {
    await fresh(); seed.setSeedData({ foods: FOODS, seedVersion: 1 }); const p = await repo.createProfile('Test A');
    assert.eq((await seed.search('protein shake', p.id)).length, 0);
    const f = await repo.saveFood(p.id, { ...RICE, name: 'Protein Shake Mix', aliases: ['whey'] }); await seed.indexFood(p.id, f); assert.eq((await seed.search('protein shake', p.id))[0].food.id, f.id); assert.eq((await seed.search('whey', p.id))[0].food.id, f.id);
    await repo.hideSeed(p.id, 'foods', 'f:fish-fry'); await seed.prepare(p.id, { force: true }); assert.eq((await seed.search('fish fry', p.id)).length, 0); assert.ok(await seed.getFood('f:fish-fry', p.id));
    await repo.unhideSeed(p.id, 'foods', 'f:fish-fry'); await seed.prepare(p.id, { force: true }); assert.eq((await seed.search('fish fry', p.id)).length, 1);
    const copy = await repo.saveFood(p.id, { ...FOODS[2], name: 'Rice, cooked (mine)', nutrition: { ...FOODS[2].nutrition, kcal: 140 } }); await seed.indexFood(p.id, copy);
    const r = await seed.search('cooked rice', p.id); assert.ok(r.some((x) => x.food.id === copy.id)); assert.ok(!r.some((x) => x.food.id === 'f:plain-rice'));
    await repo.resetToDefault('foods', p.id, copy.id); await seed.prepare(p.id, { force: true }); assert.ok((await seed.search('bhat', p.id)).some((x) => x.food.id === 'f:plain-rice')); assert.eq((await repo.listFoods(p.id)).filter((x) => x.basedOn).length, 0);
    await repo.deleteFood(p.id, 'f:plain-rice'); await seed.prepare(p.id, { force: true }); assert.eq((await seed.search('bhat', p.id)).length, 0); await repo.resetToDefault('foods', p.id, 'f:plain-rice'); await seed.prepare(p.id, { force: true }); assert.eq((await seed.search('bhat', p.id)).length, 1);
  });
  it('loadSeed tolerates missing optional food files', ['DAT-010'], async () => {
    const files = { 'data/seed-manifest.json': { seedVersion: 3, files: [{ path: 'foods-a.json' }, { path: 'foods-b.json' }, { path: 'exercises.json' }] }, 'data/foods-a.json': { items: [FOODS[0]] }, 'data/exercises.json': { items: [{ id: 'ex:a', name: 'A', kcal: EXK }] } };
    const fetchFn = async (u) => ({ ok: u in files, status: u in files ? 200 : 404, json: async () => files[u] });
    const r = await seed.loadSeed({ base: 'data/', fetchFn }); assert.eq(r.seedVersion, 3); assert.deepEq(r.missing, ['foods-b.json']); assert.eq(r.counts.foods, 1); assert.eq(r.counts.exercises, 1);
    const bad = async (u) => ({ ok: false, status: 404, json: async () => ({}) }); await assert.throws(() => seed.loadSeed({ base: 'data/', fetchFn: bad }));
  });
  it('normaliser', [], () => { assert.eq(seed.normalize('Machher  Jhol!'), seed.normalize('macher jhol')); assert.eq(seed.normalize('Caf\u00e9'), 'cafe'); assert.deepEq(seed.tokenize('Fish, Curry'), ['fis', 'cury']); });
});

describe('repo guards: source greps', () => {
  const FILES = ['config.js', 'js/core/db.js', 'js/core/store.js', 'js/core/dates.js', 'js/core/validate.js', 'js/core/units.js', 'js/core/migrate.js', 'js/core/storage-health.js', 'js/core/calc.js', 'js/core/repo.js', 'js/core/seed.js'];
  const load = async () => Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await fetchText('../' + f)])));
  it('no UTC date keys, no innerHTML, no absolute URLs, no inline handlers', ['NFR-013', 'D-052', 'NFR-009'], async () => {
    const src = await load();
    for (const [f, t] of Object.entries(src)) {
      assert.ok(!/toISOString|toUTCString|getUTC/.test(t), f + ' uses UTC'); assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(t), f + ' uses innerHTML');
      assert.ok(!/https?:\/\//.test(t), f + ' has an absolute URL'); assert.ok(!/\beval\(|new Function\(/.test(t), f + ' uses eval'); 
    }
    const fetches = Object.entries(src).flatMap(([f, t]) => t.split('\n').filter((l) => /\bfetch\(/.test(l) && !/^\s*\/\//.test(l)).map((l) => f + ': ' + l.trim()));
    assert.ok(fetches.every((l) => l.startsWith('js/core/seed.js')), fetches.join('\n'));
    for (const [f, t] of Object.entries(src)) for (const m of t.matchAll(/from '(\.[^']+)'/g)) assert.ok(m[1].endsWith('.js'), `${f} import ${m[1]}`);
  });
  it('no weekday words in core code except week-start keys and display names', ['FR-020', 'DoD-09'], async () => {
    const src = await load();
    const allow = [{ file: 'dates.js', line: /DN = \[|const WS = |'mon'|weekStart|week start/i }, { file: 'validate.js', line: /weekStart/ }, { file: 'repo.js', line: /weekStart/ }];
    assert.deepEq(scanForWeekdays(src, allow), []);
    assert.deepEq(scanForWeekdays({ 'x.js': 'const plan = { Monday: "Upper" };' }, allow).map((m) => m.match), ['Monday']);
    assert.eq(scanForWeekdays({ 'y.js': 'label: "Monday" // week start setting' }, [{ line: /week start/ }]).length, 0);
    assert.eq(scanForWeekdays({ 'z.js': 'nothing to see' }).length, 0);
    assert.deepEq(scanForWeekdays({ 'w.js': 'Sunday workout\nfine\nbest Friday' }).map((m) => m.line), [1, 3]);
    assert.ok(!src['js/core/repo.js'].includes('weekday')); assert.ok(!/weekday/i.test(src['js/core/calc.js']));
  });
});
