// App boot (D-014, D-017, D-042, D-066). Entry module loaded by index.html. (A3)
// Boot order: error ring + CSP listener -> theme -> unsupported check -> service worker (not awaited) -> shell DOM -> initRepo (open DB, migrations)
//  -> loss detection -> seed -> feature modules -> profile rule -> router.start -> banners.
// Exports for screens (import from '../../app.js'): checkForUpdate, reloadForUpdate, repairApp, getSwInfo, setTheme, getTheme, refreshBanners,
//  refreshProfileChip, canInstall, promptInstall, showFatal.
// Runtime status lives in appStore: updateReady, swStatus, seedState, cspViolations, cspLast, errors, online, dbBlocked, safeMode, writeError, canInstall.
import { appStore } from './core/store.js';
import { h, clear, mount, initLiveRegions, logError } from './core/dom.js';
import { onDbEvent, isDbBlocked } from './core/db.js';
import { initRepo, listProfiles, getSettings } from './core/repo.js';
import { loadSeed } from './core/seed.js';
import { detectLoss, sessionGet, lsGet, lsSet, reminderDecision, snoozeReminder, estimate, installNudgeDue, dismissInstallNudge, isStandalone } from './core/storage-health.js';
import { start, hasScreen, setActiveProfile, navigate, setRouteLoader, ensureRoutes } from './core/router.js';
import { installCheckinBanner } from './features/checkins/banner.js';
import { AppShell, EmptyState, Button, banners, toast } from './ui/components.js';

// ---------------------------------------------------------------- feature modules, loaded per route group on first visit (F-A11-01)
// Boot used to import all 11 register files (103 modules) before the picker showed. Now the router asks for a path and only that group loads.
// The 'settings' group also serves /restore and /safe-mode. Register paths stay as plain strings so the precache self-check can read them.
const GROUPS = {
  pick: ['profile/register.js'],
  today: ['daily/register.js'],
  food: ['food/register.js', 'food/register-w2.js'],
  workout: ['workout/register.js', 'workout/register-w2.js'],
  body: ['body/register.js'],
  progress: ['checkins/register.js', 'photos/register.js', 'analytics/register.js'],
  settings: ['settings/register.js'],
  restore: ['settings/register.js'],
  'safe-mode': ['settings/register.js']
};
const IMPORTERS = {
  'profile/register.js': () => import('./features/profile/register.js'),
  'daily/register.js': () => import('./features/daily/register.js'),
  'food/register.js': () => import('./features/food/register.js'),
  'workout/register.js': () => import('./features/workout/register.js'),
  'settings/register.js': () => import('./features/settings/register.js'),
  'food/register-w2.js': () => import('./features/food/register-w2.js'),
  'workout/register-w2.js': () => import('./features/workout/register-w2.js'),
  'body/register.js': () => import('./features/body/register.js'),
  'photos/register.js': () => import('./features/photos/register.js'),
  'checkins/register.js': () => import('./features/checkins/register.js'),
  'analytics/register.js': () => import('./features/analytics/register.js')
};
const registerLoads = new Map(); // register path -> promise, so each file is imported once
function loadRegister(path) {
  if (!registerLoads.has(path)) {
    const p = IMPORTERS[path]().then(() => { appStore.set('features', [...registerLoads.keys()].sort()); }, (e) => { registerLoads.delete(path); logError(e, 'feature ' + path); });
    registerLoads.set(path, p);
  }
  return registerLoads.get(path);
}
/** Route loader: '/food/add' -> food group. Unknown roots load nothing (the router then shows Not found). */
function loadRoutesFor(path) {
  const root = String(path || '/').split('?')[0].split('/').filter(Boolean)[0] || 'today';
  const group = GROUPS[root]; if (!group) return Promise.resolve();
  return Promise.all(group.map(loadRegister));
}
async function loadFeatures() { setRouteLoader(loadRoutesFor); appStore.set('features', []); }

// ---------------------------------------------------------------- listeners: error ring, CSP, online, install prompt
function installListeners() {
  window.addEventListener('error', (e) => logError(e.error || e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => logError(e.reason, 'promise'));
  document.addEventListener('securitypolicyviolation', (e) => {
    appStore.set('cspViolations', (appStore.get('cspViolations') || 0) + 1);
    appStore.set('cspLast', { directive: e.violatedDirective, blocked: String(e.blockedURI || '').slice(0, 120) });
    logError(`CSP: ${e.violatedDirective} blocked ${e.blockedURI}`, 'csp');
  });
  appStore.update({ cspViolations: 0, errors: [], online: navigator.onLine !== false, canInstall: false, updateReady: false, seedState: 'loading', features: [], swStatus: { state: 'unknown', error: null } });
  window.addEventListener('online', () => appStore.set('online', true));
  window.addEventListener('offline', () => appStore.set('online', false));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; appStore.set('canInstall', true); refreshBanners(); });
}
let deferredInstall = null;
export const canInstall = () => !!deferredInstall;
export async function promptInstall() { if (!deferredInstall) return 'unavailable'; deferredInstall.prompt(); const r = await deferredInstall.userChoice; deferredInstall = null; appStore.set('canInstall', false); return r.outcome; }

// ---------------------------------------------------------------- theme
export const getTheme = () => { const t = (lsGet('ui', {}) || {}).theme; return t === 'light' || t === 'dark' ? t : 'auto'; };
export function setTheme(mode) {
  const ui = { ...(lsGet('ui', {}) || {}) };
  if (mode === 'light' || mode === 'dark') { ui.theme = mode; document.documentElement.setAttribute('data-theme', mode); } else { delete ui.theme; document.documentElement.removeAttribute('data-theme'); }
  lsSet('ui', ui);
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const colour = mode === 'dark' ? '#0F1513' : '#F7F8F6';
  metas.forEach((m, i) => { if (mode === 'auto') m.setAttribute('content', i === 0 ? '#F7F8F6' : '#0F1513'); else m.setAttribute('content', colour); });
}

// ---------------------------------------------------------------- service worker and updates
let reg = null, wantReload = false;
function markUpdate() {
  appStore.set('updateReady', true);
  banners.set('update', { kind: 'info', title: 'Update available.', text: 'Reload to use the new version. Your data is not affected.', actions: [{ label: 'Reload', onClick: reloadForUpdate }] });
}
function watch(r) {
  if (r.waiting && navigator.serviceWorker.controller) markUpdate();
  r.addEventListener('updatefound', () => { const w = r.installing; if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) markUpdate(); }); });
}
async function registerSw() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') { appStore.set('swStatus', { state: 'unsupported', error: null }); return; }
  try {
    reg = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
    appStore.set('swStatus', { state: reg.active ? 'active' : 'installing', error: null });
    watch(reg);
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload) location.reload(); });
    navigator.serviceWorker.ready.then(() => appStore.set('swStatus', { state: 'active', error: null }));
    reg.update().catch(() => {});
  } catch (e) {
    logError(e, 'service worker'); appStore.set('swStatus', { state: 'failed', error: String(e && e.message || e) });
    banners.set('install', { kind: 'info', priority: 6, title: 'Offline use may not work yet.', text: 'Your data is fine.', onDismiss: () => banners.clear('install') });
  }
}
export async function checkForUpdate() {
  if (!reg) return { ok: false, reason: 'no-service-worker' };
  try { await reg.update(); } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  if (reg.waiting) markUpdate();
  return { ok: true, updateReady: !!reg.waiting || appStore.get('updateReady') };
}
export function reloadForUpdate() {
  if (reg && reg.waiting) { wantReload = true; reg.waiting.postMessage('SKIP_WAITING'); setTimeout(() => { if (wantReload) location.reload(); }, 4000); } else location.reload();
}
/** Unregister the service worker and clear winter-arc caches. Never touches IndexedDB or LocalStorage. */
export async function repairApp() {
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch { /* ignore */ }
  try { for (const k of await caches.keys()) if (k.startsWith('winter-arc-')) await caches.delete(k); } catch { /* ignore */ }
  location.reload();
}
/** {pageVersion, swVersion, seedVersion, missingSeed, state, offlineReady, mismatch} for Self-check. */
export async function getSwInfo() {
  const pageVersion = self.WA_VERSION || null; const out = { pageVersion, swVersion: null, seedVersion: self.WA_SEED_VERSION ?? null, missingSeed: [], state: appStore.get('swStatus').state, offlineReady: false, mismatch: false };
  try { out.offlineReady = !!pageVersion && await caches.has(`winter-arc-shell-${pageVersion}`); } catch { /* ignore */ }
  const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (ctl) {
    out.swVersion = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 1500);
      const fn = (e) => { if (e.data && e.data.type === 'VERSION') { clearTimeout(t); navigator.serviceWorker.removeEventListener('message', fn); out.missingSeed = e.data.missingSeed || []; resolve(e.data.version); } };
      navigator.serviceWorker.addEventListener('message', fn); ctl.postMessage({ type: 'GET_VERSION' });
    });
  }
  out.mismatch = !!(out.swVersion && pageVersion && out.swVersion !== pageVersion);
  return out;
}

// ---------------------------------------------------------------- banners (priority D-066 is applied by banners itself)
export async function refreshBanners() {
  if (!appStore.get('activeProfile')) { for (const id of ['storage-red', 'storage-amber', 'backup', 'install']) banners.clear(id); return; }
  try {
    const e = await estimate();
    banners.clear('storage-red'); banners.clear('storage-amber');
    if (e.level === 'red') banners.set('storage-red', { kind: 'danger', title: 'Storage is almost full.', text: 'Back up and free some space before adding photos.', actions: [{ label: 'Storage', onClick: () => navigate('#/settings/storage') }] });
    else if (e.level === 'amber') banners.set('storage-amber', { kind: 'warn', title: 'Storage is getting full.', text: 'Photos use the most space.', actions: [{ label: 'Storage', onClick: () => navigate('#/settings/storage') }], onDismiss: () => banners.clear('storage-amber') });
    const d = await reminderDecision();
    banners.clear('backup');
    if (d.due) banners.set('backup', { kind: 'warn', title: 'Time to back up.', text: 'A backup file is the only copy that survives if this browser clears its data.', actions: [{ label: 'Back up now', onClick: () => navigate('#/settings/backup') }], onDismiss: () => { snoozeReminder(); banners.clear('backup'); } });
    banners.clear('install');
    if (installNudgeDue() && !isStandalone()) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      banners.set('install', { kind: 'info', title: ios ? 'Install first.' : 'Install Winter Arc.', text: ios ? 'Use Share, then Add to Home Screen, and create profiles inside the installed app.' : 'It opens faster and keeps your data safer.',
        actions: [...(canInstall() ? [{ label: 'Install', onClick: promptInstall }] : []), { label: 'How', onClick: () => navigate('#/settings/install') }], onDismiss: () => { dismissInstallNudge(); banners.clear('install'); } });
    }
  } catch (e) { logError(e, 'banners'); }
}

// ---------------------------------------------------------------- fatal full-screen states
const FATAL = {
  unsupported: { icon: 'warning', title: 'This browser is not supported', text: 'Winter Arc needs Safari 16.4 or newer, or a current Chrome, Edge or Firefox. Nothing was changed.' },
  storage: { icon: 'warning', title: 'Storage is not available', text: 'This browser would not open its storage. Private browsing can cause this. Open Winter Arc in a normal window.' },
  blocked: { icon: 'info', title: 'Winter Arc is open in another tab', text: 'Close the other Winter Arc tabs or windows, then try again. Nothing was changed.' },
  versionchange: { icon: 'info', title: 'Winter Arc was updated in another tab', text: 'Reload this tab to continue. Nothing was changed.' },
  safe: { icon: 'shield', title: 'Safe mode', text: 'Winter Arc could not update your saved data, so it opened read-only. Nothing was changed. Export your data first, then update the app.' },
  lost: { icon: 'warning', title: 'Your saved data could not be found on this device', text: 'The browser may have cleared it. If you have a backup file, restore it now.' }
};
export function showFatal(kind) {
  const root = document.getElementById('app-root'); const s = FATAL[kind] || FATAL.storage; clear(root);
  const extra = [];
  if (kind === 'blocked' || kind === 'versionchange' || kind === 'storage') extra.push(Button({ label: kind === 'versionchange' ? 'Reload' : 'Try again', kind: 'primary', onClick: () => location.reload() }));
  if (kind === 'lost') extra.push(Button({ label: 'Restore from backup', kind: 'primary', href: '#/settings/import' }));
  if (kind === 'safe') extra.push(exportControl());
  mount(root, h('main', { class: 'screen screen-narrow', id: 'main' }, EmptyState({ icon: s.icon, title: s.title, text: s.text, headingLevel: 1 }), h('div', { class: 'stack-sm' }, extra)));
}
function exportControl() {
  const box = h('div', { class: 'stack-sm' }); const status = h('p', { class: 'small muted', role: 'status' });
  const prepare = Button({ label: 'Prepare backup', kind: 'primary' });
  prepare.addEventListener('click', async () => {
    prepare.disabled = true; status.textContent = 'Preparing...';
    try {
      const { prepareBackup, shareOrDownload } = await import('./core/backup.js');
      const prepared = await prepareBackup({ includePhotos: true });
      status.textContent = `Ready: ${prepared.filename}`;
      const save = Button({ label: 'Save backup', kind: 'primary' });
      save.addEventListener('click', () => { shareOrDownload(prepared, { mode: 'auto' }).then((r) => { status.textContent = r.result === 'cancelled' ? 'Not saved.' : r.result === 'failed' ? `Not saved. ${r.error || ''}` : `Backup ${r.result}.`; }); });
      prepare.replaceWith(save);
    } catch (e) { logError(e, 'safe export'); status.textContent = 'Could not prepare the backup. Your data is unchanged.'; prepare.disabled = false; }
  });
  box.append(prepare, status); return box;
}

// ---------------------------------------------------------------- boot
const supported = () => 'indexedDB' in window && typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function' && 'fetch' in window && 'Blob' in window;
async function resolveInitialProfile() {
  const profiles = await listProfiles(); const ok = (pid) => profiles.some((p) => p.id === pid);
  const s = sessionGet(); if (s && ok(s.pid)) return s.pid;
  const last = lsGet('activeProfile', null);
  if (last && ok(last)) { try { const st = await getSettings(last); if (st && st.uiPrefs && st.uiPrefs.openLastProfile) return last; } catch { /* fall through */ } }
  return null;
}
let shell = null;
export async function refreshProfileChip() {
  const pid = appStore.get('activeProfile'); if (!shell) return;
  if (!pid) { shell.setProfile(null); return; }
  const list = await listProfiles(); const i = list.findIndex((p) => p.id === pid);
  if (i >= 0) shell.setProfile(list[i], i);
}
async function boot() {
  const root = document.getElementById('app-root');
  installListeners();
  if (!supported()) { showFatal('unsupported'); return; }
  initLiveRegions();
  registerSw();
  onDbEvent((ev) => { if (ev.type === 'blocked') { appStore.set('dbBlocked', true); showFatal('blocked'); } else if (ev.type === 'versionchange') showFatal('versionchange'); });
  shell = AppShell(); mount(root, shell.el);
  try { await initRepo(); } catch (e) {
    logError(e, 'initRepo');
    if (appStore.get('safeMode')) { await loadFeatures(); await ensureRoutes('/safe-mode'); if (hasScreen('/safe-mode')) { mountSpecial('/safe-mode'); return; } showFatal('safe'); return; }
    showFatal(isDbBlocked() ? 'blocked' : 'storage'); return;
  }
  let lost = false; try { lost = await detectLoss(); } catch { /* ignore */ }
  try { await Promise.race([loadSeed(), new Promise((_, rej) => setTimeout(() => rej(new Error('Seed load timed out')), 8000))]); appStore.set('seedState', 'ready'); } catch (e) { logError(e, 'seed'); appStore.set('seedState', 'error'); }
  await loadFeatures(); installCheckinBanner(); // the check-in due banner must work from the first route, before the progress screens load
  if (lost) { await ensureRoutes('/restore'); if (hasScreen('/restore')) { mountSpecial('/restore'); return; } showFatal('lost'); return; }
  const pid = await resolveInitialProfile(); if (pid) setActiveProfile(pid);
  await refreshProfileChip();
  let last = appStore.get('activeProfile');
  appStore.subscribe((s) => { if (s.activeProfile !== last) { last = s.activeProfile; toast.clear(); banners.clear('checkin'); refreshProfileChip(); refreshBanners(); } });
  appStore.subscribe((s) => { if (s.writeError) banners.set('write-error', { kind: 'danger', title: s.writeError.quota ? 'Storage is full. Nothing was saved.' : 'That did not save.', text: 'Your earlier data is safe. Try again, or back up and free some space.', onDismiss: () => { appStore.set('writeError', null); banners.clear('write-error'); } }); else banners.clear('write-error'); });
  await start({ outlet: shell.outlet, onRoute: (info) => { shell.setChrome(info.chrome); shell.setActiveRoot(info.root); } });
  refreshBanners();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (reg) reg.update().catch(() => {}); refreshBanners(); } });
}
async function mountSpecial(path) { history.replaceState(null, '', '#' + path); await start({ outlet: shell.outlet, onRoute: (info) => { shell.setChrome('bare'); shell.setActiveRoot(info.root); } }); }
if (document.getElementById('app-root') && !window.__noAutoBoot) boot();
