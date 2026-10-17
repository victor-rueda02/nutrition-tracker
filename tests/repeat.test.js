// "Repetir comida": registrar lo de otro día ajustando los gramos, sin IA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepeat, toggleItem, setItemGrams, nudge, setTarget, repeatTotals, validateRepeat, toRecords, allItems, findItem, DESTINO_ORIGEN, PASOS } from '../frontend/js/core/repeat.js';
import { realFoods } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const M = (id, meal, lines, date = '2026-10-17') => ({ id, date, meal, createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: 'x' })) });
const AYER = [M('c', 'comida', [['arroz_blanco_crudo', 150], ['aceite_oliva', 10]]), M('d', 'desayuno', [['avena_copos', 80], ['leche_entera', 250]]), M('d2', 'desayuno', [['kiwi_verde', 69]])];
const nuevo = (o = {}) => createRepeat({ meals: AYER, sourceDate: '2026-10-17', foodsById: byId, targetDate: '2026-10-18', ...o });
const NOW = new Date('2026-10-18T13:00:00Z');
let n = 0;
const idGen = () => `n${++n}`;

test('estado: agrupado por comida en orden (desayuno, comida...), todo marcado, con los gramos de origen', () => {
  const r = nuevo();
  assert.deepEqual(r.groups.map((g) => g.meal), ['desayuno', 'comida']);
  assert.deepEqual(r.groups[0].items.map((i) => [i.food_id, i.grams, i.checked]), [['avena_copos', 80, true], ['leche_entera', 250, true], ['kiwi_verde', 69, true]]);
  assert.equal(r.groups[0].items[0].nombre, 'Avena (copos/molida)');
  assert.equal(r.targetMeal, DESTINO_ORIGEN);
});

test('ajuste rápido: −10 −5 +5 +10 sin bajar de 1 g; gramos tecleados con coma; vacío = sin gramos', () => {
  assert.deepEqual(PASOS, [-10, -5, 5, 10]);
  let r = nuevo();
  const k = r.groups[1].items[0].key; // arroz 150
  r = nudge(nudge(r, k, 10), k, 5);
  assert.equal(findItem(r, k).grams, 165);
  r = nudge(setItemGrams(r, k, '3'), k, -10);
  assert.equal(findItem(r, k).grams, 1);
  assert.equal(findItem(setItemGrams(r, k, '120,5'), k).grams, 120.5);
  assert.equal(findItem(setItemGrams(r, k, ''), k).grams, null);
  assert.equal(findItem(nudge(setItemGrams(r, k, ''), k, 5), k).grams, 5);
});

test('totales en vivo de lo marcado (kcal y proteína)', () => {
  let r = nuevo();
  const t = repeatTotals(r, byId);
  const kcal = (id, g) => (byId.get(id).nutrients.energia_kcal * g) / 100;
  const esperado = kcal('avena_copos', 80) + kcal('leche_entera', 250) + kcal('kiwi_verde', 69) + kcal('arroz_blanco_crudo', 150) + kcal('aceite_oliva', 10);
  assert.ok(Math.abs(t.energia_kcal.value - esperado) < 1e-9);
  r = toggleItem(r, r.groups[1].items[1].key, false); // sin aceite
  assert.ok(Math.abs(repeatTotals(r, byId).energia_kcal.value - (esperado - kcal('aceite_oliva', 10))) < 1e-9);
  for (const i of allItems(r)) r = toggleItem(r, i.key, false);
  assert.equal(repeatTotals(r, byId).energia_kcal.value, null);
});

test('"Como en el origen": un registro por comida; con una comida elegida, uno solo; solo lo marcado', () => {
  let r = nuevo();
  r = toggleItem(r, r.groups[0].items[1].key, false); // sin leche
  r = setItemGrams(r, r.groups[1].items[0].key, '120');
  const recs = toRecords(r, { now: NOW, idGen });
  assert.deepEqual(recs.map((x) => [x.date, x.meal, x.lines.map((l) => [l.food_id, l.grams])]), [
    ['2026-10-18', 'desayuno', [['avena_copos', 80], ['kiwi_verde', 69]]],
    ['2026-10-18', 'comida', [['arroz_blanco_crudo', 120], ['aceite_oliva', 10]]]]);
  assert.equal(recs[0].text, 'Repetido de 2026-10-17');
  assert.equal(recs[0].lines[0].source_text, 'repetido de 2026-10-17');
  assert.ok(recs[0].createdAt < recs[1].createdAt);
  const una = toRecords(setTarget(r, { meal: 'cena', date: '2026-10-16' }), { now: NOW, idGen });
  assert.deepEqual(una.map((x) => [x.date, x.meal, x.lines.length]), [['2026-10-16', 'cena', 4]]);
});

test('validación: nada marcado, sin gramos, más de 2000 g, fecha o comida no válidas -> no se añade', () => {
  let r = nuevo();
  assert.deepEqual(validateRepeat(r), { ok: true, empty: false, count: 5, problems: [] });
  const k = r.groups[0].items[0].key;
  assert.deepEqual(validateRepeat(setItemGrams(r, k, '')).problems, [{ key: k, code: 'sin_gramos' }]);
  assert.deepEqual(validateRepeat(setItemGrams(r, k, '2500')).problems, [{ key: k, code: 'gramos_altos' }]);
  assert.equal(validateRepeat(toggleItem(setItemGrams(r, k, ''), k, false)).ok, true); // desmarcado no cuenta
  assert.deepEqual(validateRepeat(setTarget(r, { date: '2026-02-30' })).problems, [{ key: null, code: 'fecha' }]);
  assert.deepEqual(validateRepeat(setTarget(r, { meal: 'brunch' })).problems, [{ key: null, code: 'comida' }]);
  for (const i of allItems(r)) r = toggleItem(r, i.key, false);
  assert.equal(validateRepeat(r).empty, true);
  assert.throws(() => toRecords(r, { now: NOW, idGen }));
});

test('un alimento que ya no está en el documento sale desmarcado y no se puede marcar', () => {
  const r = createRepeat({ meals: [M('x', 'cena', [['ya_no_existe', 30], ['huevo', 100]])], sourceDate: '2026-10-17', foodsById: byId, targetDate: '2026-10-18' });
  const [fantasma, huevo] = r.groups[0].items;
  assert.deepEqual([fantasma.checked, fantasma.known, fantasma.nombre, huevo.checked], [false, false, 'ya_no_existe', true]);
  assert.equal(findItem(toggleItem(r, fantasma.key, true), fantasma.key).checked, false);
  assert.deepEqual(toRecords(r, { now: NOW, idGen })[0].lines.map((l) => l.food_id), ['huevo']);
});
