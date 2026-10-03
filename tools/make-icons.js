// Draws icons/icon.svg to a canvas and downloads the four PNG sizes. Deletable together with make-icons.html (D-073). (A3)
const SIZES = [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]];
const status = document.getElementById('status');
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not load icons/icon.svg')); i.src = url; }); }
async function make() {
  status.textContent = 'Working...';
  try {
    const svgText = await (await fetch('../icons/icon.svg')).text();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    const img = await loadImage(url);
    for (const [name, size] of SIZES) {
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 300));
    }
    URL.revokeObjectURL(url);
    status.textContent = 'Done. Four files were downloaded. Upload them to the icons folder.';
  } catch (e) { status.textContent = 'Failed: ' + e.message; }
}
document.getElementById('go').addEventListener('click', make);
