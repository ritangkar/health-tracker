// S38 Display and days: week start, theme, open last profile, check-in reminder, backup reminder. (A4)
import { h, uid } from '../../core/dom.js';
import { Card, FormField, toast } from '../../ui/components.js';
import { getSettings, updateSettings, setUiPrefs } from '../../core/repo.js';
import { getMeta, setReminderInterval } from '../../core/storage-health.js';
import { getTheme, setTheme } from '../../app.js';
import { REMINDER } from '../../../config.js';
import { runSave } from '../daily/shared.js';
import { pageHead } from './common.js';

function select(label, hint, options, value, onChange) {
  const sel = h('select', { class: 'input select' }, options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
  const f = FormField({ label, hint, control: sel }); sel.addEventListener('change', () => onChange(sel.value, sel)); return f;
}
export async function displayScreen(ctx) {
  const { pid } = ctx; const s = await getSettings(pid); const reminder = await getMeta('reminderIntervalDays', REMINDER.defaultIntervalDays);
  const saved = (m = 'Saved') => toast(m, { duration: 2000 });
  // weekStart setting only: these three labels are the one place day names appear (a display setting, not a workout rule).
  const WEEK_START_OPTIONS = [['mon', 'Monday'], ['sun', 'Sunday'], ['sat', 'Saturday']]; // weekStart
  const week = select('Week starts on', 'Used for weekly views.', WEEK_START_OPTIONS, s.weekStart || 'mon', async (v) => { if ((await runSave(() => updateSettings(pid, { weekStart: v }))).ok) saved(); }); // weekStart
  const theme = select('Theme', 'Auto follows your device.', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], getTheme(), (v) => { setTheme(v); saved(); });
  const openLast = h('input', { type: 'checkbox', id: uid('ol'), checked: !!(s.uiPrefs && s.uiPrefs.openLastProfile) });
  openLast.addEventListener('change', async () => { if ((await runSave(() => setUiPrefs(pid, { openLastProfile: openLast.checked }))).ok) saved(); });
  const checkin = select('Check-in reminder', 'A gentle reminder to log a progress check-in.', [[0, 'Off'], [7, 'Every 7 days'], [14, 'Every 14 days']], (s.uiPrefs && s.uiPrefs.checkinIntervalDays) ?? 7, async (v) => { if ((await runSave(() => setUiPrefs(pid, { checkinIntervalDays: Number(v) }))).ok) saved(); });
  const backup = select('Backup reminder', 'Shown only when something changed since your last backup.', REMINDER.intervals.map((d) => [d, d === 0 ? 'Off' : `Every ${d} days`]), reminder, async (v) => { if ((await runSave(() => setReminderInterval(Number(v)))).ok) saved(); });
  return h('section', { class: 'screen screen-narrow' }, pageHead('Display and days'),
    Card({ children: [h('div', { class: 'stack' }, theme, week, h('label', { class: 'row check-row', htmlFor: openLast.id }, openLast, h('span', null, 'Open the last profile automatically (skip the picker)')), checkin, backup)] }),
    h('p', { class: 'small muted' }, 'The backup reminder applies to this whole device, not just this profile.'));
}
