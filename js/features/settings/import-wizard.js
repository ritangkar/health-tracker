// S34 Import wizard (7 steps, D-035) and S39 Restore. State lives in memory for the length of the wizard; leaving it clears the open file.
//  1 Choose file and verify  2 Preview  3 Profiles  4 Mode and preferences  5 Safety backup (Replace only)  6 Apply  7 Result
// Merge never deletes. Replace needs a safety backup, or an explicit "skip" tick (DAT-023). Import never changes the last-backup date. (A4)
import { add } from '../daily/shared.js';
import { h, uid, logError } from '../../core/dom.js';
import { Card, Button, EmptyState, ProgressList, ConfirmDialog } from '../../ui/components.js';
import { navigate, replace, setLeaveGuard } from '../../core/router.js';
import { verifyBackup, buildPreview, applyImport, makeSafetyBackup, suggestProfileMapping } from '../../core/import.js';
import { shareOrDownload, canShareFiles } from '../../core/backup.js';
import { listProfiles } from '../../core/repo.js';
import { appStore } from '../../core/store.js';
import { lsRemove } from '../../core/storage-health.js';
import { refreshProfileChip, refreshBanners } from '../../app.js';
import { fmtNum } from '../../core/units.js';
import { pageHead, kv, fmtBytes, fmtWhen } from './common.js';

const W = { file: null, summary: null, handle: null, mode: 'merge', preference: 'newest', profileMap: null, preview: null, safety: null, safetyDone: false, skipSafety: false, result: null, error: null, restore: false };
function resetWizard() { Object.assign(W, { file: null, summary: null, handle: null, mode: 'merge', preference: 'newest', profileMap: null, preview: null, safety: null, safetyDone: false, skipSafety: false, result: null, error: null }); }
const STEP_TITLES = ['Choose file', 'Preview', 'Profiles', 'How to import', 'Safety backup', 'Importing', 'Result'];
const STORE_LABELS = { foodLogs: 'Food entries', workoutLogs: 'Workouts', days: 'Days (water, steps, notes)', sleepLogs: 'Sleep', measurements: 'Measurements', checkins: 'Check-ins', photos: 'Photos', foods: 'Custom foods and recipes', exercises: 'Custom exercises', plans: 'Plans', foodPrefs: 'Favourites and recents', settings: 'Settings' };
const here = (n) => `#/settings/import${n > 1 ? `/${n}` : ''}`;

export function importScreen(ctx) {
  const step = Number(ctx.params.step || 1);
  if (step > 1 && !W.handle && step !== 7) { replace(here(1)); return h('section', { class: 'screen screen-narrow' }); }
  if (step === 7 && !W.result && !W.error) { replace(here(1)); return h('section', { class: 'screen screen-narrow' }); }
  const el = h('section', { class: 'screen screen-narrow import-wizard' });
  const goBackHash = appStore.get('activeProfile') ? '#/settings' : '#/pick';
  const head = (n) => h('div', { class: 'stack-sm' }, pageHead(W.restore ? 'Restore from backup' : 'Import a backup', null), h('p', { class: 'small muted', 'aria-live': 'polite' }, `Step ${n} of 7: ${STEP_TITLES[n - 1]}`));
  const cancel = () => { resetWizard(); navigate(goBackHash, { replace: true }); };
  const nav = (back, next) => h('div', { class: 'wizard-nav' }, Button({ label: back ? 'Back' : 'Cancel', kind: back ? 'secondary' : 'ghost', onClick: () => (back ? navigate(here(back)) : cancel()) }), next);
  const views = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6, 7: step7 };
  ctx.onCleanup(() => { if (!W.restore && !(W.result || W.error)) { /* keep file while moving between steps */ } });
  const body = views[step](ctx, { head, nav, goBackHash, cancel });
  return body instanceof Promise ? body : body;
}

export function restoreScreen(ctx) {
  W.restore = true;
  return h('section', { class: 'screen screen-narrow' },
    h('div', { class: 'stack-sm picker-head' }, h('h1', null, 'Your saved data could not be found on this device'), h('p', { class: 'muted' }, 'The browser may have cleared it. If you have a Winter Arc backup file, restore it now. Nothing has been changed.')),
    Button({ label: 'Restore from a backup file', kind: 'primary', icon: 'upload', block: true, onClick: () => { W.restore = true; navigate(here(1)); } }),
    Button({ label: 'Start fresh instead', kind: 'ghost', onClick: async () => { const ok = await ConfirmDialog({ title: 'Start fresh?', message: 'You will set up new profiles. If a backup file turns up later you can still import it.', confirmLabel: 'Start fresh', cancelLabel: 'Not yet' }); if (ok) { lsRemove('sentinel'); location.hash = '#/pick'; location.reload(); } } }));
}

const safeMsg = (m) => { const t = String(m || '').trim(); return /not changed/i.test(t) ? t : `${t} Your data was not changed.`.trim(); };

// ---------------------------------------------------------------- step 1
function step1(ctx, { head, nav, cancel }) {
  const el = h('section', { class: 'screen screen-narrow import-wizard' });
  const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' }); const out = h('div', { class: 'stack' });
  const input = h('input', { type: 'file', accept: '.json,.zip,application/json,application/zip', class: 'sr-only', id: uid('imp-file'), 'aria-label': 'Backup file', tabindex: '-1' });
  const pick = Button({ label: W.handle ? 'Choose a different file' : 'Choose backup file', kind: 'primary', icon: 'upload', block: true, onClick: () => input.click() });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0]; if (!f) return; input.value = '';
    resetWizard(); W.restore = W.restore || !appStore.get('activeProfile'); out.textContent = ''; status.textContent = 'Checking the file. Nothing is changed yet...'; pick.disabled = true;
    const r = await verifyBackup(f, { onProgress: (p) => { if (p && p.phase) status.textContent = `Checking the file... ${p.done || ''}${p.total ? ` of ${p.total}` : ''}`; } });
    pick.disabled = false;
    if (!r.ok) { status.textContent = ''; add(out, EmptyState({ icon: 'warning', title: 'This file cannot be imported', text: safeMsg(r.message), headingLevel: 2 })); return; }
    W.file = f; W.handle = r.handle; W.summary = r.summary; status.textContent = 'The file looks good.'; showSummary();
  });
  function showSummary() {
    out.textContent = ''; const s = W.summary;
    add(out, Card({ title: 'This backup', children: [kv([['File', W.file.name], ['Made', fmtWhen(s.createdAt)], ['Profiles', (s.profiles || []).map((p) => p.name).join(', ')], ['Includes photos', s.includesPhotos ? 'Yes' : 'No'], ['Size', fmtBytes(W.file.size)]])] }),
      s.damagedPhotos ? h('p', { class: 'warn-box small' }, `${s.damagedPhotos} photos in this backup are damaged. If you continue, they are left out and everything else is imported. You can cancel at any time.`) : null,
      s.unverified ? h('p', { class: 'warn-box small' }, 'This file has no checksums, so it could not be fully verified.') : null,
      Button({ label: 'Next: preview', kind: 'primary', block: true, onClick: () => navigate(here(2)) }));
  }
  add(el, head(1), h('p', { class: 'muted' }, W.restore ? 'Choose your Winter Arc backup file (.zip or .json).' : 'Choose a Winter Arc backup file (.zip or .json). It is checked first. Nothing changes until you confirm.'), input, pick, status, out, nav(0, null));
  if (W.handle) showSummary();
  return el;
}

// ---------------------------------------------------------------- step 2: preview
async function step2(ctx, { head, nav }) {
  const el = h('section', { class: 'screen screen-narrow import-wizard' }); add(el, head(2));
  let pv; try { pv = await buildPreview(W.handle, { mode: W.mode, preference: W.preference, profileMap: W.profileMap || undefined }); } catch (e) { logError(e, 'preview'); add(el, EmptyState({ icon: 'warning', title: 'Could not build the preview', text: safeMsg(e.message) }), nav(1, null)); return el; }
  W.preview = pv;
  const rows = Object.keys(STORE_LABELS).map((s) => { const t = pv.totals[s]; return t && t.total ? [s, t] : null; }).filter(Boolean);
  const table = h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'What is in this backup' }, h('table', { class: 'table preview-table' }, h('caption', { class: 'sr-only' }, 'Backup contents compared with this device'),
    h('thead', null, h('tr', null, ['What', 'In backup', 'New', 'Same', 'Newer', 'Older'].map((x, i) => h('th', { scope: 'col', class: i ? 'num-col' : '' }, x)))),
    h('tbody', null, rows.map(([s, t]) => h('tr', null, h('td', null, STORE_LABELS[s]), ...[t.total, t.new, t.identical, t.newer, t.older].map((n) => h('td', { class: 'num-col num' }, fmtNum(n))))))));
  add(el, h('p', { class: 'muted' }, 'This is what an import would do right now. Nothing has been changed.'), rows.length ? table : h('p', { class: 'muted' }, 'This backup has no entries yet.'),
    pv.warnings.includes('MERGE_MAY_RESURRECT') ? h('p', { class: 'warn-box small' }, 'Merging never deletes anything. If you removed an entry on this device that is still in the backup, it comes back.') : null,
    pv.warnings.includes('PHOTOS_METADATA_ONLY') ? h('p', { class: 'warn-box small' }, 'This file has no photo files. Photos show "Photo not in this backup" until you import a full backup.') : null,
    pv.damagedPhotoIds.length ? h('p', { class: 'warn-box small' }, `${pv.damagedPhotoIds.length} photos are damaged and cannot be imported. They are left out if you continue.`) : null,
    pv.invalidCount ? h('p', { class: 'warn-box small' }, `${pv.invalidCount} items in this backup are not valid. They will be skipped.`) : null,
    pv.migration && Array.isArray(pv.migration.applied) && pv.migration.applied.length > 0 ? h('p', { class: 'small muted' }, 'This backup was made by an older version and is brought up to date in memory first.') : null,
    pv.space && !pv.space.ok ? h('p', { class: 'warn-box small' }, 'There may not be enough space to import this file.') : null,
    nav(1, Button({ label: 'Next: profiles', kind: 'primary', onClick: () => navigate(here(3)) })));
  return el;
}

// ---------------------------------------------------------------- step 3: profiles
async function step3(ctx, { head, nav }) {
  const el = h('section', { class: 'screen screen-narrow import-wizard' }); add(el, head(3));
  const local = await listProfiles({ includeArchived: true }); const backupProfiles = (W.summary.profiles || []).map((p) => ({ id: p.id, name: p.name }));
  const sugg = suggestProfileMapping(backupProfiles, local, { mode: W.mode });
  const map = W.profileMap || JSON.parse(JSON.stringify(sugg)); const cards = [];
  const replaceMode = W.mode === 'replace';
  for (const bp of backupProfiles) {
    const sel = h('select', { class: 'input select', 'aria-label': `What to do with ${bp.name}` });
    const opts = [];
    if (local.some((l) => l.id === bp.id)) opts.push(['same', `Merge into the same profile (${bp.name})`]);
    else opts.push(['create', 'Add as a new profile']);
    if (!replaceMode) for (const l of local) if (l.id !== bp.id) opts.push([`map:${l.id}`, `Merge into ${l.name}`]);
    opts.push(['skip', 'Do not import this profile']);
    const cur = map[bp.id]; const curVal = cur.action === 'map' ? `map:${cur.targetPid}` : opts.some(([v]) => v === cur.action) ? cur.action : opts[0][0];
    for (const [v, l] of opts) add(sel, h('option', { value: v, selected: v === curVal }, l));
    sel.addEventListener('change', () => { const v = sel.value; map[bp.id] = v.startsWith('map:') ? { action: 'map', targetPid: v.slice(4) } : { action: v, targetPid: bp.id }; });
    cards.push(Card({ title: bp.name, headingLevel: 3, children: [h('div', { class: 'stack-sm' }, h('label', { class: 'field-label', htmlFor: (sel.id = uid('pm')) }, 'In this device'), sel)] }));
  }
  add(el, h('p', { class: 'muted' }, 'Choose where each profile in the backup should go. Two backup profiles cannot go to the same profile.'), ...cards,
    nav(2, Button({ label: 'Next: how to import', kind: 'primary', onClick: () => { W.profileMap = map; navigate(here(4)); } })));
  return el;
}

// ---------------------------------------------------------------- step 4: mode and preference
function step4(ctx, { head, nav }) {
  const el = h('section', { class: 'screen screen-narrow import-wizard' }); add(el, head(4));
  const group = (name, current, items, onPick) => {
    const box = h('div', { class: 'stack-sm', role: 'radiogroup', 'aria-label': name });
    for (const [v, t, d] of items) { const i = h('input', { type: 'radio', name: uid('r'), value: v, checked: current === v }); i.addEventListener('change', () => { onPick(v); repaint(); }); add(box, h('label', { class: 'radio-row' }, i, h('span', null, h('strong', null, t), h('span', { class: 'small muted' }, ` ${d}`)))); }
    return box;
  };
  const host = h('div', { class: 'stack' });
  const nextBtn = Button({ label: 'Next: review', kind: 'primary', onClick: () => navigate(here(W.mode === 'replace' ? 5 : 6)) });
  function repaint() {
    host.textContent = ''; nextBtn.querySelector('span').textContent = W.mode === 'replace' ? 'Next: safety backup' : 'Next: review';
    add(host, Card({ title: 'How should it be imported?', children: [group('Import mode', W.mode, [['merge', 'Merge (recommended)', 'Adds what is missing and keeps what you have. Nothing is deleted.'], ['replace', 'Replace everything', 'Makes this device match the backup exactly. Entries not in the backup are removed.']], (v) => { W.mode = v; if (v === 'replace' && W.profileMap && Object.values(W.profileMap).some((m) => m.action === 'map')) W.profileMap = null; })] }));
    if (W.mode === 'merge') add(host, Card({ title: 'If the same entry exists in both', children: [group('Conflict preference', W.preference, [['newest', 'Keep the newest edit', 'The most recently changed version wins.'], ['mine', 'Keep mine', 'Always keep what is on this device.'], ['backup', 'Use the backup', 'Always take the backup version.']], (v) => { W.preference = v; })] }));
    else add(host, h('p', { class: 'warn-box small' }, 'Replace removes anything on this device that is not in the backup, for the whole app. You will make a safety backup first.'));
  }
  repaint();
  add(el, host, nav(3, nextBtn));
  return el;
}

// ---------------------------------------------------------------- step 5: safety backup (Replace only)
function step5(ctx, { head, nav }) {
  const el = h('section', { class: 'screen screen-narrow import-wizard' }); add(el, head(5));
  if (W.mode !== 'replace') { add(el, h('p', { class: 'muted' }, 'A safety backup is only needed for Replace. Merge keeps everything you have.'), nav(4, Button({ label: 'Next', kind: 'primary', onClick: () => navigate(here(6)) }))); return el; }
  const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' }); const host = h('div', { class: 'stack' });
  const nextBtn = Button({ label: 'Next: review', kind: 'primary', disabled: true, onClick: () => navigate(here(6)) });
  const skipBox = h('input', { type: 'checkbox', id: uid('skip') }); skipBox.addEventListener('change', () => { W.skipSafety = skipBox.checked; nextBtn.disabled = !(W.safetyDone || W.skipSafety); });
  nextBtn.disabled = !(W.safetyDone || W.skipSafety);
  function intro() {
    host.textContent = '';
    const prep = Button({ label: 'Prepare safety backup', kind: 'primary', icon: 'download', block: true, onClick: async () => {
      prep.disabled = true; status.textContent = 'Preparing...';
      try { W.safety = await makeSafetyBackup({}); } catch (e) { logError(e, 'safety backup'); status.textContent = 'The safety backup could not be prepared. Your data is unchanged.'; prep.disabled = false; return; }
      ready();
    } });
    add(host, h('p', { class: 'muted' }, 'Replace removes anything not in the backup. Save a copy of what you have now first, so you can undo this.'), prep,
      h('label', { class: 'row check-row', htmlFor: skipBox.id }, skipBox, h('span', null, 'I do not want a safety backup. I understand data on this device that is not in the backup will be lost.')));
  }
  function ready() {
    host.textContent = '';
    const save = Button({ label: canShareFiles(W.safety.file) ? 'Share or save safety backup' : 'Save safety backup', kind: 'primary', icon: 'download', block: true });
    save.addEventListener('click', () => { const p = shareOrDownload(W.safety, { mode: 'auto' }); save.disabled = true; p.then((r) => { save.disabled = false; if (r.result === 'shared' || r.result === 'downloaded') { W.safetyDone = true; status.textContent = r.result === 'shared' ? 'Safety backup shared.' : 'Safety backup downloaded.'; nextBtn.disabled = false; } else status.textContent = 'Not saved. Try again, or choose to skip below.'; }); });
    add(host, h('p', null, `${W.safety.filename} (${fmtBytes(W.safety.size)}) is ready.`), save,
      h('label', { class: 'row check-row', htmlFor: skipBox.id }, skipBox, h('span', null, 'Skip the safety backup instead.')));
  }
  W.safetyDone ? (add(host, h('p', null, 'Safety backup saved. You can continue.'))) : intro();
  add(el, host, status, nav(4, nextBtn));
  return el;
}

// ---------------------------------------------------------------- step 6: apply
async function step6(ctx, { head, nav }) {
  const el = h('section', { class: 'screen screen-narrow import-wizard' }); add(el, head(6));
  const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' }); const progress = h('div', null);
  let pv; try { pv = await buildPreview(W.handle, { mode: W.mode, preference: W.preference, profileMap: W.profileMap || undefined }); } catch (e) { add(el, EmptyState({ icon: 'warning', title: 'The profile choices are not valid', text: safeMsg(e.message) }), nav(3, null)); return el; }
  const writes = pv.writeCount;
  const summary = h('div', { class: 'stack-sm' }, h('p', null, W.mode === 'replace' ? 'Replace everything with this backup.' : `Merge into this device (${W.preference === 'newest' ? 'keep the newest edit' : W.preference === 'mine' ? 'keep mine' : 'use the backup'}).`),
    h('p', { class: 'muted small' }, `${fmtNum(writes)} changes will be made in one step. If anything fails, nothing is changed.`), W.mode === 'replace' ? h('p', { class: 'warn-box small' }, W.safetyDone ? 'A safety backup was saved.' : 'You chose to skip the safety backup.') : null);
  const go = Button({ label: W.mode === 'replace' ? 'Replace and import' : 'Import now', kind: W.mode === 'replace' ? 'danger' : 'primary', block: true, onClick: run });
  async function run() {
    go.disabled = true; status.textContent = 'Importing. Keep this page open...'; progress.textContent = '';
    add(progress, ProgressList({ items: [{ label: 'Checking and writing everything in one step', status: 'active' }] }));
    try {
      const res = await applyImport(W.handle, { mode: W.mode, preference: W.preference, profileMap: W.profileMap || undefined, invalid: 'skip', damagedPhotos: 'import-without', safetyBackup: W.mode === 'replace' ? (W.safetyDone ? 'done' : 'skipped') : undefined });
      W.result = res; W.error = null;
    } catch (e) { logError(e, 'import'); W.error = { code: e.code || 'I_DAMAGED', message: e.code ? e.message : 'The import did not finish. Your data was not changed.' }; W.result = null; }
    navigate(here(7), { replace: true });
  }
  add(el, summary, go, progress, status, nav(W.mode === 'replace' ? 5 : 4, null));
  setLeaveGuard(null);
  return el;
}

// ---------------------------------------------------------------- step 7: result
async function step7(ctx, { head, goBackHash }) {
  const el = h('section', { class: 'screen screen-narrow import-wizard' }); add(el, head(7));
  if (W.error) { add(el, EmptyState({ icon: 'warning', title: 'Import did not finish', text: safeMsg(W.error.message), headingLevel: 2 }), Button({ label: 'Back to the start', kind: 'secondary', onClick: () => { const keep = W.restore; resetWizard(); W.restore = keep; navigate(here(1), { replace: true }); } })); return el; }
  const r = W.result; const v = r.verification || {}; const ok = !!v.ok;
  const rows = (v.checks || []).filter((c) => ['foodLogs', 'workoutLogs', 'days', 'sleepLogs', 'measurements', 'checkins', 'photos', 'photoData', 'foods', 'plans', 'exercises'].includes(c.store) && (c.expected || c.actual)).map((c) => [STORE_LABELS[c.store] || (c.store === 'photoData' ? 'Photo files' : c.store), `${fmtNum(c.actual)} of ${fmtNum(c.expected)}`, c.ok]);
  add(el, EmptyState({ icon: ok ? 'check' : 'warning', title: ok ? 'Import complete' : 'Import finished, but a check did not match', text: ok ? `${fmtNum(r.writes)} changes were applied and checked.` : 'Your data was written, but one of the counts did not match what we expected. Make a backup now and check your data.', headingLevel: 2 }),
    rows.length ? h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Verification' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Counts after import'), h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'What'), h('th', { scope: 'col', class: 'num-col' }, 'Count'), h('th', { scope: 'col' }, 'Check'))), h('tbody', null, rows.map(([l, c, k]) => h('tr', null, h('td', null, l), h('td', { class: 'num-col num' }, c), h('td', null, k ? 'Pass' : 'Fail')))))) : null,
    r.summary && r.summary.photosWithoutFiles ? h('p', { class: 'small muted' }, `${r.summary.photosWithoutFiles} photos have no image file: they show "Photo not in this backup".`) : null,
    r.summary && r.summary.invalidSkipped ? h('p', { class: 'small muted' }, `${r.summary.invalidSkipped} invalid items were skipped.`) : null,
    ...(r.warnings || []).map((w) => h('p', { class: 'small muted' }, w)),
    h('p', { class: 'small muted' }, W.mode === 'replace' && W.safetyDone ? 'Your last-backup date shows the safety backup. The import itself does not count as a backup.' : 'An import does not count as a backup. Your last-backup date did not change.'));
  const done = async () => {
    const wasRestore = W.restore || !appStore.get('activeProfile'); resetWizard();
    try { await refreshProfileChip(); refreshBanners(); } catch { /* ignore */ }
    const profiles = await listProfiles();
    if (appStore.get('activeProfile') && profiles.some((p) => p.id === appStore.get('activeProfile'))) navigate('#/today', { replace: true });
    else { appStore.set('activeProfile', null); location.hash = '#/pick'; location.reload(); }
  };
  add(el, Button({ label: appStore.get('activeProfile') ? 'Go to Today' : 'Choose a profile', kind: 'primary', block: true, onClick: done }));
  return el;
}
