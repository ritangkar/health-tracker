// Check-in averages (D-059, D-038): each average is taken over the days that HAVE data and says "n of N days". Days with nothing logged
// are left out, never counted as zero. computeStats is pure; loadAutoStats reads the ranges through repo.js. (A5)
import { getFoodLogsRange, getDaysRange, getSleepRange, getWorkoutLogsRange } from '../../core/repo.js';
import { dayTotals, averagesOverDaysWithData } from '../../core/calc.js';
import { addDays, rangeKeys } from '../../core/dates.js';
import { fmtNum, fmtDuration } from '../../core/units.js';

export const r1 = (x) => (x == null ? null : Math.round((x + Number.EPSILON) * 10) / 10);
export function periodFor(endDate, periodDays) { return { periodStart: addDays(endDate, -(periodDays - 1)), periodEnd: endDate }; }

/** Pure. Inputs are plain record lists for the period. Returns the autoStats snapshot stored on the check-in. */
export function computeStats({ foodLogs = [], days = [], sleeps = [], workouts = [], periodStart, periodEnd, now = Date.now() }) {
  const keys = rangeKeys(periodStart, periodEnd);
  const byDate = new Map(); for (const l of foodLogs) { if (!byDate.has(l.date)) byDate.set(l.date, []); byDate.get(l.date).push(l); }
  const perDay = keys.map((k) => (byDate.has(k) ? dayTotals(byDate.get(k)) : null));
  const food = (f) => averagesOverDaysWithData(perDay.map((t) => (t ? f(t) : null)));
  const kcal = food((t) => t.kcal), protein = food((t) => t.protein), carbs = food((t) => t.carbs), fat = food((t) => t.fat);
  const fiber = food((t) => (t.fiberPartial || t.fiber == null ? null : t.fiber)); // a day with any unknown fibre is left out of the fibre average
  const dayMap = new Map(days.map((d) => [d.date, d])); const sleepMap = new Map(sleeps.map((s) => [s.date, s]));
  const steps = averagesOverDaysWithData(keys.map((k) => { const d = dayMap.get(k); return d && d.steps && d.steps.count != null ? d.steps.count : null; }));
  const sleep = averagesOverDaysWithData(keys.map((k) => { const s = sleepMap.get(k); return s && s.durationMin != null ? s.durationMin : null; }));
  const done = workouts.filter((w) => !w.isRest && w.completionPct != null && keys.includes(w.date)); // Rest and Not started are excluded (D-071)
  const wAvg = done.length ? Math.round(done.reduce((a, w) => a + w.completionPct, 0) / done.length) : null;
  const rnd = (o, f) => (o.avg == null ? null : f(o.avg));
  return {
    avgKcal: rnd(kcal, Math.round), avgProtein: rnd(protein, r1), avgCarbs: rnd(carbs, r1), avgFat: rnd(fat, r1), avgFiber: rnd(fiber, r1),
    avgSteps: rnd(steps, Math.round), avgSleepMin: rnd(sleep, Math.round), workoutCompletionAvg: wAvg, workoutSessions: done.length,
    daysWithFood: kcal.n, daysWithFiber: fiber.n, daysWithSteps: steps.n, daysWithSleep: sleep.n, periodDays: keys.length, computedAt: now
  };
}
export async function loadAutoStats(pid, endDate, periodDays) {
  const { periodStart, periodEnd } = periodFor(endDate, periodDays);
  const [foodLogs, days, sleeps, workouts] = await Promise.all([getFoodLogsRange(pid, periodStart, periodEnd), getDaysRange(pid, periodStart, periodEnd), getSleepRange(pid, periodStart, periodEnd), getWorkoutLogsRange(pid, periodStart, periodEnd)]);
  return computeStats({ foodLogs, days, sleeps, workouts, periodStart, periodEnd });
}
/** Rows for display: value text carries "avg over n of N days". No data is a dash, never 0. */
export function statRows(s) {
  if (!s) return [];
  const N = s.periodDays;
  const over = (n) => `avg over ${n} of ${N} days`;
  const row = (key, label, value, n, unit) => ({ key, label, value: value == null ? null : `${unit === 'dur' ? fmtDuration(value) : fmtNum(value, unit === 'g' ? 1 : 0)}${unit === 'kcal' ? ' kcal' : unit === 'g' ? ' g' : unit === 'steps' ? ' steps' : ''}`, detail: value == null ? 'no data in this period' : over(n) });
  return [
    row('kcal', 'Calories', s.avgKcal, s.daysWithFood, 'kcal'), row('protein', 'Protein', s.avgProtein, s.daysWithFood, 'g'), row('carbs', 'Carbs', s.avgCarbs, s.daysWithFood, 'g'), row('fat', 'Fat', s.avgFat, s.daysWithFood, 'g'),
    row('fiber', 'Fibre', s.avgFiber, s.daysWithFiber ?? s.daysWithFood, 'g'), row('steps', 'Steps', s.avgSteps, s.daysWithSteps, 'steps'), row('sleep', 'Sleep', s.avgSleepMin, s.daysWithSleep, 'dur'),
    { key: 'workout', label: 'Workout completion', value: s.workoutCompletionAvg == null ? null : `${s.workoutCompletionAvg}%`, detail: s.workoutCompletionAvg == null ? 'no workouts with entries in this period' : `average of ${s.workoutSessions} ${s.workoutSessions === 1 ? 'session' : 'sessions'}` }
  ];
}
export const NOT_ZERO_NOTE = 'Days with nothing logged are left out, not counted as zero.';
