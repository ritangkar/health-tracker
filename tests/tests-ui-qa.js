// A10 QA suite: UI, responsive and accessibility checks that can run without a real browser UI session.
// Static checks read repo files with fetch (tests/index.html is served from the repo root).
// Tests named "F-A10-nn" are OPEN FINDINGS: they fail on purpose until A12 fixes the app. Do not weaken them.
// To run: add 'tests-ui-qa.js' to SUITES in tests/harness.js (finding F-A10-14; A10 may not edit harness.js).
import { describe, it, assert } from './harness.js';
import { EstimateBadge } from '../js/ui/components.js';

const text = async (p) => { const r = await fetch('../' + p); if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`); return r.text(); };
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const decls = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1], m[2]]));
async function precacheList() { const t = await text('version.js'); const body = t.slice(t.indexOf('self.WA_PRECACHE =')); return [...body.slice(0, body.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]); }
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
async function shippedSources() {
  const list = (await precacheList()).filter((p) => /\.(js|css|html)$/.test(p) && !p.startsWith('data/'));
  const out = {}; for (const p of list) out[p] = await text(p); out['index.html'] = await text('index.html'); out['sw.js'] = await text('sw.js'); return out;
}

describe('A10 contrast (R-033)', () => {
  it('full token matrix, light and dark, text 4.5 and UI 3', ['NFR-011', 'UX-015'], async () => {
    const css = await text('css/tokens.css');
    const light = decls(css.slice(css.indexOf(':root {'), css.indexOf('@media')));
    const dark = decls(css.slice(css.indexOf(':root[data-theme="dark"] {'), css.indexOf('/* Mode-independent')));
    const hues = ['--text', '--text-secondary', '--primary', '--c-protein', '--c-carbs', '--c-fat', '--c-fiber', '--c-steps', '--c-water', '--c-sleep', '--warning', '--danger', '--success'];
    const bad = [];
    for (const [n, t] of [['light', light], ['dark', dark]]) {
      for (const bg of ['--bg', '--surface', '--surface-2']) {
        for (const fg of hues) if (ratio(t[fg], t[bg]) < 4.5) bad.push(`${n} ${fg} on ${bg} ${ratio(t[fg], t[bg]).toFixed(2)}`);
        if (ratio(t['--border-strong'], t[bg]) < 3) bad.push(`${n} border-strong on ${bg}`);
      }
      if (ratio(t['--on-primary'], t['--primary']) < 4.5) bad.push(`${n} on-primary`);
      for (const fg of ['--text', '--primary', '--text-secondary']) if (ratio(t[fg], t['--primary-soft']) < 4.5) bad.push(`${n} ${fg} on primary-soft`);
      for (const fg of ['--text', '--warning']) if (ratio(t[fg], t['--warning-soft']) < 4.5) bad.push(`${n} ${fg} on warning-soft`);
      // focus ring is --primary (base.css): must be 3:1 against bg, surface and surface-2 (the neighbours it sits on)
      for (const bg of ['--bg', '--surface', '--surface-2']) if (ratio(t['--primary'], t[bg]) < 3) bad.push(`${n} focus ring on ${bg}`);
    }
    assert.deepEq(bad, []);
  });
  it('focus ring is a 2 px solid outline with offset', ['UX-022'], async () => {
    const b = await text('css/base.css');
    assert.ok(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--primary\)/.test(b));
  });
  it('no hard-coded colours outside tokens.css in shipped CSS', ['NFR-011'], async () => {
    const hits = [];
    for (const p of ['css/base.css', 'css/components.css', 'css/screens.css', 'js/features/screens-w1.css', 'js/features/screens-w2.css', 'js/features/analytics/screens-w3.css']) {
      stripComments(await text(p)).split('\n').forEach((l, i) => { if (/#[0-9a-fA-F]{3,8}\b/.test(l)) hits.push(`${p}:${i + 1}`); });
    }
    assert.deepEq(hits, []);
  });
});

describe('A10 CSP and external requests (NFR-013, DEP-006)', () => {
  it('index.html carries the exact CSP directives', ['NFR-013'], async () => {
    const t = await text('index.html');
    const m = t.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/); assert.ok(m, 'CSP meta missing');
    const want = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "font-src 'self'", "base-uri 'self'", "form-action 'none'"];
    assert.deepEq(m[1].split(';').map((s) => s.trim()), want);
  });
  it('no http(s) URLs, eval, innerHTML, document.write or inline handlers in shipped code', ['DEP-006', 'NFR-013'], async () => {
    const bad = [];
    for (const [p, src] of Object.entries(await shippedSources())) {
      const code = stripComments(src);
      if (/https?:\/\//.test(code.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, ''))) bad.push(`${p}: url`);
      if (/\beval\s*\(|new Function\s*\(|document\.write|\.innerHTML\s*=|insertAdjacentHTML/.test(code)) bad.push(`${p}: unsafe api`);
      if (/\son[a-z]+\s*=\s*["']/.test(code) && p.endsWith('.html')) bad.push(`${p}: inline handler`);
      if (p.endsWith('.html') && /<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(code)) bad.push(`${p}: inline script`);
      if (p.endsWith('.html') && /\sstyle\s*=/.test(code)) bad.push(`${p}: style attribute`);
      if (p.endsWith('.js') && /setAttribute\(\s*['"]style['"]|\.cssText\s*=|\bstyle\s*:\s*['"`]/.test(code)) bad.push(`${p}: style attribute in JS`);
    }
    assert.deepEq(bad, []);
  });
  it('only the service worker and seed loader call fetch, all same-origin relative', ['NFR-013'], async () => {
    const hits = [];
    for (const [p, src] of Object.entries(await shippedSources())) { if (/\bfetch\s*\(/.test(stripComments(src))) hits.push(p); }
    assert.deepEq(hits.sort(), ['js/core/seed.js', 'sw.js']); // A12: app.js no longer pre-fetches feature files (F-A11-01)
  });
});

describe('A10 theme, manifest, motion (UX-015, NFR-015)', () => {
  it('theme-color metas, viewport-fit and boot-theme blocking order', ['UX-015'], async () => {
    const t = await text('index.html');
    assert.ok(/name="theme-color" content="#F7F8F6" media="\(prefers-color-scheme: light\)"/.test(t));
    assert.ok(/name="theme-color" content="#0F1513" media="\(prefers-color-scheme: dark\)"/.test(t));
    assert.ok(/viewport-fit=cover/.test(t));
    assert.ok(/<html lang="en">/.test(t));
    const bt = t.indexOf('js/boot-theme.js'), tk = t.indexOf('css/tokens.css');
    assert.ok(bt > 0 && bt < tk, 'boot-theme must load before tokens.css');
    assert.ok(!/<script[^>]*boot-theme[^>]*(defer|async|type="module")/.test(t), 'boot-theme must be blocking');
  });
  it('manifest values', ['NFR-003'], async () => {
    const m = JSON.parse(await text('manifest.webmanifest'));
    assert.eq(m.theme_color, '#F7F8F6'); assert.eq(m.background_color, '#F7F8F6');
    assert.eq(m.start_url, './'); assert.eq(m.scope, './'); assert.eq(m.id, './'); assert.eq(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  });
  it('reduced motion zeroes durations and animations; nothing over 300 ms; no looping animation', ['NFR-015'], async () => {
    const tok = await text('css/tokens.css');
    assert.ok(/prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--dur-1: 0ms; --dur-2: 0ms; --dur-3: 0ms/.test(tok));
    const comp = await text('css/components.css');
    assert.ok(/prefers-reduced-motion: reduce\)\s*\{\s*\.sheet, \.toast \{ animation: none/.test(comp));
    const all = [tok, comp, await text('css/screens.css'), await text('js/features/screens-w1.css'), await text('js/features/screens-w2.css'), await text('js/features/analytics/screens-w3.css')].join('\n');
    assert.ok(!/infinite/.test(all), 'looping animation');
    for (const m of all.matchAll(/(\d+)ms/g)) assert.ok(Number(m[1]) <= 300, `duration ${m[0]}`);
    for (const m of all.matchAll(/(\d*\.?\d+)s\b(?!\w)/g)) assert.ok(Number(m[1]) <= 0.3, `duration ${m[0]}`);
  });
});

describe('A10 precache completeness (R-036)', () => {
  it('every WA_PRECACHE file exists, no duplicates, tests/tools/docs excluded', ['NFR-003', 'DEP-008'], async () => {
    const list = (await precacheList()).filter((p) => p !== './');
    assert.eq(new Set(list).size, list.length, 'duplicates');
    for (const p of list) { assert.ok(!/^(tests|tools|docs)\//.test(p), `excluded dir listed: ${p}`); const r = await fetch('../' + p); assert.ok(r.ok, `missing ${p}`); }
  });
  it('every relative import and dynamic import in a listed module is itself listed', ['NFR-003'], async () => {
    const list = await precacheList(); const set = new Set(list); const bad = [];
    for (const p of list.filter((x) => x.endsWith('.js') && !x.startsWith('data/'))) {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      const src = stripComments(await text(p));
      for (const m of src.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const parts = (dir ? dir.split('/') : []); for (const seg of m[1].split('/')) { if (seg === '.' || seg === '') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
        const target = parts.join('/'); if (!set.has(target)) bad.push(`${p} -> ${target}`);
      }
    }
    assert.deepEq(bad, []);
  });
  it('seed manifest files exist and WA_SEED_VERSION equals seedVersion', ['DAT-010'], async () => {
    const man = JSON.parse(await text('data/seed-manifest.json')); const v = await text('version.js');
    assert.eq(Number(v.match(/WA_SEED_VERSION\s*=\s*(\d+)/)[1]), man.seedVersion);
    for (const f of man.files) { const r = await fetch('../data/' + (f.path || f)); assert.ok(r.ok, `seed file ${f.path || f}`); }
  });
});

describe('A10 wording (D-055, D-057)', () => {
  it('exact privacy and backup warning texts are present', ['UX-009', 'DAT-028'], async () => {
    assert.ok((await text('js/features/profile/picker.js')).includes('There is no PIN in this version. Anyone who can open this app on this device can open either profile. Use your phone screen lock.'));
    assert.ok((await text('js/features/settings/backup-screen.js')).includes('This file contains both profiles and all photos. It is not encrypted. Keep it somewhere private.'));
  });
  it('no shaming words and no red colour on over-target or measurement change', ['UX-013'], async () => {
    const bad = [];
    for (const [p, src] of Object.entries(await shippedSources())) {
      if (!p.startsWith('js/features/') && p !== 'js/app.js') continue;
      stripComments(src).split('\n').forEach((l, i) => { const strs = [...l.matchAll(/'([^']{4,})'|`([^`]{4,})`/g)].map((m) => m[1] || m[2]).join(' '); if (/\b(cheat|lazy|you missed|streak|too much|guilt|shame|blown|behind schedule)\b/i.test(strs)) bad.push(`${p}:${i + 1}`); });
    }
    assert.deepEq(bad, []);
    const comp = await text('css/components.css');
    assert.ok(!/\.is-over[^{]*\{[^}]*(--danger|red)/.test(comp), 'over-target must not use danger colour');
  });
});

describe('A10 accessibility structure', () => {
  it('dialogs are native <dialog> opened with showModal (focus trap, Esc, inert background)', ['UX-022'], async () => {
    const c = await text('js/ui/components.js'); assert.ok(/createElement\('dialog'\)|h\('dialog'/.test(c)); assert.ok(/showModal\(\)/.test(c));
  });
  it('router announces route changes through the live region and focuses the main heading', ['UX-018'], async () => {
    const r = await text('js/core/router.js') + await text('js/core/dom.js'); assert.ok(/aria-live|announce/.test(r)); assert.ok(/focus/.test(r));
  });
  it('EstimateBadge is a keyboard button with expanded state and popover', ['UX-008'], () => {
    const el = EstimateBadge({ kind: 'est' }); const btn = el.querySelector('button');
    assert.eq(btn.tagName, 'BUTTON'); assert.eq(btn.getAttribute('aria-expanded'), 'false'); assert.ok(btn.getAttribute('aria-controls'));
  });
});

describe('A10 OPEN FINDINGS (red until A12 fixes)', () => {
  it('F-A10-05 estimate badge accessible name says "estimate" and has no double full stop', ['UX-008'], () => {
    const n = EstimateBadge({ kind: 'est' }).querySelector('button').getAttribute('aria-label');
    assert.ok(/estimate/i.test(n), `name was "${n}"`); assert.ok(!/\.\./.test(n), `name was "${n}"`);
    const a = EstimateBadge({ kind: 'approx' }).querySelector('button').getAttribute('aria-label');
    assert.ok(/approximate/i.test(a), `name was "${a}"`); assert.ok(!/\.\./.test(a), `name was "${a}"`);
  });
  it('F-A10-04 import file input has an accessible name and is not an unnamed tab stop', ['UX-020', 'UX-022'], async () => {
    const src = await text('js/features/settings/import-wizard.js');
    const line = src.split('\n').find((l) => l.includes("type: 'file'")) || '';
    assert.ok(/aria-label|tabindex:\s*-1|tabIndex|hidden/.test(line), 'file input: add aria-label and tabindex -1 (the visible Choose backup file button is the control)');
  });
  it('F-A10-01 screen head wraps at large text (back link must not force horizontal scroll)', ['NFR-011', 'UX-022'], async () => {
    const css = (await text('css/screens.css')) + (await text('css/components.css'));
    const m = css.match(/\.screen-head\s*\{([^}]*)\}/);
    assert.ok(m && /flex-wrap:\s*wrap/.test(m[1]), '.screen-head needs flex-wrap: wrap');
  });
  it('F-A10-03 quick actions row shows a scroll affordance instead of a hidden scrollbar', ['UX-005'], async () => {
    const css = await text('js/features/screens-w1.css');
    assert.ok(!/\.quick-actions\s*\{[^}]*scrollbar-width:\s*none/.test(css), 'hidden scrollbar leaves Steps/Workout/Sleep/Note clipped at 360 px with no cue');
  });
});
