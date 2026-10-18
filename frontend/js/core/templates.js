// Plantillas: una comida guardada con nombre para registrarla en segundos con la pantalla "Repetir" (ajustando gramos).
// Se guardan en el dispositivo (ajuste "plantillas") y van en la copia de seguridad. Funciones puras, sin DOM.
import { newId } from './ids.js';
import { MEALS } from './meal-defaults.js';
import { normalizeText } from './text.js';

export const MAX_NOMBRE = 60;

// Motivo por el que una plantilla no es válida, o null (para lo guardado y para importar copias).
export function templateError(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return 'no es un objeto';
  if (typeof t.id !== 'string' || !t.id) return 'falta el id';
  if (typeof t.nombre !== 'string' || !t.nombre.trim()) return 'falta el nombre';
  if (!MEALS.includes(t.meal)) return `comida no válida "${t.meal}"`;
  if (!Array.isArray(t.lines) || !t.lines.length) return 'sin alimentos';
  for (const l of t.lines) {
    if (!l || typeof l.food_id !== 'string' || !l.food_id) return 'una línea sin alimento';
    if (typeof l.grams !== 'number' || !Number.isFinite(l.grams) || l.grams <= 0) return `gramos no válidos en ${l.food_id}`;
  }
  return null;
}

// Lo guardado en el dispositivo: solo las plantillas válidas, con los campos conocidos.
export const cleanTemplates = (list) => (Array.isArray(list) ? list : []).filter((t) => !templateError(t)).map((t) => ({
  id: t.id, nombre: t.nombre.trim(), meal: t.meal, createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
  lines: t.lines.map((l) => ({ food_id: l.food_id, grams: l.grams })),
}));

// Nombre para una plantilla nueva: obligatorio, hasta MAX_NOMBRE caracteres y sin repetir (sin acentos ni mayúsculas).
export function nameError(nombre, list) {
  const n = String(nombre ?? '').trim();
  if (!n) return 'Ponle un nombre.';
  if (n.length > MAX_NOMBRE) return `Como mucho ${MAX_NOMBRE} caracteres.`;
  if (list.some((t) => normalizeText(t.nombre) === normalizeText(n))) return `Ya tienes una plantilla «${n}».`;
  return null;
}

export function templateFromRecord(rec, { nombre, list = [], now = new Date(), idGen = newId }) {
  const err = nameError(nombre, list);
  if (err) throw new Error(err);
  return { id: idGen(), nombre: String(nombre).trim(), meal: rec.meal, createdAt: now.toISOString(), lines: rec.lines.map((l) => ({ food_id: l.food_id, grams: l.grams })) };
}

// Orden de la lista: por nombre (como en un índice).
export const sortTemplates = (list) => [...list].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
export const addTemplate = (list, t) => sortTemplates([...list, t]);
export const removeTemplate = (list, id) => list.filter((t) => t.id !== id);

// Para abrir la pantalla "Repetir": la plantilla como si fuera una comida guardada.
export const templateAsMeals = (t) => [{ id: t.id, meal: t.meal, lines: t.lines }];

// Importar plantillas de una copia: se añaden las que no hay (por id); las que ya están se dejan como están.
export function mergeTemplates(local, incoming) {
  const ids = new Set(local.map((t) => t.id));
  const nuevas = cleanTemplates(incoming).filter((t) => !ids.has(t.id));
  return { list: sortTemplates([...local, ...nuevas]), nuevas };
}
