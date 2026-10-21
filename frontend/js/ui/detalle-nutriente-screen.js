// Detalle de un nutriente (al pulsar una fila del detalle de un alimento): tu rango de ese día frente a lo que aporta el
// alimento, la información estática de data/nutrientes-info.json y los 5 alimentos de tu catálogo que más aportan.
// Solo presentación: las cuentas son de core/detalle.js; los enlaces se abren solo si los pulsas. Estilos en css/detalle.css.
import { AVISO_SANITARIO, SECCIONES_INFO, filasAlimento, rangoNutriente, referenciaDe, topCatalogo } from '../core/detalle.js';

// ui: { h, state, byId, header, fmtQty, nf0, nf1, catalog, objetivos (targetsForDate), objetivosTexto, targets, foods,
//       info (limpiarInfoNutrientes), etiquetaHoy, hoy(clave) -> { total, aporteOriginal } | null, back }
export function detalleNutrienteScreen(ui) {
  const { h, state } = ui;
  const d = state.detalle;
  const clave = d.nutriente;
  const food = ui.byId().get(d.foodId);
  const fila = filasAlimento({ food, grams: d.gramos, objetivos: ui.objetivos.list, catalog: ui.catalog }).filas.get(clave);
  const hoy = ui.hoy?.(clave) ?? null;
  const referencia = referenciaDe(ui.targets, clave, ui.objetivos.perfil);
  const rango = rangoNutriente({ fila, hoy: hoy?.total ?? null, aporteOriginal: hoy?.aporteOriginal ?? null, referencia, etiquetaHoy: ui.etiquetaHoy });
  const q = (v) => ui.fmtQty(v, fila.unit);

  // Barra con marcas: lo que llevas (gris), lo que aporta este alimento y una marca por cada valor del rango (las que valen lo
  // mismo comparten etiqueta). Las etiquetas cercanas se escalonan en dos niveles para que no se pisen. Superar el UL se dice
  // además con texto (nunca solo con el color).
  const barra = () => {
    if (!rango.barra) return h('p', { class: 'muted small' }, 'Sin objetivo ni aporte que dibujar para este nutriente.');
    const orden = [...rango.marcas].sort((a, b) => a.pos - b.pos);
    let previa = -1; let nivel = 0;
    const niveles = new Map();
    for (const m of orden) { nivel = previa >= 0 && m.pos - previa < 0.22 ? 1 - nivel : 0; niveles.set(m.id, nivel); previa = m.pos; }
    const conPct = fila.pct !== null && fila.total !== null;
    const pct = conPct ? `${ui.nf0.format(fila.pct * 100)} % del objetivo` : fila.total === null ? 'sin dato' : q(fila.total);
    const resumen = `${fila.label}: este alimento aporta ${fila.total === null ? 'sin dato' : q(fila.total)}${conPct ? ` · ${pct}` : ''}`;
    const otros = rango.barra.otros;
    return h('div', { class: 'rango-caja' },
      h('div', { class: 'rango-barra', role: 'img', 'aria-label': resumen },
        otros > 0 ? h('span', { class: 'rango-otros', style: `width:${(otros * 100).toFixed(2)}%` }) : null,
        rango.barra.aporte > 0 ? h('span', { class: `rango-aporte ${rango.barra.superaUl || ['excedido', 'por_encima'].includes(rango.barra.estado) ? 'sobre' : ''}`, style: `left:${(otros * 100).toFixed(2)}%;width:${(rango.barra.aporte * 100).toFixed(2)}%` }) : null,
        rango.marcas.map((m) => h('span', { class: `marca marca-${m.ids.includes('ul') ? 'ul' : m.id}${niveles.get(m.id) ? ' n2' : ''}`, style: `left:${(m.pos * 100).toFixed(2)}%` }, h('span', { class: 'marca-et' }, m.etiqueta)))),
      rango.barra.superaUl ? h('p', { class: 'ul-aviso', role: 'alert' }, `⚠ Supera el máximo tolerable (UL: ${q(fila.ul)})`) : null,
      h('div', { class: 'rango-leyenda small' },
        rango.leyenda.otros && otros > 0 ? h('p', { class: 'ley ley-otros' }, h('span', { class: 'punto', 'aria-hidden': 'true' }), rango.leyenda.otros.etiqueta) : null,
        h('p', { class: 'ley ley-aporte' }, h('span', { class: 'punto', 'aria-hidden': 'true' }), `Este alimento · ${pct}`)));
  };

  const tabla = h('table', { class: 'rango-tabla' }, h('tbody', {}, rango.filas.map((r) => h('tr', { 'data-fila': r.id },
    h('th', { scope: 'row' }, r.etiqueta),
    h('td', {}, r.valor === null ? h('span', { 'aria-label': 'sin dato' }, '—') : q(r.valor), r.nota ? h('span', { class: 'muted small' }, ` (${r.nota})`) : null)))));

  const entrada = ui.info?.[clave];
  const seccion = (titulo, contenido) => h('section', { class: 'info-seccion' }, h('h2', { class: 'caps' }, titulo), h('div', { class: 'panel' }, contenido));
  const informacion = entrada
    ? [SECCIONES_INFO.filter(([c]) => entrada[c]).map(([c, titulo]) => seccion(titulo, h('p', {}, entrada[c]))),
      entrada.referencias?.length ? seccion('Fuentes consultadas', h('ul', { class: 'fuentes' }, entrada.referencias.map((r) => h('li', {},
        h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, `${r.organismo ? `${r.organismo} · ` : ''}${r.titulo}`),
        r.consultado ? h('span', { class: 'muted small' }, ` (consultado: ${r.consultado})`) : null)))) : null]
    : seccion('Información', h('p', { class: 'muted info-no-disponible' }, 'Información aún no disponible'));

  const objetivoDia = fila.objetivo ?? fila.valor ?? fila.min ?? fila.max;
  const top = topCatalogo({ foods: ui.foods, clave, suma: fila.suma ?? null, objetivo: objetivoDia });

  return h('main', { class: 'detalle-nutriente' },
    ui.header(fila.label, ui.back, { close: true, sub: food.nombre }),
    h('section', { class: 'panel rango', 'aria-label': 'Tu rango' },
      h('h2', { class: 'caps' }, 'Tu rango'),
      ui.objetivosTexto ? h('p', { class: 'muted small objetivos-dia' }, ui.objetivosTexto) : null,
      barra(), tabla),
    informacion,
    h('section', { class: 'catalogo-top', 'aria-label': 'En tu catálogo' },
      h('h2', { class: 'caps' }, 'En tu catálogo'),
      h('div', { class: 'panel' },
        top.length ? h('ul', { class: 'top-lista' }, top.map((t) => h('li', { 'data-id': t.id },
          `${t.nombre} · ración: ${ui.nf1.format(t.racion)} g → ${q(t.aporte)}${t.pct !== null ? ` (${ui.nf0.format(t.pct * 100)} % del objetivo)` : ''}`)))
          : h('p', { class: 'muted' }, 'Ningún alimento de tu documento aporta este nutriente.'))),
    h('p', { class: 'muted small aviso-sanitario' }, AVISO_SANITARIO));
}
