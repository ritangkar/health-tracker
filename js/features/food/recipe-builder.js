// S12 Recipe builder (sheet). Add flow: #/food/recipe[/<id>]. Manager flow: #/food/manage/recipe[/<id>].
// Flat ingredients, number of servings, live per-serving nutrition = totals / servings (D-027). Ingredient values are frozen at save;
// "Refresh ingredient values" shows what would change and only applies it when confirmed. Recipes cannot contain recipes yet (R_NESTED). (A5)
import { h, mount, clear, debounce, announce } from '../../core/dom.js';
import { Sheet, FormField, SearchField, Stepper, ServingPicker, MacroPreview, MealChips, FoodRow, Button, IconButton, ConfirmDialog, ErrorSummary, toast } from '../../ui/components.js';
import { notFound, setLeaveGuard } from '../../core/router.js';
import { getFood as getCustom, saveFood, addFoodLog } from '../../core/repo.js';
import { search, invalidateOverlay } from '../../core/seed.js';
import { checkName, checkRecipe, checkFoodQty, checkFoodNutrition, cleanText, msg, num } from '../../core/validate.js';
import { fmtNum } from '../../core/units.js';
import { add, meals, mealForHour, mealById, confirmSoft, runSave, sheetCtx, finishAdd, dateHash, ownedOrNull } from '../daily/shared.js';
import { servingOptions, defaultServing, foodDetail, foodChips, isEstimate, AMOUNT_OPTION_ID } from './common.js';
import { categoryChoices, cuisineChoices, selectField, foodById, servingForLog } from './custom-food.js';
import { ingredientFrom, rescaleIngredient, buildRecipeRecord, totalsOf, refreshIngredients } from './recipe-model.js';

const LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fiber: 'Fibre' };
const MAX_INGREDIENTS = 60;

export async function recipeSheet(ctx) {
  const { pid, date } = ctx; const managed = ctx.path.startsWith('/food/manage'); const id = ctx.params.id || null;
  let existing = null; if (id) { existing = await ownedOrNull(getCustom(pid, id)); if (!existing || existing.kind !== 'recipe') notFound(); }
  const R = existing
    ? { name: existing.name, category: existing.category || 'other', cuisine: existing.cuisine || 'other', notes: existing.notes || '', servings: existing.recipe.servings, cooked: existing.recipe.cookedWeightG == null ? '' : String(existing.recipe.cookedWeightG), ingredients: existing.recipe.ingredients.map((i) => ({ ...i })) }
    : { name: '', category: 'other', cuisine: 'other', notes: '', servings: 4, cooked: '', ingredients: [] };
  const mealList = meals(); const meal = { ...mealForHour(mealList) };
  const startSnap = JSON.stringify(R); const dirty = () => JSON.stringify(R) !== startSnap;
  const host = h('div', { class: 'stack' }); let sheetApi = null; const errBox = h('div', { class: 'error-host', role: 'alert' });
  const showErrors = (list) => { clear(errBox); if (list.length) add(errBox, ErrorSummary(list.map((m) => ({ fieldId: m.fieldId || 'recipe-name', message: m.message })))); };

  // ------------------------------------------------------------ main view
  function renderMain() {
    sheetApi && sheetApi.setTitle(existing ? 'Edit recipe' : 'Build recipe');
    const nameF = FormField({ label: 'Recipe name', id: 'recipe-name', type: 'text', value: R.name, maxlength: 80, required: true }); nameF.input.addEventListener('input', () => { R.name = nameF.input.value; });
    const catF = selectField('Category', categoryChoices(), R.category); catF.sel.addEventListener('change', () => { R.category = catF.sel.value; });
    const cuiF = selectField('Cuisine', cuisineChoices(), R.cuisine); cuiF.sel.addEventListener('change', () => { R.cuisine = cuiF.sel.value; });
    const servings = Stepper({ value: R.servings, min: 0.25, max: 100, step: 0.5, label: 'Servings this recipe makes', unit: 'servings', onChange: (v) => { R.servings = v; paintPreview(); } });
    const cookedF = FormField({ label: 'Cooked weight (g, optional)', type: 'text', inputmode: 'decimal', value: R.cooked, suffix: 'g' }); cookedF.input.addEventListener('input', () => { R.cooked = cookedF.input.value; });
    const ta = h('textarea', { class: 'input textarea', rows: 3, maxlength: 500 }); ta.value = R.notes; ta.addEventListener('input', () => { R.notes = ta.value; }); const notesF = FormField({ label: 'Notes (optional)', control: ta });
    const preview = h('div', { class: 'stack-sm', 'aria-live': 'polite' }); const list = h('ul', { class: 'ingredient-list', id: 'recipe-ingredients' });
    function paintPreview() {
      clear(preview);
      if (!R.ingredients.length || !(R.servings > 0)) { add(preview, h('p', { class: 'muted' }, 'Add ingredients to see the nutrition per serving.')); return; }
      const rt = totalsOf(R.ingredients, R.servings);
      add(preview, h('p', { class: 'row-title' }, 'Per serving'), MacroPreview({ kcal: rt.perServing.kcal, protein: rt.perServing.protein, carbs: rt.perServing.carbs, fat: rt.perServing.fat, fiber: rt.perServing.fiber, estimate: rt.confidence === 'estimate', fiberPartial: !rt.fiberKnown }),
        h('p', { class: 'small muted' }, `Whole recipe: ${fmtNum(Math.round(rt.totals.kcal))} kcal for ${fmtNum(R.servings, 2)} ${R.servings === 1 ? 'serving' : 'servings'}. Per serving is the whole recipe divided by the servings.`),
        rt.fiberKnown ? null : h('p', { class: 'small muted' }, 'Fibre is not shown as a number because some ingredients have no fibre value.'));
    }
    function paintList() {
      clear(list);
      R.ingredients.forEach((ing, i) => {
        const kc = h('span', { class: 'small muted num' }, `${fmtNum(Math.round(ing.nutrition.kcal))} kcal`);
        const q = Stepper({ value: ing.qty, min: 0.05, max: 50, step: 0.25, label: `Quantity of ${ing.name}`, onChange: (v) => { if (v === null) return; R.ingredients[i] = rescaleIngredient(R.ingredients[i], v); kc.textContent = `${fmtNum(Math.round(R.ingredients[i].nutrition.kcal))} kcal`; paintPreview(); } });
        add(list, h('li', { class: 'ingredient-row' }, h('div', { class: 'grow' }, h('span', { class: 'row-title' }, ing.name), h('span', { class: 'small muted' }, ` ${ing.servingLabel} `), kc), q, IconButton({ icon: 'trash', label: `Remove ${ing.name}`, onClick: () => { R.ingredients.splice(i, 1); announce(`${ing.name} removed`); paintList(); paintPreview(); } })));
      });
      if (!R.ingredients.length) add(list, h('li', { class: 'muted small' }, 'No ingredients yet.'));
    }
    paintList(); paintPreview();
    const addBtn = Button({ label: R.ingredients.length >= MAX_INGREDIENTS ? 'Ingredient limit reached' : 'Add ingredient', icon: 'plus', kind: 'secondary', disabled: R.ingredients.length >= MAX_INGREDIENTS, onClick: () => { view = 'search'; render(); } });
    const refreshBtn = existing && R.ingredients.length ? Button({ label: 'Refresh ingredient values', icon: 'info', kind: 'ghost', size: 'sm', onClick: doRefresh }) : null;
    const mealChips = !existing && !managed ? MealChips({ meals: mealList.map((m) => ({ id: m.id, label: m.label })), selected: meal.id, onChange: (mid) => { const m = mealById(mealList, mid); meal.id = m.id; meal.label = m.label; } }) : null;
    mount(host, errBox, nameF, h('div', { class: 'two-fields' }, catF, cuiF), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Servings'), servings, h('p', { class: 'small muted' }, 'How many equal servings does the whole recipe make?')), cookedF,
      h('section', { class: 'stack-sm', 'aria-label': 'Ingredients' }, h('h3', { class: 'card-title' }, `Ingredients (${R.ingredients.length})`), list, h('div', { class: 'row-wrap' }, addBtn, refreshBtn)), preview, notesF,
      mealChips ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Meal (for Save and log 1 serving)'), mealChips) : null, h('p', { class: 'small muted' }, 'Ingredient values are saved with the recipe. Changing a food later does not change this recipe unless you refresh it. ', h('a', { href: '#/food/manage' }, 'Manage my foods')));
  }
  async function doRefresh() {
    const r = await refreshIngredients(R.ingredients, R.servings, (ref) => foodById(pid, ref).catch(() => null));
    if (!r.changes.length && !r.missing.length) { toast('Ingredient values are already up to date'); return; }
    const lines = r.changes.map((c) => `${LABEL[c.key]} per serving ${fmtNum(c.from, 1)} to ${fmtNum(c.to, 1)}`); if (r.missing.length) lines.push(`Not found any more (kept as saved): ${r.missing.join(', ')}`);
    if (await ConfirmDialog({ title: 'Update ingredient values?', message: `${lines.join('. ')}. Entries you already logged do not change.`, confirmLabel: 'Update', cancelLabel: 'Keep as saved' })) { R.ingredients = r.ingredients; render(); toast('Ingredient values updated. Save to keep them.'); }
  }

  // ------------------------------------------------------------ ingredient picker
  let view = 'main'; let picked = null;
  function renderSearch() {
    sheetApi && sheetApi.setTitle('Add ingredient');
    const list = h('ul', { class: 'result-list' }); const status = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' }); let seq = 0;
    async function run() {
      const my = ++seq; const q = field.input.value.trim(); clear(list); status.textContent = '';
      if (!q) { status.textContent = 'Type a food name. Recipes cannot be used as ingredients yet.'; return; }
      let res = []; try { res = await search(q, pid, 40); } catch { status.textContent = 'Search failed. Try again.'; return; }
      if (my !== seq) return;
      const foods = res.filter((r) => r.food.kind !== 'recipe');
      for (const r of foods) add(list, FoodRow({ name: r.food.name, alias: r.matchedAlias || null, detail: foodDetail(r.food), chips: foodChips(r.food), estimate: isEstimate(r.food), onSelect: () => { picked = r.food; view = 'qty'; render(); } }));
      status.textContent = !foods.length ? 'No match. Create it first with Create custom food.' : res.length > foods.length ? msg('R_NESTED') : '';
    }
    const debounced = debounce(run, 150);
    const field = SearchField({ label: 'Search ingredients', placeholder: 'Search foods, for example rice, onion, oil', autofocus: true, onInput: debounced, onSubmit: run });
    mount(host, field, status, list, Button({ label: 'Back to recipe', kind: 'ghost', icon: 'back', onClick: () => { view = 'main'; render(); } }));
    field.input.focus();
  }
  function renderQty() {
    const food = picked; sheetApi && sheetApi.setTitle(food.name);
    const opts = servingOptions(food); const def = defaultServing(food); let optId = (opts.find((o) => o.serving.id === def.id) || opts[0]).id; let qty = 1;
    const prev = h('div', { class: 'stack-sm', 'aria-live': 'polite' }); const err = h('p', { class: 'field-error', role: 'alert' });
    const cur = () => opts.find((o) => o.id === optId) || opts[0];
    const paint = () => { const o = cur(); const ing = ingredientFrom(food, o.serving, qty ?? 0); mount(prev, MacroPreview({ ...ing.nutrition, estimate: isEstimate(food) }), o.amount ? h('p', { class: 'small muted' }, '1 means 100 g or 100 ml. Type 1.5 for 150.') : null); };
    const sp = ServingPicker({ servings: opts.map((o) => ({ id: o.id, label: o.label })), value: optId, onChange: (v) => { optId = v; paint(); } });
    const st = Stepper({ value: qty, min: 0.05, max: 50, step: 0.25, label: 'Quantity', onChange: (v) => { qty = v; paint(); } }); paint();
    const addBtn = Button({ label: 'Add to recipe', kind: 'primary', block: true, onClick: () => {
      err.textContent = ''; if (qty === null) { err.textContent = 'Enter a quantity.'; return; }
      if (R.ingredients.length >= MAX_INGREDIENTS) { err.textContent = msg('R_INGREDIENTS'); return; }
      const o = cur(); const q = checkFoodQty(qty, o.serving.baseAmount, null, food.nutrition.per.unit !== 'serving'); if (!q.ok) { err.textContent = q.hard[0].message; return; }
      R.ingredients.push(ingredientFrom(food, o.serving, qty)); announce(`${food.name} added`); picked = null; view = 'main'; render();
    } });
    mount(host, h('p', { class: 'muted' }, foodDetail(food)), sp, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How much goes into the whole recipe?'), st), prev, err, addBtn, Button({ label: 'Back to results', kind: 'ghost', icon: 'back', onClick: () => { view = 'search'; render(); } }));
  }
  function render() { if (view === 'search') renderSearch(); else if (view === 'qty') renderQty(); else renderMain(); }

  // ------------------------------------------------------------ save
  function collect() {
    const errors = []; const n = checkName(R.name, 80); if (!n.ok) errors.push({ fieldId: 'recipe-name', message: n.hard[0].message });
    const rc = checkRecipe({ servings: R.servings, ingredients: R.ingredients }); for (const x of rc.hard) errors.push({ fieldId: x.code === 'R_SERVINGS_RANGE' ? 'recipe-name' : 'recipe-ingredients', message: x.message });
    let cooked = null; if (String(R.cooked).trim() !== '') { cooked = num(R.cooked); if (!Number.isFinite(cooked) || cooked <= 0 || cooked > 20000) errors.push({ fieldId: 'recipe-name', message: msg('V_RANGE', { field: 'Cooked weight', min: 1, max: 20000 }) }); }
    return { errors, cooked };
  }
  async function submit(logNow) {
    if (view !== 'main') { view = 'main'; render(); }
    const { errors, cooked } = collect(); showErrors(errors); if (errors.length) return;
    const rec = buildRecipeRecord({ name: cleanText(R.name), category: R.category, cuisine: R.cuisine, notes: cleanText(R.notes) || null, servings: R.servings, cookedWeightG: cooked, ingredients: R.ingredients }, existing);
    const nu = checkFoodNutrition(rec.nutrition); if (!nu.ok) { showErrors([{ fieldId: 'recipe-name', message: nu.hard[0].message }]); return; }
    if (!(await confirmSoft({ soft: nu.soft }))) return;
    const res = await runSave(() => saveFood(pid, rec), (l) => showErrors(l.map((x) => ({ message: x.message })))); if (!res.ok) return;
    const saved = res.value; invalidateOverlay(pid);
    if (logNow) { const lg = await runSave(() => addFoodLog(pid, { date, food: saved, serving: servingForLog(saved), qty: 1, meal: { id: meal.id, label: meal.label } })); if (!lg.ok) return; toast(`Saved ${saved.name} and added 1 serving to ${meal.label}`); finishAdd(ctx, date); return; }
    toast(`Saved ${saved.name}`);
    if (!managed && !existing) { setLeaveGuard(null); ctx.replace(dateHash(`/food/add/serving/${encodeURIComponent(saved.id)}`, date, { from: ctx.query.from })); return; }
    finishAdd(ctx, date);
  }
  // The body is a div, not a form: SearchField is a form, and a nested form submit would save the recipe by accident.
  const saveBtn = Button({ label: existing ? 'Save changes' : 'Save recipe', kind: 'primary', block: true, onClick: () => submit(false) });
  const logBtn = !existing && !managed ? Button({ label: 'Save and log 1 serving', kind: 'secondary', block: true, onClick: () => submit(true) }) : null;
  sheetApi = Sheet({ ctx: sheetCtx(ctx, date), title: existing ? 'Edit recipe' : 'Build recipe', size: 'full', dirty, body: host, footer: h('div', { class: 'stack-sm' }, saveBtn, logBtn) });
  render();
  return sheetApi;
}
