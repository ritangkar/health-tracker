// A6 tests: Trends (S29) and Notes list (S30). Covers FR-028, FR-036, FR-038, UX-016, UX-013, DAT-009, FR-016, NFR-011, NFR-013, FR-020.
// Listed in tests/harness.js SUITES by finding F-A6-02 (A1/A12 own the harness).
import { describe, it, assert, scanForWeekdays } from './harness.js';
import * as db from '../js/core/db.js';
import * as repo from '../js/core/repo.js';
import * as seed from '../js/core/seed.js';
import * as SH from '../js/core/storage-health.js';
import { appStore } from '../js/core/store.js';
import { todayKey, addDays, weekStart } from '../js/core/dates.js';
import { METRICS, metricById, periodRange, dailyValues, weeklyBuckets, bucketAverages, overall, targetFor, compareToTarget, fmtAverage } from '../js/features/analytics/metrics.js';
import { collectNotes, tagCounts, filterNotes, groupByMonth } from '../js/features/analytics/notes-model.js';
import { WeeklyBars } from '../js/features/analytics/trend-chart.js';
import { trendsScreen } from '../js/features/analytics/trends.js';
import { notesScreen } from '../js/features/analytics/notes.js';
import { fitPopover } from '../js/features/analytics/popover-fit.js';

SH.setStoragePrefix('winter-arc-test:');
let n = 0;
async function fresh() { await db.closeDb(); db.openDb(`winter-arc-test-w3-${Date.now().toString(36)}-${n++}`); await repo.initRepo(); seed.invalidateOverlay(); appStore.update({ activeProfile: null }); }
const ctxFor = (pid, params = {}) => ({ pid, date: todayKey(), path: '/progress/trends', query: {}, params, onCleanup: () => {}, navigate: async () => true, replace: async () => true, back: () => {}, close: () => {} });
const text = async (p) => (await fetch(new URL(p, new URL('../', import.meta.url)))).text();
const tab = (root, label) => [...root.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === label);
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const MT = [['height', 'Height', 'cm', 1, false], ['weight', 'Weight', 'kg', 2, false], ['bodyFat', 'Body fat', '%', 3, true], ['biceps', 'Biceps', 'cm', 4, false], ['thigh', 'Thigh', 'cm', 5, false], ['waist', 'Waist', 'cm', 6, false]]
  .map(([key, label, canonicalUnit, sortOrder, approx]) => ({ id: `mt:${key}`, key, label, canonicalUnit, decimals: 1, approx, v1: true, sortOrder }));
const T = '2026-10-01'; // a fixed Thursday-agnostic anchor; every rule below is checked against dates.js, never a weekday name
const keys = (from, to) => { const o = []; for (let k = from; k <= to; k = addDays(k, 1)) o.push(k); return o; };
const fl = (date, protein, kcal = 500) => ({ date, totals: { kcal, protein, carbs: 10, fat: 5, fiber: null } });

describe('A6 metrics model (FR-038, DAT-009)', () => {
  it('no data is null, never 0: empty days stay null for every bar metric', ['DAT-009', 'FR-038'], () => {
    const ks = keys(addDays(T, -6), T);
    for (const m of METRICS.filter((x) => x.kind === 'bar')) { const { values } = dailyValues(m, ks, {}); assert.eq(values.length, 7); assert.ok(values.every((v) => v.value === null), `${m.id} has a zero`); }
  });
  it('a logged zero is kept as 0 (steps 0, water 0) and is not confused with no data', ['DAT-009'], () => {
    const ks = [addDays(T, -1), T];
    const d = dailyValues(metricById('steps'), ks, { days: [{ date: T, steps: { count: 0 } }] }).values; assert.eq(d[0].value, null); assert.eq(d[1].value, 0);
    const w = dailyValues(metricById('water'), ks, { days: [{ date: T, water: { glasses: 0, glassMl: 500, ml: 0 } }] }).values; assert.eq(w[1].value, 0); assert.eq(w[0].value, null);
  });
  it('calories sum a day; protein skips entries without protein and counts the day as partial', ['FR-038'], () => {
    const ks = [T];
    const c = dailyValues(metricById('calories'), ks, { foodLogs: [fl(T, 20, 400), fl(T, null, 300)] }).values[0].value; assert.eq(c, 700);
    const p = dailyValues(metricById('protein'), ks, { foodLogs: [fl(T, 20), fl(T, null)] }); assert.eq(p.values[0].value, 20); assert.eq(p.partialDays, 1);
    const none = dailyValues(metricById('protein'), ks, { foodLogs: [fl(T, null)] }); assert.eq(none.values[0].value, null, 'no protein value anywhere = no data');
  });
  it('water uses glasses x glass size in litres; sleep is hours from minutes', ['FR-028'], () => {
    const ks = [T];
    assert.near(dailyValues(metricById('water'), ks, { days: [{ date: T, water: { glasses: 5, glassMl: 500, ml: null } }] }).values[0].value, 2.5);
    assert.near(dailyValues(metricById('sleep'), ks, { sleeps: [{ date: T, durationMin: 450 }] }).values[0].value, 7.5);
  });
  it('workout metrics skip Rest and Not started sessions (D-071) and average same-day sessions', ['FR-038'], () => {
    const ks = [T, addDays(T, -1), addDays(T, -2)];
    const w = [{ date: T, isRest: false, completionPct: 70, kcalTotal: 100.4 }, { date: T, isRest: false, completionPct: 80, kcalTotal: 50 },
      { date: addDays(T, -1), isRest: true, completionPct: null, kcalTotal: null }, { date: addDays(T, -2), isRest: false, completionPct: null, kcalTotal: null }];
    const pct = dailyValues(metricById('workout'), ks, { workouts: w }).values; assert.eq(pct[0].value, 75); assert.eq(pct[1].value, null); assert.eq(pct[2].value, null);
    const kc = dailyValues(metricById('exercise-kcal'), ks, { workouts: w }).values; assert.eq(kc[0].value, 150);
  });
  it('averages use days with data only and report n of N', ['FR-038', 'DAT-009'], () => {
    const o = overall([{ value: 10 }, { value: null }, { value: 20 }, { value: null }]); assert.eq(o.avg, 15); assert.eq(o.n, 2); assert.eq(o.N, 4);
    assert.eq(overall([{ value: null }]).avg, null);
  });
});

describe('A6 periods, weeks and targets (FR-038, FR-016)', () => {
  it('Week = 7 days, Month = 30 days ending today', ['FR-038'], () => {
    const w = periodRange('week', T); assert.eq(w.keys.length, 7); assert.eq(w.to, T); assert.eq(w.keys[0], addDays(T, -6));
    const m = periodRange('month', T); assert.eq(m.keys.length, 30); assert.eq(m.weekly, false);
  });
  it('3 Months = 13 calendar weeks that start on the chosen week-start day, for each setting', ['FR-038'], () => {
    for (const ws of ['mon', 'sun', 'sat']) {
      const r = periodRange('3m', T, ws); assert.ok(r.weekly); assert.eq(r.from, addDays(weekStart(T, ws), -84)); assert.eq(weekStart(r.from, ws), r.from);
      assert.eq(weeklyBuckets(r.keys, ws, T).length, 13, `13 weeks for ${ws}`);
    }
  });
  it('weekly buckets follow the setting; the running week is "so far"; a partial first week is flagged', ['FR-038'], () => {
    const ks = keys(addDays(T, -29), T);
    for (const ws of ['mon', 'sun', 'sat']) {
      const b = weeklyBuckets(ks, ws, T);
      for (const x of b.slice(1)) assert.eq(weekStart(x.date, ws), x.date, 'full weeks start on the setting');
      assert.eq(b[0].startsMidWeek, weekStart(ks[0], ws) !== ks[0]);
      assert.eq(b.filter((x) => x.soFar).length, weekStart(T, ws) === T ? 0 : 1);
      assert.eq(b.reduce((a, x) => a + x.keys.length, 0), 30, 'every day lands in exactly one week');
    }
  });
  it('bucket averages skip no-data days and say n of N; an empty week is null, not 0', ['FR-038', 'DAT-009'], () => {
    const ks = keys(addDays(T, -13), T); const vals = ks.map((k, i) => ({ date: k, value: i < 7 ? null : (i % 2 ? 100 : null) }));
    const b = bucketAverages(vals, weeklyBuckets(ks, 'mon', T), 0);
    assert.ok(b.some((x) => x.value === null && x.n === 0), 'a week with nothing is null');
    for (const x of b) { if (x.value !== null) { assert.ok(x.n > 0 && x.n <= x.N); assert.eq(x.value, 100); } }
  });
  it('targets are effective-dated: the line is the target now in force and "changed" is flagged', ['FR-016', 'DAT-030'], () => {
    const hist = [{ from: '2000-01-01', kcal: 2100, waterMl: 3000, steps: 7000 }, { from: addDays(T, -5), kcal: 1900, waterMl: 2500, steps: 8000 }];
    const ks = keys(addDays(T, -29), T);
    const k = targetFor(hist, ks, metricById('calories')); assert.eq(k.value, 1900); assert.ok(k.changed);
    const w = targetFor(hist, ks, metricById('water')); assert.near(w.value, 2.5, 1e-9, 'millilitres shown as litres');
    const same = targetFor(hist, keys(addDays(T, -2), T), metricById('calories')); assert.eq(same.value, 1900); assert.ok(!same.changed);
    assert.eq(targetFor(hist, ks, metricById('sleep')).value, null, 'sleep has no target in V1 (C-021)');
    assert.eq(targetFor([], ks, metricById('calories')).value, null);
  });
  it('target comparison is neutral wording, never "over", "failed" or "good" (D-057)', ['UX-013'], () => {
    const m = metricById('calories');
    assert.eq(compareToTarget(2100, 1900, m), '200 kcal above target'); assert.eq(compareToTarget(1500, 1900, m), '400 kcal below target'); assert.eq(compareToTarget(1900, 1900, m), 'On target');
    assert.eq(compareToTarget(null, 1900, m), null); assert.eq(compareToTarget(1500, null, m), null);
    assert.eq(fmtAverage(m, null), '\u2014');
  });
});

describe('A6 notes model (FR-036)', () => {
  const days = [{ date: '2026-09-02', note: { text: 'a', tags: ['travel'] } }, { date: '2026-10-01', note: { text: ' ', tags: [] } }, { date: '2026-09-20', note: { text: '', tags: ['travel', 'busy'] } }, { date: '2026-08-30', note: null }, { date: '2026-10-02', note: { text: 'last', tags: [] } }];
  it('collects only days with text or tags, newest first', ['FR-036'], () => { assert.deepEq(collectNotes(days).map((x) => x.date), ['2026-10-02', '2026-09-20', '2026-09-02']); });
  it('tag counts, filter and month grouping', ['FR-036'], () => {
    const ns = collectNotes(days); assert.deepEq(tagCounts(ns), [{ tag: 'travel', count: 2 }, { tag: 'busy', count: 1 }]);
    assert.eq(filterNotes(ns, 'travel').length, 2); assert.eq(filterNotes(ns, null).length, 3); assert.eq(filterNotes(ns, 'nope').length, 0);
    assert.deepEq(groupByMonth(ns).map((g) => [g.label, g.notes.length]), [['October 2026', 1], ['September 2026', 2]]);
  });
});

describe('A6 screens (UI level)', () => {
  async function setup() { await fresh(); seed.setSeedData({ measurementTypes: MT }); // own measurement types: other suites leave a smaller list behind
    const p = await repo.createProfile('Tester'); appStore.update({ activeProfile: p.id }); return p.id; }
  it('WeeklyBars: null weeks are marks not bars; the text says weeks; the table has n of N', ['UX-016', 'DAT-009'], () => {
    const b = [{ date: '2026-09-07', value: 100, n: 3, N: 7, soFar: false }, { date: '2026-09-14', value: null, n: 0, N: 7, soFar: false }, { date: '2026-09-21', value: 120, n: 7, N: 7, soFar: true }];
    const el = WeeklyBars({ title: 'Steps, weekly average', buckets: b, unit: 'steps' });
    assert.eq(el.querySelectorAll('.bar').length, 2); assert.eq(el.querySelectorAll('.nodata-mark').length, 1);
    assert.ok(/2 of 3 weeks have data/.test(el.querySelector('svg').getAttribute('aria-label')));
    assert.ok(/10 of 21 days with data/.test(el.textContent));
    [...el.querySelectorAll('button')].find((x) => /table/.test(x.textContent)).click();
    assert.ok(el.querySelector('table') && /3 of 7/.test(el.querySelector('table').textContent) && /so far/.test(el.querySelector('table').textContent));
  });
  it('Trends with no data: every metric shows "Not enough data yet" with an action, nothing is plotted', ['FR-038', 'DAT-009'], async () => {
    const pid = await setup();
    for (const m of METRICS) {
      const el = await trendsScreen(ctxFor(pid, { metric: m.id })); document.body.appendChild(el);
      assert.ok(/Not enough data yet/.test(el.textContent), m.id); assert.eq(el.querySelectorAll('.bar, .dot').length, 0, m.id); assert.ok(el.querySelector('.empty-state a[href^="#/"]'), `${m.id} action`);
      el.remove();
    }
  });
  it('Trends with data: n of N, no zero bars, aria summary, table toggle, tab switch, neutral wording', ['FR-038', 'FR-028', 'UX-016', 'UX-013'], async () => {
    const pid = await setup(); const today = todayKey();
    for (let i = 0; i < 10; i += 2) await repo.setSteps(pid, addDays(today, -i), 5000 + i * 100);
    await repo.setTargets(pid, { kcal: 1900, protein: 120, carbs: 220, fat: 60, fiber: 25, waterMl: 3000, steps: 7000 });
    const el = await trendsScreen(ctxFor(pid, { metric: 'steps' })); document.body.appendChild(el);
    assert.eq(el.querySelectorAll('.trends-body .bar').length, 5); assert.ok(/5 of 30 days/.test(el.textContent), 'month default: n of N');
    assert.ok([...el.querySelectorAll('.bar')].every((r) => parseFloat(r.getAttribute('height')) > 0));
    assert.ok(/days have data/.test(el.querySelector('.chart-svg').getAttribute('aria-label')));
    assert.ok(/below target/.test(el.textContent) && !/\bover\b/i.test(el.querySelector('.trend-stats').textContent));
    tab(el, 'Week').click(); await wait(); assert.ok(/of 7 days/.test(el.textContent), 'week view counts 7 days');
    tab(el, '3 Months').click(); await wait(); assert.ok(/weeks have data/.test(el.querySelector('.chart-svg').getAttribute('aria-label')));
    [...el.querySelectorAll('button')].find((x) => /table/.test(x.textContent)).click(); assert.ok(el.querySelector('.chart-card table'));
    el.remove();
  });
  it('Trends: body metrics are line charts, trend only with 5+ readings, body fat is badged approximate', ['FR-038', 'UX-016'], async () => {
    const pid = await setup(); const today = todayKey();
    for (let i = 0; i < 4; i++) await repo.addMeasurement(pid, { typeId: 'mt:weight', date: addDays(today, -i * 3), value: 75 - i * 0.2 });
    await repo.addMeasurement(pid, { typeId: 'mt:bodyFat', date: today, value: 22 });
    let el = await trendsScreen(ctxFor(pid, { metric: 'weight' })); document.body.appendChild(el);
    assert.eq(el.querySelectorAll('.dot').length, 4); assert.eq(el.querySelectorAll('.trend-line').length, 0, '4 readings: no trend'); el.remove();
    await repo.addMeasurement(pid, { typeId: 'mt:weight', date: addDays(today, -12), value: 75.5 });
    el = await trendsScreen(ctxFor(pid, { metric: 'weight' })); document.body.appendChild(el); assert.eq(el.querySelectorAll('.trend-line').length, 1, '5 readings: trend'); el.remove();
    el = await trendsScreen(ctxFor(pid, { metric: 'body-fat' })); document.body.appendChild(el); assert.ok(el.querySelector('.chip-est') && /approx/.test(el.textContent)); el.remove();
  });
  it('Trends reads only the active profile', ['FR-001', 'DAT-021'], async () => {
    const a = await setup(); const b = (await repo.createProfile('Other')).id; const today = todayKey();
    await repo.setSteps(b, today, 9999);
    const el = await trendsScreen(ctxFor(a, { metric: 'steps' })); assert.ok(/Not enough data yet/.test(el.textContent));
  });
  it('an unknown metric id is Not found, not a crash', ['UX-010'], async () => {
    const pid = await setup(); let threw = null; try { await trendsScreen(ctxFor(pid, { metric: 'bogus' })); } catch (e) { threw = e; }
    assert.ok(threw && /NotFound/i.test(threw.name || threw.constructor.name));
  });
  it('Notes list: newest first, tag filter, empty state, text stays text', ['FR-036', 'UX-003'], async () => {
    const pid = await setup(); const today = todayKey();
    let el = await notesScreen(ctxFor(pid)); assert.ok(/No notes/.test(el.textContent) && el.querySelector('a[href="#/today"]'));
    await repo.setDayNote(pid, addDays(today, -3), { text: '<b>old</b> note', tags: ['travel'] }); await repo.setDayNote(pid, today, { text: 'new', tags: ['busy', 'travel'] });
    el = await notesScreen(ctxFor(pid)); document.body.appendChild(el);
    const cards = [...el.querySelectorAll('.note-card')]; assert.eq(cards.length, 2); assert.ok(/new/.test(cards[0].textContent)); assert.eq(el.querySelectorAll('.note-card b').length, 0, 'no markup from note text');
    assert.eq(cards[0].getAttribute('href'), '#/today');
    [...el.querySelectorAll('button.chip')].find((b) => /^busy/.test(b.textContent)).click(); assert.eq(el.querySelectorAll('.note-card').length, 1);
    assert.ok(/1 of 2 notes tagged busy/.test(el.textContent)); el.remove();
  });
  it('estimate popover shifts back inside a narrow screen', ['NFR-011'], () => {
    const wrap = document.createElement('span'); wrap.className = 'est-wrap'; const pop = document.createElement('span'); pop.className = 'est-pop'; wrap.appendChild(pop);
    const host = document.createElement('div'); host.appendChild(wrap); document.body.appendChild(host);
    pop.getBoundingClientRect = () => ({ left: 300, right: 540, top: 0, bottom: 10, width: 240, height: 10 });
    assert.eq(fitPopover(pop, 360), 360 - 8 - 540); host.remove();
  });
});

describe('A6 source rules (NFR-013, DEP-006, FR-020)', () => {
  it('registers /progress/trends, /progress/trends/:metric and /progress/notes', ['UX-010'], async () => {
    const s = await text('js/features/analytics/register.js');
    for (const p of ["'/progress/trends'", "'/progress/trends/:metric'", "'/progress/notes'"]) assert.ok(s.includes(p), p);
    assert.ok(/root: 'progress'/.test(s));
  });
  it('no innerHTML, style attributes, toISOString, network, eval, absolute URLs, native append or weekday words in the A6 files', ['NFR-013', 'DEP-006', 'FR-020', 'QA-010'], async () => {
    const FILES = ['register.js', 'screens-w3.css', 'metrics.js', 'load.js', 'trend-chart.js', 'trends.js', 'notes-model.js', 'notes.js', 'popover-fit.js'].map((f) => `js/features/analytics/${f}`);
    const by = {}; for (const f of FILES) by[f] = await text(f);
    const bad = []; const chk = (re, why) => { for (const [f, t] of Object.entries(by)) { const code = f.endsWith('.css') ? t : t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); if (re.test(code)) bad.push(`${why}: ${f}`); } };
    chk(/\.innerHTML|insertAdjacentHTML|outerHTML/, 'innerHTML'); chk(/\bstyle\s*:\s*['"`{]|setAttribute\(\s*['"]style['"]|\bstyle=/, 'style attribute'); chk(/toISOString/, 'toISOString');
    chk(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|\beval\(|new Function/, 'network or eval'); chk(/https?:\/\//, 'absolute URL'); chk(/localStorage|sessionStorage|indexedDB/, 'direct storage');
    for (const [f, t] of Object.entries(by)) if (!f.endsWith('.css') && /(^|[^.\w])\w+\.append\(/.test(t.replace(/add\(host/g, ''))) { if (/\bhost\.append\(|\bel\.append\(/.test(t)) bad.push(`native append: ${f}`); }
    assert.deepEq(bad, []);
    assert.deepEq(scanForWeekdays(by, []), [], 'no weekday words');
    for (const [f, t] of Object.entries(by)) if (f.endsWith('.js')) assert.ok(!/from '\.\.?\/[^']*[^s]'/.test(t.replace(/\.js'/g, "s'")) || true);
    for (const [f, t] of Object.entries(by)) for (const m of t.matchAll(/from '(\.[^']+)'/g)) assert.ok(m[1].endsWith('.js'), `${f} import ${m[1]} needs .js`);
  });
  it('CSS uses tokens only: no hex or rgb colours', ['NFR-011'], async () => {
    const css = await text('js/features/analytics/screens-w3.css'); assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css));
  });
});
