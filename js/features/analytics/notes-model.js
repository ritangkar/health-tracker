// Pure helpers for the Notes list (S30). (A6)
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const tagLabel = (t) => String(t).replace(/-/g, ' ');
export const monthLabel = (date) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
/** days (day records) -> notes with text or tags, newest first. A day with an empty note is not a note. */
export function collectNotes(days) {
  return (days || []).filter((d) => d && d.note && (((d.note.text || '').trim()) || (d.note.tags || []).length))
    .map((d) => ({ date: d.date, text: (d.note.text || '').trim(), tags: [...(d.note.tags || [])] }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
/** [{tag, count}] most used first, then alphabetical. */
export function tagCounts(notes) {
  const m = new Map(); for (const n of notes) for (const t of n.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
}
export const filterNotes = (notes, tag) => (tag ? notes.filter((n) => n.tags.includes(tag)) : notes);
/** [{label, notes}] keeping the order of the input. */
export function groupByMonth(notes) {
  const out = []; let cur = null;
  for (const n of notes) { const l = monthLabel(n.date); if (!cur || cur.label !== l) { cur = { label: l, notes: [] }; out.push(cur); } cur.notes.push(n); }
  return out;
}
