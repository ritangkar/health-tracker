// S15 Choose workout: every plan is available on every day, Complete Rest included (D-047). Choosing snapshots the plan into a workout log. (A4)
import { h, mount, logError } from '../../core/dom.js';
import { Button, EmptyState, Chip, toast } from '../../ui/components.js';
import { listPlans, resolveExerciseSync } from '../../core/seed.js';
import { createWorkoutLog, applyPlanStepGoal } from '../../core/repo.js';
import { fmtNum } from '../../core/units.js';
import { todayKey, formatDay } from '../../core/dates.js';
import { dateHash, runSave } from '../daily/shared.js';

export async function chooseScreen(ctx) {
  const { pid, date } = ctx; const el = h('section', { class: 'screen choose-screen' });
  let busy = false;
  let plans = []; try { plans = await listPlans(pid); } catch (e) { logError(e, 'plans'); }
  async function choose(plan, btn) {
    if (busy) return; busy = true; btn.disabled = true;
    const res = await runSave(async () => {
      const resolve = await resolveExerciseSync(pid);
      const log = await createWorkoutLog(pid, { date, plan, resolveExercise: resolve });
      await applyPlanStepGoal(pid, date, plan);   // a goal you set by hand for this day stays (C-027)
      return log;
    }, (l) => toast(l[0].message));
    busy = false; btn.disabled = false;
    if (!res.ok) return;
    if (plan.isRest) { toast('Rest day recorded'); ctx.replace(dateHash('/workout', date)); } else ctx.replace(`#/workout/session/${encodeURIComponent(res.value.id)}`);
  }
  const head = h('div', { class: 'screen-head' }, h('h1', null, 'Choose workout'), Button({ label: 'Back', kind: 'ghost', icon: 'back', onClick: () => ctx.back(dateHash('/workout', date)) }));
  const sub = h('p', { class: 'muted' }, `For ${date === todayKey() ? 'today' : formatDay(date)}. Any workout, any day. Your step goal follows the plan unless you set it yourself.`);
  if (!plans.length) { mount(el, head, EmptyState({ icon: 'dumbbell', title: 'No plans to show', text: 'The default plans could not be loaded. Reload the app, or restore the defaults from Plans.', action: { label: 'Reload', onClick: () => location.reload() } })); return el; }
  const cards = plans.map((p) => {
    const n = (p.items || []).length;
    const btn = h('button', { type: 'button', class: 'plan-card', 'aria-label': `Start ${p.name}` },
      h('span', { class: 'plan-name' }, p.name), p.description ? h('span', { class: 'small muted' }, p.description) : null,
      h('span', { class: 'row-wrap' }, p.isRest ? Chip({ label: 'Rest day' }) : Chip({ label: `${n} ${n === 1 ? 'exercise' : 'exercises'}` }), p.stepGoal ? Chip({ label: `${fmtNum(p.stepGoal)} steps` }) : null));
    btn.addEventListener('click', () => choose(p, btn)); return btn;
  });
  mount(el, head, sub, h('div', { class: 'plan-list' }, cards));
  return el;
}
