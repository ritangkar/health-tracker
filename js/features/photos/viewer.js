// Full-size photo viewer: a native dialog that loads the full blob on demand and revokes its object URL on close. (A5)
import { h } from '../../core/dom.js';
import { Button } from '../../ui/components.js';
import { createUrlBag } from './url-bag.js';

let open = null;
export function closePhotoViewer() { if (open) { const d = open; open = null; if (d.open) d.close(); } }
/** loadBlob: () => Promise<Blob|null>. Resolves when the dialog closes. */
export function openPhotoViewer({ title, loadBlob }) {
  closePhotoViewer();
  return new Promise((resolve) => {
    const bag = createUrlBag(); const status = h('p', { class: 'small muted', role: 'status' }, 'Loading full size...'); const holder = h('div', { class: 'photo-viewer-img' });
    const close = Button({ label: 'Close', kind: 'primary', onClick: () => dlg.close() });
    const dlg = h('dialog', { class: 'photo-viewer', 'aria-label': title }, h('h2', { class: 'photo-viewer-title' }, title), status, holder, h('div', { class: 'photo-viewer-actions' }, close));
    dlg.addEventListener('close', () => { bag.revokeAll(); dlg.remove(); if (open === dlg) open = null; resolve(); });
    document.body.appendChild(dlg); dlg.showModal(); open = dlg; close.focus();
    Promise.resolve().then(loadBlob).then((blob) => {
      if (!dlg.isConnected) return;
      if (!blob) { status.textContent = 'Photo not in this backup'; return; }
      status.hidden = true; holder.appendChild(h('img', { class: 'photo-img', src: bag.make(blob), alt: title }));
    }).catch(() => { status.textContent = 'This photo could not be shown.'; });
  });
}
