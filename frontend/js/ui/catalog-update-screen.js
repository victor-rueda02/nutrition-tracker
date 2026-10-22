// Pantalla "Actualizar documento": qué trae el foods.csv publicado (nuevos, actualizados, ya no publicados) y, si
// hay conflictos con lo que cambiaste desde la app, elegir antes de aplicar. Nada cambia hasta pulsar «Actualizar».
// Usa las clases globales (panel, card, chips); estilos propios en css/catalogo.css.
import { elegirAlimento, elegirTodos, eleccionAlimento } from '../core/catalog-update.js';

const valor = (campo, v) => {
  if (campo === 'extra:incluir') return String(v ?? '').trim().toLowerCase() === 'no' ? 'excluido (incluir=no)' : 'activado';
  return v === '' || v === null || v === undefined ? '(vacío)' : String(v).split('|').join(' | ');
};

// ui: { h, doc, state, header, render, applyCatalogUpdate, postponeCatalogUpdate, back }
export function catalogUpdateScreen(ui) {
  const { h, state } = ui;
  const { plan, remote, uso } = state.catUpdate;
  const lista = (titulo, items, texto) => (items.length ? h('details', { class: 'panel' }, h('summary', {}, `${titulo} (${items.length})`),
    h('ul', {}, items.map((i) => h('li', {}, texto(i))))) : null);
  const eleccion = (c) => state.catEleccion[`${c.id}|${c.campo}`] ?? 'mio';
  // Repinta sin que la pantalla salte: se recuerda el scroll y se devuelve tras pintar (los desplegables conservan su estado en state.catAbiertos).
  const repinta = () => { const sc = ui.doc?.scrollingElement; const y = sc?.scrollTop ?? 0; ui.render(); if (sc) sc.scrollTop = y; };
  const elegir = (c, que) => { state.catEleccion = { ...state.catEleccion, [`${c.id}|${c.campo}`]: que }; repinta(); };
  const elegirUno = (id, que) => { state.catEleccion = elegirAlimento(plan, state.catEleccion, id, que); repinta(); };
  const pedirTodos = (v) => { state.catConfirmarTodos = v; ui.render(); };
  const todosPublicado = () => { state.catEleccion = elegirTodos(plan, state.catEleccion, 'publicado'); state.catConfirmarTodos = false; ui.render(); };
  const conflictoCampo = (c) => h('li', { class: 'card conflicto', 'data-campo': c.campo },
    h('div', {}, h('strong', {}, c.nombre), ` · ${c.etiqueta}`),
    h('div', { class: 'chips', role: 'group', 'aria-label': `${c.nombre}: ${c.etiqueta}` },
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(eleccion(c) === 'mio'), onclick: () => elegir(c, 'mio') }, `Mío: ${valor(c.campo, c.mio)}`),
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(eleccion(c) === 'publicado'), onclick: () => elegir(c, 'publicado') }, `Publicado: ${valor(c.campo, c.publicado)}`)));
  const conflictoAlimento = (a) => {
    const campos = plan.conflictos.filter((c) => c.id === a.id);
    const marca = eleccionAlimento(plan, state.catEleccion, a.id);
    return h('li', { class: 'card conflicto-alimento', 'data-id': a.id },
      h('div', {}, h('strong', {}, a.nombre), ` · ${a.campos} ${a.campos === 1 ? 'campo' : 'campos'} en conflicto`),
      a.anadidoConIA ? h('p', { class: 'aviso-ia small' }, 'Este alimento lo añadiste con IA; el documento publicado trae datos revisados. Por eso viene elegido «Publicado».') : null,
      h('div', { class: 'chips', role: 'group', 'aria-label': `${a.nombre}: todo el alimento` },
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(marca === 'publicado'), onclick: () => elegirUno(a.id, 'publicado') }, 'Usar el publicado en todo el alimento'),
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(marca === 'mio'), onclick: () => elegirUno(a.id, 'mio') }, 'Mantener el mío en todo el alimento')),
      h('details', { class: 'campos', open: state.catAbiertos[a.id] ?? campos.length <= 3, ontoggle: (e) => { state.catAbiertos = { ...state.catAbiertos, [a.id]: e.target.open }; } },
        h('summary', {}, marca === 'mixto' ? 'Elegir campo a campo (mezcla de elecciones)' : 'Elegir campo a campo'),
        h('ul', { class: 'cards' }, campos.map(conflictoCampo))));
  };
  return h('main', { class: 'catalogo-update' },
    ui.header('Actualizar documento', ui.back),
    h('section', { class: 'panel' },
      h('p', {}, plan.nuevos.length || plan.actualizados.length || plan.conflictos.length
        ? `Hay una versión nueva de tu documento de alimentos publicado (${remote.foods.length} alimentos).`
        : `Tu documento de alimentos publicado (${remote.foods.length} alimentos) retira alimentos que aún tienes en este dispositivo.`),
      h('ul', { class: 'small resumen' },
        h('li', {}, `${plan.nuevos.length} nuevos`),
        h('li', {}, `${plan.actualizados.length} actualizados`),
        plan.eliminados?.length ? h('li', {}, `${plan.eliminados.length} ${plan.eliminados.length === 1 ? 'retirado: se elimina' : 'retirados: se eliminan'} (ver abajo)`) : null,
        plan.retirados.length ? h('li', {}, `${plan.retirados.length} ya no están publicados: se mantienen en tu dispositivo (pueden estar en tu diario)`) : null,
        plan.propios?.length ? h('li', {}, `${plan.propios.length} creados en este dispositivo (Estimar con IA, recetas): se mantienen`) : null,
        h('li', {}, plan.conflictos.length ? `${plan.conflictos.length} ${plan.conflictos.length === 1 ? 'conflicto' : 'conflictos'} en ${plan.alimentosConflicto.length} ${plan.alimentosConflicto.length === 1 ? 'alimento' : 'alimentos'}: elige abajo` : 'Sin conflictos: se conservan los cambios que hiciste desde la app')),
      h('p', { class: 'muted small' }, 'Nada cambia hasta que pulses «Actualizar». Tu diario no se toca.')),
    plan.eliminados?.length ? h('section', { class: 'panel aviso-retirados', 'aria-label': 'Alimentos retirados' },
      h('h2', {}, `Se eliminarán ${plan.eliminados.length} ${plan.eliminados.length === 1 ? 'alimento retirado' : 'alimentos retirados'} del documento`),
      h('p', { class: 'retirados-nombres' }, `${plan.eliminados.map((e) => e.nombre).join(', ')}.`),
      h('p', { class: 'muted small' }, 'Los has pedido retirar (data/retirados.json). Se borran de este dispositivo aunque los hubieras cambiado; no se aplica hasta pulsar «Actualizar».'),
      uso?.lineas ? h('p', { class: 'aviso-uso small', role: 'note' }, `Hay ${uso.lineas} ${uso.lineas === 1 ? 'línea' : 'líneas'} del diario que ${uso.lineas === 1 ? 'usa' : 'usan'} alimentos retirados; seguirán en el diario como «alimento borrado».`) : null,
      ...(uso?.recetas ?? []).map((r) => h('p', { class: 'aviso-uso small', role: 'note' }, `La receta «${r.nombre}» usa ${r.ingredientes.length === 1 ? 'un alimento retirado' : 'alimentos retirados'} (${r.ingredientes.join(', ')}); no se borra: revísala en Recetas.`))) : null,
    lista('Nuevos', plan.nuevos, (i) => i.nombre),
    lista('Actualizados', plan.actualizados, (i) => `${i.nombre}: ${i.campos.join(', ')}`),
    lista('Ya no publicados (se mantienen)', plan.retirados, (i) => i.nombre),
    plan.conflictos.length ? h('section', { class: 'conflictos' },
      h('h2', {}, 'Conflictos'),
      h('p', { class: 'muted small' }, 'Cambiaste lo mismo que el documento publicado. Elige qué te quedas en cada alimento o campo a campo; por defecto, lo tuyo (salvo en los alimentos que añadiste con IA).'),
      state.catConfirmarTodos
        ? h('div', { class: 'panel confirm-delete', role: 'alertdialog', 'aria-label': 'Confirmar' },
          h('p', {}, `¿Usar el publicado en los ${plan.conflictos.length} campos en conflicto de ${plan.alimentosConflicto.length} ${plan.alimentosConflicto.length === 1 ? 'alimento' : 'alimentos'}? Se sustituirán tus valores (no se aplica hasta pulsar «Actualizar»).`),
          h('div', { class: 'row' },
            h('button', { class: 'danger', onclick: todosPublicado }, 'Sí, usar el publicado en todos'),
            h('button', { class: 'secondary', onclick: () => pedirTodos(false) }, 'Cancelar')))
        : h('button', { class: 'secondary', onclick: () => pedirTodos(true) }, 'Usar el publicado en todos'),
      h('ul', { class: 'cards' }, plan.alimentosConflicto.map(conflictoAlimento))) : null,
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => ui.applyCatalogUpdate() }, 'Actualizar'),
      h('button', { class: 'secondary', onclick: () => ui.postponeCatalogUpdate() }, 'Ahora no')));
}
