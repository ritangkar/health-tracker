// S35 Storage and protection: usage bar, Protected / Not protected / Unknown, Protect my data (D-017). (A4)
import { h } from '../../core/dom.js';
import { Card, Button, toast } from '../../ui/components.js';
import { estimate, persistedStatus, requestPersist, isStandalone, getLastBackupAt, getChangesSinceBackup } from '../../core/storage-health.js';
import { pageHead, kv, fmtBytes, fmtWhen, backupAgeText } from './common.js';

export async function storageScreen(ctx) {
  const [est, status, last, changes] = await Promise.all([estimate(), persistedStatus(), getLastBackupAt(), getChangesSinceBackup()]);
  const frac = est.quota ? Math.min(1, est.usage / est.quota) : 0;
  const fill = h('span', { class: `usage-fill${est.level === 'amber' ? ' is-amber' : est.level === 'red' ? ' is-red' : ''}` }); fill.style.setProperty('--pct', `${Math.max(1, Math.round(frac * 100))}%`);
  const word = status === 'protected' ? 'Protected' : status === 'not-protected' ? 'Not protected' : 'Unknown';
  const statusEl = h('p', { class: 'row-title', role: 'status', 'aria-live': 'polite' }, word);
  const hint = h('p', { class: 'small muted' }, status === 'protected' ? 'The browser has agreed not to clear this data when space is low.' : status === 'not-protected' ? 'The browser may clear this data if the device runs low on space. Installing the app and keeping backups both help.' : 'This browser does not say whether it will keep your data. A backup file is the safe copy.');
  const protect = status === 'protected' ? null : Button({ label: 'Protect my data', kind: 'primary', icon: 'shield', onClick: async () => {
    protect.disabled = true; const s = await requestPersist(); protect.disabled = false;
    const w = s === 'protected' ? 'Protected' : s === 'not-protected' ? 'Not protected' : 'Unknown'; statusEl.textContent = w;
    toast(s === 'protected' ? 'Your data is now protected' : 'The browser did not agree. Installing the app can help, and backups are always safe.');
    if (s === 'protected') { hint.textContent = 'The browser has agreed not to clear this data when space is low.'; protect.remove(); }
  } });
  return h('section', { class: 'screen screen-narrow' }, pageHead('Storage and protection'),
    Card({ title: 'Space used by Winter Arc', children: [h('div', { class: 'usage-bar', role: 'img', 'aria-label': est.usage == null ? 'Usage not available' : `${fmtBytes(est.usage)} used of ${fmtBytes(est.quota)}` }, fill),
      h('p', { class: 'small muted' }, est.usage == null ? 'This browser does not report storage use.' : `${fmtBytes(est.usage)} used of about ${fmtBytes(est.quota)} available.`),
      est.level === 'amber' ? h('p', { class: 'warn-box small' }, 'Storage is getting full. Photos use the most space. Make a backup soon.') : est.level === 'red' ? h('p', { class: 'warn-box small' }, 'Storage is almost full. Back up now, then free some space before adding photos.') : null] }),
    Card({ title: 'Will the browser keep my data?', children: [statusEl, hint, protect, h('p', { class: 'small muted' }, isStandalone() ? 'Winter Arc is installed on this device.' : 'On iPhone, install Winter Arc to the Home Screen first. Safari can clear data from sites you do not open for about a week.')] }),
    Card({ title: 'Backup', children: [h('p', null, backupAgeText(last)), h('p', { class: 'small muted' }, last ? `${fmtWhen(last)}. ${changes} ${changes === 1 ? 'change' : 'changes'} since then.` : 'No backup has been saved yet.'), Button({ label: 'Back up my data', kind: 'secondary', icon: 'download', href: '#/settings/backup' })] }));
}
