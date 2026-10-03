// S32 Targets and defaults. Effective-dated (D-040): a save applies from today and past days keep their targets. Also profile name and default step goal. (A4)
import { h, mount, uid } from '../../core/dom.js';
import { Card, Button, FormField, toast } from '../../ui/components.js';
import { getSettings, setTargets, updateSettings, listProfiles, renameProfile } from '../../core/repo.js';
import { resolveTargets } from '../../core/calc.js';
import { checkTargets, checkName, checkStepGoal, num } from '../../core/validate.js';
import { todayKey, formatDay } from '../../core/dates.js';
import { refreshProfileChip } from '../../app.js';
import { runSave } from '../daily/shared.js';
import { pageHead } from './common.js';

const FIELDS = [
  ['kcal', 'Calories (kcal)', 'numeric'], ['protein', 'Protein (g)', 'decimal'], ['carbs', 'Carbs (g)', 'decimal'], ['fat', 'Fat (g)', 'decimal'], ['fiber', 'Fibre (g)', 'decimal'], ['waterMl', 'Water (ml)', 'numeric'], ['steps', 'Steps', 'numeric']
];
export async function targetsScreen(ctx) {
  const { pid } = ctx; const settings = await getSettings(pid); const today = todayKey(); const cur = resolveTargets(settings.targetsHistory, today) || {};
  const profile = (await listProfiles()).find((p) => p.id === pid);
  const name = FormField({ label: 'Profile name', value: profile ? profile.name : '', maxlength: 40 });
  const stepGoal = FormField({ label: 'Default step goal', type: 'text', inputmode: 'numeric', value: String(settings.defaultStepGoal), hint: 'Used on days with no workout plan. A plan can set its own goal for a day.' });
  const fields = FIELDS.map(([k, label, mode]) => FormField({ label, type: 'text', inputmode: mode, value: cur[k] == null ? '' : String(cur[k]) }));
  const status = h('p', { class: 'small', role: 'status' });
  const hist = [...settings.targetsHistory].sort((a, b) => (a.from < b.from ? 1 : -1));
  async function save() {
    status.textContent = ''; [name, stepGoal, ...fields].forEach((f) => f.setError(''));
    const nm = checkName(name.input.value, 40); if (!nm.ok) { name.setError(nm.hard[0].message); name.input.focus(); return; }
    const sg = checkStepGoal(stepGoal.input.value); if (!sg.ok || sg.value === null) { stepGoal.setError(sg.ok ? 'Enter a step goal.' : sg.hard[0].message); stepGoal.input.focus(); return; }
    const t = {}; let bad = null;
    FIELDS.forEach(([k], i) => { const n = num(fields[i].input.value); if (n === null) return; if (!Number.isFinite(n)) { fields[i].setError('Enter a number.'); bad = bad || fields[i]; } else t[k] = n; });
    if (bad) { bad.input.focus(); return; }
    const chk = checkTargets(t); if (!chk.ok) { for (const x of chk.hard) { const i = FIELDS.findIndex(([k]) => k === x.field); if (i >= 0) fields[i].setError(x.message); } const first = fields.find((f) => !f.querySelector('.field-error').hidden); if (first) first.input.focus(); return; }
    const res = await runSave(async () => {
      if (profile && nm.ok && name.input.value.trim() !== profile.name) await renameProfile(pid, name.input.value);
      if (sg.value !== settings.defaultStepGoal) await updateSettings(pid, { defaultStepGoal: sg.value });
      if (Object.keys(t).length) await setTargets(pid, t, today);
    }, (l) => { status.textContent = l[0].message; });
    if (res.ok) { await refreshProfileChip(); toast('Saved. Targets apply from today.'); ctx.replace('#/settings'); }
  }
  const form = h('form', { class: 'stack', novalidate: true }, name, stepGoal, h('div', { class: 'target-grid' }, fields), h('p', { class: 'small muted' }, 'Changes apply from today. Past days keep the targets they had.'), status, Button({ label: 'Save', kind: 'primary', block: true, type: 'submit' }));
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  return h('section', { class: 'screen screen-narrow' }, pageHead('Targets and defaults'), Card({ children: [form] }),
    hist.length ? Card({ title: 'Target history', children: [h('ul', { class: 'stack-sm small' }, hist.map((e) => h('li', null, h('strong', null, `From ${formatDay(e.from)} ${e.from.slice(0, 4)}`), `: ${FIELDS.filter(([k]) => e[k] != null).map(([k, l]) => `${l.replace(/ \(.*\)/, '')} ${e[k]}`).join(', ')}`)))] }) : null);
}
