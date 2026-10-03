// Pure helpers for the plan editor and exercise form (A5). No IO. Plans never carry a weekday or schedule (D-007).
import { moveItem, reorderItems } from '../../core/calc.js';
import { newId } from '../../core/repo.js';

export const PLAN_NOTICE = 'Changes apply to new workouts. Past workouts do not change.';
const BASIS_WORD = { per_rep: 'per rep', per_second: 'per second', per_minute: 'per minute', per_km: 'per km', per_session: 'per session' };
export const basisWord = (b) => BASIS_WORD[b] || '';
export const KINDS = [{ id: 'reps', label: 'Reps' }, { id: 'seconds', label: 'Seconds' }, { id: 'minutes', label: 'Minutes' }, { id: 'meters', label: 'Distance (km)' }, { id: 'rounds', label: 'Rounds' }];
export const BASES = [{ id: 'per_rep', label: 'Per rep' }, { id: 'per_second', label: 'Per second' }, { id: 'per_minute', label: 'Per minute' }, { id: 'per_km', label: 'Per km' }, { id: 'per_session', label: 'Per session' }];
export const defaultBasisFor = (kind) => (kind === 'reps' || kind === 'rounds' ? 'per_rep' : kind === 'seconds' ? 'per_second' : kind === 'meters' ? 'per_km' : 'per_minute');

/** New plan item from an exercise. The exercise calories are frozen into kcalSnap; a per-item override is separate (D-028). */
export function itemFromExercise(ex, idFn = newId) {
  return { itemId: idFn('it'), exerciseId: ex.id, exerciseName: ex.name, targetKind: ex.targetKind, target: ex.defaultTarget ?? 10, targetMax: ex.defaultTargetMax ?? null, perSide: !!ex.perSide, altExerciseIds: [], kcalOverride: null,
    kcalSnap: ex.kcal ? { ...ex.kcal } : { basis: defaultBasisFor(ex.targetKind), value: 0, refWeightKg: 70, scaleByWeight: false }, note: null };
}
export const moveUp = (items, i) => moveItem(items, i, -1);
export const moveDown = (items, i) => moveItem(items, i, 1);
export const reorder = (items, from, to) => reorderItems(items, from, to);
/** Draft copy so edits never touch the stored object until Save. */
export const draftOf = (plan) => JSON.parse(JSON.stringify({ name: plan.name, description: plan.description || '', stepGoal: plan.stepGoal ?? null, isRest: !!plan.isRest, items: plan.items || [] }));
export const isDirty = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
/** Draft -> record fields for savePlan. Rest plans carry no items. */
export function planFromDraft(base, d) {
  return { ...base, name: d.name, description: d.description || null, stepGoal: d.stepGoal, isRest: !!d.isRest, items: d.isRest ? [] : d.items };
}
/** Exercise form -> exercise record. All values come in already parsed. */
export function exerciseFromForm(base, f) {
  const out = { ...(base || {}), name: f.name, aliases: f.aliases, category: f.category, muscleGroups: f.muscleGroups, type: f.type, targetKind: f.targetKind, defaultTarget: f.defaultTarget, defaultTargetMax: f.defaultTargetMax, perSide: !!f.perSide,
    kcal: { basis: f.basis, value: f.kcalValue, refWeightKg: (base && base.kcal && base.kcal.refWeightKg) || 70, scaleByWeight: !!f.scaleByWeight }, difficulty: f.difficulty, instructions: f.instructions || null, notes: f.notes || null, system: false };
  return out;
}
