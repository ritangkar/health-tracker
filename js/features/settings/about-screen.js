// S37 Self-check and About: versions, offline readiness, storage, data checks, orphan clean-up, error log, diagnostics, attribution and disclaimer. (A4)
// The disclaimer text is embedded because data/ATTRIBUTION.md is cached only if WA_PRECACHE lists it (KI-020, finding F-A4-02).
import { h, mount, logError, getErrors } from '../../core/dom.js';
import { Card, Button, ConfirmDialog, toast } from '../../ui/components.js';
import { appStore } from '../../core/store.js';
import { getSwInfo } from '../../app.js';
import { estimate, persistedStatus, getLastBackupAt, getMeta, getChangesSinceBackup } from '../../core/storage-health.js';
import { integrityScan, cleanupOrphans, countStores } from '../../core/repo.js';
import { seedCounts } from '../../core/seed.js';
import { CURRENT_SCHEMA, DB_VERSION } from '../../../config.js';
import { pageHead, kv, fmtBytes, fmtWhen } from './common.js';

export const DISCLAIMER = 'Nutrition values are approximate. Home-cooked dishes vary with ingredients, oil and portion size. Restaurant, hotel, sweet-shop and street foods are marked estimate and can be far from what you were served. Exercise calories are rough estimates for a 70 kg adult and scale with body weight. None of this is medical or dietetic advice. Check packaged foods against their label and use a custom food for exact values.';

export async function aboutScreen(ctx) {
  const el = h('section', { class: 'screen screen-narrow about' }); let alive = true; ctx.onCleanup(() => { alive = false; });
  async function paint() {
    const [sw, est, persisted, last, changes, schema, scan, counts] = await Promise.all([getSwInfo(), estimate(), persistedStatus(), getLastBackupAt(), getChangesSinceBackup(), getMeta('schemaVersion', null), integrityScan().catch((e) => { logError(e, 'scan'); return null; }), countStores().catch(() => null)]);
    if (!alive) return;
    const sc = seedCounts(); const errors = getErrors(); const csp = appStore.get('cspViolations') || 0; const orphans = scan ? scan.orphanPhotoData.length + scan.orphanPhotos.length : null;
    const miss = scan ? scan.photosMissingData.length + scan.checkinsMissingPhotos.length : null;
    const lines = [
      ['App version', sw.pageVersion], ['Offline copy version', sw.swVersion || 'Not running'], ['Versions match', sw.swVersion ? (sw.mismatch ? 'No. Reload to update.' : 'Yes') : 'Unknown'], ['Ready for offline use', sw.offlineReady ? 'Yes' : 'Not yet'], ['Service worker', appStore.get('swStatus').state],
      ['Files missing from offline copy', sw.missingSeed.length ? sw.missingSeed.join(', ') : 'None'], ['Network', appStore.get('online') ? 'Online' : 'Offline'],
      ['Storage protected', persisted === 'protected' ? 'Yes' : persisted === 'not-protected' ? 'No' : 'Unknown'], ['Storage used', est.usage == null ? 'Unknown' : `${fmtBytes(est.usage)} of ${fmtBytes(est.quota)}`],
      ['Last backup', last ? fmtWhen(last) : 'Never'], ['Changes since backup', String(changes)], ['Database version', String(DB_VERSION)], ['Data format version', `${schema ?? 'unknown'} (app expects ${CURRENT_SCHEMA})`],
      ['Seed version', `${sc.seedVersion} (${sc.foods} foods, ${sc.exercises} exercises, ${sc.plans} plans)`], ['Seed state', appStore.get('seedState')], ['Screen files loaded so far', `${(appStore.get('features') || []).length} of 11 (each area loads when first opened)`]
    ];
    const diag = [`Winter Arc diagnostics ${fmtWhen(Date.now())}`, ...lines.map(([k, v]) => `${k}: ${v}`), `Security policy violations: ${csp}`, `Orphaned photo records: ${orphans}`, `Missing photo files: ${miss}`, ...(counts ? [`Counts: ${JSON.stringify(counts)}`] : []), ...errors.map((e) => `${fmtWhen(e.t)} [${e.where}] ${e.name}: ${e.message}`)].join('\n');
    const copy = Button({ label: 'Copy diagnostics', icon: 'note', onClick: async () => { try { await navigator.clipboard.writeText(diag); toast('Diagnostics copied'); } catch { const ta = h('textarea', { class: 'input', rows: 8, readOnly: true }, diag); copy.replaceWith(ta); ta.focus(); ta.select(); } } });
    const clean = orphans ? Button({ label: `Clean up ${orphans} orphaned ${orphans === 1 ? 'item' : 'items'}`, kind: 'secondary', onClick: async () => { const ok = await ConfirmDialog({ title: 'Clean up orphaned photo data?', message: 'This removes photo records that no check-in uses. Photos in your check-ins are not touched.', confirmLabel: 'Clean up', cancelLabel: 'Cancel', danger: true }); if (!ok) return; try { const n = await cleanupOrphans(scan); toast(`Removed ${n} orphaned ${n === 1 ? 'item' : 'items'}`); } catch (e) { logError(e, 'cleanup'); toast('Clean up did not finish. Nothing else was changed.'); } paint(); } }) : null;
    mount(el, pageHead('Self-check and About'),
      Card({ title: 'Self-check', children: [kv(lines), h('p', { class: csp ? 'warn-box small' : 'small muted' }, csp ? `${csp} security policy violation${csp === 1 ? '' : 's'} blocked. Something tried to load from outside the app.` : 'No security policy violations.')] }),
      Card({ title: 'Data checks', children: [kv([['Orphaned photo records', orphans === null ? 'Could not check' : String(orphans)], ['Photos with a missing file', miss === null ? 'Could not check' : String(miss)]]), orphans === 0 && miss === 0 ? h('p', { class: 'small muted' }, 'Everything lines up.') : null, clean] }),
      Card({ title: `Recent problems (${errors.length})`, children: [errors.length ? h('ul', { class: 'stack-sm small' }, errors.slice().reverse().map((e) => h('li', null, h('strong', null, `${e.where || 'app'}: `), e.message))) : h('p', { class: 'small muted' }, 'None since this page was opened.')] }),
      h('div', { class: 'row-wrap' }, copy),
      Card({ title: 'About the numbers', children: [h('p', { class: 'small' }, DISCLAIMER)] }),
      Card({ title: 'Where the food values come from', children: [h('p', { class: 'small' }, 'All food, exercise and plan values were written for this project. No database, website or book was copied. Food and exercise calories are approximate. The full register is in data/ATTRIBUTION.md in the project files.')] }),
      Card({ title: 'Privacy and address', children: [h('p', { class: 'small' }, 'Winter Arc runs on this device. Your data is not sent anywhere.'), h('p', { class: 'small' }, 'There is no PIN in this version. Anyone who can open this app on this device can open either profile. Use your phone screen lock.'), h('p', { class: 'warn-box small' }, `Keep this web address. If the project name or account is renamed, the address changes and your saved data will look missing (it stays under the old address).`)] }));
  }
  await paint();
  return el;
}
