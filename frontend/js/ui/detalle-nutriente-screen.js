// Detalle de un nutriente (al pulsar una fila del detalle de un alimento o del informe diario): tu rango de ese día frente a lo
// que aporta el alimento (o, desde el informe, lo que llevas ese día y qué alimentos lo aportaron), la información estática de
// data/nutrientes-info.json y los 5 alimentos de tu catálogo que más aportan.
// Solo presentación: las cuentas son de core/detalle.js; los enlaces se abren solo si los pulsas. Estilos en css/detalle.css.
import { AVISO_SANITARIO, SECCIONES_INFO, filasAlimento, rangoNutriente, referenciaDe, topCatalogo } from '../core/detalle.js';

// ui: { h, state, byId, header, fmtQty, nf0, nf1, catalog, objetivos (targetsForDate), objetivosTexto, targets, foods,
//       info (limpiarInfoNutrientes), etiquetaHoy, hoy(clave) -> { total, aporteOriginal } | null, back }
//   modo 'dia' (desde el informe): sin alimento; en su lugar filaDia (fila del informe), aportes (aportesDelDia), fechaTexto,
//   MEAL_LABEL, nf1 y abrirAlimento(aporte)
export function detalleNutrienteScreen(ui) {
  const { h, state } = ui;
  const d = state.detalle;
  const clave = d.nutriente;
  const dia = ui.modo === 'dia';
  const food = dia ? null : ui.byId().get(d.foodId);
  const fila = dia ? ui.filaDia : filasAlimento({ food, grams: d.gramos, objetivos: ui.objetivos.list, catalog: ui.catalog }).filas.get(clave);
  const hoy = dia ? null : ui.hoy?.(clave) ?? null;
  const referencia = referenciaDe(ui.targets, clave, ui.objetivos.perfil);
  const rango = rangoNutriente({ fila, hoy: hoy?.total ?? null, aporteOriginal: hoy?.aporteOriginal ?? null, referencia, etiquetaHoy: ui.etiquetaHoy, modo: dia ? 'dia' : 'alimento' });
  const quien = dia ? ui.etiquetaHoy : 'Este alimento'; // de quién es el valor que se compara con el rango
  const q = (v) => ui.fmtQty(v, fila.unit);

  // Barra con marcas: lo que llevas (gris), lo que aporta este alimento y una marca por cada valor del rango (las que valen lo
  // mismo comparten etiqueta). Las etiquetas cercanas se escalonan en dos niveles para que no se pisen. Superar el UL se dice
  // además con texto (nunca solo con el color).
  const barra = () => {
    // Sin ninguna referencia (ni objetivo, ni mín./máx., ni UL): el valor y «sin referencia», sin barra.
    if (rango.sinReferencia) {
      return h('div', { class: 'rango-sin-ref rango-leyenda small' },
        h('p', { class: 'ley ley-aporte' }, `${quien} · ${fila.total === null ? '—' : q(fila.total)}${rango.faltaPeso ? '' : ' · sin referencia'}`),
        rango.faltaPeso ? h('p', { class: 'muted small' }, 'sin referencia: falta tu peso en Objetivos') : null);
    }
    if (!rango.barra) return h('p', { class: 'muted small' }, 'Sin objetivo ni aporte que dibujar para este nutriente.');
    const orden = [...rango.marcas].sort((a, b) => a.pos - b.pos);
    let previa = -1; let nivel = 0;
    const niveles = new Map();
    for (const m of orden) { nivel = previa >= 0 && m.pos - previa < 0.22 ? 1 - nivel : 0; niveles.set(m.id, nivel); previa = m.pos; }
    const conPct = fila.pct !== null && fila.total !== null;
    const pct = conPct ? `${ui.nf0.format(fila.pct * 100)} % del objetivo` : fila.total === null ? 'sin dato' : q(fila.total);
    const resumen = dia ? `${fila.label}: ${ui.etiquetaHoy.toLowerCase()} ${fila.total === null ? 'sin dato' : q(fila.total)}${conPct ? ` · ${pct}` : ''}`
      : `${fila.label}: este alimento aporta ${fila.total === null ? 'sin dato' : q(fila.total)}${conPct ? ` · ${pct}` : ''}`;
    const otros = rango.barra.otros;
    return h('div', { class: 'rango-caja' },
      h('div', { class: 'rango-barra', role: 'img', 'aria-label': resumen },
        otros > 0 ? h('span', { class: 'rango-otros', style: `width:${(otros * 100).toFixed(2)}%` }) : null,
        rango.barra.aporte > 0 ? h('span', { class: `rango-aporte ${rango.barra.superaUl || ['excedido', 'por_encima'].includes(rango.barra.estado) ? 'sobre' : ''}`, style: `left:${(otros * 100).toFixed(2)}%;width:${(rango.barra.aporte * 100).toFixed(2)}%` }) : null,
        rango.marcas.map((m) => h('span', { class: `marca marca-${m.ids.includes('ul') ? 'ul' : m.id}${niveles.get(m.id) ? ' n2' : ''}`, style: `left:${(m.pos * 100).toFixed(2)}%` }, h('span', { class: 'marca-et' }, m.etiqueta)))),
      rango.barra.superaUl ? h('p', { class: 'ul-aviso', role: 'alert' }, `⚠ Supera el máximo tolerable (UL: ${q(fila.ul).replace(/ /g, ' ')})`) : null, // espacio duro: la cifra y la unidad no se separan al partir la línea
      h('div', { class: 'rango-leyenda small' },
        rango.leyenda.otros && otros > 0 ? h('p', { class: 'ley ley-otros' }, h('span', { class: 'punto', 'aria-hidden': 'true' }), rango.leyenda.otros.etiqueta) : null,
        h('p', { class: 'ley ley-aporte' }, h('span', { class: 'punto', 'aria-hidden': 'true' }), `${quien} · ${pct}`)));
  };

  const tabla = h('table', { class: 'rango-tabla' }, h('tbody', {}, rango.filas.map((r) => h('tr', { 'data-fila': r.id },
    h('th', { scope: 'row' }, r.etiqueta),
    h('td', {}, r.valor === null ? h('span', { 'aria-label': 'sin dato' }, '—') : q(r.valor), r.nota ? h('span', { class: 'muted small' }, ` (${r.nota})`) : null)))));
  // UL informativo (vitamina A, folato): se enseña con su nota, pero no avisa ni se compara con el total.
  const notaUl = fila.ulInformativo && fila.notaUl ? h('p', { class: 'muted small nota-ul-info' }, fila.notaUl) : null;

  const entrada = ui.info?.[clave];
  const seccion = (titulo, contenido) => h('section', { class: 'info-seccion' }, h('h2', { class: 'caps' }, titulo), h('div', { class: 'panel' }, contenido));
  const fuentes = (refs) => (refs?.length ? seccion('Fuentes consultadas', h('ul', { class: 'fuentes' }, refs.map((r) => h('li', {},
    h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, `${r.organismo ? `${r.organismo} · ` : ''}${r.titulo}`),
    r.consultado ? h('span', { class: 'muted small' }, ` (consultado: ${r.consultado})`) : null)))) : null);
  const textos = (e, prefijo = '') => SECCIONES_INFO.filter(([c]) => e[c]).map(([c, titulo]) => seccion(prefijo ? `${prefijo}: ${titulo}` : titulo, h('p', {}, e[c])));
  // Una suma (EPA + DHA) no tiene texto propio: se enseñan los de sus partes, cada sección con el nombre de la parte, y las fuentes una vez.
  const partes = !entrada && Array.isArray(fila.suma) ? fila.suma.map((k) => [(ui.catalog.byKey.get(k)?.label ?? k).replace(/\s*\(.*\)\s*$/, ''), ui.info?.[k]]).filter(([, e]) => e) : [];
  const informacion = entrada
    ? [textos(entrada), fuentes(entrada.referencias)]
    : partes.length
      ? [partes.map(([nombre, e]) => textos(e, nombre)),
        fuentes([...new Map(partes.flatMap(([, e]) => e.referencias ?? []).map((r) => [r.url, r])).values()])]
      : seccion('Información', h('p', { class: 'muted info-no-disponible' }, 'Información aún no disponible'));

  // «Qué te ha aportado hoy» (solo desde el informe): las líneas del día que aportan este nutriente, de más a menos, y al final las
  // que no tienen dato (no son 0). Cada una abre el detalle de su alimento con los gramos de esa línea.
  const aportes = () => {
    const { con, sin } = ui.aportes;
    const pctTxt = (p) => (p === null ? '' : ` (${p > 0 && p < 0.01 ? '<1' : ui.nf0.format(p * 100)} % del total del día)`);
    const item = (a, texto, clase) => {
      const li = h('li', { class: `aporte ${clase}`, 'data-id': a.foodId }, texto);
      if (a.abrible) li.append(h('button', { type: 'button', class: 'abre-detalle', 'aria-label': `Ver detalle de ${a.nombre}`, onclick: () => ui.abrirAlimento(a) }));
      return li;
    };
    const base = (a) => `${a.nombre} · ${ui.MEAL_LABEL[a.meal] ?? a.meal} · ${ui.nf1.format(a.grams)} g →`;
    return h('section', { class: 'aportes-dia', 'aria-label': ui.tituloAportes },
      h('h2', { class: 'caps' }, ui.tituloAportes),
      h('div', { class: 'panel' },
        con.length || sin.length ? h('ul', { class: 'top-lista aportes-lista' },
          con.map((a) => item(a, `${base(a)} ${q(a.valor)}${a.parcial ? ' (parcial)' : ''}${pctTxt(a.pct)}`, 'con-dato')),
          sin.map((a) => item(a, `${base(a)} sin dato`, 'sin-dato')))
          : h('p', { class: 'muted' }, 'Sin registros este día.')));
  };

  const objetivoDia = fila.objetivo ?? fila.valor ?? fila.min ?? fila.max;
  const top = topCatalogo({ foods: ui.foods, clave, suma: fila.suma ?? null, objetivo: objetivoDia });

  return h('main', { class: 'detalle-nutriente' },
    ui.header(fila.label, ui.back, { close: true, sub: dia ? ui.fechaTexto : food.nombre }),
    h('section', { class: 'panel rango', 'aria-label': 'Tu rango' },
      h('h2', { class: 'caps' }, 'Tu rango'),
      // una referencia que no es un objetivo (OMS, nórdica...) dice de quién es en vez de «Objetivos: referencias EFSA»; su nota va una sola vez
      fila.soloReferencia ? h('p', { class: 'muted small objetivos-dia nota-ref' }, fila.nota || 'Referencia: no es un objetivo de tu plan')
        : ui.objetivosTexto ? h('p', { class: 'muted small objetivos-dia' }, ui.objetivosTexto) : null,
      barra(), tabla, notaUl),
    dia ? aportes() : null,
    informacion,
    h('section', { class: 'catalogo-top', 'aria-label': 'En tu catálogo' },
      h('h2', { class: 'caps' }, 'En tu catálogo'),
      h('div', { class: 'panel' },
        top.length ? h('ul', { class: 'top-lista' }, top.map((t) => h('li', { 'data-id': t.id },
          `${t.nombre} · ración: ${ui.nf1.format(t.racion)} g → ${q(t.aporte)}${t.pct !== null ? ` (${ui.nf0.format(t.pct * 100)} % del objetivo)` : ''}`)))
          : h('p', { class: 'muted' }, 'Ningún alimento de tu documento aporta este nutriente.'))),
    h('p', { class: 'muted small aviso-sanitario' }, AVISO_SANITARIO));
}
