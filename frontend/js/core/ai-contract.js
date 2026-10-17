// Contrato compartido cliente/worker: qué viaja a la IA (lista compacta SIN nutrientes) y cómo se detecta el estado.
// El prompt y el esquema de salida viven en worker/src/prompt.js (para ajustarlos sin tocar la app).
import { normalizeText } from './text.js';

export const MAX_GRAMS = 2000; // por encima se pide confirmación

// Alimento -> forma compacta que viaja a internet: id, nombre, alias, porciones y datos de variante.
export function toCompact(food) {
  const c = { id: food.id, nombre: food.nombre };
  if (food.alias?.length) c.alias = [...food.alias];
  if (food.porciones?.length) c.porciones = food.porciones.map((p) => ({ nombre: p.nombre, gramos: p.gramos }));
  if (food.estado) c.estado = food.estado;
  if (food.grupo) { c.grupo = food.grupo; c.defecto = food.varianteDefecto === true; }
  return c;
}

// Los alimentos con incluir=no (columna de trabajo) no se envían a la IA salvo que se pida.
export function buildCompactList(foods, { includeExcluded = false } = {}) {
  return foods
    .filter((f) => includeExcluded || normalizeText(f.extra?.incluir) !== 'no')
    .map(toCompact);
}

// Detecta en el texto de UNA línea si el usuario dijo el estado. null = no lo dijo (o es ambiguo).
const ESTADO_PATTERNS = {
  crudo: /\bcrud[oa]s?\b/,
  cocinado: /\b(cocid[oa]s?|cocinad[oa]s?|asad[oa]s?|hervid[oa]s?|frit[oa]s?|guisad[oa]s?|saltead[oa]s?|rehogad[oa]s?|al horno|a la plancha|plancha|al vapor|a la brasa|a la parrilla)\b/,
  tostado: /\btostad[oa]s?\b/,
};
export function detectEstado(text) {
  const t = normalizeText(text);
  const found = Object.keys(ESTADO_PATTERNS).filter((k) => ESTADO_PATTERNS[k].test(t));
  return found.length === 1 ? found[0] : null;
}

// ¿La línea expresa un volumen? ("5 ml", "medio litro", "2 cl", "0,5 l"). Para detectar que el modelo lo pasó como gramos.
const VOLUMEN = /(\b(ml|mililitros?|cl|centilitros?|litros?)\b|\d\s*l\b)/;
export const detectVolumen = (text) => VOLUMEN.test(normalizeText(text));
