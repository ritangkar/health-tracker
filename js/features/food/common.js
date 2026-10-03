// Food helpers for S07-S10 (A4): serving options (incl. grams/ml entry), summaries, chips.
import { Chip } from '../../ui/components.js';
import { servingNutrition, implicitServing } from '../../core/calc.js';
import { fmtNum } from '../../core/units.js';

/** Pseudo serving used for "enter grams / ml". A1's implicit serving is 1 g, but quantity is capped at 50, so grams are logged as multiples of 100 (finding F-A4-03). */
export const amountServing = (unit) => ({ id: `${unit}100`, label: `100 ${unit}`, unit, baseAmount: 100, approx: false, implicit: true });
export const isAmountId = (id) => id === 'g100' || id === 'ml100';
export const AMOUNT_OPTION_ID = 'amt';

/** [{id,label,serving}] shown in the Serving select. Real servings first; g/ml foods also get an amount-entry option. */
export function servingOptions(food) {
  const out = (food.servings || []).map((s) => ({ id: s.id, label: s.label, serving: s }));
  const b = food.nutrition.per.unit;
  if (b === 'g' || b === 'ml') out.push({ id: AMOUNT_OPTION_ID, label: b === 'g' ? 'Enter grams' : 'Enter millilitres', serving: amountServing(b), amount: true });
  return out;
}
export function defaultServing(food) {
  const list = food.servings || [];
  return list.find((s) => s.id === food.defaultServingId) || list[0] || amountServing(food.nutrition.per.unit === 'ml' ? 'ml' : 'g');
}
export const kcalFor = (food, serving) => Math.round(servingNutrition(food, serving || implicitServing(food)).kcal);
export function foodDetail(food) {
  const sv = defaultServing(food);
  return `${sv.label} \u00B7 ${fmtNum(kcalFor(food, sv))} kcal`;
}
const ORIGIN_LABEL = { restaurant: 'restaurant', packaged: 'packaged' };
export function foodChips(food) {
  const c = [];
  if (food.kind === 'recipe') c.push({ label: 'recipe' });
  if (ORIGIN_LABEL[food.origin]) c.push({ label: ORIGIN_LABEL[food.origin] });
  if (food.source && food.source.type === 'label') c.push({ label: 'from label' });
  return c;
}
export const isEstimate = (food) => food.confidence === 'estimate';
export const servingIsApprox = (food, sv) => !!(sv && sv.approx);
export function sourceChips(food) { return [food.cuisine && food.cuisine !== 'other' ? Chip({ label: food.cuisine }) : null].filter(Boolean); }
