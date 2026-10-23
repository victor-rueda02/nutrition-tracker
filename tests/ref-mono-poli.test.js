// Encargo W: referencias de las grasas poliinsaturadas (FAO/OMS 2024, 6-10 % de la energía) y monoinsaturadas (NNR 2023,
// 10-20 % de la energía) en targets.json, con el mecanismo `solo_referencia`: se enseñan en el informe y en el detalle del
// nutriente, pero no son objetivos del plan, ni UL, ni cuentan para los totales parciales ni para «¿Qué ceno?».
// Gramos = % × kcal del día ÷ 9. Lógica pura arriba; la UI (jsdom), abajo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargets } from '../frontend/js/core/targets.js';
import { targetsForDate, planDeReferencia, validatePlan } from '../frontend/js/core/targets-plan.js';
import { diaryReport } from '../frontend/js/core/diary.js';
import { filasAlimento, rangoNutriente, referenciaDe } from '../frontend/js/core/detalle.js';
import { proponerCenas } from '../frontend/js/core/cenas.js';
import { avisoParciales } from '../frontend/js/core/parciales.js';
import { catalog, settings, readFile, realFoods } from './helpers.js';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';

const RAW = JSON.parse(readFile('../data/targets.json'));
const info = JSON.parse(readFile('../data/nutrientes-info.json')).nutrientes;
const { targets, warnings } = loadTargets(RAW, catalog);
const ctx = { targets, catalog };
const FECHA = '2026-10-20';
const CLAVES = ['grasas_poliinsaturadas_g', 'grasas_monoinsaturadas_g'];
const plan = (kcal) => ({ tipo: 'plan_objetivos', version: 1, periodos: [{ id: 'p', nombre: 'P', inicio: '2026-01-01', ...(kcal ? { valores: { energia_kcal: { objetivo: kcal } } } : {}) }], excepciones: [] });
const en = (kcal) => targetsForDate(FECHA, { plan: kcal ? plan(kcal) : null, ...ctx });
const get = (list, clave) => list.find((t) => t.clave === clave);
const meal = (lines) => ({ id: 'm', date: FECHA, meal: 'comida', createdAt: `${FECHA}T10:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const food = (id, nutrients) => ({ id, nombre: id, nutrients, porciones: [], extra: {} });
const mapa = (...foods) => new Map(foods.map((f) => [f.id, f]));
const redondea = (x) => Math.round(x * 100) / 100;
// Un alimento que aporta 10 g de cada una por 100 g (1 g de alimento = 0,1 g de grasa) y otro sin dato.
const G = food('g', { energia_kcal: 100, grasas_poliinsaturadas_g: 10, grasas_monoinsaturadas_g: 10 });
const SIN = food('sin', { energia_kcal: 100, grasas_poliinsaturadas_g: null, grasas_monoinsaturadas_g: null });
const fila = (rep, clave) => rep.otros.find((o) => o.clave === clave);

// ---------- targets.json ----------
test('targets.json: dos rangos en % de la energía, solo referencia, sin UL, cada uno con su fuente', () => {
  assert.deepEqual(warnings, []);
  const poli = get(targets.list, CLAVES[0]);
  assert.deepEqual([poli.tipo, poli.pctEnergiaMin, poli.pctEnergiaMax, poli.soloReferencia, poli.ul], ['rango', 6, 10, true, null]);
  assert.match(poli.fuente, /FAO\/OMS.*24-10-2024.*who\.int\/publications\/i\/item\/9789240101876/);
  const mono = get(targets.list, CLAVES[1]);
  assert.deepEqual([mono.tipo, mono.pctEnergiaMin, mono.pctEnergiaMax, mono.soloReferencia, mono.ul], ['rango', 10, 20, true, null]);
  assert.match(mono.fuente, /Nordic Nutrition Recommendations 2023/);
  assert.match(mono.nota, /Referencia nórdica \(NNR 2023\)/);
  assert.match(mono.nota, /EFSA y la OMS no fijan valor/);
  // no son UL: la lista de UL no cambia
  assert.deepEqual(targets.list.filter((t) => t.ul !== null).map((t) => t.clave).sort(),
    ['calcio_mg', 'cobre_mg', 'selenio_ug', 'vitamina_a_ug', 'vitamina_b6_mg', 'vitamina_b9_ug', 'vitamina_d_ug', 'vitamina_e_mg', 'zinc_mg']);
});

test('un rango sin los dos extremos o al revés se avisa y se ignora', () => {
  const malo = { ...RAW, objetivos: [{ clave: CLAVES[0], tipo: 'rango', pct_energia_min: 10, pct_energia_max: 6, solo_referencia: true }, { clave: CLAVES[1], tipo: 'rango', pct_energia_min: 10, solo_referencia: true }, { clave: 'cafeina_mg', tipo: 'rango', valor: 400, solo_referencia: true }] };
  const r = loadTargets(malo, catalog);
  assert.deepEqual(r.targets.list, []); // tipo rango exige los dos extremos válidos, aunque tenga otro valor
  assert.equal(r.warnings.length, 3);
});

test('el texto de nutrientes-info dice la referencia que usa la app y de dónde sale', () => {
  assert.match(info[CLAVES[0]].necesidades, /FAO\/OMS 2024.*6-10 % de la energía \(unos 13-22 g con 2\.000 kcal\)/);
  assert.match(info[CLAVES[1]].necesidades, /Nordic Nutrition Recommendations 2023 \(NNR\): 10-20 % de la energía \(unos 22-44 g con 2\.000 kcal\)/);
  assert.match(info[CLAVES[1]].necesidades, /referencia nórdica/);
  for (const k of CLAVES) assert.ok(info[k].referencias.some((r) => r.organismo === 'OMS' && r.url === 'https://www.who.int/publications/i/item/9789240101876' && r.consultado === '2026-10-23'), k);
  // la cifra de la NNR (10-20 %) tiene su referencia en la entrada de monoinsaturadas, con la misma URL que targets.json
  const urlNnr = RAW.fuentes.nnr_mono.match(/\((https:\/\/[^)]+)\)/)[1];
  assert.ok(info[CLAVES[1]].referencias.some((r) => r.organismo === 'NNR (Consejo Nórdico)' && r.url === urlNnr && r.consultado === '2026-10-23'));
});

// ---------- targetsForDate ----------
test('con 2000 kcal: poliinsaturadas de 13,33 a 22,22 g y monoinsaturadas de 22,22 a 44,44 g', () => {
  const l = en(null).list;
  const poli = get(l, CLAVES[0]);
  assert.deepEqual([poli.min, poli.max, poli.objetivo, poli.tipo, poli.origen, poli.soloReferencia], [13.33, 22.22, null, 'rango', 'referencia', true]);
  const mono = get(l, CLAVES[1]);
  assert.deepEqual([mono.min, mono.max, mono.objetivo, mono.tipo], [22.22, 44.44, null, 'rango']);
});

test('con otras kcal (2550, las del plan): g = % × kcal ÷ 9', () => {
  const l = en(2550).list;
  assert.deepEqual([get(l, CLAVES[0]).min, get(l, CLAVES[0]).max], [17, 28.33]);
  assert.deepEqual([get(l, CLAVES[1]).min, get(l, CLAVES[1]).max], [28.33, 56.67]);
});

test('no tocan tu plan: «Crear plan» no las escribe; si tu plan define el nutriente, manda el plan', () => {
  const creado = planDeReferencia({ fecha: '2026-10-18', perfil: 'hombre', ...ctx });
  for (const k of CLAVES) assert.ok(!Object.keys(creado.periodos[0].valores).includes(k), k);
  assert.deepEqual(validatePlan(creado, ctx).errors, []);
  const propio = { ...plan(null), periodos: [{ ...plan(null).periodos[0], valores: { grasas_monoinsaturadas_g: { max: 30 } } }] };
  const m = get(targetsForDate(FECHA, { plan: propio, ...ctx }).list, CLAVES[1]);
  assert.deepEqual([m.max, m.min, m.origen, m.soloReferencia], [30, null, 'periodo', false]);
});

// ---------- diaryReport: tres estados ----------
test('informe a 2000 kcal: por debajo, dentro y por encima del rango; superar el máximo no es un UL', () => {
  const objetivos = en(null).list; // poli 13,33-22,22 g; mono 22,22-44,44 g
  const estados = (gramos) => {
    const rep = diaryReport([meal([['g', gramos]])], mapa(G), objetivos, catalog); // 1 g de alimento = 0,1 g de cada grasa
    return { rep, poli: fila(rep, CLAVES[0]), mono: fila(rep, CLAVES[1]) };
  };
  let r = estados(100); // 10 g: poli por debajo; mono por debajo
  assert.deepEqual([r.poli.total, r.poli.estado, r.mono.total, r.mono.estado], [10, 'por_debajo', 10, 'por_debajo']);
  r = estados(150); // 15 g: poli dentro; mono aún por debajo
  assert.deepEqual([r.poli.estado, r.mono.estado, redondea(r.poli.pct)], ['en_objetivo', 'por_debajo', redondea(15 / 22.22)]);
  r = estados(300); // 30 g: poli por encima; mono dentro
  assert.deepEqual([r.poli.estado, r.mono.estado], ['por_encima', 'en_objetivo']);
  r = estados(500); // 50 g: mono por encima
  assert.deepEqual([r.mono.estado, r.mono.superaUl, r.poli.superaUl], ['por_encima', false, false]);
  assert.deepEqual(r.rep.avisosUl, []);
});

test('informe con otras kcal (2550): los mismos gramos caen en otro estado', () => {
  const dia = (kcal) => fila(diaryReport([meal([['g', 160]])], mapa(G), en(kcal).list, catalog), CLAVES[0]); // 16 g de poliinsaturadas
  assert.deepEqual([dia(null).min, dia(null).estado], [13.33, 'en_objetivo']); // 2000 kcal: dentro
  assert.deepEqual([dia(2550).min, dia(2550).max, dia(2550).estado], [17, 28.33, 'por_debajo']); // 2550 kcal: por debajo de 17 g
  const mono = fila(diaryReport([meal([['g', 600]])], mapa(G), en(2550).list, catalog), CLAVES[1]); // 60 g
  assert.deepEqual([mono.min, mono.max, mono.estado], [28.33, 56.67, 'por_encima']);
});

test('un alimento sin dato de estas grasas: el total es null (sin dato) y no un 0', () => {
  const rep = diaryReport([meal([['sin', 100]])], mapa(SIN, G), en(null).list, catalog);
  assert.deepEqual([fila(rep, CLAVES[0]).total, fila(rep, CLAVES[0]).estado], [null, 'sin_dato']);
});

test('no entran en rows, ni en los parciales, ni en el aviso de alimentos con límite superado', () => {
  const rep = diaryReport([meal([['g', 500], ['sin', 100]])], mapa(G, SIN), en(null).list, catalog);
  for (const k of CLAVES) assert.ok(!rep.rows.some((r) => r.clave === k), k);
  assert.deepEqual(rep.avisosUl, []);
  const aviso = avisoParciales([meal([['g', 100], ['sin', 100]])], mapa(G, SIN), rep.rows);
  const textos = [aviso?.importante, aviso?.menor].filter(Boolean).flatMap((x) => x.grupos.map((g) => g.texto)).join(' ');
  assert.doesNotMatch(textos, /insaturadas/i);
});

test('«¿Qué ceno?» no las usa: las mismas faltas y propuestas con y sin las referencias', () => {
  const objetivos = en(null);
  const foodsById = new Map(realFoods.map((f) => [f.id, f]));
  const base = { fecha: FECHA, comidasDelDia: [meal([['avena_copos', 50]])], historial: [], plantillas: [], recetas: [], semilla: null, foodsById, catalog, settings, hoy: FECHA };
  const con = proponerCenas({ ...base, objetivos });
  const sin = proponerCenas({ ...base, objetivos: { ...objetivos, list: objetivos.list.filter((t) => !CLAVES.includes(t.clave)) } });
  const claves = (r) => r.faltan.map((f) => f.clave);
  assert.deepEqual(claves(con), claves(sin));
  for (const k of CLAVES) assert.ok(!claves(con).includes(k), k);
  assert.deepEqual(con.propuestas.map((p) => p.lineas?.map((l) => l.food_id)), sin.propuestas.map((p) => p.lineas?.map((l) => l.food_id)));
});

// ---------- detalle de nutriente ----------
test('detalle: mínimo y máximo del día, sin fila «Referencia» duplicada, con 2000 y con 2550 kcal', () => {
  for (const [kcal, min, max] of [[null, 22.22, 44.44], [2550, 28.33, 56.67]]) {
    const objetivos = en(kcal).list;
    const f = filasAlimento({ food: G, grams: 100, objetivos, catalog }).filas.get(CLAVES[1]);
    const referencia = referenciaDe(targets, CLAVES[1], 'hombre'); // un rango ya es la fila Mínimo/Máximo: no hay una tercera
    assert.equal(referencia, null);
    const rango = rangoNutriente({ fila: f, hoy: 30, referencia });
    assert.deepEqual(rango.filas.map((x) => [x.id, x.valor]), [['alimento', 10], ['hoy', 40], ['min', min], ['max', max]]);
    assert.deepEqual(rango.filas.map((x) => x.etiqueta), ['Este alimento', 'Llevas hoy (con esta cantidad)', 'Mínimo (referencia)', 'Máximo (referencia)']); // como trans: es la referencia, no un objetivo
    assert.deepEqual(rango.marcas.map((m) => m.id), ['min', 'max']);
    assert.equal(rango.sinReferencia, false);
    assert.ok(rango.barra);
  }
  // los tres estados de la barra (total = lo que llevas + este alimento, 10 g): 20 g por debajo, 40 g dentro de 22,22-44,44 y 70 g por encima
  const f = filasAlimento({ food: G, grams: 100, objetivos: en(null).list, catalog }).filas.get(CLAVES[1]);
  const estado = (hoy) => rangoNutriente({ fila: f, hoy }).barra;
  assert.deepEqual([estado(10).estado, estado(30).estado, estado(60).estado, estado(60).superaUl], ['por_debajo', 'en_objetivo', 'por_encima', false]);
});

// ---------- UI ----------
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z');
const PLAN_UI = { tipo: 'plan_objetivos', version: 1, nombre: 'Prueba', periodos: [{ id: 'p', nombre: 'Prueba', inicio: '2026-01-01', peso_kg: 75 }], excepciones: [] };
const COMIDA = [{ id: 'h', date: '2026-10-16', meal: 'comida', createdAt: '2026-10-16T08:00:00Z', text: '', lines: [['pechuga_pollo_cruda', 200], ['arroz_blanco_crudo', 100]].map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) }];

async function setup({ plan = PLAN_UI } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const root = dom.window.document.getElementById('app');
  const store = createMemoryStore();
  for (const m of COMIDA) await store.addMeal(m);
  if (plan) await store.setSetting('plan_objetivos', plan);
  const app = mountApp(root, {
    store, createAiClient: () => ({}), catalog, settings, targets: RAW, objetivos: {},
    initial: { foods: realFoods, extraHeaders: [], docName: 'doc.csv' }, conn: {}, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async () => 'compartido',
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const act = async (fn) => { fn(); await app.whenIdle(); };
  return { root, $, $$, btn, act };
}

test('informe: las dos grasas tienen barra y rango; la monoinsaturada dice que su referencia es nórdica y la poliinsaturada, FAO/OMS', { skip }, async () => {
  const t = await setup();
  await t.act(() => t.$('button[aria-label="Más opciones del día"]').click());
  await t.act(() => t.btn('Ver informe diario').click());
  const li = (clave) => t.$(`main.informe li.nut[data-clave="${clave}"]`);
  const mono = li(CLAVES[1]);
  assert.ok(mono.querySelector('.meter'));
  assert.ok(!mono.classList.contains('nut-sin-ref'));
  assert.match(mono.querySelector('.nut-valor').textContent, /\/ 22,2.*44,4/); // rango mín.–máx. a 2000 kcal
  assert.equal(mono.querySelector('.nota-ref').textContent, RAW.objetivos.find((o) => o.clave === CLAVES[1]).nota);
  assert.match(mono.querySelector('.nota-ref').textContent, /Referencia nórdica \(NNR 2023\)/);
  assert.match(li(CLAVES[0]).querySelector('.nota-ref').textContent, /FAO\/OMS 2024/);
  assert.equal(t.$$('main.informe li.nut .nota-ref').length, 2); // solo estas dos llevan nota de referencia
  assert.ok(t.$('main.informe .grupo[data-grupo="lipidos"]').contains(mono));
});

test('detalle de nutriente de las monoinsaturadas: barra con mínimo y máximo, la nota nórdica y sin fila «Referencia»', { skip }, async () => {
  const t = await setup();
  await t.act(() => t.$('button[aria-label^="Ver detalle de Pechuga"]').click());
  await t.act(() => t.$(`.detalle-todos [data-clave="${CLAVES[1]}"] .abre-detalle`).click());
  assert.ok(t.$('.rango-barra .marca-min'));
  assert.ok(t.$('.rango-barra .marca-max'));
  assert.deepEqual(t.$$('.rango-tabla tr').map((r) => r.dataset.fila), ['alimento', 'hoy', 'min', 'max']);
  assert.match(t.$('.rango-tabla tr[data-fila="max"] td').textContent, /44,4/);
  assert.match(t.$('.nota-ref').textContent, /Referencia nórdica \(NNR 2023\)/);
});

test('detalle de nutriente sin plan: en vez de «Objetivos: referencias EFSA», la nota de la referencia nórdica, una sola vez', { skip }, async () => {
  const t = await setup({ plan: null });
  await t.act(() => t.$('button[aria-label^="Ver detalle de Pechuga"]').click());
  await t.act(() => t.$(`.detalle-todos [data-clave="${CLAVES[1]}"] .abre-detalle`).click());
  const nota = RAW.objetivos.find((o) => o.clave === CLAVES[1]).nota;
  assert.equal(t.$('.rango .objetivos-dia').textContent, nota);
  assert.equal(t.$$('.nota-ref').length, 1);
  assert.doesNotMatch(t.$('.rango').textContent, /Objetivos: referencias EFSA/);
  assert.deepEqual(t.$$('.rango-tabla th').map((x) => x.textContent), ['Este alimento', 'Llevas hoy', 'Mínimo (referencia)', 'Máximo (referencia)']);
  // un aminoácido (sin nota propia): «Referencia: no es un objetivo de tu plan»
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.$('.detalle-todos [data-clave="leucina_g"] .abre-detalle').click());
  assert.equal(t.$('.rango .objetivos-dia').textContent, 'Referencia: no es un objetivo de tu plan');
  // y un nutriente con objetivo de verdad sigue con el texto de siempre
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.$('.detalle-todos [data-clave="calcio_mg"] .abre-detalle').click());
  assert.equal(t.$('.rango .objetivos-dia').textContent, 'Objetivos: referencias EFSA');
});
