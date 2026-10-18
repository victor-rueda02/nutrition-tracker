// Plan de objetivos (formato en docs/OBJETIVOS-FORMATO.md): periodos con tipos de día, excepciones por fecha y, para lo
// que el plan no define, la referencia EFSA/UE de targets.json. Funciones puras, sin DOM.
//
// targetsForDate(fecha, { plan, targets, catalog }): los objetivos vigentes ESE día. Para cada nutriente manda la
// primera capa que lo define: 1) excepción de la fecha, 2) tipo del día (el de la excepción o el de `semana`) del
// periodo vigente, 3) valores por defecto del periodo vigente, 4) referencia. La entrada se sustituye entera (no se
// mezclan límites de capas distintas) y `null` deja el nutriente sin objetivo. Periodo vigente: de los que cubren la
// fecha, el que empezó más tarde. Los UL siempre salen de targets.json.
import { unitOf } from './catalog.js';
import { KCAL_TO_MJ } from './targets.js';
import { shiftDate } from './diary.js';
import { normalizeText } from './text.js';

export const PLAN_KIND = 'plan_objetivos';
export const PLAN_VERSION = 1;
export const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']; // en el orden de getUTCDay
export const DIAS_SEMANA = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']; // para mostrar
export const LIMITES = ['min', 'objetivo', 'max'];
export const KCAL_POR_G = { proteina_g: 4, hidratos_g: 4, azucares_g: 4, grasa_total_g: 9, grasas_saturadas_g: 9 };
export const POR_KG = { energia_kcal: 'kcal/kg', proteina_g: 'g/kg', hidratos_g: 'g/kg', grasa_total_g: 'g/kg', fibra_g: 'g/kg' };

const CAMPOS = {
  plan: ['tipo', 'version', 'nombre', 'perfil', 'periodos', 'excepciones', 'nota'],
  periodo: ['id', 'nombre', 'inicio', 'fin', 'peso_kg', 'valores', 'tipos', 'semana', 'nota'],
  tipo: ['nombre', 'valores', 'nota'],
  excepcion: ['fecha', 'tipo', 'peso_kg', 'valores', 'nota'],
  entrada: ['unidad', 'min', 'objetivo', 'max', 'nota'],
};
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const decimales = (unit) => (unit === 'kcal' ? 0 : unit === 'g' ? 1 : 2);

// 'AAAA-MM-DD' que existe en el calendario.
export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export const diaSemana = (fecha) => DIAS[new Date(`${fecha}T00:00:00Z`).getUTCDay()];
// "lun", "Lunes", "miércoles", "SÁB"… -> clave de 3 letras (o null).
export function claveDia(s) {
  const k = normalizeText(String(s ?? '')).replace(/\s+/g, '').slice(0, 3);
  return DIAS.includes(k) ? k : null;
}

// Datos de un nutriente para el plan: el objetivo de targets.json (con su UL y notas) o, si no lo tiene, la columna del
// catálogo. null si no existe.
function infoNutriente(clave, targets, catalog) {
  const t = targets.list.find((x) => x.clave === clave);
  if (t) return t;
  const n = catalog.byKey.get(clave);
  return n ? { clave, label: n.label, unit: unitOf(clave), suma: null, ul: null, nota: '', notaUl: '', fuente: '' } : null;
}

// Unidades que admite un nutriente: la suya (o ninguna), por kg y % de kcal (ver tabla del formato).
export function unidadesPara(clave, unit) {
  const u = ['', unit];
  if (unit === 'ug') u.push('µg');
  if (POR_KG[clave]) u.push(POR_KG[clave]);
  if (KCAL_POR_G[clave]) u.push('%kcal');
  return u;
}
const unidadDe = (entrada) => (isObj(entrada) && typeof entrada.unidad === 'string' ? entrada.unidad.trim() : '');
const esPorKg = (u) => u === 'g/kg' || u === 'kcal/kg';

// ---------- validación ----------

// Lee el texto de un plan (JSON). Devuelve lo mismo que validatePlan.
export function parsePlan(text, ctx) {
  let raw;
  try { raw = JSON.parse(String(text ?? '').replace(/^﻿/, '')); } catch (e) { return { ok: false, plan: null, errors: [`No es un JSON válido: ${e.message}`], avisos: [] }; }
  return validatePlan(raw, ctx);
}

// Valida el plan entero. { ok, plan (normalizado: días de la semana con su clave de 3 letras), errors, avisos }.
// Con algún error, ok = false y no se debe usar. Los campos desconocidos se conservan y solo dan aviso.
export function validatePlan(raw, { targets, catalog }) {
  const errors = [];
  const avisos = [];
  if (!isObj(raw)) return { ok: false, plan: null, errors: ['El plan tiene que ser un objeto JSON ({ … }).'], avisos };
  if (raw.tipo !== PLAN_KIND) errors.push(`Falta "tipo": "${PLAN_KIND}" (tiene ${JSON.stringify(raw.tipo ?? null)}).`);
  if (raw.version !== PLAN_VERSION) errors.push(`"version" tiene que ser ${PLAN_VERSION} (tiene ${JSON.stringify(raw.version ?? null)}).`);
  if (raw.nombre !== undefined && typeof raw.nombre !== 'string') errors.push('"nombre" tiene que ser un texto.');
  if (raw.perfil !== undefined && !targets.perfiles[raw.perfil]) errors.push(`"perfil": "${raw.perfil}" no existe (valen: ${Object.keys(targets.perfiles).join(', ')}).`);
  desconocidos(raw, CAMPOS.plan, 'El plan', avisos);
  const plan = clone(raw);
  if (!Array.isArray(plan.periodos)) { errors.push('"periodos" tiene que ser una lista ([ … ]), aunque esté vacía.'); plan.periodos = []; }
  if (plan.excepciones === undefined || plan.excepciones === null) plan.excepciones = [];
  else if (!Array.isArray(plan.excepciones)) { errors.push('"excepciones" tiene que ser una lista ([ … ]).'); plan.excepciones = []; }

  const entradas = (valores, where, hayPeso) => {
    if (valores === undefined) return;
    if (!isObj(valores)) { errors.push(`${where}: "valores" tiene que ser un objeto ({ "proteina_g": { … } }).`); return; }
    for (const [clave, entrada] of Object.entries(valores)) validarEntrada(clave, entrada, `${where} → ${clave}`, hayPeso);
  };
  const validarEntrada = (clave, entrada, where, hayPeso) => {
    const info = infoNutriente(clave, targets, catalog);
    if (!info) { errors.push(`${where}: no es un nutriente de tu documento (mira data/nutrients.json).`); return; }
    if (entrada === null) return; // sin objetivo
    if (!isObj(entrada)) { errors.push(`${where}: tiene que ser un objeto como { "min": 30 } o null${isNum(entrada) ? ` (un número suelto no vale: ¿{ "objetivo": ${entrada} }?)` : ''}.`); return; }
    desconocidos(entrada, CAMPOS.entrada, where, avisos);
    const lim = {};
    for (const k of LIMITES) {
      const v = entrada[k];
      if (v === undefined || v === null) continue;
      if (!isNum(v)) { errors.push(`${where}: "${k}" tiene que ser un número (tiene ${JSON.stringify(v)}).`); continue; }
      if (k === 'min' ? v < 0 : v <= 0) { errors.push(`${where}: "${k}" tiene que ser ${k === 'min' ? 'mayor o igual que 0' : 'mayor que 0'}.`); continue; }
      lim[k] = v;
    }
    if (!LIMITES.some((k) => entrada[k] !== undefined && entrada[k] !== null)) errors.push(`${where}: sin ningún límite (min, objetivo o max).`);
    if (lim.min !== undefined && lim.objetivo !== undefined && lim.min > lim.objetivo) errors.push(`${where}: min (${lim.min}) es mayor que objetivo (${lim.objetivo}).`);
    if (lim.objetivo !== undefined && lim.max !== undefined && lim.objetivo > lim.max) errors.push(`${where}: objetivo (${lim.objetivo}) es mayor que max (${lim.max}).`);
    if (lim.min !== undefined && lim.max !== undefined && lim.min > lim.max) errors.push(`${where}: min (${lim.min}) es mayor que max (${lim.max}).`);
    if (entrada.unidad !== undefined) {
      const u = unidadDe(entrada);
      const validas = unidadesPara(clave, info.unit);
      if (typeof entrada.unidad !== 'string' || !validas.includes(u)) errors.push(`${where}: unidad ${JSON.stringify(entrada.unidad)} no vale para este nutriente (valen: ${validas.filter(Boolean).map((x) => `"${x}"`).join(', ')}).`);
      else if (esPorKg(u) && !hayPeso) errors.push(`${where}: usa "${u}" pero no hay peso_kg.`);
    }
  };
  const peso = (v, where) => {
    if (v === undefined || v === null) return false;
    if (!isNum(v) || v <= 0) { errors.push(`${where}: "peso_kg" tiene que ser un número mayor que 0.`); return false; }
    return true;
  };

  // periodos
  const ids = new Set();
  const inicios = new Map();
  plan.periodos.forEach((p, i) => {
    if (!isObj(p)) { errors.push(`Periodo n.º ${i + 1}: tiene que ser un objeto.`); plan.periodos[i] = {}; return; }
    const where = `Periodo «${typeof p.nombre === 'string' && p.nombre ? p.nombre : p.id ?? `n.º ${i + 1}`}»`;
    desconocidos(p, CAMPOS.periodo, where, avisos);
    if (typeof p.id !== 'string' || !p.id.trim() || /\s/.test(p.id)) errors.push(`${where}: "id" tiene que ser un texto sin espacios.`);
    else if (ids.has(p.id)) errors.push(`${where}: "id" "${p.id}" repetido.`);
    else ids.add(p.id);
    if (typeof p.nombre !== 'string' || !p.nombre.trim()) errors.push(`${where}: falta "nombre".`);
    if (!isDate(p.inicio)) errors.push(`${where}: "inicio" tiene que ser una fecha AAAA-MM-DD (tiene ${JSON.stringify(p.inicio ?? null)}).`);
    else if (inicios.has(p.inicio)) errors.push(`${where}: empieza el mismo día que «${inicios.get(p.inicio)}» (${p.inicio}).`);
    else inicios.set(p.inicio, p.nombre ?? p.id);
    if (p.fin === null) delete p.fin;
    if (p.fin !== undefined) {
      if (!isDate(p.fin)) errors.push(`${where}: "fin" tiene que ser una fecha AAAA-MM-DD (tiene ${JSON.stringify(p.fin)}).`);
      else if (isDate(p.inicio) && p.fin < p.inicio) errors.push(`${where}: "fin" (${p.fin}) es anterior a "inicio" (${p.inicio}).`);
    }
    const hayPeso = peso(p.peso_kg, where);
    entradas(p.valores, where, hayPeso);
    if (p.tipos !== undefined && !isObj(p.tipos)) { errors.push(`${where}: "tipos" tiene que ser un objeto ({ "entreno": { … } }).`); delete p.tipos; }
    for (const [k, t] of Object.entries(p.tipos ?? {})) {
      const wt = `${where} → tipo «${k}»`;
      if (!isObj(t)) { errors.push(`${wt}: tiene que ser un objeto ({ "nombre": …, "valores": { … } }).`); continue; }
      desconocidos(t, CAMPOS.tipo, wt, avisos);
      if (t.nombre !== undefined && typeof t.nombre !== 'string') errors.push(`${wt}: "nombre" tiene que ser un texto.`);
      entradas(t.valores, wt, hayPeso);
    }
    if (p.semana !== undefined) {
      if (!isObj(p.semana)) { errors.push(`${where}: "semana" tiene que ser un objeto ({ "lun": "entreno", … }).`); delete p.semana; } else {
        const semana = {};
        for (const [dia, tipo] of Object.entries(p.semana)) {
          const k = claveDia(dia);
          if (!k) { errors.push(`${where} → semana: "${dia}" no es un día de la semana (lun, mar, mie, jue, vie, sab, dom).`); continue; }
          if (semana[k] !== undefined) { errors.push(`${where} → semana: el día "${k}" está repetido.`); continue; }
          if (tipo !== null && !Object.hasOwn(p.tipos ?? {}, tipo)) { errors.push(`${where} → semana → ${k}: el tipo "${tipo}" no está en "tipos" del periodo.`); continue; }
          semana[k] = tipo;
        }
        p.semana = semana;
      }
    }
  });

  // excepciones
  const fechas = new Set();
  plan.excepciones.forEach((e, i) => {
    if (!isObj(e)) { errors.push(`Excepción n.º ${i + 1}: tiene que ser un objeto.`); return; }
    const where = `Excepción ${isDate(e.fecha) ? e.fecha : `n.º ${i + 1}`}`;
    desconocidos(e, CAMPOS.excepcion, where, avisos);
    if (!isDate(e.fecha)) { errors.push(`${where}: "fecha" tiene que ser una fecha AAAA-MM-DD (tiene ${JSON.stringify(e.fecha ?? null)}).`); return; }
    if (fechas.has(e.fecha)) errors.push(`${where}: hay otra excepción con la misma fecha.`);
    fechas.add(e.fecha);
    const p = periodoVigente(plan, e.fecha);
    if (e.tipo !== undefined && e.tipo !== null) {
      if (!p) errors.push(`${where}: "tipo" "${e.tipo}", pero ningún periodo cubre esa fecha.`);
      else if (!Object.hasOwn(p.tipos ?? {}, e.tipo)) errors.push(`${where}: el tipo "${e.tipo}" no está en el periodo «${p.nombre}».`);
    }
    const propio = peso(e.peso_kg, where);
    entradas(e.valores, where, propio || isNum(p?.peso_kg));
  });

  // solapes con fin explícito: es válido (manda el que empezó más tarde), pero se avisa
  const orden = plan.periodos.filter((p) => isDate(p.inicio)).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  for (let i = 0; i < orden.length; i++) {
    for (let j = i + 1; j < orden.length; j++) {
      const [a, b] = [orden[i], orden[j]];
      if (!isDate(a.fin) || a.fin < b.inicio) continue;
      const hasta = isDate(b.fin) && b.fin < a.fin ? b.fin : a.fin;
      avisos.push(`«${a.nombre}» y «${b.nombre}» se solapan del ${b.inicio} al ${hasta}: esos días manda «${b.nombre}» (empezó más tarde).`);
    }
  }
  return { ok: errors.length === 0, plan: errors.length ? null : plan, errors, avisos };
}

function desconocidos(obj, campos, where, avisos) {
  const raros = Object.keys(obj).filter((k) => !campos.includes(k));
  if (raros.length) avisos.push(`${where}: ${raros.length === 1 ? 'campo desconocido' : 'campos desconocidos'} ${raros.map((k) => `"${k}"`).join(', ')} (se conserva${raros.length === 1 ? '' : 'n'}, pero la app no ${raros.length === 1 ? 'lo' : 'los'} usa).`);
}

// ---------- resolución ----------

// El periodo que manda una fecha: de los que la cubren, el que empezó más tarde (null si ninguno).
export function periodoVigente(plan, fecha) {
  let best = null;
  for (const p of plan?.periodos ?? []) {
    if (!isDate(p?.inicio) || p.inicio > fecha || (p.fin && fecha > p.fin)) continue;
    if (!best || p.inicio > best.inicio) best = p;
  }
  return best;
}

// Periodo, excepción, tipo de día y peso de una fecha.
export function dayContext(plan, fecha) {
  const periodo = periodoVigente(plan, fecha);
  const excepcion = (plan?.excepciones ?? []).find((e) => e?.fecha === fecha) ?? null;
  const dia = diaSemana(fecha);
  let tipoClave = null;
  let tipoOrigen = null;
  if (excepcion?.tipo && periodo?.tipos?.[excepcion.tipo]) { tipoClave = excepcion.tipo; tipoOrigen = 'excepcion'; }
  else if (periodo?.semana?.[dia] && periodo.tipos?.[periodo.semana[dia]]) { tipoClave = periodo.semana[dia]; tipoOrigen = 'semana'; }
  const tipoSemana = periodo?.semana?.[dia] && periodo.tipos?.[periodo.semana[dia]] ? periodo.semana[dia] : null;
  const peso = isNum(excepcion?.peso_kg) ? excepcion.peso_kg : isNum(periodo?.peso_kg) ? periodo.peso_kg : null;
  return { fecha, dia, periodo, excepcion, tipoClave, tipo: tipoClave ? periodo.tipos[tipoClave] : null, tipoOrigen, tipoSemana, peso };
}

export const nombreTipo = (periodo, clave) => {
  const n = periodo?.tipos?.[clave]?.nombre;
  return typeof n === 'string' && n.trim() ? n : clave.charAt(0).toUpperCase() + clave.slice(1).replace(/_/g, ' ');
};

// Valor de la columna de una entrada del plan (g/kg, kcal/kg y %kcal pasados a la unidad del nutriente).
function absolutos(clave, unit, entrada, { peso, kcal }) {
  const u = unidadDe(entrada);
  let f = 1;
  if (esPorKg(u)) f = isNum(peso) ? peso : null;
  else if (u === '%kcal') f = isNum(kcal) ? kcal / 100 / KCAL_POR_G[clave] : null;
  const lim = {};
  for (const k of LIMITES) lim[k] = isNum(entrada[k]) && f !== null ? round(entrada[k] * f, decimales(unit)) : null;
  return lim;
}

// El valor "principal" (el de la barra y el %): el objetivo; en un rango sin objetivo, el máximo; si no, el que haya.
export const principal = (l) => l.objetivo ?? (l.min !== null && l.max !== null ? l.max : l.min ?? l.max);
const centro = (l) => l.objetivo ?? (l.min !== null && l.max !== null ? (l.min + l.max) / 2 : l.min ?? l.max);
const tipoDe = (l) => {
  const hay = LIMITES.filter((k) => l[k] !== null);
  return hay.length === 1 ? hay[0] : hay.length ? 'rango' : null;
};

// Objetivos vigentes en una fecha. ctx = { plan (validado o null), targets (loadTargets), catalog }.
// Devuelve { fecha, perfil, periodo, tipoDia, excepcion, peso_kg, kcal, list }. Cada elemento de list es el objetivo de
// targets.json (label, unit, suma, ul, notas) con min/objetivo/max ya en la unidad del nutriente, valor (principal),
// tipo (min | max | objetivo | rango, o null si ese día no tiene objetivo), origen (excepcion | tipo | periodo |
// referencia) y entrada (lo escrito en el plan).
export function targetsForDate(fecha, { plan = null, targets, catalog }) {
  const perfil = targets.perfiles[plan?.perfil] ? plan.perfil : targets.perfilPorDefecto;
  const d = dayContext(plan, fecha);
  const capas = [['excepcion', d.excepcion?.valores], ['tipo', d.tipo?.valores], ['periodo', d.periodo?.valores]].filter(([, v]) => isObj(v));
  const entradaDe = (clave) => {
    for (const [origen, v] of capas) if (Object.hasOwn(v, clave)) return { origen, entrada: v[clave] };
    return null;
  };
  const base = (t) => t.porPerfil[perfil] ?? t.valor;
  const vacio = { min: null, objetivo: null, max: null };
  const deReferencia = (t, kcal) => {
    let v;
    if (t.porMj !== null) v = isNum(kcal) ? round(t.porMj * kcal * KCAL_TO_MJ, 2) : null;
    else if (t.pctEnergia !== null) v = isNum(kcal) ? round((t.pctEnergia / 100) * kcal / 9, 2) : null; // grasa: 9 kcal/g
    else v = base(t) ?? null;
    return { ...vacio, [t.tipo]: v };
  };
  const limites = (clave, unit, e, kcal) => (e.entrada === null ? vacio : absolutos(clave, unit, e.entrada, { peso: d.peso, kcal }));

  // Primero la energía: sus kcal sirven para %kcal y para B1, niacina y ALA.
  const energiaRef = targets.list.find((t) => t.clave === 'energia_kcal');
  const kcalRef = energiaRef ? base(energiaRef) ?? null : null;
  const eE = entradaDe('energia_kcal');
  const limE = eE ? limites('energia_kcal', 'kcal', eE, null) : energiaRef ? deReferencia(energiaRef, null) : vacio;
  const kcal = centro(limE) ?? kcalRef;

  const enPlan = new Set(capas.flatMap(([, v]) => Object.keys(v)));
  const extras = catalog.list.map((n) => n.key).filter((k) => enPlan.has(k) && !targets.list.some((t) => t.clave === k));
  const list = [];
  for (const clave of [...targets.list.map((t) => t.clave), ...extras]) {
    const info = infoNutriente(clave, targets, catalog);
    const e = entradaDe(clave);
    const ref = targets.list.find((t) => t.clave === clave);
    if (!e && !ref) continue;
    if (e?.entrada === null && !ref) continue; // quitado y sin referencia: no hay nada que mostrar
    const lim = e ? limites(clave, info.unit, e, kcal) : deReferencia(ref, kcal);
    list.push({
      ...info, clave, perfil, ...lim, valor: principal(lim), tipo: tipoDe(lim),
      origen: e ? e.origen : 'referencia', entrada: e ? e.entrada : null,
    });
  }
  return {
    fecha, perfil,
    periodo: d.periodo ? { id: d.periodo.id, nombre: d.periodo.nombre, inicio: d.periodo.inicio, fin: d.periodo.fin ?? null } : null,
    tipoDia: d.tipoClave ? { clave: d.tipoClave, nombre: nombreTipo(d.periodo, d.tipoClave), origen: d.tipoOrigen } : null,
    excepcion: d.excepcion ? { nota: typeof d.excepcion.nota === 'string' ? d.excepcion.nota : '' } : null,
    peso_kg: d.peso, kcal, list,
  };
}

// ---------- crear y editar el plan ----------

export const emptyPlan = (perfil) => ({ tipo: PLAN_KIND, version: PLAN_VERSION, nombre: 'Mi plan', ...(perfil ? { perfil } : {}), periodos: [], excepciones: [] });
export const planToJSON = (plan) => `${JSON.stringify(plan, null, 2)}\n`;

// Objetivos de la pantalla anterior ({ perfil, valores: { clave: número } }) -> plan con un periodo "Mis objetivos"
// abierto desde `desde` (la primera fecha del diario), para que nada cambie al actualizar. null si no había nada.
export function planFromLegacy(o, { desde, targets }) {
  if (!isObj(o) || !(o.perfil || Object.keys(o.valores ?? {}).length)) return null;
  const valores = {};
  for (const [clave, v] of Object.entries(isObj(o.valores) ? o.valores : {})) {
    const t = targets.list.find((x) => x.clave === clave);
    if (t && isNum(v) && v > 0) valores[clave] = { [t.tipo]: v };
  }
  const plan = emptyPlan(targets.perfiles[o.perfil] ? o.perfil : undefined);
  plan.nombre = 'Mis objetivos';
  if (Object.keys(valores).length) plan.periodos.push({ id: 'mis_objetivos', nombre: 'Mis objetivos', inicio: desde, valores });
  return plan;
}

export function setPerfil(plan, perfil) {
  return { ...clone(plan ?? emptyPlan()), perfil };
}

// "Hoy es: Entreno": excepción con ese tipo en la fecha; tipo null la quita (y la excepción, si no le queda nada más).
export function setDayType(plan, fecha, tipo) {
  const p = clone(plan);
  const i = p.excepciones.findIndex((e) => e.fecha === fecha);
  if (tipo) {
    if (i >= 0) p.excepciones[i].tipo = tipo; else p.excepciones.push({ fecha, tipo });
  } else if (i >= 0) {
    delete p.excepciones[i].tipo;
    if (Object.keys(p.excepciones[i]).every((k) => k === 'fecha')) p.excepciones.splice(i, 1);
  }
  p.excepciones.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return p;
}

// Edición desde la app de los valores de una capa del periodo vigente.
// cambios = { capa: 'periodo' | clave de tipo, valores: { clave: entrada | null }, peso_kg?: número | null }:
// en valores, null QUITA la entrada de esa capa (no es "sin objetivo"); peso_kg null lo quita y undefined no lo toca.
// modo 'desde_hoy': si el periodo empezó antes, termina ayer y empieza hoy un tramo nuevo (mismo nombre, tipos, semana y
// fin) con el cambio; 'todo': se cambia el periodo entero. Sin periodo vigente se crea uno desde `fecha`.
// Devuelve { plan, periodoId }. El llamante valida el resultado con validatePlan.
export function editPeriod(plan, { fecha, capa = 'periodo', valores = {}, peso_kg, modo = 'desde_hoy' }) {
  const p = clone(plan ?? emptyPlan());
  let actual = periodoVigente(p, fecha);
  if (!actual) {
    actual = { id: idUnico(p, `objetivos_${fecha.replace(/-/g, '')}`), nombre: 'Mis objetivos', inicio: fecha };
    p.periodos.push(actual);
  } else if (modo === 'desde_hoy' && actual.inicio < fecha) {
    const nuevo = { ...clone(actual), id: idUnico(p, `${actual.id}_${fecha.replace(/-/g, '')}`), inicio: fecha };
    actual.fin = shiftDate(fecha, -1);
    p.periodos.splice(p.periodos.indexOf(actual) + 1, 0, nuevo);
    actual = nuevo;
  }
  let destino;
  if (capa === 'periodo') destino = actual.valores ??= {};
  else {
    if (!actual.tipos?.[capa]) throw new Error(`El periodo «${actual.nombre}» no tiene el tipo "${capa}".`);
    destino = actual.tipos[capa].valores ??= {};
  }
  for (const [clave, entrada] of Object.entries(valores)) {
    if (entrada === null) delete destino[clave]; else destino[clave] = clone(entrada);
  }
  if (peso_kg === null) delete actual.peso_kg; else if (peso_kg !== undefined) actual.peso_kg = peso_kg;
  return { plan: p, periodoId: actual.id };
}

function idUnico(plan, base) {
  const ids = new Set(plan.periodos.map((x) => x.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
