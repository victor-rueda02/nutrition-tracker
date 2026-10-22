import test from 'node:test';
import assert from 'node:assert/strict';
import { findExcludedMatches, annotateExcluded, isExcluded } from '../frontend/js/core/excluded.js';
import { realFoods, foodsConSinDatos } from './helpers.js';

// El catálogo real solo conserva 3 excluidos (variantes cocinadas e ingrediente de receta); los alimentos sin datos que
// había se retiraron, así que las pruebas de "alimento excluido sin datos" usan fixtures/sin_datos.csv (foodsConSinDatos).
test('el documento real tiene 3 alimentos excluidos (incluir=no): dos variantes cocinadas y el morro de cerdo', () => {
  assert.deepEqual(realFoods.filter(isExcluded).map((f) => f.id).sort(), ['merluza_cocida', 'morro_cerdo', 'patata_asada']);
  assert.equal(foodsConSinDatos.filter(isExcluded).length, 3 + 5);
});

test('detecta un alimento excluido por nombre o alias, con plural/acentos', () => {
  assert.deepEqual(findExcludedMatches('medio kilo de crema de prueba', foodsConSinDatos), ['crema_sd']);
  assert.deepEqual(findExcludedMatches('CREMA DE PRUEBA con arroz', foodsConSinDatos), ['crema_sd']);
  assert.deepEqual(findExcludedMatches('un plátano', foodsConSinDatos), []);
  assert.deepEqual(findExcludedMatches('un kiwi', foodsConSinDatos), []); // incluido: no cuenta
  assert.deepEqual(findExcludedMatches('150 g de merluza cocida', realFoods), ['merluza_cocida']); // excluido real
});

test('no confunde palabras parciales ("ron" dentro de "cabrón"/"patrón")', () => {
  assert.deepEqual(findExcludedMatches('un patrón de cabrón', foodsConSinDatos), []);
  assert.deepEqual(findExcludedMatches('un chupito de ron', foodsConSinDatos), ['licor_sd']); // con palabra completa sí
});

test('annotateExcluded: "no reconocido" -> excluido_catalogo con candidatos; respeta sin_porcion y los demás', () => {
  const r = annotateExcluded({ items: [], warnings: [], unmatched: [
    { text: 'medio kilo de crema de prueba', motivo: 'no_en_catalogo' },
    { text: 'un puñado de pistachos', motivo: 'sin_porcion', food_id: 'pistachos_tostados_sin_sal' },
    { text: 'un plátano', motivo: 'no_en_catalogo' },
  ] }, foodsConSinDatos);
  assert.deepEqual(r.unmatched[0], { text: 'medio kilo de crema de prueba', motivo: 'excluido_catalogo', candidates: ['crema_sd'] });
  assert.equal(r.unmatched[1].motivo, 'sin_porcion');
  assert.equal(r.unmatched[2].motivo, 'no_en_catalogo');
});
