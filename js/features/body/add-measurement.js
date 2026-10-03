// S23 Add measurement (also edit). One sheet for the hub (/body/add), the graph (/body/:type/add) and editing (/body/:type/edit/:id). (A5)
import { h, uid } from '../../core/dom.js';
import { Sheet, FormField, Button, toast, EstimateBadge } from '../../ui/components.js';
import { notFound } from '../../core/router.js';
import { addMeasurement, editMeasurement, measurementSeries } from '../../core/repo.js';
import { checkMeasurement, checkDate, cleanText } from '../../core/validate.js';
import { todayKey, maxAllowedKey } from '../../core/dates.js';
import { MIN_DATE } from '../../../config.js';
import { confirmSoft, runSave, bindSubmit, add } from '../daily/shared.js';
import { measurementTypes, typeByKey } from './series.js';

const APPROX_EXPLAIN = 'Body fat from scales and calipers is approximate. Use it to see direction over time, not as an exact number.';

export async function measurementSheet(ctx) {
  const { pid } = ctx; const editId = ctx.params.id || null; const fixedKey = ctx.params.typeId || null;
  let key = fixedKey || ctx.query.type || 'weight';
  if (!typeByKey(key)) { if (fixedKey) notFound(); key = 'weight'; }
  let existing = null;
  if (editId) { existing = (await measurementSeries(pid, `mt:${key}`)).find((r) => r.id === editId) || null; if (!existing) notFound(); }

  const sel = h('select', { class: 'input select', disabled: !!(editId || fixedKey) }, measurementTypes().map((t) => h('option', { value: t.key, selected: t.key === key }, t.label)));
  const current = () => typeByKey(sel.value) || typeByKey(key);
  const typeField = FormField({ label: 'Measurement', control: sel });
  const dateField = FormField({ label: 'Date', type: 'date', value: existing ? existing.date : (ctx.date || todayKey()), min: MIN_DATE, max: maxAllowedKey() });
  const valueField = FormField({ label: 'Value', type: 'text', inputmode: 'decimal', value: existing ? String(existing.value) : '', required: true, suffix: current().canonicalUnit });
  const noteField = FormField({ label: 'Note (optional)', type: 'text', maxlength: 200, value: existing && existing.note ? existing.note : '' });
  const approxHost = h('div', { class: 'row-wrap' }); const errs = h('div', { class: 'sheet-errors', role: 'alert' });

  function sync() {
    const t = current(); const suffix = valueField.querySelector('.field-suffix'); if (suffix) suffix.textContent = t.canonicalUnit;
    valueField.querySelector('.field-label').firstChild.textContent = t.approx ? 'Value (approximate)' : 'Value';
    valueField.input.setAttribute('aria-label', `${t.label} in ${t.canonicalUnit}`);
    approxHost.textContent = '';
    if (t.approx) add(approxHost, EstimateBadge({ kind: 'approx', explain: APPROX_EXPLAIN }), h('span', { class: 'small muted' }, 'Body fat readings are approximate.'));
  }
  sel.addEventListener('change', sync); sync();

  const start = { v: valueField.input.value, d: dateField.input.value, n: noteField.input.value, t: sel.value };
  const dirty = () => valueField.input.value !== start.v || dateField.input.value !== start.d || noteField.input.value !== start.n || sel.value !== start.t;

  async function save() {
    errs.textContent = ''; for (const f of [dateField, valueField, noteField]) f.setError('');
    const t = current(); const dk = dateField.input.value;
    const dr = checkDate(dk); if (!dr.ok) { dateField.setError(dr.hard[0].message); dateField.input.focus(); return; }
    const raw = valueField.input.value.trim();
    if (raw === '') { valueField.setError(`Enter ${t.label.toLowerCase()}.`); valueField.input.focus(); return; }
    const r = checkMeasurement(t.id, raw); if (!r.ok) { valueField.setError(r.hard[0].message); valueField.input.focus(); return; }
    if (!(await confirmSoft(r))) return;
    const note = cleanText(noteField.input.value) || null;
    const res = await runSave(() => (editId ? editMeasurement(pid, editId, { date: dk, value: r.value, note }) : addMeasurement(pid, { typeId: t.id, date: dk, value: r.value, note })), (l) => add(errs, h('p', { class: 'field-error' }, l[0].message)));
    if (res.ok) { toast(`${t.label} ${editId ? 'updated' : 'saved'}`); ctx.close({ refresh: true }); }
  }
  const fid = uid('meas-form');
  const form = h('form', { class: 'stack', id: fid, novalidate: true }, typeField, dateField, valueField, approxHost, noteField, errs);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  return Sheet({ ctx, title: editId ? `Edit ${current().label.toLowerCase()}` : 'Add measurement', dirty, body: form, footer: bindSubmit(Button({ label: editId ? 'Save changes' : 'Save', kind: 'primary', block: true }), fid) });
}
