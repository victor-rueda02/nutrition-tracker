import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortions, serializePortions, portionToGrams, needsPortion } from '../frontend/js/core/portions.js';

test('parsea porciones con nombre y gramos', () => {
  const { portions, warnings } = parsePortions('huevo mediano:50|clara:33');
  assert.deepEqual(portions, [{ nombre: 'huevo mediano', gramos: 50 }, { nombre: 'clara', gramos: 33 }]);
  assert.equal(warnings.length, 0);
  assert.equal(serializePortions(portions), 'huevo mediano:50|clara:33');
});

test('vacío es válido y no avisa', () => {
  assert.deepEqual(parsePortions(''), { portions: [], warnings: [] });
  assert.deepEqual(parsePortions(undefined), { portions: [], warnings: [] });
});

test('entradas rotas se ignoran con aviso (rodaja:, sin ":", peso inválido, repetida)', () => {
  const { portions, warnings } = parsePortions('rodaja:|loncha|x:-5|y:abc|vaso:250|Vaso:200|:30');
  assert.deepEqual(portions, [{ nombre: 'vaso', gramos: 250 }]);
  assert.equal(warnings.length, 6);
});

test('acepta coma decimal en los gramos', () => {
  assert.equal(parsePortions('cucharada:13,5').portions[0].gramos, 13.5);
});

test('portionToGrams: exacta sin acentos/mayúsculas, plural y cantidad', () => {
  const food = { porciones: [{ nombre: 'huevo grande', gramos: 50 }, { nombre: 'clara', gramos: 33 }, { nombre: 'Cucharada', gramos: 13.5 }] };
  assert.equal(portionToGrams(food, 'huevo grande'), 50);
  assert.equal(portionToGrams(food, 'Huevos grandes', 2), 100);
  assert.equal(portionToGrams(food, 'cucharadas', 2), 27);
  assert.equal(portionToGrams(food, 'huevo'), 50); // única porción que empieza por "huevo"
  assert.equal(portionToGrams(food, 'plato'), null);
  assert.equal(portionToGrams(food, 'huevo', -1), null);
});

test('portionToGrams: ambigua -> null', () => {
  const food = { porciones: [{ nombre: 'huevo grande', gramos: 50 }, { nombre: 'huevo mediano', gramos: 44 }] };
  assert.equal(portionToGrams(food, 'huevo'), null);
});

test('needsPortion', () => {
  assert.equal(needsPortion({ porciones: [] }), true);
  assert.equal(needsPortion({ porciones: [{ nombre: 'a', gramos: 1 }] }), false);
});
