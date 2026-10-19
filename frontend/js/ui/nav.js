// Navegación: iconos propios (SVG en línea), barra inferior fija (Diario · Alimentos · [+] · Más) y hojas/menús inferiores.
// Solo presentación: cada acción la decide app.js.
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  diario: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.5 5h7M8.5 12h7M8.5 16h4',
  alimentos: 'M12 8c-2-2.2-6-1.4-6 3 0 4 2.6 8 4.4 8 .8 0 1-.4 1.6-.4s.8.4 1.6.4c1.8 0 4.4-4 4.4-8 0-4.400-4-5.200-6-3zm0 0c0-2 .8-3.400 2.600-4',
  mas: 'M5 12h.01M12 12h.01M19 12h.01',
  mas3: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  chevron: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4-4',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  hand: 'M4 20h4l10-10-4-4L4 16v4zm9-13l4 4',
  repeat: 'M4 11a8 8 0 0 1 14-4l2 2M20 4v5h-5M20 13a8 8 0 0 1-14 4l-2-2M4 20v-5h5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  shield: 'M12 3l8 3v6c0 4.500-3.400 8-8 9-4.600-1-8-4.500-8-9V6z',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  chef: 'M7 20h10v-6H7zM6 14a4 4 0 0 1 1-7.800A4 4 0 0 1 12 3a4 4 0 0 1 5 3.200A4 4 0 0 1 18 14',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
};

// icon(doc, nombre) -> <svg class="ico"> decorativo (aria-hidden).
export function icon(doc, name, extra = '') {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ico ico-${name}${extra ? ` ${extra}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = doc.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONS[name] ?? ICONS.dots);
  svg.append(p);
  return svg;
}

// Barra inferior. Los textos "Diario", "Alimentos" y "Más" son los de las etiquetas; el "+" lleva aria-label.
export function bottomNav({ h, doc, active, go }) {
  const tab = (id, label, ico) => h('button', { type: 'button', class: `tab${active === id ? ' active' : ''}`, 'aria-current': active === id ? 'page' : null, onclick: () => go(id) },
    icon(doc, ico), h('span', {}, label));
  return h('nav', { class: 'tabbar', 'aria-label': 'Navegación principal' },
    tab('diary', 'Diario', 'diario'),
    tab('alimentos', 'Alimentos', 'alimentos'),
    h('button', { type: 'button', class: 'fab', 'aria-label': 'Añadir comida', onclick: () => go('add') }, icon(doc, 'plus')),
    tab('mas', 'Más', 'mas'));
}

// Hoja inferior con título y filas (icono + texto). items: [{ icon, label, hint, onclick, danger }]
export function sheet({ h, doc, title, items, close }) {
  return h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'sheet action-sheet' },
      h('div', { class: 'sheet-head' }, h('button', { type: 'button', class: 'icon close-x', 'aria-label': 'Cerrar', onclick: close }, icon(doc, 'close')), h('strong', {}, title), h('span', { class: 'sheet-spacer' })),
      h('ul', { class: 'sheet-items' }, items.map((it) => h('li', {},
        h('button', { type: 'button', class: `sheet-item${it.danger ? ' danger' : ''}${it.primary ? ' primary-row' : ''}`, onclick: it.onclick },
          h('span', { class: 'sheet-ico' }, icon(doc, it.icon)),
          h('span', { class: 'sheet-text' }, h('span', { class: 'sheet-label' }, it.label), it.hint ? h('small', {}, it.hint) : null)))))));
}

// Menú emergente (los tres puntos del Diario).
export function popMenu({ h, doc, items, close }) {
  return h('div', { class: 'popmenu-wrap', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('ul', { class: 'popmenu', role: 'menu' }, items.map((it) => h('li', { role: 'none' },
      h('button', { type: 'button', role: 'menuitem', class: 'popitem', onclick: it.onclick }, h('span', {}, it.label), icon(doc, it.icon))))));
}
