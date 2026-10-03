// Living style guide and screenshot target for the shell (A3). Not precached. Needs no data and no database.
import { h, mount } from '../js/core/dom.js';
import * as C from '../js/ui/components.js';
import * as R from '../js/core/router.js';
import { appStore } from '../js/core/store.js';
appStore.set('activeProfile', 'p_gallery');
const shell = C.AppShell(); mount(document.getElementById('app-root'), shell.el); shell.setProfile({ name: 'Me' }, 0);
const days = (n, f) => Array.from({ length: n }, (_, i) => { const d = new Date(2025, 2, 1 + i); return { date: `2025-03-${String(d.getDate()).padStart(2, '0')}`, value: f(i) }; });
R.registerScreen('/today/:date?', () => h('section', { class: 'screen' },
  h('h1', null, 'Gallery'), C.DateNavigator({ date: '2025-03-10', onChange() {} }),
  h('div', { class: 'card stack' }, h('div', { class: 'row' }, C.Ring({ value: 1420, max: 1900, label: 'Calories', centerBottom: 'of 1,900 kcal', tone: 'kcal' }), h('div', { class: 'grow stack-sm' }, C.ProgressBar({ value: 82, max: 120, label: 'Protein', tone: 'protein' }), C.ProgressBar({ value: 150, max: 220, label: 'Carbs', tone: 'carbs' }), C.ProgressBar({ value: 45, max: 60, label: 'Fat', tone: 'fat' }), C.ProgressBar({ value: null, max: 25, label: 'Fibre', tone: 'fiber' })))),
  h('div', { class: 'tiles' }, C.MetricTile({ label: 'Steps', value: '5,830', sub: 'of 7,000', icon: 'steps', tone: 'steps' }), C.MetricTile({ label: 'Water', value: '2.5', unit: 'L', sub: 'of 3.0 L', icon: 'water', tone: 'water', actions: [{ label: '+1', onClick() {} }] }), C.MetricTile({ label: 'Sleep', value: null, sub: 'Not logged', icon: 'moon', tone: 'sleep' }), C.MetricTile({ label: 'Exercise', value: '210', unit: 'kcal', icon: 'flame', badge: C.EstimateBadge({}) })),
  h('div', { class: 'card stack' }, C.SearchField({ placeholder: 'Search foods' }), C.MealChips({ meals: [{ id: 'b', label: 'Breakfast' }, { id: 'l', label: 'Lunch' }, { id: 's', label: 'Snacks' }], selected: 'l' }), C.Stepper({ value: 1, min: 0.25, max: 50, step: 0.25, label: 'Quantity' }), C.MacroPreview({ kcal: 208, protein: 4.3, carbs: 44.8, fat: 0.5, fiber: null, estimate: true }),
    h('ul', null, C.FoodRow({ name: 'Macher jhol', detail: '1 bowl, 200 g', kcalText: '240 kcal', chips: [{ label: 'Bengali' }], estimate: true, fav: true }), C.FoodRow({ name: 'Test Rice', detail: '1 cup', kcalText: '208 kcal', fav: false }))),
  C.LineChart({ title: 'Weight', unit: 'kg', points: days(20, (i) => 72.5 - i * 0.08), endDate: '2025-03-20', range: '1M', approx: false }),
  C.BarChart({ title: 'Steps', bars: days(14, (i) => (i === 4 ? null : 4000 + i * 300)), unit: 'steps', target: 7000, tone: 'steps' }),
  h('div', { class: 'row-wrap' }, C.Button({ label: 'Add food', kind: 'primary', icon: 'plus' }), C.Button({ label: 'Delete', kind: 'danger', icon: 'trash' }), C.Button({ label: 'Later', kind: 'ghost' }), C.Chip({ label: 'Viewing 10 Mar', tone: 'warn' })),
  C.EmptyState({ icon: 'food', title: 'No food yet', text: 'Search or quick add to log your first meal.', action: { label: 'Add food' } })), { root: 'today', title: 'Gallery' });
C.banners.set('update', { kind: 'info', title: 'Update available.', text: 'Reload to use the new version.', actions: [{ label: 'Reload', onClick() {} }] });
await R.start({ outlet: shell.outlet, onRoute: (i) => { shell.setActiveRoot(i.root); } });
window.__galleryReady = true;
