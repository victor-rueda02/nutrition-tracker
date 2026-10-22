// Hito 4, fase 1: objetivos (targets.json) y diario del día.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargets, resolveTargets, referenceValue } from '../frontend/js/core/targets.js';
import { diaryReport, dayTotals, evaluate, shiftDate } from '../frontend/js/core/diary.js';
import { catalog, settings, readFile, realFoods, rulesFoods, foodsConSinDatos } from './helpers.js';

const raw = JSON.parse(readFile('../data/targets.json'));
const { targets, warnings } = loadTargets(raw, catalog);
const byId = new Map(realFoods.map((f) => [f.id, f]));
const val = (list, clave) => list.find((t) => t.clave === clave);
const meal = (id, mealName, lines, date = '2026-10-17') => ({ id, date, meal: mealName, createdAt: `${date}T10:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });

// ---------- targets.json ----------
test('targets.json: válido, cubre los 31 obligatorios (EPA y DHA como EPA + DHA) y trae UL de la EFSA (vitamina A y folato, informativos)', () => {
  assert.deepEqual(warnings, []);
  const claves = new Set(targets.list.flatMap((t) => t.suma ?? [t.clave]));
  for (const k of settings.requiredNutrients) assert.ok(claves.has(k), k);
  assert.equal(targets.perfilPorDefecto, 'hombre');
  const ul = Object.fromEntries(targets.list.filter((t) => t.ul !== null).map((t) => [t.clave, t.ul]));
  assert.deepEqual(ul, { vitamina_a_ug: 3000, vitamina_d_ug: 100, vitamina_e_mg: 300, vitamina_b6_mg: 12, vitamina_b9_ug: 1000, calcio_mg: 2500, zinc_mg: 25, cobre_mg: 5, selenio_ug: 255 });
  assert.match(val(targets.list, 'vitamina_a_ug').notaUl, /retinol preformado/);
  assert.deepEqual(targets.list.filter((t) => t.ulInformativo).map((t) => t.clave), ['vitamina_a_ug', 'vitamina_b9_ug']);
});

test('loadTargets avisa de lo inválido y lo ignora', () => {
  const r = loadTargets({ objetivos: [{ clave: 'no_existe_mg', tipo: 'min', valor: 1 }, { clave: 'calcio_mg', tipo: 'raro', valor: 1 }, { clave: 'hierro_mg', tipo: 'min' }, { clave: 'x', suma: ['epa_g', 'nada_g'], tipo: 'min', valor: 1 }] }, catalog);
  assert.equal(r.targets.list.length, 0);
  assert.equal(r.warnings.length, 4);
});

test('perfil: hombre por defecto, mujer si se elige; lo desconocido vuelve al de defecto', () => {
  assert.equal(val(resolveTargets(targets), 'hierro_mg').valor, 11);
  assert.equal(val(resolveTargets(targets, { perfil: 'mujer' }), 'hierro_mg').valor, 16);
  assert.equal(val(resolveTargets(targets, { perfil: 'mujer' }), 'vitamina_a_ug').valor, 650);
  assert.equal(val(resolveTargets(targets, { perfil: 'marciano' }), 'hierro_mg').perfil, 'hombre');
});

test('tus objetivos mandan; B1, niacina y ALA se calculan con tus kcal', () => {
  const ref = resolveTargets(targets);
  assert.equal(val(ref, 'energia_kcal').valor, 2000);
  assert.equal(val(ref, 'vitamina_b1_mg').valor, 0.84); // 0,1 mg/MJ × 8,368 MJ
  assert.equal(val(ref, 'vitamina_b3_mg').valor, 13.39);
  assert.equal(val(ref, 'ala_g').valor, 1.11); // 0,5 % de 2000 kcal / 9
  const mio = resolveTargets(targets, { valores: { energia_kcal: 2500, proteina_g: 150, hierro_mg: -3, calcio_mg: 'mucho' } });
  assert.deepEqual([val(mio, 'energia_kcal').valor, val(mio, 'energia_kcal').origen], [2500, 'tuyo']);
  assert.deepEqual([val(mio, 'proteina_g').valor, val(mio, 'proteina_g').origen], [150, 'tuyo']);
  assert.equal(val(mio, 'vitamina_b1_mg').valor, 1.05);
  assert.deepEqual([val(mio, 'hierro_mg').valor, val(mio, 'calcio_mg').valor], [11, 950]); // valores no válidos: se ignoran
  assert.equal(val(mio, 'vitamina_a_ug').ul, 3000); // tus objetivos no tocan los UL
  assert.equal(referenceValue(targets, 'vitamina_b1_mg', { valores: { energia_kcal: 2500, vitamina_b1_mg: 9 } }), 1.05);
});

// ---------- evaluación ----------
test('evaluate: min, max y objetivo; sin dato; parcial; UL es un aviso aparte', () => {
  const t = (o) => ({ tipo: 'min', valor: 100, ul: null, ...o });
  const tot = (value, missing = []) => ({ value, missing });
  assert.equal(evaluate(tot(120), t()).estado, 'cumplido');
  assert.equal(evaluate(tot(50), t()).estado, 'por_debajo');
  assert.equal(evaluate(tot(50), t()).pct, 0.5);
  assert.equal(evaluate(tot(120), t({ tipo: 'max' })).estado, 'excedido');
  assert.equal(evaluate(tot(80), t({ tipo: 'max' })).estado, 'dentro');
  assert.deepEqual([95, 85, 115].map((v) => evaluate(tot(v), t({ tipo: 'objetivo' })).estado), ['en_objetivo', 'por_debajo', 'por_encima']);
  assert.deepEqual(evaluate(tot(null, ['ron']), t()), { total: null, pct: null, estado: 'sin_dato', superaUl: false, parcial: true });
  const ul = evaluate(tot(3500), t({ ul: 3000 }));
  assert.deepEqual([ul.estado, ul.superaUl], ['cumplido', true]);
  assert.equal(evaluate(tot(120, ['x']), t()).parcial, true);
});

// ---------- diario ----------
test('diario real: totales del día, por comida, EPA + DHA sumados y UL superado', () => {
  // Copia congelada del documento: sus corn flakes traen la fortificación de EE. UU. (para probar el UL).
  const byId = new Map(rulesFoods.map((f) => [f.id, f]));
  const meals = [
    meal('a', 'desayuno', [['avena_copos', 80], ['leche_entera', 250]]),
    meal('b', 'comida', [['salmon_atlantico', 200], ['arroz_blanco_crudo', 100]]),
    meal('c', 'cena', [['corn_flakes', 400]]), // 981 µg de vitamina A por 100 g (fortificado en EE. UU.)
  ];
  const r = diaryReport(meals, byId, resolveTargets(targets), catalog);
  const kcal = val(r.rows, 'energia_kcal');
  const esperado = 379 * 0.8 + 61 * 2.5 + byId.get('salmon_atlantico').nutrients.energia_kcal * 2 + 365 + byId.get('corn_flakes').nutrients.energia_kcal * 4;
  assert.equal(Math.round(kcal.total), Math.round(esperado));
  assert.equal(kcal.parcial, false);
  const omega = val(r.rows, 'epa_dha');
  const s = byId.get('salmon_atlantico').nutrients;
  assert.ok(Math.abs(omega.total - (s.epa_g + s.dha_g) * 2 - (byId.get('leche_entera').nutrients.epa_g ?? 0) * 2.5 - (byId.get('leche_entera').nutrients.dha_g ?? 0) * 2.5) < 1e-9);
  assert.equal(omega.estado, 'cumplido');
  // fortificados: retinol y ácido fólico por encima de 3000 y 1000, pero esos dos UL son informativos (solo retinol / ácido fólico añadido)
  assert.ok(val(r.rows, 'vitamina_a_ug').total > 3000 && val(r.rows, 'vitamina_b9_ug').total > 1000);
  assert.deepEqual(r.avisosUl.map((x) => x.clave), []);
  assert.deepEqual(r.comidas.map((c) => c.meal), ['desayuno', 'comida', 'cena']);
  assert.equal(Math.round(r.comidas[0].kcal), Math.round(379 * 0.8 + 61 * 2.5));
  assert.ok(r.otros.some((o) => o.clave === 'epa_g')); // EPA y DHA sueltos, en "otros"
  assert.ok(!r.otros.some((o) => o.clave === 'energia_kcal'));
});

test('diario: alimento sin datos o borrado del documento -> total parcial y se dice cuál; nunca suma 0', () => {
  const meals = [meal('a', 'otro', [['kiwi_verde', 100], ['refresco_sd', 330], ['ya_no_existe', 50]])];
  const r = diaryReport(meals, new Map(foodsConSinDatos.map((f) => [f.id, f])), resolveTargets(targets), catalog);
  const kcal = val(r.rows, 'energia_kcal');
  assert.equal(kcal.total, 61);
  assert.equal(kcal.parcial, true);
  assert.deepEqual(kcal.missing.sort(), ['refresco_sd', 'ya_no_existe']);
  assert.deepEqual(r.sinDatos.sort(), ['Refresco de prueba', 'ya_no_existe']);
  assert.equal(r.comidas[0].kcalParcial, true);
  assert.equal(diaryReport([], byId, resolveTargets(targets), catalog).rows.every((x) => x.estado === 'sin_dato'), true);
});

test('dayTotals y shiftDate (cambios de mes y año)', () => {
  assert.equal(dayTotals([meal('a', 'otro', [['aceite_oliva', 10]])], byId, ['grasa_total_g']).grasa_total_g.value, 10);
  assert.equal(shiftDate('2026-10-17', -1), '2026-10-16');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});

// ---------- UL informativo (rama m): vitamina A (retinol preformado) y folato (ácido fólico añadido) ----------
test('UL informativo: 1080 µg DFE de folato y 4000 µg RAE de vitamina A no superan nada (ni fila roja ni tira)', () => {
  const comidas = [meal('a', 'comida', [['lentejas_secas', 150], ['corn_flakes', 50], ['brocoli', 200]]), meal('b', 'cena', [['zanahoria', 500]], '2026-10-17')];
  const r = diaryReport(comidas, byId, resolveTargets(targets), catalog);
  const folato = val(r.rows, 'vitamina_b9_ug');
  const a = val(r.rows, 'vitamina_a_ug');
  assert.ok(folato.total > 1000, `folato ${folato.total}`);
  assert.ok(a.total > 4000, `vitamina A ${a.total}`);
  assert.equal(folato.superaUl, false); assert.equal(a.superaUl, false);
  assert.deepEqual(r.avisosUl, []);
  assert.equal(folato.ulInformativo, true); assert.equal(folato.ul, 1000); // el valor sigue ahí para enseñarlo
  // evaluate directamente: un UL informativo nunca es superado; uno normal, sí
  const tot = (v) => ({ value: v, missing: [] });
  assert.equal(evaluate(tot(4000), { tipo: 'min', valor: 750, ul: 3000, ulInformativo: true }).superaUl, false);
  assert.equal(evaluate(tot(4000), { tipo: 'min', valor: 750, ul: 3000, ulInformativo: false }).superaUl, true);
});

test('UL normal (zinc, vitamina D) sigue avisando como antes', () => {
  const zinc = { ...byId.get('huevo'), id: 'zinc_extra', nutrients: { zinc_mg: 100, vitamina_d_ug: 400 } };
  const conZinc = new Map([...byId, ['zinc_extra', zinc]]);
  const r = diaryReport([meal('a', 'cena', [['zinc_extra', 100]])], conZinc, resolveTargets(targets), catalog);
  assert.deepEqual(r.avisosUl.map((x) => x.clave).sort(), ['vitamina_d_ug', 'zinc_mg']);
  assert.equal(val(r.rows, 'zinc_mg').superaUl, true);
  assert.equal(val(r.rows, 'zinc_mg').ulInformativo, false);
});
