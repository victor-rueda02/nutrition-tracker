// Objetivos diarios: data/targets.json (referencias de la UE y de la EFSA) + los tuyos (pantalla Objetivos).
// Funciones puras, sin DOM.
import { unitOf } from './catalog.js';

export const KCAL_TO_MJ = 0.004184;
export const TIPOS = ['objetivo', 'min', 'max', 'rango']; // 'rango': mínimo y máximo (hoy solo con pct_energia_min y pct_energia_max)
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const pos = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const round2 = (x) => Math.round(x * 100) / 100;

// Un rango en % de la energía (pct_energia_min y pct_energia_max, los dos): sus gramos salen de las kcal del día (9 kcal/g).
export const esRangoEnergia = (t) => t.pctEnergiaMin !== null && t.pctEnergiaMax !== null && t.pctEnergiaMin <= t.pctEnergiaMax;
export const gramosDeEnergia = (pct, kcal) => round2((pct / 100) * kcal / 9);

// UL que cuenta de verdad (avisos del Diario y del informe, detalle de nutriente y «¿Qué ceno?»): el `ul` del objetivo, salvo
// que sea informativo (`ul_informativo` en targets.json: el de la vitamina A es solo de retinol preformado y el del folato,
// solo de ácido fólico añadido, y el documento lleva el total). Es el único sitio que lo decide. null = no hay UL que vigilar.
export function ulVigilado(t) {
  return t && typeof t.ul === 'number' && Number.isFinite(t.ul) && !t.ulInformativo ? t.ul : null;
}

// Valida targets.json contra el catálogo de nutrientes. Devuelve { targets, warnings }.
export function loadTargets(raw, catalog) {
  const warnings = [];
  const perfiles = raw?.perfiles && typeof raw.perfiles === 'object' && Object.keys(raw.perfiles).length ? raw.perfiles : { general: 'General' };
  const perfilPorDefecto = perfiles[raw?.perfil_por_defecto] ? raw.perfil_por_defecto : Object.keys(perfiles)[0];
  const list = [];
  for (const t of Array.isArray(raw?.objetivos) ? raw.objetivos : []) {
    const clave = String(t?.clave ?? '');
    if (!TIPOS.includes(t?.tipo)) { warnings.push(`${clave}: tipo "${t?.tipo}" no válido (objetivo, min, max o rango)`); continue; }
    if (list.some((x) => x.clave === clave)) { warnings.push(`${clave}: repetido (se ignora)`); continue; }
    let label;
    let unit;
    if (Array.isArray(t.suma)) {
      const faltan = t.suma.filter((k) => !catalog.byKey.has(k));
      if (faltan.length || !t.suma.length) { warnings.push(`${clave}: suma con nutrientes que no existen (${faltan.join(', ')})`); continue; }
      label = t.etiqueta ?? clave;
      unit = t.unidad ?? unitOf(t.suma[0]);
    } else {
      if (!catalog.byKey.has(clave)) { warnings.push(`${clave}: no existe en el catálogo de nutrientes`); continue; }
      label = t.etiqueta ?? catalog.byKey.get(clave).label;
      unit = unitOf(clave);
    }
    const porPerfil = Object.fromEntries(Object.keys(perfiles).filter((p) => num(t[p]) !== null).map((p) => [p, t[p]]));
    const item = {
      clave, label, unit, tipo: t.tipo, suma: Array.isArray(t.suma) ? [...t.suma] : null,
      valor: num(t.valor), porPerfil, porMj: num(t.por_mj), pctEnergia: num(t.pct_energia), pctEnergiaMin: num(t.pct_energia_min), pctEnergiaMax: num(t.pct_energia_max), porKg: num(t.por_kg), soloReferencia: t.solo_referencia === true,
      ul: num(t.ul), ulInformativo: num(t.ul) !== null && t.ul_informativo === true, nota: t.nota ?? '', notaUl: t.nota_ul ?? '', fuente: raw?.fuentes?.[t.fuente] ?? t.fuente ?? '',
    };
    if (item.tipo === 'rango' && !esRangoEnergia(item)) {
      warnings.push(`${clave}: tipo "rango" sin pct_energia_min y pct_energia_max válidos (el mínimo no puede superar al máximo)`);
      continue;
    }
    if (item.valor === null && !Object.keys(porPerfil).length && item.porMj === null && item.pctEnergia === null && item.porKg === null && !esRangoEnergia(item)) {
      warnings.push(`${clave}: sin valor (valor, por perfil, por_mj, pct_energia, pct_energia_min y pct_energia_max o por_kg)`);
      continue;
    }
    list.push(item);
  }
  return { targets: { perfiles, perfilPorDefecto, list }, warnings };
}

// Objetivos efectivos. user = { perfil, valores: { clave: número } } (lo que guardas en Objetivos): tus valores
// mandan; si no, el del perfil; por_mj y pct_energia se calculan con tu objetivo de kcal y por_kg con user.peso_kg (sin peso, null).
// "origen": 'tuyo' | 'referencia'.
export function resolveTargets(targets, user = {}) {
  const perfil = targets.perfiles[user?.perfil] ? user.perfil : targets.perfilPorDefecto;
  const own = user?.valores ?? {};
  const base = (t) => t.porPerfil[perfil] ?? t.valor;
  const energia = targets.list.find((t) => t.clave === 'energia_kcal');
  const kcal = pos(own.energia_kcal) ? own.energia_kcal : energia ? base(energia) : null;
  return targets.list.map((t) => {
    let valor;
    let origen = 'referencia';
    if (pos(own[t.clave])) { valor = own[t.clave]; origen = 'tuyo'; }
    else if (t.porMj !== null) valor = pos(kcal) ? round2(t.porMj * kcal * KCAL_TO_MJ) : null;
    else if (t.pctEnergia !== null) valor = pos(kcal) ? round2((t.pctEnergia / 100) * kcal / 9) : null; // grasa: 9 kcal/g
    else if (esRangoEnergia(t)) valor = pos(kcal) ? gramosDeEnergia(t.pctEnergiaMax, kcal) : null; // el máximo es el principal; el rango entero, en min y max
    else if (t.porKg !== null) valor = pos(user?.peso_kg) ? Math.round(t.porKg * user.peso_kg * 1e4) / 1e4 : null;
    else valor = base(t) ?? null;
    const rango = esRangoEnergia(t) && origen === 'referencia' && pos(kcal) ? { min: gramosDeEnergia(t.pctEnergiaMin, kcal), max: valor } : {};
    return { ...t, perfil, valor, origen, ...rango };
  });
}

// Valor de referencia (sin tus cambios) de un objetivo, para mostrarlo como sugerencia en la pantalla Objetivos.
export function referenceValue(targets, clave, user = {}) {
  return resolveTargets(targets, { perfil: user?.perfil, valores: { energia_kcal: user?.valores?.energia_kcal } }).find((t) => t.clave === clave)?.valor ?? null;
}
