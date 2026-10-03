// Local civil dates. Local getters only, no UTC conversion. (A1)
// API: todayKey, toKey, fromKey, addDays, rangeKeys, isValidKey, clampToAllowedRange, weekStart,
// weeksBetween, daysBetween, formatDay, formatLong, parseTime, minutesBetween, sleepWakeDate, durationFromTimes
import { MIN_DATE } from '../../config.js';
const pad = (n, w = 2) => String(n).padStart(w, '0');
export function toKey(d) { return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function todayKey(now = new Date()) { return toKey(now); }
export function isValidKey(k) {
  if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  const [y, m, d] = k.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
export function fromKey(k) {
  if (!isValidKey(k)) throw new RangeError('Invalid date key: ' + k);
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // noon avoids DST edge cases
}
export function addDays(k, n) { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); }
export function daysBetween(a, b) { return Math.round((fromKey(b) - fromKey(a)) / 86400000); }
export function rangeKeys(from, to) {
  const out = []; if (from > to) return out;
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}
export function maxAllowedKey(now = new Date()) { return addDays(todayKey(now), 1); }
export function clampToAllowedRange(k, now = new Date()) {
  const max = maxAllowedKey(now);
  if (!isValidKey(k)) return todayKey(now);
  return k < MIN_DATE ? MIN_DATE : k > max ? max : k;
}
export function isInAllowedRange(k, now = new Date()) { return isValidKey(k) && k >= MIN_DATE && k <= maxAllowedKey(now); }
const WS = { mon: 1, sun: 0, sat: 6 };
export function weekStart(k, start = 'mon') {
  const d = fromKey(k); const target = WS[start] ?? 1;
  return addDays(k, -((d.getDay() - target + 7) % 7));
}
export function weeksBetween(a, b, start = 'mon') {
  return Math.round(daysBetween(weekStart(a, start), weekStart(b, start)) / 7);
}
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Display only. Never used to pick a workout. */
export function formatDay(k) { const d = fromKey(k); return `${DN[d.getDay()]} ${d.getDate()} ${MN[d.getMonth()]}`; }
export function formatLong(k) { const d = fromKey(k); return `${DN[d.getDay()]} ${d.getDate()} ${MN[d.getMonth()]} ${d.getFullYear()}`; }
export function parseTime(t) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** Minutes between two local 'YYYY-MM-DDTHH:mm' strings. */
export function minutesBetween(a, b) {
  const p = (s) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(s || '');
    if (!m || !isValidKey(m[1]) || parseTime(m[2]) === null) return null;
    return { k: m[1], t: parseTime(m[2]) };
  };
  const x = p(a), y = p(b); if (!x || !y) return null;
  return daysBetween(x.k, y.k) * 1440 + (y.t - x.t);
}
/** Sleep belongs to the WAKE date. Bed clock later than wake clock = previous evening. */
export function sleepWakeDate(wakeKey) { return wakeKey; }
export function durationFromTimes(wakeKey, bedHHmm, wakeHHmm) {
  const b = parseTime(bedHHmm), w = parseTime(wakeHHmm);
  if (b === null || w === null || !isValidKey(wakeKey)) return null;
  const bedKey = b > w ? addDays(wakeKey, -1) : wakeKey;
  const bedAt = `${bedKey}T${bedHHmm}`, wakeAt = `${wakeKey}T${wakeHHmm}`;
  const dur = minutesBetween(bedAt, wakeAt);
  return { bedAt, wakeAt, durationMin: dur, valid: dur > 0 };
}
