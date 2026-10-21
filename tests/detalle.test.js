// Detalle de alimento y de nutriente: lógica pura (core/detalle.js). Cuentas con una cantidad no redonda, null frente a 0,
// completitud, fuente, top 5 del catálogo, rango del nutriente y guardado de los gramos de una línea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, settings, readFile, realFoods } from './helpers.js';
import { loadTargets } from '../frontend/js/core/targets.js';
import { targetsForDate } from '../frontend/js/core/targets-plan.js';
import {
  opcionesPorcion, gramosDeCantidad, cantidadDeGramos, filasAlimento, grupoDetalle, GRUPOS_DETALLE, fuenteDe, completitudDe, registroConGramos,
  racionHabitual, topCatalogo, referenciaDe, rangoNutriente, limpiarInfoNutrientes,
} from '../frontend/js/core/detalle.js';

const targets = loadTargets(JSON.parse(readFile('../data/targets.json')), catalog).targets;
const obj = targetsForDate('2026-10-16', { plan: null, targets, catalog });
const food = (id, nutrients, extra = {}) => ({ id, nombre: id, alias: [], porciones: [], extra, nutrients });
const rojo = food('rojo', { energia_kcal: 600, proteina_g: 20, epa_g: 0, calcio_mg: 120 }); // vitamina_b12_ug sin dato

test('cantidad no redonda: valor por 100 g × gramos / 100, con coma decimal', () => {
  const g = gramosDeCantidad('37,5');
  assert.equal(g, 37.5);
  const { resumen } = filasAlimento({ food: rojo, grams: g, objetivos: obj.list, catalog });
  const kcal = resumen.find((r) => r.clave === 'energia_kcal');
  assert.equal(kcal.total, 225);
  assert.equal(resumen.find((r) => r.clave === 'proteina_g').total, 7.5);
  assert.equal(kcal.pct, 225 / obj.list.find((t) => t.clave === 'energia_kcal').valor);
  assert.equal(filasAlimento({ food: rojo, grams: 37.5, objetivos: obj.list, catalog }).grupos.flatMap((x) => x.filas).find((r) => r.clave === 'calcio_mg').total, 45);
});

test('sin dato es null (nunca 0, sin % ni barra) y un 0 escrito es un 0 real', () => {
  const { grupos } = filasAlimento({ food: rojo, grams: 37.5, objetivos: obj.list, catalog });
  const fila = (k) => grupos.flatMap((x) => x.filas).find((r) => r.clave === k);
  assert.equal(fila('vitamina_b12_ug').total, null);
  assert.equal(fila('vitamina_b12_ug').pct, null);
  assert.equal(fila('vitamina_b12_ug').estado, 'sin_dato');
  assert.equal(fila('epa_g').total, 0);
  assert.equal(fila('azucares_g').total, null);
  assert.equal(fila('almidon_g').pct, null); // sin objetivo: sin %
  // un nutriente con objetivo y 0 escrito: 0 %, no «sin dato»
  const cero = filasAlimento({ food: food('c', { vitamina_c_mg: 0 }), grams: 50, objetivos: obj.list, catalog }).grupos.flatMap((x) => x.filas).find((r) => r.clave === 'vitamina_c_mg');
  assert.equal(cero.total, 0); assert.equal(cero.pct, 0); assert.notEqual(cero.estado, 'sin_dato');
});

test('los grupos salen en el orden de la pantalla, con todos los nutrientes del catálogo una sola vez', () => {
  const { grupos } = filasAlimento({ food: rojo, grams: 100, objetivos: obj.list, catalog });
  assert.deepEqual(grupos.map((g) => g.id), GRUPOS_DETALLE.map((g) => g.id));
  assert.equal(grupos.flatMap((g) => g.filas).length, catalog.list.length);
  assert.equal(grupos.find((g) => g.id === 'proteinas').filas[0].clave, 'proteina_g');
  assert.ok(grupos.find((g) => g.id === 'proteinas').filas.some((f) => f.clave === 'leucina_g'));
  assert.ok(grupos.find((g) => g.id === 'hidratos').filas.some((f) => f.clave === 'fibra_g'));
  assert.equal(grupoDetalle({ key: 'x', group: 'inventado' }), 'otros');
});

test('porciones: «g» y cada porción del documento; gramos desde cantidad y porción', () => {
  const aceite = realFoods.find((f) => f.id === 'aceite_oliva');
  const op = opcionesPorcion(aceite);
  assert.equal(op[0].etiqueta, 'g');
  assert.equal(op[1].etiqueta, '1 cucharada (13,5 g)');
  assert.equal(gramosDeCantidad('2', op[1]), 27);
  assert.equal(gramosDeCantidad('0'), null);
  assert.equal(gramosDeCantidad('abc'), null);
  assert.equal(gramosDeCantidad(''), null);
  assert.equal(cantidadDeGramos(27, op[1]), '2');
  assert.equal(cantidadDeGramos(37.5), '37,5');
  assert.deepEqual(opcionesPorcion(rojo).map((o) => o.id), ['g']);
});

test('fuente corta legible y completitud n/31', () => {
  assert.match(fuenteDe(realFoods.find((f) => f.id === 'almendras_crudas')).corto, /^USDA FoodData Central \(SR Legacy\) · fdcId 170567$/);
  assert.match(fuenteDe(realFoods.find((f) => f.id === 'brocoli')).corto, /^BEDCA/);
  assert.match(fuenteDe(realFoods.find((f) => f.id === 'corn_flakes')).corto, /^Etiqueta/);
  assert.match(fuenteDe(realFoods.find((f) => f.id === 'atun_lata_con_aceite')).corto, /^Receta/);
  assert.match(fuenteDe(rojo).corto, /^Sin fuente/);
  assert.equal(fuenteDe(rojo).completo, null);
  assert.match(fuenteDe(realFoods.find((f) => f.id === 'almendras_crudas')).completo, /Nuts, almonds/);
  const c = completitudDe(rojo, settings.requiredNutrients);
  assert.equal(c.total, 31);
  assert.equal(c.filled, 4); // energía, proteína, calcio y el 0 escrito de EPA (cuenta como relleno)
});

test('registroConGramos: solo cambia esa línea, conserva el id y marca updatedAt; no admite gramos inválidos', () => {
  const rec = { id: 'r1', date: '2026-10-16', meal: 'comida', createdAt: 'x', text: 't', lines: [{ food_id: 'a', grams: 50, source_text: '' }, { food_id: 'b', grams: 20, source_text: '' }] };
  const nuevo = registroConGramos(rec, 1, 37.5, new Date('2026-10-16T10:00:00Z'));
  assert.equal(nuevo.id, 'r1'); assert.equal(nuevo.updatedAt, '2026-10-16T10:00:00.000Z');
  assert.deepEqual(nuevo.lines.map((l) => l.grams), [50, 37.5]);
  assert.equal(rec.lines[1].grams, 20); // el original no se toca
  assert.throws(() => registroConGramos(rec, 5, 10), /línea/);
  assert.throws(() => registroConGramos(rec, 0, 0), /mayores que 0/);
  assert.throws(() => registroConGramos(rec, 0, 5000), /Editar/);
});

test('ración habitual: cantidad_habitual_g; si no, la primera porción; si no, 100 g', () => {
  assert.deepEqual(racionHabitual(food('a', {}, { cantidad_habitual_g: '42' })), { gramos: 42, origen: 'habitual' });
  assert.deepEqual(racionHabitual({ ...food('a', {}), porciones: [{ nombre: 'vaso', gramos: 250 }] }), { gramos: 250, origen: 'porcion' });
  assert.deepEqual(racionHabitual(food('a', {}, { cantidad_habitual_g: '' })), { gramos: 100, origen: '100g' });
});

test('top 5 del catálogo: sin incluir=no, con dato y distinto de 0, por aporte de la ración habitual', () => {
  const foods = [
    food('a', { calcio_mg: 100 }, { cantidad_habitual_g: '100' }), // 100
    food('b', { calcio_mg: 1000 }, { cantidad_habitual_g: '5' }), // 50
    food('c', { calcio_mg: 500 }, { cantidad_habitual_g: '100', incluir: 'no' }), // excluido
    food('d', { calcio_mg: 0 }, { cantidad_habitual_g: '100' }), // 0 escrito: no aporta
    food('e', {}, { cantidad_habitual_g: '100' }), // sin dato
    { ...food('f', { calcio_mg: 80 }), porciones: [{ nombre: 'unidad', gramos: 150 }] }, // 120 (primera porción)
    food('g', { calcio_mg: 30 }), // 30 (100 g)
    food('h', { calcio_mg: 60 }, { cantidad_habitual_g: '100', incluir: 'si' }), // 60
    food('i', { calcio_mg: 10 }, { cantidad_habitual_g: '100' }), // 10: queda fuera del top 5
    food('j', { calcio_mg: 40 }, { cantidad_habitual_g: '100' }), // 40
  ];
  const top = topCatalogo({ foods, clave: 'calcio_mg', objetivo: 1000 });
  assert.deepEqual(top.map((t) => t.id), ['f', 'a', 'h', 'b', 'j']);
  assert.deepEqual(top.map((t) => t.aporte), [120, 100, 60, 50, 40]);
  assert.equal(top[0].racion, 150); assert.equal(top[0].pct, 0.12);
  assert.equal(topCatalogo({ foods, clave: 'calcio_mg' })[0].pct, null); // sin objetivo no hay %
  assert.deepEqual(topCatalogo({ foods, clave: 'zinc_mg' }), []);
  // con el catálogo real: nada excluido y como mucho 5
  const real = topCatalogo({ foods: realFoods, clave: 'calcio_mg', objetivo: 1000 });
  assert.equal(real.length, 5);
  assert.ok(real.every((t) => !realFoods.find((f) => f.id === t.id).extra.incluir?.match(/^no$/i)));
  assert.ok(real.every((t, i) => i === 0 || real[i - 1].aporte >= t.aporte));
});

test('referencia de targets.json con el perfil, y rango del nutriente (marcas, barra y tabla solo con lo que existe)', () => {
  const ref = referenciaDe(targets, 'vitamina_a_ug', 'mujer');
  assert.deepEqual(ref, { valor: 650, tipo: 'min' });
  assert.deepEqual(referenciaDe(targets, 'vitamina_a_ug', 'hombre'), { valor: 750, tipo: 'min' });
  assert.equal(referenciaDe(targets, 'almidon_g', 'hombre'), null);
  const o = targetsForDate('2026-10-16', { plan: null, targets, catalog });
  const fila = filasAlimento({ food: food('v', { vitamina_a_ug: 1500 }), grams: 100, objetivos: o.list, catalog }).filas.get('vitamina_a_ug');
  const r = rangoNutriente({ fila, hoy: 2100, aporteOriginal: 500, referencia: referenciaDe(targets, 'vitamina_a_ug', o.perfil) });
  assert.deepEqual(r.filas.map((x) => x.id), ['alimento', 'hoy', 'min', 'referencia', 'ul']);
  assert.equal(r.filas.find((x) => x.id === 'alimento').valor, 1500);
  assert.equal(r.filas.find((x) => x.id === 'referencia').nota, 'mínimo');
  assert.equal(r.escala, 3100 * 1.15); // lo más grande es el total de la barra (1600 + 1500)
  assert.equal(r.barra.otros, 1600 / r.escala); // 2100 de hoy − 500 que ya aportaba la línea
  assert.ok(Math.abs(r.barra.aporte - 1500 / r.escala) < 1e-9);
  assert.ok(r.marcas.find((m) => m.id === 'ul').pos > r.marcas.find((m) => m.id === 'min').pos);
  assert.equal(r.barra.superaUl, true); // 1600 + 1500 = 3100 > UL 3000
});

test('rango sin dato: «Este alimento» sin valor y sin segmento; sin ningún valor que dibujar no hay barra', () => {
  const o = targetsForDate('2026-10-16', { plan: null, targets, catalog });
  const sin = filasAlimento({ food: rojo, grams: 100, objetivos: o.list, catalog }).filas.get('vitamina_b12_ug');
  const r = rangoNutriente({ fila: sin });
  assert.equal(r.filas[0].valor, null);
  assert.equal(r.barra.aporte, 0);
  const nada = rangoNutriente({ fila: { total: null, min: null, objetivo: null, max: null, ul: null } });
  assert.equal(nada.barra, null);
  assert.deepEqual(nada.filas.map((x) => x.id), ['alimento']);
});

test('información de nutrientes: se limpian textos y solo quedan enlaces https', () => {
  const info = limpiarInfoNutrientes({ nutrientes: {
    ok: { resumen: ' Hola ', referencias: [{ organismo: 'EFSA', titulo: 'T', url: 'https://www.efsa.europa.eu/', consultado: '2026-10-20' }, { titulo: 'Malo', url: 'http://x.es' }, { titulo: 'Sin url' }] },
    vacio: { resumen: '  ' }, roto: 5,
  } });
  assert.deepEqual(Object.keys(info), ['ok']);
  assert.equal(info.ok.resumen, 'Hola');
  assert.equal(info.ok.referencias.length, 1);
  assert.deepEqual(limpiarInfoNutrientes(null), {});
  assert.deepEqual(limpiarInfoNutrientes({ nutrientes: {} }), {});
});
