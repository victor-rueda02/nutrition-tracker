// Detalle de alimento y de nutriente (jsdom): desde Mi catálogo y desde el Diario, cantidad, porciones, «Guardar» de una línea,
// sin dato frente a 0, detalle de un nutriente, «Volver» con la misma cantidad y la entrada sin información.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const INFO = JSON.parse(readFile('./fixtures/nutrientes-info.fixture.json'));
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z');
const MEAL = (id, date, meal, lines) => ({ id, date, meal, createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });

async function setup({ meals = [], foods = realFoods, info = INFO } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  const app = mountApp(root, {
    store, createAiClient: () => { throw new Error('sin IA en estos tests'); }, catalog, settings, targets: TARGETS, objetivos: {}, nutrientesInfo: info,
    initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn: {}, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async () => 'compartido',
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const ver = (nombre) => $(`button[aria-label="Ver detalle de ${nombre}"]`);
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const choose = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const alCatalogo = async () => { await act(() => btn('Alimentos').click()); await act(() => btn('Ver catálogo').click()); };
  return { app, root, store, $, $$, btn, ver, act, type, choose, alCatalogo };
}
const fila = (t, clave) => t.$(`.detalle [data-clave="${clave}"]`);

test('desde Mi catálogo: 100 g por defecto, fuente, completitud, resumen de macros y todos los nutrientes agrupados', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Aceite de oliva').click());
  assert.ok(t.$('main.detalle'));
  assert.equal(t.$('header.top strong').textContent, 'Aceite de oliva');
  assert.equal(t.$('input.detalle-cantidad').value, '100');
  assert.match(t.$('.detalle-por').textContent, /^Información nutricional por 100 g$/);
  assert.match(t.$('.detalle-fuente').textContent, /Fuente de datos: USDA FoodData Central \(SR Legacy\) · fdcId 171413/);
  assert.match(t.$('.detalle-comp').textContent, /^\d+\/31 nutrientes obligatorios con dato/);
  assert.match(t.$('.detalle-fuente-completa p').textContent, /Oil, olive/);
  assert.deepEqual([...t.$('select.detalle-porcion').options].map((o) => o.textContent), ['g', '1 cucharada (13,5 g)', '1 cucharadita (4,5 g)']);
  // resumen de energía y macros: valor / objetivo, % y barra
  const kcal = t.$('.detalle-resumen [data-clave="energia_kcal"]');
  assert.match(kcal.querySelector('.nut-valor').textContent, /884 kcal/);
  assert.match(kcal.querySelector('.nut-valor').textContent, /2000 kcal/);
  assert.match(kcal.querySelector('.nut-pct').textContent, /44 %/);
  assert.ok(kcal.querySelector('.meter'));
  assert.deepEqual(t.$$('.detalle-resumen .nut').map((x) => x.dataset.clave), ['energia_kcal', 'proteina_g', 'hidratos_g', 'grasa_total_g']);
  // todos los nutrientes, por grupos
  assert.deepEqual(t.$$('.detalle-todos .grupo h3').map((x) => x.textContent), ['General', 'Hidratos de carbono', 'Lípidos', 'Proteínas y aminoácidos', 'Vitaminas', 'Minerales']);
  assert.equal(t.$$('.detalle-todos .nut').length, catalog.list.length);
  assert.equal(t.$('.aviso-sanitario').textContent, 'Información general; no sustituye al consejo de un profesional sanitario.');
  // solo ver: sin «Guardar» y con la barra inferior
  assert.equal(t.btn('Guardar'), undefined);
  assert.equal(t.$('footer.bar'), null);
  assert.ok(t.$('nav.tabbar'));
});

test('cantidad no redonda y porciones: los valores se recalculan sin guardar nada', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Aceite de oliva').click());
  t.type(t.$('input.detalle-cantidad'), '37,5');
  assert.match(t.$('.detalle-por').textContent, /por 37,5 g$/);
  assert.match(fila(t, 'energia_kcal').querySelector('.nut-valor').textContent, /332 kcal/); // 884 × 37,5 / 100 = 331,5
  // porción: 1 cucharada = 13,5 g; 2 cucharadas = 27 g
  t.choose(t.$('select.detalle-porcion'), 'p0');
  assert.equal(t.$('input.detalle-cantidad').value, '1');
  assert.match(t.$('.detalle-por').textContent, /por 13,5 g$/);
  t.type(t.$('input.detalle-cantidad'), '2');
  assert.match(t.$('.detalle-por').textContent, /por 27 g$/);
  // de vuelta a gramos: los gramos que había
  t.choose(t.$('select.detalle-porcion'), 'g');
  assert.equal(t.$('input.detalle-cantidad').value, '27');
  // cantidad no válida: aviso y se conserva lo último calculado
  t.type(t.$('input.detalle-cantidad'), '0');
  assert.match(t.$('[role=alert]').textContent, /mayor que 0/);
  assert.ok(!t.$('[role=alert]').hidden);
  assert.match(t.$('.detalle-por').textContent, /por 27 g$/);
  assert.equal((await t.store.allMeals()).length, 0);
});

test('sin dato se muestra «—» sin barra; un 0 escrito se muestra 0 con su barra', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Aceite de oliva').click());
  const aceite = realFoods.find((f) => f.id === 'aceite_oliva');
  const sinDato = catalog.keys.find((k) => typeof aceite.nutrients[k] !== 'number');
  assert.ok(sinDato, 'el aceite de oliva real tiene algún nutriente sin dato');
  const f = fila(t, sinDato);
  assert.ok(f.classList.contains('sin-dato'));
  assert.equal(f.querySelector('.nut-valor').textContent, '—');
  assert.equal(f.querySelector('.meter'), null);
  const cero = fila(t, 'vitamina_b12_ug'); // 0 escrito en el documento
  assert.equal(aceite.nutrients.vitamina_b12_ug, 0);
  assert.match(cero.querySelector('.nut-valor').textContent, /^0 µg/);
  assert.ok(cero.querySelector('.meter'));
  assert.match(cero.querySelector('.nut-pct').textContent, /0 %/);
});

test('un alimento sin ningún dato: todo «—» y ninguna barra', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Coca-Cola Classic').click());
  assert.equal(t.$$('.detalle .meter').length, 0);
  assert.ok(t.$$('.detalle .nut').every((x) => x.querySelector('.nut-valor').textContent === '—'));
  assert.match(t.$('.detalle-comp').textContent, /^0\/31/);
  assert.match(t.$('.detalle-comp').textContent, /pendiente de completar/);
});

test('detalle de un nutriente: rango, información, fuentes, «En tu catálogo»; «Volver» con la misma cantidad', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Aceite de oliva').click());
  t.type(t.$('input.detalle-cantidad'), '37,5');
  await t.act(() => t.ver('Calcio').click());
  assert.ok(t.$('main.detalle-nutriente'));
  assert.equal(t.$('header.top strong').textContent, 'Calcio');
  const filas = t.$$('.rango-tabla tr').map((r) => r.dataset.fila);
  assert.deepEqual(filas.slice(0, 1), ['alimento']);
  assert.ok(!filas.includes('hoy')); // desde Alimentos no hay «Llevas hoy»
  assert.ok(filas.includes('referencia'));
  assert.match(t.$('.rango-tabla tr[data-fila="alimento"] td').textContent, /0,38 mg/); // 1 mg × 37,5 / 100
  assert.ok(t.$('.rango-barra .marca'));
  // información del fixture
  const titulos = t.$$('.info-seccion h2').map((x) => x.textContent);
  assert.deepEqual(titulos, ['Qué es', 'Cuánto necesitas', 'Si falta', 'Si sobra', 'Dónde está', 'Consejos', 'Discrepancias entre fuentes', 'Fuentes consultadas']);
  assert.match(t.$('.info-seccion .panel p').textContent, /qué es el calcio/);
  const enlaces = t.$$('.fuentes a');
  assert.equal(enlaces.length, 2);
  assert.equal(enlaces[0].getAttribute('href'), 'https://www.efsa.europa.eu/es');
  assert.equal(enlaces[0].getAttribute('target'), '_blank');
  assert.match(enlaces[0].getAttribute('rel'), /noopener/);
  assert.match(t.$('.fuentes li').textContent, /consultado: 2026-10-20/);
  // En tu catálogo: 5 alimentos como mucho, «Nombre · ración: X g → Y (Z % del objetivo)»
  const top = t.$$('.top-lista li');
  assert.equal(top.length, 5);
  assert.match(top[0].textContent, /^.+ · ración: [\d,.]+ g → [\d,.]+ mg \(\d+ % del objetivo\)$/);
  assert.equal(t.$('.aviso-sanitario').textContent, 'Información general; no sustituye al consejo de un profesional sanitario.');
  // volver: mismo alimento y misma cantidad
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('main.detalle'));
  assert.equal(t.$('input.detalle-cantidad').value, '37,5');
  assert.match(t.$('.detalle-por').textContent, /por 37,5 g$/);
});

test('un nutriente sin entrada en data/nutrientes-info.json: «Información aún no disponible», y sigue el rango y «En tu catálogo»', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Aceite de oliva').click());
  await t.act(() => t.ver('Hierro').click());
  assert.match(t.$('.info-no-disponible').textContent, /^Información aún no disponible$/);
  assert.ok(t.$('.rango-tabla'));
  assert.ok(t.$$('.top-lista li').length > 0);
  assert.equal(t.$$('.fuentes a').length, 0);
});

test('sin fichero de información en absoluto (no cargó): el detalle de nutriente sigue funcionando', { skip }, async () => {
  const t = await setup({ info: null });
  await t.alCatalogo();
  await t.act(() => t.ver('Aceite de oliva').click());
  await t.act(() => t.ver('Calcio').click());
  assert.match(t.$('.info-no-disponible').textContent, /aún no disponible/);
  assert.ok(t.$('.rango-tabla'));
});

test('«Volver» del detalle de alimento regresa a Mi catálogo con la búsqueda', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.type(t.$('input[type=search]'), 'aceite'));
  await t.act(() => t.ver('Aceite de oliva').click());
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('main.catalogo-lista'));
  assert.equal(t.$('input[type=search]').value, 'aceite');
});

test('desde el Diario: gramos de la línea, sin «Guardar» hasta cambiarlos, y Guardar actualiza solo esa línea', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'desayuno', [['avena_copos', 80], ['almendras_crudas', 30]])] });
  const abrir = t.ver('Avena (copos/molida)');
  assert.ok(abrir, 'el nombre de la línea del Diario abre el detalle');
  await t.act(() => abrir.click());
  assert.ok(t.$('main.detalle'));
  assert.equal(t.$('input.detalle-cantidad').value, '80');
  assert.equal(t.$('select.detalle-porcion'), null); // desde el Diario solo gramos
  assert.match(t.$('header.top .title-block small').textContent, /Desayuno/);
  assert.equal(t.$('footer.bar'), null); // sin cambios no se muestra «Guardar»
  assert.equal(t.$('nav.tabbar'), null); // y la pantalla puede llevar pie fijo: sin barra inferior
  assert.match(fila(t, 'energia_kcal').querySelector('.nut-valor').textContent, /303 kcal/); // 379 × 80 / 100
  t.type(t.$('input.detalle-cantidad'), '37,5');
  assert.equal(t.$('footer.bar button').textContent, 'Guardar');
  assert.equal(t.$('nav.tabbar'), null);
  t.type(t.$('input.detalle-cantidad'), '80'); // de vuelta a lo guardado: desaparece
  assert.equal(t.$('footer.bar'), null);
  t.type(t.$('input.detalle-cantidad'), '3000'); // más de 2000 g: se confirma desde «Editar»
  assert.equal(t.$('footer.bar'), null);
  assert.match(t.$('[role=alert]').textContent, /Editar/);
  t.type(t.$('input.detalle-cantidad'), '50');
  await t.act(() => t.btn('Guardar').click());
  const [m] = await t.store.allMeals();
  assert.equal(m.id, 'm0');
  assert.deepEqual(m.lines.map((l) => [l.food_id, l.grams]), [['avena_copos', 50], ['almendras_crudas', 30]]);
  assert.ok(m.updatedAt);
  assert.ok(t.$('.daylabel'), 'vuelve al Diario');
  assert.equal(t.$('[role=status]').textContent, 'Cambios guardados.');
  assert.equal(t.$('section.meal[data-meal="desayuno"] .line-grams').textContent, '50 g');
});

test('desde el Diario: «Volver» sin guardar deja la comida como estaba; el nutriente muestra «Llevas hoy» y vuelve con la cantidad', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'desayuno', [['avena_copos', 80], ['almendras_crudas', 30]])] });
  await t.act(() => t.ver('Avena (copos/molida)').click());
  t.type(t.$('input.detalle-cantidad'), '50');
  await t.act(() => t.ver('Calcio').click());
  const hoy = t.$('.rango-tabla tr[data-fila="hoy"] td').textContent;
  assert.match(hoy, /122 mg/); // avena 80 g (41,6) + almendras 30 g (80,7), lo guardado
  assert.match(t.$('.rango-tabla tr[data-fila="alimento"] td').textContent, /26 mg/); // 52 × 50 / 100
  assert.ok(t.$('.rango-barra .rango-otros'));
  assert.ok(t.$('.rango-barra .rango-aporte'));
  await t.act(() => t.btn('‹ Volver').click());
  assert.equal(t.$('input.detalle-cantidad').value, '50');
  assert.ok(t.$('footer.bar'));
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.daylabel'));
  const [m] = await t.store.allMeals();
  assert.deepEqual(m.lines.map((l) => l.grams), [80, 30]); // nada guardado
});

test('una línea del Diario cuyo alimento ya no está en el documento no abre detalle', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'desayuno', [['ya_no_existe', 40], ['avena_copos', 80]])] });
  assert.equal(t.$$('button.line-open').length, 1);
  assert.equal(t.$$('.line-name')[0].textContent, 'ya_no_existe');
});

test('un fallo al guardar se muestra y no pierde la cantidad escrita', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'desayuno', [['avena_copos', 80]])] });
  await t.act(() => t.ver('Avena (copos/molida)').click());
  t.type(t.$('input.detalle-cantidad'), '60');
  t.store.addMeal = async () => { throw new Error('disco lleno'); };
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('.alert-fail').textContent, /No se pudo guardar: disco lleno/);
  assert.equal(t.$('input.detalle-cantidad').value, '60');
  assert.ok(t.$('footer.bar'));
});
