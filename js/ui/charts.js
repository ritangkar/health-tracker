// Hand-written SVG charts (D-016, C-024). No library. No style attributes: SVG attributes, classes and setProperty only. (A3)
// Pure builders: each returns {svg, model}. components.js wraps them with range selector, stats, readout and table toggle.
//  linePlot({points:[{date,value}], from, to, unit, decimals, target, targetLabel, tone, solidMaxGap=1, dashedMaxGap=3, label})
//    raw points always drawn; solid connector only when gap <= solidMaxGap days; dashed when gap <= dashedMaxGap; longer gaps stay gaps;
//    trend line only with >= 5 points, labelled "Trend"; y axis is labelled and may be non-zero (it is labelled, never hidden).
//  barPlot({bars:[{date,value|null}], unit, decimals, target, targetLabel, tone, label})   bars always start at zero; null = no bar + baseline mark.
//  ringPlot({value, max, size, tone, label})   second lap drawn as a dashed outline; value null = dashed empty ring.
//  trendFit(points) -> {slope, intercept, x0}|null,  summarize(points) -> {latest, previous, change, n}
//  attachReadout(svg, model, onSelect) pointer tap/move -> nearest item.   fmtDay(key) 'day month'
import { svgEl } from '../core/dom.js';
import { daysBetween, addDays, fromKey } from '../core/dates.js';

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (k) => { const d = fromKey(k); return `${d.getDate()} ${MN[d.getMonth()]}`; };
export const fmtVal = (v, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '\u2014' : v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp }));

export function niceTicks(min, max, count = 4) {
  if (!(max > min)) { const pad = Math.abs(min) * 0.05 || 1; min -= pad; max += pad; }
  const raw = (max - min) / count; const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step * 1e6) / 1e6 * step);
  return { ticks, min: lo, max: hi, step };
}
export function trendFit(points) {
  if (!points || points.length < 5) return null;
  const x0 = points[0].date; const xs = points.map((p) => daysBetween(x0, p.date)); const ys = points.map((p) => p.value);
  const n = points.length; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den === 0) return null;
  const slope = num / den; return { slope, intercept: my - slope * mx, x0 };
}
export function summarize(points) {
  const n = points.length; const latest = n ? points[n - 1] : null; const previous = n > 1 ? points[n - 2] : null;
  return { latest, previous, change: latest && previous ? latest.value - previous.value : null, n };
}
const line = (x1, y1, x2, y2, cls) => svgEl('line', { x1, y1, x2, y2, class: cls });
const text = (x, y, cls, s, anchor) => svgEl('text', { x, y, class: cls, 'text-anchor': anchor || 'start' }, s);
const rnd = (n) => Math.round(n * 100) / 100;

function frame(W, H, tone, label, desc) {
  const id = 'c' + Math.random().toString(36).slice(2, 8);
  return svgEl('svg', { class: `chart-svg tone-${tone}`, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet', focusable: 'false' },
    svgEl('title', { id: id + 't' }, label), svgEl('desc', { id: id + 'd' }, desc || label));
}

export function linePlot({ points, from, to, unit = '', decimals = 1, target = null, targetLabel = 'Target', tone = 'primary', solidMaxGap = 1, dashedMaxGap = 3, label = 'Line chart', width = 640, height = 240 }) {
  const W = width, H = height, M = { l: 46, r: 14, t: 14, b: 30 }; const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const pts = points.filter((p) => Number.isFinite(p.value)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const f = from || (pts[0] && pts[0].date) || '2000-01-01', t = to || (pts[pts.length - 1] && pts[pts.length - 1].date) || f;
  const span = Math.max(1, daysBetween(f, t));
  const vals = pts.map((p) => p.value); if (target !== null) vals.push(target);
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const padv = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1;
  const nt = niceTicks(lo - padv, hi + padv, 4);
  const X = (d) => M.l + (pw * daysBetween(f, d)) / span; const Y = (v) => M.t + ph - ((v - nt.min) / (nt.max - nt.min)) * ph;
  const tr = trendFit(pts);
  const sm = summarize(pts);
  const dec = decimals;
  const desc = pts.length
    ? `${pts.length} readings from ${fmtDay(pts[0].date)} to ${fmtDay(pts[pts.length - 1].date)}. Latest ${fmtVal(sm.latest.value, dec)} ${unit} on ${fmtDay(sm.latest.date)}${sm.previous ? `, previous ${fmtVal(sm.previous.value, dec)}, change ${sm.change > 0 ? 'up' : sm.change < 0 ? 'down' : 'none'} ${fmtVal(Math.abs(sm.change), dec)}` : ''}. Range ${fmtVal(Math.min(...vals), dec)} to ${fmtVal(Math.max(...vals), dec)} ${unit}.${tr ? ' A trend line is shown.' : ''}`
    : 'No readings in this range.';
  const svg = frame(W, H, tone, `${label}. ${desc}`, desc);
  const g = svgEl('g', { class: 'grid' }); svg.appendChild(g);
  for (const v of nt.ticks) { const y = rnd(Y(v)); g.appendChild(line(M.l, y, W - M.r, y, 'grid-line')); g.appendChild(text(M.l - 6, y + 4, 'axis-text', fmtVal(v, v % 1 ? dec : 0), 'end')); }
  const nx = Math.min(5, span + 1);
  for (let i = 0; i < nx; i++) { const d = addDays(f, Math.round((span * i) / Math.max(1, nx - 1))); g.appendChild(text(rnd(X(d)), H - 8, 'axis-text', fmtDay(d), i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle')); }
  if (target !== null) { const y = rnd(Y(target)); svg.appendChild(line(M.l, y, W - M.r, y, 'target-line')); svg.appendChild(text(W - M.r - 2, y - 4, 'target-text', `${targetLabel} ${fmtVal(target, dec)}`, 'end')); }
  const segs = svgEl('g', { class: 'segments' }); svg.appendChild(segs);
  for (let i = 1; i < pts.length; i++) {
    const gap = daysBetween(pts[i - 1].date, pts[i].date); if (gap > dashedMaxGap) continue;
    segs.appendChild(svgEl('line', { x1: rnd(X(pts[i - 1].date)), y1: rnd(Y(pts[i - 1].value)), x2: rnd(X(pts[i].date)), y2: rnd(Y(pts[i].value)), class: gap <= solidMaxGap ? 'seg seg-solid' : 'seg seg-dashed' }));
  }
  if (tr) {
    const xa = daysBetween(f, pts[0].date), xb = daysBetween(f, pts[pts.length - 1].date); const ya = tr.intercept, yb = tr.intercept + tr.slope * daysBetween(pts[0].date, pts[pts.length - 1].date);
    svg.appendChild(svgEl('line', { x1: rnd(M.l + (pw * xa) / span), y1: rnd(Y(ya)), x2: rnd(M.l + (pw * xb) / span), y2: rnd(Y(yb)), class: 'trend-line' }));
    svg.appendChild(text(M.l + 4, M.t + 10, 'trend-text', 'Trend (dotted line)'));
  }
  const dots = svgEl('g', { class: 'dots' }); svg.appendChild(dots);
  const items = pts.map((p, i) => { const x = rnd(X(p.date)), y = rnd(Y(p.value)); dots.appendChild(svgEl('circle', { cx: x, cy: y, r: 3.5, class: 'dot', 'data-i': i })); return { i, x, y, date: p.date, value: p.value }; });
  const sel = svgEl('circle', { class: 'dot-sel', r: 7, cx: -20, cy: -20 }); svg.appendChild(sel);
  return { svg, model: { kind: 'line', items, W, H, M, sel, summary: desc, trend: !!tr, n: pts.length } };
}

export function barPlot({ bars, unit = '', decimals = 0, target = null, targetLabel = 'Target', tone = 'primary', label = 'Bar chart', width = 640, height = 240 }) {
  const W = width, H = height, M = { l: 46, r: 14, t: 14, b: 30 }; const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const data = bars; const have = data.filter((b) => b.value !== null && b.value !== undefined && Number.isFinite(b.value));
  const top = Math.max(1, ...have.map((b) => b.value), target || 0);
  const nt = niceTicks(0, top, 4); const Y = (v) => M.t + ph - (v / nt.max) * ph;
  const n = Math.max(1, data.length); const slot = pw / n; const bw = Math.max(2, Math.min(40, slot * 0.7));
  const avg = have.length ? have.reduce((a, b) => a + b.value, 0) / have.length : null;
  const desc = have.length ? `${have.length} of ${data.length} days have data. Average ${fmtVal(avg, decimals)} ${unit}. Highest ${fmtVal(Math.max(...have.map((b) => b.value)), decimals)}, lowest ${fmtVal(Math.min(...have.map((b) => b.value)), decimals)}.${target !== null ? ` Target ${fmtVal(target, decimals)}.` : ''}` : 'No data in this range.';
  const svg = frame(W, H, tone, `${label}. ${desc}`, desc);
  const g = svgEl('g', { class: 'grid' }); svg.appendChild(g);
  for (const v of nt.ticks) { const y = rnd(Y(v)); g.appendChild(line(M.l, y, W - M.r, y, v === 0 ? 'base-line' : 'grid-line')); g.appendChild(text(M.l - 6, y + 4, 'axis-text', fmtVal(v, 0), 'end')); }
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const items = []; const bg = svgEl('g', { class: 'bars' }); svg.appendChild(bg);
  data.forEach((b, i) => {
    const cx = M.l + slot * i + slot / 2;
    if (b.value === null || b.value === undefined || !Number.isFinite(b.value)) { bg.appendChild(line(rnd(cx - 3), rnd(Y(0) - 2), rnd(cx + 3), rnd(Y(0) - 2), 'nodata-mark')); }
    else { const y = Y(b.value); bg.appendChild(svgEl('rect', { x: rnd(cx - bw / 2), y: rnd(y), width: rnd(bw), height: rnd(Math.max(0, Y(0) - y)), rx: 2, class: 'bar', 'data-i': items.length })); }
    items.push({ i, x: rnd(cx), y: b.value === null || b.value === undefined ? Y(0) : rnd(Y(b.value)), date: b.date, value: b.value ?? null });
    if (b.date && i % labelEvery === 0) svg.appendChild(text(rnd(cx), H - 8, 'axis-text', fmtDay(b.date), 'middle'));
  });
  if (target !== null) { const y = rnd(Y(target)); svg.appendChild(line(M.l, y, W - M.r, y, 'target-line')); svg.appendChild(text(W - M.r - 2, y - 4, 'target-text', `${targetLabel} ${fmtVal(target, decimals)}`, 'end')); }
  const sel = svgEl('rect', { class: 'bar-sel', x: -50, y: -50, width: 0, height: 0, rx: 3 }); svg.appendChild(sel);
  return { svg, model: { kind: 'bar', items: items.filter((it) => true), W, H, M, sel, bw, summary: desc, avg, n: have.length, N: data.length } };
}

export function ringPlot({ value, max, size = 168, tone = 'primary', label = 'Progress', stroke = 9 }) {
  const r = 50 - stroke / 2 - 1; const C = 2 * Math.PI * r;
  const none = value === null || value === undefined || !Number.isFinite(value);
  const frac = none || !(max > 0) ? 0 : value / max;
  const svg = svgEl('svg', { class: `ring-svg tone-${tone}`, viewBox: '0 0 100 100', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(svgEl('circle', { cx: 50, cy: 50, r, fill: 'none', 'stroke-width': stroke, class: none ? 'ring-track ring-empty' : 'ring-track' }));
  const arc = (f, cls) => { const len = Math.max(0, Math.min(1, f)) * C; if (len <= 0) return; svg.appendChild(svgEl('circle', { cx: 50, cy: 50, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': len >= C ? 'butt' : 'round', 'stroke-dasharray': `${rnd(len)} ${rnd(C - len)}`, transform: 'rotate(-90 50 50)', class: cls })); };
  arc(Math.min(1, frac), 'ring-arc');
  if (frac > 1) arc(Math.min(1, frac - 1), 'ring-lap2');
  return svg;
}

/** Pointer tap/move -> nearest item by x. Returns detach(). */
export function attachReadout(svg, model, onSelect) {
  const pick = (ev) => {
    const r = svg.getBoundingClientRect(); if (!r.width || !model.items.length) return;
    const x = ((ev.clientX - r.left) / r.width) * model.W;
    let best = model.items[0], bd = Infinity; for (const it of model.items) { const d = Math.abs(it.x - x); if (d < bd) { bd = d; best = it; } }
    onSelect(best);
  };
  const down = (e) => pick(e); const move = (e) => { if (e.buttons || e.pointerType === 'mouse') pick(e); };
  svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move);
  return () => { svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move); };
}
export function markSelected(model, it) {
  if (!model.sel) return;
  if (!it) { model.sel.setAttribute(model.kind === 'line' ? 'cx' : 'x', -50); return; }
  if (model.kind === 'line') { model.sel.setAttribute('cx', it.x); model.sel.setAttribute('cy', it.y); }
  else { const bw = model.bw + 6; model.sel.setAttribute('x', it.x - bw / 2); model.sel.setAttribute('y', model.M.t); model.sel.setAttribute('width', bw); model.sel.setAttribute('height', model.H - model.M.t - model.M.b); }
}
