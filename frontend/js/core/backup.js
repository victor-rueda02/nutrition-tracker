// Copia de seguridad del diario (JSON): exportar e importar. Funciones puras, sin DOM.
// La copia lleva las comidas, tus objetivos, tus plantillas, el registro de frases a revisar y tus recetas (sus
// definiciones; las filas van en el documento); nunca la conexión
// (el token del Worker).
import { MEALS } from './meal-defaults.js';
import { cleanTemplates } from './templates.js';
import { cleanLog } from './phrase-log.js';
import { cleanRecetas } from './recetas.js';

export const BACKUP_FORMAT = 1;
export const BACKUP_KIND = 'nutrition-tracker/diario';

export function buildBackup({ meals, objetivos = null, plantillas = [], registro = [], recetas = [], now = new Date() }) {
  return { tipo: BACKUP_KIND, formatVersion: BACKUP_FORMAT, exportedAt: now.toISOString(), comidas: meals, objetivos, plantillas, registro_frases: registro, recetas };
}
export const backupToJSON = (backup) => `${JSON.stringify(backup, null, 2)}\n`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
};
const validStamp = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

// Motivo por el que un registro de comida no es válido, o null.
export function mealError(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'no es un objeto';
  if (typeof m.id !== 'string' || !m.id.trim()) return 'falta el id';
  if (!validDate(m.date)) return `fecha no válida "${m.date}"`;
  if (!MEALS.includes(m.meal)) return `comida no válida "${m.meal}"`;
  if (!validStamp(m.createdAt)) return 'falta createdAt';
  if (m.updatedAt !== undefined && !validStamp(m.updatedAt)) return 'updatedAt no válido';
  if (!Array.isArray(m.lines) || !m.lines.length) return 'sin alimentos';
  for (const l of m.lines) {
    if (!l || typeof l.food_id !== 'string' || !l.food_id) return 'una línea sin alimento';
    if (typeof l.grams !== 'number' || !Number.isFinite(l.grams) || l.grams <= 0) return `gramos no válidos en ${l.food_id}`;
  }
  return null;
}

// Solo los campos conocidos (lo que guarda la app).
const cleanMeal = (m) => ({
  id: m.id, date: m.date, meal: m.meal, createdAt: m.createdAt, ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}),
  text: typeof m.text === 'string' ? m.text : '',
  lines: m.lines.map((l) => ({ food_id: l.food_id, grams: l.grams, source_text: typeof l.source_text === 'string' ? l.source_text : '' })),
});

// Lee una copia. Devuelve { ok, error?, meals, errors: [{ index, id, message }], objetivos, plantillas, registro, recetas }.
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(String(text ?? '').replace(/^﻿/, '')); } catch (e) { return { ok: false, error: `No es un JSON válido: ${e.message}`, meals: [], errors: [], objetivos: null, plantillas: [], registro: [], recetas: [] }; }
  const lista = Array.isArray(data) ? data : data?.tipo === BACKUP_KIND && Array.isArray(data.comidas) ? data.comidas : null;
  if (!lista) return { ok: false, error: 'No es una copia del diario de esta app.', meals: [], errors: [], objetivos: null, plantillas: [], registro: [], recetas: [] };
  if (!Array.isArray(data) && data.formatVersion > BACKUP_FORMAT) return { ok: false, error: `La copia es de una versión más nueva de la app (formato ${data.formatVersion}).`, meals: [], errors: [], objetivos: null, plantillas: [], registro: [], recetas: [] };
  const meals = [];
  const errors = [];
  const vistos = new Set();
  lista.forEach((m, index) => {
    const message = mealError(m) ?? (vistos.has(m.id) ? 'id repetido en la copia' : null);
    if (message) { errors.push({ index, id: typeof m?.id === 'string' ? m.id : undefined, message }); return; }
    vistos.add(m.id);
    meals.push(cleanMeal(m));
  });
  const o = Array.isArray(data) ? null : data.objetivos;
  const objetivos = o && typeof o === 'object' && !Array.isArray(o) ? { perfil: typeof o.perfil === 'string' ? o.perfil : undefined, valores: o.valores && typeof o.valores === 'object' ? { ...o.valores } : {} } : null;
  const plantillas = Array.isArray(data) ? [] : cleanTemplates(data.plantillas); // las inválidas se ignoran
  const registro = Array.isArray(data) ? [] : cleanLog(data.registro_frases);
  const recetas = Array.isArray(data) ? [] : cleanRecetas(data.recetas);
  return { ok: true, meals, errors, objetivos, plantillas, registro, recetas };
}

const stamp = (m) => Date.parse(m.updatedAt ?? m.createdAt);
const igual = (a, b) => JSON.stringify(cleanMeal(a)) === JSON.stringify(cleanMeal(b));

// Fusión por id con lo que ya hay: nuevas se añaden; con el mismo id gana la más reciente (updatedAt o createdAt).
// Nunca se borra nada. Devuelve qué escribir y el resumen.
export function planImport(existing, incoming) {
  const actuales = new Map(existing.map((m) => [m.id, m]));
  const plan = { nuevas: [], actualizadas: [], iguales: [], masAntiguas: [] };
  for (const m of incoming) {
    const e = actuales.get(m.id);
    if (!e) plan.nuevas.push(m);
    else if (igual(e, m)) plan.iguales.push(m);
    else if (stamp(m) > stamp(e)) plan.actualizadas.push(m);
    else plan.masAntiguas.push(m);
  }
  return { ...plan, escribir: [...plan.nuevas, ...plan.actualizadas] };
}

// ¿Hay objetivos propios? (si los hay, importar una copia no los pisa)
export const tieneObjetivos = (o) => Boolean(o && (o.perfil || Object.keys(o.valores ?? {}).length)); // los guardaste alguna vez
