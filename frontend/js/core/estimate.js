// Pantalla de revisión de «Estimar con IA»: ingredientes con gramos editables, alimento elegido (del documento o de USDA)
// y, al confirmar, las filas nuevas de USDA que se añaden al documento. Funciones puras (devuelven un estado nuevo).
// Los nutrientes de las filas nuevas son los de USDA por 100 g (fichaUsda); el cálculo sigue siendo el de siempre.
import { parseNumber } from './numbers.js';
import { normalizeText, containsTerm, looseKey } from './text.js';
import { TOLERANCIA_SUMA } from './estimate-validate.js';
import { claveTermino } from './usda-cache.js';
import { quitarEnriquecimiento } from './usda-core.js';
import { slugId } from './recetas.js';

export const TIPO_USDA_APP = 'usda_app';
// Columnas de trabajo que llevan las filas nuevas (se añaden a las cabeceras del documento para exportarlas).
export const COLUMNAS_NUEVAS = ['incluir', 'tipo', 'termino_busqueda_usda', 'fdc_id', 'fuente_usda', 'notas', 'pendiente_revisar'];

const r1 = (x) => Math.round(x * 10) / 10;
const positivo = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const mapIng = (e, key, fn) => ({ ...e, ings: e.ings.map((i) => (i.key === key ? fn(i) : i)) });

// Datos de USDA de un ingrediente: candidatos del término y el elegido (el sugerido, si lo hay).
const conBusqueda = (ing, resultado) => ({ ...ing, candidatos: resultado?.candidatos ?? [], fdcId: resultado?.sugerido ?? resultado?.candidatos?.[0]?.fdcId ?? null, buscado: Boolean(resultado) });

// ¿Vale este alimento de tu documento para el ingrediente? Lo cocinado solo con lo cocinado y lo no cocinado con lo no
// cocinado: nunca pasta seca por pasta cocida, ni una fila cruda o con peso_en_crudo por carne cocinada.
const mismoEstado = (ing, f) => (ing.estado === 'cocinado' ? f.estado === 'cocinado' && !f.pesoEnCrudo : f.estado !== 'cocinado');
const candidatosDoc = (ing, foods) => foods.filter((f) => normalizeText(f.extra?.incluir) !== 'no' && mismoEstado(ing, f));

// Sugerencia (botón «Usar «…» de tu documento», no cambia nada solo): el NOMBRE que propuso la IA contiene el nombre o
// un alias de un alimento tuyo ("leche entera" -> Leche entera; "queso mozzarella" -> tu queso, solo como sugerencia).
// Nunca a partir del término en inglés ("pan-browned" no es "pan"). Gana el término más largo.
export function sugerirDelDocumento(ing, foods) {
  let mejor = null;
  for (const f of candidatosDoc(ing, foods)) {
    for (const t of [f.nombre, ...(f.alias ?? [])]) {
      if (containsTerm(ing.nombre, t) && (!mejor || normalizeText(t).length > mejor.largo)) mejor = { id: f.id, largo: normalizeText(t).length };
    }
  }
  return mejor?.id ?? null;
}

// Preselección: el nombre o el término de USDA que propuso la IA ES el nombre o un alias de un alimento tuyo (sin
// acentos, mayúsculas ni plurales). Coincidencia exacta: "queso mozzarella" no preselecciona tu "queso".
export function coincideConDocumento(ing, foods) {
  const dichos = [ing.nombre, ing.termino].filter(Boolean).map(looseKey);
  const f = candidatosDoc(ing, foods).find((x) => [x.nombre, ...(x.alias ?? [])].some((t) => dichos.includes(looseKey(t))));
  return f?.id ?? null;
}

// Antes de buscar en USDA: los ingredientes que la IA mandó a USDA y que coinciden exactamente con un alimento de tu
// documento pasan a ser el tuyo, preseleccionado, con USDA como alternativa («Usar USDA en su lugar»). Así tampoco se
// gasta una búsqueda en USDA para ellos.
export function preseleccionar(result, foods) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const ingredientes = result.ingredientes.map((i) => {
    if (i.origen !== 'usda') return i;
    const id = coincideConDocumento(i, foods);
    if (!id) return i;
    return { origen: 'catalogo', food_id: id, nombre: byId.get(id).nombre, gramos: i.gramos, alternativa: { termino: i.termino, nombre: i.nombre, estado: i.estado ?? '' } };
  });
  return { ...result, ingredientes };
}

// «Usar USDA en su lugar»: el ingrediente preseleccionado vuelve a USDA con el término que propuso la IA y los
// candidatos de esa búsqueda; tu alimento queda como sugerencia («Usar «…» de tu documento»).
export const usarAlternativa = (e, key, resultado) => mapIng(e, key, (i) => {
  if (!i.alternativa) return i;
  const { termino, nombre, estado } = i.alternativa;
  return { ...conBusqueda({ key: i.key, origen: 'usda', termino, nombre, estado, gramos: i.gramos, sinEnriquecer: false }, resultado), sugerido: i.food_id };
});

// result: lo que devuelve ai.estimateDish (pasado por preseleccionar); porTermino: Map(claveTermino -> resultado de
// /usda/search); foods: tu documento.
export function createEstimate({ result, texto, index, porTermino = new Map(), foods = [] }) {
  let n = 0;
  const ings = result.ingredientes.map((i) => {
    const base = { key: `i${++n}`, origen: i.origen, nombre: i.nombre, estado: i.estado ?? '', gramos: i.gramos, sinEnriquecer: false };
    if (i.origen === 'catalogo') return { ...base, food_id: i.food_id, ...(i.alternativa ? { alternativa: { ...i.alternativa } } : {}) };
    return { ...conBusqueda({ ...base, termino: i.termino }, porTermino.get(claveTermino(i.termino))), sugerido: sugerirDelDocumento(base, foods) };
  });
  return {
    texto, index, plato: result.plato, gramos: result.gramos, total_estimado: result.total_estimado, warnings: [...(result.warnings ?? [])], ings, nextKey: n + 1,
    receta: { guardar: false, nombre: capital(result.plato ?? ''), alias: result.plato ?? '' },
  };
}

export const suma = (e) => r1(e.ings.reduce((a, i) => a + (positivo(i.gramos) ? i.gramos : 0), 0));

const leer = (raw) => { const v = parseNumber(raw); return v.status === 'ok' && v.value > 0 ? v.value : null; };
export const setIngGrams = (e, key, raw) => mapIng(e, key, (i) => ({ ...i, gramos: leer(raw) }));

// Total del plato: reescala todos los ingredientes en proporción (los que no tienen gramos se quedan sin ellos).
export function setTotal(e, raw) {
  const total = leer(raw);
  if (total === null) return e;
  const s = suma(e);
  if (!(s > 0)) return { ...e, gramos: total };
  return { ...e, gramos: total, ings: e.ings.map((i) => (positivo(i.gramos) ? { ...i, gramos: r1(i.gramos * (total / s)) } : i)) };
}

export const removeIng = (e, key) => ({ ...e, ings: e.ings.filter((i) => i.key !== key) });
export const setNombre = (e, key, nombre) => mapIng(e, key, (i) => ({ ...i, nombre: String(nombre ?? '') }));
export const chooseCandidate = (e, key, fdcId) => mapIng(e, key, (i) => ({ ...i, fdcId: Number(fdcId) || null }));
export const setSinEnriquecer = (e, key, v) => mapIng(e, key, (i) => ({ ...i, sinEnriquecer: !!v }));
export const setReceta = (e, patch) => ({ ...e, receta: { ...e.receta, ...patch } });

// Un ingrediente pasa a ser un alimento del documento (cambiar o «Usar uno de mi documento»).
export const useCatalog = (e, key, food) => mapIng(e, key, (i) => ({ key: i.key, origen: 'catalogo', food_id: food.id, nombre: food.nombre, estado: food.estado ?? '', gramos: i.gramos, sinEnriquecer: false }));

export function addCatalogIng(e, food, gramos = null) {
  const key = `i${e.nextKey}`;
  return { ...e, nextKey: e.nextKey + 1, ings: [...e.ings, { key, origen: 'catalogo', food_id: food.id, nombre: food.nombre, estado: food.estado ?? '', gramos, sinEnriquecer: false }] };
}

// «Buscar otro término»: el ingrediente pasa a USDA con los candidatos de ese término.
export const setBusqueda = (e, key, termino, resultado) => mapIng(e, key, (i) => conBusqueda({ key: i.key, origen: 'usda', termino, nombre: i.nombre, estado: i.estado, gramos: i.gramos, sinEnriquecer: false }, resultado));

// El elegido de USDA está en crudo ("Mollusks, squid, mixed species, raw") y el ingrediente, cocinado: con gramos del
// plato terminado, kcal y proteína salen algo por debajo (al cocinarse pierde agua). Solo avisa.
export const RAW = /(^|[^a-z])raw($|[^a-z])/;
export const datoCrudoParaCocinado = (ing, candidato) => ing.estado === 'cocinado' && Boolean(candidato) && RAW.test(normalizeText(candidato.descripcion));
export const AVISO_CRUDO = 'Dato en crudo para un ingrediente cocinado: kcal y proteína algo subestimadas';

export const fueraDeRango = (e) => Math.abs(suma(e) - e.gramos) > TOLERANCIA_SUMA * e.gramos;

// problems: [{ key, code }] con code 'sin_gramos' | 'sin_alimento' (USDA sin candidato elegido) | 'sin_nombre';
// key null: 'receta_sin_nombre'. La suma fuera del ±10 % solo avisa (los gramos que pones tú mandan).
export function validateEstimate(e, foodsById) {
  const problems = [];
  for (const i of e.ings) {
    if (!positivo(i.gramos)) problems.push({ key: i.key, code: 'sin_gramos' });
    if (i.origen === 'catalogo' ? !foodsById.has(i.food_id) : !i.fdcId) problems.push({ key: i.key, code: 'sin_alimento' });
    if (i.origen === 'usda' && !String(i.nombre).trim()) problems.push({ key: i.key, code: 'sin_nombre' });
  }
  if (e.receta.guardar && !String(e.receta.nombre).trim()) problems.push({ key: null, code: 'receta_sin_nombre' });
  return { ok: e.ings.length > 0 && problems.length === 0, problems, suma: suma(e), fueraDeRango: fueraDeRango(e) };
}

// fdcId de USDA que hay que descargar al confirmar (los que ya están en el documento se reutilizan).
export function fdcIdsPendientes(e, foods) {
  const enDoc = new Set(foods.map((f) => f.extra?.fdc_id).filter(Boolean));
  return [...new Set(e.ings.filter((i) => i.origen === 'usda' && i.fdcId && !enDoc.has(String(i.fdcId))).map((i) => i.fdcId))];
}

// Fila nueva del documento a partir de la ficha de USDA. Va a la IA (incluir=si) para no duplicarla en la próxima
// estimación, y queda marcada para revisar (alias, fusionar con tus variantes) en Documento → Pulir el documento.
export function nuevoAlimento(ing, ficha, { ids, fecha, plato }) {
  const f = ing.sinEnriquecer ? quitarEnriquecimiento(ficha, ficha.enriquecibles ?? []) : ficha;
  const nombre = String(ing.nombre).trim();
  const id = slugId(nombre, ids);
  return {
    id, nombre, alias: [], porciones: [], estado: ing.estado || '', varianteDefecto: true, grupo: id, densidad: null, pesoEnCrudo: false,
    nutrients: { ...f.values },
    extra: {
      incluir: 'si', tipo: TIPO_USDA_APP, termino_busqueda_usda: ing.termino, fdc_id: String(f.fdcId), fuente_usda: f.fuente, pendiente_revisar: 'si',
      notas: `Añadido con «Estimar con IA» el ${fecha}${plato ? ` (${plato})` : ''}. Gramos del plato terminado.`,
    },
  };
}

// Al confirmar: alimentos nuevos (uno por fdcId; si ya está en el documento, se reutiliza esa fila) y las líneas de
// la comida. fichas: Map(fdcId -> ficha). Devuelve { foods, nuevos, lines: [{ food_id, grams }], avisos }.
export function aplicarEstimacion(e, { foods, fichas, fecha }) {
  const ids = new Set(foods.map((f) => f.id));
  const porFdc = new Map(foods.filter((f) => f.extra?.fdc_id).map((f) => [f.extra.fdc_id, f]));
  const nuevos = [];
  const avisos = [];
  const lines = [];
  for (const i of e.ings) {
    if (i.origen === 'catalogo') { lines.push({ food_id: i.food_id, grams: i.gramos }); continue; }
    let food = porFdc.get(String(i.fdcId));
    if (!food) {
      const ficha = fichas.get(i.fdcId);
      if (!ficha) throw new Error(`USDA no devolvió el alimento ${i.fdcId} (${i.nombre})`);
      food = nuevoAlimento(i, ficha, { ids, fecha, plato: e.plato });
      ids.add(food.id);
      porFdc.set(food.extra.fdc_id, food);
      nuevos.push(food);
      for (const s of ficha.sospechosos ?? []) avisos.push(`${food.nombre}: valor sospechoso de USDA (${s})`);
      if (ficha.fortificacion?.length && !i.sinEnriquecer) avisos.push(`${food.nombre}: USDA puede estar enriquecido (${ficha.fortificacion.join('; ')})`);
    }
    lines.push({ food_id: food.id, grams: i.gramos });
  }
  return { foods: [...foods, ...nuevos], nuevos, lines, avisos };
}

// ---------- Pendientes de revisar (Documento → Pulir el documento) ----------
export const pendientesRevision = (foods) => foods.filter((f) => normalizeText(f.extra?.pendiente_revisar) === 'si');
export const marcarRevisado = (foods, id) => foods.map((f) => {
  if (f.id !== id) return f;
  const { pendiente_revisar, ...extra } = f.extra ?? {};
  return { ...f, extra };
});
