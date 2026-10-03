// Pure calculation functions. No IO. (A1)
// PUBLIC API
//  round1(x) / round4(x)
//  servingNutrition(food, serving|null) -> {kcal,protein,carbs,fat,fiber|null}   per ONE serving (unrounded to 4dp)
//  implicitServing(food, unit) -> {id,label,unit,baseAmount:1}  | null   (g/ml basis only)
//  foodLogSnapshot(food, serving, qty, meal) -> log fields: {foodRef,foodKind,foodName,origin,confidence,mealId,mealLabel,servingLabel,servingUnit,servingBaseAmount,basisUnit,qty,per1serving,totals}
//  totalsFor(per1serving, qty) -> totals rounded 0.1 (fiber null stays null)
//  recipeTotals(ingredients, servings) -> {totals, perServing, confidence, fiberKnown}   perServing = totals/servings exact
//  completionPct(actual, target, manualPct) -> integer 0-100 | null (no data). Throws RangeError on invalid manual.
//  toBasisUnits(item, amount) -> amount expressed in the kcal basis unit
//  kcalEstimate(item, units, bodyWeightKg) -> number (0.1)   uses item.kcalOverride ?? item.kcalBasis
//  finalKcal(item, units, bodyWeightKg, logOverride) -> logOverride ?? kcalEstimate
//  itemUnits(item) -> units for estimate: actual, or target x pct/100 when only manual pct; null if nothing entered
//  computeItem(item, bodyWeightKg) -> item with pct, pctSource, kcalEst, kcalFinal filled
//  bodyWeightFor(dateKey, measurements) -> {kg, source:'on-or-before'|'latest'|'default', date, stale}
//  sessionCompletion(items) -> integer|null   (D-071)
//  averagesOverDaysWithData(series) -> {avg, n, N}
//  resolveTargets(targetsHistory, dateKey) -> entry|null
//  waterDerived(glasses, glassMl, targetMl) -> {glasses, ml, litres, pct}
//  stepsPercent(steps, goal) -> integer|null
//  sleepDuration(bedAt, wakeAt) -> minutes|null
//  dayTotals(foodLogs) -> {count, kcal, protein, carbs, fat, fiber, fiberPartial, byMeal}
//  duplicatePlan(plan, idFn, now) ; reorderItems(items, from, to) ; moveItem(items, index, delta)
//  planStepGoalForDay(plan, defaultGoal)
import { REF_WEIGHT_KG, DEFAULT_BODY_WEIGHT_KG, STALE_WEIGHT_DAYS, DEFAULT_STEP_GOAL } from '../../config.js';
import { daysBetween, minutesBetween } from './dates.js';

export const round1 = (x) => (x == null ? x : Math.round((x + Number.EPSILON) * 10) / 10);
export const round4 = (x) => (x == null ? x : Math.round((x + Number.EPSILON) * 10000) / 10000);
const NUT = ['kcal', 'protein', 'carbs', 'fat'];

export function implicitServing(food, unit) {
  const b = food?.nutrition?.per?.unit;
  if ((b === 'g' || b === 'ml') && (!unit || unit === b)) return { id: b, label: `1 ${b}`, unit: b, baseAmount: 1, implicit: true };
  return null;
}
export function servingNutrition(food, serving) {
  const n = food.nutrition, per = n.per;
  const sv = serving || implicitServing(food);
  if (!sv) throw new RangeError('A serving is required for this food');
  const base = sv.baseAmount ?? 1;
  const f = base / per.amount;
  return { kcal: round4(n.kcal * f), protein: round4(n.protein * f), carbs: round4(n.carbs * f), fat: round4(n.fat * f), fiber: n.fiber == null ? null : round4(n.fiber * f) };
}
export function totalsFor(per, qty) {
  const o = {};
  for (const k of NUT) o[k] = per[k] == null ? null : round1(per[k] * qty); // null = not entered (quick add), never 0 (D-038)
  o.fiber = per.fiber == null ? null : round1(per.fiber * qty);
  return o;
}
export function foodLogSnapshot(food, serving, qty, meal = {}) {
  const sv = serving || implicitServing(food);
  const per1serving = servingNutrition(food, sv);
  return {
    foodRef: food.id, foodKind: food.kind || 'food', foodName: food.name, origin: food.origin ?? null,
    confidence: food.confidence ?? 'typical',
    mealId: meal.id ?? null, mealLabel: meal.label ?? null,
    servingLabel: sv.label, servingUnit: sv.unit, servingBaseAmount: sv.baseAmount ?? 1, basisUnit: food.nutrition.per.unit,
    qty, per1serving, totals: totalsFor(per1serving, qty)
  };
}
export function recipeTotals(ingredients, servings) {
  if (!Array.isArray(ingredients) || !ingredients.length) throw new RangeError('A recipe needs ingredients');
  if (!(servings > 0)) throw new RangeError('servings must be > 0');
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  let fiberKnown = true;
  for (const i of ingredients) {
    for (const k of NUT) t[k] += i.nutrition[k];
    if (i.nutrition.fiber == null) fiberKnown = false; else t.fiber += i.nutrition.fiber;
  }
  if (!fiberKnown) t.fiber = null;
  const perServing = {};
  for (const k of [...NUT, 'fiber']) perServing[k] = t[k] == null ? null : t[k] / servings;
  const cs = ingredients.map((i) => i.confidence || 'typical');
  const confidence = cs.includes('estimate') ? 'estimate' : cs.includes('typical') ? 'typical' : 'verified';
  return { totals: t, perServing, confidence, fiberKnown };
}
export function completionPct(actual, target, manualPct) {
  if (manualPct !== null && manualPct !== undefined) {
    if (typeof manualPct !== 'number' || !Number.isInteger(manualPct) || manualPct < 0 || manualPct > 100) throw new RangeError('Manual completion must be an integer 0-100');
    return manualPct;
  }
  if (actual === null || actual === undefined) return null;
  if (!(target > 0)) return null;
  return Math.min(100, Math.round((actual / target) * 100));
}
export function toBasisUnits(item, amount) {
  const b = item.kcalOverride?.basis ?? item.kcalBasis?.basis, kind = item.targetKind;
  if (amount == null) return null;
  switch (b) {
    case 'per_rep': return amount; // reps / rounds
    case 'per_second': return kind === 'minutes' ? amount * 60 : amount;
    case 'per_minute': return kind === 'seconds' ? amount / 60 : amount;
    case 'per_km': return kind === 'meters' ? amount / 1000 : amount;
    case 'per_session': return 1;
    default: return amount;
  }
}
export function kcalEstimate(item, units, bodyWeightKg = DEFAULT_BODY_WEIGHT_KG) {
  const basis = item.kcalOverride || item.kcalBasis;
  if (!basis || units == null) return null;
  const refW = item.kcalBasis?.refWeightKg ?? REF_WEIGHT_KG;
  const scale = item.kcalBasis?.scaleByWeight && !item.kcalOverride ? bodyWeightKg / refW : 1;
  return round1(basis.value * units * (item.perSide ? 2 : 1) * scale);
}
export function finalKcal(item, units, bodyWeightKg, logOverride) {
  if (logOverride !== null && logOverride !== undefined) return logOverride;
  return kcalEstimate(item, units, bodyWeightKg);
}
export function itemUnits(item) {
  const basis = item.kcalOverride?.basis ?? item.kcalBasis?.basis;
  if (item.actual != null) return basis === 'per_session' ? (item.pct != null ? item.pct / 100 : 1) : toBasisUnits(item, item.actual);
  if (item.manualPct != null) return basis === 'per_session' ? item.manualPct / 100 : toBasisUnits(item, item.target * item.manualPct / 100);
  return null;
}
export function computeItem(item, bodyWeightKg) {
  const pct = completionPct(item.actual ?? null, item.target, item.manualPct ?? null);
  const pctSource = item.manualPct != null ? 'manual' : item.actual != null ? 'calculated' : null;
  const next = { ...item, pct, pctSource };
  const units = itemUnits(next);
  next.kcalEst = units == null ? null : kcalEstimate(next, units, bodyWeightKg);
  next.kcalFinal = next.kcalLogOverride != null ? next.kcalLogOverride : next.kcalEst;
  return next;
}
export function bodyWeightFor(dateKey, measurements) {
  const w = (measurements || []).filter((m) => (m.typeId === 'mt:weight' || m.typeId === 'weight') && Number.isFinite(m.value));
  const cmp = (a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1);
  const sorted = [...w].sort(cmp);
  const before = sorted.filter((m) => m.date <= dateKey);
  const pick = before.length ? before[before.length - 1] : sorted[sorted.length - 1];
  if (!pick) return { kg: DEFAULT_BODY_WEIGHT_KG, source: 'default', date: null, stale: false };
  return { kg: pick.value, source: before.length ? 'on-or-before' : 'latest', date: pick.date, stale: Math.abs(daysBetween(pick.date, dateKey)) > STALE_WEIGHT_DAYS };
}
export function sessionCompletion(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const entered = items.some((i) => i.actual != null || i.manualPct != null);
  if (!entered) return null;
  const sum = items.reduce((a, i) => a + ((i.actual != null || i.manualPct != null) ? (i.pct ?? 0) : 0), 0);
  return Math.round(sum / items.length);
}
export function averagesOverDaysWithData(series) {
  const N = series.length; const vals = series.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const n = vals.length;
  return { avg: n ? vals.reduce((a, b) => a + b, 0) / n : null, n, N };
}
export function resolveTargets(history, dateKey) {
  if (!Array.isArray(history) || !history.length) return null;
  const s = [...history].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  let pick = null;
  for (const e of s) if (e.from <= dateKey) pick = e;
  return pick || s[0];
}
export function waterDerived(glasses, glassMl = 500, targetMl = null) {
  if (glasses == null) return { glasses: null, ml: null, litres: null, pct: null };
  const ml = glasses * glassMl;
  return { glasses, ml, litres: ml / 1000, pct: targetMl ? Math.round(ml / targetMl * 100) : null };
}
export function stepsPercent(steps, goal) { return steps == null || !(goal > 0) ? null : Math.round(steps / goal * 100); }
export function sleepDuration(bedAt, wakeAt) { const d = minutesBetween(bedAt, wakeAt); return d != null && d > 0 ? d : null; }
export function dayTotals(foodLogs) {
  const logs = foodLogs || [];
  const out = { count: logs.length, kcal: null, protein: null, carbs: null, fat: null, fiber: null, fiberPartial: false, proteinPartial: false, carbsPartial: false, fatPartial: false, byMeal: {} };
  if (!logs.length) return out;
  const add = (o, l) => {
    for (const k of NUT) { if (l.totals[k] == null) { if (k !== 'kcal') o[k + 'Partial'] = true; } else o[k] = (o[k] || 0) + l.totals[k]; }
    if (l.totals.fiber == null) o.fiberPartial = true; else o.fiber = (o.fiber || 0) + l.totals.fiber;
  };
  for (const l of logs) {
    add(out, l);
    const key = l.mealId || 'meal:other';
    const m = out.byMeal[key] || (out.byMeal[key] = { label: l.mealLabel || 'Other', count: 0, kcal: 0, protein: null, carbs: null, fat: null, fiber: null, fiberPartial: false, proteinPartial: false, carbsPartial: false, fatPartial: false });
    m.count++; add(m, l);
  }
  const r = (o) => { for (const k of [...NUT, 'fiber']) o[k] = round1(o[k]); };
  r(out); Object.values(out.byMeal).forEach(r);
  return out;
}
export function duplicatePlan(plan, idFn, now = Date.now()) {
  return {
    ...JSON.parse(JSON.stringify(plan)), id: idFn('pl'), name: `${plan.name} (copy)`, rev: 1, basedOn: undefined, supersedes: undefined,
    items: plan.items.map((i) => ({ ...JSON.parse(JSON.stringify(i)), itemId: idFn('it') })), createdAt: now, updatedAt: now
  };
}
export function reorderItems(items, from, to) {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items.slice();
  const a = items.slice(); const [m] = a.splice(from, 1); a.splice(to, 0, m); return a;
}
export function moveItem(items, index, delta) { return reorderItems(items, index, index + delta); }
export function planStepGoalForDay(plan, defaultGoal = DEFAULT_STEP_GOAL) { return plan && plan.stepGoal ? plan.stepGoal : defaultGoal; }
