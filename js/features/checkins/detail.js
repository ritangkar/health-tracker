// S27 Check-in detail: values, averages snapshot (n of N days), photos (tap for full size), workouts in the period, note, compare, delete (cascade, confirmed). (A5)
import { h, mount, logError, reportWriteError } from '../../core/dom.js';
import { Button, Card, ConfirmDialog, EmptyState, EstimateBadge, FormField, toast } from '../../ui/components.js';
import { notFound } from '../../core/router.js';
import { getCheckin, listPhotos, listCheckins, getPhotoBlob, saveCheckinWithPhotos, deleteCheckin, getWorkoutLogsRange } from '../../core/repo.js';
import { formatLong, formatDay } from '../../core/dates.js';
import { fmtNum, DASH } from '../../core/units.js';
import { cleanText } from '../../core/validate.js';
import { add, ownedOrNull, runSave } from '../daily/shared.js';
import { createUrlBag } from '../photos/url-bag.js';
import { openPhotoViewer, closePhotoViewer } from '../photos/viewer.js';
import { typeById, measurementTypes } from '../body/series.js';
import { statRows, NOT_ZERO_NOTE } from './averages.js';
import { sessionStatus } from '../workout/common.js';

const SLOT_ORDER = ['front', 'side', 'back', 'flexed'];
const SLOT_LABEL = { front: 'Front', side: 'Side', back: 'Back', flexed: 'Flexed' };

export async function detailScreen(ctx) {
  const { pid } = ctx; const bag = createUrlBag(); ctx.onCleanup(() => { bag.revokeAll(); closePhotoViewer(); });
  let c = await ownedOrNull(getCheckin(pid, ctx.params.id)); if (!c) notFound();
  const el = h('section', { class: 'screen detail-screen' });
  async function paint() {
    let metas = [], all = [], sessions = [];
    try { [metas, all] = await Promise.all([listPhotos(pid, c.id), listCheckins(pid)]); if (c.periodStart && c.periodEnd) sessions = (await getWorkoutLogsRange(pid, c.periodStart, c.periodEnd)).filter((w) => !w.isRest).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedAt - b.startedAt)); }
    catch (e) { logError(e, 'checkin detail'); mount(el, EmptyState({ icon: 'warning', title: 'Could not load this check-in', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    bag.retire();
    const values = [];
    if (c.weight != null) values.push(['Weight', `${fmtNum(c.weight, 1)} kg`]);
    if (c.bodyFat != null) values.push(['Body fat', `${fmtNum(c.bodyFat, 1)} %`, true]);
    for (const [typeId, v] of Object.entries(c.measurements || {})) { const t = typeById(typeId) || measurementTypes().find((x) => x.id === typeId); values.push([t ? t.label : typeId.replace(/^mt:/, ''), `${fmtNum(v, 1)} ${t ? t.canonicalUnit : 'cm'}`]); }
    const valueCard = Card({ title: 'Measurements', children: [values.length ? h('dl', { class: 'avg-list' }, values.map(([k, v, approx]) => h('div', { class: 'avg-row' }, h('dt', null, k), h('dd', null, h('span', { class: 'num avg-value' }, v), approx ? EstimateBadge({ kind: 'approx' }) : null)))) : h('p', { class: 'muted' }, 'No weight or measurements were entered.')] });
    const rows = statRows(c.autoStats);
    const avgCard = Card({ title: c.autoStats ? `Averages over ${c.autoStats.periodDays} days` : 'Averages', children: c.autoStats ? [h('dl', { class: 'avg-list' }, rows.map((r) => h('div', { class: 'avg-row' }, h('dt', null, r.label), h('dd', null, h('span', { class: 'num avg-value' }, r.value == null ? DASH : r.value), h('span', { class: 'small muted' }, ` ${r.detail}`))))), h('p', { class: 'small muted' }, `${c.periodStart ? `${formatDay(c.periodStart)} to ${formatDay(c.periodEnd)}. ` : ''}${NOT_ZERO_NOTE} These were saved with the check-in and do not change.`)] : [h('p', { class: 'muted' }, 'No averages were saved with this check-in.')] });
    const bySlot = Object.fromEntries(metas.map((m) => [m.slot, m]));
    const tiles = SLOT_ORDER.filter((s) => bySlot[s]).map((s) => { const m = bySlot[s]; const b = h('button', { type: 'button', class: 'photo-tile', 'aria-label': `View ${SLOT_LABEL[s]} photo full size` }, h('img', { class: 'photo-img', src: bag.make(m.thumb), alt: `${SLOT_LABEL[s]} photo` }), h('span', { class: 'small' }, SLOT_LABEL[s])); b.addEventListener('click', () => openPhotoViewer({ title: `${SLOT_LABEL[s]} photo, ${formatLong(c.date)}`, loadBlob: () => getPhotoBlob(pid, m.id, true) })); return b; });
    const photoCard = Card({ title: 'Photos', children: [tiles.length ? h('div', { class: 'photo-grid' }, tiles) : h('p', { class: 'muted' }, 'No photos with this check-in.'), (c.photos || []).length > metas.length ? h('p', { class: 'small muted' }, 'Photo not in this backup') : null] });
    const sessionCard = sessions.length ? Card({ title: 'Workouts in this period', children: [h('ul', { class: 'plain-list' }, sessions.map((w) => h('li', null, h('a', { href: `#/workout/view/${encodeURIComponent(w.id)}` }, `${formatDay(w.date)}: ${w.planName}`), h('span', { class: 'small muted' }, ` ${sessionStatus(w)}`))))] }) : null;
    const noteHost = h('div', { class: 'stack-sm' });
    const paintNote = (editing) => {
      noteHost.textContent = '';
      if (!editing) { add(noteHost, c.note ? h('p', { class: 'note-text' }, c.note) : h('p', { class: 'muted' }, 'No notes.'), Button({ label: c.note ? 'Edit note' : 'Add note', kind: 'ghost', size: 'sm', icon: 'edit', onClick: () => paintNote(true) })); return; }
      const ta = h('textarea', { class: 'input textarea', rows: 4, maxlength: 2000 }); ta.value = c.note || ''; const f = FormField({ label: 'Note', control: ta });
      add(noteHost, f, h('div', { class: 'row-wrap' }, Button({ label: 'Save note', kind: 'primary', size: 'sm', onClick: async () => { const note = cleanText(ta.value) || null; const res = await runSave(() => saveCheckinWithPhotos(pid, { ...c, note }, [], {}), (l) => f.setError(l[0].message)); if (res.ok) { c = res.value; toast('Note saved'); paintNote(false); } } }), Button({ label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => paintNote(false) })));
      ta.focus();
    };
    paintNote(false);
    const idx = all.findIndex((x) => x.id === c.id); const prev = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;
    const actions = h('div', { class: 'row-wrap' }, prev ? Button({ label: 'Compare with previous', icon: 'image', href: `#/progress/compare?a=${encodeURIComponent(prev.id)}&b=${encodeURIComponent(c.id)}` }) : null, all.length >= 2 ? Button({ label: 'Compare photos', kind: 'ghost', href: `#/progress/compare?b=${encodeURIComponent(c.id)}` }) : null,
      Button({ label: 'Delete check-in', kind: 'danger', icon: 'trash', onClick: remove }));
    mount(el, h('div', { class: 'screen-head' }, h('h1', null, `Check-in, ${formatLong(c.date)}`), Button({ label: 'Progress', kind: 'ghost', icon: 'back', href: '#/progress' })), photoCard, valueCard, avgCard, sessionCard, Card({ title: 'Note', children: [noteHost] }), actions);
    bag.flush();
  }
  async function remove() {
    const n = (c.photos || []).length;
    const ok = await ConfirmDialog({ title: 'Delete this check-in?', message: `This removes the check-in${n ? ` and its ${n} ${n === 1 ? 'photo' : 'photos'}` : ''}. Weight and measurements saved in Body stay there. This cannot be undone.`, confirmLabel: 'Delete check-in', danger: true });
    if (!ok) return;
    try { await deleteCheckin(pid, c.id); } catch (e) { reportWriteError(e); return; }
    toast('Check-in deleted'); ctx.replace('#/progress');
  }
  await paint();
  return el;
}
