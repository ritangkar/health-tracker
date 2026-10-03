// S36 Install and updates: iOS 3-step guide, Android Install button, Check for update, Repair app (never touches data). (A4)
import { h } from '../../core/dom.js';
import { Card, Button, ConfirmDialog, toast } from '../../ui/components.js';
import { canInstall, promptInstall, checkForUpdate, reloadForUpdate, repairApp, getSwInfo } from '../../app.js';
import { appStore } from '../../core/store.js';
import { isStandalone } from '../../core/storage-health.js';
import { pageHead, kv } from './common.js';

export async function installScreen(ctx) {
  const info = await getSwInfo(); const ios = /iPhone|iPad|iPod/.test(navigator.userAgent); const standalone = isStandalone();
  const out = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
  const installCard = standalone ? Card({ title: 'Installed', children: [h('p', null, 'Winter Arc is installed on this device.')] })
    : Card({ title: 'Install Winter Arc', children: [ios
      ? h('div', { class: 'stack' }, h('p', null, 'On iPhone and iPad, install before you create profiles. The installed app keeps its own storage, separate from Safari.'), h('ol', { class: 'steps-list stack-sm' }, h('li', null, 'Tap the Share button in Safari.'), h('li', null, 'Choose Add to Home Screen.'), h('li', null, 'Open Winter Arc from the new icon.')), h('p', { class: 'small muted' }, 'Already have data in Safari? Back it up there, then use Import a backup in the installed app.'))
      : h('div', { class: 'stack' }, h('p', null, 'Installing makes Winter Arc open faster and work offline.'), canInstall() ? Button({ label: 'Install Winter Arc', kind: 'primary', icon: 'download', onClick: async () => { const r = await promptInstall(); out.textContent = r === 'accepted' ? 'Installed.' : 'Not installed.'; } }) : h('p', { class: 'small muted' }, 'Use your browser menu and choose Install or Add to Home Screen.'))] });
  const check = Button({ label: 'Check for update', kind: 'secondary', onClick: async () => { check.disabled = true; out.textContent = 'Checking...'; const r = await checkForUpdate(); check.disabled = false; out.textContent = !r.ok ? (r.reason === 'no-service-worker' ? 'Updates are checked when the app is installed or the service worker is running.' : 'Could not check. You may be offline.') : r.updateReady ? 'An update is ready. Use Reload.' : 'You have the latest version.'; } });
  const reload = appStore.get('updateReady') ? Button({ label: 'Reload to update', kind: 'primary', onClick: reloadForUpdate }) : null;
  const repair = Button({ label: 'Repair app', kind: 'secondary', onClick: async () => { const ok = await ConfirmDialog({ title: 'Repair the app?', message: 'This refreshes the app files and offline copy. Your saved data is not touched.', confirmLabel: 'Repair', cancelLabel: 'Cancel' }); if (ok) repairApp(); } });
  return h('section', { class: 'screen screen-narrow' }, pageHead('Install and updates'), installCard,
    Card({ title: 'Updates', children: [kv([['This version', info.pageVersion], ['Service worker version', info.swVersion || (info.state === 'unsupported' ? 'Not supported here' : 'Not running yet')], ['Offline ready', info.offlineReady ? 'Yes' : 'Not yet']]), info.mismatch ? h('p', { class: 'warn-box small' }, 'The page and the offline copy are different versions. Reload to finish updating.') : null, h('div', { class: 'row-wrap' }, check, reload), out] }),
    Card({ title: 'Trouble?', children: [h('p', { class: 'small muted' }, 'If the app looks out of date or will not update, repair it. This never deletes your data.'), repair] }));
}
