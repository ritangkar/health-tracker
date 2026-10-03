// A9 seed-data QA (DAT-010..012, FR-009..011, FR-018, FR-019, DAT-016, DAT-025). Read-only: fetches data/*.json and runs the shared validator over it.
// Loaded by tests-data.js (the harness SUITES list names tests-data.js, not this file). Findings go to window.__a9 for the report runner.
import { describe, it, assert, scanForWeekdays } from './harness.js';
import { validateRecord } from '../js/core/validate.js';
import { normalize, setSeedData, search, loadSeed } from '../js/core/seed.js';

const DATA = new URL('../data/', import.meta.url);
const FIX = new URL('./fixtures/', import.meta.url);
const MIN_FOODS = 900; // D-069
const report = (window.__a9 = window.__a9 || {});
const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.json(); };
const getText = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.text(); };

let cache = null;
async function seedFiles() {
  if (cache) return cache;
  const manifest = await getJson(new URL('seed-manifest.json', DATA));
  const files = {};
  for (const f of manifest.files) files[f.path] = await getJson(new URL(f.path, DATA));
  const foodFiles = manifest.files.filter((f) => /^foods-/.test(f.path)).map((f) => f.path);
  const foods = foodFiles.flatMap((p) => files[p].items.map((x) => ({ ...x, __file: p })));
  cache = { manifest, files, foodFiles, foods, exercises: files['exercises.json'].items, plans: files['plans.json'].items };
  return cache;
}
const PREFIX = { 'foods-starter.json': 'f:st-', 'foods-staples-a.json': 'f:sa-', 'foods-staples-b.json': 'f:sb-', 'foods-indian-home-a.json': 'f:ha-', 'foods-indian-home-b.json': 'f:hb-', 'foods-bengali.json': 'f:bn-', 'foods-restaurant-indian.json': 'f:ri-', 'foods-packaged.json': 'f:pk-', 'foods-restaurant-world-a.json': 'f:wa-', 'foods-restaurant-world-b.json': 'f:wb-', 'foods-restaurant-world-c.json': 'f:wc-' };

describe('A9 seed: manifest and files', () => {
  it('manifest counts equal the real item counts; seedVersion equals WA_SEED_VERSION in version.js', ['DAT-010', 'DAT-016'], async () => {
    const s = await seedFiles(); const bad = [];
    for (const f of s.manifest.files) { const n = s.files[f.path].items.length; if (n !== f.count) bad.push(`${f.path}: manifest ${f.count}, file ${n}`); }
    assert.eq(bad.length, 0, bad.join('; '));
    const vj = await getText(new URL('../version.js', import.meta.url));
    const m = /WA_SEED_VERSION\s*=\s*(\d+)/.exec(vj); assert.ok(m, 'WA_SEED_VERSION not found');
    assert.eq(Number(m[1]), s.manifest.seedVersion, 'version.js vs seed-manifest');
  });
  it('every file is {schema:1,file,items[]} and its file name matches', ['DAT-010'], async () => {
    const s = await seedFiles();
    for (const [p, j] of Object.entries(s.files)) { assert.eq(j.schema, 1, p); assert.eq(j.file, p, p); assert.ok(Array.isArray(j.items), p); }
  });
  it('total seed size is at most 2 MB (hard) and the files are listed in the manifest', ['NFR-005'], async () => {
    const s = await seedFiles(); let total = 0;
    for (const f of s.manifest.files) { const t = await getText(new URL(f.path, DATA)); total += new Blob([t]).size; }
    report.seedBytes = total; assert.ok(total <= 2 * 1024 * 1024, `seed is ${total} bytes`);
  });
  it('SEED-GAP: at least 900 foods (D-069); the real total is reported', ['FR-009', 'FR-010', 'FR-011', 'DAT-010'], async () => {
    const s = await seedFiles(); report.foodTotal = s.foods.length;
    assert.ok(s.foods.length >= MIN_FOODS, `only ${s.foods.length} of ${MIN_FOODS} minimum foods (${Math.round(s.foods.length / MIN_FOODS * 100)}%): seed chunks A7.1-A7.9 are missing`);
  });
});

describe('A9 seed: foods', () => {
  it('every food passes the shared validator with 0 HARD problems (SOFT listed in the report)', ['DAT-027', 'DAT-010'], async () => {
    const { foods } = await seedFiles(); const hard = [], soft = [];
    for (const f of foods) { const r = validateRecord('foods', f); if (!r.ok) hard.push(`${f.id}: ${r.hard.map((h) => h.code).join(',')}`); for (const x of r.soft || []) soft.push(`${f.id}: ${x.code}`); }
    report.foodSoft = soft; assert.eq(hard.length, 0, hard.slice(0, 5).join(' | '));
  });
  it('ids are unique across ALL seed files and use the file prefix from D-093', ['DAT-010'], async () => {
    const s = await seedFiles(); const seen = new Map(); const bad = [];
    const all = [...s.foods.map((x) => [x.id, x.__file]), ...s.exercises.map((x) => [x.id, 'exercises.json']), ...s.plans.map((x) => [x.id, 'plans.json'])];
    for (const [id, file] of all) { if (seen.has(id)) bad.push(`duplicate ${id} (${seen.get(id)} and ${file})`); seen.set(id, file); }
    for (const f of s.foods) { const p = PREFIX[f.__file]; if (p && !f.id.startsWith(p)) bad.push(`${f.id} in ${f.__file} should start with ${p}`); if (!p) bad.push(`no prefix rule for ${f.__file}`); if (!/^f:[a-z0-9-]+$/.test(f.id)) bad.push(`bad id ${f.id}`); }
    assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
  });
  it('no duplicate food names (exact and normalised)', ['DAT-010'], async () => {
    const { foods } = await seedFiles(); const a = new Map(), b = new Map(), bad = [];
    for (const f of foods) { const k1 = f.name.trim().toLowerCase(), k2 = normalize(f.name); if (a.has(k1)) bad.push(`${f.id} = ${a.get(k1)}`); else if (b.has(k2)) bad.push(`${f.id} ~ ${b.get(k2)}`); a.set(k1, f.id); b.set(k2, f.id); }
    assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
  });
  it('Atwater deviation (off by >25% AND >50 kcal) is reported; none may exceed 50% and 100 kcal', ['DAT-012', 'FR-009'], async () => {
    const { foods } = await seedFiles(); const list = [], severe = [];
    for (const f of foods) {
      const n = f.nutrition; const calc = 4 * n.protein + 4 * n.carbs + 9 * n.fat; const d = Math.abs(calc - n.kcal);
      const per = n.per.amount ? n.kcal / n.per.amount : 0; void per;
      if (d > 50 && d > 0.25 * Math.max(n.kcal, 1)) list.push({ id: f.id, kcal: n.kcal, atwater: Math.round(calc) });
      if (d > 100 && d > 0.5 * Math.max(n.kcal, 1)) severe.push(f.id);
    }
    report.atwater = list; assert.eq(severe.length, 0, `severe: ${severe.join(', ')}`);
  });
  it('fiber is null or at most carbs; carbs plus fat plus protein fit in the basis', ['DAT-012'], async () => {
    const { foods } = await seedFiles(); const bad = [];
    for (const f of foods) { const n = f.nutrition; if (n.fiber != null && n.fiber > n.carbs) bad.push(`${f.id} fiber ${n.fiber} > carbs ${n.carbs}`); if (n.per.unit !== 'serving' && n.protein + n.carbs + n.fat > 105 * n.per.amount / 100) bad.push(`${f.id} macros exceed basis`); }
    assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
  });
  it('servings: unit word appears in the label, baseAmount plausible, default serving exists, g/ml foods may rely on the implicit serving', ['FR-012'], async () => {
    const { foods } = await seedFiles(); const bad = [], odd = [];
    const RANGE = { cup: [100, 320], bowl: [100, 600], piece: [3, 500], serving: [10, 800] };
    for (const f of foods) {
      const sv = f.servings || []; const ids = new Set(sv.map((x) => x.id)); const unit = f.nutrition.per.unit;
      if (unit === 'serving' && !sv.length) bad.push(`${f.id} basis serving but no servings`);
      if (f.defaultServingId && !ids.has(f.defaultServingId) && f.defaultServingId !== unit) bad.push(`${f.id} defaultServingId ${f.defaultServingId} missing`);
      if (ids.size !== sv.length) bad.push(`${f.id} duplicate serving ids`);
      for (const s of sv) {
        if (!/\d/.test(s.label)) bad.push(`${f.id}/${s.id} label has no number: ${s.label}`);
        // D-027: the label names its unit ('1 bowl') or states the amount ('1 roti (40 g)'); this mirrors the shared validator F_SERVING_LABEL
        if (['cup', 'bowl', 'piece', 'serving', 'g', 'ml'].includes(s.unit) && !s.label.toLowerCase().includes(s.unit) && !/\d\s*(g|ml)\b/i.test(s.label)) bad.push(`${f.id}/${s.id} label "${s.label}" names neither unit ${s.unit} nor an amount`);
        if (!(s.baseAmount > 0 && s.baseAmount <= 5000)) bad.push(`${f.id}/${s.id} baseAmount ${s.baseAmount}`);
        const r = RANGE[s.unit]; if (r && unit !== 'serving' && (s.baseAmount < r[0] || s.baseAmount > r[1])) odd.push(`${f.id}/${s.id} ${s.label} = ${s.baseAmount}`);
      }
    }
    report.servingOdd = odd; assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
  });
  it('Bengali and Hindi names carry aliases: every indian/bengali food has at least 2', ['FR-010', 'DAT-010'], async () => {
    const { foods } = await seedFiles(); const bad = foods.filter((f) => ['bengali', 'indian'].includes(f.cuisine) && (f.aliases || []).length < 2).map((f) => f.id);
    assert.eq(bad.length, 0, bad.join(', '));
  });
  it('restaurant and mixed foods are all estimate; nothing is verified without a cited source', ['FR-011', 'DAT-012', 'DAT-016'], async () => {
    const { foods } = await seedFiles(); const bad = [];
    for (const f of foods) {
      if (f.origin === 'restaurant' && f.confidence !== 'estimate') bad.push(`${f.id} restaurant but ${f.confidence}`);
      if (f.source?.type === 'restaurant-estimate' && f.confidence !== 'estimate') bad.push(`${f.id} restaurant-estimate but ${f.confidence}`);
      if (f.confidence === 'verified' && !(f.source && f.source.ref && f.source.type === 'cited')) bad.push(`${f.id} verified without a cited source.ref`);
      if (!f.source || !f.source.ref || !f.confidence) bad.push(`${f.id} lacks source or confidence`);
    }
    assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
  });
  it('every system seed food is flagged system:true and has no pid', ['DAT-006'], async () => {
    const { foods } = await seedFiles(); const bad = foods.filter((f) => f.system !== true || f.pid).map((f) => f.id); assert.eq(bad.length, 0, bad.join(', '));
  });
  it('report: counts by category and by cuisine', async () => {
    const { foods } = await seedFiles(); const c = {}, u = {};
    for (const f of foods) { c[f.category] = (c[f.category] || 0) + 1; u[f.cuisine] = (u[f.cuisine] || 0) + 1; }
    report.byCategory = c; report.byCuisine = u; assert.ok(true);
  });
});

describe('A9 seed: exercises, plans, other files', () => {
  it('every exercise passes the validator; ids unique; at most one kind of kcal basis per exercise', ['DAT-011', 'FR-018'], async () => {
    const { exercises } = await seedFiles(); const bad = [];
    for (const e of exercises) { const r = validateRecord('exercises', e); if (!r.ok) bad.push(`${e.id}: ${r.hard.map((h) => h.code).join(',')}`); }
    assert.eq(bad.length, 0, bad.slice(0, 5).join(' | ')); assert.ok(exercises.length >= 55, `${exercises.length} exercises`);
  });
  it('all 20 exercises named in the master brief exist (the brief lists 20, not 21: C-043)', ['FR-018', 'DAT-011'], async () => {
    const { exercises } = await seedFiles(); const names = exercises.map((e) => normalize(e.name)); const al = exercises.flatMap((e) => (e.aliases || []).map(normalize));
    const need = ['push ups', 'backpack rows', 'pike push ups', 'reverse flys', 'plank', 'squats', 'backpack romanian deadlifts', 'reverse lunges', 'glute bridges', 'dead bugs', 'biceps curls', 'overhead triceps extensions', 'hamstring walkouts', 'calf raises', 'wall sit', 'running', 'brisk walking', 'suryanamaskar', 'cat cow flow', 'child s pose'];
    const missing = need.filter((n) => !names.some((x) => x.replace(/s$/, '') === normalize(n).replace(/s$/, '') || x === normalize(n)) && !al.includes(normalize(n)));
    assert.eq(missing.length, 0, `missing: ${missing.join(', ')}`);
  });
  it('the six plans match default_plans_exact: names, order, step goals, items, targets, ranges, perSide, alt', ['FR-019', 'DAT-011', 'QA-010'], async () => {
    const { plans, exercises } = await seedFiles(); const exById = new Map(exercises.map((e) => [e.id, e]));
    const want = [
      ['plan:upper-push-pull', 'Upper Body - Push & Pull', 7000, [['ex:push-up', 'reps', 10, null, false], ['ex:backpack-row', 'reps', 12, null, false], ['ex:pike-push-up', 'reps', 8, null, false], ['ex:reverse-fly', 'reps', 12, null, false], ['ex:plank', 'seconds', 30, null, false]]],
      ['plan:lower-core', 'Lower Body & Core', 7000, [['ex:squat', 'reps', 15, null, false], ['ex:backpack-rdl', 'reps', 12, null, false], ['ex:reverse-lunge', 'reps', 10, null, true], ['ex:glute-bridge', 'reps', 15, null, false], ['ex:dead-bug', 'reps', 10, null, true]]],
      ['plan:recovery-yoga', 'Active Recovery & Yoga', 7000, [['ex:suryanamaskar', 'rounds', 5, 10, false], ['ex:cat-cow', 'reps', 10, 12, false], ['ex:childs-pose', 'seconds', 60, 120, false]]],
      ['plan:upper-arms', 'Upper Body - Arms Focus', 7000, [['ex:push-up', 'reps', 10, null, false], ['ex:backpack-row', 'reps', 12, null, false], ['ex:pike-push-up', 'reps', 8, null, false], ['ex:biceps-curl', 'reps', 12, null, false], ['ex:overhead-triceps-extension', 'reps', 12, null, false]]],
      ['plan:lower-cardio', 'Lower Body & Cardio', 7000, [['ex:squat', 'reps', 15, null, false], ['ex:hamstring-walkout', 'reps', 10, null, false], ['ex:calf-raise', 'reps', 20, null, false], ['ex:wall-sit', 'seconds', 30, null, false], ['ex:running', 'minutes', 20, 30, false]]],
      ['plan:rest', 'Complete Rest', 10000, []]
    ];
    assert.eq(plans.length, 6, 'plan count');
    const problems = [];
    want.forEach((w, i) => {
      const p = plans[i]; if (!p || p.id !== w[0]) { problems.push(`plan ${i} id ${p && p.id} want ${w[0]}`); return; }
      if (p.name !== w[1]) problems.push(`${w[0]} name "${p.name}"`);
      if (p.stepGoal !== w[2]) problems.push(`${w[0]} stepGoal ${p.stepGoal}`);
      if (w[0] === 'plan:rest') { if (!p.isRest || p.items.length) problems.push('rest plan must be isRest with no items'); return; }
      if (p.isRest) problems.push(`${w[0]} must not be rest`);
      if (p.items.length !== w[3].length) { problems.push(`${w[0]} has ${p.items.length} items`); return; }
      w[3].forEach((x, j) => {
        const it = p.items[j]; const tag = `${w[0]}#${j + 1}`;
        if (it.exerciseId !== x[0]) problems.push(`${tag} exercise ${it.exerciseId} want ${x[0]}`);
        if (it.targetKind !== x[1]) problems.push(`${tag} kind ${it.targetKind}`);
        if (it.target !== x[2]) problems.push(`${tag} target ${it.target}`);
        if ((it.targetMax ?? null) !== x[3]) problems.push(`${tag} targetMax ${it.targetMax}`);
        if (!!it.perSide !== x[4]) problems.push(`${tag} perSide ${it.perSide}`);
        const ex = exById.get(it.exerciseId); if (!ex) problems.push(`${tag} exercise missing`); else { if (ex.name !== it.exerciseName) problems.push(`${tag} name drift`); if (ex.targetKind !== it.targetKind) problems.push(`${tag} kind differs from exercise`); if (!!ex.perSide !== !!it.perSide) problems.push(`${tag} perSide differs from exercise`); }
      });
    });
    const lc = plans[4].items[4]; if (!(lc.altExerciseIds || []).includes('ex:brisk-walking')) problems.push('running alt brisk-walking missing');
    assert.eq(problems.length, 0, problems.join(' | '));
    const r = plans.map((p) => validateRecord('plans', p)); assert.ok(r.every((x) => x.ok), 'validator on plans');
    assert.eq(plans.filter((p) => p.stepGoal === 7000).length, 5); assert.eq(plans.filter((p) => p.stepGoal === 10000).length, 1);
  });
  it('plan items: kcalSnap equals the exercise kcal; itemIds unique per plan', ['DAT-011'], async () => {
    const { plans, exercises } = await seedFiles(); const ex = new Map(exercises.map((e) => [e.id, e])); const bad = [];
    for (const p of plans) { const ids = new Set(); for (const it of p.items) { if (ids.has(it.itemId)) bad.push(`${p.id} dup ${it.itemId}`); ids.add(it.itemId); const e = ex.get(it.exerciseId); if (e && JSON.stringify(e.kcal) !== JSON.stringify(it.kcalSnap)) bad.push(`${it.itemId} kcalSnap differs`); } }
    assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
  });
  it('measurement-types and meal-categories shapes', ['FR-006', 'FR-029', 'FR-030'], async () => {
    const s = await seedFiles(); const mt = s.files['measurement-types.json'].items, mc = s.files['meal-categories.json'].items;
    assert.deepEq(mt.filter((m) => m.v1).map((m) => m.key), ['height', 'weight', 'bodyFat', 'biceps', 'thigh', 'waist'], 'six V1 types in order');
    assert.deepEq(mt.filter((m) => !m.v1).map((m) => m.key), ['chest', 'hips', 'neck', 'calf'], 'four reserved');
    for (const m of mt) { assert.ok(m.id === `mt:${m.key}` && ['cm', 'kg', '%'].includes(m.canonicalUnit) && m.min < m.max, m.id); }
    assert.eq(mt.find((m) => m.key === 'bodyFat').approx, true, 'body fat is approximate');
    assert.deepEq(mc.map((m) => m.id), ['meal:breakfast', 'meal:lunch', 'meal:snacks', 'meal:dinner', 'meal:other'], 'meals');
    assert.deepEq(mc.map((m) => m.label), ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Other']);
    let at = 0; for (const m of mc) { assert.ok(m.clockFrom === at, `${m.id} window gap`); at = m.clockTo; } assert.eq(at, 24, 'meal windows cover 24 h');
  });
  it('categories: every food category and cuisine is declared in categories.json', ['DAT-010'], async () => {
    const s = await seedFiles(); const cats = s.files['categories.json'].items; const cat = new Set(cats.filter((c) => c.group === 'category').map((c) => c.id)); const cui = new Set(cats.filter((c) => c.group === 'cuisine').map((c) => c.id.replace('cuisine:', '')));
    const bad = s.foods.filter((f) => !cat.has(f.category) || !cui.has(f.cuisine)).map((f) => `${f.id} ${f.category}/${f.cuisine}`); assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
  });
  it('ATTRIBUTION.md: IFCT consulted but not imported, disclaimer, confidence levels, restaurant estimate wording', ['DAT-016', 'DAT-025'], async () => {
    const t = await getText(new URL('ATTRIBUTION.md', DATA));
    assert.ok(/IFCT|Indian Food Composition Tables/i.test(t) && /not imported/i.test(t), 'IFCT not imported');
    assert.ok(/approximate/i.test(t) && /medical/i.test(t) && /advice/i.test(t), 'disclaimer'); assert.ok(/estimate/i.test(t) && /restaurant/i.test(t), 'estimate wording');
    assert.ok(/src-indb/.test(t) && /src-usda/.test(t), 'register lists INDB and USDA');
  });
  it('no weekday field, schedule or rotation key in any seed file; no URLs inside data', ['FR-020', 'QA-010'], async () => {
    const s = await seedFiles(); const bad = []; const keyScan = (o, path) => { if (Array.isArray(o)) o.forEach((x, i) => keyScan(x, `${path}[${i}]`)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (/weekday|dayOfWeek|schedule|rotation|^day$/i.test(k)) bad.push(`${path}.${k}`); keyScan(v, `${path}.${k}`); } };
    for (const [p, j] of Object.entries(s.files)) keyScan(j, p);
    assert.eq(bad.length, 0, bad.slice(0, 5).join(' | '));
    const texts = {}; for (const f of s.manifest.files) texts[`data/${f.path}`] = await getText(new URL(f.path, DATA)); texts['data/ATTRIBUTION.md'] = await getText(new URL('ATTRIBUTION.md', DATA));
    const wd = scanForWeekdays(texts); assert.eq(wd.length, 0, wd.slice(0, 3).map((x) => `${x.file}:${x.line} ${x.match}`).join(' | '));
    for (const [p, t] of Object.entries(texts)) if (!p.endsWith('.md') && /https?:\/\//i.test(t)) bad.push(`${p} has a URL`);
    assert.eq(bad.length, 0, bad.join(' | '));
  });
});

describe('A9 seed: search fixtures', () => {
  async function runFixtures(tier) {
    const s = await seedFiles(); const fx = await getJson(new URL('a9-search-fixtures.json', FIX));
    setSeedData({ foods: s.foods, exercises: s.exercises, plans: s.plans, mealCategories: s.files['meal-categories.json'].items, measurementTypes: s.files['measurement-types.json'].items, categories: s.files['categories.json'].items, seedVersion: s.manifest.seedVersion });
    const miss = []; let n = 0;
    for (const q of fx.queries.filter((x) => (tier ? x.tier === tier : true))) {
      n++; const res = await search(q.q, 'a9-no-profile', q.top || 5); const rx = new RegExp(q.expectMatch, 'i');
      if (!res.some((r) => rx.test(r.food.name + ' ' + (r.food.aliases || []).join(' ')))) miss.push(`"${q.q}" -> [${res.slice(0, 3).map((r) => r.food.name).join('; ')}] want /${q.expectMatch}/`);
    }
    return { miss, n };
  }
  it('at least 40 fixtures exist, 13 of them for foods named in the master brief', ['FR-010', 'QA-010'], async () => { const fx = await getJson(new URL('a9-search-fixtures.json', FIX)); assert.ok(fx.queries.length >= 40, `${fx.queries.length}`); assert.ok(fx.queries.filter((q) => q.tier === 'brief').length >= 13); });
  it('spelling-variant queries for foods that exist return them in the top 5', ['FR-010', 'FR-040'], async () => {
    const { miss, n } = await runFixtures('present'); report.searchPresent = { n, miss }; assert.eq(miss.length, 0, miss.slice(0, 6).join(' | '));
  });
  it('ranking: exact alias and whole-word matches outrank bare prefixes (paan, khichdi, egg, kheer; KI-093, KI-112)', ['FR-010', 'FR-040'], async () => {
    const { miss, n } = await runFixtures('rank'); report.searchRank = { n, miss }; assert.ok(n >= 10, `${n} rank fixtures`); assert.eq(miss.length, 0, miss.slice(0, 6).join(' | '));
  });
  it('SEED-GAP: foods named in the master brief are found (aloo posto, shukto, cholar dal, luchi, chow mein, ...)', ['FR-010', 'FR-011'], async () => {
    const { miss, n } = await runFixtures('brief'); report.searchBrief = { n, miss }; assert.eq(miss.length, 0, `${miss.length} of ${n} not found: ${miss.map((m) => m.split(' -> ')[0]).join(', ')}`);
  });
  it('search results never include foods flagged deprecated or from another profile overlay', ['DAT-006'], async () => {
    const s = await seedFiles(); const dep = s.foods.filter((f) => f.deprecated).map((f) => f.id);
    for (const q of ['rice', 'dal', 'egg']) { const res = await search(q, 'a9-no-profile', 50); assert.ok(!res.some((r) => dep.includes(r.food.id)), 'deprecated listed'); }
  });
  it('restores the real seed loader state after the fixtures', async () => { const r = await loadSeed({ base: '../data/' }); assert.ok(r && r.seedVersion >= 1); });
});
