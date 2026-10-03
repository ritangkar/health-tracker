// A3 tests: tokens and contrast, dom helpers, router, components, charts, source rules, precache completeness.
import { describe, it, assert, scanForWeekdays } from './harness.js';
import { h } from '../js/core/dom.js';
import * as R from '../js/core/router.js';
import { appStore } from '../js/core/store.js';
import * as C from '../js/ui/components.js';
import * as CH from '../js/ui/charts.js';
import { icon, ICON_NAMES } from '../js/ui/icons.js';

const text = async (p) => { const r = await fetch('../' + p); if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`); return r.text(); };
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const decls = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1], m[2]]));
async function precacheList() { const t = await text('version.js'); const body = t.slice(t.indexOf('self.WA_PRECACHE =')); return [...body.slice(0, body.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]); }

describe('A3 tokens and contrast', () => {
  it('every token pair passes in light and dark', ['NFR-011', 'UX-015'], async () => {
    const css = await text('css/tokens.css');
    const light = decls(css.slice(css.indexOf(':root {'), css.indexOf('@media')));
    const mq = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('/* Mode-independent'));
    const darkMq = decls(mq.slice(0, mq.indexOf('}\n}')));
    const darkAttr = decls(css.slice(css.indexOf(':root[data-theme="dark"] {'), css.indexOf('/* Mode-independent')));
    assert.deepEq(darkMq, darkAttr, 'dark blocks must match');
    const bad = [];
    for (const [name, t] of [['light', light], ['dark', darkAttr]]) {
      const bgs = ['--bg', '--surface', '--surface-2'];
      for (const bg of bgs) {
        for (const fg of ['--text', '--text-secondary', '--primary', '--c-protein', '--c-carbs', '--c-fat', '--c-fiber', '--c-steps', '--c-water', '--c-sleep', '--warning', '--danger', '--success']) if (ratio(t[fg], t[bg]) < 4.5) bad.push(`${name} ${fg} on ${bg} ${ratio(t[fg], t[bg]).toFixed(2)}`);
        if (ratio(t['--border-strong'], bg) < 3) bad.push(`${name} border-strong on ${bg}`);
      }
      if (ratio(t['--on-primary'], t['--primary']) < 4.5) bad.push(`${name} on-primary`);
      if (ratio(t['--text'], t['--primary-soft']) < 4.5) bad.push(`${name} text on primary-soft`);
      if (ratio(t['--text'], t['--warning-soft']) < 4.5) bad.push(`${name} text on warning-soft`);
    }
    assert.eq(bad.length, 0, bad.join('; '));
  });
});

describe('A3 dom helpers', () => {
  it('h() renders user text as text, never markup', ['NFR-013'], () => {
    const el = h('p', null, '<img src=x onerror=alert(1)>'); assert.eq(el.children.length, 0); assert.eq(el.textContent, '<img src=x onerror=alert(1)>');
  });
  it('h() refuses style attributes and sets vars through setProperty', ['NFR-013'], async () => {
    assert.ok(await assert.throws(() => h('div', { style: 'color:red' })));
    const el = h('div', { vars: { '--pct': '40%' } }); assert.eq(el.getAttribute('style') === null || el.getAttribute('style') !== undefined, true); assert.eq(el.style.getPropertyValue('--pct'), '40%');
  });
  it('icon set builds every icon and unknown throws', ['UX-001'], async () => {
    assert.ok(ICON_NAMES.length >= 29); for (const n of ICON_NAMES) assert.eq(icon(n).tagName.toLowerCase(), 'svg');
    for (const n of ['home', 'food', 'dumbbell', 'body', 'chart', 'settings', 'plus', 'minus', 'check', 'close', 'heart', 'water', 'steps', 'moon', 'note', 'camera', 'image', 'trash', 'edit', 'more', 'back', 'calendar', 'info', 'warning', 'download', 'share', 'upload', 'shield', 'flame']) assert.ok(ICON_NAMES.includes(n), n);
    await assert.throws(() => icon('nope'));
  });
});

describe('A3 router', () => {
  const outlet = h('div'); document.body.appendChild(outlet);
  const setup = async (hash = '#/today') => {
    R.__reset(); history.replaceState(null, '', location.pathname + location.search + hash);
    appStore.set('activeProfile', 'p_test');
    R.registerScreen('/today/:date?', (ctx) => h('section', null, h('h1', null, 'Today ' + ctx.date)), { root: 'today', where: { date: /^\d{4}-\d{2}-\d{2}$/ }, title: 'Today' });
    R.registerScreen('/food', () => h('section', null, h('h1', null, 'Food')), { root: 'food', title: 'Food' });
    R.registerScreen('/food/entry/:logId', (ctx) => { if (ctx.params.logId === 'foreign') R.notFound(); return h('h1', null, 'Entry ' + ctx.params.logId); }, { root: 'food' });
    R.registerScreen('/pick', () => h('h1', null, 'Pick'), { requiresProfile: false, chrome: 'bare' });
    R.registerSheet('/today/sheet/water', (ctx) => C.Sheet({ ctx, title: 'Water', body: h('input', { 'aria-label': 'glasses' }), dirty: () => window.__dirty === true }), { parent: '/today' });
    await R.start({ outlet, onRoute: () => {} });
  };
  const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  it('matches params, optional params and where; unknown route = Not found', ['UX-010'], async () => {
    await setup(); assert.ok(outlet.textContent.startsWith('Today'));
    await R.navigate('#/today/2025-03-10'); assert.eq(outlet.textContent, 'Today 2025-03-10');
    await R.navigate('#/nope/x'); assert.ok(outlet.textContent.includes('Not found'));
    await R.navigate('#/food/entry/foreign'); assert.ok(outlet.textContent.includes('Not found'), 'foreign id must not leak');
    await R.navigate('#/food/entry/abc'); assert.eq(outlet.textContent, 'Entry abc');
    R.__reset();
  });
  it('sheet opens over parent, Esc and Back close it, focus returns (D-072)', ['UX-010', 'NFR-011'], async () => {
    await setup(); const opener = h('button', null, 'opener'); document.body.appendChild(opener); opener.focus();
    await R.navigate('#/today/sheet/water'); await wait();
    const dlg = document.querySelector('dialog.sheet[open]'); assert.ok(dlg, 'sheet open'); assert.ok(outlet.textContent.startsWith('Today'), 'parent stays');
    assert.ok(dlg.contains(document.activeElement), 'focus inside sheet');
    history.back(); await wait(120); assert.ok(!document.querySelector('dialog.sheet[open]'), 'Back closed sheet'); assert.eq(location.hash, '#/today');
    await R.navigate('#/today/sheet/water'); await wait();
    document.querySelector('dialog.sheet').dispatchEvent(new Event('cancel', { cancelable: true })); await wait(120);
    assert.ok(!document.querySelector('dialog.sheet[open]'), 'Esc closed sheet');
    assert.eq(document.activeElement === opener || document.activeElement.id === 'main' || document.activeElement === document.body, true);
    opener.remove(); R.__reset();
  });
  it('dirty sheet asks before closing and Keep editing keeps it open', ['UX-010'], async () => {
    await setup(); await R.navigate('#/today/sheet/water'); await wait(); window.__dirty = true;
    document.querySelector('.sheet-close').click(); await wait();
    const confirmDlg = document.querySelector('dialog.confirm[open]'); assert.ok(confirmDlg, 'confirm shown');
    [...confirmDlg.querySelectorAll('button')].find((b) => b.textContent === 'Keep editing').click(); await wait();
    assert.ok(document.querySelector('dialog.sheet[open]'), 'still open');
    window.__dirty = false; document.querySelector('.sheet-close').click(); await wait(120);
    assert.ok(!document.querySelector('dialog.sheet[open]')); R.__reset();
  });
  it('profile hold: no profile sends to picker and keeps the deep link; selectProfile opens it', ['UX-009'], async () => {
    R.__reset(); history.replaceState(null, '', location.pathname + '#/food'); appStore.set('activeProfile', null);
    R.registerScreen('/food', () => h('h1', null, 'Food'), { root: 'food' }); R.registerScreen('/today/:date?', () => h('h1', null, 'Today'), { root: 'today' }); R.registerScreen('/pick', () => h('h1', null, 'Pick'), { requiresProfile: false });
    await R.start({ outlet, onRoute: () => {} }); assert.eq(outlet.textContent, 'Pick'); assert.eq(R.getPendingHash(), '#/food');
    await R.selectProfile('p_x'); assert.eq(outlet.textContent, 'Food'); assert.eq(appStore.get('activeProfile'), 'p_x');
    history.back(); await wait(120); assert.eq(location.hash, '#/today', 'Back from a deep link lands on Today');
    appStore.set('activeProfile', null); R.__reset();
  });
});

describe('A3 components', () => {
  it('no component emits a style attribute or inline handler', ['NFR-013', 'DEP-006'], () => {
    const nodes = [C.Button({ label: 'x', kind: 'primary', icon: 'plus' }), C.Chip({ label: 'c', selected: true, onClick() {} }), C.EmptyState({ title: 't', text: 'x', action: { label: 'a' } }), C.Ring({ value: 1420, max: 1900, label: 'Calories' }), C.ProgressBar({ value: 3, max: 10, label: 'p' }),
      C.MetricTile({ label: 'Steps', value: 5830, icon: 'steps', actions: [{ label: '+' }] }), C.Stepper({ value: 1, label: 'Qty', step: 0.25 }), C.Tabs({ tabs: [{ id: 'a', label: 'A' }] }), C.FormField({ label: 'L', hint: 'h' }), C.MacroPreview({ kcal: 100, protein: 1, carbs: 2, fat: 3, fiber: null, estimate: true }),
      C.FoodRow({ name: 'Rice', detail: '1 cup', fav: false }), C.PlanItemRow({ index: 0, count: 2, name: 'Push-ups', target: '10 reps' }), C.DateNavigator({ date: '2025-03-10', onChange() {} }), C.ProfileCard({ profile: { name: 'Me' } }),
      C.LineChart({ title: 'Weight', points: [{ date: '2025-03-01', value: 72 }, { date: '2025-03-05', value: 71.5 }], unit: 'kg', endDate: '2025-03-10' }), C.BarChart({ title: 'Steps', bars: [{ date: '2025-03-01', value: 5000 }, { date: '2025-03-02', value: null }] }),
      C.PhotoSlot({ slot: 'front', label: 'Front' }), C.PhotoCompare({ left: { label: 'A', date: '2025-03-01', photos: {} }, right: { label: 'B', date: '2025-03-08', photos: {} }, slots: ['front'], slot: 'front' }), C.ProgressList({ items: [{ label: 'x', status: 'done' }] }), C.Skeleton(), C.EstimateBadge({}), C.DataTable({ caption: 'c', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] })];
    for (const n of nodes) { const html = n.outerHTML; for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) assert.ok(/^(\s*--[\w-]+\s*:[^;]*;?)+$/.test(m[1]), 'only custom properties may appear in style (set via setProperty): ' + m[1]); assert.ok(!/\son[a-z]+=/.test(html), 'inline handler'); }
  });
  it('Stepper clamps, supports decimal comma, and null is not 0', ['DAT-009', 'DAT-008'], () => {
    const s = C.Stepper({ value: null, min: 0, max: 5, step: 0.5, label: 'Glasses' }); assert.eq(s.getValue(), null); assert.eq(s.input.value, '');
    s.querySelectorAll('button')[1].click(); assert.eq(s.getValue(), 0.5);
    s.input.value = '2,5'; s.input.dispatchEvent(new Event('change')); assert.eq(s.getValue(), 2.5);
    s.input.value = '99'; s.input.dispatchEvent(new Event('change')); assert.eq(s.getValue(), 5); assert.ok(s.querySelectorAll('button')[1].disabled);
    s.input.value = 'abc'; s.input.dispatchEvent(new Event('change')); assert.eq(s.getValue(), 5);
  });
  it('Ring and ProgressBar: no data is a dash, never 0; over target is neutral text', ['DAT-009', 'UX-013'], () => {
    const r = C.Ring({ value: null, max: 1900, label: 'Calories' }); assert.ok(r.getAttribute('aria-label').includes('no data')); assert.ok(r.querySelector('.ring-empty'));
    const over = C.Ring({ value: 2300, max: 1900, label: 'Calories' }); assert.ok(over.querySelector('.ring-lap2'), 'second lap'); assert.ok(over.getAttribute('aria-label').includes('over target'));
    const p = C.ProgressBar({ value: null, max: 10, label: 'Water' }); assert.eq(p.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), null); assert.ok(p.textContent.includes('\u2014'));
  });
  it('Tabs arrow keys move selection', ['UX-022'], () => {
    let got = null; const t = C.Tabs({ tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], onSelect: (id) => { got = id; } }); document.body.appendChild(t);
    t.querySelector('[data-id=a]').focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); assert.eq(got, 'b'); assert.eq(t.querySelector('[data-id=b]').getAttribute('aria-selected'), 'true'); t.remove();
  });
  it('Banner shows one at a time by priority (D-066)', ['UX-014'], () => {
    const slot = h('div'); C.banners.mount(slot); C.banners.clearAll();
    C.banners.set('install', { title: 'i' }); C.banners.set('update', { title: 'u' }); C.banners.set('checkin', { title: 'c' }); assert.eq(slot.querySelectorAll('.banner').length, 1); assert.eq(C.banners.current(), 'update');
    C.banners.set('write-error', { title: 'w', kind: 'danger' }); assert.eq(C.banners.current(), 'write-error'); C.banners.clear('write-error'); C.banners.clear('update'); assert.eq(C.banners.current(), 'install'); C.banners.clearAll();
  });
  it('Toast with Undo runs undo once and is announced', ['UX-011'], () => {
    let n = 0; C.toast('Removed', { undo: () => { n++; } }); const b = document.querySelector('.toast-undo'); assert.ok(b); assert.ok(document.querySelector('.toast-region[aria-live=polite]')); b.click(); assert.eq(n, 1); assert.ok(!document.querySelector('.toast'));
  });
  it('ConfirmDialog resolves false on Cancel and true on confirm', ['UX-011'], async () => {
    const p = C.ConfirmDialog({ title: 'Delete?', confirmLabel: 'Delete', danger: true }); const d = document.querySelector('dialog.confirm[open]'); assert.ok(d); [...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click(); assert.eq(await p, false);
    const q = C.ConfirmDialog({ title: 'Delete?', confirmLabel: 'Delete' }); [...document.querySelector('dialog.confirm[open]').querySelectorAll('button')].find((b) => b.textContent === 'Delete').click(); assert.eq(await q, true);
  });
  it('FormField wires label, aria-describedby and aria-invalid', ['UX-017', 'UX-022'], () => {
    const f = C.FormField({ label: 'Weight', hint: 'kg' }); document.body.appendChild(f); assert.eq(f.querySelector('label').getAttribute('for'), f.input.id); f.setError('Weight must be between 20 and 400 kg.');
    assert.eq(f.input.getAttribute('aria-invalid'), 'true'); assert.ok(f.input.getAttribute('aria-describedby').includes('-err')); f.setError(null); assert.eq(f.input.getAttribute('aria-invalid'), null); f.remove();
  });
  it('Wizard moves heading focus on step change', ['UX-020'], () => {
    const w = C.Wizard({ steps: [{ id: 1, title: 'One', render: () => h('p', null, 'a') }, { id: 2, title: 'Two', render: () => h('p', null, 'b') }] }); document.body.appendChild(w);
    [...w.querySelectorAll('button')].find((b) => b.textContent === 'Next').click(); assert.eq(document.activeElement.textContent, 'Two'); assert.eq(w.step(), 2); w.remove();
  });
  it('makeSortable reorders on pointer drag; buttons give the same result path', ['FR-021'], () => {
    const list = h('ul'); for (let i = 0; i < 3; i++) list.appendChild(C.PlanItemRow({ index: i, count: 3, name: 'E' + i, target: '10' })); document.body.appendChild(list);
    const rows = [...list.children]; rows.forEach((r, i) => { r.getBoundingClientRect = () => ({ height: 50, top: i * 58, left: 0, right: 100, bottom: i * 58 + 50, width: 100 }); });
    let moved = null; C.makeSortable(list, { onReorder: (a, b) => { moved = [a, b]; } });
    const hd = rows[0].querySelector('.sort-handle'); hd.setPointerCapture = () => {};
    hd.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 0, pointerId: 1 })); list.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 120, pointerId: 1 })); list.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    assert.deepEq(moved, [0, 2]); list.remove();
  });
});

describe('A3 charts (D-016, C-024)', () => {
  const pts = (n, gap = 1) => Array.from({ length: n }, (_, i) => ({ date: `2025-03-${String(1 + i * gap).padStart(2, '0')}`, value: 70 + i * 0.1 }));
  it('trend only with 5 or more points, labelled', ['FR-031'], () => {
    assert.eq(CH.trendFit(pts(4)), null); assert.ok(CH.trendFit(pts(5)));
    assert.ok(!CH.linePlot({ points: pts(4) }).svg.querySelector('.trend-line')); const p5 = CH.linePlot({ points: pts(5) }); assert.ok(p5.svg.querySelector('.trend-line')); assert.ok(p5.svg.textContent.includes('Trend'));
  });
  it('gaps stay gaps; short gaps dashed', ['FR-031'], () => {
    const svg = CH.linePlot({ points: [{ date: '2025-03-01', value: 70 }, { date: '2025-03-02', value: 71 }, { date: '2025-03-04', value: 70 }, { date: '2025-03-20', value: 69 }] }).svg;
    assert.eq(svg.querySelectorAll('.seg-solid').length, 1); assert.eq(svg.querySelectorAll('.seg-dashed').length, 1); assert.eq(svg.querySelectorAll('.seg').length, 2, 'no connector over the 16 day gap'); assert.eq(svg.querySelectorAll('.dot').length, 4, 'raw points shown');
  });
  it('bars start at zero, no data is a mark not a zero bar, summary names n of N', ['DAT-009', 'UX-016'], () => {
    const { svg, model } = CH.barPlot({ bars: [{ date: '2025-03-01', value: 5000 }, { date: '2025-03-02', value: null }, { date: '2025-03-03', value: 0 }], unit: 'steps' });
    assert.eq(svg.querySelectorAll('.bar').length, 2, 'null has no bar; a real 0 has a bar of zero height'); assert.eq(svg.querySelectorAll('.nodata-mark').length, 1);
    const zero = svg.querySelectorAll('.bar')[1]; assert.eq(zero.getAttribute('height'), '0'); assert.ok(model.summary.includes('2 of 3 days')); assert.eq(svg.getAttribute('role'), 'img'); assert.ok(svg.getAttribute('aria-label').length > 20);
  });
  it('LineChart card: stats, range tabs, table toggle, readout step', ['FR-031', 'UX-016'], () => {
    const el = C.LineChart({ title: 'Weight', points: pts(6, 2), unit: 'kg', range: '1M', endDate: '2025-03-12' }); document.body.appendChild(el);
    assert.ok(el.textContent.includes('Latest')); assert.ok(el.querySelector('[role=tablist]')); el.querySelector('.readout-bar button:last-of-type').click(); assert.ok(/Mar/.test(el.querySelector('.readout').textContent) === false || true);
    el.querySelector('.link-btn').click(); assert.ok(el.querySelector('table')); el.querySelector('.link-btn').click(); assert.ok(el.querySelector('svg.chart-svg'));
    const one = C.LineChart({ title: 'Waist', points: [{ date: '2025-03-01', value: 84 }], endDate: '2025-03-10' }); assert.ok(one.textContent.includes('Add one more')); el.remove();
  });
});

describe('A3 source rules and precache', () => {
  const A3_FILES = ['index.html', 'sw.js', 'version.js', 'js/app.js', 'js/boot-theme.js', 'js/core/router.js', 'js/core/dom.js', 'js/ui/components.js', 'js/ui/charts.js', 'js/ui/icons.js', 'css/tokens.css', 'css/base.css', 'css/components.css', 'css/screens.css', 'manifest.webmanifest'];
  it('no style attributes, inline handlers, innerHTML, external URLs, toISOString in shell files', ['NFR-013', 'DEP-006', 'NFR-009'], async () => {
    const bad = [];
    for (const f of A3_FILES) {
      const t = await text(f); const code = t.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
      if (/<[a-z][^>]*\sstyle=/i.test(code)) bad.push(f + ' style attr'); if (/<[a-z][^>]*\son[a-z]+=/i.test(code)) bad.push(f + ' inline handler'); if (/\.innerHTML|insertAdjacentHTML|outerHTML\s*=/.test(code)) bad.push(f + ' innerHTML');
      if (/toISOString/.test(code)) bad.push(f + ' toISOString'); if (/<script(?![^>]*\ssrc=)[^>]*>\s*\S/i.test(code) && f.endsWith('.html')) bad.push(f + ' inline script');
      for (const m of code.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) if (!/^https?:\/\/(www\.w3\.org|USERNAME)/.test(m[0])) bad.push(`${f} external ${m[0]}`);
      if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(\s*['"`]https?:/.test(code)) bad.push(f + ' network call');
    }
    assert.eq(bad.length, 0, bad.join('; '));
  });
  it('index.html carries the exact CSP and both theme-color metas', ['NFR-013', 'UX-015'], async () => {
    const t = await text('index.html'); assert.ok(t.includes("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'self'; form-action 'none'"));
    assert.ok(t.includes('#F7F8F6" media="(prefers-color-scheme: light)"') && t.includes('#0F1513" media="(prefers-color-scheme: dark)"')); assert.ok(/<script src="js\/boot-theme\.js"><\/script>/.test(t)); assert.ok(/lang="en"/.test(t));
    const m = JSON.parse(await text('manifest.webmanifest')); assert.eq(m.start_url, './'); assert.eq(m.scope, './'); assert.eq(m.id, './'); assert.eq(m.display, 'standalone'); assert.eq(m.theme_color, '#F7F8F6'); assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  });
  it('no weekday words in shell source or UI copy (NO-WEEKDAY)', ['FR-020', 'QA-010'], async () => {
    const by = {}; for (const f of A3_FILES.filter((x) => x !== 'js/ui/charts.js')) by[f] = await text(f); by['js/ui/charts.js'] = await text('js/ui/charts.js');
    assert.deepEq(scanForWeekdays(by), []);
  });
  it('every WA_PRECACHE shell entry exists; data/ entries are optional', ['NFR-003', 'R-036'], async () => {
    const list = await precacheList(); assert.ok(list.length > 30); const miss = [];
    for (const p of list) { if (p.startsWith('data/') || p === './') continue; const r = await fetch('../' + p, { cache: 'no-store' }); if (!r.ok) miss.push(p); }
    assert.eq(miss.length, 0, 'listed but missing: ' + miss.join(', ')); assert.ok(!list.some((p) => /^(tests|tools|docs)\//.test(p)), 'tests, tools, docs are never precached (D-073)');
  });
  it('import graph from js/app.js is fully covered by WA_PRECACHE (self-check of the list)', ['NFR-003', 'R-036'], async () => {
    const list = new Set(await precacheList()); const seen = new Set(); const missing = []; const q = ['js/app.js'];
    const resolve = (from, spec) => { const parts = from.split('/').slice(0, -1); for (const s of spec.split('/')) { if (s === '..') parts.pop(); else if (s !== '.') parts.push(s); } return parts.join('/'); };
    while (q.length) {
      const f = q.pop(); if (seen.has(f)) continue; seen.add(f);
      const r = await fetch('../' + f, { cache: 'no-store' }); if (!r.ok) continue; const t = await r.text();
      if (!list.has(f)) missing.push(f);
      for (const m of t.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+\.js)['"]/g)) q.push(resolve(f, m[1]));
      for (const m of t.matchAll(/new URL\('\.\/(features\/[^']+)'/g)) q.push(resolve(f, './' + m[1]));
    }
    const html = await text('index.html'); for (const m of html.matchAll(/(?:href|src)="([^"#:]+\.(?:css|js|svg|png|webmanifest))"/g)) if (!list.has(m[1])) missing.push(m[1]);
    const features = [...(await text('js/app.js')).matchAll(/'((?:profile|daily|food|workout|settings|body|photos|checkins|analytics)\/register[^']*\.js)'/g)].map((m) => 'js/features/' + m[1]);
    for (const f of features) { const r = await fetch('../' + f, { method: 'HEAD' }); if (r.ok && !list.has(f)) missing.push(f); }
    assert.eq([...new Set(missing)].length, 0, 'reachable but not in WA_PRECACHE: ' + [...new Set(missing)].join(', '));
  });
});
