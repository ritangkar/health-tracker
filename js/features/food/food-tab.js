// S07 Food tab: day navigator, daily totals, per-meal entries with delete + Undo (D-054). (A4)
import { h, mount, reportWriteError, logError } from '../../core/dom.js';
import { Card, Button, IconButton, EmptyState, DateNavigator, EstimateBadge, toast, Chip } from '../../ui/components.js';
import { getFoodLogs, deleteFoodLog, restoreFoodLog } from '../../core/repo.js';
import { dayTotals } from '../../core/calc.js';
import { todayKey, formatDay } from '../../core/dates.js';
import { fmtNum } from '../../core/units.js';
import { dateHash, meals, settingsAndTargets, r1, routeExists } from '../daily/shared.js';
import { macroBars } from '../daily/summary.js';
import { invalidate } from '../../core/router.js';

const qtyText = (l) => `${fmtNum(l.qty, 2)} \u00D7 ${l.servingLabel}`;
const mv = (v) => (v == null ? '\u2013' : fmtNum(r1(v), 1)); // not entered shows a dash, never 0 (D-038)
const macroLine = (t) => `P ${mv(t.protein)} \u00B7 C ${mv(t.carbs)} \u00B7 F ${mv(t.fat)} g`;

export async function foodScreen(ctx) {
  const { pid, date } = ctx;
  const el = h('section', { class: 'screen food-screen' });
  let alive = true; ctx.onCleanup(() => { alive = false; });
  const order = meals();

  async function remove(log) {
    try { await deleteFoodLog(pid, log.id); } catch (e) { reportWriteError(e); return; }
    await paint();
    toast(`Removed ${log.foodName}`, { undo: async () => { try { await restoreFoodLog(pid, log); } catch (e) { reportWriteError(e); return; } await invalidate(); } });
  }
  function entryRow(l) {
    const main = h('button', { type: 'button', class: 'entry-main', 'aria-label': `Edit ${l.foodName}, ${qtyText(l)}, ${Math.round(l.totals.kcal)} kcal` },
      h('span', { class: 'entry-title' }, l.foodName),
      h('span', { class: 'small muted' }, qtyText(l)),
      h('span', { class: 'small muted' }, macroLine(l.totals)));
    main.addEventListener('click', () => ctx.navigate(dateHash(`/food/entry/${encodeURIComponent(l.id)}`, date)));
    return h('li', { class: 'entry-row' }, main, h('div', { class: 'row-side' }, h('span', { class: 'entry-kcal num' }, `${fmtNum(Math.round(l.totals.kcal))} kcal`), l.source && l.source.type === 'label' ? Chip({ label: 'from label' }) : null, l.confidence === 'estimate' ? EstimateBadge({ kind: 'est' }) : null),
      IconButton({ icon: 'trash', label: `Remove ${l.foodName}`, onClick: () => remove(l) }));
  }
  function mealCard(m, logs) {
    const kcal = logs.reduce((a, l) => a + l.totals.kcal, 0);
    return h('section', { class: 'card meal-card', 'aria-label': m.label },
      h('div', { class: 'meal-head' }, h('h2', { class: 'card-title' }, m.label), logs.length ? h('span', { class: 'small muted num' }, `${fmtNum(Math.round(kcal))} kcal`) : null),
      logs.length ? h('ul', { class: 'entry-list' }, logs.map(entryRow)) : h('p', { class: 'muted small' }, 'No food yet'),
      Button({ label: `Add to ${m.label}`, icon: 'plus', kind: logs.length ? 'ghost' : 'secondary', size: 'sm', href: dateHash('/food/add', date, { meal: m.id }) }));
  }
  async function paint() {
    let logs, st, hasManage;
    try { [logs, st, hasManage] = await Promise.all([getFoodLogs(pid, date), settingsAndTargets(pid, date), routeExists('/food/manage')]); } catch (e) { logError(e, 'food load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load food', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return;
    logs.sort((a, b) => (a.loggedAt || 0) - (b.loggedAt || 0));
    const totals = dayTotals(logs); const t = st.targets; const none = totals.count === 0;
    const byMeal = new Map(); for (const l of logs) { const k = l.mealId || 'meal:other'; if (!byMeal.has(k)) byMeal.set(k, []); byMeal.get(k).push(l); }
    const cards = order.map((m) => mealCard(m, byMeal.get(m.id) || []));
    for (const [id, list] of byMeal) if (!order.some((m) => m.id === id)) cards.push(mealCard({ id, label: list[0].mealLabel || 'Other' }, list));
    const kcalLine = none ? h('p', { class: 'muted' }, 'No food logged yet') : h('p', null, h('span', { class: 'big-num' }, fmtNum(Math.round(totals.kcal))), h('span', { class: 'muted' }, t && t.kcal != null ? ` of ${fmtNum(t.kcal)} kcal${totals.kcal > t.kcal ? ` \u00B7 +${fmtNum(Math.round(totals.kcal - t.kcal))} over` : ''}` : ' kcal'));
    const summary = Card({ title: 'Daily total', cls: 'food-summary', children: [kcalLine, macroBars(totals, t)] });
    const dateNav = DateNavigator({ date, onChange: (d) => ctx.replace(d === todayKey() ? '#/food' : `#/food?d=${d}`) });
    mount(el, h('div', { class: 'food-head' }, h('h1', null, date === todayKey() ? 'Food' : `Food, ${formatDay(date)}`), Button({ label: 'Add food', icon: 'plus', kind: 'primary', href: dateHash('/food/add', date) })), dateNav,
      h('div', { class: 'two-col food-cols' }, summary, h('div', { class: 'stack food-meals' }, none ? EmptyState({ icon: 'food', title: 'No food yet', text: 'Search the food list, pick a serving and it is logged in a few taps.', action: { label: 'Add food', href: dateHash('/food/add', date) } }) : null, cards)),
      hasManage ? h('div', { class: 'row-wrap' }, Button({ label: 'My foods and recipes', icon: 'edit', kind: 'secondary', size: 'sm', href: '#/food/manage' })) : null, // F-A5-04
      h('p', { class: 'small muted disclaimer' }, 'Calories and nutrients are typical values. ', h('a', { href: '#/settings/about' }, 'Values are approximate'), '. Estimates carry an est. tag.'));
  }
  await paint();
  return el;
}
