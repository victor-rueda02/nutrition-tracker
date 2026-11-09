// «Copiar dieta del día»: validación de data/dieta.json (pura) y el botón del Diario (jsdom) que abre «Repetir» con la dieta
// del día de la semana. Sin IA ni red: el fichero publicado se simula.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAS, DIA_LABEL, diaDeSemana, validarDieta, parseDieta, dietaComoComidas } from '../frontend/js/core/dieta.js';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { cleanRetirados } from '../frontend/js/core/catalog-update.js';
import { createRepeat, toRecords, DESTINO_ORIGEN } from '../frontend/js/core/repeat.js';
import { MEALS } from '../frontend/js/core/meal-defaults.js';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const IDS = new Set(realFoods.map((f) => f.id));
const L = (food_id, gramos) => ({ food_id, gramos });

// ---------- lógica pura ----------

test('día de la semana de una fecha (calendario puro) y fecha inválida', () => {
  assert.equal(diaDeSemana('2026-10-19'), 'lunes');
  assert.equal(diaDeSemana('2026-10-16'), 'viernes');
  assert.equal(diaDeSemana('2026-10-17'), 'sabado');
  assert.equal(diaDeSemana('2026-10-18'), 'domingo');
  assert.equal(diaDeSemana('2026-03-29'), 'domingo'); // cambio de hora: sin efecto
  assert.deepEqual(DIAS.map((_, i) => diaDeSemana(`2026-11-0${i + 2}`)), DIAS);
  assert.throws(() => diaDeSemana('16/10/2026'), /Fecha no válida/);
});

test('validarDieta: estructura correcta y conversión de un día al formato de Repetir', () => {
  const raw = { nombre: 'x', dias: { lunes: { cena: [L('huevo', 108)], desayuno: [L('avena_copos', 90), L('bebida_de_avena', 300.5)] } } };
  const r = validarDieta(raw, { foodIds: IDS });
  assert.deepEqual([r.ok, r.errores, r.desconocidos], [true, [], []]);
  const meals = dietaComoComidas(r.dieta, 'lunes');
  assert.deepEqual(meals.map((m) => [m.meal, m.lines]), [['desayuno', [{ food_id: 'avena_copos', grams: 90 }, { food_id: 'bebida_de_avena', grams: 300.5 }]], ['cena', [{ food_id: 'huevo', grams: 108 }]]]); // en el orden de las comidas
  assert.equal(dietaComoComidas(r.dieta, 'sabado'), null);
  assert.equal(dietaComoComidas(validarDieta({ dias: { sabado: { cena: [] } } }).dieta, 'sabado'), null);
});

test('validarDieta: cada tipo de error de estructura se nombra (día, comida, gramos, food_id)', () => {
  const malos = [
    [{ dias: { lunez: { cena: [L('huevo', 1)] } } }, /Día no válido «lunez»/],
    [{ dias: { lunes: { almuerzo: [L('huevo', 1)] } } }, /comida no válida «almuerzo»/],
    [{ dias: { lunes: { cena: [L('huevo', 0)] } } }, /huevo: los gramos deben ser un número mayor que 0/],
    [{ dias: { lunes: { cena: [L('huevo', -5)] } } }, /mayor que 0/],
    [{ dias: { lunes: { cena: [L('huevo', '100')] } } }, /mayor que 0/],
    [{ dias: { lunes: { cena: [L('huevo', 99999)] } } }, /más de 2000 g/],
    [{ dias: { lunes: { cena: [{ gramos: 5 }] } } }, /falta food_id/],
    [{ dias: { lunes: { cena: 'huevo' } } }, /debe ser una lista/],
    [{ dias: { lunes: [] } }, /debe ser un objeto con sus comidas/],
    [{ dias: [] }, /Falta «dias»/],
    [[], /debe ser un objeto/],
    [null, /debe ser un objeto/],
  ];
  for (const [raw, re] of malos) {
    const r = validarDieta(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.match(r.errores.join(' | '), re);
  }
  const roto = parseDieta('{ "dias": ');
  assert.deepEqual([roto.ok, roto.dieta], [false, null]);
  assert.match(roto.errores[0], /no es un JSON válido/);
});

test('validarDieta: un id que no está en el documento no es error de estructura: se devuelve aparte', () => {
  const r = validarDieta({ dias: { lunes: { cena: [L('huevo', 100), L('no_existe', 50)] } } }, { foodIds: IDS });
  assert.deepEqual([r.ok, r.desconocidos], [true, [{ dia: 'lunes', comida: 'cena', food_id: 'no_existe' }]]);
  assert.equal(validarDieta({ dias: { lunes: { cena: [L('no_existe', 50)] } } }).desconocidos.length, 0); // sin catálogo no se comprueba
});

test('data/dieta.json real: estructura válida y todos los ids existen en data/foods.csv y no están retirados', () => {
  const foods = parseFoodsCSV(readFile('../data/foods.csv'), { catalog }).foods;
  const ids = new Set(foods.map((f) => f.id));
  const retirados = new Set(cleanRetirados(JSON.parse(readFile('../data/retirados.json'))).map((r) => r.id));
  const r = parseDieta(readFile('../data/dieta.json'), { foodIds: ids });
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.desconocidos, [], 'ids de la dieta que no están en data/foods.csv');
  const usados = Object.values(r.dieta.dias).flatMap((d) => Object.values(d).flat()).map((l) => l.food_id);
  assert.ok(usados.length > 0);
  assert.deepEqual(usados.filter((id) => retirados.has(id)), [], 'ids de la dieta que están en retirados.json');
  for (const dia of Object.keys(r.dieta.dias)) assert.ok(dietaComoComidas(r.dieta, dia), `${dia} sin líneas`);
  assert.ok(['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].every((d) => r.dieta.dias[d] && MEALS.slice(0, 4).every((m) => r.dieta.dias[d][m]?.length)));
});

test('Repetir con la dieta: todo marcado, cada comida en la suya y registros normales (sin vínculo a plantilla)', () => {
  const r = validarDieta({ dias: { viernes: { desayuno: [L('avena_copos', 90)], cena: [L('huevo', 108), L('sal', 0.3)] } } });
  const byId = new Map(realFoods.map((f) => [f.id, f]));
  const rep = createRepeat({ meals: dietaComoComidas(r.dieta, 'viernes'), dieta: { dia: 'viernes', etiqueta: 'viernes' }, foodsById: byId, targetDate: '2026-10-16', targetMeal: DESTINO_ORIGEN });
  assert.ok(rep.groups.flatMap((g) => g.items).every((i) => i.checked && i.known));
  const recs = toRecords(rep, { now: new Date('2026-10-16T08:00:00Z'), idGen: (() => { let n = 0; return () => `d${++n}`; })() });
  assert.deepEqual(recs.map((x) => [x.date, x.meal, x.text, x.lines.map((l) => [l.food_id, l.grams, l.source_text])]),
    [['2026-10-16', 'desayuno', 'Dieta del viernes', [['avena_copos', 90, 'dieta del viernes']]], ['2026-10-16', 'cena', 'Dieta del viernes', [['huevo', 108, 'dieta del viernes'], ['sal', 0.3, 'dieta del viernes']]]]);
  assert.ok(recs.every((x) => !('template' in x) && !('dieta' in x)));
});

// ---------- el botón en el Diario (jsdom) ----------

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z'); // viernes, 09:30 en Madrid
const DIETA = { version: 1, nombre: 'prueba', dias: {
  viernes: { desayuno: [L('avena_copos', 90), L('bebida_de_avena', 300)], comida: [L('arroz_blanco_crudo', 150), L('sal', 0.3)], cena: [L('huevo', 108)] },
} };

async function setup({ dieta = JSON.stringify(DIETA), fetchDieta, fetchDietaCopia, ajustes = {}, foods = realFoods } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const root = dom.window.document.getElementById('app');
  const store = createMemoryStore();
  for (const [k, v] of Object.entries(ajustes)) await store.setSetting(k, v);
  const peticiones = [];
  const app = mountApp(root, {
    store, createAiClient: () => ({}), catalog, settings, targets: JSON.parse(readFile('../data/targets.json')), objetivos: {},
    fetchDieta: fetchDieta ?? (async () => { peticiones.push('red'); if (dieta instanceof Error) throw dieta; return dieta; }), fetchDietaCopia,
    initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn: { endpoint: 'https://w', token: 't' }, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(),
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const copiar = async () => { await act(() => $('button[aria-label="Más opciones del día"]').click()); await act(() => btn('Copiar dieta del día').click()); };
  return { app, root, store, peticiones, $, $$, btn, act, copiar };
}

test('Copiar dieta del día: abre Repetir con la dieta del día mostrado, todo marcado, cada comida en la suya; «Añadir» guarda registros normales', { skip }, async () => {
  const t = await setup();
  await t.copiar();
  assert.equal(t.$('header strong').textContent, 'Dieta del día');
  assert.equal(t.$('.source-label').textContent, 'De: dieta del viernes');
  assert.deepEqual(t.$$('.repeat-group h2').map((x) => x.textContent), ['Desayuno', 'Comida', 'Cena']);
  assert.equal(t.$$('.repeat-item input[type=checkbox]').length, 5);
  assert.ok(t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked));
  assert.equal(t.$('select[aria-label="Comida de destino"]').value, 'origen');
  assert.equal(t.$('input[aria-label="Fecha de destino"]').value, '2026-10-16');
  assert.equal(t.$('.alert-ul'), null);
  // confirmación editable: cambiar gramos y desmarcar
  const gramos = t.$('input[aria-label="Gramos de Copos de avena"]') ?? t.$$('input.grams')[0];
  gramos.value = '80'; gramos.dispatchEvent(new t.root.ownerDocument.defaultView.Event('input', { bubbles: true }));
  t.$$('.repeat-item input[type=checkbox]')[4].click(); // el huevo de la cena
  await t.act(() => t.btn('Añadir 4 alimentos').click());
  const guardadas = (await t.store.allMeals()).filter((m) => m.date === '2026-10-16').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  assert.deepEqual(guardadas.map((m) => [m.meal, m.lines.map((l) => [l.food_id, l.grams])]),
    [['desayuno', [['avena_copos', 80], ['bebida_de_avena', 300]]], ['comida', [['arroz_blanco_crudo', 150], ['sal', 0.3]]]]);
  assert.ok(t.$('.daylabel')); // de vuelta en el Diario
  assert.match(t.root.textContent, /Añadidos 4 alimentos de la dieta del viernes/);
});

test('Copiar dieta del día: pide siempre la red (fresca), guarda la copia y, sin red, usa la última copia guardada', { skip }, async () => {
  const t = await setup();
  await t.copiar();
  assert.deepEqual(t.peticiones, ['red']);
  assert.equal(await t.store.getSetting('dieta_publicada'), JSON.stringify(DIETA));
  // sin red: la copia guardada del ajuste manda sobre la del service worker
  const sinRed = await setup({ fetchDieta: async () => { throw new TypeError('Failed to fetch'); }, ajustes: { dieta_publicada: JSON.stringify(DIETA) }, fetchDietaCopia: async () => '{"dias":{}}' });
  await sinRed.copiar();
  assert.equal(sinRed.$('.source-label').textContent, 'De: dieta del viernes');
  // sin red ni copia guardada: la del service worker
  const conSw = await setup({ fetchDieta: async () => { throw new TypeError('Failed to fetch'); }, fetchDietaCopia: async () => JSON.stringify(DIETA) });
  await conSw.copiar();
  assert.equal(conSw.$('.source-label').textContent, 'De: dieta del viernes');
  // sin nada: error visible, nos quedamos en el Diario
  const nada = await setup({ fetchDieta: async () => { throw new TypeError('Failed to fetch'); } });
  await nada.copiar();
  assert.match(nada.$('.alert-fail').textContent, /^No se pudo copiar la dieta: no se pudo cargar data\/dieta\.json \(¿sin conexión\?\)/);
  assert.ok(nada.$('.daylabel'));
});

test('Copiar dieta del día: día sin dieta -> «No hay dieta para el jueves», visible, sin pantalla nueva', { skip }, async () => {
  const t = await setup();
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  await t.copiar();
  assert.match(t.$('.alert-fail').textContent, /No se pudo copiar la dieta: No hay dieta para el jueves/);
  assert.equal(t.$('.repeat'), null);
  assert.equal((await t.store.allMeals()).length, 0);
  // un día de la semana presente en el fichero pero sin ninguna línea tampoco cuenta como dieta
  const t2 = await setup({ dieta: JSON.stringify({ dias: { viernes: { cena: [] } } }) });
  await t2.copiar();
  assert.match(t2.$('.alert-fail').textContent, /No hay dieta para el viernes/);
  assert.deepEqual([DIA_LABEL.miercoles, DIA_LABEL.sabado], ['miércoles', 'sábado']); // en el aviso, con tilde
});

test('Copiar dieta del día: fichero roto o inválido -> error visible con el motivo; nada se guarda', { skip }, async () => {
  for (const [dieta, re] of [['{ "dias": ', /no es un JSON válido/], [JSON.stringify({ dias: { viernes: { cena: [L('huevo', 0)] } } }), /data\/dieta\.json no es válido: .*mayor que 0/], [new Error('dieta.json: 404'), /no se pudo cargar/]]) {
    const t = await setup({ dieta, fetchDietaCopia: undefined });
    await t.copiar();
    assert.match(t.$('.alert-fail').textContent, re);
    assert.equal(t.$('.repeat'), null);
  }
});

test('Copiar dieta del día: un alimento que el documento del iPhone no tiene se avisa, queda desmarcado y se copia el resto', { skip }, async () => {
  const dieta = JSON.stringify({ dias: { viernes: { desayuno: [L('avena_copos', 90)], cena: [L('alimento_nuevo_x', 50), L('huevo', 108)] } } });
  const t = await setup({ dieta });
  await t.copiar();
  const aviso = t.$('.alert-ul[role=alert]');
  assert.match(aviso.textContent, /Un alimento de la dieta no está en tu documento \(alimento_nuevo_x\) y no se añadirá/);
  assert.match(aviso.textContent, /Busca la actualización del documento/);
  const marcas = t.$$('.repeat-item').map((li) => [li.querySelector('input[type=checkbox]').checked, li.querySelector('input[type=checkbox]').disabled]);
  assert.deepEqual(marcas, [[true, false], [false, true], [true, false]]);
  await t.act(() => t.btn('Añadir 2 alimentos').click());
  const guardadas = await t.store.allMeals();
  assert.deepEqual(guardadas.flatMap((m) => m.lines.map((l) => l.food_id)).sort(), ['avena_copos', 'huevo']);
});

test('Copiar dieta del día: un alimento con incluir=no se puede copiar, como al elegirlo a mano', { skip }, async () => {
  const foods = realFoods.map((f) => (f.id === 'huevo' ? { ...f, incluir: false } : f));
  const t = await setup({ foods });
  await t.copiar();
  assert.ok(t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked && !c.disabled));
  await t.act(() => t.btn('Añadir 5 alimentos').click());
  assert.equal((await t.store.allMeals()).flatMap((m) => m.lines).length, 5);
});
