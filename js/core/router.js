// Hash router, route-backed sheets, Back rules (D-072), profile hold (D-042). No framework. (A3)
// Screens register themselves; nothing here needs editing to add a screen:
//   registerScreen('/food', (ctx) => node | {el, destroy} | Promise<either>, { root:'food', title:'Food', chrome:'shell'|'bare', requiresProfile:true, where:{date:/^\d{4}-\d{2}-\d{2}$/} })
//   registerSheet('/food/add', (ctx) => presentable, { parent:'/food' })    presentable = {el, open(), dispose()} (components.Sheet)
// Patterns: literal segments, ':name', and a final optional ':name?'. A route that returns false from `where` does not match.
// ctx: { path, query, params, hash, kind, pid, date, signal, onCleanup(fn), close({refresh}), navigate, replace, back }
//   ctx.date = date in the path (#/today/2025-03-10) or ?d=, if valid and in range, else today.
// Unregistered or unmatched routes show Not found. A factory can throw notFound() for a missing/foreign id.
import { appStore } from './store.js';
import { h, clear, focusHeading, announce, logError } from './dom.js';
import { todayKey, isInAllowedRange } from './dates.js';
import { sessionSet, sessionRemove, lsSet } from './storage-health.js';
import { invalidateOverlay } from './seed.js';

export const PRIMARY_ROOTS = ['today', 'food', 'workout', 'body', 'progress'];
export class NotFoundError extends Error { constructor(m = 'Not found') { super(m); this.name = 'NotFoundError'; } }
export const notFound = (m) => { throw new NotFoundError(m); };

let routes = [];
let host = null, outlet = null, started = false;
let idx = 0, curHash = '', pendingHash = null, guard = null, ignorePops = 0, token = 0;
let base = null;       // mounted screen {key, hash, destroy, cleanups, ac}
let sheet = null;      // open sheet {p, parentHash, cleanups, ac}
let cur = { path: '', query: {}, kind: null, root: null };
const lastRoute = {};
const listeners = new Set();

// ---------------------------------------------------------------- patterns and hashes
const seg = (p) => String(p).split('/').filter(Boolean);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export function parseHash(hash = location.hash) {
  let s = String(hash || '').replace(/^#/, '');
  const q = s.indexOf('?'); const query = {};
  if (q >= 0) { for (const part of s.slice(q + 1).split('&')) { if (!part) continue; const [k, v = ''] = part.split('='); query[dec(k)] = dec(v); } s = s.slice(0, q); }
  return { path: '/' + seg(s).map(dec).join('/'), query };
}
export function buildHash(path, query = {}) {
  const p = '/' + seg(path).map((x) => encodeURIComponent(dec(x))).join('/');
  const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return '#' + p + (qs ? '?' + qs : '');
}
export const hashFor = buildHash;
function compile(pattern) {
  const parts = seg(pattern).map((s) => (s.startsWith(':') ? { param: s.replace(/^:|\?$/g, ''), optional: s.endsWith('?') } : { lit: s }));
  return parts;
}
function matchRoute(r, parts) {
  const need = r.parts.filter((p) => !p.optional).length;
  if (parts.length < need || parts.length > r.parts.length) return null;
  const params = {};
  for (let i = 0; i < r.parts.length; i++) {
    const p = r.parts[i], v = parts[i];
    if (v === undefined) { if (p.optional) continue; return null; }
    if (p.lit !== undefined) { if (p.lit !== v) return null; continue; }
    const w = r.opts.where && r.opts.where[p.param];
    if (w && !(w instanceof RegExp ? w.test(v) : w(v))) return null;
    params[p.param] = v;
  }
  return params;
}
function find(path) {
  const parts = seg(path).map(dec);
  for (const kind of ['sheet', 'screen']) {
    const cands = routes.filter((r) => r.kind === kind).sort((a, b) => b.parts.length - a.parts.length);
    for (const r of cands) { const params = matchRoute(r, parts); if (params) return { route: r, params }; }
  }
  return null;
}
function fill(pattern, params) {
  const out = [];
  for (const p of compile(pattern)) { if (p.lit !== undefined) out.push(p.lit); else if (params[p.param] !== undefined) out.push(params[p.param]); else if (!p.optional) out.push(''); }
  return '/' + out.filter(Boolean).join('/');
}
const rootOf = (path) => seg(path)[0] || 'today';

// ---------------------------------------------------------------- registration
function add(kind, pattern, factory, opts) {
  routes = routes.filter((r) => !(r.kind === kind && r.pattern === pattern));
  routes.push({ kind, pattern, parts: compile(pattern), factory, opts: { requiresProfile: true, chrome: 'shell', ...opts } });
}
export const registerScreen = (pattern, factory, opts = {}) => add('screen', pattern, factory, opts);
export function registerSheet(pattern, factory, opts = {}) {
  if (!opts.parent) throw new Error(`registerSheet(${pattern}) needs a parent pattern`);
  add('sheet', pattern, factory, opts);
}
// Lazy feature loading (F-A11-01): app.js installs a loader that imports the register files for a route group on first use.
let routeLoader = null;
export const setRouteLoader = (fn) => { routeLoader = fn; };
/** Make sure the screens for this path (or prefix) are registered. Safe to call often; resolves when they are. */
export async function ensureRoutes(path) { if (!routeLoader) return; try { await routeLoader(path); } catch (e) { logError(e, 'route loader'); } }
export const hasScreen = (pattern) => routes.some((r) => r.kind === 'screen' && r.pattern === pattern);
export const listRoutes = () => routes.map((r) => ({ kind: r.kind, pattern: r.pattern }));

// ---------------------------------------------------------------- history
const stNow = () => (history.state && typeof history.state.i === 'number' ? history.state : null);
function write(mode, hash) {
  const st = stNow();
  if (mode === 'push') { idx = (st ? st.i : idx) + 1; history.pushState({ i: idx, prev: curHash || null }, '', hash); }
  else { idx = st ? st.i : idx; history.replaceState({ i: idx, prev: st ? st.prev : null }, '', hash); }
  curHash = hash;
}
async function canLeave() {
  if (!guard || !guard.dirty()) return true;
  const ok = await guard.confirm();
  if (ok) guard = null;
  return ok;
}
export async function navigate(to, { replace: rep = false } = {}) {
  const hash = to.startsWith('#') ? to : buildHash(to);
  if (hash === curHash) return true;
  if (!(await canLeave())) return false;
  write(rep ? 'replace' : 'push', hash);
  await render(hash);
  return true;
}
export const replace = (to) => navigate(to, { replace: true });
export async function back(fallback = '#/today') {
  const st = stNow();
  if (!(await canLeave())) return;
  if (st && st.i > 0 && st.prev) history.back(); else { write('replace', fallback.startsWith('#') ? fallback : buildHash(fallback)); await render(curHash); }
}
/** Primary tab switch: Today -> tab pushes; tab -> tab replaces; tab -> Today pops when Today is directly below. */
export async function goRoot(root, { reset = false } = {}) {
  const here = rootOf(cur.path);
  const target = !reset && lastRoute[root] && here !== root ? lastRoute[root] : buildHash('/' + root);
  if (target === curHash) return;
  if (!(await canLeave())) return;
  const st = stNow();
  if (root === 'today' && here !== 'today' && st && st.i > 0 && st.prev && rootOf(parseHash(st.prev).path) === 'today' && PRIMARY_ROOTS.includes(here)) { history.back(); return; }
  write(here === 'today' ? 'push' : 'replace', target);
  await render(target);
}
async function onPop() {
  if (ignorePops > 0) { ignorePops--; return; }
  const st = stNow(); const before = idx; const hash = location.hash || '#/today';
  const nextIdx = st ? st.i : before + 1;
  if (guard && guard.dirty() && hash !== curHash) {
    const delta = nextIdx - before;
    if (delta !== 0) {
      ignorePops++; history.go(-delta);
      const ok = await guard.confirm();
      if (!ok) return;
      guard = null; history.go(delta); return;
    }
  }
  if (!st) { idx = before + 1; history.replaceState({ i: idx, prev: curHash || null }, '', hash); } else idx = st.i;
  curHash = hash;
  await render(hash);
}
/** Make Back from a deep link land on Today (D-072). Only when this entry has no state yet. */
function plant(target) {
  const t = target && target !== '#' ? target : '#/today';
  const { path, query } = parseHash(t); const m = find(path);
  history.replaceState({ i: 0, prev: null }, '', '#/today'); idx = 0; curHash = '#/today';
  if (path === '/today' && !Object.keys(query).length) return '#/today';
  if (m && m.route.kind === 'sheet') {
    const parent = buildHash(fill(m.route.opts.parent, m.params), query);
    if (parent !== '#/today') write('push', parent);
  }
  write('push', t);
  return t;
}

// ---------------------------------------------------------------- profile
export function setActiveProfile(pid) {
  if (pid) { sessionSet({ pid }); lsSet('activeProfile', pid); } else sessionRemove();
  invalidateOverlay();
  appStore.set('activeProfile', pid || null);
}
/** Picker calls this after the user taps a profile. Opens the held deep link, else Today. */
export async function selectProfile(pid) {
  setActiveProfile(pid);
  const target = pendingHash && pendingHash !== '#/pick' ? pendingHash : '#/today';
  pendingHash = null;
  const t = plant(target);
  await render(t);
}
export async function switchProfile() {
  if (!(await canLeave())) return;
  teardownSheet(); setActiveProfile(null); pendingHash = null;
  write('replace', '#/pick'); await render('#/pick');
}
export const getPendingHash = () => pendingHash;

// ---------------------------------------------------------------- rendering
function makeCtx(m, parsed, kind, extra = {}) {
  const ac = new AbortController(); const cleanups = [];
  const dq = m.params.date || parsed.query.d;
  const ctx = {
    path: parsed.path, query: parsed.query, params: m.params, hash: buildHash(parsed.path, parsed.query), kind,
    pid: appStore.get('activeProfile'), date: dq && isInAllowedRange(dq) ? dq : todayKey(),
    signal: ac.signal, onCleanup: (fn) => { cleanups.push(fn); }, navigate, replace, back,
    close: (o) => closeSheet(o), ...extra
  };
  return { ctx, cleanups, ac };
}
function runCleanups(o) { if (!o) return; try { o.ac.abort(); } catch { /* ignore */ } for (const fn of o.cleanups.splice(0)) { try { fn(); } catch (e) { logError(e, 'cleanup'); } } }
function teardownSheet() {
  if (!sheet) return;
  const s = sheet; sheet = null; guard = null;
  runCleanups(s); try { s.p && s.p.dispose && s.p.dispose(); } catch (e) { logError(e, 'sheet dispose'); }
}
function teardownBase() { if (!base) return; const b = base; base = null; runCleanups(b); try { b.destroy && b.destroy(); } catch (e) { logError(e, 'screen destroy'); } }
function notFoundView() {
  return h('section', { class: 'screen screen-narrow' },
    h('div', { class: 'empty-state' }, h('h1', { class: 'empty-title' }, 'Not found'),
      h('p', { class: 'empty-text muted' }, 'That page does not exist or is not available for this profile.'),
      h('a', { class: 'btn btn-primary', href: '#/today' }, 'Go to Today')));
}
function mountNode(node) { clear(outlet); outlet.appendChild(node); }
function normalize(res) { return res instanceof Node ? { el: res } : res && res.el ? res : { el: notFoundView() }; }
async function mountScreen(m, parsed, hash, myToken, opts) {
  const key = hash;
  teardownBase();
  const { ctx, cleanups, ac } = makeCtx(m, parsed, 'screen');
  const holder = { key, hash, destroy: null, cleanups, ac };
  base = holder;
  let view;
  try { view = normalize(await m.route.factory(ctx)); }
  catch (e) { if (e instanceof NotFoundError) view = { el: notFoundView() }; else { logError(e, 'screen ' + m.route.pattern); view = { el: h('section', { class: 'screen screen-narrow' }, h('div', { class: 'empty-state' }, h('h1', { class: 'empty-title' }, 'Something went wrong'), h('p', { class: 'empty-text muted' }, 'This screen could not be shown. Your data is safe. Go back and try again.'), h('a', { class: 'btn btn-secondary', href: '#/today' }, 'Go to Today'))) }; } }
  if (myToken !== token) { runCleanups(holder); try { view.destroy && view.destroy(); } catch { /* ignore */ } return false; }
  holder.destroy = view.destroy || null;
  mountNode(view.el);
  if (opts.focus) { focusHeading(outlet); }
  return true;
}
function titleFor(m, ctx) { const t = m.route.opts.title; return typeof t === 'function' ? t(ctx) : t || ''; }
async function render(hash, { refresh = false } = {}) {
  const myToken = ++token;
  const parsed = parseHash(hash);
  if (parsed.path === '/') { write('replace', '#/today'); return render('#/today'); }
  await ensureRoutes(parsed.path);
  if (myToken !== token) return;
  const m = find(parsed.path);
  const bare = !m;
  if (m && m.route.opts.requiresProfile && !appStore.get('activeProfile')) {
    pendingHash = hash; teardownSheet(); write('replace', '#/pick'); return render('#/pick');
  }
  if (bare) {
    teardownSheet(); teardownBase();
    cur = { path: parsed.path, query: parsed.query, kind: 'notfound', root: null };
    mountNode(notFoundView()); if (host) host.onRoute({ chrome: appStore.get('activeProfile') ? 'shell' : 'bare', root: null, path: parsed.path, title: 'Not found' });
    document.title = 'Not found · Winter Arc'; return;
  }
  let screenMatch = m, baseHash = hash, parentParsed = parsed;
  if (m.route.kind === 'sheet') {
    const parentPath = fill(m.route.opts.parent, m.params);
    baseHash = buildHash(parentPath, parsed.query); parentParsed = parseHash(baseHash);
    screenMatch = find(parentParsed.path);
    if (!screenMatch || screenMatch.route.kind !== 'screen') { teardownSheet(); mountNode(notFoundView()); return; }
  }
  const sameBase = base && base.key === baseHash && !refresh;
  const changed = !sameBase;
  if (m.route.kind === 'screen') teardownSheet();
  if (changed) {
    const ok = await mountScreen(screenMatch, parentParsed, baseHash, myToken, { focus: m.route.kind === 'screen' });
    if (!ok) return;
    if (m.route.kind === 'screen') window.scrollTo(0, 0);
  }
  const root = screenMatch.route.opts.root || rootOf(parentParsed.path);
  const chrome = screenMatch.route.opts.chrome;
  if (PRIMARY_ROOTS.includes(root)) lastRoute[root] = baseHash;
  cur = { path: parsed.path, query: parsed.query, kind: m.route.kind, root, hash };
  if (m.route.kind === 'sheet') {
    teardownSheet();
    const { ctx, cleanups, ac } = makeCtx(m, parsed, 'sheet');
    const holder = { p: null, parentHash: baseHash, cleanups, ac };
    sheet = holder;
    let p;
    try { p = await m.route.factory(ctx); } catch (e) { const missing = e instanceof NotFoundError; if (!missing) logError(e, 'sheet ' + m.route.pattern); sheet = null; runCleanups(holder); await replace(baseHash); if (missing) { try { const { toast } = await import('../ui/components.js'); toast('That entry was not found. It may have been removed, or it belongs to another profile.'); } catch { /* ignore */ } } return; } // F-A8-02 / F-A10-06: say so, never fail silently
    if (myToken !== token) { runCleanups(holder); try { p.dispose && p.dispose(); } catch { /* ignore */ } return; }
    holder.p = p; p.open();
  }
  const ctxTitle = { params: m.params, query: parsed.query, date: parsed.query.d };
  const title = titleFor(m.route.kind === 'sheet' ? screenMatch : m, ctxTitle);
  document.title = title ? `${title} \u00B7 Winter Arc` : 'Winter Arc';
  if (host) host.onRoute({ chrome, root, path: parsed.path, title, kind: m.route.kind });
  for (const fn of [...listeners]) { try { fn(cur); } catch (e) { logError(e, 'route listener'); } }
  if (changed && m.route.kind === 'screen' && title) announce(title);
}
/** Close the open sheet. Pops history when the sheet was opened from its parent, else replaces. refresh:true re-runs the parent screen. */
export async function closeSheet({ refresh = false } = {}) {
  if (!sheet) return;
  const parentHash = sheet.parentHash; const st = stNow();
  guard = null;
  if (refresh) { teardownBase(); }
  if (st && st.i > 0 && st.prev === parentHash) { history.back(); return; } // F-A4-06: also for refresh, the base was torn down so the pop re-mounts the parent; no duplicate history entry
  write('replace', parentHash); await render(parentHash);
}
/** Re-run the current screen (after data changed behind it). An open sheet is left alone. */
export async function invalidate() {
  if (!base) return;
  const hh = base.hash; const parsed = parseHash(hh); const m = find(parsed.path);
  if (m && m.route.kind === 'screen') await mountScreen(m, parsed, hh, token, { focus: false });
}
export function setLeaveGuard(g) { guard = g; }
export const currentRoute = () => ({ ...cur });
export const onRouteChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---------------------------------------------------------------- start / stop
/** host = { outlet, onRoute({chrome, root, path, title, kind}) }. Call once, after screens are registered. */
export async function start(opts) {
  host = opts; outlet = opts.outlet; started = true;
  window.addEventListener('popstate', onPop);
  const st = stNow(); let hash = location.hash;
  if (!hash || hash === '#' || hash === '#/') hash = '#/today';
  const { path } = parseHash(hash); await ensureRoutes(path); const m = find(path);
  const needsPick = !appStore.get('activeProfile') && (!m || m.route.opts.requiresProfile);
  if (needsPick) { if (m) pendingHash = hash; if (path !== '/pick') { history.replaceState({ i: 0, prev: null }, '', '#/pick'); idx = 0; } else idx = st ? st.i : 0; curHash = '#/pick'; await render('#/pick'); return; }
  if (st) { idx = st.i; curHash = hash; } else curHash = plant(hash);
  await render(curHash);
}
export function stop() { window.removeEventListener('popstate', onPop); teardownSheet(); teardownBase(); started = false; host = null; guard = null; pendingHash = null; ignorePops = 0; }
/** Tests only. */
export function __reset() { stop(); routes = []; cur = { path: '', query: {}, kind: null, root: null }; for (const k of Object.keys(lastRoute)) delete lastRoute[k]; listeners.clear(); }
