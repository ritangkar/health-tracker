// S11 Custom food form (sheet). Add flow: #/food/custom[/<id>] (from Add food). Manager flow: #/food/manage/food[/<id>].
// Custom foods go through the same validator as everything else and appear in normal search (D-010, D-027, C-025). (A5)
import { h, uid } from '../../core/dom.js';
import { Sheet, FormField, MealChips, Button, EstimateBadge, ErrorSummary, toast } from '../../ui/components.js';
import { notFound, setLeaveGuard } from '../../core/router.js';
import { getFood as getCustom, saveFood, addFoodLog } from '../../core/repo.js';
import { getFood as getAny, listCategories, invalidateOverlay } from '../../core/seed.js';
import { add, meals, mealForHour, mealById, confirmSoft, runSave, bindSubmit, sheetCtx, finishAdd, dateHash, ownedOrNull } from '../daily/shared.js';
import { amountServing } from './common.js';
import { BASES, SERVING_UNITS, ORIGINS, emptyForm, formFromFood, parseForm } from './custom-model.js';

const FALLBACK_CATS = ['grain-rice', 'bread-roti', 'dal-legume', 'veg-dish', 'paneer-dairy-dish', 'egg', 'chicken', 'mutton-red-meat', 'fish-seafood', 'fruit', 'veg-raw', 'dairy', 'beverage', 'snack', 'sweet-dessert', 'fast-food', 'pizza-burger-sandwich', 'noodles-rice-dish', 'soup-salad', 'oil-spice-condiment', 'packaged', 'other'].map((id) => ({ id, label: id.replace(/-/g, ' ') }));
const FALLBACK_CUISINES = ['indian', 'bengali', 'chinese', 'japanese', 'thai', 'continental', 'italian', 'american', 'other'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
export function categoryChoices() { let l = []; try { l = listCategories(); } catch { l = []; } const c = l.filter((x) => x.group === 'category').sort((a, b) => a.sortOrder - b.sortOrder).map((x) => ({ id: x.id, label: x.label })); return c.length ? c : FALLBACK_CATS; }
export function cuisineChoices() { let l = []; try { l = listCategories(); } catch { l = []; } const c = l.filter((x) => x.group === 'cuisine').sort((a, b) => a.sortOrder - b.sortOrder).map((x) => ({ id: x.cuisine || String(x.id).replace('cuisine:', ''), label: x.label })); return c.length ? c : FALLBACK_CUISINES; }
export const selectField = (label, options, value, extra = {}) => { const sel = h('select', { class: 'input select' }, options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.label))); const f = FormField({ label, control: sel, ...extra }); f.sel = sel; return f; };
export function radioGroup(label, options, value, onChange) {
  const name = uid('rg'); const wrap = h('div', { class: 'stack-sm', role: 'radiogroup', 'aria-label': label }); let cur = value;
  for (const o of options) { const input = h('input', { type: 'radio', name, value: o.id, checked: o.id === cur }); input.addEventListener('change', () => { cur = o.id; if (onChange) onChange(cur); }); add(wrap, h('label', { class: 'radio-row' }, input, h('span', null, h('strong', null, o.label), o.hint ? h('span', { class: 'small muted' }, ` ${o.hint}`) : null))); }
  wrap.getValue = () => cur; return wrap;
}
/** Seed ids (f:...) come from the seed list; everything else is a record of this profile. Foreign ids become Not found. */
export async function foodById(pid, id) { if (String(id).startsWith('f:')) return (await getAny(id, pid)) || null; return ownedOrNull(getCustom(pid, id)); }
export const servingForLog = (food) => (food.servings && food.servings[0]) || amountServing(food.nutrition.per.unit === 'ml' ? 'ml' : 'g');

export async function customFoodSheet(ctx) {
  const { pid, date } = ctx; const managed = ctx.path.startsWith('/food/manage'); const id = ctx.params.id || null;
  let existing = null; if (id) { existing = await foodById(pid, id); if (!existing || existing.kind === 'recipe') notFound(); }
  const seedEdit = !!(existing && String(existing.id).startsWith('f:'));
  const F = existing ? formFromFood(existing) : emptyForm();
  const mealList = meals(); const meal = { ...(mealForHour(mealList)) };
  const fields = {};
  fields.name = FormField({ label: 'Name', type: 'text', value: F.name, maxlength: 80, required: true });
  fields.aliases = FormField({ label: 'Other names (optional)', type: 'text', value: F.aliases, hint: 'Separate with commas. They help the search find it.' });
  fields.category = selectField('Category', categoryChoices(), F.category); fields.cuisine = selectField('Cuisine', cuisineChoices(), F.cuisine);
  const basis = radioGroup('Nutrition values are given', BASES.map((b) => ({ id: b.id, label: b.label })), F.basis, () => syncBasis());
  fields.kcal = FormField({ label: 'Calories (kcal)', type: 'text', inputmode: 'decimal', value: F.kcal, required: true });
  fields.protein = FormField({ label: 'Protein (g)', type: 'text', inputmode: 'decimal', value: F.protein, required: true });
  fields.carbs = FormField({ label: 'Carbs (g)', type: 'text', inputmode: 'decimal', value: F.carbs, required: true, hint: 'Carbs include fibre.' });
  fields.fat = FormField({ label: 'Fat (g)', type: 'text', inputmode: 'decimal', value: F.fat, required: true });
  fields.fiber = FormField({ label: 'Fibre (g, optional)', type: 'text', inputmode: 'decimal', value: F.fiber, hint: 'Leave blank if unknown. Blank is not the same as 0.' });
  const sHint = h('p', { class: 'small muted' });
  fields.servingLabel = FormField({ label: 'Serving name', type: 'text', value: F.servingLabel, maxlength: 60, hint: 'Include the unit, for example 1 bowl or 1 piece.' });
  fields.servingUnit = selectField('Serving unit', SERVING_UNITS, F.servingUnit);
  fields.servingBase = FormField({ label: 'How much is one serving?', type: 'text', inputmode: 'decimal', value: F.servingBase, suffix: 'g' });
  fields.origin = selectField('Where is it from?', ORIGINS, F.origin);
  const source = radioGroup('Where do these numbers come from?', [{ id: 'user', label: 'My estimate', hint: 'Shown with an est. tag everywhere.' }, { id: 'label', label: 'From a label', hint: 'Copied from a pack or menu. Shown as \u201Cfrom label\u201D.' }], F.sourceKind);
  const ta = h('textarea', { class: 'input textarea', rows: 3, maxlength: 500 }); ta.value = F.notes; fields.notes = FormField({ label: 'Notes (optional)', control: ta });
  const mealChips = !existing && !managed ? MealChips({ meals: mealList.map((m) => ({ id: m.id, label: m.label })), selected: meal.id, onChange: (mid) => { const m = mealById(mealList, mid); meal.id = m.id; meal.label = m.label; } }) : null;
  const sBox = h('div', { class: 'stack' }); const errBox = h('div', { class: 'error-host' });
  function syncBasis() {
    const b = basis.getValue(); const unit = b === 'serving' ? '' : b; sBox.textContent = '';
    if (b === 'serving') { sHint.textContent = 'The values above are for one serving. Name it, for example 1 plate or 1 piece.'; add(sBox, sHint, fields.servingLabel, fields.servingUnit); }
    else { sHint.textContent = `Optional. Add a serving so you can log by bowl, cup or piece. Without one you log by ${unit === 'ml' ? 'millilitres' : 'grams'}.`; const suf = fields.servingBase.querySelector('.field-suffix'); if (suf) suf.textContent = unit; add(sBox, sHint, fields.servingLabel, fields.servingUnit, fields.servingBase); }
  }
  syncBasis();
  const read = () => ({ name: fields.name.input.value, aliases: fields.aliases.input.value, category: fields.category.sel.value, cuisine: fields.cuisine.sel.value, origin: fields.origin.sel.value, sourceKind: source.getValue(), basis: basis.getValue(), kcal: fields.kcal.input.value, protein: fields.protein.input.value, carbs: fields.carbs.input.value, fat: fields.fat.input.value, fiber: fields.fiber.input.value, servingLabel: fields.servingLabel.input.value, servingUnit: fields.servingUnit.sel.value, servingBase: fields.servingBase.input.value, notes: ta.value });
  const start = JSON.stringify(read()); const dirty = () => JSON.stringify(read()) !== start;
  function showErrors(errors) {
    for (const [k, f] of Object.entries(fields)) { const e = errors.find((x) => x.field === k); if (f.setError) f.setError(e ? e.message : ''); }
    const loose = errors.filter((e) => !fields[e.field]);
    errBox.textContent = ''; if (errors.length) add(errBox, ErrorSummary(errors.map((e) => ({ fieldId: (fields[e.field] || fields.name).fieldId, message: e.message }))));
    if (loose.length) add(errBox, h('p', { class: 'field-error' }, loose[0].message));
    const first = errors.find((e) => fields[e.field]); if (first) (fields[first.field].input || fields[first.field].sel).focus();
  }
  async function submit(logNow) {
    const { record, errors, soft } = parseForm(read(), existing); showErrors(errors); if (errors.length) return;
    if (!(await confirmSoft({ soft }))) return;
    const res = await runSave(() => saveFood(pid, record), (l) => showErrors(l.map((x) => ({ field: 'form', message: x.message }))));
    if (!res.ok) return;
    const saved = res.value; invalidateOverlay(pid);
    if (logNow) {
      const lg = await runSave(() => addFoodLog(pid, { date, food: saved, serving: servingForLog(saved), qty: 1, meal: { id: meal.id, label: meal.label } }));
      if (!lg.ok) return;
      toast(`Saved ${saved.name} and added it to ${meal.label}`); finishAdd(ctx, date); return;
    }
    toast(`Saved ${saved.name}`);
    if (!managed && !existing) { setLeaveGuard(null); ctx.replace(dateHash(`/food/add/serving/${encodeURIComponent(saved.id)}`, date, { from: ctx.query.from })); return; }
    finishAdd(ctx, date);
  }
  const fid = uid('custom-food-form');
  const note = seedEdit ? h('div', { class: 'warn-box' }, 'This edits your own copy. The built-in food is not changed, and entries you already logged keep their values.') : existing ? h('p', { class: 'small muted' }, 'Entries you already logged keep the values they had when you logged them.') : null;
  const form = h('form', { class: 'stack', id: fid, novalidate: true }, note, errBox, fields.name, fields.aliases, h('div', { class: 'two-fields' }, fields.category, fields.cuisine),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Nutrition values are given'), basis), h('div', { class: 'two-fields' }, fields.kcal, fields.protein, fields.carbs, fields.fat, fields.fiber), sBox,
    fields.origin, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Source'), source), fields.notes,
    mealChips ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Meal (for Save and log now)'), mealChips) : null,
    h('p', { class: 'small muted' }, h('a', { href: '#/food/manage' }, 'Manage my foods')));
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  const saveBtn = bindSubmit(Button({ label: existing ? 'Save changes' : 'Save', kind: 'primary', block: true }), fid);
  const logBtn = !existing && !managed ? Button({ label: 'Save and log now', kind: 'secondary', block: true, onClick: () => submit(true) }) : null;
  return Sheet({ ctx: sheetCtx(ctx, date), title: existing ? (seedEdit ? 'Edit built-in food' : 'Edit food') : 'Create custom food', size: 'full', dirty, body: form, footer: h('div', { class: 'stack-sm' }, saveBtn, logBtn) });
}
