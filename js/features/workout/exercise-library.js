// S19 Exercise library: search, category filter, built-in and custom exercises. Built-in ones are edited as your own copy or hidden. (A5)
import { h, mount, clear, logError, reportWriteError } from '../../core/dom.js';
import { Button, Chip, ConfirmDialog, EmptyState, EstimateBadge, ExerciseRow, IconButton, SearchField, toast } from '../../ui/components.js';
import { listExercises, getExercise, normalize, invalidateOverlay } from '../../core/seed.js';
import { deleteExercise, resetToDefault, getSettings, unhideSeed } from '../../core/repo.js';
import { fmtNum } from '../../core/units.js';
import { add } from '../daily/shared.js';
import { toUi, unitWord } from './common.js';

const CATS = [{ id: 'all', label: 'All' }, { id: 'strength', label: 'Strength' }, { id: 'cardio', label: 'Cardio' }, { id: 'core', label: 'Core' }, { id: 'mobility', label: 'Mobility' }, { id: 'yoga', label: 'Yoga' }, { id: 'other', label: 'Other' }];
const PAGE = 60;
const memory = { q: '', cat: 'all' };
export const matchExercise = (x, q) => { const toks = normalize(q).split(' ').filter(Boolean); if (!toks.length) return true; const words = normalize([x.name, ...(x.aliases || []), ...(x.muscleGroups || [])].join(' ')).split(' '); return toks.every((t) => words.some((w) => w.startsWith(t))); };

export async function exercisesScreen(ctx) {
  const { pid } = ctx; const el = h('section', { class: 'screen exercises-screen' }); let alive = true; ctx.onCleanup(() => { alive = false; });
  let all = []; let hidden = []; let shown = PAGE;
  const list = h('ul', { class: 'result-list' }); const hiddenHost = h('div', { class: 'stack-sm' }); const status = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' }); const more = h('div', { class: 'row-wrap' }); const chips = h('div', { class: 'row-wrap', role: 'group', 'aria-label': 'Category' });
  async function mutate(fn, ok) { try { await fn(); } catch (e) { reportWriteError(e); return; } invalidateOverlay(pid); toast(ok); await load(); }
  const hideOrDelete = async (x) => { const seedEx = String(x.id).startsWith('ex:'); if (await ConfirmDialog({ title: `${seedEx ? 'Hide' : 'Delete'} ${x.name}?`, message: `Plans and workouts that already use it keep their own copy and do not change.${seedEx ? ' You can show it again from Hidden exercises at the bottom of this screen.' : ''}`, confirmLabel: seedEx ? 'Hide' : 'Delete', danger: true })) mutate(() => deleteExercise(pid, x.id), `${seedEx ? 'Hid' : 'Deleted'} ${x.name}`); };
  const reset = async (x) => { if (await ConfirmDialog({ title: `Reset ${x.name} to default?`, message: 'Your edited copy is removed. Plans and workouts keep their own copy.', confirmLabel: 'Reset to default', danger: true })) mutate(() => resetToDefault('exercises', pid, x.id), `${x.name} reset to default`); };
  function paintChips() { clear(chips); for (const c of CATS) add(chips, Chip({ label: c.label, selected: memory.cat === c.id, onClick: () => { memory.cat = c.id; shown = PAGE; paintChips(); paintList(); } })); }
  function paintList() {
    clear(list); clear(more); const hit = all.filter((x) => (memory.cat === 'all' || x.category === memory.cat) && matchExercise(x, field.input.value)).sort((a, b) => a.name.localeCompare(b.name));
    memory.q = field.input.value;
    for (const x of hit.slice(0, shown)) {
      const own = !String(x.id).startsWith('ex:'); const k = x.kcal;
      add(list, ExerciseRow({ name: x.name, detail: `${x.category || 'other'} \u00B7 ${fmtNum(toUi(x.targetKind, x.defaultTarget ?? 0), 2)} ${unitWord({ targetKind: x.targetKind }, x)}`, meta: (x.muscleGroups || []).join(', ') || null, onSelect: () => ctx.navigate(`#/workout/exercise/${encodeURIComponent(x.id)}`),
        trailing: [x.basedOn ? Chip({ label: 'Edited' }) : own ? Chip({ label: 'Mine' }) : null, k ? EstimateBadge({ kind: 'est' }) : null, x.basedOn ? Button({ label: 'Reset', kind: 'ghost', size: 'sm', ariaLabel: `Reset ${x.name} to default`, onClick: () => reset(x) }) : null, IconButton({ icon: 'trash', label: `${own ? 'Delete' : 'Hide'} ${x.name}`, onClick: () => hideOrDelete(x) })] }));
    }
    if (hit.length > shown) add(more, Button({ label: `Show more (${hit.length - shown} left)`, kind: 'secondary', onClick: () => { shown += PAGE; paintList(); } }));
    status.textContent = hit.length ? `${hit.length} ${hit.length === 1 ? 'exercise' : 'exercises'}` : 'No exercise matches.';
  }
  const field = SearchField({ label: 'Search exercises', placeholder: 'Search by name or muscle, for example squat or glutes', value: memory.q, onInput: () => { shown = PAGE; paintList(); }, onSubmit: paintList });
  async function load() {
    try { all = await listExercises(pid); const ids = ((await getSettings(pid)).hiddenSeed || {}).exercises || []; hidden = (await Promise.all(ids.map(async (id) => ({ id, ex: await getExercise(id, pid).catch(() => null) })))).filter((x) => x.ex); } catch (e) { logError(e, 'exercises load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load exercises', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: load }, headingLevel: 1 })); return; }
    if (!alive) return;
    if (!all.length && !hidden.length) { mount(el, h('div', { class: 'food-head' }, h('h1', null, 'Exercise library')), EmptyState({ icon: 'dumbbell', title: 'No exercises', text: 'Create your own exercise to use in a plan.', action: { label: 'New exercise', href: '#/workout/exercise/new' } })); return; }
    mount(el, h('div', { class: 'food-head' }, h('h1', null, 'Exercise library'), Button({ label: 'New exercise', icon: 'plus', kind: 'primary', href: '#/workout/exercise/new' })), field, chips, status, list, more, hiddenHost,
      h('p', { class: 'small muted' }, 'Calorie values are rough estimates and can be changed. Editing a built-in exercise makes your own copy.'), h('div', { class: 'row-wrap' }, Button({ label: 'Plans', kind: 'ghost', icon: 'edit', href: '#/workout/plans' }), Button({ label: 'Back to Workout', kind: 'ghost', icon: 'back', href: '#/workout' })));
    paintChips(); paintList(); clear(hiddenHost);
    if (hidden.length) add(hiddenHost, h('h2', { class: 'card-title' }, `Hidden exercises (${hidden.length})`), h('ul', { class: 'manage-list' }, hidden.map((x) => h('li', { class: 'manage-row' }, h('span', { class: 'row-title' }, x.ex.name), Button({ label: 'Show again', kind: 'secondary', size: 'sm', ariaLabel: `Show ${x.ex.name} again`, onClick: () => mutate(() => unhideSeed(pid, 'exercises', x.id), `${x.ex.name} is back`) })))));
  }
  await load();
  return el;
}
