// Inline SVG icon set (D-020). 24x24 grid, stroke only, currentColor. Authored for this project. (A3)
// API: icon(name, {size=24, label, cls}) -> SVG node. label => role=img + aria-label, otherwise aria-hidden. ICON_NAMES.
import { svgEl } from '../core/dom.js';

const P = {
  home: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  food: ['M7 3v8', 'M5 3v5a2 2 0 0 0 4 0V3', 'M7 11v10', 'M16 3c-2 1.5-3 4-3 7 0 2 1 3 3 3v8', 'M16 3v10'],
  dumbbell: ['M6 7v10', 'M3 9.5v5', 'M18 7v10', 'M21 9.5v5', 'M6 12h12'],
  body: ['M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M5 9l7 2 7-2', 'M12 11v4', 'M9 22l3-7 3 7'],
  chart: ['M4 20V4', 'M4 20h16', 'M7 15l4-4 3 3 5-6'],
  settings: ['M4 7h10', 'M18 7h2', 'M14 5v4h4V5z', 'M4 17h2', 'M10 17h10', 'M6 15v4h4v-4z'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  water: ['M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3z'],
  steps: ['M8 4c2 0 3 2 3 4.5S10 12 8 12 5 10.5 5 8s1-4 3-4z', 'M7 15h4v1.5a2 2 0 0 1-4 0V15z', 'M16 10c2 0 3 2 3 4.5S18 18 16 18s-3-1-3-3.5 1-4.5 3-4.5z', 'M15 21h4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'],
  note: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h5'],
  camera: ['M4 8h3l1.5-2h7L17 8h3v11H4z', 'M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M9 9.5a1 1 0 1 0 0-.01'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  edit: ['M4 20l1-4L16 5l3 3L8 19z', 'M14 7l3 3'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  back: ['M15 5l-7 7 7 7'],
  forward: ['M9 5l7 7-7 7'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5h.01'],
  warning: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  share: ['M12 15V4', 'M8 8l4-4 4 4', 'M6 12v8h12v-8'],
  upload: ['M12 16V5', 'M7 9l5-5 5 5', 'M5 20h14'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2.2 2.2L15.5 10'],
  flame: ['M12 21c-4 0-6.5-2.8-6.5-6.2 0-3 2-4.8 3.5-7C10 6.5 10.5 5 10.5 3c3 1.5 6 5 6 9 .8-.6 1.4-1.6 1.5-2.8 1.2 1.6 1.5 3 1.5 4.6C19.5 18 16.5 21 12 21z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M16 16l5 5'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.5-6 8-6s8 2 8 6']
};
export const ICON_NAMES = Object.keys(P);

export function icon(name, { size = 24, label = null, cls = '' } = {}) {
  const paths = P[name];
  if (!paths) throw new RangeError(`Unknown icon: ${name}`);
  const svg = svgEl('svg', {
    class: `icon icon-${name}${cls ? ' ' + cls : ''}`, viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })
  }, ...paths.map((d) => svgEl('path', { d })));
  return svg;
}
