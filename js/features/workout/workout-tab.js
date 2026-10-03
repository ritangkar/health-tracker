// S14 Workout tab: sessions for the viewed day, choose any plan, links to plans and the exercise library. (A4)
import { h, mount, logError } from '../../core/dom.js';
import { Button, Card, EmptyState, DateNavigator, EstimateBadge, Chip } from '../../ui/components.js';
import { getWorkoutLogs, effectiveStepGoal } from '../../core/repo.js';
import { todayKey, formatDay } from '../../core/dates.js';
import { fmtNum } from '../../core/units.js';
import { dateHash, routeExists } from '../daily/shared.js';
import { sessionStatus, kcalText } from './common.js';

const SOURCE = { plan: 'from your workout plan', manual: 'set by you', default: 'your default' };

export async function workoutScreen(ctx) {
  const { pid, date } = ctx; const el = h('section', { class: 'screen workout-screen' });
  let alive = true; ctx.onCleanup(() => { alive = false; });
  async function paint() {
    let logs, goal, hasPlans, hasLib;
    try { [logs, goal, hasPlans, hasLib] = await Promise.all([getWorkoutLogs(pid, date), effectiveStepGoal(pid, date), routeExists('/workout/plans'), routeExists('/workout/exercises')]); }
    catch (e) { logError(e, 'workout load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load workouts', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return;
    logs.sort((a, b) => a.startedAt - b.startedAt);
    const cards = logs.map((l) => h('a', { class: 'session-card', href: `${date === todayKey() ? '#/workout/session/' : '#/workout/view/'}${encodeURIComponent(l.id)}` }, // F-A5-05: other days open the read-only view
      h('span', { class: 'grow' }, h('span', { class: 'row-title' }, l.planName), h('span', { class: 'small muted' }, ` ${sessionStatus(l)}`)),
      l.kcalTotal != null ? h('span', { class: 'row-side' }, h('span', { class: 'num' }, kcalText(l.kcalTotal)), EstimateBadge({ kind: 'est' })) : null));
    const links = h('div', { class: 'row-wrap' }, hasPlans ? Button({ label: 'Plans', icon: 'edit', kind: 'secondary', size: 'sm', href: '#/workout/plans' }) : null, hasLib ? Button({ label: 'Exercise library', icon: 'dumbbell', kind: 'secondary', size: 'sm', href: '#/workout/exercises' }) : null);
    mount(el, h('div', { class: 'food-head' }, h('h1', null, date === todayKey() ? 'Workout' : `Workout, ${formatDay(date)}`), Button({ label: logs.length ? 'Add another workout' : 'Choose workout', icon: 'plus', kind: 'primary', href: dateHash('/workout/choose', date) })),
      DateNavigator({ date, onChange: (d) => ctx.replace(d === todayKey() ? '#/workout' : `#/workout?d=${d}`) }),
      logs.length ? Card({ title: logs.length === 1 ? 'Session' : 'Sessions', children: [h('div', { class: 'stack-sm' }, cards)] })
        : EmptyState({ icon: 'dumbbell', title: 'No workout yet', text: 'Pick any workout for any day, or choose Complete Rest. Plans are not tied to days of the week.', action: { label: 'Choose workout', href: dateHash('/workout/choose', date) } }),
      h('p', { class: 'small muted' }, `Step goal for this day: ${fmtNum(goal.goal)} (${SOURCE[goal.source] || 'your default'}).`), links);
  }
  await paint();
  return el;
}
