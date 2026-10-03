// S31 Settings hub (D-061): grouped links with live status, Switch profile, privacy text, "Export one profile: coming later". (A4)
import { h, mount } from '../../core/dom.js';
import { Card, Button, Chip } from '../../ui/components.js';
import { icon } from '../../ui/icons.js';
import { switchProfile } from '../../core/router.js';
import { listProfiles } from '../../core/repo.js';
import { getLastBackupAt, persistedStatus, isStandalone } from '../../core/storage-health.js';
import { appStore } from '../../core/store.js';
import { NO_PIN_TEXT } from '../profile/picker.js';
import { pageHead, backupAgeText } from './common.js';

const link = (href, title, sub, ic) => h('a', { class: 'settings-link', href }, ic ? icon(ic, { size: 22 }) : null, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'small muted' }, sub) : null), icon('forward', { size: 18 }));

export async function settingsHub(ctx) {
  const pid = ctx.pid; const [profiles, last, persisted] = await Promise.all([listProfiles(), getLastBackupAt(), persistedStatus()]);
  const me = profiles.find((p) => p.id === pid);
  const prot = persisted === 'protected' ? 'Protected' : persisted === 'not-protected' ? 'Not protected' : 'Unknown';
  const upd = appStore.get('updateReady');
  const group = (title, ...links) => Card({ title, children: [h('div', { class: 'settings-group' }, links)] });
  return h('section', { class: 'screen screen-narrow settings-hub' },
    pageHead('Settings', null),
    h('div', { class: 'card row' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, me ? me.name : 'Profile'), h('span', { class: 'small muted' }, ' is open on this device')), Button({ label: 'Switch profile', icon: 'user', onClick: () => switchProfile() })),
    group('Profile and targets', link('#/settings/targets', 'Targets and defaults', 'Calories, macros, water, steps, profile name', 'flame')),
    group('Days and display', link('#/settings/display', 'Display and days', 'Theme, week start, reminders', 'calendar')),
    group('Food and exercise data', link('#/food', 'Foods and recipes', 'Open the Food tab to add or log foods', 'food'), link('#/workout', 'Plans and exercises', 'Open the Workout tab', 'dumbbell')),
    group('Backup and restore', link('#/settings/backup', 'Back up my data', backupAgeText(last), 'download'), link('#/settings/import', 'Import a backup', 'Merge or replace from a backup file', 'upload'), h('p', { class: 'small muted settings-note' }, 'Export one profile: coming later.')),
    group('Storage and protection', link('#/settings/storage', 'Storage and protection', prot, 'shield')),
    group('Install and updates', link('#/settings/install', 'Install and updates', upd ? 'An update is ready' : isStandalone() ? 'Installed' : 'Not installed', 'info')),
    group('Self-check and About', link('#/settings/about', 'Self-check and About', 'Version, offline readiness, data checks', 'info')),
    h('p', { class: 'small muted' }, NO_PIN_TEXT));
}
