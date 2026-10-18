// Pantalla Objetivos con el plan (docs/OBJETIVOS-FORMATO.md) y el Diario evaluando cada día con su plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const EJEMPLO = readFile('../docs/OBJETIVOS-FORMATO.md').match(/```json\n([\s\S]*?)```/)[1];
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-10-16T07:30:00Z'); // viernes 16-10-2026: en el ejemplo, día de entreno

const MEAL = (id, date, lines) => ({ id, date, meal: 'comida', createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const fichero = (name, data) => ({ name, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) });

async function setup({ meals = [], objetivos = {}, ajustes = {} } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  for (const [k, v] of Object.entries(ajustes)) await store.setSetting(k, v);
  const saved = [];
  const app = mountApp(root, {
    store, createAiClient: () => ({}), catalog, settings, targets: TARGETS, objetivos, initial: { foods: realFoods, extraHeaders: [], docName: 'doc.csv' }, conn: {},
    now: () => NOW, idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: (f) => f.text(), saveFile: async (f) => { saved.push(f); return 'compartido'; },
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const act = async (fn) => { fn(); await app.whenIdle(); };
  const attach = async (inputEl, file) => { Object.defineProperty(inputEl, 'files', { value: [file] }); inputEl.dispatchEvent(new Event('change', { bubbles: true })); await app.whenIdle(); };
  const elegir = (sel, value) => act(() => { const s = $(sel); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); });
  return { app, root, store, saved, $, $$, btn, act, attach, elegir };
}
const fila = (t, clave) => t.$(`li.nut[data-clave="${clave}"]`);
const hoy = (t, clave) => t.$(`.objetivos-hoy li[data-clave="${clave}"]`);
const abrirObjetivos = async (t) => { await t.act(() => t.btn('Diario').click()); await t.act(() => t.btn('Objetivos').click()); };
const importarEjemplo = async (t) => {
  await abrirObjetivos(t);
  await t.attach(t.$('input[aria-label="Elegir plan de objetivos"]'), fichero('plan.json', EJEMPLO));
  await t.act(() => t.btn('Usar este plan').click());
};
const COMIDAS = [MEAL('hoy', '2026-10-16', [['arroz_blanco_crudo', 100]]), MEAL('ayer', '2026-10-15', [['arroz_blanco_crudo', 100]])];

test('importar el plan: resumen antes de aplicar; qué aplica hoy, con su origen; el diario usa el plan de cada día', { skip }, async () => {
  const t = await setup({ meals: COMIDAS });
  await abrirObjetivos(t);
  await t.attach(t.$('input[aria-label="Elegir plan de objetivos"]'), fichero('plan.json', EJEMPLO));
  assert.match(t.$('[aria-label="Importar plan"]').textContent, /«plan\.json»: Plan 2026-27 con 3 periodos y 3 excepciones/);
  assert.equal(await t.store.getSetting('plan_objetivos'), undefined); // nada hasta confirmar
  await t.act(() => t.btn('Usar este plan').click());
  assert.match(t.$('[role=status]').textContent, /Plan importado: 3 periodos/);
  assert.equal((await t.store.getSetting('plan_objetivos')).nombre, 'Plan 2026-27');
  const seccion = t.$('.objetivos-hoy');
  assert.match(seccion.textContent, /Volumen otoño 2026 · desde el 15-09-2026 hasta el 20-12-2026 · Entreno/);
  assert.match(seccion.textContent, /Peso: 74 kg/);
  assert.match(hoy(t, 'energia_kcal').textContent, /3100 kcal.*tipo «Entreno»/);
  assert.match(hoy(t, 'proteina_g').textContent, /148 g \(al menos 133 g\) · 1,8–2 g\/kg.*periodo/);
  assert.match(hoy(t, 'grasa_total_g').textContent, /entre 86,1 y 121 g · 25–35 %kcal/);
  assert.match(hoy(t, 'magnesio_mg').textContent, /al menos 350 mg.*EFSA/);
  assert.match(seccion.textContent, /Micronutrientes \(2 de tu plan, el resto EFSA\)/); // vitamina D y sodio
  assert.match(t.$('.objetivos-plan').textContent, /Volumen otoño 2026vigente · 15-09-2026 → 20-12-2026/);
  assert.match(t.$('.objetivos-plan').textContent, /Mantenimiento · 07-01-2027 → sin fin/);
  // el diario: hoy (entreno) y ayer (jueves, descanso)
  await t.act(() => t.btn('‹ Volver').click());
  assert.match(t.$('.objetivos-dia').textContent, /Objetivos: Volumen otoño 2026 · Entreno/);
  assert.match(fila(t, 'energia_kcal').textContent, /\/ 3100 kcal/);
  assert.match(fila(t, 'grasa_total_g').textContent, /\/ 86,1–121 g/); // rango
  assert.match(fila(t, 'grasa_total_g').textContent, /Por debajo/);
  assert.match(fila(t, 'sodio_mg').textContent, /\/ 2300 mg/);
  await t.act(() => t.$('button[aria-label="Día anterior"]').click());
  assert.match(t.$('.objetivos-dia').textContent, /Objetivos: Volumen otoño 2026 · Descanso/);
  assert.match(fila(t, 'energia_kcal').textContent, /\/ 2700 kcal/);
});

test('importar un plan con errores: se listan todos y no se aplica nada', { skip }, async () => {
  const t = await setup({ meals: COMIDAS });
  await abrirObjetivos(t);
  const malo = { tipo: 'plan_objetivos', version: 1, periodos: [{ id: 'v', nombre: 'Volumen', inicio: '2026-09-15', valores: { proteina_g: { unidad: 'g/kg', min: 2 }, fibra_g: 30 } }] };
  await t.attach(t.$('input[aria-label="Elegir plan de objetivos"]'), fichero('malo.json', malo));
  const r = t.$('[aria-label="Importar plan"]');
  assert.match(r.textContent, /No se puede importar «malo\.json»: 2 errores/);
  assert.match(r.textContent, /Periodo «Volumen» → proteina_g: usa "g\/kg" pero no hay peso_kg/);
  assert.match(r.textContent, /Periodo «Volumen» → fibra_g: tiene que ser un objeto/);
  assert.equal(t.btn('Usar este plan'), undefined);
  await t.act(() => t.btn('Cerrar').click());
  assert.equal(t.$('[aria-label="Importar plan"]'), null);
  assert.equal(await t.store.getSetting('plan_objetivos'), undefined);
  await t.attach(t.$('input[aria-label="Elegir plan de objetivos"]'), fichero('roto.json', '{ "tipo":'));
  assert.match(t.$('[aria-label="Importar plan"]').textContent, /No es un JSON válido/);
});

test('«Hoy es»: cambiar el tipo de hoy crea una excepción; «Según la semana» la quita', { skip }, async () => {
  const t = await setup({ meals: COMIDAS });
  await importarEjemplo(t);
  assert.equal(t.$('select[aria-label="Hoy es"]').value, '');
  assert.match(t.$('select[aria-label="Hoy es"]').textContent, /Según la semana \(Entreno\)/);
  await t.elegir('select[aria-label="Hoy es"]', 'descanso');
  assert.match(t.$('[role=status]').textContent, /Hoy: Descanso/);
  assert.deepEqual((await t.store.getSetting('plan_objetivos')).excepciones.find((e) => e.fecha === '2026-10-16'), { fecha: '2026-10-16', tipo: 'descanso' });
  assert.match(hoy(t, 'energia_kcal').textContent, /2700 kcal/);
  assert.match(t.$('.objetivos-hoy').textContent, /Excepción de hoy/);
  await t.act(() => t.btn('‹ Volver').click());
  assert.match(t.$('.objetivos-dia').textContent, /Descanso · excepción del día/);
  assert.match(fila(t, 'energia_kcal').textContent, /\/ 2700 kcal/);
  await t.act(() => t.btn('Objetivos').click());
  await t.elegir('select[aria-label="Hoy es"]', '');
  assert.equal((await t.store.getSetting('plan_objetivos')).excepciones.some((e) => e.fecha === '2026-10-16'), false);
  assert.match(hoy(t, 'energia_kcal').textContent, /3100 kcal/);
});

test('editar kcal y macros «desde hoy» (por defecto): tramo nuevo y los días pasados no cambian; «a todo el periodo» sí', { skip }, async () => {
  const t = await setup({ meals: COMIDAS });
  await importarEjemplo(t);
  await t.elegir('select[aria-label="Qué valores"]', 'entreno');
  const kcal = t.$('input[aria-label="Energía: objetivo"]');
  assert.equal(kcal.value, '3100');
  assert.equal(t.$('select[aria-label="Unidad de Hidratos de carbono"]').value, 'g/kg');
  assert.equal(t.$('input[aria-label="Hidratos de carbono: objetivo"]').value, '5,5');
  assert.equal(t.$('select[aria-label="Aplicar"]').value, 'desde_hoy');
  kcal.value = '3300';
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('[role=status]').textContent, /Guardado desde hoy/);
  const plan = await t.store.getSetting('plan_objetivos');
  assert.deepEqual(plan.periodos.slice(0, 2).map((p) => [p.id, p.inicio, p.fin]), [['volumen_otono_2026', '2026-09-15', '2026-10-15'], ['volumen_otono_2026_20261016', '2026-10-16', '2026-12-20']]);
  assert.deepEqual(plan.periodos[1].tipos.entreno.valores.energia_kcal, { objetivo: 3300 });
  assert.deepEqual(plan.periodos[1].tipos.entreno.valores.hidratos_g, { unidad: 'g/kg', objetivo: 5.5 }); // lo no tocado sigue igual
  assert.match(hoy(t, 'energia_kcal').textContent, /3300 kcal/);
  assert.equal(t.$('select[aria-label="Aplicar"]'), null); // el tramo empieza hoy: no hay nada que partir
  // a todo el periodo (tras importar otra vez el plan original)
  await t.attach(t.$('input[aria-label="Elegir plan de objetivos"]'), fichero('plan.json', EJEMPLO));
  await t.act(() => t.btn('Usar este plan').click());
  await t.elegir('select[aria-label="Aplicar"]', 'todo');
  t.$('input[aria-label="Energía: objetivo"]').value = '2950';
  t.$('input[aria-label="Peso (kg)"]').value = '75';
  await t.act(() => t.btn('Guardar').click());
  const todo = await t.store.getSetting('plan_objetivos');
  assert.equal(todo.periodos.length, 3);
  assert.deepEqual([todo.periodos[0].valores.energia_kcal, todo.periodos[0].peso_kg], [{ objetivo: 2950 }, 75]);
  await t.act(() => t.btn('‹ Volver').click());
  assert.match(fila(t, 'proteina_g').textContent, /\/ 150 g/); // 2 g/kg × 75
  // vaciar el peso con g/kg en uso: no se guarda y se dice por qué
  await t.act(() => t.btn('Objetivos').click());
  t.$('input[aria-label="Peso (kg)"]').value = '';
  await t.act(() => t.btn('Guardar').click());
  assert.match(t.$('[role=alert]').textContent, /No guardado:.*usa "g\/kg" pero no hay peso_kg/);
  assert.equal((await t.store.getSetting('plan_objetivos')).periodos[0].peso_kg, 75);
});

test('exportar el plan: el JSON que se importa de vuelta', { skip }, async () => {
  const t = await setup();
  await importarEjemplo(t);
  await t.act(() => t.btn('Exportar plan').click());
  assert.equal(t.saved.length, 1);
  assert.deepEqual([t.saved[0].name, t.saved[0].type], ['nutritiontracker-objetivos-2026-10-16.json', 'application/json']);
  assert.deepEqual(JSON.parse(t.saved[0].text), await t.store.getSetting('plan_objetivos'));
  assert.match(t.$('[role=status]').textContent, /Plan exportado/);
});

test('al actualizar: tus objetivos de la pantalla anterior pasan a un plan desde tu primer día, sin cambiar nada', { skip }, async () => {
  const t = await setup({ meals: [MEAL('v', '2026-10-10', [['arroz_blanco_crudo', 100]]), ...COMIDAS], objetivos: { perfil: 'mujer', valores: { energia_kcal: 2500, proteina_g: 150 } } });
  const plan = await t.store.getSetting('plan_objetivos');
  assert.deepEqual([plan.perfil, plan.periodos], ['mujer', [{ id: 'mis_objetivos', nombre: 'Mis objetivos', inicio: '2026-10-10', valores: { energia_kcal: { objetivo: 2500 }, proteina_g: { min: 150 } } }]]);
  await t.act(() => t.btn('Diario').click());
  assert.match(fila(t, 'energia_kcal').textContent, /\/ 2500 kcal/);
  assert.match(fila(t, 'proteina_g').textContent, /\/ 150 g/);
  assert.match(fila(t, 'hierro_mg').textContent, /\/ 16 mg/);
  // si ya hay plan, no se vuelve a migrar
  const otro = await setup({ objetivos: { valores: { energia_kcal: 1900 } }, ajustes: { plan_objetivos: { tipo: 'plan_objetivos', version: 1, periodos: [], excepciones: [] } } });
  assert.deepEqual((await otro.store.getSetting('plan_objetivos')).periodos, []);
});

test('copia del diario: lleva el plan; se restaura si el dispositivo no tiene; uno no válido no se restaura', { skip }, async () => {
  const t = await setup({ meals: COMIDAS });
  await importarEjemplo(t);
  await t.act(() => t.btn('‹ Volver').click()); // al Diario
  await t.act(() => t.btn('‹ Volver').click()); // al inicio
  await t.act(() => t.btn('Documento').click());
  await t.act(() => t.btn('Exportar diario').click());
  const copia = JSON.parse(t.saved.at(-1).text);
  assert.deepEqual(copia.plan_objetivos, await t.store.getSetting('plan_objetivos'));
  const nuevo = await setup();
  await nuevo.act(() => nuevo.btn('Documento').click());
  await nuevo.attach(nuevo.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', copia));
  assert.match(nuevo.root.textContent, /Se restaurarán los objetivos de la copia/);
  await nuevo.act(() => nuevo.btn('Importar 2 comidas').click());
  assert.deepEqual(await nuevo.store.getSetting('plan_objetivos'), copia.plan_objetivos);
  const roto = await setup();
  await roto.act(() => roto.btn('Documento').click());
  await roto.attach(roto.$('input[aria-label="Elegir copia del diario"]'), fichero('c.json', { ...copia, plan_objetivos: { tipo: 'plan_objetivos', version: 9, periodos: [] } }));
  assert.match(roto.root.textContent, /El plan de objetivos de la copia no es válido: no se restaura/);
  await roto.act(() => roto.btn('Importar 2 comidas').click());
  assert.equal(await roto.store.getSetting('plan_objetivos'), undefined);
});
