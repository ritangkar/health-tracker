// S18 Plan editor: rename, add, remove and reorder exercises (drag handle AND up/down buttons), targets, ranges, per side, calorie override, step goal.
// Edits stay in a draft until Save. A plan edit bumps the plan revision and never rewrites a past workout (D-007, D-026). (A5)
import { h, mount, clear, logError, announce } from '../../core/dom.js';
import { Button, ConfirmDialog, ExerciseRow, FormField, PlanItemRow, SearchField, makeSortable, toast } from '../../ui/components.js';
import { notFound, setLeaveGuard } from '../../core/router.js';
import { savePlan } from '../../core/repo.js';
import { getPlan, listExercises, resolveExerciseSync, normalize, invalidateOverlay } from '../../core/seed.js';
import { checkName, checkStepGoal, checkKcalOverride, cleanText, num, msg } from '../../core/validate.js';
import { fmtNum } from '../../core/units.js';
import { add, runSave } from '../daily/shared.js';
import { stepFor, toUi, fromUi, targetText, unitWord } from './common.js';
import { PLAN_NOTICE, basisWord, itemFromExercise, moveUp, moveDown, reorder, draftOf, isDirty, planFromDraft } from './plan-model.js';

const emptyDraft = () => ({ name: '', description: '', stepGoal: null, isRest: false, items: [] });
export const itemKcalText = (it) => (it.kcalOverride ? `~${fmtNum(it.kcalOverride.value, 3)} kcal ${basisWord(it.kcalOverride.basis)} (your value)` : it.kcalSnap && it.kcalSnap.value != null ? `~${fmtNum(it.kcalSnap.value, 3)} kcal ${basisWord(it.kcalSnap.basis)} (est.)` : null);

export async function planEditorScreen(ctx) {
  const { pid } = ctx; const rawId = ctx.params.id; const isNew = rawId === 'new';
  let base = null; if (!isNew) { base = await getPlan(rawId, pid); if (!base) notFound(); }
  const resolve = await resolveExerciseSync(pid);
  let D = isNew ? emptyDraft() : draftOf(base); let saved = JSON.parse(JSON.stringify(D));
  let editing = null; let picking = false; let detach = null;
  const el = h('section', { class: 'screen screen-narrow plan-editor' }); const errBox = h('div', { class: 'sheet-errors', role: 'alert' });
  const dirty = () => isDirty(D, saved);
  const guard = { dirty, confirm: () => ConfirmDialog({ title: 'Discard changes?', message: 'You have changes to this plan that are not saved.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }) };
  setLeaveGuard(guard); ctx.onCleanup(() => { setLeaveGuard(null); if (detach) detach(); });
  const say = (m) => { clear(errBox); if (m) add(errBox, h('p', { class: 'field-error' }, m)); };

  function itemForm(i) {
    const it = D.items[i]; const ex = resolve(it.exerciseId); const word = unitWord(it, ex);
    const t = FormField({ label: `Target (${word})`, type: 'text', inputmode: 'decimal', value: String(toUi(it.targetKind, it.target) ?? '') });
    const m = FormField({ label: 'Top of range (optional)', type: 'text', inputmode: 'decimal', value: it.targetMax == null ? '' : String(toUi(it.targetKind, it.targetMax)), hint: 'For a range like 5 to 10 rounds. Completion is measured against the lower number.' });
    const ps = h('input', { type: 'checkbox', checked: !!it.perSide }); const psRow = h('label', { class: 'row check-row' }, ps, h('span', null, 'Each side (calories count both sides)'));
    const basis = (it.kcalOverride || it.kcalSnap || {}).basis;
    const k = FormField({ label: `Calories ${basisWord(basis)} (your own value, optional)`, type: 'text', inputmode: 'decimal', value: it.kcalOverride ? String(it.kcalOverride.value) : '', hint: it.kcalSnap && it.kcalSnap.value != null ? `Default: ${fmtNum(it.kcalSnap.value, 3)} ${basisWord(it.kcalSnap.basis)}. Leave blank to use the default.` : 'Leave blank to use the default.' });
    const note = FormField({ label: 'Note (optional)', type: 'text', maxlength: 200, value: it.note || '' });
    const apply = () => {
      for (const f of [t, m, k, note]) f.setError('');
      const tv = num(t.input.value); const lo = tv === null || !Number.isFinite(tv) ? null : fromUi(it.targetKind, tv);
      if (!(lo > 0)) { t.setError(msg('P_TARGET')); t.input.focus(); return; }
      let hi = null;
      if (m.input.value.trim() !== '') { const mv = num(m.input.value); hi = Number.isFinite(mv) ? fromUi(it.targetKind, mv) : NaN; if (!(hi >= lo)) { m.setError('The top of the range must be at least the target.'); m.input.focus(); return; } }
      let ko = null;
      if (k.input.value.trim() !== '') { const r = checkKcalOverride(k.input.value); if (!r.ok || r.value === null) { k.setError((r.hard[0] || {}).message || msg('X_KCAL_RANGE')); k.input.focus(); return; } ko = { basis, value: r.value }; }
      const n = cleanText(note.input.value) || null;
      D.items[i] = { ...it, target: lo, targetMax: hi, perSide: ps.checked, kcalOverride: ko, note: n }; editing = null; announce('Exercise updated'); paint();
    };
    return h('li', { class: 'plan-item-edit card stack' }, h('p', { class: 'row-title' }, it.exerciseName), t, m, psRow, k, note,
      h('div', { class: 'row-wrap' }, Button({ label: 'Done', kind: 'primary', size: 'sm', onClick: apply }), Button({ label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => { editing = null; paint(); } })));
  }

  function pickerPanel() {
    const list = h('ul', { class: 'result-list' }); const status = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
    let all = []; let loaded = false;
    const run = () => {
      clear(list); if (!loaded) return; const toks = normalize(field.input.value).split(' ').filter(Boolean);
      const hit = all.filter((x) => !toks.length || toks.every((tk) => normalize([x.name, ...(x.aliases || [])].join(' ')).split(' ').some((w) => w.startsWith(tk)))).slice(0, 40);
      for (const x of hit) add(list, ExerciseRow({ name: x.name, detail: `${x.category || ''} \u00B7 ${fmtNum(toUi(x.targetKind, x.defaultTarget ?? 0), 2)} ${unitWord({ targetKind: x.targetKind }, x)}`, onSelect: () => { D.items.push(itemFromExercise(x)); picking = false; announce(`${x.name} added`); paint(); } }));
      status.textContent = hit.length ? '' : 'No exercise matches. You can create one in the Exercise library.';
    };
    const field = SearchField({ label: 'Search exercises', placeholder: 'Search exercises, for example squat or plank', autofocus: true, onInput: run, onSubmit: run });
    listExercises(pid).then((l) => { all = l; loaded = true; run(); }).catch((e) => { logError(e, 'plan picker'); status.textContent = 'Could not load exercises.'; });
    return h('div', { class: 'card stack' }, h('p', { class: 'row-title' }, 'Add an exercise'), field, status, list,
      h('div', { class: 'row-wrap' }, Button({ label: 'Close', kind: 'ghost', size: 'sm', onClick: () => { picking = false; paint(); } }), Button({ label: 'New exercise', kind: 'ghost', size: 'sm', href: '#/workout/exercise/new' })));
  }

  function paint() {
    if (detach) { detach(); detach = null; }
    const nameF = FormField({ label: 'Plan name', id: 'plan-name', type: 'text', value: D.name, maxlength: 60, required: true }); nameF.input.addEventListener('input', () => { D.name = nameF.input.value; });
    const descF = FormField({ label: 'Description (optional)', type: 'text', value: D.description, maxlength: 300 }); descF.input.addEventListener('input', () => { D.description = descF.input.value; });
    const goalF = FormField({ label: 'Daily step goal for this plan', id: 'plan-goal', type: 'text', inputmode: 'numeric', value: D.stepGoal == null ? '' : String(D.stepGoal), hint: 'Optional. Leave blank to use your default goal. A goal you set by hand for a day always wins.' });
    goalF.input.addEventListener('input', () => { const raw = goalF.input.value; const v = num(raw); D.stepGoal = raw.trim() === '' ? null : (Number.isFinite(v) ? v : raw); });
    const rest = h('input', { type: 'checkbox', checked: D.isRest }); rest.addEventListener('change', () => { D.isRest = rest.checked; paint(); });
    const restRow = h('label', { class: 'row check-row' }, rest, h('span', null, 'This is a rest day plan (no exercises)'));
    const list = h('ul', { class: 'plan-items' });
    D.items.forEach((it, i) => {
      if (editing === it.itemId) { add(list, itemForm(i)); return; }
      const ex = resolve(it.exerciseId);
      add(list, PlanItemRow({ index: i, count: D.items.length, name: it.exerciseName, target: targetText(it, ex), kcal: itemKcalText(it), note: it.note, onEdit: () => { editing = it.itemId; paint(); },
        onMoveUp: () => { D.items = moveUp(D.items, i); announce(`${it.exerciseName} moved up`); paint(); }, onMoveDown: () => { D.items = moveDown(D.items, i); announce(`${it.exerciseName} moved down`); paint(); },
        onRemove: () => { D.items.splice(i, 1); announce(`${it.exerciseName} removed`); paint(); } }));
    });
    detach = makeSortable(list, { onReorder: (from, to) => { D.items = reorder(D.items, from, to); paint(); } });
    const itemsCard = D.isRest ? h('p', { class: 'muted' }, 'A rest day has no exercises. Choosing it on a day records a rest day.')
      : h('section', { class: 'stack-sm', 'aria-label': 'Exercises' }, h('h2', { class: 'card-title' }, `Exercises (${D.items.length})`), D.items.length ? list : h('p', { class: 'muted' }, 'No exercises yet.'),
        picking ? pickerPanel() : Button({ label: 'Add exercise', icon: 'plus', kind: 'secondary', onClick: () => { picking = true; paint(); } }),
        D.items.length ? h('p', { class: 'small muted' }, 'Calories are estimates. Drag the handle, or use the up and down buttons, to reorder.') : null);
    const back = Button({ label: 'Plans', kind: 'ghost', icon: 'back', onClick: () => ctx.back('#/workout/plans') });
    mount(el, h('div', { class: 'screen-head' }, h('h1', null, isNew && !base ? 'New plan' : 'Edit plan'), back), h('div', { class: 'notice-box', role: 'note' }, PLAN_NOTICE),
      base && String(base.id).startsWith('plan:') ? h('p', { class: 'small muted' }, 'This is a default plan. Saving makes your own copy and the default stays available.') : null,
      nameF, descF, goalF, restRow, itemsCard, errBox, h('div', { class: 'row-wrap sticky-actions' }, Button({ label: 'Save plan', kind: 'primary', onClick: save })));
  }
  async function save() {
    say(''); const n = checkName(D.name, 60, 'P_NAME'); if (!n.ok) { say(n.hard[0].message); const f = document.getElementById('plan-name'); if (f) f.focus(); return; }
    let goal = D.stepGoal; if (goal !== null) { const g = checkStepGoal(goal); if (!g.ok) { say(g.hard[0].message); return; } goal = g.value; }
    if (!D.isRest && !D.items.length) { say('Add at least one exercise, or mark this as a rest day plan.'); return; }
    const rec = planFromDraft(base || {}, { ...D, name: cleanText(D.name), description: cleanText(D.description) || '', stepGoal: goal });
    const res = await runSave(() => savePlan(pid, rec), (l) => say(l[0].message)); if (!res.ok) return;
    invalidateOverlay(pid); toast('Plan saved. New workouts use it; past workouts do not change.');
    const out = res.value; setLeaveGuard(null);
    if (out.id !== (base && base.id)) { ctx.replace(`#/workout/plan/${encodeURIComponent(out.id)}`); return; }
    base = out; D = draftOf(out); saved = JSON.parse(JSON.stringify(D)); setLeaveGuard(guard); paint();
  }
  paint();
  return el;
}
