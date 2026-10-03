// Check-in due banner (D-059, D-066: lowest priority, id 'checkin'). Pure rule + a route hook that sets or clears it. (A5)
import { banners } from '../../ui/components.js';
import { appStore } from '../../core/store.js';
import { onRouteChange, navigate } from '../../core/router.js';
import { getSettings, listCheckins, getProfile } from '../../core/repo.js';
import { lsGet, lsSet } from '../../core/storage-health.js';
import { logError, debounce } from '../../core/dom.js';
import { todayKey, daysBetween } from '../../core/dates.js';

const DAY = 86400000;
/** Pure. interval 0 = off. latest = newest check-in date or null. profileCreatedAt used when there is no check-in yet. -> {due, reason, daysSince}. */
export function checkinDue({ interval, latest, today, profileCreatedAt = null, snoozeUntil = 0, now = Date.now() }) {
  if (![7, 14].includes(interval)) return { due: false, reason: 'off', daysSince: null };
  if (snoozeUntil && now < snoozeUntil) return { due: false, reason: 'snoozed', daysSince: null };
  if (latest) { const d = daysBetween(latest, today); return d >= interval ? { due: true, reason: 'interval', daysSince: d } : { due: false, reason: 'too-early', daysSince: d }; }
  if (profileCreatedAt && now - profileCreatedAt >= interval * DAY) return { due: true, reason: 'first', daysSince: null };
  return { due: false, reason: 'too-early', daysSince: null };
}
let shown = null;
export async function refreshCheckinBanner(path = '') {
  const pid = appStore.get('activeProfile');
  if (!pid || /^\/(progress\/checkin|pick|restore|safe-mode|settings\/import)/.test(path)) { if (shown) { banners.clear('checkin'); shown = null; } return; }
  try {
    const [st, list, prof] = await Promise.all([getSettings(pid), listCheckins(pid), getProfile(pid)]);
    const snooze = lsGet('checkinSnooze', null);
    const r = checkinDue({ interval: (st.uiPrefs && st.uiPrefs.checkinIntervalDays) ?? 7, latest: list[0] ? list[0].date : null, today: todayKey(), profileCreatedAt: prof ? prof.createdAt : null, snoozeUntil: snooze && snooze.pid === pid ? snooze.until : 0 });
    if (!r.due) { if (shown) { banners.clear('checkin'); shown = null; } return; }
    const key = `${pid}|${r.reason}`; if (shown === key) return; shown = key;
    banners.set('checkin', { kind: 'info', title: r.reason === 'first' ? 'Ready for your first check-in?' : 'Time for a check-in.', text: r.daysSince != null ? `It has been ${r.daysSince} days since your last one. It takes about two minutes.` : 'Weight, photos and your weekly averages in one place. It takes about two minutes.',
      actions: [{ label: 'Start check-in', onClick: () => navigate('#/progress/checkin/new') }], onDismiss: () => { lsSet('checkinSnooze', { pid, until: Date.now() + DAY }); banners.clear('checkin'); shown = null; } });
  } catch (e) { logError(e, 'checkin banner'); }
}
let installed = false;
export function installCheckinBanner() {
  if (installed) return; installed = true;
  const run = debounce((cur) => refreshCheckinBanner(cur && cur.path ? cur.path : ''), 250);
  onRouteChange((cur) => run(cur));
  let lastPid = appStore.get('activeProfile');
  appStore.subscribe((s) => { if (s.activeProfile !== lastPid) { lastPid = s.activeProfile; shown = null; } });
}
