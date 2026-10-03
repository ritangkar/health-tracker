// S21 Past session (read-only): #/workout/view/<logId>. Built only from the workout log's own snapshot, so editing or deleting
// the plan or exercise later never changes what is shown (D-026, DoD-10). Never uses the editable session route (F-A4-07). (A5)
import { h, mount } from '../../core/dom.js';
import { Button, Card, Chip, EstimateBadge, Ring } from '../../ui/components.js';
import { notFound } from '../../core/router.js';
import { getWorkoutLog } from '../../core/repo.js';
import { formatLong } from '../../core/dates.js';
import { DASH, fmtNum } from '../../core/units.js';
import { ownedOrNull } from '../daily/shared.js';
import { targetText, kcalText } from './common.js';

const KIND_WORD = { reps: 'reps', seconds: 'seconds', minutes: 'minutes', meters: 'km', rounds: 'rounds' };
export const actualText = (it) => (it.actual == null ? 'Not entered' : `${fmtNum(it.targetKind === 'meters' ? it.actual / 1000 : it.actual, 2)} ${KIND_WORD[it.targetKind] || ''}`.trim());

export async function pastSessionScreen(ctx) {
  const { pid } = ctx; const log = await ownedOrNull(getWorkoutLog(pid, ctx.params.logId)); if (!log) notFound();
  const pct = log.completionPct;
  const rows = (log.items || []).map((it) => h('li', { class: 'past-item' },
    h('div', { class: 'grow' }, h('span', { class: 'row-title' }, it.exerciseName), h('span', { class: 'small muted' }, ` Target ${targetText(it, null)}`),
      h('span', { class: 'small' }, ` Done: ${actualText(it)}`)),
    h('div', { class: 'row-side' }, h('span', { class: 'num' }, it.pct == null ? DASH : `${it.pct}%`), it.pctSource === 'manual' ? Chip({ label: 'set by you' }) : null,
      it.kcalFinal != null ? h('span', { class: 'small muted' }, kcalText(it.kcalFinal)) : null, it.kcalFinal != null ? EstimateBadge({ kind: 'est' }) : null)));
  const weight = log.bodyWeightKg ? `Calories used ${fmtNum(log.bodyWeightKg, 1)} kg${log.weightSource === 'default' ? ' (default)' : log.weightSource === 'manual' ? ' (entered for this workout)' : log.weightDate ? ` (from ${formatLong(log.weightDate)})` : ''}.` : null;
  return h('section', { class: 'screen screen-narrow past-session' },
    h('div', { class: 'screen-head' }, h('h1', null, log.planName), Button({ label: 'Workout', kind: 'ghost', icon: 'back', onClick: () => ctx.back(`#/workout?d=${log.date}`) })),
    h('p', { class: 'muted' }, `${formatLong(log.date)}. This is how the workout was recorded. It does not change when plans change.`),
    Card({ children: [h('div', { class: 'session-totals' }, Ring({ value: pct, max: 100, size: 112, tone: 'primary', label: 'Workout completion', centerTop: pct == null ? DASH : `${pct}%`, centerBottom: log.isRest ? 'rest day' : pct == null ? 'not started' : 'complete', summary: pct == null ? 'Workout completion: none' : `Workout completion: ${pct} percent` }),
      h('div', { class: 'stack-sm grow' }, h('p', { class: 'row-wrap' }, h('span', { class: 'big-pct num' }, log.kcalTotal == null ? DASH : kcalText(log.kcalTotal)), log.kcalTotal == null ? null : EstimateBadge({ kind: 'est' })), weight ? h('p', { class: 'small muted' }, weight) : null, log.planRev ? h('p', { class: 'small muted' }, `Plan version ${log.planRev} at the time.`) : null))] }),
    log.isRest ? h('p', { class: 'muted' }, 'A rest day was recorded.') : Card({ title: 'Exercises', children: [h('ul', { class: 'past-list' }, rows)] }),
    log.note ? Card({ title: 'Note', children: [h('p', { class: 'note-text' }, log.note)] }) : null,
    h('div', { class: 'row-wrap' }, log.isRest ? null : Button({ label: 'Edit this workout', icon: 'edit', href: `#/workout/session/${encodeURIComponent(log.id)}` })));
}
