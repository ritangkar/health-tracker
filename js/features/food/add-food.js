// S08 Add food: search-first full-height sheet (D-046) and the serving step. (A4)
//   #/food/add                      search, tabs Recent / Frequent / Favourites / Categories, entries Quick add / Create custom food / Build recipe
//   #/food/add/serving/<foodRef>    serving selector, quantity stepper, meal chips, live macro preview, Add / Add and keep searching
// The serving step REPLACES the search entry in history so Back and Add both land on the Food tab with a clean stack.
import { h, uid, debounce } from '../../core/dom.js';
import { Sheet, SearchField, Tabs, FoodRow, Button, Chip, Stepper, ServingPicker, MealChips, MacroPreview, EstimateBadge, EmptyState, toast } from '../../ui/components.js';
import { notFound } from '../../core/router.js';
import { search, browseCategory, getFood, listCategories } from '../../core/seed.js';
import { listPrefs, toggleFavourite, addFoodLog } from '../../core/repo.js';
import { foodLogSnapshot } from '../../core/calc.js';
import { checkFoodQty } from '../../core/validate.js';
import { fmtNum } from '../../core/units.js';
import { dateHash, meals, mealForHour, mealById, confirmSoft, runSave, bindSubmit, routeExists, r1, add, sheetCtx, finishAdd } from '../daily/shared.js';
import { servingOptions, defaultServing, foodDetail, foodChips, isEstimate, servingIsApprox, AMOUNT_OPTION_ID, isAmountId } from './common.js';

const memory = { q: '', tab: 'recent', category: null, cuisine: null };
export const resetAddFoodMemory = () => { memory.q = ''; memory.tab = 'recent'; memory.category = null; memory.cuisine = null; }; // F-A8-03: a finished add starts the next search clean
const PAGE = 60;
const servingHash = (food, date, meal, from) => dateHash(`/food/add/serving/${encodeURIComponent(food.id)}`, date, { meal, from });

// ================================================================ search
export async function addFoodSheet(ctx) {
  const { pid, date } = ctx; const mealQ = ctx.query.meal || undefined;
  let prefs = await listPrefs(pid); let prefMap = new Map(prefs.map((p) => [p.foodRef, p]));
  const [hasCustom, hasRecipe] = await Promise.all([routeExists('/food/custom'), routeExists('/food/recipe')]);
  const status = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
  const list = h('ul', { class: 'result-list' }); const catBar = h('div', { class: 'stack-sm' }); const more = h('div', { class: 'row-wrap' });
  let current = []; let shown = PAGE; let seq = 0;

  const field = SearchField({ label: 'Search foods', placeholder: 'Search foods, for example dal, roti, macher jhol', value: memory.q, autofocus: true, onInput: () => { shown = PAGE; debounced(); }, onSubmit: () => run() });
  const tabs = Tabs({ tabs: [{ id: 'recent', label: 'Recent' }, { id: 'frequent', label: 'Frequent' }, { id: 'fav', label: 'Favourites' }, { id: 'cat', label: 'Categories' }], selected: memory.tab, label: 'Food lists', onSelect: (id) => { memory.tab = id; shown = PAGE; run(); } });

  const entries = h('div', { class: 'add-entries' },
    Button({ label: 'Quick add', icon: 'flame', size: 'sm', onClick: () => ctx.replace(dateHash('/food/quick', date, { meal: mealQ, from: ctx.query.from })) }),
    hasCustom ? Button({ label: 'Create custom food', icon: 'plus', size: 'sm', onClick: () => ctx.replace(dateHash('/food/custom', date, { from: ctx.query.from })) }) : null,
    hasRecipe ? Button({ label: 'Build recipe', icon: 'plus', size: 'sm', onClick: () => ctx.replace(dateHash('/food/recipe', date, { from: ctx.query.from })) }) : null);

  function row(food, alias) {
    const pref = prefMap.get(food.id); const fav = !!(pref && pref.fav); const sv = defaultServing(food);
    const r = FoodRow({ name: food.name, alias, detail: foodDetail(food), chips: foodChips(food), estimate: isEstimate(food), approx: servingIsApprox(food, sv), fav,
      onSelect: () => { memory.q = field.input.value; ctx.replace(servingHash(food, date, mealQ, ctx.query.from)); }, onToggleFav: async (ev) => {
        const btn = ev.currentTarget; const res = await runSave(() => toggleFavourite(pid, food.id)); if (!res.ok) return;
        prefMap.set(food.id, res.value); const on = !!res.value.fav;
        btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('is-fav', on); btn.setAttribute('aria-label', on ? `Remove ${food.name} from favourites` : `Add ${food.name} to favourites`);
        if (memory.tab === 'fav' && !field.input.value.trim() && !on) run();
      } });
    return r;
  }
  function paintList(items, emptyNode) {
    current = items; list.textContent = ''; more.textContent = '';
    if (!items.length) { add(list, h('li', { class: 'result-empty' }, emptyNode)); return; }
    for (const it of items.slice(0, shown)) add(list, row(it.food, it.alias));
    if (items.length > shown) add(more, Button({ label: `Show more (${items.length - shown} left)`, kind: 'secondary', onClick: () => { shown += PAGE; paintList(current, emptyNode); } }));
  }
  const resolve = async (refs) => (await Promise.all(refs.map(async (p) => ({ food: await getFood(p.foodRef, pid), alias: null })))).filter((x) => x.food);

  async function run() {
    const my = ++seq; const q = field.input.value.trim(); memory.q = field.input.value; catBar.textContent = '';
    tabs.hidden = !!q;
    if (q) {
      const res = await search(q, pid, 80); if (my !== seq) return;
      paintList(res.map((r) => ({ food: r.food, alias: r.matchedAlias })), emptyForSearch(q));
      status.textContent = res.length ? `${res.length} ${res.length === 1 ? 'result' : 'results'}` : 'No matches'; return;
    }
    status.textContent = '';
    prefs = await listPrefs(pid); prefMap = new Map(prefs.map((p) => [p.foodRef, p]));
    if (memory.tab === 'recent') { const rs = prefs.filter((p) => p.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 30); const items = await resolve(rs); if (my === seq) paintList(items, empty('clock', 'No recent foods yet', 'Foods you log show up here so the next time takes one tap.')); }
    else if (memory.tab === 'frequent') { const rs = prefs.filter((p) => p.useCount > 0).sort((a, b) => b.useCount - a.useCount || (b.lastUsedAt || 0) - (a.lastUsedAt || 0)).slice(0, 30); const items = await resolve(rs); if (my === seq) paintList(items, empty('flame', 'Nothing frequent yet', 'Your most used foods collect here.')); }
    else if (memory.tab === 'fav') { const rs = prefs.filter((p) => p.fav); const items = await resolve(rs); if (my === seq) paintList(items, empty('heart', 'No favourites yet', 'Tap the heart next to a food to keep it here.')); }
    else await runCategories(my);
  }
  async function runCategories(my) {
    const all = listCategories(); const cats = all.filter((c) => c.group === 'category').sort((a, b) => a.sortOrder - b.sortOrder); const cuisines = all.filter((c) => c.group === 'cuisine').sort((a, b) => a.sortOrder - b.sortOrder);
    add(catBar, h('div', { class: 'chips', role: 'group', 'aria-label': 'Food categories' }, cats.map((c) => Chip({ label: c.label, selected: memory.category === c.id, onClick: () => { memory.category = memory.category === c.id ? null : c.id; shown = PAGE; run(); } }))));
    if (memory.category) add(catBar, h('div', { class: 'chips', role: 'group', 'aria-label': 'Cuisine' }, cuisines.map((c) => { const key = c.cuisine || c.id.replace(/^cuisine:/, ''); return Chip({ label: c.label, selected: memory.cuisine === key, onClick: () => { memory.cuisine = memory.cuisine === key ? null : key; shown = PAGE; run(); } }); })));
    if (!memory.category) { list.textContent = ''; more.textContent = ''; status.textContent = 'Choose a category to browse.'; return; }
    const foods = await browseCategory(pid, memory.category, memory.cuisine); if (my !== seq) return;
    paintList(foods.map((f) => ({ food: f, alias: null })), empty('food', 'Nothing in this group', 'Try another cuisine or category.'));
    status.textContent = `${foods.length} ${foods.length === 1 ? 'food' : 'foods'}`;
  }
  const empty = (ic, title, text) => EmptyState({ icon: ic === 'clock' ? 'calendar' : ic, title, text, headingLevel: 3 });
  const emptyForSearch = (q) => EmptyState({ icon: 'search', title: 'No match', text: `Nothing found for "${q}". You can log it with Quick add${hasCustom ? ' or create a custom food' : ''}.`, headingLevel: 3,
    action: hasCustom ? { label: 'Create custom food', onClick: () => ctx.replace(dateHash('/food/custom', date, { from: ctx.query.from })) } : { label: 'Quick add', onClick: () => ctx.replace(dateHash('/food/quick', date, { meal: mealQ, from: ctx.query.from })) } });
  const debounced = debounce(run, 120); ctx.onCleanup(() => debounced.cancel());
  await run();
  const body = h('div', { class: 'food-search-sheet stack-sm' }, field, entries, tabs, catBar, status, list, more);
  const sheet = Sheet({ ctx: sheetCtx(ctx, date), title: 'Add food', size: 'full', body });
  return sheet;
}

// ================================================================ serving step
export async function servingSheet(ctx) {
  const { pid, date } = ctx; const mealQ = ctx.query.meal || undefined;
  const food = await getFood(ctx.params.foodRef, pid); if (!food) notFound();
  const pref = (await listPrefs(pid)).find((p) => p.foodRef === food.id) || null;
  const mealList = meals(); const startMeal = (mealQ && mealById(mealList, mealQ)) || mealForHour(mealList);
  const options = servingOptions(food); const hasAmount = options.some((o) => o.id === AMOUNT_OPTION_ID);
  // prefill: last serving and quantity (D-046), else the food's default
  let optId = defaultServing(food).id; let qty = 1;
  if (pref && pref.lastServingId) {
    if (isAmountId(pref.lastServingId) && hasAmount) { optId = AMOUNT_OPTION_ID; qty = Math.round((pref.lastQty || 1) * 100); }
    else if (options.some((o) => o.id === pref.lastServingId)) { optId = pref.lastServingId; qty = pref.lastQty || 1; }
  }
  if (!options.some((o) => o.id === optId)) optId = options[0].id;
  if (optId === AMOUNT_OPTION_ID && !(pref && isAmountId(pref.lastServingId))) qty = 100;

  const meal = { id: startMeal.id, label: startMeal.label };
  const preview = h('div', { class: 'stack-sm' }); const amountLine = h('p', { class: 'small muted', 'aria-live': 'polite' }); const errs = h('div', { class: 'sheet-errors', role: 'alert' });
  const stepHost = h('div', null); let stepper = null; let touched = false;
  const picker = ServingPicker({ servings: options.map((o) => ({ id: o.id, label: o.label })), value: optId, onChange: (id) => { optId = id; touched = true; const o = options.find((x) => x.id === id); qty = o.amount ? 100 : 1; buildStepper(); update(); } });
  const mealChips = MealChips({ meals: mealList.map((m) => ({ id: m.id, label: m.label })), selected: meal.id, onChange: (id) => { const m = mealById(mealList, id); meal.id = m.id; meal.label = m.label; touched = true; } });

  const current = () => options.find((o) => o.id === optId);
  function buildStepper() {
    const o = current(); stepHost.textContent = '';
    stepper = o.amount
      ? Stepper({ value: qty, min: 5, max: 5000, step: 10, label: `Amount in ${food.nutrition.per.unit}`, unit: food.nutrition.per.unit, onChange: () => { touched = true; update(); } })
      : Stepper({ value: qty, min: 0.25, max: 50, step: o.serving.unit === 'piece' ? 0.5 : 0.25, label: 'Quantity', unit: 'servings', onChange: () => { touched = true; update(); } });
    add(stepHost, stepper);
  }
  const units = () => { const v = stepper.getValue(); if (v === null) return null; const o = current(); return o.amount ? v / 100 : v; };
  function snapshot() { const q = units(); if (q === null || !(q > 0)) return null; return foodLogSnapshot(food, current().serving, q, { id: meal.id, label: meal.label }); }
  function update() {
    const snap = snapshot(); preview.textContent = '';
    const o = current(); const v = stepper.getValue();
    if (!snap) { add(preview, MacroPreview({ kcal: null, protein: null, carbs: null, fat: null, fiber: null })); amountLine.textContent = ''; return; }
    add(preview, MacroPreview({ kcal: snap.totals.kcal, protein: snap.totals.protein, carbs: snap.totals.carbs, fat: snap.totals.fat, fiber: snap.totals.fiber, estimate: isEstimate(food), fiberPartial: snap.totals.fiber === null }));
    const base = food.nutrition.per.unit;
    amountLine.textContent = o.amount ? `${fmtNum(v)} ${base}` : `${fmtNum(v, 2)} \u00D7 ${o.label}${base !== 'serving' ? ` = ${fmtNum(r1(v * o.serving.baseAmount))} ${base}` : ''}`;
  }
  buildStepper(); update();

  async function addEntry(keep) {
    errs.textContent = ''; const q = units(); const o = current();
    const chk = checkFoodQty(q, o.serving.baseAmount, q === null ? null : foodLogSnapshot(food, o.serving, q).totals.kcal, food.nutrition.per.unit !== 'serving');
    if (!chk.ok) { add(errs, h('p', { class: 'field-error' }, chk.hard[0].message)); return; }
    if (!(await confirmSoft(chk))) return;
    const res = await runSave(() => addFoodLog(pid, { date, food, serving: o.serving, qty: q, meal: { id: meal.id, label: meal.label } }), (l) => add(errs, h('p', { class: 'field-error' }, l[0].message)));
    if (!res.ok) return;
    toast(`Added ${food.name} to ${meal.label}`);
    if (keep) { memory.q = ''; ctx.replace(dateHash('/food/add', date, { meal: mealQ, from: ctx.query.from })); } else { resetAddFoodMemory(); finishAdd(ctx, date); }
  }
  const fid = uid('serving-form'); const form = h('form', { class: 'stack', id: fid, novalidate: true }, h('div', { class: 'estimate-line' }, ...foodChips(food).map((c) => Chip({ label: c.label })), isEstimate(food) ? EstimateBadge({ kind: 'est', explain: 'This food is an estimate, for example a restaurant dish. Real values can differ.' }) : null),
    food.notes ? h('p', { class: 'small muted' }, food.notes) : null, picker, stepHost, amountLine, preview, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Meal'), mealChips), errs);
  form.addEventListener('submit', (e) => { e.preventDefault(); addEntry(false); });
  const back = Button({ label: 'Back to search', icon: 'back', kind: 'ghost', size: 'sm', onClick: () => ctx.replace(dateHash('/food/add', date, { meal: mealQ, from: ctx.query.from })) });
  const footer = h('div', { class: 'stack-sm' }, bindSubmit(Button({ label: 'Add', kind: 'primary', block: true }), fid), Button({ label: 'Add and keep searching', kind: 'secondary', block: true, onClick: () => addEntry(true) }));
  return Sheet({ ctx: sheetCtx(ctx, date), title: food.name, body: h('div', { class: 'stack' }, back, form), footer });
}
