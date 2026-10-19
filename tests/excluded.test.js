import test from 'node:test';
import assert from 'node:assert/strict';
import { findExcludedMatches, annotateExcluded, isExcluded } from '../frontend/js/core/excluded.js';
import { realFoods } from './helpers.js';

test('el documento real tiene 14 alimentos excluidos (incluir=no), entre ellos la crema de calabacín', () => {
  assert.equal(realFoods.filter(isExcluded).length, 14);
  assert.ok(realFoods.filter(isExcluded).some((f) => f.id === 'crema_calabacin'));
});

test('detecta un alimento excluido por nombre o alias, con plural/acentos', () => {
  assert.deepEqual(findExcludedMatches('medio kilo de crema de calabacín', realFoods), ['crema_calabacin']);
  assert.deepEqual(findExcludedMatches('CREMA DE CALABACÍN con arroz', realFoods), ['crema_calabacin']);
  assert.deepEqual(findExcludedMatches('un plátano', realFoods), []);
  assert.deepEqual(findExcludedMatches('un kiwi', realFoods), []); // incluido: no cuenta
});

test('no confunde palabras parciales ("ron" dentro de "cabrón"/"patrón")', () => {
  assert.deepEqual(findExcludedMatches('un patrón de cabrón', realFoods), []);
});

test('annotateExcluded: "no reconocido" -> excluido_catalogo con candidatos; respeta sin_porcion y los demás', () => {
  const r = annotateExcluded({ items: [], warnings: [], unmatched: [
    { text: 'medio kilo de crema de calabacín', motivo: 'no_en_catalogo' },
    { text: 'un puñado de pistachos', motivo: 'sin_porcion', food_id: 'pistachos_tostados_sin_sal' },
    { text: 'un plátano', motivo: 'no_en_catalogo' },
  ] }, realFoods);
  assert.deepEqual(r.unmatched[0], { text: 'medio kilo de crema de calabacín', motivo: 'excluido_catalogo', candidates: ['crema_calabacin'] });
  assert.equal(r.unmatched[1].motivo, 'sin_porcion');
  assert.equal(r.unmatched[2].motivo, 'no_en_catalogo');
});
