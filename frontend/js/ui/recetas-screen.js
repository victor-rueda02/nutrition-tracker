// «Recetas» (Documento → Pulir el documento) y «Guardar como receta» (desde el Diario o al estimar con IA).
// Una receta es una fila más del documento (estado cocinado: se pesa el plato terminado). Sus nutrientes por 100 g se
// calculan aquí, de forma determinista, con los de sus ingredientes en tu documento (core/recetas.js, lo mismo que
// scripts/recetas.mjs). Las definiciones se guardan en el dispositivo (ajuste "recetas"), en el formato de
// data/recetas.json, y se pueden exportar como recetas.json para subirlas al repositorio. Estilos en css/ia-recetas.css.
import { parseNumber } from '../core/numbers.js';
import { unirCabeceras } from '../core/catalog-update.js';
import {
  computeReceta, recetaToFood, recetaFromLines, recetaErrors, cleanRecetas, mergeRecetas, upsertReceta, recetasToJSON, slugId, completitud,
} from '../core/recetas.js';

const COLUMNAS_RECETA = ['incluir', 'tipo', 'termino_busqueda_usda', 'fuente_usda', 'notas'];
const fmt = (g) => (g === null || g === undefined ? '' : String(g).replace('.', ','));
const numero = (raw) => { const v = parseNumber(raw); return v.status === 'ok' && v.value > 0 ? v.value : null; };
const aliasTexto = (a) => (Array.isArray(a) ? a.join(' | ') : String(a ?? ''));

// ctx: { state, deps, track, render, byId, persistFoods, now, saveFile, openDay }
export function recetasActions(ctx) {
  const { state, deps } = ctx;
  const propias = async () => cleanRecetas(await deps.store.getSetting('recetas'));
  const todas = async () => mergeRecetas(deps.recetasBase ?? [], await propias());

  // Calcula la receta con tu documento, escribe su fila y guarda la definición. Devuelve { ok, errores, res }.
  async function guardarReceta(receta, { definicion = true } = {}) {
    const lista = await todas();
    const errores = recetaErrors(receta, ctx.byId(), lista);
    if (errores.length) return { ok: false, errores };
    const res = computeReceta(receta, ctx.byId(), deps.catalog.keys);
    const fila = recetaToFood(receta, res, ctx.byId().get(receta.id) ?? null);
    state.foods = state.foods.some((f) => f.id === fila.id) ? state.foods.map((f) => (f.id === fila.id ? fila : f)) : [...state.foods, fila];
    state.extraHeaders = unirCabeceras(state.extraHeaders, COLUMNAS_RECETA);
    await ctx.persistFoods();
    if (definicion) await deps.store.setSetting('recetas', upsertReceta(await propias(), { ...receta, actualizada: ctx.now().toISOString() }));
    return { ok: true, errores: [], res };
  }

  const open = (msg = '') => ctx.track((async () => {
    state.recetas = (await todas()).filter((r) => !r.ejemplo);
    state.recetasMsg = msg; state.recetaForm = null; state.screen = 'recetas'; ctx.render();
  })());

  // receta: una que ya existe (editar); lines: [{ food_id, grams }] de una comida (nueva desde el Diario).
  function openForm({ receta = null, lines = [], back = 'recetas' } = {}) {
    const src = receta ? receta.ingredientes.map((i) => ({ food_id: i.food_id, grams: i.gramos })) : lines;
    state.recetaForm = {
      id: receta?.id ?? null, nombre: receta?.nombre ?? '', alias: aliasTexto(receta?.alias ?? ''), peso: fmt(receta?.peso_final_g ?? null), notas: receta?.notas ?? '',
      lines: src.map((l, i) => ({ key: `r${i + 1}`, food_id: l.food_id, grams: l.grams })), nextKey: src.length + 1, errores: [], back,
    };
    state.screen = 'recetas'; ctx.render();
  }

  // La receta del formulario (con id nuevo si es nueva). null si aún no hay nombre o ingredientes con gramos.
  function recetaDelFormulario(form) {
    const lines = form.lines.filter((l) => l.grams > 0);
    const ids = new Set([...state.foods.map((f) => f.id), ...(state.recetas ?? []).map((r) => r.id)]);
    return recetaFromLines({
      id: form.id ?? slugId(form.nombre, ids), nombre: form.nombre, alias: form.alias.split('|'), lines, peso_final_g: numero(form.peso), notas: form.notas,
    });
  }

  function saveForm() {
    const form = state.recetaForm;
    return ctx.track((async () => {
      const faltan = [];
      if (!form.nombre.trim()) faltan.push('ponle un nombre');
      if (form.lines.some((l) => !(l.grams > 0))) faltan.push('pon los gramos de todos los ingredientes');
      if (String(form.peso).trim() && numero(form.peso) === null) faltan.push('el peso final debe ser un número mayor que 0 (o déjalo vacío)');
      if (faltan.length) { state.recetaForm = { ...form, errores: faltan }; ctx.render(); return; }
      const receta = recetaDelFormulario(form);
      const r = await guardarReceta(receta);
      if (!r.ok) { state.recetaForm = { ...form, errores: r.errores }; ctx.render(); return; }
      const msg = `Receta «${receta.nombre}» guardada (${r.res.nutrients.energia_kcal ?? '¿?'} kcal por 100 g).${receta.alias.length ? ` Ya puedes dictar «${receta.alias[0]}».` : ''}`;
      if (form.back === 'diary') { state.recetaForm = null; await ctx.openDay(state.day, msg); } else await open(msg);
    })(), 'No se pudo guardar la receta');
  }

  // Vuelve a calcular las filas de todas las recetas con los nutrientes actuales de tu documento (p. ej. después de
  // actualizarlo). Las definiciones no cambian.
  function recalcular() {
    return ctx.track((async () => {
      let ok = 0;
      const malas = [];
      for (const r of (await todas()).filter((x) => !x.ejemplo)) {
        const res = await guardarReceta(r, { definicion: false });
        if (res.ok) ok++; else malas.push(r.nombre);
      }
      await open(`Recalculadas ${ok} ${ok === 1 ? 'receta' : 'recetas'}.${malas.length ? ` Sin calcular (revisa sus ingredientes): ${malas.join(', ')}.` : ''}`);
    })(), 'No se pudieron recalcular las recetas');
  }

  function exportar() {
    return ctx.track((async () => {
      const text = recetasToJSON(await todas());
      const r = await ctx.saveFile({ name: 'recetas.json', text, type: 'application/json' });
      state.recetasMsg = r === 'cancelado' ? 'Exportación cancelada.' : 'Exportado recetas.json: cópialo en data/ del repositorio.';
      ctx.render();
    })(), 'No se pudo exportar');
  }

  return { guardarReceta, open, openForm, saveForm, recalcular, exportar, todas };
}

// ui: { h, state, byId, header, openPicker, render, openDay, nf0, rec (recetasActions), keys, required, labels, back }
export function recetasScreen(ui) {
  return ui.state.recetaForm ? formScreen(ui) : listScreen(ui);
}

function listScreen(ui) {
  const { h, state } = ui;
  const kcal = (r) => ui.byId().get(r.id)?.nutrients?.energia_kcal;
  return h('main', { class: 'recetas' },
    ui.header('Recetas', ui.back),
    state.recetasMsg ? h('p', { class: 'ok', role: 'status' }, state.recetasMsg) : null,
    h('p', { class: 'muted small' }, 'Una receta es un alimento más de tu documento: se pesa el plato terminado. Sus nutrientes se calculan con los de sus ingredientes.'),
    h('div', { class: 'recetas-actions' },
      h('button', { class: 'primary', onclick: () => ui.rec.openForm() }, 'Nueva receta'),
      h('div', { class: 'recetas-dos' },
        h('button', { class: 'secondary', disabled: !state.recetas.length, onclick: () => ui.rec.recalcular() }, 'Recalcular todas'),
        h('button', { class: 'secondary', onclick: () => ui.rec.exportar() }, 'Exportar recetas.json'))),
    state.recetas.length === 0 ? h('p', { class: 'muted' }, 'Aún no tienes recetas. En el Diario, pulsa «Guardar como receta» en una comida, o crea una nueva.')
      : h('ul', { class: 'cards' }, state.recetas.map((r) => h('li', { class: 'card receta', 'data-id': r.id },
        h('div', { class: 'row between' }, h('strong', {}, r.nombre), h('span', { class: 'muted small' }, kcal(r) === undefined ? 'sin calcular' : `${ui.nf0.format(kcal(r))} kcal/100 g`)),
        h('div', { class: 'muted small' }, `${r.ingredientes.length} ${r.ingredientes.length === 1 ? 'ingrediente' : 'ingredientes'} · ${r.peso_final_g ? `peso final ${fmt(r.peso_final_g)} g` : 'en proporción'}${r.alias?.length ? ` · se dicta «${r.alias.join('», «')}»` : ''}`),
        h('div', { class: 'row' }, h('button', { class: 'link', onclick: () => ui.rec.openForm({ receta: r }) }, 'Editar'))))));
}

function formScreen(ui) {
  const { h, state } = ui;
  const form = state.recetaForm;
  const set = (patch) => { state.recetaForm = { ...state.recetaForm, ...patch }; };
  const preview = h('div', { class: 'small receta-preview', role: 'status' });
  const paint = () => {
    const f = state.recetaForm;
    const lines = f.lines.filter((l) => l.grams > 0 && ui.byId().has(l.food_id));
    if (!lines.length) { preview.textContent = 'Añade ingredientes con sus gramos para ver el cálculo.'; return; }
    const peso = numero(f.peso);
    const res = computeReceta({ ingredientes: lines.map((l) => ({ food_id: l.food_id, gramos: l.grams })), peso_final_g: peso ?? undefined }, ui.byId(), ui.keys);
    const n = completitud(res, ui.required);
    const sinDato = ui.required.filter((k) => !(k in res.nutrients));
    const nombre = (id) => ui.byId().get(id)?.nombre ?? id;
    preview.replaceChildren(
      h('div', {}, `${res.nutrients.energia_kcal === undefined ? 'sin dato de kcal' : `${ui.nf0.format(res.nutrients.energia_kcal)} kcal`} por 100 g · ${n}/${ui.required.length} nutrientes obligatorios · peso ${fmt(Math.round(res.pesoIngredientes * 10) / 10)} g → ${fmt(Math.round(res.pesoFinal * 10) / 10)} g`),
      sinDato.length ? h('div', { class: 'flag' }, `Sin dato (falta en algún ingrediente): ${sinDato.slice(0, 6).map((k) => `${ui.labels.get(k) ?? k} (${res.sinDato[k].map(nombre).join(', ')})`).join('; ')}${sinDato.length > 6 ? '…' : ''}`) : null,
      ...res.avisos.map((a) => h('div', { class: 'flag' }, a)));
  };
  const nombre = h('input', { type: 'text', 'aria-label': 'Nombre de la receta', value: form.nombre, maxlength: '60', oninput: (e) => set({ nombre: e.target.value }) });
  const alias = h('input', { type: 'text', 'aria-label': 'Alias de la receta', value: form.alias, placeholder: 'lentejas | lentejas caseras', oninput: (e) => set({ alias: e.target.value }) });
  const peso = h('input', { type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': 'Peso final del plato en gramos', value: form.peso, oninput: (e) => { set({ peso: e.target.value }); paint(); } });
  const lineRow = (l) => {
    const f = ui.byId().get(l.food_id);
    const g = h('input', { type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': `Gramos de ${f?.nombre ?? l.food_id}`, value: fmt(l.grams),
      oninput: (e) => { set({ lines: state.recetaForm.lines.map((x) => (x.key === l.key ? { ...x, grams: numero(e.target.value) } : x)) }); g.classList.toggle('bad', numero(e.target.value) === null); paint(); } });
    return h('li', { class: 'card', 'data-key': l.key },
      h('div', { class: 'row between' },
        h('button', { class: 'name', 'aria-label': `Cambiar ingrediente: ${f?.nombre ?? l.food_id}`, onclick: () => ui.openPicker({ title: 'Cambiar ingrediente', onPick: (x) => { set({ lines: state.recetaForm.lines.map((y) => (y.key === l.key ? { ...y, food_id: x.id } : y)) }); ui.render(); } }) }, f?.nombre ?? `${l.food_id} (no está en tu documento)`),
        h('button', { class: 'icon', 'aria-label': `Quitar ${f?.nombre ?? l.food_id}`, onclick: () => { set({ lines: state.recetaForm.lines.filter((y) => y.key !== l.key) }); ui.render(); } }, '✕')),
      h('div', { class: 'row' }, g, h('span', {}, 'g')));
  };
  const screen = h('main', { class: 'recetas' },
    ui.header(form.id ? 'Editar receta' : 'Guardar como receta', () => { state.recetaForm = null; if (form.back === 'diary') ui.openDay(state.day); else ui.rec.open(); }),
    h('label', {}, 'Nombre', nombre),
    h('label', {}, 'Alias para dictarla (separados por |)', alias),
    h('h2', {}, 'Ingredientes'),
    h('p', { class: 'muted small' }, 'Gramos de la tanda entera (en crudo si los pesas así). Sin peso final, los gramos son proporciones.'),
    h('ul', { class: 'cards' }, form.lines.map(lineRow)),
    h('button', { class: 'secondary', onclick: () => ui.openPicker({ title: 'Añadir ingrediente', onPick: (x) => { set({ lines: [...state.recetaForm.lines, { key: `r${state.recetaForm.nextKey}`, food_id: x.id, grams: null }], nextKey: state.recetaForm.nextKey + 1 }); ui.render(); } }) }, '+ Añadir ingrediente'),
    h('label', {}, 'Peso final del plato cocinado (opcional)', h('span', { class: 'row' }, peso, h('span', {}, 'g'))),
    preview,
    form.errores.length ? h('ul', { class: 'error', role: 'alert' }, form.errores.map((e) => h('li', {}, e))) : null,
    h('footer', { class: 'bar' }, h('div', { class: 'muted small' }, 'Se guarda como un alimento de tu documento (estado cocinado) y su definición, en este dispositivo.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => ui.rec.saveForm() }, 'Guardar receta'))));
  paint();
  return screen;
}
