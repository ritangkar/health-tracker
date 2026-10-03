// Weekly average bars for the 3 Months view (S29). The shared BarChart counts its bars as days, so its text would say
// "11 of 13 days" for 13 weeks. This wrapper uses the same barPlot and readout helpers and words everything as weeks. (A6)
// Bars start at zero; a week with no data is a mark, never a zero bar. Finding F-A6-01 asks A3 for a unit word on BarChart.
import { h, clear } from '../../core/dom.js';
import { DataTable, IconButton } from '../../ui/components.js';
import { add } from '../daily/shared.js';
import { barPlot, attachReadout, markSelected, fmtDay, fmtVal } from '../../ui/charts.js';

const weekText = (b) => `Week from ${fmtDay(b.date)}${b.soFar ? ' (so far)' : ''}`;
/** buckets [{date, value|null, n, N, soFar}] from bucketAverages(). */
export function WeeklyBars({ title, buckets, unit = '', decimals = 0, tone = 'primary', target = null, coverage = null }) {
  const host = h('div', { class: 'chart-host' }); const state = { table: false };
  const have = buckets.filter((b) => b.value !== null);
  const draw = () => {
    clear(host);
    const cov = coverage || { n: have.reduce((a, b) => a + b.n, 0), N: buckets.reduce((a, b) => a + b.N, 0) };
    const note = h('p', { class: 'small muted' }, `${cov.n} of ${cov.N} days with data. Each bar is the average of the days with data in that week. Days with nothing logged are left out, not counted as zero.`);
    let body;
    if (state.table) {
      body = DataTable({ caption: `${title}, weekly averages`, columns: [
        { key: 'date', label: 'Week from', format: (_, r) => `${fmtDay(r.date)}${r.soFar ? ' (so far)' : ''}` },
        { key: 'value', label: unit ? `Average (${unit})` : 'Average', align: 'end', format: (v) => fmtVal(v, decimals) },
        { key: 'n', label: 'Days with data', align: 'end', format: (_, r) => `${r.n} of ${r.N}` }
      ], rows: [...buckets].reverse() });
    } else {
      // Draw at the width it will be shown at, so axis text stays readable on a phone (the shared default is 640 wide).
      const width = Math.max(300, Math.min(640, (document.documentElement.clientWidth || 640) - 40));
      const { svg, model } = barPlot({ bars: buckets.map((b) => ({ date: b.date, value: b.value })), unit, decimals, target, tone, label: title, width, height: 230 });
      svg.classList.add('chart-fit');
      const lo = have.length ? Math.min(...have.map((b) => b.value)) : null, hi = have.length ? Math.max(...have.map((b) => b.value)) : null;
      const desc = have.length
        ? `${have.length} of ${buckets.length} weeks have data. Each bar is a weekly average over the days with data. Highest ${fmtVal(hi, decimals)} ${unit}, lowest ${fmtVal(lo, decimals)} ${unit}.${target !== null ? ` Target ${fmtVal(target, decimals)} ${unit}.` : ''}`
        : 'No data in this range.';
      svg.setAttribute('aria-label', `${title}. ${desc}`);
      const t = svg.querySelector('title'), d = svg.querySelector('desc'); if (t) t.textContent = `${title}. ${desc}`; if (d) d.textContent = desc;
      let sel = -1; const line = h('p', { class: 'readout small', 'aria-live': 'polite' }, 'Tap a bar to see that week.');
      const show = (it) => {
        sel = it.i; markSelected(model, it); const b = buckets[it.i];
        line.textContent = b.value === null ? `${weekText(b)}: no data` : `${weekText(b)}: average ${fmtVal(b.value, decimals)} ${unit}, ${b.n} of ${b.N} days with data`;
      };
      attachReadout(svg, model, show);
      const step = (d2) => { if (!model.items.length) return; const n = sel < 0 ? (d2 > 0 ? 0 : model.items.length - 1) : Math.min(model.items.length - 1, Math.max(0, sel + d2)); show(model.items[n]); };
      const prev = IconButton({ icon: 'back', label: 'Previous week', size: 18 }), next = IconButton({ icon: 'forward', label: 'Next week', size: 18 });
      prev.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
      body = h('div', { class: 'chart-plot' }, svg, h('div', { class: 'readout-bar' }, prev, line, next));
    }
    add(host, note, body, h('button', { type: 'button', class: 'link-btn', 'aria-pressed': String(state.table), onClick: () => { state.table = !state.table; draw(); } }, state.table ? 'Show as chart' : 'Show as table'));
  };
  draw();
  return h('section', { class: 'chart-card card', 'aria-label': title }, h('div', { class: 'chart-head spread' }, h('h3', { class: 'chart-title' }, title)), host);
}
