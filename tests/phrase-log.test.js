// Registro local de frases problemáticas (punto 6 de CLAUDE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { problemsFromResult, newEntry, resolveEntry, cleanLog, addEntry, updateEntry, removeEntry, logToCSV, MAX_ENTRADAS } from '../frontend/js/core/phrase-log.js';
import { realFoods } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const RESULT = {
  items: [
    { food_id: 'avena_copos', grams: 80, source_text: '80 g de avena', confidence: 'alta', flags: [] },
    { food_id: 'pechuga_pollo_cruda', grams: 150, source_text: '150 g de pechuga', confidence: 'baja', flags: ['sin_alias'] },
    { food_id: 'merluza_cruda', grams: 200, source_text: '200 g de pescado', confidence: 'baja', flags: [] },
  ],
  unmatched: [{ text: 'un plátano', motivo: 'no_en_catalogo' }, { text: '1 manzana', motivo: 'sin_porcion', food_id: 'manzana_con_piel' }],
};
const NOW = new Date('2026-10-18T09:00:00Z');

test('problemas de un dictado: no reconocido, "no coincide con tus alias" y confianza baja (uno por línea)', () => {
  assert.deepEqual(problemsFromResult(RESULT).map((p) => [p.texto, p.tipo, p.motivo, p.food_id]), [
    ['un plátano', 'no_reconocido', 'no_en_catalogo', null],
    ['1 manzana', 'no_reconocido', 'sin_porcion', 'manzana_con_piel'],
    ['150 g de pechuga', 'sin_alias', null, 'pechuga_pollo_cruda'],
    ['200 g de pescado', 'confianza_baja', null, 'merluza_cruda']]);
  assert.equal(newEntry({ texto: 'x', result: { items: [RESULT.items[0]], unmatched: [] } }), null); // sin problemas, nada que anotar
});

test('al guardar se anota la resolución de cada problema: el alimento elegido o "descartado"', () => {
  const e = newEntry({ texto: 'frase', result: RESULT, now: NOW, idGen: () => 'e1' });
  assert.deepEqual([e.id, e.fecha, e.texto, e.problemas.every((p) => p.resolucion === null)], ['e1', '2026-10-18T09:00:00.000Z', 'frase', true]);
  const lines = [{ food_id: 'avena_copos', source_text: '80 g de avena' }, { food_id: 'pechuga_pavo_cruda', source_text: '150 g de pechuga' }, { food_id: 'manzana_con_piel', source_text: '1 manzana' }];
  assert.deepEqual(resolveEntry(e, lines).problemas.map((p) => [p.texto, p.resolucion]), [
    ['un plátano', 'descartado'], ['1 manzana', 'manzana_con_piel'], ['150 g de pechuga', 'pechuga_pavo_cruda'], ['200 g de pescado', 'descartado']]);
});

test('lista: lo más nuevo primero, como mucho 300; actualizar, quitar y limpiar lo guardado', () => {
  const e = (id) => ({ id, fecha: 'f', texto: id, problemas: [{ texto: 't', tipo: 'no_reconocido', motivo: null, food_id: null, resolucion: null }] });
  let log = [];
  for (let i = 0; i < MAX_ENTRADAS + 5; i++) log = addEntry(log, e(`e${i}`));
  assert.equal(log.length, MAX_ENTRADAS);
  assert.equal(log[0].id, `e${MAX_ENTRADAS + 4}`);
  assert.equal(updateEntry(log, { ...e(log[1].id), texto: 'nuevo' })[1].texto, 'nuevo');
  assert.equal(removeEntry(log, log[0].id).length, MAX_ENTRADAS - 1);
  assert.deepEqual(cleanLog([e('a'), { id: 'b' }, null, { ...e('c'), problemas: [{ texto: 't', tipo: 'raro' }] }]).map((x) => x.id), ['a']);
  assert.deepEqual(cleanLog(undefined), []);
});

test('exportar a CSV para Excel: una fila por problema, con nombres de alimentos', () => {
  const e = resolveEntry(newEntry({ texto: 'para comer 150 g de pechuga', result: { items: [RESULT.items[1]], unmatched: [] }, now: NOW, idGen: () => 'e1' }), [{ food_id: 'pechuga_pavo_cruda', source_text: '150 g de pechuga' }]);
  const csv = logToCSV([e], byId);
  assert.ok(csv.startsWith('﻿fecha;frase;texto;problema;motivo;alimento_ia;resolucion;id_resolucion\r\n'));
  assert.match(csv, /2026-10-18T09:00:00\.000Z;para comer 150 g de pechuga;150 g de pechuga;No coincide con tus alias;;Pechuga de pollo sin piel cruda;Pechuga de pavo sin piel cruda;pechuga_pavo_cruda/);
});

test('copia de seguridad: lleva el registro; al importar se añaden las frases nuevas, sin pisar las tuyas y con el máximo', async () => {
  const { mergeLog } = await import('../frontend/js/core/phrase-log.js');
  const { buildBackup, backupToJSON, parseBackup } = await import('../frontend/js/core/backup.js');
  const e = (id, fecha, texto = id) => ({ id, fecha, texto, problemas: [{ texto: 't', tipo: 'no_reconocido', motivo: null, food_id: null, resolucion: null }] });
  const mia = e('a', '2026-10-17T10:00:00Z', 'mía');
  const copia = parseBackup(backupToJSON(buildBackup({ meals: [], registro: [{ ...mia, texto: 'cambiada' }, e('b', '2026-10-18T10:00:00Z'), { id: 'mala' }] })));
  assert.deepEqual(copia.registro.map((x) => x.id), ['a', 'b']);
  const { list, nuevas } = mergeLog([mia], copia.registro);
  assert.deepEqual(nuevas.map((x) => x.id), ['b']);
  assert.deepEqual(list.map((x) => [x.id, x.texto]), [['b', 'b'], ['a', 'mía']]); // lo más reciente primero; la tuya intacta
  assert.equal(mergeLog([], Array.from({ length: 310 }, (_, i) => e(`x${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`))).list.length, 300);
  assert.deepEqual(parseBackup(JSON.stringify([])).registro, []);
});
