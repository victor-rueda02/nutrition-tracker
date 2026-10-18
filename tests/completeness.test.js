import test from 'node:test';
import assert from 'node:assert/strict';
import { foodCompleteness, isIncomplete, completenessReport } from '../frontend/js/core/completeness.js';
import { loadSettings } from '../frontend/js/core/settings.js';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { catalog, settings, settingsWarnings, readFile } from './helpers.js';

const req = ['energia_kcal', 'proteina_g', 'hierro_mg', 'zinc_mg', 'vitamina_b12_ug'];
const food = (id, nutrients) => ({ id, nombre: id, nutrients });

test('solo cuentan los obligatorios; los opcionales no suben el porcentaje', () => {
  const c = foodCompleteness(food('a', { energia_kcal: 1, proteina_g: 1, leucina_g: 1, agua_g: 70 }), req);
  assert.equal(c.filled, 2);
  assert.equal(c.total, 5);
  assert.deepEqual(c.missing, ['hierro_mg', 'zinc_mg', 'vitamina_b12_ug']);
});

test('un 0 escrito cuenta como relleno', () => {
  assert.equal(foodCompleteness(food('a', { vitamina_b12_ug: 0 }), req).filled, 1);
});

test('umbral: justo en el 80 % es completo; por debajo, incompleto', () => {
  const four = foodCompleteness(food('a', { energia_kcal: 1, proteina_g: 1, hierro_mg: 1, zinc_mg: 1 }), req);
  const three = foodCompleteness(food('b', { energia_kcal: 1, proteina_g: 1, hierro_mg: 1 }), req);
  assert.equal(isIncomplete(four, 0.8), false);
  assert.equal(isIncomplete(three, 0.8), true);
  assert.equal(isIncomplete(three, 0.5), false);
});

test('informe: pendientes ordenados de menos a más completos', () => {
  const rep = completenessReport(
    [food('b', { energia_kcal: 1 }), food('a', {}), food('c', { energia_kcal: 1, proteina_g: 1, hierro_mg: 1, zinc_mg: 1, vitamina_b12_ug: 1 })],
    { requiredNutrients: req, completenessThreshold: 0.8 });
  assert.deepEqual(rep.incomplete.map((f) => f.id), ['a', 'b']);
  assert.deepEqual(rep.summary, { total: 3, incomplete: 2, complete: 1, threshold: 0.8, requiredCount: 5 });
});

test('sin obligatorios definidos: ratio 1 (no revienta)', () => {
  assert.equal(foodCompleteness(food('a', {}), []).ratio, 1);
});

test('ajustes: claves desconocidas se ignoran con aviso; umbral inválido -> 0.8', () => {
  const { settings: s, warnings } = loadSettings({ completenessThreshold: 80, requiredNutrients: ['hierro_mg', 'hierro_mg', 'inventado_mg'] }, catalog);
  assert.deepEqual(s.requiredNutrients, ['hierro_mg']);
  assert.equal(s.completenessThreshold, 0.8);
  assert.equal(warnings.length, 2);
});

test('data/settings.json: 31 obligatorios, todos existen en el catálogo, umbral 0.8', () => {
  assert.equal(settingsWarnings.length, 0);
  assert.equal(settings.requiredNutrients.length, 31);
  assert.equal(settings.completenessThreshold, 0.8);
  for (const k of ['ala_g', 'epa_g', 'dha_g', 'colina_mg', 'vitamina_b9_ug', 'selenio_ug']) assert.ok(settings.requiredNutrients.includes(k), k);
  assert.ok(!settings.requiredNutrients.includes('leucina_g'));
});

test('fichero de ejemplo: el huevo está completo y el resto aparece como pendiente', () => {
  const { foods } = parseFoodsCSV(readFile('../data/foods.sample.csv'), { catalog });
  const rep = completenessReport(foods, settings);
  assert.equal(rep.perFood.find((f) => f.id === 'huevo_grande').incomplete, false);
  assert.equal(rep.summary.incomplete, 9);
  assert.equal(rep.incomplete[0].ratio <= rep.incomplete.at(-1).ratio, true);
});

test('catálogo real con nutrientes de USDA, BEDCA y recetas: 54 completos; incompletos la chía y los 12 con incluir=no sin datos', () => {
  const { foods } = parseFoodsCSV(readFile('./fixtures/alimentos_iniciales.csv'), { catalog });
  const rep = completenessReport(foods, settings);
  assert.deepEqual([rep.summary.total, rep.summary.complete, rep.summary.incomplete], [67, 54, 13]);
  const chia = rep.perFood.find((p) => p.id === 'semillas_chia');
  assert.deepEqual([chia.filled, chia.incomplete], [23, true]);
  const sinDatos = rep.incomplete.filter((p) => p.filled === 0).map((p) => p.id);
  assert.equal(sinDatos.length, 12);
  assert.ok(foods.filter((f) => sinDatos.includes(f.id)).every((f) => f.extra.incluir === 'no'));
  // pan de molde: enriquecimiento de EE. UU. vaciado a propósito (sin dato, no 0)
  const pan = foods.find((f) => f.id === 'pan_molde_blanco');
  for (const k of ['vitamina_b9_ug', 'vitamina_b1_mg', 'vitamina_b2_mg', 'vitamina_b3_mg', 'hierro_mg']) assert.equal(pan.nutrients[k], undefined, k);
  assert.equal(pan.extra.fdc_id, '174924');
});
