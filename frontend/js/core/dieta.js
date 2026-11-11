// Dieta predefinida (data/dieta.json; formato en data/SCHEMA.md). Funciones puras, sin DOM ni red.
// Versión 1: un menú por día de la semana. Versión 2: una versión por periodo del plan de objetivos y, dentro, menús propios
// por tipo de día (descanso, carrera...). El botón «Copiar dieta del día» del Diario elige el menú de la fecha (elegirMenu) y
// lo convierte en comidas para la pantalla Repetir (que es la confirmación editable).
import { MEALS } from './meal-defaults.js';
import { MAX_GRAMS } from './ai-contract.js';
import { dayContext, nombreTipo } from './targets-plan.js';

export const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
export const DIA_LABEL = { lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábado', domingo: 'domingo' };
export const SIN_PLAN = 'Para copiar la dieta necesitas un plan de objetivos (Más → Objetivos).';

// 'YYYY-MM-DD' -> 'lunes'..'domingo' (calendario puro, sin zonas horarias).
export function diaDeSemana(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha));
  if (!m) throw new Error(`Fecha no válida: ${fecha}`);
  return DIAS[(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7]; // getUTCDay: 0 = domingo
}

// Los días de un menú ({ lunes: { desayuno: [{ food_id, gramos }] } }). `donde` antepone la versión y el tipo a los mensajes.
function validarDias(rawDias, { foodIds, errores, desconocidos, donde = '', extra = {} }) {
  const pre = donde ? `${donde}, ` : '';
  if (!rawDias || typeof rawDias !== 'object' || Array.isArray(rawDias)) { errores.push(`${pre}los días deben ser un objeto con los días de la semana.`); return {}; }
  const dias = {};
  for (const [dia, comidas] of Object.entries(rawDias)) {
    if (!DIAS.includes(dia)) { errores.push(`${pre ? `${pre}día` : 'Día'} no válido «${dia}» (usa ${DIAS.join(', ')}).`); continue; }
    if (!comidas || typeof comidas !== 'object' || Array.isArray(comidas)) { errores.push(`${pre}${dia}: debe ser un objeto con sus comidas.`); continue; }
    const out = {};
    for (const [comida, lineas] of Object.entries(comidas)) {
      const lugar = `${pre}${dia}, ${comida}`;
      if (!MEALS.includes(comida)) { errores.push(`${pre}${dia}: comida no válida «${comida}» (usa ${MEALS.join(', ')}).`); continue; }
      if (!Array.isArray(lineas)) { errores.push(`${lugar}: debe ser una lista de {food_id, gramos}.`); continue; }
      out[comida] = [];
      lineas.forEach((l, n) => {
        const id = typeof l?.food_id === 'string' ? l.food_id.trim() : '';
        if (!id) { errores.push(`${lugar}, línea ${n + 1}: falta food_id.`); return; }
        if (typeof l.gramos !== 'number' || !Number.isFinite(l.gramos) || l.gramos <= 0) { errores.push(`${lugar}, ${id}: los gramos deben ser un número mayor que 0.`); return; }
        if (l.gramos > MAX_GRAMS) { errores.push(`${lugar}, ${id}: más de ${MAX_GRAMS} g.`); return; }
        if (foodIds && !foodIds.has(id)) desconocidos.push({ ...extra, dia, comida, food_id: id });
        out[comida].push({ food_id: id, gramos: l.gramos });
      });
    }
    dias[dia] = out;
  }
  return dias;
}

// Valida la estructura. Devuelve { ok, errores: [texto], desconocidos: [{ dia, comida, food_id }], dieta }.
// Los errores de estructura (día o comida inválidos, gramos no positivos, líneas sin food_id) bloquean. Los ids que no están
// en `foodIds` (un Set o un Map; opcional) no son error de estructura: se devuelven aparte para avisar y dejar copiar el resto
// (el iPhone puede no tener aún la actualización del documento).
export function validarDieta(raw, { foodIds = null } = {}) {
  const errores = [];
  const desconocidos = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errores: ['La dieta debe ser un objeto con «dias» o «versiones».'], desconocidos, dieta: null };
  const nombre = typeof raw.nombre === 'string' ? raw.nombre : '';
  if (raw.version === 2 || raw.versiones !== undefined) {
    if (!Array.isArray(raw.versiones) || !raw.versiones.length) return { ok: false, errores: ['Falta «versiones» (una lista con una versión por periodo del plan).'], desconocidos, dieta: null };
    const vistos = new Set();
    const versiones = [];
    raw.versiones.forEach((v, n) => {
      const periodo = typeof v?.periodo === 'string' ? v.periodo.trim() : '';
      const donde = periodo ? `versión «${periodo}»` : `versión ${n + 1}`;
      if (!periodo) { errores.push(`${donde}: falta «periodo» (el id de un periodo de tu plan de objetivos).`); return; }
      if (vistos.has(periodo)) { errores.push(`${donde}: periodo repetido.`); return; }
      vistos.add(periodo);
      const dias = validarDias(v.dias ?? {}, { foodIds, errores, desconocidos, donde, extra: { periodo } });
      const tipos = {};
      if (v.tipos !== undefined) {
        if (!v.tipos || typeof v.tipos !== 'object' || Array.isArray(v.tipos)) errores.push(`${donde}: «tipos» debe ser un objeto { tipo: { día: comidas } }.`);
        else for (const [tipo, d] of Object.entries(v.tipos)) tipos[tipo] = validarDias(d, { foodIds, errores, desconocidos, donde: `${donde}, ${tipo}`, extra: { periodo, tipo } });
      }
      versiones.push({ periodo, nombre: typeof v.nombre === 'string' && v.nombre.trim() ? v.nombre : periodo, dias, tipos });
    });
    return { ok: errores.length === 0, errores, desconocidos, dieta: { version: 2, nombre, versiones } };
  }
  if (!raw.dias || typeof raw.dias !== 'object' || Array.isArray(raw.dias)) return { ok: false, errores: ['Falta «dias» (un objeto con los días de la semana).'], desconocidos, dieta: null };
  const dias = validarDias(raw.dias, { foodIds, errores, desconocidos });
  return { ok: errores.length === 0, errores, desconocidos, dieta: { version: raw.version ?? 1, nombre, dias } };
}

// Texto del fichero -> validarDieta; un JSON roto es un error de estructura más.
export function parseDieta(text, opts) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, errores: [`dieta.json no es un JSON válido (${e.message}).`], desconocidos: [], dieta: null }; }
  return validarDieta(raw, opts);
}

// Un menú de un día ({ desayuno: [...], ... }) como comidas para createRepeat: [{ id, meal, lines: [{ food_id, grams }] }].
// null si no tiene ninguna línea.
export function menuComoComidas(comidas, dia) {
  if (!comidas) return null;
  const meals = MEALS.filter((m) => comidas[m]?.length).map((m) => ({ id: `dieta-${dia}-${m}`, meal: m, lines: comidas[m].map((l) => ({ food_id: l.food_id, grams: l.gramos })) }));
  return meals.length ? meals : null;
}

// La dieta (versión 1) de un día de la semana como comidas para createRepeat. null si ese día no tiene dieta.
export const dietaComoComidas = (dieta, dia) => menuComoComidas(dieta?.dias?.[dia], dia);

// Qué menú toca en una fecha. Versión 1: el del día de la semana (no necesita plan). Versión 2: la versión del periodo vigente
// de esa fecha en el plan de objetivos y, dentro, el menú de su tipo de día (con las excepciones por fecha: dayContext) si lo
// tiene; si no, el normal de ese día de la semana.
// Devuelve { ok: true, dia, etiqueta, comidas, tipo, menuPropio, version } (tipo y version: nombres para enseñar, o null;
// menuPropio: si el menú es el propio de ese tipo de día y no el normal; menuNormalDeOtroTipo: el día es de otro tipo que el
// de su semana —p. ej. «Hoy es: Descanso»— pero no tiene menú propio, así que se copia el normal y hay que decirlo) o
// { ok: false, error } con el texto para el usuario.
export function elegirMenu(dieta, fecha, plan) {
  const dia = diaDeSemana(fecha);
  const etiqueta = DIA_LABEL[dia];
  const sinDia = { ok: false, error: `No hay dieta para el ${etiqueta}` };
  if (dieta?.version !== 2) {
    const comidas = dietaComoComidas(dieta, dia);
    return comidas ? { ok: true, dia, etiqueta, comidas, tipo: null, version: null } : sinDia;
  }
  if (!plan) return { ok: false, error: SIN_PLAN };
  const ctx = dayContext(plan, fecha);
  if (!ctx.periodo) return { ok: false, error: 'Tu plan de objetivos no tiene ningún periodo para este día, así que no hay dieta que copiar.' };
  const v = versionDelPeriodo(dieta.versiones, ctx.periodo.id);
  if (!v) return { ok: false, error: `Tu dieta no tiene menú para el periodo «${ctx.periodo.nombre || ctx.periodo.id}».` };
  const propio = ctx.tipoClave ? menuComoComidas(v.tipos?.[ctx.tipoClave]?.[dia], dia) : null;
  const comidas = propio ?? menuComoComidas(v.dias?.[dia], dia);
  if (!comidas) return sinDia;
  return { ok: true, dia, etiqueta, comidas, tipo: ctx.tipoClave ? nombreTipo(ctx.periodo, ctx.tipoClave) : null, menuPropio: Boolean(propio), menuNormalDeOtroTipo: Boolean(ctx.tipoClave && !propio && ctx.tipoClave !== ctx.tipoSemana), version: v.nombre };
}

// La versión de un periodo. Editar en Objetivos «desde hoy» parte el periodo y el tramo nuevo se llama `<id>_AAAAMMDD`
// (y `_2`... si se repite; editPeriod en core/targets-plan.js): ese tramo usa la versión del periodo del que sale, quitando
// sufijos uno a uno (también tras varias ediciones seguidas).
function versionDelPeriodo(versiones, id) {
  for (let actual = id; actual;) {
    const v = versiones.find((x) => x.periodo === actual);
    if (v) return v;
    const sin = actual.replace(/_\d{8}(?:_\d{1,3})?$/, ''); // `_n` corto: dos fechas seguidas se quitan de una en una
    if (sin === actual) return null;
    actual = sin;
  }
  return null;
}
