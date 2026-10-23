// Informe diario -> detalle de un nutriente del día (jsdom): todas las filas se pulsan (macros, micros, sumas, «sin referencia»),
// «Tu rango» con el total del día y los objetivos de ese día, «Qué te ha aportado hoy» (orden, %, sin dato, abre el alimento)
// y «Volver» con la posición de scroll del informe.
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
const por100 = (id, k) => realFoods.find((f) => f.id === id).nutrients[k];
const num = (texto) => Number(texto.match(/[\d.,]+/)[0].replace(/\./g, '').replace(',', '.'));
const FECHA_HOY = /^Hoy · vie,? 16 oct$/; const FECHA_AYER = /^Ayer · jue,? 15 oct$/; // según el ICU de Node lleva coma tras el día
const DIA = [
  MEAL('m0', '2026-10-16', 'desayuno', [['avena_copos', 80], ['almendras_crudas', 30]]),
  MEAL('m1', '2026-10-16', 'comida', [['salmon_atlantico', 150], ['refresco_sd', 200]]), // el refresco no tiene ningún dato
];

async function setup({ meals = DIA, foods = foodsConSinDatos, ajustes = {} } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  for (const [k, v] of Object.entries(ajustes)) await store.setSetting(k, v);
  const app = mountApp(root, {
    store, createAiClient: () => { throw new Error('sin IA en estos tests'); }, catalog, settings, targets: TARGETS, objetivos: {}, nutrientesInfo: INFO,
    initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn: {}, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async () => 'compartido',
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const ver = (nombre) => $(`button[aria-label="Ver detalle de ${nombre}"]`);
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const informe = async () => { await act(() => $('button[aria-label="Más opciones del día"]').click()); await act(() => btn('Ver informe diario').click()); };
  return { app, root, store, $, $$, btn, ver, act, informe };
}
const fila = (t, clave) => t.$(`main.informe li.nut[data-clave="${clave}"]`);
const abrir = (t, clave) => t.act(() => fila(t, clave).querySelector('button.abre-detalle').click());
const lineas = (t) => t.$$('.aportes-lista li').map((li) => li.textContent.replace(/ /g, ' ')); // los espacios duros (cifra + unidad) como normales
const fijaScroll = (t) => { // scroll controlable en jsdom
  let y = 0;
  Object.defineProperty(t.root.ownerDocument, 'scrollingElement', { configurable: true, value: { get scrollTop() { return y; }, set scrollTop(v) { y = v; } } });
  return { get: () => y, set: (v) => { y = v; } };
};

test('todas las filas del informe llevan su botón superpuesto (≥ 44 px, con nombre accesible): macros, micros, sumas y «sin referencia»', { skip }, async () => {
  const t = await setup();
  await t.informe();
  const filas = t.$$('main.informe li.nut');
  assert.ok(filas.length > 40);
  for (const li of filas) {
    const b = li.querySelector(':scope > button.abre-detalle');
    assert.ok(b, `fila ${li.dataset.clave}`);
    assert.equal(b.getAttribute('type'), 'button');
    assert.equal(b.getAttribute('aria-label'), `Ver detalle de ${li.querySelector('.nut-label').textContent}`);
  }
  for (const k of ['energia_kcal', 'proteina_g', 'calcio_mg', 'epa_dha', 'metionina_cistina', 'agua_g']) assert.ok(fila(t, k), k);
  assert.ok(fila(t, 'agua_g').classList.contains('nut-sin-ref'));
  assert.ok(t.$('main.informe details.plegable[open]'), 'los desplegables siguen');
  // el CSS: zona ≥ 44 px y fila de referencia posicionada
  const css = readFile('../frontend/css/detalle.css');
  assert.match(css, /\.abre-detalle \{ position:absolute; inset:0 -8px;[^}]*min-height:44px/);
  assert.match(css, /\.informe \.nut:not\(\.nut-sin-ref\) \{ min-height:44px; \}/); // las «sin referencia» conservan sus 50 px
  assert.match(css, /\.aportes-dia h2\.caps \{/); // mismo encabezado que «Qué es» o «En tu catálogo»
  assert.doesNotMatch(css, /\.aportes-lista \.abre-detalle/); // usa la regla base
  assert.match(readFile('../frontend/css/navegacion.css'), /\.nut \{ position:relative; \}/);
});

test('pulsar un macro, la energía, un micro, una suma y una fila «sin referencia» abre su detalle del día', { skip }, async () => {
  const t = await setup();
  await t.informe();
  for (const [clave, titulo] of [['proteina_g', 'Proteína'], ['energia_kcal', 'Energía'], ['calcio_mg', 'Calcio'], ['epa_dha', 'EPA + DHA'], ['metionina_cistina', 'Metionina + cistina'], ['agua_g', 'Agua']]) {
    await abrir(t, clave);
    assert.ok(t.$('main.detalle-nutriente'), clave);
    assert.equal(t.$('header.top .title-block strong').textContent, titulo, clave);
    assert.match(t.$('header.top .title-block small').textContent, FECHA_HOY, clave);
    assert.equal(t.$('.rango-tabla tr[data-fila="alimento"]'), null, `${clave}: no hay «Este alimento»`);
    assert.ok(t.$('.aportes-dia'), clave);
    await t.act(() => t.btn('‹ Volver').click());
    assert.ok(t.$('main.informe'), `${clave}: vuelve al informe`);
  }
});

test('detalle de proteína del día: rango con el total del día y el objetivo, y «Qué te ha aportado hoy» de más a menos con % y sin dato al final', { skip }, async () => {
  const t = await setup();
  await t.informe();
  await abrir(t, 'proteina_g');
  const av = por100('avena_copos', 'proteina_g') * 0.8;
  const al = por100('almendras_crudas', 'proteina_g') * 0.3;
  const sa = por100('salmon_atlantico', 'proteina_g') * 1.5;
  const total = av + al + sa;
  assert.equal(t.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas hoy (parcial)'); // el refresco no tiene dato de proteína
  assert.ok(Math.abs(num(t.$('.rango-tabla tr[data-fila="hoy"] td').textContent) - total) < 0.06, 'el total del día');
  assert.ok(t.$('.rango-tabla tr[data-fila="objetivo"]') || t.$('.rango-tabla tr[data-fila="min"]'), 'con el objetivo del día');
  assert.ok(t.$('.rango-barra .rango-aporte'));
  assert.equal(t.$('.rango-barra .rango-otros'), null);
  assert.equal(t.$('.ley-otros'), null);
  assert.match(t.$('.ley-aporte').textContent, /^Llevas hoy \(parcial\) · \d+ % del objetivo$/);
  assert.equal(t.$('.aportes-dia h2').textContent, 'Qué te ha aportado hoy');
  const esperado = [['Salmón del Atlántico de piscifactoría crudo', 'Comida', 150, sa], ['Avena (copos/molida)', 'Desayuno', 80, av], ['Almendras crudas', 'Desayuno', 30, al]].sort((a, b) => b[3] - a[3]);
  const L = lineas(t);
  assert.equal(L.length, 4);
  esperado.forEach(([nombre, comida, g, v], i) => {
    assert.ok(L[i].startsWith(`${nombre} · ${comida} · ${g} g → `), L[i]);
    assert.match(L[i], /→ [\d,.]+ g \(\d+ % del total del día\)$/);
    assert.equal(L[i].match(/\((\d+) %/)[1], String(Math.round((v / total) * 100)));
  });
  assert.equal(L[3], 'Refresco de prueba · Comida · 200 g → sin dato'); // al final y sin 0 inventado
  assert.ok(t.$$('.aportes-lista li')[3].classList.contains('sin-dato'));
  // «En tu catálogo» y aviso sanitario como siempre
  assert.ok(t.$('.catalogo-top'));
  assert.equal(t.$('.aviso-sanitario').textContent, 'Información general; no sustituye al consejo de un profesional sanitario.');
});

test('una suma (EPA + DHA) suma las partes de cada alimento; sin sus partes, sin dato', { skip }, async () => {
  const t = await setup();
  await t.informe();
  await abrir(t, 'epa_dha');
  assert.ok(por100('salmon_atlantico', 'epa_g') > 0 && por100('salmon_atlantico', 'dha_g') > 0);
  const L = lineas(t);
  assert.ok(L[0].startsWith('Salmón del Atlántico de piscifactoría crudo · Comida · 150 g → '));
  assert.match(L[0], /\(100 % del total del día\)$/); // el único que aporta
  assert.ok(L.some((x) => x.startsWith('Refresco de prueba') && x.endsWith('sin dato')));
  assert.ok(t.$('.rango-tabla'));
});

test('UL superado en el día: aviso con texto y la barra en rojo', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'cena', [['queso_tierno_loncha', 400]])], foods: realFoods });
  await t.informe();
  await abrir(t, 'calcio_mg');
  assert.match(t.$('.ul-aviso').textContent, /^⚠ Supera el máximo tolerable \(UL: 2500 mg\)$/);
  assert.ok(t.$('.rango-aporte.sobre'));
  assert.ok(t.$('.marca-ul'));
  assert.equal(lineas(t).length, 1);
});

test('«Volver» regresa al informe en la misma posición de scroll', { skip }, async () => {
  const t = await setup();
  const y = fijaScroll(t);
  y.set(310);
  await t.informe();
  y.set(1800);
  await abrir(t, 'calcio_mg');
  assert.equal(y.get(), 0, 'el detalle empieza arriba');
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('main.informe'));
  assert.equal(y.get(), 1800);
});

test('abrir un alimento desde «Qué te ha aportado hoy»: sus gramos de esa línea; Volver vuelve al nutriente del día y de ahí al informe, con el scroll de cada uno', { skip }, async () => {
  const t = await setup();
  const y = fijaScroll(t);
  await t.informe();
  y.set(1200);
  await abrir(t, 'proteina_g');
  y.set(450); // desplazado dentro de «Qué te ha aportado hoy»
  await t.act(() => t.ver('Avena (copos/molida)').click());
  assert.ok(t.$('main.detalle'));
  assert.equal(y.get(), 0);
  assert.equal(t.$('input.detalle-cantidad').value, '80');
  assert.equal(t.$('header.top .title-block strong').textContent, 'Avena (copos/molida)');
  assert.match(t.$('header.top .title-block small').textContent, /Desayuno/);
  // desde ahí se puede abrir un nutriente del alimento y volver
  await t.act(() => t.ver('Calcio').click());
  assert.ok(t.$('.rango-tabla tr[data-fila="alimento"]'), 'detalle de nutriente desde un alimento: como siempre');
  assert.equal(t.$('header.top .title-block small').textContent, 'Avena (copos/molida)');
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('main.detalle'));
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.aportes-dia'), 'de vuelta al detalle del nutriente del día');
  assert.match(t.$('header.top .title-block small').textContent, FECHA_HOY);
  assert.equal(y.get(), 450);
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('main.informe'));
  assert.equal(y.get(), 1200);
  // y nada se guardó
  assert.deepEqual((await t.store.allMeals()).flatMap((m) => m.lines.map((l) => l.grams)).sort((a, b) => a - b), [30, 80, 150, 200]);
});

test('un alimento sin dato también abre su detalle; uno borrado del documento no', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m0', '2026-10-16', 'comida', [['refresco_sd', 200], ['ya_no_existe', 40], ['avena_copos', 80]])] });
  await t.informe();
  await abrir(t, 'proteina_g');
  assert.ok(t.ver('Refresco de prueba'));
  assert.equal(t.ver('ya_no_existe'), null);
  assert.ok(lineas(t).some((x) => x.startsWith('ya_no_existe · Comida · 40 g → sin dato')));
  await t.act(() => t.ver('Refresco de prueba').click());
  assert.equal(t.$('input.detalle-cantidad').value, '200');
});

test('informe de un día pasado: el detalle usa los objetivos de ese día y dice «Llevas ese día»', { skip }, async () => {
  const plan = { tipo: 'plan_objetivos', version: 1, nombre: 'Prueba', periodos: [
    { id: 'a', nombre: 'Antes', inicio: '2026-10-01', fin: '2026-10-15', valores: { proteina_g: { unidad: 'g', objetivo: 100 } } },
    { id: 'b', nombre: 'Ahora', inicio: '2026-10-16', valores: { proteina_g: { unidad: 'g', objetivo: 200 } } },
  ] };
  const t = await setup({ ajustes: { plan_objetivos: plan }, meals: [...DIA, MEAL('m9', '2026-10-15', 'cena', [['avena_copos', 100]])] });
  await t.informe();
  await abrir(t, 'proteina_g');
  assert.equal(t.$('.rango-tabla tr[data-fila="objetivo"] td').textContent, '200 g');
  assert.match(t.$('.objetivos-dia').textContent, /Ahora/);
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.btn('‹ Volver').click()); // informe -> Diario
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  await t.informe();
  await abrir(t, 'proteina_g');
  assert.match(t.$('header.top .title-block small').textContent, FECHA_AYER);
  assert.equal(t.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas ese día');
  assert.equal(t.$('.rango-tabla tr[data-fila="objetivo"] td').textContent, '100 g');
  assert.match(t.$('.objetivos-dia').textContent, /Antes/);
  assert.equal(t.$('.aportes-dia h2').textContent, 'Qué te aportó ese día');
  const L = lineas(t);
  assert.equal(L.length, 1);
  assert.ok(L[0].startsWith('Avena (copos/molida) · Cena · 100 g → '));
  assert.match(L[0], /\(100 % del total del día\)$/);
});

test('la tira de UL, los totales parciales y los desplegables del informe siguen funcionando; el detalle de nutriente desde un alimento no cambia', { skip }, async () => {
  // bizcocho: tiene datos pero no kcal ni proteína (sin dato de ese nutriente, no 0)
  const p = realFoods.find((f) => f.id === 'pasta_seca');
  const bizcocho = { ...p, id: 'bizcocho', nombre: 'Bizcocho', extra: {}, nutrients: { ...p.nutrients, energia_kcal: null, proteina_g: null } };
  const t = await setup({ foods: [...realFoods, bizcocho], meals: [MEAL('m0', '2026-10-16', 'cena', [['queso_tierno_loncha', 400], ['bizcocho', 60], ['pasta_seca', 80]])] });
  await t.informe();
  assert.match(t.$('.alert-strip').textContent, /Máximo tolerable \(UL\) superado: .*Calcio/);
  assert.ok(t.$('.parciales-informe'));
  const det = t.$('details.plegable'); det.open = false;
  assert.equal(det.open, false);
  // la proteína del día es parcial: el bizcocho sale al final como «sin dato»
  await abrir(t, 'proteina_g');
  const L = lineas(t);
  assert.equal(L.length, 3);
  assert.equal(L[2], 'Bizcocho · Cena · 60 g → sin dato');
  assert.ok(!L[0].includes('sin dato') && !L[1].includes('sin dato'));
  // desde un alimento (Alimentos -> Mi catálogo) sigue el detalle con «Este alimento»
  await t.act(() => t.btn('Alimentos').click());
  await t.act(() => t.btn('Ver catálogo').click());
  await t.act(() => t.ver('Aceite de oliva').click());
  await t.act(() => t.ver('Calcio').click());
  assert.ok(t.$('.rango-tabla tr[data-fila="alimento"]'));
  assert.equal(t.$('.aportes-dia'), null);
  assert.equal(t.$('header.top .title-block small').textContent, 'Aceite de oliva');
});

test('regla 4: con faltas, la cifra del día dice «(parcial)» en tabla, leyenda y barra; sin faltas no; las líneas llevan espacio duro', { skip }, async () => {
  const parcial = await setup({ foods: realFoods, meals: [MEAL('m0', '2026-10-16', 'comida', [['salmon_atlantico', 150], ['pan_molde_blanco', 60]])] });
  await parcial.informe();
  await abrir(parcial, 'metionina_cistina');
  assert.equal(parcial.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas hoy (parcial)');
  assert.match(parcial.$('.ley-aporte').textContent, /^Llevas hoy \(parcial\) · /);
  assert.ok(parcial.$('.rango-sin-ref'), 'sin peso en el plan no hay referencia ni barra: la línea «sin referencia» también lo dice');
  assert.match(parcial.$('.rango-sin-ref .ley-aporte').textContent, /^Llevas hoy \(parcial\) · [\d,.]+ g$/); // aminoácido sin peso en el plan: «falta tu peso en Objetivos»
  assert.ok(lineas(parcial).some((x) => x.startsWith('Pan de molde blanco') && x.endsWith('sin dato')));
  // cifra, unidad y % no se parten
  const con = parcial.$('.aportes-lista li.con-dato').textContent;
  assert.match(con, /\d g/);
  assert.match(con, /\d %/);
  // proteína con un alimento sin dato de proteína, igual
  const p = realFoods.find((f) => f.id === 'pasta_seca');
  const biz = { ...p, id: 'bizcocho', nombre: 'Bizcocho', extra: {}, nutrients: { ...p.nutrients, energia_kcal: null, proteina_g: null } };
  const t2 = await setup({ foods: [...realFoods, biz], meals: [MEAL('m0', '2026-10-16', 'cena', [['pasta_seca', 80], ['bizcocho', 60]])] });
  await t2.informe();
  await abrir(t2, 'proteina_g');
  assert.equal(t2.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas hoy (parcial)');
  assert.match(t2.$('.rango-barra').getAttribute('aria-label'), /^Proteína: llevas hoy \(parcial\) /); // la barra, también
  // sin faltas: sin «(parcial)»
  const completo = await setup({ foods: realFoods, meals: [MEAL('m0', '2026-10-16', 'comida', [['salmon_atlantico', 150]])] });
  await completo.informe();
  await abrir(completo, 'metionina_cistina');
  assert.equal(completo.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas hoy');
  assert.doesNotMatch(completo.$('.ley-aporte').textContent, /parcial/);
  assert.doesNotMatch(completo.$('.rango-sin-ref').textContent, /parcial/);
  // día pasado
  const t3 = await setup({ foods: realFoods, meals: [MEAL('m0', '2026-10-15', 'comida', [['salmon_atlantico', 150], ['pan_molde_blanco', 60]])] });
  await t3.act(() => t3.$('button[aria-label="Día anterior"]').click());
  await t3.informe();
  await abrir(t3, 'metionina_cistina');
  assert.equal(t3.$('.rango-tabla tr[data-fila="hoy"] th').textContent, 'Llevas ese día (parcial)');
});
