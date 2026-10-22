import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, setGrams, changeFood, removeLine, addLine, resolveUnmatched, dropUnmatched, confirmHigh, validateDraft, previewTotals, toMealRecord, draftFromRecord, setDate, setMeal } from '../frontend/js/core/draft.js';
import { defaultMeal, madridNow, MEALS } from '../frontend/js/core/meal-defaults.js';
import { realFoods } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const result = {
  items: [
    { food_id: 'avena_copos', grams: 80, source_text: '80 g de avena', confidence: 'alta', flags: [] },
    { food_id: 'huevo', grams: 100, source_text: '2 huevos', confidence: 'media', flags: ['variante_por_defecto'] },
    { food_id: 'inexistente', grams: 5, source_text: 'cosa', confidence: 'alta', flags: [] },
    { food_id: 'kiwi_verde', grams: -3, source_text: 'kiwi', confidence: 'alta', flags: [] },
  ],
  unmatched: [{ text: 'un plátano', motivo: 'no_en_catalogo' }, { text: 'un puñado de pistachos', motivo: 'sin_porcion', food_id: 'pistachos_tostados_sin_sal' }],
  warnings: ['aviso'],
};
const mk = () => createDraft({ text: 'frase', meal: 'desayuno', result, foodsById: byId });

test('createDraft: revalida en cliente (id inexistente -> sin resolver; gramos inválidos -> null)', () => {
  const d = mk();
  assert.deepEqual(d.lines.map((l) => [l.food_id, l.grams]), [['avena_copos', 80], ['huevo', 100], ['kiwi_verde', null]]);
  assert.equal(d.unmatched.length, 3);
  assert.equal(d.unmatched.at(-1).text, 'cosa');
  assert.deepEqual(d.warnings, ['aviso']);
  assert.equal(new Set(d.lines.map((l) => l.key)).size, 3);
});

test('setGrams acepta coma decimal y deja null lo inválido; no se puede guardar sin gramos', () => {
  let d = mk();
  const k = d.lines[2].key;
  assert.equal(validateDraft(d).ok, false);
  d = setGrams(d, k, '69,5');
  assert.equal(d.lines[2].grams, 69.5);
  assert.equal(validateDraft(d).ok, true);
  for (const bad of ['', 'abc', '0', '-4']) assert.equal(setGrams(d, k, bad).lines[2].grams, null, bad);
});

test('más de 2000 g exige confirmar; al bajar de 2000 se limpia la confirmación', () => {
  let d = setGrams(removeLine(removeLine(mk(), 'l3'), 'l2'), 'l1', '2500');
  assert.equal(validateDraft(d).problems[0].code, 'gramos_altos');
  d = confirmHigh(d, 'l1', true);
  assert.equal(validateDraft(d).ok, true);
  d = setGrams(setGrams(d, 'l1', '100'), 'l1', '3000');
  assert.equal(d.lines[0].confirmedHigh, false);
  assert.equal(validateDraft(d).ok, false);
});

test('cambiar alimento: pasa a manual y limpia avisos de la IA; borrar línea; borrador vacío no se guarda', () => {
  let d = changeFood(mk(), 'l2', 'kiwi_verde');
  assert.deepEqual([d.lines[1].food_id, d.lines[1].confidence, d.lines[1].flags], ['kiwi_verde', 'manual', []]);
  assert.equal(d.lines[1].grams, 100);
  d = removeLine(d, 'l2');
  assert.equal(d.lines.some((l) => l.key === 'l2'), false);
  const empty = createDraft({ meal: 'cena', foodsById: byId });
  assert.deepEqual([validateDraft(empty).ok, validateDraft(empty).empty], [false, true]);
});

test('sin resolver: resolver con alimento (línea sin gramos), descartar', () => {
  let d = mk();
  d = resolveUnmatched(d, 1, 'pistachos_tostados_sin_sal');
  assert.equal(d.unmatched.length, 2);
  const last = d.lines.at(-1);
  assert.deepEqual([last.food_id, last.grams, last.source_text, last.confidence], ['pistachos_tostados_sin_sal', null, 'un puñado de pistachos', 'manual']);
  assert.equal(dropUnmatched(d, 0).unmatched.length, 1);
  assert.equal(addLine(d, 'kiwi_verde', 69).lines.at(-1).grams, 69);
});

test('previewTotals usa el documento; un alimento sin nutrientes deja el total parcial (missing), nunca suma 0', () => {
  const t = previewTotals(setGrams(mk(), 'l3', '50'), byId);
  // catálogo real: 80 g avena (384 kcal) + 100 g huevo (143) + 50 g kiwi (61)
  assert.equal(Math.round(t.energia_kcal.value * 10) / 10, 480.7);
  assert.deepEqual(t.energia_kcal.missing, []);
  const parcial = previewTotals(addLine(setGrams(mk(), 'l3', '50'), 'coca_cola', 330), byId); // incluir=no, sin datos
  assert.equal(Math.round(parcial.energia_kcal.value * 10) / 10, 480.7);
  assert.deepEqual(parcial.energia_kcal.missing, ['coca_cola']);
  const vacio = previewTotals(addLine(createDraft({ meal: 'otro', foodsById: byId }), 'coca_cola', 330), byId);
  assert.equal(vacio.energia_kcal.value, null);
  const withData = new Map([['a', { id: 'a', nutrients: { energia_kcal: 200, proteina_g: 10 } }]]);
  const d = addLine(createDraft({ meal: 'otro', foodsById: withData }), 'a', 50);
  assert.equal(previewTotals(d, withData).energia_kcal.value, 100);
});

test('toMealRecord: solo alimentos y gramos (sin nutrientes), fecha de Madrid', () => {
  const d = setGrams(removeLine(removeLine(mk(), 'l3'), 'l2'), 'l1', '80');
  const rec = toMealRecord(d, { now: new Date('2026-10-16T22:30:00Z'), idGen: () => 'id-1' });
  assert.deepEqual(rec, { id: 'id-1', date: '2026-10-17', meal: 'desayuno', createdAt: '2026-10-16T22:30:00.000Z', text: 'frase', lines: [{ food_id: 'avena_copos', grams: 80, source_text: '80 g de avena' }] });
  assert.throws(() => toMealRecord(mk()), /no es válido/);
});

test('comida por defecto según la hora de Madrid (verano e invierno)', () => {
  const at = (iso) => defaultMeal(new Date(iso));
  assert.equal(at('2026-10-16T07:30:00Z'), 'desayuno'); // 09:30 CEST
  assert.equal(at('2026-10-16T09:29:00Z'), 'desayuno'); // 11:29
  assert.equal(at('2026-10-16T09:30:00Z'), 'comida');   // 11:30
  assert.equal(at('2026-10-16T12:00:00Z'), 'comida');   // 14:00
  assert.equal(at('2026-10-16T14:30:00Z'), 'merienda'); // 16:30
  assert.equal(at('2026-10-16T17:30:00Z'), 'cena');     // 19:30
  assert.equal(at('2026-10-16T21:59:00Z'), 'cena');     // 23:59
  assert.equal(at('2026-10-16T22:00:00Z'), 'otro');     // 00:00 del día siguiente
  assert.equal(at('2026-10-16T02:59:00Z'), 'otro');     // 04:59
  assert.equal(at('2026-12-16T08:00:00Z'), 'desayuno'); // 09:00 CET (invierno)
  assert.equal(at('2026-12-16T10:30:00Z'), 'comida');   // 11:30 CET
  assert.deepEqual(madridNow(new Date('2026-10-16T22:30:00Z')), { date: '2026-10-17', minutes: 30 });
  assert.deepEqual(MEALS, ['desayuno', 'comida', 'merienda', 'cena', 'otro']);
});

// ---------- Hito 4, fase 2: editar una comida guardada ----------
test('draftFromRecord + toMealRecord: misma id y createdAt, fecha del borrador, updatedAt; alimento borrado a "sin resolver"', () => {
  const rec = { id: 'r1', date: '2026-10-15', meal: 'comida', createdAt: '2026-10-15T12:00:00.000Z', text: 'frase', lines: [
    { food_id: 'avena_copos', grams: 80, source_text: '80 g de avena' }, { food_id: 'ya_no_existe', grams: 35, source_text: 'algo' }, { food_id: 'huevo', grams: 100, source_text: '2 huevos' }] };
  let d = draftFromRecord(rec, byId);
  assert.deepEqual(d.lines.map((l) => [l.food_id, l.grams, l.confidence]), [['avena_copos', 80, 'guardado'], ['huevo', 100, 'guardado']]);
  assert.deepEqual(d.unmatched, [{ text: 'ya_no_existe · 35 g', motivo: 'no_en_catalogo' }]);
  assert.deepEqual(d.editing, { id: 'r1', createdAt: '2026-10-15T12:00:00.000Z', date: '2026-10-15' });
  // al resolver el que falta con otro alimento, los gramos vienen del texto
  assert.equal(resolveUnmatched(d, 0, 'kiwi_verde').lines.at(-1).grams, 35);
  d = setDate(setMeal(removeLine(setGrams(d, 'l1', '90'), 'l2'), 'cena'), '2026-10-16');
  const out = toMealRecord(d, { now: new Date('2026-10-16T20:00:00Z'), idGen: () => 'NO-USAR' });
  assert.deepEqual(out, { id: 'r1', date: '2026-10-16', meal: 'cena', createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-16T20:00:00.000Z', text: 'frase', lines: [{ food_id: 'avena_copos', grams: 90, source_text: '80 g de avena' }] });
});

test('editar: fecha inválida o sin líneas no se puede guardar', () => {
  const rec = { id: 'r1', date: '2026-10-15', meal: 'comida', createdAt: 'x', text: '', lines: [{ food_id: 'kiwi_verde', grams: 69, source_text: '' }] };
  const d = draftFromRecord(rec, byId);
  assert.equal(validateDraft(d).ok, true);
  for (const bad of ['', '2026-13-01', '2026-02-30', '15/10/2026']) assert.deepEqual(validateDraft(setDate(d, bad)).problems, [{ key: null, code: 'fecha' }], bad);
  assert.equal(validateDraft(removeLine(d, 'l1')).empty, true);
});
