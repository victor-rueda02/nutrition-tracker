// Repetir comidas de otro día ajustando los gramos a mano, sin IA. Funciones puras (devuelven un estado nuevo), sin DOM.
// Esta pantalla cuenta como confirmación editable (regla 5): se ve todo, se marca/desmarca y se cambian los gramos.
import { MEALS } from './meal-defaults.js';
import { MAX_GRAMS } from './ai-contract.js';
import { sumLines } from './nutrients.js';
import { parseNumber } from './numbers.js';
import { validDate } from './draft.js';

export const DESTINO_ORIGEN = 'origen'; // cada grupo vuelve a su comida (desayuno -> desayuno...)
export const PASOS = [-10, -5, 5, 10];
const MIN_GRAMOS = 1;
const redondea = (x) => Math.round(x * 10) / 10;

// Estado de la pantalla a partir de las comidas guardadas de un día (o de una sola, desde el Diario).
// Un alimento que ya no está en el documento aparece desmarcado y no se puede marcar.
export function createRepeat({ meals, sourceDate, foodsById, targetDate, targetMeal = DESTINO_ORIGEN, recordId = null }) {
  let n = 0;
  const groups = MEALS.map((meal) => ({
    meal,
    items: meals.filter((m) => m.meal === meal).flatMap((m) => m.lines.map((l) => {
      const known = foodsById.has(l.food_id);
      return { key: `i${++n}`, food_id: l.food_id, nombre: foodsById.get(l.food_id)?.nombre ?? l.food_id, grams: l.grams, checked: known, known };
    })),
  })).filter((g) => g.items.length);
  return { sourceDate, recordId, targetDate, targetMeal, groups };
}

const mapItem = (r, key, fn) => ({ ...r, groups: r.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.key === key ? fn(i) : i)) })) });
export const allItems = (r) => r.groups.flatMap((g) => g.items);
export const findItem = (r, key) => allItems(r).find((i) => i.key === key);

export const toggleItem = (r, key, checked) => mapItem(r, key, (i) => ({ ...i, checked: i.known && !!checked }));

// "80", "80,5" o "80.5". Vacío o inválido -> null (no se puede añadir marcado).
export function setItemGrams(r, key, raw) {
  const p = parseNumber(raw);
  return mapItem(r, key, (i) => ({ ...i, grams: p.status === 'ok' && p.value > 0 ? p.value : null }));
}

// Botones −10 −5 +5 +10: nunca por debajo de 1 g.
export const nudge = (r, key, delta) => mapItem(r, key, (i) => ({ ...i, grams: Math.max(MIN_GRAMOS, redondea((i.grams ?? 0) + delta)) }));

export const setTarget = (r, { date = r.targetDate, meal = r.targetMeal } = {}) => ({ ...r, targetDate: date, targetMeal: meal });

// kcal y proteína de lo marcado (cálculo de siempre: sin dato no es 0; "missing" dice qué falta).
export function repeatTotals(r, foodsById) {
  const lines = allItems(r).filter((i) => i.checked && i.grams > 0).map((i) => ({ food: foodsById.get(i.food_id), grams: i.grams }));
  return sumLines(lines, ['energia_kcal', 'proteina_g']);
}

export function validateRepeat(r) {
  const marcados = allItems(r).filter((i) => i.checked);
  const problems = marcados.filter((i) => !(i.grams > 0)).map((i) => ({ key: i.key, code: 'sin_gramos' }))
    .concat(marcados.filter((i) => i.grams > MAX_GRAMS).map((i) => ({ key: i.key, code: 'gramos_altos' })));
  if (!validDate(r.targetDate)) problems.push({ key: null, code: 'fecha' });
  if (r.targetMeal !== DESTINO_ORIGEN && !MEALS.includes(r.targetMeal)) problems.push({ key: null, code: 'comida' });
  return { ok: marcados.length > 0 && problems.length === 0, empty: marcados.length === 0, count: marcados.length, problems };
}

// Registros a guardar (mismo formato que el resto del diario). Con "Como en el origen", uno por comida; si no, uno.
export function toRecords(r, { now = new Date(), idGen = () => globalThis.crypto.randomUUID() } = {}) {
  if (!validateRepeat(r).ok) throw new Error('Nada válido que añadir: revisa los gramos, la fecha y la comida');
  const linea = (i) => ({ food_id: i.food_id, grams: i.grams, source_text: `repetido de ${r.sourceDate}` });
  const grupos = r.targetMeal === DESTINO_ORIGEN
    ? r.groups.map((g) => ({ meal: g.meal, items: g.items.filter((i) => i.checked) }))
    : [{ meal: r.targetMeal, items: allItems(r).filter((i) => i.checked) }];
  return grupos.filter((g) => g.items.length).map((g, n) => ({
    id: idGen(), date: r.targetDate, meal: g.meal,
    createdAt: new Date(now.getTime() + n).toISOString(), // en orden, aunque se guarden a la vez
    text: `Repetido de ${r.sourceDate}`, lines: g.items.map(linea),
  }));
}
