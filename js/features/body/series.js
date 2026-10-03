// Pure helpers for the Body screens (A5): measurement types, chart points, neutral change text, sparkline, default range. No IO.
import { listMeasurementTypes } from '../../core/seed.js';
import { svgEl } from '../../core/dom.js';
import { addDays, daysBetween, formatDay } from '../../core/dates.js';
import { fmtNum } from '../../core/units.js';
import { DEFAULT_RANGES } from '../../ui/components.js';

export const HEIGHT_KEY = 'height';
const FALLBACK = [
  { id: 'mt:height', key: 'height', label: 'Height', canonicalUnit: 'cm', min: 50, max: 250, decimals: 1, approx: false, v1: true, sortOrder: 1 },
  { id: 'mt:weight', key: 'weight', label: 'Weight', canonicalUnit: 'kg', min: 20, max: 400, decimals: 1, approx: false, v1: true, sortOrder: 2 },
  { id: 'mt:bodyFat', key: 'bodyFat', label: 'Body fat', canonicalUnit: '%', min: 2, max: 70, decimals: 1, approx: true, v1: true, sortOrder: 3 },
  { id: 'mt:biceps', key: 'biceps', label: 'Biceps', canonicalUnit: 'cm', min: 10, max: 80, decimals: 1, approx: false, v1: true, sortOrder: 4 },
  { id: 'mt:thigh', key: 'thigh', label: 'Thigh', canonicalUnit: 'cm', min: 20, max: 120, decimals: 1, approx: false, v1: true, sortOrder: 5 },
  { id: 'mt:waist', key: 'waist', label: 'Waist', canonicalUnit: 'cm', min: 30, max: 250, decimals: 1, approx: false, v1: true, sortOrder: 6 }
];
/** V1 measurement types in display order. Reserved types (chest, hips, neck, calf: v1 false) are never shown (FR-030 is V1.1). */
export function measurementTypes() {
  let list = []; try { list = listMeasurementTypes(); } catch { list = []; }
  const v1 = list.filter((t) => t.v1 !== false);
  return (v1.length ? v1 : FALLBACK).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}
export const typeByKey = (key) => measurementTypes().find((t) => t.key === key) || null;
export const typeById = (id) => measurementTypes().find((t) => t.id === id) || null;

/** readings (any order) -> one point per date: the latest entered that day. Sorted by date. */
export function chartPoints(readings) {
  const by = new Map();
  for (const r of [...readings].sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1))) by.set(r.date, { date: r.date, value: r.value, id: r.id });
  return [...by.values()];
}
/** Neutral wording only: Up / Down, never good or bad (D-057). */
export function changeText(latest, previous, unit, dp = 1) {
  if (!latest) return null;
  if (!previous) return 'First reading';
  const d = latest.value - previous.value;
  if (Math.abs(d) < Math.pow(10, -dp) / 2) return `No change since ${formatDay(previous.date)}`;
  return `${d > 0 ? 'Up' : 'Down'} ${fmtNum(Math.abs(d), dp)} ${unit} since ${formatDay(previous.date)}`;
}
/** Smallest range holding at least two points, else All. */
export function defaultRange(points, end) {
  for (const r of DEFAULT_RANGES) {
    if (!r.days) continue;
    const from = addDays(end, -(r.days - 1));
    if (points.filter((p) => p.date >= from && p.date <= end).length >= 2) return r.id;
  }
  return 'All';
}
export function rangeText(values, unit, dp = 1) {
  if (!values.length) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  return lo === hi ? `${fmtNum(lo, dp)} ${unit}` : `${fmtNum(lo, dp)} to ${fmtNum(hi, dp)} ${unit}`;
}
/** Small trend line. Scaled between the lowest and highest value shown, so it carries no axis: the range is printed beside it. Decorative (aria-hidden). */
export function sparkline(values, { w = 120, h = 36 } = {}) {
  const svg = svgEl('svg', { class: 'sparkline', viewBox: `0 0 ${w} ${h}`, width: w, height: h, 'aria-hidden': 'true', focusable: 'false' });
  if (!values.length) return svg;
  const lo = Math.min(...values), hi = Math.max(...values), pad = 5; const r = (n) => Math.round(n * 10) / 10;
  const X = (i) => (values.length === 1 ? w / 2 : pad + ((w - 2 * pad) * i) / (values.length - 1));
  const Y = (v) => (hi === lo ? h / 2 : h - pad - ((h - 2 * pad) * (v - lo)) / (hi - lo));
  if (values.length > 1) svg.appendChild(svgEl('polyline', { class: 'spark-line', fill: 'none', points: values.map((v, i) => `${r(X(i))},${r(Y(v))}`).join(' ') }));
  svg.appendChild(svgEl('circle', { class: 'spark-dot', cx: r(X(values.length - 1)), cy: r(Y(values[values.length - 1])), r: 3 }));
  return svg;
}
export const daysAgoText = (date, today) => { const n = daysBetween(date, today); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
