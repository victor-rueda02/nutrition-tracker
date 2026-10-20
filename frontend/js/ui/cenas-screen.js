// ¿Qué ceno?: pantalla del Diario (para el día que se mira) con lo que falta del día y 3 cenas propuestas por
// core/cenas.js, calculadas con tu documento y sin gastar IA. «Añadir a la cena» abre la confirmación editable de siempre;
// «Más ideas» es la única llamada a la IA (una por pulsación). Estilos propios en css/cenas.css.
import { buildCompactList } from '../core/ai-contract.js';
import { draftFromLines } from '../core/draft.js';
import { foodSinDatos } from '../core/completeness.js';
import { proponerCenas, deficitsParaIA, textoDescartados, rolesDe } from '../core/cenas.js';
import { normalizeCenas } from '../core/cenas-validate.js';
import { nutrientsForGrams } from '../core/nutrients.js';

// ctx: { state, deps, track, render, byId, targetsFor, today, loadTemplates, recetasTodas }
export function cenasActions(ctx) {
  const { state, deps } = ctx;
  const calcular = (ideasIA = []) => proponerCenas({
    ...state.cenas.entrada, foodsById: ctx.byId(), objetivos: ctx.targetsFor(state.cenas.fecha), catalog: deps.catalog, settings: deps.settings, hoy: ctx.today(), ideasIA,
  });

  // Abre la pantalla para un día (el que muestra el Diario). Todo se calcula en el dispositivo.
  function open(fecha = state.day) {
    return ctx.track((async () => {
      const [comidasDelDia, todas, plantillas, recetas] = await Promise.all([
        deps.store.listMealsByDate(fecha), deps.store.allMeals(), ctx.loadTemplates(), ctx.recetasTodas(),
      ]);
      state.cenas = {
        fecha, ideasIA: [], ideasUsadas: false, busy: false, error: '', aviso: '',
        entrada: { fecha, comidasDelDia, historial: todas.filter((m) => m.meal === 'cena'), plantillas, recetas: recetas.filter((r) => !r.ejemplo), semilla: deps.semilla ?? null },
      };
      state.cenas.resultado = calcular();
      state.menu = false; state.sheet = null; state.screen = 'cenas'; ctx.render();
    })(), 'No se pudo calcular la cena');
  }

  // «Añadir a la cena»: borrador nuevo con la cena del día mostrado; nada se guarda hasta «Guardar» en la confirmación.
  function anadir(p) {
    const c = state.cenas;
    const d = draftFromLines({ lines: p.lineas, meal: 'cena', text: '¿Qué ceno?', sourceText: `¿Qué ceno? · ${p.origen}`, foodsById: ctx.byId() });
    state.draft = { ...d, addDate: c.fecha, volver: 'cenas' };
    state.error = ''; state.screen = 'confirm'; ctx.render();
  }

  // «Más ideas»: UNA llamada a la IA por pulsación; el botón queda desactivado hasta volver a abrir la pantalla.
  function masIdeas() {
    const c = state.cenas;
    if (!c || c.ideasUsadas || c.busy || c.resultado?.modo !== 'normal') return undefined; // solo se usa en modo normal (regla 10)
    c.ideasUsadas = true; c.busy = true; c.error = ''; c.aviso = ''; ctx.render();
    return ctx.track((async () => {
      try {
        const alimentos = buildCompactList(state.foods).filter((a) => !foodSinDatos(ctx.byId().get(a.id)));
        const deficits = deficitsParaIA(c.resultado.faltan);
        const r = await deps.createAiClient(state.conn).ideasCena({ alimentos, deficits });
        const v = normalizeCenas({ cenas: r.cenas.map((x) => ({ nombre: x.nombre, lineas: (x.lineas ?? []).map((l) => ({ id: l.food_id ?? l.id, gramos: l.gramos })) })) }, alimentos, { roles: rolesDe(ctx.byId()) });
        if (!v.ok) { c.error = 'La IA no devolvió ninguna idea válida con tu catálogo.'; return; }
        c.ideasIA = v.cenas;
        c.resultado = calcular(v.cenas);
        if (!c.resultado.ideas.length) c.aviso = 'Ninguna de las ideas de la IA encaja con lo que te falta.';
      } catch (e) {
        c.error = e.userMessage ?? `Error inesperado: ${e.message}`; // las propuestas de siempre se conservan
      } finally {
        c.busy = false; ctx.render();
      }
    })());
  }
  return { open, anadir, masIdeas };
}

// ui: { h, state, byId, header, nf0, nf1, dayLabel, actions, back }
export function cenasScreen(ui) {
  const { h, state } = ui;
  const c = state.cenas;
  const r = c.resultado;
  const nf = (x, dec = 0) => (dec ? ui.nf1 : ui.nf0).format(x);
  const nombres = (id) => ui.byId().get(id)?.nombre ?? id;

  const falta = () => {
    const k = r.resumen.kcal;
    const macro = (m) => h('li', { 'data-clave': m.clave, class: 'falta-macro' }, h('span', { class: 'punto' }), h('span', { class: 'falta-label' }, m.label), h('strong', {}, m.falta > 0 ? `${nf(m.falta, 1)} g` : 'cubierto'));
    return h('section', { class: 'panel cenas-falta', 'aria-label': 'Te falta' },
      h('h2', { class: 'caps' }, 'Te falta'),
      h('ul', { class: 'falta-macros' },
        h('li', { 'data-clave': 'energia_kcal', class: 'falta-macro' }, h('span', { class: 'punto' }), h('span', { class: 'falta-label' }, 'Energía'),
          h('strong', {}, k.restantes > 0 ? `${nf(k.restantes)} kcal` : 'cubierta'), h('span', { class: 'muted small' }, ` (llevas ${nf(k.consumidas)} de ${nf(k.meta)})`)),
        r.resumen.macros.map(macro)),
      r.resumen.micros.length ? h('p', { class: 'small falta-micros' }, h('strong', {}, 'Micros que más faltan: '), r.resumen.micros.map((m) => `${m.label} (${nf(m.pctPorCubrir * 100)} %)`).join(', ')) : null,
      r.resumen.mensaje ? h('p', { class: 'cenas-mensaje', role: 'status' }, r.resumen.mensaje) : null,
      r.recomendacion === 'no_cenar' ? h('p', { class: 'warn' }, 'Lo mejor es no cenar. Si te apetece algo, verdura cruda.') : null);
  };

  const lista_y = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0]);
  const lista = (titulo, items) => (items.length ? h('p', { class: 'small cena-nota' }, h('strong', {}, `${titulo}: `), items.join(', ')) : null);

  const tarjeta = (p, i, { ia = false } = {}) => h('section', { class: `card meal cena-prop${ia ? ' cena-ia' : ''}`, 'data-idx': String(i), 'data-origen': p.tipo },
    h('div', { class: 'row between meal-head' },
      h('strong', {}, p.origen, ia ? h('span', { class: 'tag' }, 'Idea de la IA') : null),
      h('span', { class: 'muted' }, `${nf(p.kcal)} kcal`)),
    h('ul', { class: 'lines' }, p.lineas.map((l) => {
      const food = ui.byId().get(l.food_id);
      const kcal = food ? nutrientsForGrams(food, l.gramos, ['energia_kcal']).energia_kcal : null;
      return h('li', { class: 'line' },
        h('span', { class: 'line-name' }, l.nombre, l.añadida ? h('span', { class: 'tag' }, 'añadida para completar') : l.postre ? h('span', { class: 'tag' }, 'postre habitual') : null),
        h('span', { class: 'sep' }, ' · '),
        h('span', { class: 'line-grams' }, `${nf(l.gramos, l.gramos % 1 ? 1 : 0)} g`),
        h('span', { class: 'sep' }, ' · '),
        h('span', { class: kcal === null ? 'line-kcal sin-dato' : 'line-kcal' }, kcal === null ? 'sin dato' : `${nf(kcal)} kcal`));
    })),
    h('p', { class: 'cena-macros small' }, `${nf(p.kcal)} kcal · ${nf(p.proteina, 1)} g proteína · ${nf(p.hidratos, 1)} g hidratos · ${nf(p.grasa, 1)} g grasa`),
    p.quitados?.length ? h('p', { class: 'flag', 'data-quitados': '1' }, `Sin ${lista_y(p.quitados.map((n) => n.charAt(0).toLowerCase() + n.slice(1)))} para que quepa.`) : null,
    p.seQuedaCorta ? h('p', { class: 'flag' }, `Se queda en ${nf(p.seQuedaCorta)} kcal.`) : null,
    p.porEncimaObjetivo ? h('p', { class: 'flag' }, 'Por encima de tu objetivo de hoy.') : null,
    lista('Completa', p.completa.map((x) => x.label)),
    lista('Cubre la mitad de', p.mitad.map((x) => x.label)),
    lista('Sigue faltando', p.siguenFaltando.map((x) => `${x.label} (${nf(x.pct * 100)} %)`)),
    p.parciales.length ? h('p', { class: 'flag' }, `Aporte parcial (faltan datos en tu documento): ${p.parciales.join(', ')}.`) : null,
    p.incompletos.length ? h('p', { class: 'flag' }, `Pendiente de completar: ${p.incompletos.join(', ')}.`) : null,
    h('div', { class: 'row cena-acciones' }, h('button', { type: 'button', class: 'primary', onclick: () => ui.actions.anadir(p) }, 'Añadir a la cena')));

  const avisos = r.avisos.filter((a) => a.codigo !== 'sin_candidatos');
  const descartados = textoDescartados(r.descartados, nombres);
  const sinCandidatos = r.avisos.find((a) => a.codigo === 'sin_candidatos');

  return h('main', { class: 'cenas' },
    ui.header('¿Qué ceno?', ui.back, { sub: ui.dayLabel(c.fecha) }),
    falta(),
    avisos.length ? h('ul', { class: 'warnlist cenas-avisos', 'aria-label': 'Avisos' }, avisos.map((a) => h('li', { 'data-aviso': a.codigo }, a.texto))) : null,
    descartados.length ? h('ul', { class: 'muted small cenas-descartados' }, descartados.map((t) => h('li', {}, t))) : null,
    sinCandidatos ? h('p', { class: 'warn', 'data-aviso': 'sin_candidatos', role: 'status' }, sinCandidatos.texto) : null,
    r.propuestas.map((p, i) => tarjeta(p, i)),
    r.modo === 'normal' ? h('section', { class: 'cenas-ideas' }, // solo en modo normal (o sin_candidatos con R ≥ 400): en ligero y cubierto el motor no usaría la respuesta
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary wide ideas-btn', disabled: c.ideasUsadas || c.busy, onclick: () => ui.actions.masIdeas() }, c.busy ? 'Pensando…' : 'Más ideas')),
      h('p', { class: 'muted small' }, c.ideasUsadas ? 'Una llamada a la IA por visita a esta pantalla.' : 'Pide a la IA hasta 3 ideas más (una llamada). Los gramos y nutrientes los calcula la app con tu documento.'),
      c.error ? h('p', { class: 'error', role: 'alert' }, c.error) : null,
      c.aviso ? h('p', { class: 'muted small', role: 'status' }, c.aviso) : null,
      r.ideas.map((p, i) => tarjeta(p, i, { ia: true }))) : null);
}
