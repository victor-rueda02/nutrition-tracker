// Lógica de USDA (FoodData Central) compartida por el script manual (scripts/usda.mjs) y el Worker (Estimar con IA).
// Funciones puras + un cliente HTTP con fetch y caché inyectables, sin Node: así lo puede empaquetar el Worker.
// La app NUNCA llama a USDA directamente: solo a través del Worker, tras una acción del usuario.
// A USDA solo viajan términos de búsqueda y fdcId.
import { normalizeText } from './text.js';

export const API = 'https://api.nal.usda.gov/fdc/v1';
export const PRINCIPALES = ['Foundation', 'SR Legacy'];
export const FNDDS = 'Survey (FNDDS)';
export const MAX_CANDIDATOS = 5;

// ---------- Nutrientes ----------
const UNIDADES = { g: 'g', mg: 'mg', ug: 'ug', 'µg': 'ug', mcg: 'ug', kcal: 'kcal', iu: 'iu', kj: 'kj' };
const unidad = (u) => UNIDADES[String(u ?? '').toLowerCase()] ?? String(u ?? '').toLowerCase();

// Nutrientes de un alimento de USDA como Map número -> { value, unit }. Acepta las tres formas de la API:
// búsqueda (nutrientNumber/value), detalle "full" (nutrient.number/amount) y "abridged" (number/amount).
export function usdaNutrients(food) {
  const out = new Map();
  for (const n of food?.foodNutrients ?? []) {
    const number = String(n.nutrientNumber ?? n.nutrient?.number ?? n.number ?? '');
    const value = n.value ?? n.amount;
    const unit = unidad(n.unitName ?? n.nutrient?.unitName);
    if (!number || typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!out.has(number)) out.set(number, { value, unit });
  }
  return out;
}

const redondea = (x) => Math.round(x * 1000) / 1000;

// Aplica data/usda-map.json. Devuelve { values: {columna: número}, notas: [...], unidades: [...] }.
// Un 0 de USDA es un 0 real; un nutriente ausente no se escribe (celda vacía = sin dato).
export function mapNutrients(food, map) {
  const ns = usdaNutrients(food);
  const values = {};
  const notas = [];
  const unidades = [];
  for (const [key, spec] of Object.entries(map.nutrientes)) {
    const main = ns.get(spec.n);
    if (main && main.unit === spec.unidad) { values[key] = main.value; continue; }
    if (main) unidades.push(`${key}: USDA ${spec.n} viene en ${main.unit}, se esperaba ${spec.unidad}`);
    for (const alt of spec.alternativas ?? []) {
      const a = ns.get(alt.n);
      if (!a || a.unit !== alt.unidad) continue;
      if (alt.solo_si_cero && (ns.get(alt.solo_si_cero)?.value ?? 0) !== 0) continue;
      values[key] = alt.factor ? redondea(a.value * alt.factor) : a.value;
      notas.push(`${key}: ${alt.nota}`);
      break;
    }
  }
  return { values, notas, unidades };
}

export const countRequired = (values, required) => required.filter((k) => typeof values[k] === 'number').length;

// ---------- Candidatos ----------
const palabras = (s) => normalizeText(s).split(/[^a-z0-9%]+/).filter((w) => w.length > 1);
// Una palabra casa con otra igual o, si ambas tienen 5+ letras, con la que empieza por ella ("commercial" ~ "commercially";
// con 4 letras "with" casaría con "without").
const casa = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
// Parte de las palabras del término que aparecen en la descripción de USDA (0..1). Solo para elegir el sugerido.
// USDA nombra "Categoría, tipo, ...": si la categoría del término ("Ham") no está en la primera parte de la
// descripción ("Peppers, serrano"), es otro alimento aunque comparta palabras, y el parecido se reduce a la mitad.
// Preparaciones que cambian mucho la grasa y las kcal. Si la descripción de USDA lleva una que el término no pide
// ("Squid, cooked" -> "..., cooked, fried"), es otro alimento: el parecido también se reduce a la mitad.
export const PREPARACIONES = ['fried', 'breaded', 'battered', 'coated', 'floured', 'with sauce', 'in sauce', 'with gravy', 'canned', 'in oil', 'in syrup', 'glazed'];
const prepRe = new Map(PREPARACIONES.map((p) => [p, new RegExp(`(^|[^a-z])${p.replace(' ', '\\s+')}($|[^a-z])`)]));
export const preparacionesDeMas = (termino, descripcion) => PREPARACIONES.filter((p) => prepRe.get(p).test(normalizeText(descripcion)) && !prepRe.get(p).test(normalizeText(termino)));

export function coincidencia(termino, descripcion) {
  const t = palabras(termino);
  if (!t.length) return 0;
  const d = palabras(descripcion);
  let ratio = t.filter((w) => d.some((x) => casa(w, x))).length / t.length;
  if (preparacionesDeMas(termino, descripcion).length) ratio /= 2;
  const categoria = palabras(descripcion.split(',')[0]);
  return categoria.some((x) => casa(t[0], x)) ? ratio : ratio / 2;
}

export function toCandidate(food, { termino, map, required }) {
  const m = mapNutrients(food, map);
  const obligatorios = countRequired(m.values, required);
  return {
    fdcId: food.fdcId, descripcion: food.description, tipo: food.dataType, estimado: food.dataType === FNDDS,
    obligatorios, total: required.length, ratio: obligatorios / required.length, coincidencia: coincidencia(termino, food.description),
    preparaciones: preparacionesDeMas(termino, food.description),
  };
}

// Orden pedido: por completitud (no por tipo), sin distinguir Foundation de SR Legacy; FNDDS siempre detrás.
export const sortCandidates = (cands) => [...cands].sort((a, b) => (a.estimado - b.estimado) || (b.ratio - a.ratio) || (b.coincidencia - a.coincidencia));

// Sugerido: Foundation/SR Legacy con completitud >= umbral (el que más se parece al término; a igualdad, el más
// completo). Si no hay ninguno, FNDDS con completitud >= umbral (marcado "estimado"). Si tampoco, el más completo.
// "motivo" explica la elección (va a eleccion.csv).
export const pct = (r) => `${Math.round(r * 100)} %`;
const datos = (c) => `completitud ${c.obligatorios}/${c.total} (${pct(c.ratio)}), parecido al término ${pct(c.coincidencia)}`;
// Primero el parecido: solo cuentan los candidatos más parecidos al término (si el correcto está incompleto, se
// sugiere incompleto antes que otro alimento completo: nunca "sésamo" por "chía"). Entre ellos, por este orden:
// Foundation/SR Legacy ≥ umbral; FNDDS ≥ umbral (estimado); el más completo.
export function suggest(cands, threshold) {
  if (!cands.length) return { candidato: null, estado: 'sin_candidatos', motivo: 'USDA no devolvió resultados para el término' };
  const top = Math.max(...cands.map((c) => c.coincidencia));
  const relevantes = cands.filter((c) => c.coincidencia + 1e-9 >= top);
  const masCompleto = (list) => [...list].sort((a, b) => b.ratio - a.ratio)[0];
  const ok = (c) => c.ratio + 1e-9 >= threshold;
  const umbral = pct(threshold);
  const entre = relevantes.length === 1 ? `(el más parecido al término, ${pct(top)})` : `entre los ${relevantes.length} más parecidos al término (${pct(top)})`;
  const principal = masCompleto(relevantes.filter((c) => !c.estimado && ok(c)));
  if (principal) return { candidato: principal, estado: 'completo', motivo: `Foundation/SR Legacy ≥ ${umbral} ${entre}: ${datos(principal)}` };
  const estimado = masCompleto(relevantes.filter((c) => c.estimado && ok(c)));
  if (estimado) return { candidato: estimado, estado: 'completo_estimado', motivo: `ningún Foundation/SR Legacy ≥ ${umbral} ${entre}; FNDDS (estimado): ${datos(estimado)}` };
  const mejor = masCompleto(relevantes);
  return { candidato: mejor, estado: 'incompleto', motivo: `ninguno llega al ${umbral} ${entre}; el más completo: ${datos(mejor)}` };
}

// La búsqueda de USDA interpreta / ( ) [ ] { } " ~ * ? : ^ ! + & | \ como sintaxis (la "/" da HTTP 400).
export const searchQuery = (termino) => termino.replace(/[\\/()[\]{}"~*?:^!+&|]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- Cliente HTTP ----------
// status: el HTTP de USDA (401/403 clave, 429 límite...), para que el Worker lo traduzca a su propio error.
export class UsdaError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// La clave va en la cabecera X-Api-Key, nunca en la URL, en la caché ni en los mensajes.
// cache (opcional): { get(kind, payload) -> datos | undefined, set(kind, payload, datos) }, síncrona o asíncrona.
export function createUsdaClient({ apiKey, fetchImpl = globalThis.fetch?.bind(globalThis), cache = null }) {
  let calls = 0;
  async function post(path, payload, kind) {
    const cached = cache ? await cache.get(kind, payload) : undefined;
    if (cached !== undefined) return cached;
    if (!apiKey) throw new UsdaError('Falta la variable USDA_API_KEY. Ponla en .env y ejecuta: node --env-file=.env scripts/usda.mjs ...', 500);
    calls++;
    const res = await fetchImpl(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }, body: JSON.stringify(payload) });
    if (res.status === 403 || res.status === 401) {
      // api.data.gov dice el motivo (API_KEY_INVALID, API_KEY_MISSING...); nunca incluye la clave.
      const code = await res.json().then((b) => b?.error?.code, () => null).catch(() => null);
      throw new UsdaError(`USDA rechazó la clave (HTTP ${res.status}${code ? `, ${code}` : ''}): revisa USDA_API_KEY`, res.status);
    }
    if (res.status === 429) throw new UsdaError('USDA: límite de llamadas alcanzado (1000/hora). Espera y vuelve a intentarlo: lo ya descargado está en caché.', 429);
    if (!res.ok) throw new UsdaError(`USDA respondió HTTP ${res.status} en ${path}`, res.status);
    const data = await res.json();
    if (cache) await cache.set(kind, payload, data);
    return data;
  }
  return {
    get calls() { return calls; },
    async search(query, dataType, pageSize) {
      const data = await post('/foods/search', { query, dataType, pageSize }, 'search');
      return data?.foods ?? [];
    },
    // Detalle completo, en bloques de 20 (límite de la API).
    async foods(fdcIds) {
      const out = [];
      for (let i = 0; i < fdcIds.length; i += 20) {
        const data = await post('/foods', { fdcIds: fdcIds.slice(i, i + 20), format: 'full' }, 'foods');
        out.push(...(Array.isArray(data) ? data : []));
      }
      return out;
    },
  };
}

// Candidatos de un término: primero Foundation + SR Legacy; FNDDS solo si ninguno llega al umbral (ahorra llamadas).
// fndds = false (Estimar con IA): solo Foundation y SR Legacy, una búsqueda por término.
export async function findCandidates(client, termino, { map, required, threshold, pageSize = 10, fndds = true }) {
  const ctx = { termino, map, required };
  const query = searchQuery(termino);
  let cands = (await client.search(query, PRINCIPALES, pageSize)).map((f) => toCandidate(f, ctx));
  if (fndds && suggest(cands, threshold).estado !== 'completo') {
    cands = cands.concat((await client.search(query, [FNDDS], MAX_CANDIDATOS)).map((f) => toCandidate(f, ctx)));
  }
  const sugerencia = suggest(cands, threshold);
  // Lista por completitud, pero el sugerido siempre aparece (si no está entre los 5 primeros, ocupa el último hueco).
  const lista = sortCandidates(cands).slice(0, MAX_CANDIDATOS);
  const s = sugerencia.candidato;
  if (s && !lista.includes(s)) lista.splice(MAX_CANDIDATOS - 1, 1, s);
  return { candidatos: lista, ...sugerencia };
}

// ---------- Revisión automática ----------
// Fortificación de EE. UU. (en España estos productos normalmente no están enriquecidos): para revisarlo a mano.
// "unenriched", "not fortified" y "without added" no cuentan. Como USDA no siempre da el ácido fólico (431), en
// cereales, panes, galletas, pastas, harinas y arroz también avisa si B1 o hierro son imposibles sin fortificar.
const CEREALES = /^(cereals|bread|cookies|crackers|pasta|spaghetti|macaroni|noodles|rice|flour|wheat flour)/i;
export function fortificacion(usda) {
  const motivos = [];
  const d = String(usda.description ?? '');
  // Sin lookbehind (la app también carga este módulo y Safari antiguos no lo entienden): la negación se descarta a mano.
  for (const re of [/\b(not |non-?)?(enriched)\b/gi, /\b(not |non-?)?(fortified)\b/gi, /\b()(with added)\b/gi]) {
    const m = [...d.matchAll(re)].find((x) => !x[1]);
    if (m) motivos.push(`la descripción dice "${m[2]}"`);
  }
  const n = usdaNutrients(usda);
  const folico = n.get('431');
  if (folico && folico.value > 0) motivos.push(`ácido fólico añadido (431) = ${folico.value} µg`);
  if (CEREALES.test(d)) {
    const b1 = n.get('404')?.value;
    const fe = n.get('303')?.value;
    if (b1 > 1.5) motivos.push(`B1 = ${b1} mg por 100 g: imposible sin fortificar en un cereal`);
    if (fe >= 10) motivos.push(`hierro = ${fe} mg por 100 g: imposible sin fortificar en un cereal`);
  }
  return motivos;
}

// Factores calóricos propios del alimento según USDA (p. ej. cacao 1,83/8,37/1,33), si los trae.
export function calorieFactors(usda) {
  const f = (usda?.nutrientConversionFactors ?? []).find((x) => String(x.type ?? '').includes('Calorie'));
  return f && [f.proteinValue, f.fatValue, f.carbohydrateValue].every((x) => typeof x === 'number') ? { p: f.proteinValue, g: f.fatValue, h: f.carbohydrateValue } : null;
}

// Valores imposibles o incoherentes por 100 g. "factores" = calorieFactors(usda); sin ellos, Atwater general.
export function valoresSospechosos(n, factores = null) {
  const v = (k) => (typeof n[k] === 'number' ? n[k] : null);
  const out = [];
  for (const [k, x] of Object.entries(n)) if (k.endsWith('_g') && x > 100) out.push(`${k} = ${x} g (> 100 g por 100 g)`);
  const kcal = v('energia_kcal');
  if (kcal !== null && (kcal < 0 || kcal > 900)) out.push(`energia_kcal = ${kcal} (fuera de 0–900)`);
  const p = v('proteina_g') ?? 0; const g = v('grasa_total_g') ?? 0; const h = v('hidratos_g') ?? 0;
  const suma = p + g + h + (v('agua_g') ?? 0) + (v('alcohol_g') ?? 0);
  if (suma > 102) out.push(`proteína + grasa + hidratos + agua + alcohol = ${redondea(suma)} g (> 100 g)`);
  if (v('fibra_g') !== null && v('hidratos_g') !== null && v('fibra_g') > v('hidratos_g') + 0.5) out.push(`fibra (${v('fibra_g')}) > hidratos (${v('hidratos_g')})`);
  if (v('azucares_g') !== null && v('hidratos_g') !== null && v('azucares_g') > v('hidratos_g') + 0.5) out.push(`azúcares (${v('azucares_g')}) > hidratos (${v('hidratos_g')})`);
  const grasas = ['grasas_saturadas_g', 'grasas_monoinsaturadas_g', 'grasas_poliinsaturadas_g'].map(v);
  if (grasas.every((x) => x !== null) && v('grasa_total_g') !== null && grasas.reduce((a, b) => a + b, 0) > v('grasa_total_g') * 1.05 + 0.5) out.push(`saturadas + mono + poli > grasa total (${v('grasa_total_g')})`);
  // Atwater: la energía no debería alejarse mucho de lo que dicen los macros. Con los factores propios del alimento
  // se usan esos (hidratos totales); si no, los generales 4/9/4/7 con la fibra a 2 kcal/g.
  if (kcal !== null && [v('proteina_g'), v('grasa_total_g'), v('hidratos_g')].every((x) => x !== null)) {
    const fib = v('fibra_g') ?? 0;
    const at = (factores ? factores.p * p + factores.g * g + factores.h * h : 4 * p + 9 * g + 4 * (h - fib) + 2 * fib) + 7 * (v('alcohol_g') ?? 0);
    if (Math.abs(kcal - at) > Math.max(25, 0.2 * at)) out.push(`energia_kcal = ${kcal}, pero los macros dan ≈ ${Math.round(at)} kcal`);
  }
  return out;
}

// ---------- Ficha de un alimento de USDA (lo que se escribe en el documento) ----------
// Valores por 100 g mapeados a columnas, avisos y el texto de fuente_usda. La usan el script ("filas") y la app
// (Estimar con IA, a través del Worker). "Sin enriquecer" vacía las columnas de map.enriquecimiento (mejor sin dato
// que inflado): con la opción aquí o después con quitarEnriquecimiento (la app la aplica sin volver a USDA).
const fuenteDe = (f) => [`${f.descripcion} (${f.tipo}${f.estimado ? ', estimado' : ''})`, ...f.notas].join(' · ');

export function quitarEnriquecimiento(ficha, columnas) {
  const values = { ...ficha.values };
  const vaciados = columnas.filter((k) => k in values);
  for (const k of vaciados) delete values[k];
  const notas = vaciados.length ? [...ficha.notas, `sin enriquecer: vacíos ${vaciados.join(', ')} (USDA está enriquecido)`] : [...ficha.notas];
  const out = { ...ficha, values, notas, vaciados };
  return { ...out, fuente: fuenteDe(out) };
}

export function fichaUsda(usda, map, { sinEnriquecer = false } = {}) {
  const m = mapNutrients(usda, map);
  const base = {
    fdcId: usda.fdcId, descripcion: usda.description, tipo: usda.dataType, estimado: usda.dataType === FNDDS,
    values: m.values, notas: m.notas, unidades: m.unidades, vaciados: [],
    fortificacion: fortificacion(usda), sospechosos: valoresSospechosos(m.values, calorieFactors(usda)),
  };
  base.fuente = fuenteDe(base);
  return sinEnriquecer ? quitarEnriquecimiento(base, map.enriquecimiento?.columnas ?? []) : base;
}
