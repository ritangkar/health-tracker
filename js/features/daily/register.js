// S02 Today and S03-S06 sheets (water, steps, sleep, note). Dated variants use #/today/YYYY-MM-DD. (A4)
import { registerScreen, registerSheet } from '../../core/router.js';
import { todayScreen } from './today.js';
import { waterSheet, stepsSheet, sleepSheet, noteSheet } from './sheets.js';

const DATE = { date: /^\d{4}-\d{2}-\d{2}$/ };
registerScreen('/today/:date?', todayScreen, { root: 'today', title: 'Today', where: DATE });
for (const [kind, factory] of [['water', waterSheet], ['steps', stepsSheet], ['sleep', sleepSheet], ['note', noteSheet]]) {
  registerSheet(`/today/sheet/${kind}`, factory, { parent: '/today' });
  registerSheet(`/today/:date/sheet/${kind}`, factory, { parent: '/today/:date', where: DATE });
}
