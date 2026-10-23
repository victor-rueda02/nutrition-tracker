// Detalle de alimento y de nutriente (jsdom): desde Mi catálogo y desde el Diario, cantidad, porciones, «Guardar» de una línea,
// sin dato frente a 0, detalle de un nutriente, «Volver» con la misma cantidad y la entrada sin información.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { realFoods, catalog, settings, readFile, foodsConSinDatos } from './helpers.js';

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
  assert.match(t.$('.detalle-fuente').textContent, /Fuente de datos: Etiqueta del producto/);
  assert.match(t.$('.detalle-comp').textContent, /^\d+\/31 nutrientes obligatorios con dato/);
  assert.match(t.$('.detalle-fuente-completa p').textContent, /Oil, olive/);
  assert.deepEqual([...t.$('select.detalle-porcion').options].map((o) => o.textContent), ['g', '1 cucharada (13,5 g)', '1 cucharadita (4,5 g)']);
  // resumen de energía y macros: valor / objetivo, % y barra
  const kcal = t.$('.detalle-resumen [data-clave="energia_kcal"]');
  assert.match(kcal.querySelector('.nut-valor').textContent, /903 kcal/);
  assert.match(kcal.querySelector('.nut-valor').textContent, /2000 kcal/);
  assert.match(kcal.querySelector('.nut-pct').textContent, /45 %/);
  assert.ok(kcal.querySelector('.meter'));
  assert.deepEqual(t.$$('.detalle-resumen .nut').map((x) => x.dataset.clave), ['energia_kcal', 'proteina_g', 'hidratos_g', 'grasa_total_g']);
  // todos los nutrientes, por grupos
  assert.deepEqual(t.$$('.detalle-todos .grupo h3').map((x) => x.textContent), ['General', 'Hidratos', 'Lípidos', 'Proteínas y aminoácidos', 'Vitaminas', 'Minerales']);
  assert.equal(t.$$('.detalle-todos .nut').length, catalog.list.length + 1); // + EPA + DHA
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
  assert.match(fila(t, 'energia_kcal').querySelector('.nut-valor').textContent, /339 kcal/); // 903,3 × 37,5 / 100 = 338,7
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
  const t = await setup({ foods: foodsConSinDatos }); // fixture: el catálogo real ya no tiene alimentos sin datos
  await t.alCatalogo();
  await t.act(() => t.ver('Refresco de prueba').click());
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
  assert.ok(filas.includes('min') && !filas.includes('referencia')); // mínimo y referencia valen lo mismo (950): una fila
  assert.equal(t.$('.rango-tabla tr[data-fila="min"] th').textContent, 'Mínimo (referencia)');
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
  assert.match(fila(t, 'energia_kcal').querySelector('.nut-valor').textContent, /307 kcal/); // 384 × 80 / 100
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
  assert.match(hoy, /98 mg/); // otros alimentos 72 (almendras 30 g) + este alimento con la cantidad nueva (50 g = 26)
  assert.equal(t.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas hoy (con esta cantidad)');
  assert.equal(t.$('.ley-otros').textContent, 'Llevas hoy (sin este alimento)');
  assert.match(t.$('.ley-aporte').textContent, /^Este alimento · \d+ % del objetivo$/);
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

test('UL superado en el detalle de nutriente: aviso con texto (no solo color) y marca UL; sin superarlo, no hay aviso', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Queso tierno en lonchas').click());
  t.type(t.$('input.detalle-cantidad'), '100'); // 731 mg de calcio: dentro del UL (2500 mg)
  await t.act(() => t.ver('Calcio').click());
  assert.equal(t.$('.ul-aviso'), null);
  await t.act(() => t.btn('‹ Volver').click());
  t.type(t.$('input.detalle-cantidad'), '400'); // 2924 mg > 2500 mg
  await t.act(() => t.ver('Calcio').click());
  const aviso = t.$('.ul-aviso');
  assert.ok(aviso);
  assert.equal(aviso.textContent, '⚠ Supera el máximo tolerable (UL: 2500\u00a0mg)'); // espacio duro: «mg)» no queda suelto en una línea
  assert.equal(aviso.getAttribute('role'), 'alert');
  assert.ok(t.$('.rango-aporte.sobre'));
  assert.ok(t.$('.marca-ul .marca-et'));
  assert.equal(t.$('.marca-ul .marca-et').textContent, 'UL');
  // mínimo y referencia valen lo mismo: una sola marca con una sola etiqueta
  assert.deepEqual(t.$$('.marca-et').map((x) => x.textContent), ['Mín. y ref.', 'UL']);
});

test('secciones plegables como el informe (abiertas) y grupos plegables; lo cerrado se recuerda al cambiar la cantidad', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Aceite de oliva').click());
  for (const s of ['.detalle-resumen', '.detalle-todos']) {
    const det = t.$(s);
    assert.equal(det.tagName, 'DETAILS'); assert.ok(det.classList.contains('plegable')); assert.ok(det.open);
    assert.equal(det.querySelector(':scope > summary > h2').tagName, 'H2');
  }
  const grupos = t.$$('.detalle-todos details.grupo');
  assert.deepEqual(grupos.map((g) => g.querySelector('summary h3').textContent), ['General', 'Hidratos', 'Lípidos', 'Proteínas y aminoácidos', 'Vitaminas', 'Minerales']);
  assert.ok(grupos.every((g) => g.open));
  const lip = t.$('.grupo[data-grupo="lipidos"]');
  lip.open = false; lip.dispatchEvent(new t.root.ownerDocument.defaultView.Event('toggle'));
  t.type(t.$('input.detalle-cantidad'), '50');
  assert.equal(t.$('.grupo[data-grupo="lipidos"]').open, false);
  assert.equal(t.$('.grupo[data-grupo="vitaminas"]').open, true);
});

test('filas sin objetivo: el valor va en la columna del % (borde derecho); subpartidas con sangría; fila EPA + DHA con barra', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Salmón del Atlántico de piscifactoría crudo').click());
  const mono = fila(t, 'grasas_monoinsaturadas_g');
  assert.ok(mono.classList.contains('nut-simple'));
  assert.ok(mono.querySelector('.nut-head > .nut-pct .nut-valor'), 'valor en la columna del %');
  assert.equal(mono.querySelector('.nut-head > .nut-main .nut-valor'), null);
  for (const k of ['grasas_saturadas_g', 'grasas_monoinsaturadas_g', 'epa_g', 'dha_g', 'azucares_g']) assert.ok(fila(t, k).classList.contains('sub'), k);
  assert.ok(!fila(t, 'grasa_total_g').classList.contains('sub'));
  const suma = t.$('.detalle-todos [data-clave="epa_dha"]');
  assert.ok(suma, 'fila EPA + DHA');
  assert.match(suma.querySelector('.nut-label').textContent, /EPA \+ DHA/);
  assert.ok(suma.querySelector('.meter'));
  assert.match(suma.querySelector('.nut-pct').textContent, /\d+ %/);
  // y se abre su detalle
  await t.act(() => t.ver('EPA + DHA').click());
  assert.equal(t.$('header.top strong').textContent, 'EPA + DHA');
  assert.ok(t.$('.rango-tabla'));
  assert.ok(t.$$('.top-lista li').length > 0);
});

test('lo muy pequeño no se confunde con un 0: EPA del chorizo a 123 g (0,00246 g) se ve «<0,01 g»', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'comida', [['chorizo', 123]])] });
  await t.act(() => t.ver('Chorizo').click());
  assert.equal(fila(t, 'epa_g').querySelector('.nut-valor').textContent, '<0,01 g');
  assert.equal(fila(t, 'dha_g').querySelector('.nut-valor').textContent, '<0,01 g');
  assert.equal(fila(t, 'vitamina_b12_ug').querySelector('.nut-valor').textContent.startsWith('<'), false);
  // un 0 real sigue siendo 0
  const aceite = await setup();
  await aceite.alCatalogo();
  await aceite.act(() => aceite.ver('Aceite de oliva').click());
  assert.match(fila(aceite, 'vitamina_b12_ug').querySelector('.nut-valor').textContent, /^0 µg/);
});

test('un día pasado dice «Llevas ese día» (y hoy, «Llevas hoy»)', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-15', 'cena', [['avena_copos', 80]])] });
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  await t.act(() => t.ver('Avena (copos/molida)').click());
  await t.act(() => t.ver('Calcio').click());
  assert.equal(t.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas ese día');
  assert.equal(t.$('.ley-otros'), null); // sin otros alimentos ese día: solo «Este alimento»
  assert.ok(t.$('.ley-aporte'));
});

test('«Volver» restaura la posición de scroll en la que estaba el Diario o Mi catálogo', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'desayuno', [['avena_copos', 80]])] });
  const doc = t.root.ownerDocument;
  let y = 0;
  Object.defineProperty(doc, 'scrollingElement', { configurable: true, value: { get scrollTop() { return y; }, set scrollTop(v) { y = v; } } });
  y = 420; // el Diario, desplazado
  await t.act(() => t.ver('Avena (copos/molida)').click());
  assert.equal(y, 0, 'el detalle empieza arriba');
  y = 900;
  await t.act(() => t.ver('Calcio').click());
  assert.equal(y, 0);
  await t.act(() => t.btn('‹ Volver').click());
  assert.equal(y, 900, 'del nutriente vuelve a donde estaba el detalle');
  await t.act(() => t.btn('‹ Volver').click());
  assert.equal(y, 420, 'del detalle vuelve a donde estaba el Diario');
  // y desde Mi catálogo
  await t.alCatalogo();
  y = 640;
  await t.act(() => t.ver('Aceite de oliva').click());
  await t.act(() => t.btn('‹ Volver').click());
  assert.equal(y, 640);
  assert.ok(t.$('main.catalogo-lista'));
});

// ---------- UL informativo (vitamina A y folato), EPA + DHA ----------
test('UL informativo en el detalle de nutriente: vitamina A a 500 g de zanahoria (4175 µg) no avisa, sin marca UL, con su nota', { skip }, async () => {
  const t = await setup();
  await t.alCatalogo();
  await t.act(() => t.ver('Zanahoria cruda').click());
  t.type(t.$('input.detalle-cantidad'), '500');
  await t.act(() => t.ver('Vitamina A (RAE)').click());
  assert.match(t.$('.rango-tabla tr[data-fila="alimento"] td').textContent, /4175 µg/);
  assert.equal(t.$('.ul-aviso'), null);
  assert.equal(t.$('.marca-ul'), null); // la marca del UL informativo no se dibuja
  assert.ok(!t.$('.rango-aporte').classList.contains('sobre'));
  assert.equal(t.$('.rango-tabla tr[data-fila="ul"] th').textContent, 'UL (informativo)');
  assert.match(t.$('.rango-tabla tr[data-fila="ul"] td').textContent, /^3000 µg$/);
  assert.match(t.$('.nota-ul-info').textContent, /solo para retinol preformado.*no se aplica al total con carotenos/);
});

test('EPA + DHA: su detalle muestra la información de EPA y de DHA (y las fuentes una sola vez), no «aún no disponible»', { skip }, async () => {
  const parte = (n) => ({ resumen: `Qué es ${n}.`, exceso: `Si sobra ${n}.`, referencias: [{ organismo: 'EFSA', titulo: 'Omega-3', url: 'https://www.efsa.europa.eu/en/press/news/120727', consultado: '2026-10-21' }] });
  const t = await setup({ info: { nutrientes: { epa_g: parte('EPA'), dha_g: parte('DHA') } } });
  await t.alCatalogo();
  await t.act(() => t.ver('Salmón del Atlántico de piscifactoría crudo').click());
  await t.act(() => t.ver('EPA + DHA').click());
  assert.equal(t.$('.info-no-disponible'), null);
  assert.deepEqual(t.$$('.info-seccion h2').map((x) => x.textContent), ['EPA: Qué es', 'EPA: Si sobra', 'DHA: Qué es', 'DHA: Si sobra', 'Fuentes consultadas']);
  assert.equal(t.$$('.fuentes a').length, 1);
  // sin información de ninguna de las partes sigue diciendo que no está
  const t2 = await setup();
  await t2.alCatalogo();
  await t2.act(() => t2.ver('Salmón del Atlántico de piscifactoría crudo').click());
  await t2.act(() => t2.ver('EPA + DHA').click());
  assert.match(t2.$('.info-no-disponible').textContent, /aún no disponible/);
});

test('cabecera del detalle de alimento: con o sin subtítulo, el título va en el mismo bloque centrado (con elipsis)', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'desayuno', [['avena_copos', 80]])] });
  await t.act(() => t.ver('Avena (copos/molida)').click()); // desde el Diario: con subtítulo
  assert.ok(t.$('header.top > .title-block > strong'));
  assert.ok(t.$('header.top .title-block small'));
  await t.act(() => t.btn('‹ Volver').click());
  await t.alCatalogo();
  await t.act(() => t.ver('Salmón del Atlántico de piscifactoría crudo').click()); // desde el catálogo: sin subtítulo
  assert.equal(t.$('header.top > strong'), null);
  assert.equal(t.$('header.top > .title-block > strong').textContent, 'Salmón del Atlántico de piscifactoría crudo');
  assert.equal(t.$('header.top .title-block small'), null);
});
