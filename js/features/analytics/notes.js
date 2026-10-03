// S30 Notes list (#/progress/notes): every day note, newest first, grouped by month, with a tag filter. (A6)
// Each note opens that day on Today. Long lists are windowed (40 at a time). Note text is always set as text.
import { h, mount, logError, announce } from '../../core/dom.js';
import { Button, Chip, EmptyState } from '../../ui/components.js';
import { getDaysRange } from '../../core/repo.js';
import { formatLong, todayKey, addDays } from '../../core/dates.js';
import { add } from '../daily/shared.js';
import { collectNotes, tagCounts, filterNotes, groupByMonth, tagLabel } from './notes-model.js';

const PAGE = 40;
export async function notesScreen(ctx) {
  const { pid } = ctx; const el = h('section', { class: 'screen screen-narrow notes-screen' }); let alive = true; ctx.onCleanup(() => { alive = false; });
  let tag = null; let shown = PAGE; let notes = [];
  const head = () => h('div', { class: 'food-head' }, h('h1', null, 'Notes'), Button({ label: 'Trends', icon: 'chart', kind: 'ghost', href: '#/progress/trends' }));
  const back = () => Button({ label: 'Back to Progress', kind: 'ghost', icon: 'back', href: '#/progress' });
  const dayHref = (date) => (date === todayKey() ? '#/today' : `#/today/${date}`);

  function paint({ focusTag = null } = {}) {
    if (!alive) return;
    if (!notes.length) { mount(el, head(), EmptyState({ icon: 'note', title: 'No notes', text: 'A note is optional. Add one from Today when something is worth remembering, such as travel, a restaurant meal or a poor night of sleep.', action: { label: 'Go to Today', href: '#/today' } }), back()); return; }
    const counts = tagCounts(notes); const list = filterNotes(notes, tag); const page = list.slice(0, shown);
    const filter = counts.length ? h('div', { class: 'stack-sm' }, h('p', { class: 'metric-group-label small muted', id: 'note-filter-label' }, 'Filter by tag'),
      h('div', { class: 'row-wrap', role: 'group', 'aria-labelledby': 'note-filter-label' },
        Chip({ label: `All (${notes.length})`, selected: tag === null, onClick: () => { tag = null; shown = PAGE; paint({ focusTag: '' }); announce(`Showing all ${notes.length} notes`); } }),
        counts.map((c) => Chip({ label: `${tagLabel(c.tag)} (${c.count})`, selected: tag === c.tag, onClick: () => { tag = tag === c.tag ? null : c.tag; shown = PAGE; paint({ focusTag: c.tag }); announce(tag ? `Showing ${filterNotes(notes, tag).length} notes tagged ${tagLabel(tag)}` : `Showing all ${notes.length} notes`); } })))) : null;
    const groups = groupByMonth(page);
    const body = !list.length
      ? EmptyState({ icon: 'note', title: 'No notes with this tag', text: 'Try another tag or show all notes.', action: { label: 'Show all notes', onClick: () => { tag = null; paint(); } }, headingLevel: 2 })
      : h('div', { class: 'stack' }, groups.map((g) => h('section', { class: 'notes-month stack-sm', 'aria-label': g.label }, h('h2', { class: 'notes-month-title' }, g.label),
        h('ul', { class: 'notes-list' }, g.notes.map((n) => h('li', null, h('a', { class: 'note-card card', href: dayHref(n.date), 'aria-label': `Open ${formatLong(n.date)}` },
          h('span', { class: 'row-title' }, formatLong(n.date)),
          n.text ? h('span', { class: 'note-text' }, n.text) : null,
          n.tags.length ? h('span', { class: 'row-wrap' }, n.tags.map((t) => Chip({ label: tagLabel(t) }))) : null)))))));
    mount(el, head(), filter, h('p', { class: 'small muted', role: 'status' }, `${list.length} of ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}${tag ? ` tagged ${tagLabel(tag)}` : ''}`), body,
      list.length > shown ? Button({ label: `Show more (${list.length - shown} left)`, kind: 'secondary', onClick: () => { shown += PAGE; paint(); } }) : null, back());
    if (focusTag !== null) { const btn = [...el.querySelectorAll('button.chip')].find((b) => (focusTag === '' ? /^All/.test(b.textContent) : b.textContent.startsWith(tagLabel(focusTag)))); if (btn) btn.focus(); }
  }
  try { notes = collectNotes(await getDaysRange(pid, '2000-01-01', addDays(todayKey(), 1))); }
  catch (e) { logError(e, 'notes load'); return h('section', { class: 'screen' }, EmptyState({ icon: 'warning', title: 'Could not load notes', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: () => ctx.navigate('#/progress/notes') }, headingLevel: 1 })); }
  paint();
  return el;
}
