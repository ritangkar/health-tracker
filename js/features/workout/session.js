// S16 Workout session: one row per exercise with target, actual stepper, completion %, estimated kcal (D-047).
// Rows update in place, so typing in a stepper never loses focus. Completion and kcal are computed by calc.js through repo.js, never here. (A4)
import { h, mount, uid } from '../../core/dom.js';
import { Button, Card, Chip, EmptyState, EstimateBadge, FormField, MealChips, Ring, Stepper, toast } from '../../ui/components.js';
import { notFound, invalidate } from '../../core/router.js';
import { getWorkoutLog, updateWorkoutItem, markAllAsTarget, setWorkoutBodyWeight, switchWorkoutAlt, setWorkoutNote, deleteWorkoutLog, restoreWorkoutLog } from '../../core/repo.js';
import { getPlan, resolveExerciseSync } from '../../core/seed.js';
import { checkActual, checkManualPct, checkKcalOverride, checkWeight, num } from '../../core/validate.js';
import { formatDay } from '../../core/dates.js';
import { DASH, fmtNum } from '../../core/units.js';
import { STALE_WEIGHT_DAYS } from '../../../config.js';
import { todayPath, dateHash, confirmSoft, runSave, add, ownedOrNull } from '../daily/shared.js';
import { stepFor, toUi, fromUi, targetText, unitWord, kcalText } from './common.js';

export async function sessionScreen(ctx) {
  const { pid } = ctx;
  let log = await ownedOrNull(getWorkoutLog(pid, ctx.params.logId)); if (!log) notFound();
  const resolve = await resolveExerciseSync(pid);
  let planNow = null; try { planNow = await getPlan(log.planRef, pid); } catch { planNow = null; }
  const el = h('section', { class: 'screen session-screen' });
  const rows = new Map(); const errBox = h('div', { class: 'sheet-errors', role: 'alert' });
  const say = (m) => { errBox.textContent = ''; if (m) add(errBox, h('p', { class: 'field-error' }, m)); };

  // ---------------------------------------------------------------- summary
  const summaryHost = h('div', null);
  const weightHost = h('div', { class: 'stack-sm' });
  function weightLine() {
    const kg = fmtNum(log.bodyWeightKg, 1);
    if (log.weightSource === 'default') return `Using ${kg} kg (default). Add your weight for better estimates.`;
    if (log.weightSource === 'manual') return `Using ${kg} kg (entered for this workout).`;
    return `Using ${kg} kg from ${log.weightDate ? formatDay(log.weightDate) : 'your latest weigh-in'}.${log.weightStale ? ` That is over ${STALE_WEIGHT_DAYS} days old.` : ''}`;
  }
  function paintWeight() {
    weightHost.textContent = '';
    const edit = Button({ label: log.weightSource === 'default' ? 'Set weight' : 'Change weight', kind: 'ghost', size: 'sm', icon: 'edit', onClick: () => openWeight() });
    add(weightHost, h('div', { class: 'row-wrap' }, h('span', { class: 'small muted' }, weightLine()), log.weightSource === 'default' || log.weightStale ? EstimateBadge({ kind: 'approx', text: log.weightSource === 'default' ? 'default' : 'old', explain: 'Calorie estimates scale with body weight. A recent weight makes them better.' }) : null, edit));
  }
  function openWeight() {
    weightHost.textContent = '';
    const f = FormField({ label: 'Your weight for this workout (kg)', type: 'text', inputmode: 'decimal', value: log.weightSource === 'default' ? '' : String(log.bodyWeightKg) });
    const save = Button({ label: 'Save weight', kind: 'primary', size: 'sm', onClick: async () => {
      f.setError(''); const r = checkWeight(f.input.value); if (!r.ok) { f.setError(r.hard[0].message); return; } if (!(await confirmSoft(r))) return;
      const res = await runSave(() => setWorkoutBodyWeight(pid, log.id, r.value), (l) => f.setError(l[0].message)); if (res.ok) { applyLog(res.value); toast('Weight saved for this workout'); }
    } });
    add(weightHost, h('div', { class: 'ex-inline' }, f, save, Button({ label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => paintWeight() })));
    f.input.focus();
  }
  function paintSummary() {
    summaryHost.textContent = '';
    const pct = log.completionPct;
    add(summaryHost, h('div', { class: 'session-totals' },
      Ring({ value: pct, max: 100, size: 112, tone: 'primary', label: 'Workout completion', centerTop: pct == null ? DASH : `${pct}%`, centerBottom: pct == null ? 'not started' : 'complete', summary: pct == null ? 'Workout completion: not started' : `Workout completion: ${pct} percent` }),
      h('div', { class: 'stack-sm grow' }, h('p', { class: 'row-wrap' }, h('span', { class: 'big-pct num' }, log.kcalTotal == null ? DASH : kcalText(log.kcalTotal)), log.kcalTotal == null ? null : EstimateBadge({ kind: 'est' })),
        h('p', { class: 'small muted' }, log.kcalTotal == null ? 'Estimated exercise calories appear once you enter something.' : 'Estimated exercise calories. Real burn varies.'),
        log.stepGoalSnap ? h('p', { class: 'small muted' }, `Plan step goal: ${fmtNum(log.stepGoalSnap)}`) : null)));
  }
  function applyLog(next) {
    log = next;
    for (const it of log.items) { const r = rows.get(it.itemId); if (r) r.update(it); }
    paintSummary(); paintWeight();
  }

  // ---------------------------------------------------------------- rows
  function buildRow(item) {
    const ex = resolve(item.exerciseRef); const k = item.targetKind; const cfg = stepFor(k); const unit = unitWord(item, ex);
    const card = h('li', { class: 'ex-card', 'data-item': item.itemId });
    const pctEl = h('span', { class: 'ex-pct num' }); const meta = h('div', { class: 'row-wrap small' }); const editor = h('div', null);
    let cur = item;
    const setActual = async (v, stepperToRevert) => {
      say(''); const stored = fromUi(k, v); const chk = checkActual(k, stored);
      if (!chk.ok) { say(chk.hard[0].message); if (stepperToRevert) stepper.setValue(toUi(k, cur.actual)); return; }
      if (!(await confirmSoft(chk))) { if (stepperToRevert) stepper.setValue(toUi(k, cur.actual)); return; }
      const res = await runSave(() => updateWorkoutItem(pid, log.id, item.itemId, { actual: stored }), (l) => say(l[0].message));
      if (res.ok) applyLog(res.value); else stepper.setValue(toUi(k, cur.actual));
    };
    const stepper = Stepper({ value: toUi(k, item.actual), min: cfg.min, max: cfg.max, step: cfg.step, label: `Actual for ${item.exerciseName}`, unit: unit.length > 14 ? '' : unit, onChange: (v) => setActual(v, true) });
    const doneBtn = Button({ label: 'Done as target', size: 'sm', icon: 'check', onClick: () => setActual(toUi(k, item.target), false).then(() => stepper.setValue(toUi(k, item.target))) });
    const pctBtn = Button({ label: 'Set %', size: 'sm', onClick: () => openPct() }); const kcalBtn = Button({ label: 'Edit kcal', size: 'sm', onClick: () => openKcal() });
    const stretch = item.targetMax != null ? Chip({ label: `Stretch: ${fmtNum(toUi(k, item.targetMax), 2)}`, onClick: () => { setActual(toUi(k, item.targetMax), false).then(() => stepper.setValue(toUi(k, item.targetMax))); } }) : null;
    // alternatives (Running / Brisk Walking): frozen in the log
    let altNode = null;
    const opts = [...new Set([planNow && (planNow.items || []).find((i) => i.itemId === item.itemId) ? planNow.items.find((i) => i.itemId === item.itemId).exerciseId : item.exerciseRef, ...(item.altExerciseIds || [])])];
    if (opts.length > 1) {
      altNode = MealChips({ label: `Exercise for ${item.exerciseName}`, meals: opts.map((id) => ({ id, label: (resolve(id) || {}).name || id })), selected: item.exerciseRef, onChange: async (id) => {
        const exo = resolve(id); if (!exo) return; say('');
        const res = await runSave(() => switchWorkoutAlt(pid, log.id, item.itemId, exo), (l) => say(l[0].message)); if (!res.ok) return;
        log = res.value; const nit = log.items.find((i) => i.itemId === item.itemId); const nr = buildRow(nit); card.replaceWith(nr.el); rows.set(item.itemId, nr); applyLog(log);
      } });
    }
    function update(it) {
      cur = it; pctEl.textContent = it.pct == null ? DASH : `${it.pct}%`; pctEl.setAttribute('aria-label', it.pct == null ? 'Not entered' : `${it.pct} percent complete`);
      meta.textContent = '';
      add(meta, h('span', { class: 'muted' }, it.pct == null ? 'Not entered' : it.pctSource === 'manual' ? 'Completion set by you' : 'Completion from your actual'));
      add(meta, h('span', { class: 'muted num' }, it.kcalFinal == null ? `Calories ${DASH}` : kcalText(it.kcalFinal)));
      if (it.kcalFinal != null) add(meta, EstimateBadge({ kind: 'est' }));
      if (it.kcalLogOverride != null) add(meta, Chip({ label: 'edited' }));
      if (it.manualPct != null) add(meta, Chip({ label: 'manual %' }));
      pctBtn.querySelector('span').textContent = it.manualPct != null ? 'Edit %' : 'Set %';
      const want = toUi(k, it.actual); if (stepper.getValue() !== want) stepper.setValue(want);
    }
    function closeEditor() { editor.textContent = ''; }
    function openPct() {
      editor.textContent = '';
      const f = FormField({ label: 'Completion, 0 to 100', type: 'text', inputmode: 'numeric', value: cur.manualPct == null ? '' : String(cur.manualPct), hint: 'Use this when reps or time do not fit, for example a partial set.' });
      const apply = async (val) => { f.setError(''); const r = checkManualPct(val); if (!r.ok) { f.setError(r.hard[0].message); return; } const res = await runSave(() => updateWorkoutItem(pid, log.id, item.itemId, { manualPct: r.value }), (l) => f.setError(l[0].message)); if (res.ok) { applyLog(res.value); closeEditor(); } };
      add(editor, h('div', { class: 'ex-inline' }, f, Button({ label: 'Set', kind: 'primary', size: 'sm', onClick: () => apply(f.input.value.trim() === '' ? null : f.input.value) }), cur.manualPct != null ? Button({ label: 'Clear manual', size: 'sm', onClick: () => apply(null) }) : null, Button({ label: 'Cancel', kind: 'ghost', size: 'sm', onClick: closeEditor })));
      f.input.focus();
    }
    function openKcal() {
      editor.textContent = '';
      const f = FormField({ label: 'Calories for this exercise (kcal)', type: 'text', inputmode: 'decimal', value: cur.kcalLogOverride != null ? String(cur.kcalLogOverride) : cur.kcalEst != null ? String(cur.kcalEst) : '', hint: 'Your own number replaces the estimate for this workout only.' });
      const apply = async (val) => { f.setError(''); const r = checkKcalOverride(val); if (!r.ok) { f.setError(r.hard[0].message); return; } const res = await runSave(() => updateWorkoutItem(pid, log.id, item.itemId, { kcalLogOverride: r.value }), (l) => f.setError(l[0].message)); if (res.ok) { applyLog(res.value); closeEditor(); } };
      add(editor, h('div', { class: 'ex-inline' }, f, Button({ label: 'Set', kind: 'primary', size: 'sm', onClick: () => apply(f.input.value.trim() === '' ? null : f.input.value) }), cur.kcalLogOverride != null ? Button({ label: 'Use estimate', size: 'sm', onClick: () => apply(null) }) : null, Button({ label: 'Cancel', kind: 'ghost', size: 'sm', onClick: closeEditor })));
      f.input.focus();
    }
    add(card, h('div', { class: 'ex-top' }, h('div', { class: 'stack-sm grow' }, h('p', { class: 'ex-name' }, item.exerciseName), h('p', { class: 'ex-target small' }, `Target: ${targetText(item, ex)}`)), pctEl),
      altNode ? h('div', { class: 'field' }, h('span', { class: 'field-label small' }, 'Which one did you do?'), altNode) : null,
      stepper, h('div', { class: 'ex-actions' }, doneBtn, stretch, pctBtn, kcalBtn), meta, editor);
    update(item);
    return { el: card, update };
  }

  // ---------------------------------------------------------------- page
  const head = h('div', { class: 'session-head' }, h('div', { class: 'screen-head' }, h('h1', null, log.planName), Button({ label: 'Done', kind: 'primary', icon: 'check', onClick: () => ctx.navigate(todayPath(log.date)) })),
    h('p', { class: 'muted small' }, `${formatDay(log.date)}. Changes to a plan never change this workout.`));
  const list = h('ul', { class: 'ex-list' });
  for (const it of log.items) { const r = buildRow(it); rows.set(it.itemId, r); add(list, r.el); }
  const markAll = log.items.length ? Button({ label: 'Mark all as target', icon: 'check', onClick: async () => { say(''); const res = await runSave(() => markAllAsTarget(pid, log.id), (l) => say(l[0].message)); if (res.ok) applyLog(res.value); } }) : null;
  const note = FormField({ label: 'Session note (optional)', control: h('textarea', { class: 'input', rows: 2, maxlength: 500 }, log.note || '') });
  note.input.addEventListener('blur', async () => { const v = note.input.value.trim() || null; if (v === (log.note || null)) return; const res = await runSave(() => setWorkoutNote(pid, log.id, v), (l) => note.setError(l[0].message)); if (res.ok) { log = res.value; note.setError(''); } });
  const remove = Button({ label: 'Remove this workout', kind: 'ghost', icon: 'trash', onClick: async () => {
    const res = await runSave(() => deleteWorkoutLog(pid, log.id)); if (!res.ok || !res.value) return; const rec = res.value;
    await ctx.replace(dateHash('/workout', log.date));
    toast('Workout removed', { undo: async () => { await runSave(() => restoreWorkoutLog(pid, rec)); await invalidate(); } });
  } });
  paintSummary(); paintWeight();
  mount(el, head, Card({ children: [summaryHost, log.isRest ? null : weightHost] }),
    log.isRest || !log.items.length ? EmptyState({ icon: 'moon', title: log.isRest ? 'Rest day recorded' : 'No exercises in this workout', text: log.isRest ? 'Rest is part of the plan. Your step goal for today follows the Complete Rest plan.' : 'This plan has no exercises.' }) : h('div', { class: 'stack' }, h('div', { class: 'row-wrap' }, markAll), list),
    errBox, note, h('div', { class: 'row-wrap' }, remove));
  return el;
}
