// Tests for A2: zip.js, backup.js, import.js (QA-010: round-trip counts, import atomicity, conflict rules, migration fixtures). (A2)
// Every DB test uses its own throwaway database name winter-arc-test-a2-* and the LS prefix winter-arc-test: (D-077). Synthetic data only.
import { describe, it, assert, scanForWeekdays } from './harness.js';
import * as db from '../js/core/db.js';
import { initRepo, USER_STORES, EXPORT_STORES, rebuildPrefs } from '../js/core/repo.js';
import { setStoragePrefix, getMeta, getChangesSinceBackup, getLastBackupAt, recordBackup, lsRemove } from '../js/core/storage-health.js';
import { registerTestStep, clearTestSteps } from '../js/core/migrate.js';
import { crc32, crc32Blob, createZip, openZip, ZipError } from '../js/lib/zip.js';
import { prepareBackup, shareOrDownload, estimateBackup, sha256Hex } from '../js/core/backup.js';
import { openBackupFile, verifyBackup, migrateBackup, buildPreview, applyImport, importBackupFile, suggestProfileMapping } from '../js/core/import.js';

const enc = new TextEncoder();
const FIX = new URL('./fixtures/', import.meta.url);
let fixtureText = null;
async function fixture() { if (!fixtureText) fixtureText = await (await fetch(new URL('backup-v1.json', FIX))).text(); return JSON.parse(fixtureText); }
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date(2026, 9, 1, 10, 30);
const dbNames = []; let dbCount = 0;

async function freshDb() {
  setStoragePrefix('winter-arc-test:');
  lsRemove('lastBackupAt'); lsRemove('reminderSnoozeUntil'); // F-A4-05 / C-046: the LocalStorage mirror from tests-core must not leak in
  const name = `winter-arc-test-a2-${Date.now().toString(36)}-${++dbCount}`; dbNames.push(name);
  await db.closeDb(); await db.openDb(name); await initRepo();
  return name;
}
async function load(data) {
  await db.tx(EXPORT_STORES, 'readwrite', async (t) => { for (const s of EXPORT_STORES) for (const r of data[s] || []) await t.store(s).put(r); });
}
function randBytes(n, seed) { const out = new Uint8Array(n); let x = (seed >>> 0) || 1; for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out[i] = x & 255; } return out; }
const jpeg = (n, seed) => new Blob([randBytes(n, seed)], { type: 'image/jpeg' });
function photoRec(id, pid, checkinId, slot, full, thumb) { return { id, pid, checkinId, slot, date: '2025-03-15', w: 1200, h: 1600, bytes: full.size, thumbBytes: thumb.size, mime: 'image/jpeg', crc32: null, thumb, createdAt: 1700000001000 }; }
/** adds a check-in with a 5 MB front photo and a small side photo for pid */
async function addPhotos(pid = 'p_fixture_a1', checkinId = 'ck_photo_1', ids = ['ph_t_front', 'ph_t_side'], sizes = [5 * 1024 * 1024, 20000]) {
  const slots = ['front', 'side'];
  const photos = ids.map((id, i) => photoRec(id, pid, checkinId, slots[i], jpeg(sizes[i], 11 + i), jpeg(3000 + i, 77 + i)));
  const checkin = { id: checkinId, pid, date: '2025-03-15', periodDays: 7, periodStart: '2025-03-09', periodEnd: '2025-03-15', weight: 72, bodyFat: null, measurements: {}, photos: photos.map((p) => ({ photoId: p.id, slot: p.slot })), autoStats: null, note: null, createdAt: 1700000001000, updatedAt: 1700000001000 };
  await db.tx(['checkins', 'photos', 'photoData'], 'readwrite', async (t) => {
    await t.store('checkins').put(checkin);
    for (const [i, p] of photos.entries()) { await t.store('photos').put(p); await t.store('photoData').put({ id: p.id, blob: jpeg(sizes[i], 11 + i) }); }
  });
  return { checkin, photos };
}
async function canon(v) {
  if (v instanceof Blob) return { $blob: v.size, type: v.type, crc: await crc32Blob(v) };
  if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await canon(x)); return o; }
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = await canon(v[k]); return o; }
  return v;
}
/** counts + content hash per store of the open DB (Blob contents included). meta only when asked. */
async function snapshot({ meta = false } = {}) {
  const stores = [...USER_STORES, ...(meta ? ['meta'] : [])]; const raw = {};
  await db.tx(stores, 'readonly', async (t) => { for (const s of stores) raw[s] = await t.store(s).getAll(); });
  const counts = {}, hashes = {};
  for (const s of stores) {
    const rows = []; for (const r of raw[s]) rows.push(JSON.stringify(await canon(r))); rows.sort();
    counts[s] = rows.length; const text = rows.join('\n'); hashes[s] = (await sha256Hex(enc.encode(text))) ?? text;
  }
  return { counts, hashes };
}
function jsonBackup(data, manifestOver = {}) {
  const counts = {}; for (const s of EXPORT_STORES) counts[s] = (data[s] || []).length;
  const manifest = { format: 'winter-arc-backup', formatVersion: 1, schemaVersion: 1, appVersion: 't', seedVersion: 0, createdAt: 1700000000000, installId: 'in_t', includesPhotos: false, profiles: (data.profiles || []).map((p) => ({ id: p.id, name: p.name })), counts, exportCategories: {}, files: [], ...manifestOver };
  return new File([JSON.stringify({ manifest, data })], 'test.json', { type: 'application/json' });
}
const only = (fx, ...stores) => { const o = {}; for (const s of stores) o[s] = clone(fx.data[s]); return o; };
async function sourceDb() { await freshDb(); const fx = await fixture(); await load(fx.data); const ph = await addPhotos(); return { fx, ph }; }
async function sameBytes(a, b) { const x = new Uint8Array(await a.arrayBuffer()), y = new Uint8Array(await b.arrayBuffer()); if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; }
async function corruptByte(blob, at) { const b = new Uint8Array(await blob.slice(at, at + 1).arrayBuffer()); return new Blob([blob.slice(0, at), new Uint8Array([b[0] ^ 0xFF]), blob.slice(at + 1)], { type: blob.type }); }
async function rejects(file, code) {
  const before = await snapshot({ meta: true });
  const e = await assert.throws(() => importBackupFile(file, { mode: 'merge' }), `expected rejection ${code}`);
  assert.eq(e.code, code, 'code');
  assert.deepEq(await snapshot({ meta: true }), before, 'DB unchanged after rejection');
}
const mockShare = (fn) => { Object.defineProperty(navigator, 'share', { configurable: true, value: fn }); Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true }); };
const unmockShare = () => { delete navigator.share; delete navigator.canShare; };

describe('zip.js', () => {
  it('crc32 known vector', ['DAT-020'], () => { assert.eq(crc32(enc.encode('123456789')), 0xCBF43926); assert.eq(crc32(enc.encode('6789'), crc32(enc.encode('12345'))), 0xCBF43926, 'chunked'); });
  it('zip round-trip is byte-identical, incl a 5 MB blob', ['DAT-004', 'DAT-020', 'QA-010'], async () => {
    const big = new Blob([randBytes(5 * 1024 * 1024, 5)]);
    const made = await createZip([{ path: 'a.txt', data: 'héllo wörld' }, { path: 'dir/empty.bin', data: new Uint8Array(0) }, { path: 'photos/big.jpg', data: big }], { now: NOW });
    const z = await openZip(made.blob);
    assert.deepEq(z.names().sort(), ['a.txt', 'dir/empty.bin', 'photos/big.jpg']);
    assert.eq(await z.text('a.txt'), 'héllo wörld');
    assert.eq(z.info('dir/empty.bin').size, 0);
    assert.ok(await sameBytes(z.blob('photos/big.jpg'), big), '5 MB identical');
    for (const n of z.names()) assert.ok(await z.verify(n), 'crc ' + n);
    assert.eq(made.entries.find((e) => e.path === 'photos/big.jpg').crc32, await crc32Blob(big));
  });
  it('reads a zip written by Python (independent writer)', ['DAT-004'], async () => {
    const z = await openZip(await (await fetch(new URL('zip-python-store.zip', FIX))).blob());
    assert.deepEq(z.names().sort(), ['empty.txt', 'hello.txt', 'sub/data.bin']);
    assert.eq(await z.text('hello.txt'), 'hello world\n');
    assert.deepEq([...await z.bytes('sub/data.bin')], [...Array(256).keys()]);
    for (const n of z.names()) assert.ok(await z.verify(n));
  });
  it('rejects deflate, truncated and garbage zips; detects flipped bytes', ['DAT-005'], async () => {
    let e = await assert.throws(async () => openZip(await (await fetch(new URL('zip-python-deflate.zip', FIX))).blob())); assert.eq(e.code, 'unsupported-method');
    e = await assert.throws(async () => openZip(await (await fetch(new URL('zip-truncated.zip', FIX))).blob())); assert.ok(e instanceof ZipError);
    e = await assert.throws(() => openZip(new Blob([randBytes(500, 3)]))); assert.eq(e.code, 'no-eocd');
    const made = await createZip([{ path: 'x.bin', data: new Blob([randBytes(1000, 9)]) }]);
    const z = await openZip(made.blob); const bad = await openZip(await corruptByte(made.blob, z.info('x.bin').start + 5));
    assert.ok(await z.verify('x.bin')); assert.ok(!(await bad.verify('x.bin')), 'flip detected');
  });
  it('createZip refuses unsafe or duplicate names', async () => {
    for (const p of ['../x', '/x', 'a//b', 'a/./b', '', 'sp ace.txt']) { const e = await assert.throws(() => createZip([{ path: p, data: 'x' }])); assert.eq(e.code, 'bad-name', p); }
    const e = await assert.throws(() => createZip([{ path: 'a', data: 'x' }, { path: 'a', data: 'y' }])); assert.eq(e.code, 'duplicate-entry');
  });
});

describe('backup.js', () => {
  it('prepareBackup builds a zip: layout, manifest, no meta, no thumbs inside JSON, lastBackupAt untouched', ['DAT-003', 'DAT-018', 'DAT-004'], async () => {
    const { ph } = await sourceDb(); localStorage.setItem('winter-arc-test:secret', 'must-not-export');
    const est = await estimateBackup(); assert.eq(est.photoCount, 2); assert.ok(est.photoBytes > 5 * 1024 * 1024);
    const p = await prepareBackup({ now: NOW });
    assert.eq(p.filename, 'winter-arc-backup-2026-10-01.zip'); assert.eq(p.kind, 'zip'); assert.ok(p.includesPhotos); assert.eq(p.file.type, 'application/zip');
    const z = await openZip(p.file);
    assert.deepEq(z.names().sort(), ['backup.json', 'manifest.json', ...ph.photos.flatMap((x) => [`photos/${x.id}.jpg`, `photos/thumbs/${x.id}.jpg`])].sort());
    const manifest = JSON.parse(await z.text('manifest.json')); const bj = JSON.parse(await z.text('backup.json'));
    assert.deepEq(manifest, p.manifest);
    assert.deepEq(Object.keys(bj.data), EXPORT_STORES, 'exactly the exported stores (no meta, no photoData)');
    assert.ok(bj.data.photos.every((x) => !('thumb' in x)), 'no Blob in JSON');
    assert.eq(manifest.counts.photos, 2); assert.eq(manifest.counts.profiles, 2); assert.eq(manifest.files.length, 1 + 4);
    assert.eq(manifest.format, 'winter-arc-backup'); assert.eq(manifest.formatVersion, 1); assert.eq(manifest.schemaVersion, 1);
    assert.ok(!(await z.text('backup.json')).includes('must-not-export') && !JSON.stringify(manifest).includes('must-not-export'), 'no LocalStorage content');
    assert.eq(await getLastBackupAt(), null, 'prepare does not record a backup');
    localStorage.removeItem('winter-arc-test:secret');
  });
  it('JSON-only variant: photo metadata, no bytes, data checksum', ['DAT-003'], async () => {
    await sourceDb();
    const p = await prepareBackup({ includePhotos: false, now: NOW });
    assert.eq(p.filename, 'winter-arc-backup-2026-10-01.json'); assert.eq(p.kind, 'json'); assert.ok(!p.includesPhotos);
    const o = JSON.parse(await p.file.text());
    assert.eq(o.data.photos.length, 2); assert.ok(o.data.photos.every((x) => !('thumb' in x)));
    assert.ok(o.manifest.dataChecksum && o.manifest.dataChecksum.value); assert.eq(o.manifest.includesPhotos, false);
  });
  it('shareOrDownload: shared records, AbortError does not, failed share falls back to download', ['DAT-018', 'DAT-015'], async () => {
    await sourceDb(); const p = await prepareBackup({ includePhotos: false, now: NOW });
    const realClick = HTMLAnchorElement.prototype.click; let clicks = 0; HTMLAnchorElement.prototype.click = function () { clicks++; };
    try {
      mockShare(async () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; });
      let r = await shareOrDownload(p); assert.eq(r.result, 'cancelled'); assert.eq(r.recorded, false); assert.eq(await getLastBackupAt(), null);
      mockShare(async () => { const e = new Error('no gesture'); e.name = 'NotAllowedError'; throw e; });
      r = await shareOrDownload(p); assert.eq(r.result, 'downloaded'); assert.eq(clicks, 1); assert.ok(await getLastBackupAt());
      await db.put('meta', { k: 'changesSinceBackup', v: 5 }); await db.del('meta', 'lastBackupAt');
      mockShare(async () => {}); r = await shareOrDownload(p); assert.eq(r.result, 'shared'); assert.eq(r.recorded, true);
      assert.ok(await getLastBackupAt()); assert.eq(await getChangesSinceBackup(), 0, 'counter reset');
      r = await shareOrDownload(p, { mode: 'download' }); assert.eq(r.result, 'downloaded'); assert.eq(clicks, 2);
      unmockShare(); r = await shareOrDownload(p, { mode: 'share' }); assert.eq(r.result, 'failed'); assert.eq(r.recorded, false);
    } finally { HTMLAnchorElement.prototype.click = realClick; unmockShare(); }
  });
});

describe('import: round trip', () => {
  it('backup then import into an empty DB: counts and values identical per store (zip with 5 MB photo)', ['DAT-003', 'DAT-004', 'DAT-005', 'NFR-006', 'QA-010'], async () => {
    await sourceDb(); const a = await snapshot(); const p = await prepareBackup({ now: NOW });
    await freshDb();
    const res = await importBackupFile(p.file, { mode: 'merge' });
    assert.ok(res.verification.ok, JSON.stringify(res.verification.checks.filter((c) => !c.ok)));
    const b = await snapshot(); assert.deepEq(b.counts, a.counts, 'counts'); assert.deepEq(b.hashes, a.hashes, 'content hashes');
    for (const s of EXPORT_STORES) assert.eq(b.counts[s], p.manifest.counts[s], 'manifest count ' + s);
    assert.eq(b.counts.photoData, 2); assert.eq(res.verification.photoBytes.ok, true);
  });
  it('JSON-only backup round-trips everything except photo bytes', ['DAT-003'], async () => {
    await sourceDb(); const p = await prepareBackup({ includePhotos: false, now: NOW });
    await freshDb(); const res = await importBackupFile(p.file, { mode: 'merge' });
    assert.ok(res.verification.ok); const b = await snapshot();
    assert.eq(b.counts.photos, 2); assert.eq(b.counts.photoData, 0); assert.eq(b.counts.foodLogs, 2);
  });
  it('Merge twice: the second run is all identical and writes nothing', ['DAT-005', 'QA-010'], async () => {
    await sourceDb(); const p = await prepareBackup({ now: NOW });
    await freshDb(); await importBackupFile(p.file, { mode: 'merge' });
    const snap1 = await snapshot({ meta: true }); const changes1 = await getChangesSinceBackup();
    const r2 = await importBackupFile(p.file, { mode: 'merge' });
    assert.eq(r2.changed, false); assert.eq(r2.writes, 0);
    for (const [s, t] of Object.entries(r2.totals)) { assert.eq(t.new, 0, s); assert.eq(t.identical, t.total, s); }
    assert.eq(await getChangesSinceBackup(), changes1, 'no change counted');
    const snap2 = await snapshot({ meta: true });
    assert.deepEq(snap2.hashes, { ...snap1.hashes, meta: snap2.hashes.meta }, 'user data unchanged'); // only meta.lastImportSummary differs
  });
  it('import never sets lastBackupAt; saves lastImportSummary; counts one change', ['DAT-015'], async () => {
    await sourceDb(); const p = await prepareBackup({ includePhotos: false, now: NOW });
    await freshDb(); await recordBackup(111); await db.put('meta', { k: 'changesSinceBackup', v: 0 });
    const r = await importBackupFile(p.file, { mode: 'merge' });
    assert.eq(await getLastBackupAt(), 111); assert.eq(await getChangesSinceBackup(), 1);
    const s = await getMeta('lastImportSummary'); assert.eq(s.mode, 'merge'); assert.eq(s.verificationOk, true); assert.ok(r.summary.applied.foodLogs.new === 2);
  });
  it('merge into a DB with existing logs rebuilds favourites/recents from the merged logs', async () => {
    await freshDb(); const fx = await fixture(); await load(fx.data);
    const extra = clone(fx.data.foodLogs[0]); extra.id = 'fl_extra_1'; extra.loggedAt = 1700000099000; extra.qty = 2; for (const k of Object.keys(extra.totals)) extra.totals[k] = extra.per1serving[k] == null ? null : Math.round(extra.per1serving[k] * 2 * 10) / 10; // A12: totals must equal qty x per1serving (F-A9-02); the old record was inconsistent test data
    const other = jsonBackup({ profiles: clone(fx.data.profiles), foodLogs: [extra] });
    await importBackupFile(other, { mode: 'merge' });
    const pref = await db.get('foodPrefs', ['p_fixture_a1', 'fd_fixture_rice1']); assert.eq(pref.useCount, 2); assert.eq(pref.lastUsedAt, 1700000099000);
  });
});

describe('import: conflict rules', () => {
  const run = async (mod, preference = 'newest') => {
    await freshDb(); const fx = await fixture(); await load(fx.data);
    const backupData = clone(fx.data); mod(backupData.foodLogs[0]);
    const res = await importBackupFile(jsonBackup(backupData), { mode: 'merge', preference });
    return { res, rec: await db.get('foodLogs', 'fl_fixture_1') };
  };
  it('newer backup wins (default newest)', ['DAT-005', 'QA-010'], async () => { const { res, rec } = await run((r) => { r.note = 'B'; r.updatedAt = 1700000009000; }); assert.eq(rec.note, 'B'); assert.eq(res.totals.foodLogs.newer, 1); });
  it('older backup loses', ['QA-010'], async () => { const { res, rec } = await run((r) => { r.note = 'B'; r.updatedAt = 1699999990000; }); assert.eq(rec.note, null); assert.eq(res.totals.foodLogs.older, 1); });
  it('tie keeps the existing record', ['QA-010'], async () => { const { res, rec } = await run((r) => { r.note = 'B'; }); assert.eq(rec.note, null); assert.eq(res.totals.foodLogs.tie, 1); });
  it('Keep mine never overwrites, even when the backup is newer', ['QA-010'], async () => { const { rec } = await run((r) => { r.note = 'B'; r.updatedAt = 1700000009000; }, 'mine'); assert.eq(rec.note, null); });
  it('Use backup overwrites, even when the backup is older or tied', ['QA-010'], async () => {
    let o = await run((r) => { r.note = 'B'; r.updatedAt = 1699999990000; }, 'backup'); assert.eq(o.rec.note, 'B');
    o = await run((r) => { r.note = 'T'; }, 'backup'); assert.eq(o.rec.note, 'T');
  });
  it('identical content with a different updatedAt counts as identical and is skipped', async () => {
    const { res, rec } = await run((r) => { r.updatedAt = 1700000050000; }); assert.eq(res.totals.foodLogs.identical, 2); assert.eq(rec.updatedAt, 1700000000000);
  });
  const sleepRun = async (mod, preference = 'newest') => {
    await freshDb(); const fx = await fixture(); await load(fx.data);
    const s = clone(fx.data.sleepLogs[0]); s.id = 'sl_other_1'; s.quality = 2; mod(s);
    const res = await importBackupFile(jsonBackup({ profiles: clone(fx.data.profiles), sleepLogs: [s] }), { mode: 'merge', preference });
    return { res, rows: await db.getAll('sleepLogs') };
  };
  it('sleepLogs natural-key clash: newer backup replaces, loser dropped and counted', ['QA-010'], async () => {
    const { res, rows } = await sleepRun((s) => { s.updatedAt = 1700000009000; });
    assert.eq(rows.length, 1); assert.eq(rows[0].id, 'sl_other_1'); assert.eq(res.totals.sleepLogs.clashReplaced, 1); assert.ok(res.verification.ok);
  });
  it('sleepLogs natural-key clash: older or tied backup is dropped and counted', ['QA-010'], async () => {
    let o = await sleepRun((s) => { s.updatedAt = 1699999990000; }); assert.eq(o.rows.length, 1); assert.eq(o.rows[0].id, 'sl_fixture_1'); assert.eq(o.res.totals.sleepLogs.clashDropped, 1); assert.eq(o.res.dropped.length, 1);
    o = await sleepRun(() => {}); assert.eq(o.rows[0].id, 'sl_fixture_1');
    o = await sleepRun((s) => { s.updatedAt = 1699999990000; }, 'mine'); assert.eq(o.rows[0].id, 'sl_fixture_1');
    o = await sleepRun((s) => { s.updatedAt = 1699999990000; }, 'backup'); assert.eq(o.rows[0].id, 'sl_other_1');
  });
  it('same-name custom foods with different ids are both kept', ['QA-010'], async () => {
    await freshDb(); const fx = await fixture(); await load(fx.data);
    const f = clone(fx.data.foods[0]); f.id = 'fd_other_rice'; f.updatedAt = 1700000005000;
    await importBackupFile(jsonBackup({ profiles: clone(fx.data.profiles), foods: [f] }), { mode: 'merge' });
    const foods = await db.getAll('foods'); assert.eq(foods.length, 3); assert.eq(foods.filter((x) => x.nameKey === 'test rice').length, 2);
  });
  it('merge never deletes: records missing from the backup stay', ['DAT-005'], async () => {
    await freshDb(); const fx = await fixture(); await load(fx.data);
    await importBackupFile(jsonBackup({ profiles: clone(fx.data.profiles) }), { mode: 'merge' });
    assert.eq((await snapshot()).counts.foodLogs, 2);
  });
});

describe('import: profile mapping', () => {
  const localOnly = async () => { await freshDb(); const fx = await fixture(); const p = clone(fx.data.profiles[0]); p.id = 'p_local_x'; await db.put('profiles', p); await db.put('settings', { ...clone(fx.data.settings[0]), pid: 'p_local_x' }); return fx; };
  it('by id: same ids line up; suggestions: id, then exact name, else create', ['QA-010'], async () => {
    const fx = await fixture(); const bp = fx.manifest.profiles;
    let s = suggestProfileMapping(bp, [{ id: 'p_fixture_a1', name: 'x' }]); assert.eq(s.p_fixture_a1.action, 'same'); assert.eq(s.p_fixture_b1.action, 'create');
    s = suggestProfileMapping(bp, [{ id: 'p_local_x', name: ' test person a ' }]); assert.eq(s.p_fixture_a1.action, 'map'); assert.eq(s.p_fixture_a1.targetPid, 'p_local_x'); assert.eq(s.p_fixture_a1.reason, 'name');
    s = suggestProfileMapping(bp, [{ id: 'p_local_x', name: 'Test Person A' }], { mode: 'replace' }); assert.eq(s.p_fixture_a1.action, 'create', 'replace never suggests map');
  });
  it('by name: records are re-homed to the existing profile (default mapping = suggestion)', ['QA-010'], async () => {
    const fx = await localOnly(); const handle = await openBackupFile(jsonBackup(clone(fx.data)));
    const pv = await buildPreview(handle, { mode: 'merge' });
    assert.eq(pv.profiles.find((p) => p.backupPid === 'p_fixture_a1').targetPid, 'p_local_x');
    await applyImport(handle, { mode: 'merge' });
    const ids = (await db.getAll('profiles')).map((p) => p.id).sort(); assert.deepEq(ids, ['p_fixture_b1', 'p_local_x']);
    assert.eq((await db.get('foodLogs', 'fl_fixture_1')).pid, 'p_local_x'); assert.ok(await db.get('days', ['p_local_x', '2025-03-10']));
    assert.ok(await db.get('foodPrefs', ['p_local_x', 'fd_fixture_rice1']));
    assert.eq((await db.getAll('foodLogs')).filter((r) => r.pid === 'p_fixture_a1').length, 0);
  });
  it('create new, map to a differently named profile, and skip', ['QA-010'], async () => {
    let fx = await localOnly();
    await importBackupFile(jsonBackup(clone(fx.data)), { mode: 'merge', profileMap: { p_fixture_a1: { action: 'create' }, p_fixture_b1: { action: 'create' } } });
    assert.eq((await db.getAll('profiles')).length, 3);
    fx = await localOnly();
    await importBackupFile(jsonBackup(clone(fx.data)), { mode: 'merge', profileMap: { p_fixture_a1: { action: 'map', targetPid: 'p_local_x' }, p_fixture_b1: { action: 'skip' } } });
    const snap = await snapshot(); assert.eq(snap.counts.profiles, 1); assert.eq(snap.counts.foodLogs, 1); assert.eq(snap.counts.foods, 1);
    assert.eq((await db.getAll('foodLogs'))[0].pid, 'p_local_x');
  });
  it('bad mappings are rejected before anything is written', ['QA-010'], async () => {
    const fx = await localOnly(); const before = await snapshot({ meta: true }); const f = () => jsonBackup(clone(fx.data));
    for (const [mode, map] of [['merge', { p_fixture_a1: { action: 'map', targetPid: 'p_local_x' }, p_fixture_b1: { action: 'map', targetPid: 'p_local_x' } }],
      ['merge', { p_fixture_a1: { action: 'map', targetPid: 'nope' } }], ['replace', { p_fixture_a1: { action: 'map', targetPid: 'p_local_x' } }], ['merge', { p_fixture_a1: { action: 'weird' } }]]) {
      const e = await assert.throws(() => importBackupFile(f(), { mode, profileMap: map, safetyBackup: 'skipped' })); assert.eq(e.code, 'E_BAD_MAPPING');
    }
    assert.deepEq(await snapshot({ meta: true }), before);
  });
});

describe('import: replace and atomicity', () => {
  it('Replace restores exactly (extra local data is removed, photos incl. bytes)', ['DAT-023', 'QA-010'], async () => {
    await sourceDb(); const a = await snapshot(); const p = await prepareBackup({ now: NOW });
    await freshDb(); const fx = await fixture(); await load(fx.data);
    const junk = clone(fx.data.foodLogs[0]); junk.id = 'fl_junk'; await db.put('foodLogs', junk);
    await db.put('profiles', { id: 'p_junk', name: 'Junk', createdAt: 1, updatedAt: 1, sortOrder: 9, archivedAt: null });
    await addPhotos('p_junk', 'ck_junk', ['ph_junk_1', 'ph_junk_2'], [1000, 1000]);
    const pv = await buildPreview(await openBackupFile(p.file), { mode: 'replace' }); assert.ok(pv.willRemove.foodLogs >= 1); assert.ok(pv.warnings.includes('REPLACE_REMOVES_OTHER_DATA'));
    const res = await importBackupFile(p.file, { mode: 'replace', safetyBackup: 'skipped' });
    assert.ok(res.verification.ok, JSON.stringify(res.verification.checks.filter((c) => !c.ok)));
    const b = await snapshot(); assert.deepEq(b.counts, a.counts); assert.deepEq(b.hashes, a.hashes);
  });
  it('Replace needs a safety backup: missing or failed safety backup changes nothing', ['DAT-023', 'QA-010'], async () => {
    await sourceDb(); const p = await prepareBackup({ includePhotos: false, now: NOW }); const before = await snapshot({ meta: true });
    let e = await assert.throws(() => importBackupFile(p.file, { mode: 'replace' })); assert.eq(e.code, 'E_SAFETY_REQUIRED');
    e = await assert.throws(() => importBackupFile(p.file, { mode: 'replace', safetyBackup: async () => false })); assert.eq(e.code, 'E_SAFETY_FAILED');
    e = await assert.throws(() => importBackupFile(p.file, { mode: 'replace', safetyBackup: async () => { throw new Error('x'); } })); assert.eq(e.code, 'E_SAFETY_FAILED');
    assert.deepEq(await snapshot({ meta: true }), before);
    let called = 0; await importBackupFile(p.file, { mode: 'replace', safetyBackup: async () => { called++; return true; } }); assert.eq(called, 1);
    await importBackupFile(p.file, { mode: 'replace', safetyBackup: 'done' });
  });
  it('INJECTED FAILURE inside apply leaves the DB unchanged (counts + content hash, every store)', ['DAT-005', 'DAT-019', 'QA-010'], async () => {
    await sourceDb(); const p = await prepareBackup({ now: NOW });
    for (const [mode, failAt] of [['replace', 1], ['replace', 7], ['merge', 1], ['merge', 4]]) {
      await freshDb(); const fx = await fixture(); await load(fx.data);
      const extra = clone(fx.data.foodLogs[0]); extra.id = 'fl_local_only'; await db.put('foodLogs', extra); await db.put('meta', { k: 'changesSinceBackup', v: 3 });
      if (mode === 'merge') { await db.del('foodLogs', 'fl_fixture_1'); }
      const before = await snapshot({ meta: true });
      const e = await assert.throws(() => importBackupFile(p.file, { mode, safetyBackup: 'skipped', hooks: { onWrite: (n) => { if (n === failAt) throw new Error('injected failure'); } } }));
      assert.eq(e.message, 'injected failure', `${mode}@${failAt}`);
      const after = await snapshot({ meta: true });
      assert.deepEq(after.counts, before.counts, `counts ${mode}@${failAt}`); assert.deepEq(after.hashes, before.hashes, `hashes ${mode}@${failAt}`);
      assert.eq(await getMeta('lastImportSummary', null), null, 'no summary after failure');
    }
    const e = await assert.throws(() => importBackupFile(p.file, { mode: 'merge', hooks: { beforeCommit: () => { throw new Error('late failure'); } } })); assert.eq(e.message, 'late failure');
    const ok = await importBackupFile(p.file, { mode: 'merge' }); assert.ok(ok.verification.ok, 'a clean import works after failures (lock released)');
  });
  it('pre-flight space check (about 1.5x) rejects with zero writes', ['DAT-020', 'QA-010'], async () => {
    await sourceDb(); const p = await prepareBackup({ now: NOW }); await freshDb(); const before = await snapshot({ meta: true });
    navigator.storage.estimate = async () => ({ quota: 1000, usage: 0 });
    try {
      const handle = await openBackupFile(p.file); const pv = await buildPreview(handle, { mode: 'merge' }); assert.eq(pv.space.ok, false);
      const e = await assert.throws(() => applyImport(handle, { mode: 'merge' })); assert.eq(e.code, 'I_SPACE');
    } finally { delete navigator.storage.estimate; }
    assert.deepEq(await snapshot({ meta: true }), before);
  });
});

describe('import: rejection and damage', () => {
  it('corrupt, truncated, non-JSON, wrong format, checksum failure, newer version: rejected with zero writes', ['DAT-005', 'QA-010'], async () => {
    await sourceDb(); const p = await prepareBackup({ now: NOW }); const pj = await prepareBackup({ includePhotos: false, now: NOW });
    const z = await openZip(p.file);
    await rejects(await corruptByte(p.file, z.info('backup.json').start + 20), 'I_CHECKSUM');
    await rejects(p.file.slice(0, p.file.size - 30), 'I_DAMAGED');
    await rejects(p.file.slice(0, 100), 'I_DAMAGED');
    await rejects(new File([randBytes(2000, 4)], 'x.bin'), 'I_NOT_BACKUP');
    await rejects(new File(['hello, this is a text file'], 'x.txt'), 'I_NOT_BACKUP');
    await rejects(new File([''], 'empty.json'), 'I_NOT_BACKUP');
    await rejects(new File(['{"manifest": {"format": "winter-arc-backup", "formatVers'], 'cut.json'), 'I_DAMAGED');
    await rejects(new File(['[1,2,3]'], 'arr.json'), 'I_NOT_BACKUP');
    const o = JSON.parse(await pj.file.text());
    const edit = (fn) => { const c = clone(o); fn(c); return new File([JSON.stringify(c)], 'e.json'); };
    await rejects(edit((c) => { c.manifest.format = 'other-app'; }), 'I_NOT_BACKUP');
    await rejects(edit((c) => { c.data.foods[0].name = 'Tampered'; }), 'I_CHECKSUM');
    await rejects(edit((c) => { c.manifest.schemaVersion = 2; }), 'I_NEWER');
    await rejects(edit((c) => { c.manifest.formatVersion = 2; }), 'I_NEWER');
    await rejects(edit((c) => { c.manifest.schemaVersion = 0; }), 'I_DAMAGED');
    await rejects(edit((c) => { c.manifest.counts.foodLogs = 99; }), 'I_DAMAGED');
    await rejects(edit((c) => { c.data.foods = 'nope'; }), 'I_DAMAGED');
    const noManifest = (await createZip([{ path: 'backup.json', data: '{"data":{}}' }])).blob; await rejects(noManifest, 'I_NOT_BACKUP');
    const wrongFormat = (await createZip([{ path: 'manifest.json', data: '{"format":"x"}' }, { path: 'backup.json', data: '{"data":{}}' }])).blob; await rejects(wrongFormat, 'I_NOT_BACKUP');
    const v = await verifyBackup(new File(['nope'], 'n.txt')); assert.eq(v.ok, false); assert.eq(v.code, 'I_NOT_BACKUP');
    const v2 = await verifyBackup(p.file); assert.ok(v2.ok); assert.eq(v2.summary.profiles.length, 2);
  });
  it('invalid records: reported in the preview, import needs explicit skip, nothing partial', ['DAT-008', 'DAT-005'], async () => {
    await freshDb(); const fx = await fixture(); const d = clone(fx.data);
    const bad = clone(d.foodLogs[0]); bad.id = 'fl_bad'; bad.qty = -1;
    const stray = clone(d.foodLogs[0]); stray.id = 'fl_stray'; stray.pid = 'p_nobody';
    const dup = clone(d.foodLogs[0]); dup.updatedAt = 1700000000001;
    const orphanPhoto = { id: 'ph_orphan', pid: 'p_fixture_a1', checkinId: 'ck_missing', slot: 'front', date: '2025-03-10', createdAt: 1 };
    d.foodLogs.push(bad, stray, dup); d.photos.push(orphanPhoto);
    const file = jsonBackup(d); const handle = await openBackupFile(file); const pv = await buildPreview(handle, { mode: 'merge' });
    assert.eq(pv.invalidCount, 4); assert.deepEq(pv.invalid.map((x) => x.reasons[0]).sort(), ['F_QTY_RANGE', 'duplicate', 'orphan-photo', 'unknown-profile']);
    const before = await snapshot({ meta: true });
    let e = await assert.throws(() => applyImport(handle, { mode: 'merge' })); assert.eq(e.code, 'I_INVALID_RECORDS'); assert.deepEq(await snapshot({ meta: true }), before);
    const res = await applyImport(handle, { mode: 'merge', invalid: 'skip' }); assert.eq(res.summary.invalidSkipped, 4); assert.eq((await snapshot()).counts.foodLogs, 2);
  });
  it('damaged photos: user must choose; Import without keeps metadata and the good photos', ['DAT-004', 'DAT-005', 'QA-010'], async () => {
    await sourceDb(); const p = await prepareBackup({ now: NOW }); const z = await openZip(p.file);
    const bad = await corruptByte(p.file, z.info('photos/ph_t_side.jpg').start + 100);
    await freshDb(); const before = await snapshot({ meta: true });
    const handle = await openBackupFile(bad); assert.deepEq(handle.damagedPhotoIds, ['ph_t_side']);
    const pv = await buildPreview(handle, { mode: 'merge' }); assert.ok(pv.warnings.includes('PHOTOS_DAMAGED'));
    let e = await assert.throws(() => applyImport(handle, { mode: 'merge' })); assert.eq(e.code, 'I_PHOTOS_DAMAGED'); assert.deepEq(await snapshot({ meta: true }), before);
    const res = await applyImport(handle, { mode: 'merge', damagedPhotos: 'import-without' }); assert.ok(res.verification.ok);
    const s = await snapshot(); assert.eq(s.counts.photos, 2); assert.eq(s.counts.photoData, 1);
    assert.eq((await db.get('photos', 'ph_t_side')).thumb, null); assert.ok((await db.get('photos', 'ph_t_front')).thumb instanceof Blob);
    assert.eq(res.summary.photosWithoutFiles, 1);
    const badThumb = await corruptByte(p.file, z.info('photos/thumbs/ph_t_front.jpg').start + 10); assert.deepEq((await openBackupFile(badThumb)).damagedPhotoIds, ['ph_t_front']);
  });
  it('JSON-only import never overwrites existing photo bytes (merge and replace)', ['DAT-004', 'QA-010'], async () => {
    const { ph } = await sourceDb(); const before = await snapshot(); const pj = await prepareBackup({ includePhotos: false, now: NOW });
    const o = JSON.parse(await pj.file.text()); o.data.photos[0].w = 999; o.data.photos[0].createdAt = 1800000000000;
    const newPhoto = { id: 'ph_meta_only', pid: 'p_fixture_a1', checkinId: 'ck_photo_1', slot: 'back', date: '2025-03-15', createdAt: 5 }; o.data.photos.push(newPhoto); o.manifest.counts.photos = 3; delete o.manifest.dataChecksum;
    const file = new File([JSON.stringify(o)], 'p.json');
    const r = await importBackupFile(file, { mode: 'merge', preference: 'backup' }); assert.ok(r.verification.ok);
    assert.eq((await db.get('photos', 'ph_t_front')).w, 999, 'metadata updated');
    const after = await snapshot(); assert.deepEq(after.hashes.photoData, before.hashes.photoData, 'bytes untouched'); assert.eq(after.counts.photos, 3); assert.eq(after.counts.photoData, 2);
    assert.eq((await db.get('photos', 'ph_meta_only')).thumb, null);
    assert.ok((await db.get('photos', 'ph_t_front')).thumb instanceof Blob, 'thumb kept');
    await db.put('photos', photoRec('ph_local_only', 'p_fixture_a1', 'ck_photo_1', 'flexed', jpeg(10, 1), jpeg(10, 2))); await db.put('photoData', { id: 'ph_local_only', blob: jpeg(10, 1) });
    await importBackupFile(file, { mode: 'replace', safetyBackup: 'skipped' });
    const s2 = await snapshot(); assert.eq(s2.counts.photos, 3); assert.eq(s2.counts.photoData, 2, 'same-id bytes kept, extra local photo removed');
    assert.ok(await sameBytes((await db.get('photoData', 'ph_t_front')).blob, jpeg(5 * 1024 * 1024, 11)), 'original 5 MB bytes intact');
    assert.ok(ph.photos.length === 2);
  });
});

describe('import: migration', () => {
  it('older fixture (schema 1) migrates: no steps now, chain applied with a registered test step', ['DAT-026', 'NFR-010', 'QA-010'], async () => {
    const fx = await fixture(); const handle = await openBackupFile(jsonBackup(clone(fx.data)));
    let m = migrateBackup(handle); assert.deepEq(m.applied, []); assert.eq(m.to, 1);
    for (const s of EXPORT_STORES) assert.deepEq(m.data[s], fx.data[s], s);
    registerTestStep(1, (d) => { for (const f of d.foods) f.testField = true; return d; });
    try {
      m = migrateBackup(handle, { targetSchema: 2 }); assert.deepEq(m.applied, [1]); assert.eq(m.to, 2); assert.ok(m.data.foods.every((f) => f.testField === true));
      assert.ok(handle.data.foods.every((f) => !('testField' in f)), 'original untouched');
      await freshDb(); const h2 = await openBackupFile(jsonBackup(clone(fx.data)));
      await applyImport(h2, { mode: 'merge', targetSchema: 2 }); assert.eq((await db.get('foods', 'fd_fixture_rice1')).testField, true, 'migrated data is what gets stored');
      const e = await assert.throws(async () => migrateBackup(handle, { targetSchema: 3 })); assert.eq(e.code, 'I_DAMAGED', 'missing step');
    } finally { clearTestSteps(); }
    registerTestStep(1, () => { throw new Error('boom'); });
    try { const e = await assert.throws(async () => migrateBackup(handle, { targetSchema: 2 })); assert.eq(e.code, 'I_DAMAGED'); } finally { clearTestSteps(); }
  });
  it('the schema-1 fixture imports cleanly end to end with counts equal to its manifest', ['DAT-026', 'DAT-005'], async () => {
    await freshDb(); const fx = await fixture(); const res = await importBackupFile(jsonBackup(clone(fx.data)), { mode: 'merge' });
    assert.ok(res.verification.ok); const s = await snapshot();
    for (const k of Object.keys(fx.manifest.counts)) assert.eq(s.counts[k], fx.manifest.counts[k], k);
    const pv = await buildPreview(await openBackupFile(jsonBackup(clone(fx.data))), { mode: 'merge' });
    assert.eq(pv.invalidCount, 0); assert.eq(pv.totals.foodLogs.identical, 2); assert.eq(pv.profiles.length, 2);
  });
});

describe('A2 source scans', () => {
  it('no weekday words, toISOString or innerHTML in A2 source (DoD-09)', ['FR-020', 'QA-010'], async () => {
    const files = { 'js/lib/zip.js': '../js/lib/zip.js', 'js/core/backup.js': '../js/core/backup.js', 'js/core/import.js': '../js/core/import.js' }; const text = {};
    for (const [k, rel] of Object.entries(files)) text[k] = await (await fetch(new URL(rel, import.meta.url))).text();
    assert.deepEq(scanForWeekdays(text, []), []);
    for (const [k, t] of Object.entries(text)) { assert.ok(!t.includes('toISOString'), k); assert.ok(!t.includes('innerHTML'), k); assert.ok(!/https?:\/\//.test(t), 'no network URL ' + k); }
  });
  it('bad option values are rejected', async () => {
    await freshDb(); const h = await openBackupFile(jsonBackup(clone((await fixture()).data)));
    for (const o of [{ mode: 'overwrite' }, { preference: 'theirs' }]) { const e = await assert.throws(() => applyImport(h, o)); assert.eq(e.code, 'E_BAD_OPTIONS'); }
    assert.eq((await snapshot()).counts.foodLogs, 0);
  });
  it('cleanup: delete throwaway databases', async () => { for (const n of dbNames) { try { await db.deleteDb(n); } catch { /* ignore */ } } });
});
