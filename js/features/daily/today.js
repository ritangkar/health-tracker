// S02 Today: dashboard per D-044. Header, calories ring, macro bars, tiles, per-meal breakdown, sticky quick actions. (A4)
import { h, mount, reportWriteError, logError } from '../../core/dom.js';
import { Ring, Card, Chip, Button, MetricTile, DateNavigator, EmptyState, EstimateBadge, toast } from '../../ui/components.js';
import { getDay, getFoodLogs, getWorkoutLogs, getSleep, getSettings, addWater } from '../../core/repo.js';
import { dayTotals, resolveTargets, waterDerived, stepsPercent } from '../../core/calc.js';
import { todayKey, formatDay } from '../../core/dates.js';
import { DASH, fmtNum, fmtDuration, fmtLitres } from '../../core/units.js';
import { dateHash, todayPath, meals, r1, hardMessages, add } from './shared.js';
import { macroBars } from './summary.js';

const GOAL_SOURCE = { plan: 'from your workout plan', manual: 'set by you for this day', default: 'your default' };

async function load(pid, date) {
  const [settings, day, foods, workouts, sleep] = await Promise.all([getSettings(pid), getDay(pid, date), getFoodLogs(pid, date), getWorkoutLogs(pid, date), getSleep(pid, date)]);
  return { settings, day, foods, workouts, sleep, targets: resolveTargets(settings.targetsHistory, date), totals: dayTotals(foods) };
}

/** D-071: sessions with no entries are Not started and left out; rest sessions are Rest day. */
export function workoutSummary(workouts) {
  if (!workouts.length) return { value: null, sub: 'No workout yet', kcal: null };
  const kc = workouts.map((w) => w.kcalTotal).filter((k) => k != null);
  const kcal = kc.length ? r1(kc.reduce((a, b) => a + b, 0)) : null;
  const real = workouts.filter((w) => !w.isRest);
  if (!real.length) return { value: 'Rest day', sub: 'Rest recorded', kcal: null };
  const pcts = real.map((w) => w.completionPct).filter((p) => p != null);
  const names = real.map((w) => w.planName).join(', ');
  if (!pcts.length) return { value: 'Not started', sub: names, kcal };
  return { value: `${Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)}`, unit: '%', sub: names, kcal };
}


/** The water tile alone, so +1 can replace just this tile (F-A11-07: no whole-screen rebuild, focus and scroll stay). */
function makeWaterTile(day, settings, t, ctx) {
    const glasses = day && day.water ? day.water.glasses : null; const glassMl = day && day.water && day.water.glassMl ? day.water.glassMl : settings.glassMl;
    const wd = waterDerived(glasses, glassMl, t ? t.waterMl : null);
    const tile = MetricTile({ label: 'Water', value: wd.litres == null ? null : fmtNum(wd.litres, 2), unit: 'L', icon: 'water', tone: 'water',
      sub: glasses == null ? `No water yet${t && t.waterMl ? `. Target ${fmtLitres(t.waterMl)}` : ''}` : `${glasses} ${glasses === 1 ? 'glass' : 'glasses'}, ${fmtNum(wd.ml)} ml${wd.pct != null ? `, ${wd.pct}% of ${fmtLitres(t.waterMl)}` : ''}`,
      actions: [{ label: '+1 glass', icon: 'plus', ariaLabel: 'Add one glass of water', onClick: () => ctx.bumpWater(1) }, { label: '\u2212\u00BD', ariaLabel: 'Remove half a glass of water', onClick: () => ctx.bumpWater(-0.5), kind: 'secondary' }, { label: 'Edit', ariaLabel: 'Edit water', onClick: () => ctx.navigate(ctx.sheet('water')) }] });
    if (!(glasses > 0)) tile.querySelectorAll('.tile-actions button')[1].disabled = true;
    return tile;
}

export async function todayScreen(ctx) {
  const { pid, date } = ctx; const isToday = date === todayKey();
  const el = h('section', { class: 'screen today' });
  let alive = true; ctx.onCleanup(() => { alive = false; });
  const sheet = (kind) => todayPath(date, `/sheet/${kind}`);

  let waterRef = null; let lastD = null;
  const api = { bumpWater: (dl) => bumpWater(dl), navigate: (h2) => ctx.navigate(h2), sheet };
  async function bumpWater(delta) {
    try { await addWater(pid, date, delta); } catch (e) { const m = hardMessages(e); if (m) toast(m[0].message); else reportWriteError(e); return; }
    if (!waterRef || !lastD) { await paint(); return; }
    let day; try { day = await getDay(pid, date); } catch (e) { logError(e, 'today water'); await paint(); return; }
    if (!alive) return;
    lastD.day = day;
    const fresh = makeWaterTile(day, lastD.settings, lastD.targets, api);
    waterRef.replaceWith(fresh); waterRef = fresh;
    const btn = fresh.querySelectorAll('.tile-actions button')[delta > 0 ? 0 : 1];
    if (btn && !btn.disabled) btn.focus(); else { const alt = fresh.querySelector('.tile-actions button'); if (alt) alt.focus(); }
  }
  function view(d) {
    const t = d.targets; const { totals, day, sleep } = d; const none = totals.count === 0;
    const tk = t && t.kcal != null ? t.kcal : null;
    // calories hero
    const remaining = tk != null && !none ? tk - totals.kcal : null;
    const ringSummary = none ? 'Calories: no food logged yet' : tk != null ? `Calories: ${fmtNum(Math.round(totals.kcal))} of ${fmtNum(tk)} kcal${remaining < 0 ? `, ${fmtNum(Math.round(-remaining))} over` : `, ${fmtNum(Math.round(remaining))} remaining`}` : `Calories: ${fmtNum(Math.round(totals.kcal))} kcal, no target set`;
    const ring = Ring({ value: none ? null : totals.kcal, max: tk || 1, size: 168, tone: 'kcal', label: 'Calories', centerTop: none ? DASH : fmtNum(Math.round(totals.kcal)), centerBottom: tk != null ? `of ${fmtNum(tk)} kcal` : 'kcal', summary: ringSummary });
    const heroText = h('div', { class: 'hero-text stack-sm' });
    add(heroText, h('h2', { class: 'hero-title' }, 'Calories'));
    if (none) add(heroText, h('p', { class: 'muted' }, 'No food logged yet'), Button({ label: 'Add food', kind: 'primary', icon: 'plus', href: dateHash('/food/add', date, { from: 'today' }) }));
    else if (tk == null) add(heroText, h('p', { class: 'muted' }, 'No calorie target set.'), Button({ label: 'Set targets', kind: 'secondary', href: '#/settings/targets' }));
    else add(heroText, h('p', { class: 'hero-remaining' }, remaining >= 0 ? `${fmtNum(Math.round(remaining))} kcal remaining` : `+${fmtNum(Math.round(-remaining))} over`));
    const hero = h('section', { class: 'card hero', 'aria-label': 'Calories' }, h('div', { class: 'hero-ring' }, ring), heroText);
    const macros = Card({ title: 'Macros', children: [macroBars(totals, t)] });

    // steps
    const steps = day && day.steps ? day.steps.count : null;
    const goal = day && day.stepGoal ? day.stepGoal : d.settings.defaultStepGoal;
    const src = day && day.stepGoal ? day.stepGoalSource : 'default';
    const sp = stepsPercent(steps, goal);
    const stepsTile = MetricTile({ label: 'Steps', value: steps == null ? null : fmtNum(steps), icon: 'steps', tone: 'steps',
      sub: steps == null ? `No steps yet. Goal ${fmtNum(goal)} (${GOAL_SOURCE[src] || 'your default'})` : `${sp}% of ${fmtNum(goal)} (${GOAL_SOURCE[src] || 'your default'})`,
      actions: [{ label: 'Edit', icon: 'edit', ariaLabel: 'Edit steps', onClick: () => ctx.navigate(sheet('steps')) }] });
    // water
    const waterTile = makeWaterTile(day, d.settings, t, api);
    waterRef = waterTile;
    // sleep
    const sleepTile = MetricTile({ label: 'Sleep', value: sleep ? fmtDuration(sleep.durationMin) : null, icon: 'moon', tone: 'sleep',
      sub: sleep ? [sleep.quality ? `Quality ${sleep.quality} of 5` : null, sleep.napMin ? `Nap ${fmtDuration(sleep.napMin)}` : null].filter(Boolean).join(' \u00B7 ') || 'Tap to edit' : 'No sleep logged. Tap to add', onClick: () => ctx.navigate(sheet('sleep')) });
    // workout
    const ws = workoutSummary(d.workouts);
    const workoutTile = MetricTile({ label: 'Workout', value: ws.value, unit: ws.unit, icon: 'dumbbell', tone: 'primary', sub: ws.sub, href: dateHash('/workout', date) });
    // exercise kcal estimate
    const kcalTile = MetricTile({ label: 'Exercise calories', value: ws.kcal == null ? null : `~${fmtNum(Math.round(ws.kcal))}`, unit: 'kcal', icon: 'flame', tone: 'kcal', sub: ws.kcal == null ? 'Shown once you log a workout' : 'Estimate from your workouts', badge: ws.kcal == null ? null : EstimateBadge({ kind: 'est' }) });
    const tiles = h('div', { class: 'tiles' }, stepsTile, waterTile, sleepTile, workoutTile, kcalTile);

    // note
    const noteRow = h('div', { class: 'row-wrap note-row' });
    if (day && day.note && (day.note.text || (day.note.tags || []).length)) {
      const txt = (day.note.text || '').trim();
      add(noteRow, Chip({ label: txt ? `Note: ${txt.length > 40 ? `${txt.slice(0, 40)}\u2026` : txt}` : 'Note', icon: 'note', onClick: () => ctx.navigate(sheet('note')) }), ...(day.note.tags || []).map((tg) => Chip({ label: tg })));
    } else add(noteRow, Chip({ label: 'Add a note', icon: 'note', onClick: () => ctx.navigate(sheet('note')) }));

    // per meal
    const order = meals(); const byMeal = totals.byMeal || {};
    const rows = []; const seen = new Set();
    for (const m of order) { const b = byMeal[m.id]; if (b) { rows.push({ id: m.id, label: m.label, b }); seen.add(m.id); } }
    for (const [id, b] of Object.entries(byMeal)) if (!seen.has(id)) rows.push({ id, label: b.label, b });
    const mealCard = none
      ? Card({ title: 'Meals', children: [EmptyState({ icon: 'food', title: 'Nothing logged yet', text: 'Add what you eat and it will show up here by meal.', action: { label: 'Add food', href: dateHash('/food/add', date, { from: 'today' }) } })] })
      : Card({ title: 'Meals', children: [h('ul', { class: 'meal-list' }, rows.map((r) => h('li', { class: 'meal-row' }, h('a', { class: 'meal-link', href: dateHash('/food', date) }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, r.label), h('span', { class: 'small muted' }, ` ${r.b.count} ${r.b.count === 1 ? 'item' : 'items'}`)), h('span', { class: 'num' }, `${fmtNum(Math.round(r.b.kcal))} kcal`)))))] });

    const quick = h('nav', { class: 'sticky-actions quick-actions', 'aria-label': 'Quick actions' },
      Button({ label: 'Food', icon: 'food', kind: 'primary', href: dateHash('/food/add', date, { from: 'today' }) }), Button({ label: 'Water', icon: 'water', href: sheet('water') }), Button({ label: 'Steps', icon: 'steps', href: sheet('steps') }),
      Button({ label: 'Workout', icon: 'dumbbell', href: dateHash('/workout/choose', date) }), Button({ label: 'Sleep', icon: 'moon', href: sheet('sleep') }), Button({ label: 'Note', icon: 'note', href: sheet('note') }));
    const nav = DateNavigator({ date, onChange: (dd) => ctx.replace(dd === todayKey() ? '#/today' : `#/today/${dd}`) });
    return [h('div', { class: 'screen-head' }, h('h1', null, isToday ? 'Today' : formatDay(date))), nav, hero, macros, tiles, noteRow, mealCard, quick];
  }
  async function paint() {
    let d; try { d = await load(pid, date); } catch (e) { logError(e, 'today load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load this day', text: 'Your data is safe. Go back and try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return; lastD = d; mount(el, ...view(d));
  }
  await paint();
  return el;
}
