// Navegación (rama estetica): barra inferior Diario · Alimentos · [+] · Más, "+" central directo al dictado,
// hoja del "+" de cada comida, Informe diario, catálogo en Alimentos y la lista de Más (jsdom, IA simulada).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z'); // 09:30 en Madrid -> desayuno
const MEAL = (id, date, meal, lines) => ({ id, date, meal, createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const RESULT = { items: [{ food_id: 'avena_copos', grams: 80, source_text: '80 g de avena', confidence: 'alta', flags: [], requiresConfirmation: false }], unmatched: [], warnings: [], model: 'm' };

async function setup({ meals = [] } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  const app = mountApp(root, {
    store, createAiClient: () => ({ interpretMeal: async () => RESULT }), catalog, settings, targets: TARGETS, objetivos: {},
    initial: { foods: realFoods, extraHeaders: [], docName: 'doc.csv' }, conn: { endpoint: 'https://w', token: 't' }, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async () => 'compartido',
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  return { app, root, store, $, $$, btn, act, type };
}
const nav = (t) => t.$$('nav.tabbar button').map((b) => b.getAttribute('aria-label') ?? b.textContent);

test('abre en el Diario con la barra inferior Diario · Alimentos · [+] · Más', { skip }, async () => {
  const t = await setup();
  assert.ok(t.$('.daylabel'));
  assert.deepEqual(nav(t), ['Diario', 'Alimentos', 'Añadir comida', 'Más']);
  assert.equal(t.$('button.tab.active').textContent, 'Diario');
  // el Diario muestra las cuatro comidas, aunque estén vacías, cada una con su "+"
  assert.deepEqual(t.$$('section.meal strong').map((x) => x.textContent), ['Desayuno', 'Comida', 'Merienda', 'Cena']);
  assert.equal(t.$$('button.meal-add').length, 4);
});

test('el "+" central abre directamente el dictado (comida de la hora) con los accesos rápidos arriba', { skip }, async () => {
  const t = await setup();
  await t.act(() => t.$('button[aria-label="Añadir comida"]').click());
  assert.ok(t.$('textarea'));
  assert.equal(t.$('.chip[aria-pressed="true"]').textContent, 'Desayuno');
  assert.deepEqual(t.$$('.quick-row button').map((b) => b.textContent), ['Añadir a mano', 'Repetir de ayer', 'Plantillas', 'Estimar con IA']);
  // «Estimar con IA» sin texto no gasta nada: avisa
  await t.act(() => t.btn('Estimar con IA').click());
  assert.match(t.$('[role=alert]').textContent, /Añade al menos un alimento/);
  // pantalla completa, sin barra inferior; la X vuelve al Diario
  assert.equal(t.$('nav.tabbar'), null);
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.daylabel'));
  assert.ok(t.$('nav.tabbar'));
});

test('el "+" de una comida abre su hoja y «Dictar comida» la lleva ya elegida y al día que se mira', { skip }, async () => {
  const t = await setup({ meals: [MEAL('a', '2026-10-15', 'comida', [['arroz_blanco_crudo', 100]])] });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  await t.act(() => t.$('button[aria-label="Añadir a cena"]').click());
  const hoja = t.$('[role=dialog]');
  assert.deepEqual([...hoja.querySelectorAll('.sheet-item')].map((b) => b.textContent), ['Dictar comida', 'Añadir a mano', 'Repetir de ayer', 'Plantillas']);
  await t.act(() => t.btn('Dictar comida').click());
  assert.equal(t.$('.chip[aria-pressed="true"]').textContent, 'Cena');
  t.type(t.$('textarea'), '80 g de avena');
  await t.act(() => t.btn('Procesar').click());
  await t.act(() => t.btn('Guardar').click());
  const guardadas = await t.store.allMeals();
  assert.deepEqual(guardadas.filter((m) => m.id !== 'a').map((m) => [m.date, m.meal]), [['2026-10-15', 'cena']]); // en el día que miraba, no en hoy
  assert.equal(t.$('.daylabel').textContent, 'Ayer'); // vuelve al Diario de ese día
});

test('tres puntos: Informe diario con todos los nutrientes y comidas; "‹" vuelve al Diario', { skip }, async () => {
  const t = await setup({ meals: [MEAL('h', '2026-10-16', 'desayuno', [['avena_copos', 80], ['huevo', 100]])] });
  await t.act(() => t.$('button[aria-label="Más opciones del día"]').click());
  assert.deepEqual(t.$$('.popmenu button').map((b) => b.textContent), ['Ver informe diario', 'Copiar día anterior', '¿Qué ceno?']);
  await t.act(() => t.btn('Ver informe diario').click());
  assert.match(t.$('header').textContent, /Informe diario/);
  assert.ok(t.$('li.nut[data-clave="vitamina_b12_ug"]'));
  assert.ok(t.$('li.nut[data-clave="energia_kcal"]'));
  assert.match(t.$('main.informe').textContent, /Comidas del día[\s\S]*Desayuno/);
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.resumen'));
  assert.equal(t.$('li.nut[data-clave="vitamina_b12_ug"]'), null); // el Diario queda con el resumen
});

test('Alimentos: catálogo buscable con filtros; Más: lista con sus cinco apartados', { skip }, async () => {
  const t = await setup();
  await t.act(() => t.btn('Alimentos').click());
  assert.deepEqual(t.$$('.card-link h2').map((x) => x.textContent), ['Mi catálogo', 'Recetas', 'Plantillas']);
  assert.match(t.$$('.card-link').map((x) => x.textContent).join(' '), /\d+ recetas?.*\d+ plantillas?/); // recuentos en las tarjetas
  await t.act(() => t.btn('Ver catálogo').click());
  const total = t.$$('.food-row').length;
  assert.ok(total > 0 && total <= 80);
  t.type(t.$('input[type=search]'), 'avena');
  assert.ok(t.$$('.food-row').length < total);
  assert.match(t.$('.food-list').textContent, /avena/i);
  await t.act(() => t.btn('Excluidos').click());
  assert.ok(t.$$('.food-row').every((r) => /excluido/.test(r.textContent)));
  await t.act(() => t.btn('Más').click());
  assert.deepEqual(t.$$('.menu-row').map((b) => b.textContent), ['Objetivos', 'Documento', 'Copia de seguridad', 'Conexión con la IA', 'Pulir el documento']);
  await t.act(() => t.btn('Conexión con la IA').click());
  assert.ok(t.$('input[type=url]'));
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.menu-list'));
});
