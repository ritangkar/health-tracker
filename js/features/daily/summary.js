// Nutrition summary pieces used by Today (S02) and the Food tab (S07). (A4)
import { h } from '../../core/dom.js';
import { ProgressBar, EstimateBadge } from '../../ui/components.js';
import { DASH, fmtNum } from '../../core/units.js';
import { r1 } from './shared.js';

export function macroValueText(v, tgt, unit = 'g') {
  if (v === null || v === undefined) return DASH;
  if (tgt === null || tgt === undefined) return `${fmtNum(r1(v), 1)} ${unit}`;
  const over = v > tgt ? ` \u00B7 +${fmtNum(r1(v - tgt), 1)} over` : '';
  return `${fmtNum(r1(v), 1)} / ${fmtNum(tgt)} ${unit}${over}`;
}
/** Bars always start at zero (D-016). No data shows a dash, never a zero bar. */
export function macroBars(totals, targets) {
  const none = !totals || totals.count === 0;
  const row = (key, label, tone, tgt) => {
    const v = none ? null : totals[key];
    return ProgressBar({ value: v, max: tgt ?? 0, label, valueText: macroValueText(v, tgt), tone, over: v != null && tgt != null && v > tgt });
  };
  const partial = !none && totals.fiberPartial;
  const macroPartial = !none && (totals.proteinPartial || totals.carbsPartial || totals.fatPartial);
  return h('div', { class: 'macro-bars stack-sm' },
    row('protein', 'Protein', 'protein', targets ? targets.protein : null), row('carbs', 'Carbs', 'carbs', targets ? targets.carbs : null),
    row('fat', 'Fat', 'fat', targets ? targets.fat : null), row('fiber', 'Fibre', 'fiber', targets ? targets.fiber : null),
    macroPartial ? h('p', { class: 'small muted row-wrap' }, EstimateBadge({ kind: 'approx', text: 'partial', explain: 'Some entries only list calories, so protein, carbs or fat totals are incomplete.' }), 'Protein, carbs or fat total is incomplete.') : null,
    partial ? h('p', { class: 'small muted row-wrap' }, EstimateBadge({ kind: 'approx', text: 'partial', explain: 'Some entries do not list fibre, so this total is incomplete.' }), 'Fibre total is incomplete.') : null);
}
