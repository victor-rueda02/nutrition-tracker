// Diario: totales de un día frente a los objetivos. Funciones puras, sin DOM.
// Sin dato NO es 0: un alimento sin el nutriente deja el total "parcial" y se dice cuál falta.
import { sumLines, nutrientsForGrams, columnasVacias } from './nutrients.js';
import { unitOf } from './catalog.js';
import { MEALS } from './meal-defaults.js';
import { foodSinDatos } from './completeness.js';
import { ulVigilado } from './targets.js';

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

// Límites de un objetivo: los de targetsForDate (min, objetivo, max) o, en uno de resolveTargets, su tipo y valor.
function limitesDe(target) {
  if ('min' in target || 'objetivo' in target || 'max' in target) return { min: target.min ?? null, objetivo: target.objetivo ?? null, max: target.max ?? null };
  const v = target.valor ?? null;
  return { min: target.tipo === 'min' ? v : null, objetivo: target.tipo === 'objetivo' ? v : null, max: target.tipo === 'max' ? v : null };
}

// Estado de un total frente a su objetivo resuelto (targetsForDate o resolveTargets).
// estado: sin_dato | sin_objetivo | cumplido | por_debajo (solo min) · dentro | excedido (solo max) ·
// en_objetivo | por_debajo | por_encima (objetivo y rangos: por debajo de min, o del 90 % del objetivo si no hay min;
// por encima de max, o del 110 % del objetivo si no hay max). El % es sobre el objetivo (en un rango sin objetivo,
// sobre el máximo). superaUl va aparte: es un aviso distinto de "objetivo cumplido" (un UL informativo no cuenta, ver ulVigilado).
export function evaluate(total, target) {
  const value = total.value;
  const parcial = total.missing.length > 0;
  if (value === null) return { total: null, pct: null, estado: 'sin_dato', superaUl: false, parcial };
  const { min, objetivo, max } = limitesDe(target);
  const ref = objetivo ?? (min !== null && max !== null ? max : min ?? max);
  const pct = ref ? value / ref : null;
  let estado;
  if (ref === null) estado = 'sin_objetivo';
  else if (objetivo === null && max === null) estado = value >= min ? 'cumplido' : 'por_debajo';
  else if (objetivo === null && min === null) estado = value > max ? 'excedido' : 'dentro';
  else {
    const lo = min ?? objetivo * RANGO_OBJETIVO[0];
    const hi = max ?? objetivo * RANGO_OBJETIVO[1];
    estado = value < lo ? 'por_debajo' : value > hi ? 'por_encima' : 'en_objetivo';
  }
  return { total: value, pct, estado, superaUl: ulVigilado(target) !== null && value > ulVigilado(target), parcial };
}

// Un nutriente sin nada con qué compararlo (ni mínimo, ni objetivo, ni máximo): se enseña su valor y «sin referencia».
export const sinReferencia = (r) => [r.min, r.objetivo, r.max, r.valor].every((x) => x === null || x === undefined);

// Todo lo que muestra la pantalla Diario para un día.
// rows: los nutrientes con objetivo (los que cuentan para los avisos y los totales parciales). otros: el resto del catálogo
// en el mismo formato de fila y en el orden del catálogo, con su `group`: los que solo tienen una referencia (`solo_referencia`
// de targets.json: aminoácidos de la OMS, cafeína, trans) llevan su estado frente a ella; los demás, 'sin_objetivo' (o
// 'sin_dato'). Se omiten los que no tienen objetivo y cuya columna está vacía en todos los alimentos del documento (omega-3
// y omega-6 hoy; si algún día tienen dato, aparecen solos). Las referencias que son suma (metionina + cistina) van tras su última parte.
export function diaryReport(meals, foodsById, resolved, catalog) {
  const totals = dayTotals(meals, foodsById, catalog.keys);
  const filaDe = (t) => {
    const total = t.suma ? combine(t.suma.map((k) => totals[k])) : totals[t.clave];
    return { ...t, ...evaluate(total, t), missing: total.missing };
  };
  const principales = resolved.filter((t) => !t.soloReferencia);
  const rows = principales.map(filaDe);
  const conObjetivo = new Set(principales.filter((t) => !t.suma).map((t) => t.clave));
  const referencias = new Map(resolved.filter((t) => t.soloReferencia && !t.suma).map((t) => [t.clave, t]));
  const sumasRef = resolved.filter((t) => t.soloReferencia && t.suma?.length && t.suma.every((k) => totals[k]));
  const vacias = columnasVacias(foodsById.values(), catalog.keys);
  const otros = [];
  for (const n of catalog.list) {
    const ref = referencias.get(n.key);
    if (!conObjetivo.has(n.key) && (ref || !vacias.has(n.key))) {
      otros.push({ ...filaDe(ref ?? { clave: n.key, label: n.label, unit: unitOf(n.key), min: null, objetivo: null, max: null, valor: null, ul: null }), group: n.group });
    }
    for (const s of sumasRef) if (s.suma[s.suma.length - 1] === n.key) otros.push({ ...filaDe(s), group: n.group });
  }
  const ids = [...new Set(meals.flatMap((m) => m.lines.map((l) => l.food_id)))];
  const nombre = (id) => foodOf(foodsById, id).nombre ?? id;
  const sinDatos = ids.filter((id) => foodSinDatos(foodOf(foodsById, id))).map(nombre);
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
