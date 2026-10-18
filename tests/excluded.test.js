import test from 'node:test';
import assert from 'node:assert/strict';
import { findExcludedMatches, annotateExcluded, isExcluded } from '../frontend/js/core/excluded.js';
import { realFoods } from './helpers.js';

test('el documento real tiene 14 alimentos excluidos (incluir=no), entre ellos las lentejas', () => {
  assert.equal(realFoods.filter(isExcluded).length, 14);
  assert.ok(realFoods.filter(isExcluded).some((f) => f.id === 'lentejas_caseras'));
});

test('detecta un alimento excluido por nombre o alias, con plural/acentos', () => {
  assert.deepEqual(findExcludedMatches('medio kilo de lentejas', realFoods), ['lentejas_caseras']);
  assert.deepEqual(findExcludedMatches('LENTEJA con arroz', realFoods), ['lentejas_caseras']);
  assert.deepEqual(findExcludedMatches('un plátano', realFoods), []);
  assert.deepEqual(findExcludedMatches('un kiwi', realFoods), []); // incluido: no cuenta
});

test('no confunde palabras parciales ("ron" dentro de "cabrón"/"patrón")', () => {
  assert.deepEqual(findExcludedMatches('un patrón de cabrón', realFoods), []);
});

test('annotateExcluded: "no reconocido" -> excluido_catalogo con candidatos; respeta sin_porcion y los demás', () => {
  const r = annotateExcluded({ items: [], warnings: [], unmatched: [
    { text: 'medio kilo de lentejas', motivo: 'no_en_catalogo' },
    { text: 'un puñado de pistachos', motivo: 'sin_porcion', food_id: 'pistachos_tostados_sin_sal' },
    { text: 'un plátano', motivo: 'no_en_catalogo' },
  ] }, realFoods);
  assert.deepEqual(r.unmatched[0], { text: 'medio kilo de lentejas', motivo: 'excluido_catalogo', candidates: ['lentejas_caseras'] });
  assert.equal(r.unmatched[1].motivo, 'sin_porcion');
  assert.equal(r.unmatched[2].motivo, 'no_en_catalogo');
});
