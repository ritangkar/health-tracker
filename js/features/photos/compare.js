// S28 Photo compare: choose Date A and Date B from check-ins, slot tabs, two equal columns, thumbs first, full size on demand (D-060). (A5)
// Missing photo -> "Photo not in this backup". Object URLs are revoked on every repaint and when the screen goes away.
import { h, mount, logError } from '../../core/dom.js';
import { Button, Chip, EmptyState, FormField, PhotoCompare } from '../../ui/components.js';
import { notFound } from '../../core/router.js';
import { listCheckins, listPhotos, getPhotoBlob } from '../../core/repo.js';
import { PHOTO } from '../../../config.js';
import { formatDay } from '../../core/dates.js';
import { add } from '../daily/shared.js';
import { createUrlBag } from './url-bag.js';

export const SLOTS = PHOTO.slots;
/** Presets used by the chips and by tests. all is newest first. */
export function presetPair(all, which) {
  if (all.length < 2) return null;
  if (which === 'earliest') return { a: all[all.length - 1].id, b: all[0].id };
  return { a: all[1].id, b: all[0].id };
}

export async function compareScreen(ctx) {
  const { pid } = ctx; const el = h('section', { class: 'screen compare-screen' }); const bag = createUrlBag();
  ctx.onCleanup(() => bag.revokeAll());
  let all; try { all = await listCheckins(pid); } catch (e) { logError(e, 'compare load'); return h('section', { class: 'screen' }, EmptyState({ icon: 'warning', title: 'Could not load check-ins', text: 'Your data is safe. Try again.', action: { label: 'Try again', href: '#/progress/compare' }, headingLevel: 1 })); }
  if (all.length < 2) return h('section', { class: 'screen screen-narrow' }, h('h1', null, 'Compare photos'), EmptyState({ icon: 'image', title: 'Two check-ins needed', text: 'Photo comparison needs at least two check-ins. Add another check-in and come back.', action: { label: 'New check-in', href: '#/progress/checkin/new' }, headingLevel: 2 })); // F-A10-09: the page keeps its own title
  const known = new Set(all.map((c) => c.id));
  for (const k of ['a', 'b']) if (ctx.query[k] && !known.has(ctx.query[k])) notFound();
  const def = presetPair(all, 'previous');
  const st = { a: ctx.query.a || def.a, b: ctx.query.b || def.b, slot: SLOTS.includes(ctx.query.slot) ? ctx.query.slot : null, full: false };
  const metaCache = new Map();
  const metasFor = (id) => { if (!metaCache.has(id)) metaCache.set(id, listPhotos(pid, id)); return metaCache.get(id); };
  const byId = (id) => all.find((c) => c.id === id);
  const status = h('p', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
  const host = h('div', { class: 'stack' });
  let seq = 0;

  async function paint() {
    const my = ++seq; bag.retire(); status.textContent = '';
    const [ma, mb] = await Promise.all([metasFor(st.a), metasFor(st.b)]);
    if (my !== seq) return;
    const bySlot = (metas) => Object.fromEntries(metas.map((m) => [m.slot, m]));
    const A = bySlot(ma), B = bySlot(mb);
    if (!st.slot) st.slot = SLOTS.find((s) => A[s] || B[s]) || SLOTS[0];
    const urlsFor = (m) => { const o = {}; for (const s of SLOTS) o[s] = m[s] && m[s].thumb ? bag.make(m[s].thumb) : null; return o; };
    const left = { label: 'Date A', date: byId(st.a).date, photos: urlsFor(A), metas: A }; const right = { label: 'Date B', date: byId(st.b).date, photos: urlsFor(B), metas: B };
    if (st.full) {
      status.textContent = 'Loading full size...';
      try {
        for (const side of [left, right]) { const m = side.metas[st.slot]; if (m) { const blob = await getPhotoBlob(pid, m.id, true); if (my !== seq) return; if (blob) { bag.revoke(side.photos[st.slot]); side.photos[st.slot] = bag.make(blob); } } }
        status.textContent = 'Showing full size for this position.';
      } catch (e) { logError(e, 'compare full'); status.textContent = 'Full size could not be loaded. Showing the small version.'; }
    }
    const cmp = PhotoCompare({ left, right, slots: SLOTS, slot: st.slot, onSlot: (s) => { st.slot = s; st.full = false; paint(); } });
    const have = Boolean(A[st.slot] || B[st.slot]);
    mount(host, cmp, h('div', { class: 'row-wrap' }, have ? Button({ label: st.full ? 'Show small version' : 'Show full size', kind: 'secondary', size: 'sm', onClick: () => { st.full = !st.full; paint(); } }) : null), status,
      !have ? h('p', { class: 'small muted' }, 'Neither check-in has a photo for this position.') : null);
    bag.flush();
  }
  const opt = (id) => { const c = byId(id); const n = (c.photos || []).length; return `${formatDay(c.date)} \u00B7 ${n} ${n === 1 ? 'photo' : 'photos'}`; };
  const mkSelect = (label, key) => {
    const sel = h('select', { class: 'input select' }, all.map((c) => h('option', { value: c.id, selected: c.id === st[key] }, opt(c.id))));
    const f = FormField({ label, control: sel }); sel.addEventListener('change', () => { st[key] = sel.value; st.full = false; st.slot = null; paint(); }); f.sel = sel; return f;
  };
  const fa = mkSelect('Date A', 'a'), fb = mkSelect('Date B', 'b');
  const usePreset = (which) => { const p = presetPair(all, which); st.a = p.a; st.b = p.b; fa.sel.value = p.a; fb.sel.value = p.b; st.full = false; st.slot = null; paint(); };
  add(el, h('div', { class: 'screen-head' }, h('h1', null, 'Compare photos'), Button({ label: 'Back', kind: 'ghost', icon: 'back', onClick: () => ctx.back('#/progress') })),
    h('div', { class: 'compare-fields' }, fa, fb),
    h('div', { class: 'row-wrap' }, Chip({ label: 'Earliest vs latest', onClick: () => usePreset('earliest') }), Chip({ label: 'Previous vs latest', onClick: () => usePreset('previous') })),
    host, h('p', { class: 'small muted' }, 'Photos stay on this device. They are never uploaded.'));
  await paint();
  return el;
}
