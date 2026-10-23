// Detalle de un alimento (desde Alimentos → Mi catálogo o desde una línea del Diario): cantidad editable, de dónde salen los
// datos, resumen de energía y macros y todos los nutrientes con % del objetivo de ese día. Solo presentación: las cuentas son
// de core/detalle.js y core/nutrients.js; app.js decide las acciones. Estilos en css/detalle.css.
import { MAX_GRAMS } from '../core/ai-contract.js';
import { AVISO_SANITARIO, opcionesPorcion, gramosDeCantidad, cantidadDeGramos, filasAlimento, fuenteDe, completitudDe } from '../core/detalle.js';

// Fila sin barra: nutriente sin dato («—», nunca 0) o sin objetivo ese día. Un 0 escrito se muestra como 0.
function filaSimple(ui, r) {
  const { h } = ui;
  const sinDato = r.total === null;
  return h('li', { class: `nut nut-simple${sinDato ? ' sin-dato' : ''}`, 'data-clave': r.clave },
    // el valor va en la misma columna (borde derecho) que el % de las filas con barra
    h('div', { class: 'row between nut-head' },
      h('span', { class: 'nut-main' }, h('span', { class: 'nut-label' }, r.label)),
      h('span', { class: 'nut-pct nut-simple-valor' }, h('span', { class: 'nut-valor' }, sinDato ? h('span', { 'aria-label': 'sin dato' }, '—') : ui.fmtQty(r.total, r.unit)))));
}

// ui: { h, doc, state, byId, header, nutrientRow, fmtQty, nf1, required, threshold, catalog, objetivos (targetsForDate), objetivosTexto,
//       foods (documento, para ocultar lo que no tiene objetivo ni dato en ningún alimento), origenTexto, guardar(gramos), abrirNutriente(clave), back }
export function detalleAlimentoScreen(ui) {
  const { h, state } = ui;
  const d = state.detalle;
  const food = ui.byId().get(d.foodId);
  const delDiario = d.origen === 'diary';
  const opciones = delDiario ? [{ id: 'g', etiqueta: 'g', gramos: 1 }] : opcionesPorcion(food);
  const opcion = () => opciones.find((o) => o.id === d.porcion) ?? opciones[0];

  const input = h('input', { type: 'text', inputmode: 'decimal', class: 'grams detalle-cantidad', 'aria-label': `Cantidad de ${food.nombre}`, value: d.cantidad, autocomplete: 'off' });
  const selector = opciones.length > 1 ? h('select', { class: 'detalle-porcion', 'aria-label': 'Tamaño de la porción',
    onchange: (e) => {
      // A una porción: 1 de ellas. De vuelta a «g»: los gramos que había.
      const g = gramosDeCantidad(d.cantidad, opcion());
      d.porcion = e.target.value;
      if (d.porcion !== 'g') d.cantidad = '1'; else if (g !== null) d.cantidad = cantidadDeGramos(g);
      input.value = d.cantidad;
      pintar();
    } }, opciones.map((o) => h('option', { value: o.id, selected: o.id === d.porcion }, o.etiqueta))) : null;
  const cuerpo = h('div', { class: 'detalle-cuerpo' });
  const aviso = h('p', { class: 'error small', role: 'alert', hidden: true });
  const main = h('main', { class: 'detalle' });
  let pie = null;

  function pintar() {
    const gramos = gramosDeCantidad(d.cantidad, opcion());
    const mal = gramos === null ? 'Escribe una cantidad mayor que 0.' : delDiario && gramos > MAX_GRAMS ? `Más de ${MAX_GRAMS} g: cámbialo desde «Editar», donde se confirma.` : '';
    aviso.hidden = !mal; aviso.textContent = mal;
    cuerpo.classList.toggle('obsoleto', gramos === null); // con una cantidad no válida se queda lo último calculado, atenuado
    if (gramos !== null) { d.gramos = gramos; cuerpo.replaceChildren(...contenido(gramos)); } // d.gramos: lo usa el detalle de nutriente
    const cambiado = delDiario && gramos !== null && !mal && Math.abs(gramos - d.grams0) > 1e-9;
    if (cambiado && !pie) {
      pie = h('footer', { class: 'bar' }, h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => ui.guardar(gramosDeCantidad(d.cantidad, opcion())) }, 'Guardar')));
      main.append(pie);
    } else if (!cambiado && pie) { pie.remove(); pie = null; }
  }

  function contenido(gramos) {
    const { resumen, grupos } = filasAlimento({ food, grams: gramos, objetivos: ui.objetivos.list, catalog: ui.catalog, foods: ui.foods });
    const fila = (r) => {
      const li = r.pct !== null && r.total !== null ? ui.nutrientRow(r) : filaSimple(ui, r);
      if (r.sub) li.classList.add('sub'); // subpartida: sangría y peso normal
      li.append(h('button', { type: 'button', class: 'abre-detalle', 'aria-label': `Ver detalle de ${r.label}`, onclick: () => ui.abrirNutriente(r.clave) }));
      return li;
    };
    // Secciones plegables como las del informe diario (abiertas por defecto); lo que cierres se recuerda mientras escribes.
    const plegable = (id, clase, titulo, hijos) => {
      const det = h('details', { class: clase, open: d.plegados[id] !== false }, h('summary', {}, titulo), hijos);
      det.addEventListener('toggle', () => { d.plegados[id] = det.open; });
      return det;
    };
    const fuente = fuenteDe(food);
    const comp = completitudDe(food, ui.required);
    const incompleto = comp.total > 0 && comp.filled / comp.total + 1e-9 < ui.threshold;
    return [
      h('section', { class: 'detalle-info', 'aria-label': 'Información nutricional' },
        h('p', { class: 'detalle-por' }, h('strong', {}, `Información nutricional por ${ui.nf1.format(gramos)} g`)),
        h('p', { class: 'muted small detalle-fuente' }, `Fuente de datos: ${fuente.corto}`),
        h('p', { class: `small detalle-comp${incompleto ? ' warn' : ' muted'}` }, `${comp.filled}/${comp.total} nutrientes obligatorios con dato${incompleto ? ' · pendiente de completar' : ''}`),
        fuente.completo ? h('details', { class: 'detalle-fuente-completa' }, h('summary', {}, 'Fuente completa'), h('p', { class: 'small muted' }, fuente.completo)) : null),
      plegable('resumen', 'panel plegable detalle-resumen', h('h2', {}, 'Resumen de energía y macros'), h('ul', { class: 'nuts' }, resumen.map(fila))),
      plegable('todos', 'panel plegable detalle-todos', h('h2', {}, 'Todos los nutrientes'),
        grupos.map((g) => { const det = plegable(`grupo-${g.id}`, 'grupo', h('h3', {}, g.titulo), h('ul', { class: 'nuts' }, g.filas.map(fila))); det.dataset.grupo = g.id; return det; })),
      ui.objetivosTexto ? h('p', { class: 'muted small objetivos-dia' }, ui.objetivosTexto) : null,
      h('p', { class: 'muted small aviso-sanitario' }, AVISO_SANITARIO),
    ];
  }

  input.addEventListener('input', (e) => { d.cantidad = e.target.value; pintar(); });
  main.append(
    ui.header(food.nombre, ui.back, { close: true, sub: ui.origenTexto ?? '', bloque: true }),
    h('section', { class: 'panel detalle-cantidad-panel' },
      h('label', { class: 'detalle-campo' }, h('span', {}, delDiario ? 'Cantidad (g)' : 'Cantidad'), input),
      selector ? h('label', { class: 'detalle-campo' }, h('span', {}, 'Tamaño de la porción'), selector) : null,
      aviso),
    cuerpo);
  pintar();
  return main;
}
