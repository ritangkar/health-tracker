// S03 Water, S04 Steps, S05 Sleep, S06 Day note: route-backed sheets (D-045). Each saves write-through, toasts, closes with refresh. (A4)
import { h } from '../../core/dom.js';
import { Sheet, Stepper, FormField, Button, Chip, toast } from '../../ui/components.js';
import { getDay, getSleep, getSettings, setWater, setSteps, setStepGoalManual, applyPlanStepGoal, getWorkoutLogs, upsertSleep, deleteSleep, setDayNote, effectiveStepGoal } from '../../core/repo.js';
import { checkWater, checkSteps, checkStepGoal, checkSleep, checkDayNote, num, checkTime } from '../../core/validate.js';
import { resolveTargets, waterDerived } from '../../core/calc.js';
import { durationFromTimes, formatDay } from '../../core/dates.js';
import { invalidate } from '../../core/router.js';
import { fmtNum, fmtDuration, fmtLitres } from '../../core/units.js';
import { confirmSoft, runSave, bindSubmit, add } from './shared.js';
import { uid } from '../../core/dom.js';

function form(id, onSubmit, ...kids) { const f = h('form', { class: 'stack', id, novalidate: true }, kids); f.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(); }); return f; }
const errorBox = () => h('div', { class: 'sheet-errors', role: 'alert' });
function showErrors(box, list) { box.textContent = ''; if (list && list.length) add(box, h('p', { class: 'field-error' }, list.map((x) => x.message).join(' '))); }

// ---------------------------------------------------------------- S03 water
export async function waterSheet(ctx) {
  const { pid, date } = ctx;
  const [day, settings] = await Promise.all([getDay(pid, date), getSettings(pid)]);
  const glassMl = day && day.water && day.water.glassMl ? day.water.glassMl : settings.glassMl;
  const target = (resolveTargets(settings.targetsHistory, date) || {}).waterMl ?? null;
  const initial = day && day.water ? day.water.glasses : null;
  const readout = h('p', { class: 'sheet-readout', 'aria-live': 'polite' }); const errs = errorBox();
  const stepper = Stepper({ value: initial, min: 0, max: 40, step: 0.5, label: 'Glasses of water', unit: 'glasses', onChange: () => paint() });
  function paint() {
    const v = stepper.getValue(); if (v === null) { readout.textContent = 'No water logged for this day.'; return; }
    const d = waterDerived(v, glassMl, target);
    readout.textContent = `${v} ${v === 1 ? 'glass' : 'glasses'} = ${fmtNum(d.ml)} ml = ${fmtLitres(d.ml)}${d.pct != null ? `, ${d.pct}% of the ${fmtLitres(target)} target` : ''}`;
  }
  paint();
  const quick = h('div', { class: 'row-wrap' }, [1, 2].map((n) => Chip({ label: `+${n} ${n === 1 ? 'glass' : 'glasses'}`, onClick: () => { stepper.setValue(Math.min(40, (stepper.getValue() || 0) + n)); paint(); } })));
  async function save() {
    showErrors(errs, null); const v = stepper.getValue();
    if (v === null && initial === null) { ctx.close(); return; }
    const r = checkWater(v); if (!r.ok) { showErrors(errs, r.hard); return; }
    if (!(await confirmSoft(r))) return;
    const res = await runSave(() => setWater(pid, date, v), (l) => showErrors(errs, l));
    if (res.ok) { toast('Water saved'); ctx.close({ refresh: true }); }
  }
  const fid = uid('water-form');
  return Sheet({ ctx, title: 'Water', dirty: () => stepper.getValue() !== initial,
    body: form(fid, save, h('p', { class: 'muted small' }, `One glass is ${fmtNum(glassMl)} ml.`), stepper, quick, readout, errs),
    footer: bindSubmit(Button({ label: 'Save', kind: 'primary', block: true }), fid) });
}

// ---------------------------------------------------------------- S04 steps
export async function stepsSheet(ctx) {
  const { pid, date } = ctx;
  const [day, eff] = await Promise.all([getDay(pid, date), effectiveStepGoal(pid, date)]);
  const initialSteps = day && day.steps ? day.steps.count : null;
  const stepsField = FormField({ label: 'Steps today', type: 'text', inputmode: 'numeric', value: initialSteps == null ? '' : String(initialSteps), hint: 'Leave empty if you have no count yet.' });
  const goalField = FormField({ label: 'Step goal for this day', type: 'text', inputmode: 'numeric', value: String(eff.goal), hint: eff.source === 'plan' ? 'Set by the workout plan you chose. Change it to override.' : eff.source === 'manual' ? 'You set this goal for this day.' : 'Your default goal.' });
  const errs = errorBox();
  const reset = eff.source === 'manual' ? Button({ label: 'Use plan goal', kind: 'ghost', onClick: async () => {
    const res = await runSave(async () => {
      await setStepGoalManual(pid, date, null);
      const logs = (await getWorkoutLogs(pid, date)).sort((a, b) => a.startedAt - b.startedAt); const last = logs[logs.length - 1];
      if (last && last.stepGoalSnap) await applyPlanStepGoal(pid, date, { stepGoal: last.stepGoalSnap });
    }, (l) => showErrors(errs, l));
    if (res.ok) { toast('Goal reset'); ctx.close({ refresh: true }); }
  } }) : null;
  const dirty = () => stepsField.input.value.trim() !== (initialSteps == null ? '' : String(initialSteps)) || goalField.input.value.trim() !== String(eff.goal);
  async function save() {
    showErrors(errs, null); stepsField.setError(''); goalField.setError('');
    const raw = stepsField.input.value; const r = checkSteps(raw); const g = checkStepGoal(goalField.input.value);
    if (!r.ok) stepsField.setError(r.hard[0].message); if (!g.ok) goalField.setError(g.hard[0].message);
    if (!r.ok || !g.ok) return;
    if (!(await confirmSoft(r))) return;
    const res = await runSave(async () => {
      if (!(r.value === null && initialSteps === null)) await setSteps(pid, date, r.value);
      if (g.value !== null && g.value !== eff.goal) await setStepGoalManual(pid, date, g.value);
    }, (l) => showErrors(errs, l));
    if (res.ok) { toast('Steps saved'); ctx.close({ refresh: true }); }
  }
  const fid = uid('steps-form');
  return Sheet({ ctx, title: 'Steps', dirty, body: form(fid, save, stepsField, goalField, reset, errs), footer: bindSubmit(Button({ label: 'Save', kind: 'primary', block: true }), fid) });
}

// ---------------------------------------------------------------- S05 sleep
const timePart = (s) => (s ? String(s).slice(11, 16) : '');
function sleepArgs(rec) { return rec.bedAt && rec.wakeAt ? { bed: timePart(rec.bedAt), wake: timePart(rec.wakeAt), quality: rec.quality, napMin: rec.napMin, note: rec.note } : { durationMin: rec.durationMin, quality: rec.quality, napMin: rec.napMin, note: rec.note }; }
export async function sleepSheet(ctx) {
  const { pid, date } = ctx;
  const cur = await getSleep(pid, date);
  const bed = FormField({ label: 'Went to bed', control: h('input', { class: 'input', type: 'time', value: cur ? timePart(cur.bedAt) : '' }) });
  const wake = FormField({ label: 'Woke up', control: h('input', { class: 'input', type: 'time', value: cur ? timePart(cur.wakeAt) : '' }) });
  const manual = FormField({ label: 'Or total sleep in minutes', type: 'text', inputmode: 'numeric', value: cur && cur.durationSource === 'manual' && cur.durationMin != null ? String(cur.durationMin) : '', hint: 'Only needed if you do not know the times.' });
  const nap = FormField({ label: 'Nap (minutes, optional)', type: 'text', inputmode: 'numeric', value: cur && cur.napMin != null ? String(cur.napMin) : '' });
  const note = FormField({ label: 'Note (optional)', control: h('textarea', { class: 'input', rows: 2, maxlength: 500 }, cur && cur.note ? cur.note : '') });
  let quality = cur ? cur.quality : null; const initialQuality = quality;
  const qBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Sleep quality, 1 is poor and 5 is great' });
  const paintQ = () => { qBox.textContent = ''; for (let n = 1; n <= 5; n++) add(qBox, Chip({ label: String(n), selected: quality === n, onClick: () => { quality = quality === n ? null : n; paintQ(); } })); };
  paintQ();
  const preview = h('p', { class: 'sheet-readout', 'aria-live': 'polite' }); const errs = errorBox();
  const hint = h('p', { class: 'small muted' }, 'Sleep is saved on the day you woke up.');
  function paint() {
    const b = bed.input.value, w = wake.input.value;
    if (!b || !w) { preview.textContent = ''; return null; }
    const d = durationFromTimes(date, b, w);
    if (!d || !d.valid) { preview.textContent = 'Wake time must be after bed time.'; return null; }
    preview.textContent = `Bed ${formatDay(d.bedAt.slice(0, 10))} ${b}, woke ${formatDay(date)} ${w}, ${fmtDuration(d.durationMin)}`; return d;
  }
  bed.input.addEventListener('input', paint); wake.input.addEventListener('input', paint); paint();
  const snapshot = () => JSON.stringify([bed.input.value, wake.input.value, manual.input.value, nap.input.value, note.input.value, quality]);
  const start = snapshot();
  async function save() {
    showErrors(errs, null); [bed, wake, manual, nap].forEach((f) => f.setError(''));
    const b = bed.input.value, w = wake.input.value, m = manual.input.value.trim();
    const args = { quality, napMin: nap.input.value.trim() === '' ? null : num(nap.input.value), note: note.input.value.trim() || null };
    if (b || w) {
      if (!(b && w)) { (b ? wake : bed).setError('Enter both times, or total minutes instead.'); return; }
      const tb = checkTime(b), tw = checkTime(w); if (!tb.ok) { bed.setError(tb.hard[0].message); return; } if (!tw.ok) { wake.setError(tw.hard[0].message); return; }
      Object.assign(args, { bed: b, wake: w });
    } else if (m !== '') { const mn = num(m); if (!Number.isFinite(mn)) { manual.setError('Enter a whole number of minutes.'); return; } args.durationMin = mn; }
    else { if (cur && snapshot() !== start) { showErrors(errs, [{ message: 'Enter the times or total minutes, or use Remove sleep.' }]); return; } ctx.close(); return; }
    if (args.napMin !== null && !Number.isFinite(args.napMin)) { nap.setError('Enter a number of minutes.'); return; }
    const d = args.bed ? durationFromTimes(date, args.bed, args.wake) : null;
    const chk = checkSleep({ durationMin: d ? d.durationMin : args.durationMin, napMin: args.napMin, quality: args.quality, bedAt: d && d.bedAt, wakeAt: d && d.wakeAt });
    if (!chk.ok) { showErrors(errs, chk.hard); return; }
    if (!(await confirmSoft(chk))) return;
    const res = await runSave(() => upsertSleep(pid, date, args), (l) => showErrors(errs, l));
    if (res.ok) { toast('Sleep saved'); ctx.close({ refresh: true }); }
  }
  const remove = cur ? Button({ label: 'Remove sleep for this day', kind: 'ghost', icon: 'trash', onClick: async () => {
    const res = await runSave(() => deleteSleep(pid, date), (l) => showErrors(errs, l));
    if (!res.ok) return; const rec = res.value;
    ctx.close({ refresh: true });
    toast('Sleep removed', { undo: () => runSave(() => upsertSleep(pid, date, sleepArgs(rec))).then(() => invalidate()) });
  } }) : null;
  const fid = uid('sleep-form');
  return Sheet({ ctx, title: 'Sleep', dirty: () => snapshot() !== start,
    body: form(fid, save, h('div', { class: 'two-fields' }, bed, wake), preview, hint, manual, nap, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Quality (optional)'), qBox), note, errs, remove),
    footer: bindSubmit(Button({ label: 'Save', kind: 'primary', block: true }), fid) });
}

// ---------------------------------------------------------------- S06 note
export const NOTE_TAGS = ['ate-outside', 'travel', 'poor-sleep', 'busy', 'skipped-workout', 'illness', 'special-occasion', 'restaurant-meal'];
const tagLabel = (t) => t.replace(/-/g, ' ');
export async function noteSheet(ctx) {
  const { pid, date } = ctx;
  const cur = await getDay(pid, date); const n = cur && cur.note ? cur.note : { text: '', tags: [] };
  const text = FormField({ label: 'Note', control: h('textarea', { class: 'input', rows: 5, maxlength: 2000, placeholder: 'How was the day? Anything worth remembering?' }, n.text || '') });
  let tags = [...(n.tags || [])]; const startTags = JSON.stringify(tags);
  const tagBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tags' }); const errs = errorBox();
  const custom = FormField({ label: 'Your own tag (optional)', type: 'text', maxlength: 30, hint: 'Up to 5 tags in total.' });
  const paintTags = () => {
    tagBox.textContent = ''; const all = [...NOTE_TAGS, ...tags.filter((t) => !NOTE_TAGS.includes(t))];
    for (const t of all) add(tagBox, Chip({ label: tagLabel(t), selected: tags.includes(t), onClick: () => { if (tags.includes(t)) tags = tags.filter((x) => x !== t); else if (tags.length >= 5) { showErrors(errs, [{ message: 'You can add up to 5 tags.' }]); return; } else tags.push(t); showErrors(errs, null); paintTags(); } }));
  };
  paintTags();
  const addCustom = Button({ label: 'Add tag', kind: 'secondary', onClick: () => { const t = custom.input.value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30); if (!t) return; if (!tags.includes(t)) { if (tags.length >= 5) { showErrors(errs, [{ message: 'You can add up to 5 tags.' }]); return; } tags.push(t); } custom.input.value = ''; showErrors(errs, null); paintTags(); } });
  custom.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom.click(); } });
  const dirty = () => text.input.value !== (n.text || '') || JSON.stringify(tags) !== startTags;
  async function save() {
    showErrors(errs, null); const note = { text: text.input.value.trim(), tags };
    const r = checkDayNote(note); if (!r.ok) { showErrors(errs, r.hard); return; }
    if (!note.text && !tags.length && !cur) { ctx.close(); return; }
    const res = await runSave(() => setDayNote(pid, date, note), (l) => showErrors(errs, l));
    if (res.ok) { toast(note.text || tags.length ? 'Note saved' : 'Note removed'); ctx.close({ refresh: true }); }
  }
  const fid = uid('note-form');
  return Sheet({ ctx, title: 'Day note', dirty, body: form(fid, save, text, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), tagBox), h('div', { class: 'row-wrap' }, custom, addCustom), errs),
    footer: bindSubmit(Button({ label: 'Save', kind: 'primary', block: true }), fid) });
}
