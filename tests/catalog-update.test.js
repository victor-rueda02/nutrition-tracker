// Actualizar el documento del dispositivo con el foods.csv publicado (fusión a tres bandas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText, planCatalogUpdate, applyChoices, unirCabeceras, anadidoConIA, eleccionesPorDefecto, elegirAlimento, elegirTodos, eleccionAlimento } from '../frontend/js/core/catalog-update.js';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { catalog, csv, readFile } from './helpers.js';

const H = 'id,nombre,alias,porciones,energia_kcal,proteina_g,incluir';
const doc = (...rows) => parseFoodsCSV(csv(H, ...rows), { catalog }).foods;
const plan = (local, remote, base) => planCatalogUpdate({ local, remote, base, catalog });
const de = (foods, id) => foods.find((f) => f.id === id);

test('huella del texto: estable y distinta si cambia algo', () => {
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
  assert.match(hashText(''), /^[0-9a-f]{8}$/);
});

test('con base: lo que solo cambió en lo publicado se actualiza; lo que solo cambiaste tú se conserva', () => {
  const base = doc('arroz,Arroz,arroz,,365,7,si', 'kiwi,Kiwi,kiwi,unidad:69,61,1,no');
  const mio = doc('arroz,Arroz,arroz|arroz largo,,365,7,si', 'kiwi,Kiwi,kiwi,unidad:69,61,1,si'); // alias propio y kiwi activado
  const publicado = doc('arroz,Arroz,arroz,,360,7.1,si', 'kiwi,Kiwi,kiwi,unidad:75,61,1,no', 'pera,Pera,pera,,57,0.4,si');
  const p = plan(mio, publicado, base);
  assert.deepEqual(p.conflictos, []);
  assert.deepEqual(p.nuevos, [{ id: 'pera', nombre: 'Pera' }]);
  assert.deepEqual(p.actualizados.map((a) => [a.id, a.campos]), [['arroz', ['Energía', 'Proteína']], ['kiwi', ['porciones']]]);
  const arroz = de(p.foods, 'arroz');
  assert.deepEqual([arroz.alias, arroz.nutrients.energia_kcal, arroz.nutrients.proteina_g], [['arroz', 'arroz largo'], 360, 7.1]);
  const kiwi = de(p.foods, 'kiwi');
  assert.deepEqual([kiwi.extra.incluir, kiwi.porciones], ['si', [{ nombre: 'unidad', gramos: 75 }]]);
  assert.equal(p.hayCambios, true);
});

test('con base: si los dos cambiaron el mismo campo, es un conflicto; por defecto se queda lo tuyo, y puedes elegir', () => {
  const base = doc('arroz,Arroz,arroz,,365,7,si');
  const mio = doc('arroz,Arroz,arroz|arroz blanco,,365,7,si');
  const publicado = doc('arroz,Arroz,arroz|arroz largo,,365,7,si');
  const p = plan(mio, publicado, base);
  assert.deepEqual(p.conflictos, [{ id: 'arroz', nombre: 'Arroz', campo: 'core:alias', etiqueta: 'alias', mio: 'arroz|arroz blanco', publicado: 'arroz|arroz largo' }]);
  assert.deepEqual(de(p.foods, 'arroz').alias, ['arroz', 'arroz blanco']);
  assert.deepEqual(de(applyChoices(p, publicado, { 'arroz|core:alias': 'publicado' }), 'arroz').alias, ['arroz', 'arroz largo']);
  assert.deepEqual(de(applyChoices(p, publicado, { 'arroz|core:alias': 'mio' }), 'arroz').alias, ['arroz', 'arroz blanco']);
});

test('nunca se borra un alimento: los que ya no están publicados se mantienen; sin cambios, nada que hacer', () => {
  const base = doc('arroz,Arroz,arroz,,365,7,si', 'ron,Ron,ron,,231,0,no');
  const publicado = doc('arroz,Arroz,arroz,,365,7,si');
  const p = plan(base, publicado, base);
  assert.deepEqual(p.retirados, [{ id: 'ron', nombre: 'Ron' }]);
  assert.ok(de(p.foods, 'ron'));
  assert.equal(p.hayCambios, false);
  assert.equal(plan(publicado, publicado, publicado).hayCambios, false);
});

test('sin base (instalación anterior): todo viene de lo publicado salvo un alimento que activaste y ahora está excluido', () => {
  const mio = doc('arroz,Arroz,arroz,,365,7,si', 'merluza_cocida,Merluza cocida,merluza,,116,23,si', 'mayonesa,Mayonesa,mayonesa,,680,1,no');
  const publicado = doc('arroz,Arroz,arroz|arroz largo,,360,7,si', 'merluza_cocida,Merluza cocida,merluza,,116,23,no', 'mayonesa,Mayonesa,mayonesa|mahonesa,,680,1,si');
  const p = plan(mio, publicado, null);
  assert.deepEqual(p.conflictos.map((c) => [c.id, c.campo, c.mio, c.publicado]), [['merluza_cocida', 'extra:incluir', 'si', 'no']]);
  assert.deepEqual(de(p.foods, 'arroz').alias, ['arroz', 'arroz largo']);
  assert.equal(de(p.foods, 'arroz').nutrients.energia_kcal, 360);
  assert.equal(de(p.foods, 'mayonesa').extra.incluir, 'si'); // activar desde lo publicado no es conflicto
  assert.equal(de(applyChoices(p, publicado, { 'merluza_cocida|extra:incluir': 'publicado' }), 'merluza_cocida').extra.incluir, 'no');
});

test('documento real: actualizar del catálogo de antes (64) al de ahora sin base no pierde nada ni da conflictos', () => {
  const ahora = parseFoodsCSV(readFile('../data/foods.csv'), { catalog }).foods;
  const antes = ahora.filter((f) => !['brocoli', 'champinon'].includes(f.id)).map((f) => ({ ...f, alias: f.alias.slice(0, 1), nutrients: {}, extra: { ...f.extra } }));
  const p = plan(antes, ahora, null);
  assert.equal(p.foods.length, ahora.length);
  assert.deepEqual(p.nuevos.map((n) => n.id).sort(), ['brocoli', 'champinon']);
  assert.deepEqual(p.conflictos, []);
  assert.deepEqual(applyChoices(p, ahora).map((f) => f.nutrients), ahora.map((f) => f.nutrients));
  assert.deepEqual(unirCabeceras(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
});

// ---------- Elegir todo un alimento, todos, y los añadidos con IA ----------
const HX = 'id,nombre,alias,energia_kcal,proteina_g,tipo,pendiente_revisar';
const docX = (...rows) => parseFoodsCSV(csv(HX, ...rows), { catalog }).foods;
const fix = (f) => parseFoodsCSV(readFile(`./fixtures/${f}`), { catalog }).foods;

test('conflictos agrupados por alimento: cuántos campos tiene cada uno y si lo añadiste con IA', () => {
  const base = docX('arroz,Arroz,arroz,365,7,,', 'pasta,Pasta,pasta,350,12,,');
  const mio = docX('arroz,Arroz,arroz|blanco,360,7,,', 'pasta,Pasta,pasta,340,11,usda_app,si');
  const pub = docX('arroz,Arroz,arroz|largo,350,7,,', 'pasta,Pasta,pasta,355,13,,');
  const p = plan(mio, pub, base);
  assert.deepEqual(p.alimentosConflicto, [
    { id: 'arroz', nombre: 'Arroz', campos: 2, anadidoConIA: false },
    { id: 'pasta', nombre: 'Pasta', campos: 2, anadidoConIA: true },
  ]);
  assert.equal(anadidoConIA(mio[1]), true);
  assert.equal(anadidoConIA(mio[0]), false);
  assert.equal(anadidoConIA(docX('x,X,x,1,1,,si')[0]), true); // pendiente_revisar=si sin tipo
});

test('valor por defecto: «mío» en todo, salvo los alimentos añadidos con IA, que llegan como lo publicado', () => {
  const base = docX('arroz,Arroz,arroz,365,7,,', 'pasta,Pasta,pasta,350,12,,');
  const mio = docX('arroz,Arroz,arroz|blanco,360,7,,', 'pasta,Pasta,pasta,340,11,usda_app,si');
  const pub = docX('arroz,Arroz,arroz|largo,350,7,,', 'pasta,Pasta,pasta,355,13,,');
  const p = plan(mio, pub, base);
  const def = eleccionesPorDefecto(p);
  assert.deepEqual(Object.keys(def).sort(), p.conflictos.filter((c) => c.id === 'pasta').map((c) => `pasta|${c.campo}`).sort());
  assert.ok(Object.keys(def).length >= 2);
  const foods = applyChoices(p, pub, def);
  assert.equal(de(foods, 'pasta').nutrients.energia_kcal, 355); // IA -> publicado
  assert.deepEqual(de(foods, 'arroz').alias, ['arroz', 'blanco']); // normal -> mío
  assert.equal(de(foods, 'arroz').nutrients.energia_kcal, 360);
});

test('elegir todo un alimento, todos, y la marca de cada alimento', () => {
  const base = docX('arroz,Arroz,arroz,365,7,,', 'pasta,Pasta,pasta,350,12,,');
  const mio = docX('arroz,Arroz,arroz|blanco,360,8,,', 'pasta,Pasta,pasta,340,11,,');
  const pub = docX('arroz,Arroz,arroz|largo,350,9,,', 'pasta,Pasta,pasta,355,13,,');
  const p = plan(mio, pub, base);
  assert.deepEqual(eleccionesPorDefecto(p), {});
  assert.equal(eleccionAlimento(p, {}, 'arroz'), 'mio');
  const uno = elegirAlimento(p, {}, 'arroz', 'publicado');
  assert.equal(eleccionAlimento(p, uno, 'arroz'), 'publicado');
  assert.equal(eleccionAlimento(p, uno, 'pasta'), 'mio'); // el otro alimento no cambia
  const foods = applyChoices(p, pub, uno);
  assert.deepEqual([de(foods, 'arroz').alias, de(foods, 'arroz').nutrients.proteina_g, de(foods, 'pasta').nutrients.energia_kcal], [['arroz', 'largo'], 9, 340]);
  const mixto = { ...uno, 'arroz|nutriente:proteina_g': 'mio' };
  assert.equal(eleccionAlimento(p, mixto, 'arroz'), 'mixto');
  assert.equal(eleccionAlimento(p, elegirAlimento(p, mixto, 'arroz', 'mio'), 'arroz'), 'mio');
  assert.deepEqual(uno, { 'arroz|core:alias': 'publicado', 'arroz|nutriente:energia_kcal': 'publicado', 'arroz|nutriente:proteina_g': 'publicado' });
  const todos = elegirTodos(p, {}, 'publicado');
  const f2 = applyChoices(p, pub, todos);
  assert.deepEqual(f2.map((f) => [f.alias, f.nutrients.energia_kcal, f.nutrients.proteina_g]), pub.map((f) => [f.alias, f.nutrients.energia_kcal, f.nutrients.proteina_g]));
  assert.equal(eleccionAlimento(p, elegirTodos(p, todos, 'mio'), 'pasta'), 'mio');
  assert.deepEqual(elegirTodos(p, {}, 'mio') && applyChoices(p, pub, elegirTodos(p, {}, 'mio')).map((f) => f.nutrients.energia_kcal), [360, 340]);
});

test('export real de Victor: sus 4 alimentos de Estimar con IA ya publicados con etiqueta salen con muchos conflictos y se resuelven de una vez', () => {
  const mio = fix('actualizar_local_ia.csv');
  const pub = fix('actualizar_publicado_ia.csv');
  assert.equal(mio.length, 4);
  assert.ok(mio.every(anadidoConIA));
  const base = docX('arroz,Arroz,arroz,365,7,,'); // la base anterior no tenía esos ids
  const p = plan(mio, pub, base);
  assert.deepEqual(p.alimentosConflicto.map((a) => a.id).sort(), ['anacardos', 'bebida_de_avena', 'cafe_expreso', 'salchichon']);
  assert.equal(p.conflictos.length, 96);
  assert.deepEqual(p.alimentosConflicto.map((a) => [a.id, a.campos]), [['salchichon', 31], ['bebida_de_avena', 40], ['cafe_expreso', 6], ['anacardos', 19]]);
  assert.ok(p.alimentosConflicto.every((a) => a.anadidoConIA && a.campos > 0));
  assert.equal(p.alimentosConflicto.reduce((n, a) => n + a.campos, 0), p.conflictos.length);
  // Por defecto (IA) ya se queda lo publicado: no hay que pulsar nada.
  const foods = applyChoices(p, pub, eleccionesPorDefecto(p));
  for (const r of pub) {
    const f = de(foods, r.id);
    assert.deepEqual(f.nutrients, r.nutrients, r.id);
    assert.deepEqual(f.alias, r.alias, r.id);
  }
  // Y mantener lo mío en un alimento sigue siendo posible.
  const mantener = elegirAlimento(p, eleccionesPorDefecto(p), 'salchichon', 'mio');
  assert.deepEqual(de(applyChoices(p, pub, mantener), 'salchichon').nutrients, de(mio, 'salchichon').nutrients);
});
