// S17 Plans list, S18 Plan editor, S19 Exercise library, S20 Exercise detail/form, S21 Past session (read-only). (A5)
// S21 uses /workout/view/:logId and never /workout/session/:logId, which A4 owns and keeps editable (F-A4-07).
import { registerScreen } from '../../core/router.js';
import { plansScreen } from './plans-list.js';
import { planEditorScreen } from './plan-editor.js';
import { exercisesScreen } from './exercise-library.js';
import { exerciseScreen } from './exercise-form.js';
import { pastSessionScreen } from './past-session.js';

registerScreen('/workout/plans', plansScreen, { root: 'workout', title: 'Plans' });
registerScreen('/workout/plan/:id', planEditorScreen, { root: 'workout', title: 'Plan' });
registerScreen('/workout/exercises', exercisesScreen, { root: 'workout', title: 'Exercise library' });
registerScreen('/workout/exercise/:id', exerciseScreen, { root: 'workout', title: 'Exercise' });
registerScreen('/workout/view/:logId', pastSessionScreen, { root: 'workout', title: 'Past workout' });
