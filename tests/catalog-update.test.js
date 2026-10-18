// Actualizar el documento del dispositivo con el foods.csv publicado (fusión a tres bandas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText, planCatalogUpdate, applyChoices, unirCabeceras } from '../frontend/js/core/catalog-update.js';
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
