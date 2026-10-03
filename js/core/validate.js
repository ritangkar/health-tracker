// One shared validator (DAT-027). HARD = reject, SOFT = confirm once. (A1)
// Result shape: { ok, hard:[{code,field,message}], soft:[{code,field,message}] }
// API: CATALOG, msg(code,params), newResult, finish, num, cleanText,
//  checkWeight, checkHeight, checkBodyFat, checkMeasurement(typeId,v), checkFoodQty(qty,baseAmount,entryKcal),
//  checkFoodNutrition(nutrition), checkServing(s), checkRecipe(recipe), checkWater(glasses), checkSteps(n), checkStepGoal(n),
//  checkSleep({durationMin,napMin,quality,bedAt,wakeAt}), checkManualPct(v), checkActual(kind,v), checkKcalOverride(v),
//  checkTargets(t), checkDate(k), checkTime(t), checkDayNote(note), checkCheckinPhotos(list), validateRecord(store, rec), merge
import { isInAllowedRange, isValidKey, parseTime, minutesBetween } from './dates.js';
import { PHOTO } from '../../config.js';

export const CATALOG = {
  V_REQUIRED: 'Enter {field}.', V_NOT_NUMBER: 'Enter a number for {field}.', V_NEGATIVE: '{field} cannot be negative.',
  V_RANGE: '{field} must be between {min} and {max}.', V_INTEGER: '{field} must be a whole number.',
  V_TEXT_LONG: '{field} is too long (maximum {max} characters).', V_NAME_EMPTY: 'Give it a name (1 to {max} characters).',
  V_DATE_INVALID: 'That date is not valid.', V_DATE_RANGE: 'Choose a date from 1 Jan 2000 to tomorrow.',
  V_TIME_INVALID: 'Enter a time like 23:15.',
  M_WEIGHT_RANGE: 'Weight must be between 20 and 400 kg.', 'M_WEIGHT_UNUSUAL(SOFT)': 'This looks unusual: {value} kg. Save anyway?',
  M_HEIGHT_RANGE: 'Height must be between 50 and 250 cm.', 'M_HEIGHT_UNUSUAL(SOFT)': 'This looks unusual: {value} cm. Save anyway?',
  M_BF_RANGE: 'Body fat must be between 2 and 70 percent.', 'M_BF_UNUSUAL(SOFT)': 'This looks unusual: {value} percent. Body fat readings are approximate. Save anyway?',
  M_BICEPS_RANGE: 'Biceps must be between 10 and 80 cm.', M_THIGH_RANGE: 'Thigh must be between 20 and 120 cm.', M_WAIST_RANGE: 'Waist must be between 30 and 250 cm.',
  F_QTY_RANGE: 'Quantity must be more than 0 and at most 50 servings.', F_AMOUNT_TOO_BIG: 'That is more than 5,000 g or ml in one entry.',
  'F_QTY_UNUSUAL(SOFT)': 'This is a large amount: {qty} servings. Save anyway?', 'F_KCAL_UNUSUAL(SOFT)': 'This entry is over 3,000 kcal. Save anyway?',
  F_KCAL_RANGE100: 'Calories per 100 must be between 0 and 950.', F_MACRO_RANGE100: 'Protein, carbs and fat must each be 0 to 100 per 100 g or ml.',
  F_MACRO_SUM: 'Protein + carbs + fat cannot add up to more than 105 per 100 g or ml.',
  'F_ATWATER(SOFT)': 'The calories do not match the protein, carbs and fat you entered. Save anyway?',
  'F_FIBER_GT_CARBS(SOFT)': 'Fibre is higher than carbs. Carbs include fibre. Save anyway?',
  F_SERVING_BASE: 'Serving size must be more than 0 and at most 5,000.', F_SERVING_LABEL: 'The serving name should include its unit, for example 1 bowl.',
  F_SERVING_BASIS_RANGE: 'Per-serving values are out of range (calories 0 to 5,000).',
  R_SERVINGS_RANGE: 'A recipe must make between 0.25 and 100 servings.', R_INGREDIENTS: 'A recipe needs 1 to 60 ingredients.',
  R_NESTED: 'A recipe cannot be used inside another recipe yet.',
  W_GLASS_RANGE: 'Water must be between 0 and 40 glasses, in steps of half a glass.', 'W_GLASS_UNUSUAL(SOFT)': 'That is more than 6 litres. Save anyway?',
  S_STEPS_RANGE: 'Steps must be a whole number from 0 to 150,000.', 'S_STEPS_UNUSUAL(SOFT)': 'That is over 60,000 steps. Save anyway?',
  S_GOAL_RANGE: 'A step goal must be between 1,000 and 100,000.',
  SL_DURATION_RANGE: 'Sleep must be between 1 minute and 20 hours.', 'SL_DURATION_UNUSUAL(SOFT)': 'That is more than 14 hours of sleep. Save anyway?',
  SL_NAP_RANGE: 'A nap must be 0 to 600 minutes.', SL_QUALITY: 'Quality must be 1 to 5.', SL_ORDER: 'Wake time must be after bed time.',
  N_NOTE_LONG: 'A day note can be up to 2,000 characters.', N_TAGS: 'You can add up to 5 tags.',
  X_PCT_RANGE: 'Completion must be a whole number from 0 to 100.', X_ACTUAL_RANGE: 'That number is out of range for this exercise.',
  'X_REPS_UNUSUAL(SOFT)': 'That is over 1,000 reps. Save anyway?', X_KCAL_RANGE: 'Calories must be between 0 and 5,000.',
  P_NAME: 'Give the plan a name (1 to 60 characters).', P_TARGET: 'Target must be more than 0.',
  T_KCAL: 'Calories target must be between 500 and 10,000.', T_PROTEIN: 'Protein target must be 0 to 500 g.', T_CARBS: 'Carbs target must be 0 to 1,000 g.',
  T_FAT: 'Fat target must be 0 to 500 g.', T_FIBER: 'Fibre target must be 0 to 200 g.', T_WATER: 'Water target must be between 250 and 20,000 ml.',
  T_STEPS: 'Steps target must be between 1,000 and 100,000.',
  C_PHOTO_COUNT: 'A check-in can have at most 4 photos, one for each position.', C_PHOTO_FAIL: 'This photo could not be prepared. Try another photo.',
  C_PHOTO_QUOTA: 'There is not enough space. Nothing was saved.', C_NOTE_LONG: 'A check-in note can be up to 2,000 characters.',
  I_NOT_BACKUP: 'This is not a Winter Arc backup.', I_DAMAGED: 'This backup file is damaged. Your data was not changed.',
  I_NEWER: 'This backup was made by a newer Winter Arc. Update the app first.',
  I_CHECKSUM: 'A check on this file failed. It may be damaged. Your data was not changed.',
  I_SPACE: 'There may not be enough space to import this file.', I_INVALID_RECORDS: '{n} items in this backup are not valid. Skip them or cancel.',
  I_PHOTOS_DAMAGED: '{n} photos in this backup are damaged. Import without them or cancel.'
};
export function msg(code, params = {}) {
  const t = CATALOG[code] ?? code;
  return t.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}
export const newResult = () => ({ ok: true, hard: [], soft: [] });
export function finish(r) { r.ok = r.hard.length === 0; return r; }
export function merge(...rs) { const o = newResult(); for (const r of rs) { o.hard.push(...r.hard); o.soft.push(...r.soft); } return finish(o); }
function H(r, code, field, params) { r.hard.push({ code, field, message: msg(code, { field, ...params }) }); }
function S(r, code, field, params) { r.soft.push({ code, field, message: msg(code, { field, ...params }) }); }

/** Decimal-comma aware. '' / null / undefined -> null. Invalid -> NaN. */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '');
  if (s === '') return null;
  const t = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}
export function cleanText(s) { return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : s; }

function numberCore(r, v, field, { required = true } = {}) {
  const n = num(v);
  if (n === null) { if (required) H(r, 'V_REQUIRED', field); return null; }
  if (!Number.isFinite(n)) { H(r, 'V_NOT_NUMBER', field); return null; }
  return n;
}
function rangeCheck(r, n, lo, hi, code, field, extra = {}) {
  if (n < lo || n > hi) { H(r, code, field, { min: lo, max: hi, ...extra }); return false; }
  return true;
}
function measure(code, label, lo, hi, softLo, softHi, unusualCode) {
  return (v) => {
    const r = newResult(); const n = numberCore(r, v, label);
    if (n === null) return { ...finish(r), value: null };
    if (rangeCheck(r, n, lo, hi, code, label)) {
      if (unusualCode && (n < softLo || n > softHi)) S(r, unusualCode, label, { value: n });
    }
    return { ...finish(r), value: n };
  };
}
export const checkWeight = measure('M_WEIGHT_RANGE', 'Weight', 20, 400, 35, 200, 'M_WEIGHT_UNUSUAL(SOFT)');
export const checkHeight = measure('M_HEIGHT_RANGE', 'Height', 50, 250, 120, 220, 'M_HEIGHT_UNUSUAL(SOFT)');
export const checkBodyFat = measure('M_BF_RANGE', 'Body fat', 2, 70, 5, 50, 'M_BF_UNUSUAL(SOFT)');
const MEAS = {
  weight: checkWeight, height: checkHeight, bodyFat: checkBodyFat,
  biceps: measure('M_BICEPS_RANGE', 'Biceps', 10, 80), thigh: measure('M_THIGH_RANGE', 'Thigh', 20, 120),
  waist: measure('M_WAIST_RANGE', 'Waist', 30, 250),
  chest: measure('V_RANGE', 'Chest', 40, 250), hips: measure('V_RANGE', 'Hips', 40, 250),
  neck: measure('V_RANGE', 'Neck', 15, 80), calf: measure('V_RANGE', 'Calf', 15, 80)
};
/** typeId may be 'mt:weight' or 'weight'. */
export function checkMeasurement(typeId, v) {
  const key = String(typeId || '').replace(/^mt:/, '');
  const fn = MEAS[key];
  if (!fn) { const r = newResult(); H(r, 'V_REQUIRED', 'Measurement type'); return finish(r); }
  return fn(v);
}
export function checkDate(k, now = new Date()) {
  const r = newResult();
  if (!isValidKey(k)) H(r, 'V_DATE_INVALID', 'Date');
  else if (!isInAllowedRange(k, now)) H(r, 'V_DATE_RANGE', 'Date');
  return finish(r);
}
export function checkTime(t) { const r = newResult(); if (parseTime(t) === null) H(r, 'V_TIME_INVALID', 'Time'); return finish(r); }
export function checkName(name, max = 80, code = 'V_NAME_EMPTY') {
  const r = newResult(); const s = cleanText(name);
  if (typeof s !== 'string' || s.length < 1 || s.length > max) H(r, code, 'Name', { max });
  return finish(r);
}
function textLen(r, s, max, field, code = 'V_TEXT_LONG') {
  if (s == null || s === '') return;
  if (typeof s !== 'string' || s.length > max) H(r, code, field, { max });
}
export function checkFoodQty(qty, baseAmount = null, entryKcal = null, basisIsMass = true) {
  const r = newResult(); const q = numberCore(r, qty, 'Quantity');
  if (q === null) return finish(r);
  if (!(q > 0 && q <= 50)) { H(r, 'F_QTY_RANGE', 'Quantity'); return finish(r); }
  if (basisIsMass && baseAmount != null && q * baseAmount > 5000) H(r, 'F_AMOUNT_TOO_BIG', 'Quantity');
  if (r.hard.length === 0) {
    if (q > 20) S(r, 'F_QTY_UNUSUAL(SOFT)', 'Quantity', { qty: q });
    if (entryKcal != null && entryKcal > 3000) S(r, 'F_KCAL_UNUSUAL(SOFT)', 'Quantity');
  }
  return finish(r);
}
/** nutrition: {per:{amount,unit}, kcal, protein, carbs, fat, fiber|null} */
export function checkFoodNutrition(n) {
  const r = newResult();
  if (!n || typeof n !== 'object') { H(r, 'V_REQUIRED', 'Nutrition'); return finish(r); }
  const kcal = numberCore(r, n.kcal, 'Calories'); const p = numberCore(r, n.protein, 'Protein');
  const c = numberCore(r, n.carbs, 'Carbs'); const f = numberCore(r, n.fat, 'Fat');
  const fiber = numberCore(r, n.fiber, 'Fibre', { required: false });
  if (r.hard.length) return finish(r);
  const per100 = n.per && (n.per.unit === 'g' || n.per.unit === 'ml');
  if (per100) {
    if (kcal < 0 || kcal > 950) H(r, 'F_KCAL_RANGE100', 'Calories');
    if ([p, c, f].some((x) => x < 0 || x > 100)) H(r, 'F_MACRO_RANGE100', 'Macros');
    else if (p + c + f > 105) H(r, 'F_MACRO_SUM', 'Macros');
  } else {
    if (kcal < 0 || kcal > 5000 || [p, c, f].some((x) => x < 0 || x > 1000) || (fiber !== null && (fiber < 0 || fiber > 300))) H(r, 'F_SERVING_BASIS_RANGE', 'Nutrition');
  }
  if (per100 && fiber !== null && (fiber < 0 || fiber > 100)) H(r, 'F_MACRO_RANGE100', 'Fibre');
  if (r.hard.length === 0) {
    const est = 4 * p + 4 * c + 9 * f;
    if (Math.abs(kcal - est) > 50 && Math.abs(kcal - est) > 0.25 * Math.max(est, kcal)) S(r, 'F_ATWATER(SOFT)', 'Calories');
    if (fiber !== null && fiber > c) S(r, 'F_FIBER_GT_CARBS(SOFT)', 'Fibre');
  }
  return finish(r);
}
const UNIT_WORDS = { g: ['g', 'gram'], ml: ['ml'], cup: ['cup'], bowl: ['bowl'], piece: ['piece', 'pc', 'egg', 'slice', 'roti', 'item'], serving: ['serving', 'plate', 'portion'] };
export function checkServing(s) {
  const r = newResult();
  if (!s || typeof s !== 'object') { H(r, 'F_SERVING_BASE', 'Serving'); return finish(r); }
  const b = num(s.baseAmount);
  if (b === null || !Number.isFinite(b) || !(b > 0 && b <= 5000)) H(r, 'F_SERVING_BASE', 'Serving');
  const label = cleanText(s.label);
  if (typeof label !== 'string' || label.length < 1 || label.length > 60) H(r, 'F_SERVING_LABEL', 'Serving name');
  else if (s.unit && s.unit !== 'other' && !(UNIT_WORDS[s.unit] || [s.unit]).some((w) => label.toLowerCase().includes(w)) && !/\d/.test(label)) H(r, 'F_SERVING_LABEL', 'Serving name');
  return finish(r);
}
export function checkRecipe(rc) {
  const r = newResult();
  if (!rc || typeof rc !== 'object') { H(r, 'R_INGREDIENTS', 'Recipe'); return finish(r); }
  const sv = num(rc.servings);
  if (!Number.isFinite(sv) || sv === null || sv < 0.25 || sv > 100) H(r, 'R_SERVINGS_RANGE', 'Servings');
  const ing = Array.isArray(rc.ingredients) ? rc.ingredients : [];
  if (ing.length < 1 || ing.length > 60) H(r, 'R_INGREDIENTS', 'Ingredients');
  if (ing.some((i) => i && (i.kind === 'recipe' || i.foodKind === 'recipe'))) H(r, 'R_NESTED', 'Ingredients');
  return finish(r);
}
export function checkWater(g) {
  const r = newResult(); const n = num(g);
  if (n === null) return { ...finish(r), value: null };
  if (!Number.isFinite(n) || n < 0 || n > 40 || Math.round(n * 2) !== n * 2) { H(r, 'W_GLASS_RANGE', 'Water'); return { ...finish(r), value: null }; }
  if (n > 12) S(r, 'W_GLASS_UNUSUAL(SOFT)', 'Water');
  return { ...finish(r), value: n };
}
export function checkSteps(v) {
  const r = newResult(); const n = num(v);
  if (n === null) return { ...finish(r), value: null };
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 150000) { H(r, 'S_STEPS_RANGE', 'Steps'); return { ...finish(r), value: null }; }
  if (n > 60000) S(r, 'S_STEPS_UNUSUAL(SOFT)', 'Steps');
  return { ...finish(r), value: n };
}
export function checkStepGoal(v) {
  const r = newResult(); const n = num(v);
  if (n === null) return { ...finish(r), value: null };
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1000 || n > 100000) H(r, 'S_GOAL_RANGE', 'Step goal');
  return { ...finish(r), value: n };
}
export function checkSleep({ durationMin, napMin, quality, bedAt, wakeAt } = {}) {
  const r = newResult();
  if (bedAt && wakeAt) { const d = minutesBetween(bedAt, wakeAt); if (d === null || d <= 0) H(r, 'SL_ORDER', 'Wake time'); }
  const d = num(durationMin);
  if (d === null || !Number.isFinite(d)) { if (!bedAt || !wakeAt) H(r, 'V_REQUIRED', 'Sleep duration'); }
  else if (d < 1 || d > 1200) H(r, 'SL_DURATION_RANGE', 'Sleep');
  else if (d > 840) S(r, 'SL_DURATION_UNUSUAL(SOFT)', 'Sleep');
  const nap = num(napMin);
  if (nap !== null && (!Number.isFinite(nap) || nap < 0 || nap > 600)) H(r, 'SL_NAP_RANGE', 'Nap');
  const q = num(quality);
  if (q !== null && (!Number.isInteger(q) || q < 1 || q > 5)) H(r, 'SL_QUALITY', 'Quality');
  return finish(r);
}
export function checkManualPct(v) {
  const r = newResult(); const n = num(v);
  if (n === null) return { ...finish(r), value: null };
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) { H(r, 'X_PCT_RANGE', 'Completion'); return { ...finish(r), value: null }; }
  return { ...finish(r), value: n };
}
const ACT = { reps: [0, 10000, true], rounds: [0, 1000, true], seconds: [0, 36000, false], minutes: [0, 1440, false], meters: [0, 500000, false] };
export function checkActual(kind, v) {
  const r = newResult(); const n = num(v);
  if (n === null) return { ...finish(r), value: null };
  const spec = ACT[kind];
  if (!spec || !Number.isFinite(n) || n < spec[0] || n > spec[1] || (spec[2] && !Number.isInteger(n))) { H(r, 'X_ACTUAL_RANGE', 'Actual'); return { ...finish(r), value: null }; }
  if (kind === 'reps' && n > 1000) S(r, 'X_REPS_UNUSUAL(SOFT)', 'Actual');
  return { ...finish(r), value: n };
}
export function checkKcalOverride(v) {
  const r = newResult(); const n = num(v);
  if (n === null) return { ...finish(r), value: null };
  if (!Number.isFinite(n) || n < 0 || n > 5000) { H(r, 'X_KCAL_RANGE', 'Calories'); return { ...finish(r), value: null }; }
  return { ...finish(r), value: n };
}
const TGT = { kcal: [500, 10000, 'T_KCAL'], protein: [0, 500, 'T_PROTEIN'], carbs: [0, 1000, 'T_CARBS'], fat: [0, 500, 'T_FAT'], fiber: [0, 200, 'T_FIBER'], waterMl: [250, 20000, 'T_WATER'], steps: [1000, 100000, 'T_STEPS'] };
export function checkTargets(t) {
  const r = newResult();
  for (const [k, [lo, hi, code]] of Object.entries(TGT)) {
    if (t == null || t[k] === undefined || t[k] === null) continue;
    const n = num(t[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) H(r, code, k);
  }
  return finish(r);
}
export function checkDayNote(note) {
  const r = newResult(); if (!note) return finish(r);
  if (typeof note.text === 'string' && note.text.length > 2000) H(r, 'N_NOTE_LONG', 'Note');
  if (Array.isArray(note.tags) && note.tags.length > 5) H(r, 'N_TAGS', 'Tags');
  return finish(r);
}
export function checkCheckinPhotos(list) {
  const r = newResult(); const arr = Array.isArray(list) ? list : [];
  const slots = arr.map((p) => p && p.slot);
  if (arr.length > PHOTO.maxPerCheckin || new Set(slots).size !== slots.length || slots.some((s) => !PHOTO.slots.includes(s))) H(r, 'C_PHOTO_COUNT', 'Photos');
  return finish(r);
}

// ---------- structural record validators ----------
const SECTIONS = ['food', 'recipe'];
const FOOD_CATS = ['grain-rice', 'bread-roti', 'dal-legume', 'veg-dish', 'paneer-dairy-dish', 'egg', 'chicken', 'mutton-red-meat', 'fish-seafood', 'fruit', 'veg-raw', 'dairy', 'beverage', 'snack', 'sweet-dessert', 'fast-food', 'pizza-burger-sandwich', 'noodles-rice-dish', 'soup-salad', 'oil-spice-condiment', 'packaged', 'other'];
const CUISINES = ['indian', 'bengali', 'chinese', 'japanese', 'thai', 'continental', 'italian', 'american', 'other'];
const EX_CATS = ['strength', 'cardio', 'core', 'mobility', 'yoga', 'other'];
const T_KINDS = ['reps', 'seconds', 'minutes', 'meters', 'rounds'];
const inEnum = (v, list) => list.includes(v);
function needId(r, rec, pidRequired = true) {
  if (!rec || typeof rec !== 'object') { H(r, 'V_REQUIRED', 'Record'); return false; }
  if (typeof rec.id !== 'string' || !rec.id) H(r, 'V_REQUIRED', 'id');
  if (pidRequired && (typeof rec.pid !== 'string' || !rec.pid)) H(r, 'V_REQUIRED', 'pid');
  return true;
}
// F-A9-02: structural sanity for records that can arrive from a backup whose checksum is valid (hand-edited or buggy file).
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const nonNeg = (x) => fin(x) && x >= 0;
const CANON_UNIT = { weight: 'kg', height: 'cm', bodyFat: '%', biceps: 'cm', thigh: 'cm', waist: 'cm', chest: 'cm', hips: 'cm', neck: 'cm', calf: 'cm' };
function checkNutritionBlock(r, o, kcalRequired) {
  if (!o || typeof o !== 'object') { H(r, 'F_SERVING_BASIS_RANGE', 'Nutrition'); return false; }
  if (!(nonNeg(o.kcal) && o.kcal <= 100000)) { H(r, 'F_SERVING_BASIS_RANGE', 'Nutrition'); return false; }
  for (const k of ['protein', 'carbs', 'fat', 'fiber']) if (o[k] != null && !(nonNeg(o[k]) && o[k] <= 100000)) { H(r, 'F_SERVING_BASIS_RANGE', 'Nutrition'); return false; }
  return true;
}
const V = {
  profiles(rec) { const r = newResult(); if (!needId(r, rec, false)) return finish(r); merge; return merge(r, checkName(rec.name, 40)); },
  settings(rec) {
    const r = newResult(); if (!rec || typeof rec.pid !== 'string') { H(r, 'V_REQUIRED', 'pid'); return finish(r); }
    if (rec.targetsHistory !== undefined && !Array.isArray(rec.targetsHistory)) H(r, 'V_REQUIRED', 'targetsHistory');
    else for (const t of rec.targetsHistory || []) { if (!isValidKey(t.from)) H(r, 'V_DATE_INVALID', 'targets date'); r.hard.push(...checkTargets(t).hard); }
    if (rec.defaultStepGoal != null) r.hard.push(...checkStepGoal(rec.defaultStepGoal).hard);
    if (rec.weekStart != null && !inEnum(rec.weekStart, ['mon', 'sun', 'sat'])) H(r, 'V_REQUIRED', 'weekStart');
    if (rec.glassMl != null && !(Number.isInteger(rec.glassMl) && rec.glassMl >= 50 && rec.glassMl <= 2000)) H(r, 'V_RANGE', 'Glass size', { min: 50, max: 2000 });
    return finish(r);
  },
  foods(rec) {
    const r = newResult(); if (!needId(r, rec, !String(rec?.id).startsWith('f:'))) return finish(r);
    const nm = checkName(rec.name, 80); r.hard.push(...nm.hard);
    if (!inEnum(rec.kind, SECTIONS)) H(r, 'V_REQUIRED', 'kind');
    if (rec.category != null && !inEnum(rec.category, FOOD_CATS)) H(r, 'V_REQUIRED', 'category');
    if (rec.cuisine != null && !inEnum(rec.cuisine, CUISINES)) H(r, 'V_REQUIRED', 'cuisine');
    if (rec.origin === 'restaurant' && rec.confidence && rec.confidence !== 'estimate') H(r, 'V_REQUIRED', 'confidence');
    const nu = checkFoodNutrition(rec.nutrition); r.hard.push(...nu.hard); r.soft.push(...nu.soft);
    if (rec.nutrition && rec.nutrition.per && !['g', 'ml', 'serving'].includes(rec.nutrition.per.unit)) H(r, 'V_REQUIRED', 'basis');
    for (const s of rec.servings || []) r.hard.push(...checkServing(s).hard);
    if (rec.kind === 'recipe') r.hard.push(...checkRecipe(rec.recipe).hard);
    textLen(r, rec.notes, 500, 'Notes');
    return finish(r);
  },
  exercises(rec) {
    const r = newResult(); if (!needId(r, rec, !String(rec?.id).startsWith('ex:'))) return finish(r);
    r.hard.push(...checkName(rec.name, 80).hard);
    if (!inEnum(rec.targetKind, T_KINDS)) H(r, 'V_REQUIRED', 'targetKind');
    if (rec.category != null && !inEnum(rec.category, EX_CATS)) H(r, 'V_REQUIRED', 'category');
    if (rec.defaultTarget != null && !(num(rec.defaultTarget) > 0)) H(r, 'P_TARGET', 'Target');
    if (rec.kcal && (!['per_rep', 'per_second', 'per_minute', 'per_km', 'per_session'].includes(rec.kcal.basis) || !(rec.kcal.value >= 0))) H(r, 'X_KCAL_RANGE', 'Calories');
    textLen(r, rec.instructions, 600, 'Instructions'); textLen(r, rec.notes, 300, 'Notes');
    return finish(r);
  },
  plans(rec) {
    const r = newResult(); if (!needId(r, rec, !String(rec?.id).startsWith('plan:'))) return finish(r);
    r.hard.push(...checkName(rec.name, 60, 'P_NAME').hard);
    if (rec.stepGoal != null) r.hard.push(...checkStepGoal(rec.stepGoal).hard);
    if (!Array.isArray(rec.items)) H(r, 'V_REQUIRED', 'items');
    else for (const it of rec.items) {
      if (!inEnum(it.targetKind, T_KINDS)) H(r, 'V_REQUIRED', 'targetKind');
      if (!(num(it.target) > 0)) H(r, 'P_TARGET', 'Target');
      if (it.targetMax != null && !(num(it.targetMax) >= num(it.target))) H(r, 'P_TARGET', 'Target');
      if (it.kcalOverride) r.hard.push(...checkKcalOverride(it.kcalOverride.value).hard);
    }
    return finish(r);
  },
  foodLogs(rec) {
    const r = newResult(); if (!needId(r, rec)) return finish(r);
    r.hard.push(...checkDate(rec.date).hard);
    if (typeof rec.foodName !== 'string' || !rec.foodName) H(r, 'V_REQUIRED', 'foodName');
    const q = num(rec.qty); if (!Number.isFinite(q) || !(q > 0 && q <= 50)) H(r, 'F_QTY_RANGE', 'Quantity');
    // kcal is always a number; protein, carbs, fat and fibre may be null = not entered (quick add, D-038).
    if (checkNutritionBlock(r, rec.per1serving) && checkNutritionBlock(r, rec.totals)) {
      for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber']) {
        const pv = rec.per1serving[k], tv = rec.totals[k];
        if ((pv == null) !== (tv == null)) { H(r, 'F_SERVING_BASIS_RANGE', 'Nutrition'); break; }
        if (pv != null && Number.isFinite(q) && Math.abs(tv - pv * q) > 0.11 + Math.abs(pv * q) * 1e-6) { H(r, 'F_SERVING_BASIS_RANGE', 'Nutrition'); break; }
      }
    }
    return finish(r);
  },
  workoutLogs(rec) {
    const r = newResult(); if (!needId(r, rec)) return finish(r);
    r.hard.push(...checkDate(rec.date).hard);
    if (typeof rec.planName !== 'string') H(r, 'V_REQUIRED', 'planName');
    if (rec.kcalTotal != null && !(nonNeg(rec.kcalTotal) && rec.kcalTotal <= 100000)) H(r, 'X_KCAL_RANGE', 'Calories');
    if (rec.bodyWeightKg != null && !(fin(rec.bodyWeightKg) && rec.bodyWeightKg >= 20 && rec.bodyWeightKg <= 400)) H(r, 'M_WEIGHT_RANGE', 'Weight');
    if (!Array.isArray(rec.items)) H(r, 'V_REQUIRED', 'items');
    else for (const it of rec.items) {
      if (it.manualPct != null) r.hard.push(...checkManualPct(it.manualPct).hard);
      if (it.pct != null && !(Number.isInteger(it.pct) && it.pct >= 0 && it.pct <= 100)) H(r, 'X_PCT_RANGE', 'Completion');
      for (const k of ['kcalEst', 'kcalFinal']) if (it[k] != null && !(nonNeg(it[k]) && it[k] <= 100000)) H(r, 'X_KCAL_RANGE', 'Calories');
      if (it.actual != null) r.hard.push(...checkActual(it.targetKind, it.actual).hard);
    }
    if (rec.completionPct != null && !(Number.isInteger(rec.completionPct) && rec.completionPct >= 0 && rec.completionPct <= 100)) H(r, 'X_PCT_RANGE', 'Completion');
    return finish(r);
  },
  days(rec) {
    const r = newResult(); if (!rec || typeof rec.pid !== 'string') { H(r, 'V_REQUIRED', 'pid'); return finish(r); }
    r.hard.push(...checkDate(rec.date).hard);
    if (rec.water) { r.hard.push(...checkWater(rec.water.glasses).hard); }
    if (rec.steps) r.hard.push(...checkSteps(rec.steps.count).hard);
    if (rec.stepGoal != null) r.hard.push(...checkStepGoal(rec.stepGoal).hard);
    r.hard.push(...checkDayNote(rec.note).hard);
    return finish(r);
  },
  sleepLogs(rec) {
    const r = newResult(); if (!needId(r, rec)) return finish(r);
    r.hard.push(...checkDate(rec.date).hard);
    r.hard.push(...checkSleep({ durationMin: rec.durationMin, napMin: rec.napMin, quality: rec.quality }).hard);
    textLen(r, rec.note, 500, 'Note');
    return finish(r);
  },
  measurementTypes(rec) { const r = newResult(); needId(r, rec); return finish(r); },
  measurements(rec) {
    const r = newResult(); if (!needId(r, rec)) return finish(r);
    r.hard.push(...checkDate(rec.date).hard);
    if (typeof rec.typeId !== 'string') H(r, 'V_REQUIRED', 'typeId');
    else if (rec.typeId.startsWith('mt:')) r.hard.push(...checkMeasurement(rec.typeId, rec.value).hard);
    else if (!Number.isFinite(rec.value)) H(r, 'V_NOT_NUMBER', 'Value');
    { const want = CANON_UNIT[String(rec.typeId || '').replace(/^mt:/, '')]; if (want && rec.unit != null && rec.unit !== want) H(r, 'V_REQUIRED', 'Unit'); }
    textLen(r, rec.note, 200, 'Note');
    return finish(r);
  },
  checkins(rec) {
    const r = newResult(); if (!needId(r, rec)) return finish(r);
    r.hard.push(...checkDate(rec.date).hard);
    r.hard.push(...checkCheckinPhotos(rec.photos || []).hard);
    if (rec.weight != null) r.hard.push(...checkWeight(rec.weight).hard);
    if (rec.bodyFat != null) r.hard.push(...checkBodyFat(rec.bodyFat).hard);
    if (typeof rec.note === 'string' && rec.note.length > 2000) H(r, 'C_NOTE_LONG', 'Note');
    return finish(r);
  },
  photos(rec) {
    const r = newResult(); if (!needId(r, rec)) return finish(r);
    if (!PHOTO.slots.includes(rec.slot)) H(r, 'C_PHOTO_COUNT', 'Photos');
    if (typeof rec.checkinId !== 'string') H(r, 'V_REQUIRED', 'checkinId');
    return finish(r);
  },
  foodPrefs(rec) { const r = newResult(); if (!rec || typeof rec.pid !== 'string' || !rec.foodRef) H(r, 'V_REQUIRED', 'foodRef'); return finish(r); }
};
/** store name -> validation result. Unknown store: hard error. */
export function validateRecord(store, rec) {
  const fn = V[store];
  if (!fn) { const r = newResult(); H(r, 'V_REQUIRED', 'store'); return finish(r); }
  return fn(rec);
}
export const RECORD_STORES = Object.keys(V);
