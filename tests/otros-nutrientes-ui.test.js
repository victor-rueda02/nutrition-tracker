// Encargo U (UI): el informe diario enseña todos los nutrientes del catálogo en sus grupos, con la misma fila; sin la
// lista «Otros nutrientes»; «sin referencia» sin barra; aminoácidos con su barra; el detalle de nutriente coherente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z');
const MEAL = (id, date, meal, lines) => ({ id, date, meal, createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const PLAN = (peso) => ({ tipo: 'plan_objetivos', version: 1, nombre: 'Prueba', periodos: [{ id: 'p', nombre: 'Prueba', inicio: '2026-01-01', ...(peso ? { peso_kg: peso } : {}) }], excepciones: [] });
const COMIDA = [MEAL('h', '2026-10-16', 'comida', [['pechuga_pollo_cruda', 200], ['arroz_blanco_crudo', 100]])];

async function setup({ meals = COMIDA, plan = PLAN(75) } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  if (plan) await store.setSetting('plan_objetivos', plan);
  const app = mountApp(root, {
    store, createAiClient: () => ({}), catalog, settings, targets: TARGETS, objetivos: {},
    initial: { foods: realFoods, extraHeaders: [], docName: 'doc.csv' }, conn: {}, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async () => 'compartido',
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const act = async (fn) => { fn(); await app.whenIdle(); };
  return { app, root, store, $, $$, btn, act };
}
const informe = async (t) => {
  await t.act(() => t.$('button[aria-label="Más opciones del día"]').click());
  await t.act(() => t.btn('Ver informe diario').click());
};
const fila = (t, clave) => t.$(`main.informe li.nut[data-clave="${clave}"]`);

test('informe: no hay lista «Otros nutrientes»; todos los nutrientes con datos salen en sus grupos, con los mismos títulos que el detalle', { skip }, async () => {
  const t = await setup();
  await informe(t);
  assert.doesNotMatch(t.$('main.informe').textContent, /Otros nutrientes/);
  assert.equal(t.$('main.informe details:not(.plegable)'), null);
  assert.deepEqual(t.$$('main.informe .grupo h3').map((x) => x.textContent), ['General', 'Hidratos', 'Lípidos', 'Proteínas y aminoácidos', 'Vitaminas', 'Minerales']);
  const grupo = (id) => t.$(`main.informe .grupo[data-grupo="${id}"]`);
  assert.ok(grupo('proteinas').querySelector('li[data-clave="leucina_g"]'), 'leucina en Proteínas y aminoácidos');
  assert.ok(grupo('proteinas').querySelector('li[data-clave="metionina_cistina"]'), 'suma de aminoácidos');
  assert.ok(grupo('lipidos').querySelector('li[data-clave="grasas_trans_g"]'));
  assert.ok(grupo('lipidos').querySelector('li[data-clave="epa_g"]'));
  assert.ok(grupo('lipidos').querySelector('li[data-clave="epa_dha"]'));
  assert.ok(grupo('hidratos').querySelector('li[data-clave="almidon_g"]'));
  assert.ok(grupo('general').querySelector('li[data-clave="cafeina_mg"]'));
  assert.ok(grupo('vitaminas').querySelector('li[data-clave="vitamina_c_mg"]'));
  assert.ok(grupo('minerales').querySelector('li[data-clave="hierro_mg"]'));
  // cada nutriente una sola vez
  const claves = t.$$('main.informe li.nut').map((x) => x.dataset.clave);
  assert.equal(new Set(claves).size, claves.length);
  // omega-3 y omega-6: columnas vacías en todo el catálogo, ocultos
  assert.equal(fila(t, 'omega3_g'), null);
  assert.equal(fila(t, 'omega6_g'), null);
});

test('informe: aminoácido con su barra y % (39 mg/kg × 75 kg = 2,925 g); sin referencia, valor y «sin referencia» sin barra ni %', { skip }, async () => {
  const t = await setup();
  await informe(t);
  const leu = fila(t, 'leucina_g');
  assert.ok(leu.querySelector('.meter'));
  assert.match(leu.querySelector('.nut-valor').textContent, /\/ 2,9/);
  assert.match(leu.querySelector('.nut-pct').textContent, /^\d+ %$/);
  const alm = fila(t, 'agua_g');
  assert.ok(alm.classList.contains('nut-sin-ref'));
  assert.equal(alm.querySelector('.meter'), null);
  // dos columnas: nombre a la izquierda y el valor en la columna del % (sin %); debajo, «sin referencia»
  assert.match(alm.querySelector('.nut-head > .nut-pct .nut-valor').textContent, /^\d[\d,.]* g$/);
  assert.equal(alm.querySelector('.nut-head > .nut-main .nut-valor'), null);
  assert.equal(alm.querySelector('.nut-sin-ref-nota').textContent, 'sin referencia');
  // trans con su máximo y cafeína con el suyo
  assert.ok(fila(t, 'grasas_trans_g').querySelector('.meter'));
  assert.ok(fila(t, 'cafeina_mg').querySelector('.meter'));
  // sin dato: «—», nunca 0
  const sinDato = t.$$('main.informe li.nut-sin-ref.sin-dato');
  assert.ok(sinDato.length > 0, 'con este día hay nutrientes sin dato y sin referencia');
  for (const li of sinDato) assert.deepEqual([li.querySelector('.nut-valor').textContent, li.querySelector('.nut-sin-ref-nota').textContent], ['—', 'sin referencia']);
  // los que tienen valor no son un 0 inventado: o traen su cantidad o es un 0 escrito en el documento
  for (const li of t.$$('main.informe li.nut-sin-ref:not(.sin-dato)')) {
    assert.match(li.querySelector('.nut-valor').textContent, /^[<\d]/);
    assert.equal(li.querySelector('.nut-sin-ref-nota').textContent, 'sin referencia');
  }
  // «Todos los nutrientes» (como en el detalle de alimento) y los componentes de una suma, sangrados por CSS (siguen en su sitio, antes de la suma)
  assert.match(t.$('main.informe details.plegable:last-of-type summary h2').textContent, /^Todos los nutrientes$/);
  const orden = t.$$('main.informe li.nut').map((x) => x.dataset.clave);
  assert.deepEqual(orden.slice(orden.indexOf('metionina_g'), orden.indexOf('metionina_cistina') + 1), ['metionina_g', 'cistina_g', 'metionina_cistina']);
});

test('informe sin peso en el plan: el aminoácido dice «sin referencia: falta tu peso en Objetivos» y no lleva barra', { skip }, async () => {
  const t = await setup({ plan: PLAN(null) });
  await informe(t);
  const leu = fila(t, 'leucina_g');
  assert.equal(leu.querySelector('.meter'), null);
  assert.equal(leu.querySelector('.nut-sin-ref-nota').textContent, 'sin referencia: falta tu peso en Objetivos');
  assert.match(leu.querySelector('.nut-valor').textContent, /\d/); // su valor sigue ahí
  // cafeína y trans no necesitan el peso
  assert.ok(fila(t, 'cafeina_mg').querySelector('.meter'));
  assert.ok(fila(t, 'grasas_trans_g').querySelector('.meter'));
});

test('detalle de nutriente de la leucina (desde el Diario): barra con su mínimo; el de un nutriente sin referencia, valor y «sin referencia» sin barra', { skip }, async () => {
  const t = await setup();
  await t.act(() => t.$('button[aria-label^="Ver detalle de Pechuga"]').click());
  // detalle de alimento: grupos como el informe y sin omega-3/omega-6
  assert.deepEqual(t.$$('.detalle-todos .grupo h3').map((x) => x.textContent), ['General', 'Hidratos', 'Lípidos', 'Proteínas y aminoácidos', 'Vitaminas', 'Minerales']);
  assert.equal(t.$('.detalle-todos [data-clave="omega3_g"]'), null);
  assert.ok(t.$('.detalle-todos [data-clave="metionina_cistina"]'));
  await t.act(() => t.$('.detalle-todos [data-clave="leucina_g"] .abre-detalle').click());
  assert.equal(t.$('header.top strong').textContent, 'Leucina');
  assert.ok(t.$('.rango-barra'));
  assert.ok(t.$('.rango-barra .marca-min'));
  assert.deepEqual(t.$$('.rango-tabla tr').map((r) => r.dataset.fila), ['alimento', 'hoy', 'min']);
  assert.match(t.$('.rango-tabla tr[data-fila="min"] td').textContent, /2,9/);
  assert.equal(t.$('.rango-sin-ref'), null);
  await t.act(() => t.btn('‹ Volver').click());
  // un nutriente sin referencia (almidón): valor y «sin referencia», sin barra
  await t.act(() => t.$('.detalle-todos [data-clave="almidon_g"] .abre-detalle').click());
  assert.equal(t.$('.rango-barra'), null);
  assert.match(t.$('.rango-sin-ref').textContent, /sin referencia/);
});
