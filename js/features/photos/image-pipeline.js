// Progress photo pipeline (D-018): decode honouring orientation, two-step downscale, full 1600 px q0.8 and thumb 320 px q0.7.
// Canvas re-encode drops EXIF and GPS. Nothing here talks to the network or to the database. (A5)
import { PHOTO } from '../../../config.js';
import { crc32Blob } from '../../lib/zip.js';
import { msg } from '../../core/validate.js';

export const MAX_INPUT_BYTES = 80 * 1024 * 1024;
export class PhotoError extends Error { constructor(m, cause) { super(m || msg('C_PHOTO_FAIL')); this.name = 'PhotoError'; this.code = 'C_PHOTO_FAIL'; this.cause = cause; } }

/** Largest size with the long edge at most maxEdge, same aspect ratio. Never upscales. */
export function fitSize(w, h, maxEdge) {
  const long = Math.max(w, h);
  if (!(long > 0)) return { w: 1, h: 1 };
  if (long <= maxEdge) return { w, h };
  const s = maxEdge / long;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}
/** Sizes to draw in order. Halves while the source is more than twice the target (huge iOS canvases), then the final size. */
export function downscalePlan(w, h, maxEdge) {
  const fin = fitSize(w, h, maxEdge); const steps = []; let cw = w, ch = h;
  while (Math.max(cw, ch) > 2 * Math.max(fin.w, fin.h)) { cw = Math.max(1, Math.ceil(cw / 2)); ch = Math.max(1, Math.ceil(ch / 2)); steps.push({ w: cw, h: ch }); }
  steps.push(fin); return steps;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { src: bmp, w: bmp.width, h: bmp.height, close() { if (bmp.close) bmp.close(); } }; }
    catch { /* fall back to an img element, which applies EXIF orientation itself */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url;
    if (img.decode) await img.decode(); else await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, close() {} };
  } finally { URL.revokeObjectURL(url); }
}
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
/** Draws src through the plan. Intermediate canvases are released straight away (iOS canvas memory). Returns the final canvas. */
function scaleThrough(src, w0, h0, plan) {
  let cur = src, cw = w0, ch = h0;
  for (const s of plan) {
    const c = newCanvas(s.w, s.h); const g = c.getContext('2d');
    if (!g) throw new Error('no 2d canvas');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s.w, s.h); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, cw, ch, 0, 0, s.w, s.h);
    if (cur !== src && cur.width) { cur.width = 0; cur.height = 0; }
    cur = c; cw = s.w; ch = s.h;
  }
  return cur;
}
const toBlob = (canvas, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q));

/** file -> {blob, thumb, w, h, bytes, thumbBytes, mime, crc32}. Throws PhotoError (C_PHOTO_FAIL). */
export async function processImage(file, opts = {}) {
  const longEdge = opts.longEdge || PHOTO.longEdge, quality = opts.quality || PHOTO.quality, thumbEdge = opts.thumbEdge || PHOTO.thumbEdge, thumbQuality = opts.thumbQuality || PHOTO.thumbQuality;
  if (!file || (file.type && !/^image\//i.test(file.type)) || file.size > MAX_INPUT_BYTES || file.size === 0) throw new PhotoError();
  let dec = null; let full = null; let thumbCanvas = null;
  try {
    dec = await decode(file);
    if (!(dec.w > 0 && dec.h > 0)) throw new Error('empty image');
    full = scaleThrough(dec.src, dec.w, dec.h, downscalePlan(dec.w, dec.h, longEdge));
    const w = full.width, h = full.height;
    const blob = await toBlob(full, quality);
    thumbCanvas = scaleThrough(full, w, h, downscalePlan(w, h, thumbEdge));
    const thumb = await toBlob(thumbCanvas, thumbQuality);
    const crc = await crc32Blob(blob);
    return { blob, thumb, w, h, bytes: blob.size, thumbBytes: thumb.size, mime: 'image/jpeg', crc32: crc };
  } catch (e) { throw e instanceof PhotoError ? e : new PhotoError(msg('C_PHOTO_FAIL'), e); }
  finally {
    if (dec) dec.close();
    for (const c of [full, thumbCanvas]) if (c && c.width) { c.width = 0; c.height = 0; }
  }
}
