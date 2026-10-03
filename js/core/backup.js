// Backup engine, no UI. (A2)
// Two steps (DAT-018): prepareBackup() builds the file and returns a share-ready File; shareOrDownload() is then called
// directly from a user gesture (tap) so navigator.share() is allowed. Nothing here sets lastBackupAt except a finished
// share/download (D-017 item 4). AbortError on share = "not recorded".
// API: FORMAT, FORMAT_VERSION, SUPPORTED_FORMAT_VERSION, EXPORT_CATEGORIES, BACKUP_WARN_BYTES,
//  estimateBackup() -> {photoCount, photoBytes, jsonBytes, totalBytes, warnLarge}
//  prepareBackup({includePhotos=true, now, onProgress}) -> {file, filename, size, kind:'zip'|'json', includesPhotos, photoCount, photoBytes, manifest, hashAlgo, warnLarge}
//  canShareFiles(file) sync, shareOrDownload(prepared, {mode:'auto'|'share'|'download'}) -> {result:'shared'|'downloaded'|'cancelled'|'failed', recorded, filename}
//  backupFilename(now, kind) sync, snapshotForExport(), hashBlob(blob), sha256Hex(bytes), keyString(store, rec)
// File layout (D-033): zip = manifest.json, backup.json ({data}), photos/<id>.jpg, photos/thumbs/<id>.jpg ; json = {manifest, data} (no photo bytes).
// Excluded always: meta store, seed, caches, LocalStorage.
import * as db from './db.js';
import { EXPORT_STORES, txAll } from './repo.js';
import { getMeta, setMeta, recordBackup, getChangesSinceBackup } from './storage-health.js';
import { toKey } from './dates.js';
import { CURRENT_SCHEMA } from '../../config.js';
import { createZip, crc32 } from '../lib/zip.js';

export const FORMAT = 'winter-arc-backup';
export const FORMAT_VERSION = 1;
export const SUPPORTED_FORMAT_VERSION = 1;
export const BACKUP_WARN_BYTES = 150 * 1024 * 1024;
export const EXPORT_CATEGORIES = {
  users: 'profiles', goals: 'settings.targetsHistory', 'custom foods/recipes': 'foods', 'exercise library': 'exercises', 'workout plans': 'plans',
  'daily/step/water logs, notes': 'days', 'food logs': 'foodLogs', 'exercise logs': 'workoutLogs', 'sleep logs': 'sleepLogs',
  measurements: 'measurementTypes+measurements', 'check-ins': 'checkins', photos: 'photos+files', settings: 'settings', 'favourites/recents': 'foodPrefs'
};

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hasSubtle = () => typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function';
/** Lower-case hex SHA-256, or null when crypto.subtle is not available (non-https). */
export async function sha256Hex(bytes) { return hasSubtle() ? hex(await crypto.subtle.digest('SHA-256', bytes)) : null; }
/** One read of the blob gives byte count, CRC-32 and SHA-256 (null if unavailable). */
export async function hashBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes: bytes.length, crc32: crc32(bytes), sha256: await sha256Hex(bytes) };
}

/** Stable key text for a record (used for ordering and matching). Composite stores use pid + second part. */
export function keyString(store, r) {
  if (store === 'days') return `${r.pid}\u0001${r.date}`;
  if (store === 'foodPrefs') return `${r.pid}\u0001${r.foodRef}`;
  if (store === 'settings') return String(r.pid);
  return String(r.id);
}
const byKey = (store) => (a, b) => { const x = keyString(store, a), y = keyString(store, b); return x < y ? -1 : x > y ? 1 : 0; };
const noThumb = (p) => { const { thumb, ...rest } = p; return rest; };

/** One consistent read of every exported store in a single readonly transaction. Photo thumbs stay as Blobs here. */
export async function snapshotForExport() {
  const snap = await txAll('readonly', async (t) => {
    const out = {};
    for (const s of EXPORT_STORES) out[s] = await t.store(s).getAll();
    return out;
  });
  for (const s of EXPORT_STORES) snap[s].sort(byKey(s));
  return snap;
}

async function installId() {
  let id = await getMeta('installId', null);
  if (!id) { id = `in_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; try { await setMeta('installId', id); } catch { /* not fatal */ } }
  return id;
}
const appVersion = () => String(globalThis.WA_VERSION || '0.0.0-dev');
const seedVersion = () => Number(globalThis.WA_SEED_VERSION || 0);
export function backupFilename(now = new Date(), kind = 'zip') { return `winter-arc-backup-${toKey(now)}.${kind === 'json' ? 'json' : 'zip'}`; }

/** Sizes the user sees before pressing Prepare. */
export async function estimateBackup() {
  // F-A11-03: the size line must not read and stringify every row. Each store is sampled (first 40 rows) and scaled by its row count;
  // photo bytes come from photo metadata only. The Backup screen already says "About".
  const SAMPLE = 40;
  const r = await txAll('readonly', async (t) => {
    let jsonBytes = 2; let photoBytes = 0; let photoCount = 0;
    for (const sName of EXPORT_STORES) {
      const n = await t.store(sName).count(); if (!n) { jsonBytes += sName.length + 6; continue; }
      const rows = await t.store(sName).getAll({ limit: SAMPLE });
      const strip = sName === 'photos' ? rows.map(noThumb) : rows;
      const sampleBytes = enc.encode(JSON.stringify(strip)).length;
      jsonBytes += Math.round(sampleBytes / Math.max(1, rows.length) * n) + sName.length + 6;
      if (sName === 'photos') { photoCount = n; for (const p of await t.store('photos').getAll()) photoBytes += (p.bytes || 0) + (p.thumbBytes || 0); }
    }
    return { jsonBytes, photoBytes, photoCount };
  });
  const total = r.jsonBytes + r.photoBytes;
  return { photoCount: r.photoCount, photoBytes: r.photoBytes, jsonBytes: r.jsonBytes, totalBytes: total, warnLarge: total > BACKUP_WARN_BYTES };
}
function dataFrom(snap) {
  const data = {};
  for (const s of EXPORT_STORES) data[s] = s === 'photos' ? snap[s].map(noThumb) : snap[s];
  return data;
}
function manifestBase(snap, includesPhotos, id, now) {
  const counts = {}; for (const s of EXPORT_STORES) counts[s] = snap[s].length;
  return {
    format: FORMAT, formatVersion: FORMAT_VERSION, schemaVersion: CURRENT_SCHEMA, appVersion: appVersion(), seedVersion: seedVersion(),
    createdAt: now.getTime(), installId: id, includesPhotos, profiles: snap.profiles.map((p) => ({ id: p.id, name: p.name })),
    counts, exportCategories: EXPORT_CATEGORIES
  };
}
const asFile = (parts, name, type) => (typeof File === 'function' ? new File(parts, name, { type }) : Object.assign(new Blob(parts, { type }), { name }));

/**
 * Step 1 of 2. Builds the whole file. Does NOT set lastBackupAt.
 * includePhotos=false (or no photos exist) gives the JSON-only variant: photo metadata but no image bytes.
 */
export async function prepareBackup({ includePhotos = true, now = new Date(), onProgress } = {}) {
  const snap = await snapshotForExport();
  const id = await installId();
  const data = dataFrom(snap);
  const photos = snap.photos;
  const withBytes = includePhotos && photos.length > 0;
  const progress = (phase, done, total) => { if (onProgress) onProgress({ phase, done, total }); };
  let hashAlgo = hasSubtle() ? 'sha256' : 'crc32';

  if (!withBytes) {
    const manifest = manifestBase(snap, false, id, now);
    const dataText = JSON.stringify(data);
    const h = await hashBlob(new Blob([enc.encode(dataText)]));
    manifest.hashAlgo = hashAlgo;
    manifest.dataChecksum = hashAlgo === 'sha256' && h.sha256 ? { algo: 'sha256', value: h.sha256 } : { algo: 'crc32', value: h.crc32 };
    manifest.files = [];
    const text = JSON.stringify({ manifest, data });
    const file = asFile([text], backupFilename(now, 'json'), 'application/json');
    return { file, filename: file.name, size: file.size, kind: 'json', includesPhotos: false, photoCount: 0, photoBytes: 0, manifest, hashAlgo, warnLarge: file.size > BACKUP_WARN_BYTES };
  }

  const files = []; const entries = []; const missing = [];
  const backupBlob = new Blob([enc.encode(JSON.stringify({ data }))]);
  const bh = await hashBlob(backupBlob);
  files.push({ path: 'backup.json', bytes: bh.bytes, crc32: bh.crc32, sha256: bh.sha256 });
  entries.push({ path: 'backup.json', data: backupBlob, crc32: bh.crc32 });
  let photoBytes = 0, i = 0;
  for (const p of photos) {
    i++; progress('photos', i, photos.length);
    const rec = await db.get('photoData', p.id); // one photo at a time
    const full = rec && rec.blob instanceof Blob ? rec.blob : null;
    if (!full || !(p.thumb instanceof Blob)) { missing.push(p.id); continue; }
    const fh = await hashBlob(full), th = await hashBlob(p.thumb);
    files.push({ path: `photos/${p.id}.jpg`, bytes: fh.bytes, crc32: fh.crc32, sha256: fh.sha256 });
    files.push({ path: `photos/thumbs/${p.id}.jpg`, bytes: th.bytes, crc32: th.crc32, sha256: th.sha256 });
    entries.push({ path: `photos/${p.id}.jpg`, data: full, crc32: fh.crc32 }, { path: `photos/thumbs/${p.id}.jpg`, data: p.thumb, crc32: th.crc32 });
    photoBytes += fh.bytes + th.bytes;
  }
  if (files.some((f) => !f.sha256)) hashAlgo = 'crc32';
  const manifest = manifestBase(snap, true, id, now);
  manifest.hashAlgo = hashAlgo;
  if (missing.length) manifest.missingPhotoIds = missing;
  manifest.files = files;
  entries.unshift({ path: 'manifest.json', data: JSON.stringify(manifest) });
  const zip = await createZip(entries, { now, onProgress });
  const file = asFile([zip.blob], backupFilename(now, 'zip'), 'application/zip');
  return { file, filename: file.name, size: file.size, kind: 'zip', includesPhotos: true, photoCount: photos.length - missing.length, photoBytes, manifest, hashAlgo, warnLarge: file.size > BACKUP_WARN_BYTES };
}

export function canShareFiles(file) {
  try { return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }) === true; }
  catch { return false; }
}
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function markBackedUp() {
  try {
    await recordBackup(Date.now());
    if ((await getChangesSinceBackup()) !== 0) await setMeta('changesSinceBackup', 0);
    return true;
  } catch { return false; }
}
/**
 * Step 2 of 2. Call from a tap handler with no await before it. Do not await anything between the tap and this call.
 * mode 'auto': share sheet when files can be shared, else download. 'share': share only. 'download': anchor download.
 */
export async function shareOrDownload(prepared, { mode = 'auto' } = {}) {
  const file = prepared.file; const filename = prepared.filename || file.name;
  if (mode !== 'download' && canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: filename });
      return { result: 'shared', recorded: await markBackedUp(), filename };
    } catch (e) {
      if (e && e.name === 'AbortError') return { result: 'cancelled', recorded: false, filename };
      if (mode === 'share') return { result: 'failed', recorded: false, filename, error: String(e && e.message || e) };
      // otherwise fall back to a normal download below
    }
  } else if (mode === 'share') {
    return { result: 'failed', recorded: false, filename, error: 'Sharing files is not available here.' };
  }
  try { downloadFile(file); } catch (e) { return { result: 'failed', recorded: false, filename, error: String(e && e.message || e) }; }
  return { result: 'downloaded', recorded: await markBackedUp(), filename };
}
