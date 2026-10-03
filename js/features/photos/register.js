// S28 Photo compare (A5). The image pipeline and viewer are helpers used by the check-in wizard and detail screens.
import { registerScreen } from '../../core/router.js';
import { compareScreen } from './compare.js';

registerScreen('/progress/compare', compareScreen, { root: 'progress', title: 'Compare photos' });
