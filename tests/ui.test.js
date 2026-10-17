import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { AiClientError } from '../frontend/js/ai-client.js';
import { realFoods, catalog, settings } from './helpers.js';

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z'); // 09:30 en Madrid

const ITEM = (food_id, grams, source_text, o = {}) => ({ food_id, grams, source_text, confidence: 'alta', flags: [], requiresConfirmation: false, ...o });

async function setup({ responses = [], foods = realFoods, conn = { endpoint: 'https://w', token: 't' }, files } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  const calls = [];
  const queue = [...responses];
  const createAiClient = () => ({
    async interpretMeal(args) {
      calls.push(args);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    async health() { return true; },
  });
  const app = mountApp(root, { store, createAiClient, catalog, settings, initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn, now: () => NOW, idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text() });
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const attach = async (inputEl, file) => { Object.defineProperty(inputEl, 'files', { value: [file] }); inputEl.dispatchEvent(new Event('change', { bubbles: true })); await app.whenIdle(); };
  return { app, root, store, calls, document, $, $$, btn, type, act, attach };
}

const RESULT = { items: [ITEM('avena_copos', 80, '80 g de avena'), ITEM('huevo', 100, '2 huevos', { confidence: 'media', flags: ['variante_por_defecto'] })], unmatched: [{ text: 'un plátano', motivo: 'no_en_catalogo' }], warnings: [], model: 'm' };

test('inicio: dictado grande con foco, comida por defecto de la hora, Procesar desactivado sin texto', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await Promise.resolve();
  assert.equal(t.document.activeElement, t.$('textarea.dictado'));
  assert.equal(t.btn('Procesar').disabled, true);
  assert.equal(t.$$('.chip').find((c) => c.getAttribute('aria-pressed') === 'true').textContent, 'Desayuno');
  t.type(t.$('textarea'), 'hola');
  assert.equal(t.btn('Procesar').disabled, false);
});

test('flujo completo: dictar -> confirmar (editar, borrar) -> guardar; la IA solo recibe la lista compacta', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  t.type(t.$('textarea'), 'para desayunar 80 g de avena, 2 huevos y un plátano');
  await t.act(() => t.btn('Procesar').click());
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].texto, 'para desayunar 80 g de avena, 2 huevos y un plátano');
  assert.equal(t.calls[0].alimentos.length, 49); // sin los incluir=no
  assert.ok(!JSON.stringify(t.calls[0].alimentos).includes('nutrients'));
  assert.ok(!JSON.stringify(t.calls[0].alimentos).includes('densidad')); // la densidad no viaja: la conversión de ml es local
  // confirmación
  assert.equal(t.$$('li.card[data-key]').length, 2);
  assert.match(t.root.textContent, /No dijiste el estado/);
  assert.match(t.root.textContent, /«un plátano»/);
  const grams = t.$$('input.grams');
  assert.equal(grams[0].value, '80');
  t.type(grams[0], '90,5');
  t.type(grams[1], '');
  assert.equal(t.btn('Guardar').disabled, true);          // línea sin gramos
  t.type(grams[1], '100');
  assert.equal(t.btn('Guardar').disabled, false);
  assert.match(t.root.textContent, /sin dato de kcal/);   // el documento aún no trae nutrientes
  await t.act(() => t.$$('button[aria-label^="Borrar"]')[1].click());
  assert.equal(t.$$('li.card[data-key]').length, 1);
  await t.act(() => t.btn('Guardar').click());
  const meals = await t.store.allMeals();
  assert.deepEqual(meals, [{ id: 'm1', date: '2026-10-16', meal: 'desayuno', createdAt: NOW.toISOString(), text: 'para desayunar 80 g de avena, 2 huevos y un plátano', lines: [{ food_id: 'avena_copos', grams: 90.5, source_text: '80 g de avena' }] }]);
  assert.match(t.$('[role=status]').textContent, /Guardado en desayuno: 1 alimento/);
  assert.equal(t.$('textarea').value, '');
});

test('más de 2000 g: hay que confirmar la cantidad antes de guardar', { skip }, async () => {
  const t = await setup({ responses: [{ ...RESULT, items: [ITEM('leche_entera', 2500, '2500 g de leche', { flags: ['gramos_altos'] })], unmatched: [] }] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  assert.equal(t.btn('Guardar').disabled, true);
  const check = t.$('label.high input[type=checkbox]');
  check.checked = true; check.dispatchEvent(new t.document.defaultView.Event('change', { bubbles: true }));
  assert.equal(t.btn('Guardar').disabled, false);
});

test('cambiar alimento con el buscador del documento (sin acentos ni plurales)', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  await t.act(() => t.$('button.name').click());
  assert.ok(t.$('.overlay'));
  t.type(t.$('.overlay input'), 'KIWIS');
  await t.act(() => t.$('.pick').click());
  assert.equal(t.$('.overlay'), null);
  assert.match(t.$('li.card[data-key] button.name').textContent, /kiwi/i);
  assert.equal(t.$('li.card[data-key] input.grams').value, '80'); // conserva los gramos
});

test('alimento excluido (incluir=no): motivo claro, se activa con un toque y se reinterpreta la frase', { skip }, async () => {
  const lentejas = realFoods.find((f) => f.id === 'lentejas_caseras');
  const first = { items: [ITEM('kiwi_verde', 69, 'un kiwi')], unmatched: [{ text: 'medio kilo de lentejas', motivo: 'no_en_catalogo' }], warnings: [] };
  const second = { items: [ITEM('kiwi_verde', 69, 'un kiwi'), ITEM('lentejas_caseras', 500, 'medio kilo de lentejas')], unmatched: [], warnings: [] };
  const t = await setup({ responses: [first, second] });
  t.type(t.$('textarea'), 'medio kilo de lentejas y un kiwi');
  await t.act(() => t.btn('Procesar').click());
  assert.match(t.root.textContent, /Excluido del catálogo \(incluir=no\)/);
  await t.act(() => t.btn(`Activar «${lentejas.nombre}»`).click());
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0].alimentos.some((f) => f.id === 'lentejas_caseras'), false);
  assert.equal(t.calls[1].alimentos.some((f) => f.id === 'lentejas_caseras'), true);
  assert.deepEqual(t.$$('li.card[data-key] input.grams').map((i) => i.value), ['69', '500']);
  assert.equal((await t.store.getCatalogRecord()).foods.find((f) => f.id === 'lentejas_caseras').extra.incluir, 'si');
});

test('sin_porcion: "Poner gramos" añade la línea vacía y no se guarda hasta teclear los gramos', { skip }, async () => {
  const t = await setup({ responses: [{ items: [], unmatched: [{ text: 'un puñado de pistachos', motivo: 'sin_porcion', food_id: 'pistachos_tostados_sin_sal' }], warnings: [] }] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  assert.match(t.root.textContent, /Falta la cantidad en gramos/);
  await t.act(() => t.btn('Poner gramos de').click());
  assert.equal(t.btn('Guardar').disabled, true);
  t.type(t.$('input.grams'), '30');
  assert.equal(t.btn('Guardar').disabled, false);
});

test('error de la IA: mensaje claro, el texto dictado se conserva y se puede añadir a mano sin conexión', { skip }, async () => {
  const t = await setup({ responses: [new AiClientError('sin_conexion', 'Sin conexión: la IA necesita internet. Puedes añadir los alimentos a mano.')] });
  t.type(t.$('textarea'), 'dos huevos');
  await t.act(() => t.btn('Procesar').click());
  assert.match(t.$('[role=alert]').textContent, /Sin conexión/);
  assert.equal(t.$('textarea').value, 'dos huevos');
  assert.equal(t.btn('Procesar').disabled, false);
  await t.act(() => t.btn('Añadir a mano').click());
  assert.equal(t.$$('li.card[data-key]').length, 0);
  assert.equal(t.btn('Guardar').disabled, true);
  await t.act(() => t.btn('+ Añadir alimento').click());
  t.type(t.$('.overlay input'), 'huevo');
  await t.act(() => t.$('.pick').click());
  t.type(t.$('input.grams'), '100');
  await t.act(() => t.btn('Guardar').click());
  assert.equal((await t.store.allMeals())[0].lines[0].grams, 100);
});

test('importar documento: guarda directamente si no hay errores y muestra el informe', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await t.act(() => t.btn('Documento').click());
  const csv = 'id,nombre,marca,proteina_g\na,Alimento A,X,10\nb,Alimento B,Y,\n';
  await t.attach(t.$('input[type=file]'), { name: 'mis_alimentos.csv', text: async () => csv });
  assert.match(t.$('.report').textContent, /Importado «mis_alimentos.csv»: 2 alimentos/);
  assert.match(t.$('.report').textContent, /cabecera desconocida "marca"/);
  const rec = await t.store.getCatalogRecord();
  assert.deepEqual([rec.foods.length, rec.name, rec.extraHeaders], [2, 'mis_alimentos.csv', ['marca']]);
});

test('importar con errores: pide confirmación y solo importa las filas válidas', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await t.act(() => t.btn('Documento').click());
  await t.attach(t.$('input[type=file]'), { name: 'x.csv', text: async () => 'id,nombre\na,A\na,Repetido\n' });
  assert.match(t.$('.report').textContent, /1 alimentos válidos, 1 filas con error/);
  assert.match(t.$('.report').textContent, /id duplicado/);
  assert.equal(await t.store.getCatalogRecord(), null);          // aún no se ha aplicado
  await t.act(() => t.btn('Importar 1 alimentos válidos').click());
  assert.equal((await t.store.getCatalogRecord()).foods.length, 1);
});

test('documento inservible (falta nombre): no se puede importar y no se toca el actual', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await t.act(() => t.btn('Documento').click());
  await t.attach(t.$('input[type=file]'), { name: 'mal.csv', text: async () => 'id,alias\na,x\n' });
  assert.match(t.$('.report').textContent, /No se puede importar «mal.csv»/);
  assert.match(t.$('.report').textContent, /falta la columna obligatoria "nombre"/);
  assert.equal(await t.store.getCatalogRecord(), null);
});

test('seguridad: el texto de un documento nunca se interpreta como HTML', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await t.act(() => t.btn('Documento').click());
  await t.attach(t.$('input[type=file]'), { name: 'x.csv', text: async () => 'id,nombre\na,"<img src=x onerror=alert(1)><b>negrita</b>"\n' });
  await t.act(() => t.btn('Volver').click());
  await t.act(() => t.btn('Añadir a mano').click());
  await t.act(() => t.btn('+ Añadir alimento').click());
  assert.equal(t.$('.overlay img'), null);
  assert.equal(t.$('.overlay b'), null);
  assert.match(t.$('.overlay .pick').textContent, /<img src=x onerror=alert\(1\)>/);
});

test('conexión: se guarda el Worker y el token (no van en el repositorio)', { skip }, async () => {
  const t = await setup({ responses: [RESULT], conn: {} });
  await t.act(() => t.btn('Documento').click());
  t.$('input[type=url]').value = 'https://w.example';
  t.$('input[type=password]').value = 'secreto';
  await t.act(() => t.btn('Guardar').click());
  assert.deepEqual(await t.store.getSetting('conn'), { endpoint: 'https://w.example', token: 'secreto' });
  await t.act(() => t.btn('Probar').click());
  assert.match(t.root.textContent, /El Worker responde/);
});

test('Hoy: lista lo guardado hoy por comida', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  await t.act(() => t.btn('Guardar').click());
  await t.act(() => t.btn('Hoy').click());
  assert.match(t.root.textContent, /Desayuno/);
  assert.match(t.root.textContent, /80 g/);
});
