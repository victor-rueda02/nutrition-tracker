// Interfaz de «Estimar con IA» y «Guardar como receta» (jsdom). IA y USDA simulados: nunca hay llamadas reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { AiClientError } from '../frontend/js/ai-client.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';
import { parseRecetas } from '../frontend/js/core/recetas.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-18T11:30:00Z'); // 13:30 en Madrid

const PASTA = 'Pasta, cooked, unenriched, without added salt';
const BEEF = 'Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned';
const ESTIMACION = {
  plato: 'lasaña', gramos: 300, total_estimado: false, ajustado: false, warnings: [], model: 'm',
  ingredientes: [
    { origen: 'usda', termino: PASTA, nombre: 'pasta de lasaña cocida', estado: 'cocinado', gramos: 120 },
    { origen: 'usda', termino: BEEF, nombre: 'carne picada cocinada', estado: 'cocinado', gramos: 80 },
    { origen: 'catalogo', food_id: 'salsa_tomate_frito', nombre: 'tomate frito', gramos: 60 },
    { origen: 'catalogo', food_id: 'queso_tierno_loncha', nombre: 'queso', gramos: 40 },
  ],
};
const CAND = (fdcId, descripcion, o = {}) => ({ fdcId, descripcion, tipo: 'SR Legacy', obligatorios: 29, total: 31, coincidencia: 1, fortificacion: [], ...o });
const BUSQUEDAS = {
  [PASTA]: { termino: PASTA, estado: 'completo', motivo: 'm', sugerido: 101, candidatos: [CAND(101, PASTA), CAND(102, 'Pasta, cooked, enriched', { fortificacion: ['la descripción dice "enriched"'] })] },
  [BEEF]: { termino: BEEF, estado: 'completo', motivo: 'm', sugerido: 201, candidatos: [CAND(201, BEEF)] },
};
const FICHA = (fdcId, descripcion) => ({ fdcId, descripcion, tipo: 'SR Legacy', estimado: false, values: { energia_kcal: 158, proteina_g: 5.8, hierro_mg: 0.5 }, notas: [], unidades: [], vaciados: [], fuente: `${descripcion} (SR Legacy)`, fortificacion: [], sospechosos: [], enriquecibles: ['hierro_mg'] });
const DICTADO = { items: [{ food_id: 'aceite_oliva', grams: 10, source_text: '10 g de aceite', confidence: 'alta', flags: [], requiresConfirmation: false }], unmatched: [{ text: '300 g de lasaña', motivo: 'no_en_catalogo' }], warnings: [], model: 'm' };

async function setup({ estimate = ESTIMACION, busquedas = BUSQUEDAS, meals = [], recetasBase = [] } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  const calls = { parse: [], estimate: [], search: [], foods: [] };
  const saved = [];
  const createAiClient = () => ({
    async interpretMeal(a) { calls.parse.push(a); return DICTADO; },
    async estimateDish(a) { calls.estimate.push(a); if (estimate instanceof Error) throw estimate; return structuredClone(estimate); },
    async usdaSearch({ terminos }) { calls.search.push(terminos); if (busquedas instanceof Error) throw busquedas; return { resultados: terminos.map((t) => busquedas[t] ?? { termino: t, estado: 'sin_candidatos', motivo: '', sugerido: null, candidatos: [] }) }; },
    async usdaFoods({ fdcIds }) { calls.foods.push(fdcIds); return { fichas: fdcIds.map((id) => FICHA(id, id === 101 ? PASTA : BEEF)), faltan: [] }; },
    async health() { return { ok: true }; },
  });
  let n = 0;
  const app = mountApp(root, { store, createAiClient, catalog, settings, targets: TARGETS, recetasBase, initial: { foods: realFoods, extraHeaders: [], docName: 'doc.csv' }, conn: { endpoint: 'https://w', token: 't' }, now: () => NOW, idGen: () => `m${++n}`, saveFile: async (f) => { saved.push(f); return 'compartido'; } });
  await app.whenIdle();
  root.querySelector('button[aria-label="Añadir comida"]').click(); // la app abre en el Diario; el "+" central lleva directo al dictado
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const buscar = (text) => $$('button').find((b) => b.textContent.includes(text));
  // El dictado ocupa toda la pantalla (sin barra inferior): para ir a una pestaña se cierra primero con la X.
  const btn = (text) => { let b = buscar(text); if (!b && ['Diario', 'Alimentos', 'Más'].includes(text)) { buscar('‹ Volver')?.click(); b = buscar(text); } return b; };
  const type = (el, value, ev = 'input') => { el.value = value; el.dispatchEvent(new Event(ev, { bubbles: true })); };
  const act = async (fn) => { fn(); await app.whenIdle(); };
  return { app, root, store, calls, saved, $, $$, btn, type, act, Event };
}

async function hastaEstimar(t) {
  t.type(t.$('textarea'), 'para comer 300 g de lasaña y 10 g de aceite');
  await t.act(() => t.btn('Procesar').click());
  await t.act(() => t.btn('Estimar con IA').click());
}

test('flujo completo: «Estimar con IA» -> revisión -> confirmación -> guardar; filas nuevas de USDA en el documento', { skip }, async () => {
  const t = await setup();
  await hastaEstimar(t);
  // una llamada a la IA, con el fragmento y la lista compacta (sin nutrientes)
  assert.equal(t.calls.estimate.length, 1);
  assert.equal(t.calls.estimate[0].texto, '300 g de lasaña');
  assert.ok(!JSON.stringify(t.calls.estimate[0].alimentos).includes('nutrients'));
  // USDA: una sola petición con los dos términos que faltan
  assert.deepEqual(t.calls.search, [[PASTA, BEEF]]);
  assert.match(t.root.textContent, /Estimar con IA/);
  assert.equal(t.$$('li.estimar-ing').length, 4);
  assert.equal(t.$$('.origen.usda').length, 2);
  assert.equal(t.$$('.origen.catalogo').length, 2);
  assert.match(t.$('.estimar-suma').textContent, /Suma de ingredientes: 300 g de 300 g/);
  // gramos editables: la suma se actualiza y avisa fuera del ±10 %
  const gramos = t.$$('li.estimar-ing input.grams');
  t.type(gramos[0], '200');
  assert.match(t.$('.estimar-suma').textContent, /380 g de 300 g · se aleja más de un 10 %/);
  t.type(gramos[0], '120');
  // elegir el candidato enriquecido muestra el aviso y la opción «sin enriquecer»
  const sel = t.$('li.estimar-ing select');
  await t.act(() => t.type(sel, '102', 'change'));
  assert.match(t.root.textContent, /Puede estar enriquecido/);
  await t.act(() => t.type(t.$('li.estimar-ing select'), '101', 'change'));
  assert.ok(!/Puede estar enriquecido/.test(t.root.textContent));
  await t.act(() => t.btn('Añadir a la comida').click());
  // detalle de USDA: una petición; vuelta a la confirmación con las líneas estimadas
  assert.deepEqual(t.calls.foods, [[101, 201]]);
  assert.equal(t.$$('li.card[data-key]').length, 5); // aceite + 4 ingredientes
  assert.match(t.root.textContent, /Estimado con IA: proporciones típicas/);
  assert.match(t.root.textContent, /Añadidos a tu documento: pasta de lasaña cocida, carne picada cocinada/);
  assert.ok(!t.root.textContent.includes('«300 g de lasaña»No está en tu documento'));
  // las filas nuevas ya están en el documento del dispositivo, marcadas para revisar
  const doc = await t.store.getCatalogRecord();
  const pasta = doc.foods.find((f) => f.id === 'pasta_de_lasana_cocida');
  assert.deepEqual([pasta.extra.tipo, pasta.extra.incluir, pasta.extra.fdc_id, pasta.extra.pendiente_revisar, pasta.nutrients.proteina_g], ['usda_app', 'si', '101', 'si', 5.8]);
  assert.ok(doc.extraHeaders.includes('pendiente_revisar'));
  // nada en el diario hasta Guardar
  assert.equal((await t.store.allMeals()).length, 0);
  await t.act(() => t.btn('Guardar').click());
  const [meal] = await t.store.allMeals();
  assert.deepEqual(meal.lines.map((l) => [l.food_id, l.grams]), [['aceite_oliva', 10], ['pasta_de_lasana_cocida', 120], ['carne_picada_cocinada', 80], ['salsa_tomate_frito', 60], ['queso_tierno_loncha', 40]]);
  // segunda vez: los términos ya están en la caché del iPhone (no se vuelve a USDA) y las filas se reutilizan
  await t.act(() => t.$('button[aria-label="Añadir comida"]').click()); // guardar lleva al Diario; el "+" vuelve al dictado
  await hastaEstimar(t);
  assert.equal(t.calls.search.length, 1);
  await t.act(() => t.btn('Añadir a la comida').click());
  assert.equal(t.calls.foods.length, 1);
  assert.equal((await t.store.getCatalogRecord()).foods.filter((f) => f.extra?.tipo === 'usda_app').length, 2);
});

test('«Guardar también como receta»: la receta queda en el documento y en el dispositivo; la comida, como ingredientes', { skip }, async () => {
  const t = await setup();
  await hastaEstimar(t);
  const casilla = t.$$('input[type=checkbox]').at(-1);
  casilla.checked = true;
  await t.act(() => casilla.dispatchEvent(new t.Event('change', { bubbles: true })));
  t.type(t.$('input[aria-label="Alias de la receta"]'), 'lasaña');
  assert.equal(t.$('input[aria-label="Nombre de la receta"]').value, 'Lasaña');
  await t.act(() => t.btn('Añadir a la comida').click());
  assert.match(t.root.textContent, /Receta «Lasaña» guardada/);
  const doc = await t.store.getCatalogRecord();
  const fila = doc.foods.find((f) => f.id === 'lasana');
  assert.deepEqual([fila.nombre, fila.alias, fila.estado, fila.extra.tipo], ['Lasaña', ['lasaña'], 'cocinado', 'receta']);
  assert.ok(fila.nutrients.energia_kcal > 0);
  const [def] = await t.store.getSetting('recetas');
  assert.deepEqual(def.ingredientes.map((i) => i.food_id), ['pasta_de_lasana_cocida', 'carne_picada_cocinada', 'salsa_tomate_frito', 'queso_tierno_loncha']);
  assert.equal(t.$$('li.card[data-key]').length, 5); // la comida sigue siendo sus ingredientes
});

test('errores: límite de la IA -> mensaje en la confirmación y la línea sigue sin resolver; fallo de USDA -> se puede reintentar', { skip }, async () => {
  const t = await setup({ estimate: new AiClientError('limite_de_uso', 'Se ha alcanzado el límite de uso gratuito de la IA.') });
  await hastaEstimar(t);
  assert.match(t.$('[role=alert]').textContent, /límite de uso gratuito/);
  assert.ok(t.btn('Estimar con IA'));
  const u = await setup({ busquedas: new AiClientError('limite_usda', 'USDA ha llegado a su límite de consultas.') });
  await hastaEstimar(u);
  assert.match(u.$('[role=alert]').textContent, /USDA ha llegado a su límite/);
  assert.match(u.root.textContent, /Sin buscar en USDA todavía/);
  assert.equal(u.btn('Añadir a la comida').disabled, true);
  await u.act(() => u.$$('li.estimar-ing button.secondary').find((b) => b.textContent === 'Buscar en USDA').click());
  assert.equal(u.calls.search.length, 2);
});

test('sin candidatos en USDA: «Usar uno de mi documento» resuelve el ingrediente', { skip }, async () => {
  const t = await setup({ busquedas: { [PASTA]: BUSQUEDAS[PASTA] } });
  await hastaEstimar(t);
  assert.match(t.root.textContent, /USDA no encontró nada con este término/);
  assert.equal(t.btn('Añadir a la comida').disabled, true);
  await t.act(() => t.$$('li.estimar-ing')[1].querySelector('button.link').click());
  await t.act(() => t.$$('button.pick').find((b) => b.textContent.startsWith('Solomillo')).click());
  assert.equal(t.btn('Añadir a la comida').disabled, false);
  await t.act(() => t.btn('Añadir a la comida').click());
  assert.deepEqual(t.calls.foods, [[101]]);
});

test('Alimentos: «Añadidos con IA, pendientes de revisar» y «Revisado» quita la marca', { skip }, async () => {
  const t = await setup();
  await hastaEstimar(t);
  await t.act(() => t.btn('Añadir a la comida').click());
  await t.act(() => t.btn('Volver').click());
  await t.act(() => t.btn('Alimentos').click());
  const det = t.$('details.pendientes-ia');
  assert.match(det.textContent, /Añadidos con IA, pendientes de revisar \(2\)/);
  await t.act(() => det.querySelector('button.link').click());
  assert.match(t.$('details.pendientes-ia').textContent, /\(1\)/);
  assert.equal((await t.store.getCatalogRecord()).foods.filter((f) => f.extra?.pendiente_revisar === 'si').length, 1);
});

test('Diario -> «Guardar como receta»: formulario con los ingredientes, cálculo en vivo, guardar y exportar recetas.json', { skip }, async () => {
  const meal = { id: 'c1', date: '2026-10-18', meal: 'comida', createdAt: NOW.toISOString(), text: '', lines: [{ food_id: 'arroz_blanco_crudo', grams: 100, source_text: '' }, { food_id: 'aceite_oliva', grams: 10, source_text: '' }] };
  const base = parseRecetas(readFile('../data/recetas.json')).recetas;
  const t = await setup({ meals: [meal], recetasBase: base });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => t.btn('Guardar como receta').click());
  assert.match(t.root.textContent, /Guardar como receta/);
  assert.equal(t.$$('main.recetas li.card').length, 2);
  assert.match(t.$('.receta-preview').textContent, /kcal por 100 g · \d+\/31 nutrientes obligatorios · peso 110 g → 110 g/);
  t.type(t.$('input[aria-label="Peso final del plato en gramos"]'), '330');
  assert.match(t.$('.receta-preview').textContent, /peso 110 g → 330 g/);
  await t.act(() => t.btn('Guardar receta').click());
  assert.match(t.$('[role=alert]').textContent, /ponle un nombre/);
  t.type(t.$('input[aria-label="Nombre de la receta"]'), 'Arroz blanco con aceite');
  t.type(t.$('input[aria-label="Alias de la receta"]'), 'arroz con aceite');
  await t.act(() => t.btn('Guardar receta').click());
  assert.match(t.root.textContent, /Receta «Arroz blanco con aceite» guardada .*Ya puedes dictar «arroz con aceite»/);
  const fila = (await t.store.getCatalogRecord()).foods.find((f) => f.id === 'arroz_blanco_con_aceite');
  assert.equal(fila.extra.tipo, 'receta');
  assert.ok(Math.abs(fila.nutrients.energia_kcal - (365 + 88.4) / 3.3) < 2); // (arroz + aceite) / 330 g × 100
  // Alimentos -> Recetas: las del repositorio (sin el ejemplo) y la nueva; exportar recetas.json
  await t.act(() => t.btn('Alimentos').click());
  await t.act(() => t.btn('Ver recetas').click());
  const ids = t.$$('li.receta').map((li) => li.dataset.id);
  assert.deepEqual(ids, ['verduras_asadas_hacendado', 'parrillada_verduras_hacendado', 'lentejas_caseras', 'arroz_blanco_con_aceite']);
  await t.act(() => t.btn('Exportar recetas.json').click());
  const json = parseRecetas(t.saved.at(-1).text);
  assert.deepEqual(json.errores, []);
  assert.equal(json.recetas.length, base.length + 1);
  // editar: no se anida una receta
  await t.act(() => t.$$('li.receta')[2].querySelector('button.link').click());
  await t.act(() => t.btn('+ Añadir ingrediente').click());
  t.type(t.$('.overlay input[type=search]'), 'parrillada');
  await t.act(() => t.$$('button.pick').find((b) => b.textContent.startsWith('Parrillada')).click());
  t.type(t.$$('main.recetas li.card input.grams').at(-1), '50');
  await t.act(() => t.btn('Guardar receta').click());
  assert.match(t.$('[role=alert]').textContent, /es una receta \(no se anidan/);
});

test('ingrediente que la IA manda a USDA y ya tienes («leche entera»): preseleccionado el tuyo, sin buscarlo; USDA como alternativa', { skip }, async () => {
  const leche = { origen: 'usda', termino: 'Milk, whole, 3.25% milkfat', nombre: 'leche entera', estado: 'procesado', gramos: 35 };
  const t = await setup({
    estimate: { ...ESTIMACION, ingredientes: [...ESTIMACION.ingredientes.slice(0, 3), { ...ESTIMACION.ingredientes[3], gramos: 5 }, leche] },
    busquedas: { ...BUSQUEDAS, 'Milk, whole, 3.25% milkfat': { termino: 'Milk, whole, 3.25% milkfat', estado: 'completo', motivo: 'm', sugerido: 301, candidatos: [CAND(301, 'Milk, whole, 3.25% milkfat')] } },
  });
  await hastaEstimar(t);
  assert.deepEqual(t.calls.search, [[PASTA, BEEF]]); // la leche no se busca en USDA
  assert.equal(t.$$('.origen.catalogo').length, 3);
  const card = t.$$('li.estimar-ing')[4];
  assert.match(card.textContent, /Leche entera.*Tu documento.*Preseleccionado de tu documento: la IA lo buscaba en USDA \(«Milk, whole, 3.25% milkfat»\)/);
  // «Usar USDA en su lugar»: una búsqueda; vuelve a USDA con su nombre y el tuyo queda como sugerencia
  await t.act(() => [...card.querySelectorAll('button')].find((b) => b.textContent === 'Usar USDA en su lugar').click());
  assert.deepEqual(t.calls.search, [[PASTA, BEEF], ['Milk, whole, 3.25% milkfat']]);
  assert.equal(t.$$('.origen.catalogo').length, 2);
  assert.equal(t.$$('li.estimar-ing')[4].querySelector('input[aria-label="Nombre en tu documento"]').value, 'leche entera');
  await t.act(() => t.btn('Usar «Leche entera» de tu documento').click());
  assert.equal(t.$$('.origen.catalogo').length, 3);
  await t.act(() => t.btn('Añadir a la comida').click());
  const [l] = t.$$('li.card[data-key]').filter((li) => li.textContent.includes('Leche entera'));
  assert.ok(l);
});

test('revisión: «Dato en crudo para un ingrediente cocinado» si el elegido de USDA es «raw» y el ingrediente está cocinado', { skip }, async () => {
  const SQUID = 'Mollusks, squid, mixed species, cooked';
  const t = await setup({
    estimate: { ...ESTIMACION, ingredientes: [{ origen: 'usda', termino: SQUID, nombre: 'calamar cocinado', estado: 'cocinado', gramos: 60 }, { ...ESTIMACION.ingredientes[2], gramos: 240 }] },
    busquedas: { [SQUID]: { termino: SQUID, estado: 'completo', motivo: 'm', sugerido: 401, candidatos: [CAND(401, 'Mollusks, squid, mixed species, raw'), CAND(402, 'Mollusks, squid, mixed species, cooked, fried', { preparaciones: ['fried'] })] } },
  });
  await hastaEstimar(t);
  const card = () => t.$$('li.estimar-ing')[0];
  assert.match(card().textContent, /Dato en crudo para un ingrediente cocinado: kcal y proteína algo subestimadas/);
  await t.act(() => { const sel = card().querySelector('select'); sel.value = '402'; sel.dispatchEvent(new t.Event('change', { bubbles: true })); });
  assert.ok(!/Dato en crudo/.test(card().textContent));
  assert.match(card().textContent, /Preparación que no pidió la IA: fried/);
  assert.equal(t.btn('Añadir a la comida').disabled, false); // solo avisa
});
