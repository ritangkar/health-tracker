// Tracks object URLs so every one is revoked when a screen goes away (D-060, D-032). (A5)
// retire() marks the current URLs as old and flush() revokes the old ones. Screens call retire() before they build new images and flush()
// after the new DOM is mounted, so a URL is never revoked while its <img> is still loading.
export function createUrlBag() {
  const urls = new Set(); let old = new Set();
  return {
    make(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; },
    revoke(u) { if (urls.delete(u) || old.delete(u)) URL.revokeObjectURL(u); },
    retire() { for (const u of urls) old.add(u); urls.clear(); },
    flush() { for (const u of old) URL.revokeObjectURL(u); old = new Set(); },
    revokeAll() { for (const u of urls) URL.revokeObjectURL(u); for (const u of old) URL.revokeObjectURL(u); urls.clear(); old = new Set(); },
    get size() { return urls.size + old.size; }
  };
}
