// Borrador de la pantalla de confirmación. Funciones puras (devuelven un borrador nuevo), sin DOM.
// Aquí viven las ediciones del usuario: cambiar gramos, cambiar alimento, borrar línea, resolver "no reconocidos".
import { parseNumber } from './numbers.js';
import { MAX_GRAMS, UMBRAL_GRAMOS_SIN_UNIDAD, detectPeso, detectVolumen, cantidadDicha } from './ai-contract.js';
import { sumLines } from './nutrients.js';
import { madridNow } from './meal-defaults.js';
import { normalizeText, removeTerms } from './text.js';

const mapLine = (d, key, fn) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? fn(l) : l)) });
const newLine = (d, food_id, grams = null, source_text = '', confidence = 'manual') => {
  const key = `l${d.nextKey}`;
  return [{ ...d, nextKey: d.nextKey + 1 }, { key, food_id, grams, source_text, confidence, flags: [], confirmedHigh: false, needsReview: false }];
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
    // Lo dicho no coincide con tus alias: no se guarda hasta que confirmes el alimento o lo cambies (confirmFood/changeFood).
    line.needsReview = flags.includes('sin_alias');
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
export const changeFood = (d, key, food_id) => mapLine(d, key, (l) => ({ ...l, food_id, flags: [], confidence: 'manual', needsReview: false }));
// "Sí, es este alimento": gesto explícito para una línea marcada sin_alias (editar los gramos no cuenta).
export const confirmFood = (d, key) => mapLine(d, key, (l) => ({ ...l, needsReview: false }));
export const confirmHigh = (d, key, value) => mapLine(d, key, (l) => ({ ...l, confirmedHigh: !!value }));
export const removeLine = (d, key) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) });

export function addLine(d, food_id, grams = null, source_text = '') {
  const [d2, line] = newLine(d, food_id, grams, source_text);
  return { ...d2, lines: [...d2.lines, line] };
}

export const dropUnmatched = (d, index) => ({ ...d, unmatched: d.unmatched.filter((_, i) => i !== index) });

// Gramos escritos en el texto de una línea ("180 g de pollo", "0,5 kg", "20 ml" con densidad). Solo si hay UNA
// cantidad clara; si no, null y se teclean a mano. Determinista: no adivina "un puñado" ni "medio kilo".
const QTY = /(\d+(?:[.,]\d+)?)\s*(g|gr|grs|gramos?|kg|kilos?|kilogramos?|ml|mililitros?)\b/g;
export function gramsFromText(text, food = null) {
  const found = [...normalizeText(text).matchAll(QTY)];
  if (found.length !== 1) return null;
  const n = parseNumber(found[0][1]);
  if (n.status !== 'ok' || !(n.value > 0)) return null;
  const unit = found[0][2];
  if (unit.startsWith('k')) return n.value * 1000;
  if (unit.startsWith('m')) return positive(food?.densidad) ? mlToGrams(n.value, food.densidad) : null;
  return n.value;
}

// Número dicho sin unidad, desde UMBRAL_GRAMOS_SIN_UNIDAD ("150 de arroz"): se asume en gramos. Por debajo
// ("1 manzana") son unidades: null. El número se lee sin el nombre del alimento ("chocolate 85" no es 85).
export function gramosAsumidos(text, food = null) {
  if (detectPeso(text) || detectVolumen(text)) return null;
  const n = cantidadDicha(removeTerms(text, food ? [food.nombre, ...(food.alias ?? [])] : []));
  return n !== null && n >= UMBRAL_GRAMOS_SIN_UNIDAD ? n : null;
}

// Un "no reconocido" resuelto con un alimento del documento pasa a ser una línea. Si no se dan los gramos,
// se toman del texto dicho cuando lo dice claro ("180 g de pollo" -> 180) o se asumen ("150 de arroz", con aviso);
// si no, la línea queda sin gramos.
export function resolveUnmatched(d, index, food_id, grams = null, food = null) {
  const u = d.unmatched[index];
  const text = u?.text ?? '';
  let g = grams ?? gramsFromText(text, food);
  const asumido = g === null ? gramosAsumidos(text, food) : null;
  if (asumido !== null) g = asumido;
  const d2 = addLine(dropUnmatched(d, index), food_id, g, text);
  if (asumido === null) return d2;
  return mapLine(d2, d2.lines.at(-1).key, (l) => ({ ...l, flags: ['gramos_asumidos'] }));
}

export function lineProblem(line) {
  if (line.needsReview) return 'sin_revisar';
  if (!(line.grams > 0)) return 'sin_gramos';
  if (line.grams > MAX_GRAMS && !line.confirmedHigh) return 'gramos_altos';
  return null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (s) => {
  if (!DATE.test(s ?? '')) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s; // descarta 2026-13-01 y 2026-02-30
};

export function validateDraft(d) {
  const problems = d.lines.map((l) => ({ key: l.key, code: lineProblem(l) })).filter((p) => p.code);
  if (d.editing && !validDate(d.date)) problems.push({ key: null, code: 'fecha' });
  return { ok: d.lines.length > 0 && problems.length === 0, empty: d.lines.length === 0, problems };
}

// ---------- editar un registro guardado ----------
// Borrador a partir de una comida guardada. Un alimento que ya no está en el documento pasa a "sin resolver"
// con sus gramos en el texto (al elegir otro alimento, se rellenan solos).
export function draftFromRecord(rec, foodsById) {
  let d = { text: rec.text ?? '', meal: rec.meal, date: rec.date, lines: [], unmatched: [], warnings: [], nextKey: 1, editing: { id: rec.id, createdAt: rec.createdAt, date: rec.date } };
  for (const l of rec.lines ?? []) {
    if (!foodsById.has(l.food_id)) { d.unmatched.push({ text: `${l.food_id} · ${l.grams} g`, motivo: 'no_en_catalogo' }); continue; }
    let line;
    [d, line] = newLine(d, l.food_id, l.grams, l.source_text ?? '', 'guardado');
    d.lines.push(line);
  }
  return d;
}

// Mover la comida a otro día ('YYYY-MM-DD').
export const setDate = (d, date) => ({ ...d, date });

// Energía y proteína de las líneas ya válidas (para la vista previa; el cálculo real es el de nutrients.js).
export function previewTotals(d, foodsById) {
  const lines = d.lines.filter((l) => l.grams > 0 && foodsById.has(l.food_id)).map((l) => ({ food: foodsById.get(l.food_id), grams: l.grams }));
  return sumLines(lines, ['energia_kcal', 'proteina_g']);
}

// Registro que se guarda: solo alimentos y gramos (los nutrientes se calculan siempre del documento).
// Al editar se conservan id y createdAt, se usa la fecha del borrador y se añade updatedAt.
export function toMealRecord(d, { now = new Date(), idGen = () => globalThis.crypto.randomUUID() } = {}) {
  if (!validateDraft(d).ok) throw new Error('El borrador no es válido: revisa gramos y líneas');
  const lines = d.lines.map((l) => ({ food_id: l.food_id, grams: l.grams, source_text: l.source_text }));
  if (d.editing) return { id: d.editing.id, date: d.date, meal: d.meal, createdAt: d.editing.createdAt, updatedAt: now.toISOString(), text: d.text, lines };
  return { id: idGen(), date: madridNow(now).date, meal: d.meal, createdAt: now.toISOString(), text: d.text, lines };
}
