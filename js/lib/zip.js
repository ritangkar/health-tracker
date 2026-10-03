// Store-only ZIP writer and reader (no compression). (A2)
// Never builds a whole-archive ArrayBuffer: entries are Blob parts; reading uses File.slice per entry.
// API: crc32(bytes, prev?), crc32Blob(blob), createZip(entries, {now,onProgress}) -> Promise<{blob, entries}>,
//      openZip(blobOrFile) -> Promise<archive>, ZipError(code)
//  entries for createZip: [{ path, data: Blob|string|Uint8Array|ArrayBuffer|() => Promise<those>, crc32? }]
//  archive: { size, names(), has(name), info(name), blob(name, type) (sync slice), bytes(name), text(name), crcOf(name), verify(name) }
// Limits: no ZIP64, no encryption, no compression; up to 65535 entries; entries under 4 GB.
const enc = new TextEncoder();
const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50;

export class ZipError extends Error { constructor(code, m) { super(m || code); this.name = 'ZipError'; this.code = code; } }

let TABLE = null;
function table() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TABLE[n] = c >>> 0; }
  return TABLE;
}
/** CRC-32 of a Uint8Array. Pass the previous result as prev to continue over several chunks. */
export function crc32(bytes, prev = 0) {
  const t = table(); let c = (prev ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/** CRC-32 of a Blob, read in 1 MB slices. */
export async function crc32Blob(blob, chunk = 1 << 20) {
  let c = 0;
  for (let o = 0; o < blob.size; o += chunk) c = crc32(new Uint8Array(await blob.slice(o, Math.min(blob.size, o + chunk)).arrayBuffer()), c);
  return c;
}

const toBlob = (d) => (d instanceof Blob ? d : typeof d === 'string' ? new Blob([enc.encode(d)]) : new Blob([d]));
const NAME_OK = /^[A-Za-z0-9._\-/]+$/;
export function checkEntryName(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || !NAME_OK.test(p) || p.startsWith('/') || p.endsWith('/') || p.includes('//') || p.split('/').some((s) => s === '..' || s === '.' || s === '')) throw new ZipError('bad-name', 'Bad entry name: ' + p);
}
function dosStamp(d) {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** Builds a store-only zip as a Blob made of Blob parts. Entry data is hashed one entry at a time. */
export async function createZip(entries, { now = new Date(), onProgress } = {}) {
  if (!Array.isArray(entries) || entries.length > 65535) throw new ZipError('too-many', 'Too many entries');
  const stamp = dosStamp(now); const seen = new Set(); const parts = []; const central = []; const out = [];
  let offset = 0, i = 0;
  for (const e of entries) {
    checkEntryName(e.path);
    if (seen.has(e.path)) throw new ZipError('duplicate-entry', 'Duplicate entry: ' + e.path);
    seen.add(e.path);
    const raw = typeof e.data === 'function' ? await e.data() : e.data;
    const blob = toBlob(raw); const size = blob.size;
    if (size > 0xFFFFFFFF || offset > 0xFFFFFFFF) throw new ZipError('too-large', 'Entry too large');
    const crc = e.crc32 !== undefined && e.crc32 !== null ? (e.crc32 >>> 0) : await crc32Blob(blob);
    const name = enc.encode(e.path);
    const lh = new DataView(new ArrayBuffer(30 + name.length));
    lh.setUint32(0, SIG_LOCAL, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, stamp.time, true); lh.setUint16(12, stamp.date, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    new Uint8Array(lh.buffer).set(name, 30);
    const ch = new DataView(new ArrayBuffer(46 + name.length));
    ch.setUint32(0, SIG_CENTRAL, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, stamp.time, true); ch.setUint16(14, stamp.date, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    new Uint8Array(ch.buffer).set(name, 46);
    parts.push(new Uint8Array(lh.buffer), blob); central.push(new Uint8Array(ch.buffer));
    offset += lh.byteLength + size;
    out.push({ path: e.path, size, crc32: crc });
    i++; if (onProgress) onProgress({ phase: 'zip', done: i, total: entries.length });
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  if (offset + cdSize > 0xFFFFFFFF) throw new ZipError('too-large', 'Archive too large');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_EOCD, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return { blob: new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' }), entries: out };
}

/** Opens a zip held in a Blob/File. Reads only the directory; entry bytes are read on demand. */
export async function openZip(file) {
  const size = file.size;
  if (!(size >= 22)) throw new ZipError('too-small', 'Not a zip file');
  const tailLen = Math.min(size, 22 + 65535);
  const tail = new Uint8Array(await file.slice(size - tailLen, size).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_EOCD && i + 22 + tv.getUint16(i + 20, true) === tail.length) { at = i; break; }
  }
  if (at < 0) throw new ZipError('no-eocd', 'Zip directory not found (file may be cut short)');
  const eocdAbs = size - tailLen + at;
  const disk = tv.getUint16(at + 4, true), cdDisk = tv.getUint16(at + 6, true);
  const count = tv.getUint16(at + 10, true), cdSize = tv.getUint32(at + 12, true), cdOff = tv.getUint32(at + 16, true);
  if (disk !== 0 || cdDisk !== 0) throw new ZipError('multi-disk', 'Multi-disk zip not supported');
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw new ZipError('zip64', 'ZIP64 not supported');
  if (cdOff + cdSize > eocdAbs) throw new ZipError('bad-directory', 'Zip directory is out of range');
  const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const cv = new DataView(cd.buffer);
  const dec = new TextDecoder('utf-8');
  const map = new Map(); let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('bad-directory', 'Zip directory is damaged');
    const flags = cv.getUint16(p + 8, true), method = cv.getUint16(p + 10, true);
    const crc = cv.getUint32(p + 16, true), csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
    const nlen = cv.getUint16(p + 28, true), elen = cv.getUint16(p + 30, true), clen = cv.getUint16(p + 32, true), lo = cv.getUint32(p + 42, true);
    if (p + 46 + nlen + elen + clen > cd.length) throw new ZipError('bad-directory', 'Zip directory is damaged');
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new ZipError('encrypted', 'Encrypted zip not supported');
    if (method !== 0) throw new ZipError('unsupported-method', 'Only uncompressed (store) zip entries are supported');
    if (csize !== usize) throw new ZipError('bad-size', 'Zip entry sizes disagree');
    try { checkEntryName(name); } catch { throw new ZipError('bad-name', 'Unsafe entry name'); }
    if (map.has(name)) throw new ZipError('duplicate-entry', 'Duplicate entry: ' + name);
    map.set(name, { name, size: usize, crc32: crc, localOffset: lo, start: -1 });
  }
  if (p !== cd.length) throw new ZipError('bad-directory', 'Zip directory has extra bytes');
  for (const e of map.values()) {
    if (e.localOffset + 30 > cdOff) throw new ZipError('truncated', 'Zip entry is cut short');
    const lh = new DataView(await file.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
    if (lh.getUint32(0, true) !== SIG_LOCAL) throw new ZipError('bad-local', 'Zip entry header is damaged');
    e.start = e.localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (e.start + e.size > cdOff) throw new ZipError('truncated', 'Zip entry is cut short');
  }
  const need = (n) => { const e = map.get(n); if (!e) throw new ZipError('missing-entry', 'Missing entry: ' + n); return e; };
  return {
    size,
    names: () => [...map.keys()],
    has: (n) => map.has(n),
    info: (n) => { const e = need(n); return { name: e.name, size: e.size, crc32: e.crc32, start: e.start }; },
    /** Synchronous: a slice of the original file, no bytes are read. */
    blob: (n, type = '') => { const e = need(n); return file.slice(e.start, e.start + e.size, type); },
    bytes: async (n) => { const e = need(n); return new Uint8Array(await file.slice(e.start, e.start + e.size).arrayBuffer()); },
    text: async (n) => { const e = need(n); return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await file.slice(e.start, e.start + e.size).arrayBuffer())); },
    crcOf: async (n) => { const e = need(n); return crc32Blob(file.slice(e.start, e.start + e.size)); },
    /** true when the bytes still match the CRC recorded in the directory */
    verify: async (n) => { const e = need(n); return (await crc32Blob(file.slice(e.start, e.start + e.size))) === e.crc32; }
  };
}
