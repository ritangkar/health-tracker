// Pure model for recipes (S12, D-027): flat ingredients with frozen nutrition snapshots, per-serving = totals / servings exactly.
// Stored per-serving values keep 6 decimals so per-serving x servings equals the totals (display rounds to 0.1). (A5)
import { servingNutrition, recipeTotals } from '../../core/calc.js';

export const RECIPE_SERVING = { id: 's1', label: '1 serving', unit: 'serving', baseAmount: 1, approx: false };
const KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];
export const r4 = (x) => (x == null ? null : Math.round((x + Number.EPSILON) * 1e4) / 1e4);
export const r6 = (x) => (x == null ? null : Math.round((x + Number.EPSILON) * 1e6) / 1e6);
const scale = (n, k) => { const o = {}; for (const key of KEYS) o[key] = n[key] == null ? null : r4(n[key] * k); return o; };

/** food + serving + qty -> ingredient snapshot. servingBase is kept so a refresh can rebuild g/ml amounts. */
export function ingredientFrom(food, serving, qty) {
  const per = servingNutrition(food, serving); const base = serving.baseAmount ?? 1;
  const nutrition = {}; for (const k of KEYS) nutrition[k] = per[k] == null ? null : r4(per[k] * qty);
  return { foodRef: food.id, name: food.name, servingId: serving.id ?? null, servingLabel: serving.label, servingBase: base, qty, amountBase: r4(base * qty), basisUnit: food.nutrition.per.unit, nutrition, confidence: food.confidence || 'typical' };
}
/** Change a quantity without reading the master again: the snapshot is scaled. */
export function rescaleIngredient(ing, qty) {
  const k = ing.qty > 0 ? qty / ing.qty : 0;
  return { ...ing, qty, amountBase: r4(ing.amountBase * k), nutrition: scale(ing.nutrition, k) };
}
export function totalsOf(ingredients, servings) { return recipeTotals(ingredients, servings); }
export function sumIngredients(ingredients) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }; let known = true;
  for (const i of ingredients) { for (const k of ['kcal', 'protein', 'carbs', 'fat']) t[k] += i.nutrition[k]; if (i.nutrition.fiber == null) known = false; else t.fiber += i.nutrition.fiber; }
  if (!known) t.fiber = null; return t;
}
/** Food record for saveFood. existing keeps id, pid, createdAt and so on when editing. */
export function buildRecipeRecord({ name, category = 'other', cuisine = 'other', notes = null, servings, cookedWeightG = null, ingredients }, existing = null, now = Date.now()) {
  const rt = recipeTotals(ingredients, servings); const per = {}; const tot = {};
  for (const k of KEYS) { per[k] = rt.perServing[k] == null ? null : r6(rt.perServing[k]); tot[k] = rt.totals[k] == null ? null : r6(rt.totals[k]); }
  return { ...(existing || {}), kind: 'recipe', name, aliases: (existing && existing.aliases) || [], category, cuisine, origin: 'home', source: { type: 'recipe-calc', ref: null }, confidence: rt.confidence, system: false,
    nutrition: { per: { amount: 1, unit: 'serving' }, kcal: per.kcal, protein: per.protein, carbs: per.carbs, fat: per.fat, fiber: per.fiber },
    servings: [{ ...RECIPE_SERVING }], defaultServingId: 's1', notes: notes || null,
    recipe: { servings, ingredients, totals: tot, cookedWeightG: cookedWeightG ?? null, refreshedAt: now } };
}
/** Equality helper (QA-010): stored per-serving x servings = stored totals = sum of ingredient snapshots. */
export function recipeEquality(food, tol = 1e-3) {
  const rc = food.recipe; const sv = rc.servings; const sum = sumIngredients(rc.ingredients); const diffs = {}; let max = 0;
  for (const k of KEYS) {
    const a = food.nutrition[k], b = rc.totals[k], c = sum[k];
    if (a == null || b == null || c == null) { diffs[k] = a == null && b == null && c == null ? 0 : Infinity; max = Math.max(max, diffs[k]); continue; }
    diffs[k] = Math.max(Math.abs(a * sv - b), Math.abs(b - c)); max = Math.max(max, diffs[k]);
  }
  return { ok: max <= tol, maxDiff: max, diffs };
}
/** Re-reads each ingredient from the current food list. getFood(ref) -> food|null. Returns the new ingredients and what changed per serving. */
export async function refreshIngredients(ingredients, servings, getFood) {
  const next = []; const missing = [];
  for (const ing of ingredients) {
    const food = await getFood(ing.foodRef);
    if (!food) { next.push(ing); missing.push(ing.name); continue; }
    const sv = (food.servings || []).find((x) => x.id === ing.servingId) || { id: ing.servingId, label: ing.servingLabel, unit: 'g', baseAmount: ing.servingBase ?? (ing.qty ? ing.amountBase / ing.qty : 1) };
    next.push(ingredientFrom(food, sv, ing.qty));
  }
  const a = recipeTotals(ingredients, servings), b = recipeTotals(next, servings); const changes = [];
  for (const k of KEYS) { const x = a.perServing[k], y = b.perServing[k]; if (x != null && y != null && Math.abs(x - y) >= 0.05) changes.push({ key: k, from: x, to: y }); }
  return { ingredients: next, changes, missing };
}
