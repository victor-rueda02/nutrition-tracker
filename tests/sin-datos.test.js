// Alimentos sin datos nutricionales y platos partidos por la IA. Caso real: «lentejas caseras con chorizo» se resolvió
// a lentejas_caseras (fila sin nutrientes) + chorizo, sin ningún aviso. IA simulada: nunca hay llamadas reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { createDraft, addLine, changeFood } from '../frontend/js/core/draft.js';
import { foodSinDatos, lineasSinDatos, detectarPlatos, tratarComoPlato, lineaAEstimar, deshacerPlato } from '../frontend/js/core/sin-datos.js';
import { diaryReport } from '../frontend/js/core/diary.js';
import { loadTargets, resolveTargets } from '../frontend/js/core/targets.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
// El catálogo real ya trae datos de las lentejas (receta); el caso original, una fila sin ningún nutriente, se reproduce así.
const foods = realFoods.map((f) => (f.id === 'lentejas_caseras' ? { ...f, nutrients: {} } : f));
const byId = new Map(foods.map((f) => [f.id, f]));
const item = (food_id, grams, source_text) => ({ food_id, grams, source_text, confidence: 'alta', flags: [], requiresConfirmation: false });
const draftDe = (text, items, extra = {}) => createDraft({ text, meal: 'comida', result: { items, unmatched: [], warnings: [] }, foodsById: byId, ...extra });
const LENTEJAS = 'lentejas caseras con chorizo';
const itemsLentejas = [item('lentejas_caseras', 200, 'lentejas caseras'), item('chorizo', 30, 'chorizo')];

test('foodSinDatos: ni un nutriente con valor; un 0 escrito sí es dato', () => {
  assert.equal(foodSinDatos(byId.get('lentejas_caseras')), true);
  assert.equal(foodSinDatos(byId.get('chorizo')), false);
  assert.equal(foodSinDatos({ nutrients: {} }), true);
  assert.equal(foodSinDatos({ nutrients: { energia_kcal: 0 } }), false);
  assert.equal(foodSinDatos({}), true);
});

test('«lentejas caseras con chorizo»: la línea de lentejas está sin datos; la de chorizo no', () => {
  const d = draftDe(LENTEJAS, itemsLentejas);
  assert.deepEqual(lineasSinDatos(d, byId), [d.lines[0].key]);
  // también si se elige a mano (no solo lo que resuelve la IA)
  const d2 = addLine(draftDe('x', []), 'lentejas_caseras', 100);
  assert.deepEqual(lineasSinDatos(d2, byId), [d2.lines[0].key]);
  // al cambiar a un alimento con datos, deja de avisar
  assert.deepEqual(lineasSinDatos(changeFood(d2, d2.lines[0].key, 'chorizo'), byId), []);
});

test('el Diario no da por completo un día con un alimento sin datos', () => {
  const comida = { id: 'm1', date: '2026-10-18', meal: 'comida', createdAt: 't', lines: [{ food_id: 'lentejas_caseras', grams: 200 }, { food_id: 'chorizo', grams: 30 }] };
  const rep = diaryReport([comida], byId, resolveTargets(loadTargets(TARGETS, catalog).targets), catalog);
  assert.deepEqual(rep.sinDatos, ['Lentejas caseras']);
  assert.ok(rep.parciales.includes('Lentejas caseras'));
  assert.ok(rep.rows.find((r) => r.clave === 'energia_kcal').parcial);
});

test('un plato partido: «X con Y» (una sola cantidad, o ninguna) se ofrece como plato', () => {
  const d = draftDe(LENTEJAS, itemsLentejas);
  assert.deepEqual(detectarPlatos(d, byId).map((p) => [p.texto, p.keys.length]), [[LENTEJAS, 2]]);
  // con una cantidad sigue siendo un plato; con dos ("170 g de arroz con 2 huevos") son dos alimentos
  const arroz = draftDe('200 g de arroz con chorizo', [item('arroz_blanco_crudo', 200, '200 g de arroz'), item('chorizo', 30, 'chorizo')]);
  assert.equal(arroz.lines.length, 2);
  assert.equal(detectarPlatos(arroz, byId).length, 1);
  const dos = draftDe('170 g de arroz con 2 huevos', [item('arroz_blanco_crudo', 170, '170 g de arroz'), item('huevo', 100, '2 huevos')]);
  assert.deepEqual(detectarPlatos(dos, byId), []);
  const palabras = draftDe('arroz con dos huevos', [item('arroz_blanco_crudo', 170, 'arroz'), item('huevo', 100, 'dos huevos')]);
  assert.deepEqual(detectarPlatos(palabras, byId), []);
  // alimentos de fragmentos distintos no se juntan
  const aparte = draftDe('150 g de arroz, chorizo y aceite', [item('arroz_blanco_crudo', 150, '150 g de arroz'), item('chorizo', 30, 'chorizo'), item('aceite_oliva', 10, 'aceite')]);
  assert.deepEqual(detectarPlatos(aparte, byId), []);
  // dos platos en la misma frase
  const dosPlatos = draftDe(`${LENTEJAS} y arroz con huevo`, [...itemsLentejas, item('arroz_blanco_crudo', 100, 'arroz'), item('huevo', 60, 'huevo')]);
  assert.deepEqual(detectarPlatos(dosPlatos, byId).map((p) => p.texto), [LENTEJAS, 'arroz con huevo']);
});

test('«caseras» se ofrece como plato si la IA lo repartió en varios alimentos; una receta resuelta como una sola línea, no', () => {
  const d = draftDe('lentejas caseras chorizo', itemsLentejas);
  assert.deepEqual(detectarPlatos(d, byId).map((p) => p.texto), ['lentejas caseras chorizo']);
  assert.deepEqual(detectarPlatos(draftDe('lentejas caseras', [item('lentejas_caseras', 200, 'lentejas caseras')]), byId), []);
  assert.deepEqual(detectarPlatos(draftDe('200 g de arroz', [item('arroz_blanco_crudo', 200, '200 g de arroz')]), byId), []);
});

test('no se ofrece al editar una comida guardada ni sobre líneas ya estimadas con IA', () => {
  const d = draftDe(LENTEJAS, itemsLentejas);
  assert.equal(detectarPlatos({ ...d, editing: { id: 'x' } }, byId).length, 0);
  const estimadas = { ...d, lines: d.lines.map((l) => ({ ...l, flags: ['estimado_ia'] })) };
  assert.equal(detectarPlatos(estimadas, byId).length, 0);
  assert.equal(detectarPlatos(draftDe('', itemsLentejas), byId).length, 0);
});

test('tratarComoPlato y deshacerPlato: las líneas pasan a un sin resolver con el fragmento y se pueden recuperar', () => {
  const d = draftDe(`${LENTEJAS} y 10 g de aceite`, [...itemsLentejas, item('aceite_oliva', 10, '10 g de aceite')]);
  const [plato] = detectarPlatos(d, byId);
  const { draft, index } = tratarComoPlato(d, plato);
  assert.deepEqual(draft.lines.map((l) => l.food_id), ['aceite_oliva']);
  assert.deepEqual([draft.unmatched[index].text, draft.unmatched[index].motivo], [LENTEJAS, 'no_en_catalogo']);
  const vuelta = deshacerPlato(draft, index);
  assert.deepEqual(vuelta.lines.map((l) => l.food_id).sort(), ['aceite_oliva', 'chorizo', 'lentejas_caseras']);
  assert.equal(vuelta.unmatched.length, 0);
});

test('lineaAEstimar: una línea sin datos pasa a sin resolver con lo dicho y sus gramos', () => {
  const d = draftDe(LENTEJAS, itemsLentejas);
  const { draft, index } = lineaAEstimar(d, d.lines[0].key, byId);
  assert.equal(draft.unmatched[index].text, '200 g de lentejas caseras');
  assert.deepEqual(draft.lines.map((l) => l.food_id), ['chorizo']);
  assert.equal(deshacerPlato(draft, index).lines.length, 2);
  assert.equal(lineaAEstimar(d, 'no_existe', byId).index, -1);
});

// ---------- interfaz ----------
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-18T11:30:00Z');
const ESTIMACION = { plato: 'lentejas', gramos: 300, total_estimado: true, ajustado: false, warnings: [], model: 'm', ingredientes: [
  { origen: 'catalogo', food_id: 'chorizo', nombre: 'chorizo', gramos: 40 },
  { origen: 'catalogo', food_id: 'aceite_oliva', nombre: 'aceite', gramos: 10 },
] };

async function setup(dictado, { meals = [] } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  const calls = { estimate: [] };
  const createAiClient = () => ({
    async interpretMeal() { return dictado; },
    async estimateDish(a) { calls.estimate.push(a); return structuredClone(ESTIMACION); },
    async usdaSearch() { return { resultados: [] }; },
    async usdaFoods() { return { fichas: [], faltan: [] }; },
    async health() { return { ok: true }; },
  });
  let n = 0;
  const app = mountApp(root, { store, createAiClient, catalog, settings, targets: TARGETS, recetasBase: [], initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn: { endpoint: 'https://w', token: 't' }, now: () => NOW, idGen: () => `m${++n}`, saveFile: async () => 'compartido' });
  await app.whenIdle();
  root.querySelector('button[aria-label="Añadir comida"]').click(); // la app abre en el Diario; el «+» central lleva al dictado
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const act = async (fn) => { fn(); await app.whenIdle(); };
  return { root, store, calls, $, $$, btn, type, act };
}
const dictar = async (t, texto) => { t.type(t.$('textarea'), texto); await t.act(() => t.btn('Procesar').click()); };
const DICTADO = { items: itemsLentejas, unmatched: [], warnings: [], model: 'm' };

test('UI: la línea sin datos se marca «Sin datos nutricionales» con «Estimar con IA» y «Elegir otro alimento»', { skip }, async () => {
  const t = await setup(DICTADO);
  await dictar(t, LENTEJAS);
  const sin = t.$$('li.card[data-key]').filter((c) => /Sin datos nutricionales/.test(c.textContent));
  assert.equal(sin.length, 1);
  assert.match(sin[0].textContent, /Lentejas caseras/);
  const botones = [...sin[0].querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(botones.includes('Estimar con IA') && botones.includes('Elegir otro alimento'), botones.join(' | '));
  assert.doesNotMatch(t.$$('li.card[data-key]').find((c) => /Chorizo/.test(c.textContent)).textContent, /Sin datos nutricionales/);
  // el total no se presenta como completo
  assert.match(t.$('.totals').textContent, /parcial|sin dato/);
});

test('UI: «Elegir otro alimento» cambia la línea y el aviso desaparece', { skip }, async () => {
  const t = await setup(DICTADO);
  await dictar(t, LENTEJAS);
  const card = t.$$('li.card[data-key]').find((c) => /Sin datos nutricionales/.test(c.textContent));
  await t.act(() => [...card.querySelectorAll('button')].find((b) => b.textContent === 'Elegir otro alimento').click());
  t.type(t.$('input[type=search], input[type=text]'), 'aceite');
  await t.act(() => t.$$('button').find((b) => /^Aceite de oliva/.test(b.textContent.trim()))?.click());
  assert.equal(t.$$('li.card[data-key]').filter((c) => /Sin datos nutricionales/.test(c.textContent)).length, 0);
});

test('UI: «Estimar con IA» en la línea sin datos estima el fragmento con sus gramos y deja los ingredientes', { skip }, async () => {
  const t = await setup(DICTADO);
  await dictar(t, LENTEJAS);
  const card = t.$$('li.card[data-key]').find((c) => /Sin datos nutricionales/.test(c.textContent));
  await t.act(() => [...card.querySelectorAll('button')].find((b) => b.textContent === 'Estimar con IA').click());
  assert.equal(t.calls.estimate.length, 1);
  assert.equal(t.calls.estimate[0].texto, '200 g de lentejas caseras');
  assert.match(t.root.textContent, /Estimar con IA/);
});

test('UI: un plato partido ofrece «Tratar como un plato y estimar con IA» (una llamada, con el fragmento dicho)', { skip }, async () => {
  const t = await setup(DICTADO);
  await dictar(t, LENTEJAS);
  assert.equal(t.$$('li.plato').length, 1);
  assert.match(t.$('li.plato').textContent, /lentejas caseras con chorizo/);
  assert.equal(t.calls.estimate.length, 0); // nada se llama solo
  await t.act(() => t.btn('Tratar como un plato y estimar con IA').click());
  assert.equal(t.calls.estimate.length, 1);
  assert.equal(t.calls.estimate[0].texto, LENTEJAS);
});

test('UI: un dictado normal (cantidades y alimentos con datos) no ofrece plato ni avisa de datos', { skip }, async () => {
  const t = await setup({ items: [item('arroz_blanco_crudo', 170, '170 g de arroz'), item('huevo', 100, '2 huevos')], unmatched: [], warnings: [], model: 'm' });
  await dictar(t, '170 g de arroz con 2 huevos');
  assert.equal(t.$$('li.plato').length, 0);
  assert.doesNotMatch(t.root.textContent, /Sin datos nutricionales/);
});

const COMIDA = { id: 'c1', date: '2026-10-18', meal: 'comida', createdAt: '2026-10-18T10:00:00.000Z', text: 'x', lines: [{ food_id: 'lentejas_caseras', grams: 200 }, { food_id: 'chorizo', grams: 30 }] };
const aDiario = async (t) => { await t.act(() => t.$$('button').find((b) => b.textContent.includes('‹ Volver')).click()); };

test('UI: el Diario avisa de los alimentos sin datos y no da el día por completo', { skip }, async () => {
  const t = await setup(DICTADO, { meals: [COMIDA] });
  await aDiario(t);
  assert.match(t.$('[role=alert]').textContent, /Sin datos nutricionales: Lentejas caseras/);
  assert.match(t.root.textContent, /Totales parciales: faltan datos de Lentejas caseras/);
});

test('UI: las etiquetas de macros son «Hidratos» y «Grasa» en el Diario, el anillo y el informe', { skip }, async () => {
  const t = await setup(DICTADO, { meals: [COMIDA] });
  await aDiario(t);
  assert.match(t.root.textContent, /Hidratos/);
  assert.match(t.root.textContent, /Grasa/);
  t.$('button[aria-label="Más opciones del día"]').click();
  await t.act(() => t.btn('Ver informe diario').click());
  assert.match(t.root.textContent, /Hidratos/);
  assert.doesNotMatch(t.root.textContent, /Carbohidratos|Hidratos de carbono|Grasa total/);
});
