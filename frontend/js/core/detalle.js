// Detalle de un alimento y de un nutriente: lógica pura, sin DOM (las pantallas están en ui/detalle-*-screen.js).
// Los números son siempre los del código: valor por 100 g del documento × gramos / 100 (nutrients.js). Sin dato = null,
// nunca 0; el % y el estado de la barra son los del informe diario (evaluate de diary.js).
import { sumLines, columnasVacias, nutrientsForGrams } from './nutrients.js';
import { evaluate } from './diary.js';
import { foodCompleteness } from './completeness.js';
import { isExcluded } from './excluded.js';
import { unitOf } from './catalog.js';
import { parseNumber } from './numbers.js';
import { MAX_GRAMS } from './ai-contract.js';
import { referenceValue, ulVigilado } from './targets.js';

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
const redondea = (x) => Math.round(x * 1e6) / 1e6;

export const MACROS_RESUMEN = ['energia_kcal', 'proteina_g', 'hidratos_g', 'grasa_total_g'];
export const AVISO_SANITARIO = 'Información general; no sustituye al consejo de un profesional sanitario.';

// ---------- cantidad ----------

// Opciones del selector de porciones: «g» y cada porción del documento («1 cucharada (13,5 g)»).
export function opcionesPorcion(food) {
  return [{ id: 'g', etiqueta: 'g', gramos: 1 }, ...(food.porciones ?? []).map((p, i) => ({ id: `p${i}`, etiqueta: `1 ${p.nombre} (${nf.format(p.gramos)} g)`, gramos: p.gramos }))];
}

// Gramos a partir de lo escrito en «Cantidad» (admite coma decimal) y la opción elegida. null si no es un número > 0.
export function gramosDeCantidad(texto, opcion = { gramos: 1 }) {
  const n = parseNumber(texto);
  return n.status === 'ok' && n.value > 0 ? redondea(n.value * opcion.gramos) : null;
}

// Texto de «Cantidad» para unos gramos en una opción (1 cucharada = 1; en gramos, los gramos tal cual).
export const cantidadDeGramos = (gramos, opcion = { gramos: 1 }) => String(redondea(gramos / opcion.gramos)).replace('.', ',');

// ---------- nutrientes de un alimento para una cantidad ----------

// Grupos de la pantalla (los de data/nutrients.json, con proteína y aminoácidos juntos y los hidratos aparte de ellos).
export const GRUPOS_DETALLE = [
  { id: 'general', titulo: 'General' },
  { id: 'hidratos', titulo: 'Hidratos' },
  { id: 'lipidos', titulo: 'Lípidos' },
  { id: 'proteinas', titulo: 'Proteínas y aminoácidos' },
  { id: 'vitaminas', titulo: 'Vitaminas' },
  { id: 'minerales', titulo: 'Minerales' },
];
// Subpartidas (se muestran con sangría y peso normal): las grasas bajo la grasa total, ALA/EPA/DHA bajo omega-3 y fibra,
// azúcares y almidón bajo hidratos.
const SUBPARTIDAS = new Set(['grasas_saturadas_g', 'grasas_monoinsaturadas_g', 'grasas_poliinsaturadas_g', 'grasas_trans_g', 'ala_g', 'epa_g', 'dha_g', 'fibra_g', 'azucares_g', 'almidon_g']);
export function grupoDetalle(n) {
  if (n.key === 'proteina_g' || n.group === 'aminoácidos') return 'proteinas';
  if (n.group === 'hidratos y proteína') return 'hidratos';
  if (n.group === 'grasas') return 'lipidos';
  return GRUPOS_DETALLE.some((g) => g.id === n.group) ? n.group : 'otros';
}

// Agrupa filas por el grupo de la pantalla, en el orden del catálogo (el mismo del informe diario y del detalle de un alimento).
//   filas: Map clave -> fila (las que no estén no se enseñan); sumas: filas de un objetivo que es suma (EPA + DHA, metionina +
//   cistina), cada una justo detrás de su última parte; excluir: claves que se enseñan en otro sitio; sub(clave): subpartida.
export function agruparFilas({ catalog, filas, sumas = [], excluir = new Set(), sub = () => false }) {
  const grupos = [];
  const grupoDe = (id) => {
    let g = grupos.find((x) => x.id === id);
    if (!g) { g = { id, titulo: GRUPOS_DETALLE.find((x) => x.id === id)?.titulo ?? 'Otros', filas: [] }; grupos.push(g); }
    return g;
  };
  for (const n of catalog.list) {
    const fila = filas.get(n.key);
    if (fila && !excluir.has(n.key)) grupoDe(grupoDetalle(n)).filas.push({ ...fila, sub: sub(n.key) });
    for (const t of sumas) if (t.suma[t.suma.length - 1] === n.key) grupoDe(grupoDetalle(n)).filas.push({ ...t, sub: false });
  }
  grupos.sort((a, b) => { const ia = GRUPOS_DETALLE.findIndex((x) => x.id === a.id); const ib = GRUPOS_DETALLE.findIndex((x) => x.id === b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  return grupos;
}

// Los grupos del informe diario: todos los nutrientes que no son los macros del panel de arriba (`excluir`), con las filas
// de diaryReport (rows y otros). Mismos títulos y orden que el detalle de un alimento.
export function gruposInforme({ rep, catalog, excluir = new Set() }) {
  const todas = [...rep.rows, ...rep.otros];
  return agruparFilas({ catalog, filas: new Map(todas.filter((r) => !r.suma).map((r) => [r.clave, r])), sumas: todas.filter((r) => r.suma), excluir });
}

// Una fila por nutriente del catálogo: { clave, label, unit, total (null = sin dato), pct, estado, superaUl, ul, min, objetivo, max, valor }.
// objetivos = targetsForDate(...).list (los de ese día); lo que no tiene objetivo queda 'sin_objetivo' (sin % ni barra).
// foods (opcional): los alimentos del documento; sin objetivo y con la columna vacía en todos, el nutriente no sale en `grupos`
// (sí en `filas`).
export function filasAlimento({ food, grams, objetivos, catalog, foods = null }) {
  const sums = sumLines([{ food, grams }], catalog.keys);
  const porClave = new Map((objetivos ?? []).filter((t) => !t.suma).map((t) => [t.clave, t]));
  const filas = new Map();
  for (const n of catalog.list) {
    const t = porClave.get(n.key) ?? { clave: n.key, label: n.label, unit: unitOf(n.key), min: null, objetivo: null, max: null, valor: null, ul: null };
    filas.set(n.key, { ...t, clave: n.key, label: t.label ?? n.label, unit: t.unit ?? unitOf(n.key), ...evaluate(sums[n.key], t), missing: sums[n.key].missing });
  }
  // Objetivos que son suma de varios nutrientes (EPA + DHA): como `combine` del informe, null si ninguno tiene dato.
  const sumas = (objetivos ?? []).filter((t) => Array.isArray(t.suma) && t.suma.length && t.suma.every((k) => sums[k]));
  for (const t of sumas) {
    const partes = t.suma.map((k) => sums[k].value).filter((v) => v !== null);
    const total = { value: partes.length ? partes.reduce((a, v) => a + v, 0) : null, missing: [...new Set(t.suma.flatMap((k) => sums[k].missing))] };
    filas.set(t.clave, { ...t, ...evaluate(total, t), missing: total.missing });
  }
  const resumen = MACROS_RESUMEN.map((k) => filas.get(k)).filter(Boolean);
  const ocultos = foods ? new Set([...columnasVacias(foods, catalog.keys)].filter((k) => !porClave.has(k))) : new Set();
  const grupos = agruparFilas({
    catalog, excluir: ocultos, sub: (k) => SUBPARTIDAS.has(k),
    filas: new Map([...filas].filter(([k]) => catalog.byKey.has(k))), sumas: sumas.map((t) => filas.get(t.clave)),
  });
  return { filas, resumen, grupos };
}

// ---------- fuente y completitud ----------

// Texto corto de dónde salen los datos del alimento, y el texto completo de fuente_usda para el <details>.
export function fuenteDe(food) {
  const completo = String(food.extra?.fuente_usda ?? '').trim();
  const fdc = String(food.extra?.fdc_id ?? '').trim();
  const primera = completo.split(' · ')[0];
  let corto;
  if (/^BEDCA\b/i.test(primera)) corto = 'BEDCA (Base de Datos Española de Composición de Alimentos)';
  else if (/^Etiqueta\b/i.test(primera)) corto = 'Etiqueta del producto';
  else if (/^Receta\b/i.test(primera)) corto = 'Receta: calculada con los datos de sus ingredientes';
  else {
    const base = (primera.match(/\((SR Legacy|Foundation|FNDDS|Survey \(FNDDS\)|Branded)\)\s*$/i) ?? [])[1];
    if (base || fdc) corto = `USDA FoodData Central${base ? ` (${base})` : ''}${fdc ? ` · fdcId ${fdc}` : ''}`;
    else corto = 'Sin fuente anotada en el documento';
  }
  return { corto, completo: completo || null };
}

// n/31: nutrientes obligatorios de data/settings.json con dato (un 0 escrito cuenta).
export const completitudDe = (food, required) => { const c = foodCompleteness(food, required); return { filled: c.filled, total: c.total }; };

// ---------- guardar los gramos de una línea del Diario ----------

// Copia del registro con otros gramos en una sola línea (mismo id; updatedAt como en «Editar»). Lanza si no es válido.
export function registroConGramos(rec, index, grams, now = new Date()) {
  if (!Number.isInteger(index) || !rec?.lines?.[index]) throw new Error('No encuentro esa línea en la comida');
  if (!(grams > 0) || !Number.isFinite(grams)) throw new Error('Los gramos tienen que ser mayores que 0');
  if (grams > MAX_GRAMS) throw new Error(`Más de ${MAX_GRAMS} g: cámbialo desde «Editar», donde se confirma`);
  return { ...rec, updatedAt: now.toISOString(), lines: rec.lines.map((l, i) => (i === index ? { ...l, grams } : l)) };
}

// ---------- detalle de un nutriente ----------

// Ración habitual de un alimento: cantidad_habitual_g; si no, la primera porción; si no, 100 g.
export function racionHabitual(food) {
  const h = parseNumber(food.extra?.cantidad_habitual_g);
  if (h.status === 'ok' && h.value > 0) return { gramos: h.value, origen: 'habitual' };
  const p = (food.porciones ?? [])[0];
  if (p && p.gramos > 0) return { gramos: p.gramos, origen: 'porcion' };
  return { gramos: 100, origen: '100g' };
}

// Los `n` alimentos del documento (sin incluir=no, con dato de ese nutriente y distinto de 0) que más aportan por ración
// habitual. objetivo = valor del día para el %, o null. Orden: más aporte primero; empates por nombre.
// suma: claves de un objetivo que es suma (EPA + DHA): se suman las que tienen dato.
export function topCatalogo({ foods, clave, suma = null, objetivo = null, n = 5 }) {
  const filas = [];
  for (const f of foods) {
    if (isExcluded(f)) continue;
    const partes = (suma ?? [clave]).map((k) => f.nutrients?.[k]).filter(esNum);
    const per100 = partes.length ? partes.reduce((a, v) => a + v, 0) : null;
    if (!esNum(per100) || per100 === 0) continue;
    const racion = racionHabitual(f);
    const aporte = (per100 * racion.gramos) / 100;
    filas.push({ id: f.id, nombre: f.nombre, racion: racion.gramos, origen: racion.origen, aporte, pct: esNum(objetivo) && objetivo > 0 ? aporte / objetivo : null });
  }
  return filas.sort((a, b) => b.aporte - a.aporte || a.nombre.localeCompare(b.nombre, 'es')).slice(0, n);
}

// Referencia de targets.json (EFSA/UE) de un nutriente, con el perfil del plan: { valor, tipo } o null.
export function referenciaDe(targets, clave, perfil) {
  const t = targets?.list?.find((x) => x.clave === clave);
  if (!t || t.tipo === 'rango') return null; // un rango (poli y monoinsaturadas, % de la energía) ya es la fila Mínimo/Máximo del día: no se repite como «Referencia»
  const valor = referenceValue(targets, clave, { perfil });
  return valor === null || valor === undefined ? null : { valor, tipo: t.tipo };
}

const TIPO_TEXTO = { min: 'mínimo', max: 'máximo', objetivo: 'objetivo' };

// Datos de la barra con marcas y de la tabla de «Detalle de nutriente».
//   fila: la del nutriente en filasAlimento (aporte = fila.total, con la cantidad elegida; null = sin dato)
//   hoy: total del día (o null si no hay), aporteOriginal: lo que aportaba la línea guardada (para no contarla dos veces)
//   referencia: { valor, tipo } de referenciaDe. Solo se incluye lo que existe.
//   etiquetaHoy: «Llevas hoy» o «Llevas ese día» (si el día no es hoy)
//   modo 'dia' (desde el informe diario, sin alimento): `fila` es la fila del informe (fila.total = total del día), no hay «Este
//   alimento» y la barra es solo lo que llevas ese día frente al rango; `hoy` y `aporteOriginal` no se usan
// «Llevas hoy» de la tabla es el total del día CON la cantidad elegida (lo de otros alimentos + este alimento); la leyenda
// de la barra da las dos partes por separado: `leyenda.otros` (el día sin este alimento) y `leyenda.aporte`.
export function rangoNutriente({ fila, hoy: hoyDado = null, aporteOriginal = null, referencia: referenciaDada = null, etiquetaHoy = 'Llevas hoy', modo = 'alimento' }) {
  const dia = modo === 'dia';
  const hoy = dia ? fila.total : hoyDado;
  // Si el objetivo del día ya ES la referencia (origen 'referencia'), una sola cifra: la del día, que puede diferir de la de
  // resolveTargets (trans, ALA, B1 y niacina dependen de las kcal del plan). Se funde con su límite, sin fila «Referencia» aparte.
  const referencia = referenciaDada && fila.origen === 'referencia' && esNum(fila[referenciaDada.tipo]) ? { ...referenciaDada, valor: fila[referenciaDada.tipo] } : referenciaDada;
  const aporte = dia ? null : fila.total;
  const hayHoy = esNum(hoy);
  const otros = hayHoy && !dia ? Math.max(0, hoy - (esNum(aporteOriginal) ? aporteOriginal : 0)) : 0;
  const total = dia ? (hayHoy ? hoy : 0) : otros + (aporte ?? 0);
  // Marcas: las que tienen el mismo valor (mínimo y referencia, por ejemplo) comparten una sola con una etiqueta unida.
  const bruto = [];
  const marca = (id, etiqueta, valor) => { if (esNum(valor)) bruto.push({ id, etiqueta, valor }); };
  marca('min', 'Mín.', fila.min); marca('objetivo', 'Objetivo', fila.objetivo); marca('max', 'Máx.', fila.max);
  marca('referencia', 'Ref.', referencia?.valor); marca('ul', 'UL', ulVigilado(fila)); // el UL informativo no se dibuja: estiraría la escala (3000 µg frente a 750) sin decir nada útil; va en la tabla, con su nota
  const marcas = [];
  for (const m of bruto) {
    const igual = marcas.find((x) => Math.abs(x.valor - m.valor) <= 1e-9 * Math.max(1, Math.abs(m.valor)));
    if (igual) { igual.ids.push(m.id); igual.etiquetas.push(m.etiqueta); } else marcas.push({ id: m.id, ids: [m.id], etiquetas: [m.etiqueta], valor: m.valor });
  }
  for (const m of marcas) m.etiqueta = m.etiquetas.map((e, i) => (i === 0 || e === 'UL' ? e : e.charAt(0).toLowerCase() + e.slice(1))).join(' y ');
  const tope = Math.max(...marcas.map((m) => m.valor), total, hayHoy ? hoy : 0);
  const escala = marcas.length && tope > 0 ? tope * 1.15 : null; // sin ninguna referencia no hay barra: solo el valor
  const pos = (v) => Math.min(1, Math.max(0, v / escala));
  // Tabla: «Referencia» se funde con el mínimo, el objetivo o el máximo si vale lo mismo («Mínimo (referencia)»).
  const filas = dia ? [{ id: 'hoy', etiqueta: etiquetaHoy, valor: hayHoy ? hoy : null }] : [{ id: 'alimento', etiqueta: 'Este alimento', valor: aporte }];
  const cambiado = esNum(aporte) !== esNum(aporteOriginal) || (esNum(aporte) && Math.abs(aporte - aporteOriginal) > 1e-9);
  if (hayHoy && !dia) filas.push({ id: 'hoy', etiqueta: `${etiquetaHoy}${cambiado ? ' (con esta cantidad)' : ''}`, valor: total });
  const refValor = referencia?.valor;
  let refFundida = false;
  for (const [id, etiqueta, valor] of [['min', 'Mínimo', fila.min], ['objetivo', 'Objetivo', fila.objetivo], ['max', 'Máximo', fila.max]]) {
    if (!esNum(valor)) continue;
    const funde = fila.soloReferencia || (!refFundida && esNum(refValor) && Math.abs(valor - refValor) <= 1e-9 * Math.max(1, Math.abs(valor))); // una referencia solo_referencia ya ES la referencia: sus filas lo dicen
    if (funde) refFundida = true;
    filas.push({ id, etiqueta: funde ? `${etiqueta} (referencia)` : etiqueta, valor });
  }
  if (esNum(refValor) && !refFundida) filas.push({ id: 'referencia', etiqueta: 'Referencia', valor: refValor, nota: TIPO_TEXTO[referencia.tipo] ?? '' });
  if (esNum(fila.ul)) filas.push(fila.ulInformativo ? { id: 'ul', etiqueta: 'UL (informativo)', valor: fila.ul } : { id: 'ul', etiqueta: 'UL', valor: fila.ul });
  // Estado del total de la barra (lo de otros + este alimento) frente al objetivo del día, con la misma lógica del informe.
  const ev = escala ? evaluate({ value: total > 0 || aporte !== null || hayHoy ? total : null, missing: [] }, fila) : null;
  if (dia) {
    return {
      filas, modo, sinReferencia: marcas.length === 0, faltaPeso: marcas.length === 0 && Boolean(fila.faltaPeso),
      marcas: escala ? marcas.map((m) => ({ ...m, pos: pos(m.valor) })) : [], escala,
      leyenda: { otros: null, aporte: { etiqueta: etiquetaHoy, valor: hayHoy ? hoy : null } },
      // lo que llevas se dibuja como el relleno principal (del color del estado: rojo si supera el UL), desde el principio de la barra
      barra: escala ? { otros: 0, aporte: hayHoy ? pos(total) : 0, total, estado: ev?.estado ?? 'sin_dato', superaUl: Boolean(ev?.superaUl) } : null,
    };
  }
  return {
    filas,
    sinReferencia: marcas.length === 0, faltaPeso: marcas.length === 0 && Boolean(fila.faltaPeso),
    marcas: escala ? marcas.map((m) => ({ ...m, pos: pos(m.valor) })) : [],
    escala,
    leyenda: { otros: hayHoy ? { etiqueta: `${etiquetaHoy} (sin este alimento)`, valor: otros } : null, aporte: { etiqueta: 'Este alimento', valor: aporte } },
    barra: escala ? { otros: pos(otros), aporte: aporte === null ? 0 : Math.min(pos(otros + aporte) - pos(otros), 1), total, estado: ev?.estado ?? 'sin_dato', superaUl: Boolean(ev?.superaUl) } : null,
  };
}

// «Qué te ha aportado hoy»: línea por línea, lo que aportó cada alimento del día a un nutriente (o a una suma: EPA + DHA, se
// suman las partes que tienen dato). meals = las comidas del día (registros con `lines`), byId = alimentos del documento.
//   con: las líneas con dato, de más a menos (empates por nombre): { foodId, nombre, meal, recordId, lineIndex, grams, valor, pct, parcial, abrible }
//        pct = parte del total del día (null si el total es 0); parcial = a una suma le falta alguna parte
//   sin: las líneas sin dato de ese nutriente (nunca 0, regla 4), en el orden del día
//   total: suma de las líneas con dato (null si ninguna): coincide con el total del Diario
export function aportesDelDia({ meals, byId, clave, suma = null }) {
  const keys = suma?.length ? suma : [clave];
  const todas = [];
  for (const m of meals ?? []) {
    (m.lines ?? []).forEach((l, lineIndex) => {
      const food = byId.get(l.food_id);
      const partes = food ? Object.values(nutrientsForGrams(food, l.grams, keys)) : keys.map(() => null); // borrado del documento: sin dato
      const con = partes.filter(esNum);
      todas.push({ foodId: l.food_id, nombre: food?.nombre ?? l.food_id, meal: m.meal, recordId: m.id, lineIndex, grams: l.grams,
        valor: con.length ? con.reduce((a, v) => a + v, 0) : null, parcial: con.length > 0 && con.length < keys.length, abrible: Boolean(food) });
    });
  }
  const con = todas.filter((x) => x.valor !== null);
  const total = con.length ? con.reduce((a, x) => a + x.valor, 0) : null;
  for (const x of todas) x.pct = x.valor !== null && total > 0 ? x.valor / total : null;
  con.sort((a, b) => b.valor - a.valor || a.nombre.localeCompare(b.nombre, 'es'));
  return { con, sin: todas.filter((x) => x.valor === null), total };
}

// Número para estas pantallas: lo muy pequeño pero no nulo («<0,01») no se confunde con un 0 real. fmt = formato normal.
export function cantidadLegible(v, unitLabel, fmt) {
  return esNum(v) && v > 0 && v < 0.01 ? `<0,01 ${unitLabel}` : fmt(v);
}

// ---------- información estática de cada nutriente (data/nutrientes-info.json) ----------

const TEXTOS_INFO = ['resumen', 'necesidades', 'deficit', 'exceso', 'fuentes_alimentos', 'consejos', 'discrepancias'];
const SECCIONES_INFO = [['resumen', 'Qué es'], ['necesidades', 'Cuánto necesitas'], ['deficit', 'Si falta'], ['exceso', 'Si sobra'], ['fuentes_alimentos', 'Dónde está'], ['consejos', 'Consejos'], ['discrepancias', 'Discrepancias entre fuentes']];
export { SECCIONES_INFO };

// Limpia el JSON del fichero: solo textos no vacíos y enlaces https. Lo que no se entiende se ignora (sin romper la pantalla).
export function limpiarInfoNutrientes(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' && raw.nutrientes && typeof raw.nutrientes === 'object' ? raw.nutrientes : {};
  for (const [clave, e] of Object.entries(src)) {
    if (!e || typeof e !== 'object') continue;
    const entrada = {};
    for (const c of TEXTOS_INFO) if (typeof e[c] === 'string' && e[c].trim()) entrada[c] = e[c].trim();
    entrada.referencias = (Array.isArray(e.referencias) ? e.referencias : []).filter((r) => r && typeof r.titulo === 'string' && typeof r.url === 'string' && /^https:\/\//.test(r.url))
      .map((r) => ({ organismo: String(r.organismo ?? ''), titulo: r.titulo, url: r.url, consultado: String(r.consultado ?? '') }));
    if (TEXTOS_INFO.some((c) => entrada[c])) out[clave] = entrada;
  }
  return out;
}
