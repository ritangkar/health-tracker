// Workout helpers for S14-S16 (A4): target text, stepper settings, status text. Plans are never tied to a day of the week (D-007).
import { fmtNum } from '../../core/units.js';

const KIND_WORD = { reps: 'reps', seconds: 'seconds', minutes: 'minutes', meters: 'km', rounds: 'rounds' };
/** Targets for meters are stored in metres and shown in km. */
export const toUi = (kind, v) => (v == null ? null : kind === 'meters' ? Math.round((v / 1000) * 1000) / 1000 : v);
export const fromUi = (kind, v) => (v == null ? null : kind === 'meters' ? Math.round(v * 1000) : v);
export function stepFor(kind) { return kind === 'seconds' ? { step: 5, min: 0, max: 36000 } : kind === 'minutes' ? { step: 1, min: 0, max: 1440 } : kind === 'meters' ? { step: 0.1, min: 0, max: 500 } : kind === 'rounds' ? { step: 1, min: 0, max: 1000 } : { step: 1, min: 0, max: 10000 }; }
export function unitWord(item, ex) { return ex && ex.unitLabel ? ex.unitLabel : KIND_WORD[item.targetKind] || ''; }
/** '10 reps', '5-10 rounds', '12 reps each leg', '30 seconds'. Range: value is the minimum, targetMax the stretch (D-028). */
export function targetText(item, ex) {
  const lo = toUi(item.targetKind, item.target); const hi = item.targetMax != null ? toUi(item.targetKind, item.targetMax) : null;
  const word = unitWord(item, ex); const each = item.perSide && !/each|side|leg|arm/i.test(word) ? ' each side' : '';
  return `${fmtNum(lo, 2)}${hi != null ? `\u2013${fmtNum(hi, 2)}` : ''} ${word}${each}`.trim();
}
export function sessionStatus(log) {
  if (log.isRest) return 'Rest day';
  if (log.completionPct == null) return 'Not started';
  return `${log.completionPct}% complete`;
}
export const kcalText = (k) => (k == null ? null : `~${fmtNum(Math.round(k * 10) / 10, 1)} kcal`);
