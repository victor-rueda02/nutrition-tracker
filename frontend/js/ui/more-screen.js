// Pestaña Más: lista de ajustes con chevrons (Objetivos, Documento, Copia de seguridad, Conexión, Pulir el documento).
// Solo presentación; cada fila abre su pantalla desde app.js. Estilos en css/navegacion.css.
import { icon } from './nav.js';

// ui: { h, doc, state, items: [{ icon, label, hint, onclick }] }
export function masScreen(ui) {
  const { h, doc, state } = ui;
  const incompletos = ui.incompletos;
  return h('main', { class: 'mas' },
    h('header', { class: 'top big' }, h('div', {}, h('h1', {}, 'Más'),
      h('p', { class: 'muted small' }, state.foods.length ? `${state.docName || 'Documento'} · ${state.foods.length} alimentos${incompletos ? ` · ${incompletos} incompletos` : ''}` : 'Sin documento cargado'))),
    state.status ? h('p', { class: 'ok', role: 'status' }, state.status) : null,
    h('ul', { class: 'menu-list' }, ui.items.map((it) => h('li', {},
      h('button', { type: 'button', class: 'menu-row', onclick: it.onclick },
        h('span', { class: 'menu-ico' }, icon(doc, it.icon)),
        h('span', { class: 'menu-text' }, h('span', {}, it.label), it.hint ? h('small', { class: 'muted' }, it.hint) : null),
        icon(doc, 'chevron', 'menu-chev'))))));
}
