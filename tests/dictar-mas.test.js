// «Dictar más» en Confirmar: lo dictado se añade al final del borrador sin tocar lo que había. Lógica pura (appendDictation)
// y UI con jsdom y el modelo simulado (nunca Gemini real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { AiClientError } from '../frontend/js/ai-client.js';
import { createDraft, appendDictation, setGrams, validateDraft } from '../frontend/js/core/draft.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z');
const ITEM = (food_id, grams, source_text, o = {}) => ({ food_id, grams, source_text, confidence: 'alta', flags: [], requiresConfirmation: false, ...o });
const RES = (items = [], unmatched = [], warnings = []) => ({ items, unmatched, warnings, model: 'm' });
const foodsById = new Map(realFoods.map((f) => [f.id, f]));

// ---------- lógica pura ----------
test('appendDictation: añade al final, renumera claves y no toca lo que había', () => {
  let d = createDraft({ text: '80 g de avena', meal: 'desayuno', result: RES([ITEM('avena_copos', 80, '80 g de avena'), ITEM('huevo', 100, '2 huevos')], [{ text: 'un plátano', motivo: 'no_en_catalogo' }], ['aviso viejo']), foodsById });
  d = setGrams(d, 'l1', '90,5');
  const antes = JSON.stringify(d);
  const r = appendDictation(d, { text: '50 g de avena y pan', result: RES([ITEM('avena_copos', 50, '50 g de avena', { flags: ['sin_alias'], confidence: 'baja' })], [{ text: 'pan', motivo: 'ambiguo' }], ['aviso viejo', 'aviso nuevo']), foodsById });
  assert.equal(JSON.stringify(d), antes); // función pura
  assert.deepEqual(r.draft.lines.slice(0, 2), d.lines);
  assert.deepEqual(r.draft.lines.map((l) => [l.key, l.food_id, l.grams]), [['l1', 'avena_copos', 90.5], ['l2', 'huevo', 100], ['l3', 'avena_copos', 50]]); // la repetida es otra línea
  assert.deepEqual(r.lineKeys, ['l3']);
  assert.equal(r.draft.lines[2].needsReview, true);
  assert.deepEqual(r.draft.unmatched.map((u) => u.text), ['un plátano', 'pan']);
  assert.equal(r.unmatchedFrom, 1);
  assert.deepEqual(r.draft.warnings, ['aviso viejo', 'aviso nuevo']);
  assert.equal(r.draft.text, '80 g de avena, 50 g de avena y pan');
  assert.equal(r.draft.meal, 'desayuno');
  assert.equal(r.draft.nextKey, 4);
  assert.equal(validateDraft(r.draft).ok, false); // la línea sin_alias sigue pendiente
});

test('appendDictation: una comida editada conserva id y fecha, y el texto se acumula aunque estuviera vacío', () => {
  const d = { text: '', meal: 'comida', date: '2026-10-15', lines: [], unmatched: [], warnings: [], nextKey: 1, editing: { id: 'r1', createdAt: 'x', date: '2026-10-15' } };
  const r = appendDictation(d, { text: '2 huevos', result: RES([ITEM('huevo', 100, '2 huevos')]), foodsById });
  assert.deepEqual([r.draft.editing.id, r.draft.date, r.draft.text, r.draft.lines[0].key], ['r1', '2026-10-15', '2 huevos', 'l1']);
});

// ---------- UI ----------
async function setup({ respuestas = [], meals = [] } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  const calls = [];
  const cola = [...respuestas];
  const createAiClient = () => ({
    async interpretMeal(args) {
      calls.push(args);
      const next = cola.length > 1 ? cola.shift() : cola[0];
      const v = typeof next === 'function' ? await next() : next;
      if (v instanceof Error) throw v;
      return v;
    },
    async health() { return { ok: true }; },
  });
  const app = mountApp(root, { store, createAiClient, catalog, settings, targets: TARGETS, objetivos: {}, initial: { foods: realFoods, extraHeaders: [], docName: 'doc.csv' }, conn: { endpoint: 'https://w', token: 't' }, now: () => NOW, idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async () => 'compartido' });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const dictar = async (texto) => { $('button[aria-label="Añadir comida"]').click(); await app.whenIdle(); type($('textarea'), texto); await act(() => btn('Procesar').click()); };
  const masTexto = () => $('textarea.dictar-mas');
  return { app, root, store, calls, document, $, $$, btn, type, act, dictar, masTexto };
}

const PRIMERA = RES([ITEM('avena_copos', 80, '80 g de avena'), ITEM('pechuga_pollo_cruda', 150, '150 g de pechuga', { flags: ['sin_alias'], confidence: 'baja' })], [{ text: 'un plátano', motivo: 'no_en_catalogo' }]);
const SEGUNDA = RES([ITEM('huevo', 100, '2 huevos'), ITEM('avena_copos', 50, '50 g de avena')], [{ text: 'pan', motivo: 'ambiguo' }]);

test('Dictar más: abre el campo con foco, vacío no llama, añade al final sin tocar lo que había y cierra el campo', { skip }, async () => {
  const t = await setup({ respuestas: [PRIMERA, SEGUNDA] });
  await t.dictar('80 g de avena, 150 g de pechuga y un plátano');
  assert.equal(t.calls.length, 1);
  t.type(t.$$('input.grams')[0], '90,5'); // gramos editados
  assert.equal(t.btn('Guardar').disabled, true); // sin_alias pendiente
  assert.ok(t.btn('Dictar más'));
  assert.ok(t.btn('Añadir alimento'));
  assert.ok(!t.masTexto());
  await t.act(() => t.btn('Dictar más').click());
  await Promise.resolve();
  assert.ok(t.masTexto());
  assert.equal(t.document.activeElement, t.masTexto());
  assert.equal(t.btn('Interpretar').disabled, true);
  await t.act(() => t.btn('Interpretar').click()); // vacío: no llama
  t.type(t.masTexto(), '   ');
  assert.equal(t.btn('Interpretar').disabled, true);
  assert.equal(t.calls.length, 1);
  t.type(t.masTexto(), '2 huevos, 50 g de avena y pan');
  assert.equal(t.btn('Interpretar').disabled, false);
  await t.act(() => t.btn('Interpretar').click());
  // una sola llamada, con solo la frase nueva y la lista compacta (nunca el borrador)
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].texto, '2 huevos, 50 g de avena y pan');
  assert.deepEqual(Object.keys(t.calls[1]).sort(), ['alimentos', 'texto']);
  // las líneas antiguas siguen igual (gramos editados incluidos) y las nuevas van al final
  assert.deepEqual(t.$$('input.grams').map((i) => i.value), ['90.5', '150', '100', '50']);
  assert.deepEqual(t.$$('li.card[data-key]').map((c) => c.getAttribute('data-key')), ['l1', 'l2', 'l3', 'l4']);
  assert.deepEqual(t.$$('li.card.unmatched').map((c) => c.querySelector('div').textContent), ['«un plátano»', '«pan»']);
  assert.match(t.$('p.dictada').textContent, /80 g de avena, 150 g de pechuga y un plátano, 2 huevos, 50 g de avena y pan/);
  // la línea sin_alias de antes sigue pendiente: no se puede guardar hasta tocarla
  assert.equal(t.btn('Guardar').disabled, true);
  assert.ok(t.btn('Sí, es «Pechuga de pollo sin piel cruda»'));
  // el campo se cierra y se vacía
  assert.ok(!t.masTexto());
  await t.act(() => t.btn('Dictar más').click());
  assert.equal(t.masTexto().value, '');
  await t.act(() => t.btn('Cancelar').click());
  assert.ok(!t.masTexto());
  // tras confirmar la pechuga, se guarda todo: la avena repetida es una línea aparte
  await t.act(() => t.btn('Sí, es «Pechuga de pollo sin piel cruda»').click());
  await t.act(() => t.btn('Guardar').click());
  const [m] = await t.store.allMeals();
  assert.deepEqual(m.lines.map((l) => [l.food_id, l.grams, l.source_text]), [['avena_copos', 90.5, '80 g de avena'], ['pechuga_pollo_cruda', 150, '150 g de pechuga'], ['huevo', 100, '2 huevos'], ['avena_copos', 50, '50 g de avena']]);
  assert.equal(m.meal, 'desayuno');
  // el registro de frases anota las dos frases con problemas y resuelve las dos al guardar
  const log = await t.store.getSetting('registro_frases');
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((e) => e.texto).sort(), ['2 huevos, 50 g de avena y pan', '80 g de avena, 150 g de pechuga y un plátano']);
  assert.ok(log.every((e) => e.problemas.every((p) => p.resolucion !== null)));
  assert.equal(log.find((e) => e.texto.startsWith('2 huevos')).problemas[0].resolucion, 'descartado'); // «pan» se dejó sin resolver
});

test('Dictar más: un 429 muestra el mensaje, conserva el texto y el borrador, y se puede reintentar', { skip }, async () => {
  const t = await setup({ respuestas: [PRIMERA, new AiClientError('limite_de_uso', 'Se ha alcanzado el límite de uso gratuito de la IA. Prueba más tarde o añade a mano.'), SEGUNDA] });
  await t.dictar('80 g de avena');
  const antes = t.$$('li.card[data-key]').map((c) => c.textContent);
  await t.act(() => t.btn('Dictar más').click());
  t.type(t.masTexto(), '2 huevos');
  await t.act(() => t.btn('Interpretar').click());
  assert.match(t.$('.dictar-mas-panel [role=alert]').textContent, /límite de uso gratuito/);
  assert.equal(t.masTexto().value, '2 huevos');
  assert.deepEqual(t.$$('li.card[data-key]').map((c) => c.textContent), antes);
  assert.equal(t.$$('li.card.unmatched').length, 1);
  assert.equal(t.btn('Interpretar').disabled, false);
  assert.equal(t.calls.length, 2);
  await t.act(() => t.btn('Interpretar').click()); // reintento a mano
  assert.equal(t.calls.length, 3);
  assert.equal(t.$$('li.card[data-key]').length, 4);
  assert.ok(!t.$('.dictar-mas-panel'));
});

test('Dictar más: un fallo inesperado (sin red) también se ve, sin perder nada', { skip }, async () => {
  const t = await setup({ respuestas: [PRIMERA, new Error('boom')] });
  await t.dictar('x');
  await t.act(() => t.btn('Dictar más').click());
  t.type(t.masTexto(), 'otra cosa');
  await t.act(() => t.btn('Interpretar').click());
  assert.match(t.$('.dictar-mas-panel [role=alert]').textContent, /Error inesperado: boom/);
  assert.equal(t.masTexto().value, 'otra cosa');
  assert.equal(t.$$('li.card[data-key]').length, 2);
});

test('Dictar más: doble pulsación = una sola llamada; el botón queda desactivado mientras espera', { skip }, async () => {
  let abrir;
  const espera = () => new Promise((res) => { abrir = () => res(SEGUNDA); });
  const t = await setup({ respuestas: [PRIMERA, espera] });
  await t.dictar('x');
  await t.act(() => t.btn('Dictar más').click());
  t.type(t.masTexto(), '2 huevos');
  const b = t.btn('Interpretar');
  b.click();
  const b2 = t.btn('Procesando…');
  assert.ok(b2 && b2.disabled);
  b.click(); b2.click(); // el original ya no está en pantalla y el nuevo está desactivado
  await Promise.resolve();
  assert.equal(t.calls.length, 2);
  assert.equal(t.btn('Guardar').disabled, true);
  abrir();
  await t.app.whenIdle();
  assert.equal(t.calls.length, 2);
  assert.equal(t.$$('li.card[data-key]').length, 4);
});

test('Dictar más al editar una comida pasada: las líneas nuevas se guardan en esa comida y esa fecha', { skip }, async () => {
  const AYER = { id: 'r1', date: '2026-10-15', meal: 'comida', createdAt: '2026-10-15T12:00:00Z', text: '', lines: [{ food_id: 'arroz_blanco_crudo', grams: 150, source_text: '' }, { food_id: 'kiwi_verde', grams: 69, source_text: '' }] };
  const t = await setup({ meals: [AYER], respuestas: [RES([ITEM('huevo', 100, '2 huevos')], [{ text: 'pan', motivo: 'ambiguo' }])] });
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  await t.act(() => t.btn('Editar').click());
  assert.match(t.$('header').textContent, /Editar comida/);
  t.type(t.$$('input.grams')[0], '120');
  await t.act(() => t.btn('Dictar más').click());
  t.type(t.masTexto(), '2 huevos y pan');
  await t.act(() => t.btn('Interpretar').click());
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.$$('input.grams').map((i) => i.value), ['120', '69', '100']);
  assert.equal(t.$('input[aria-label="Fecha"]').value, '2026-10-15');
  await t.act(() => t.btn('Guardar cambios').click());
  const comidas = await t.store.allMeals();
  assert.equal(comidas.length, 1);
  assert.deepEqual([comidas[0].id, comidas[0].date, comidas[0].meal, comidas[0].createdAt], ['r1', '2026-10-15', 'comida', '2026-10-15T12:00:00Z']);
  assert.deepEqual(comidas[0].lines.map((l) => [l.food_id, l.grams]), [['arroz_blanco_crudo', 120], ['kiwi_verde', 69], ['huevo', 100]]);
  const log = await t.store.getSetting('registro_frases');
  assert.equal(log[0].texto, '2 huevos y pan');
  assert.equal(log[0].problemas[0].resolucion, 'descartado');
});

test('Dictar más conserva la comida elegida y no cambia «Añadir alimento»', { skip }, async () => {
  const t = await setup({ respuestas: [PRIMERA, SEGUNDA] });
  await t.dictar('x');
  await t.act(() => t.btn('Cena').click());
  await t.act(() => t.btn('Dictar más').click());
  t.type(t.masTexto(), 'y');
  await t.act(() => t.btn('Interpretar').click());
  assert.equal(t.$$('.chip').find((c) => c.getAttribute('aria-pressed') === 'true').textContent, 'Cena');
  await t.act(() => t.btn('Añadir alimento').click());
  t.type(t.$('.overlay input'), 'huevo');
  await t.act(() => t.$$('.pick')[0].click());
  assert.equal(t.$$('li.card[data-key]').length, 5);
  assert.equal(t.calls.length, 2);
});
