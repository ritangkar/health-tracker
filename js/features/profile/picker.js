// S01: picker (every cold launch, D-042) and first-run setup (names, optional targets, install guidance). (A4)
import { h, clear } from '../../core/dom.js';
import { Button, ProfileCard, FormField, Card } from '../../ui/components.js';
import { selectProfile, invalidate } from '../../core/router.js';
import { listProfiles, createProfile } from '../../core/repo.js';
import { checkName, checkTargets, num } from '../../core/validate.js';
import { DEFAULT_TARGETS } from '../../../config.js';
import { isStandalone } from '../../core/storage-health.js';
import { canInstall, promptInstall } from '../../app.js';
import { runSave, add } from '../daily/shared.js';

export const NO_PIN_TEXT = 'There is no PIN in this version. Anyone who can open this app on this device can open either profile. Use your phone screen lock.';

export async function pickerScreen() {
  const profiles = await listProfiles();
  return profiles.length ? picker(profiles) : firstRun();
}

function picker(profiles) {
  const list = h('div', { class: 'stack-sm profile-list' }, profiles.map((p, i) => ProfileCard({ profile: p, index: i, onSelect: () => selectProfile(p.id) })));
  return h('section', { class: 'screen screen-narrow picker' },
    h('div', { class: 'picker-head stack-sm' }, h('h1', null, 'Who is using Winter Arc?'), h('p', { class: 'muted' }, 'Tap your name to open your day.')),
    list,
    h('p', { class: 'small muted picker-note' }, NO_PIN_TEXT),
    h('div', { class: 'row-wrap' }, Button({ label: 'Restore from a backup file', kind: 'ghost', icon: 'upload', href: '#/settings/import' })));
}

const TARGET_FIELDS = [
  { key: 'kcal', label: 'Calories (kcal)', mode: 'numeric' }, { key: 'protein', label: 'Protein (g)', mode: 'decimal' }, { key: 'carbs', label: 'Carbs (g)', mode: 'decimal' },
  { key: 'fat', label: 'Fat (g)', mode: 'decimal' }, { key: 'fiber', label: 'Fibre (g)', mode: 'decimal' }, { key: 'waterMl', label: 'Water (ml)', mode: 'numeric' }, { key: 'steps', label: 'Steps', mode: 'numeric' }
];

function firstRun() {
  const names = [FormField({ label: 'First profile name', value: 'Me', maxlength: 40, required: true }), FormField({ label: 'Second profile name', value: 'Partner', maxlength: 40, required: true })];
  const tFields = TARGET_FIELDS.map((f) => FormField({ label: f.label, type: 'text', inputmode: f.mode, value: String(DEFAULT_TARGETS[f.key]) }));
  const useTargets = h('input', { type: 'checkbox', id: 'fr-use-targets', checked: true });
  const status = h('p', { class: 'small', role: 'status' });
  const steps = [];
  if (!isStandalone()) {
    steps.push({ id: 'install', title: 'Install first', render: () => installStep() });
  }
  steps.push({ id: 'names', title: 'Who will use this device?', render: () => h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Each profile keeps its own food, workouts, sleep, body numbers and photos. You can rename them later in Settings.'), names) });
  steps.push({ id: 'targets', title: 'Daily targets (optional)', render: () => h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'These are only suggestions. Change them to suit you. Each profile can have its own targets later in Settings.'),
    h('label', { class: 'row check-row', htmlFor: 'fr-use-targets' }, useTargets, h('span', null, 'Set these targets for both profiles')),
    h('div', { class: 'target-grid' }, tFields), status) });
  const nameStepIndex = steps.findIndex((s) => s.id === 'names') + 1;

  function validNames() {
    let ok = true;
    names.forEach((f) => { const r = checkName(f.input.value, 40); f.setError(r.ok ? '' : r.hard[0].message); if (!r.ok) ok = false; });
    if (ok && names[0].input.value.trim().toLowerCase() === names[1].input.value.trim().toLowerCase()) { names[1].setError('Give each profile a different name.'); ok = false; }
    return ok;
  }
  function readTargets() {
    if (!useTargets.checked) return { ok: true, targets: null };
    const t = {}; let ok = true;
    TARGET_FIELDS.forEach((f, i) => { const n = num(tFields[i].input.value); tFields[i].setError(''); if (n === null) return; if (!Number.isFinite(n)) { tFields[i].setError('Enter a number.'); ok = false; } else t[f.key] = n; });
    if (!ok) return { ok };
    const r = checkTargets(t);
    r.hard.forEach((x) => { const i = TARGET_FIELDS.findIndex((f) => f.key === x.field); if (i >= 0) tFields[i].setError(x.message); });
    return r.ok ? { ok: true, targets: t } : { ok: false };
  }
  let cur = 1;
  const panel = h('div', { class: 'stack' }); const nav = h('div', { class: 'wizard-nav' }); const progress = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const finish = async () => {
    if (!validNames()) { go(nameStepIndex); return; }
    const t = readTargets(); if (!t.ok) return;
    status.textContent = 'Saving...';
    const res = await runSave(async () => {
      const a = await createProfile(names[0].input.value, t.targets ? { targets: t.targets } : {});
      await createProfile(names[1].input.value, t.targets ? { targets: t.targets } : {});
      return a;
    }, (list) => { status.textContent = list[0].message; });
    if (res.ok) await invalidate(); else if (!res.invalid) status.textContent = 'Could not save. Nothing was lost; try again.';
  };
  function paint(focus) {
    const s = steps[cur - 1]; progress.textContent = `Step ${cur} of ${steps.length}`;
    const title = h('h2', { class: 'wizard-title', tabindex: '-1' }, s.title);
    clear(panel); add(panel, title, s.render()); clear(nav);
    if (cur > 1) add(nav, Button({ label: 'Back', onClick: () => go(cur - 1) }));
    add(nav, cur === steps.length ? Button({ label: 'Start using Winter Arc', kind: 'primary', onClick: finish }) : Button({ label: 'Next', kind: 'primary', onClick: () => { if (cur !== nameStepIndex || validNames()) go(cur + 1); } }));
    if (focus) title.focus({ preventScroll: true });
  }
  function go(n) { cur = Math.min(Math.max(1, n), steps.length); paint(true); }
  paint(false);
  const wiz = h('div', { class: 'wizard stack' }, progress, panel, nav);
  return h('section', { class: 'screen screen-narrow first-run' }, h('div', { class: 'picker-head stack-sm' }, h('h1', null, 'Welcome to Winter Arc'), h('p', { class: 'muted' }, 'Everything stays on this device. No account, no sign-up.')), Card({ children: [wiz] }));
}

function installStep() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const box = h('div', { class: 'stack' });
  if (ios) {
    add(box, h('p', null, 'On iPhone and iPad, install Winter Arc before you create profiles. The installed app keeps its own storage, separate from Safari.'),
      h('ol', { class: 'steps-list stack-sm' }, h('li', null, 'Tap the Share button in Safari.'), h('li', null, 'Choose Add to Home Screen.'), h('li', null, 'Open Winter Arc from the new icon and set up your profiles there.')),
      h('p', { class: 'small muted' }, 'Already installed, or just trying it out? You can continue here.'));
  } else {
    add(box, h('p', null, 'Installing makes Winter Arc open faster, work offline, and helps the browser keep your data.'));
    if (canInstall()) add(box, Button({ label: 'Install Winter Arc', kind: 'primary', icon: 'download', onClick: () => promptInstall() }));
    else add(box, h('p', { class: 'small muted' }, 'Use your browser menu and choose Install or Add to Home Screen. You can also do this later from Settings.'));
  }
  return box;
}
