// Regla «alias más específico» (CLAUDE.md §4, «Lo dicho debe coincidir con el alimento»): lo dicho nombra al alimento
// elegido, pero esa mención queda dentro de un alias más largo de OTRO alimento que también está en lo dicho
// ("pan de molde" elegido como pan de barra). Las respuestas del modelo son SIMULADAS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiResponse } from '../frontend/js/core/ai-validate.js';
import { createDraft, validateDraft, changeFood, confirmFood, setGrams, toMealRecord } from '../frontend/js/core/draft.js';
import { problemsFromResult, newEntry, cleanLog, logToCSV, TIPOS } from '../frontend/js/core/phrase-log.js';
import { termSpans } from '../frontend/js/core/text.js';
import { realFoods, realList } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const line = (food_id, source_text, o = {}) => ({ food_id, cantidad: 100, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'ninguno', ...o });
const one = (food_id, text, list = realList, o = {}) => normalizeAiResponse({ items: [line(food_id, text, o)], unmatched: [] }, list).items[0];
const dispara = (item, otro) => {
  assert.ok(item.flags.includes('alias_mas_especifico'), item.source_text);
  assert.equal(item.mas_especifico, otro);
  assert.equal(item.confidence, 'baja');
  assert.equal(item.requiresConfirmation, true);
  assert.ok(!item.flags.includes('sin_alias'));
};
const limpio = (item) => {
  assert.ok(!item.flags.includes('alias_mas_especifico'), item.source_text);
  assert.equal(item.mas_especifico, undefined);
};

// Catálogo de prueba para lo que aún no está en foods.csv (salteado de verduras asadas llega con otra rama).
const SALTEADOS = [
  { id: 'salteado_verduras', nombre: 'Salteado de verduras', alias: ['salteado de verduras'], estado: 'cocinado', grupo: 'salteado_verduras', defecto: true },
  { id: 'salteado_verduras_asadas', nombre: 'Salteado de verduras asadas', alias: ['salteado de verduras asadas'], estado: 'cocinado', grupo: 'salteado_verduras_asadas', defecto: true },
];

test('termSpans: dónde aparece un término (palabras completas, sin acentos, con plurales)', () => {
  assert.deepEqual(termSpans('60 g de Pan de molde', 'pan'), [[3, 4]]);
  assert.deepEqual(termSpans('pan de molde y pan', 'pan'), [[0, 1], [4, 5]]);
  assert.deepEqual(termSpans('lentejas con chorizo', 'lentejas con chorizo'), [[0, 3]]);
  assert.deepEqual(termSpans('latas de atún', 'lata de atun'), [[0, 3]]);
  assert.deepEqual(termSpans('panadería', 'pan'), []);
  assert.deepEqual(termSpans('pan', ''), []);
});

test('salteado de verduras elegido, pero dijiste «salteado de verduras asadas»', () => {
  dispara(one('salteado_verduras', '200 g de salteado de verduras asadas', SALTEADOS), 'salteado_verduras_asadas');
  dispara(one('salteado_verduras', '200 g de SALTEADO de Verduras Asadas', SALTEADOS), 'salteado_verduras_asadas');
  // El salteado normal, dicho tal cual, y el asado, elegido bien, no avisan.
  limpio(one('salteado_verduras', '200 g de salteado de verduras', SALTEADOS));
  limpio(one('salteado_verduras_asadas', '200 g de salteado de verduras asadas', SALTEADOS));
  limpio(one('salteado_verduras_asadas', '200 g de salteado de verduras', SALTEADOS)); // dijo menos: el elegido es más largo, no hay otro que lo contenga
});

test('pan de molde elegido como pan de barra (catálogo real)', () => {
  dispara(one('pan_blanco_barra', '60 g de pan de molde'), 'pan_molde_blanco');
  dispara(one('pan_blanco_barra', '60 g de pan bimbo'), 'pan_molde_blanco');
  dispara(one('pan_blanco_barra', '60 g de pan integral'), 'pan_integral');
  limpio(one('pan_blanco_barra', '60 g de pan'));
  limpio(one('pan_blanco_barra', '60 g de barra de pan'));
  limpio(one('pan_molde_blanco', '60 g de pan de molde')); // la IA ya eligió el largo: no cambia nada
  limpio(one('pan_integral', '60 g de pan integral'));
  const ok = one('pan_molde_blanco', '60 g de pan de molde');
  assert.deepEqual([ok.food_id, ok.confidence, ok.flags, ok.requiresConfirmation], ['pan_molde_blanco', 'alta', [], false]);
});

test('pechuga de pavo elegida cuando dijiste «en lonchas»', () => {
  dispara(one('pechuga_pavo_cruda', '100 g de pechuga de pavo en lonchas'), 'pavo_fiambre');
  limpio(one('pechuga_pavo_cruda', '100 g de pechuga de pavo'));
  limpio(one('pavo_fiambre', '100 g de pechuga de pavo en lonchas'));
  limpio(one('pavo_fiambre', '100 g de pavo en lonchas'));
});

test('atún elegido cuando dijiste «lata de atún»', () => {
  dispara(one('atun_lata_aceite', '80 g de lata de atún'), 'atun_lata_con_aceite');
  dispara(one('atun_lata_aceite', '80 gramos de la lata de atún'), 'atun_lata_con_aceite');
  limpio(one('atun_lata_con_aceite', 'una lata de atún', realList, { cantidad: 80 }));
  limpio(one('atun_lata_aceite', '80 g de atún'));
  limpio(one('atun_lata_aceite', '80 g de atún en lata'));
});

test('lentejas con chorizo: elegir chorizo (o lentejas) avisa; la receta no', () => {
  dispara(one('chorizo', '300 g de lentejas con chorizo', realList, { cantidad: 300 }), 'lentejas_caseras');
  limpio(one('lentejas_caseras', '300 g de lentejas con chorizo', realList, { cantidad: 300 }));
  limpio(one('chorizo', '30 g de chorizo', realList, { cantidad: 30 }));
  // «lentejas» a secas, con «lentejas con chorizo» en otro alimento del mismo catálogo de prueba.
  const lista = [
    { id: 'lentejas', nombre: 'Lentejas', alias: ['lentejas'], estado: 'crudo', grupo: 'lentejas', defecto: true },
    { id: 'lentejas_chorizo', nombre: 'Lentejas con chorizo', alias: ['lentejas con chorizo'], estado: 'cocinado', grupo: 'lentejas_chorizo', defecto: true },
  ];
  dispara(one('lentejas', '300 g de lentejas con chorizo', lista, { cantidad: 300 }), 'lentejas_chorizo');
});

test('no dispara: variantes del mismo grupo, alimentos fuera de la lista, alias repetido y palabras sueltas', () => {
  // Mismo grupo: lo trata la regla de variantes, no esta.
  const mismoGrupo = [
    { id: 'pan_a', nombre: 'Pan', alias: ['pan'], estado: 'procesado', grupo: 'pan', defecto: true },
    { id: 'pan_b', nombre: 'Pan de molde', alias: ['pan de molde'], estado: 'procesado', grupo: 'pan', defecto: false },
  ];
  limpio(one('pan_a', '60 g de pan de molde', mismoGrupo));
  // incluir=no: no está en la lista compacta que recibe el validador.
  limpio(one('pan_blanco_barra', '60 g de pan de molde', realList.filter((f) => f.id !== 'pan_molde_blanco')));
  // El alias largo también es del propio elegido: ya casa con él.
  const repetido = [
    { id: 'a', nombre: 'A', alias: ['pan', 'pan de molde'], estado: 'procesado', grupo: 'a', defecto: true },
    { id: 'b', nombre: 'B', alias: ['pan de molde'], estado: 'procesado', grupo: 'b', defecto: true },
  ];
  limpio(one('a', '60 g de pan de molde', repetido));
  // Palabras sueltas que no forman el alias completo.
  limpio(one('atun_lata_aceite', '80 g de atún con pan'));
  limpio(one('atun_lata_aceite', '80 g de atún y una lata de maíz'));
  limpio(one('atun_lata_aceite', 'la lata, 80 g de atún'));
  limpio(one('pan_blanco_barra', '60 g de pan de la panadería de molde'));
  limpio(one('pan_blanco_barra', '60 g de pan y 10 g de molde'));
  // Sin alias del elegido en lo dicho: sigue siendo sin_alias, no esta regla.
  const sa = one('pan_blanco_barra', '60 g de pan de molde bimbo', realList.filter((f) => f.id !== 'pan_molde_blanco'));
  assert.ok(!sa.flags.includes('alias_mas_especifico'));
  const sinAlias = one('kiwi_verde', '60 g de pan de molde');
  assert.ok(sinAlias.flags.includes('sin_alias') && !sinAlias.flags.includes('alias_mas_especifico'));
});

test('la regla encaja con las variantes: «tomate frito» y «pollo frito» siguen igual', () => {
  const t = one('salsa_tomate_frito', '70 g de tomate frito', realList, { cantidad: 70, estado_dicho: 'cocinado' });
  assert.deepEqual([t.food_id, t.confidence, t.flags], ['salsa_tomate_frito', 'alta', []]);
  // Con variantes, el aviso se calcula sobre la variante final (la que elige el código).
  const lista = [
    { id: 'pollo_crudo', nombre: 'Pollo crudo', alias: ['pollo'], estado: 'crudo', grupo: 'pollo', defecto: true },
    { id: 'pollo_cocinado', nombre: 'Pollo cocinado', alias: ['pollo'], estado: 'cocinado', grupo: 'pollo', defecto: false },
    { id: 'pollo_curry', nombre: 'Pollo al curry', alias: ['pollo al curry'], estado: 'cocinado', grupo: 'curry', defecto: true },
  ];
  const r = one('pollo_crudo', '200 g de pollo al curry', lista, { cantidad: 200 });
  assert.equal(r.mas_especifico, 'pollo_curry');
  assert.ok(r.flags.includes('alias_mas_especifico'));
});

test('el aviso entra en el borrador y no se guarda hasta confirmarlo o cambiar de alimento', () => {
  const result = normalizeAiResponse({ items: [line('pan_blanco_barra', '60 g de pan de molde', { cantidad: 60 }), line('kiwi_verde', 'un kiwi', { cantidad: 69 })], unmatched: [] }, realList);
  const d = createDraft({ meal: 'comida', result, foodsById: byId });
  const [l1, l2] = d.lines;
  assert.deepEqual([l1.needsReview, l1.masEspecifico, l2.needsReview, l2.masEspecifico], [true, 'pan_molde_blanco', false, null]);
  assert.deepEqual(validateDraft(d).problems, [{ key: l1.key, code: 'sin_revisar' }]);
  assert.throws(() => toMealRecord(d));
  assert.equal(validateDraft(setGrams(d, l1.key, '70')).ok, false); // editar gramos no basta
  const mantenido = confirmFood(d, l1.key);
  assert.equal(validateDraft(mantenido).ok, true);
  assert.equal(mantenido.lines[0].food_id, 'pan_blanco_barra');
  const cambiado = changeFood(d, l1.key, l1.masEspecifico);
  assert.equal(validateDraft(cambiado).ok, true);
  assert.deepEqual([cambiado.lines[0].food_id, cambiado.lines[0].grams, cambiado.lines[0].masEspecifico, cambiado.lines[0].flags], ['pan_molde_blanco', 60, null, []]);
});

test('registro de frases: anota el aviso con el alimento más específico (también en CSV)', () => {
  const result = normalizeAiResponse({ items: [line('pan_blanco_barra', '60 g de pan de molde', { cantidad: 60 })], unmatched: [] }, realList);
  const [p] = problemsFromResult(result);
  assert.deepEqual([p.texto, p.tipo, p.food_id, p.mas_especifico], ['60 g de pan de molde', 'alias_mas_especifico', 'pan_blanco_barra', 'pan_molde_blanco']);
  const e = newEntry({ texto: 'pan de molde', result, idGen: () => 'e1', now: new Date('2026-10-21T09:00:00Z') });
  assert.equal(cleanLog([e]).length, 1);
  assert.equal(TIPOS.alias_mas_especifico, 'Hay un alimento más específico');
  const csv = logToCSV([e], byId);
  assert.match(csv, /Hay un alimento más específico;más específico: Pan de molde blanco;Pan blanco de barra;/);
});

test('tomate frito Hacendado: «tomate frito» es el estilo casero y «con aceite de oliva» es otra fila; el aviso salta al elegir la equivocada; «frito» no es estado', () => {
  const ok = one('salsa_tomate_frito', '70 g de tomate frito', realList, { cantidad: 70 });
  limpio(ok);
  assert.equal(ok.food_id, 'salsa_tomate_frito');
  assert.ok(!ok.flags.includes('variante_no_disponible') && !ok.flags.includes('sin_alias') && !ok.flags.includes('estado_discrepante'));
  const nueva = one('salsa_tomate_frito_oliva', '70 g de tomate frito con aceite de oliva', realList, { cantidad: 70 });
  limpio(nueva);
  assert.equal(nueva.food_id, 'salsa_tomate_frito_oliva');
  dispara(one('salsa_tomate_frito', '70 g de tomate frito con aceite de oliva', realList, { cantidad: 70 }), 'salsa_tomate_frito_oliva');
  assert.notEqual(byId.get('salsa_tomate_frito').grupo, byId.get('salsa_tomate_frito_oliva').grupo);
});

// Optimización del Worker (10 ms de CPU): sameWord y spansIn dan lo mismo que la versión con cadenas.
test('sameWord rápido equivale a la comparación con sufijos y spansIn/termSpans coinciden', async () => {
  const { sameWord, spansIn, words } = await import('../frontend/js/core/text.js');
  const vieja = (a, b) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
  const palabras = ['pan', 'panes', 'pane', 'ore', 'ores', 'or', 'es', 's', 'lentejas', 'lenteja', 'macarron', 'macarrones', 'huevo', 'huevos', 'x', 'atun', 'atunes', 'ao', 'aos', 'aoes', 'lunes', 'lune'];
  for (const a of palabras) for (const b of palabras) assert.equal(sameWord(a, b), vieja(a, b), `${a} ~ ${b}`);
  assert.deepEqual(spansIn(words('Pan de molde y pan'), words('pan')), termSpans('Pan de molde y pan', 'pan'));
});
