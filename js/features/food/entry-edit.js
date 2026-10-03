// S10 Edit food entry. Quantity and meal recompute from the entry's OWN snapshot (D-026). Changing the serving takes a new snapshot
// from the food's current values and says so first. (A4)
import { h, uid } from '../../core/dom.js';
import { Sheet, FormField, Stepper, MealChips, MacroPreview, EstimateBadge, ServingPicker, Button, toast } from '../../ui/components.js';
import { notFound, invalidate } from '../../core/router.js';
import { getFoodLog, editFoodLog, changeFoodLogServing, deleteFoodLog, restoreFoodLog } from '../../core/repo.js';
import { getFood } from '../../core/seed.js';
import { totalsFor } from '../../core/calc.js';
import { checkFoodQty } from '../../core/validate.js';
import { fmtNum } from '../../core/units.js';
import { meals, mealById, confirmSoft, runSave, bindSubmit, add, ownedOrNull } from '../daily/shared.js';
import { amountServing } from './common.js';

export async function entrySheet(ctx) {
  const { pid } = ctx; const log = await ownedOrNull(getFoodLog(pid, ctx.params.logId)); if (!log) notFound();
  const mealList = meals(); const meal = { id: log.mealId || 'meal:other', label: log.mealLabel || 'Other' };
  const master = log.foodRef ? await getFood(log.foodRef, pid) : null;
  const preview = h('div', null); const errs = h('div', { class: 'sheet-errors', role: 'alert' });
  let servingChoice = null;   // {serving} when the person picked a different serving
  const stepper = Stepper({ value: log.qty, min: 0.25, max: 50, step: 0.25, label: 'Quantity', unit: 'servings', onChange: () => update() });
  function perOf() { return servingChoice ? null : log.per1serving; }
  function update() {
    const q = stepper.getValue(); preview.textContent = '';
    if (q === null) { add(preview, MacroPreview({})); return; }
    const per = perOf() || servingNutritionFor(servingChoice.serving);
    const t = totalsFor(per, q);
    add(preview, MacroPreview({ kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, fiber: t.fiber, estimate: log.confidence === 'estimate', fiberPartial: t.fiber === null }));
  }
  function servingNutritionFor(sv) { const n = master.nutrition; const f = (sv.baseAmount ?? 1) / n.per.amount; const r = (x) => x * f; return { kcal: r(n.kcal), protein: r(n.protein), carbs: r(n.carbs), fat: r(n.fat), fiber: n.fiber == null ? null : r(n.fiber) }; }
  const mealChips = MealChips({ meals: mealList.map((m) => ({ id: m.id, label: m.label })), selected: meal.id, onChange: (id) => { const m = mealById(mealList, id); meal.id = m.id; meal.label = m.label; } });
  const note = FormField({ label: 'Note (optional)', control: h('textarea', { class: 'input', rows: 2, maxlength: 500 }, log.note || '') });
  // serving change (only when the food still exists)
  const serveBox = h('div', { class: 'stack-sm' });
  if (master) {
    const opts = (master.servings || []).map((s) => ({ id: s.id, label: s.label, serving: s }));
    if (master.nutrition.per.unit === 'g' || master.nutrition.per.unit === 'ml') { const a = amountServing(master.nutrition.per.unit); opts.push({ id: a.id, label: a.label, serving: a }); }
    const reveal = Button({ label: 'Change serving', kind: 'ghost', size: 'sm', onClick: () => {
      reveal.remove();
      const cur = opts.find((o) => o.id === log.servingId) || opts[0];
      const pk = ServingPicker({ servings: opts.map((o) => ({ id: o.id, label: o.label })), value: cur.id, onChange: (id) => { const o = opts.find((x) => x.id === id); servingChoice = id === log.servingId ? null : { serving: o.serving }; update(); } });
      add(serveBox, h('p', { class: 'warn-box small' }, 'Changing the serving takes the food\u2019s current values, not the values saved with this entry.'), pk);
    } });
    add(serveBox, reveal);
  }
  update();
  const dirty = () => stepper.getValue() !== log.qty || meal.id !== (log.mealId || 'meal:other') || note.input.value !== (log.note || '') || !!servingChoice;
  async function save() {
    errs.textContent = ''; const q = stepper.getValue();
    const per = perOf() || (servingChoice && servingNutritionFor(servingChoice.serving));
    const base = servingChoice ? servingChoice.serving.baseAmount : log.servingBaseAmount;
    const chk = checkFoodQty(q, base, q === null || !per ? null : totalsFor(per, q).kcal, log.basisUnit !== 'serving');
    if (!chk.ok) { add(errs, h('p', { class: 'field-error' }, chk.hard[0].message)); return; }
    if (!(await confirmSoft(chk))) return;
    const res = await runSave(async () => {
      if (servingChoice) await changeFoodLogServing(pid, log.id, { food: master, serving: servingChoice.serving, qty: q });
      await editFoodLog(pid, log.id, servingChoice ? { mealId: meal.id, mealLabel: meal.label, note: note.input.value.trim() || null } : { qty: q, mealId: meal.id, mealLabel: meal.label, note: note.input.value.trim() || null });
    }, (l) => add(errs, h('p', { class: 'field-error' }, l[0].message)));
    if (res.ok) { toast('Entry saved'); ctx.close({ refresh: true }); }
  }
  const remove = Button({ label: 'Remove this entry', kind: 'ghost', icon: 'trash', onClick: async () => {
    const res = await runSave(() => deleteFoodLog(pid, log.id)); if (!res.ok) return; const rec = res.value;
    ctx.close({ refresh: true });
    toast(`Removed ${log.foodName}`, { undo: async () => { await runSave(() => restoreFoodLog(pid, rec)); await invalidate(); } });
  } });
  const fid = uid('entry-form');
  const form = h('form', { class: 'stack', id: fid, novalidate: true },
    h('div', null, h('p', { class: 'food-serving-name' }, log.foodName), h('p', { class: 'small muted' }, `Saved as ${fmtNum(log.qty, 2)} \u00D7 ${log.servingLabel}`), log.confidence === 'estimate' ? EstimateBadge({ kind: 'est' }) : null),
    stepper, serveBox, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Meal'), mealChips), preview, note, errs, remove);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  return Sheet({ ctx, title: 'Edit entry', dirty, body: form, footer: bindSubmit(Button({ label: 'Save', kind: 'primary', block: true }), fid) });
}
