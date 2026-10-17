// Borrador de la pantalla de confirmación. Funciones puras (devuelven un borrador nuevo), sin DOM.
// Aquí viven las ediciones del usuario: cambiar gramos, cambiar alimento, borrar línea, resolver "no reconocidos".
import { parseNumber } from './numbers.js';
import { MAX_GRAMS } from './ai-contract.js';
import { sumLines } from './nutrients.js';
import { madridNow } from './meal-defaults.js';

const mapLine = (d, key, fn) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? fn(l) : l)) });
const newLine = (d, food_id, grams = null, source_text = '', confidence = 'manual') => {
  const key = `l${d.nextKey}`;
  return [{ ...d, nextKey: d.nextKey + 1 }, { key, food_id, grams, source_text, confidence, flags: [], confirmedHigh: false }];
};

const positive = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;

// ml -> g con la densidad del documento (g/ml). Redondeo a centésimas para no arrastrar decimales espurios.
export const mlToGrams = (ml, densidad) => Math.round(ml * densidad * 100) / 100;

// result = { items, unmatched, warnings } (de la IA, ya validado por el worker; aquí se vuelve a comprobar).
// Las líneas en volumen ({ ml }) se convierten aquí, porque la densidad no viaja a internet.
export function createDraft({ text = '', meal, result = { items: [], unmatched: [], warnings: [] }, foodsById }) {
  let d = { text, meal, lines: [], unmatched: (result.unmatched ?? []).map((u) => ({ ...u })), warnings: [...(result.warnings ?? [])], nextKey: 1 };
  for (const it of result.items ?? []) {
    if (!foodsById.has(it.food_id)) { d.unmatched.push({ text: it.source_text || String(it.food_id), motivo: 'no_en_catalogo' }); continue; }
    const flags = [...(it.flags ?? [])];
    let grams = positive(it.grams) ? it.grams : null;
    if (positive(it.ml)) {
      const densidad = foodsById.get(it.food_id).densidad;
      if (!positive(densidad)) { d.unmatched.push({ text: it.source_text || String(it.food_id), motivo: 'sin_densidad', food_id: it.food_id }); continue; }
      grams = mlToGrams(it.ml, densidad);
      flags.push('convertido_ml');
    }
    let line;
    [d, line] = newLine(d, it.food_id, grams, it.source_text ?? '', it.confidence ?? 'baja');
    line.flags = flags;
    d.lines.push(line);
  }
  return d;
}

export const setMeal = (d, meal) => ({ ...d, meal });

// Acepta "80", "80,5" o "80.5". Vacío o inválido -> null (la línea queda sin gramos y no se puede guardar).
export function setGrams(d, key, raw) {
  const n = parseNumber(raw);
  const grams = n.status === 'ok' && n.value > 0 ? n.value : null;
  return mapLine(d, key, (l) => ({ ...l, grams, confirmedHigh: grams !== null && grams > MAX_GRAMS ? l.confirmedHigh : false }));
}

// Al cambiar el alimento a mano, los avisos de la IA dejan de aplicar.
export const changeFood = (d, key, food_id) => mapLine(d, key, (l) => ({ ...l, food_id, flags: [], confidence: 'manual' }));
export const confirmHigh = (d, key, value) => mapLine(d, key, (l) => ({ ...l, confirmedHigh: !!value }));
export const removeLine = (d, key) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) });

export function addLine(d, food_id, grams = null, source_text = '') {
  const [d2, line] = newLine(d, food_id, grams, source_text);
  return { ...d2, lines: [...d2.lines, line] };
}

export const dropUnmatched = (d, index) => ({ ...d, unmatched: d.unmatched.filter((_, i) => i !== index) });

// Un "no reconocido" resuelto con un alimento del documento pasa a ser una línea (sin gramos si no se conocen).
export function resolveUnmatched(d, index, food_id, grams = null) {
  const u = d.unmatched[index];
  return addLine(dropUnmatched(d, index), food_id, grams, u?.text ?? '');
}

export function lineProblem(line) {
  if (!(line.grams > 0)) return 'sin_gramos';
  if (line.grams > MAX_GRAMS && !line.confirmedHigh) return 'gramos_altos';
  return null;
}

export function validateDraft(d) {
  const problems = d.lines.map((l) => ({ key: l.key, code: lineProblem(l) })).filter((p) => p.code);
  return { ok: d.lines.length > 0 && problems.length === 0, empty: d.lines.length === 0, problems };
}

// Energía y proteína de las líneas ya válidas (para la vista previa; el cálculo real es el de nutrients.js).
export function previewTotals(d, foodsById) {
  const lines = d.lines.filter((l) => l.grams > 0 && foodsById.has(l.food_id)).map((l) => ({ food: foodsById.get(l.food_id), grams: l.grams }));
  return sumLines(lines, ['energia_kcal', 'proteina_g']);
}

// Registro que se guarda: solo alimentos y gramos (los nutrientes se calculan siempre del documento).
export function toMealRecord(d, { now = new Date(), idGen = () => globalThis.crypto.randomUUID() } = {}) {
  if (!validateDraft(d).ok) throw new Error('El borrador no es válido: revisa gramos y líneas');
  return {
    id: idGen(),
    date: madridNow(now).date,
    meal: d.meal,
    createdAt: now.toISOString(),
    text: d.text,
    lines: d.lines.map((l) => ({ food_id: l.food_id, grams: l.grams, source_text: l.source_text })),
  };
}
