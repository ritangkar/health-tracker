// Check-in state, validation and the atomic save (D-032, D-059). The wizard keeps its state here, in memory, between its step routes. (A5)
// Saving goes through repo.saveCheckinWithPhotos: check-in + photos + measurements in ONE transaction. A failure leaves nothing behind.
import { saveCheckinWithPhotos, ValidationError } from '../../core/repo.js';
import * as db from '../../core/db.js';
import { checkWeight, checkBodyFat, checkMeasurement, checkDate, msg } from '../../core/validate.js';
import { toNum } from '../../core/dom.js';
import { todayKey } from '../../core/dates.js';
import { PHOTO } from '../../../config.js';
import { periodFor } from './averages.js';

export const EXTRA_KEYS = ['waist', 'biceps', 'thigh'];
export function newState(pid, { periodDays = 7, date = todayKey() } = {}) {
  return { pid, date, periodDays: periodDays === 14 ? 14 : 7, weight: '', bodyFat: '', measures: { waist: '', biceps: '', thigh: '' }, showMeasures: false, photos: {}, photoErrors: {}, stats: null, statsKey: null, note: '' };
}
export const photoCount = (s) => Object.keys(s.photos).length;
export const photoBytes = (s) => Object.values(s.photos).reduce((a, p) => a + (p.bytes || 0) + (p.thumbBytes || 0), 0);
export function hasData(s) { return !!(s && (s.weight !== '' || s.bodyFat !== '' || s.note.trim() || photoCount(s) || Object.values(s.measures).some((v) => v !== ''))); }

/** -> {errors:[{field,message}], soft:[{message}], values:{weight,bodyFat,measurements:{typeId:number}}}. Empty input is "not entered" (null), never 0. */
export function validateBasics(s) {
  const errors = [], soft = [], values = { weight: null, bodyFat: null, measurements: {} };
  const dr = checkDate(s.date); if (!dr.ok) errors.push({ field: 'date', message: dr.hard[0].message });
  const one = (field, raw, fn, assign) => {
    if (String(raw).trim() === '') return;
    const r = fn(raw); if (!r.ok) { errors.push({ field, message: r.hard[0].message }); return; }
    soft.push(...r.soft); assign(r.value);
  };
  one('weight', s.weight, checkWeight, (v) => { values.weight = v; });
  one('bodyFat', s.bodyFat, checkBodyFat, (v) => { values.bodyFat = v; });
  for (const k of EXTRA_KEYS) one(k, s.measures[k] ?? '', (raw) => checkMeasurement(`mt:${k}`, raw), (v) => { values.measurements[`mt:${k}`] = v; });
  if (s.note.length > 2000) errors.push({ field: 'note', message: msg('C_NOTE_LONG') });
  return { errors, soft, values };
}
export function buildCheckinRecord(s, values) {
  const { periodStart, periodEnd } = periodFor(s.date, s.periodDays);
  return { date: s.date, periodDays: s.periodDays, periodStart, periodEnd, weight: values.weight, bodyFat: values.bodyFat, measurements: values.measurements, autoStats: s.stats || null, note: s.note.trim() || null };
}
export const photoList = (s) => PHOTO.slots.filter((slot) => s.photos[slot]).map((slot) => { const p = s.photos[slot]; return { slot, blob: p.blob, thumb: p.thumb, w: p.w, h: p.h, bytes: p.bytes, thumbBytes: p.thumbBytes, mime: p.mime, crc32: p.crc32 }; });

export function isQuota(e) {
  const n = (x) => String((x && x.name) || '');
  return e instanceof db.QuotaError || /quota/i.test(n(e)) || /quota/i.test(n(e && e.cause)) || /quota/i.test(String((e && e.message) || ''));
}
export function describeSaveError(e) {
  if (isQuota(e)) return { kind: 'quota', message: `${msg('C_PHOTO_QUOTA')} Free some space (Settings, Storage and protection), then try again.` };
  if (e instanceof ValidationError) return { kind: 'validation', message: e.result.hard[0].message };
  return { kind: 'other', message: 'The check-in could not be saved. Nothing was saved. Your other data is safe.' };
}
/** prevalidate:false skips the form checks so tests can inject a failure inside the transaction. Resolves {ok, saved} or {ok:false, errors|error}. */
export async function saveCheckinState(pid, s, { prevalidate = true } = {}) {
  let values;
  if (prevalidate) { const v = validateBasics(s); if (v.errors.length) return { ok: false, errors: v.errors }; values = v.values; }
  else { const n = (x) => { const t = toNum(x); return t === null || Number.isNaN(t) ? null : t; }; values = { weight: n(s.weight), bodyFat: n(s.bodyFat), measurements: Object.fromEntries(EXTRA_KEYS.filter((k) => n(s.measures[k]) !== null).map((k) => [`mt:${k}`, n(s.measures[k])])) }; }
  try { const saved = await saveCheckinWithPhotos(pid, buildCheckinRecord(s, values), photoList(s), { writeMeasurements: true }); return { ok: true, saved }; }
  catch (e) { return { ok: false, error: describeSaveError(e), cause: e }; }
}
