// Validación en código de la respuesta de «Más ideas» de ¿Qué ceno? (la usan el Worker y la app). La IA solo propone
// combinaciones de ids del catálogo enviado con gramos típicos; aquí se descarta todo lo inválido. Nunca nutrientes:
// los gramos finales y los nutrientes los calcula core/cenas.js desde el documento.
import { MAX_GRAMS } from './ai-contract.js';

export const MAX_CENAS_IA = 5;
export const MAX_LINEAS_CENA = 8;
export const MAX_DEFICITS = 8;
export const MAX_DEFICIT_CHARS = 40;
const MAX_NOMBRE = 80;

// Papeles de un alimento en una cena (columna rol_cena del documento). Es un dato del catálogo, no un nutriente: la app lo
// envía en la lista compacta de /cenas para que la IA sepa qué alimentos son proteína, hidrato o verdura.
export const ROLES_CENA = ['proteina', 'hidrato', 'verdura', 'plato', 'grasa', 'salsa', 'postre_base', 'postre_extra', 'fruta', 'otro'];

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

// data: JSON del modelo; compactList: lo que se le envió; roles: { food_id: rol } (para exigir proteína o plato; la app lo
// saca de la columna rol_cena del documento. Sin `roles` (el Worker no los conoce) no se comprueba).
// -> { ok, cenas: [{ nombre, lineas: [{ food_id, gramos }] }], warnings, recibidas, descartes } o { ok: false, error, recibidas, descartes }.
// `recibidas`: cenas que mandó la IA; `descartes`: cuántas se descartaron por cada motivo principal
// ({ fuera_catalogo, gramos, sin_proteina }); `ids_fuera`: algunos ids que no están en el catálogo (para el diagnóstico).
export function normalizeCenas(data, compactList, { roles = null } = {}) {
  const ids = new Set(compactList.map((f) => f.id));
  const warnings = [];
  const cenas = [];
  const descartes = { fuera_catalogo: 0, gramos: 0, sin_proteina: 0 };
  const idsFuera = new Set();
  const brutas = Array.isArray(data?.cenas) ? data.cenas : [];
  for (const raw of brutas) {
    if (cenas.length >= MAX_CENAS_IA) { warnings.push(`más de ${MAX_CENAS_IA} cenas: se quedan las primeras`); break; }
    const nombre = texto(raw?.nombre, MAX_NOMBRE) || `Cena ${cenas.length + 1}`;
    const porId = new Map();
    let fuera = 0;
    let malGramos = 0;
    for (const l of Array.isArray(raw?.lineas) ? raw.lineas : []) {
      const id = typeof l?.id === 'string' ? l.id.trim() : '';
      if (!ids.has(id)) { fuera++; idsFuera.add(id || '?'); warnings.push(`«${nombre}»: el alimento "${id || '?'}" no está en tu catálogo, se quita`); continue; }
      if (typeof l.gramos !== 'number' || !Number.isFinite(l.gramos) || l.gramos <= 0 || l.gramos > MAX_GRAMS) { malGramos++; warnings.push(`«${nombre}»: gramos no válidos en "${id}", se quita`); continue; }
      porId.set(id, (porId.get(id) ?? 0) + l.gramos); // el mismo alimento dos veces: se suman
    }
    const lineas = [...porId].slice(0, MAX_LINEAS_CENA).map(([food_id, gramos]) => ({ food_id, gramos: Math.round(gramos * 10) / 10 })).filter((l) => l.gramos <= MAX_GRAMS);
    if (!lineas.length) {
      descartes[fuera >= malGramos ? 'fuera_catalogo' : 'gramos']++;
      warnings.push(`«${nombre}»: sin alimentos válidos, se descarta`);
      continue;
    }
    if (roles && !lineas.some((l) => ['proteina', 'plato'].includes(roles[l.food_id]))) { descartes.sin_proteina++; warnings.push(`«${nombre}»: sin proteína, se descarta`); continue; }
    cenas.push({ nombre, lineas });
  }
  const extra = { recibidas: brutas.length, descartes, ids_fuera: [...idsFuera].slice(0, 5) };
  if (!cenas.length) return { ok: false, error: 'ninguna cena válida', ...extra };
  return { ok: true, cenas, warnings, ...extra };
}

// «La IA propuso 3 cenas, pero ninguna vale: 2 sin proteína ni plato y 1 con alimentos que no están en tu catálogo.»
// A partir del resultado de normalizeCenas (ok o no): agrupa los descartes por motivo. Con alguna válida y ninguna
// descartada, devuelve ''.
const MOTIVOS_TEXTO = [
  ['sin_proteina', (n) => `${n} sin proteína ni plato`],
  ['fuera_catalogo', (n) => `${n} con alimentos que no están en tu catálogo`],
  ['gramos', (n) => `${n} con gramos no válidos`],
];
export function textoDescarteCenas({ recibidas = 0, descartes = {}, cenas = [] } = {}) {
  const cuenta = (x) => `${x} ${x === 1 ? 'cena' : 'cenas'}`;
  const partes = MOTIVOS_TEXTO.filter(([k]) => descartes[k] > 0).map(([k, f]) => f(descartes[k]));
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : (partes[0] ?? '');
  if (!cenas.length) {
    if (!recibidas) return 'La IA no propuso ninguna cena.';
    return `La IA propuso ${cuenta(recibidas)}, pero ninguna vale${lista ? `: ${lista}` : ''}.`;
  }
  const quitadas = Object.values(descartes).reduce((a, b) => a + b, 0);
  return quitadas ? `La IA propuso ${cuenta(recibidas)} y se descartaron ${quitadas}${lista ? `: ${lista}` : ''}.` : '';
}
