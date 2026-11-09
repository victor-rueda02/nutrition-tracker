// Dieta predefinida por día de la semana (data/dieta.json; formato en data/SCHEMA.md). Funciones puras, sin DOM ni red.
// El botón «Copiar dieta del día» del Diario la convierte en comidas para la pantalla Repetir (que es la confirmación editable).
import { MEALS } from './meal-defaults.js';
import { MAX_GRAMS } from './ai-contract.js';

export const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
export const DIA_LABEL = { lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábado', domingo: 'domingo' };

// 'YYYY-MM-DD' -> 'lunes'..'domingo' (calendario puro, sin zonas horarias).
export function diaDeSemana(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha));
  if (!m) throw new Error(`Fecha no válida: ${fecha}`);
  return DIAS[(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7]; // getUTCDay: 0 = domingo
}

// Valida la estructura. Devuelve { ok, errores: [texto], desconocidos: [{ dia, comida, food_id }], dieta }.
// Los errores de estructura (día o comida inválidos, gramos no positivos, líneas sin food_id) bloquean. Los ids que no están
// en `foodIds` (un Set o un Map; opcional) no son error de estructura: se devuelven aparte para avisar y dejar copiar el resto
// (el iPhone puede no tener aún la actualización del documento).
export function validarDieta(raw, { foodIds = null } = {}) {
  const errores = [];
  const desconocidos = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errores: ['La dieta debe ser un objeto con «dias».'], desconocidos, dieta: null };
  if (!raw.dias || typeof raw.dias !== 'object' || Array.isArray(raw.dias)) return { ok: false, errores: ['Falta «dias» (un objeto con los días de la semana).'], desconocidos, dieta: null };
  const dias = {};
  for (const [dia, comidas] of Object.entries(raw.dias)) {
    if (!DIAS.includes(dia)) { errores.push(`Día no válido «${dia}» (usa ${DIAS.join(', ')}).`); continue; }
    if (!comidas || typeof comidas !== 'object' || Array.isArray(comidas)) { errores.push(`${dia}: debe ser un objeto con sus comidas.`); continue; }
    const out = {};
    for (const [comida, lineas] of Object.entries(comidas)) {
      const donde = `${dia}, ${comida}`;
      if (!MEALS.includes(comida)) { errores.push(`${dia}: comida no válida «${comida}» (usa ${MEALS.join(', ')}).`); continue; }
      if (!Array.isArray(lineas)) { errores.push(`${donde}: debe ser una lista de {food_id, gramos}.`); continue; }
      out[comida] = [];
      lineas.forEach((l, n) => {
        const id = typeof l?.food_id === 'string' ? l.food_id.trim() : '';
        if (!id) { errores.push(`${donde}, línea ${n + 1}: falta food_id.`); return; }
        if (typeof l.gramos !== 'number' || !Number.isFinite(l.gramos) || l.gramos <= 0) { errores.push(`${donde}, ${id}: los gramos deben ser un número mayor que 0.`); return; }
        if (l.gramos > MAX_GRAMS) { errores.push(`${donde}, ${id}: más de ${MAX_GRAMS} g.`); return; }
        if (foodIds && !foodIds.has(id)) desconocidos.push({ dia, comida, food_id: id });
        out[comida].push({ food_id: id, gramos: l.gramos });
      });
    }
    dias[dia] = out;
  }
  return { ok: errores.length === 0, errores, desconocidos, dieta: { version: raw.version ?? 1, nombre: typeof raw.nombre === 'string' ? raw.nombre : '', dias } };
}

// Texto del fichero -> validarDieta; un JSON roto es un error de estructura más.
export function parseDieta(text, opts) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, errores: [`dieta.json no es un JSON válido (${e.message}).`], desconocidos: [], dieta: null }; }
  return validarDieta(raw, opts);
}

// La dieta de un día de la semana como comidas para createRepeat: [{ id, meal, lines: [{ food_id, grams }] }].
// null si ese día no tiene dieta (o no tiene ninguna línea).
export function dietaComoComidas(dieta, dia) {
  const comidas = dieta?.dias?.[dia];
  if (!comidas) return null;
  const meals = MEALS.filter((m) => comidas[m]?.length).map((m) => ({ id: `dieta-${dia}-${m}`, meal: m, lines: comidas[m].map((l) => ({ food_id: l.food_id, grams: l.gramos })) }));
  return meals.length ? meals : null;
}
