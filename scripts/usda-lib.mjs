// Lógica del script de USDA (scripts/usda.mjs). Herramienta manual para mantener el catálogo.
// Lo puro (mapeo, candidatos, sugerido, cliente HTTP, fortificación, valores sospechosos) vive en
// frontend/js/core/usda-core.js, compartido con el Worker («Estimar con IA»). Aquí, lo del script: caché en disco,
// eleccion.csv, filas propuestas e informe. Se prueba sin red (fetch inyectable).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeText } from '../frontend/js/core/text.js';
import { parseCSV, serializeCSV } from '../frontend/js/core/csv.js';
import {
  MAX_CANDIDATOS, pct, findCandidates, calorieFactors, valoresSospechosos, fichaUsda, createUsdaClient as createCoreClient,
} from '../frontend/js/core/usda-core.js';

export {
  API, PRINCIPALES, FNDDS, MAX_CANDIDATOS, usdaNutrients, mapNutrients, countRequired, coincidencia, toCandidate, sortCandidates,
  pct, suggest, searchQuery, UsdaError, findCandidates, fortificacion, calorieFactors, valoresSospechosos, fichaUsda,
} from '../frontend/js/core/usda-core.js';

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

// ---------- Cliente HTTP con caché en disco ----------
// La clave va en la cabecera X-Api-Key, nunca en la URL, en la caché ni en los mensajes.
export function createUsdaClient({ apiKey, fetchImpl = fetch, cacheDir = null }) {
  const file = (kind, payload) => resolve(cacheDir, `${kind}-${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}.json`);
  const cache = cacheDir ? {
    get(kind, payload) { const f = file(kind, payload); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined; },
    set(kind, payload, data) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file(kind, payload), JSON.stringify(data)); },
  } : null;
  return createCoreClient({ apiKey, fetchImpl, cache });
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
    const ficha = fichaUsda(usda, map, { sinEnriquecer });
    const choques = [];
    for (const [k, v] of Object.entries(ficha.values)) {
      const actual = food.nutrients[k];
      if (typeof actual === 'number' && actual !== v && !sobrescribir) { choques.push(`${k}: documento ${actual}, USDA ${v} (se mantiene el del documento)`); continue; }
      food.nutrients[k] = v;
    }
    food.extra.fdc_id = String(fdcId);
    food.extra.fuente_usda = ficha.fuente;
    resultado.push({ id, fdcId, descripcion: ficha.descripcion, tipo: ficha.tipo, estimado: ficha.estimado, notas: ficha.notas, unidades: ficha.unidades, choques,
      fortificacion: ficha.fortificacion, sospechosos: valoresSospechosos(food.nutrients, calorieFactors(usda)), vaciados: ficha.vaciados });
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
