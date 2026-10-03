// S11 Custom food form, S12 Recipe builder, S13 My foods manager (A5). The Add food sheet and the Food tab discover these through routeExists().
import { registerScreen, registerSheet } from '../../core/router.js';
import { customFoodSheet } from './custom-food.js';
import { recipeSheet } from './recipe-builder.js';
import { manageScreen } from './my-foods.js';

registerSheet('/food/custom/:id?', customFoodSheet, { parent: '/food' });
registerSheet('/food/recipe/:id?', recipeSheet, { parent: '/food' });
registerScreen('/food/manage', manageScreen, { root: 'food', title: 'My foods' });
registerSheet('/food/manage/food/:id?', customFoodSheet, { parent: '/food/manage' });
registerSheet('/food/manage/recipe/:id?', recipeSheet, { parent: '/food/manage' });
