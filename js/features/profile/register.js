// S01 Profile picker and first run. Needs no profile (D-042). (A4)
import { registerScreen } from '../../core/router.js';
import { pickerScreen } from './picker.js';

registerScreen('/pick', pickerScreen, { root: 'pick', title: 'Choose profile', chrome: 'bare', requiresProfile: false });
