// ¿Qué ceno? en la interfaz (jsdom): las dos entradas del Diario, la pantalla, «Añadir a la cena» (confirmación editable,
// nada se guarda hasta «Guardar») y «Más ideas» (una llamada, cuerpo mínimo, errores). IA simulada: nunca hay llamadas reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { createAiClient } from '../frontend/js/ai-client.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';
import { foodSinDatos } from '../frontend/js/core/completeness.js';
import { hashText } from '../frontend/js/core/catalog-update.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const SEMILLA = JSON.parse(readFile('../data/cenas-semilla.json'));
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z'); // 09:30 en Madrid
const AYER = '2026-10-15';
const MEAL = (id, date, meal, lines) => ({ id, date, meal, createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const DIA_AYER = [
  MEAL('a1', AYER, 'desayuno', [['avena_copos', 50], ['leche_entera', 200]]),
  MEAL('a2', AYER, 'comida', [['arroz_blanco_crudo', 90], ['pechuga_pollo_cruda', 160], ['aceite_oliva', 15], ['brocoli', 120]]),
  MEAL('a3', AYER, 'merienda', [['yogur_griego_natural', 125], ['manzana_con_piel', 150], ['pan_blanco_barra', 60]]),
];
const IDEAS = { cenas: [
  { nombre: 'Pollo con arroz y brócoli', lineas: [{ food_id: 'pechuga_pollo_cruda', gramos: 180 }, { food_id: 'arroz_blanco_crudo', gramos: 90 }, { food_id: 'brocoli', gramos: 150 }] },
  { nombre: 'Inventada', lineas: [{ food_id: 'nada_de_nada', gramos: 100 }] },
], warnings: [] };

const sinRolCena = realFoods.map((f) => { const { rol_cena, ...extra } = f.extra ?? {}; return { ...f, extra }; }); // un documento antiguo, sin la columna

async function setup({ meals = DIA_AYER, createAiClient: crear = () => ({}), semilla = SEMILLA, foods = realFoods, fetchPublished, recetasBase = [] } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  const app = mountApp(root, {
    store, createAiClient: crear, catalog, settings, targets: TARGETS, objetivos: {}, semilla, recetasBase,
    ...(fetchPublished ? { fetchPublished } : {}),
    initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn: { endpoint: 'https://w', token: 't' }, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async () => 'compartido',
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const ayer = () => act(() => $('button[aria-label="Día anterior"]').click());
  return { app, root, store, $, $$, btn, act, type, ayer };
}

test('la tarjeta de Cena del Diario tiene «¿Qué ceno?»; ninguna otra tarjeta de comida lo tiene', { skip }, async () => {
  const t = await setup();
  const botones = t.$$('.que-ceno');
  assert.equal(botones.length, 1);
  assert.equal(botones[0].closest('section.meal').dataset.meal, 'cena');
  for (const meal of ['desayuno', 'comida', 'merienda']) assert.equal(t.$(`section.meal[data-meal="${meal}"] .que-ceno`), null, meal);
  assert.equal(botones[0].textContent, '¿Qué ceno?');
  assert.ok(botones[0].querySelector('svg.ico-spark')); // icono spark
  assert.equal(t.$('nav.tabbar button.tab.active').textContent, 'Diario');
});

test('«¿Qué ceno?» de la tarjeta abre la pantalla para el día mostrado (otro distinto de hoy); «‹ Volver» vuelve a ese día', { skip }, async () => {
  const t = await setup();
  await t.ayer();
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  await t.act(() => t.$('.que-ceno').click());
  assert.ok(t.$('main.cenas'));
  assert.match(t.$('header.top').textContent, /¿Qué ceno\?/);
  assert.match(t.$('header.top').textContent, /Ayer/);
  assert.equal(t.app.state.cenas.fecha, AYER);
  assert.equal(t.$$('.cena-prop').length, 3);
  assert.ok(t.$('.cenas-falta'));
  // bloque «Te falta» con kcal y los tres macros (con data-clave: el color fijo de cada macro)
  assert.deepEqual(t.$$('.falta-macro').map((x) => x.dataset.clave), ['energia_kcal', 'proteina_g', 'hidratos_g', 'grasa_total_g']);
  // la barra inferior se ve con Diario activo
  assert.equal(t.$('nav.tabbar button.tab.active').textContent, 'Diario');
  // cada tarjeta: líneas con nombre, gramos y kcal; macros; «Completa»; botón
  const primera = t.$$('.cena-prop')[0];
  assert.ok(primera.querySelectorAll('.lines .line .line-name').length >= 3);
  assert.ok(primera.querySelector('.line-grams') && primera.querySelector('.line-kcal') && primera.querySelector('.sep'));
  assert.match(primera.textContent, /kcal · .* g proteína/);
  assert.match(primera.textContent, /Completa: /);
  assert.equal(primera.querySelector('button.primary').textContent, 'Añadir a la cena');
  await t.act(() => t.btn('‹ Volver').click());
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  assert.equal(t.$('main.cenas'), null);
  assert.equal((await t.store.allMeals()).length, DIA_AYER.length); // ver las propuestas no guarda nada
});

test('«¿Qué ceno?» de los tres puntos abre la pantalla para el día mostrado', { skip }, async () => {
  const t = await setup();
  await t.ayer();
  await t.act(() => t.$('button[aria-label="Más opciones del día"]').click());
  assert.deepEqual(t.$$('.popmenu button').map((b) => b.textContent), ['Ver informe diario', 'Copiar día anterior', '¿Qué ceno?', 'Ir a hoy']);
  await t.act(() => t.$$('.popmenu button').find((b) => b.textContent === '¿Qué ceno?').click());
  assert.ok(t.$('main.cenas'));
  assert.equal(t.app.state.cenas.fecha, AYER);
  assert.equal(t.$('.popmenu'), null);
  // en el día de hoy también (y avisa de que no hay nada registrado)
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.$('button[aria-label="Día siguiente"]').click());
  await t.act(() => t.$('.que-ceno').click());
  assert.equal(t.app.state.cenas.fecha, '2026-10-16');
  assert.match(t.$('header.top').textContent, /Hoy/);
  assert.ok(t.$$('.cenas-avisos li').some((li) => li.dataset.aviso === 'dia_vacio'));
});

test('el código nuevo no menciona Inicio ni la pantalla home', () => {
  for (const f of ['js/ui/cenas-screen.js', 'js/core/cenas.js', 'js/core/cenas-validate.js', 'css/cenas.css']) {
    const src = readFile(`../frontend/${f}`).replace(/^\s*(\/\/|\/\*).*$/gm, '');
    assert.doesNotMatch(src, /\bhome\b|Inicio/, f);
  }
  const app = readFile('../frontend/js/ui/app.js');
  const nuevas = app.split('\n').filter((l) => /cenas|¿Qué ceno/.test(l)).join('\n');
  assert.doesNotMatch(nuevas, /'home'|Inicio/);
});

test('«Añadir a la cena» abre la confirmación con meal=cena, la fecha del día y los gramos; no guarda hasta «Guardar»', { skip }, async () => {
  const t = await setup();
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  const p = t.app.state.cenas.resultado.propuestas[0];
  await t.act(() => t.$$('.cena-prop')[0].querySelector('button.primary').click());
  assert.ok(!t.$('main.cenas'));
  assert.equal(t.$('nav.tabbar'), null); // la confirmación lleva su propia barra
  assert.equal(t.$('.chip[aria-pressed="true"]').textContent, 'Cena');
  const gramos = t.$$('input.grams').map((i) => Number(i.value.replace(',', '.')));
  assert.deepEqual(gramos, p.lineas.map((l) => l.gramos));
  assert.deepEqual(t.$$('.card .name').map((b) => b.textContent), p.lineas.map((l) => l.nombre));
  assert.match(t.$('.dictada').textContent, /¿Qué ceno\?/);
  assert.equal((await t.store.allMeals()).length, DIA_AYER.length); // todavía nada guardado
  // «‹ Volver» regresa a las propuestas, sin guardar
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('main.cenas'));
  assert.equal(t.$$('.cena-prop').length, 3);
  assert.equal((await t.store.allMeals()).length, DIA_AYER.length);
  // otra vez: se puede editar (gramos) y guardar; queda en el diario del día mostrado
  await t.act(() => t.$$('.cena-prop')[0].querySelector('button.primary').click());
  t.type(t.$$('input.grams')[0], '111');
  await t.act(() => t.btn('Guardar').click());
  const nuevas = (await t.store.allMeals()).filter((m) => !DIA_AYER.some((x) => x.id === m.id));
  assert.equal(nuevas.length, 1);
  assert.deepEqual([nuevas[0].date, nuevas[0].meal, nuevas[0].text], [AYER, 'cena', '¿Qué ceno?']);
  assert.deepEqual(nuevas[0].lines.map((l) => [l.food_id, l.grams]), p.lineas.map((l, i) => [l.food_id, i === 0 ? 111 : l.gramos]));
  assert.ok(nuevas[0].lines.every((l) => l.source_text.startsWith('¿Qué ceno? · ') && !/«.*«/.test(l.source_text)));
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  assert.ok(t.$('section.meal[data-meal="cena"] .registro'));
});

test('«Más ideas»: una sola llamada por pulsación, botón desactivado después; ideas marcadas; ids inventados descartados', { skip }, async () => {
  const llamadas = [];
  const t = await setup({ createAiClient: () => ({ ideasCena: async (a) => { llamadas.push(a); return IDEAS; } }) });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  assert.equal(llamadas.length, 0); // abrir la pantalla no llama a la IA
  const btn = () => t.$('.ideas-btn');
  assert.equal(btn().disabled, false);
  await t.act(() => btn().click());
  assert.equal(llamadas.length, 1);
  assert.equal(btn().disabled, true);
  await t.act(() => btn().click());
  assert.equal(llamadas.length, 1);
  const ideas = t.$$('.cena-ia');
  assert.equal(ideas.length, 1);
  assert.match(ideas[0].textContent, /Idea de la IA/);
  assert.match(ideas[0].textContent, /Pollo con arroz y brócoli/);
  assert.equal(t.$$('.cena-prop').length, 4); // las 3 de siempre + 1 idea
  // la idea también se añade con la confirmación de siempre
  await t.act(() => ideas[0].querySelector('button.primary').click());
  assert.equal(t.$('.chip[aria-pressed="true"]').textContent, 'Cena');
  await t.act(() => t.btn('‹ Volver').click());
  // al volver a abrir la pantalla, el botón vuelve a estar disponible
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.$('.que-ceno').click());
  assert.equal(t.$('.ideas-btn').disabled, false);
  assert.equal(t.$$('.cena-ia').length, 0);
});

test('«Más ideas» envía solo alimentos (lista compacta) y deficits (nombres sin dígitos, ≤ 8); un 429 muestra el mensaje y conserva las propuestas', { skip }, async () => {
  const cuerpos = [];
  let status = 200;
  const fetchImpl = async (url, init) => {
    cuerpos.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (status === 429) return { ok: false, status, json: async () => ({ error: 'limite_de_uso' }) };
    return { ok: true, status, json: async () => ({ ...IDEAS, model: 'm' }) };
  };
  const crear = (conn) => createAiClient({ ...conn, fetchImpl, isOnline: () => true });
  const t = await setup({ createAiClient: crear });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(cuerpos.length, 1);
  const { url, body } = cuerpos[0];
  assert.equal(url, 'https://w/cenas');
  assert.deepEqual(Object.keys(body).sort(), ['alimentos', 'deficits']);
  const ids = body.alimentos.map((a) => a.id);
  const porId = new Map(realFoods.map((f) => [f.id, f]));
  assert.ok(ids.length > 30);
  for (const id of ids) { const f = porId.get(id); assert.ok(f.extra.incluir !== 'no' && !foodSinDatos(f), id); }
  for (const id of ['merluza_cocida', 'patata_asada', 'morro_cerdo']) assert.ok(!ids.includes(id), id); // incluir=no
  for (const a of body.alimentos) assert.ok(Object.keys(a).every((k) => ['id', 'nombre', 'alias', 'porciones', 'estado', 'grupo', 'defecto', 'peso_en_crudo', 'rol'].includes(k)), JSON.stringify(Object.keys(a)));
  // el papel en la cena (rol_cena) viaja con cada alimento: es un dato del catálogo, y solo se envían los que lo tienen
  for (const a of body.alimentos) assert.equal(a.rol, porId.get(a.id).extra.rol_cena, a.id);
  assert.ok(body.alimentos.every((a) => a.rol) && !ids.includes('lentejas_secas')); // sin rol_cena no se propone ni se envía
  assert.ok(body.alimentos.some((a) => a.rol === 'proteina') && body.alimentos.some((a) => a.rol === 'verdura'));
  assert.ok(!JSON.stringify(body).includes('nutrients') && !JSON.stringify(body).includes('densidad'));
  assert.ok(body.deficits.length > 0 && body.deficits.length <= 8);
  assert.ok(body.deficits.every((d) => typeof d === 'string' && d.length <= 40 && !/\d/.test(d)), JSON.stringify(body.deficits));
  assert.equal(cuerpos[0].headers['X-App-Token'], 't');
  // 429 en otra visita: mensaje de siempre, las propuestas se conservan
  status = 429;
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(cuerpos.length, 2);
  assert.match(t.$('[role=alert]').textContent, /límite de uso gratuito/);
  assert.equal(t.$$('.cena-prop').length, 3);
  assert.equal(t.$('.ideas-btn').disabled, true);
});

test('«Más ideas» con una respuesta sin ninguna cena válida: lo dice y no inventa nada', { skip }, async () => {
  const t = await setup({ createAiClient: () => ({ ideasCena: async () => ({ cenas: [{ nombre: 'x', lineas: [{ food_id: 'inventado', gramos: 100 }] }], warnings: [] }) }) });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(t.$('[role=alert]').textContent, 'La IA propuso 1 cena, pero no vale: 1 con alimentos que no están en tu catálogo.');
  assert.equal(t.$$('.cena-ia').length, 0);
  assert.equal(t.$$('.cena-prop').length, 3);
});

// Regresión: la IA propone cenas con ids reales pero ninguna con alimentos de rol proteína/plato (comida vegetal que el
// documento no marca como proteína, jamón sin rol…). Antes: «La IA no devolvió ninguna idea válida» a secas. Ahora: cuántas y por qué.
test('«Más ideas» cuando ninguna cena tiene proteína: dice cuántas llegaron y el motivo, agrupado', { skip }, async () => {
  const cenas = [
    { nombre: 'Pasta con brócoli', lineas: [{ food_id: 'pasta_seca', gramos: 80 }, { food_id: 'brocoli', gramos: 150 }] },
    { nombre: 'Arroz con calabacín', lineas: [{ food_id: 'arroz_blanco_crudo', gramos: 80 }, { food_id: 'calabacin', gramos: 150 }] },
    { nombre: 'Con inventos', lineas: [{ food_id: 'nada_de_nada', gramos: 100 }] },
  ];
  const t = await setup({ createAiClient: () => ({ ideasCena: async () => ({ cenas, warnings: [], recibidas: 3, descartes: {}, model: 'm' }) }) });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(t.$('[role=alert]').textContent, 'La IA propuso 3 cenas, pero ninguna vale: 2 sin proteína ni plato y 1 con alimentos que no están en tu catálogo.');
  assert.equal(t.$$('.cena-ia').length, 0);
  assert.equal(t.$$('.cena-prop').length, 3);
});

test('«Más ideas» con algunas ideas válidas y otras descartadas: enseña las buenas y avisa de las descartadas (suma las del Worker)', { skip }, async () => {
  const cenas = [IDEAS.cenas[0], { nombre: 'Arroz con calabacín', lineas: [{ food_id: 'arroz_blanco_crudo', gramos: 80 }, { food_id: 'calabacin', gramos: 150 }] }];
  const t = await setup({ createAiClient: () => ({ ideasCena: async () => ({ cenas, warnings: [], recibidas: 3, descartes: { fuera_catalogo: 1 }, model: 'm' }) }) });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(t.$$('.cena-ia').length, 1);
  assert.match(t.$('.cenas-ideas .muted[role=status]').textContent, /La IA propuso 3 cenas y se descartaron 2: 1 sin proteína ni plato y 1 con alimentos que no están en tu catálogo\./);
  assert.equal(t.$('[role=alert]'), null);
});

// Un documento antiguo (sin rol_cena) no puede validar las cenas de la IA: se avisa y NO se gasta la llamada.
test('«Más ideas» con un documento sin rol_cena: no llama a la IA, lo dice y ofrece buscar la actualización del documento', { skip }, async () => {
  const llamadas = [];
  let consultas = 0;
  const t = await setup({
    foods: sinRolCena,
    createAiClient: () => ({ ideasCena: async (a) => { llamadas.push(a); return IDEAS; } }),
    fetchPublished: async () => { consultas++; return readFile('./fixtures/alimentos_iniciales.csv'); },
  });
  const antes = consultas; // la app mira sola al arrancar
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  assert.ok(t.$('[data-aviso="sin_roles"]'));
  assert.ok(t.$('.actualizar-doc')); // el botón se ofrece ya con el aviso
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(llamadas.length, 0);
  assert.match(t.$('[role=alert]').textContent, /rol_cena.*No se ha llamado a la IA/);
  assert.equal(t.$('.ideas-btn').disabled, false); // no se gastó "la" llamada de esta visita
  assert.equal(t.$$('.cena-ia').length, 0);
  // «Buscar actualización del documento»: mismo flujo que Documento (consulta lo publicado y abre la revisión)
  await t.act(() => t.$('.actualizar-doc').click());
  assert.equal(consultas, antes + 1);
  assert.equal(t.app.state.screen, 'catalogo');
  assert.ok(t.app.state.catUpdate.plan.actualizados.length > 0);
  assert.equal(llamadas.length, 0);
  // la revisión es parte del Diario (no de Alimentos) y «‹ Volver» regresa a ¿Qué ceno?, no a Documento
  assert.equal(t.$('nav.tabbar button.tab.active').textContent, 'Diario');
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('main.cenas'));
  // «Ahora no» también regresa aquí
  await t.act(() => t.$('.actualizar-doc').click());
  await t.act(() => t.btn('Ahora no').click());
  assert.ok(t.$('main.cenas'));
});

// El botón sale con el aviso, también en modo ligero (donde no hay sección «Más ideas»).
test('el botón «Buscar actualización del documento» está junto a los avisos y también en modo ligero y cubierto', { skip }, async () => {
  const t0 = await setup({ foods: sinRolCena });
  await t0.ayer();
  await t0.act(() => t0.$('.que-ceno').click());
  const { meta, consumidas } = t0.app.state.cenas.resultado.resumen.kcal;
  const kcalAceite = realFoods.find((f) => f.id === 'aceite_oliva').nutrients.energia_kcal;
  for (const R of [250, 100]) {
    const t = await setup({ foods: sinRolCena, meals: [...DIA_AYER, MEAL('extra', AYER, 'otro', [['aceite_oliva', ((meta - consumidas - R) / kcalAceite) * 100]])] });
    await t.ayer();
    await t.act(() => t.$('.que-ceno').click());
    assert.equal(t.$('.ideas-btn'), null, `R=${R}`);
    assert.ok(t.$('.actualizar-doc'), `R=${R}`);
    assert.equal(t.$('.actualizar-doc').closest('.cenas-ideas'), null);
  }
});

// Regresión «ningún error es silencioso»: el resultado de buscar la actualización se dice en ¿Qué ceno?, no solo en Documento.
test('«Buscar actualización» desde ¿Qué ceno?: al día pero sin rol_cena lo explica; sin conexión lo dice; nunca llama a la IA', { skip }, async () => {
  const llamadas = [];
  const csv = readFile('./fixtures/alimentos_iniciales.csv');
  let modo = 'igual';
  const t = await setup({
    foods: sinRolCena,
    createAiClient: () => ({ ideasCena: async (a) => { llamadas.push(a); return IDEAS; } }),
    fetchPublished: async () => { if (modo === 'falla') throw new Error('sin red'); return csv; },
  });
  await t.store.setSetting('catalogo_base', { hash: hashText(csv), text: csv }); // lo publicado es justo lo que copió el dispositivo
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.actualizar-doc').click());
  assert.ok(t.$('main.cenas')); // sigue aquí
  assert.equal(t.$('[data-doc-msg]').textContent, 'Tu documento está al día con el publicado pero no tiene la columna rol_cena (¿importaste un CSV sin ella?): importa el foods.csv publicado desde Documento o añade la columna.');
  // sin conexión
  modo = 'falla';
  await t.act(() => t.$('.actualizar-doc').click());
  assert.ok(t.$('main.cenas'));
  assert.equal(t.$('[data-doc-msg]').textContent, 'No se pudo consultar el documento publicado (¿sin conexión?).');
  assert.equal(t.app.state.catMsg, ''); // no se queda escondido en Documento
  assert.equal(llamadas.length, 0);
});

test('«Más ideas»: una receta sin rol_cena viaja como plato (igual que en el motor) y su idea no se descarta', { skip }, async () => {
  const foods = realFoods.map((f) => { if (f.id !== 'lentejas_caseras') return f; const { rol_cena, ...extra } = f.extra; return { ...f, extra }; });
  const cuerpos = [];
  const ideas = { cenas: [{ nombre: 'Lentejas', lineas: [{ food_id: 'lentejas_caseras', gramos: 300 }, { food_id: 'yogur_griego_natural', gramos: 125 }] }], warnings: [] };
  const t = await setup({ foods, recetasBase: [{ id: 'lentejas_caseras', nombre: 'Lentejas caseras', peso_final_g: 1000, ingredientes: [{ food_id: 'lentejas_secas', gramos: 300 }] }], createAiClient: () => ({ ideasCena: async (a) => { cuerpos.push(a); return ideas; } }) });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(cuerpos.length, 1);
  assert.equal(cuerpos[0].alimentos.find((a) => a.id === 'lentejas_caseras')?.rol, 'plato');
  assert.equal(t.$('[role=alert]'), null);
  assert.equal(t.$$('.cena-ia').length, 1);
});

test('«Más ideas» sin ningún alimento que enviar: no llama a la IA y lo explica', { skip }, async () => {
  const llamadas = [];
  // solo un alimento con rol y sin datos
  const foods = sinRolCena.map((f) => (f.id === 'huevo' ? { ...f, extra: { ...f.extra, rol_cena: 'proteina' }, nutrients: {} } : f));
  const t = await setup({ foods, createAiClient: () => ({ ideasCena: async (a) => { llamadas.push(a); return IDEAS; } }) });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(llamadas.length, 0);
  assert.match(t.$('[role=alert]').textContent, /No hay ningún alimento con rol_cena y con datos.*no se ha llamado a la IA/);
  assert.equal(t.$('.ideas-btn').disabled, false);
});

test('«Más ideas» con una idea de un alimento que existe pero no se envió: dice «no se le enviaron», no «no están en tu catálogo»', { skip }, async () => {
  const cenas = [{ nombre: 'Lentejas', lineas: [{ food_id: 'lentejas_secas', gramos: 80 }] }];
  const t = await setup({ createAiClient: () => ({ ideasCena: async () => ({ cenas, warnings: [] }) }) });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  await t.act(() => t.$('.ideas-btn').click());
  assert.equal(t.$('[role=alert]').textContent, 'La IA propuso 1 cena, pero no vale: 1 con alimentos que no se le enviaron a la IA (sin rol_cena o sin datos).');
});

test('sin cenas que usar: la pantalla funciona sin IA; si no hay nada que proponer, lo dice y «Más ideas» sigue disponible', { skip }, async () => {
  const t = await setup({ semilla: { ...SEMILLA, cenas: [] } });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  assert.equal(t.$$('.cena-prop').length, 0);
  assert.match(t.$('[data-aviso="sin_candidatos"]').textContent, /No tengo cenas habituales/);
  assert.equal(t.$('.ideas-btn').disabled, false);
});

test('(20) «Más ideas» no aparece en modo ligero ni cubierto: sin botón y sin ninguna llamada posible', { skip }, async () => {
  const llamadas = [];
  const crear = () => ({ ideasCena: async (a) => { llamadas.push(a); return IDEAS; } });
  // la meta del día mostrado, para dejar R donde se quiere con aceite (kcal de aceite_oliva del documento)
  const t0 = await setup({ createAiClient: crear });
  await t0.ayer();
  await t0.act(() => t0.$('.que-ceno').click());
  const { meta, consumidas } = t0.app.state.cenas.resultado.resumen.kcal;
  assert.ok(t0.$('.ideas-btn')); // modo normal: sí
  const kcalAceite = realFoods.find((f) => f.id === 'aceite_oliva').nutrients.energia_kcal;
  for (const [R, modo] of [[250, 'ligero'], [100, 'cubierto'], [-80, 'cubierto']]) {
    const gramos = ((meta - consumidas - R) / kcalAceite) * 100;
    const t = await setup({ createAiClient: crear, meals: [...DIA_AYER, MEAL('extra', AYER, 'otro', [['aceite_oliva', gramos]])] });
    await t.ayer();
    await t.act(() => t.$('.que-ceno').click());
    const r = t.app.state.cenas.resultado;
    assert.equal(r.modo, modo, `R=${R}`);
    assert.ok(Math.abs(r.resumen.kcal.restantes - R) < 1, `R=${R}: ${r.resumen.kcal.restantes}`);
    assert.equal(t.$('.ideas-btn'), null, `R=${R}`);
    assert.equal(t.$('.cenas-ideas'), null, `R=${R}`);
    assert.ok(!t.$$('button').some((b) => b.textContent.includes('Más ideas')));
    assert.ok(t.$('main.cenas'));
  }
  assert.equal(llamadas.length, 0);
});

test('(22) la tarjeta dice «Sin … para que quepa» cuando se quitaron extras, y solo entonces', { skip }, async () => {
  const dia = [
    MEAL('b1', AYER, 'desayuno', [['avena_copos', 60], ['leche_entera', 250], ['kiwi_verde', 69], ['almendras_crudas', 20]]),
    MEAL('b2', AYER, 'comida', [['pechuga_pollo_cruda', 180], ['arroz_blanco_crudo', 100], ['aceite_oliva', 10], ['brocoli', 150]]),
    MEAL('b3', AYER, 'merienda', [['pan_blanco_barra', 60], ['jamon_curado', 40]]),
  ];
  const t = await setup({ meals: dia });
  await t.ayer();
  await t.act(() => t.$('.que-ceno').click());
  const r = t.app.state.cenas.resultado;
  assert.equal(r.propuestas.length, 3);
  const tarjetas = t.$$('section.cena-prop');
  assert.equal(tarjetas.length, 3);
  let con = 0;
  r.propuestas.forEach((p, i) => {
    const flag = tarjetas[i].querySelector('[data-quitados]');
    if (p.quitados?.length) {
      con++;
      assert.match(flag.textContent, /^Sin .+ para que quepa\.$/);
      for (const n of p.quitados) assert.ok(flag.textContent.toLowerCase().includes(n.toLowerCase()), n);
    } else assert.equal(flag, null);
  });
  assert.ok(con > 0, 'en este día alguna cena necesita quitar extras');
});
