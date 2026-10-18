import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { AiClientError } from '../frontend/js/ai-client.js';
import { realFoods, rulesFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z'); // 09:30 en Madrid

const ITEM = (food_id, grams, source_text, o = {}) => ({ food_id, grams, source_text, confidence: 'alta', flags: [], requiresConfirmation: false, ...o });

async function setup({ responses = [], foods = realFoods, conn = { endpoint: 'https://w', token: 't' }, files, objetivos = {}, meals = [], shareResult = 'compartido', health = { ok: true, configurado: true, token: 'ok' } } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
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
  const app = mountApp(root, { store, createAiClient, catalog, settings, targets: TARGETS, objetivos, initial: { foods, extraHeaders: [], docName: 'doc.csv' }, conn, now: () => NOW, idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async (f) => { saved.push(f); return shareResult; } });
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const attach = async (inputEl, file) => { Object.defineProperty(inputEl, 'files', { value: [file] }); inputEl.dispatchEvent(new Event('change', { bubbles: true })); await app.whenIdle(); };
  return { app, root, store, calls, saved, document, $, $$, btn, type, act, attach };
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
  assert.equal(t.calls[0].alimentos.length, 53); // sin los incluir=no
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
  // con el catálogo real: 90,5 g de avena (379 kcal/100 g) + 100 g de huevo (143 kcal/100 g)
  assert.match(t.root.textContent, /343 kcal · 11,9 g prot./);
  assert.match(t.root.textContent, /Total: 486 kcal · 24,5 g de proteína/);
  assert.ok(!/parcial|sin dato/.test(t.root.textContent));
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
  assert.match(t.root.textContent, /Todo correcto: el Worker responde, tiene sus secretos y el token es el correcto/);
});

test('Probar: token incorrecto o secretos que faltan, con un mensaje para cada caso', { skip }, async () => {
  for (const [health, re] of [[{ ok: true, configurado: true, token: 'incorrecto' }, /el token no es correcto/], [{ ok: true, configurado: false, token: 'ok' }, /le faltan secretos/], [{ ok: false }, /no responde bien/]]) {
    const t = await setup({ health });
    await t.act(() => t.btn('Documento').click());
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
  // 80 g de avena (379 kcal) + 100 g de huevo (143 kcal) = 446 kcal; objetivo de referencia 2000 kcal
  assert.match(fila(t, 'energia_kcal').textContent, /446 kcal \/ 2000 kcal/);
  assert.match(fila(t, 'energia_kcal').textContent, /Por debajo · 22 %/);
  assert.match(fila(t, 'vitamina_b12_ug').textContent, /µg/);
  assert.ok(fila(t, 'epa_dha'));
  assert.match(t.$('section.meal').textContent, /Desayuno.*446 kcal/);
  assert.match(t.$('section.meal').textContent, /Avena \(copos\/molida\) · 80 g · 303 kcal/);
  assert.equal(t.$('.alert-ul'), null);
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  assert.equal(t.$('.daylabel').textContent, 'Ayer');
  assert.match(t.root.textContent, /Sin registros este día/);
  await t.act(() => t.btn('Ir a hoy').click());
  assert.equal(t.$('.daylabel').textContent, 'Hoy');
});

test('Diario: superar un UL es un aviso distinto de "objetivo cumplido"', { skip }, async () => {
  // Copia congelada del documento: sus corn flakes traen la fortificación de EE. UU. (981 µg de vitamina A por 100 g).
  const t = await setup({ foods: rulesFoods, meals: [MEAL('m', '2026-10-16', 'cena', [['corn_flakes', 400]])] });
  await t.act(() => t.btn('Diario').click());
  assert.match(t.$('.alert-ul').textContent, /Máximo tolerable \(UL\) superado/);
  assert.match(t.$('.alert-ul').textContent, /Vitamina A \(RAE\): 3924 µg \(UL 3000 µg\)/);
  assert.match(t.$('.alert-ul').textContent, /retinol preformado/);
  const a = fila(t, 'vitamina_a_ug');
  assert.ok(a.classList.contains('over-ul'));
  assert.match(a.textContent, /Objetivo cumplido/);
  assert.match(a.textContent, /⚠ Supera el máximo tolerable \(UL 3000 µg\)/);
  assert.ok(!fila(t, 'vitamina_c_mg').classList.contains('over-ul'));
});

test('Diario: un alimento sin datos deja los totales parciales y se dice cuál', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m', '2026-10-16', 'comida', [['kiwi_verde', 100], ['coca_cola', 330]])] });
  await t.act(() => t.btn('Diario').click());
  assert.match(t.root.textContent, /Totales parciales: faltan datos de Coca-Cola Classic/);
  assert.match(fila(t, 'energia_kcal').textContent, /parcial/);
  assert.match(t.$('section.meal').textContent, /Coca-Cola Classic · 330 g · sin dato/);
});

test('Objetivos: perfil hombre por defecto; tus kcal y macros se guardan y el diario los usa; perfil mujer', { skip }, async () => {
  const t = await setup({ meals: [MEAL('m', '2026-10-16', 'comida', [['arroz_blanco_crudo', 100]])] });
  await t.act(() => t.btn('Diario').click());
  assert.match(fila(t, 'hierro_mg').textContent, /\/ 11 mg/);
  await t.act(() => t.btn('Objetivos').click());
  assert.equal(t.$('select').value, 'hombre');
  const kcal = t.$('input[aria-label="Energía (kcal)"]');
  assert.equal(kcal.placeholder, '2000');
  kcal.value = '2500';
  t.$('input[aria-label="Proteína (g)"]').value = '150,5';
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('[role=status]').textContent, /Guardado/);
  assert.deepEqual(await t.store.getSetting('objetivos'), { perfil: 'hombre', valores: { energia_kcal: 2500, proteina_g: 150.5 } });
  assert.equal(t.$('input[aria-label="Vitamina B1 (tiamina) (mg)"]').placeholder, '1,05'); // 0,1 mg/MJ con 2500 kcal
  t.$('input[aria-label="Calcio (mg)"]').value = 'mucho';
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('[role=status]').textContent, /No guardado: valor no válido en Calcio/);
  t.$('input[aria-label="Calcio (mg)"]').value = '';
  t.$('select').value = 'mujer';
  await t.act(() => t.btn('Guardar').click());
  await t.act(() => t.btn('‹ Volver').click());
  assert.match(fila(t, 'energia_kcal').textContent, /\/ 2500 kcal/);
  assert.match(fila(t, 'proteina_g').textContent, /\/ 151 g|\/ 150,5 g/);
  assert.match(fila(t, 'hierro_mg').textContent, /\/ 16 mg/);
  await t.act(() => t.btn('Objetivos').click());
  await t.act(() => t.btn('Restablecer').click());
  assert.deepEqual((await t.store.getSetting('objetivos')).valores, {});
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

// ---------- Hito 4, fase 2: editar y borrar comidas guardadas ----------
const AYER = MEAL('r1', '2026-10-15', 'comida', [['arroz_blanco_crudo', 150], ['kiwi_verde', 69], ['aceite_oliva', 10]]);
const toAyer = async (t) => { await t.act(() => t.btn('Diario').click()); await t.act(() => t.$('button[aria-label="Día anterior"]').click()); };

test('editar una comida pasada: gramos, quitar línea, cambiar comida y fecha; mismo id y createdAt', { skip }, async () => {
  const t = await setup({ meals: [AYER] });
  await toAyer(t);
  assert.match(t.$('section.meal').textContent, /Arroz blanco crudo · 150 g/);
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
  assert.match(t.$('section.meal').textContent, /Cena/);
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
  assert.match(t.$('section.meal').textContent, /ya_no_existe · 35 g · sin dato/);
  await t.act(() => t.btn('Editar').click());
  assert.match(t.root.textContent, /«ya_no_existe · 35 g»/);
  await t.act(() => t.btn('Buscar en mi documento').click());
  t.type(t.$('.overlay input'), 'avena');
  await t.act(() => t.$('.pick').click());
  assert.equal(t.$$('input.grams').at(-1).value, '35');
});

// ---------- Hito 4, paso 3: copia de seguridad ----------
const fichero = (name, data) => ({ name, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) });
const abrirDoc = (t) => t.act(() => t.btn('Documento').click());

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
  await abrirDoc(t);
  await t.act(() => t.btn('Exportar documento (Excel)').click());
  await t.act(() => t.btn('Exportar documento (CSV con comas)').click());
  assert.deepEqual(t.saved.map((f) => [f.name, f.type]), [['nutritiontracker-alimentos-excel-2026-10-16.csv', 'text/csv'], ['nutritiontracker-alimentos-2026-10-16.csv', 'text/csv']]);
  assert.ok(t.saved[0].text.startsWith('﻿id;nombre;'));
  assert.match(t.saved[0].text, /aceite_oliva;.*;0,91;/);
  assert.ok(t.saved[1].text.startsWith('﻿id,nombre,'));
  assert.match(t.$('p.ok[role=status]').textContent, /Documento exportado: 67 alimentos/);
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
  const copia = { tipo: 'nutrition-tracker/diario', formatVersion: 1, comidas: [], objetivos: { perfil: 'mujer', valores: { energia_kcal: 1800 } } };
  const sin = await setup();
  await abrirDoc(sin);
  await sin.attach(sin.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', copia));
  assert.match(sin.root.textContent, /Se restaurarán los objetivos de la copia/);
  await sin.act(() => sin.btn('Restaurar objetivos').click());
  assert.deepEqual(await sin.store.getSetting('objetivos'), copia.objetivos);
  const con = await setup({ objetivos: { perfil: 'hombre', valores: { energia_kcal: 2500 } } });
  await abrirDoc(con);
  await con.attach(con.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', copia));
  assert.match(con.root.textContent, /Objetivos: se mantienen los de este dispositivo/);
  assert.match(con.root.textContent, /No hay nada nuevo que importar/);
});
