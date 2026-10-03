// S26 Check-in wizard (D-059): 1 Basics, 2 Photos, 3 Averages, 4 Notes and Save. Steps are routes (#/progress/checkin/new/step/<n>).
// State lives in memory (save.js) so Back, refresh of one step and leaving to another tab never lose it; the hub offers Continue. (A5)
import { h, mount, clear, logError, reportWriteError, announce } from '../../core/dom.js';
import { Button, Card, Chip, EmptyState, ErrorSummary, EstimateBadge, FormField, PhotoSlot, Skeleton, Wizard, ConfirmDialog, toast } from '../../ui/components.js';
import { getSettings, latestMeasurements } from '../../core/repo.js';
import { estimate } from '../../core/storage-health.js';
import { todayKey, maxAllowedKey, formatDay } from '../../core/dates.js';
import { fmtNum, DASH } from '../../core/units.js';
import { MIN_DATE, PHOTO } from '../../../config.js';
import { msg } from '../../core/validate.js';
import { navigate } from '../../core/router.js';
import { add, confirmSoft } from '../daily/shared.js';
import { measurementTypes } from '../body/series.js';
import { createUrlBag } from '../photos/url-bag.js';
import { processImage } from '../photos/image-pipeline.js';
import { loadAutoStats, statRows, periodFor, NOT_ZERO_NOTE } from './averages.js';
import { newState, hasData, photoCount, photoBytes, validateBasics, saveCheckinState, EXTRA_KEYS } from './save.js';

let W = null;
export const wizardState = () => W;
export const resetWizard = () => { W = null; };
export const wizardInProgress = (pid) => !!(W && W.pid === pid && hasData(W));
const stepHash = (n) => `#/progress/checkin/new/step/${n}`;
const SLOT_LABEL = { front: 'Front', side: 'Side', back: 'Back', flexed: 'Flexed (optional)' };
const MB = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Starts (or resumes) a check-in. Used by the hub and by the due banner. */
export async function startCheckin(pid, { fresh = false } = {}) {
  if (fresh || !W || W.pid !== pid) { const st = await getSettings(pid).catch(() => null); const iv = st && st.uiPrefs && st.uiPrefs.checkinIntervalDays; W = newState(pid, { periodDays: iv === 14 ? 14 : 7 }); }
  return navigate(stepHash(1));
}

export async function wizardScreen(ctx) {
  const { pid } = ctx;
  const raw = ctx.params.n; const n = raw === undefined ? null : Number(raw);
  if (n === null) { await startCheckin(pid, { fresh: !W || W.pid !== pid }); return h('section', { class: 'screen' }); }
  if (!Number.isInteger(n) || n < 1 || n > 4) return h('section', { class: 'screen screen-narrow' }, EmptyState({ icon: 'info', title: 'Not found', text: 'That step does not exist.', action: { label: 'Start a check-in', href: '#/progress/checkin/new' }, headingLevel: 1 }));
  if (!W || W.pid !== pid) { const st = await getSettings(pid).catch(() => null); const iv = st && st.uiPrefs && st.uiPrefs.checkinIntervalDays; W = newState(pid, { periodDays: iv === 14 ? 14 : 7 }); if (n !== 1) { ctx.replace(stepHash(1)); return h('section', { class: 'screen' }); } }
  const state = W; const bag = createUrlBag(); let alive = true;
  ctx.onCleanup(() => { alive = false; bag.revokeAll(); });
  let latest = {}; try { latest = await latestMeasurements(pid); } catch (e) { logError(e, 'checkin latest'); }
  const el = h('section', { class: 'screen screen-narrow wizard-screen' });
  const leave = () => ctx.back('#/progress');
  const cancel = async () => {
    if (hasData(state)) { const ok = await ConfirmDialog({ title: 'Discard this check-in?', message: 'What you entered and any prepared photos will be dropped. Nothing has been saved yet.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true }); if (!ok) return; }
    resetWizard(); leave();
  };

  // ------------------------------------------------------------ step 1: basics
  function stepBasics() {
    const box = h('div', { class: 'stack' }); const summary = h('div', { class: 'error-host' });
    const showErrors = (errs) => { mount(summary, ErrorSummary(errs.map((e) => ({ fieldId: fields[e.field] ? fields[e.field].fieldId : fields.date.fieldId, message: e.message })))); for (const [k, f] of Object.entries(fields)) { const e = errs.find((x) => x.field === k); f.setError(e ? e.message : ''); } };
    const period = h('p', { class: 'small muted' });
    const paintPeriod = () => { const p = periodFor(state.date, state.periodDays); period.textContent = `Averages will cover ${formatDay(p.periodStart)} to ${formatDay(p.periodEnd)} (${state.periodDays} days).`; };
    const fields = {};
    fields.date = FormField({ label: 'Check-in date', type: 'date', value: state.date, min: MIN_DATE, max: maxAllowedKey() });
    fields.date.input.addEventListener('input', () => { if (fields.date.input.value) { state.date = fields.date.input.value; state.stats = null; paintPeriod(); } });
    const lw = latest['mt:weight'] && latest['mt:weight'].latest;
    fields.weight = FormField({ label: 'Weight', type: 'text', inputmode: 'decimal', value: state.weight, suffix: 'kg', hint: lw ? `Last weigh-in: ${fmtNum(lw.value, 1)} kg on ${formatDay(lw.date)}.` : 'No weight logged yet.' });
    fields.weight.input.addEventListener('input', () => { state.weight = fields.weight.input.value; });
    const lb = latest['mt:bodyFat'] && latest['mt:bodyFat'].latest;
    fields.bodyFat = FormField({ label: 'Body fat (approximate)', type: 'text', inputmode: 'decimal', value: state.bodyFat, suffix: '%', hint: lb ? `Approximate. Last reading: ${fmtNum(lb.value, 1)}% on ${formatDay(lb.date)}.` : 'Approximate. Leave blank if you did not measure it.' });
    fields.bodyFat.input.addEventListener('input', () => { state.bodyFat = fields.bodyFat.input.value; });
    const periodChips = h('div', { class: 'row-wrap', role: 'group', 'aria-label': 'Averages period' });
    const paintChips = () => { clear(periodChips); for (const d of [7, 14]) add(periodChips, Chip({ label: `Last ${d} days`, selected: state.periodDays === d, onClick: () => { state.periodDays = d; state.stats = null; paintChips(); paintPeriod(); } })); };
    const more = h('div', { class: 'stack' });
    const types = measurementTypes().filter((t) => EXTRA_KEYS.includes(t.key));
    const paintMore = () => {
      clear(more);
      add(more, Button({ label: state.showMeasures ? 'Hide measurements' : 'Add measurements (optional)', kind: 'ghost', icon: state.showMeasures ? 'up' : 'plus', onClick: () => { state.showMeasures = !state.showMeasures; paintMore(); } }));
      if (state.showMeasures) { const grid = h('div', { class: 'two-fields' }); for (const t of types) { const f = FormField({ label: t.label, type: 'text', inputmode: 'decimal', value: state.measures[t.key] || '', suffix: t.canonicalUnit }); f.input.addEventListener('input', () => { state.measures[t.key] = f.input.value; }); fields[t.key] = f; add(grid, f); } add(more, grid); }
    };
    paintChips(); paintPeriod(); paintMore();
    const useLast = (key, f, rec) => (rec ? Button({ label: `Use last ${key === 'weight' ? 'weight' : 'body fat'} (${fmtNum(rec.value, 1)}${key === 'weight' ? ' kg' : '%'})`, kind: 'ghost', size: 'sm', onClick: () => { state[key] = String(rec.value); f.input.value = state[key]; } }) : null); // F-A8-11: one tap, never silent, so no duplicate reading is written
    add(box, summary, fields.date, h('div', { class: 'two-fields' }, fields.weight, fields.bodyFat), h('div', { class: 'row-wrap' }, useLast('weight', fields.weight, lw), useLast('bodyFat', fields.bodyFat, lb)), more, h('div', { class: 'stack-sm' }, h('p', { class: 'field-label' }, 'Averages period'), periodChips, period), h('p', { class: 'small muted' }, 'Anything you enter here is also saved as a reading in Body, on the check-in date.'));
    box.validate = () => { const v = validateBasics(state); const own = v.errors.filter((e) => e.field !== 'note'); showErrors(own); if (own.length) { const first = fields[own[0].field] || fields.date; first.input.focus(); return false; } return true; };
    return box;
  }

  // ------------------------------------------------------------ step 2: photos
  const photoUi = { queue: [], total: 0, done: 0, running: false, busySlot: null };
  async function runQueue(repaint) {
    if (photoUi.running) return; photoUi.running = true;
    while (photoUi.queue.length) {
      const job = photoUi.queue.shift(); photoUi.busySlot = job.slot; photoUi.done += 1; repaint();
      try { state.photos[job.slot] = await processImage(job.file); state.photoErrors[job.slot] = null; announce(`${SLOT_LABEL[job.slot]} photo ready`); }
      catch (e) { logError(e, 'photo'); delete state.photos[job.slot]; state.photoErrors[job.slot] = msg('C_PHOTO_FAIL'); }
      photoUi.busySlot = null; if (alive) repaint();
    }
    photoUi.running = false; photoUi.total = 0; photoUi.done = 0; if (alive) repaint();
  }
  function stepPhotos() {
    const box = h('div', { class: 'stack' }); const grid = h('div', { class: 'photo-grid' }); const note = h('div', { class: 'stack-sm' });
    const cache = new Map(); // slot -> {photo, url}: one object URL per prepared photo, revoked only when it is replaced or removed
    const urlFor = (slot, p) => { const c = cache.get(slot); if (c && c.photo === p) return c.url; if (c) bag.revoke(c.url); if (!p) { cache.delete(slot); return null; } const url = bag.make(p.thumb); cache.set(slot, { photo: p, url }); return url; };
    const paint = () => {
      clear(grid);
      for (const slot of PHOTO.slots) {
        const p = state.photos[slot]; const busy = photoUi.busySlot === slot ? `Preparing photo ${photoUi.done} of ${photoUi.total}` : (photoUi.queue.some((j) => j.slot === slot) ? 'Waiting...' : null);
        add(grid, PhotoSlot({ slot, label: SLOT_LABEL[slot], url: urlFor(slot, p), busyText: busy, error: state.photoErrors[slot] || null, onFile: (file, s) => { photoUi.queue = photoUi.queue.filter((j) => j.slot !== s); photoUi.queue.push({ file, slot: s }); photoUi.total += 1; runQueue(paint); paint(); }, onRemove: (s) => { delete state.photos[s]; paint(); } }));
      }
      clear(note); const c = photoCount(state);
      add(note, h('p', { class: 'small', role: 'status' }, c ? `${c} of ${PHOTO.maxPerCheckin} photos ready (about ${MB(photoBytes(state))} on this device).` : 'No photos yet. Photos are optional.'));
    };
    paint();
    const storage = h('div', { class: 'stack-sm' });
    estimate().then((e) => { if (!alive || !e) return; if (e.level === 'red') add(storage, h('div', { class: 'warn-box', role: 'status' }, h('strong', null, 'Storage is almost full. '), 'Back up and free some space before adding photos. ', h('a', { href: '#/settings/storage' }, 'Open Storage'))); else if (e.level === 'amber') add(storage, h('div', { class: 'warn-box', role: 'status' }, 'Storage is getting full. Photos use the most space. ', h('a', { href: '#/settings/storage' }, 'Open Storage'))); }).catch(() => {});
    add(box, h('p', { class: 'muted' }, 'Same spot, same light, same distance each time makes the comparison fair. Up to four photos: front, side, back and an optional flexed one.'), storage, grid, note, h('p', { class: 'small muted' }, 'Photos are resized on this device and stay here. They are never uploaded. Location data in a photo is removed.'));
    return box;
  }

  // ------------------------------------------------------------ step 3: averages
  function stepAverages() {
    const box = h('div', { class: 'stack' }); const list = h('div', { class: 'stack-sm' }); const status = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
    const key = () => `${state.date}|${state.periodDays}`;
    async function compute() {
      mount(list, Skeleton({ lines: 4 })); status.textContent = 'Reading your logs...';
      try { state.stats = await loadAutoStats(pid, state.date, state.periodDays); state.statsKey = key(); } catch (e) { logError(e, 'averages'); if (alive) { mount(list, h('p', { class: 'field-error' }, 'Averages could not be read. You can still save the check-in without them.')); status.textContent = ''; } return; }
      if (alive) paint();
    }
    function paint() {
      const rows = statRows(state.stats); const p = periodFor(state.date, state.periodDays);
      mount(list, h('dl', { class: 'avg-list' }, rows.map((r) => h('div', { class: 'avg-row' }, h('dt', null, r.label), h('dd', null, h('span', { class: 'num avg-value' }, r.value == null ? DASH : r.value), h('span', { class: 'small muted' }, ` ${r.detail}`))))));
      status.textContent = `Period: ${formatDay(p.periodStart)} to ${formatDay(p.periodEnd)}.`;
    }
    add(box, h('p', { class: 'muted' }, 'These come from what you logged. They are saved with the check-in as a snapshot.'), list, h('p', { class: 'small muted' }, NOT_ZERO_NOTE), status,
      Button({ label: 'Recompute', icon: 'calendar', kind: 'secondary', onClick: () => { announce('Recomputing averages'); compute(); } }));
    if (!state.stats || state.statsKey !== key()) compute(); else paint();
    return box;
  }

  // ------------------------------------------------------------ step 4: notes + save
  function stepNotes() {
    const box = h('div', { class: 'stack' }); const err = h('div', { class: 'sheet-errors', role: 'alert' });
    const ta = h('textarea', { class: 'input textarea', rows: 5, maxlength: 2000 }); ta.value = state.note; ta.addEventListener('input', () => { state.note = ta.value; });
    const noteField = FormField({ label: 'Notes (optional)', control: ta, hint: 'How the week went, how you feel, anything worth remembering. Up to 2,000 characters.' });
    const v = validateBasics(state);
    const lines = [state.date ? `Date: ${formatDay(state.date)}` : null, v.values.weight != null ? `Weight: ${fmtNum(v.values.weight, 1)} kg` : null, v.values.bodyFat != null ? `Body fat: ${fmtNum(v.values.bodyFat, 1)} % (approximate)` : null, `Photos: ${photoCount(state)}`, state.stats ? `Averages over ${state.stats.periodDays} days saved with it` : 'No averages (go back a step to add them)'].filter(Boolean);
    add(box, noteField, h('div', { class: 'card stack-sm' }, h('p', { class: 'row-title' }, 'This check-in'), h('ul', { class: 'plain-list' }, lines.map((l) => h('li', null, l)))), err);
    box.err = err; return box;
  }
  let step4 = null; let basicsNode = null;
  const steps = [
    { id: 'basics', title: 'Basics', render: () => { basicsNode = stepBasics(); return basicsNode; } },
    { id: 'photos', title: 'Photos', render: stepPhotos },
    { id: 'averages', title: 'Averages', render: stepAverages },
    { id: 'notes', title: 'Notes and save', render: () => { step4 = stepNotes(); return step4; } }
  ];
  async function finish() {
    const v = validateBasics(state);
    if (v.errors.length) { const first = v.errors[0]; toast(first.message); const target = ['date', 'weight', 'bodyFat', 'waist', 'biceps', 'thigh'].includes(first.field) ? 1 : 4; ctx.replace(stepHash(target)); return; }
    if (!(await confirmSoft({ soft: v.soft }))) return;
    const showErr = (m) => { if (step4 && step4.err) { clear(step4.err); add(step4.err, h('p', { class: 'field-error' }, m)); } else toast(m); };
    const res = await saveCheckinState(pid, state);
    if (!res.ok) { if (res.error && res.error.kind === 'other') reportWriteError(res.cause); showErr(res.error ? res.error.message : 'Nothing was saved.'); return; }
    resetWizard(); toast('Check-in saved'); ctx.replace(`#/progress/checkin/${encodeURIComponent(res.saved.id)}`);
  }
  const wizard = Wizard({ steps, current: n, finishLabel: 'Save check-in', onCancel: cancel, onFinish: finish,
    canAdvance: (cur) => { if (cur === 1 && basicsNode && !basicsNode.validate()) return false; return true; },
    onNavigate: (to) => { if (to < n) ctx.back(stepHash(to)); else ctx.navigate(stepHash(to)); } });
  add(el, h('h1', null, 'New check-in'), wizard);
  setTimeout(() => announce(`Step ${n} of ${steps.length}: ${steps[n - 1].title}`), 400); // F-A10-07: the step name is spoken after the route title
  return el;
}
