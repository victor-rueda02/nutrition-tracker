// Plantillas: una comida guardada con nombre que se aplica con la pantalla "Repetir".
import test from 'node:test';
import assert from 'node:assert/strict';
import { templateError, cleanTemplates, nameError, templateFromRecord, addTemplate, removeTemplate, templateAsMeals, mergeTemplates, sortTemplates } from '../frontend/js/core/templates.js';
import { createRepeat, toRecords, DESTINO_ORIGEN } from '../frontend/js/core/repeat.js';
import { buildBackup, backupToJSON, parseBackup } from '../frontend/js/core/backup.js';
import { realFoods } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const REC = { id: 'r1', date: '2026-10-17', meal: 'desayuno', createdAt: '2026-10-17T07:00:00Z', text: 'x', lines: [{ food_id: 'avena_copos', grams: 80, source_text: 'a' }, { food_id: 'leche_entera', grams: 250, source_text: 'b' }] };
const NOW = new Date('2026-10-18T08:00:00Z');

test('guardar una comida como plantilla: nombre obligatorio, sin repetir (sin acentos ni mayúsculas), solo alimentos y gramos', () => {
  const t = templateFromRecord(REC, { nombre: '  Desayuno habitual ', now: NOW, idGen: () => 'p1' });
  assert.deepEqual(t, { id: 'p1', nombre: 'Desayuno habitual', meal: 'desayuno', createdAt: '2026-10-18T08:00:00.000Z', lines: [{ food_id: 'avena_copos', grams: 80 }, { food_id: 'leche_entera', grams: 250 }] });
  assert.equal(nameError('', []), 'Ponle un nombre.');
  assert.equal(nameError('x'.repeat(61), []), 'Como mucho 60 caracteres.');
  assert.equal(nameError('DESAYUNO HABITUÁL', [t]), 'Ya tienes una plantilla «DESAYUNO HABITUÁL».');
  assert.throws(() => templateFromRecord(REC, { nombre: 'desayuno habitual', list: [t] }), /Ya tienes/);
});

test('lista: ordenada por nombre; añadir y borrar; lo guardado inválido se ignora', () => {
  const a = { id: 'a', nombre: 'zumo', meal: 'otro', lines: [{ food_id: 'kiwi_verde', grams: 69 }] };
  const b = { id: 'b', nombre: 'Ávena', meal: 'desayuno', lines: [{ food_id: 'avena_copos', grams: 80 }] };
  assert.deepEqual(addTemplate([a], b).map((t) => t.id), ['b', 'a']);
  assert.deepEqual(removeTemplate([a, b], 'a').map((t) => t.id), ['b']);
  assert.deepEqual(sortTemplates([a, b]).map((t) => t.nombre), ['Ávena', 'zumo']);
  assert.equal(templateError({ ...a, meal: 'brunch' }), 'comida no válida "brunch"');
  assert.equal(templateError({ ...a, lines: [{ food_id: 'kiwi_verde', grams: 0 }] }), 'gramos no válidos en kiwi_verde');
  assert.deepEqual(cleanTemplates([a, { ...b, nombre: '' }, null, 'x']).map((t) => t.id), ['a']);
  assert.deepEqual(cleanTemplates(undefined), []);
});

test('usar una plantilla con "Repetir": misma pantalla, a su comida o a otra, y queda anotado de qué plantilla viene', () => {
  const t = templateFromRecord(REC, { nombre: 'Desayuno habitual', now: NOW, idGen: () => 'p1' });
  const r = createRepeat({ meals: templateAsMeals(t), template: { id: t.id, nombre: t.nombre }, foodsById: byId, targetDate: '2026-10-18', targetMeal: DESTINO_ORIGEN });
  assert.deepEqual(r.groups.map((g) => [g.meal, g.items.map((i) => [i.food_id, i.grams, i.checked])]), [['desayuno', [['avena_copos', 80, true], ['leche_entera', 250, true]]]]);
  const [rec] = toRecords(r, { now: NOW, idGen: () => 'n1' });
  assert.deepEqual([rec.meal, rec.date, rec.text, rec.lines[0].source_text], ['desayuno', '2026-10-18', 'Plantilla: Desayuno habitual', 'plantilla «Desayuno habitual»']);
});

test('copia de seguridad: lleva las plantillas; al importar se añaden las nuevas y se mantienen las tuyas', () => {
  const mia = { id: 'p1', nombre: 'Mía', meal: 'comida', createdAt: '', lines: [{ food_id: 'arroz_blanco_crudo', grams: 150 }] };
  const otra = { id: 'p2', nombre: 'Otra', meal: 'cena', createdAt: '', lines: [{ food_id: 'huevo', grams: 100 }] };
  const copia = parseBackup(backupToJSON(buildBackup({ meals: [], plantillas: [{ ...mia, nombre: 'Cambiada' }, otra, { id: 'mala' }] })));
  assert.deepEqual(copia.plantillas.map((t) => t.id), ['p1', 'p2']);
  const { list, nuevas } = mergeTemplates([mia], copia.plantillas);
  assert.deepEqual(nuevas.map((t) => t.id), ['p2']);
  assert.deepEqual(list.map((t) => [t.id, t.nombre]), [['p1', 'Mía'], ['p2', 'Otra']]);
  assert.deepEqual(parseBackup(JSON.stringify([])).plantillas, []);
});
