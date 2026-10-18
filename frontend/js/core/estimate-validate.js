// Validación en código de la respuesta de «Estimar con IA» (la usan el Worker y la app). La IA propone ingredientes y
// gramos de un plato que no está en el catálogo; aquí se descarta lo inválido y se cuadra la suma. Nunca nutrientes.
// Los gramos son los del plato TERMINADO (la misma excepción a "todo en crudo" que las recetas).
import { MAX_GRAMS } from './ai-contract.js';
import { gramsFromText, gramosAsumidos } from './draft.js';
import { ESTADOS } from './schema.js';
import { normalizeText } from './text.js';

export const TOLERANCIA_SUMA = 0.1; // la suma de ingredientes debe quedar a ±10 % de lo dicho; si no, se reescala
export const MAX_INGREDIENTES = 15;
export const MAX_TERMINO = 150;
const MAX_NOMBRE = 80;

const positivo = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const texto = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const r1 = (x) => Math.round(x * 10) / 10;

export function checkEstimateStructure(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'la respuesta no es un objeto' };
  if (!Array.isArray(data.ingredientes) || !data.ingredientes.length) return { ok: false, error: 'falta "ingredientes" (lista no vacía)' };
  return { ok: true };
}

// Gramos que dijo el usuario ("300 g de lasaña", "0,5 kg", "300 de lasaña" con el umbral de siempre). null si no los
// dijo ("un plato de paella"): entonces vale la ración que estima la IA, marcada como estimada.
export const gramosDichos = (t) => gramsFromText(t) ?? gramosAsumidos(t);

// data: JSON del modelo; compactList: lo que se le envió. Devuelve { ok, error? } o
// { ok: true, plato, gramos, total_estimado, ajustado, ingredientes: [{ origen: 'catalogo', food_id, nombre, gramos } |
//   { origen: 'usda', termino, nombre, estado, gramos }], warnings }.
export function normalizeEstimate(data, compactList, { texto: dicho = '' } = {}) {
  const byId = new Map(compactList.map((f) => [f.id, f]));
  const warnings = [];
  const porClave = new Map();
  for (const raw of data.ingredientes ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const nombre = texto(raw.nombre, MAX_NOMBRE);
    const quien = nombre || texto(raw.food_id, 60) || texto(raw.termino_usda, 60) || '?';
    if (!positivo(raw.gramos)) { warnings.push(`«${quien}»: gramos no válidos (${JSON.stringify(raw.gramos)}), se quita`); continue; }
    const id = typeof raw.food_id === 'string' ? raw.food_id.trim() : '';
    const termino = texto(raw.termino_usda, MAX_TERMINO);
    let ing;
    if (id && byId.has(id)) ing = { origen: 'catalogo', food_id: id, nombre: nombre || byId.get(id).nombre, gramos: raw.gramos };
    else {
      if (id) warnings.push(`«${quien}»: el alimento "${id}" no está en tu documento${termino ? ', se busca en USDA' : ', se quita'}`);
      if (!termino) { if (!id) warnings.push(`«${quien}»: sin alimento del documento ni término de USDA, se quita`); continue; }
      ing = { origen: 'usda', termino, nombre: nombre || termino, estado: ESTADOS.includes(raw.estado) ? raw.estado : '', gramos: raw.gramos };
    }
    // El mismo ingrediente dos veces: se suman los gramos.
    const clave = ing.origen === 'catalogo' ? `c:${ing.food_id}` : `u:${normalizeText(ing.termino)}`;
    const previo = porClave.get(clave);
    if (previo) previo.gramos += ing.gramos;
    else porClave.set(clave, ing);
  }
  let ingredientes = [...porClave.values()];
  if (ingredientes.length > MAX_INGREDIENTES) {
    warnings.push(`más de ${MAX_INGREDIENTES} ingredientes: se quedan los ${MAX_INGREDIENTES} que más pesan`);
    ingredientes = [...ingredientes].sort((a, b) => b.gramos - a.gramos).slice(0, MAX_INGREDIENTES);
  }
  if (!ingredientes.length) return { ok: false, error: 'ningún ingrediente válido' };

  const deTexto = gramosDichos(dicho);
  const total_estimado = deTexto === null;
  const suma = ingredientes.reduce((a, i) => a + i.gramos, 0);
  const gramos = deTexto ?? (positivo(data.gramos_total) ? data.gramos_total : suma);
  let ajustado = false;
  if (Math.abs(suma - gramos) > TOLERANCIA_SUMA * gramos) {
    const f = gramos / suma;
    ingredientes = ingredientes.map((i) => ({ ...i, gramos: r1(i.gramos * f) }));
    ajustado = true;
    warnings.push(`Los ingredientes sumaban ${r1(suma)} g y no ${r1(gramos)} g: se han ajustado en proporción.`);
  } else ingredientes = ingredientes.map((i) => ({ ...i, gramos: r1(i.gramos) }));
  if (total_estimado) warnings.push(`No dijiste la cantidad: ración estimada de ${r1(gramos)} g. Cámbiala si no es así.`);
  if (gramos > MAX_GRAMS) warnings.push(`${r1(gramos)} g es mucha cantidad: revísala.`);
  return { ok: true, plato: texto(data.plato, MAX_NOMBRE) || texto(dicho, MAX_NOMBRE), gramos: r1(gramos), total_estimado, ajustado, ingredientes, warnings };
}
