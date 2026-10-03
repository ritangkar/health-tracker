// S14 Workout tab, S15 Choose workout, S16 Workout session. S17-S21 belong to A5 (register-w2.js). (A4)
// Note for A5: S21 (read-only past session) must use its own pattern, for example '/workout/view/:logId'. '/workout/session/:logId' is the editable session.
import { registerScreen } from '../../core/router.js';
import { workoutScreen } from './workout-tab.js';
import { chooseScreen } from './choose.js';
import { sessionScreen } from './session.js';

registerScreen('/workout', workoutScreen, { root: 'workout', title: 'Workout' });
registerScreen('/workout/choose', chooseScreen, { root: 'workout', title: 'Choose workout' });
registerScreen('/workout/session/:logId', sessionScreen, { root: 'workout', title: 'Workout session' });
