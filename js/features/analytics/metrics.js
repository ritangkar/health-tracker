// Pure model for Trends (S29, D-058, A6). No IO, no DOM.
// Rules: a day with nothing logged is NO DATA (null), never zero (D-038). Averages use only days with data and say "n of N days".
// Targets come from the effective-dated history (D-040, resolveTargets). Weekly buckets follow the Week-starts-on setting (D-030).
import { dayTotals, averagesOverDaysWithData, resolveTargets } from '../../core/calc.js';
import { addDays, rangeKeys, weekStart, daysBetween } from '../../core/dates.js';
import { fmtNum, fmtDuration } from '../../core/units.js';

/** Metric ids double as the route parameter: #/progress/trends/<id>. */
export const METRICS = [
  { id: 'weight', group: 'body', label: 'Weight', kind: 'line', typeKey: 'weight', unit: 'kg', decimals: 1, tone: 'primary', logHref: '#/body/weight/add', logLabel: 'Add weight' },
  { id: 'body-fat', group: 'body', label: 'Body fat', kind: 'line', typeKey: 'bodyFat', unit: '%', decimals: 1, tone: 'primary', approx: true, logHref: '#/body/bodyFat/add', logLabel: 'Add body fat' },
  { id: 'waist', group: 'body', label: 'Waist', kind: 'line', typeKey: 'waist', unit: 'cm', decimals: 1, tone: 'primary', logHref: '#/body/waist/add', logLabel: 'Add waist' },
  { id: 'calories', group: 'daily', label: 'Calories', kind: 'bar', needs: 'food', unit: 'kcal', decimals: 0, tone: 'kcal', targetKey: 'kcal', logHref: '#/food/add', logLabel: 'Log food', emptyText: 'Log some food and your calories will show up here.' },
  { id: 'protein', group: 'daily', label: 'Protein', kind: 'bar', needs: 'food', unit: 'g', decimals: 0, tone: 'protein', targetKey: 'protein', logHref: '#/food/add', logLabel: 'Log food', emptyText: 'Log some food and your protein will show up here.', partialNote: 'entries without a protein value' },
  { id: 'steps', group: 'daily', label: 'Steps', kind: 'bar', needs: 'days', unit: 'steps', decimals: 0, tone: 'steps', targetKey: 'steps', logHref: '#/today/sheet/steps', logLabel: 'Add steps', emptyText: 'Add your steps on Today and they will show up here.' },
  { id: 'water', group: 'daily', label: 'Water', titleUnit: 'litres', kind: 'bar', needs: 'days', unit: 'L', decimals: 1, tone: 'water', targetKey: 'waterMl', targetScale: 0.001, logHref: '#/today/sheet/water', logLabel: 'Add water', emptyText: 'Add water on Today and it will show up here.' },
  { id: 'sleep', group: 'daily', label: 'Sleep', titleUnit: 'hours', kind: 'bar', needs: 'sleep', unit: 'h', decimals: 1, tone: 'sleep', logHref: '#/today/sheet/sleep', logLabel: 'Add sleep', emptyText: 'Add your sleep on Today and it will show up here.', fmtAvg: (v) => fmtDuration(Math.round(v * 60)) },
  { id: 'workout', group: 'daily', label: 'Workout completion', short: 'Workouts', kind: 'bar', needs: 'workout', unit: '%', decimals: 0, tone: 'primary', logHref: '#/workout/choose', logLabel: 'Choose a workout', emptyText: 'Record a workout and its completion will show up here. Rest days and workouts with nothing entered are left out.' },
  { id: 'exercise-kcal', group: 'daily', label: 'Exercise calories', short: 'Exercise kcal', kind: 'bar', needs: 'workout', unit: 'kcal', decimals: 0, tone: 'primary', approx: true, logHref: '#/workout/choose', logLabel: 'Choose a workout', emptyText: 'Record a workout and its estimated calories will show up here.' }
];
export const metricById = (id) => METRICS.find((m) => m.id === id) || null;
export const METRIC_GROUPS = [{ id: 'body', label: 'Body' }, { id: 'daily', label: 'Daily habits' }];

/** Week = the last 7 days. Month = the last 30 days. 3 Months = 13 calendar weeks (by week, starting on the chosen week-start day). */
export const PERIODS = [{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: '3m', label: '3 Months' }];
export const periodById = (id) => PERIODS.find((p) => p.id === id) || null;
export function periodRange(periodId, today, weekStartKey) {
  const to = today; let from;
  if (periodId === 'week') from = addDays(today, -6);
  else if (periodId === 'month') from = addDays(today, -29);
  else from = addDays(weekStart(today, weekStartKey), -12 * 7);
  return { from, to, keys: rangeKeys(from, to), weekly: periodId === '3m' };
}

const sumKnown = (logs, f) => { let n = 0, s = 0; for (const l of logs) { const v = f(l); if (v !== null && v !== undefined && Number.isFinite(v)) { s += v; n++; } } return n ? { sum: s, n, of: logs.length } : null; };
const r1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
const byDate = (list) => { const m = new Map(); for (const x of list) { if (!m.has(x.date)) m.set(x.date, []); m.get(x.date).push(x); } return m; };

/**
 * One value per day for a bar metric, aligned to keys. null = no data. Returns {values:[{date,value}], partialDays}.
 * data: {foodLogs, days, sleeps, workouts}. partialDays counts days whose total leaves out some entries (protein only).
 */
export function dailyValues(metric, keys, data = {}) {
  const food = byDate(data.foodLogs || []), work = byDate(data.workouts || []);
  const days = new Map((data.days || []).map((d) => [d.date, d])), sleeps = new Map((data.sleeps || []).map((s) => [s.date, s]));
  let partialDays = 0;
  const values = keys.map((date) => {
    let v = null;
    switch (metric.id) {
      case 'calories': { const l = food.get(date); v = l && l.length ? dayTotals(l).kcal : null; break; }
      case 'protein': { const l = food.get(date); const s = l ? sumKnown(l, (x) => x.totals && x.totals.protein) : null; if (s) { v = r1(s.sum); if (s.n < s.of) partialDays++; } break; }
      case 'steps': { const d = days.get(date); v = d && d.steps && d.steps.count !== null && d.steps.count !== undefined ? d.steps.count : null; break; }
      case 'water': {
        const d = days.get(date); const w = d && d.water; if (!w) break;
        const ml = w.ml !== null && w.ml !== undefined ? w.ml : (w.glasses !== null && w.glasses !== undefined ? w.glasses * (w.glassMl || 500) : null);
        v = ml === null ? null : ml / 1000; break;
      }
      case 'sleep': { const s = sleeps.get(date); v = s && s.durationMin !== null && s.durationMin !== undefined ? s.durationMin / 60 : null; break; }
      case 'workout': { const done = (work.get(date) || []).filter((w) => !w.isRest && w.completionPct !== null && w.completionPct !== undefined); v = done.length ? Math.round(done.reduce((a, w) => a + w.completionPct, 0) / done.length) : null; break; }
      case 'exercise-kcal': { const done = (work.get(date) || []).filter((w) => !w.isRest && w.kcalTotal !== null && w.kcalTotal !== undefined); v = done.length ? Math.round(done.reduce((a, w) => a + w.kcalTotal, 0)) : null; break; }
      default: v = null;
    }
    return { date, value: v };
  });
  return { values, partialDays };
}

/** Calendar weeks (by the week-start setting) covering keys. Each: {date (first day shown), keys, soFar (week still running), startsMidWeek}. */
export function weeklyBuckets(keys, weekStartKey, today) {
  const out = []; let cur = null;
  for (const k of keys) {
    const ws = weekStart(k, weekStartKey);
    if (!cur || cur.ws !== ws) { cur = { ws, date: k, keys: [], soFar: false, startsMidWeek: k !== ws }; out.push(cur); }
    cur.keys.push(k);
  }
  for (const b of out) b.soFar = b.keys[b.keys.length - 1] === today && daysBetween(b.ws, today) < 6;
  return out;
}
/** Average per bucket over days with data only. value null when the bucket has no data. */
export function bucketAverages(values, buckets, decimals = 0) {
  const byKey = new Map(values.map((v) => [v.date, v.value]));
  const f = 10 ** decimals;
  return buckets.map((b) => {
    const a = averagesOverDaysWithData(b.keys.map((k) => (byKey.has(k) ? byKey.get(k) : null)));
    return { date: b.date, value: a.avg === null ? null : Math.round(a.avg * f) / f, n: a.n, N: a.N, soFar: b.soFar, startsMidWeek: b.startsMidWeek };
  });
}
export const overall = (values) => averagesOverDaysWithData(values.map((v) => v.value));

/** Target line for a metric, from the effective-dated history. changed = the target was different on different days of this period. */
export function targetFor(history, keys, metric) {
  if (!metric.targetKey || !keys.length) return { value: null, changed: false };
  const seen = new Set(); let last = null;
  for (const k of keys) {
    const t = resolveTargets(history, k); const raw = t ? t[metric.targetKey] : null;
    const v = raw !== null && raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw * (metric.targetScale || 1) : null;
    if (v !== null) seen.add(v); last = v;
  }
  return { value: last, changed: seen.size > 1 };
}

/** Neutral wording (D-057): no good or bad, no colour. */
export function compareToTarget(avg, target, metric) {
  if (avg === null || avg === undefined || target === null || target === undefined) return null;
  const f = 10 ** metric.decimals; const diff = Math.round((avg - target) * f) / f;
  if (diff === 0) return 'On target';
  const amount = metric.fmtAvg ? metric.fmtAvg(Math.abs(diff)) : `${fmtNum(Math.abs(diff), metric.decimals)} ${metric.unit}`;
  return `${amount} ${diff > 0 ? 'above' : 'below'} target`;
}
export const fmtAverage = (metric, v) => (v === null || v === undefined ? '\u2014' : metric.fmtAvg ? metric.fmtAvg(v) : `${fmtNum(v, metric.decimals)} ${metric.unit}`);
