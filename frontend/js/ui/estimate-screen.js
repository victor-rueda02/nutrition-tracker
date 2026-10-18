// «Estimar con IA»: un plato que no está en el documento ("300 g de lasaña") se descompone en ingredientes con
// proporciones típicas. Pantalla de revisión: gramos editables (del plato terminado), alimento elegido (de tu documento o
// de USDA, cambiable) y origen. Al confirmar, los alimentos nuevos de USDA se añaden al documento (marcados para
// revisar) y las líneas pasan a la confirmación normal: nada se guarda en el diario hasta pulsar «Guardar».
// Una llamada a la IA por «Estimar»; a USDA solo lo que falta en la caché del dispositivo (core/usda-cache.js).
// Estilos propios en css/ia-recetas.css. También: lista «Añadidos con IA, pendientes de revisar» (Documento).
import { buildCompactList } from '../core/ai-contract.js';
import { resolveUnmatchedWithLines } from '../core/draft.js';
import { unirCabeceras } from '../core/catalog-update.js';
import { buscarConCache, fichasConCache, cleanCache } from '../core/usda-cache.js';
import { madridNow } from '../core/meal-defaults.js';
import { recetaFromLines, slugId } from '../core/recetas.js';
import {
  createEstimate, preseleccionar, usarAlternativa, setIngGrams, setTotal, removeIng, setNombre, chooseCandidate, setSinEnriquecer, setReceta, useCatalog, addCatalogIng, setBusqueda,
  validateEstimate, datoCrudoParaCocinado, AVISO_CRUDO, fdcIdsPendientes, aplicarEstimacion, pendientesRevision, marcarRevisado, COLUMNAS_NUEVAS,
} from '../core/estimate.js';

const fmt = (g) => (g === null || g === undefined ? '' : String(g).replace('.', ','));
export const MOTIVOS_ESTIMABLES = ['no_en_catalogo'];

// ctx: { state, deps, track, render, byId, persistFoods, now, guardarReceta }
export function estimateActions(ctx) {
  const { state, deps } = ctx;
  const ai = () => deps.createAiClient(state.conn);
  const loadCache = async () => cleanCache(await deps.store.getSetting('usda_cache'));
  const saveCache = (c) => deps.store.setSetting('usda_cache', c);
  const fallo = (e) => e.userMessage ?? `Error inesperado: ${e.message}`;

  function start(index) {
    const u = state.draft?.unmatched[index];
    if (!u || state.busy) return;
    state.busy = true; state.error = ''; ctx.render();
    return ctx.track((async () => {
      try {
        const cliente = ai();
        // Lo que ya tienes en tu documento se preselecciona y no se busca en USDA (queda como alternativa).
        const result = preseleccionar(await cliente.estimateDish({ texto: u.text, alimentos: buildCompactList(state.foods) }), state.foods);
        const terminos = result.ingredientes.filter((i) => i.origen === 'usda').map((i) => i.termino);
        let porTermino = new Map();
        let errorUsda = '';
        if (terminos.length) {
          try {
            const r = await buscarConCache(cliente, await loadCache(), terminos, ctx.now());
            porTermino = r.porTermino;
            await saveCache(r.cache);
          } catch (e) { errorUsda = fallo(e); }
        }
        state.estimate = { ...createEstimate({ result, texto: u.text, index, porTermino, foods: state.foods }), error: errorUsda };
        state.screen = 'estimar';
      } catch (e) {
        state.error = fallo(e); // en la confirmación; la línea sigue sin resolver
      } finally {
        state.busy = false; ctx.render();
      }
    })());
  }

  // «Buscar en USDA» con otro término (o reintentar el mismo), o «Usar USDA en su lugar» (alternativa = true) en un
  // ingrediente preseleccionado de tu documento: una búsqueda, si no está en la caché.
  function buscar(key, termino, { alternativa = false } = {}) {
    const t = String(termino ?? '').trim();
    if (!t) return;
    state.busy = true; ctx.render();
    return ctx.track((async () => {
      try {
        const r = await buscarConCache(ai(), await loadCache(), [t], ctx.now());
        await saveCache(r.cache);
        const res = [...r.porTermino.values()][0];
        state.estimate = { ...(alternativa ? usarAlternativa(state.estimate, key, res) : setBusqueda(state.estimate, key, t, res)), error: '' };
      } catch (e) {
        state.estimate = { ...state.estimate, error: fallo(e) };
      } finally {
        state.busy = false; ctx.render();
      }
    })());
  }

  function confirm() {
    const e = state.estimate;
    if (!validateEstimate(e, ctx.byId()).ok || state.busy) return;
    state.busy = true; ctx.render();
    return ctx.track((async () => {
      try {
        const pedir = fdcIdsPendientes(e, state.foods);
        let fichas = new Map();
        if (pedir.length) {
          const r = await fichasConCache(ai(), await loadCache(), pedir, ctx.now());
          await saveCache(r.cache);
          fichas = r.fichas;
        }
        const ap = aplicarEstimacion(e, { foods: state.foods, fichas, fecha: madridNow(ctx.now()).date });
        if (ap.nuevos.length) {
          state.foods = ap.foods;
          state.extraHeaders = unirCabeceras(state.extraHeaders, COLUMNAS_NUEVAS);
          await ctx.persistFoods();
        }
        const avisos = [...e.warnings, ...ap.avisos];
        if (ap.nuevos.length) avisos.push(`Añadidos a tu documento: ${ap.nuevos.map((f) => f.nombre).join(', ')} (pendientes de revisar en Documento).`);
        if (e.receta.guardar) {
          const ids = new Set(state.foods.map((f) => f.id));
          const receta = recetaFromLines({ id: slugId(e.receta.nombre, ids), nombre: e.receta.nombre, alias: String(e.receta.alias ?? '').split('|'), lines: ap.lines, notas: `Estimada con IA a partir de «${e.texto}» (gramos del plato terminado).` });
          const r = await ctx.guardarReceta(receta);
          avisos.push(r.ok ? `Receta «${receta.nombre}» guardada: la próxima vez puedes dictarla directamente.` : `No se guardó la receta: ${r.errores.join('; ')}`);
        }
        state.draft = resolveUnmatchedWithLines(state.draft, e.index, ap.lines);
        state.draft = { ...state.draft, warnings: [...state.draft.warnings, ...avisos] };
        state.estimate = null;
        state.screen = 'confirm';
      } catch (err) {
        state.estimate = { ...state.estimate, error: fallo(err) };
      } finally {
        state.busy = false; ctx.render();
      }
    })(), 'No se pudo completar la estimación');
  }

  function markReviewed(id) {
    return ctx.track((async () => {
      state.foods = marcarRevisado(state.foods, id);
      await ctx.persistFoods();
      ctx.render();
    })(), 'No se pudo marcar como revisado');
  }

  return { start, buscar, confirm, markReviewed };
}

// ui: { h, state, byId, header, openPicker, render, thr (umbral de completitud), est (estimateActions), back }
export function estimateScreen(ui) {
  const { h, state } = ui;
  const e = state.estimate;
  const set = (fn) => { state.estimate = fn(state.estimate); };
  const sumaEl = h('p', { class: 'small estimar-suma', role: 'status' });
  const hint = h('div', { class: 'muted small' });
  const okBtn = h('button', { class: 'primary', onclick: () => ui.est.confirm() }, 'Añadir a la comida');
  const enDoc = new Map(state.foods.filter((f) => f.extra?.fdc_id).map((f) => [f.extra.fdc_id, f]));

  const paint = () => {
    const v = validateEstimate(state.estimate, ui.byId());
    sumaEl.textContent = `Suma de ingredientes: ${fmt(v.suma)} g de ${fmt(state.estimate.gramos)} g${v.fueraDeRango ? ' · se aleja más de un 10 % del total' : ''}`;
    sumaEl.classList.toggle('warn', v.fueraDeRango);
    okBtn.disabled = !v.ok || state.busy;
    const code = (c) => v.problems.some((p) => p.code === c);
    hint.textContent = !state.estimate.ings.length ? 'Añade al menos un ingrediente.' : code('sin_alimento') ? 'Elige un alimento en los ingredientes marcados.' : code('sin_gramos') ? 'Pon los gramos de los ingredientes marcados.' : code('sin_nombre') ? 'Ponle nombre a los alimentos nuevos.' : code('receta_sin_nombre') ? 'Ponle nombre a la receta.' : 'Nada se guarda en el diario hasta pulsar «Guardar» en la confirmación.';
  };

  const ingCard = (i) => {
    const grams = h('input', { type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': `Gramos de ${i.nombre}`, value: fmt(i.gramos),
      oninput: (ev) => { set((x) => setIngGrams(x, i.key, ev.target.value)); grams.classList.toggle('bad', !(state.estimate.ings.find((y) => y.key === i.key)?.gramos > 0)); paint(); } });
    grams.classList.toggle('bad', !(i.gramos > 0));
    const quitar = h('button', { class: 'icon', 'aria-label': `Quitar ${i.nombre}`, onclick: () => { set((x) => removeIng(x, i.key)); ui.render(); } }, '✕');
    const usarDoc = h('button', { class: 'link', onclick: () => ui.openPicker({ title: i.origen === 'catalogo' ? 'Cambiar alimento' : 'Usar uno de mi documento', onPick: (f) => { set((x) => useCatalog(x, i.key, f)); ui.render(); } }) }, i.origen === 'catalogo' ? 'Cambiar' : 'Usar uno de mi documento');
    if (i.origen === 'catalogo') {
      const f = ui.byId().get(i.food_id);
      return h('li', { class: 'card estimar-ing', 'data-key': i.key },
        h('div', { class: 'row between' }, h('strong', {}, f?.nombre ?? i.food_id), quitar),
        h('div', { class: 'row' }, h('span', { class: 'origen catalogo' }, 'Tu documento'), usarDoc),
        i.alternativa ? h('div', { class: 'muted small' }, `Preseleccionado de tu documento: la IA lo buscaba en USDA («${i.alternativa.termino}»).`) : null,
        i.alternativa ? h('button', { class: 'link', disabled: state.busy, onclick: () => ui.est.buscar(i.key, i.alternativa.termino, { alternativa: true }) }, 'Usar USDA en su lugar') : null,
        h('div', { class: 'row' }, grams, h('span', {}, 'g')));
    }
    const ya = i.fdcId ? enDoc.get(String(i.fdcId)) : null;
    const elegido = i.candidatos.find((c) => c.fdcId === i.fdcId);
    const nombre = h('input', { type: 'text', 'aria-label': 'Nombre en tu documento', value: i.nombre, maxlength: '80', oninput: (ev) => { set((x) => setNombre(x, i.key, ev.target.value)); paint(); } });
    const sel = i.candidatos.length ? h('select', { 'aria-label': `Alimento de USDA para ${i.nombre}`, onchange: (ev) => { set((x) => chooseCandidate(x, i.key, ev.target.value)); ui.render(); } },
      i.candidatos.map((c) => h('option', { value: String(c.fdcId), selected: c.fdcId === i.fdcId }, `${c.descripcion} · ${c.tipo} · ${c.obligatorios}/${c.total}`))) : null;
    const suyo = i.sugerido && !ya ? ui.byId().get(i.sugerido) : null;
    const otro = h('input', { type: 'search', 'aria-label': 'Otro término de USDA (en inglés)', placeholder: 'Otro término (en inglés)', value: i.termino });
    return h('li', { class: 'card estimar-ing usda', 'data-key': i.key },
      h('div', { class: 'row between' }, ya ? h('strong', {}, ya.nombre) : h('label', { class: 'estimar-nombre' }, 'Nombre en tu documento', nombre), quitar),
      h('div', { class: 'row wrap' }, h('span', { class: 'origen usda' }, ya ? 'USDA · ya en tu documento' : 'USDA · nuevo'), usarDoc),
      suyo ? h('button', { class: 'secondary sugerido', onclick: () => { set((x) => useCatalog(x, i.key, suyo)); ui.render(); } }, `Usar «${suyo.nombre}» de tu documento`) : null,
      h('div', { class: 'row' }, grams, h('span', {}, 'g')),
      h('div', { class: 'muted small' }, `Término: «${i.termino}»`),
      sel ?? h('p', { class: 'flag' }, i.buscado ? 'USDA no encontró nada con este término: prueba otro o usa uno de tu documento.' : 'Sin buscar en USDA todavía.'),
      elegido && !ya && elegido.obligatorios + 1e-9 < elegido.total * ui.thr ? h('div', { class: 'flag' }, `Incompleto en USDA: ${elegido.obligatorios}/${elegido.total} nutrientes obligatorios`) : null,
      !ya && datoCrudoParaCocinado(i, elegido) ? h('div', { class: 'flag crudo' }, AVISO_CRUDO) : null,
      elegido?.preparaciones?.length && !ya ? h('div', { class: 'flag' }, `Preparación que no pidió la IA: ${elegido.preparaciones.join(', ')} (cambia mucho la grasa y las kcal): mira las alternativas`) : null,
      elegido?.fortificacion?.length && !ya ? h('div', { class: 'flag' }, `Puede estar enriquecido (EE. UU.): ${elegido.fortificacion.join('; ')}`) : null,
      elegido?.fortificacion?.length && !ya ? h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: i.sinEnriquecer, onchange: (ev) => { set((x) => setSinEnriquecer(x, i.key, ev.target.checked)); } }), ' Sin enriquecer (deja vacíos B9, B1, B2, B3 y hierro)') : null,
      h('div', { class: 'row' }, otro, h('button', { class: 'secondary', disabled: state.busy, onclick: () => ui.est.buscar(i.key, otro.value) }, 'Buscar en USDA')));
  };

  const total = h('input', { type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': 'Total del plato en gramos', value: fmt(e.gramos), onchange: (ev) => { set((x) => setTotal(x, ev.target.value)); ui.render(); } });
  const recNombre = h('input', { type: 'text', 'aria-label': 'Nombre de la receta', value: e.receta.nombre, maxlength: '60', oninput: (ev) => { set((x) => setReceta(x, { nombre: ev.target.value })); paint(); } });
  const recAlias = h('input', { type: 'text', 'aria-label': 'Alias de la receta', value: e.receta.alias, placeholder: 'lasaña | lasaña de carne', oninput: (ev) => { set((x) => setReceta(x, { alias: ev.target.value })); } });

  const screen = h('main', { class: 'estimar' },
    ui.header('Estimar con IA', ui.back),
    h('p', {}, h('strong', {}, `«${e.texto}»`)),
    h('p', { class: 'muted small' }, 'Ingredientes y gramos típicos del plato terminado, propuestos por la IA. Los nutrientes salen de tu documento y de USDA, nunca de la IA. Revisa y cambia lo que haga falta.'),
    e.error ? h('p', { class: 'error', role: 'alert' }, e.error) : null,
    state.busy ? h('p', { class: 'muted', role: 'status' }, 'Consultando…') : null,
    e.warnings.length ? h('ul', { class: 'warnlist' }, e.warnings.map((w) => h('li', {}, w))) : null,
    h('section', { class: 'panel' }, h('label', {}, `Total del plato${e.total_estimado ? ' (ración estimada)' : ''}`, h('span', { class: 'row' }, total, h('span', {}, 'g'))), sumaEl),
    h('ul', { class: 'cards' }, e.ings.map(ingCard)),
    h('button', { class: 'secondary', onclick: () => ui.openPicker({ title: 'Añadir ingrediente', onPick: (f) => { set((x) => addCatalogIng(x, f)); ui.render(); } }) }, '+ Añadir ingrediente de mi documento'),
    h('section', { class: 'panel' },
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: e.receta.guardar, onchange: (ev) => { set((x) => setReceta(x, { guardar: ev.target.checked })); ui.render(); } }), ' Guardar también como receta'),
      e.receta.guardar ? [h('label', {}, 'Nombre de la receta', recNombre), h('label', {}, 'Alias para dictarla (separados por |)', recAlias),
        h('p', { class: 'muted small' }, 'Se calcula con estos ingredientes en proporción. La comida se guarda igualmente como sus ingredientes.')] : null),
    h('footer', { class: 'bar' }, hint, h('div', { class: 'row' }, okBtn)));
  paint();
  return screen;
}

// Documento → Pulir el documento: alimentos añadidos con «Estimar con IA» que tienes que revisar (alias, fusionar
// con tus variantes en tu documento). «Revisado» quita la marca.
export function pendientesView(ui) {
  const { h } = ui;
  const lista = pendientesRevision(ui.state.foods);
  if (!lista.length) return null;
  return h('details', { class: 'pendientes-ia' },
    h('summary', {}, `Añadidos con IA, pendientes de revisar (${lista.length})`),
    h('p', { class: 'muted small' }, 'Ponles alias o fúndelos con tus variantes en tu documento (Excel) y márcalos como revisados.'),
    h('ul', { class: 'cards' }, lista.map((f) => h('li', { class: 'card', 'data-id': f.id },
      h('div', { class: 'row between' }, h('strong', {}, f.nombre), h('button', { class: 'link', onclick: () => ui.est.markReviewed(f.id) }, 'Revisado')),
      h('div', { class: 'muted small' }, [f.id, f.extra?.fuente_usda].filter(Boolean).join(' · ')),
      f.extra?.notas ? h('div', { class: 'muted small' }, f.extra.notas) : null))));
}
