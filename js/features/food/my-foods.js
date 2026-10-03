// S13 My foods manager: custom foods, recipes, edited copies of built-in foods (Reset to default), built-in search (Edit my copy / Hide) and hidden foods (Show again). (A5)
// Deleting a food never touches logs: entries keep their own snapshot (D-026). Every destructive step is confirmed (D-054).
import { h, mount, clear, logError, reportWriteError, debounce } from '../../core/dom.js';
import { Button, Card, Chip, ConfirmDialog, EmptyState, EstimateBadge, IconButton, SearchField, toast } from '../../ui/components.js';
import { listFoods, deleteFood, resetToDefault, unhideSeed, getSettings } from '../../core/repo.js';
import { search, getFood as seedFood, invalidateOverlay } from '../../core/seed.js';
import { add } from '../daily/shared.js';
import { foodDetail, foodChips, isEstimate } from './common.js';

const PAGE = 100;
export async function manageScreen(ctx) {
  const { pid } = ctx; const el = h('section', { class: 'screen manage-screen' }); let alive = true; ctx.onCleanup(() => { alive = false; });
  const shown = { foods: PAGE, recipes: PAGE, copies: PAGE };
  const searchRes = h('ul', { class: 'result-list' }); const searchStatus = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' });

  async function mutate(fn, okText) { try { await fn(); } catch (e) { reportWriteError(e); return; } invalidateOverlay(pid); toast(okText); await paint(); }
  const del = async (f) => { if (await ConfirmDialog({ title: `Delete ${f.name}?`, message: 'It will no longer appear in search or favourites. Entries you already logged keep their values and stay in your history.', confirmLabel: 'Delete', danger: true })) mutate(() => deleteFood(pid, f.id), `Deleted ${f.name}`); };
  const reset = async (f) => { if (await ConfirmDialog({ title: `Reset ${f.name} to the built-in version?`, message: 'Your edited copy is removed and the built-in food shows again. Entries you already logged keep their values.', confirmLabel: 'Reset to default', danger: true })) mutate(() => resetToDefault('foods', pid, f.id), `${f.name} reset to default`); };
  const hide = async (f) => { if (await ConfirmDialog({ title: `Hide ${f.name}?`, message: 'It will not appear in search. You can show it again from this screen. Entries you already logged keep their values.', confirmLabel: 'Hide', danger: true })) mutate(() => deleteFood(pid, f.id), `Hid ${f.name}`); };
  const editHref = (f) => (f.kind === 'recipe' ? `#/food/manage/recipe/${encodeURIComponent(f.id)}` : `#/food/manage/food/${encodeURIComponent(f.id)}`);

  function row(f, actions) {
    return h('li', { class: 'manage-row' }, h('div', { class: 'grow' }, h('span', { class: 'row-title' }, f.name), h('span', { class: 'small muted' }, ` ${foodDetail(f)}`), h('span', { class: 'row-badges' }, foodChips(f).map((c) => Chip({ label: c.label })), isEstimate(f) ? EstimateBadge({ kind: 'est' }) : null)), h('div', { class: 'row-actions' }, actions));
  }
  const section = (title, key, list, mk, empty) => {
    const rows = list.slice(0, shown[key] || list.length).map(mk);
    return Card({ title: `${title} (${list.length})`, children: [list.length ? h('ul', { class: 'manage-list' }, rows) : h('p', { class: 'muted' }, empty), key && list.length > shown[key] ? Button({ label: `Show more (${list.length - shown[key]} left)`, kind: 'secondary', onClick: () => { shown[key] += PAGE; paint(); } }) : null] });
  };
  const runSearch = async (q) => {
    clear(searchRes); searchStatus.textContent = ''; const t = q.trim(); if (!t) return;
    let res = []; try { res = await search(t, pid, 30); } catch (e) { logError(e, 'manage search'); searchStatus.textContent = 'Search failed. Try again.'; return; }
    const seeds = res.filter((r) => String(r.food.id).startsWith('f:')); if (!seeds.length) { searchStatus.textContent = 'No built-in food matches.'; return; }
    for (const r of seeds) add(searchRes, row(r.food, [Button({ label: 'Edit my copy', kind: 'secondary', size: 'sm', href: editHref(r.food) }), Button({ label: 'Hide', kind: 'ghost', size: 'sm', onClick: () => hide(r.food) })]));
  };
  const field = SearchField({ label: 'Search built-in foods', placeholder: 'Find a built-in food to edit or hide', onInput: debounce(runSearch, 200), onSubmit: runSearch });

  async function paint() {
    let all, st;
    try { [all, st] = await Promise.all([listFoods(pid), getSettings(pid)]); } catch (e) { logError(e, 'manage load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load your foods', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return;
    const byName = (a, b) => a.name.localeCompare(b.name); const live = all.filter((f) => !f.archivedAt);
    const foods = live.filter((f) => f.kind !== 'recipe' && !f.basedOn).sort(byName), recipes = live.filter((f) => f.kind === 'recipe').sort(byName), copies = live.filter((f) => f.basedOn && f.kind !== 'recipe').sort(byName);
    const hiddenIds = (st.hiddenSeed && st.hiddenSeed.foods) || []; const hidden = (await Promise.all(hiddenIds.map(async (id) => ({ id, food: await seedFood(id, pid).catch(() => null) })))).filter((x) => x.food);
    const empty = !foods.length && !recipes.length && !copies.length && !hidden.length;
    mount(el, h('div', { class: 'food-head' }, h('h1', null, 'My foods'), h('div', { class: 'row-wrap' }, Button({ label: 'Create custom food', icon: 'plus', kind: 'primary', href: '#/food/manage/food' }), Button({ label: 'Build recipe', icon: 'plus', href: '#/food/manage/recipe' }))),
      empty ? EmptyState({ icon: 'food', title: 'No custom foods yet', text: 'Create a food or build a recipe and it shows up in normal search, with the same serving picker as everything else.', action: { label: 'Create custom food', href: '#/food/manage/food' } }) : null,
      section('Custom foods', 'foods', foods, (f) => row(f, [Button({ label: 'Edit', kind: 'secondary', size: 'sm', href: editHref(f) }), IconButton({ icon: 'trash', label: `Delete ${f.name}`, onClick: () => del(f) })]), 'None yet.'),
      section('Recipes', 'recipes', recipes, (f) => row(f, [Button({ label: 'Edit', kind: 'secondary', size: 'sm', href: editHref(f) }), IconButton({ icon: 'trash', label: `Delete ${f.name}`, onClick: () => del(f) })]), 'None yet.'),
      copies.length ? section('Edited built-in foods', 'copies', copies, (f) => row(f, [Button({ label: 'Edit', kind: 'secondary', size: 'sm', href: editHref(f) }), Button({ label: 'Reset to default', kind: 'ghost', size: 'sm', onClick: () => reset(f) })]), '') : null,
      Card({ title: 'Built-in foods', children: [h('p', { class: 'small muted' }, 'Editing a built-in food makes your own copy. The built-in one is not changed.'), field, searchStatus, searchRes] }),
      hidden.length ? Card({ title: `Hidden built-in foods (${hidden.length})`, children: [h('ul', { class: 'manage-list' }, hidden.map((x) => row(x.food, [Button({ label: 'Show again', kind: 'secondary', size: 'sm', onClick: () => mutate(() => unhideSeed(pid, 'foods', x.id), `${x.food.name} is back in search`) })])))] }) : null,
      Button({ label: 'Back to Food', kind: 'ghost', icon: 'back', href: '#/food' }));
  }
  await paint();
  return el;
}
