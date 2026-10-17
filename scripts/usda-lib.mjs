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
// Parte de las palabras del término que aparecen en la descripción de USDA (0..1). Solo para elegir el sugerido.
export function coincidencia(termino, descripcion) {
  const t = palabras(termino);
  if (!t.length) return 0;
  const d = new Set(palabras(descripcion));
  return t.filter((w) => d.has(w)).length / t.length;
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
export function suggest(cands, threshold) {
  const best = (list) => [...list].sort((a, b) => (b.coincidencia - a.coincidencia) || (b.ratio - a.ratio))[0];
  const ok = (c) => c.ratio + 1e-9 >= threshold;
  const principal = best(cands.filter((c) => !c.estimado && ok(c)));
  if (principal) return { candidato: principal, estado: 'completo' };
  const estimado = best(cands.filter((c) => c.estimado && ok(c)));
  if (estimado) return { candidato: estimado, estado: 'completo_estimado' };
  if (!cands.length) return { candidato: null, estado: 'sin_candidatos' };
  return { candidato: [...cands].sort((a, b) => (b.ratio - a.ratio) || (b.coincidencia - a.coincidencia))[0], estado: 'incompleto' };
}

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
  let cands = (await client.search(termino, PRINCIPALES, pageSize)).map((f) => toCandidate(f, ctx));
  if (!cands.some((c) => c.ratio + 1e-9 >= threshold)) {
    cands = cands.concat((await client.search(termino, [FNDDS], MAX_CANDIDATOS)).map((f) => toCandidate(f, ctx)));
  }
  const sugerencia = suggest(cands, threshold);
  return { candidatos: sortCandidates(cands).slice(0, MAX_CANDIDATOS), ...sugerencia };
}

// ---------- usda/eleccion.csv (para Excel en español: punto y coma y BOM) ----------
const tipoTexto = (c) => (c.estimado ? `${c.tipo} (estimado)` : c.tipo);
const oblTexto = (c) => `${c.obligatorios}/${c.total}`;
export const ELECCION_HEADER = ['id', 'nombre', 'termino_busqueda_usda', 'fdcId', 'estado', 'sugerido', 'sugerido_descripcion', 'sugerido_tipo', 'sugerido_obligatorios',
  ...Array.from({ length: MAX_CANDIDATOS }, (_, i) => [`c${i + 1}_fdcId`, `c${i + 1}_descripcion`, `c${i + 1}_tipo`, `c${i + 1}_obligatorios`]).flat()];

export function eleccionCSV(rows) {
  const out = [ELECCION_HEADER];
  for (const r of rows) {
    const s = r.candidato;
    const cells = [r.id, r.nombre, r.termino, '', r.estado, s?.fdcId ?? '', s?.descripcion ?? '', s ? tipoTexto(s) : '', s ? oblTexto(s) : ''];
    for (let i = 0; i < MAX_CANDIDATOS; i++) {
      const c = r.candidatos?.[i];
      cells.push(c?.fdcId ?? '', c?.descripcion ?? '', c ? tipoTexto(c) : '', c ? oblTexto(c) : '');
    }
    out.push(cells);
  }
  return serializeCSV(out, { delimiter: ';', bom: true, eol: '\r\n' });
}

// Lee la elección (con ; o con ,). Devuelve { elegidos: [{ id, fdcId }], errores: [...] }.
export function readEleccion(text) {
  const table = parseCSV(text);
  const [header = [], ...rows] = table.rows;
  const col = (name) => header.findIndex((h) => normalizeText(h).replace(/^﻿/, '') === normalizeText(name));
  const iId = col('id');
  const iFdc = col('fdcId');
  if (iId < 0 || iFdc < 0) return { elegidos: [], errores: ['eleccion.csv: faltan las columnas "id" o "fdcId"'] };
  const elegidos = [];
  const errores = [];
  for (const cells of rows) {
    const id = String(cells[iId] ?? '').trim();
    const raw = String(cells[iFdc] ?? '').trim();
    if (!id || !raw) continue;
    if (!/^\d+$/.test(raw)) { errores.push(`${id}: fdcId "${raw}" no es un número`); continue; }
    elegidos.push({ id, fdcId: Number(raw) });
  }
  return { elegidos, errores };
}

// ---------- Filas propuestas ----------
// Rellena los nutrientes de los alimentos elegidos sobre una COPIA del documento. Por defecto no pisa celdas
// con valor (los choques se informan). Añade fdc_id y fuente_usda (columnas de trabajo).
export function applyUsda(foods, elegidos, usdaById, { map, sobrescribir = false }) {
  const resultado = [];
  const copia = foods.map((f) => ({ ...f, nutrients: { ...f.nutrients }, extra: { ...f.extra } }));
  const copiaById = new Map(copia.map((f) => [f.id, f]));
  for (const { id, fdcId } of elegidos) {
    const food = copiaById.get(id);
    const usda = usdaById.get(fdcId);
    if (!food) { resultado.push({ id, fdcId, error: 'id no está en el documento' }); continue; }
    if (!usda) { resultado.push({ id, fdcId, error: 'USDA no devolvió ese fdcId' }); continue; }
    const m = mapNutrients(usda, map);
    const choques = [];
    for (const [k, v] of Object.entries(m.values)) {
      const actual = food.nutrients[k];
      if (typeof actual === 'number' && actual !== v && !sobrescribir) { choques.push(`${k}: documento ${actual}, USDA ${v} (se mantiene el del documento)`); continue; }
      food.nutrients[k] = v;
    }
    const estimado = usda.dataType === FNDDS;
    food.extra.fdc_id = String(fdcId);
    food.extra.fuente_usda = [`${usda.description} (${usda.dataType}${estimado ? ', estimado' : ''})`, ...m.notas].join(' · ');
    resultado.push({ id, fdcId, descripcion: usda.description, tipo: usda.dataType, estimado, notas: m.notas, unidades: m.unidades, choques });
  }
  return { foods: copia, resultado };
}

// ---------- Informe (usda/informe.md) ----------
// La completitud se calcula con el mismo código que la app (completenessReport), para que coincida con
// "pendiente de completar".
export function informeMarkdown({ report, resultado, plan, elegidosIds, errores = [], labels, fecha }) {
  const pct = (r) => `${Math.round(r * 100)} %`;
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

export async function runFilas({ client, foods, eleccionText, map, sobrescribir = false }) {
  const { elegidos, errores } = readEleccion(eleccionText);
  const usda = await client.foods([...new Set(elegidos.map((e) => e.fdcId))]);
  const usdaById = new Map(usda.map((f) => [f.fdcId, f]));
  const { foods: propuestos, resultado } = applyUsda(foods, elegidos, usdaById, { map, sobrescribir });
  return { propuestos, resultado, errores, elegidosIds: new Set(elegidos.map((e) => e.id)), plan: searchPlan(foods) };
}
