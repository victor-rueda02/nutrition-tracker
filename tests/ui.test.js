import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { AiClientError } from '../frontend/js/ai-client.js';
import { realFoods, rulesFoods, catalog, settings, readFile, foodsConSinDatos } from './helpers.js';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { hashText } from '../frontend/js/core/catalog-update.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z'); // 09:30 en Madrid

const ITEM = (food_id, grams, source_text, o = {}) => ({ food_id, grams, source_text, confidence: 'alta', flags: [], requiresConfirmation: false, ...o });

async function setup({ responses = [], foods = realFoods, conn = { endpoint: 'https://w', token: 't' }, files, objetivos = {}, meals = [], shareResult = 'compartido', health = { ok: true, configurado: true, token: 'ok' }, idGen = 'contador', alterStore = (st) => st, publicado, ajustes = {}, enDiario = false, retirados } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = alterStore(createMemoryStore());
  for (const m of meals) await store.addMeal(m);
  for (const [k, v] of Object.entries(ajustes)) await store.setSetting(k, v);
  const calls = [];
  const saved = []; // ficheros exportados (en el iPhone irían al menú Compartir)
  const queue = [...responses];
  const createAiClient = () => ({
    async interpretMeal(args) {
      calls.push(args);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    async health() { return health; },
  });
  const app = mountApp(root, { store, createAiClient, catalog, settings, targets: TARGETS, objetivos, retirados, initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn, now: () => NOW, idGen: idGen === 'contador' ? (() => { let n = 0; return () => `m${++n}`; })() : idGen ?? undefined, readFile: (f) => f.text(), saveFile: async (f) => { saved.push(f); return shareResult; },
    fetchPublished: publicado === undefined ? undefined : async () => { if (publicado instanceof Error) throw publicado; return publicado; } });
  await app.whenIdle();
  if (!enDiario) root.querySelector('button[aria-label="Añadir comida"]').click(); // la app abre en el Diario; el "+" central lleva directo al dictado
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const buscar = (text) => $$('button').find((b) => b.textContent.includes(text));
  // El dictado ocupa toda la pantalla (sin barra inferior): para ir a una pestaña se cierra primero con la X.
  const btn = (text) => { let b = buscar(text); if (!b && ['Diario', 'Alimentos', 'Más'].includes(text)) { buscar('‹ Volver')?.click(); b = buscar(text); } return b; };
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const attach = async (inputEl, file) => { Object.defineProperty(inputEl, 'files', { value: [file] }); inputEl.dispatchEvent(new Event('change', { bubbles: true })); await app.whenIdle(); };
  return { app, root, store, calls, saved, document, $, $$, btn, type, act, attach };
}

const comidaCon = (t) => t.$$('section.meal').find((x) => x.querySelector('.registro')); // la primera comida con registros (el Diario muestra también las vacías)
const verInforme = (t) => { t.$('button[aria-label="Más opciones del día"]').click(); t.btn('Ver informe diario').click(); };
const abrirDictado = (t) => t.$('button[aria-label="Añadir comida"]').click(); // el "+" central
const masA = (t, etiqueta) => { t.btn('Más').click(); t.btn(etiqueta).click(); }; // pestaña Más -> su fila

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
  assert.equal(t.calls[0].alimentos.length, 66); // sin los incluir=no
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
  // con el catálogo real: 90,5 g de avena (384 kcal/100 g) + 100 g de huevo (143 kcal/100 g)
  assert.match(t.root.textContent, /348 kcal · 11 g prot./);
  assert.match(t.root.textContent, /Total: 491 kcal · 23,6 g de proteína/);
  assert.ok(!/parcial|sin dato/.test(t.root.textContent));
  await t.act(() => t.$$('button[aria-label^="Borrar"]')[1].click());
  assert.equal(t.$$('li.card[data-key]').length, 1);
  await t.act(() => t.btn('Guardar').click());
  const meals = await t.store.allMeals();
  assert.deepEqual(meals, [{ id: 'm1', date: '2026-10-16', meal: 'desayuno', createdAt: NOW.toISOString(), text: 'para desayunar 80 g de avena, 2 huevos y un plátano', lines: [{ food_id: 'avena_copos', grams: 90.5, source_text: '80 g de avena' }] }]);
  assert.match(t.$('[role=status]').textContent, /Guardado en desayuno: 1 alimento/); // vuelve al Diario con el aviso
  await t.act(() => abrirDictado(t));
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
  const lentejas = foodsConSinDatos.find((f) => f.id === 'crema_sd'); // fixture: el catálogo real ya no tiene alimentos excluidos sin datos
  const first = { items: [ITEM('kiwi_verde', 69, 'un kiwi')], unmatched: [{ text: 'medio kilo de crema de prueba', motivo: 'no_en_catalogo' }], warnings: [] };
  const second = { items: [ITEM('kiwi_verde', 69, 'un kiwi'), ITEM('crema_sd', 500, 'medio kilo de crema de prueba')], unmatched: [], warnings: [] };
  const t = await setup({ responses: [first, second], foods: foodsConSinDatos });
  t.type(t.$('textarea'), 'medio kilo de crema de prueba y un kiwi');
  await t.act(() => t.btn('Procesar').click());
  assert.match(t.root.textContent, /Excluido del catálogo \(incluir=no\)/);
  await t.act(() => t.btn(`Activar «${lentejas.nombre}»`).click());
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0].alimentos.some((f) => f.id === 'crema_sd'), false);
  assert.equal(t.calls[1].alimentos.some((f) => f.id === 'crema_sd'), true);
  assert.deepEqual(t.$$('li.card[data-key] input.grams').map((i) => i.value), ['69', '500']);
  assert.equal((await t.store.getCatalogRecord()).foods.find((f) => f.id === 'crema_sd').extra.incluir, 'si');
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
  await t.act(() => masA(t, 'Documento'));
  const csv = 'id,nombre,marca,proteina_g\na,Alimento A,X,10\nb,Alimento B,Y,\n';
  await t.attach(t.$('input[type=file]'), { name: 'mis_alimentos.csv', text: async () => csv });
  assert.match(t.$('.report').textContent, /Importado «mis_alimentos.csv»: 2 alimentos/);
  assert.match(t.$('.report').textContent, /cabecera desconocida "marca"/);
  const rec = await t.store.getCatalogRecord();
  assert.deepEqual([rec.foods.length, rec.name, rec.extraHeaders], [2, 'mis_alimentos.csv', ['marca']]);
});

test('importar con errores: pide confirmación y solo importa las filas válidas', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await t.act(() => masA(t, 'Documento'));
  await t.attach(t.$('input[type=file]'), { name: 'x.csv', text: async () => 'id,nombre\na,A\na,Repetido\n' });
  assert.match(t.$('.report').textContent, /1 alimentos válidos, 1 filas con error/);
  assert.match(t.$('.report').textContent, /id duplicado/);
  assert.equal(await t.store.getCatalogRecord(), null);          // aún no se ha aplicado
  await t.act(() => t.btn('Importar 1 alimentos válidos').click());
  assert.equal((await t.store.getCatalogRecord()).foods.length, 1);
});

test('documento inservible (falta nombre): no se puede importar y no se toca el actual', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await t.act(() => masA(t, 'Documento'));
  await t.attach(t.$('input[type=file]'), { name: 'mal.csv', text: async () => 'id,alias\na,x\n' });
  assert.match(t.$('.report').textContent, /No se puede importar «mal.csv»/);
  assert.match(t.$('.report').textContent, /falta la columna obligatoria "nombre"/);
  assert.equal(await t.store.getCatalogRecord(), null);
});

test('seguridad: el texto de un documento nunca se interpreta como HTML', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  await t.act(() => masA(t, 'Documento'));
  await t.attach(t.$('input[type=file]'), { name: 'x.csv', text: async () => 'id,nombre\na,"<img src=x onerror=alert(1)><b>negrita</b>"\n' });
  await t.act(() => abrirDictado(t));
  await t.act(() => t.btn('Añadir a mano').click());
  await t.act(() => t.btn('+ Añadir alimento').click());
  assert.equal(t.$('.overlay img'), null);
  assert.equal(t.$('.overlay b'), null);
  assert.match(t.$('.overlay .pick').textContent, /<img src=x onerror=alert\(1\)>/);
});

test('conexión: se guarda el Worker y el token (no van en el repositorio)', { skip }, async () => {
  const t = await setup({ responses: [RESULT], conn: {} });
  await t.act(() => masA(t, 'Conexión con la IA'));
  t.$('input[type=url]').value = 'https://w.example';
  t.$('input[type=password]').value = 'secreto';
  await t.act(() => t.btn('Guardar').click());
  assert.deepEqual(await t.store.getSetting('conn'), { endpoint: 'https://w.example', token: 'secreto' });
  await t.act(() => t.btn('Probar').click());
  assert.match(t.root.textContent, /Todo correcto: el Worker responde, tiene sus secretos y el token es el correcto/);
});

test('Probar: token incorrecto o secretos que faltan, con un mensaje para cada caso', { skip }, async () => {
  for (const [health, re] of [[{ ok: true, configurado: true, token: 'incorrecto' }, /el token no es correcto/], [{ ok: true, configurado: false, token: 'ok' }, /le faltan secretos/], [{ ok: false }, /no responde bien/]]) {
    const t = await setup({ health });
    await t.act(() => masA(t, 'Conexión con la IA'));
    await t.act(() => t.btn('Probar').click());
    assert.match(t.root.textContent, re);
  }
});

// ---------- Diario (hito 4, fase 1) ----------
const MEAL = (id, date, meal, lines) => ({ id, date, meal, createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const fila = (t, clave) => t.$(`li.nut[data-clave="${clave}"]`);

test('Diario: lo guardado hoy, con totales frente a los objetivos, por comida y con navegación entre días', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  await t.act(() => t.btn('Guardar').click()); // 80 g de avena + 100 g de huevo
  await t.act(() => t.btn('Diario').click());
  assert.equal(t.$('.daylabel').textContent, 'Hoy');
  assert.equal(t.$('button[aria-label="Día siguiente"]').disabled, true);
  assert.match(comidaCon(t).textContent, /Desayuno.*450 kcal/);
  assert.match(comidaCon(t).textContent, /Avena \(copos\/molida\) · 80 g · 307 kcal/);
  assert.equal(t.$('.alert-ul'), null);
  // Informe diario (tres puntos): 80 g de avena (384 kcal) + 100 g de huevo (143 kcal) = 450 kcal; objetivo de referencia 2000 kcal
  await t.act(() => verInforme(t));
  assert.match(t.$('header').textContent, /Informe diario/);
  assert.match(fila(t, 'energia_kcal').textContent, /450 kcal \/ 2000 kcal/);
  assert.match(fila(t, 'energia_kcal').textContent, /Por debajo · 23 %/);
  assert.match(fila(t, 'vitamina_b12_ug').textContent, /µg/);
  assert.ok(fila(t, 'epa_dha'));
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  assert.match(t.root.textContent, /Sin registros este día/);
  await t.act(() => { t.$('button[aria-label="Más opciones del día"]').click(); t.btn('Ir a hoy').click(); });
  assert.equal(t.$('.daylabel').textContent, 'Hoy');
});

test('Diario: superar un UL es un aviso distinto de "objetivo cumplido"', { skip }, async () => {
  // Alimento con 100 mg de zinc por 100 g (UL 25 mg): un UL normal sigue avisando.
  const zinc = { ...realFoods.find((f) => f.id === 'huevo'), id: 'zinc_extra', nombre: 'Zinc extra', alias: [], nutrients: { energia_kcal: 100, zinc_mg: 100 } };
  const t = await setup({ foods: [...realFoods, zinc], meals: [MEAL('m', '2026-10-16', 'cena', [['zinc_extra', 100]])] });
  await t.act(() => t.btn('Diario').click());
  assert.match(t.$('.alert-ul').textContent, /Máximo tolerable \(UL\) superado: Zinc/); // el Diario: una línea con el aviso
  await t.act(() => verInforme(t));
  assert.match(t.$('.alert-ul').textContent, /Zinc 100 mg \(UL 25 mg\)/);
  const a = fila(t, 'zinc_mg');
  assert.ok(a.classList.contains('over-ul'));
  assert.match(a.textContent, /Objetivo cumplido/);
  assert.match(a.textContent, /⚠ Supera el máximo tolerable \(UL 25 mg\)/);
  assert.ok(!fila(t, 'vitamina_c_mg').classList.contains('over-ul'));
});

test('Diario: el UL informativo (vitamina A con 400 g de zanahoria, folato) no avisa ni pinta rojo; el informe lo enseña con su nota', { skip }, async () => {
  // 400 g de zanahoria: 3340 µg RAE (> 3000), pero ese UL es solo de retinol preformado.
  const t = await setup({ meals: [MEAL('m', '2026-10-16', 'cena', [['zanahoria', 400]])] });
  await t.act(() => t.btn('Diario').click());
  assert.equal(t.$('.alert-ul'), null); // sin tira de UL en el Diario
  await t.act(() => verInforme(t));
  assert.equal(t.$('.alert-ul'), null);
  const a = fila(t, 'vitamina_a_ug');
  assert.match(a.textContent, /3340 µg/);
  assert.ok(!a.classList.contains('over-ul'));
  assert.doesNotMatch(a.textContent, /Supera el máximo tolerable/);
  assert.match(a.querySelector('.ul-informativo').textContent, /UL 3000 µg \(solo informativo\)/);
  assert.match(a.querySelector('.ul-informativo').textContent, /solo para retinol preformado/);
});

test('Diario: un alimento sin datos deja los totales parciales y se dice cuál', { skip }, async () => {
  const t = await setup({ foods: foodsConSinDatos, meals: [MEAL('m', '2026-10-16', 'comida', [['kiwi_verde', 100], ['refresco_sd', 330]])] });
  await t.act(() => t.btn('Diario').click());
  assert.match(t.$('[role=alert]').textContent, /Sin datos nutricionales: Refresco de prueba/); // sin ningún dato: se avisa aparte
  assert.doesNotMatch(t.$('.parciales')?.textContent ?? '', /Refresco de prueba/); // y no inunda el aviso de parciales
  assert.match(comidaCon(t).textContent, /Refresco de prueba · 330 g · sin dato/);
  await t.act(() => verInforme(t));
  assert.match(fila(t, 'energia_kcal').textContent, /parcial/);
});

// Día con ambos casos: chía (sin vitamina K...) y pasta (sin colina) = menor; "Bizcocho" sin kcal ni proteína = importante.
const BIZCOCHO = (() => { const p = realFoods.find((f) => f.id === 'pasta_seca'); return { ...p, id: 'bizcocho', nombre: 'Bizcocho', extra: {}, nutrients: { ...p.nutrients, energia_kcal: null, proteina_g: null } }; })();
const DIA_PARCIAL = [MEAL('m', '2026-10-16', 'comida', [['semillas_chia', 15], ['pasta_seca', 80], ['bizcocho', 60], ['huevo', 0]])];

test('Diario: totales parciales con gravedad: lo importante (kcal y proteína) primero y en negrita; lo menor, discreto y plegado', { skip }, async () => {
  const t = await setup({ foods: [...realFoods, BIZCOCHO], meals: DIA_PARCIAL });
  await t.act(() => t.btn('Diario').click());
  const avisos = t.$$('.parciales');
  assert.equal(avisos.length, 2);
  assert.ok(avisos[0].classList.contains('importante') && avisos[0].classList.contains('warn'));
  assert.equal(avisos[0].tagName, 'P'); // el resumen lo dice todo: sin desplegable
  assert.equal(avisos[0].textContent, 'Importante: totales parciales en kcal y proteína (faltan datos de Bizcocho)');
  assert.ok(avisos[0].querySelector('strong')); // el estado no depende solo del color: lleva el prefijo «Importante:»
  assert.ok(avisos[1].classList.contains('menor') && avisos[1].classList.contains('muted'));
  assert.equal(avisos[1].tagName, 'DETAILS');
  assert.match(avisos[1].querySelector('summary').textContent, /^Totales parciales en \d+ nutrientes \(faltan datos de /);
  assert.match(avisos[1].querySelector('ul').textContent, /Colina: faltan datos de .*Pasta seca sin enriquecer/);
  assert.doesNotMatch(avisos[1].textContent, /Huevo/); // 0 g ese día: no cuenta
  assert.doesNotMatch(t.root.textContent, /Totales parciales: faltan datos/); // el texto antiguo ya no está
});

test('Informe diario: el detalle de parciales, agrupado y por gravedad (importante primero)', { skip }, async () => {
  const t = await setup({ foods: [...realFoods, BIZCOCHO], meals: DIA_PARCIAL });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => verInforme(t));
  const panel = t.$('.parciales-informe');
  const bloques = [...panel.querySelectorAll('.parciales')];
  assert.deepEqual(bloques.map((b) => b.className.split(' ').pop()), ['importante', 'menor']);
  assert.match(bloques[0].textContent, /^Importante: afecta a kcal o a proteína, hidratos o grasa/);
  assert.match(bloques[0].querySelector('li').textContent, /^Energía y proteína: faltan datos de Bizcocho\.$/);
  assert.match(bloques[1].textContent, /^Menor: no afecta a kcal/);
  assert.ok([...bloques[1].querySelectorAll('li')].some((li) => /^Colina: faltan datos de .*Pasta seca sin enriquecer/.test(li.textContent)));
});

test('Diario: un día sin parciales no muestra el aviso', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m', '2026-10-16', 'comida', [['kiwi_verde', 100]])] });
  await t.act(() => t.btn('Diario').click());
  assert.equal(t.$$('.parciales').length, 0);
});

test('Informe diario: nombra los alimentos sin datos y los borrados del documento (aviso «Sin datos nutricionales»)', { skip }, async () => {
  const t = await setup({ foods: foodsConSinDatos, meals: [MEAL('m', '2026-10-16', 'comida', [['kiwi_verde', 100], ['refresco_sd', 330], ['alimento_borrado', 50]])] });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => verInforme(t));
  const aviso = t.$$('[role=alert]').find((x) => /Sin datos nutricionales/.test(x.textContent));
  assert.ok(aviso);
  assert.match(aviso.textContent, /Refresco de prueba/);
  assert.match(aviso.textContent, /alimento_borrado/);
  assert.match(aviso.textContent, /no son completos/);
});

test('Objetivos: sin plan, editar kcal y macros crea «Mis objetivos» desde hoy; el diario de hoy los usa y el de ayer no; perfil mujer', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m', '2026-10-16', 'comida', [['arroz_blanco_crudo', 100]]), MEAL('a', '2026-10-15', 'comida', [['arroz_blanco_crudo', 100]])] });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => verInforme(t));
  assert.match(t.$('.objetivos-dia').textContent, /Objetivos: referencias EFSA/);
  assert.match(fila(t, 'hierro_mg').textContent, /\/ 11 mg/);
  await t.act(() => masA(t, 'Objetivos'));
  assert.match(t.root.textContent, /Ningún periodo de tu plan cubre hoy/);
  assert.match(t.root.textContent, /Sin plan: se usan las referencias EFSA/);
  assert.equal(t.btn('Exportar plan').disabled, true);
  t.$('input[aria-label="Energía: objetivo"]').value = '2500';
  t.$('input[aria-label="Proteína: mínimo"]').value = '150,5';
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('[role=status]').textContent, /Guardado/);
  const plan = await t.store.getSetting('plan_objetivos');
  assert.deepEqual(plan.periodos, [{ id: 'objetivos_20261016', nombre: 'Mis objetivos', inicio: '2026-10-16', valores: { energia_kcal: { objetivo: 2500 }, proteina_g: { min: 150.5 } } }]);
  t.$('input[aria-label="Hidratos: mínimo"]').value = 'mucho';
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('[role=alert]').textContent, /Valor no válido en Hidratos \(mínimo\)/);
  await t.act(() => { const s = t.$('select[aria-label="Perfil de referencia"]'); s.value = 'mujer'; s.dispatchEvent(new t.document.defaultView.Event('change')); });
  assert.equal((await t.store.getSetting('plan_objetivos')).perfil, 'mujer');
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.btn('Diario').click());
  await t.act(() => verInforme(t));
  assert.match(t.$('.objetivos-dia').textContent, /Objetivos: Mis objetivos/);
  assert.match(fila(t, 'energia_kcal').textContent, /\/ 2500 kcal/);
  assert.match(fila(t, 'proteina_g').textContent, /\/ 151 g|\/ 150,5 g/);
  assert.match(fila(t, 'hierro_mg').textContent, /\/ 16 mg/);
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.$('button[aria-label="Día anterior"]').click()); // ayer: antes del periodo
  await t.act(() => verInforme(t));
  assert.match(fila(t, 'energia_kcal').textContent, /\/ 2000 kcal/);
  assert.match(fila(t, 'hierro_mg').textContent, /\/ 16 mg/); // el perfil es del plan entero
});

test('no coincide con tus alias: Guardar desactivado hasta pulsar "Sí, es ..." (editar gramos no basta)', { skip }, async () => {
  const t = await setup({ responses: [{ ...RESULT, items: [ITEM('pechuga_pollo_cruda', 150, '150 g de pechuga', { flags: ['sin_alias'], confidence: 'baja' })], unmatched: [] }] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  assert.match(t.root.textContent, /No coincide con tus alias/);
  assert.equal(t.btn('Guardar').disabled, true);
  assert.match(t.root.textContent, /Confirma o cambia los alimentos que no coinciden con tus alias/);
  t.type(t.$('li.card[data-key] input.grams'), '160');
  assert.equal(t.btn('Guardar').disabled, true);
  await t.act(() => t.btn('Sí, es «Pechuga de pollo sin piel cruda»').click());
  assert.equal(t.btn('Sí, es'), undefined);
  assert.equal(t.btn('Guardar').disabled, false);
});

const MAS_ESPECIFICO = (o = {}) => ({ ...RESULT, items: [ITEM('pan_blanco_barra', 60, '60 g de pan de molde', { flags: ['alias_mas_especifico'], mas_especifico: 'pan_molde_blanco', confidence: 'baja', requiresConfirmation: true, ...o })], unmatched: [] });

test('alias más específico: aviso, botón «Cambiar a …» y Guardar desactivado hasta tocar', { skip }, async () => {
  const t = await setup({ responses: [MAS_ESPECIFICO()] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  assert.doesNotMatch(t.root.textContent, /Dijiste algo más específico que este alimento/); // un solo aviso, no dos casi iguales
  assert.match(t.root.textContent, /Dijiste «60 g de pan de molde»: ¿es «Pan de molde blanco»\?/);
  assert.ok(t.btn('Cambiar a «Pan de molde blanco»'));
  assert.ok(t.btn('Sí, es «Pan blanco de barra»'));
  assert.equal(t.btn('Guardar').disabled, true);
  assert.match(t.root.textContent, /Confirma o cambia los alimentos que no coinciden con tus alias o tienen uno más específico/);
  t.type(t.$('li.card[data-key] input.grams'), '70');
  assert.equal(t.btn('Guardar').disabled, true); // editar gramos no basta
  // Con un toque, la línea pasa al alimento del alias largo, conserva los gramos y ya se puede guardar.
  await t.act(() => t.btn('Cambiar a «Pan de molde blanco»').click());
  assert.equal(t.btn('Cambiar a'), undefined);
  assert.equal(t.btn('Sí, es'), undefined);
  assert.match(t.$('li.card[data-key] button.name').textContent, /Pan de molde blanco/);
  assert.equal(t.$('li.card[data-key] input.grams').value, '70');
  assert.equal(t.btn('Guardar').disabled, false);
});

test('alias más específico: «Sí, es …» mantiene el alimento elegido y desbloquea Guardar', { skip }, async () => {
  const t = await setup({ responses: [MAS_ESPECIFICO()] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  assert.equal(t.btn('Guardar').disabled, true);
  await t.act(() => t.btn('Sí, es «Pan blanco de barra»').click());
  assert.equal(t.btn('Cambiar a'), undefined);
  assert.match(t.$('li.card[data-key] button.name').textContent, /Pan blanco de barra/);
  assert.equal(t.btn('Guardar').disabled, false);
});

test('alias más específico: la frase queda en «Frases a revisar» con el alimento más específico', { skip }, async () => {
  const t = await setup({ responses: [MAS_ESPECIFICO()] });
  t.type(t.$('textarea'), 'pan de molde');
  await t.act(() => t.btn('Procesar').click());
  await t.act(() => t.btn('Sí, es «Pan blanco de barra»').click());
  await t.act(() => t.btn('Guardar').click());
  const log = await t.store.getSetting('registro_frases');
  assert.deepEqual(log.map((e) => e.problemas.map((p) => [p.texto, p.tipo, p.mas_especifico, p.resolucion])), [[['60 g de pan de molde', 'alias_mas_especifico', 'pan_molde_blanco', 'pan_blanco_barra']]]);
});

// ---------- Hito 4, fase 2: editar y borrar comidas guardadas ----------
const AYER = MEAL('r1', '2026-10-15', 'comida', [['arroz_blanco_crudo', 150], ['kiwi_verde', 69], ['aceite_oliva', 10]]);
const toAyer = async (t) => { await t.act(() => t.btn('Diario').click()); await t.act(() => t.$('button[aria-label="Día anterior"]').click()); };

test('editar una comida pasada: gramos, quitar línea, cambiar comida y fecha; mismo id y createdAt', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await toAyer(t);
  assert.match(comidaCon(t).textContent, /Arroz blanco crudo · 150 g/);
  await t.act(() => t.btn('Editar').click());
  assert.match(t.$('header').textContent, /Editar comida/);
  assert.equal(t.$('input[aria-label="Fecha"]').value, '2026-10-15');
  assert.equal(t.$('input[aria-label="Fecha"]').max, '2026-10-16');
  assert.equal(t.$$('li.card[data-key]').length, 3);
  t.type(t.$$('input.grams')[0], '120');
  await t.act(() => t.$$('button[aria-label^="Borrar"]')[1].click()); // quita el kiwi
  await t.act(() => t.btn('Cena').click());
  const fecha = t.$('input[aria-label="Fecha"]');
  fecha.value = '2026-10-16'; fecha.dispatchEvent(new t.document.defaultView.Event('change', { bubbles: true }));
  await t.act(() => t.btn('Guardar cambios').click());
  // vuelve al diario del día en que queda la comida
  assert.equal(t.$('.daylabel').textContent, 'Hoy');
  assert.match(t.$('[role=status]').textContent, /Cambios guardados. La comida está ahora en este día/);
  assert.match(comidaCon(t).textContent, /Cena/);
  const meals = await t.store.allMeals();
  assert.deepEqual(meals, [{ ...AYER, date: '2026-10-16', meal: 'cena', updatedAt: NOW.toISOString(),
    lines: [{ food_id: 'arroz_blanco_crudo', grams: 120, source_text: '' }, { food_id: 'aceite_oliva', grams: 10, source_text: '' }] }]);
});

test('editar: "Volver" descarta los cambios; sin líneas solo se puede borrar', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await toAyer(t);
  await t.act(() => t.btn('Editar').click());
  t.type(t.$$('input.grams')[0], '999');
  await t.act(() => t.btn('‹ Volver').click());
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  assert.deepEqual(await t.store.allMeals(), [AYER]);
  await t.act(() => t.btn('Editar').click());
  for (let i = 0; i < 3; i++) await t.act(() => t.$('button[aria-label^="Borrar"]').click());
  assert.equal(t.btn('Guardar cambios').disabled, true);
  assert.match(t.root.textContent, /Añade al menos un alimento o borra la comida/);
});

test('borrar una comida desde el diario pide confirmación dentro de la app', { skip }, async () => {
  const otra = MEAL('r2', '2026-10-15', 'cena', [['huevo', 100]]);
  const t = await setup({ meals: [AYER, otra] });
  await toAyer(t);
  const borrarDe = (id) => t.$(`.registro[data-id="${id}"]`).querySelector('button.danger');
  await t.act(() => borrarDe('r1').click());
  assert.match(t.$('.registro[data-id="r1"]').textContent, /¿Borrar esta comida\?/);
  await t.act(() => t.btn('Cancelar').click());
  assert.equal((await t.store.allMeals()).length, 2);
  await t.act(() => borrarDe('r1').click());
  await t.act(() => t.btn('Sí, borrar').click());
  assert.deepEqual((await t.store.allMeals()).map((m) => m.id), ['r2']);
  assert.match(t.$('[role=status]').textContent, /Comida borrada/);
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  assert.equal(t.$$('.registro').length, 1);
});

test('borrar desde la pantalla de edición', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await toAyer(t);
  await t.act(() => t.btn('Editar').click());
  await t.act(() => t.btn('Borrar esta comida').click());
  await t.act(() => t.btn('Sí, borrar').click());
  assert.deepEqual(await t.store.allMeals(), []);
  assert.match(t.root.textContent, /Sin registros este día/);
});

test('editar una comida con un alimento que ya no está en el documento: queda en "Sin resolver" con sus gramos', { skip }, async () => {
  const t = await setup({ meals: [MEAL('r3', '2026-10-15', 'comida', [['ya_no_existe', 35], ['kiwi_verde', 69]])] });
  await toAyer(t);
  assert.match(comidaCon(t).textContent, /ya_no_existe · 35 g · sin dato/);
  await t.act(() => t.btn('Editar').click());
  assert.match(t.root.textContent, /«ya_no_existe · 35 g»/);
  await t.act(() => t.btn('Buscar en mi documento').click());
  t.type(t.$('.overlay input'), 'avena');
  await t.act(() => t.$('.pick').click());
  assert.equal(t.$$('input.grams').at(-1).value, '35');
});

// ---------- Hito 4, paso 3: copia de seguridad ----------
const fichero = (name, data) => ({ name, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) });
const abrirDoc = (t, seccion = 'Copia de seguridad') => t.act(() => masA(t, seccion));

test('exportar el diario: copia JSON con todas las comidas y sin el token', { skip }, async () => {
  const t = await setup({ meals: [AYER, MEAL('r2', '2026-10-16', 'cena', [['huevo', 100]])], conn: { endpoint: 'https://w', token: 'TOKEN-SECRETO' } });
  await abrirDoc(t);
  assert.match(t.root.textContent, /2 comidas guardadas/);
  await t.act(() => t.btn('Exportar diario').click());
  assert.equal(t.saved.length, 1);
  assert.equal(t.saved[0].name, 'nutritiontracker-diario-2026-10-16.json');
  assert.equal(t.saved[0].type, 'application/json');
  assert.ok(!t.saved[0].text.includes('TOKEN-SECRETO'));
  const data = JSON.parse(t.saved[0].text);
  assert.deepEqual(data.comidas.map((m) => m.id).sort(), ['r1', 'r2']);
  assert.match(t.$('p.ok[role=status]').textContent, /Copia del diario: 2 comidas/);
});

test('exportar: si cancelas el menú Compartir, se dice', { skip }, async () => {
  const t = await setup({ meals: [AYER], shareResult: 'cancelado' });
  await abrirDoc(t);
  await t.act(() => t.btn('Exportar diario').click());
  assert.match(t.$('p.ok[role=status]').textContent, /Exportación cancelada/);
});

test('exportar el documento: Excel (; y coma decimal) o CSV con comas', { skip }, async () => {
  const t = await setup();
  await abrirDoc(t, 'Documento');
  await t.act(() => t.btn('Exportar documento (Excel)').click());
  await t.act(() => t.btn('Exportar documento (CSV con comas)').click());
  assert.deepEqual(t.saved.map((f) => [f.name, f.type]), [['nutritiontracker-alimentos-excel-2026-10-16.csv', 'text/csv'], ['nutritiontracker-alimentos-2026-10-16.csv', 'text/csv']]);
  assert.ok(t.saved[0].text.startsWith('﻿id;nombre;'));
  assert.match(t.saved[0].text, /aceite_oliva;.*;0,91;/);
  assert.ok(t.saved[1].text.startsWith('﻿id,nombre,'));
  assert.match(t.$('p.ok[role=status]').textContent, /Documento exportado: 69 alimentos/);
});

test('importar el diario: resumen antes de aplicar, fusión por id, nunca borra; repetir no duplica', { skip }, async () => {
  const local = MEAL('local', '2026-10-14', 'desayuno', [['avena_copos', 80]]);
  const t = await setup({ meals: [AYER, local] });
  await abrirDoc(t);
  const copia = { tipo: 'nutrition-tracker/diario', formatVersion: 1, exportedAt: 'x', objetivos: null, comidas: [
    AYER, // igual
    { ...MEAL('nueva', '2026-10-12', 'cena', [['huevo', 100], ['desconocido', 10]]) },
    { ...AYER, id: 'r1', updatedAt: '2026-10-16T09:00:00.000Z', lines: [{ food_id: 'kiwi_verde', grams: 69, source_text: '' }] }, // repetido en la copia: error
    { id: 'mal', date: '2026-10-12', meal: 'comida', createdAt: 'x', lines: [] },
  ] };
  await t.attach(t.$('input[aria-label="Elegir copia del diario"]'), fichero('copia.json', copia));
  const r = t.$('section[aria-label="Importar copia"]').textContent;
  assert.match(r, /«copia\.json»: 2 comidas válidas/);
  assert.match(r, /1 nuevas/);
  assert.match(r, /0 se actualizan/);
  assert.match(r, /1 ya estaban igual/);
  assert.match(r, /Alimentos que no están en tu documento \(saldrán sin datos\): desconocido/);
  assert.match(r, /Comidas con error, no se importan \(2\)/);
  assert.match(r, /Importar nunca borra nada/);
  assert.equal((await t.store.allMeals()).length, 2); // nada aplicado todavía
  await t.act(() => t.btn('Importar 1 comida').click());
  assert.deepEqual((await t.store.allMeals()).map((m) => m.id).sort(), ['local', 'nueva', 'r1']);
  assert.match(t.$('p.ok[role=status]').textContent, /Copia importada: 1 nuevas, 0 actualizadas/);
  await t.attach(t.$('input[aria-label="Elegir copia del diario"]'), fichero('copia.json', copia));
  assert.match(t.root.textContent, /No hay nada nuevo que importar/);
  await t.act(() => t.btn('Cerrar').click());
  assert.equal(t.$('section[aria-label="Importar copia"]'), null);
});

test('importar el diario: una comida más reciente en la copia sustituye a la del dispositivo', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await abrirDoc(t);
  const editada = { ...AYER, meal: 'cena', updatedAt: '2026-10-16T09:00:00.000Z' };
  await t.attach(t.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', [editada]));
  assert.match(t.root.textContent, /1 se actualizan/);
  await t.act(() => t.btn('Importar 1 comida').click());
  assert.deepEqual(await t.store.allMeals(), [editada]);
});

test('importar el diario: fichero que no es una copia -> error claro y nada cambia', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await abrirDoc(t);
  await t.attach(t.$('input[aria-label="Elegir copia del diario"]'), fichero('alimentos.json', { foods: [] }));
  assert.match(t.$('[role=alert]').textContent, /«alimentos\.json»: No es una copia del diario/);
  assert.deepEqual(await t.store.allMeals(), [AYER]);
});

test('importar el diario: los objetivos de la copia solo se restauran si en este dispositivo no hay', { skip }, async () => {
  // copia antigua (objetivos de la pantalla anterior): se convierten en un plan desde su primera comida
  const copia = { tipo: 'nutrition-tracker/diario', formatVersion: 1, comidas: [AYER], objetivos: { perfil: 'mujer', valores: { energia_kcal: 1800 } } };
  const sin = await setup();
  await abrirDoc(sin);
  await sin.attach(sin.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', copia));
  assert.match(sin.root.textContent, /Se restaurarán los objetivos de la copia/);
  await sin.act(() => sin.btn('Importar 1 comida').click());
  const plan = await sin.store.getSetting('plan_objetivos');
  assert.deepEqual([plan.perfil, plan.periodos[0].inicio, plan.periodos[0].valores], ['mujer', AYER.date, { energia_kcal: { objetivo: 1800 } }]);
  const con = await setup({ objetivos: { perfil: 'hombre', valores: { energia_kcal: 2500 } } });
  await abrirDoc(con);
  await con.attach(con.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', { ...copia, comidas: [] }));
  assert.match(con.root.textContent, /Objetivos: se mantienen los de este dispositivo/);
  assert.match(con.root.textContent, /No hay nada nuevo que importar/);
});

// ---------- "Repetir comida" (tras el MVP) ----------
const DESAYUNO_AYER = MEAL('r0', '2026-10-15', 'desayuno', [['avena_copos', 80]]);
const gramosDe = (t) => t.$$('.repeat-item input.grams').map((i) => i.value);
const itemDe = (t, nombre) => t.$$('.repeat-item').find((li) => li.textContent.includes(nombre));
const kcal = (id, g) => (realFoods.find((f) => f.id === id).nutrients.energia_kcal * g) / 100;

// Casilla de una comida del origen (a la izquierda del nombre) y de un alimento; estado de ambas.
const casillaComida = (t, nombre) => t.$$('.repeat-group').find((g) => g.querySelector('h2').textContent === nombre).querySelector('input.meal-check');
const casillaItem = (t, nombre) => itemDe(t, nombre).querySelector('input[type=checkbox]');
const estadoCasilla = (c) => (c.indeterminate ? 'some' : c.checked ? 'all' : 'none');
const sinMarcar = (t) => t.$$('.repeat-item input[type=checkbox]').every((c) => !c.checked);

test('Repetir de ayer: agrupado y SIN nada marcado; la casilla de cada comida marca; ajuste rápido y totales en vivo; "Añadir" guarda sin IA', { skip }, async () => {
  const t = await setup({ meals: [AYER, DESAYUNO_AYER] });
  await t.act(() => t.btn('Repetir de ayer').click());
  assert.equal(t.$('.source-label').textContent, 'De: Ayer');
  assert.deepEqual(t.$$('.repeat-group h2').map((x) => x.textContent), ['Desayuno', 'Comida']);
  assert.deepEqual(gramosDe(t), ['80', '150', '69', '10']);
  assert.ok(sinMarcar(t));
  assert.deepEqual(t.$$('.repeat-group input.meal-check').map(estadoCasilla), ['none', 'none']);
  assert.ok(t.$$('.repeat-item').every((li) => li.classList.contains('off')));
  assert.equal(t.$('.bar button.primary').disabled, true);
  assert.equal(t.$('.bar button.primary').textContent, 'Añadir');
  assert.match(t.$('.bar').textContent, /Marca al menos un alimento/);
  assert.match(t.$('.bar .totals').textContent, /^Total: nada marcado$/); // sin «sin dato» engañoso
  assert.equal(t.$('select[aria-label="Comida de destino"]').value, 'origen');
  assert.equal(t.$('input[aria-label="Fecha de destino"]').value, '2026-10-16');
  // las casillas de las dos comidas marcan todo
  casillaComida(t, 'Desayuno').click();
  casillaComida(t, 'Comida').click();
  assert.ok(t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked));
  assert.match(t.$('.bar .totals').textContent, new RegExp(`Total: ${Math.round(kcal('avena_copos', 80) + kcal('arroz_blanco_crudo', 150) + kcal('kiwi_verde', 69) + kcal('aceite_oliva', 10))} kcal`));
  // quitar el kiwi (la casilla de su comida queda indeterminada), +10 al arroz, teclear la avena
  const kiwi = itemDe(t, 'Kiwi');
  kiwi.querySelector('input[type=checkbox]').checked = false;
  kiwi.querySelector('input[type=checkbox]').dispatchEvent(new t.document.defaultView.Event('change', { bubbles: true }));
  assert.ok(kiwi.classList.contains('off'));
  assert.equal(estadoCasilla(casillaComida(t, 'Comida')), 'some');
  assert.equal(estadoCasilla(casillaComida(t, 'Desayuno')), 'all');
  itemDe(t, 'Arroz').querySelector('button[aria-label^="+10"]').click();
  t.type(itemDe(t, 'Avena').querySelector('input.grams'), '90,5');
  assert.deepEqual(gramosDe(t), ['90,5', '160', '69', '10']);
  const total = Math.round(kcal('avena_copos', 90.5) + kcal('arroz_blanco_crudo', 160) + kcal('aceite_oliva', 10));
  assert.match(t.$('.bar .totals').textContent, new RegExp(`Total: ${total} kcal`));
  await t.act(() => t.btn('Añadir 3 alimentos').click());
  // vuelve al diario de hoy
  assert.equal(t.$('.daylabel').textContent, 'Hoy');
  assert.match(t.$('p.ok[role=status]').textContent, /Añadidos 3 alimentos de ayer/);
  const hoy = (await t.store.allMeals()).filter((m) => m.date === '2026-10-16');
  assert.deepEqual(hoy.map((m) => [m.meal, m.text, m.lines.map((l) => [l.food_id, l.grams, l.source_text])]), [
    ['desayuno', 'Repetido de 2026-10-15', [['avena_copos', 90.5, 'repetido de 2026-10-15']]],
    ['comida', 'Repetido de 2026-10-15', [['arroz_blanco_crudo', 160, 'repetido de 2026-10-15'], ['aceite_oliva', 10, 'repetido de 2026-10-15']]]]);
  assert.equal(t.calls.length, 0); // ninguna llamada a la IA
});

test('Repetir: tocar el campo selecciona el número; −10 no baja de 1 g', { skip }, async () => {
  const t = await setup({ meals: [DESAYUNO_AYER] });
  await t.act(() => t.btn('Repetir de ayer').click());
  const input = t.$('.repeat-item input.grams');
  assert.equal(input.getAttribute('inputmode'), 'decimal');
  input.focus();
  input.dispatchEvent(new t.document.defaultView.FocusEvent('focus'));
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 2]);
  t.type(input, '8');
  for (let i = 0; i < 2; i++) t.$('button[aria-label^="−10"]').click();
  assert.equal(input.value, '1');
});

test('Repetir: la casilla de la comida marca y desmarca todos, es indeterminada con algunos y se actualiza sola; accesible', { skip }, async () => {
  const t = await setup({ meals: [AYER, DESAYUNO_AYER] });
  await t.act(() => t.btn('Repetir de ayer').click());
  const comida = casillaComida(t, 'Comida');
  const desayuno = casillaComida(t, 'Desayuno');
  // input real con su etiqueta (el nombre de la comida), a la izquierda del nombre
  assert.equal(comida.type, 'checkbox');
  const etiqueta = comida.closest('label');
  assert.equal(etiqueta.textContent, 'Comida');
  assert.equal(etiqueta.firstElementChild, comida);
  assert.equal(etiqueta.closest('h2').textContent, 'Comida');
  // vacía -> pulsar marca todos los de esa comida (y solo esos)
  comida.click();
  assert.deepEqual(['arroz', 'kiwi', 'aceite'].map((n) => casillaItem(t, n.charAt(0).toUpperCase() + n.slice(1)).checked), [true, true, true]);
  assert.equal(casillaItem(t, 'Avena').checked, false);
  assert.equal(estadoCasilla(comida), 'all');
  assert.equal(estadoCasilla(desayuno), 'none');
  assert.equal(itemDe(t, 'Kiwi').classList.contains('off'), false);
  assert.match(t.$('.bar button.primary').textContent, /^Añadir 3 alimentos$/);
  // marcada -> pulsar desmarca todos
  comida.click();
  assert.ok(sinMarcar(t));
  assert.equal(estadoCasilla(comida), 'none');
  assert.equal(itemDe(t, 'Kiwi').classList.contains('off'), true);
  assert.equal(t.$('.bar button.primary').disabled, true);
  // un alimento suelto -> indeterminada; pulsarla marca todos; los sueltos la actualizan
  casillaItem(t, 'Kiwi').click();
  assert.equal(estadoCasilla(comida), 'some');
  assert.equal(comida.indeterminate, true);
  comida.click();
  assert.equal(estadoCasilla(comida), 'all');
  assert.ok(['Arroz', 'Kiwi', 'Aceite'].every((n) => casillaItem(t, n).checked));
  casillaItem(t, 'Aceite').click();
  assert.equal(estadoCasilla(comida), 'some');
  casillaItem(t, 'Aceite').click();
  assert.equal(estadoCasilla(comida), 'all');
  for (const n of ['Arroz', 'Kiwi', 'Aceite']) casillaItem(t, n).click();
  assert.equal(estadoCasilla(comida), 'none');
  assert.equal(comida.indeterminate, false);
  // marcar una línea con los gramos vacíos desde la casilla de la comida avisa y no deja añadir
  t.type(itemDe(t, 'Kiwi').querySelector('input.grams'), '');
  comida.click();
  assert.equal(itemDe(t, 'Kiwi').querySelector('input.grams').classList.contains('bad'), true);
  assert.equal(t.$('.bar button.primary').disabled, true);
  assert.match(t.$('.bar').textContent, /Pon los gramos de las líneas marcadas/);
});

test('Repetir: "Añadir" con nada marcado está desactivado, lo dice y no guarda nada', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await t.act(() => t.btn('Repetir de ayer').click());
  const boton = t.$('.bar button.primary');
  assert.equal(boton.disabled, true);
  assert.match(t.$('.bar').textContent, /Marca al menos un alimento/);
  await t.act(() => boton.click());
  assert.match(t.$('header').textContent, /Repetir/); // sigue en la pantalla
  assert.equal((await t.store.allMeals()).filter((m) => m.date === '2026-10-16').length, 0);
  casillaComida(t, 'Comida').click();
  casillaComida(t, 'Comida').click(); // marcar y desmarcar vuelve a dejarlo sin nada que añadir
  assert.equal(t.$('.bar button.primary').disabled, true);
  assert.match(t.$('.bar').textContent, /Marca al menos un alimento/);
});

test('«Copiar día anterior» (tres puntos del Diario) abre con TODO marcado y lo conserva al cambiar de día con las flechas', { skip }, async () => {
  const t = await setup({ meals: [AYER, DESAYUNO_AYER, MEAL('a2', '2026-10-14', 'cena', [['huevo', 100]])] });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => t.$('button[aria-label="Más opciones del día"]').click());
  await t.act(() => t.btn('Copiar día anterior').click());
  assert.equal(t.$('.source-label').textContent, 'De: Ayer');
  assert.ok(t.$$('.repeat-item input[type=checkbox]').length === 4 && t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked));
  assert.deepEqual(t.$$('.repeat-group input.meal-check').map(estadoCasilla), ['all', 'all']);
  assert.match(t.$('.bar button.primary').textContent, /^Añadir 4 alimentos$/);
  // flechas: el día anterior (anteayer) también llega con todo marcado, y volver a ayer igual
  await t.act(() => t.$('button[aria-label="Día de origen anterior"]').click());
  assert.ok(t.$$('.repeat-item input[type=checkbox]').length === 1 && t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked));
  await t.act(() => t.$('button[aria-label="Día de origen siguiente"]').click());
  assert.equal(t.$$('.repeat-item input[type=checkbox]').length, 4);
  assert.ok(t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked));
  await t.act(() => t.btn('Añadir 4 alimentos').click());
  assert.equal((await t.store.allMeals()).filter((m) => m.date === '2026-10-16').reduce((a, m) => a + m.lines.length, 0), 4);
});

test('Repetir esta comida (desde el Diario): solo esa comida, destino la comida de la hora; volver regresa al Diario', { skip }, async () => {
  const t = await setup({ meals: [AYER, DESAYUNO_AYER] });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  const botonRepetir = () => [...t.$('.registro[data-id="r1"]').querySelectorAll('button')].find((b) => b.textContent === 'Repetir esta comida');
  const repetir = () => botonRepetir().click();
  assert.ok(botonRepetir());
  await t.act(repetir);
  assert.deepEqual(t.$$('.repeat-group h2').map((x) => x.textContent), ['Comida']);
  assert.match(t.root.textContent, /Solo la comida que elegiste en el Diario/);
  // una sola comida elegida a propósito: llega con todo marcado (y la casilla de la comida marcada)
  assert.ok(t.$$('.repeat-item input[type=checkbox]').length === 3 && t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked));
  assert.equal(estadoCasilla(casillaComida(t, 'Comida')), 'all');
  assert.equal(t.$('.bar button.primary').disabled, false);
  assert.equal(t.$('select[aria-label="Comida de destino"]').value, 'desayuno'); // 09:30 en Madrid
  await t.act(() => t.btn('‹ Volver').click());
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  await t.act(repetir);
  await t.act(() => t.btn('Añadir 3 alimentos').click());
  const hoy = (await t.store.allMeals()).filter((m) => m.date === '2026-10-16');
  assert.deepEqual(hoy.map((m) => [m.meal, m.lines.length]), [['desayuno', 3]]);
});

test('Repetir: flechas del día de origen, día sin comidas, y destino a una comida concreta', { skip }, async () => {
  const t = await setup({ meals: [AYER, DESAYUNO_AYER] });
  await t.act(() => t.btn('Repetir de ayer').click());
  assert.equal(t.$('button[aria-label="Día de origen siguiente"]').disabled, false);
  casillaComida(t, 'Comida').click(); // marcado a mano; al cambiar de día se parte de cero
  await t.act(() => t.$('button[aria-label="Día de origen anterior"]').click());
  assert.match(t.root.textContent, /No hay comidas guardadas ese día/);
  assert.equal(t.$('.bar button.primary').disabled, true);
  await t.act(() => t.$('button[aria-label="Día de origen siguiente"]').click());
  assert.equal(t.$('.source-label').textContent, 'De: Ayer');
  assert.ok(sinMarcar(t)); // al volver con las flechas sigue sin marcar nada
  assert.equal(t.$('.bar button.primary').disabled, true);
  await t.act(() => t.$('button[aria-label="Día de origen siguiente"]').click());
  assert.equal(t.$('.source-label').textContent, 'De: Hoy');
  assert.equal(t.$('button[aria-label="Día de origen siguiente"]').disabled, true);
  await t.act(() => t.$('button[aria-label="Día de origen anterior"]').click());
  assert.ok(sinMarcar(t));
  casillaComida(t, 'Desayuno').click(); casillaComida(t, 'Comida').click();
  const sel = t.$('select[aria-label="Comida de destino"]');
  sel.value = 'cena'; sel.dispatchEvent(new t.document.defaultView.Event('change', { bubbles: true }));
  await t.act(() => t.btn('Añadir 4 alimentos').click());
  const hoy = (await t.store.allMeals()).filter((m) => m.date === '2026-10-16');
  assert.deepEqual(hoy.map((m) => [m.meal, m.lines.length]), [['cena', 4]]);
});

test('Repetir: sin gramos o con más de 2000 g no se puede añadir, y se dice por qué', { skip }, async () => {
  const t = await setup({ meals: [DESAYUNO_AYER] });
  await t.act(() => t.btn('Repetir de ayer').click());
  casillaComida(t, 'Desayuno').click();
  const input = t.$('.repeat-item input.grams');
  t.type(input, '');
  assert.equal(t.$('.bar button.primary').disabled, true);
  assert.match(t.$('.bar').textContent, /Pon los gramos de las líneas marcadas/);
  assert.ok(input.classList.contains('bad'));
  t.type(input, '2500');
  assert.match(t.$('.bar').textContent, /Más de 2000 g en una línea/);
  t.type(input, '85');
  assert.equal(t.$('.bar button.primary').disabled, false);
  assert.equal(input.classList.contains('bad'), false);
});

// ---------- Plantillas ----------
test('plantillas: guardar una comida del Diario, verla en Plantillas y usarla con "Repetir"', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await t.act(() => t.btn('Diario').click());
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  await t.act(() => t.btn('Guardar como plantilla').click());
  const nombre = t.$('input[aria-label="Nombre de la plantilla"]');
  assert.equal(nombre.placeholder, 'Por ejemplo: Comida habitual');
  await t.act(() => t.btn('Guardar plantilla').click());
  assert.match(t.$('[role=alert]').textContent, /Ponle un nombre/);
  t.$('input[aria-label="Nombre de la plantilla"]').value = 'Arroz con kiwi';
  await t.act(() => t.btn('Guardar plantilla').click());
  assert.match(t.$('p.ok[role=status]').textContent, /Plantilla «Arroz con kiwi» guardada/);
  assert.deepEqual((await t.store.getSetting('plantillas')).map((p) => [p.nombre, p.meal, p.lines.length]), [['Arroz con kiwi', 'comida', 3]]);
  // repetir el nombre: no se guarda
  await t.act(() => t.btn('Guardar como plantilla').click());
  t.$('input[aria-label="Nombre de la plantilla"]').value = 'ARROZ CON KIWI';
  await t.act(() => t.btn('Guardar plantilla').click());
  assert.match(t.$('[role=alert]').textContent, /Ya tienes una plantilla/);
  await t.act(() => t.btn('Cancelar').click());
  // usarla desde Alimentos -> Plantillas
  await t.act(() => t.btn('Alimentos').click());
  await t.act(() => t.btn('Ver plantillas').click());
  assert.match(t.$('.plantilla').textContent, /Arroz con kiwi/);
  assert.match(t.$('.plantilla').textContent, /Comida · \d+ kcal/);
  await t.act(() => t.btn('Usar').click());
  assert.match(t.$('header').textContent, /Usar plantilla/);
  assert.equal(t.$('.source-label').textContent, 'De: plantilla «Arroz con kiwi»');
  assert.equal(t.$('button[aria-label="Día de origen anterior"]'), null);
  assert.equal(t.$('select[aria-label="Comida de destino"]').value, 'origen');
  // una plantilla es una sola comida elegida a propósito: todo marcado desde el principio
  assert.ok(t.$$('.repeat-item input[type=checkbox]').length === 3 && t.$$('.repeat-item input[type=checkbox]').every((c) => c.checked));
  assert.equal(estadoCasilla(casillaComida(t, 'Comida')), 'all');
  t.type(t.$$('.repeat-item input.grams')[0], '100');
  await t.act(() => t.btn('Añadir 3 alimentos').click());
  assert.match(t.$('p.ok[role=status]').textContent, /Añadidos 3 alimentos de la plantilla «Arroz con kiwi»/);
  const hoy = (await t.store.allMeals()).filter((m) => m.date === '2026-10-16');
  assert.deepEqual(hoy.map((m) => [m.meal, m.text, m.lines[0].grams]), [['comida', 'Plantilla: Arroz con kiwi', 100]]);
  assert.equal(t.calls.length, 0);
});

test('plantillas: lista vacía, borrar con confirmación y "Volver" desde Usar regresa a Plantillas', { skip }, async () => {
  const t = await setup();
  await t.act(() => t.btn('Plantillas').click());
  assert.match(t.root.textContent, /Aún no tienes plantillas/);
  await t.store.setSetting('plantillas', [{ id: 'p1', nombre: 'Desayuno', meal: 'desayuno', createdAt: '', lines: [{ food_id: 'avena_copos', grams: 80 }] }]);
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.btn('Plantillas').click());
  await t.act(() => t.btn('Usar').click());
  await t.act(() => t.btn('‹ Volver').click());
  assert.match(t.$('header').textContent, /Plantillas/);
  await t.act(() => t.$('.plantilla button.danger').click());
  assert.match(t.root.textContent, /¿Borrar esta plantilla\?/);
  await t.act(() => t.btn('Sí, borrar').click());
  assert.deepEqual(await t.store.getSetting('plantillas'), []);
  assert.match(t.$('p.ok[role=status]').textContent, /Plantilla «Desayuno» borrada/);
});

test('copia de seguridad con plantillas: se exportan y al importar se añaden las nuevas', { skip }, async () => {
  const P = { id: 'p1', nombre: 'Desayuno', meal: 'desayuno', createdAt: '', lines: [{ food_id: 'avena_copos', grams: 80 }] };
  const t = await setup();
  await t.store.setSetting('plantillas', [P]);
  await t.act(() => masA(t, 'Copia de seguridad'));
  await t.act(() => t.btn('Exportar diario').click());
  assert.deepEqual(JSON.parse(t.saved[0].text).plantillas, [P]);
  const copia = { tipo: 'nutrition-tracker/diario', formatVersion: 1, comidas: [], objetivos: null, plantillas: [P, { ...P, id: 'p2', nombre: 'Cena' }] };
  await t.attach(t.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', copia));
  assert.match(t.root.textContent, /1 plantillas nuevas/);
  await t.act(() => t.btn('Importar 1 plantilla').click());
  assert.deepEqual((await t.store.getSetting('plantillas')).map((x) => x.nombre), ['Cena', 'Desayuno']);
  assert.match(t.$('p.ok[role=status]').textContent, /1 plantilla/);
});

// ---------- Registro local de frases problemáticas ----------
test('registro: un dictado con problemas se anota (solo local) y al guardar se anota qué elegiste', { skip }, async () => {
  const resp = { items: [ITEM('pechuga_pollo_cruda', 150, '150 g de pechuga', { flags: ['sin_alias'], confidence: 'baja' }), ITEM('avena_copos', 80, '80 g de avena')], unmatched: [{ text: 'un plátano', motivo: 'no_en_catalogo' }], warnings: [], model: 'm' };
  const t = await setup({ responses: [resp] });
  t.type(t.$('textarea'), 'para desayunar 150 g de pechuga, 80 g de avena y un plátano');
  await t.act(() => t.btn('Procesar').click());
  let log = await t.store.getSetting('registro_frases');
  assert.deepEqual(log.map((e) => [e.texto, e.problemas.map((p) => [p.texto, p.tipo, p.resolucion])]), [['para desayunar 150 g de pechuga, 80 g de avena y un plátano', [['un plátano', 'no_reconocido', null], ['150 g de pechuga', 'sin_alias', null]]]]);
  // cambiar la pechuga por la de pavo y guardar (el plátano se queda sin resolver)
  await t.act(() => t.$('button.name').click());
  t.type(t.$('.overlay input'), 'pechuga de pavo');
  await t.act(() => t.$$('.pick').find((b) => b.textContent.includes('sin piel cruda')).click());
  await t.act(() => t.btn('Guardar').click());
  log = await t.store.getSetting('registro_frases');
  assert.deepEqual(log[0].problemas.map((p) => [p.texto, p.resolucion]), [['un plátano', 'descartado'], ['150 g de pechuga', 'pechuga_pavo_cruda']]);
  assert.equal((await t.store.allMeals())[0].id, 'm1'); // el registro no consume ids de comidas
  // verlo en Documento -> Frases a revisar
  await t.act(() => masA(t, 'Pulir el documento'));
  await t.act(() => t.btn('Frases a revisar (1)').click());
  const card = t.$('.frase').textContent;
  assert.match(card, /«un plátano» · No reconocido \(No está en tu documento\) · descartado/);
  assert.match(card, /«150 g de pechuga» · No coincide con tus alias · la IA: Pechuga de pollo sin piel cruda · → Pechuga de pavo sin piel cruda/);
  await t.act(() => t.btn('Exportar (CSV)').click());
  assert.equal(t.saved[0].name, 'nutritiontracker-frases-2026-10-16.csv');
  assert.match(t.saved[0].text, /un plátano;No reconocido;no_en_catalogo;;descartado/);
  await t.act(() => t.btn('Quitar').click());
  assert.match(t.root.textContent, /No hay frases pendientes de revisar/);
  assert.deepEqual(await t.store.getSetting('registro_frases'), []);
});

test('registro: un dictado sin problemas no se anota; «Vaciar» pide confirmación', { skip }, async () => {
  const limpio = { items: [ITEM('avena_copos', 80, '80 g de avena')], unmatched: [], warnings: [], model: 'm' };
  const t = await setup({ responses: [limpio] });
  t.type(t.$('textarea'), '80 g de avena');
  await t.act(() => t.btn('Procesar').click());
  assert.equal(await t.store.getSetting('registro_frases'), undefined);
  await t.store.setSetting('registro_frases', [{ id: 'e1', fecha: '2026-10-16T08:00:00Z', texto: 'x', problemas: [{ texto: 'x', tipo: 'confianza_baja', motivo: null, food_id: 'kiwi_verde', resolucion: null }] }]);
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => masA(t, 'Pulir el documento'));
  await t.act(() => t.btn('Frases a revisar (1)').click());
  assert.match(t.$('.frase').textContent, /Confianza baja · la IA: Kiwi verde · sin guardar/);
  await t.act(() => t.btn('Vaciar').click());
  assert.match(t.root.textContent, /¿Vaciar todo el registro\?/);
  await t.act(() => t.btn('Sí, vaciar').click());
  assert.deepEqual(await t.store.getSetting('registro_frases'), []);
  assert.match(t.$('p.ok[role=status]').textContent, /Registro vaciado/);
  await t.act(() => t.btn('‹ Volver').click());
  assert.match(t.root.textContent, /Frases a revisar \(0\)/);
});

// ---------- Contexto no seguro (http con la IP del PC): sin crypto.randomUUID ----------
const sinRandomUUID = () => { Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true }); return () => delete globalThis.crypto.randomUUID; };

test('sin crypto.randomUUID (http con IP), guardar funciona con el generador de ids de la app', { skip }, async () => {
  const restaurar = sinRandomUUID();
  try {
    assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
    const t = await setup({ responses: [RESULT], idGen: null }); // como en producción: sin generador de ids inyectado
    t.type(t.$('textarea'), 'para desayunar 80 g de avena, 2 huevos y un plátano'); // con un no reconocido: también se anota en el registro
    await t.act(() => t.btn('Procesar').click());
    assert.equal(t.$('.error'), null);
    await t.act(() => t.btn('Guardar').click());
    const [m] = await t.store.allMeals();
    assert.match(m.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(t.$('[role=status]').textContent, /Guardado en desayuno/);
    assert.equal((await t.store.getSetting('registro_frases')).length, 1);
  } finally { restaurar(); }
  assert.equal(typeof globalThis.crypto.randomUUID, 'function');
});

test('ningún error al guardar es silencioso: "No se pudo guardar: …" y el borrador se conserva', { skip }, async () => {
  let romper = true;
  const t = await setup({ responses: [RESULT], alterStore: (st) => ({ ...st, addMeal: async (rec) => { if (romper) throw new Error('disco lleno'); return st.addMeal(rec); } }) });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  t.type(t.$$('input.grams')[0], '90');
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('[role=alert]').textContent, /No se pudo guardar: disco lleno/);
  assert.match(t.$('header').textContent, /Confirmar/); // sigue en la confirmación
  assert.equal(t.$$('input.grams')[0].value, '90'); // con lo que habías cambiado
  assert.deepEqual(await t.store.allMeals(), []);
  romper = false;
  await t.act(() => t.btn('Guardar').click());
  assert.equal((await t.store.allMeals()).length, 1);
  assert.equal(t.$('.error[role=alert]'), null); // el aviso desaparece al guardar bien
});

test('también en Repetir: un fallo al guardar se ve y la pantalla se conserva', { skip }, async () => {
  let romper = false;
  const t = await setup({ meals: [AYER], alterStore: (st) => ({ ...st, addMeal: async (rec) => { if (romper) throw new Error('sin espacio'); return st.addMeal(rec); } }) });
  romper = true;
  await t.act(() => t.btn('Repetir de ayer').click());
  casillaComida(t, 'Comida').click();
  await t.act(() => t.btn('Añadir 3 alimentos').click());
  assert.match(t.$('[role=alert]').textContent, /No se pudo guardar: sin espacio/);
  assert.match(t.$('header').textContent, /Repetir/);
  await t.act(() => t.btn('Cerrar').click());
  assert.equal(t.$('p.error[role=alert]'), null);
});

test('copia de seguridad con el registro de frases: se exporta y al importar se añaden las nuevas', { skip }, async () => {
  const F = { id: 'f1', fecha: '2026-10-15T08:00:00Z', texto: '150 g de pechuga', problemas: [{ texto: '150 g de pechuga', tipo: 'sin_alias', motivo: null, food_id: 'pechuga_pollo_cruda', resolucion: 'pechuga_pavo_cruda' }] };
  const t = await setup();
  await t.store.setSetting('registro_frases', [F]);
  await t.act(() => masA(t, 'Copia de seguridad'));
  await t.act(() => t.btn('Exportar diario').click());
  assert.deepEqual(JSON.parse(t.saved[0].text).registro_frases, [F]);
  const copia = { tipo: 'nutrition-tracker/diario', formatVersion: 1, comidas: [], objetivos: null, plantillas: [], registro_frases: [F, { ...F, id: 'f2', fecha: '2026-10-16T08:00:00Z', texto: 'un plátano' }] };
  await t.attach(t.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', copia));
  assert.match(t.root.textContent, /1 frases a revisar nuevas/);
  await t.act(() => t.btn('Importar 1 frase').click());
  assert.deepEqual((await t.store.getSetting('registro_frases')).map((x) => x.id), ['f2', 'f1']);
  assert.match(t.$('p.ok[role=status]').textContent, /1 frase a revisar/);
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.btn('Pulir el documento').click());
  assert.match(t.root.textContent, /Frases a revisar \(2\)/);
});

// ---------- Actualizar el documento con el foods.csv publicado ----------
const CSV_H = 'id,nombre,alias,energia_kcal,incluir';
const csvDoc = (...rows) => [CSV_H, ...rows].join('\n') + '\n';
const docDe = (text) => parseFoodsCSV(text, { catalog }).foods;

test('documento publicado nuevo (sin base): aviso en el inicio, revisar y actualizar conservando lo activado', { skip }, async () => {
  const mio = docDe(csvDoc('arroz,Arroz,arroz,365,si', 'mayonesa,Mayonesa,mayonesa,680,no', 'merluza_cocida,Merluza cocida,merluza,116,si'));
  const publicado = csvDoc('arroz,Arroz,arroz|arroz largo,360,si', 'mayonesa,Mayonesa,mayonesa|mahonesa,680,si', 'merluza_cocida,Merluza cocida,merluza,116,no', 'brocoli,Brócoli,brócoli,34,si');
  const t = await setup({ foods: mio, publicado, enDiario: true });
  const aviso = t.$('section[aria-label="Documento nuevo"]');
  assert.match(aviso.textContent, /Hay una versión nueva de tu documento de alimentos: 1 nuevos, 2 actualizados, 1 campo en conflicto en 1 alimento/);
  await t.act(() => t.btn('Revisar').click());
  assert.match(t.root.textContent, /4 alimentos/);
  assert.match(t.$('.conflicto').textContent, /Merluza cocida · incluir/);
  assert.equal(t.btn('Mío: activado').getAttribute('aria-pressed'), 'true');
  await t.act(() => t.btn('Actualizar').click());
  const rec = await t.store.getCatalogRecord();
  const de = (id) => rec.foods.find((f) => f.id === id);
  assert.deepEqual([de('arroz').alias, de('arroz').nutrients.energia_kcal, de('mayonesa').extra.incluir, de('merluza_cocida').extra.incluir, !!de('brocoli')], [['arroz', 'arroz largo'], 360, 'si', 'si', true]);
  assert.match(t.$('[role=status]').textContent, /Documento actualizado: 1 nuevos, 2 actualizados/);
  assert.equal(t.$('section[aria-label="Documento nuevo"]'), null);
  assert.equal((await t.store.getSetting('catalogo_base')).text, publicado);
});

test('conflicto con base: eliges "Publicado" y se aplica; nada cambia hasta pulsar Actualizar', { skip }, async () => {
  const base = csvDoc('arroz,Arroz,arroz,365,si');
  const mio = docDe(csvDoc('arroz,Arroz,arroz|arroz blanco,365,si'));
  const publicado = csvDoc('arroz,Arroz,arroz|arroz largo,365,si');
  const t = await setup({ foods: mio, publicado, enDiario: true, ajustes: { catalogo_base: { hash: 'x', text: base } } });
  await t.act(() => t.btn('Revisar').click());
  assert.match(t.$('.conflicto').textContent, /Arroz · alias/);
  await t.act(() => t.btn('Publicado: arroz | arroz largo').click());
  assert.equal(await t.store.getCatalogRecord(), null); // aún no se ha guardado nada
  await t.act(() => t.btn('Actualizar').click());
  assert.deepEqual((await t.store.getCatalogRecord()).foods[0].alias, ['arroz', 'arroz largo']);
});

// Conflictos por alimento: dos botones por alimento, uno global con confirmación y los añadidos con IA ya como «Publicado».
const CSV_X = 'id,nombre,alias,energia_kcal,proteina_g,tipo,pendiente_revisar';
const csvX = (...rows) => [CSV_X, ...rows].join('\n') + '\n';
const enAlimento = (t, id, texto) => [...t.$(`[data-id="${id}"]`).querySelectorAll('button')].find((b) => b.textContent.includes(texto));
const escenarioIA = () => ({
  base: csvX('arroz,Arroz,arroz,365,7,,'),
  mio: docDe(csvX('arroz,Arroz,arroz|blanco,360,8,,', 'pasta,Pasta,pasta,340,11,usda_app,si')),
  publicado: csvX('arroz,Arroz,arroz|largo,350,9,,', 'pasta,Pasta,pasta,355,13,,'),
});

test('conflictos por alimento: nº de campos, «Mío» por defecto y, en lo añadido con IA, «Publicado» con su aviso', { skip }, async () => {
  const { base, mio, publicado } = escenarioIA();
  const t = await setup({ foods: mio, publicado, enDiario: true, ajustes: { catalogo_base: { hash: 'x', text: base } } });
  await t.act(() => t.btn('Revisar').click());
  assert.match(t.root.textContent, /\d+ conflictos en 2 alimentos/);
  assert.match(t.$('[data-id="arroz"]').textContent, /Arroz · 3 campos en conflicto/);
  assert.match(t.$('[data-id="pasta"]').textContent, /Pasta · \d+ campos en conflicto/);
  assert.equal(t.$('[data-id="arroz"] .aviso-ia'), null);
  assert.match(t.$('[data-id="pasta"] .aviso-ia').textContent, /lo añadiste con IA; el documento publicado trae datos revisados/);
  assert.equal(enAlimento(t, 'arroz', 'Mantener el mío en todo el alimento').getAttribute('aria-pressed'), 'true');
  assert.equal(enAlimento(t, 'arroz', 'Usar el publicado en todo el alimento').getAttribute('aria-pressed'), 'false');
  assert.equal(enAlimento(t, 'pasta', 'Usar el publicado en todo el alimento').getAttribute('aria-pressed'), 'true');
  assert.equal(enAlimento(t, 'pasta', 'Mantener el mío en todo el alimento').getAttribute('aria-pressed'), 'false');
  // sin tocar nada: lo normal se queda mío, lo añadido con IA llega como lo publicado
  await t.act(() => t.btn('Actualizar').click());
  const rec = await t.store.getCatalogRecord();
  const de = (id) => rec.foods.find((f) => f.id === id);
  assert.deepEqual([de('arroz').alias, de('arroz').nutrients.energia_kcal, de('pasta').nutrients.energia_kcal, de('pasta').nutrients.proteina_g], [['arroz', 'blanco'], 360, 355, 13]);
  assert.equal((await t.store.getSetting('catalogo_base')).text, publicado);
});

test('botones por alimento: publicado en todo uno y mantener lo mío en el otro; la elección campo a campo sigue', { skip }, async () => {
  const { base, mio, publicado } = escenarioIA();
  const t = await setup({ foods: mio, publicado, enDiario: true, ajustes: { catalogo_base: { hash: 'x', text: base } } });
  await t.act(() => t.btn('Revisar').click());
  await t.act(() => enAlimento(t, 'arroz', 'Usar el publicado en todo el alimento').click());
  await t.act(() => enAlimento(t, 'pasta', 'Mantener el mío en todo el alimento').click());
  assert.equal(enAlimento(t, 'arroz', 'Usar el publicado en todo el alimento').getAttribute('aria-pressed'), 'true');
  assert.equal(enAlimento(t, 'pasta', 'Mantener el mío en todo el alimento').getAttribute('aria-pressed'), 'true');
  // un campo a mano: el alimento queda mezclado (ninguno de los dos botones marcado)
  const campo = t.$('[data-id="arroz"] [data-campo="nutriente:energia_kcal"]');
  await t.act(() => [...campo.querySelectorAll('button')].find((b) => b.textContent.startsWith('Mío')).click());
  assert.equal(enAlimento(t, 'arroz', 'Usar el publicado en todo el alimento').getAttribute('aria-pressed'), 'false');
  assert.equal(enAlimento(t, 'arroz', 'Mantener el mío en todo el alimento').getAttribute('aria-pressed'), 'false');
  await t.act(() => t.btn('Actualizar').click());
  const rec = await t.store.getCatalogRecord();
  const de = (id) => rec.foods.find((f) => f.id === id);
  assert.deepEqual([de('arroz').alias, de('arroz').nutrients.energia_kcal, de('arroz').nutrients.proteina_g], [['arroz', 'largo'], 360, 9]);
  assert.deepEqual([de('pasta').nutrients.energia_kcal, de('pasta').nutrients.proteina_g, de('pasta').extra.tipo], [340, 11, 'usda_app']);
});

const esperaToggle = async (t, id, valor) => { for (let i = 0; i < 100 && t.app.state.catAbiertos[id] !== valor; i++) await new Promise((r) => setTimeout(r, 10)); };

test('regresión: el desplegable «campo a campo» de un alimento con más de 3 conflictos sigue abierto al elegir un campo; la confirmación global se cierra al salir', { skip }, async () => {
  const { base, mio, publicado } = escenarioIA();
  const t = await setup({ foods: mio, publicado, enDiario: true, ajustes: { catalogo_base: { hash: 'x', text: base } } });
  await t.act(() => t.btn('Revisar').click());
  const det = (id) => t.$(`[data-id="${id}"] details.campos`);
  assert.equal(det('pasta').open, false); // más de 3 campos: plegado
  assert.equal(det('arroz').open, true); // 3 campos: abierto
  det('pasta').open = true;
  await esperaToggle(t, 'pasta', true); // el evento toggle llega después
  const campo = t.$('[data-id="pasta"] [data-campo="nutriente:energia_kcal"]');
  await t.act(() => [...campo.querySelectorAll('button')].find((b) => b.textContent.startsWith('Mío')).click());
  assert.equal(det('pasta').open, true, 'sigue abierto tras elegir un campo');
  assert.equal(det('arroz').open, true);
  assert.equal([...t.$('[data-id="pasta"] [data-campo="nutriente:energia_kcal"]').querySelectorAll('button')].find((b) => b.textContent.startsWith('Mío')).getAttribute('aria-pressed'), 'true');
  // cerrarlo a mano también se recuerda
  det('arroz').open = false;
  await esperaToggle(t, 'arroz', false);
  await t.act(() => enAlimento(t, 'arroz', 'Usar el publicado en todo el alimento').click());
  assert.equal(det('arroz').open, false);
  // la pregunta de «en todos» no se queda pendiente al salir y volver
  await t.act(() => t.btn('Usar el publicado en todos').click());
  assert.ok(t.$('[role=alertdialog]'));
  await t.act(() => t.btn('‹ Volver').click());
  await t.act(() => t.btn('Revisar').click());
  assert.equal(t.$('[role=alertdialog]'), null);
});

test('«Usar el publicado en todos» pide confirmación dentro de la app y no cambia nada hasta confirmar y actualizar', { skip }, async () => {
  const { base, mio, publicado } = escenarioIA();
  const t = await setup({ foods: mio, publicado, enDiario: true, ajustes: { catalogo_base: { hash: 'x', text: base } } });
  await t.act(() => t.btn('Revisar').click());
  await t.act(() => t.btn('Usar el publicado en todos').click());
  assert.match(t.$('[role=alertdialog]').textContent, /¿Usar el publicado en los \d+ campos en conflicto de 2 alimentos\?/);
  assert.equal(enAlimento(t, 'arroz', 'Mantener el mío en todo el alimento').getAttribute('aria-pressed'), 'true'); // aún nada
  await t.act(() => t.btn('Cancelar').click());
  assert.equal(t.$('[role=alertdialog]'), null);
  assert.equal(enAlimento(t, 'arroz', 'Mantener el mío en todo el alimento').getAttribute('aria-pressed'), 'true');
  await t.act(() => t.btn('Usar el publicado en todos').click());
  await t.act(() => t.btn('Sí, usar el publicado en todos').click());
  assert.equal(t.$('[role=alertdialog]'), null);
  assert.equal(enAlimento(t, 'arroz', 'Usar el publicado en todo el alimento').getAttribute('aria-pressed'), 'true');
  assert.equal(await t.store.getCatalogRecord(), null); // aún no se ha guardado nada
  await t.act(() => t.btn('Actualizar').click());
  const rec = await t.store.getCatalogRecord();
  const de = (id) => rec.foods.find((f) => f.id === id);
  assert.deepEqual([de('arroz').alias, de('arroz').nutrients.energia_kcal, de('pasta').nutrients.energia_kcal], [['arroz', 'largo'], 350, 355]);
  assert.equal((await t.store.getSetting('catalogo_base')).text, publicado);
});

test('export real de Victor: 96 conflictos en 4 alimentos añadidos con IA; «Actualizar» sin tocar nada trae los datos publicados', { skip }, async () => {
  const mio = parseFoodsCSV(readFile('./fixtures/actualizar_local_ia.csv'), { catalog }).foods;
  const publicado = readFile('./fixtures/actualizar_publicado_ia.csv');
  const t = await setup({ foods: mio, publicado, enDiario: true, ajustes: { catalogo_base: { hash: 'x', text: csvX('arroz,Arroz,arroz,365,7,,') } } });
  await t.act(() => t.btn('Revisar').click());
  assert.match(t.root.textContent, /96 conflictos en 4 alimentos/);
  assert.equal(t.$$('.aviso-ia').length, 4);
  assert.match(t.$('[data-id="salchichon"]').textContent, /31 campos en conflicto/);
  assert.match(t.$('[data-id="bebida_de_avena"]').textContent, /40 campos en conflicto/);
  assert.equal(t.$$('.conflicto-alimento button[aria-pressed="true"]').filter((b) => b.textContent.startsWith('Usar el publicado')).length, 4);
  await t.act(() => t.btn('Actualizar').click());
  const rec = await t.store.getCatalogRecord();
  const pub = parseFoodsCSV(publicado, { catalog }).foods;
  for (const r of pub) assert.deepEqual(rec.foods.find((f) => f.id === r.id).nutrients, r.nutrients, r.id);
  assert.equal(rec.foods.find((f) => f.id === 'salchichon').nutrients.energia_kcal, 419.8);
});

test('«Ahora no» no vuelve a avisar de esa versión; desde Documento se puede revisar o buscar de nuevo', { skip }, async () => {
  const mio = docDe(csvDoc('arroz,Arroz,arroz,365,si'));
  const publicado = csvDoc('arroz,Arroz,arroz,360,si');
  const t = await setup({ foods: mio, publicado, enDiario: true });
  await t.act(() => t.btn('Ahora no').click());
  assert.equal(t.$('section[aria-label="Documento nuevo"]'), null);
  assert.equal(typeof (await t.store.getSetting('catalogo_ignorado')), 'string');
  await t.act(() => masA(t, 'Documento'));
  await t.act(() => t.btn('Revisar la versión nueva').click());
  assert.match(t.$('header').textContent, /Actualizar documento/);
  await t.act(() => t.btn('‹ Volver').click());
  assert.match(t.$('header').textContent, /Documento/);
});

test('al día o sin conexión: no hay aviso ni error; desde Documento se dice el resultado', { skip }, async () => {
  const text = csvDoc('arroz,Arroz,arroz,365,si');
  const t = await setup({ foods: docDe(text), publicado: text });
  assert.equal(t.$('section[aria-label="Documento nuevo"]'), null);
  assert.equal((await t.store.getSetting('catalogo_base')).text, text); // sin cambios: se adopta como base
  await t.act(() => masA(t, 'Documento'));
  await t.act(() => t.btn('Buscar actualización del documento').click());
  assert.match(t.root.textContent, /Tu documento está al día con el publicado/);
  const off = await setup({ publicado: new Error('Failed to fetch') });
  assert.equal(off.$('[role=alert]'), null);
  await off.act(() => masA(off, 'Documento'));
  await off.act(() => off.btn('Buscar actualización del documento').click());
  assert.match(off.root.textContent, /No se pudo consultar el documento publicado/);
});

test('elegir a mano un alimento excluido lo usa en la línea sin activarlo (sigue sin ir a la IA)', { skip }, async () => {
  const t = await setup({ responses: [RESULT] });
  t.type(t.$('textarea'), 'x');
  await t.act(() => t.btn('Procesar').click());
  await t.act(() => t.btn('+ Añadir alimento').click());
  t.type(t.$('.overlay input'), 'merluza cocida');
  const pick = t.$$('.pick').find((b) => b.textContent.includes('Merluza cocida'));
  assert.match(pick.textContent, /excluido \(incluir=no\): no se envía a la IA/);
  await t.act(() => pick.click());
  assert.ok(t.$$('li.card[data-key] button.name').some((b) => b.textContent === 'Merluza cocida'));
  assert.equal(t.app.state.foods.find((f) => f.id === 'merluza_cocida').extra.incluir, 'no');
  assert.equal(await t.store.getCatalogRecord(), null); // no se ha tocado el documento
});

// ---------- Alimentos retirados (data/retirados.json): la actualización del documento los elimina tras enseñarlos ----------
const RETIRADOS = { version: 1, retirados: [{ id: 'coca', fecha: '2026-10-23', motivo: 'sin datos' }, { id: 'ron', fecha: '2026-10-23', motivo: 'sin datos' }, { id: 'ya_no_esta', fecha: '2026-10-23', motivo: 'ya borrado' }] };
const escenarioRetirados = () => {
  const publicado = csvDoc('arroz,Arroz,arroz,365,si', 'kiwi_verde,Kiwi,kiwi,61,si');
  // el dispositivo tiene lo mismo + Coca-Cola y Ron (sin datos); Ron además lo cambió Victor (alias propio)
  const mio = docDe(csvDoc('arroz,Arroz,arroz,365,si', 'kiwi_verde,Kiwi,kiwi,61,si', 'coca,Coca-Cola Classic,coca-cola,,no', 'ron,Ron,ron|ron añejo,,si'));
  const baseVieja = csvDoc('arroz,Arroz,arroz,365,si', 'kiwi_verde,Kiwi,kiwi,61,si', 'coca,Coca-Cola Classic,coca-cola,,no', 'ron,Ron,ron,,no'); // lo que copió el dispositivo cuando aún se publicaban
  return { publicado, mio, ajustes: { catalogo_base: { hash: hashText(publicado), text: baseVieja } } }; // el hash coincide: el foods.csv no cambió, pero hay retirados
};

test('retirados: aunque el foods.csv no haya cambiado se ofrece la actualización; la revisión los nombra y, al aplicar, desaparecen', { skip }, async () => {
  const { publicado, mio, ajustes } = escenarioRetirados();
  const t = await setup({ foods: mio, publicado, ajustes, retirados: RETIRADOS, enDiario: true });
  const aviso = t.$('section[aria-label="Documento nuevo"]');
  assert.ok(aviso, 'el aviso del Diario se ofrece sin cambios en el publicado');
  assert.match(aviso.textContent, /0 nuevos, 0 actualizados, 2 alimentos retirados por eliminar/);
  await t.act(() => t.btn('Revisar').click());
  const sec = t.$('section[aria-label="Alimentos retirados"]');
  assert.match(sec.querySelector('h2').textContent, /^Se eliminarán 2 alimentos retirados del documento$/);
  assert.match(sec.textContent, /Coca-Cola Classic, Ron\./);
  assert.match(sec.textContent, /no se aplica hasta pulsar «Actualizar»/);
  assert.equal(sec.querySelector('.aviso-uso'), null); // el diario y las recetas no los usan: sin avisos de uso
  assert.equal(t.app.state.foods.length, 4); // nada cambia hasta pulsar Actualizar
  assert.equal(await t.store.getCatalogRecord(), null);
  await t.act(() => t.btn('Actualizar').click());
  const rec = await t.store.getCatalogRecord();
  assert.deepEqual(rec.foods.map((f) => f.id), ['arroz', 'kiwi_verde']);
  assert.deepEqual(t.app.state.foods.map((f) => f.id), ['arroz', 'kiwi_verde']);
  assert.match(t.$('[role=status]').textContent, /Documento actualizado: 0 nuevos, 0 actualizados, 2 eliminados/);
  assert.equal(t.$('section[aria-label="Documento nuevo"]'), null);
  assert.equal((await t.store.getSetting('catalogo_base')).text, publicado); // catalogo_base = lo publicado
  assert.equal(t.$('[role=alert]'), null);
});

test('retirados: la revisión avisa de las líneas del diario y de las recetas que los usan; el diario y las recetas no se tocan', { skip }, async () => {
  const { publicado, mio, ajustes } = escenarioRetirados();
  const receta = { id: 'mi_cena', nombre: 'Mi cena', ingredientes: [{ food_id: 'arroz', gramos: 100 }, { food_id: 'ron', gramos: 10 }] };
  const meals = [MEAL('m1', '2026-10-15', 'cena', [['arroz', 100], ['coca', 330]]), MEAL('m2', '2026-10-16', 'comida', [['coca', 200], ['ron', 40], ['kiwi_verde', 69]])];
  const t = await setup({ foods: mio, publicado, ajustes: { ...ajustes, recetas: [receta] }, retirados: RETIRADOS, meals, enDiario: true });
  await t.act(() => t.btn('Revisar').click());
  const avisos = t.$$('section[aria-label="Alimentos retirados"] .aviso-uso').map((x) => x.textContent);
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0], '⚠ Hay 3 líneas del diario que usan alimentos retirados; seguirán en el diario con su id y sin datos nutricionales.');
  assert.equal(avisos[1], '⚠ La receta «Mi cena» usa un alimento retirado (Ron); no se borra: revísala en Recetas.');
  await t.act(() => t.btn('Actualizar').click());
  assert.deepEqual(t.app.state.foods.map((f) => f.id), ['arroz', 'kiwi_verde']);
  const guardadas = await t.store.allMeals();
  assert.deepEqual(guardadas.map((m) => m.lines.map((l) => l.food_id)).sort(), [['arroz', 'coca'], ['coca', 'ron', 'kiwi_verde']].sort()); // el diario, intacto
  assert.deepEqual(await t.store.getSetting('recetas'), [receta]); // la receta, también
});

test('retirados: «Ahora no» se recuerda; uno ya publicado no se borra; sin retirados.json (o con basura) la app sigue como antes', { skip }, async () => {
  const { publicado, mio, ajustes } = escenarioRetirados();
  const t = await setup({ foods: mio, publicado, ajustes, retirados: RETIRADOS, enDiario: true });
  await t.act(() => t.$('section[aria-label="Documento nuevo"]').querySelector('button.link').click()); // Ahora no
  assert.equal(t.$('section[aria-label="Documento nuevo"]'), null);
  assert.match(await t.store.getSetting('catalogo_ignorado'), /^[0-9a-f]{8}\+coca,ron$/);
  assert.equal(t.app.state.foods.length, 4);
  // si lo publicado SÍ trae uno de la lista, ese no se borra (el otro, sí)
  const conRon = csvDoc('arroz,Arroz,arroz,365,si', 'kiwi_verde,Kiwi,kiwi,61,si', 'ron,Ron,ron,,no');
  const t2 = await setup({ foods: mio, publicado: conRon, ajustes: { catalogo_base: { hash: hashText(conRon), text: csvDoc('arroz,Arroz,arroz,365,si', 'kiwi_verde,Kiwi,kiwi,61,si', 'coca,Coca-Cola Classic,coca-cola,,no', 'ron,Ron,ron,,no') } }, retirados: RETIRADOS, enDiario: true });
  await t2.act(() => t2.btn('Revisar').click());
  assert.match(t2.$('section[aria-label="Alimentos retirados"]').textContent, /Se eliminarán 1 alimento retirado del documento[\s\S]*Coca-Cola Classic\./);
  // sin el fichero o con otro formato: nada que eliminar, y con el publicado al día no hay aviso
  for (const sin of [undefined, null, 'basura', { retirados: 'no' }, []]) {
    const t3 = await setup({ foods: mio, publicado, ajustes, retirados: sin, enDiario: true });
    assert.equal(t3.$('section[aria-label="Documento nuevo"]'), null, String(sin));
    assert.equal(t3.app.state.foods.length, 4);
    assert.equal(t3.$('[role=alert]'), null);
  }
});
