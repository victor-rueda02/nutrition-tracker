// ¿Qué ceno?: motor puro (sin DOM ni red). Para un día, mira lo ya registrado, lo compara con los objetivos de ese día y
// propone 3 cenas sacadas de las cenas habituales, con los gramos ajustados. Especificación: docs/cenas/ESPEC.md.
// Los gramos y los nutrientes los calcula este código desde el documento (sumLines); la IA, si interviene, solo aporta
// combinaciones de ids que aquí se validan, se ajustan y se calculan igual que las demás. Determinista: mismas entradas,
// mismas propuestas y mismo orden (los empates se resuelven por id).
import { sumLines } from './nutrients.js';
import { dayTotals, shiftDate } from './diary.js';
import { foodSinDatos, foodCompleteness, isIncomplete } from './completeness.js';
import { isExcluded } from './excluded.js';

export const DIAS_PARA_HISTORIAL = 21; // con menos días con cena en la app, se usa también la semilla de Cronometer
export const DIAS_HISTORIAL = 60; // ventana del historial real
export const RACION_RECETA_G = 300; // gramos de una receta que nunca se ha registrado
export const N_PROPUESTAS = 3;
export const R_NORMAL = 400; // kcal restantes desde las que hay cena completa
export const R_LIGERO = 150; // por debajo, solo opciones muy ligeras o nada
export const FACTOR_MIN = 0.6;
export const FACTOR_MIN_LIGERO = 0.3;
export const FACTOR_MAX = 1.5;
export const MARGEN_KCAL = (R) => Math.max(50, 0.05 * R); // una propuesta nunca pasa de R + margen
export const KCAL_VERDURA_CRUDA = 50;
export const CENA_MAX_FRAC = 0.45; // una cena no intenta cubrir el día entero: como mucho este tanto de la meta de kcal
export const VERDURA_COMPLETAR_G = 100; // gramos mínimos de una verdura añadida para completar
const TOPE_BLANDO_SOBRE_OBJETIVO = 1.1; // como RANGO_OBJETIVO del Diario
const DESVIO_KCAL_MAX = 0.05; // si el ajuste por mínimos cuadrados se aleja más de E* se corrige hacia E*
const POSTRE_BASE_ID = 'yogur_griego_natural';
const YOGUR_G = 125;
const CHIA_ID = 'semillas_chia';
const CHIA_G = 3;
const EXTRAS_POSTRE = [['chocolate_negro_85', 10], ['nueces', 10]];
const ACEITE_LIGERO_G = 5;
const MACROS = ['energia_kcal', 'proteina_g', 'fibra_g', 'hidratos_g', 'grasa_total_g'];
const ESCALA = { proteina: 'p', hidrato: 'h', plato: 'h' }; // qué factor escala a cada rol; el resto es fijo
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const ROLES = ['proteina', 'hidrato', 'verdura', 'plato', 'grasa', 'salsa', 'postre_base', 'postre_extra', 'fruta', 'otro'];

// Nombres de nutriente que sí viajan a la IA (sin dígitos: la regla del Worker es /\d/). Las etiquetas con número
// ("Vitamina B12") se cambian por su nombre propio; el resto, la etiqueta sin el paréntesis ("Vitamina A (RAE)").
const NOMBRE_IA = {
  vitamina_b1_mg: 'Tiamina', vitamina_b2_mg: 'Riboflavina', vitamina_b3_mg: 'Niacina', vitamina_b5_mg: 'Ácido pantoténico',
  vitamina_b6_mg: 'Piridoxina', vitamina_b9_ug: 'Folato', vitamina_b12_ug: 'Cobalamina', omega3_g: 'Omega tres', omega6_g: 'Omega seis',
  ala_g: 'Ácido alfa-linolénico', epa_dha: 'EPA y DHA', epa_g: 'EPA', dha_g: 'DHA',
};
export const MAX_DEFICITS_IA = 8;
export function nombreParaIA(clave, label = '') {
  const n = NOMBRE_IA[clave] ?? String(label).replace(/\s*\([^)]*\)/g, '').trim();
  return n && !/\d/.test(n) && n.length <= 40 ? n : null;
}

export const fechaCorta = (fecha) => { const [, m, d] = fecha.split('-').map(Number); return `${String(d).padStart(2, '0')}-${MESES[m - 1]}`; };
const minuscula = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const porId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const positivo = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const r1 = (x) => Math.round(x * 10) / 10;

function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const mediana0 = (xs) => (xs.length ? mediana(xs) : 0);

// ---------- contexto: lo que se sabe del día y del catálogo ----------

// Objetivos del día -> una ficha por nutriente con meta, déficit y topes.
function especsDe(objetivos, totals) {
  const combine = (parts) => {
    const con = parts.filter((p) => p.value !== null);
    return { value: con.length ? con.reduce((a, p) => a + p.value, 0) : null, missing: [...new Set(parts.flatMap((p) => p.missing))] };
  };
  const out = [];
  for (const t of objetivos?.list ?? []) {
    const keys = Array.isArray(t.suma) ? t.suma : [t.clave];
    if (keys.some((k) => !totals[k])) continue;
    const total = combine(keys.map((k) => totals[k]));
    const { min = null, objetivo = null, max = null, ul = null } = t;
    const meta = objetivo ?? (min !== null && max !== null ? (min + max) / 2 : min); // solo máximo: sin meta, solo tope
    const tope = max ?? (objetivo !== null ? objetivo * TOPE_BLANDO_SOBRE_OBJETIVO : null);
    if (meta === null && tope === null && ul === null) continue;
    const consumido = total.value ?? 0;
    out.push({
      clave: t.clave, label: t.label ?? t.clave, unit: t.unit ?? '', keys, meta, tope, ul, consumido,
      falta: meta === null ? 0 : Math.max(0, meta - consumido), parcialDia: total.missing.length > 0,
    });
  }
  return out;
}

const mealOrder = (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || porId(a.id ?? '', b.id ?? '');

// Suma las líneas de un mismo alimento ([{ food_id, gramos }]).
function juntar(lineas) {
  const m = new Map();
  for (const l of lineas) {
    const g = l.gramos === null || l.gramos === undefined ? null : l.gramos;
    const p = m.get(l.food_id);
    if (!p) m.set(l.food_id, { ...l, gramos: g });
    else p.gramos = p.gramos === null || g === null ? null : p.gramos + g;
  }
  return [...m.values()];
}

const claveConjunto = (lineas) => [...new Set(lineas.map((l) => l.food_id))].sort(porId).join('+');

function contexto({ fecha, comidasDelDia, historial, plantillas, recetas, semilla, foodsById, objetivos, catalog, settings, hoy }) {
  const keys = [...new Set([...MACROS, ...(objetivos?.list ?? []).flatMap((t) => (Array.isArray(t.suma) ? t.suma : [t.clave]))])].filter((k) => catalog.byKey.has(k));
  const totals = dayTotals(comidasDelDia, foodsById, keys);
  const especs = especsDe(objetivos, totals);
  const energia = especs.find((e) => e.clave === 'energia_kcal');
  const metaKcal = energia?.meta ?? (positivo(objetivos?.kcal) ? objetivos.kcal : null);
  const consumidoKcal = totals.energia_kcal?.value ?? 0;
  const roles = semilla?.roles ?? {};
  const recetaIds = new Set((recetas ?? []).map((r) => (typeof r === 'string' ? r : r?.id)).filter(Boolean));
  const rolDe = (id) => roles[id] ?? (recetaIds.has(id) ? 'plato' : 'otro');
  const motivo = (id) => {
    const f = foodsById.get(id);
    if (!f) return 'fuera_documento';
    if (foodSinDatos(f)) return 'sin_datos';
    if (isExcluded(f)) return 'excluido';
    return null;
  };

  // Cenas reales: el historial (60 días antes de `fecha`), una por día.
  const desde = shiftDate(fecha, -DIAS_HISTORIAL);
  const porFecha = new Map();
  for (const r of [...(historial ?? [])].filter((m) => m.meal === 'cena' && m.date < fecha && m.date >= desde).sort(mealOrder)) {
    (porFecha.get(r.date) ?? porFecha.set(r.date, []).get(r.date)).push(...r.lines.map((l) => ({ food_id: l.food_id, gramos: l.grams })));
  }
  const fechasCena = [...porFecha.keys()].sort().reverse(); // más reciente primero
  const diasConCena = fechasCena.length;
  const semillaCenas = Array.isArray(semilla?.cenas) ? semilla.cenas : [];
  const usarSemilla = diasConCena < DIAS_PARA_HISTORIAL && semillaCenas.length > 0;

  const fuentes = []; // todas las cenas de las que se aprende lo habitual
  for (const f of fechasCena) fuentes.push({ tipo: 'historial', fecha: f, lineas: juntar(porFecha.get(f)) });
  for (const p of [...(plantillas ?? [])].filter((t) => t.meal === 'cena').sort((a, b) => porId(a.id, b.id))) {
    fuentes.push({ tipo: 'plantilla', nombre: p.nombre, id: p.id, lineas: juntar(p.lines.map((l) => ({ food_id: l.food_id, gramos: l.grams }))) });
  }
  if (usarSemilla) for (const c of semillaCenas) fuentes.push({ tipo: 'semilla', fecha: c.fecha, lineas: juntar(c.lineas.map((l) => ({ ...l, gramos: l.gramos ?? null }))) });

  // Lo habitual: cuántas cenas llevan cada alimento y qué gramos suelen llevar.
  const habitual = new Map();
  for (const f of fuentes) {
    for (const l of f.lineas) {
      const h = habitual.get(l.food_id) ?? habitual.set(l.food_id, { n: 0, gramos: [] }).get(l.food_id);
      h.n++;
      if (positivo(l.gramos)) h.gramos.push(l.gramos);
    }
  }
  const gramosHabituales = (id, porDefecto) => (habitual.get(id)?.gramos.length ? mediana(habitual.get(id).gramos) : porDefecto);
  // Alimentos válidos y habituales de un rol, de más a menos habituales (empate por id).
  const habitualesDe = (rol, filtro = () => true) => [...habitual.entries()]
    .filter(([id]) => rolDe(id) === rol && motivo(id) === null && filtro(foodsById.get(id)))
    .sort((a, b) => b[1].n - a[1].n || mediana0(b[1].gramos) - mediana0(a[1].gramos) || porId(a[0], b[0])).map(([id]) => id);
  const nombre = (id) => foodsById.get(id)?.nombre ?? id;
  // Verduras que se comen crudas (lista de la semilla), válidas hoy: las más habituales primero.
  const crudasValidas = () => (Array.isArray(semilla?.crudas) ? [...new Set(semilla.crudas)] : []).filter((id) => motivo(id) === null)
    .sort((a, b) => (habitual.get(b)?.n ?? 0) - (habitual.get(a)?.n ?? 0) || mediana0(habitual.get(b)?.gramos ?? []) - mediana0(habitual.get(a)?.gramos ?? []) || porId(a, b));

  return {
    fecha, hoy, comidasDelDia, foodsById, objetivos, catalog, settings, keys, totals, especs, metaKcal, consumidoKcal,
    R: metaKcal === null ? null : metaKcal - consumidoKcal,
    topeCena: metaKcal === null ? null : CENA_MAX_FRAC * metaKcal, crudasValidas,
    rolDe, motivo, nombre, fuentes, habitual, gramosHabituales, habitualesDe, diasConCena, usarSemilla, recetaIds,
    descartados: new Map(),
  };
}

// ---------- evaluación: cálculo y puntuación sobre los gramos finales ----------

function calcular(lineas, ctx) {
  const s = sumLines(lineas.map((l) => ({ food: ctx.foodsById.get(l.food_id), grams: l.gramos })), ctx.keys);
  const val = (k) => s[k]?.value ?? 0;
  const aportes = ctx.especs.map((e) => ({
    e, aporte: e.keys.reduce((a, k) => a + val(k), 0), parcial: e.keys.some((k) => (s[k]?.missing.length ?? 0) > 0),
  }));
  return { kcal: val('energia_kcal'), proteina: val('proteina_g'), hidratos: val('hidratos_g'), grasa: val('grasa_total_g'), aportes };
}

const cobertura = ({ e, aporte }) => (e.falta > 0 ? Math.min(1, aporte / e.falta) : 1);
const media = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 1);

// Puntuación (ESPEC §6.4). null si la propuesta hace superar un UL que antes de cenar no se superaba.
function puntuar(calc, ctx, { E, sHab }) {
  let ulNuevo = false;
  let pen = 0;
  for (const { e, aporte } of calc.aportes) {
    const despues = e.consumido + aporte;
    if (e.ul !== null && despues > e.ul && e.consumido <= e.ul) ulNuevo = true;
    if (e.tope !== null) pen += Math.min(1, Math.max(0, (despues - Math.max(e.tope, e.consumido)) / e.tope));
    if (e.ul !== null && e.consumido > e.ul) pen += Math.min(1, Math.max(0, (despues - e.consumido) / e.ul)); // UL ya superado: como un tope blando
  }
  if (ulNuevo) return null;
  const sKcal = E > 0 ? Math.max(0, 1 - Math.abs(calc.kcal - E) / E) : 0;
  const porClave = new Map(calc.aportes.map((a) => [a.e.clave, a]));
  const macros = ['proteina_g', 'fibra_g'].filter((k) => porClave.has(k)).map((k) => cobertura(porClave.get(k)))
    .concat(['hidratos_g', 'grasa_total_g'].filter((k) => porClave.has(k) && porClave.get(k).e.falta > 0).map((k) => cobertura(porClave.get(k))));
  const sMacros = media(macros);
  const sMicros = media(calc.aportes.filter((a) => !MACROS.includes(a.e.clave) && a.e.falta > 0).map(cobertura));
  return 0.25 * sKcal + 0.3 * sMacros + 0.35 * sMicros + 0.1 * sHab - 0.5 * pen;
}

// Lo que se enseña de una propuesta ya calculada.
function propuestaDe(cand, lineas, calc, puntuacion, ctx, extra = {}) {
  const conDeficit = calc.aportes.filter((a) => a.e.falta > 0 && a.e.clave !== 'energia_kcal');
  const tolera = 1e-9;
  const completa = conDeficit.filter((a) => a.aporte >= a.e.falta - tolera);
  const mitad = conDeficit.filter((a) => a.aporte < a.e.falta - tolera && a.aporte >= a.e.falta * 0.5 - tolera);
  const siguen = conDeficit.filter((a) => a.aporte < a.e.falta - tolera)
    .map((a) => ({ clave: a.e.clave, label: a.e.label, pct: (a.e.falta - a.aporte) / a.e.meta }))
    .sort((a, b) => b.pct - a.pct || porId(a.clave, b.clave)).slice(0, 3);
  const incompletos = ctx.settings
    ? [...new Set(lineas.map((l) => l.food_id))].filter((id) => isIncomplete(foodCompleteness(ctx.foodsById.get(id), ctx.settings.requiredNutrients), ctx.settings.completenessThreshold)).map((id) => ctx.nombre(id))
    : [];
  return {
    origen: cand.origen, tipo: cand.tipo, veces: cand.veces ?? null, variante: Boolean(cand.variante), origenClave: cand.origenClave,
    lineas: lineas.map((l) => ({ food_id: l.food_id, nombre: ctx.nombre(l.food_id), gramos: l.gramos, base: l.base ?? l.gramos, rol: l.rol, ...(l.añadida ? { añadida: true } : {}), ...(l.postre ? { postre: true } : {}), ...(l.extra ? { extra: true } : {}) })),
    kcal: calc.kcal, proteina: calc.proteina, hidratos: calc.hidratos, grasa: calc.grasa,
    completa: completa.map((a) => ({ clave: a.e.clave, label: a.e.label })),
    mitad: mitad.map((a) => ({ clave: a.e.clave, label: a.e.label })),
    siguenFaltando: siguen,
    parciales: conDeficit.filter((a) => a.parcial && a.aporte < a.e.falta - tolera).map((a) => a.e.label),
    incompletos,
    puntuacion, ia: cand.tipo === 'ia', principal: principalDe(lineas), ...extra,
  };
}

// Proteína principal (o el plato) de una propuesta: la de más gramos; empate por id.
function principalDe(lineas) {
  const pick = (rol) => [...lineas].filter((l) => l.rol === rol).sort((a, b) => b.gramos - a.gramos || porId(a.food_id, b.food_id))[0];
  return (pick('plato') ?? pick('proteina'))?.food_id ?? null;
}

// ---------- escalado de gramos (ESPEC §6.3) ----------

const r5 = (g) => Math.round(g / 5) * 5;
function gramosEscalados(base, f, fmin, porcion = null) {
  if (positivo(porcion)) { // proteína con porción en el catálogo (huevo): número entero de esa porción, al menos 1
    const nlo = Math.max(1, Math.ceil((fmin * base) / porcion - 1e-9));
    const nhi = Math.floor((FACTOR_MAX * base) / porcion + 1e-9);
    let n = Math.max(1, Math.round((base * f) / porcion));
    if (nhi >= nlo) n = Math.min(nhi, Math.max(nlo, n));
    return n * porcion;
  }
  const lo = Math.ceil((fmin * base) / 5 - 1e-9) * 5;
  const hi = Math.floor((FACTOR_MAX * base) / 5 + 1e-9) * 5;
  let g = r5(base * f);
  if (hi >= lo) g = Math.min(hi, Math.max(lo, g));
  return Math.max(5, g);
}

function ajustar(cand, ctx, { ligero = false, sHab = cand.sHab ?? 0 } = {}) {
  const R = ctx.R;
  const fmin = ligero ? FACTOR_MIN_LIGERO : FACTOR_MIN;
  const lineas = cand.lineas;
  const grupo = (l) => ESCALA[l.rol] ?? null;
  const vec = (pred) => {
    const s = sumLines(lineas.filter(pred).map((l) => ({ food: ctx.foodsById.get(l.food_id), grams: l.gramos })), ['energia_kcal', 'proteina_g']);
    return { k: s.energia_kcal.value ?? 0, p: s.proteina_g.value ?? 0 };
  };
  const fijo = vec((l) => !grupo(l));
  const P = vec((l) => grupo(l) === 'p');
  const H = vec((l) => grupo(l) === 'h');
  const tieneP = lineas.some((l) => grupo(l) === 'p');
  const tieneH = lineas.some((l) => grupo(l) === 'h');
  const Rtope = ligero ? R : Math.min(R, ctx.topeCena ?? R); // una cena normal no cubre el día entero (CENA_MAX_FRAC)
  const E = Math.min(Rtope, fijo.k + FACTOR_MAX * (P.k + H.k)); // meta de la cena
  const Pn = ctx.especs.find((e) => e.clave === 'proteina_g')?.falta ?? 0;
  const cl = (x) => Math.min(FACTOR_MAX, Math.max(fmin, x));
  const wk = 2 / (E * E);
  const wp = Pn > 0 ? 1 / (Pn * Pn) : 0;
  let fp = 1;
  let fh = 1;

  if (tieneP && tieneH) {
    const rk = E - fijo.k;
    const rp = Pn - fijo.p;
    const a11 = wk * P.k * P.k + wp * P.p * P.p;
    const a12 = wk * P.k * H.k + wp * P.p * H.p;
    const a22 = wk * H.k * H.k + wp * H.p * H.p;
    const det = a11 * a22 - a12 * a12;
    if (wp > 0 && Math.abs(det) > 1e-12 * (a11 * a22 + 1e-30)) {
      fp = (a22 * (wk * P.k * rk + wp * P.p * rp) - a12 * (wk * H.k * rk + wp * H.p * rp)) / det;
      fh = (a11 * (wk * H.k * rk + wp * H.p * rp) - a12 * (wk * P.k * rk + wp * P.p * rp)) / det;
    } else {
      fp = 1;
      fh = H.k > 0 ? (rk - P.k) / H.k : 1;
    }
    const cfp = cl(fp);
    const cfh = cl(fh);
    if (cfp !== fp && cfh === fh && H.k > 0) { fp = cfp; fh = cl((rk - cfp * P.k) / H.k); }
    else if (cfh !== fh && cfp === fp && P.k > 0) { fh = cfh; fp = cl((rk - cfh * H.k) / P.k); }
    else { fp = cfp; fh = cfh; }
    // Las kcal mandan: si el ajuste se aleja de E*, se vuelve a la recta de E* y ahí se acerca a la proteína.
    const K = fijo.k + fp * P.k + fh * H.k;
    if (Math.abs(K - E) > DESVIO_KCAL_MAX * E && H.k > 0 && P.k > 0) {
      const pend = -P.k / H.k; // fh = c0 + pend·fp sobre la recta de E*
      const c0 = rk / H.k;
      let x = fp;
      if (wp > 0) {
        const den = (P.p + H.p * pend) ** 2;
        if (den > 1e-12) x = (rp - H.p * c0) * (P.p + H.p * pend) / den;
      }
      fp = cl(x);
      fh = cl(c0 + pend * fp);
      if (fh !== c0 + pend * fp) fp = cl((rk - fh * H.k) / P.k);
    }
  } else if (tieneP || tieneH) {
    const g = tieneP ? P : H;
    const rk = E - fijo.k;
    const rp = Pn - fijo.p;
    const f = g.k > 0 ? (wp > 0 ? (wk * g.k * rk + wp * g.p * rp) / (wk * g.k * g.k + wp * g.p * g.p) : rk / g.k) : 1;
    const kcalSolo = g.k > 0 ? rk / g.k : 1;
    const x = wp > 0 && Math.abs(g.k * f - rk) > DESVIO_KCAL_MAX * E ? kcalSolo : f;
    if (tieneP) fp = cl(x); else fh = cl(x);
  }

  const redondear = (a, b) => lineas.map((l) => {
    const gr = grupo(l);
    const base = l.gramos;
    return { ...l, base, gramos: gr === 'p' ? gramosEscalados(base, a, fmin, ctx.foodsById.get(l.food_id)?.porciones?.[0]?.gramos ?? null) : gr === 'h' ? gramosEscalados(base, b, fmin) : Math.max(1, Math.round(base)) };
  });
  const limite = Rtope + MARGEN_KCAL(Rtope);
  let finales = redondear(fp, fh);
  let calc = calcular(finales, ctx);
  if (calc.kcal > limite && (P.k + H.k) > 0) { // no cabe: una sola proporción hacia E*, con los mínimos como suelo
    const f = cl((E - fijo.k) / (P.k + H.k));
    finales = redondear(f, f);
    calc = calcular(finales, ctx);
    fp = f; fh = f;
  }
  if (calc.kcal > limite) return null;
  const puntuacion = puntuar(calc, ctx, { E, sHab });
  if (puntuacion === null) return null;
  const queda = calc.kcal < E * 0.9 ? { seQuedaCorta: Math.round(calc.kcal) } : {};
  return { cand: { ...cand, lineas: finales }, calc, puntuacion, E, factores: { fp, fh }, queda };
}

// Prueba los extras de postre de uno en uno (orden fijo): se quedan si suben la puntuación y caben en las kcal.
function conExtras(cand, ctx, extras, opts) {
  let actual = ajustar(cand, ctx, opts);
  if (!actual) return null;
  let base = cand;
  for (const ex of extras) {
    if (base.lineas.some((l) => l.food_id === ex.food_id)) continue;
    const probada = { ...base, lineas: [...base.lineas, ex] };
    const r = ajustar(probada, ctx, opts);
    if (r && r.puntuacion > actual.puntuacion + 1e-9) { actual = r; base = probada; }
  }
  return actual;
}

// ---------- candidatos (ESPEC §6.2) ----------

function limpiar(cand, ctx) {
  const lineas = [];
  for (const l of juntar(cand.lineas)) {
    const m = ctx.motivo(l.food_id) ?? (positivo(l.gramos) ? null : 'sin_gramos');
    if (m) { if (!ctx.descartados.has(l.food_id)) ctx.descartados.set(l.food_id, m); continue; }
    lineas.push({ food_id: l.food_id, gramos: l.gramos, rol: ctx.rolDe(l.food_id), ...(l.supuesto ? { supuesto: true } : {}) });
  }
  return { ...cand, lineas };
}

const masHabitual = (ctx, rol, excluir = []) => ctx.habitualesDe(rol).find((id) => !excluir.includes(id));
const lineaHabitual = (ctx, id, extra = {}) => ({ food_id: id, gramos: ctx.gramosHabituales(id, 100), rol: ctx.rolDe(id), ...extra });

function completar(cand, ctx) {
  const lineas = [...cand.lineas];
  const roles = new Set(lineas.map((l) => l.rol));
  if (!roles.has('proteina') && !roles.has('plato')) return null;
  if (!roles.has('plato')) {
    for (const rol of ['verdura', 'hidrato']) {
      if (roles.has(rol)) continue;
      const id = masHabitual(ctx, rol);
      if (!id) continue;
      const l = lineaHabitual(ctx, id, { añadida: true });
      if (rol === 'verdura') l.gramos = Math.max(l.gramos, VERDURA_COMPLETAR_G);
      lineas.push(l);
    }
  }
  if (!lineas.some((l) => l.rol === 'postre_base')) {
    const base = masHabitual(ctx, 'postre_base') ?? (ctx.motivo(POSTRE_BASE_ID) === null ? POSTRE_BASE_ID : null);
    if (base) {
      lineas.push({ food_id: base, gramos: ctx.gramosHabituales(base, YOGUR_G), rol: 'postre_base', postre: true });
      if (ctx.motivo(CHIA_ID) === null && !lineas.some((l) => l.food_id === CHIA_ID)) lineas.push({ food_id: CHIA_ID, gramos: ctx.gramosHabituales(CHIA_ID, CHIA_G), rol: ctx.rolDe(CHIA_ID), postre: true });
    }
  }
  return { ...cand, lineas };
}

function candidatosNormales(ctx, ideasIA) {
  const crudos = []; // antes de limpiar
  // 1. Historial real: un candidato por conjunto de alimentos (el más reciente), con cuántas veces se repite.
  const vistos = new Map();
  for (const f of ctx.fuentes.filter((x) => x.tipo === 'historial')) {
    const k = claveConjunto(f.lineas);
    if (vistos.has(k)) { vistos.get(k).veces++; continue; }
    const c = { tipo: 'historial', origen: `Tu cena del ${fechaCorta(f.fecha)}`, origenClave: `h:${f.fecha}`, veces: 1, lineas: f.lineas };
    vistos.set(k, c);
    crudos.push(c);
  }
  // 2. Plantillas de cena.
  for (const f of ctx.fuentes.filter((x) => x.tipo === 'plantilla')) {
    crudos.push({ tipo: 'plantilla', origen: `Tu plantilla «${f.nombre}»`, origenClave: `p:${f.id}`, veces: 1, lineas: f.lineas });
  }
  // 3. Semilla (solo con menos de 21 días con cena en la app).
  for (const f of ctx.fuentes.filter((x) => x.tipo === 'semilla')) {
    crudos.push({ tipo: 'semilla', origen: `Tu cena de Cronometer del ${fechaCorta(f.fecha)}`, origenClave: `s:${f.fecha}`, veces: 1, lineas: f.lineas });
  }
  const bases = [];
  for (const c of crudos) {
    const l = completar(limpiar(c, ctx), ctx);
    if (l) bases.push({ ...l, sHab: c.tipo === 'semilla' ? 0.5 : Math.min(1, c.veces / 3) });
  }
  // 4. Recetas con datos (rol plato) + el postre habitual.
  const recetas = [...ctx.recetaIds].sort(porId).filter((id) => ctx.rolDe(id) === 'plato' && ctx.motivo(id) === null);
  for (const id of recetas) {
    const c = completar(limpiar({ tipo: 'receta', origen: `Tu receta «${ctx.nombre(id)}»`, origenClave: `r:${id}`, lineas: [{ food_id: id, gramos: ctx.gramosHabituales(id, RACION_RECETA_G) }] }, ctx), ctx);
    if (c) bases.push({ ...c, sHab: 1 });
  }
  // 5. Variantes: un solo componente (proteína, hidrato o verdura) cambiado por otro habitual del mismo rol.
  const variantes = [];
  for (const b of bases.filter((x) => ['historial', 'plantilla', 'semilla'].includes(x.tipo))) {
    for (const rol of ['proteina', 'hidrato', 'verdura']) {
      const actual = [...b.lineas].filter((l) => l.rol === rol).sort((x, y) => y.gramos - x.gramos || porId(x.food_id, y.food_id))[0];
      if (!actual) continue;
      const alternativas = ctx.habitualesDe(rol).filter((id) => !b.lineas.some((l) => l.food_id === id)).slice(0, 3);
      for (const id of alternativas) {
        variantes.push({
          ...b, tipo: b.tipo, variante: true, origen: `${b.origen} con ${minuscula(ctx.nombre(id))} en vez de ${minuscula(ctx.nombre(actual.food_id))}`,
          lineas: b.lineas.map((l) => (l === actual ? { food_id: id, gramos: ctx.gramosHabituales(id, 100), rol } : l)), sHab: b.sHab / 2,
        });
      }
    }
  }
  // IA: mismos pasos de limpieza; S_hab = 0.
  const ia = [];
  for (const idea of ideasIA ?? []) {
    const c = completar(limpiar({ tipo: 'ia', origen: `Idea de la IA: ${idea.nombre}`, origenClave: `i:${idea.nombre}`, lineas: idea.lineas.map((l) => ({ food_id: l.food_id, gramos: l.gramos })) }, ctx), ctx);
    if (c) ia.push({ ...c, sHab: 0 });
  }
  return { bases, variantes, ia };
}

// Extras de postre en orden fijo: chocolate, nueces y la fruta habitual.
function extrasPostre(ctx) {
  const out = [];
  for (const [id, g] of EXTRAS_POSTRE) if (ctx.motivo(id) === null) out.push({ food_id: id, gramos: g, rol: ctx.rolDe(id), extra: true });
  const fruta = ctx.habitualesDe('fruta')[0];
  if (fruta) out.push({ food_id: fruta, gramos: ctx.gramosHabituales(fruta, 100), rol: 'fruta', extra: true });
  return out;
}

// ---------- elección de las 3 (ESPEC §6.5) ----------

function elegir(props, n = N_PROPUESTAS) {
  const orden = [...props].sort((a, b) => b.puntuacion - a.puntuacion || porId(a.clave, b.clave));
  const elegidas = [];
  const proteinas = new Set();
  const variantesDe = new Map();
  const cabe = (p) => !p.variante || (variantesDe.get(p.origenClave) ?? 0) < 1;
  const toma = (p) => { elegidas.push(p); if (p.principal) proteinas.add(p.principal); if (p.variante) variantesDe.set(p.origenClave, 1); };
  for (const p of orden) if (elegidas.length < n && cabe(p) && !(p.principal && proteinas.has(p.principal))) toma(p);
  for (const p of orden) if (elegidas.length < n && !elegidas.includes(p) && cabe(p)) toma(p);
  return elegidas;
}

// Evalúa candidatos, quita duplicados (mismo conjunto de alimentos) y devuelve propuestas ordenadas.
function evaluarTodos(cands, ctx, extras, opts = {}) {
  const por = new Map();
  for (const c of cands) {
    const r = extras ? conExtras(c, ctx, extras, opts) : ajustar(c, ctx, opts);
    if (!r) continue;
    const clave = claveConjunto(r.cand.lineas);
    const p = { ...propuestaDe(r.cand, r.cand.lineas, r.calc, r.puntuacion, ctx, r.queda), clave };
    const previa = por.get(clave);
    if (!previa || p.puntuacion > previa.puntuacion + 1e-9) por.set(clave, p);
  }
  return [...por.values()];
}

// ---------- modo ligero y modo cubierto (ESPEC §6.1 y §6.6) ----------

function candidatosLigeros(ctx) {
  const out = [];
  const verdura = ctx.crudasValidas()[0]; // verdura que se come cruda (semilla.crudas)
  const aceite = ctx.habitualesDe('grasa')[0];
  const base = ctx.habitualesDe('postre_base')[0] ?? (ctx.motivo(POSTRE_BASE_ID) === null ? POSTRE_BASE_ID : null);
  for (const p of ctx.habitualesDe('proteina').slice(0, 4)) {
    const lineas = [lineaHabitual(ctx, p)];
    if (verdura) lineas.push({ ...lineaHabitual(ctx, verdura), gramos: Math.max(ctx.gramosHabituales(verdura, VERDURA_COMPLETAR_G), VERDURA_COMPLETAR_G) });
    if (aceite) lineas.push({ food_id: aceite, gramos: ACEITE_LIGERO_G, rol: 'grasa' });
    out.push({ tipo: 'ligera', origen: `Cena ligera: ${minuscula(ctx.nombre(p))}${verdura ? ` con ${minuscula(ctx.nombre(verdura))}` : ''}`, origenClave: `l:${p}`, sHab: 0.5, lineas });
  }
  if (base) {
    const postre = [{ food_id: base, gramos: ctx.gramosHabituales(base, YOGUR_G), rol: 'postre_base' }];
    if (ctx.motivo(CHIA_ID) === null) postre.push({ food_id: CHIA_ID, gramos: ctx.gramosHabituales(CHIA_ID, CHIA_G), rol: ctx.rolDe(CHIA_ID) });
    out.push({ tipo: 'ligera', origen: 'Tu postre habitual', origenClave: 'l:postre', sHab: 0.5, lineas: postre });
    const fruta = ctx.habitualesDe('fruta')[0];
    if (fruta) out.push({ tipo: 'ligera', origen: 'Tu postre habitual con fruta', origenClave: 'l:postre_fruta', sHab: 0.5, lineas: [...postre, lineaHabitual(ctx, fruta)] });
  }
  return out;
}

// Opciones "muy ligeras" (R entre 0 y 150) o una verdura cruda (R ≤ 0): una sola comida, con los gramos habituales
// reducidos para que quepa; se descarta si hay que bajar de la mitad.
function opcionesMuyLigeras(ctx) {
  const R = ctx.R;
  const out = [];
  const una = (id, origen, extra = {}) => {
    if (!id) return;
    const g0 = ctx.gramosHabituales(id, 100);
    const kcal0 = calcular([{ food_id: id, gramos: g0, rol: ctx.rolDe(id) }], ctx).kcal;
    const tope = R > 0 ? R : KCAL_VERDURA_CRUDA;
    const f = kcal0 > tope && kcal0 > 0 ? tope / kcal0 : 1;
    if (f < 0.5) return;
    const gramos = Math.max(1, Math.floor(g0 * f));
    const lineas = [{ food_id: id, gramos, rol: ctx.rolDe(id) }];
    const calc = calcular(lineas, ctx);
    const puntuacion = puntuar(calc, ctx, { E: Math.max(calc.kcal, 1), sHab: 0.5 });
    if (puntuacion === null) return;
    out.push({ ...propuestaDe({ tipo: 'ligera', origen, origenClave: `m:${id}` }, lineas, calc, puntuacion, ctx, extra), clave: id });
  };
  const verdura = ctx.crudasValidas()[0];
  if (R > 0) {
    una(ctx.habitualesDe('postre_base')[0] ?? (ctx.motivo(POSTRE_BASE_ID) === null ? POSTRE_BASE_ID : null), 'Yogur griego');
    for (const f of ctx.habitualesDe('fruta').slice(0, 1)) una(f, 'Tu fruta habitual');
    una(verdura, 'Tu verdura cruda habitual');
  } else {
    una(verdura, 'Solo si te apetece: verdura cruda', { porEncimaObjetivo: true });
  }
  return out.slice(0, N_PROPUESTAS);
}

// ---------- API ----------

const AVISO = (codigo, texto, extra = {}) => ({ codigo, texto, ...extra });
const nf = (x) => Math.round(x);

export function textoDescartados(descartados, nombres = (id) => id) {
  const por = (motivo) => descartados.filter((d) => d.motivo === motivo).map((d) => d.nombre ?? nombres(d.food_id));
  const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ni ${xs.at(-1)}` : xs[0]);
  const out = [];
  const sin = por('sin_datos');
  if (sin.length) out.push(`No propongo ${lista(sin)}: no ${sin.length > 1 ? 'tienen' : 'tiene'} datos.`);
  const exc = por('excluido');
  if (exc.length) out.push(`No propongo ${lista(exc)}: ${exc.length > 1 ? 'están excluidos' : 'está excluido'} del catálogo (incluir=no).`);
  const fuera = por('fuera_documento');
  if (fuera.length) out.push(`No propongo ${lista(fuera)}: ${fuera.length > 1 ? 'no están' : 'no está'} en tu documento.`);
  return out;
}

// entrada: ver ESPEC §5. settings = { requiredNutrients, completenessThreshold } (opcional: avisos de incompletos).
export function proponerCenas(entrada) {
  const { fecha, comidasDelDia = [], ideasIA = [], semilla = null } = entrada;
  const ctx = contexto({ ...entrada, semilla, comidasDelDia });
  const avisos = [];
  const faltan = ctx.especs.filter((e) => e.falta > 0 && e.clave !== 'energia_kcal')
    .map((e) => ({ clave: e.clave, label: e.label, unit: e.unit, meta: e.meta, consumido: e.consumido, falta: e.falta, pctPorCubrir: e.falta / e.meta, parcial: e.parcialDia }))
    .sort((a, b) => b.pctPorCubrir - a.pctPorCubrir || porId(a.clave, b.clave));
  const macroDe = (clave) => { const e = ctx.especs.find((x) => x.clave === clave); return e ? { clave, label: e.label, unit: e.unit, meta: e.meta, consumido: e.consumido, falta: e.falta } : null; };
  const resumen = {
    kcal: { consumidas: ctx.consumidoKcal, meta: ctx.metaKcal, restantes: ctx.R },
    macros: ['proteina_g', 'hidratos_g', 'grasa_total_g'].map(macroDe).filter(Boolean),
    micros: faltan.filter((f) => !MACROS.includes(f.clave)).slice(0, 5),
    mensaje: '',
  };
  const salida = (estado, extra = {}) => ({ estado, modo: estado, resumen, faltan, avisos, propuestas: [], ideas: [], descartados: [], recomendacion: null, ...extra });

  if (ctx.R === null) {
    avisos.push(AVISO('sin_objetivos', 'No hay objetivos de energía para este día: no puedo calcular cuánto te falta.'));
    return salida('sin_objetivos');
  }
  // Avisos del día
  if (!comidasDelDia.length) avisos.push(AVISO('dia_vacio', '')); // el texto se completa al final, con las kcal de la cena
  if (ctx.objetivos?.periodo === null || ctx.objetivos?.periodo === undefined) avisos.push(AVISO('sin_plan', 'Sin plan de objetivos: uso las referencias EFSA.'));
  const cenaHecha = comidasDelDia.filter((m) => m.meal === 'cena');
  if (cenaHecha.length) {
    const k = dayTotals(cenaHecha, ctx.foodsById, ['energia_kcal']).energia_kcal.value ?? 0;
    avisos.push(AVISO('cena_registrada', `Ya tienes una cena registrada (${nf(k)} kcal): esto propone qué añadir.`));
  }
  const sinKcal = ctx.totals.energia_kcal?.missing ?? [];
  if (sinKcal.length) avisos.push(AVISO('consumido_parcial', `Lo que llevas ${ctx.hoy && fecha !== ctx.hoy ? 'ese día' : 'hoy'} no es completo: ${sinKcal.map((id) => ctx.nombre(id)).join(', ')} no ${sinKcal.length > 1 ? 'tienen' : 'tiene'} datos; puede que te falte menos.`, { alimentos: sinKcal }));
  for (const e of ctx.especs) if (e.ul !== null && e.consumido > e.ul) avisos.push(AVISO('ul_superado', `Ya has superado el UL de ${e.label} ${ctx.hoy && fecha !== ctx.hoy ? 'ese día' : 'hoy'}.`, { nutriente: e.clave }));
  if (ctx.usarSemilla) {
    avisos.push(AVISO('semilla', ctx.diasConCena === 0
      ? 'Aún no tienes cenas en la app: uso tus cenas de Cronometer.'
      : `Aún tienes ${ctx.diasConCena} días con cena en la app: uso también tus cenas de Cronometer.`, { dias: ctx.diasConCena }));
  }
  if (comidasDelDia.length && ctx.R >= R_NORMAL && ctx.R > ctx.topeCena) {
    avisos.push(AVISO('cena_tope', `Te faltan ${nf(ctx.R)} kcal: una cena no debería cubrirlo todo; propongo como mucho ${nf(ctx.topeCena)} kcal.`, { kcal: nf(ctx.topeCena) }));
  }
  const cierra = (r) => {
    const i = avisos.findIndex((a) => a.codigo === 'dia_vacio');
    if (i >= 0) {
      const maxK = r.propuestas.length ? Math.max(...r.propuestas.map((p) => p.kcal)) : null;
      if (maxK === null) avisos.splice(i, 1);
      else avisos[i] = AVISO('dia_vacio', `No has registrado nada ${ctx.hoy && fecha !== ctx.hoy ? 'ese día' : 'hoy'}: la propuesta cubre solo la cena (como mucho ${nf(maxK)} kcal), no el día entero.`, { kcal: nf(maxK) });
    }
    return { ...r, avisos };
  };
  const descartados = () => [...ctx.descartados.entries()].sort((a, b) => porId(a[0], b[0])).map(([food_id, motivo]) => ({ food_id, nombre: ctx.nombre(food_id), motivo }));

  // Modo cubierto
  if (ctx.R < R_LIGERO) {
    resumen.mensaje = ctx.R > 0
      ? `Ya llevas ${nf(ctx.consumidoKcal)} kcal de ${nf(ctx.metaKcal)}: te faltan solo ${nf(ctx.R)}.`
      : `Te has pasado ${nf(-ctx.R)} kcal.`;
    const props = opcionesMuyLigeras(ctx);
    return cierra(salida('cubierto', { propuestas: props, recomendacion: ctx.R > 0 ? 'muy_ligero' : 'no_cenar', descartados: descartados() }));
  }

  const ligero = ctx.R < R_NORMAL;
  let propuestas;
  let ideas = [];
  if (ligero) {
    propuestas = elegir(evaluarTodos(candidatosLigeros(ctx), ctx, null, { ligero: true }));
  } else {
    const { bases, variantes, ia } = candidatosNormales(ctx, ideasIA);
    const extras = extrasPostre(ctx);
    const todas = evaluarTodos([...bases, ...variantes], ctx, extras);
    propuestas = elegir(todas);
    if (ia.length) {
      const claves = new Set(propuestas.map((p) => p.clave));
      ideas = elegir(evaluarTodos(ia, ctx, extras).filter((p) => !claves.has(p.clave)));
    }
  }
  const out = salida(propuestas.length ? (ligero ? 'ligero' : 'normal') : 'sin_candidatos', { modo: ligero ? 'ligero' : 'normal', propuestas, ideas, descartados: descartados() });
  if (!propuestas.length) avisos.push(AVISO('sin_candidatos', 'No tengo cenas habituales con tu documento actual: registra alguna cena o guarda una plantilla de cena.'));
  return cierra(out);
}

// Nombres (sin cantidades ni dígitos) de los nutrientes con déficit, para «Más ideas»: como mucho 8, los de más % por cubrir.
export function deficitsParaIA(faltan) {
  const out = [];
  for (const f of faltan) {
    const n = nombreParaIA(f.clave, f.label);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= MAX_DEFICITS_IA) break;
  }
  return out;
}
