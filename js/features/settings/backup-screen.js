// S33 Backup: Prepare, then Share/Save in a SEPARATE tap with no await before the share call (DAT-018, R-019). (A4)
import { add } from '../daily/shared.js';
import { h, mount, uid, logError } from '../../core/dom.js';
import { Card, Button, FormField, ProgressList } from '../../ui/components.js';
import { estimateBackup, prepareBackup, shareOrDownload, canShareFiles } from '../../core/backup.js';
import { getLastBackupAt, getChangesSinceBackup } from '../../core/storage-health.js';
import { refreshBanners } from '../../app.js';
import { pageHead, fmtBytes, fmtWhen, backupAgeText } from './common.js';

export async function backupScreen(ctx) {
  const [est, last, changes] = await Promise.all([estimateBackup(), getLastBackupAt(), getChangesSinceBackup()]);
  const host = h('div', { class: 'stack' }); let alive = true; ctx.onCleanup(() => { alive = false; });
  let includePhotos = true; let prepared = null;
  const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
  const hasPhotos = est.photoCount > 0;

  function intro() {
    host.textContent = ''; prepared = null; status.textContent = '';
    const cb = h('input', { type: 'checkbox', id: uid('inc'), checked: includePhotos, disabled: !hasPhotos }); cb.addEventListener('change', () => { includePhotos = cb.checked; });
    const sizeLine = hasPhotos ? `About ${fmtBytes(est.totalBytes)} with photos (${est.photoCount}), or ${fmtBytes(est.jsonBytes)} without.` : `About ${fmtBytes(est.jsonBytes)}. No photos saved yet.`;
    const prep = Button({ label: 'Prepare backup', kind: 'primary', icon: 'download', block: true, onClick: () => prepare(prep) });
    add(host, 
      Card({ title: 'Your last backup', children: [h('p', null, backupAgeText(last)), h('p', { class: 'small muted' }, last ? `${fmtWhen(last)}. ${changes} ${changes === 1 ? 'change' : 'changes'} since then.` : 'A backup file is the only copy that survives if this browser clears its data.')] }),
      h('div', { class: 'warn-box' }, h('strong', null, 'Before you save: '), 'This file contains both profiles and all photos. It is not encrypted. Keep it somewhere private.'),
      Card({ title: 'What to include', children: [h('label', { class: 'row check-row', htmlFor: cb.id }, cb, h('span', null, `Include photos${hasPhotos ? ` (${fmtBytes(est.photoBytes)})` : ''}`)), h('p', { class: 'small muted' }, sizeLine), est.warnLarge && includePhotos ? h('p', { class: 'small warn-box' }, 'This backup is large. Saving to a cloud folder or sharing by email may fail. Choose "without photos" for a smaller file.') : null] }),
      prep, status,
      h('p', { class: 'small muted' }, 'Export one profile: coming later.'));
  }
  async function prepare(btn) {
    btn.disabled = true; status.textContent = 'Preparing your backup...'; let item = [{ label: 'Collecting your data', status: 'active' }];
    try {
      prepared = await prepareBackup({ includePhotos, onProgress: (p) => { if (alive && p && p.phase === 'photos') status.textContent = `Adding photo ${p.done} of ${p.total}...`; } });
    } catch (e) { logError(e, 'prepare backup'); if (alive) { status.textContent = 'The backup could not be prepared. Your data is unchanged. Try again, or choose without photos.'; btn.disabled = false; } return; }
    if (!alive) return; ready();
  }
  function ready() {
    host.textContent = '';
    const share = canShareFiles(prepared.file);
    const saveBtn = Button({ label: share ? 'Share or save backup' : 'Save backup', kind: 'primary', icon: share ? 'share' : 'download', block: true });
    // The share call is the first thing in the handler: no await before it, so the browser still counts it as a tap.
    saveBtn.addEventListener('click', () => { const p = shareOrDownload(prepared, { mode: 'auto' }); saveBtn.disabled = true; finish(p, saveBtn); });
    add(host, Card({ title: 'Backup ready', children: [h('p', null, prepared.filename), h('p', { class: 'small muted' }, `${fmtBytes(prepared.size)}${prepared.includesPhotos ? `, ${prepared.photoCount} photos included` : ', no photo files'}.`), prepared.hashAlgo === 'crc32' ? h('p', { class: 'small muted' }, 'This browser could not compute strong checksums, so a simpler check was used.') : null] }),
      h('div', { class: 'warn-box' }, 'This file contains both profiles and all photos. It is not encrypted. Keep it somewhere private.'), saveBtn, Button({ label: 'Start over', kind: 'ghost', onClick: () => { intro(); } }), status);
  }
  async function finish(promise, btn) {
    let r; try { r = await promise; } catch (e) { r = { result: 'failed', error: String(e && e.message || e) }; }
    if (!alive) return; btn.disabled = false;
    if (r.result === 'shared') status.textContent = 'Backup shared.'; else if (r.result === 'downloaded') status.textContent = 'Backup downloaded. Check your Downloads folder.';
    else if (r.result === 'cancelled') status.textContent = 'Not saved. The backup was not saved, so your last-backup date did not change.'; else status.textContent = `Not saved. ${r.error || ''}`.trim();
    if (r.recorded) { refreshBanners(); const l = await getLastBackupAt(); const lead = host.querySelector('.card-title'); if (lead) lead.textContent = `Backup ready. ${backupAgeText(l)}.`; }
  }
  intro();
  return h('section', { class: 'screen screen-narrow' }, pageHead('Back up my data'), host, h('p', { class: 'small muted' }, 'To restore, use Import a backup in Settings. A backup also lets you move your data to a new phone.'));
}
