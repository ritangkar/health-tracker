// S25 Progress hub: check-ins newest first (weight, photo thumbnails, average chips), New check-in, Compare photos. (A5)
// Links to Trends and Notes (A6) appear once those routes exist. Thumbnails are object URLs, revoked when the screen goes away.
import { h, mount, logError } from '../../core/dom.js';
import { Button, Card, Chip, EmptyState, EstimateBadge } from '../../ui/components.js';
import { listCheckins, listAllPhotos, getSettings } from '../../core/repo.js';
import { formatLong, todayKey, daysBetween } from '../../core/dates.js';
import { fmtNum, fmtDuration } from '../../core/units.js';
import { add, routeExists } from '../daily/shared.js';
import { createUrlBag } from '../photos/url-bag.js';
import { wizardInProgress, resetWizard, startCheckin } from './wizard.js';
import { checkinDue } from './banner.js';

const PAGE = 30;
export function statChips(s) {
  if (!s) return [];
  const c = [];
  if (s.avgKcal != null) c.push(`${fmtNum(s.avgKcal)} kcal`);
  if (s.avgSteps != null) c.push(`${fmtNum(s.avgSteps)} steps`);
  if (s.avgSleepMin != null) c.push(`${fmtDuration(s.avgSleepMin)} sleep`);
  if (s.workoutCompletionAvg != null) c.push(`${s.workoutCompletionAvg}% workouts`);
  return c;
}
export async function progressScreen(ctx) {
  const { pid } = ctx; const el = h('section', { class: 'screen progress-screen' }); const bag = createUrlBag(); let alive = true; let shown = PAGE;
  ctx.onCleanup(() => { alive = false; bag.revokeAll(); });
  async function paint() {
    let list, hasTrends, hasNotes, st;
    try { [list, hasTrends, hasNotes, st] = await Promise.all([listCheckins(pid), routeExists('/progress/trends'), routeExists('/progress/notes'), getSettings(pid)]); }
    catch (e) { logError(e, 'progress load'); if (alive) mount(el, EmptyState({ icon: 'warning', title: 'Could not load check-ins', text: 'Your data is safe. Try again.', action: { label: 'Try again', onClick: paint }, headingLevel: 1 })); return; }
    if (!alive) return; bag.retire();
    const resume = wizardInProgress(pid);
    const interval = (st.uiPrefs && st.uiPrefs.checkinIntervalDays) ?? 7;
    const due = checkinDue({ interval, latest: list[0] ? list[0].date : null, today: todayKey(), profileCreatedAt: null });
    const dueText = !list.length ? null : interval === 0 ? 'Check-in reminders are off (Settings, Display and days).' : due.due ? `It has been ${due.daysSince} days since your last check-in.` : `Your last check-in was ${due.daysSince === 0 ? 'today' : due.daysSince === 1 ? 'yesterday' : `${due.daysSince} days ago`}.`;
    const actions = h('div', { class: 'row-wrap' }, Button({ label: resume ? 'Continue check-in' : 'New check-in', icon: 'plus', kind: 'primary', onClick: () => startCheckin(pid) }),
      list.length >= 2 ? Button({ label: 'Compare photos', icon: 'image', href: '#/progress/compare' }) : null, hasTrends ? Button({ label: 'Trends', icon: 'chart', href: '#/progress/trends' }) : null, hasNotes ? Button({ label: 'Notes', icon: 'note', href: '#/progress/notes' }) : null);
    const resumeBox = resume ? h('div', { class: 'card stack-sm' }, h('p', { class: 'row-title' }, 'A check-in is in progress'), h('p', { class: 'small muted' }, 'It is kept in memory until you save it or close the app.'), h('div', { class: 'row-wrap' }, Button({ label: 'Start over', kind: 'ghost', size: 'sm', onClick: async () => { resetWizard(); await paint(); } }))) : null;
    if (!list.length) { mount(el, h('div', { class: 'food-head' }, h('h1', null, 'Progress')), resumeBox, EmptyState({ icon: 'chart', title: 'No check-ins yet', text: 'A check-in brings your weight, photos and weekly averages together so you can see how things are going.', action: { label: resume ? 'Continue check-in' : 'New check-in', onClick: () => startCheckin(pid) } }), hasTrends || hasNotes ? actions : null); return; }
    let allPhotos = []; try { allPhotos = await listAllPhotos(pid); } catch (e) { logError(e, 'progress photos'); } // one read instead of one transaction per check-in
    const byCheckin = new Map(); for (const m of allPhotos) { if (!byCheckin.has(m.checkinId)) byCheckin.set(m.checkinId, []); byCheckin.get(m.checkinId).push(m); }
    const metas = list.slice(0, shown).map((c) => byCheckin.get(c.id) || []);
    if (!alive) return;
    const rows = list.slice(0, shown).map((c, i) => {
      const thumbs = metas[i].filter((m) => m.thumb).sort((a, b) => ['front', 'side', 'back', 'flexed'].indexOf(a.slot) - ['front', 'side', 'back', 'flexed'].indexOf(b.slot)).slice(0, 4).map((m) => h('img', { class: 'ck-thumb', src: bag.make(m.thumb), alt: `${m.slot} photo`, loading: 'lazy', decoding: 'async' }));
      const chips = statChips(c.autoStats);
      return h('a', { class: 'checkin-card card', href: `#/progress/checkin/${encodeURIComponent(c.id)}`, 'aria-label': `Check-in ${formatLong(c.date)}` },
        h('span', { class: 'row-title' }, formatLong(c.date)),
        h('span', { class: 'small muted' }, c.weight != null ? `Weight ${fmtNum(c.weight, 1)} kg` : 'No weight entered', c.bodyFat != null ? ` \u00B7 Body fat ${fmtNum(c.bodyFat, 1)} %` : ''),
        thumbs.length ? h('span', { class: 'ck-thumbs' }, thumbs) : h('span', { class: 'small muted' }, 'No photos'),
        chips.length ? h('span', { class: 'row-wrap' }, chips.map((t) => Chip({ label: t }))) : null);
    });
    mount(el, h('div', { class: 'food-head' }, h('h1', null, 'Progress')), actions, resumeBox, dueText ? h('p', { class: 'small muted' }, dueText) : null, h('div', { class: 'checkin-list' }, rows),
      list.length > shown ? Button({ label: `Show more (${list.length - shown} left)`, kind: 'secondary', onClick: () => { shown += PAGE; paint(); } }) : null,
      h('p', { class: 'small muted' }, 'Photos stay on this device. Averages use only the days you logged.'));
    bag.flush();
  }
  await paint();
  return el;
}
