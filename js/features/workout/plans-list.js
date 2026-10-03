// S17 Plans list: every plan, any day (no weekday anywhere). Edit, Duplicate, Delete, Reset to default, Restore defaults. (A5)
// Deleting a plan never touches past workouts: each workout log carries its own copy of the plan (D-026, DoD-10).
import { h, mount, logError, reportWriteError } from '../../core/dom.js';
import { Button, Chip, ConfirmDialog, EmptyState, IconButton, toast } from '../../ui/components.js';
import { listPlans, invalidateOverlay } from '../../core/seed.js';
import { duplicatePlanFor, deletePlan, resetToDefault, getSettings, unhideSeed } from '../../core/repo.js';
import { navigate } from '../../core/router.js';
import { fmtNum } from '../../core/units.js';
import { add } from '../daily/shared.js';

export async function plansScreen(ctx) {
  const { pid } = ctx; const el = h('section', { class: 'screen plans-screen' }); let alive = true; ctx.onCleanup(() => { alive = false; });
  async function run(fn, okText, then) { try { const v = await fn(); invalidateOverlay(pid); if (okText) toast(okText); if (then) return then(v); } catch (e) { reportWriteError(e); return; } await paint(); }
  const dup = (p) => run(() => duplicatePlanFor(pid, p), `Copied ${p.name}`, (c) => navigate(`#/workout/plan/${encodeURIComponent(c.id)}`));
  const del = async (p) => { if (await ConfirmDialog({ title: `Delete ${p.name}?`, message: 'Workouts you already logged with this plan stay exactly as they are and can still be viewed.', confirmLabel: 'Delete plan', danger: true })) run(() => deletePlan(pid, p.id), `Deleted ${p.name}`); };
  const reset = async (p) => { if (await ConfirmDialog({ title: `Reset ${p.name} to default?`, message: 'Your edited copy is removed and the default plan shows again. Past workouts do not change.', confirmLabel: 'Reset to default', danger: true })) run(() => resetToDefault('plans', pid, p.id), `${p.name} reset to default`); };
  async function paint() {
    let plans, st;
    try { [plans, st] = await Promise.all([listPlans(pid), getSettings(pid)]); } catch (e) { logError(e, 'plans load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load plans', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return;
    const hiddenIds = (st.hiddenSeed && st.hiddenSeed.plans) || [];
    const restore = hiddenIds.length ? Button({ label: `Restore default plans (${hiddenIds.length})`, kind: 'secondary', onClick: () => run(async () => { for (const id of hiddenIds) await unhideSeed(pid, 'plans', id); }, 'Default plans restored') }) : null;
    const head = h('div', { class: 'food-head' }, h('h1', null, 'Plans'), Button({ label: 'New plan', icon: 'plus', kind: 'primary', href: '#/workout/plan/new' }));
    if (!plans.length) { mount(el, head, EmptyState({ icon: 'dumbbell', title: 'No plans', text: 'Create a plan, or bring the default plans back.', action: restore ? { label: `Restore default plans (${hiddenIds.length})`, onClick: () => restore.click() } : { label: 'New plan', href: '#/workout/plan/new' } }), restore); return; }
    const cards = plans.map((p) => {
      const n = (p.items || []).length;
      return h('li', { class: 'plan-row card' }, h('a', { class: 'plan-row-main', href: `#/workout/plan/${encodeURIComponent(p.id)}`, 'aria-label': `Edit ${p.name}` }, h('span', { class: 'plan-name' }, p.name), p.description ? h('span', { class: 'small muted' }, p.description) : null,
        h('span', { class: 'row-wrap' }, p.isRest ? Chip({ label: 'Rest day' }) : Chip({ label: `${n} ${n === 1 ? 'exercise' : 'exercises'}` }), p.stepGoal ? Chip({ label: `${fmtNum(p.stepGoal)} steps` }) : null, p.basedOn ? Chip({ label: 'Edited' }) : null)),
        h('div', { class: 'row-actions' }, Button({ label: 'Edit', kind: 'secondary', size: 'sm', href: `#/workout/plan/${encodeURIComponent(p.id)}` }), IconButton({ icon: 'plus', label: `Duplicate ${p.name}`, onClick: () => dup(p) }), p.basedOn ? Button({ label: 'Reset to default', kind: 'ghost', size: 'sm', onClick: () => reset(p) }) : null, IconButton({ icon: 'trash', label: `Delete ${p.name}`, onClick: () => del(p) })));
    });
    mount(el, head, h('p', { class: 'muted' }, 'Any plan can be used on any day. Plans are not tied to days of the week.'), h('ul', { class: 'plan-rows' }, cards), restore,
      h('div', { class: 'row-wrap' }, Button({ label: 'Exercise library', icon: 'dumbbell', kind: 'ghost', href: '#/workout/exercises' }), Button({ label: 'Back to Workout', icon: 'back', kind: 'ghost', href: '#/workout' })));
  }
  await paint();
  return el;
}
