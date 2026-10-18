// Pantalla "Frases a revisar": dictados con líneas problemáticas (no reconocido, confianza baja, "no coincide con tus
// alias") y cómo se resolvieron, para añadir alias o alimentos al documento. Todo local. Usa las clases globales.
import { TIPOS } from '../core/phrase-log.js';

const fmtFecha = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ui: { h, state, byId, header, MOTIVO_TEXT, render, removeLogEntry, clearLog, exportLog, back }
export function phraseLogScreen(ui) {
  const { h, state } = ui;
  const nombre = (id) => ui.byId().get(id)?.nombre ?? id;
  const resolucion = (p) => (p.resolucion === null ? 'sin guardar' : p.resolucion === 'descartado' ? 'descartado' : `→ ${nombre(p.resolucion)}`);
  const vaciar = state.pendingDelete !== 'registro'
    ? h('button', { class: 'link danger', disabled: !state.registro.length, onclick: () => { state.pendingDelete = 'registro'; ui.render(); } }, 'Vaciar')
    : h('span', { class: 'confirm-delete', role: 'group', 'aria-label': 'Confirmar borrado' },
      h('span', { class: 'small' }, '¿Vaciar todo el registro? '),
      h('button', { class: 'danger', onclick: () => ui.clearLog() }, 'Sí, vaciar'),
      h('button', { class: 'link', onclick: () => { state.pendingDelete = null; ui.render(); } }, 'Cancelar'));
  return h('main', {},
    ui.header('Frases a revisar', ui.back),
    h('p', { class: 'muted small' }, 'Dictados con alimentos no reconocidos, de confianza baja o que no coinciden con tus alias, y lo que elegiste al final. Sirve para añadir alias o alimentos a tu documento. Solo se guarda en este dispositivo.'),
    state.logMsg ? h('p', { class: 'ok', role: 'status' }, state.logMsg) : null,
    h('div', { class: 'row wrap' }, h('button', { class: 'secondary', disabled: !state.registro.length, onclick: () => ui.exportLog() }, 'Exportar (CSV)'), vaciar),
    state.registro.length === 0 ? h('p', { class: 'muted' }, 'No hay frases pendientes de revisar.') : h('ul', { class: 'cards' }, state.registro.map((e) => h('li', { class: 'card frase', 'data-id': e.id },
      h('div', { class: 'row between' }, h('span', { class: 'muted small' }, fmtFecha.format(new Date(e.fecha))), h('button', { class: 'link', onclick: () => ui.removeLogEntry(e.id) }, 'Quitar')),
      h('div', {}, `«${e.texto}»`),
      h('ul', { class: 'lines' }, e.problemas.map((p) => h('li', {},
        `«${p.texto}» · ${TIPOS[p.tipo]}${p.motivo ? ` (${ui.MOTIVO_TEXT[p.motivo] ?? p.motivo})` : ''}${p.food_id ? ` · la IA: ${nombre(p.food_id)}` : ''} · ${resolucion(p)}`)))))));
}
