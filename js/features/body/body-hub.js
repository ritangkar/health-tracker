// S22 Body hub: latest value, date, change and a small trend line for each measurement (D-016, measurement_ux). (A5)
import { h, mount, logError } from '../../core/dom.js';
import { Button, Card, EmptyState, EstimateBadge } from '../../ui/components.js';
import { measurementSeries } from '../../core/repo.js';
import { formatDay } from '../../core/dates.js';
import { fmtNum } from '../../core/units.js';
import { add } from '../daily/shared.js';
import { measurementTypes, chartPoints, changeText, sparkline, rangeText } from './series.js';

const SPARK_POINTS = 12;
export async function bodyScreen(ctx) {
  const { pid } = ctx; const el = h('section', { class: 'screen body-screen' });
  let alive = true; ctx.onCleanup(() => { alive = false; });
  async function paint() {
    let rows;
    try { rows = await Promise.all(measurementTypes().map(async (t) => ({ t, pts: chartPoints(await measurementSeries(pid, t.id)) }))); }
    catch (e) { logError(e, 'body load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load measurements', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return;
    const any = rows.some((r) => r.pts.length);
    const head = h('div', { class: 'food-head' }, h('h1', null, 'Body'), Button({ label: 'Add measurement', icon: 'plus', kind: 'primary', href: '#/body/add' }));
    if (!any) { mount(el, head, EmptyState({ icon: 'body', title: 'No measurements yet', text: 'Add your weight, waist or any other measurement. Each one gets its own graph over time.', action: { label: 'Add measurement', href: '#/body/add' } }), h('p', { class: 'small muted' }, 'Body fat readings are approximate.')); return; }
    const cards = rows.map(({ t, pts }) => {
      const latest = pts[pts.length - 1] || null, prev = pts.length > 1 ? pts[pts.length - 2] : null; const dp = t.decimals ?? 1;
      const last = pts.slice(-SPARK_POINTS).map((p) => p.value);
      const body = latest
        ? [h('p', { class: 'body-latest' }, h('span', { class: 'big-num num' }, fmtNum(latest.value, dp)), h('span', { class: 'muted' }, ` ${t.canonicalUnit}`), t.approx ? EstimateBadge({ kind: 'approx' }) : null),
          h('p', { class: 'small muted' }, `${formatDay(latest.date)} \u00B7 ${changeText(latest, prev, t.canonicalUnit, dp)}`),
          last.length > 1 ? h('div', { class: 'body-spark' }, sparkline(last), h('span', { class: 'small muted' }, `Last ${last.length}: ${rangeText(last, t.canonicalUnit, dp)}`)) : null]
        : [h('p', { class: 'muted' }, 'No readings yet'), h('p', { class: 'small muted' }, 'Tap to add the first one.')];
      return h('a', { class: 'body-card card', href: latest ? `#/body/${encodeURIComponent(t.key)}` : `#/body/add?type=${encodeURIComponent(t.key)}`, 'aria-label': `${t.label}${latest ? `, latest ${fmtNum(latest.value, dp)} ${t.canonicalUnit}` : ', no readings yet'}` },
        h('span', { class: 'row-title' }, t.label), body);
    });
    mount(el, head, h('div', { class: 'body-grid' }, cards), h('p', { class: 'small muted' }, 'Body fat readings are approximate. Trends need a few readings to mean anything.'));
  }
  await paint();
  return el;
}
