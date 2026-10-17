import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, serializeCSV, detectDelimiter } from '../frontend/js/core/csv.js';

test('comillas, comas internas, comillas escapadas y saltos de línea en celdas', () => {
  const { rows } = parseCSV('a,b,c\n"x,y","di ""hola""","l1\nl2"\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x,y', 'di "hola"', 'l1\nl2']]);
});

test('BOM y CRLF', () => {
  const { rows } = parseCSV('\uFEFFa,b\r\n1,2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('autodetecta punto y coma (Excel en español) y tabulador', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.deepEqual(parseCSV('a;b\n1,5;2').rows[1], ['1,5', '2']);
});

test('salta filas vacías y conserva el número de registro', () => {
  const r = parseCSV('a,b\n1,2\n,\n\n3,4');
  assert.deepEqual(r.rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(r.rowNumbers, [1, 2, 5]);
});

test('ida y vuelta con celdas difíciles', () => {
  const rows = [['id', 'nota'], ['a', 'dice "sí", y luego\nsalta'], ['b', '']];
  assert.deepEqual(parseCSV(serializeCSV(rows)).rows, rows);
});
