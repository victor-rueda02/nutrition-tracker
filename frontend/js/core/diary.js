// Diario: totales de un día frente a los objetivos. Funciones puras, sin DOM.
// Sin dato NO es 0: un alimento sin el nutriente deja el total "parcial" y se dice cuál falta.
import { sumLines, nutrientsForGrams } from './nutrients.js';
import { unitOf } from './catalog.js';
import { MEALS } from './meal-defaults.js';

export const RANGO_OBJETIVO = [0.9, 1.1]; // tipo 'objetivo': entre el 90 % y el 110 % cuenta como en objetivo

// 'YYYY-MM-DD' + n días (en calendario, sin husos horarios).
export function shiftDate(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const foodOf = (foodsById, id) => foodsById.get(id) ?? { id, nombre: id, nutrients: {} }; // borrado del documento: sin datos

// Totales del día por nutriente: { clave: { value, missing: [ids], withData } }.
export function dayTotals(meals, foodsById, keys) {
  const lines = meals.flatMap((m) => m.lines).map((l) => ({ food: foodOf(foodsById, l.food_id), grams: l.grams }));
  return sumLines(lines, keys);
}

// Suma de varios nutrientes (EPA + DHA): null si ninguno tiene dato; los alimentos sin dato de alguno, en missing.
function combine(parts) {
  const withValue = parts.filter((p) => p.value !== null);
  return {
    value: withValue.length ? withValue.reduce((a, p) => a + p.value, 0) : null,
    missing: [...new Set(parts.flatMap((p) => p.missing))],
  };
}

// Estado de un total frente a su objetivo resuelto (resolveTargets).
// estado: sin_dato | cumplido | por_debajo (min) · dentro | excedido (max) · en_objetivo | por_debajo | por_encima (objetivo).
// superaUl va aparte: es un aviso distinto de "objetivo cumplido".
export function evaluate(total, target) {
  const value = total.value;
  const parcial = total.missing.length > 0;
  if (value === null) return { total: null, pct: null, estado: 'sin_dato', superaUl: false, parcial };
  const pct = target.valor ? value / target.valor : null;
  let estado;
  if (target.valor === null) estado = 'sin_objetivo';
  else if (target.tipo === 'min') estado = value >= target.valor ? 'cumplido' : 'por_debajo';
  else if (target.tipo === 'max') estado = value > target.valor ? 'excedido' : 'dentro';
  else estado = pct < RANGO_OBJETIVO[0] ? 'por_debajo' : pct > RANGO_OBJETIVO[1] ? 'por_encima' : 'en_objetivo';
  return { total: value, pct, estado, superaUl: target.ul !== null && value > target.ul, parcial };
}

// Todo lo que muestra la pantalla Diario para un día.
export function diaryReport(meals, foodsById, resolved, catalog) {
  const totals = dayTotals(meals, foodsById, catalog.keys);
  const rows = resolved.map((t) => {
    const total = t.suma ? combine(t.suma.map((k) => totals[k])) : totals[t.clave];
    return { ...t, ...evaluate(total, t), missing: total.missing };
  });
  const conObjetivo = new Set(resolved.filter((t) => !t.suma).map((t) => t.clave));
  const otros = catalog.list.filter((n) => !conObjetivo.has(n.key)).map((n) => ({
    clave: n.key, label: n.label, group: n.group, unit: unitOf(n.key), total: totals[n.key].value, parcial: totals[n.key].missing.length > 0,
  }));
  const ids = [...new Set(meals.flatMap((m) => m.lines.map((l) => l.food_id)))];
  const nombre = (id) => foodOf(foodsById, id).nombre ?? id;
  const sinDatos = ids.filter((id) => !Object.keys(foodOf(foodsById, id).nutrients ?? {}).length).map(nombre);
  // kcal de un conjunto de líneas: null si ninguna tiene dato; parcial si falta alguna.
  const kcalDe = (lines) => {
    const con = lines.filter((l) => l.kcal !== null);
    return { kcal: con.length ? con.reduce((a, l) => a + l.kcal, 0) : null, kcalParcial: con.length < lines.length };
  };
  // Por comida y, dentro, por registro guardado (cada uno se edita o se borra por separado).
  const comidas = MEALS.map((meal) => {
    const registros = meals.filter((r) => r.meal === meal).map((record) => {
      const lines = record.lines.map((l) => {
        const food = foodOf(foodsById, l.food_id);
        return { food_id: l.food_id, nombre: food.nombre ?? l.food_id, grams: l.grams, kcal: nutrientsForGrams(food, l.grams, ['energia_kcal']).energia_kcal };
      });
      return { id: record.id, record, lines, ...kcalDe(lines) };
    });
    return { meal, registros, ...kcalDe(registros.flatMap((r) => r.lines)) };
  }).filter((c) => c.registros.length);
  return {
    rows, otros, comidas, sinDatos,
    avisosUl: rows.filter((r) => r.superaUl),
    parciales: [...new Set(rows.filter((r) => r.parcial).flatMap((r) => r.missing))].map(nombre),
  };
}
