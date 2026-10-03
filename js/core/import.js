// Import engine, no UI. Stages A-F of D-035. (A2)
// A openBackupFile(file)       read-only verify: format, versions, checksums, photo files   -> handle (throws ImportError)
// B migrateBackup(handle)      pure in-memory migration to CURRENT_SCHEMA
// C validateBackupData(data)   every record through the shared validator
// D buildPreview(handle, opts) counts per profile/store: new / identical / newer / older / tie / invalid, plus mapping, warnings, space
// E options                    {mode:'merge'|'replace', preference:'newest'|'mine'|'backup', profileMap, invalid:'skip', damagedPhotos:'import-without', safetyBackup}
//                              profileMap defaults to suggestProfileMapping() in BOTH preview and apply (id match, else exact name -> 'map', else 'create'); the UI should pass the user's explicit choice.
// F applyImport(handle, opts)  ONE readwrite transaction over every store; any failure aborts and leaves the DB unchanged
// Preview and apply use the same pure function (computePlan), so what the preview shows is what apply does.
// Error codes are the I_* codes of the message catalog plus E_BAD_MAPPING, E_BAD_OPTIONS, E_SAFETY_REQUIRED, E_SAFETY_FAILED, E_BUSY.
// API: ImportError, openBackupFile, verifyBackup, migrateBackup, validateBackupData, suggestProfileMapping, buildPreview, computePlan,
//      applyImport, importBackupFile, makeSafetyBackup, verifyAfterImport, describeImportError
import * as db from './db.js';
import { tx } from './db.js';
import { EXPORT_STORES, USER_STORES, rebuildPrefs } from './repo.js';
import { validateRecord, msg } from './validate.js';
import { migrateData } from './migrate.js';
import { CURRENT_SCHEMA } from '../../config.js';
import { noteWrite, setMeta } from './storage-health.js';
import { invalidateOverlay } from './seed.js';
import { openZip, ZipError, crc32 } from '../lib/zip.js';
import { FORMAT, SUPPORTED_FORMAT_VERSION, sha256Hex, prepareBackup, keyString } from './backup.js';

const OWN = {
  E_BAD_MAPPING: 'The profile choices are not valid. Nothing was changed.',
  E_SAFETY_REQUIRED: 'Replace needs a safety backup of the current data first. Nothing was changed.',
  E_SAFETY_FAILED: 'The safety backup did not finish, so nothing was changed.',
  E_BUSY: 'Another import is already running.',
  E_BAD_OPTIONS: 'The import options are not valid. Nothing was changed.'
};
export class ImportError extends Error {
  constructor(code, params = {}, detail = null) { super(OWN[code] || msg(code, params)); this.name = 'ImportError'; this.code = code; this.params = params; this.detail = detail; }
}
export const describeImportError = (e) => ({ code: e && e.code ? e.code : 'I_DAMAGED', message: e && e.code ? e.message : msg('I_DAMAGED') });

const SEP = '\u0001';
const PHOTO_ID_OK = /^[A-Za-z0-9_\-:.]+$/;
const enc = new TextEncoder();
const hasSubtle = () => typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function';

// ---------------------------------------------------------------- Stage A
function checkManifest(m) {
  if (!m || typeof m !== 'object' || m.format !== FORMAT) throw new ImportError('I_NOT_BACKUP');
  if (!Number.isInteger(m.formatVersion) || m.formatVersion < 1) throw new ImportError('I_NOT_BACKUP');
  if (m.formatVersion > SUPPORTED_FORMAT_VERSION) throw new ImportError('I_NEWER');
  if (!Number.isInteger(m.schemaVersion) || m.schemaVersion < 1) throw new ImportError('I_DAMAGED');
  if (m.schemaVersion > CURRENT_SCHEMA) throw new ImportError('I_NEWER');
}
function checkDataShape(manifest, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ImportError('I_DAMAGED');
  for (const s of EXPORT_STORES) {
    if (data[s] === undefined) data[s] = [];
    if (!Array.isArray(data[s])) throw new ImportError('I_DAMAGED');
    const c = manifest.counts && manifest.counts[s];
    if (Number.isInteger(c) && c !== data[s].length) throw new ImportError('I_DAMAGED', {}, `count mismatch in ${s}`);
  }
}

/** Stage A. Throws ImportError. Never writes anything. */
export async function openBackupFile(file, { onProgress } = {}) {
  if (!file || typeof file.slice !== 'function' || !(file.size >= 2)) throw new ImportError('I_NOT_BACKUP');
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4B && (head[2] === 3 || head[2] === 5);
  return isZip ? openZipBackup(file, onProgress) : openJsonBackup(file);
}

async function openJsonBackup(file) {
  let text;
  try { text = await file.text(); } catch { throw new ImportError('I_DAMAGED'); }
  if (text.trimStart()[0] !== '{') throw new ImportError('I_NOT_BACKUP');
  let obj;
  try { obj = JSON.parse(text); } catch { throw new ImportError('I_DAMAGED'); }
  checkManifest(obj.manifest);
  const manifest = obj.manifest; const data = obj.data;
  checkDataShape(manifest, data);
  let unverified = true, weak = false;
  const dc = manifest.dataChecksum;
  if (dc && typeof dc === 'object') {
    const bytes = enc.encode(JSON.stringify(data));
    if (dc.algo === 'sha256') {
      if (hasSubtle()) { if ((await sha256Hex(bytes)) !== dc.value) throw new ImportError('I_CHECKSUM'); }
      else weak = true; // cannot check here
    } else if (dc.algo === 'crc32') { if (crc32(bytes) !== dc.value) throw new ImportError('I_CHECKSUM'); }
    unverified = weak;
  }
  const photoState = new Map(data.photos.map((p) => [p && p.id, 'meta-only']));
  return {
    kind: 'json', fileName: file.name || '', fileSize: file.size, manifest, data, includesPhotos: false, photoState,
    damagedPhotoIds: [], metaOnlyPhotoIds: [...photoState.keys()], unverified, weak, hashAlgo: manifest.hashAlgo || (dc && dc.algo) || null,
    incomingBytes: file.size, photoBlobs: () => null
  };
}

async function openZipBackup(file, onProgress) {
  let zip;
  try { zip = await openZip(file); } catch (e) { if (e instanceof ZipError) throw new ImportError('I_DAMAGED', {}, e.code); throw e; }
  if (!zip.has('manifest.json')) throw new ImportError('I_NOT_BACKUP');
  if (!zip.has('backup.json')) throw new ImportError('I_DAMAGED');
  let manifest;
  try { manifest = JSON.parse(await zip.text('manifest.json')); } catch { throw new ImportError('I_DAMAGED'); }
  checkManifest(manifest);
  const listed = new Map((Array.isArray(manifest.files) ? manifest.files : []).map((f) => [f.path, f]));
  let weak = false;
  // returns 'ok' | 'bad' ; compares directory CRC with the bytes, then the manifest numbers
  const checkEntry = async (path) => {
    const info = zip.info(path); const f = listed.get(path);
    const bytes = await zip.bytes(path);
    if (crc32(bytes) !== info.crc32) return 'bad';
    if (!f) return 'ok';
    if (Number.isInteger(f.bytes) && f.bytes !== info.size) return 'bad';
    if (typeof f.crc32 === 'number' && f.crc32 !== info.crc32) return 'bad';
    if (typeof f.sha256 === 'string') { if (hasSubtle()) { if ((await sha256Hex(bytes)) !== f.sha256) return 'bad'; } else weak = true; }
    return 'ok';
  };
  if ((await checkEntry('backup.json')) !== 'ok') throw new ImportError('I_CHECKSUM');
  let data;
  try { data = JSON.parse(await zip.text('backup.json')).data; } catch { throw new ImportError('I_DAMAGED'); }
  checkDataShape(manifest, data);

  const missingIds = new Set(Array.isArray(manifest.missingPhotoIds) ? manifest.missingPhotoIds : []);
  const photoState = new Map(); const damaged = []; const metaOnly = [];
  let i = 0, incoming = zip.info('backup.json').size;
  for (const p of data.photos) {
    i++; if (onProgress) onProgress({ phase: 'verify', done: i, total: data.photos.length });
    const id = p && p.id;
    if (typeof id !== 'string' || !PHOTO_ID_OK.test(id)) { photoState.set(id, 'damaged'); damaged.push(id); continue; }
    if (!manifest.includesPhotos || missingIds.has(id)) { photoState.set(id, 'meta-only'); metaOnly.push(id); continue; }
    const fp = `photos/${id}.jpg`, tp = `photos/thumbs/${id}.jpg`;
    if (!zip.has(fp) || !zip.has(tp) || (await checkEntry(fp)) !== 'ok' || (await checkEntry(tp)) !== 'ok') { photoState.set(id, 'damaged'); damaged.push(id); continue; }
    photoState.set(id, 'ok'); incoming += zip.info(fp).size + zip.info(tp).size;
  }
  return {
    kind: 'zip', fileName: file.name || '', fileSize: file.size, manifest, data, includesPhotos: !!manifest.includesPhotos, photoState,
    damagedPhotoIds: damaged, metaOnlyPhotoIds: metaOnly, unverified: !listed.has('backup.json'), weak, hashAlgo: manifest.hashAlgo || null,
    incomingBytes: incoming,
    photoBlobs: (id) => (photoState.get(id) === 'ok' ? { full: zip.blob(`photos/${id}.jpg`, 'image/jpeg'), thumb: zip.blob(`photos/thumbs/${id}.jpg`, 'image/jpeg') } : null)
  };
}

/** Same as openBackupFile but never throws. {ok:true, handle, summary} or {ok:false, code, message}. */
export async function verifyBackup(file, opts) {
  try {
    const handle = await openBackupFile(file, opts);
    const m = handle.manifest;
    return { ok: true, handle, summary: { kind: handle.kind, createdAt: m.createdAt, appVersion: m.appVersion, schemaVersion: m.schemaVersion, includesPhotos: handle.includesPhotos, profiles: m.profiles || [], counts: m.counts || {}, damagedPhotos: handle.damagedPhotoIds.length, unverified: handle.unverified, weakChecksum: handle.weak } };
  } catch (e) { return { ok: false, ...describeImportError(e) }; }
}

// ---------------------------------------------------------------- Stage B
/** Pure in-memory migration. targetSchema is a test hook (default CURRENT_SCHEMA). Original handle data is not modified. */
export function migrateBackup(handle, { targetSchema = CURRENT_SCHEMA } = {}) {
  const raw = {}; for (const s of EXPORT_STORES) raw[s] = handle.data[s] || [];
  let out;
  try { out = migrateData(raw, handle.manifest.schemaVersion, targetSchema); }
  catch (e) { throw new ImportError(e && e.code === 'I_NEWER' ? 'I_NEWER' : 'I_DAMAGED', {}, e && e.message); }
  for (const s of EXPORT_STORES) { if (!Array.isArray(out.data[s])) out.data[s] = []; }
  return out;
}

// ---------------------------------------------------------------- Stage C
function natKey(store, r) {
  if (store === 'sleepLogs') return `${r.pid}${SEP}${r.date}`;
  if (store === 'photos') return `${r.checkinId}${SEP}${r.slot}`;
  return null;
}
/** Every record through the shared validator. HARD problems make a record invalid (skipped later). SOFT problems are ignored for stored data. */
export function validateBackupData(data) {
  const valid = {}; const invalid = []; const seen = {}; const nat = {};
  for (const s of EXPORT_STORES) { valid[s] = []; seen[s] = new Set(); nat[s] = new Set(); }
  const pids = new Set();
  for (const s of ['profiles', ...EXPORT_STORES.filter((x) => x !== 'profiles')]) {
    for (const rec of data[s] || []) {
      const bad = (reasons) => invalid.push({ store: s, key: rec && typeof rec === 'object' ? keyString(s, rec) : '?', reasons });
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { bad(['not-an-object']); continue; }
      const r = validateRecord(s, rec);
      if (!r.ok) { bad(r.hard.map((h) => h.code)); continue; }
      if (s !== 'profiles' && !pids.has(rec.pid)) { bad(['unknown-profile']); continue; }
      const k = keyString(s, rec);
      if (seen[s].has(k)) { bad(['duplicate']); continue; }
      const nk = natKey(s, rec);
      if (nk && nat[s].has(nk)) { bad(['duplicate-natural-key']); continue; }
      seen[s].add(k); if (nk) nat[s].add(nk);
      if (s === 'profiles') pids.add(rec.id);
      valid[s].push(rec);
    }
  }
  return { valid, invalid, profileIds: pids };
}

// ---------------------------------------------------------------- profile mapping
/** Default choice per backup profile: same id -> 'same'; else exact name match -> 'map' (suggested); else 'create'. */
export function suggestProfileMapping(backupProfiles, localProfiles, { mode = 'merge' } = {}) {
  const out = {}; const usedLocal = new Set();
  const norm = (n) => String(n || '').trim().toLowerCase();
  for (const p of backupProfiles) if (localProfiles.some((l) => l.id === p.id)) { out[p.id] = { action: 'same', targetPid: p.id, reason: 'id' }; usedLocal.add(p.id); }
  for (const p of backupProfiles) {
    if (out[p.id]) continue;
    const m = localProfiles.find((l) => !usedLocal.has(l.id) && norm(l.name) === norm(p.name) && !backupProfiles.some((b) => b.id === l.id));
    if (m && mode !== 'replace') { out[p.id] = { action: 'map', targetPid: m.id, reason: 'name' }; usedLocal.add(m.id); } else out[p.id] = { action: 'create', targetPid: p.id, reason: 'new' };
  }
  return out;
}
function resolveMapping(backupProfileIds, mapping, mode, localProfiles) {
  const local = new Set(localProfiles.map((p) => p.id)); const res = new Map(); const targets = new Set();
  for (const pid of backupProfileIds) {
    const m = (mapping && mapping[pid]) || { action: local.has(pid) ? 'same' : 'create' };
    let action = m.action; let target = pid;
    if (action === 'same' || action === 'create') target = pid;
    else if (action === 'map') {
      if (mode === 'replace' || !m.targetPid || !local.has(m.targetPid)) throw new ImportError('E_BAD_MAPPING');
      target = m.targetPid; if (target === pid) action = 'same';
    } else if (action === 'skip') target = null;
    else throw new ImportError('E_BAD_MAPPING');
    if (target) { if (targets.has(target)) throw new ImportError('E_BAD_MAPPING'); targets.add(target); }
    res.set(pid, { action, target });
  }
  return res;
}

// ---------------------------------------------------------------- plan (shared by preview and apply)
const IGNORE = new Set(['updatedAt', 'rev']);
function stripForCompare(store, r) { const o = {}; for (const k of Object.keys(r)) { if (IGNORE.has(k) || (store === 'photos' && k === 'thumb') || r[k] === undefined) continue; o[k] = r[k]; } return o; }
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { if (a[k] === undefined && b[k] === undefined) continue; if (!deepEqual(a[k], b[k])) return false; }
  return true;
}
const sameContent = (store, a, b) => deepEqual(stripForCompare(store, a), stripForCompare(store, b));
const stamp = (r) => Number(r.updatedAt ?? r.createdAt ?? 0);
const idbKey = (store, r) => (store === 'days' ? [r.pid, r.date] : store === 'foodPrefs' ? [r.pid, r.foodRef] : store === 'settings' ? r.pid : r.id);
const ORDER = ['profiles', 'settings', 'foods', 'foodPrefs', 'exercises', 'plans', 'foodLogs', 'workoutLogs', 'days', 'sleepLogs', 'measurementTypes', 'measurements', 'checkins', 'photos'];
const emptyStat = () => ({ total: 0, new: 0, identical: 0, newer: 0, older: 0, tie: 0, invalid: 0, clashDropped: 0, clashReplaced: 0, write: 0 });

/**
 * Pure. existing: {store: Map(keyString -> record), photoDataKeys: Set}. incoming: valid records per store.
 * Returns the full list of writes, per-profile statistics and the expected store counts after applying.
 */
export function computePlan({ mode = 'merge', preference = 'newest', existing, incoming, mapping, photoBlobs = () => null, photoState = new Map(), backupProfileIds }) {
  const replace = mode === 'replace';
  const pidMap = resolveMapping(backupProfileIds || incoming.profiles.map((p) => p.id), mapping, mode, [...existing.profiles.values()]);
  const writes = []; const clear = []; const stats = {}; const totals = {}; const invalid = []; const dropped = [];
  const natIdx = { sleepLogs: new Map(), photos: new Map() };
  if (!replace) for (const s of ['sleepLogs', 'photos']) for (const r of existing[s].values()) natIdx[s].set(natKey(s, r), r);
  const pdKeys = new Set(existing.photoDataKeys);
  const stat = (pid, s) => ((stats[pid] ||= {})[s] ||= emptyStat());
  const tot = (s) => (totals[s] ||= emptyStat());
  const bump = (pid, s, f) => { stat(pid, s)[f]++; tot(s)[f]++; };
  const expected = {}; for (const s of USER_STORES) expected[s] = replace ? 0 : (s === 'photoData' ? pdKeys.size : existing[s].size);
  const foodLogPids = new Set(); const touchedPids = new Set();
  let photoBytes = 0, photoNew = 0;

  if (replace) {
    for (const s of ORDER) if (s !== 'photos') clear.push(s);
    for (const k of existing.photoDataKeys) pdKeys.add(k);
  }
  const checkinIds = new Set(replace ? [] : existing.checkins.keys());
  for (const c of incoming.checkins) { const t = pidMap.get(c.pid); if (t && t.target) checkinIds.add(c.id); }
  const clashFix = new Map(); const fixFor = (cid) => { let f = clashFix.get(cid); if (!f) clashFix.set(cid, f = { remove: new Set(), add: [] }); return f; };
  const keepPhotoIds = new Set(); // replace mode: existing photos that stay because the backup has metadata only
  const delPhoto = (id) => { writes.push({ store: 'photos', op: 'del', key: id }, { store: 'photoData', op: 'del', key: id }); pdKeys.delete(id); };

  for (const s of ORDER) {
    for (const rec0 of incoming[s]) {
      let rec = rec0; let pid;
      if (s === 'profiles') {
        const m = pidMap.get(rec.id); if (!m || m.action === 'skip' || m.action === 'map') continue; pid = rec.id;
      } else {
        const m = pidMap.get(rec.pid); if (!m || !m.target) continue; pid = m.target;
        if (pid !== rec.pid) rec = { ...rec, pid };
      }
      bump(pid, s, 'total'); touchedPids.add(pid);
      const k = keyString(s, rec);
      if (s === 'photos' && !checkinIds.has(rec.checkinId)) { bump(pid, s, 'invalid'); invalid.push({ store: s, key: k, reasons: ['orphan-photo'] }); continue; }
      const e = replace ? undefined : existing[s].get(k);
      const nk = natKey(s, rec);
      let write = false;

      if (nk && !replace) {
        const occ = natIdx[s].get(nk);
        if (occ && keyString(s, occ) !== k) {
          const backupWins = preference === 'backup' || (preference === 'newest' && stamp(rec) > stamp(occ));
          if (!backupWins) { bump(pid, s, 'clashDropped'); dropped.push({ store: s, key: k, keptKey: keyString(s, occ) }); if (s === 'photos') { const f = fixFor(rec.checkinId); f.remove.add(rec.id); f.add.push({ photoId: occ.id, slot: occ.slot }); } continue; }
          bump(pid, s, 'clashReplaced');
          if (s === 'photos') { delPhoto(occ.id); const f = fixFor(rec.checkinId); f.remove.add(occ.id); f.add.push({ photoId: rec.id, slot: rec.slot }); } else writes.push({ store: s, op: 'del', key: occ.id });
          expected[s]--; natIdx[s].delete(nk);
        }
      }
      if (replace) { write = true; bump(pid, s, 'new'); }
      else if (!e) { write = true; bump(pid, s, 'new'); }
      else if (sameContent(s, e, rec)) bump(pid, s, 'identical');
      else {
        const a = stamp(rec), b = stamp(e); const cls = a > b ? 'newer' : a < b ? 'older' : 'tie';
        bump(pid, s, cls);
        write = preference === 'backup' || (preference === 'newest' && cls === 'newer');
      }
      if (!write) continue;
      bump(pid, s, 'write');
      if (nk) { if (e) { const ok2 = natKey(s, e); if (natIdx[s].get(ok2) === e) natIdx[s].delete(ok2); } natIdx[s].set(nk, rec); }
      if (!e) expected[s]++; else if (replace) expected[s]++;
      if (s === 'foodLogs') foodLogPids.add(pid);
      if (s === 'photos') {
        const blobs = photoState.get(rec.id) === 'ok' ? photoBlobs(rec.id) : null;
        const prev = replace ? existing.photos.get(k) : e;
        if (blobs) {
          writes.push({ store: 'photos', op: 'put', key: rec.id, rec: { ...rec, thumb: blobs.thumb } }, { store: 'photoData', op: 'put', key: rec.id, rec: { id: rec.id, blob: blobs.full } });
          pdKeys.add(rec.id); photoBytes += blobs.full.size + blobs.thumb.size; if (!prev) photoNew++;
        } else {
          writes.push({ store: 'photos', op: 'put', key: rec.id, rec: { ...rec, thumb: prev && prev.thumb ? prev.thumb : null } }); // existing bytes are never touched
          if (replace && prev) keepPhotoIds.add(rec.id);
        }
        continue;
      }
      writes.push({ store: s, op: 'put', key: idbKey(s, rec), rec });
    }
  }
  // F-A9-03: a photo that lost (or won) a [checkin, slot] clash must not leave the surviving check-in pointing at a photo that no longer exists.
  if (!replace && clashFix.size) {
    for (const [cid, f] of clashFix) {
      let wi = -1; for (let i = writes.length - 1; i >= 0; i--) if (writes[i].store === 'checkins' && writes[i].op === 'put' && writes[i].key === cid) { wi = i; break; }
      const base = wi >= 0 ? writes[wi].rec : existing.checkins.get(cid); if (!base) continue;
      let list = (base.photos || []).filter((p) => !f.remove.has(p.photoId));
      for (const a2 of f.add) if (!list.some((p) => p.photoId === a2.photoId) && !list.some((p) => p.slot === a2.slot)) list.push({ photoId: a2.photoId, slot: a2.slot });
      const same = list.length === (base.photos || []).length && list.every((p, i) => (base.photos || [])[i] && base.photos[i].photoId === p.photoId);
      if (same) continue;
      const rec2 = { ...base, photos: list };
      if (wi >= 0) writes[wi] = { ...writes[wi], rec: rec2 }; else writes.push({ store: 'checkins', op: 'put', key: idbKey('checkins', rec2), rec: rec2 });
    }
  }
  const willRemove = {};
  if (replace) {
    // existing photos that are not (re)written are removed with their bytes. Metadata-only photos that exist locally keep their bytes.
    const writtenPhotos = new Set(writes.filter((w) => w.store === 'photos' && w.op === 'put').map((w) => w.key));
    const dels = [];
    for (const id of existing.photos.keys()) if (!writtenPhotos.has(id)) dels.push(id);
    for (const id of existing.photoDataKeys) if (!writtenPhotos.has(id) && !dels.includes(id)) dels.push(id);
    for (const id of dels) delPhoto(id);
    for (const s of ORDER) {
      const written = new Set(writes.filter((w) => w.store === s && w.op === 'put').map((w) => keyString(s, w.rec)));
      expected[s] = written.size;
      let gone = 0; for (const key of existing[s].keys()) if (!written.has(key)) gone++;
      willRemove[s] = gone;
    }
    expected.photoData = pdKeys.size;
  } else expected.photoData = pdKeys.size;
  const invalidTotal = invalid.length;
  return { mode, preference, writes, clear, stats, totals, invalid, invalidTotal, dropped, expected, foodLogPids, touchedPids, willRemove, photoBytes, photoNew, mapping: pidMap, keepPhotoIds };
}

// ---------------------------------------------------------------- DB reads
async function readExisting(t) {
  const existing = {};
  for (const s of ORDER) { existing[s] = new Map(); for (const r of await t.store(s).getAll()) existing[s].set(keyString(s, r), r); }
  existing.photoDataKeys = new Set(await t.store('photoData').getAllKeys());
  return existing;
}
const readExistingOnce = () => tx([...ORDER, 'photoData'], 'readonly', readExisting);

async function freeBytes() {
  try { if (navigator.storage && typeof navigator.storage.estimate === 'function') { const e = await navigator.storage.estimate(); if (e && e.quota > 0) return Math.max(0, e.quota - (e.usage || 0)); } } catch { /* unknown */ }
  return null;
}
/** Pre-flight about 1.5x the incoming size. free=null means the browser cannot say, so the check passes. */
async function spaceCheck(handle, existing, mode) {
  const free = await freeBytes();
  let credit = 0; if (mode === 'replace') for (const p of existing.photos.values()) credit += (p.bytes || 0) + (p.thumbBytes || 0);
  const required = Math.ceil(handle.incomingBytes * 1.5) - credit;
  return { requiredBytes: Math.max(0, required), freeBytes: free, ok: free === null || free >= required };
}

// ---------------------------------------------------------------- Stage D
function prepared(handle, targetSchema) {
  const key = targetSchema ?? CURRENT_SCHEMA;
  if (handle._prepared && handle._prepared.key === key) return handle._prepared;
  const mig = migrateBackup(handle, { targetSchema });
  const val = validateBackupData(mig.data);
  handle._prepared = { key, mig, val };
  return handle._prepared;
}
/** Stage D. Reads the DB (read-only) and returns everything the preview screens need. */
export async function buildPreview(handle, { mode = 'merge', preference = 'newest', profileMap, targetSchema } = {}) {
  if (!['merge', 'replace'].includes(mode) || !['newest', 'mine', 'backup'].includes(preference)) throw new ImportError('E_BAD_OPTIONS');
  const { mig, val } = prepared(handle, targetSchema);
  const existing = await readExistingOnce();
  const localProfiles = [...existing.profiles.values()];
  const backupProfiles = val.valid.profiles.map((p) => ({ id: p.id, name: p.name }));
  const suggested = suggestProfileMapping(backupProfiles, localProfiles, { mode });
  const plan = computePlan({ mode, preference, existing, incoming: val.valid, mapping: profileMap || suggested, photoBlobs: handle.photoBlobs, photoState: handle.photoState, backupProfileIds: backupProfiles.map((p) => p.id) });
  const space = await spaceCheck(handle, existing, mode);
  const warnings = [];
  if (mode === 'merge' && Object.values(plan.totals).some((t) => t.new > 0)) warnings.push('MERGE_MAY_RESURRECT');
  if (mode === 'replace') warnings.push('REPLACE_REMOVES_OTHER_DATA');
  if (handle.kind === 'json' && handle.data.photos.length) warnings.push('PHOTOS_METADATA_ONLY');
  if (handle.damagedPhotoIds.length) warnings.push('PHOTOS_DAMAGED');
  if (handle.weak) warnings.push('CHECKSUM_WEAK');
  if (handle.unverified) warnings.push('NOT_VERIFIED');
  const profiles = backupProfiles.map((p) => { const m = plan.mapping.get(p.id); return { backupPid: p.id, name: p.name, existsLocally: localProfiles.some((l) => l.id === p.id), suggested: suggested[p.id], action: m.action, targetPid: m.target, stats: (m.target && plan.stats[m.target]) || {} }; });
  return {
    mode, preference, migration: { from: mig.from, to: mig.to, applied: mig.applied },
    profiles, localProfiles: localProfiles.map((p) => ({ id: p.id, name: p.name })), suggestedMapping: suggested,
    totals: plan.totals, stats: plan.stats, invalidCount: val.invalid.length + plan.invalidTotal, invalid: [...val.invalid, ...plan.invalid].slice(0, 100),
    dropped: plan.dropped, damagedPhotoIds: handle.damagedPhotoIds, metaOnlyPhotoCount: handle.metaOnlyPhotoIds.length,
    willRemove: plan.willRemove, expected: plan.expected, writeCount: plan.writes.length, space, warnings,
    manifest: { createdAt: handle.manifest.createdAt, appVersion: handle.manifest.appVersion, installId: handle.manifest.installId, includesPhotos: handle.includesPhotos }
  };
}

// ---------------------------------------------------------------- Stage F
let busy = false;
/** Convenience for the UI: build the safety backup file for Replace. The UI shares/saves it from a tap, then calls applyImport with safetyBackup:'done'. */
export const makeSafetyBackup = (opts) => prepareBackup({ includePhotos: true, ...opts });

/**
 * Stage F. One readwrite transaction over every store. Throws ImportError (or the underlying error) and leaves the DB unchanged on any failure.
 * options.safetyBackup (Replace only): 'done' | 'skipped' (the user explicitly chose to skip) | async function that must resolve true.
 * options.invalid: 'skip' is required when records are invalid. options.damagedPhotos: 'import-without' is required when photos are damaged.
 * options.hooks.onWrite(n, write) is a test hook: throw from it to simulate a failure in the middle of the transaction.
 */
export async function applyImport(handle, options = {}) {
  const { mode = 'merge', preference = 'newest', profileMap, hooks = {}, targetSchema } = options;
  if (!['merge', 'replace'].includes(mode) || !['newest', 'mine', 'backup'].includes(preference)) throw new ImportError('E_BAD_OPTIONS');
  if (busy) throw new ImportError('E_BUSY');
  busy = true;
  try {
    const { mig, val } = prepared(handle, targetSchema);
    const invalidCount = val.invalid.length;
    if (handle.damagedPhotoIds.length && options.damagedPhotos !== 'import-without') throw new ImportError('I_PHOTOS_DAMAGED', { n: handle.damagedPhotoIds.length });
    if (invalidCount && options.invalid !== 'skip') throw new ImportError('I_INVALID_RECORDS', { n: invalidCount });
    if (mode === 'replace') {
      const sb = options.safetyBackup;
      if (sb === 'done' || sb === 'skipped') { /* confirmed by the UI */ }
      else if (typeof sb === 'function') { let ok = false; try { ok = (await sb()) === true; } catch { ok = false; } if (!ok) throw new ImportError('E_SAFETY_FAILED'); }
      else throw new ImportError('E_SAFETY_REQUIRED');
    }
    const backupProfileIds = val.valid.profiles.map((p) => p.id);
    const pre = await readExistingOnce();
    const space = await spaceCheck(handle, pre, mode);
    if (!space.ok) throw new ImportError('I_SPACE', {}, space);
    const before = {}; for (const s of USER_STORES) before[s] = s === 'photoData' ? pre.photoDataKeys.size : pre[s].size;

    const plan = await tx([...ORDER, 'photoData'], 'readwrite', async (t) => {
      const existing = await readExisting(t); // read inside the transaction: the plan matches exactly what gets written
      const mapping = profileMap || suggestProfileMapping(val.valid.profiles.map((x) => ({ id: x.id, name: x.name })), [...existing.profiles.values()], { mode });
      const p = computePlan({ mode, preference, existing, incoming: val.valid, mapping, photoBlobs: handle.photoBlobs, photoState: handle.photoState, backupProfileIds });
      if (p.invalidTotal && options.invalid !== 'skip') throw new ImportError('I_INVALID_RECORDS', { n: invalidCount + p.invalidTotal });
      p.logCountsBefore = {}; for (const pid of p.foodLogPids) { let n = 0; for (const r of existing.foodLogs.values()) if (r.pid === pid) n++; p.logCountsBefore[pid] = n; }
      let n = 0;
      for (const s of p.clear) await t.store(s).clear();
      for (const w of p.writes) {
        if (w.op === 'put') await t.store(w.store).put(w.rec); else await t.store(w.store).del(w.key);
        n++; if (hooks.onWrite) hooks.onWrite(n, w);
      }
      if (hooks.beforeCommit) hooks.beforeCommit(n);
      return p;
    });

    // ---- committed. Everything below is verification and bookkeeping; it must not undo or throw.
    try { invalidateOverlay(); } catch { /* F-A9-01: custom foods, copies and hidden-seed lists must be visible straight away */ }
    const warnings = [];
    const verification = await verifyAfterImport(plan).catch((e) => ({ ok: false, error: String(e && e.message || e), checks: [] }));
    const changed = plan.writes.length > 0 || plan.clear.length > 0;
    if (mode === 'merge') {
      for (const pid of plan.foodLogPids) {
        // restore from an empty history keeps the backup's own favourites/recents exactly; otherwise rebuild from the merged logs
        if ((plan.logCountsBefore[pid] || 0) > 0) { try { await rebuildPrefs(pid); } catch (e) { warnings.push('rebuildPrefs failed for a profile'); } }
      }
    }
    const summary = {
      at: Date.now(), mode, preference, kind: handle.kind, fileName: handle.fileName, backupCreatedAt: handle.manifest.createdAt,
      applied: Object.fromEntries(Object.entries(plan.totals).map(([s, t]) => [s, { new: t.new, identical: t.identical, newer: t.newer, older: t.older, tie: t.tie, written: t.write, dropped: t.clashDropped, replacedByClash: t.clashReplaced }])),
      invalidSkipped: invalidCount + plan.invalidTotal, photosWithoutFiles: handle.metaOnlyPhotoIds.length + handle.damagedPhotoIds.length, verificationOk: !!verification.ok, migration: { from: mig.from, to: mig.to }
    };
    try { await setMeta('lastImportSummary', summary); } catch { warnings.push('Could not save the import summary'); }
    if (changed) { try { await noteWrite(); } catch { warnings.push('Could not update the change counter'); } }
    return { ok: true, mode, preference, changed, writes: plan.writes.length, before, expected: plan.expected, stats: plan.stats, totals: plan.totals, dropped: plan.dropped, verification, summary, warnings };
  } finally { busy = false; }
}

/** Post-import verification: recount every store and the photo bytes that were just written. */
export async function verifyAfterImport(plan) {
  const checks = [];
  const res = await tx([...ORDER, 'photoData'], 'readonly', async (t) => {
    const counts = {};
    for (const s of ORDER) counts[s] = await t.store(s).count();
    const pd = await t.store('photoData').getAllKeys(); counts.photoData = pd.length;
    let actualBytes = 0, expectedBytes = 0;
    for (const w of plan.writes) if (w.store === 'photoData' && w.op === 'put') { const r = await t.store('photoData').get(w.key); actualBytes += r && r.blob ? r.blob.size : 0; expectedBytes += w.rec.blob.size; }
    return { counts, actualBytes, expectedBytes };
  });
  let ok = true;
  for (const s of [...ORDER, 'photoData']) { const good = res.counts[s] === plan.expected[s]; if (!good) ok = false; checks.push({ store: s, expected: plan.expected[s], actual: res.counts[s], ok: good }); }
  const bytesOk = res.actualBytes === res.expectedBytes; if (!bytesOk) ok = false;
  return { ok, checks, photoBytes: { expected: res.expectedBytes, actual: res.actualBytes, ok: bytesOk } };
}

/** open + apply in one call (tests and simple flows). */
export async function importBackupFile(file, options = {}) { return applyImport(await openBackupFile(file, { onProgress: options.onProgress }), options); }
