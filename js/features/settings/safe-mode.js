// S40 Safe mode: the saved data could not be updated, so the app is read-only. Export first. (A4)
import { add } from '../daily/shared.js';
import { h, logError } from '../../core/dom.js';
import { Button, EmptyState } from '../../ui/components.js';
import { prepareBackup, shareOrDownload } from '../../core/backup.js';
import { fmtBytes } from './common.js';

export function safeModeScreen() {
  const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' }); const host = h('div', { class: 'stack-sm' });
  const prep = Button({ label: 'Prepare backup of my data', kind: 'primary', icon: 'download', block: true, onClick: async () => {
    prep.disabled = true; status.textContent = 'Preparing...';
    try {
      const p = await prepareBackup({ includePhotos: true });
      const save = Button({ label: 'Save backup', kind: 'primary', icon: 'download', block: true });
      save.addEventListener('click', () => { const r = shareOrDownload(p, { mode: 'auto' }); r.then((x) => { status.textContent = x.result === 'cancelled' ? 'Not saved.' : x.result === 'failed' ? `Not saved. ${x.error || ''}` : `Backup ${x.result}.`; }); });
      prep.replaceWith(save); status.textContent = `${p.filename} (${fmtBytes(p.size)}) is ready.`;
    } catch (e) { logError(e, 'safe-mode export'); status.textContent = 'The backup could not be prepared from this state. Your data was not changed.'; prep.disabled = false; }
  } });
  add(host, prep, status, Button({ label: 'Reload the app', kind: 'secondary', onClick: () => location.reload() }));
  return h('section', { class: 'screen screen-narrow' }, EmptyState({ icon: 'shield', title: 'Safe mode', text: 'Winter Arc could not update your saved data, so it opened read-only. Nothing was changed. Export your data first, then update the app.', headingLevel: 1 }), host);
}
