// S09 Quick add: log calories (and optional macros) without searching. Source: from a label (typical) or my estimate (C-025, C-029). (A4)
import { h, uid } from '../../core/dom.js';
import { Sheet, FormField, MealChips, Button, toast } from '../../ui/components.js';
import { quickAddFoodLog } from '../../core/repo.js';
import { checkFoodNutrition, num, cleanText } from '../../core/validate.js';
import { meals, mealForHour, mealById, confirmSoft, runSave, bindSubmit, add, sheetCtx, finishAdd } from '../daily/shared.js';

export async function quickAddSheet(ctx) {
  const { pid, date } = ctx; const mealList = meals(); const start = (ctx.query.meal && mealById(mealList, ctx.query.meal)) || mealForHour(mealList);
  const meal = { id: start.id, label: start.label };
  const name = FormField({ label: 'Name', type: 'text', value: 'Quick add', maxlength: 80 });
  const kcal = FormField({ label: 'Calories (kcal)', type: 'text', inputmode: 'decimal', required: true });
  const protein = FormField({ label: 'Protein (g, optional)', type: 'text', inputmode: 'decimal' }); const carbs = FormField({ label: 'Carbs (g, optional)', type: 'text', inputmode: 'decimal' });
  const fat = FormField({ label: 'Fat (g, optional)', type: 'text', inputmode: 'decimal' }); const fiber = FormField({ label: 'Fibre (g, optional)', type: 'text', inputmode: 'decimal' });
  let source = 'user';
  const radios = h('div', { class: 'stack-sm', role: 'radiogroup', 'aria-label': 'Where do these numbers come from?' });
  const rid = uid('qa-src');
  for (const [val, label, hint] of [['user', 'My estimate', 'Marked as an estimate everywhere it shows.'], ['label', 'From a label', 'Copied from a pack or menu. Shown as "from label".']]) {
    const input = h('input', { type: 'radio', name: rid, value: val, checked: val === source }); input.addEventListener('change', () => { source = val; });
    add(radios, h('label', { class: 'radio-row' }, input, h('span', null, h('strong', null, label), h('span', { class: 'small muted' }, ` ${hint}`))));
  }
  const mealChips = MealChips({ meals: mealList.map((m) => ({ id: m.id, label: m.label })), selected: meal.id, onChange: (id) => { const m = mealById(mealList, id); meal.id = m.id; meal.label = m.label; } });
  const errs = h('div', { class: 'sheet-errors', role: 'alert' });
  const fields = [kcal, protein, carbs, fat, fiber];
  const dirty = () => fields.some((f) => f.input.value.trim() !== '') || name.input.value !== 'Quick add';
  async function save() {
    errs.textContent = ''; fields.forEach((f) => f.setError(''));
    const vals = { kcal: num(kcal.input.value), protein: num(protein.input.value), carbs: num(carbs.input.value), fat: num(fat.input.value), fiber: num(fiber.input.value) };
    if (vals.kcal === null) { kcal.setError('Enter calories.'); kcal.input.focus(); return; }
    const bad = fields.find((f, i) => { const v = Object.values(vals)[i]; return v !== null && !Number.isFinite(v); });
    if (bad) { bad.setError('Enter a number.'); bad.input.focus(); return; }
    const chk = checkFoodNutrition({ per: { unit: 'serving', amount: 1 }, kcal: vals.kcal, protein: vals.protein ?? 0, carbs: vals.carbs ?? 0, fat: vals.fat ?? 0, fiber: vals.fiber });
    if (!chk.ok) { add(errs, h('p', { class: 'field-error' }, chk.hard[0].message)); return; }
    // Blank macros mean "not entered", so the calories-vs-macros and fibre-vs-carbs checks only make sense when macros were typed.
    if (vals.protein === null && vals.carbs === null && vals.fat === null) chk.soft = chk.soft.filter((x) => x.code !== 'F_ATWATER(SOFT)');
    if (vals.carbs === null) chk.soft = chk.soft.filter((x) => x.code !== 'F_FIBER_GT_CARBS(SOFT)');
    if (vals.protein === null || vals.carbs === null || vals.fat === null) chk.soft = chk.soft.filter((x) => x.code !== 'F_ATWATER(SOFT)'); // F-A8-05: only compare when all three macros were typed
    if (!(await confirmSoft(chk))) return;
    const res = await runSave(() => quickAddFoodLog(pid, { date, name: cleanText(name.input.value) || 'Quick add', ...vals, meal: { id: meal.id, label: meal.label }, sourceType: source }), (l) => add(errs, h('p', { class: 'field-error' }, l[0].message)));
    if (res.ok) { toast(`Added ${Math.round(vals.kcal)} kcal to ${meal.label}`); finishAdd(ctx, date); }
  }
  const fid = uid('quick-form'); const form = h('form', { class: 'stack', id: fid, novalidate: true }, name, kcal, h('div', { class: 'two-fields' }, protein, carbs, fat, fiber), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Meal'), mealChips), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Source'), radios), errs);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  return Sheet({ ctx: sheetCtx(ctx, date), title: 'Quick add', dirty, body: form, footer: bindSubmit(Button({ label: 'Add', kind: 'primary', block: true }), fid) });
}
