// Informe diario (detrás de los tres puntos del Diario): kcal y macros con anillos, objetivo de energía, todos los nutrientes
// con barras y % de objetivo, avisos de UL y comidas del día. Solo presentación: los números vienen de core/diary.js.
// También exporta ring() y energySummary(), que usa el Diario. Estilos en css/navegacion.css.
import { gruposInforme } from '../core/detalle.js';

const KCAL_POR_G = { proteina_g: 4, hidratos_g: 4, grasa_total_g: 9 };
const MACRO_NOMBRE = { proteina_g: 'Proteína', hidratos_g: 'Hidratos', grasa_total_g: 'Grasa' };
const MACRO_VAR = { proteina_g: 'var(--c-proteina)', hidratos_g: 'var(--c-hidratos)', grasa_total_g: 'var(--c-grasa)' };

// Anillo hecho con conic-gradient (sin dependencias): segmentos [{ color, frac }] sobre el fondo --track.
export function ring({ h, segments, value, unit = 'kcal', label, alert = false }) {
  let acc = 0;
  const stops = [];
  for (const s of segments) {
    const a = acc; acc = Math.min(1, acc + Math.max(0, s.frac));
    if (acc > a) stops.push(`${s.color} ${(a * 100).toFixed(2)}% ${(acc * 100).toFixed(2)}%`);
  }
  stops.push(`var(--track) ${(acc * 100).toFixed(2)}% 100%`);
  return h('div', { class: 'ring-box' },
    h('div', { class: 'ring', role: 'img', 'aria-label': `${label}: ${value} ${unit}`, style: `background:conic-gradient(from 0deg, ${stops.join(', ')})` },
      h('div', { class: 'ring-in' }, h('strong', {}, value), h('span', {}, unit))),
    h('div', { class: alert ? 'ring-label alert' : 'ring-label' }, label, alert ? h('span', { class: 'ring-warn', 'aria-hidden': 'true' }, '!') : null));
}

// Datos de energía del día: consumido, objetivo, diferencia y kcal por macro. Sin dato = null (nunca 0).
export function energyData(rep) {
  const row = (k) => rep.rows.find((r) => r.clave === k);
  const e = row('energia_kcal');
  const consumido = e?.total ?? null;
  const objetivo = e ? (e.valor ?? e.objetivo ?? e.max ?? e.min ?? null) : null;
  const macros = Object.keys(KCAL_POR_G).map((k) => {
    const g = row(k)?.total ?? null;
    return { clave: k, nombre: MACRO_NOMBRE[k], g, kcal: g === null ? null : g * KCAL_POR_G[k], color: MACRO_VAR[k] };
  });
  const suma = macros.reduce((a, m) => a + (m.kcal ?? 0), 0);
  macros.forEach((m) => { m.frac = m.kcal !== null && suma > 0 ? m.kcal / suma : 0; });
  return { consumido, objetivo, macros, parcial: Boolean(e?.parcial), resto: consumido !== null && objetivo ? objetivo - consumido : null };
}

// Tres anillos del Diario: Consumido (por macro), Objetivo y Restante/Excedido.
export function energySummary(ui, rep) {
  const { h, nf0 } = ui;
  const d = energyData(rep);
  const consumido = ring({ h, segments: d.macros.map((m) => ({ color: m.color, frac: m.frac })), value: d.consumido === null ? '—' : nf0.format(d.consumido), label: d.parcial && d.consumido !== null ? 'Consumido (parcial)' : 'Consumido' });
  const objetivo = ring({ h, segments: d.objetivo ? [{ color: 'var(--ring-obj)', frac: 1 }] : [], value: d.objetivo ? nf0.format(d.objetivo) : '—', label: 'Objetivo' });
  const pasado = d.resto !== null && d.resto < 0;
  const restante = d.resto === null ? ring({ h, segments: [], value: '—', label: 'Restante' })
    : ring({ h, segments: [{ color: pasado ? 'var(--bar-over)' : 'var(--c-energia)', frac: pasado ? 1 : Math.min(1, d.consumido / d.objetivo) }], value: nf0.format(Math.abs(d.resto)), label: pasado ? 'Excedido' : 'Restante', alert: pasado });
  return h('div', { class: 'rings' }, consumido, objetivo, restante);
}

// Aviso de totales parciales (lógica en core/parciales.js). En el Diario, una línea por gravedad: el importante en negrita
// y con --warn, el menor discreto; si el resumen no lo dice todo, la línea abre el detalle agrupado (<details>).
const prefijo = (a) => (a.nivel === 'importante' ? 'Importante:' : null);
export function parcialesDiario(ui, aviso) {
  const { h } = ui;
  return [aviso?.importante, aviso?.menor].filter(Boolean).map((a) => {
    const clase = `${a.nivel === 'importante' ? 'warn' : 'muted'} small parciales ${a.nivel}`;
    const texto = a.nivel === 'importante' ? [h('strong', {}, prefijo(a)), a.resumen.slice(prefijo(a).length)] : a.resumen;
    if (a.completo) return h('p', { class: clase }, texto);
    return h('details', { class: clase }, h('summary', {}, texto), h('ul', {}, a.grupos.map((g) => h('li', {}, `${g.texto}.`))));
  });
}

// Informe diario: todo el detalle, agrupado por gravedad.
export function parcialesInforme(ui, aviso) {
  const { h } = ui;
  if (!aviso) return null;
  const bloque = (a, titulo) => a && h('div', { class: `parciales ${a.nivel}` },
    h('p', { class: a.nivel === 'importante' ? 'warn' : 'muted small' }, h('strong', {}, titulo)),
    h('ul', { class: a.nivel === 'importante' ? 'warn' : 'muted small' }, a.grupos.map((g) => h('li', {}, `${g.texto}.`))));
  return h('section', { class: 'panel parciales-informe', 'aria-label': 'Totales parciales' },
    h('h2', {}, 'Totales parciales'),
    bloque(aviso.importante, 'Importante: afecta a kcal o a proteína, hidratos o grasa'),
    bloque(aviso.menor, 'Menor: no afecta a kcal ni a proteína, hidratos o grasa'));
}

// ui: { h, state, deps, rep, obj, MACROS, MEAL_LABEL, nf0, fmtQty, fmtKcal, nutrientRow, dayLabel, header, back }
export function reportScreen(ui) {
  const { h, rep, nf0 } = ui;
  const d = energyData(rep);
  const macroFilas = rep.rows.filter((r) => ui.MACROS.includes(r.clave));
  // Todos los demás nutrientes del catálogo, en sus grupos (los mismos del detalle de un alimento); sin referencia, solo el valor.
  const grupos = gruposInforme({ rep, catalog: ui.deps.catalog, excluir: new Set(ui.MACROS) });
  const total = d.macros.reduce((a, m) => a + (m.kcal ?? 0), 0);
  const fila = (nombre, valor, { fuerte = false, aviso = false } = {}) => h('li', { class: `kv${fuerte ? ' strong' : ''}` }, h('span', {}, nombre), h('span', { class: aviso ? 'warn' : null }, valor));
  const energia = d.objetivo
    ? h('section', { class: 'panel' },
      h('div', { class: 'ring-row' },
        h('h2', {}, d.resto !== null && d.resto < 0 ? 'Excedido' : 'Restante'),
        ring({ h, segments: d.resto === null ? [] : [{ color: d.resto < 0 ? 'var(--bar-over)' : 'var(--c-energia)', frac: d.resto < 0 ? 1 : Math.min(1, d.consumido / d.objetivo) }], value: d.resto === null ? '—' : nf0.format(Math.abs(d.resto)), label: '' })),
      h('ul', { class: 'kvs' },
        fila('Objetivo de energía', `${nf0.format(d.objetivo)} kcal`, { fuerte: true }),
        fila('Consumido', d.consumido === null ? 'sin dato' : `− ${nf0.format(d.consumido)} kcal${d.parcial ? ' (parcial)' : ''}`),
        fila(d.resto !== null && d.resto < 0 ? 'Excedido' : 'Restante', d.resto === null ? 'sin dato' : `${nf0.format(Math.abs(d.resto))} kcal`, { fuerte: true })))
    : null;
  return h('main', { class: 'informe' },
    ui.header('Informe diario', ui.back),
    h('p', { class: 'informe-fecha' }, ui.dayLabel(ui.state.day)),
    h('p', { class: 'muted small objetivos-dia' }, ui.objetivosTexto),
    rep.avisosUl.length ? h('section', { class: 'alert-ul alert-strip', role: 'alert' }, h('strong', {}, '⚠ Máximo tolerable (UL) superado: '),
      rep.avisosUl.map((r) => `${r.label} ${ui.fmtQty(r.total, r.unit)} (UL ${ui.fmtQty(r.ul, r.unit)})`).join(' · ')) : null,
    rep.sinDatos.length ? h('p', { class: 'warn small', role: 'alert' }, `Sin datos nutricionales: ${rep.sinDatos.join(', ')}. Los totales de este día no incluyen su aporte y no son completos.`) : null,
    parcialesInforme(ui, ui.parciales),
    ui.state.dayMeals.length === 0 ? h('p', { class: 'muted' }, 'Sin registros este día.') : [
      h('section', { class: 'panel consumido' },
        h('div', { class: 'ring-row' },
          h('h2', {}, 'Consumido'),
          ring({ h, segments: d.macros.map((m) => ({ color: m.color, frac: m.frac })), value: d.consumido === null ? '—' : nf0.format(d.consumido), label: d.parcial ? 'Parcial' : '' })),
        h('ul', { class: 'legend' }, d.macros.map((m) => h('li', {},
          h('span', { class: 'dot', style: `background:${m.color}` }), h('strong', {}, m.nombre), h('span', { class: 'muted' }, m.kcal === null ? 'sin dato' : `${nf0.format(m.kcal)} kcal`),
          h('span', { class: 'legend-pct' }, m.kcal === null || !total ? '' : `${nf0.format((m.kcal / total) * 100)} %`))))),
      energia,
      h('details', { class: 'panel plegable', open: true }, h('summary', {}, h('h2', {}, 'Objetivos de macronutrientes')), h('ul', { class: 'nuts' }, macroFilas.map(ui.nutrientRow))),
      h('details', { class: 'panel plegable', open: true }, h('summary', {}, h('h2', {}, 'Resto de nutrientes')),
        grupos.map((g) => h('div', { class: 'grupo', 'data-grupo': g.id }, h('h3', {}, g.titulo), h('ul', { class: 'nuts' }, g.filas.map(ui.nutrientRow))))),
      h('section', { class: 'panel' }, h('h2', {}, 'Comidas del día'),
        h('ul', { class: 'kvs' }, rep.comidas.map((c) => fila(ui.MEAL_LABEL[c.meal], ui.fmtKcal(c)))))]);
}
