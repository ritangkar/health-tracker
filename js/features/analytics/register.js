// S29 Trends and S30 Notes list. The Progress hub links to both once these routes exist (routeExists). (A6)
import { registerScreen } from '../../core/router.js';
import { trendsScreen } from './trends.js';
import { notesScreen } from './notes.js';

const metricWhere = { metric: /^[a-z][a-z0-9-]*$/ };
registerScreen('/progress/trends', trendsScreen, { root: 'progress', title: 'Trends' });
registerScreen('/progress/trends/:metric', trendsScreen, { root: 'progress', title: 'Trends', where: metricWhere });
registerScreen('/progress/notes', notesScreen, { root: 'progress', title: 'Notes' });
