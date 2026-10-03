// DOM helpers. No innerHTML anywhere: text always goes in as text nodes. (A3)
// API: h(tag, props, ...children), svgEl(tag, attrs, ...children), mount(parent, ...children), clear(el), on(el, type, fn, opts)->off,
//  FOCUSABLE, focusFirst(root), focusHeading(root), uid(prefix), announce(msg, {assertive}), initLiveRegions(root),
//  logError(err, where), getErrors(), reportWriteError(err), debounce(fn, ms), toNum(text), cx(...classes)
// h props: class | className, dataset {k:v}, vars {'--x': v} (CSS custom properties through setProperty), on {click: fn} or onClick: fn,
//  aria-* / role / any other name -> setAttribute (true -> '', false/null/undefined skipped); value, checked, selected, disabled, hidden, indeterminate -> properties.
//  A 'style' prop throws: CSP forbids style attributes (D-052). Use classes, data attributes or vars.
import { appStore } from './store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'indeterminate', 'readOnly', 'required', 'multiple', 'autofocus']);

function appendChildren(parent, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false || k === true) continue;
    if (Array.isArray(k)) appendChildren(parent, k);
    else if (k instanceof Node) parent.appendChild(k);
    else parent.appendChild(document.createTextNode(String(k)));
  }
}
function applyProps(el, props, isSvg) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'style') throw new Error('h(): style attributes are blocked by the CSP. Use classes, data attributes or vars.');
    if (k === 'class' || k === 'className') { if (isSvg) el.setAttribute('class', v); else el.className = v; }
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) { if (dv !== null && dv !== undefined) el.dataset[dk] = String(dv); }
    else if (k === 'vars') for (const [vk, vv] of Object.entries(v)) el.style.setProperty(vk, String(vv));
    else if (k === 'on') for (const [ek, fn] of Object.entries(v)) el.addEventListener(ek, fn);
    else if (/^on[A-Z]/.test(k)) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'htmlFor') el.setAttribute('for', v);
    else if (!isSvg && PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  applyProps(el, props, false);
  appendChildren(el, kids);
  return el;
}
export function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, attrs, true);
  appendChildren(el, kids);
  return el;
}
export function mount(parent, ...kids) { clear(parent); appendChildren(parent, kids); return parent; }
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function on(el, type, fn, opts) { el.addEventListener(type, fn, opts); return () => el.removeEventListener(type, fn, opts); }
export const cx = (...a) => a.flat().filter(Boolean).join(' ');
let uidN = 0;
export const uid = (prefix = 'u') => `${prefix}-${++uidN}`;
export const debounce = (fn, ms = 150) => { let t = 0; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
/** Decimal comma accepted. '' -> null, junk -> NaN. */
export function toNum(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim().replace(',', '.');
  if (s === '') return null;
  return /^-?\d*\.?\d+$|^-?\d+\.$/.test(s) ? Number(s) : NaN;
}

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function focusFirst(root) {
  const el = root.querySelector('[autofocus]') || root.querySelector(FOCUSABLE);
  if (el) { el.focus({ preventScroll: false }); return true; }
  return false;
}
/** Move focus to the screen heading (route and wizard step changes). */
export function focusHeading(root) {
  const t = root.querySelector('h1, h2');
  if (!t) return false;
  if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
  t.focus({ preventScroll: true });
  return true;
}

// ---- aria-live announcer
let polite = null, assertive = null;
export function initLiveRegions(root = document.body) {
  if (polite && polite.isConnected) return;
  polite = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', id: 'live-polite' });
  assertive = h('div', { class: 'sr-only', role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true', id: 'live-assertive' });
  root.append(polite, assertive);
}
export function announce(message, { assertive: loud = false } = {}) {
  if (!polite) initLiveRegions();
  const r = loud ? assertive : polite;
  r.textContent = '';
  setTimeout(() => { r.textContent = String(message); }, 30); // re-insert so repeated text is read again
}

// ---- error ring (20) and write errors, read by Self-check
export function logError(err, where = '') {
  const message = String(err && err.message ? err.message : err).slice(0, 300);
  const entry = { t: Date.now(), where, name: err && err.name ? err.name : 'Error', message };
  const list = [...(appStore.get('errors') || []), entry].slice(-20);
  appStore.set('errors', list);
  return entry;
}
export const getErrors = () => appStore.get('errors') || [];
/** Screens call this when a save fails. Shows the write-failure banner (D-066 priority 2). */
export function reportWriteError(err) {
  logError(err, 'write');
  appStore.set('writeError', { message: String(err && err.message ? err.message : err), quota: !!(err && err.name === 'QuotaError'), at: Date.now() });
}
