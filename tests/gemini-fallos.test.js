// Regresiones de los tres fallos que destapó Gemini real (CLAUDE.md, sección 6, puntos 1-3).
// Las respuestas del modelo son SIMULADAS: se prueba la capa determinista, no la calidad del modelo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVolumen, toCompact } from '../frontend/js/core/ai-contract.js';
import { normalizeAiResponse, stripNameStates } from '../frontend/js/core/ai-validate.js';
import { createDraft, mlToGrams, resolveUnmatched, lineProblem } from '../frontend/js/core/draft.js';
import { parseFoodsCSV, foodsToCSV, foodsToJSON } from '../frontend/js/core/foods-parser.js';
import { normalizeText } from '../frontend/js/core/text.js';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA } from '../worker/src/prompt.js';
import { realFoods, realList, catalog, csv } from './helpers.js';

const line = (food_id, source_text, o = {}) => ({ food_id, cantidad: 100, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'ninguno', ...o });
const run = (items, list = realList, unmatched = []) => normalizeAiResponse({ items, unmatched }, list);
const one = (item, list) => run([item], list).items[0];
const byId = new Map(realFoods.map((f) => [f.id, f]));
const draftOf = (items) => createDraft({ meal: 'comida', result: run(items), foodsById: byId });

// ---------- 1. "tomate frito": la palabra de estado es parte del nombre ----------
test('tomate frito: "frito" es parte del alias, no un estado (aunque el modelo diga cocinado)', () => {
  for (const [text, estado_dicho] of [['70 g de tomate frito', 'cocinado'], ['70 g de tomate frito', 'ninguno'], ['unos tomates fritos', 'cocinado']]) {
    const r = run([line('salsa_tomate_frito', text, { cantidad: 70, estado_dicho })]);
    assert.equal(r.items[0].food_id, 'salsa_tomate_frito', text);
    assert.equal(r.items[0].confidence, 'alta', text);
    assert.deepEqual(r.items[0].flags, [], text);
    assert.equal(r.items[0].requiresConfirmation, false, text);
    assert.deepEqual(r.warnings, [], text);
  }
});

test('pollo frito: "frito" sí es estado cuando no forma parte del nombre', () => {
  const list = [{ id: 'pollo_crudo', nombre: 'Pollo crudo', alias: ['pollo'], estado: 'crudo', grupo: 'pollo', defecto: true },
    { id: 'pollo_cocinado', nombre: 'Pollo cocinado', alias: ['pollo'], estado: 'cocinado', grupo: 'pollo', defecto: false }];
  const r = one(line('pollo_crudo', '200 g de pollo frito', { estado_dicho: 'cocinado' }), list);
  assert.equal(r.food_id, 'pollo_cocinado');
  assert.equal(r.confidence, 'alta');
  // En el documento real solo hay pechuga cruda: dijo un estado sin variante -> baja y aviso.
  const p = run([line('pechuga_pollo_cruda', '200 g de pechuga de pollo frita', { estado_dicho: 'cocinado' })]);
  assert.equal(p.items[0].food_id, 'pechuga_pollo_cruda');
  assert.equal(p.items[0].confidence, 'baja');
  assert.ok(p.items[0].flags.includes('variante_no_disponible'));
});

test('el estado del propio alimento en su alias sí cuenta ("pistachos crudos", "merluza cruda")', () => {
  const c = one(line('pistachos_crudos', 'pistachos crudos', { estado_dicho: 'crudo' }));
  assert.equal(c.food_id, 'pistachos_crudos');
  assert.equal(c.confidence, 'alta');
  const m = one(line('merluza_cruda', '200 g de merluza cruda', { estado_dicho: 'crudo' }));
  assert.equal(m.food_id, 'merluza_cruda');
  assert.equal(m.confidence, 'alta'); // dijo el estado: no se baja
  assert.equal(stripNameStates('pistachos crudos', byId.get('pistachos_crudos')).states.size, 0);
  assert.deepEqual([...stripNameStates('tomate frito', toCompact(byId.get('salsa_tomate_frito'))).states], ['cocinado']);
});

// ---------- 2. Cortes y especies ----------
test('documento: pechuga de pollo nueva; "pollo", "pavo" y "pechuga" a secas no identifican a ningún alimento', () => {
  const p = byId.get('pechuga_pollo_cruda');
  assert.deepEqual([p.nombre, p.alias, p.estado, p.grupo, p.varianteDefecto], ['Pechuga de pollo sin piel cruda', ['pechuga de pollo'], 'crudo', 'pechuga_pollo', true]);
  assert.equal(p.extra.termino_busqueda_usda, 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw');
  assert.deepEqual(byId.get('muslo_pollo_con_piel').alias, ['muslo de pollo', 'contramuslo']);
  assert.deepEqual(byId.get('pechuga_pavo_cruda').alias, ['pechuga de pavo']);
  const terms = new Set(realList.flatMap((f) => [f.nombre, ...(f.alias ?? [])]).map(normalizeText));
  for (const generic of ['pollo', 'pavo', 'pechuga']) assert.ok(!terms.has(generic), generic);
});

test('prompt: regla de cortes y especies, nombre que no es estado, y volumen en ml', () => {
  for (const s of ['CORTES Y ESPECIES', '"pechuga de pollo" es la pechuga de pollo', '("pollo", "pavo", "pechuga")', 'motivo "ambiguo"', 'Nunca aproximes', 'tomate frito', 'NUNCA conviertas un volumen a gramos']) {
    assert.ok(SYSTEM_PROMPT.includes(s), s);
  }
  const item = RESPONSE_SCHEMA.properties.items.items;
  assert.deepEqual(item.properties.unidad.enum, ['g', 'ml']);
  assert.ok(item.required.includes('cantidad') && item.required.includes('unidad'));
});

// ---------- 3. Mililitros ----------
test('detectVolumen', () => {
  for (const t of ['5 ml de aceite', '200 mililitros de leche', '2 cl', 'medio litro de leche', '0,5 l de leche', '1l']) assert.equal(detectVolumen(t), true, t);
  for (const t of ['5 g de aceite', 'un vaso de leche', '1 lata de atún', 'lentejas', '']) assert.equal(detectVolumen(t), false, t);
});

test('densidad_g_ml: se lee, se valida y se exporta; no viaja a la IA', () => {
  assert.equal(byId.get('aceite_oliva').densidad, 0.91);
  assert.equal(byId.get('leche_entera').densidad, 1.03);
  assert.equal(byId.get('kiwi_verde').densidad, null);
  assert.ok(!JSON.stringify(realList).includes('densidad'));
  assert.ok(!JSON.stringify(realList).includes('0.91'));

  const es = parseFoodsCSV('id;nombre;densidad_g_ml\na;A;0,91\nb;B;\n', { catalog }); // Excel en español
  assert.deepEqual(es.foods.map((f) => f.densidad), [0.91, null]);
  assert.deepEqual(es.report.warnings, []);

  const bad = parseFoodsCSV(csv('id,nombre,densidad_g_ml', 'a,A,mucha', 'b,B,0', 'c,C,910'), { catalog });
  assert.equal(bad.report.ok, true); // un aviso, no un error: el alimento se importa
  assert.deepEqual(bad.foods.map((f) => f.densidad), [null, null, 910]);
  assert.equal(bad.report.warnings.filter((w) => w.field === 'densidad_g_ml').length, 3);

  const again = parseFoodsCSV(foodsToCSV(es.foods, { catalog }), { catalog });
  assert.deepEqual(again.foods.map((f) => f.densidad), [0.91, null]);
  assert.deepEqual(JSON.parse(foodsToJSON(es.foods)).foods.map((f) => f.densidad_g_ml), [0.91, null]);
});

test('worker: un volumen viaja como ml, sin convertir; gramos con un volumen en el texto -> revisar', () => {
  const r = one(line('aceite_oliva', '5 ml de aceite', { cantidad: 5, unidad: 'ml' }));
  assert.equal(r.grams, null);
  assert.equal(r.ml, 5);
  assert.equal(r.confidence, 'alta');
  // el fallo original: el modelo devolvía "5 ml" como 5 g
  const g = one(line('aceite_oliva', '5 ml de aceite', { cantidad: 5, unidad: 'g' }));
  assert.equal(g.grams, 5);
  assert.ok(g.flags.includes('unidad_discrepante'));
  assert.equal(g.requiresConfirmation, true);
  const sinUnidad = one(line('aceite_oliva', 'una cucharada de aceite', { cantidad: 13.5, unidad: undefined }));
  assert.deepEqual([sinUnidad.grams, sinUnidad.ml], [13.5, undefined]);
});

test('app: ml -> g con la densidad del documento; sin densidad -> no reconocido "sin_densidad"', () => {
  assert.equal(mlToGrams(5, 0.91), 4.55);
  const d = draftOf([
    line('aceite_oliva', '5 ml de aceite', { cantidad: 5, unidad: 'ml' }),
    line('leche_entera', '200 ml de leche', { cantidad: 200, unidad: 'ml' }),
    line('kiwi_verde', '100 ml de kiwi', { cantidad: 100, unidad: 'ml' }),
    line('avena_copos', '80 g de avena', { cantidad: 80 }),
  ]);
  assert.deepEqual(d.lines.map((l) => [l.food_id, l.grams]), [['aceite_oliva', 4.55], ['leche_entera', 206], ['avena_copos', 80]]);
  assert.ok(d.lines[0].flags.includes('convertido_ml'));
  assert.ok(!d.lines[2].flags.includes('convertido_ml'));
  assert.deepEqual(d.unmatched, [{ text: '100 ml de kiwi', motivo: 'sin_densidad', food_id: 'kiwi_verde' }]);
  // se resuelve como cualquier otro no reconocido: línea sin gramos para teclearlos
  const r = resolveUnmatched(d, 0, 'kiwi_verde');
  assert.deepEqual([r.lines.at(-1).food_id, r.lines.at(-1).grams], ['kiwi_verde', null]);
});

test('app: más de 2000 g tras convertir ml exige confirmación', () => {
  const d = draftOf([line('leche_entera', '2 litros de leche', { cantidad: 2000, unidad: 'ml' })]);
  assert.equal(d.lines[0].grams, 2060);
  assert.equal(lineProblem(d.lines[0]), 'gramos_altos');
});
