// S29 Trends (#/progress/trends[/<metric>]), D-058. Week = last 7 days, Month = last 30 days plus weekly averages,
// 3 Months = 13 calendar weeks. Ten metrics. Bars start at zero, lines are body measurements, no data is never plotted as zero,
// averages use only days with data and say "n of N days", the target line comes from the effective-dated targets, no scores,
// no streaks, no red. (A6)
import { h, mount, logError, announce } from '../../core/dom.js';
import { Button, Card, EmptyState, EstimateBadge, Tabs, BarChart, LineChart, DataTable } from '../../ui/components.js';
import { notFound } from '../../core/router.js';
import { getSettings } from '../../core/repo.js';
import { todayKey } from '../../core/dates.js';
import { fmtNum } from '../../core/units.js';
import { fmtDay } from '../../ui/charts.js';
import { add } from '../daily/shared.js';
import { METRICS, METRIC_GROUPS, PERIODS, metricById, periodById, periodRange, dailyValues, weeklyBuckets, bucketAverages, overall, targetFor, compareToTarget, fmtAverage } from './metrics.js';
import { loadMetricData } from './load.js';
import { WeeklyBars } from './trend-chart.js';

// Remembered for this tab only, so coming back keeps your choice. Not stored anywhere.
const GAP_SOLID_DAYS = 2, GAP_DASHED_DAYS = 8; // same as the Body graph: readings are sparse, so a connector only crosses short gaps
const session = { period: 'month', metric: 'weight' };

const stat = (label, value, sub) => h('div', { class: 'chart-stat' }, h('dt', { class: 'small muted' }, label), h('dd', null, value, sub ? h('span', { class: 'small muted' }, ` ${sub}`) : null));

export async function trendsScreen(ctx) {
  const { pid } = ctx;
  if (ctx.params.metric && !metricById(ctx.params.metric)) notFound();
  const el = h('section', { class: 'screen trends-screen' }); let alive = true; let token = 0; ctx.onCleanup(() => { alive = false; });
  const state = { period: session.period, metric: ctx.params.metric || session.metric };
  let settings;
  try { settings = await getSettings(pid); }
  catch (e) { logError(e, 'trends settings'); return h('section', { class: 'screen' }, EmptyState({ icon: 'warning', title: 'Could not load trends', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: () => ctx.navigate('#/progress/trends') }, headingLevel: 1 })); }
  const weekStartKey = settings.weekStart; // undefined falls back to the app default inside dates.js

  const body = h('div', { class: 'trends-body stack', 'aria-busy': 'false' });
  const chips = new Map();
  const periodTabs = Tabs({ tabs: PERIODS, selected: state.period, label: 'Time period', onSelect: (id) => { state.period = id; session.period = id; paint(true); } });
  const chipRow = (group) => h('div', { class: 'metric-group' }, h('p', { class: 'metric-group-label small muted', id: `mg-${group.id}` }, group.label),
    h('div', { class: 'metric-chips', role: 'group', 'aria-labelledby': `mg-${group.id}` }, METRICS.filter((m) => m.group === group.id).map((m) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(m.id === state.metric), onClick: () => { state.metric = m.id; session.metric = m.id; syncChips(); paint(true); } }, h('span', null, m.short || m.label));
      if (m.id === state.metric) b.classList.add('is-selected'); chips.set(m.id, b); return b;
    })));
  const syncChips = () => { for (const [id, b] of chips) { const on = id === state.metric; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-selected', on); } };

  async function paint(announceIt = false) {
    const my = ++token; const metric = metricById(state.metric); const period = periodById(state.period);
    body.setAttribute('aria-busy', 'true');
    const today = todayKey(); const range = periodRange(state.period, today, weekStartKey);
    let data;
    try { data = await loadMetricData(pid, metric, range.from, range.to); }
    catch (e) { logError(e, 'trends load'); if (alive && my === token) mount(body, EmptyState({ icon: 'warning', title: 'Could not load this chart', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: () => paint() } })); body.setAttribute('aria-busy', 'false'); return; }
    if (!alive || my !== token) return;
    const view = metric.kind === 'line' ? lineView(metric, data, range, today) : barView(metric, data, range, today, state.period);
    mount(body, h('h2', { class: 'sr-only' }, `${metric.label}, ${period.label}`), ...view.nodes);
    body.setAttribute('aria-busy', 'false');
    if (announceIt) announce(view.announce);
  }

  function emptyView(metric) {
    return EmptyState({ icon: 'chart', title: 'Not enough data yet', text: `${metric.emptyText || `Add a reading and it will show up here.`} Days with nothing logged are left out, not counted as zero.`, action: { label: metric.logLabel, href: metric.logHref }, headingLevel: 3 });
  }

  function lineView(metric, data, range, today) {
    const pts = data.points || []; const dp = (data.type && data.type.decimals) ?? metric.decimals;
    const n = pts.length; const nodes = [];
    if (!n) { nodes.push(Card({ title: metric.label, children: [emptyView(metric)] })); return { nodes, announce: `${metric.label}: not enough data yet` }; }
    nodes.push(LineChart({ title: `${metric.label} over time`, points: pts, unit: metric.unit, decimals: dp, tone: metric.tone, ranges: [{ id: 'p', label: 'Period', days: range.keys.length }], range: 'p', endDate: today, solidMaxGap: GAP_SOLID_DAYS, dashedMaxGap: GAP_DASHED_DAYS, approx: !!metric.approx, coverage: { n, N: range.keys.length }, emptyText: 'No readings in this period.' }));
    nodes.push(h('p', { class: 'small muted' }, metric.approx ? 'Body fat readings are approximate. ' : '', 'A trend line appears once there are five or more readings in the period. Long gaps are left as gaps.'));
    nodes.push(h('div', { class: 'row-wrap' }, Button({ label: `Add ${metric.label.toLowerCase()}`, icon: 'plus', href: metric.logHref }), Button({ label: `All ${metric.label.toLowerCase()} readings`, kind: 'ghost', href: `#/body/${encodeURIComponent(metric.typeKey)}` })));
    return { nodes, announce: `${metric.label}: ${n} ${n === 1 ? 'reading' : 'readings'} in this period` };
  }

  function barView(metric, data, range, today, periodId) {
    const { values, partialDays } = dailyValues(metric, range.keys, data);
    const o = overall(values); const tgt = targetFor(settings.targetsHistory, range.keys, metric);
    const nodes = [];
    if (!o.n) { nodes.push(Card({ title: metric.label, children: [emptyView(metric)] })); return { nodes, announce: `${metric.label}: not enough data yet` }; }
    const buckets = weeklyBuckets(range.keys, weekStartKey, today); const weekly = bucketAverages(values, buckets, metric.decimals);
    const common = { title: `${metric.label}${metric.titleUnit ? ` (${metric.titleUnit})` : ''}${range.weekly ? ', weekly average' : ', per day'}`, unit: metric.unit, decimals: metric.decimals, tone: metric.tone, target: tgt.value, targetLabel: 'Target' };
    nodes.push(range.weekly ? WeeklyBars({ ...common, buckets: weekly, coverage: { n: o.n, N: o.N } }) : BarChart({ ...common, bars: values, coverage: { n: o.n, N: o.N }, endDate: today }));
    // Summary: average over days with data, how many days that was, and the target when there is one.
    const cmp = compareToTarget(o.avg === null ? null : (Math.round(o.avg * 10 ** metric.decimals) / 10 ** metric.decimals), tgt.value, metric);
    nodes.push(Card({ title: 'Summary', children: [
      h('dl', { class: `chart-stats trend-stats${metric.targetKey ? '' : ' trend-stats-2'}` }, stat('Average', fmtAverage(metric, o.avg), range.weekly ? 'per logged day' : ''), stat('Days with data', `${o.n} of ${o.N}`), metric.targetKey ? stat('Target', tgt.value === null ? 'Not set' : fmtAverage(metric, tgt.value), cmp || '') : null),
      h('div', { class: 'row-wrap' }, metric.approx ? EstimateBadge({ kind: 'est', explain: 'Exercise calories are estimates from the exercise, your weight and what you entered. They are not measured.' }) : null,
        metric.approx ? h('span', { class: 'small muted' }, 'These values are estimates.') : null),
      tgt.changed ? h('p', { class: 'small muted' }, 'Your target changed during this period. The line shows the target now in force; earlier days were measured against the target they had.') : null,
      partialDays ? h('p', { class: 'small muted' }, `${partialDays} ${partialDays === 1 ? 'day includes' : 'days include'} ${metric.partialNote || 'entries with missing values'}, so ${partialDays === 1 ? 'that total' : 'those totals'} may be low.`) : null,
      values[values.length - 1].value !== null ? h('p', { class: 'small muted' }, 'Today counts as logged so far.') : null
    ] }));
    if (periodId === 'month') {
      const rows = [...weekly].reverse();
      nodes.push(Card({ title: 'Weekly averages', children: [DataTable({ caption: `${metric.label}, weekly averages`, columns: [
        { key: 'date', label: 'Week from', format: (v, r) => `${fmtDay(v)}${r.soFar ? ' (so far)' : r.startsMidWeek ? ' (part week)' : ''}` },
        { key: 'value', label: `Average${metric.unit ? ` (${metric.unit})` : ''}`, align: 'end', format: (v) => (v === null ? '\u2014' : fmtNum(v, metric.decimals)) },
        { key: 'n', label: 'Days with data', align: 'end', format: (_, r) => `${r.n} of ${r.N}` }], rows }),
      h('p', { class: 'small muted' }, 'Weeks start on the day chosen in Settings. A week marked so far is still running.')] }));
    }
    nodes.push(h('div', { class: 'row-wrap' }, Button({ label: metric.logLabel, icon: 'plus', href: metric.logHref })));
    return { nodes, announce: `${metric.label}: ${o.n} of ${o.N} days with data` };
  }

  const head = h('div', { class: 'food-head' }, h('h1', null, 'Trends'), Button({ label: 'Notes', icon: 'note', kind: 'ghost', href: '#/progress/notes' }));
  add(el, head, periodTabs, h('div', { class: 'metric-picker stack-sm' }, METRIC_GROUPS.map(chipRow)), body,
    h('p', { class: 'small muted' }, 'Averages use only the days you logged. There are no scores or streaks here.'),
    Button({ label: 'Back to Progress', kind: 'ghost', icon: 'back', href: '#/progress' }));
  await paint();
  return el;
}
