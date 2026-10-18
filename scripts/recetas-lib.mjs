// Lógica del script de recetas (scripts/recetas.mjs). Herramienta manual, fuera de la app.
// Una receta es una fila más del catálogo: sus nutrientes por 100 g de plato cocinado se calculan, de forma
// determinista, con los nutrientes del propio catálogo y los gramos de data/recetas.json. Formato en data/SCHEMA.md.
import { parseCSV, serializeCSV, detectDelimiter } from '../frontend/js/core/csv.js';
import { normalizeText } from '../frontend/js/core/text.js';

export const ESTADO_RECETA = 'cocinado';
export const NOTA_RECETA = 'Gramos del plato cocinado';
export const TERMINO_RECETA = '(receta: data/recetas.json)'; // empieza por "(": usda.mjs la omite como receta
const ID_RE = /^[a-z0-9_]+$/;

const redondea = (x) => Math.round(x * 1000) / 1000;
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);
const aLista = (v) => (Array.isArray(v) ? v : String(v ?? '').split('|')).map((s) => String(s).trim()).filter(Boolean);

// Acepta { "recetas": [...] } o directamente la lista. Devuelve { recetas, errores }.
export function parseRecetas(text) {
  let data;
  try { data = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { return { recetas: [], errores: [`JSON no válido: ${e.message}`] }; }
  const recetas = Array.isArray(data) ? data : data?.recetas;
  if (!Array.isArray(recetas)) return { recetas: [], errores: ['falta la lista "recetas"'] };
  return { recetas, errores: [] };
}

// Errores que impiden calcular. foodsById: Map id -> alimento del catálogo (también los incluir=no).
export function validateRecetas(recetas, foodsById) {
  const errores = [];
  const ids = new Set();
  const idsRecetas = new Set(recetas.map((r) => r?.id));
  recetas.forEach((r, i) => {
    const q = `receta ${r?.id ? `"${r.id}"` : `nº ${i + 1}`}`;
    if (!r || typeof r !== 'object') { errores.push(`${q}: no es un objeto`); return; }
    if (!ID_RE.test(r.id ?? '')) errores.push(`${q}: id vacío o no válido (minúsculas, números y _)`);
    else if (ids.has(r.id)) errores.push(`${q}: id repetido`);
    ids.add(r.id);
    if (!String(r.nombre ?? '').trim()) errores.push(`${q}: falta el nombre`);
    if (r.peso_final_g !== undefined && !(esNumero(r.peso_final_g) && r.peso_final_g > 0)) errores.push(`${q}: peso_final_g debe ser un número mayor que 0`);
    if (!Array.isArray(r.ingredientes) || r.ingredientes.length === 0) { errores.push(`${q}: sin ingredientes`); return; }
    r.ingredientes.forEach((ing, j) => {
      const qi = `${q}, ingrediente ${j + 1}`;
      if (!foodsById.has(ing?.food_id)) errores.push(`${qi}: "${ing?.food_id}" no está en el catálogo`);
      else if (idsRecetas.has(ing.food_id)) errores.push(`${qi}: "${ing.food_id}" es otra receta (no se anidan: pon sus ingredientes)`);
      if (!(esNumero(ing?.gramos) && ing.gramos > 0)) errores.push(`${qi}: gramos debe ser un número mayor que 0`);
    });
  });
  return errores;
}

// Nutrientes por 100 g de plato cocinado. Sin peso_final_g, el peso final es la suma de los ingredientes (sirve
// para dar proporciones). Si un ingrediente no tiene dato de un nutriente, la receta queda SIN DATO en ese
// nutriente (nunca un total parcial que parezca completo). El cambio de peso al cocinar se asume que es agua:
// agua final = agua de los ingredientes + (peso final − peso de los ingredientes).
export function computeReceta(receta, foodsById, keys) {
  const pesoIngredientes = receta.ingredientes.reduce((s, i) => s + i.gramos, 0);
  const pesoFinal = receta.peso_final_g ?? pesoIngredientes;
  const nutrients = {};
  const sinDato = {}; // nutriente -> ids de ingredientes sin dato
  const avisos = [];
  for (const k of keys) {
    const faltan = receta.ingredientes.filter((i) => !esNumero(foodsById.get(i.food_id).nutrients[k])).map((i) => i.food_id);
    if (faltan.length) { sinDato[k] = [...new Set(faltan)]; continue; }
    let total = receta.ingredientes.reduce((s, i) => s + (foodsById.get(i.food_id).nutrients[k] * i.gramos) / 100, 0);
    if (k === 'agua_g') {
      total += pesoFinal - pesoIngredientes;
      if (total < 0) { avisos.push(`el peso final (${pesoFinal} g) pierde más agua de la que tienen los ingredientes: agua sin dato`); continue; }
    }
    nutrients[k] = redondea((total / pesoFinal) * 100);
  }
  if (pesoFinal < 0.3 * pesoIngredientes) avisos.push(`peso final (${pesoFinal} g) menor que el 30 % de los ingredientes (${pesoIngredientes} g): ¿está bien pesado?`);
  return { id: receta.id, nutrients, sinDato, avisos, pesoIngredientes, pesoFinal };
}

const resumenIngredientes = (r) => r.ingredientes.map((i) => `${i.food_id} ${i.gramos} g`).join(', ');
export const fuenteReceta = (r, res) => `Receta (data/recetas.json): ${resumenIngredientes(r)}; ${r.peso_final_g ? `peso final ${res.pesoFinal} g` : 'sin peso final: proporciones de los ingredientes'}`;

// Escribe las recetas calculadas en el texto CSV del catálogo, conservando el resto tal cual (separador, BOM,
// fin de línea; coma decimal si el separador es ";"). Crea la fila si no existe. Las recetas "ejemplo" nunca se
// escriben. Devuelve { text, cambios: [{ id, nueva }], omitidas: [ids] }.
export function aplicarRecetas(csvText, recetas, resultados, keys) {
  const bom = csvText.startsWith('﻿');
  const eol = /\r\n/.test(csvText) ? '\r\n' : '\n';
  const delimiter = detectDelimiter(csvText);
  const decimalComma = delimiter === ';';
  const { rows } = parseCSV(csvText, delimiter);
  const header = rows[0];
  const col = (name) => {
    let i = header.findIndex((h) => normalizeText(h) === name);
    if (i < 0) { header.push(name); for (const r of rows.slice(1)) r.length = Math.max(r.length, header.length); i = header.length - 1; }
    return i;
  };
  const num = (n) => (decimalComma ? String(n).replace('.', ',') : String(n));
  const cambios = [];
  const omitidas = [];
  const resById = new Map(resultados.map((r) => [r.id, r]));
  for (const receta of recetas) {
    if (receta.ejemplo) { omitidas.push(receta.id); continue; }
    const res = resById.get(receta.id);
    const iId = col('id');
    let row = rows.slice(1).find((r) => r[iId] === receta.id);
    const nueva = !row;
    if (nueva) { row = header.map(() => ''); row[iId] = receta.id; rows.push(row); }
    for (let i = 0; i < header.length; i++) row[i] ??= '';
    const set = (name, value) => { row[col(name)] = value; };
    set('nombre', receta.nombre);
    if (receta.alias !== undefined) set('alias', aLista(receta.alias).join('|'));
    set('estado', ESTADO_RECETA);
    set('peso_en_crudo', '');
    if (nueva) { set('variante_por_defecto', 'si'); set('grupo', receta.id); set('tipo', 'receta'); }
    set('incluir', 'si');
    set('termino_busqueda_usda', TERMINO_RECETA);
    set('fdc_id', '');
    set('fuente_usda', fuenteReceta(receta, res));
    set('notas', [`${NOTA_RECETA}.`, receta.notas].filter(Boolean).join(' '));
    for (const k of keys) set(k, k in res.nutrients ? num(res.nutrients[k]) : '');
    cambios.push({ id: receta.id, nueva });
  }
  for (const r of rows) while (r.length < header.length) r.push('');
  return { text: serializeCSV(rows, { delimiter, bom, eol }), cambios, omitidas };
}

// Obligatorios rellenos de una receta calculada.
export const completitud = (res, required) => required.filter((k) => k in res.nutrients).length;
