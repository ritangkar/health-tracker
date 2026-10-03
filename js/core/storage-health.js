// Storage health, backup reminder, sentinel, install nudge. (A1)
// API: isStandalone, requestPersist(), persistedStatus(), estimate(), check(reason), getMeta(k,def), setMeta(k,v),
//  noteWrite(), getChangesSinceBackup(), recordBackup(ts?), getLastBackupAt(), reminderDecision(now?), snoozeReminder(now?),
//  setReminderInterval(days), writeSentinel(), detectLoss(), installNudgeDue(now?), dismissInstallNudge(now?),
//  lsGet, lsSet, lsRemove, sessionGet, sessionSet, sessionRemove
import { LS_PREFIX, SESSION_KEY, STORAGE, REMINDER, PHOTO } from '../../config.js';
import { get, put, count } from './db.js';

let lsPrefix = LS_PREFIX, sessKey = SESSION_KEY;
/** Tests only: isolate LocalStorage/sessionStorage keys from real data. */
export function setStoragePrefix(p) { lsPrefix = p; sessKey = p + 'session'; }
export function lsGet(k, def = null) { try { const v = localStorage.getItem(lsPrefix + k); return v === null ? def : JSON.parse(v); } catch { return def; } }
export function lsSet(k, v) { try { localStorage.setItem(lsPrefix + k, JSON.stringify(v)); return true; } catch { return false; } }
export function lsRemove(k) { try { localStorage.removeItem(lsPrefix + k); } catch { /* ignore */ } }
export function sessionGet() { try { const v = sessionStorage.getItem(sessKey); return v === null ? null : JSON.parse(v); } catch { return null; } }
export function sessionSet(v) { try { sessionStorage.setItem(sessKey, JSON.stringify(v)); return true; } catch { return false; } }
export function sessionRemove() { try { sessionStorage.removeItem(sessKey); } catch { /* ignore */ } }

export async function getMeta(k, def = null) { const r = await get('meta', k); return r ? r.v : def; }
export async function setMeta(k, v) { await put('meta', { k, v }); return v; }

export function isStandalone() {
  try {
    return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || (typeof navigator !== 'undefined' && navigator.standalone === true);
  } catch { return false; }
}
export async function requestPersist() {
  let status = 'unknown';
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (navigator.storage.persisted && await navigator.storage.persisted()) status = 'protected';
      else status = (await navigator.storage.persist()) ? 'protected' : 'not-protected';
    }
  } catch { status = 'unknown'; }
  try { await setMeta('persistedStatus', status); } catch { /* ignore */ }
  return status;
}
export async function persistedStatus() {
  try {
    if (navigator.storage && navigator.storage.persisted) { const s = (await navigator.storage.persisted()) ? 'protected' : 'not-protected'; await setMeta('persistedStatus', s); return s; }
  } catch { /* fall through */ }
  return (await getMeta('persistedStatus', 'unknown'));
}
/** level: ok | amber | red | unknown */
export function levelFor(usage, quota) {
  if (usage == null) return 'unknown';
  const frac = quota ? usage / quota : 0;
  if (usage >= STORAGE.redBytes || frac >= STORAGE.redFraction) return 'red';
  if (usage >= STORAGE.amberBytes || frac >= STORAGE.amberFraction) return 'amber';
  return 'ok';
}
export async function estimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage: usage ?? null, quota: quota ?? null, free: quota != null && usage != null ? quota - usage : null, level: levelFor(usage, quota) };
    }
  } catch { /* ignore */ }
  return { usage: null, quota: null, free: null, level: 'unknown' };
}
/** reason: 'photo-add' (needs free >= 2x photo bytes) | 'general'. Returns {allow, level, warn}. */
export async function check(reason = 'general', bytes = 0) {
  const e = await estimate();
  let allow = true;
  if (reason === 'photo-add' && e.free != null && bytes > 0 && e.free < PHOTO.minFreeFactor * bytes) allow = false;
  return { allow, level: e.level, warn: e.level === 'amber' || e.level === 'red', estimate: e };
}
/** Called by repo.js after each committed user-data write. Never throws. */
export async function noteWrite() {
  try {
    const n = (await getMeta('changesSinceBackup', 0)) + 1;
    await setMeta('changesSinceBackup', n);
    if (!(await getMeta('sentinelWrittenAt', null))) { await writeSentinel(); requestPersist(); }
  } catch { /* bookkeeping must never break a save */ }
}
export async function getChangesSinceBackup() { return getMeta('changesSinceBackup', 0); }
export async function getLastBackupAt() { const m = await getMeta('lastBackupAt', null); return m ?? lsGet('lastBackupAt', null); }
export async function recordBackup(ts = Date.now()) {
  await setMeta('lastBackupAt', ts); lsSet('lastBackupAt', ts); await setMeta('changesSinceBackup', 0); lsRemove('reminderSnoozeUntil');
  return ts;
}
const DAY = 86400000;
/** -> {due:boolean, reason:'never'|'interval'|'off'|'snoozed'|'no-changes'|'too-early'} */
export async function reminderDecision(now = Date.now()) {
  const interval = (await getMeta('reminderIntervalDays', REMINDER.defaultIntervalDays));
  if (!interval) return { due: false, reason: 'off' };
  const snooze = lsGet('reminderSnoozeUntil', 0);
  if (snooze && now < snooze) return { due: false, reason: 'snoozed' };
  const changes = await getChangesSinceBackup();
  if (changes < 1) return { due: false, reason: 'no-changes' };
  const last = await getLastBackupAt();
  if (last == null) {
    const first = (await getMeta('sentinelWrittenAt', null)) ?? lsGet('sentinel', {})?.firstWriteAt ?? now;
    return now - first >= REMINDER.firstNudgeDays * DAY ? { due: true, reason: 'never' } : { due: false, reason: 'too-early' };
  }
  return now - last >= interval * DAY ? { due: true, reason: 'interval' } : { due: false, reason: 'too-early' };
}
export function snoozeReminder(now = Date.now()) { lsSet('reminderSnoozeUntil', now + REMINDER.snoozeHours * 3600000); }
export async function setReminderInterval(days) {
  if (!REMINDER.intervals.includes(days)) throw new RangeError('Reminder interval must be one of ' + REMINDER.intervals.join('/'));
  await setMeta('reminderIntervalDays', days);
}
export async function writeSentinel() {
  const now = Date.now();
  await setMeta('sentinelWrittenAt', now);
  const installId = (await getMeta('installId', null)) ?? (await setMeta('installId', 'in_' + now.toString(36) + Math.random().toString(36).slice(2, 7)));
  lsSet('sentinel', { hadData: true, firstWriteAt: now, installId });
}
/** LS sentinel says data existed but IDB has no profiles -> Restore screen. */
export async function detectLoss() {
  const s = lsGet('sentinel', null);
  if (!s || !s.hadData) return false;
  try { return (await count('profiles')) === 0; } catch { return false; }
}
export function installNudgeDue(now = Date.now()) {
  if (isStandalone()) return false;
  const st = lsGet('installNudge', null);
  return !st || !st.dismissedAt || now - st.dismissedAt >= REMINDER.installNudgeReturnDays * DAY;
}
export function dismissInstallNudge(now = Date.now()) { lsSet('installNudge', { dismissedAt: now }); }
