// S07 Food tab, S08 Add food (search + serving), S09 Quick add, S10 Edit entry. S11-S13 belong to A5 (register-w2.js). (A4)
import { registerScreen, registerSheet } from '../../core/router.js';
import { foodScreen } from './food-tab.js';
import { addFoodSheet, servingSheet } from './add-food.js';
import { quickAddSheet } from './quick-add.js';
import { entrySheet } from './entry-edit.js';

registerScreen('/food', foodScreen, { root: 'food', title: 'Food' });
registerSheet('/food/add', addFoodSheet, { parent: '/food' });
registerSheet('/food/add/serving/:foodRef', servingSheet, { parent: '/food' });
registerSheet('/food/quick', quickAddSheet, { parent: '/food' });
registerSheet('/food/entry/:logId', entrySheet, { parent: '/food' });
