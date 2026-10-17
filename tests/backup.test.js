// Hito 4, paso 3: copia de seguridad del diario y exportación del documento.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, backupToJSON, parseBackup, planImport, mealError, tieneObjetivos, BACKUP_KIND } from '../frontend/js/core/backup.js';
import { parseFoodsCSV, foodsToCSV } from '../frontend/js/core/foods-parser.js';
import { catalog, realFoods, readFile } from './helpers.js';

const M = (id, o = {}) => ({ id, date: '2026-10-15', meal: 'comida', createdAt: '2026-10-15T12:00:00.000Z', text: 'frase', lines: [{ food_id: 'arroz_blanco_crudo', grams: 150, source_text: '150 g de arroz' }], ...o });

test('copia del diario: ida y vuelta sin pérdidas; lleva los objetivos y nunca la conexión', () => {
  const meals = [M('a'), M('b', { meal: 'cena', updatedAt: '2026-10-16T08:00:00.000Z' })];
  const objetivos = { perfil: 'hombre', valores: { energia_kcal: 2500 } };
  const json = backupToJSON(buildBackup({ meals, objetivos, now: new Date('2026-10-17T10:00:00Z') }));
  const data = JSON.parse(json);
  assert.equal(data.tipo, BACKUP_KIND);
  assert.equal(data.exportedAt, '2026-10-17T10:00:00.000Z');
  assert.ok(!json.includes('token') && !json.includes('endpoint'));
  const r = parseBackup(json);
  assert.deepEqual([r.ok, r.meals, r.errors, r.objetivos], [true, meals, [], objetivos]);
});

test('parseBackup: fichero que no es una copia, de una versión más nueva o JSON roto', () => {
  assert.match(parseBackup('{').error, /No es un JSON válido/);
  assert.match(parseBackup('{"foods": []}').error, /No es una copia del diario/);
  assert.match(parseBackup(JSON.stringify({ tipo: BACKUP_KIND, formatVersion: 99, comidas: [] })).error, /versión más nueva/);
  assert.equal(parseBackup(`﻿${JSON.stringify([M('a')])}`).meals.length, 1); // una lista suelta de comidas también vale
});

test('parseBackup: las comidas inválidas se informan y no se importan; los campos desconocidos se quitan', () => {
  const lista = [M('ok', { extra: 'x', lines: [{ food_id: 'kiwi_verde', grams: 69, otra: 1 }] }), M('', {}), M('f', { date: '2026-02-30' }), M('m', { meal: 'brunch' }),
    M('l', { lines: [] }), M('g', { lines: [{ food_id: 'kiwi_verde', grams: 0 }] }), M('ok'), M('c', { createdAt: 'ayer' })];
  const r = parseBackup(JSON.stringify(buildBackup({ meals: lista })));
  assert.deepEqual(r.meals, [{ id: 'ok', date: '2026-10-15', meal: 'comida', createdAt: '2026-10-15T12:00:00.000Z', text: 'frase', lines: [{ food_id: 'kiwi_verde', grams: 69, source_text: '' }] }]);
  assert.deepEqual(r.errors.map((e) => [e.index, e.message]), [[1, 'falta el id'], [2, 'fecha no válida "2026-02-30"'], [3, 'comida no válida "brunch"'], [4, 'sin alimentos'], [5, 'gramos no válidos en kiwi_verde'], [6, 'id repetido en la copia'], [7, 'falta createdAt']]);
  assert.equal(mealError(M('x')), null);
  assert.equal(r.objetivos, null);
});

test('importar fusiona por id: nuevas, iguales, más recientes y más antiguas; nunca borra', () => {
  const existentes = [M('igual'), M('vieja'), M('nueva-aqui', { updatedAt: '2026-10-16T09:00:00.000Z', meal: 'cena' }), M('solo-aqui')];
  const copia = [M('igual'), M('vieja', { updatedAt: '2026-10-16T09:00:00.000Z', lines: [{ food_id: 'huevo', grams: 100, source_text: '' }] }),
    M('nueva-aqui', { meal: 'otro' }), M('nueva')];
  const plan = planImport(existentes, copia);
  assert.deepEqual([plan.nuevas, plan.actualizadas, plan.iguales, plan.masAntiguas].map((l) => l.map((m) => m.id)), [['nueva'], ['vieja'], ['igual'], ['nueva-aqui']]);
  assert.deepEqual(plan.escribir.map((m) => m.id), ['nueva', 'vieja']);
  assert.ok(!plan.escribir.some((m) => m.id === 'solo-aqui'));
  // importar dos veces la misma copia no cambia nada
  const despues = [...existentes.filter((m) => !plan.escribir.some((w) => w.id === m.id)), ...plan.escribir];
  assert.deepEqual(planImport(despues, copia).escribir, []);
});

test('tieneObjetivos: si los guardaste alguna vez, una copia no los pisa', () => {
  assert.equal(tieneObjetivos(undefined), false);
  assert.equal(tieneObjetivos({}), false);
  assert.equal(tieneObjetivos({ perfil: 'mujer', valores: {} }), true);
  assert.equal(tieneObjetivos({ valores: { proteina_g: 150 } }), true);
});

test('documento para Excel en español: punto y coma, coma decimal y BOM; se vuelve a importar igual', () => {
  const { foods, extraHeaders } = parseFoodsCSV(readFile('./fixtures/alimentos_iniciales.csv'), { catalog });
  const excel = foodsToCSV(foods, { catalog, extraHeaders, delimiter: ';', decimalComma: true });
  assert.ok(excel.startsWith('﻿id;nombre;alias;'));
  const aceite = excel.split('\n').find((l) => l.startsWith('aceite_oliva;'));
  assert.match(aceite, /;0,91;/); // densidad con coma decimal
  assert.match(aceite, /;884;/);
  const again = parseFoodsCSV(excel, { catalog });
  assert.equal(again.report.ok, true);
  assert.deepEqual(again.report.warnings, []);
  assert.deepEqual(again.foods, foods);
  // y con comas (el formato de data/foods.csv)
  const comas = foodsToCSV(realFoods, { catalog, extraHeaders });
  assert.ok(comas.startsWith('﻿id,nombre,alias,'));
  assert.deepEqual(parseFoodsCSV(comas, { catalog }).foods, realFoods);
});
