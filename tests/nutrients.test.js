import test from 'node:test';
import assert from 'node:assert/strict';
import { nutrientsForGrams, sumLines, nutrientPer100 } from '../frontend/js/core/nutrients.js';

const avena = { id: 'avena', nutrients: { energia_kcal: 389, proteina_g: 16.9, vitamina_b12_ug: 0 } };
const huevo = { id: 'huevo', nutrients: { energia_kcal: 143, proteina_g: 12.56, vitamina_b12_ug: 0.89 } };
const arroz = { id: 'arroz', nutrients: { energia_kcal: 365 } };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('escala por 100 g', () => {
  const r = nutrientsForGrams(avena, 80, ['energia_kcal', 'proteina_g']);
  close(r.energia_kcal, 311.2);
  close(r.proteina_g, 13.52);
});

test('sin dato -> null (no 0); 0 escrito -> 0', () => {
  const r = nutrientsForGrams(arroz, 100, ['energia_kcal', 'proteina_g']);
  assert.equal(r.proteina_g, null);
  assert.equal(nutrientsForGrams(avena, 100, ['vitamina_b12_ug']).vitamina_b12_ug, 0);
  assert.equal(nutrientPer100(arroz, 'hierro_mg'), null);
});

test('gramos 0 válido; negativos o NaN lanzan error', () => {
  assert.equal(nutrientsForGrams(avena, 0, ['energia_kcal']).energia_kcal, 0);
  assert.throws(() => nutrientsForGrams(avena, -1, ['energia_kcal']), RangeError);
  assert.throws(() => nutrientsForGrams(avena, NaN, ['energia_kcal']), RangeError);
});

test('sumLines: total parcial con la lista de alimentos sin dato', () => {
  const t = sumLines([{ food: avena, grams: 80 }, { food: huevo, grams: 100 }, { food: arroz, grams: 50 }], ['energia_kcal', 'proteina_g', 'vitamina_b12_ug']);
  close(t.energia_kcal.value, 311.2 + 143 + 182.5);
  assert.deepEqual(t.energia_kcal.missing, []);
  close(t.proteina_g.value, 13.52 + 12.56);
  assert.deepEqual(t.proteina_g.missing, ['arroz']);
  close(t.vitamina_b12_ug.value, 0.89);
  assert.equal(t.vitamina_b12_ug.withData, 2);
});

test('sumLines: ningún alimento con dato -> null; cero real con todos con dato -> 0', () => {
  assert.equal(sumLines([{ food: arroz, grams: 50 }], ['hierro_mg']).hierro_mg.value, null);
  const z = sumLines([{ food: avena, grams: 50 }], ['vitamina_b12_ug']).vitamina_b12_ug;
  assert.equal(z.value, 0);
  assert.deepEqual(z.missing, []);
  assert.equal(sumLines([], ['energia_kcal']).energia_kcal.value, null);
});

test('sumLines no duplica un alimento sin dato repetido', () => {
  const t = sumLines([{ food: arroz, grams: 10 }, { food: arroz, grams: 20 }], ['proteina_g']);
  assert.deepEqual(t.proteina_g.missing, ['arroz']);
});
