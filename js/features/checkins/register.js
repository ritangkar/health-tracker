// S25 Progress hub, S26 Check-in wizard, S27 Check-in detail, check-in due banner. S28 Compare is in photos/register.js. (A5)
// A6 registers /progress/trends and /progress/notes; the hub links to them when they exist.
import { registerScreen } from '../../core/router.js';
import { progressScreen } from './progress-hub.js';
import { wizardScreen } from './wizard.js';
import { detailScreen } from './detail.js';
import { installCheckinBanner } from './banner.js';

registerScreen('/progress', progressScreen, { root: 'progress', title: 'Progress' });
registerScreen('/progress/checkin/new', wizardScreen, { root: 'progress', title: 'New check-in' });
registerScreen('/progress/checkin/new/step/:n', wizardScreen, { root: 'progress', title: 'New check-in', where: { n: /^\d+$/ } });
registerScreen('/progress/checkin/:id', detailScreen, { root: 'progress', title: 'Check-in', where: { id: /^(?!new$)[A-Za-z0-9_-]+$/ } });
installCheckinBanner();
