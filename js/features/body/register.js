// S22 Body hub, S23 Add measurement (sheet), S24 Measurement graph. (A5)
import { registerScreen, registerSheet } from '../../core/router.js';
import { bodyScreen } from './body-hub.js';
import { graphScreen } from './measurement-graph.js';
import { measurementSheet } from './add-measurement.js';

const typeWhere = { typeId: /^(?!add$)[A-Za-z0-9_-]+$/ };
registerScreen('/body', bodyScreen, { root: 'body', title: 'Body' });
registerScreen('/body/:typeId', graphScreen, { root: 'body', title: 'Measurement', where: typeWhere });
registerSheet('/body/add', measurementSheet, { parent: '/body' });
registerSheet('/body/:typeId/add', measurementSheet, { parent: '/body/:typeId', where: typeWhere });
registerSheet('/body/:typeId/edit/:id', measurementSheet, { parent: '/body/:typeId', where: typeWhere });
