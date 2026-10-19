// Pestaña Alimentos: tarjetas (Mi catálogo, Recetas, Plantillas, Añadidos con IA) y la lista buscable del catálogo.
// Solo presentación; las acciones llegan desde app.js. Estilos en css/navegacion.css.
import { isExcluded } from '../core/excluded.js';
import { looseKey } from '../core/text.js';
import { icon } from './nav.js';

// ui: { h, doc, state, incompleteInfo, header, openCatalog, openRecetas, openTemplates, reviewUpdate, postponeUpdate, pendientes }
export function alimentosScreen(ui) {
  const { h, doc, state } = ui;
  const incompletos = state.foods.filter(ui.incompleteInfo).length;
  const card = (ico, title, text, actions, onOpen) => h('section', { class: 'panel card-link' },
    h('div', { class: 'card-head' },
      h('span', { class: 'card-ico' }, icon(doc, ico)),
      h('div', { class: 'card-body' }, h('h2', {}, title), text ? h('p', { class: 'muted' }, text) : null),
      onOpen ? h('button', { type: 'button', class: 'icon chev', 'aria-label': `Abrir ${title}`, onclick: onOpen }, icon(doc, 'chevron')) : null),
    h('div', { class: 'row wrap' }, actions));
  const u = state.catUpdate;
  return h('main', { class: 'alimentos' },
    h('header', { class: 'top big' }, h('h1', {}, 'Alimentos'),
      h('button', { type: 'button', class: 'icon', 'aria-label': 'Buscar alimento', onclick: () => ui.openCatalog({ focus: true }) }, icon(doc, 'search'))),
    state.status ? h('p', { class: 'ok', role: 'status' }, state.status) : null,
    u && !u.ignorado ? h('section', { class: 'panel aviso-catalogo', 'aria-label': 'Documento nuevo' },
      h('p', {}, `Hay una versión nueva de tu documento de alimentos: ${u.plan.nuevos.length} nuevos, ${u.plan.actualizados.length} actualizados${u.plan.conflictos.length ? `, ${u.plan.conflictos.length} con conflicto` : ''}.`),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'secondary', onclick: ui.reviewUpdate }, 'Revisar'),
        h('button', { type: 'button', class: 'link', onclick: ui.postponeUpdate }, 'Ahora no'))) : null,
    card('alimentos', 'Mi catálogo', state.foods.length ? [`${state.foods.length} alimentos`, incompletos ? [' · ', h('button', { type: 'button', class: 'link inline', onclick: ui.openIncompletos }, `${incompletos} incompletos`)] : null] : 'No hay documento de alimentos. Impórtalo en Documento.',
      h('button', { type: 'button', class: 'secondary pill', onclick: () => ui.openCatalog() }, 'Ver catálogo'), () => ui.openCatalog()),
    card('chef', 'Recetas', `${ui.nRecetas} ${ui.nRecetas === 1 ? 'receta' : 'recetas'}`,
      h('button', { type: 'button', class: 'secondary pill', onclick: ui.openRecetas }, 'Ver recetas'), ui.openRecetas),
    card('list', 'Plantillas', `${ui.nPlantillas} ${ui.nPlantillas === 1 ? 'plantilla' : 'plantillas'}`,
      h('button', { type: 'button', class: 'secondary pill', onclick: ui.openTemplates }, 'Ver plantillas'), ui.openTemplates),
    ui.pendientes);
}

// Lista del catálogo: buscador, filtros (Todos · Incompletos · Excluidos) y una fila por alimento. Solo lectura.
export function catalogoListScreen(ui) {
  const { h, doc, state } = ui;
  const FILTROS = [['todos', 'Todos'], ['incompletos', 'Incompletos'], ['excluidos', 'Excluidos']];
  const list = h('ul', { class: 'food-list' });
  const count = h('p', { class: 'muted small food-count', role: 'status' });
  const input = h('input', { type: 'search', placeholder: 'Buscar en tu documento…', 'aria-label': 'Buscar alimento', value: state.catQuery ?? '',
    oninput: (e) => { state.catQuery = e.target.value; fill(); } });
  const chips = h('div', { class: 'segment', role: 'group', 'aria-label': 'Filtro' }, FILTROS.map(([id, label]) =>
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String((state.catFilter ?? 'todos') === id), onclick: () => { state.catFilter = id; ui.render(); } }, label)));
  function fill() {
    list.replaceChildren();
    const q = looseKey(state.catQuery ?? '');
    const f = state.catFilter ?? 'todos';
    const rows = state.foods.filter((x) => (!q || [x.nombre, x.id, ...x.alias].some((t) => looseKey(t).includes(q)))
      && (f === 'todos' || (f === 'incompletos' && ui.incompleteInfo(x)) || (f === 'excluidos' && isExcluded(x))));
    count.textContent = `${rows.length} ${rows.length === 1 ? 'alimento' : 'alimentos'}${rows.length > 80 ? ' (se muestran 80: afina la búsqueda)' : ''}`;
    if (!rows.length) list.append(h('li', { class: 'muted empty' }, 'Sin resultados en tu documento'));
    for (const x of rows.slice(0, 80)) {
      const inc = ui.incompleteInfo(x);
      list.append(h('li', { class: 'food-row', 'data-id': x.id },
        h('div', { class: 'food-main' }, h('strong', {}, x.nombre), x.alias.length ? h('small', { class: 'muted' }, x.alias.slice(0, 3).join(' · ')) : null),
        h('div', { class: 'food-side' },
          typeof x.nutrients?.energia_kcal === 'number' ? h('span', { class: 'food-kcal' }, `${Math.round(x.nutrients.energia_kcal)} kcal`, h('small', { class: 'muted' }, '/100 g')) : h('span', { class: 'food-kcal muted' }, 'sin dato'),
          isExcluded(x) ? h('span', { class: 'food-tag' }, 'excluido') : inc ? h('span', { class: 'food-tag warn' }, 'pendiente de completar') : null)));
    }
  }
  fill();
  if (state.catFocus) { state.catFocus = false; queueMicrotask(() => { try { input.focus(); } catch { /* sin foco */ } }); }
  return h('main', { class: 'catalogo-lista' },
    ui.header('Mi catálogo', ui.back),
    h('div', { class: 'searchbar' }, icon(doc, 'search'), input),
    chips, count, list);
}
