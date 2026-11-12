// «Copiar dieta del día»: validación de data/dieta.json (pura) y el botón del Diario (jsdom) que abre «Repetir» con la dieta
// que toca (versión 1: del día de la semana; versión 2: del periodo del plan y su tipo de día). Sin IA ni red: el fichero se simula.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAS, DIA_LABEL, diaDeSemana, validarDieta, parseDieta, dietaComoComidas, menuComoComidas, elegirMenu, SIN_PLAN } from '../frontend/js/core/dieta.js';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { cleanRetirados } from '../frontend/js/core/catalog-update.js';
import { createRepeat, toRecords, DESTINO_ORIGEN } from '../frontend/js/core/repeat.js';
import { MEALS } from '../frontend/js/core/meal-defaults.js';
import { editPeriod } from '../frontend/js/core/targets-plan.js';
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
  // Todos los menús: los de la versión 1 o, en la 2, los normales y los de cada tipo de día de cada versión.
  const menus = r.dieta.version === 2
    ? r.dieta.versiones.flatMap((v) => [['', v.dias], ...Object.entries(v.tipos).map(([t, d]) => [t, d])].map(([t, d]) => [`${v.periodo}${t ? `/${t}` : ''}`, d]))
    : [['', r.dieta.dias]];
  const usados = menus.flatMap(([, dias]) => Object.values(dias).flatMap((d) => Object.values(d).flat())).map((l) => l.food_id);
  assert.ok(usados.length > 0);
  assert.deepEqual(usados.filter((id) => retirados.has(id)), [], 'ids de la dieta que están en retirados.json');
  for (const [donde, dias] of menus) {
    for (const dia of Object.keys(dias)) assert.ok(menuComoComidas(dias[dia], dia), `${donde} ${dia} sin líneas`);
    // los menús normales, completos de lunes a viernes; los de un tipo de día pueden ser parciales
    if (donde.includes('/')) continue;
    assert.ok(['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].every((d) => dias[d] && MEALS.slice(0, 4).every((m) => dias[d][m]?.length)), `${donde}: falta algún día de lunes a viernes o alguna comida`);
  }
  if (r.dieta.version === 2) {
    // cada versión es de un periodo que existe en algún plan de Victor no se puede comprobar aquí (el plan está en el iPhone),
    // pero los periodos no se repiten y todas tienen nombre
    assert.equal(new Set(r.dieta.versiones.map((v) => v.periodo)).size, r.dieta.versiones.length);
    assert.ok(r.dieta.versiones.every((v) => v.nombre));
    // el «dias» de la raíz (para la app antigua, versión 1) también tiene que ser válido
    const raw = JSON.parse(readFile('../data/dieta.json'));
    if (raw.dias) {
      const v1 = validarDieta({ dias: raw.dias }, { foodIds: ids });
      assert.deepEqual([v1.ok, v1.errores, v1.desconocidos], [true, [], []]);
      const idsV1 = Object.values(v1.dieta.dias).flatMap((d) => Object.values(d).flat()).map((l) => l.food_id);
      assert.deepEqual(idsV1.filter((id) => retirados.has(id)), []);
    }
  }
});

// ---------- versión 2: una versión por periodo del plan y menús por tipo de día ----------

const PLAN = {
  tipo: 'plan_objetivos', version: 1, nombre: 'prueba',
  periodos: [
    { id: 'p20', nombre: 'Volumen p20', inicio: '2026-10-05',
      tipos: { fuerza: { nombre: 'Fuerza', valores: { energia_kcal: { objetivo: 3700 } } }, descanso: { nombre: 'Descanso', valores: { energia_kcal: { objetivo: 3300 } } } },
      semana: { lun: 'fuerza', mar: 'fuerza', mie: 'fuerza', jue: 'fuerza', vie: 'fuerza', sab: 'descanso', dom: 'descanso' } },
    { id: 'p19', nombre: 'Volumen p19', inicio: '2026-10-19', semana: {} },
    { id: 'vacaciones', nombre: 'Vacaciones', inicio: '2026-11-01', fin: '2026-11-08' },
  ],
  excepciones: [{ fecha: '2026-10-15', tipo: 'descanso' }],
};
const V2 = { version: 2, nombre: 'prueba v2', versiones: [
  { periodo: 'p20', nombre: 'p20 · prueba', dias: { jueves: { cena: [L('huevo', 108)] }, viernes: { cena: [L('huevo', 54)] } }, tipos: { descanso: { jueves: { cena: [L('patata_cruda', 200)] } } } },
  { periodo: 'p19', dias: { lunes: { comida: [L('arroz_blanco_crudo', 100)] } } },
] };

test('validarDieta versión 2: versiones por periodo con menús por tipo de día; errores con la versión y el tipo', () => {
  const r = validarDieta(V2, { foodIds: IDS });
  assert.deepEqual([r.ok, r.errores, r.desconocidos], [true, [], []]);
  assert.deepEqual(r.dieta.versiones.map((v) => [v.periodo, v.nombre, Object.keys(v.dias), Object.keys(v.tipos)]), [['p20', 'p20 · prueba', ['jueves', 'viernes'], ['descanso']], ['p19', 'p19', ['lunes'], []]]);
  const malos = [
    [{ version: 2 }, /Falta «versiones»/],
    [{ versiones: [] }, /Falta «versiones»/],
    [{ versiones: [{ dias: {} }] }, /versión 1: falta «periodo»/],
    [{ versiones: [{ periodo: 'a', dias: {} }, { periodo: 'a', dias: {} }] }, /versión «a»: periodo repetido/],
    [{ versiones: [{ periodo: 'a', dias: {}, tipos: [] }] }, /versión «a»: «tipos» debe ser un objeto/],
    [{ versiones: [{ periodo: 'a', dias: { lunez: {} } }] }, /versión «a», día no válido «lunez»/],
    [{ versiones: [{ periodo: 'a', tipos: { descanso: { lunes: { cena: [L('huevo', 0)] } } } }] }, /versión «a», descanso, lunes, cena, huevo: los gramos deben ser un número mayor que 0/],
  ];
  for (const [raw, re] of malos) { const x = validarDieta(raw); assert.equal(x.ok, false, JSON.stringify(raw)); assert.match(x.errores.join(' | '), re); }
  const d = validarDieta({ versiones: [{ periodo: 'a', tipos: { descanso: { lunes: { cena: [L('no_existe', 5)] } } } }] }, { foodIds: IDS });
  assert.deepEqual([d.ok, d.desconocidos], [true, [{ periodo: 'a', tipo: 'descanso', dia: 'lunes', comida: 'cena', food_id: 'no_existe' }]]);
});

test('elegirMenu: versión del periodo vigente y menú del tipo de día (con excepciones); mensajes cuando no hay', () => {
  const d1 = validarDieta({ dias: { viernes: { cena: [L('huevo', 108)] } } }).dieta;
  const d2 = validarDieta(V2).dieta;
  const cena = (sel) => sel.comidas.map((m) => [m.meal, m.lines.map((l) => [l.food_id, l.grams])]);
  // versión 1: sin plan, el del día de la semana
  assert.deepEqual([elegirMenu(d1, '2026-10-16', null).ok, elegirMenu(d1, '2026-10-16', null).tipo], [true, null]);
  assert.deepEqual(elegirMenu(d1, '2026-10-15', null), { ok: false, error: 'No hay dieta para el jueves' });
  // versión 2: hace falta plan
  assert.deepEqual(elegirMenu(d2, '2026-10-16', null), { ok: false, error: SIN_PLAN });
  // viernes 16 en p20, fuerza (sin menú propio de fuerza): el normal
  const vie = elegirMenu(d2, '2026-10-16', PLAN);
  assert.deepEqual([vie.ok, vie.dia, vie.etiqueta, vie.tipo, vie.version, cena(vie)], [true, 'viernes', 'viernes', 'Fuerza', 'p20 · prueba', [['cena', [['huevo', 54]]]]]);
  // jueves 15: la semana dice fuerza, la excepción lo cambia a descanso -> su menú propio
  const jue = elegirMenu(d2, '2026-10-15', PLAN);
  assert.deepEqual([jue.tipo, cena(jue)], ['Descanso', [['cena', [['patata_cruda', 200]]]]]);
  // jueves 8 (fuerza, sin excepción): el normal
  assert.deepEqual(cena(elegirMenu(d2, '2026-10-08', PLAN)), [['cena', [['huevo', 108]]]]);
  // sábado 10: descanso, pero ni descanso ni normal tienen sábado
  assert.deepEqual(elegirMenu(d2, '2026-10-10', PLAN), { ok: false, error: 'No hay dieta para el sábado' });
  // p19 (sin tipos ni semana): el normal, sin tipo
  const lun = elegirMenu(d2, '2026-10-19', PLAN);
  assert.deepEqual([lun.ok, lun.tipo, lun.version], [true, null, 'p19']);
  // menú propio o normal; el normal en un día que no es de su tipo de semana se marca
  assert.deepEqual([jue.menuPropio, jue.menuNormalDeOtroTipo, vie.menuPropio, vie.menuNormalDeOtroTipo], [true, false, false, false]);
  const vieDescanso = elegirMenu(d2, '2026-10-16', { ...PLAN, excepciones: [{ fecha: '2026-10-16', tipo: 'descanso' }] });
  assert.deepEqual([vieDescanso.tipo, vieDescanso.menuPropio, vieDescanso.menuNormalDeOtroTipo], ['Descanso', false, true]);
  // editar en Objetivos «desde hoy» parte el periodo (p20 -> p20_20261013, y otra vez -> p20_20261013_2...): sigue su versión
  const e1 = editPeriod(PLAN, { fecha: '2026-10-13', peso_kg: 80, modo: 'desde_hoy' }).plan;
  assert.ok(e1.periodos.some((p) => p.id === 'p20_20261013'));
  assert.deepEqual([elegirMenu(d2, '2026-10-15', e1).version, elegirMenu(d2, '2026-10-15', e1).tipo], ['p20 · prueba', 'Descanso']);
  const e2 = editPeriod(editPeriod(e1, { fecha: '2026-10-14', peso_kg: 81, modo: 'desde_hoy' }).plan, { fecha: '2026-10-15', peso_kg: 82, modo: 'desde_hoy' }).plan;
  assert.ok(e2.periodos.length > e1.periodos.length);
  assert.equal(elegirMenu(d2, '2026-10-16', e2).version, 'p20 · prueba');
  // con versión propia para un tramo intermedio, el tramo siguiente usa esa (no salta a la del periodo base)
  const d3 = validarDieta({ versiones: [...V2.versiones, { periodo: 'p20_20261013', nombre: 'tramo 13', dias: { viernes: { cena: [L('huevo', 60)] } } }] }).dieta;
  const e3 = editPeriod(e1, { fecha: '2026-10-14', peso_kg: 81, modo: 'desde_hoy' }).plan;
  assert.ok(e3.periodos.some((p) => p.id === 'p20_20261013_20261014'));
  assert.equal(elegirMenu(d3, '2026-10-16', e3).version, 'tramo 13');
  assert.equal(elegirMenu(d2, '2026-10-16', { ...PLAN, periodos: [{ ...PLAN.periodos[0], id: 'otro_20261001' }] }).ok, false); // sin «p20» no inventa
  // periodo sin versión y fecha sin periodo
  assert.deepEqual(elegirMenu(d2, '2026-11-02', PLAN), { ok: false, error: 'Tu dieta no tiene menú para el periodo «Vacaciones».' });
  assert.deepEqual(elegirMenu(d2, '2026-10-01', PLAN), { ok: false, error: 'Tu plan de objetivos no tiene ningún periodo para este día, así que no hay dieta que copiar.' });
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

async function setup({ dieta = JSON.stringify(DIETA), fetchDieta, fetchDietaCopia, ajustes = {}, foods = realFoods, dietaTimeoutMs, alterStore = (st) => st } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const root = dom.window.document.getElementById('app');
  const store = alterStore(createMemoryStore());
  for (const [k, v] of Object.entries(ajustes)) await store.setSetting(k, v);
  const peticiones = [];
  const app = mountApp(root, {
    store, createAiClient: () => ({}), catalog, settings, targets: JSON.parse(readFile('../data/targets.json')), objetivos: {},
    fetchDieta: fetchDieta ?? (async () => { peticiones.push('red'); if (dieta instanceof Error) throw dieta; return dieta; }), fetchDietaCopia, dietaTimeoutMs,
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
  assert.equal(t.$('.repeat p.muted.small'), null); // descargada ahora: sin aviso de copia antigua
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
  assert.equal(sinRed.$('.repeat p.muted.small').textContent, 'Sin conexión: es la última dieta descargada; puede no ser la más reciente.');
  // sin red ni copia guardada: la del service worker
  const conSw = await setup({ fetchDieta: async () => { throw new TypeError('Failed to fetch'); }, fetchDietaCopia: async () => JSON.stringify(DIETA) });
  await conSw.copiar();
  assert.equal(conSw.$('.source-label').textContent, 'De: dieta del viernes');
  assert.match(conSw.$('.repeat p.muted.small').textContent, /^Sin conexión: es la última dieta descargada/);
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

// ---------- ronda de revisión: espera, copia válida, aviso de copia antigua, fallos de guardado ----------

test('Copiar dieta del día: «Cargando la dieta…» mientras espera, una segunda pulsación no repite la descarga, y a los 5 s (aquí 30 ms) usa la copia guardada', { skip }, async () => {
  let llamadas = 0; let senal = null;
  const t = await setup({ dietaTimeoutMs: 30, ajustes: { dieta_publicada: JSON.stringify(DIETA) }, fetchDieta: ({ signal } = {}) => { llamadas++; senal = signal; return new Promise(() => {}); } }); // nunca responde
  t.$('button[aria-label="Más opciones del día"]').click();
  t.btn('Copiar dieta del día').click();
  assert.match(t.$('[role=status]').textContent, /Cargando la dieta…/); // se ve de inmediato
  t.$('button[aria-label="Más opciones del día"]').click();
  t.btn('Copiar dieta del día').click(); // segunda pulsación mientras carga
  await t.app.whenIdle();
  assert.equal(llamadas, 1);
  assert.equal(senal.aborted, true); // la descarga se cancela al vencer el plazo
  assert.equal(t.$('.source-label').textContent, 'De: dieta del viernes');
  assert.match(t.$('.repeat p.muted.small').textContent, /^Sin conexión: es la última dieta descargada/);
  assert.doesNotMatch(t.root.textContent, /Cargando la dieta/);
  // sin copia a la que recurrir, al vencer el plazo hay error visible y el mensaje de carga desaparece
  const sin = await setup({ dietaTimeoutMs: 20, fetchDieta: () => new Promise(() => {}) });
  await sin.copiar();
  assert.match(sin.$('.alert-fail').textContent, /No se pudo copiar la dieta: no se pudo cargar data\/dieta\.json .*tardó demasiado/);
  assert.doesNotMatch(sin.root.textContent, /Cargando la dieta/);
  // tras el fallo se puede volver a pulsar
  assert.equal(sin.app.state.dietaCargando, null);
});

test('Copiar dieta del día: un 200 con HTML o un JSON roto no pisa la copia buena; sin red se salta una copia guardada inválida y usa la del service worker', { skip }, async () => {
  const buena = JSON.stringify(DIETA);
  for (const malo of ['<!doctype html><title>Wi-Fi del hotel</title>', '{ "dias": ']) {
    const t = await setup({ dieta: malo, ajustes: { dieta_publicada: buena } });
    await t.copiar();
    assert.match(t.$('.alert-fail').textContent, /no es un JSON válido/); // lo recibido se enseña como error...
    assert.equal(await t.store.getSetting('dieta_publicada'), buena); // ...pero no sustituye a la copia
  }
  const nueva = JSON.stringify({ ...DIETA, nombre: 'nueva' });
  const ok = await setup({ dieta: nueva, ajustes: { dieta_publicada: buena } });
  await ok.copiar();
  assert.equal(await ok.store.getSetting('dieta_publicada'), nueva); // una válida sí la sustituye
  const roto = await setup({ fetchDieta: async () => { throw new TypeError('Failed to fetch'); }, ajustes: { dieta_publicada: '<html>' }, fetchDietaCopia: async () => buena });
  await roto.copiar();
  assert.equal(roto.$('.source-label').textContent, 'De: dieta del viernes');
  const sinValida = await setup({ fetchDieta: async () => { throw new TypeError('Failed to fetch'); }, ajustes: { dieta_publicada: '<html>' }, fetchDietaCopia: async () => '<html>' });
  await sinValida.copiar();
  assert.match(sinValida.$('.alert-fail').textContent, /no se pudo cargar data\/dieta\.json/);
});

test('Copiar dieta del día: si falla guardar la copia no se traga en silencio (console.error) y la dieta leída se usa igual', { skip }, async () => {
  const errores = []; const original = console.error;
  console.error = (...a) => errores.push(a);
  try {
    const t = await setup({ alterStore: (st) => { const set = st.setSetting.bind(st); st.setSetting = async (k, v) => { if (k === 'dieta_publicada') throw new Error('cuota llena'); return set(k, v); }; return st; } });
    await t.copiar();
    assert.equal(t.$('.source-label').textContent, 'De: dieta del viernes');
    assert.ok(errores.some((a) => /No se pudo guardar la copia de la dieta/.test(String(a[0])) && /cuota llena/.test(String(a[1]))));
  } finally { console.error = original; }
});

test('Repetir con la dieta: un alimento ausente se etiqueta «no está en tu documento» (no «ya no está»)', { skip }, async () => {
  const t = await setup({ dieta: JSON.stringify({ dias: { viernes: { cena: [L('alimento_nuevo_x', 50)] } } }) });
  await t.copiar();
  assert.equal(t.$('.repeat-item .tag').textContent, 'no está en tu documento');
});

test('Copiar dieta del día (versión 2): elige con el plan del iPhone el menú del periodo y del tipo de día; sin plan, lo dice', { skip }, async () => {
  const sinPlan = await setup({ dieta: JSON.stringify(V2) });
  await sinPlan.copiar();
  assert.match(sinPlan.$('.alert-fail').textContent, /No se pudo copiar la dieta: Para copiar la dieta necesitas un plan de objetivos \(Más → Objetivos\)\./);
  assert.equal(sinPlan.$('.repeat'), null);
  // viernes 16 de descanso por excepción; el viernes no tiene menú propio de descanso: el normal, con el nombre de su tipo
  const plan = { ...PLAN, excepciones: [{ fecha: '2026-10-16', tipo: 'descanso' }] };
  const t = await setup({ dieta: JSON.stringify(V2), ajustes: { plan_objetivos: plan } });
  await t.copiar();
  assert.equal(t.$('.source-label').textContent, 'De: dieta del viernes · Descanso (menú normal)'); // descanso sin menú propio
  assert.equal(t.$('.dieta-version').textContent, 'p20 · prueba');
  assert.equal(t.$$('.repeat-item input[type=checkbox]').length, 1);
  await t.act(() => t.btn('Añadir').click());
  assert.deepEqual((await t.store.allMeals()).map((m) => [m.date, m.meal, m.text]), [['2026-10-16', 'cena', 'Dieta del viernes']]);
});

test('Diario: se puede ir a mañana (y más allá), se ve vacío y «Copiar dieta del día» guarda en la fecha futura', { skip }, async () => {
  const t = await setup(); // hoy: viernes 2026-10-16; la dieta de prueba solo tiene viernes
  const sig = () => t.$('button[aria-label="Día siguiente"]');
  assert.equal(sig().disabled, false);
  await t.act(() => sig().click());
  assert.equal(t.$('.daylabel').textContent, 'Mañana');
  assert.equal(t.$('.alert-fail'), null);
  assert.equal((await t.store.allMeals()).length, 0);
  await t.act(() => sig().click()); // sábado 17: sin dieta de prueba (la de prueba solo tiene viernes)
  assert.notEqual(t.$('.daylabel').textContent, 'Mañana');
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  await t.act(() => t.$('button[aria-label="Día anterior"]').click()); // vuelve a hoy
  // viernes de la semana siguiente (2026-10-23): dieta del viernes copiada con destino en esa fecha
  for (let i = 0; i < 7; i++) await t.act(() => sig().click());
  await t.copiar();
  assert.equal(t.$('input[aria-label="Fecha de destino"]').value, '2026-10-23');
  assert.equal(t.$('input[aria-label="Fecha de destino"]').max, '');
  await t.act(() => t.btn('Añadir').click());
  const guardadas = await t.store.allMeals();
  assert.ok(guardadas.length > 0 && guardadas.every((m) => m.date === '2026-10-23'));
});

test('aceite en flus: «≈ N flus» junto a los gramos en el Diario y en Repetir (la app sigue guardando gramos)', { skip }, async () => {
  const { flusDeGramos, textoFlus } = await import('../frontend/js/core/portions.js');
  const aceite = realFoods.find((f) => f.id === 'aceite_oliva');
  assert.equal(flusDeGramos(aceite, 7), Math.round(7 / aceite.porciones.find((p) => p.nombre === 'flus').gramos));
  assert.equal(flusDeGramos(realFoods.find((f) => f.id === 'huevo'), 108), null); // sin porción flus: nada
  assert.equal(textoFlus(aceite, 0), '');
  const t = await setup({ dieta: JSON.stringify({ dias: { viernes: { comida: [L('arroz_blanco_crudo', 100), L('aceite_oliva', 7)] } } }) });
  await t.copiar();
  // los flus van en una línea aparte, debajo de la fila de gramos (en la fila no caben a 375 px)
  const flusVisibles = () => t.$$('.repeat-flus').filter((x) => !x.hidden).map((x) => x.textContent);
  assert.deepEqual(flusVisibles(), [`≈ ${flusDeGramos(aceite, 7)} flus`]);
  assert.ok(t.$$('.repeat-qty').every((q) => !/flus/.test(q.textContent)));
  const campo = t.$('input[aria-label="Gramos de Aceite de oliva"]');
  assert.equal(t.root.querySelector(`#${campo.getAttribute('aria-describedby')}`).textContent, `≈ ${flusDeGramos(aceite, 7)} flus`);
  // en vivo: escribir y los botones
  campo.value = '10'; campo.dispatchEvent(new campo.ownerDocument.defaultView.Event('input', { bubbles: true }));
  assert.deepEqual(flusVisibles(), [`≈ ${flusDeGramos(aceite, 10)} flus`]);
  await t.act(() => t.$('button[aria-label="+10 g a Aceite de oliva"]').click());
  assert.deepEqual(flusVisibles(), [`≈ ${flusDeGramos(aceite, 20)} flus`]);
  await t.act(() => t.$('button[aria-label="−10 g a Aceite de oliva"]').click());
  assert.equal(flusDeGramos(aceite, 0.1), 1); // nunca «≈ 0 flus»
  assert.equal(flusDeGramos({ porciones: [{ nombre: 'Flus', gramos: 0.3 }] }, 3), 10); // sin distinguir mayúsculas
  await t.act(() => t.btn('Añadir').click());
  assert.ok(t.$$('.line-grams').some((s) => s.textContent === `10 g (≈ ${flusDeGramos(aceite, 10)} flus)`));
  assert.ok(t.$$('.line-grams').some((s) => s.textContent === '100 g')); // el arroz, sin flus
  assert.deepEqual((await t.store.allMeals())[0].lines.map((l) => l.grams), [100, 10]); // se guardan gramos
});
