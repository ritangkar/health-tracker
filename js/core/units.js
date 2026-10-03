// Unit conversion and display helpers. Null -> dash, never 0. (A1)
// API: DASH, kgToLb, lbToKg, cmToIn, inToCm, metersToKm, kmToMeters, glassesToMl, mlToLitres,
// fmtNum, fmtDuration, fmtLitres, fmtPct, fmtKcal, fmtSteps, fmtWater, fmtMeasurement, round1, round2
export const DASH = '\u2014';
export const round1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export const kgToLb = (kg) => kg * 2.2046226218;
export const lbToKg = (lb) => lb / 2.2046226218;
export const cmToIn = (cm) => cm / 2.54;
export const inToCm = (i) => i * 2.54;
export const metersToKm = (m) => m / 1000;
export const kmToMeters = (km) => km * 1000;
export const glassesToMl = (glasses, glassMl = 500) => (glasses == null ? null : glasses * glassMl);
export const mlToLitres = (ml) => (ml == null ? null : ml / 1000);
const isNil = (v) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
export function fmtNum(v, dp = 0) {
  if (isNil(v)) return DASH;
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
export function fmtDuration(min) {
  if (isNil(min)) return DASH;
  const t = Math.round(min); const h = Math.floor(t / 60), m = t % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
export function fmtLitres(ml) { return isNil(ml) ? DASH : `${round2(ml / 1000)} L`; }
export function fmtPct(p) { return isNil(p) ? DASH : `${Math.round(p)}%`; }
export function fmtKcal(k) { return isNil(k) ? DASH : `${fmtNum(Math.round(k))} kcal`; }
export function fmtSteps(n) { return isNil(n) ? DASH : fmtNum(n); }
export function fmtWater(glasses, glassMl = 500) {
  if (isNil(glasses)) return DASH;
  return `${glasses} glasses, ${fmtNum(glasses * glassMl)} ml`;
}
export function fmtMeasurement(v, unit, dp = 1) { return isNil(v) ? DASH : `${fmtNum(v, dp)} ${unit}`; }
