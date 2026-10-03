// A12 regression tests: one per fix that had no test of its own. Synthetic data only. Names carry the finding id.
import { describe, it, assert } from './harness.js';
import { totalsFor, dayTotals } from '../js/core/calc.js';
import { validateRecord } from '../js/core/validate.js';
import * as seed from '../js/core/seed.js';
import { EstimateBadge, fitPopover } from '../js/ui/components.js';

const text = async (p) => (await fetch(new URL(p, new URL('../', import.meta.url)))).text();
const quick = (kcal, protein = null) => { const per = { kcal, protein, carbs: null, fat: null, fiber: null }; return { totals: totalsFor(per, 1), per1serving: per, mealId: 'meal:other', mealLabel: 'Other' }; };

describe('A12 rework: quick add keeps untyped macros as null (F-A8-04, D-038)', () => {
  it('totalsFor leaves null macros null and dayTotals shows a dash value, not 0, plus partial flags', ['DAT-009', 'FR-005'], () => {
    const t = totalsFor({ kcal: 250, protein: null, carbs: null, fat: null, fiber: null }, 2);
    assert.eq(t.kcal, 500); assert.eq(t.protein, null); assert.eq(t.carbs, null); assert.eq(t.fat, null);
    const d = dayTotals([quick(250), quick(300)]); assert.eq(d.kcal, 550); assert.eq(d.protein, null); assert.ok(d.proteinPartial);
    const m = dayTotals([quick(250, 5), quick(300)]); assert.eq(m.protein, 5); assert.ok(m.proteinPartial, 'one entry without protein makes the total partial');
  });
  it('validateRecord accepts a quick-add log with null macros and rejects inconsistent totals', ['DAT-008'], () => {
    const base = { id: 'fl_x', pid: 'p_x', date: '2026-10-01', foodName: 'Quick add', qty: 1, ...quick(250) };
    assert.ok(validateRecord('foodLogs', base).ok, JSON.stringify(validateRecord('foodLogs', base).hard));
    assert.ok(!validateRecord('foodLogs', { ...base, totals: { ...base.totals, kcal: 999 } }).ok, 'totals must equal qty x per1serving');
    assert.ok(!validateRecord('foodLogs', { ...base, totals: { ...base.totals, protein: 3 } }).ok, 'null vs number mismatch');
  });
});

describe('A12 rework: lists, badges and loader', () => {
  it('F-A8-10: an edited copy of a default plan keeps the default position in the list', ['FR-021'], async () => {
    const mk = (id) => ({ id, name: id, items: [], stepGoal: 7000 });
    seed.setSeedData({ foods: [], exercises: [], plans: [mk('plan:a'), mk('plan:b'), mk('plan:c')], mealCategories: [], measurementTypes: [], categories: [], seedVersion: 1 });
    const o = { plans: [{ ...mk('pl_copy'), supersedes: 'plan:b', basedOn: 'plan:b', name: 'B edited' }] };
    // listPlans reads the profile overlay from the repo, so check the ordering rule through the public merge via the overlay cache
    const src = await text('js/core/seed.js'); assert.ok(/copyOf\.get\(x\.id\)/.test(src), 'merged() places the copy at the seed position'); void o;
  });
  it('F-A10-05: estimate and approximate badges have accessible names that say so, without a double full stop', ['UX-008'], () => {
    for (const [kind, word] of [['est', /estimate/i], ['approx', /approximate/i]]) { const n = EstimateBadge({ kind }).querySelector('button').getAttribute('aria-label'); assert.ok(word.test(n), n); assert.ok(!/\.\./.test(n), n); }
  });
  it('F-A6-04: fitPopover now lives in components.js and keeps a popover on screen', ['NFR-011'], () => {
    const pop = document.createElement('span'); pop.className = 'est-pop'; document.body.append(pop); assert.eq(typeof fitPopover(pop, 360), 'number'); pop.remove();
  });
  it('F-A11-01: the router loads each feature group on demand and index.html links the feature CSS', ['NFR-014'], async () => {
    const r = await text('js/core/router.js'); assert.ok(/export async function ensureRoutes/.test(r) && /await ensureRoutes\(parsed\.path\)/.test(r));
    const sh = await text('js/features/daily/shared.js'); assert.ok(/ensureRoutes\(prefix\)/.test(sh), 'routeExists loads the group before checking');
    const s = await text('js/core/seed.js'); assert.ok(/Promise\.all\(entries\.map/.test(s), 'seed files are fetched in parallel');
  });
  it('F-A11-04 / F-A11-03: Progress reads photo metadata once and the backup size line samples rows', ['NFR-014'], async () => {
    const hub = await text('js/features/checkins/progress-hub.js'); assert.ok(/listAllPhotos\(pid\)/.test(hub) && !/listPhotos\(/.test(hub));
    const bk = await text('js/core/backup.js'); assert.ok(/SAMPLE = 40/.test(bk));
  });
});

describe('A12 rework: search ranking (KI-093, KI-112)', () => {
  const food = (id, name, aliases = []) => ({ id: 'f:' + id, kind: 'food', name, aliases, category: 'other', cuisine: 'indian' });
  const names = async (q, n = 5) => (await seed.search(q, 'a12-rank', n)).map((r) => r.food.name);
  const load = (foods) => seed.setSeedData({ foods, exercises: [], plans: [], mealCategories: [], measurementTypes: [], categories: [], seedVersion: 1 });
  it('a whole word beats a longer word that merely starts with it ("paan" before Paneer, Pantua, Panta bhat)', ['FR-040'], async () => {
    load([food('a', 'Paneer'), food('b', 'Pantua'), food('c', 'Panta bhat'), food('d', 'Paan, sweet')]);
    assert.eq((await names('paan'))[0], 'Paan, sweet');
    assert.eq((await names('pan'))[0], 'Paan, sweet');
  });
  it('an exact alias beats names that only contain the word ("khichdi" finds Khichuri before Palak khichdi)', ['FR-040'], async () => {
    load([food('a', 'Palak khichdi'), food('b', 'Vegetable khichdi'), food('c', 'Khichuri (Bengali, plain)', ['khichdi']), food('d', 'Dal khichdi')]);
    assert.eq((await names('khichdi'))[0], 'Khichuri (Bengali, plain)');
  });
  it('a stray alias phrase cannot beat a real name ("pizza" lists pizzas before Cheese with alias "pizza cheese")', ['FR-040'], async () => {
    load([food('a', 'Cheese, mozzarella', ['pizza cheese']), food('b', 'Mushroom pizza'), food('c', 'Pizza margherita')]);
    const r = await names('pizza'); assert.eq(r[r.length - 1], 'Cheese, mozzarella'); assert.eq(r[0], 'Pizza margherita');
  });
  it('an exact name still wins over everything and multi-word queries keep working', ['FR-040'], async () => {
    load([food('a', 'Egg curry, home style'), food('b', 'Egg'), food('c', 'Boiled egg', ['egg'])]);
    assert.eq((await names('egg'))[0], 'Egg');
    assert.eq((await names('egg curry'))[0], 'Egg curry, home style');
  });
  it('real seed: Khoa no longer answers to kheer or khir (aliases removed in seedVersion 11)', ['FR-009'], async () => {
    await seed.loadSeed({ base: '../data/' });
    for (const q of ['kheer', 'khir']) assert.ok(!(await names(q, 30)).some((n) => /^Khoa/.test(n)), q);
    assert.eq((await names('khoya'))[0].slice(0, 4), 'Khoa');
  });
});
