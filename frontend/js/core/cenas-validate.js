// Validación en código de la respuesta de «Más ideas» de ¿Qué ceno? (la usan el Worker y la app). La IA solo propone
// combinaciones de ids del catálogo enviado con gramos típicos; aquí se descarta todo lo inválido. Nunca nutrientes:
// los gramos finales y los nutrientes los calcula core/cenas.js desde el documento.
import { MAX_GRAMS } from './ai-contract.js';

export const MAX_CENAS_IA = 5;
export const MAX_LINEAS_CENA = 8;
export const MAX_DEFICITS = 8;
export const MAX_DEFICIT_CHARS = 40;
const MAX_NOMBRE = 80;

const texto = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// `deficits` que acepta el Worker: solo una lista de nombres cortos, sin dígitos (ni cantidades ni %). null = inválido.
export function checkDeficits(d) {
  if (!Array.isArray(d) || d.length > MAX_DEFICITS) return null;
  const out = [];
  for (const x of d) {
    if (typeof x !== 'string') return null;
    const s = x.trim().replace(/\s+/g, ' ');
    if (!s || s.length > MAX_DEFICIT_CHARS || /\d/.test(s)) return null;
    out.push(s);
  }
  return out;
}

export function checkCenasStructure(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'la respuesta no es un objeto' };
  if (!Array.isArray(data.cenas) || !data.cenas.length) return { ok: false, error: 'falta "cenas" (lista no vacía)' };
  return { ok: true };
}

// data: JSON del modelo; compactList: lo que se le envió; roles: { food_id: rol } (para exigir proteína o plato).
// -> { ok, cenas: [{ nombre, lineas: [{ food_id, gramos }] }], warnings } o { ok: false, error }.
export function normalizeCenas(data, compactList, { roles = {} } = {}) {
  const ids = new Set(compactList.map((f) => f.id));
  const warnings = [];
  const cenas = [];
  for (const raw of Array.isArray(data?.cenas) ? data.cenas : []) {
    if (cenas.length >= MAX_CENAS_IA) { warnings.push(`más de ${MAX_CENAS_IA} cenas: se quedan las primeras`); break; }
    const nombre = texto(raw?.nombre, MAX_NOMBRE) || `Cena ${cenas.length + 1}`;
    const porId = new Map();
    for (const l of Array.isArray(raw?.lineas) ? raw.lineas : []) {
      const id = typeof l?.id === 'string' ? l.id.trim() : '';
      if (!ids.has(id)) { warnings.push(`«${nombre}»: el alimento "${id || '?'}" no está en tu catálogo, se quita`); continue; }
      if (typeof l.gramos !== 'number' || !Number.isFinite(l.gramos) || l.gramos <= 0 || l.gramos > MAX_GRAMS) { warnings.push(`«${nombre}»: gramos no válidos en "${id}", se quita`); continue; }
      porId.set(id, (porId.get(id) ?? 0) + l.gramos); // el mismo alimento dos veces: se suman
    }
    const lineas = [...porId].slice(0, MAX_LINEAS_CENA).map(([food_id, gramos]) => ({ food_id, gramos: Math.round(gramos * 10) / 10 })).filter((l) => l.gramos <= MAX_GRAMS);
    if (!lineas.some((l) => ['proteina', 'plato'].includes(roles[l.food_id]))) { warnings.push(`«${nombre}»: sin proteína, se descarta`); continue; }
    cenas.push({ nombre, lineas });
  }
  if (!cenas.length) return { ok: false, error: 'ninguna cena válida' };
  return { ok: true, cenas, warnings };
}
