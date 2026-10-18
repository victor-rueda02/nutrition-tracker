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
  for (const [id, text] of [['pan_blanco_barra', '60 g de pan'], ['pan_blanco_barra', '60 g de barra de pan'], ['jamon_cocido', '30 g de jamón cocido'], ['jamon_cocido', '30 g de jamón york']]) {
    assert.ok(!flagsOf(id, text).includes('sin_alias'), text);
  }
  // pan de barra: el enriquecimiento de EE. UU. vaciado a propósito (sin dato, no 0)
  const pan = byId.get('pan_blanco_barra');
  for (const k of ['vitamina_b9_ug', 'vitamina_b1_mg', 'vitamina_b2_mg', 'vitamina_b3_mg', 'hierro_mg']) assert.equal(pan.nutrients[k], undefined, k);
  assert.equal(pan.extra.fdc_id, '172675');
  assert.equal(byId.get('jamon_cocido').extra.fdc_id, '168295');
});

test('alias: regla de cortes y especies, sin genéricos de especie o de corte', () => {
  const terms = new Set(realFoods.flatMap((f) => [f.nombre, ...f.alias]).map(normalizeText));
  for (const generic of ['pollo', 'pavo', 'pechuga', 'ternera', 'solomillo', 'jamon']) assert.ok(!terms.has(generic), generic);
  assert.deepEqual(byId.get('solomillo_ternera').alias, ['solomillo de ternera']);
});

test('peso_en_crudo (regla general: lo dictado es peso en crudo): cocinar no cambia la fila ni pide confirmación', () => {
  const r1 = (food_id, source_text) => normalizeAiResponse({ items: [{ food_id, cantidad: 150, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'cocinado' }], unmatched: [] }, realList);
  for (const [id, text] of [['arroz_blanco_crudo', '150 g de arroz cocido'], ['pasta_seca', '150 g de macarrones hervidos'], ['salmon_atlantico', '150 g de salmón al horno'],
    ['merluza_cruda', '150 g de merluza a la plancha'], ['patata_cruda', '150 g de patata asada'], ['huevo', '150 g de huevos fritos'], ['calabacin', '150 g de calabacín a la plancha']]) {
    const r = r1(id, text);
    assert.deepEqual([r.items[0].food_id, r.items[0].confidence, r.items[0].flags, r.warnings.length], [id, 'alta', [], 0], text);
  }
});

test('merluza_cocida y patata_asada: se conservan (diario, elegir a mano) pero no viajan a la IA', () => {
  for (const id of ['merluza_cocida', 'patata_asada']) {
    assert.equal(byId.get(id).extra.incluir, 'no', id);
    assert.ok(!realList.some((f) => f.id === id), id);
  }
  // merluza queda con una sola variante en la lista: sin estado no se baja la confianza
  const r = normalizeAiResponse({ items: [{ food_id: 'merluza_cruda', cantidad: 200, unidad: 'g', source_text: '200 g de merluza', confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [] }, realList);
  assert.deepEqual([r.items[0].food_id, r.items[0].confidence], ['merluza_cruda', 'alta']);
});

test('incluir=no: activados mayonesa (con "mahonesa") y chorizo pendiente; el resto de puntuales sigue fuera', () => {
  const m = byId.get('mayonesa');
  assert.deepEqual([m.extra.incluir, m.estado, m.extra.fdc_id], ['si', 'procesado', '171009']);
  assert.ok(!flagsOf('mayonesa', '15 g de mahonesa').includes('sin_alias'));
  for (const id of ['coca_cola', 'tinto_verano', 'ron', 'lengua_cerdo', 'salsa_cerdo_lata', 'salchicha_desayuno_cerdo', 'yogur_griego_vainilla', 'queso_monterey_jack']) {
    assert.equal(byId.get(id).extra.incluir, 'no', id);
  }
});
