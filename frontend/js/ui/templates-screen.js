// Pantalla "Plantillas": lista de comidas guardadas con nombre; «Usar» abre la pantalla Repetir con la plantilla
// (para ajustar gramos, fecha y comida) y «Borrar» pide confirmación dentro de la app. Usa las clases globales.
import { nutrientsForGrams } from '../core/nutrients.js';

// ui: { h, state, byId, header, nf0, nf1, MEAL_LABEL, useTemplate, deleteTemplate, back }
export function templatesScreen(ui) {
  const { h, state } = ui;
  const kcalDe = (t) => {
    const kcal = t.lines.map((l) => (ui.byId().has(l.food_id) ? nutrientsForGrams(ui.byId().get(l.food_id), l.grams, ['energia_kcal']).energia_kcal : null));
    const con = kcal.filter((k) => k !== null);
    return con.length ? `${ui.nf0.format(con.reduce((a, k) => a + k, 0))} kcal${con.length < kcal.length ? ' (parcial)' : ''}` : 'sin dato de kcal';
  };
  const borrar = (t) => (state.pendingDelete !== t.id
    ? h('button', { class: 'link danger', onclick: () => { state.pendingDelete = t.id; ui.render(); } }, 'Borrar')
    : h('span', { class: 'confirm-delete', role: 'group', 'aria-label': 'Confirmar borrado' },
      h('span', { class: 'small' }, '¿Borrar esta plantilla? '),
      h('button', { class: 'danger', onclick: () => ui.deleteTemplate(t.id) }, 'Sí, borrar'),
      h('button', { class: 'link', onclick: () => { state.pendingDelete = null; ui.render(); } }, 'Cancelar')));
  return h('main', {},
    ui.header('Plantillas', ui.back),
    state.plantillasMsg ? h('p', { class: 'ok', role: 'status' }, state.plantillasMsg) : null,
    state.plantillas.length === 0
      ? h('p', { class: 'muted' }, 'Aún no tienes plantillas. En el Diario, pulsa «Guardar como plantilla» en cualquier comida.')
      : h('ul', { class: 'cards' }, state.plantillas.map((t) => h('li', { class: 'card plantilla', 'data-id': t.id },
        h('div', { class: 'row between' }, h('strong', {}, t.nombre), h('span', { class: 'muted small' }, `${ui.MEAL_LABEL[t.meal]} · ${kcalDe(t)}`)),
        h('ul', { class: 'lines' }, t.lines.map((l) => h('li', {}, `${ui.byId().get(l.food_id)?.nombre ?? l.food_id} · ${ui.nf1.format(l.grams)} g`))),
        h('div', { class: 'row between' }, h('button', { class: 'secondary', onclick: () => ui.useTemplate(t) }, 'Usar'), borrar(t))))));
}
