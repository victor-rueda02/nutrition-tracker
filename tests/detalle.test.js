// Detalle de alimento y de nutriente: lógica pura (core/detalle.js). Cuentas con una cantidad no redonda, null frente a 0,
// completitud, fuente, top 5 del catálogo, rango del nutriente y guardado de los gramos de una línea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, settings, readFile, realFoods } from './helpers.js';
import { loadTargets } from '../frontend/js/core/targets.js';
import { targetsForDate } from '../frontend/js/core/targets-plan.js';
import {
  opcionesPorcion, gramosDeCantidad, cantidadDeGramos, filasAlimento, grupoDetalle, GRUPOS_DETALLE, fuenteDe, completitudDe, registroConGramos,
  racionHabitual, topCatalogo, referenciaDe, rangoNutriente, limpiarInfoNutrientes, cantidadLegible,
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
  assert.equal(grupos.flatMap((g) => g.filas).length, catalog.list.length + 1); // + la fila EPA + DHA
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
  assert.match(fuenteDe(realFoods.find((f) => f.id === 'huevo')).corto, /^USDA FoodData Central \(SR Legacy\) · fdcId 171287$/);
  assert.match(fuenteDe(realFoods.find((f) => f.id === 'almendras_crudas')).corto, /^Etiqueta/);
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
  const fila = filasAlimento({ food: food('v', { calcio_mg: 1500 }), grams: 100, objetivos: o.list, catalog }).filas.get('calcio_mg');
  const r = rangoNutriente({ fila, hoy: 2100, aporteOriginal: 500, referencia: referenciaDe(targets, 'calcio_mg', o.perfil) });
  assert.deepEqual(r.filas.map((x) => x.id), ['alimento', 'hoy', 'min', 'ul']); // la referencia (950) se funde con el mínimo (950)
  assert.equal(r.filas.find((x) => x.id === 'min').etiqueta, 'Mínimo (referencia)');
  assert.equal(r.filas.find((x) => x.id === 'hoy').etiqueta, 'Llevas hoy (con esta cantidad)');
  assert.equal(r.filas.find((x) => x.id === 'hoy').valor, 3100); // otros 1600 + este alimento 1500
  assert.deepEqual(r.marcas.map((m) => m.etiqueta), ['Mín. y ref.', 'UL']); // una sola marca para dos valores iguales
  assert.equal(r.filas.find((x) => x.id === 'alimento').valor, 1500);
  assert.equal(r.escala, 3100 * 1.15); // lo más grande es el total de la barra (1600 + 1500)
  assert.equal(r.barra.otros, 1600 / r.escala); // 2100 de hoy − 500 que ya aportaba la línea
  assert.ok(Math.abs(r.barra.aporte - 1500 / r.escala) < 1e-9);
  assert.ok(r.marcas.find((m) => m.id === 'ul').pos > r.marcas.find((m) => m.id === 'min').pos);
  assert.equal(r.barra.superaUl, true); // 1600 + 1500 = 3100 > UL 2500
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

test('«Llevas hoy» / «Llevas ese día»: coherente con la cantidad (sin cambios, el total del día; con otra cantidad, lo de otros + lo nuevo)', () => {
  const o = targetsForDate('2026-10-15', { plan: null, targets, catalog });
  const f = (g) => filasAlimento({ food: food('v', { calcio_mg: 100 }), grams: g, objetivos: o.list, catalog }).filas.get('calcio_mg');
  // el día suma 300 mg y esta línea (200 g = 200 mg) es parte de ellos
  const igual = rangoNutriente({ fila: f(200), hoy: 300, aporteOriginal: 200, etiquetaHoy: 'Llevas ese día' });
  assert.equal(igual.filas.find((x) => x.id === 'hoy').etiqueta, 'Llevas ese día');
  assert.equal(igual.filas.find((x) => x.id === 'hoy').valor, 300);
  assert.equal(igual.leyenda.otros.etiqueta, 'Llevas ese día (sin este alimento)');
  assert.equal(igual.leyenda.otros.valor, 100);
  // con 50 g: 100 de otros + 50 = 150, y la tabla lo dice
  const otra = rangoNutriente({ fila: f(50), hoy: 300, aporteOriginal: 200, etiquetaHoy: 'Llevas ese día' });
  assert.equal(otra.filas.find((x) => x.id === 'hoy').etiqueta, 'Llevas ese día (con esta cantidad)');
  assert.equal(otra.filas.find((x) => x.id === 'hoy').valor, 150);
  assert.equal(otra.leyenda.otros.valor + otra.leyenda.aporte.valor, 150); // la leyenda cuadra con la fila
  assert.equal(rangoNutriente({ fila: f(50) }).leyenda.otros, null); // desde Alimentos no hay «Llevas hoy»
});

test('lo muy pequeño pero no nulo se muestra «<0,01» y no «0»; un 0 real sigue siendo 0', () => {
  const fmt = (v) => `${v} g`;
  assert.equal(cantidadLegible(0.00246, 'g', fmt), '<0,01 g');
  assert.equal(cantidadLegible(0, 'g', fmt), '0 g');
  assert.equal(cantidadLegible(0.01, 'g', fmt), '0.01 g');
  assert.equal(cantidadLegible(null, 'g', () => 'sin dato'), 'sin dato');
});

test('EPA + DHA: fila de suma tras DHA, como `combine` del informe (null si ninguna parte tiene dato)', () => {
  const suma = (f, g = 50) => { const { grupos, filas } = filasAlimento({ food: f, grams: g, objetivos: obj.list, catalog }); return { fila: filas.get('epa_dha'), lipidos: grupos.find((x) => x.id === 'lipidos').filas }; };
  const a = suma(food('p', { epa_g: 0.2, dha_g: 0.3 }));
  assert.equal(a.fila.total, 0.25);
  assert.equal(a.fila.pct, 1);
  assert.equal(a.fila.label, 'EPA + DHA');
  const claves = a.lipidos.map((r) => r.clave);
  assert.equal(claves[claves.indexOf('dha_g') + 1], 'epa_dha');
  assert.equal(suma(food('p', { epa_g: 0.2 })).fila.total, 0.1); // una parte con dato basta
  assert.equal(suma(food('p', { epa_g: 0, dha_g: 0 })).fila.total, 0); // 0 real
  assert.equal(suma(food('p', { calcio_mg: 5 })).fila.total, null); // sin dato
  assert.equal(suma(food('p', { calcio_mg: 5 })).fila.estado, 'sin_dato');
  // y el top del catálogo de la suma
  const top = topCatalogo({ foods: [food('a', { epa_g: 0.1, dha_g: 0.2 }, { cantidad_habitual_g: '100' }), food('b', { epa_g: 0.1 }, { cantidad_habitual_g: '100' }), food('c', {})], clave: 'epa_dha', suma: ['epa_g', 'dha_g'] });
  assert.deepEqual(top.map((t) => [t.id, Math.round(t.aporte * 100) / 100]), [['a', 0.3], ['b', 0.1]]);
});

test('subpartidas marcadas para la sangría', () => {
  const { grupos } = filasAlimento({ food: rojo, grams: 100, objetivos: obj.list, catalog });
  const sub = (k) => grupos.flatMap((g) => g.filas).find((r) => r.clave === k).sub;
  for (const k of ['grasas_saturadas_g', 'grasas_monoinsaturadas_g', 'ala_g', 'epa_g', 'dha_g', 'azucares_g', 'fibra_g', 'almidon_g']) assert.equal(sub(k), true, k);
  for (const k of ['grasa_total_g', 'omega3_g', 'hidratos_g', 'proteina_g', 'calcio_mg']) assert.equal(sub(k), false, k);
});

test('UL informativo (vitamina A, folato): sin aviso en la barra, sin marca UL, y en la tabla con su etiqueta', () => {
  const o = targetsForDate('2026-10-16', { plan: null, targets, catalog });
  for (const [clave, ul, cantidad] of [['vitamina_a_ug', 3000, 4000], ['vitamina_b9_ug', 1000, 1080]]) {
    const fila = filasAlimento({ food: food('v', { [clave]: cantidad }), grams: 100, objetivos: o.list, catalog }).filas.get(clave);
    assert.equal(fila.ulInformativo, true, clave);
    assert.equal(fila.superaUl, false, clave);
    const r = rangoNutriente({ fila, hoy: cantidad, aporteOriginal: cantidad, referencia: referenciaDe(targets, clave, o.perfil) });
    assert.equal(r.barra.superaUl, false, clave);
    assert.ok(!r.marcas.some((m) => m.ids.includes('ul')), clave);
    assert.deepEqual(r.filas.find((x) => x.id === 'ul'), { id: 'ul', etiqueta: 'UL (informativo)', valor: ul }, clave);
  }
  // un UL normal (zinc) sigue avisando y con su marca
  const zinc = filasAlimento({ food: food('z', { zinc_mg: 40 }), grams: 100, objetivos: o.list, catalog }).filas.get('zinc_mg');
  const rz = rangoNutriente({ fila: zinc, hoy: 40, aporteOriginal: 40 });
  assert.equal(rz.barra.superaUl, true);
  assert.ok(rz.marcas.some((m) => m.ids.includes('ul')));
  assert.equal(rz.filas.find((x) => x.id === 'ul').etiqueta, 'UL');
});
