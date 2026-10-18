// Caché de USDA en el dispositivo (ajuste "usda_cache"): términos ya buscados y fichas ya descargadas, para no repetir
// consultas. Solo guarda lo que devuelve USDA (candidatos y valores por 100 g), nunca el diario. Funciones puras.
import { searchQuery } from './usda-core.js';
import { normalizeText } from './text.js';

export const MAX_BUSQUEDAS = 200;
export const MAX_FICHAS = 300;

export const claveTermino = (t) => normalizeText(searchQuery(String(t ?? '')));
export const emptyCache = () => ({ busquedas: {}, fichas: {} });

const objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export function cleanCache(raw) {
  const c = objeto(raw);
  const busquedas = Object.fromEntries(Object.entries(objeto(c.busquedas)).filter(([, v]) => v && typeof v.at === 'string' && Array.isArray(v.r?.candidatos)));
  const fichas = Object.fromEntries(Object.entries(objeto(c.fichas)).filter(([, v]) => v && typeof v.at === 'string' && v.f && typeof v.f.values === 'object'));
  return { busquedas, fichas };
}

// Se quedan las más recientes.
const recorta = (o, max) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, max));

export const getBusqueda = (cache, termino) => cache.busquedas[claveTermino(termino)]?.r ?? null;
export const getFicha = (cache, fdcId) => cache.fichas[String(fdcId)]?.f ?? null;

export function putBusquedas(cache, resultados, now = new Date()) {
  const busquedas = { ...cache.busquedas };
  for (const r of resultados) busquedas[claveTermino(r.termino)] = { at: now.toISOString(), r };
  return { ...cache, busquedas: recorta(busquedas, MAX_BUSQUEDAS) };
}

export function putFichas(cache, fichas, now = new Date()) {
  const out = { ...cache.fichas };
  for (const f of fichas) out[String(f.fdcId)] = { at: now.toISOString(), f };
  return { ...cache, fichas: recorta(out, MAX_FICHAS) };
}

// Busca en USDA (a través del Worker) solo los términos que no están en la caché, en UNA petición.
// Devuelve { porTermino: Map(claveTermino -> resultado), cache, consultados }.
export async function buscarConCache(ai, cache, terminos, now = new Date()) {
  const porClave = new Map();
  for (const t of terminos) if (!porClave.has(claveTermino(t))) porClave.set(claveTermino(t), t); // gana el primero
  const unicos = [...porClave.values()];
  const faltan = unicos.filter((t) => !getBusqueda(cache, t));
  let c = cache;
  if (faltan.length) c = putBusquedas(c, (await ai.usdaSearch({ terminos: faltan })).resultados, now);
  return { porTermino: new Map(unicos.map((t) => [claveTermino(t), getBusqueda(c, t)])), cache: c, consultados: faltan.length };
}

// Fichas de estos fdcId: las que faltan, en UNA petición. Devuelve { fichas: Map(fdcId -> ficha), cache, faltan }.
export async function fichasConCache(ai, cache, fdcIds, now = new Date()) {
  const ids = [...new Set(fdcIds)];
  const pedir = ids.filter((id) => !getFicha(cache, id));
  let c = cache;
  let noDevueltos = [];
  if (pedir.length) {
    const r = await ai.usdaFoods({ fdcIds: pedir });
    c = putFichas(c, r.fichas, now);
    noDevueltos = r.faltan ?? [];
  }
  return { fichas: new Map(ids.filter((id) => getFicha(c, id)).map((id) => [id, getFicha(c, id)])), cache: c, faltan: [...new Set([...noDevueltos, ...ids.filter((id) => !getFicha(c, id))])] };
}
