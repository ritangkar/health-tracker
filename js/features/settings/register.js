// S31-S41 settings group. /settings/import, /restore and /safe-mode need no profile so a restore works on an empty database. (A4)
import { registerScreen } from '../../core/router.js';
import { settingsHub } from './hub.js';
import { targetsScreen } from './targets.js';
import { displayScreen } from './display.js';
import { backupScreen } from './backup-screen.js';
import { importScreen, restoreScreen } from './import-wizard.js';
import { storageScreen } from './storage-screen.js';
import { installScreen } from './install-screen.js';
import { aboutScreen } from './about-screen.js';
import { safeModeScreen } from './safe-mode.js';

registerScreen('/settings', settingsHub, { root: 'settings', title: 'Settings' });
registerScreen('/settings/targets', targetsScreen, { root: 'settings', title: 'Targets and defaults' });
registerScreen('/settings/display', displayScreen, { root: 'settings', title: 'Display and days' });
registerScreen('/settings/backup', backupScreen, { root: 'settings', title: 'Backup' });
registerScreen('/settings/import/:step?', importScreen, { root: 'settings', title: 'Import a backup', chrome: 'bare', requiresProfile: false, where: { step: /^\d$/ } });
registerScreen('/settings/storage', storageScreen, { root: 'settings', title: 'Storage and protection' });
registerScreen('/settings/install', installScreen, { root: 'settings', title: 'Install and updates' });
registerScreen('/settings/about', aboutScreen, { root: 'settings', title: 'Self-check and About' });
registerScreen('/restore', restoreScreen, { root: 'settings', title: 'Restore from backup', chrome: 'bare', requiresProfile: false });
registerScreen('/safe-mode', safeModeScreen, { root: 'settings', title: 'Safe mode', chrome: 'bare', requiresProfile: false });
