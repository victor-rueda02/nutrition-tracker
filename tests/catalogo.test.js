// Decisiones sobre el catálogo real (fixture = copia de data/foods.csv). Las respuestas del modelo son SIMULADAS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiResponse } from '../frontend/js/core/ai-validate.js';
import { normalizeText } from '../frontend/js/core/text.js';
import { realFoods, realList, readFile } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const flagsOf = (food_id, source_text) => normalizeAiResponse({
  items: [{ food_id, cantidad: 100, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [],
}, realList).items[0].flags;

test('el fixture es copia exacta de data/foods.csv', () => {
  assert.equal(readFile('./fixtures/alimentos_iniciales.csv'), readFile('../data/foods.csv'));
});

test('alias: frases que antes no casaban con el alimento ahora sí (sin aviso sin_alias)', () => {
  for (const [id, text] of [
    ['nueces', '100 g de nuez'], // plural irregular
    ['muesli', '50 g de musli'],
    ['corn_flakes', '40 g de cornflakes'],
    ['queso_tierno_loncha', '100 g de lonchas de queso'],
    ['merluza_cruda', '200 g de pescadilla'],
    ['merluza_cocida', '200 g de pescadilla cocida'],
    ['pechuga_pollo_cruda', '150 g de filete de pollo'],
    ['arroz_blanco_crudo', '80 g de arroz largo'],
    ['pan_molde_blanco', '40 g de pan bimbo'],
    ['solomillo_ternera', '150 g de solomillo de ternera'],
    ['jamon_curado', '30 g de jamón serrano'],
  ]) assert.ok(!flagsOf(id, text).includes('sin_alias'), text);
});

test('alias: "pan" es pan blanco de barra (no el integral) y "jamón" a secas no es el curado (también como cocido)', () => {
  assert.ok(flagsOf('pan_integral', '60 g de pan').includes('sin_alias'));
  assert.ok(flagsOf('pan_integral', '60 g de barra de pan').includes('sin_alias'));
  assert.ok(!flagsOf('pan_integral', '60 g de pan integral').includes('sin_alias'));
  assert.ok(flagsOf('jamon_curado', '30 g de jamón cocido').includes('sin_alias'));
});

test('alias: regla de cortes y especies, sin genéricos de especie o de corte', () => {
  const terms = new Set(realFoods.flatMap((f) => [f.nombre, ...f.alias]).map(normalizeText));
  for (const generic of ['pollo', 'pavo', 'pechuga', 'ternera', 'solomillo', 'jamon']) assert.ok(!terms.has(generic), generic);
  assert.deepEqual(byId.get('solomillo_ternera').alias, ['solomillo de ternera']);
});
