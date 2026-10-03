// Pure model for the custom food form (S11): form values <-> food record, with the shared validator doing the checking (D-037). (A5)
import { validateRecord, cleanText, num } from '../../core/validate.js';

export const BASES = [{ id: 'g', label: 'Per 100 g' }, { id: 'ml', label: 'Per 100 ml' }, { id: 'serving', label: 'Per serving' }];
export const SERVING_UNITS = [{ id: 'serving', label: 'serving' }, { id: 'bowl', label: 'bowl' }, { id: 'cup', label: 'cup' }, { id: 'piece', label: 'piece' }, { id: 'other', label: 'other' }];
export const ORIGINS = [{ id: 'home', label: 'Home-cooked' }, { id: 'packaged', label: 'Packaged' }, { id: 'restaurant', label: 'Restaurant or takeaway' }, { id: 'raw', label: 'Raw ingredient' }];
const FIELD_OF = { Name: 'name', Calories: 'kcal', Protein: 'protein', Carbs: 'carbs', Fat: 'fat', Fibre: 'fiber', Macros: 'protein', Nutrition: 'kcal', Serving: 'servingBase', 'Serving name': 'servingLabel', Notes: 'notes' };

export function emptyForm() { return { name: '', aliases: '', category: 'other', cuisine: 'other', origin: 'home', sourceKind: 'user', basis: 'g', kcal: '', protein: '', carbs: '', fat: '', fiber: '', servingLabel: '', servingUnit: 'serving', servingBase: '', notes: '' }; }
const s = (v) => (v === null || v === undefined ? '' : String(v));
/** Existing food record -> form values. */
export function formFromFood(f) {
  const per = f.nutrition.per; const sv = (f.servings || [])[0] || null; const basis = per.unit === 'g' || per.unit === 'ml' ? per.unit : 'serving';
  return { name: f.name || '', aliases: (f.aliases || []).join(', '), category: f.category || 'other', cuisine: f.cuisine || 'other', origin: f.origin || 'home', sourceKind: f.source && f.source.type === 'label' ? 'label' : 'user', basis,
    kcal: s(f.nutrition.kcal), protein: s(f.nutrition.protein), carbs: s(f.nutrition.carbs), fat: s(f.nutrition.fat), fiber: s(f.nutrition.fiber), servingLabel: sv ? sv.label : '', servingUnit: sv && SERVING_UNITS.some((u) => u.id === sv.unit) ? sv.unit : 'serving', servingBase: sv && basis !== 'serving' ? s(sv.baseAmount) : '', notes: f.notes || '' };
}
const aliasList = (text) => [...new Set(String(text || '').split(',').map((x) => cleanText(x)).filter(Boolean))];

/** -> {record, errors:[{field,message,code}], soft:[{message}]}. record is null when there are errors. Blank fibre = unknown (null), never 0. */
export function parseForm(f, existing = null) {
  const errors = []; const pushE = (field, message, code) => errors.push({ field, message, code });
  const basis = ['g', 'ml', 'serving'].includes(f.basis) ? f.basis : 'g';
  const nutrition = { per: { amount: basis === 'serving' ? 1 : 100, unit: basis }, kcal: num(f.kcal), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat), fiber: num(f.fiber) };
  const servings = []; const label = cleanText(f.servingLabel) || '';
  const firstId = (existing && existing.servings && existing.servings[0] && existing.servings[0].id) || 's1';
  if (basis === 'serving') servings.push({ id: firstId, label: label || '1 serving', unit: f.servingUnit || 'serving', baseAmount: 1, approx: false });
  else if (label || String(f.servingBase).trim() !== '') servings.push({ id: firstId, label, unit: f.servingUnit || 'serving', baseAmount: num(f.servingBase), approx: false });
  // The form edits the first serving only. Any further servings (for example from an import) are kept as they are.
  if (servings.length && existing && Array.isArray(existing.servings)) servings.push(...existing.servings.slice(1));
  const origin = ORIGINS.some((o) => o.id === f.origin) ? f.origin : 'home';
  const label_ = f.sourceKind === 'label' && origin !== 'restaurant';
  const aliases = aliasList(f.aliases);
  if (aliases.length > 10 || aliases.some((a) => a.length > 60)) pushE('aliases', 'Use up to 10 other names, each under 60 characters.', 'V_TEXT_LONG');
  const record = { ...(existing || {}), kind: 'food', name: cleanText(f.name), aliases, category: f.category, cuisine: f.cuisine, origin, source: { type: label_ ? 'label' : 'user', ref: null }, confidence: label_ ? 'typical' : 'estimate', system: false, nutrition, servings, defaultServingId: servings.length ? (existing && servings.some((x) => x.id === existing.defaultServingId) ? existing.defaultServingId : servings[0].id) : null, notes: cleanText(f.notes) || null };
  delete record.recipe;
  const res = validateRecord('foods', { ...record, id: record.id || 'fd_check', pid: record.pid || 'p_check' });
  for (const hh of res.hard) pushE(FIELD_OF[hh.field] || 'form', hh.message, hh.code);
  if (basis === 'serving' && servings[0] && servings[0].label.length > 60) pushE('servingLabel', 'The serving name is too long.', 'F_SERVING_LABEL');
  return { record: errors.length ? null : record, errors, soft: res.soft };
}
