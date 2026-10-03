// Seed loader, resolver (seed + profile overlay + hiddenSeed) and search index. (A1)
// API:
//  normalize(text) -> normalised string      tokenize(text) -> string[]
//  loadSeed({base, fetchFn}) -> {seedVersion, counts, missing[]}   (tolerates missing optional food files)
//  setSeedData({foods,exercises,plans,mealCategories,measurementTypes,categories,seedVersion})  (tests / injection)
//  seedLoaded() sync bool, seedCounts() sync
//  prepare(pid, {force}) -> loads overlay (custom foods/exercises/plans, hiddenSeed, prefs) for pid
//  indexFood(pid, food) incremental update after a custom food is saved; invalidateOverlay(pid)
//  search(query, pid, limit=30) -> [{food, matchedAlias|null, rank}]   (prepare() is called internally)
//  browseCategory(pid, category, cuisine?) -> foods[]
//  getFood(id, pid) / getExercise(id, pid) / getPlan(id, pid)   (hidden/deprecated still resolvable for navigation)
//  listExercises(pid) / listPlans(pid) -> visible merged lists;  resolveExerciseSync(pid) -> (id)=>exercise|null
//  listMealCategories() / listMeasurementTypes() / listCategories()
import { SEED_BASE } from '../../config.js';
import * as repo from './repo.js';

const S = { foods: [], exercises: [], plans: [], mealCategories: [], measurementTypes: [], categories: [], seedVersion: 0, loaded: false };
const byId = { foods: new Map(), exercises: new Map(), plans: new Map() };
let seedIndex = null;
const overlays = new Map(); // pid -> {foods[], exercises[], plans[], hidden{}, prefs Map, customIndex}

export function normalize(text) {
  let s = String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(/([a-z])\1+/g, '$1');                 // collapse repeated letters
  s = s.replace(/([bcdfgjklmnpqrstvwxz])h/g, '$1');   // drop h after consonants
  return s.replace(/\s+/g, ' ');
}
export const tokenize = (t) => normalize(t).split(' ').filter(Boolean);

function buildIndex(foods) {
  const entries = foods.map((food) => {
    const terms = [{ norm: normalize(food.name), alias: false }];
    for (const a of food.aliases || []) terms.push({ norm: normalize(a), alias: true, raw: a });
    for (const t of terms) t.tokens = t.norm.split(' ').filter(Boolean);
    return { food, terms };
  });
  const prefix = new Map();
  entries.forEach((e, i) => {
    for (const t of e.terms) for (const tok of t.tokens) for (let l = 1; l <= Math.min(tok.length, 8); l++) {
      const k = tok.slice(0, l); let set = prefix.get(k); if (!set) prefix.set(k, (set = new Set())); set.add(i);
    }
  });
  return { entries, prefix };
}
function candidates(index, qTokens) {
  let acc = null;
  for (const tok of qTokens) {
    const set = index.prefix.get(tok.slice(0, 8)); if (!set) return [];
    acc = acc ? new Set([...acc].filter((x) => set.has(x))) : new Set(set);
    if (!acc.size) return [];
  }
  return acc ? [...acc].map((i) => index.entries[i]) : [];
}
// Ranking (KI-093, KI-112): lower is better. Per term the tier is
//  0 whole term equals the query   1 query words are the term's leading whole words ("paan" in "Paan, sweet")
//  2 every query word is a whole word somewhere in the term ("khichdi" in "Palak khichdi")
//  3 term text starts with the query ("pan" in "Paneer")   4 every query word is a word prefix
// Names: 0,2,3,4,5 by tier. Aliases: an exact alias ranks 1 (just under an exact name, so "khichdi" finds Khichuri first);
// other alias tiers rank 6..9, after every name match, so a stray alias cannot beat a real name.
const NAME_RANK = [0, 2, 3, 4, 5];
const ALIAS_RANK = [1, 6, 7, 8, 9];
function rankEntry(e, q, qTokens) {
  let best = null;
  for (const t of e.terms) {
    let tier = null;
    if (t.norm === q) tier = 0;
    else if (qTokens.length < t.tokens.length && qTokens.every((qt, i) => t.tokens[i] === qt)) tier = 1;
    else if (qTokens.every((qt) => t.tokens.includes(qt))) tier = 2;
    else if (t.norm.startsWith(q)) tier = 3;
    else if (qTokens.every((qt) => t.tokens.some((tk) => tk.startsWith(qt)))) tier = 4;
    if (tier === null) continue;
    const rank = (t.alias ? ALIAS_RANK : NAME_RANK)[tier];
    if (best === null || rank < best.rank) best = { rank, alias: t.alias ? t.raw : null };
  }
  return best;
}
function searchIndex(index, q, qTokens) {
  const out = [];
  for (const e of candidates(index, qTokens)) { const r = rankEntry(e, q, qTokens); if (r) out.push({ food: e.food, matchedAlias: r.alias, rank: r.rank }); }
  return out;
}

export function setSeedData(d) {
  Object.assign(S, { foods: [], exercises: [], plans: [], mealCategories: [], measurementTypes: [], categories: [], seedVersion: 0 }, d, { loaded: true });
  for (const k of ['foods', 'exercises', 'plans']) byId[k] = new Map(S[k].map((x) => [x.id, x]));
  seedIndex = buildIndex(S.foods.filter((f) => !f.deprecated));
  overlays.clear();
}
export const seedLoaded = () => S.loaded;
export const seedCounts = () => ({ foods: S.foods.length, exercises: S.exercises.length, plans: S.plans.length, seedVersion: S.seedVersion });

export async function loadSeed({ base = SEED_BASE, fetchFn = (u) => fetch(u) } = {}) {
  const getJson = async (path) => { const r = await fetchFn(base + path); if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`); return r.json(); };
  const manifest = await getJson('seed-manifest.json');
  const data = { foods: [], exercises: [], plans: [], mealCategories: [], measurementTypes: [], categories: [], seedVersion: manifest.seedVersion ?? 0 };
  const missing = [];
  // F-A11-01: all seed files are requested at once (they used to be fetched one after another); order of foods is kept.
  const entries = (manifest.files || []).map((f) => { const path = typeof f === 'string' ? f : f.path; return { path, name: path.split('/').pop() }; });
  const fetched = await Promise.all(entries.map((en) => getJson(en.path).then((j) => ({ en, j }), (e) => ({ en, e }))));
  for (const { en, j, e } of fetched) {
    const { path, name } = en;
    if (e) { if (/^foods-/.test(name)) { missing.push(path); continue; } throw e; }
    const items = j.items || [];
    if (/^foods-/.test(name)) data.foods.push(...items);
    else if (name === 'exercises.json') data.exercises = items;
    else if (name === 'plans.json') data.plans = items;
    else if (name === 'meal-categories.json') data.mealCategories = items;
    else if (name === 'measurement-types.json') data.measurementTypes = items;
    else if (name === 'categories.json') data.categories = items;
  }
  setSeedData(data);
  return { seedVersion: data.seedVersion, counts: seedCounts(), missing };
}

export async function prepare(pid, { force = false } = {}) {
  if (!force && overlays.has(pid)) return overlays.get(pid);
  const [foods, exercises, plans, settings, prefs] = await Promise.all([repo.listFoods(pid), repo.listExercises(pid), repo.listPlans(pid), repo.getSettings(pid), repo.listPrefs(pid)]);
  const o = { foods, exercises, plans, hidden: settings.hiddenSeed || { foods: [], exercises: [], plans: [] }, prefs: new Map(prefs.map((p) => [p.foodRef, p])), customIndex: buildIndex(foods.filter((f) => !f.archivedAt)) };
  overlays.set(pid, o); return o;
}
export function invalidateOverlay(pid) { if (pid) overlays.delete(pid); else overlays.clear(); }
export async function indexFood(pid, food) {
  const o = await prepare(pid);
  const i = o.foods.findIndex((f) => f.id === food.id);
  if (i >= 0) o.foods[i] = food; else o.foods.push(food);
  o.customIndex = buildIndex(o.foods.filter((f) => !f.archivedAt));
}
const supersededSet = (list) => new Set(list.map((x) => x.supersedes).filter(Boolean));
export async function search(query, pid, limit = 30) {
  const o = await prepare(pid);
  const q = normalize(query); const qTokens = q.split(' ').filter(Boolean);
  if (!qTokens.length || !seedIndex) return [];
  const hidden = new Set(o.hidden.foods || []); const sup = supersededSet(o.foods);
  const res = [
    ...searchIndex(seedIndex, q, qTokens).filter((r) => !hidden.has(r.food.id) && !sup.has(r.food.id)),
    ...searchIndex(o.customIndex, q, qTokens)
  ];
  const pref = (r) => o.prefs.get(r.food.id) || {};
  res.sort((a, b) => a.rank - b.rank || (pref(b).fav || 0) - (pref(a).fav || 0) || (pref(b).lastUsedAt || 0) - (pref(a).lastUsedAt || 0) || (pref(b).useCount || 0) - (pref(a).useCount || 0) || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name));
  return res.slice(0, limit);
}
export async function browseCategory(pid, category, cuisine = null) {
  const o = await prepare(pid);
  const hidden = new Set(o.hidden.foods || []); const sup = supersededSet(o.foods);
  const all = [...S.foods.filter((f) => !f.deprecated && !hidden.has(f.id) && !sup.has(f.id)), ...o.foods.filter((f) => !f.archivedAt)];
  return all.filter((f) => (!category || f.category === category) && (!cuisine || f.cuisine === cuisine)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function getFood(id, pid) {
  if (String(id).startsWith('f:')) return byId.foods.get(id) || null;
  const o = await prepare(pid); return o.foods.find((f) => f.id === id) || null;
}
export async function getExercise(id, pid) {
  if (String(id).startsWith('ex:')) return byId.exercises.get(id) || null;
  const o = await prepare(pid); return o.exercises.find((f) => f.id === id) || null;
}
export async function getPlan(id, pid) {
  if (String(id).startsWith('plan:')) return byId.plans.get(id) || null;
  const o = await prepare(pid); return o.plans.find((f) => f.id === id) || null;
}
function merged(seedList, custom, hiddenIds) {
  const hidden = new Set(hiddenIds || []); const live = custom.filter((x) => !x.archivedAt);
  // F-A8-10: an edited copy keeps the position of the seed item it replaces instead of jumping to the end.
  const copyOf = new Map(live.filter((x) => x.supersedes).map((x) => [x.supersedes, x])); const used = new Set(); const out = [];
  for (const x of seedList) {
    if (x.deprecated || hidden.has(x.id)) continue;
    const c = copyOf.get(x.id); if (c) { out.push(c); used.add(c.id); } else if (!supersededSet(custom).has(x.id)) out.push(x);
  }
  for (const x of live) if (!used.has(x.id)) out.push(x);
  return out;
}
export async function listExercises(pid) { const o = await prepare(pid); return merged(S.exercises, o.exercises, o.hidden.exercises); }
export async function listPlans(pid) { const o = await prepare(pid); return merged(S.plans, o.plans, o.hidden.plans); }
export async function resolveExerciseSync(pid) {
  const o = await prepare(pid);
  return (id) => byId.exercises.get(id) || o.exercises.find((x) => x.id === id) || null;
}
export const listMealCategories = () => S.mealCategories.slice();
export const listMeasurementTypes = () => S.measurementTypes.slice();
export const listCategories = () => S.categories.slice();
