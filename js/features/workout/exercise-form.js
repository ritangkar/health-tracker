// S20 Exercise detail and form: shows instructions and estimates, edits name, target, calories per unit and more.
// Built-in exercises are edited as the person's own copy (copy-on-edit, D-025). Plans and past workouts keep their own copy of the exercise (D-026). (A5)
import { h, mount, clear, announce } from '../../core/dom.js';
import { Button, Chip, ErrorSummary, EstimateBadge, FormField, toast } from '../../ui/components.js';
import { notFound, setLeaveGuard } from '../../core/router.js';
import { saveExercise } from '../../core/repo.js';
import { getExercise, invalidateOverlay } from '../../core/seed.js';
import { checkName, cleanText, num, msg } from '../../core/validate.js';
import { fmtNum } from '../../core/units.js';
import { ConfirmDialog } from '../../ui/components.js';
import { add, runSave } from '../daily/shared.js';
import { selectField } from '../food/custom-food.js';
import { toUi, fromUi } from './common.js';
import { KINDS, BASES, basisWord, defaultBasisFor, exerciseFromForm } from './plan-model.js';

export const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads', 'hamstrings', 'calves', 'full-body'];
const CATS = ['strength', 'cardio', 'core', 'mobility', 'yoga', 'other'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));
const TYPES = [{ id: 'bodyweight', label: 'Bodyweight' }, { id: 'weighted', label: 'Weighted' }, { id: 'cardio', label: 'Cardio' }, { id: 'flexibility', label: 'Flexibility' }];
const LEVELS = [{ id: 'beginner', label: 'Beginner' }, { id: 'intermediate', label: 'Intermediate' }, { id: 'advanced', label: 'Advanced' }];

export async function exerciseScreen(ctx) {
  const { pid } = ctx; const rawId = ctx.params.id; const isNew = rawId === 'new';
  let base = null; if (!isNew) { base = await getExercise(rawId, pid); if (!base) notFound(); }
  const seedEx = !!(base && String(base.id).startsWith('ex:'));
  const X = base || { name: '', aliases: [], category: 'strength', muscleGroups: [], type: 'bodyweight', targetKind: 'reps', defaultTarget: 10, defaultTargetMax: null, perSide: false, kcal: { basis: 'per_rep', value: 0.3, refWeightKg: 70, scaleByWeight: true }, difficulty: 'beginner', instructions: '', notes: '' };
  const el = h('section', { class: 'screen screen-narrow exercise-form' }); const errHost = h('div', { class: 'error-host' }); const fields = {};
  fields.name = FormField({ label: 'Name', id: 'ex-name', type: 'text', value: X.name, maxlength: 80, required: true });
  fields.aliases = FormField({ label: 'Other names (optional)', type: 'text', value: (X.aliases || []).join(', '), hint: 'Separate with commas.' });
  fields.category = selectField('Category', CATS, X.category || 'strength'); fields.type = selectField('Type', TYPES, X.type || 'bodyweight'); fields.difficulty = selectField('Difficulty', LEVELS, X.difficulty || 'beginner');
  const kinds = selectField('Measured in', KINDS, X.targetKind);
  fields.target = FormField({ label: 'Default target', type: 'text', inputmode: 'decimal', value: String(toUi(X.targetKind, X.defaultTarget) ?? '') });
  fields.targetMax = FormField({ label: 'Top of range (optional)', type: 'text', inputmode: 'decimal', value: X.defaultTargetMax == null ? '' : String(toUi(X.targetKind, X.defaultTargetMax)) });
  const ps = h('input', { type: 'checkbox', checked: !!X.perSide }); const psRow = h('label', { class: 'row check-row' }, ps, h('span', null, 'Done on each side'));
  const basisF = selectField('Calories are counted', BASES, (X.kcal && X.kcal.basis) || defaultBasisFor(X.targetKind));
  fields.kcal = FormField({ label: 'Calories per unit (estimate)', type: 'text', inputmode: 'decimal', value: X.kcal ? String(X.kcal.value) : '', hint: 'About how many kcal one unit burns for a 70 kg adult. It is an estimate.' });
  const sc = h('input', { type: 'checkbox', checked: !!(X.kcal && X.kcal.scaleByWeight) }); const scRow = h('label', { class: 'row check-row' }, sc, h('span', null, 'Scale the estimate with my body weight'));
  const muscles = new Set(X.muscleGroups || []); const mHost = h('div', { class: 'row-wrap', role: 'group', 'aria-label': 'Muscle groups' });
  const paintM = () => { clear(mHost); for (const m of MUSCLES) add(mHost, Chip({ label: m, selected: muscles.has(m), onClick: () => { if (muscles.has(m)) muscles.delete(m); else muscles.add(m); paintM(); } })); }; paintM();
  const ins = h('textarea', { class: 'input textarea', rows: 4, maxlength: 600 }); ins.value = X.instructions || ''; fields.instructions = FormField({ label: 'Instructions (optional)', control: ins });
  const nt = h('textarea', { class: 'input textarea', rows: 2, maxlength: 300 }); nt.value = X.notes || ''; fields.notes = FormField({ label: 'Notes (optional)', control: nt });
  const read = () => JSON.stringify([fields.name.input.value, fields.aliases.input.value, fields.category.sel.value, fields.type.sel.value, fields.difficulty.sel.value, kinds.sel.value, fields.target.input.value, fields.targetMax.input.value, ps.checked, basisF.sel.value, fields.kcal.input.value, sc.checked, [...muscles].sort(), ins.value, nt.value]);
  const start = read(); const dirty = () => read() !== start;
  const guard = { dirty, confirm: () => ConfirmDialog({ title: 'Discard changes?', message: 'You have changes that are not saved.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }) };
  setLeaveGuard(guard); ctx.onCleanup(() => setLeaveGuard(null));
  kinds.sel.addEventListener('change', () => { basisF.sel.value = defaultBasisFor(kinds.sel.value); });
  const showErrors = (errs) => { clear(errHost); for (const [k, f] of Object.entries(fields)) f.setError && f.setError((errs.find((e) => e.field === k) || {}).message || ''); if (errs.length) { add(errHost, ErrorSummary(errs.map((e) => ({ fieldId: (fields[e.field] || fields.name).fieldId, message: e.message })))); const f = fields[errs[0].field]; if (f && f.input) f.input.focus(); } };
  async function save() {
    const errs = []; const kind = kinds.sel.value;
    const nm = checkName(fields.name.input.value, 80); if (!nm.ok) errs.push({ field: 'name', message: nm.hard[0].message });
    const tv = num(fields.target.input.value); const lo = Number.isFinite(tv) && tv !== null ? fromUi(kind, tv) : null; if (!(lo > 0)) errs.push({ field: 'target', message: msg('P_TARGET') });
    let hi = null; if (fields.targetMax.input.value.trim() !== '') { const mv = num(fields.targetMax.input.value); hi = Number.isFinite(mv) ? fromUi(kind, mv) : NaN; if (!(hi >= lo)) errs.push({ field: 'targetMax', message: 'The top of the range must be at least the target.' }); }
    const kv = num(fields.kcal.input.value); if (kv === null || !Number.isFinite(kv) || kv < 0 || kv > 5000) errs.push({ field: 'kcal', message: msg('X_KCAL_RANGE') });
    const aliases = [...new Set(fields.aliases.input.value.split(',').map((a) => cleanText(a)).filter(Boolean))].slice(0, 10);
    showErrors(errs); if (errs.length) return;
    const rec = exerciseFromForm(base, { name: cleanText(fields.name.input.value), aliases, category: fields.category.sel.value, muscleGroups: [...muscles], type: fields.type.sel.value, targetKind: kind, defaultTarget: lo, defaultTargetMax: hi, perSide: ps.checked, basis: basisF.sel.value, kcalValue: kv, scaleByWeight: sc.checked, difficulty: fields.difficulty.sel.value, instructions: cleanText(ins.value) || '', notes: cleanText(nt.value) || '' });
    const res = await runSave(() => saveExercise(pid, rec), (l) => showErrors(l.map((x) => ({ field: 'name', message: x.message })))); if (!res.ok) return;
    invalidateOverlay(pid); setLeaveGuard(null); toast(`Saved ${res.value.name}. Plans and past workouts do not change.`); ctx.replace('#/workout/exercises');
  }
  const detail = base && !isNew ? h('div', { class: 'card stack-sm' }, h('p', { class: 'row-title' }, 'About this exercise'), base.instructions ? h('p', null, base.instructions) : h('p', { class: 'muted' }, 'No instructions yet.'),
    base.kcal ? h('p', { class: 'row-wrap small' }, `About ${fmtNum(base.kcal.value, 3)} kcal ${basisWord(base.kcal.basis)}`, EstimateBadge({ kind: 'est' })) : null) : null;
  mount(el, h('div', { class: 'screen-head' }, h('h1', null, isNew ? 'New exercise' : seedEx ? 'Edit built-in exercise' : 'Edit exercise'), Button({ label: 'Exercises', kind: 'ghost', icon: 'back', onClick: () => ctx.back('#/workout/exercises') })),
    seedEx ? h('div', { class: 'notice-box' }, 'This edits your own copy. The built-in exercise is not changed. Plans and past workouts keep their own values.') : null, detail, errHost,
    fields.name, fields.aliases, h('div', { class: 'two-fields' }, fields.category, fields.type), fields.difficulty, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Muscle groups'), mHost),
    kinds, h('div', { class: 'two-fields' }, fields.target, fields.targetMax), psRow, basisF, fields.kcal, scRow, fields.instructions, fields.notes,
    h('div', { class: 'row-wrap sticky-actions' }, Button({ label: 'Save exercise', kind: 'primary', onClick: save })));
  return el;
}
