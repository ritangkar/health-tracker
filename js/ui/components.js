// Shared UI components (CR-004). Every component is a function returning a DOM node (or a small object, noted). No innerHTML, no style attributes. (A3)
// Stateful components attach methods on the returned node: Stepper.getValue()/setValue(v), Tabs.select(id), FormField.setError(msg)/input, SearchField.input, Wizard.setStep(n).
// Full API list with props, events and accessibility behaviour: docs/CONVENTIONS.md section 5.
import { h, svgEl, clear, uid, announce, focusFirst, focusHeading, toNum, cx, on } from '../core/dom.js';
import { icon } from './icons.js';
import { linePlot, barPlot, ringPlot, attachReadout, markSelected, summarize, fmtDay, fmtVal } from './charts.js';
import { closeSheet, setLeaveGuard, goRoot, switchProfile, navigate } from '../core/router.js';
import { formatDay, todayKey, addDays, isValidKey, maxAllowedKey, daysBetween } from '../core/dates.js';
import { MIN_DATE } from '../../config.js';
import { DASH } from '../core/units.js';

// ================================================================ basics
export function Button({ label, kind = 'secondary', icon: ic = null, onClick, href, disabled = false, type = 'button', block = false, ariaLabel, cls = '', size }) {
  const props = { class: cx('btn', `btn-${kind}`, block && 'btn-block', size === 'sm' && 'btn-sm', cls), 'aria-label': ariaLabel };
  const kids = [ic ? icon(ic, { size: 20 }) : null, label ? h('span', null, label) : null];
  if (href) return h('a', { ...props, href }, kids);
  const b = h('button', { ...props, type, disabled }, kids);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
export function IconButton({ icon: ic, label, onClick, cls = '', pressed, disabled = false, size = 24 }) {
  const b = h('button', { type: 'button', class: cx('icon-btn', cls), 'aria-label': label, title: label, disabled, 'aria-pressed': pressed === undefined ? null : String(!!pressed) }, icon(ic, { size }));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
export function Card({ title, children = [], cls = '', as = 'section', headingLevel = 2 }) {
  return h(as, { class: cx('card', cls) }, title ? h(`h${headingLevel}`, { class: 'card-title' }, title) : null, children);
}
export function Chip({ label, selected, onClick, icon: ic, tone, title, cls = '' }) {
  const kids = [ic ? icon(ic, { size: 16 }) : null, h('span', null, label)];
  const c = cx('chip', tone && `chip-${tone}`, selected && 'is-selected', cls);
  if (!onClick) return h('span', { class: c, title }, kids);
  const b = h('button', { type: 'button', class: c, title, 'aria-pressed': selected === undefined ? null : String(!!selected) }, kids);
  b.addEventListener('click', onClick); return b;
}
export function EmptyState({ icon: ic = 'info', title, text, action, headingLevel = 2 }) {
  return h('div', { class: 'empty-state' }, h('span', { class: 'empty-icon' }, icon(ic, { size: 32 })), h(`h${headingLevel}`, { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text muted' }, text) : null,
    action ? Button({ label: action.label, kind: action.kind || 'primary', onClick: action.onClick, href: action.href }) : null);
}
export function Skeleton({ lines = 3, variant = 'text' } = {}) {
  return h('div', { class: `skeleton skeleton-${variant}`, 'aria-hidden': 'true' }, Array.from({ length: lines }, () => h('span', { class: 'skeleton-line' })));
}
export function ProgressList({ items, label = 'Progress' }) {
  const word = { pending: 'Waiting', active: 'In progress', done: 'Done', error: 'Failed' };
  return h('ol', { class: 'progress-list', 'aria-label': label }, items.map((it) => h('li', { class: `pl-item pl-${it.status || 'pending'}`, 'aria-current': it.status === 'active' ? 'step' : null },
    h('span', { class: 'pl-mark' }, icon(it.status === 'done' ? 'check' : it.status === 'error' ? 'warning' : 'more', { size: 18 })), h('span', { class: 'grow' }, it.label), h('span', { class: 'pl-state small muted' }, it.detail || word[it.status || 'pending']))));
}
const POP_MARGIN = 8;
/** Keeps an estimate popover inside the screen (F-A6-04). Only sets the custom property --pop-left (D-052). */
export function fitPopover(pop, vw = document.documentElement.clientWidth) {
  if (!pop) return 0;
  pop.style.setProperty('--pop-left', '0px');
  const r = pop.getBoundingClientRect(); let shift = 0;
  if (r.right > vw - POP_MARGIN) shift = vw - POP_MARGIN - r.right;
  if (r.left + shift < POP_MARGIN) shift = POP_MARGIN - r.left;
  pop.style.setProperty('--pop-left', `${Math.round(shift)}px`);
  return shift;
}
export function EstimateBadge({ kind = 'est', text, explain }) {
  const label = text || (kind === 'approx' ? 'approx.' : 'est.');
  const pid = uid('est');
  const msg = explain || (kind === 'approx' ? 'This value is approximate. Real amounts vary.' : 'This is an estimate, not a measurement. Real values can differ.');
  const pop = h('span', { class: 'est-pop', id: pid, role: 'note', hidden: true }, msg);
  const btn = h('button', { type: 'button', class: 'chip chip-est', 'aria-expanded': 'false', 'aria-controls': pid, 'aria-label': `${kind === 'approx' ? 'Approximate value' : 'Estimate'}${text ? `: ${String(text).replace(/[.\s]+$/, '')}` : ''}. What does this mean?` }, label); // F-A10-05: the name says estimate / approximate, never just 'est.'
  const wrap = h('span', { class: 'est-wrap' }, btn, pop);
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  btn.addEventListener('click', () => { const open = pop.hidden; if (open) { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); fitPopover(pop); document.addEventListener('pointerdown', outside, true); } else close(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); btn.focus(); } });
  return wrap;
}
export function Tabs({ tabs, selected, onSelect, label = 'Sections', panelId }) {
  let cur = selected || (tabs[0] && tabs[0].id);
  const el = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const btns = tabs.map((t) => h('button', { type: 'button', role: 'tab', class: 'tab', 'data-id': t.id, 'aria-controls': panelId || null }, t.label));
  const paint = () => btns.forEach((b) => { const on2 = b.dataset.id === cur; b.setAttribute('aria-selected', String(on2)); b.tabIndex = on2 ? 0 : -1; b.classList.toggle('is-selected', on2); });
  const select = (id, { focus = false, silent = false } = {}) => { cur = id; paint(); if (focus) btns.find((b) => b.dataset.id === id).focus(); if (!silent && onSelect) onSelect(id); };
  btns.forEach((b) => { b.addEventListener('click', () => select(b.dataset.id)); el.appendChild(b); });
  el.addEventListener('keydown', (e) => {
    const i = btns.findIndex((b) => b.dataset.id === cur); let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % btns.length; else if (e.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = btns.length - 1;
    if (n >= 0) { e.preventDefault(); select(btns[n].dataset.id, { focus: true }); }
  });
  paint(); el.select = select; el.current = () => cur; return el;
}

// ================================================================ forms
export function FormField({ label, id, hint, error, input, control, required = false, type = 'text', inputmode, value, min, max, step, placeholder, maxlength, autocomplete = 'off', suffix, cls = '' }) {
  const fid = id || uid('f'); const hintId = `${fid}-hint`, errId = `${fid}-err`;
  const ctl = control || input || h('input', { class: 'input', type, inputmode, value: value ?? '', min, max, step, placeholder, maxlength, autocomplete, required: required || null });
  ctl.id = fid;
  const hintEl = hint ? h('p', { class: 'field-hint small muted', id: hintId }, hint) : null;
  const errEl = h('p', { class: 'field-error small', id: errId, hidden: true });
  const syncDesc = () => { const ids = [hintEl ? hintId : null, errEl.hidden ? null : errId].filter(Boolean).join(' '); if (ids) ctl.setAttribute('aria-describedby', ids); else ctl.removeAttribute('aria-describedby'); };
  const el = h('div', { class: cx('field', cls) }, h('label', { class: 'field-label', htmlFor: fid }, label, required ? h('span', { class: 'req muted' }, ' (required)') : null),
    suffix ? h('div', { class: 'field-row' }, ctl, h('span', { class: 'field-suffix muted' }, suffix)) : ctl, hintEl, errEl);
  el.input = ctl; el.fieldId = fid;
  el.setError = (m) => { if (m) { errEl.textContent = m; errEl.hidden = false; ctl.setAttribute('aria-invalid', 'true'); } else { errEl.textContent = ''; errEl.hidden = true; ctl.removeAttribute('aria-invalid'); } syncDesc(); };
  syncDesc(); return el;
}
/** role=alert summary. errors: [{fieldId, message}]. Links move focus to the field. Returns null node when empty. */
export function ErrorSummary(errors) {
  if (!errors || !errors.length) return h('div', { class: 'error-summary', role: 'alert', hidden: true });
  return h('div', { class: 'error-summary', role: 'alert' }, h('p', { class: 'error-summary-title' }, errors.length === 1 ? 'Fix this to continue:' : `Fix these ${errors.length} things to continue:`),
    h('ul', null, errors.map((e) => h('li', null, h('a', { href: `#${e.fieldId}`, onClick: (ev) => { ev.preventDefault(); const f = document.getElementById(e.fieldId); if (f) f.focus(); } }, e.message)))));
}
const round4 = (n) => Math.round(n * 10000) / 10000;
export function Stepper({ value = null, min = 0, max = 100, step = 1, label, unit = '', onChange, decimals = 2, format }) {
  let v = value; const iid = uid('stp');
  const input = h('input', { class: 'stepper-input', id: iid, type: 'text', inputmode: step % 1 ? 'decimal' : 'numeric', 'aria-label': label, autocomplete: 'off', value: '' });
  const minus = IconButton({ icon: 'minus', label: `Decrease ${label}`, cls: 'stepper-btn' });
  const plus = IconButton({ icon: 'plus', label: `Increase ${label}`, cls: 'stepper-btn' });
  const el = h('div', { class: 'stepper', role: 'group', 'aria-label': label }, minus, h('div', { class: 'stepper-mid' }, input, unit ? h('span', { class: 'stepper-unit muted small' }, unit) : null), plus);
  const show = () => { input.value = v === null ? '' : format ? format(v) : String(v); minus.disabled = v === null || v <= min; plus.disabled = v !== null && v >= max; };
  const set = (n, { silent = false, say = true } = {}) => {
    let next = n === null ? null : Math.min(max, Math.max(min, round4(n)));
    const clamped = n !== null && next !== n;
    v = next; show();
    if (say) announce(v === null ? `${label} cleared` : `${label} ${show2(v)}${clamped ? `, limit ${n < min ? 'minimum' : 'maximum'}` : ''}`);
    if (!silent && onChange) onChange(v);
  };
  const show2 = (x) => (format ? format(x) : String(x)) + (unit ? ` ${unit}` : '');
  minus.addEventListener('click', () => set(v === null ? null : v - step));
  plus.addEventListener('click', () => set(v === null ? Math.max(min, step) : v + step));
  input.addEventListener('change', () => { const n = toNum(input.value); if (Number.isNaN(n)) { show(); announce(`${label} must be a number`); return; } set(n); });
  input.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); plus.click(); } else if (e.key === 'ArrowDown') { e.preventDefault(); minus.click(); } });
  show(); el.getValue = () => v; el.setValue = (n, o) => set(n, { silent: true, say: false, ...o }); el.input = input; el.decimals = decimals; return el;
}
export function SearchField({ label = 'Search', placeholder = '', value = '', onInput, onSubmit, autofocus = false }) {
  const input = h('input', { class: 'search-input', type: 'search', 'aria-label': label, placeholder, value, enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', autofocus: autofocus || null });
  const clearBtn = IconButton({ icon: 'close', label: 'Clear search', cls: 'search-clear', size: 20 }); clearBtn.hidden = !value;
  const el = h('form', { class: 'search', role: 'search' }, h('span', { class: 'search-icon' }, icon('search', { size: 20 })), input, clearBtn);
  input.addEventListener('input', () => { clearBtn.hidden = !input.value; if (onInput) onInput(input.value); });
  clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; input.focus(); if (onInput) onInput(''); });
  el.addEventListener('submit', (e) => { e.preventDefault(); if (onSubmit) onSubmit(input.value); });
  el.input = input; return el;
}
export function MealChips({ meals, selected, onChange, label = 'Meal' }) {
  let cur = selected;
  const el = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label });
  const btns = meals.map((m) => h('button', { type: 'button', role: 'radio', class: 'chip', 'data-id': m.id }, m.label));
  const paint = () => btns.forEach((b) => { const on2 = b.dataset.id === cur; b.setAttribute('aria-checked', String(on2)); b.tabIndex = on2 || (!cur && b === btns[0]) ? 0 : -1; b.classList.toggle('is-selected', on2); });
  const pick = (id, focus) => { cur = id; paint(); if (focus) btns.find((b) => b.dataset.id === id).focus(); if (onChange) onChange(id); };
  btns.forEach((b) => { b.addEventListener('click', () => pick(b.dataset.id)); el.appendChild(b); });
  el.addEventListener('keydown', (e) => { const i = Math.max(0, btns.findIndex((b) => b.dataset.id === cur)); let n = -1; if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % btns.length; else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + btns.length) % btns.length; if (n >= 0) { e.preventDefault(); pick(btns[n].dataset.id, true); } });
  paint(); el.getValue = () => cur; el.setValue = (id) => { cur = id; paint(); }; return el;
}
export function ServingPicker({ servings, value, onChange, label = 'Serving' }) {
  const sel = h('select', { class: 'input select' }, servings.map((s) => h('option', { value: s.id, selected: s.id === value }, s.label)));
  const f = FormField({ label, control: sel });
  sel.addEventListener('change', () => { if (onChange) onChange(sel.value); });
  f.getValue = () => sel.value; f.setValue = (id) => { sel.value = id; }; return f;
}
export function MacroPreview({ kcal, protein, carbs, fat, fiber, estimate = false, fiberPartial = false }) {
  const cell = (name, v, unit, tone) => h('div', { class: `macro macro-${tone}` }, h('dt', { class: 'macro-name small' }, name), h('dd', { class: 'macro-val' }, v === null || v === undefined ? DASH : `${fmtVal(v, 1)}${unit}`));
  return h('div', { class: 'macro-preview', role: 'group', 'aria-label': 'Nutrition for this entry' },
    h('dl', { class: 'macro-grid' }, cell('Calories', kcal === null || kcal === undefined ? null : Math.round(kcal), ' kcal', 'kcal'), cell('Protein', protein, ' g', 'protein'), cell('Carbs', carbs, ' g', 'carbs'), cell('Fat', fat, ' g', 'fat'), cell('Fibre', fiber, ' g', 'fiber')),
    estimate || fiberPartial ? h('p', { class: 'row-wrap small muted' }, estimate ? EstimateBadge({ kind: 'est' }) : null, fiberPartial ? EstimateBadge({ kind: 'approx', text: 'partial', explain: 'Some entries do not list fibre, so this total is incomplete.' }) : null) : null);
}

// ================================================================ rows
export function FoodRow({ name, detail, alias, kcalText, chips = [], estimate = false, approx = false, fav = null, onSelect, onToggleFav }) {
  const main = h('button', { type: 'button', class: 'row-main' },
    h('span', { class: 'row-title' }, name), alias ? h('span', { class: 'row-alias small muted' }, `also: ${alias}`) : null,
    h('span', { class: 'row-detail small muted' }, detail || ''));
  if (onSelect) main.addEventListener('click', onSelect);
  const badges = h('span', { class: 'row-badges' }, chips.map((c) => Chip({ label: c.label, tone: c.tone })), estimate ? EstimateBadge({ kind: 'est' }) : null, approx ? EstimateBadge({ kind: 'approx' }) : null);
  const li = h('li', { class: 'food-row' }, main, h('div', { class: 'row-side' }, kcalText ? h('span', { class: 'row-kcal' }, kcalText) : null, badges));
  if (fav !== null) { const fb = IconButton({ icon: 'heart', label: fav ? `Remove ${name} from favourites` : `Add ${name} to favourites`, pressed: fav, cls: cx('fav-btn', fav && 'is-fav') }); if (onToggleFav) fb.addEventListener('click', onToggleFav); li.appendChild(fb); }
  return li;
}
export function ExerciseRow({ name, detail, meta, trailing, onSelect }) {
  const main = h('button', { type: 'button', class: 'row-main' }, h('span', { class: 'row-title' }, name), detail ? h('span', { class: 'row-detail small muted' }, detail) : null, meta ? h('span', { class: 'row-detail small muted' }, meta) : null);
  if (onSelect) main.addEventListener('click', onSelect);
  return h('li', { class: 'exercise-row' }, main, trailing ? h('div', { class: 'row-side' }, trailing) : null);
}
export function PlanItemRow({ index, count, name, target, kcal, note, onEdit, onMoveUp, onMoveDown, onRemove, sortable = true }) {
  const main = h('button', { type: 'button', class: 'row-main' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-detail small muted' }, [target, kcal ? ` \u00B7 ${kcal}` : null]), note ? h('span', { class: 'row-detail small muted' }, note) : null);
  if (onEdit) main.addEventListener('click', onEdit);
  const grip = sortable ? h('span', { class: 'sort-handle', role: 'img', 'aria-label': `Drag to reorder ${name}` }, icon('grip', { size: 20 })) : null;
  const up = IconButton({ icon: 'up', label: `Move ${name} up`, disabled: index === 0 }); const down = IconButton({ icon: 'down', label: `Move ${name} down`, disabled: index === count - 1 });
  const rm = IconButton({ icon: 'trash', label: `Remove ${name}` });
  if (onMoveUp) up.addEventListener('click', onMoveUp); if (onMoveDown) down.addEventListener('click', onMoveDown); if (onRemove) rm.addEventListener('click', onRemove);
  return h('li', { class: 'plan-item sortable-item', 'data-index': index }, grip, main, h('div', { class: 'row-actions' }, up, down, rm));
}
/** Pointer drag reorder for lists of PlanItemRow. Up/down buttons remain the keyboard path. onReorder(from, to). Returns detach(). */
export function makeSortable(list, { onReorder, handle = '.sort-handle', item = '.sortable-item' }) {
  let drag = null;
  const items = () => [...list.querySelectorAll(item)];
  const down = (e) => {
    const hd = e.target.closest(handle); if (!hd) return; const el = hd.closest(item); const all = items(); const from = all.indexOf(el); if (from < 0) return;
    hd.setPointerCapture && hd.setPointerCapture(e.pointerId);
    drag = { el, from, to: from, y0: e.clientY, hgt: el.getBoundingClientRect().height + 8, all, pid: e.pointerId }; el.classList.add('is-dragging'); e.preventDefault();
  };
  const move = (e) => {
    if (!drag) return; const dy = e.clientY - drag.y0; drag.el.style.setProperty('--dy', `${dy}px`);
    const to = Math.max(0, Math.min(drag.all.length - 1, drag.from + Math.round(dy / drag.hgt))); drag.to = to;
    drag.all.forEach((it, i) => { if (it === drag.el) return; const s = drag.from < to && i > drag.from && i <= to ? -drag.hgt : drag.from > to && i >= to && i < drag.from ? drag.hgt : 0; it.style.setProperty('--dy', `${s}px`); });
  };
  const up = () => {
    if (!drag) return; const d = drag; drag = null; d.all.forEach((it) => { it.style.removeProperty('--dy'); it.classList.remove('is-dragging'); });
    if (d.to !== d.from) { onReorder(d.from, d.to); announce(`Moved to position ${d.to + 1} of ${d.all.length}`); }
  };
  list.addEventListener('pointerdown', down); list.addEventListener('pointermove', move); list.addEventListener('pointerup', up); list.addEventListener('pointercancel', up);
  return () => { list.removeEventListener('pointerdown', down); list.removeEventListener('pointermove', move); list.removeEventListener('pointerup', up); list.removeEventListener('pointercancel', up); };
}
export function ProfileCard({ profile, index = 0, subtitle, onSelect }) {
  const b = h('button', { type: 'button', class: 'profile-card' }, ProfileDot({ name: profile.name, index, size: 48 }), h('span', { class: 'grow' }, h('span', { class: 'profile-name' }, profile.name), subtitle ? h('span', { class: 'small muted' }, subtitle) : null), icon('forward', { size: 20 }));
  if (onSelect) b.addEventListener('click', () => onSelect(profile));
  return b;
}
export function ProfileDot({ name, index = 0, size = 32 }) {
  return h('span', { class: `profile-dot pc-${index % 4}`, 'data-size': size, 'aria-hidden': 'true' }, (name || '?').trim().charAt(0).toUpperCase());
}

// ================================================================ metrics
export function Ring({ value, max, size = 168, tone = 'primary', label, centerTop, centerBottom, summary }) {
  const none = value === null || value === undefined;
  const text = summary || (none ? `${label}: no data yet` : `${label}: ${fmtVal(value, 0)} of ${fmtVal(max, 0)}${value > max ? ', over target' : ''}`);
  return h('div', { class: cx('ring', `tone-${tone}`), role: 'img', 'aria-label': text, 'data-size': size },
    ringPlot({ value, max, size, tone, label }), h('div', { class: 'ring-center', 'aria-hidden': 'true' }, h('span', { class: 'ring-top' }, centerTop ?? (none ? DASH : fmtVal(value, 0))), centerBottom ? h('span', { class: 'ring-bottom small muted' }, centerBottom) : null));
}
export function ProgressBar({ value, max, label, valueText, tone = 'primary', over = false }) {
  const none = value === null || value === undefined; const pct = none || !(max > 0) ? 0 : Math.min(100, (value / max) * 100);
  const fill = h('span', { class: 'pbar-fill' }); fill.style.setProperty('--pct', `${pct}%`);
  return h('div', { class: cx('pbar', `tone-${tone}`, over && 'is-over') },
    h('div', { class: 'pbar-head small' }, h('span', { class: 'pbar-label' }, label), h('span', { class: 'pbar-value num' }, valueText ?? (none ? DASH : `${fmtVal(value, 0)} / ${fmtVal(max, 0)}`))),
    h('div', { class: 'pbar-track', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max > 0 ? max : 0, 'aria-valuenow': none ? null : value, 'aria-valuetext': none ? 'No data' : (valueText || null) }, fill));
}
export function MetricTile({ label, value, unit, sub, icon: ic, tone = 'primary', href, onClick, actions = [], badge, children }) {
  const empty = value === null || value === undefined;
  const head = h('div', { class: 'tile-head' }, ic ? h('span', { class: 'tile-icon' }, icon(ic, { size: 20 })) : null, h('span', { class: 'tile-label small' }, label), badge || null);
  const body = h('div', { class: 'tile-body' }, h('span', { class: 'tile-value' }, empty ? DASH : String(value)), unit && !empty ? h('span', { class: 'tile-unit muted' }, unit) : null);
  const kids = [head, body, sub ? h('p', { class: 'tile-sub small muted' }, sub) : null, children || null, actions.length ? h('div', { class: 'tile-actions' }, actions.map((a) => Button({ label: a.label, ariaLabel: a.ariaLabel, icon: a.icon, kind: a.kind || 'secondary', size: 'sm', onClick: a.onClick }))) : null];
  const cls = cx('tile', `tone-${tone}`, (href || onClick) && 'tile-link');
  if (href) return h('a', { class: cls, href }, kids);
  if (onClick) { const b = h('button', { type: 'button', class: cls }, kids); b.addEventListener('click', onClick); return b; }
  return h('div', { class: cls }, kids);
}
export function DateNavigator({ date, onChange, now = new Date() }) {
  const today = todayKey(now), max = maxAllowedKey(now);
  const prev = IconButton({ icon: 'back', label: 'Previous day', disabled: date <= MIN_DATE }); const next = IconButton({ icon: 'forward', label: 'Next day', disabled: date >= max });
  const picker = h('input', { type: 'date', class: 'date-native', value: date, min: MIN_DATE, max, tabindex: '-1', 'aria-hidden': 'true', 'aria-label': 'Date' });
  const btn = h('button', { type: 'button', class: 'date-btn', 'aria-label': `Date: ${formatDay(date)}. Choose a date` }, icon('calendar', { size: 18 }), h('span', null, date === today ? `Today, ${formatDay(date)}` : formatDay(date)));
  btn.addEventListener('click', () => { if (picker.showPicker) { try { picker.showPicker(); return; } catch { /* fall through */ } } picker.focus(); picker.click(); });
  picker.addEventListener('change', () => { if (isValidKey(picker.value) && picker.value >= MIN_DATE && picker.value <= max) onChange(picker.value); });
  prev.addEventListener('click', () => onChange(addDays(date, -1))); next.addEventListener('click', () => onChange(addDays(date, 1)));
  const chip = date !== today ? h('div', { class: 'date-other row-wrap small' }, h('span', { class: 'chip chip-warn' }, `Viewing ${formatDay(date)}`), Button({ label: 'Jump to today', kind: 'ghost', size: 'sm', onClick: () => onChange(today) })) : null;
  return h('div', { class: 'datenav' }, h('div', { class: 'datenav-row' }, prev, btn, next, picker), chip);
}

// ================================================================ sheets and dialogs
let sheetCount = 0;
/** Native <dialog> confirm. Resolves true/false. Not routed. Esc = false. */
export function ConfirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const tid = uid('cd'); let result = false;
    const cancel = Button({ label: cancelLabel, kind: 'secondary' }); const ok = Button({ label: confirmLabel, kind: danger ? 'danger' : 'primary' });
    const dlg = h('dialog', { class: 'confirm', 'aria-labelledby': tid }, h('div', { class: 'confirm-body stack-sm' }, h('h2', { id: tid, class: 'confirm-title' }, title), message ? h('p', { class: 'muted' }, message) : null), h('div', { class: 'confirm-actions' }, cancel, ok));
    cancel.addEventListener('click', () => dlg.close()); ok.addEventListener('click', () => { result = true; dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.appendChild(dlg); dlg.showModal(); (danger ? cancel : ok).focus();
  });
}
/** Route-backed sheet. Return it from a registerSheet factory. size 'auto' | 'full'. dirty: () => boolean (guards Back, Esc, backdrop, X). */
export function Sheet({ ctx, title, body, footer, size = 'auto', dirty = null, headerAction }) {
  const tid = uid('sheet'); let opener = null; let closing = false;
  const closeBtn = IconButton({ icon: 'close', label: 'Close', cls: 'sheet-close' });
  const bodyEl = h('div', { class: 'sheet-body' }, body); const footEl = footer ? h('div', { class: 'sheet-footer' }, footer) : null;
  const dlg = h('dialog', { class: `sheet sheet-${size}`, 'aria-labelledby': tid }, h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }), h('header', { class: 'sheet-head' }, h('h2', { id: tid, class: 'sheet-title' }, title), headerAction || null, closeBtn), bodyEl, footEl);
  const isDirty = () => !!(dirty && dirty());
  const confirm = () => ConfirmDialog({ title: 'Discard changes?', message: 'You have changes that are not saved.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true });
  const requestClose = async () => { if (closing) return; if (isDirty() && !(await confirm())) return; closing = true; setLeaveGuard(null); if (ctx) await ctx.close(); else api.dispose(); };
  closeBtn.addEventListener('click', requestClose);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) requestClose(); });
  const api = {
    el: dlg, body: bodyEl, footer: footEl, close: requestClose,
    setTitle: (t) => { dlg.querySelector('.sheet-title').textContent = t; },
    open() {
      opener = document.activeElement; document.body.appendChild(dlg); dlg.showModal(); sheetCount++; document.documentElement.classList.add('has-sheet');
      setLeaveGuard({ dirty: isDirty, confirm });
      if (size !== 'full' || !dlg.querySelector('[autofocus]')) focusFirstIn(bodyEl, closeBtn); else focusFirst(dlg);
    },
    dispose() {
      if (dlg.open) dlg.close(); dlg.remove(); setLeaveGuard(null); sheetCount = Math.max(0, sheetCount - 1); if (!sheetCount) document.documentElement.classList.remove('has-sheet');
      const back = opener && opener.isConnected ? opener : document.getElementById('main'); if (back) back.focus({ preventScroll: true }); opener = null;
    }
  };
  return api;
}
function focusFirstIn(root, fallback) { if (!focusFirst(root)) fallback.focus(); }

// ================================================================ toast
let toastEl = null, toastTimer = 0;
function toastRegion() { if (!toastEl || !toastEl.isConnected) { toastEl = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastEl); } return toastEl; }
/** One toast at a time. undo: () => void shows an Undo button (6 s, D-054). Returns {dismiss}. */
export function toast(message, { undo = null, duration = 6000, undoLabel = 'Undo' } = {}) {
  const region = toastRegion(); clearTimeout(toastTimer); clear(region);
  const t = h('div', { class: 'toast' }, h('span', { class: 'toast-msg' }, message));
  const dismiss = () => { clearTimeout(toastTimer); if (t.parentNode) t.remove(); };
  if (undo) { const ub = h('button', { type: 'button', class: 'toast-undo' }, undoLabel); ub.addEventListener('click', () => { dismiss(); undo(); }); t.appendChild(ub); }
  region.appendChild(t); toastTimer = setTimeout(dismiss, duration);
  t.addEventListener('focusin', () => clearTimeout(toastTimer)); t.addEventListener('focusout', () => { toastTimer = setTimeout(dismiss, 3000); });
  return { dismiss };
}
toast.clear = () => { clearTimeout(toastTimer); if (toastEl) clear(toastEl); };

// ================================================================ banners (D-066: one at a time, fixed priority)
export const BANNER_PRIORITY = { 'storage-red': 2, 'write-error': 2, update: 3, backup: 4, 'storage-amber': 5, install: 6, checkin: 7 };
const bannerSpecs = new Map(); let bannerSlot = null;
function paintBanner() {
  if (!bannerSlot) return; clear(bannerSlot);
  let best = null; for (const [id, s] of bannerSpecs) { const p = s.priority ?? BANNER_PRIORITY[id] ?? 9; if (!best || p < best.p) best = { id, s, p }; }
  if (!best) return; const s = best.s;
  const el = h('div', { class: cx('banner', `banner-${s.kind || 'info'}`), 'data-banner': best.id, role: s.kind === 'danger' ? 'alert' : 'region', 'aria-label': s.title || 'Notice' },
    icon(s.kind === 'danger' || s.kind === 'warn' ? 'warning' : 'info', { size: 20 }), h('div', { class: 'banner-text grow' }, s.title ? h('strong', null, s.title) : null, s.text ? h('span', { class: 'small' }, ` ${s.text}`) : null),
    h('div', { class: 'banner-actions' }, (s.actions || []).map((a) => Button({ label: a.label, kind: 'secondary', size: 'sm', onClick: a.onClick })), s.onDismiss ? IconButton({ icon: 'close', label: 'Dismiss notice', size: 18, onClick: () => { s.onDismiss(); } }) : null));
  bannerSlot.appendChild(el);
}
export const banners = {
  mount(slot) { bannerSlot = slot; paintBanner(); },
  set(id, spec) { bannerSpecs.set(id, spec); paintBanner(); },
  clear(id) { if (bannerSpecs.delete(id)) paintBanner(); },
  clearAll() { bannerSpecs.clear(); paintBanner(); },
  current() { const el = bannerSlot && bannerSlot.querySelector('[data-banner]'); return el ? el.dataset.banner : null; }
};

// ================================================================ charts (wrappers over charts.js)
export function DataTable({ caption, columns, rows, cls = '' }) {
  const wrap = h('div', { class: cx('table-wrap', cls), tabindex: '0', role: 'region', 'aria-label': caption });
  wrap.appendChild(h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, caption),
    h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', class: c.align === 'end' ? 'num-col' : '' }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => h('td', { class: c.align === 'end' ? 'num-col' : '' }, c.format ? c.format(r[c.key], r) : (r[c.key] === null || r[c.key] === undefined ? DASH : String(r[c.key])))))))));
  return wrap;
}
export const DEFAULT_RANGES = [{ id: '1M', label: '1M', days: 30 }, { id: '3M', label: '3M', days: 91 }, { id: '6M', label: '6M', days: 182 }, { id: '1Y', label: '1Y', days: 365 }, { id: 'All', label: 'All', days: null }];
function chartShell({ title, approx, tabs, stats, plot, readout, toggleTable, extra }) {
  return h('section', { class: 'chart-card card', 'aria-label': title }, h('div', { class: 'chart-head spread' }, h('h3', { class: 'chart-title' }, title), approx ? EstimateBadge({ kind: 'approx' }) : null), tabs || null, stats || null, plot, readout, extra || null, toggleTable);
}
function readoutBar(model, text, onStep) {
  const line = h('p', { class: 'readout small', 'aria-live': 'polite' }, 'Tap a point to see its value.');
  const prev = IconButton({ icon: 'back', label: 'Previous point', size: 18 }), next = IconButton({ icon: 'forward', label: 'Next point', size: 18 });
  prev.addEventListener('click', () => onStep(-1)); next.addEventListener('click', () => onStep(1));
  const bar = h('div', { class: 'readout-bar' }, prev, line, next); bar.line = line; return bar;
}
function wireChart({ svg, model, fmt }) {
  let selI = -1; const items = model.items;
  const bar = readoutBar(model, '', (d) => { if (!items.length) return; const n = selI < 0 ? (d > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, selI + d)); show(items[n]); });
  const show = (it) => { selI = it.i; markSelected(model, it); bar.line.textContent = fmt(it); };
  attachReadout(svg, model, show);
  if (!items.length) bar.hidden = true; return bar;
}
/** Chart card for one measurement/metric over time. points [{date,value}]. See charts.js for gap/trend rules. */
// F-A6-03: draw charts at about the width they are shown at, so axis text keeps its real size on a phone (it used to be drawn 640 wide and scaled down to ~6 px).
export function chartDims() {
  const width = Math.max(300, Math.min(640, (document.documentElement.clientWidth || 640) - 40));
  return { width, height: Math.max(170, Math.min(240, Math.round(width * 0.55))) };
}
export function LineChart({ title, points, unit = '', decimals = 1, tone = 'primary', ranges = DEFAULT_RANGES, range = '3M', target = null, targetLabel = 'Target', coverage = null, endDate = todayKey(), onRange, solidMaxGap = 1, dashedMaxGap = 3, approx = false, emptyText = 'Nothing in this range yet.' }) {
  const host = h('div', { class: 'chart-host' }); const state = { range, table: false };
  const draw = () => {
    clear(host); const r = ranges.find((x) => x.id === state.range) || ranges[ranges.length - 1];
    const from = r.days ? addDays(endDate, -(r.days - 1)) : null; const pts = points.filter((p) => p.value !== null && p.value !== undefined && (!from || p.date >= from) && p.date <= endDate).sort((a, b) => (a.date < b.date ? -1 : 1));
    const s = summarize(pts); const dec = decimals;
    const stats = h('dl', { class: 'chart-stats' }, stat('Latest', s.latest ? `${fmtVal(s.latest.value, dec)} ${unit}` : DASH, s.latest ? fmtDay(s.latest.date) : ''), stat('Previous', s.previous ? `${fmtVal(s.previous.value, dec)} ${unit}` : DASH, s.previous ? fmtDay(s.previous.date) : ''),
      stat('Change', s.change === null ? DASH : s.change === 0 ? 'No change' : `${s.change > 0 ? 'Up' : 'Down'} ${fmtVal(Math.abs(s.change), dec)} ${unit}`, ''));
    let body;
    if (state.table) body = DataTable({ caption: `${title} readings`, columns: [{ key: 'date', label: 'Date', format: (v) => fmtDay(v) }, { key: 'value', label: unit ? `Value (${unit})` : 'Value', align: 'end', format: (v) => fmtVal(v, dec) }], rows: [...pts].reverse() });
    else if (!pts.length) body = h('p', { class: 'muted chart-empty' }, emptyText);
    else {
      const { svg, model } = linePlot({ points: pts, from: from || pts[0].date, to: endDate, unit, decimals: dec, target, targetLabel, tone, solidMaxGap, dashedMaxGap, label: title, ...chartDims() }); svg.classList.add('chart-fit');
      const bar = wireChart({ svg, model, fmt: (it) => `${fmtDay(it.date)}: ${fmtVal(it.value, dec)} ${unit}` });
      body = h('div', { class: 'chart-plot' }, svg, pts.length < 2 ? h('p', { class: 'small muted' }, 'Add one more to see a line.') : null, bar);
    }
    host.append(...[stats, coverage ? h('p', { class: 'small muted' }, `${coverage.n} of ${coverage.N} days with data. Days with nothing logged are left out.`) : null, body].filter(Boolean),
      h('button', { type: 'button', class: 'link-btn', 'aria-pressed': String(state.table), onClick: () => { state.table = !state.table; draw(); } }, state.table ? 'Show as chart' : 'Show as table'));
  };
  const tabs = ranges.length > 1 ? Tabs({ tabs: ranges, selected: range, label: `${title} range`, onSelect: (id) => { state.range = id; draw(); if (onRange) onRange(id); } }) : null;
  draw();
  return chartShell({ title, approx, tabs, plot: host });
}
const stat = (k, v, sub) => h('div', { class: 'chart-stat' }, h('dt', { class: 'small muted' }, k), h('dd', null, v, sub ? h('span', { class: 'small muted' }, ` ${sub}`) : null));
/** Bar chart of per-day totals. bars [{date, value|null}]. null = no data (gap, never 0). coverage {n, N} shows 'n of N days'. */
export function BarChart({ title, bars, unit = '', decimals = 0, tone = 'primary', target = null, targetLabel = 'Target', coverage = null, ranges = null, range, onRange, endDate = todayKey() }) {
  const host = h('div', { class: 'chart-host' }); const state = { range: range || (ranges && ranges[0].id), table: false };
  const draw = () => {
    clear(host); let data = bars;
    if (ranges) { const r = ranges.find((x) => x.id === state.range) || ranges[0]; if (r.days) { const from = addDays(endDate, -(r.days - 1)); data = bars.filter((b) => b.date >= from && b.date <= endDate); } }
    const have = data.filter((b) => b.value !== null && b.value !== undefined);
    const cov = coverage && !ranges ? coverage : { n: have.length, N: data.length };
    let body;
    if (state.table) body = DataTable({ caption: `${title} values`, columns: [{ key: 'date', label: 'Date', format: (v) => fmtDay(v) }, { key: 'value', label: unit ? `Value (${unit})` : 'Value', align: 'end', format: (v) => fmtVal(v, decimals) }], rows: [...data].reverse() });
    else if (!have.length) body = h('p', { class: 'muted chart-empty' }, 'Not enough data yet.');
    else { const { svg, model } = barPlot({ bars: data, unit, decimals, target, targetLabel, tone, label: title, ...chartDims() }); svg.classList.add('chart-fit'); const bar = wireChart({ svg, model, fmt: (it) => `${fmtDay(it.date)}: ${it.value === null ? 'No data' : `${fmtVal(it.value, decimals)} ${unit}`}` }); body = h('div', { class: 'chart-plot' }, svg, bar); }
    host.append(h('p', { class: 'small muted' }, `${cov.n} of ${cov.N} days with data. Days with nothing logged are left out, not counted as zero.`), body,
      h('button', { type: 'button', class: 'link-btn', 'aria-pressed': String(state.table), onClick: () => { state.table = !state.table; draw(); } }, state.table ? 'Show as chart' : 'Show as table'));
  };
  const tabs = ranges ? Tabs({ tabs: ranges, selected: state.range, label: `${title} range`, onSelect: (id) => { state.range = id; draw(); if (onRange) onRange(id); } }) : null;
  draw(); return chartShell({ title, tabs, plot: host });
}

// ================================================================ photos and wizard
export function PhotoSlot({ slot, label, url = null, busyText = null, error = null, onFile, onRemove }) {
  const mk = (cap) => { const inp = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', tabindex: '-1', 'aria-label': `${cap} for ${label}` }); if (cap === 'Take photo') inp.setAttribute('capture', 'environment'); inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (f && onFile) onFile(f, slot); inp.value = ''; }); return inp; };
  const cam = mk('Take photo'), lib = mk('Choose photo');
  const preview = url ? h('img', { class: 'photo-img', src: url, alt: `${label} photo` }) : h('div', { class: 'photo-empty' }, icon('camera', { size: 28 }), h('span', { class: 'small muted' }, 'No photo'));
  return h('div', { class: 'photo-slot', 'data-slot': slot }, h('p', { class: 'photo-label' }, label), preview, busyText ? h('p', { class: 'small', role: 'status' }, busyText) : null, error ? h('p', { class: 'field-error small' }, error) : null,
    h('div', { class: 'row-wrap' }, Button({ label: 'Take photo', icon: 'camera', size: 'sm', onClick: () => cam.click() }), Button({ label: 'Choose photo', icon: 'image', size: 'sm', onClick: () => lib.click() }), url && onRemove ? Button({ label: 'Remove', kind: 'ghost', size: 'sm', ariaLabel: `Remove ${label} photo`, onClick: () => onRemove(slot) }) : null), cam, lib);
}
/** left/right: {label, date, photos:{front:url|null,...}}. Two equal columns at every width. Caller revokes object URLs. */
export function PhotoCompare({ left, right, slots, slot, onSlot }) {
  const col = (side) => { const u = side.photos[slot]; const has = !!(side.metas && side.metas[slot]); return h('figure', { class: 'compare-col' }, u ? h('img', { class: 'photo-img', src: u, alt: `${slot} photo, ${side.label}` }) : h('div', { class: 'photo-empty' }, h('span', { class: 'small muted' }, has || !side.metas ? 'Photo not in this backup' : 'No photo for this position')), h('figcaption', { class: 'small' }, `${side.label} \u00B7 ${fmtDay(side.date)}`)); };
  const apart = Math.abs(daysBetween(left.date, right.date));
  return h('div', { class: 'photo-compare stack-sm' }, Tabs({ tabs: slots.map((s) => ({ id: s, label: s.charAt(0).toUpperCase() + s.slice(1) })), selected: slot, label: 'Photo position', onSelect: onSlot }), h('div', { class: 'compare-grid' }, col(left), col(right)), h('p', { class: 'small muted' }, `${apart} ${apart === 1 ? 'day' : 'days'} apart`));
}
/** steps [{id, title, render: () => node}]. Step headings take focus on change. onNavigate(n) lets the screen sync the route (n is 1-based). */
export function Wizard({ steps, current = 1, onNavigate, onCancel, onFinish, finishLabel = 'Save', canAdvance }) {
  let cur = Math.min(Math.max(1, current), steps.length);
  const panel = h('div', { class: 'wizard-panel' }); const nav = h('div', { class: 'wizard-nav' });
  const el = h('div', { class: 'wizard stack' }, h('p', { class: 'wizard-progress small muted', 'aria-live': 'polite' }), panel, nav);
  const progress = el.firstChild;
  const paint = (focus) => {
    const s = steps[cur - 1]; progress.textContent = `Step ${cur} of ${steps.length}`; clear(panel); panel.appendChild(h('h2', { class: 'wizard-title' }, s.title)); panel.appendChild(s.render()); clear(nav);
    nav.appendChild(cur === 1 ? Button({ label: 'Cancel', kind: 'ghost', onClick: () => onCancel && onCancel() }) : Button({ label: 'Back', onClick: () => go(cur - 1) }));
    nav.appendChild(cur === steps.length ? Button({ label: finishLabel, kind: 'primary', onClick: () => onFinish && onFinish() }) : Button({ label: 'Next', kind: 'primary', onClick: () => { if (!canAdvance || canAdvance(cur)) go(cur + 1); } }));
    if (focus) focusHeading(panel);
  };
  const go = (n) => { cur = n; if (onNavigate) onNavigate(n); paint(true); };
  paint(false); el.setStep = (n) => { cur = Math.min(Math.max(1, n), steps.length); paint(true); }; el.step = () => cur; return el;
}

// ================================================================ app shell
const NAV = [{ root: 'today', label: 'Today', icon: 'home' }, { root: 'food', label: 'Food', icon: 'food' }, { root: 'workout', label: 'Workout', icon: 'dumbbell' }, { root: 'body', label: 'Body', icon: 'body' }, { root: 'progress', label: 'Progress', icon: 'chart' }];
export function AppShell() {
  const main = h('main', { id: 'main', class: 'main', tabindex: '-1' }); const slot = h('div', { class: 'banner-slot' });
  const skip = h('button', { type: 'button', class: 'skip-link' }, 'Skip to content'); skip.addEventListener('click', () => main.focus());
  const links = new Map();
  const mkLink = (n) => { const a = h('a', { class: 'nav-item', href: `#/${n.root}`, 'data-root': n.root }, icon(n.icon, { size: 24 }), h('span', { class: 'nav-label' }, n.label)); a.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); goRoot(n.root, { reset: a.getAttribute('aria-current') === 'page' }); }); links.set(n.root, a); return a; };
  const settingsLink = h('a', { class: 'nav-item nav-settings', href: '#/settings', 'data-root': 'settings' }, icon('settings', { size: 24 }), h('span', { class: 'nav-label' }, 'Settings'));
  links.set('settings', settingsLink);
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(mkLink), settingsLink);
  // profile menu
  const dot = h('span', { class: 'profile-chip-dot' }); const nameEl = h('span', { class: 'profile-chip-name' });
  const chip = h('button', { type: 'button', class: 'profile-chip', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, dot, nameEl, icon('down', { size: 16 }));
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
  const item = (label, ic, fn) => { const b = h('button', { type: 'button', role: 'menuitem', class: 'menu-item' }, icon(ic, { size: 20 }), label); b.addEventListener('click', () => { closeMenu(); fn(); }); return b; };
  menu.append(item('Switch profile', 'user', () => switchProfile()), item('Settings', 'settings', () => navigate('#/settings')));
  const closeMenu = () => { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!menu.contains(e.target) && !chip.contains(e.target)) closeMenu(); };
  chip.addEventListener('click', () => { if (menu.hidden) { menu.hidden = false; chip.setAttribute('aria-expanded', 'true'); document.addEventListener('pointerdown', outside, true); menu.querySelector('button').focus(); } else closeMenu(); });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); chip.focus(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const b = [...menu.querySelectorAll('button')]; const i = b.indexOf(document.activeElement); b[(i + (e.key === 'ArrowDown' ? 1 : b.length - 1)) % b.length].focus(); } });
  const top = h('header', { class: 'topbar' }, h('div', { class: 'profile-menu' }, chip, menu), h('span', { class: 'topbar-brand muted small' }, 'Winter Arc'));
  const el = h('div', { class: 'shell', id: 'shell' }, skip, top, nav, slot, main);
  banners.mount(slot);
  return {
    el, outlet: main, bannerSlot: slot,
    setChrome(mode) { el.classList.toggle('shell--bare', mode === 'bare'); },
    setActiveRoot(root) { for (const [r, a] of links) { if (r === root) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); } },
    setProfile(p, index = 0) { if (!p) { nameEl.textContent = ''; return; } nameEl.textContent = p.name; dot.className = `profile-chip-dot pc-${index % 4}`; dot.textContent = (p.name || '?').trim().charAt(0).toUpperCase(); chip.setAttribute('aria-label', `Profile: ${p.name}. Open menu`); },
    closeMenu
  };
}
