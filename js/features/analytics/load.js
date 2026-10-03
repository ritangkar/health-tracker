// Range reads for Trends (S29). All through repo.js, always for one profile. Results are plain records. (A6)
import { getFoodLogsRange, getDaysRange, getSleepRange, getWorkoutLogsRange, measurementSeries } from '../../core/repo.js';
import { chartPoints, typeByKey } from '../body/series.js';

/** Reads only what the metric needs. Returns the shape dailyValues() expects, or {points} for a measurement metric. */
export async function loadMetricData(pid, metric, from, to) {
  if (metric.kind === 'line') {
    const t = typeByKey(metric.typeKey); if (!t) return { points: [], type: null };
    const readings = await measurementSeries(pid, t.id, from, to);
    return { points: chartPoints(readings), type: t };
  }
  if (metric.needs === 'food') return { foodLogs: await getFoodLogsRange(pid, from, to) };
  if (metric.needs === 'days') return { days: await getDaysRange(pid, from, to) };
  if (metric.needs === 'sleep') return { sleeps: await getSleepRange(pid, from, to) };
  return { workouts: await getWorkoutLogsRange(pid, from, to) };
}
