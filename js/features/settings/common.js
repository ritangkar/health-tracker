// Small helpers for the settings screens. (A4)
import { add } from '../daily/shared.js';
import { h } from '../../core/dom.js';
import { Button } from '../../ui/components.js';

export const pageHead = (title, back = '#/settings', backLabel = 'Settings') => h('div', { class: 'screen-head' }, h('h1', null, title), back ? Button({ label: backLabel, kind: 'ghost', icon: 'back', href: back }) : null);
export function kv(rows) { const dl = h('dl', { class: 'kv' }); for (const [k, v] of rows) add(dl, h('dt', null, k), h('dd', null, v === null || v === undefined || v === '' ? '\u2014' : v)); return dl; }
export function fmtBytes(n) { if (n == null) return '\u2014'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`; if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`; return `${(n / 1073741824).toFixed(2)} GB`; }
export function fmtWhen(ts) { if (!ts) return 'Never'; const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
export function daysAgo(ts) { if (!ts) return null; return Math.floor((Date.now() - ts) / 86400000); }
export const backupAgeText = (ts) => { if (!ts) return 'No backup yet'; const d = daysAgo(ts); return d <= 0 ? 'Last backup today' : d === 1 ? 'Last backup yesterday' : `Last backup ${d} days ago`; };
