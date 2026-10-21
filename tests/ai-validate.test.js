import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactList, detectEstado, toCompact } from '../frontend/js/core/ai-contract.js';
import { normalizeAiResponse, parseModelJson, checkStructure } from '../frontend/js/core/ai-validate.js';
import { realFoods, realList, rulesList, catalog } from './helpers.js';

// Una línea dictada tal y como la devolvería el modelo.
const line = (food_id, source_text, o = {}) => ({ food_id, cantidad: 100, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'ninguno', ...o });
// Las reglas se prueban sobre la copia congelada del catálogo (grupos merluza y patata con variante cocinada).
const run = (items, list = rulesList, unmatched = []) => normalizeAiResponse({ items, unmatched }, list);
const one = (item, list) => run([item], list).items[0];

// ---------- lista compacta ----------
test('lista compacta: sin los alimentos incluir=no y sin nutrientes', () => {
  const foods = [{ id: 'a', nombre: 'A', alias: ['x'], porciones: [{ nombre: 'p', gramos: 5 }], estado: 'crudo', grupo: 'g', varianteDefecto: true, nutrients: { proteina_g: 12.5, energia_kcal: 777 }, extra: {} },
    { id: 'b', nombre: 'B', alias: [], porciones: [], estado: '', grupo: '', varianteDefecto: null, nutrients: {}, extra: { incluir: 'no' } }];
  const list = buildCompactList(foods);
  assert.deepEqual(list.map((f) => f.id), ['a']);
  const text = JSON.stringify(list);
  for (const leak of ['proteina_g', 'energia_kcal', '12.5', '777', 'nutrients']) assert.ok(!text.includes(leak), leak);
  assert.deepEqual(list[0], { id: 'a', nombre: 'A', alias: ['x'], porciones: [{ nombre: 'p', gramos: 5 }], estado: 'crudo', grupo: 'g', defecto: true });
  assert.equal(buildCompactList(foods, { includeExcluded: true }).length, 2);
});

test('lista compacta del documento real: 58 de 72 (14 con incluir=no fuera) y ningún nutriente', () => {
  assert.equal(realFoods.length, 72);
  assert.equal(realList.length, 58);
  assert.ok(!realList.some((f) => f.id === 'ron' || f.id === 'crema_calabacin'));
  const text = JSON.stringify(realList);
  for (const k of catalog.keys) assert.ok(!text.includes(k), k);
});

// ---------- estado dicho ----------
test('detectEstado: cocinado, crudo, tostado, nada y ambiguo', () => {
  for (const t of ['arroz cocido', 'merluza cocida', 'patata asada', 'verdura asadas', 'pollo hervido', 'pescado a la plancha', 'pollo al horno', 'patatas fritas', 'calabacín al vapor']) assert.equal(detectEstado(t), 'cocinado', t);
  assert.equal(detectEstado('merluza CRUDA'), 'crudo');
  assert.equal(detectEstado('pistachos tostados'), 'tostado');
  assert.equal(detectEstado('2 huevos'), null);
  assert.equal(detectEstado('arroz crudo o cocido'), null);
  assert.equal(detectEstado(''), null);
});

// ---------- reglas de variantes (petición de Victor) ----------
test('una sola variante y sin estado: no se baja la confianza', () => {
  const r = one(line('kiwi_verde', 'un kiwi', { cantidad: 69 })); // 1 porción "unidad"
  assert.equal(r.food_id, 'kiwi_verde');
  assert.equal(r.confidence, 'alta');
  assert.deepEqual(r.flags, []);
  assert.equal(one(line('huevo', '2 huevos', { confidence: 'media' })).confidence, 'media');
});

test('varias variantes y sin estado: variante por defecto (crudo) y confianza -1 nivel', () => {
  const r = one(line('merluza_cruda', '200 g de merluza'));
  assert.equal(r.food_id, 'merluza_cruda');
  assert.equal(r.confidence, 'media');
  assert.ok(r.flags.includes('variante_por_defecto'));
  assert.equal(one(line('patata_cruda', '200 g de patatas', { confidence: 'media' })).confidence, 'baja');
  assert.equal(one(line('patata_cruda', '200 g de patatas', { confidence: 'baja' })).confidence, 'baja');
});

test('si el modelo elige la cocinada pero no lo dije: se corrige a la de defecto', () => {
  const r = one(line('merluza_cocida', '200 g de merluza'));
  assert.equal(r.food_id, 'merluza_cruda');
  assert.equal(r.confidence, 'media');
  assert.ok(r.flags.includes('variante_cambiada'));
});

test('digo cocido/asado/plancha: variante cocinada y confianza sin cambios', () => {
  for (const [food, text] of [['merluza_cruda', '200 g de merluza cocida'], ['merluza_cruda', '200 g de merluza a la plancha'], ['patata_cruda', '200 g de patata asada'], ['patata_cruda', '200 g de patatas hervidas']]) {
    const r = one(line(food, text, { estado_dicho: 'cocinado' }));
    assert.equal(r.food_id, food.replace('cruda', food.startsWith('merluza') ? 'cocida' : 'asada'), text);
    assert.equal(r.confidence, 'alta', text);
  }
});

test('digo crudo y el modelo eligió la cocinada: se corrige a crudo sin bajar confianza', () => {
  const r = one(line('merluza_cocida', '200 g de merluza cruda', { estado_dicho: 'crudo' }));
  assert.equal(r.food_id, 'merluza_cruda');
  assert.equal(r.confidence, 'alta');
});

test('pistachos: por defecto los tostados sin sal; crudos solo si lo digo', () => {
  const t = one(line('pistachos_crudos', '30 g de pistachos tostados', { estado_dicho: 'tostado' }));
  assert.equal(t.food_id, 'pistachos_tostados_sin_sal');
  assert.equal(t.confidence, 'alta');
  const d = one(line('pistachos_crudos', '30 g de pistachos'));
  assert.equal(d.food_id, 'pistachos_tostados_sin_sal');
  assert.equal(d.confidence, 'media');
  assert.ok(d.flags.includes('variante_cambiada'));
  const c = one(line('pistachos_tostados_sin_sal', '30 g de pistachos crudos', { estado_dicho: 'crudo' }));
  assert.equal(c.food_id, 'pistachos_crudos');
  assert.equal(c.confidence, 'alta');
});

test('digo un estado que no existe en el documento: confianza baja y aviso', () => {
  const arroz = run([line('arroz_blanco_crudo', '150 g de arroz cocido', { estado_dicho: 'cocinado' })]);
  assert.equal(arroz.items[0].food_id, 'arroz_blanco_crudo');
  assert.equal(arroz.items[0].confidence, 'baja');
  assert.ok(arroz.items[0].flags.includes('variante_no_disponible'));
  assert.equal(arroz.items[0].requiresConfirmation, true);
  assert.equal(arroz.warnings.length, 1);
  const kiwi = one(line('kiwi_verde', 'un kiwi asado', { cantidad: 69, estado_dicho: 'cocinado' }));
  assert.equal(kiwi.confidence, 'baja');
});

test('el modelo dice un estado que no consta en su fragmento: se ignora, baja y se marca la discrepancia', () => {
  const r = one(line('merluza_cocida', '200 g de merluza', { estado_dicho: 'cocinado' }));
  assert.equal(r.food_id, 'merluza_cruda');
  assert.equal(r.confidence, 'baja');
  assert.ok(r.flags.includes('estado_discrepante'));
});

test('grupo con varias variantes y ninguna por defecto: respeta al modelo, confianza -1 y aviso', () => {
  const list = [{ id: 'a_crudo', nombre: 'A', grupo: 'a', estado: 'crudo', defecto: false }, { id: 'a_cocido', nombre: 'A', grupo: 'a', estado: 'cocinado', defecto: false }];
  const r = run([line('a_cocido', '100 g de a')], list);
  assert.equal(r.items[0].food_id, 'a_cocido');
  assert.equal(r.items[0].confidence, 'media');
  assert.ok(r.items[0].flags.includes('sin_variante_por_defecto'));
  assert.equal(r.warnings.length, 1);
});

// ---------- validación de la respuesta ----------
test('food_id inexistente: descartado y pasa a no reconocido', () => {
  const r = run([line('plátano_inventado', 'un plátano'), line('kiwi_verde', 'un kiwi', { cantidad: 69 })]);
  assert.deepEqual(r.items.map((i) => i.food_id), ['kiwi_verde']);
  assert.deepEqual(r.unmatched, [{ text: 'un plátano', motivo: 'no_en_catalogo' }]);
  assert.equal(r.warnings.length, 1);
});

test('gramos negativos, cero, texto o nulos: rechazados (no se guardan como línea)', () => {
  for (const grams of [-5, 0, '80', null, undefined, Infinity]) {
    const r = run([line('kiwi_verde', 'kiwi', { cantidad: grams })]);
    assert.equal(r.items.length, 0, String(grams));
    assert.equal(r.unmatched[0].food_id, 'kiwi_verde');
  }
});

test('más de 2000 g por línea: se conserva pero exige confirmación', () => {
  const r = run([line('leche_entera', '2500 g de leche', { cantidad: 2500 })]);
  assert.equal(r.items[0].grams, 2500);
  assert.ok(r.items[0].flags.includes('gramos_altos'));
  assert.equal(r.items[0].requiresConfirmation, true);
  assert.equal(run([line('leche_entera', 'leche', { cantidad: 2000 })]).items[0].flags.includes('gramos_altos'), false);
});

test('confianza inválida -> baja; unmatched se normaliza', () => {
  assert.equal(one(line('kiwi_verde', '100 g de kiwi', { confidence: 'altísima' })).confidence, 'baja');
  const r = run([], realList, [{ text: ' un puñado de pistachos ', motivo: 'sin_porcion', food_id: 'pistachos_crudos' }, { text: 'x', motivo: 'rarisimo', food_id: 'no_existe' }, { text: '' }, null]);
  assert.deepEqual(r.unmatched, [{ text: 'un puñado de pistachos', motivo: 'sin_porcion', food_id: 'pistachos_crudos' }, { text: 'x', motivo: 'no_en_catalogo' }]);
});

test('parseModelJson y checkStructure', () => {
  assert.equal(parseModelJson('{"items":[],"unmatched":[]}').ok, true);
  assert.equal(parseModelJson('```json\n{"items":[],"unmatched":[]}\n```').ok, true);
  assert.equal(parseModelJson('Claro, aquí tienes: {').ok, false);
  assert.equal(checkStructure({ items: [], unmatched: [] }).ok, true);
  assert.equal(checkStructure({ items: [] }).ok, false);
  assert.equal(checkStructure([]).ok, false);
  assert.equal(checkStructure(null).ok, false);
});

test('toCompact: sin grupo no lleva "defecto"', () => {
  assert.deepEqual(toCompact({ id: 'a', nombre: 'A', alias: [], porciones: [], estado: '', grupo: '' }), { id: 'a', nombre: 'A' });
});
