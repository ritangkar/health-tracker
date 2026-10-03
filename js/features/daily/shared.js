// Helpers shared by the W1 screens (A4): save guard, soft-confirm, meal list, date hashes, targets lookup.
import { ConfirmDialog } from '../../ui/components.js';
import { setLeaveGuard } from '../../core/router.js';
import { ValidationError, getSettings } from '../../core/repo.js';
import { reportWriteError } from '../../core/dom.js';
import { todayKey } from '../../core/dates.js';
import { listMealCategories } from '../../core/seed.js';
import { resolveTargets } from '../../core/calc.js';

/** Asks once about SOFT warnings. Resolves true when there is nothing to ask or the person confirms. */
export async function confirmSoft(result) {
  if (!result || !result.soft || !result.soft.length) return true;
  return ConfirmDialog({ title: 'This looks unusual', message: result.soft.map((s) => s.message).join(' '), confirmLabel: 'Save anyway', cancelLabel: 'Go back' });
}
export const hardMessages = (err) => (err instanceof ValidationError ? err.result.hard.map((x) => ({ code: x.code, field: x.field, message: x.message })) : null);
/** Runs a save. Validation errors go to onInvalid(list); anything else raises the write-failure banner (D-066). */
export async function runSave(fn, onInvalid) {
  try { return { ok: true, value: await fn() }; }
  catch (e) {
    const list = hardMessages(e);
    if (list) { if (onInvalid) onInvalid(list); return { ok: false, invalid: true }; }
    reportWriteError(e); return { ok: false };
  }
}
/** '#/food/add' + ?d= only when the viewed date is not today. */
export function dateHash(path, date, extra = {}) {
  const q = { ...extra }; if (date && date !== todayKey()) q.d = date;
  const s = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `#${path}${s ? `?${s}` : ''}`;
}
export const todayPath = (date, tail = '') => `#/today${date && date !== todayKey() ? `/${date}` : ''}${tail}`;

const FALLBACK_MEALS = [
  { id: 'meal:breakfast', label: 'Breakfast', sortOrder: 1, clockFrom: 0, clockTo: 11 }, { id: 'meal:lunch', label: 'Lunch', sortOrder: 2, clockFrom: 11, clockTo: 15 },
  { id: 'meal:snacks', label: 'Snacks', sortOrder: 3, clockFrom: 15, clockTo: 18 }, { id: 'meal:dinner', label: 'Dinner', sortOrder: 4, clockFrom: 18, clockTo: 23 },
  { id: 'meal:other', label: 'Other', sortOrder: 5, clockFrom: 23, clockTo: 24 }
];
export function meals() { const l = listMealCategories(); return (l.length ? l : FALLBACK_MEALS).slice().sort((a, b) => a.sortOrder - b.sortOrder); }
/** D-046: preselect by local clock; Other is the fallback. */
export function mealForHour(list, hour = new Date().getHours()) { return list.find((m) => hour >= m.clockFrom && hour < m.clockTo) || list.find((m) => m.id === 'meal:other') || list[list.length - 1]; }
export const mealById = (list, id) => list.find((m) => m.id === id) || null;

export async function settingsAndTargets(pid, date) {
  const settings = await getSettings(pid);
  return { settings, targets: resolveTargets(settings.targetsHistory, date) };
}
export const r1 = (x) => Math.round((x + Number.EPSILON) * 10) / 10;
/** Submit button that lives in a sheet footer but submits the form in the body. */
export function bindSubmit(button, formId) { button.setAttribute('type', 'submit'); button.setAttribute('form', formId); return button; }
/** Is any screen registered whose pattern starts with this prefix? (W2 screens may not exist yet.) */
export async function routeExists(prefix) { const { listRoutes, ensureRoutes } = await import('../../core/router.js'); await ensureRoutes(prefix); return listRoutes().some((r) => r.pattern.startsWith(prefix)); }

/** Food sheets opened from Today carry from=today. Closing or finishing then goes Back to Today (history pop, so Today reloads with fresh data). */
export const cameFromToday = (ctx) => ctx.query && ctx.query.from === 'today';
export function sheetCtx(ctx, date) { return cameFromToday(ctx) ? { ...ctx, close: () => ctx.back(todayPath(date)) } : ctx; }
export function finishAdd(ctx, date) { if (cameFromToday(ctx)) { setLeaveGuard(null); return ctx.back(todayPath(date)); } return ctx.close({ refresh: true }); }
/** Reads a record owned by a profile. Missing or foreign ids both become Not found, never a leak (R-034). */
export async function ownedOrNull(promise) { try { return (await promise) || null; } catch (e) { if (e && /another profile/.test(String(e.message))) return null; throw e; } }
/** Null-safe append: skips null, undefined, false; flattens arrays. Native append() would print "null". */
export function add(parent, ...kids) { for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false && k !== true) parent.append(k); return parent; }
