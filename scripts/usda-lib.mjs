// Lógica del script de USDA (scripts/usda.mjs). Herramienta manual: la app NUNCA consulta USDA.
// Funciones puras + un cliente HTTP con fetch inyectable y caché en disco, para poder probarlo sin red.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeText } from '../frontend/js/core/text.js';
import { parseCSV, serializeCSV } from '../frontend/js/core/csv.js';

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
export function coincidencia(termino, descripcion) {
  const t = palabras(termino);
  if (!t.length) return 0;
  const d = palabras(descripcion);
  const ratio = t.filter((w) => d.some((x) => casa(w, x))).length / t.length;
  const categoria = palabras(descripcion.split(',')[0]);
  return categoria.some((x) => casa(t[0], x)) ? ratio : ratio / 2;
}

export function toCandidate(food, { termino, map, required }) {
  const m = mapNutrients(food, map);
  const obligatorios = countRequired(m.values, required);
  return {
    fdcId: food.fdcId, descripcion: food.description, tipo: food.dataType, estimado: food.dataType === FNDDS,
    obligatorios, total: required.length, ratio: obligatorios / required.length, coincidencia: coincidencia(termino, food.description),
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

// Alimentos del documento que se buscan y motivo de los que no.
export function searchPlan(foods) {
  return foods.map((f) => {
    const termino = (f.extra?.termino_busqueda_usda ?? '').trim();
    if (normalizeText(f.extra?.incluir) === 'no') return { food: f, termino, omitido: 'excluido (incluir=no)' };
    if (!termino) return { food: f, termino, omitido: 'sin termino_busqueda_usda' };
    if (termino.startsWith('(')) return { food: f, termino, omitido: 'receta por descomponer' };
    return { food: f, termino, omitido: null };
  });
}

// ---------- Cliente HTTP ----------
export class UsdaError extends Error {}

// La clave va en la cabecera X-Api-Key, nunca en la URL, en la caché ni en los mensajes.
export function createUsdaClient({ apiKey, fetchImpl = fetch, cacheDir = null }) {
  let calls = 0;
  const cachePath = (kind, payload) => cacheDir && resolve(cacheDir, `${kind}-${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}.json`);
  async function post(path, payload, kind) {
    const file = cachePath(kind, payload);
    if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (!apiKey) throw new UsdaError('Falta la variable USDA_API_KEY. Ponla en .env y ejecuta: node --env-file=.env scripts/usda.mjs ...');
    calls++;
    const res = await fetchImpl(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }, body: JSON.stringify(payload) });
    if (res.status === 403 || res.status === 401) {
      // api.data.gov dice el motivo (API_KEY_INVALID, API_KEY_MISSING...); nunca incluye la clave.
      const code = await res.json().then((b) => b?.error?.code, () => null).catch(() => null);
      throw new UsdaError(`USDA rechazó la clave (HTTP ${res.status}${code ? `, ${code}` : ''}): revisa USDA_API_KEY en .env`);
    }
    if (res.status === 429) throw new UsdaError('USDA: límite de llamadas alcanzado (1000/hora). Espera y vuelve a ejecutar: lo ya descargado está en caché.');
    if (!res.ok) throw new UsdaError(`USDA respondió HTTP ${res.status} en ${path}`);
    const data = await res.json();
    if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, JSON.stringify(data)); }
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
export async function findCandidates(client, termino, { map, required, threshold, pageSize = 10 }) {
  const ctx = { termino, map, required };
  const query = searchQuery(termino);
  let cands = (await client.search(query, PRINCIPALES, pageSize)).map((f) => toCandidate(f, ctx));
  if (suggest(cands, threshold).estado !== 'completo') {
    cands = cands.concat((await client.search(query, [FNDDS], MAX_CANDIDATOS)).map((f) => toCandidate(f, ctx)));
  }
  const sugerencia = suggest(cands, threshold);
  // Lista por completitud, pero el sugerido siempre aparece (si no está entre los 5 primeros, ocupa el último hueco).
  const lista = sortCandidates(cands).slice(0, MAX_CANDIDATOS);
  const s = sugerencia.candidato;
  if (s && !lista.includes(s)) lista.splice(MAX_CANDIDATOS - 1, 1, s);
  return { candidatos: lista, ...sugerencia };
}

// ---------- usda/eleccion.csv (para Excel en español: punto y coma y BOM) ----------
const tipoTexto = (c) => (c.estimado ? `${c.tipo} (estimado)` : c.tipo);
const oblTexto = (c) => `${c.obligatorios}/${c.total}`;
export const ELECCION_HEADER = ['id', 'nombre', 'termino_busqueda_usda', 'fdcId', 'sin_enriquecer', 'estado', 'sugerido', 'sugerido_descripcion', 'sugerido_tipo', 'sugerido_obligatorios', 'sugerido_parecido', 'motivo_sugerido',
  ...Array.from({ length: MAX_CANDIDATOS }, (_, i) => [`c${i + 1}_fdcId`, `c${i + 1}_descripcion`, `c${i + 1}_tipo`, `c${i + 1}_obligatorios`, `c${i + 1}_parecido`]).flat()];

// "previo" = elecciones de un eleccion.csv anterior (readEleccion): se conservan fdcId y sin_enriquecer.
export function eleccionCSV(rows, previo = []) {
  const antes = new Map(previo.map((e) => [e.id, e]));
  const out = [ELECCION_HEADER];
  for (const r of rows) {
    const s = r.candidato;
    const e = antes.get(r.id);
    const cells = [r.id, r.nombre, r.termino, e?.fdcId ?? '', e?.sinEnriquecer ? 'si' : '', r.estado, s?.fdcId ?? '', s?.descripcion ?? '', s ? tipoTexto(s) : '', s ? oblTexto(s) : '', s ? pct(s.coincidencia) : '', r.motivo ?? ''];
    for (let i = 0; i < MAX_CANDIDATOS; i++) {
      const c = r.candidatos?.[i];
      cells.push(c?.fdcId ?? '', c?.descripcion ?? '', c ? tipoTexto(c) : '', c ? oblTexto(c) : '', c ? pct(c.coincidencia) : '');
    }
    out.push(cells);
  }
  return serializeCSV(out, { delimiter: ';', bom: true, eol: '\r\n' });
}

// Lee la elección (con ; o con ,). Devuelve { elegidos: [{ id, fdcId, sinEnriquecer }], errores: [...] }.
export function readEleccion(text) {
  const table = parseCSV(text);
  const [header = [], ...rows] = table.rows;
  const col = (name) => header.findIndex((h) => normalizeText(h).replace(/^﻿/, '') === normalizeText(name));
  const iId = col('id');
  const iFdc = col('fdcId');
  const iSin = col('sin_enriquecer');
  if (iId < 0 || iFdc < 0) return { elegidos: [], errores: ['eleccion.csv: faltan las columnas "id" o "fdcId"'] };
  const elegidos = [];
  const errores = [];
  for (const cells of rows) {
    const id = String(cells[iId] ?? '').trim();
    const raw = String(cells[iFdc] ?? '').trim();
    if (!id || !raw) continue;
    if (!/^\d+$/.test(raw)) { errores.push(`${id}: fdcId "${raw}" no es un número`); continue; }
    elegidos.push({ id, fdcId: Number(raw), sinEnriquecer: iSin >= 0 && ['si', 'sí', 'x'].includes(normalizeText(cells[iSin])) });
  }
  return { elegidos, errores };
}

// ---------- Revisión automática ----------
// Fortificación de EE. UU. (en España estos productos normalmente no están enriquecidos): para revisarlo a mano.
// "unenriched", "not fortified" y "without added" no cuentan. Como USDA no siempre da el ácido fólico (431), en
// cereales, panes, galletas, pastas, harinas y arroz también avisa si B1 o hierro son imposibles sin fortificar.
const CEREALES = /^(cereals|bread|cookies|crackers|pasta|spaghetti|macaroni|noodles|rice|flour|wheat flour)/i;
export function fortificacion(usda) {
  const motivos = [];
  const d = String(usda.description ?? '');
  for (const re of [/(?<!\bnot |\bnon-?)\benriched\b/i, /(?<!\bnot |\bnon-?)\bfortified\b/i, /\bwith added\b/i]) {
    const m = d.match(re);
    if (m) motivos.push(`la descripción dice "${m[0]}"`);
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

// ---------- Filas propuestas ----------
// Rellena los nutrientes de los alimentos elegidos sobre una COPIA del documento. Por defecto no pisa celdas
// con valor (los choques se informan). Añade fdc_id y fuente_usda (columnas de trabajo).
export function applyUsda(foods, elegidos, usdaById, { map, sobrescribir = false }) {
  const resultado = [];
  const copia = foods.map((f) => ({ ...f, nutrients: { ...f.nutrients }, extra: { ...f.extra } }));
  const copiaById = new Map(copia.map((f) => [f.id, f]));
  for (const { id, fdcId, sinEnriquecer = false } of elegidos) {
    const food = copiaById.get(id);
    const usda = usdaById.get(fdcId);
    if (!food) { resultado.push({ id, fdcId, error: 'id no está en el documento' }); continue; }
    if (!usda) { resultado.push({ id, fdcId, error: 'USDA no devolvió ese fdcId' }); continue; }
    const m = mapNutrients(usda, map);
    const vaciados = sinEnriquecer ? (map.enriquecimiento?.columnas ?? []).filter((k) => k in m.values) : [];
    for (const k of vaciados) delete m.values[k];
    if (vaciados.length) m.notas.push(`sin enriquecer: vacíos ${vaciados.join(', ')} (USDA está enriquecido)`);
    const choques = [];
    for (const [k, v] of Object.entries(m.values)) {
      const actual = food.nutrients[k];
      if (typeof actual === 'number' && actual !== v && !sobrescribir) { choques.push(`${k}: documento ${actual}, USDA ${v} (se mantiene el del documento)`); continue; }
      food.nutrients[k] = v;
    }
    const estimado = usda.dataType === FNDDS;
    food.extra.fdc_id = String(fdcId);
    food.extra.fuente_usda = [`${usda.description} (${usda.dataType}${estimado ? ', estimado' : ''})`, ...m.notas].join(' · ');
    resultado.push({ id, fdcId, descripcion: usda.description, tipo: usda.dataType, estimado, notas: m.notas, unidades: m.unidades, choques,
      fortificacion: fortificacion(usda), sospechosos: valoresSospechosos(food.nutrients, calorieFactors(usda)), vaciados });
  }
  return { foods: copia, resultado };
}

// ---------- Informe (usda/informe.md) ----------
// La completitud se calcula con el mismo código que la app (completenessReport), para que coincida con
// "pendiente de completar".
export function informeMarkdown({ report, resultado, plan, elegidosIds, errores = [], labels, fecha }) {
  const perFood = new Map(report.perFood.map((p) => [p.id, p]));
  const omitidos = plan.filter((p) => p.omitido);
  const sinElegir = plan.filter((p) => !p.omitido && !elegidosIds.has(p.food.id));
  const L = [];
  L.push(`# Informe USDA (${fecha})`, '');
  L.push('Generado por `scripts/usda.mjs filas`. Revisa `usda/foods.propuesto.csv` antes de copiarlo a `data/foods.csv`.', '');
  L.push('## Resumen', '');
  L.push(`- Alimentos en el documento: ${report.summary.total}`);
  L.push(`- Completos (≥ ${pct(report.summary.threshold)} de ${report.summary.requiredCount} obligatorios): ${report.summary.complete}`);
  L.push(`- Incompletos: ${report.summary.incomplete}`);
  L.push(`- Con fdcId elegido: ${resultado.filter((r) => !r.error).length}`);
  L.push(`- Buscables sin fdcId elegido: ${sinElegir.length}`);
  L.push(`- Omitidos (excluidos, sin término o recetas): ${omitidos.length}`, '');
  if (errores.length || resultado.some((r) => r.error)) {
    L.push('## Errores', '');
    for (const e of errores) L.push(`- ${e}`);
    for (const r of resultado.filter((x) => x.error)) L.push(`- ${r.id} (fdcId ${r.fdcId}): ${r.error}`);
    L.push('');
  }
  const ok = resultado.filter((x) => !x.error);
  L.push('## Avisos de fortificación (revisar contra el envase)', '');
  const fort = ok.filter((r) => r.fortificacion.length);
  if (!fort.length) L.push('- Ninguno.');
  for (const r of fort) L.push(`- ${r.id} (fdcId ${r.fdcId}, ${r.descripcion}): ${r.fortificacion.join('; ')}${r.vaciados.length ? ` — vaciados: ${r.vaciados.join(', ')}` : ''}`);
  L.push('', '## Valores sospechosos', '');
  const sosp = ok.filter((r) => r.sospechosos.length);
  if (!sosp.length) L.push('- Ninguno (kcal 0–900, ningún valor en g por encima de 100, macros + agua ≤ 100 g, fibra y azúcares ≤ hidratos, ácidos grasos ≤ grasa total, energía coherente con los macros).');
  for (const r of sosp) L.push(`- ${r.id}: ${r.sospechosos.join('; ')}`);
  L.push('');
  L.push('## Alimentos con datos de USDA', '');
  for (const r of resultado.filter((x) => !x.error)) {
    const p = perFood.get(r.id);
    L.push(`### ${r.id}`, '');
    L.push(`- USDA: ${r.descripcion} — fdcId ${r.fdcId} — ${r.tipo}${r.estimado ? ' (**estimado**)' : ''}`);
    L.push(`- Obligatorios: ${p.filled}/${p.total} (${pct(p.ratio)})${p.incomplete ? ' — **incompleto**' : ''}`);
    if (p.missing.length) L.push(`- Faltan: ${p.missing.map((k) => labels.get(k) ?? k).join(', ')}`);
    for (const n of r.notas) L.push(`- Alternativa usada: ${n}`);
    for (const u of r.unidades) L.push(`- Unidad no coincide (no se rellena): ${u}`);
    for (const c of r.choques) L.push(`- Choque con tu documento: ${c}`);
    for (const f of r.fortificacion) L.push(`- ⚠ Fortificación: ${f}${r.vaciados.length ? ' (enriquecimiento vaciado)' : ''}`);
    for (const x of r.sospechosos) L.push(`- ⚠ Valor sospechoso: ${x}`);
    L.push('');
  }
  L.push('## Incompletos, de peor a mejor', '');
  for (const p of report.incomplete) L.push(`- ${p.id}: ${p.filled}/${p.total} (${pct(p.ratio)})${elegidosIds.has(p.id) ? '' : ' — sin datos de USDA'}`);
  L.push('');
  if (sinElegir.length) {
    L.push('## Buscables sin fdcId elegido', '');
    for (const p of sinElegir) L.push(`- ${p.food.id}: "${p.termino}"`);
    L.push('');
  }
  if (omitidos.length) {
    L.push('## Para resolver a mano', '');
    for (const p of omitidos) L.push(`- ${p.food.id}: ${p.omitido}${p.termino ? ` ("${p.termino}")` : ''}`);
    L.push('');
  }
  return L.join('\n');
}

// ---------- Orquestación (la usa el CLI; aquí para poder probarla con un cliente simulado) ----------
export async function runCandidatos({ client, foods, map, required, threshold, onProgress = () => {} }) {
  const plan = searchPlan(foods);
  const rows = [];
  for (const p of plan) {
    const base = { id: p.food.id, nombre: p.food.nombre, termino: p.termino };
    if (p.omitido) { rows.push({ ...base, estado: `omitido: ${p.omitido}`, candidatos: [], candidato: null }); continue; }
    const r = await findCandidates(client, p.termino, { map, required, threshold });
    rows.push({ ...base, ...r });
    onProgress(base.id, r);
  }
  const cuenta = (e) => rows.filter((r) => r.estado === e).length;
  const resumen = {
    completo: cuenta('completo'), completo_estimado: cuenta('completo_estimado'), incompleto: cuenta('incompleto'),
    sin_candidatos: cuenta('sin_candidatos'), omitidos: rows.filter((r) => r.estado.startsWith('omitido')).length, llamadas: client.calls,
  };
  return { rows, plan, resumen };
}

// Solo se aplican los alimentos que "candidatos" busca: los omitidos (incluir=no, sin término o recetas, p. ej. con
// datos de BEDCA o de una etiqueta) se saltan aunque tengan fdcId en eleccion.csv, para no pisar sus datos.
export async function runFilas({ client, foods, eleccionText, map, sobrescribir = false }) {
  const { elegidos: todos, errores } = readEleccion(eleccionText);
  const plan = searchPlan(foods);
  const omitidos = new Map(plan.filter((x) => x.omitido).map((x) => [x.food.id, x.omitido]));
  const saltados = todos.filter((e) => omitidos.has(e.id));
  const elegidos = todos.filter((e) => !omitidos.has(e.id));
  for (const e of saltados) errores.push(`${e.id}: no se aplica el fdcId ${e.fdcId} porque el alimento no se busca en USDA (${omitidos.get(e.id)})`);
  const usda = await client.foods([...new Set(elegidos.map((e) => e.fdcId))]);
  const usdaById = new Map(usda.map((f) => [f.fdcId, f]));
  const { foods: propuestos, resultado } = applyUsda(foods, elegidos, usdaById, { map, sobrescribir });
  return { propuestos, resultado, errores, elegidosIds: new Set(elegidos.map((e) => e.id)), plan };
}
