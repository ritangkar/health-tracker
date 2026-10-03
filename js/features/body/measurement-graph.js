// S24 Measurement graph (D-016, C-024): LineChart with 1M|3M|6M|1Y|All, latest/previous/change, trend only with 5+ points, gaps stay gaps.
// Height is a value list, not a graph. Body fat is labelled approximate. Readings list with Edit and Delete underneath. (A5)
import { h, mount, logError } from '../../core/dom.js';
import { Button, Card, EmptyState, EstimateBadge, IconButton, LineChart, ConfirmDialog, DEFAULT_RANGES, toast } from '../../ui/components.js';
import { notFound } from '../../core/router.js';
import { measurementSeries, deleteMeasurement } from '../../core/repo.js';
import { todayKey, formatDay } from '../../core/dates.js';
import { fmtNum } from '../../core/units.js';
import { reportWriteError } from '../../core/dom.js';
import { add } from '../daily/shared.js';
import { typeByKey, chartPoints, defaultRange, HEIGHT_KEY } from './series.js';

export const GAP_SOLID_DAYS = 2, GAP_DASHED_DAYS = 8; // body readings are sparse: a connector only across short gaps
const PAGE = 30;

export async function graphScreen(ctx) {
  const { pid } = ctx; const t = typeByKey(ctx.params.typeId); if (!t) notFound();
  const el = h('section', { class: 'screen graph-screen' }); let alive = true; ctx.onCleanup(() => { alive = false; });
  let shown = PAGE; let range = null;
  async function paint() {
    let readings; try { readings = await measurementSeries(pid, t.id); } catch (e) { logError(e, 'graph load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load readings', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return;
    const dp = t.decimals ?? 1; const pts = chartPoints(readings); const end = todayKey();
    if (!range) range = defaultRange(pts, end);
    const head = h('div', { class: 'food-head' }, h('div', { class: 'row-wrap' }, h('h1', null, t.label), t.approx ? EstimateBadge({ kind: 'approx' }) : null), Button({ label: `Add ${t.label.toLowerCase()}`, icon: 'plus', kind: 'primary', href: `#/body/${encodeURIComponent(t.key)}/add` }));
    const back = Button({ label: 'All measurements', kind: 'ghost', icon: 'back', href: '#/body' });
    if (!readings.length) { mount(el, head, EmptyState({ icon: 'body', title: 'No measurements yet', text: `Add a ${t.label.toLowerCase()} reading to start this graph.`, action: { label: `Add ${t.label.toLowerCase()}`, href: `#/body/${encodeURIComponent(t.key)}/add` } }), back); return; }
    const chart = t.key === HEIGHT_KEY ? Card({ title: 'Height values', children: [h('p', { class: 'muted' }, 'Height rarely changes, so it is a list of readings rather than a graph.'), h('p', null, h('span', { class: 'big-num num' }, fmtNum(pts[pts.length - 1].value, dp)), h('span', { class: 'muted' }, ` ${t.canonicalUnit} on ${formatDay(pts[pts.length - 1].date)}`))] })
      : LineChart({ title: `${t.label} over time`, points: pts, unit: t.canonicalUnit, decimals: dp, tone: 'primary', ranges: DEFAULT_RANGES, range, endDate: end, solidMaxGap: GAP_SOLID_DAYS, dashedMaxGap: GAP_DASHED_DAYS, approx: !!t.approx, onRange: (r) => { range = r; } });
    const list = [...readings].reverse();
    const rows = list.slice(0, shown).map((r) => h('li', { class: 'reading-row' },
      h('span', { class: 'grow' }, h('span', { class: 'row-title num' }, `${fmtNum(r.value, dp)} ${t.canonicalUnit}`), h('span', { class: 'small muted' }, ` ${formatDay(r.date)}${r.note ? ` \u00B7 ${r.note}` : ''}`)),
      IconButton({ icon: 'edit', label: `Edit ${t.label} reading from ${formatDay(r.date)}`, onClick: () => ctx.navigate(`#/body/${encodeURIComponent(t.key)}/edit/${encodeURIComponent(r.id)}`) }),
      IconButton({ icon: 'trash', label: `Delete ${t.label} reading from ${formatDay(r.date)}`, onClick: () => remove(r) })));
    mount(el, head, chart, Card({ title: 'Readings', children: [h('ul', { class: 'reading-list' }, rows), list.length > shown ? Button({ label: `Show more (${list.length - shown} left)`, kind: 'secondary', onClick: () => { shown += PAGE; paint(); } }) : null] }),
      t.approx ? h('p', { class: 'small muted' }, 'Body fat readings are approximate. A trend line needs five or more readings.') : h('p', { class: 'small muted' }, 'A trend line appears once there are five or more readings. Long gaps are left as gaps.'), back);
  }
  async function remove(r) {
    const ok = await ConfirmDialog({ title: 'Delete this reading?', message: `${fmtNum(r.value, t.decimals ?? 1)} ${t.canonicalUnit} on ${formatDay(r.date)} will be removed.${r.checkinId ? ' The check-in it came from keeps its own copy.' : ''}`, confirmLabel: 'Delete reading', danger: true });
    if (!ok) return;
    try { await deleteMeasurement(pid, r.id); } catch (e) { reportWriteError(e); return; }
    toast('Reading deleted'); await paint();
  }
  await paint();
  return el;
}
