import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFoodsCSV, parseFoodsJSON, parseFoodsDocument, foodsToCSV, foodsToJSON, formatIssue } from '../frontend/js/core/foods-parser.js';
import { catalog, csv, readFile } from './helpers.js';

const parse = (text) => parseFoodsCSV(text, { catalog });
const messages = (r, level) => r.report[level].map((i) => i.message);

test('documento mínimo válido', () => {
  const r = parse(csv('id,nombre,alias,porciones,estado,proteina_g', 'avena,Avena,copos|avena molida,cucharada:10,,16.9'));
  assert.equal(r.report.ok, true);
  assert.deepEqual(r.foods[0].alias, ['copos', 'avena molida']);
  assert.deepEqual(r.foods[0].porciones, [{ nombre: 'cucharada', gramos: 10 }]);
  assert.equal(r.foods[0].nutrients.proteina_g, 16.9);
});

test('celda vacía = sin dato; "0" escrito = cero real', () => {
  const r = parse(csv('id,nombre,vitamina_b12_ug,hierro_mg', 'kiwi,Kiwi,0,'));
  assert.equal(r.foods[0].nutrients.vitamina_b12_ug, 0);
  assert.equal('hierro_mg' in r.foods[0].nutrients, false);
});

test('id duplicado, id inválido y nombre ausente: la fila se rechaza con error', () => {
  const r = parse(csv('id,nombre', 'a,A', 'a,Otra', 'Mala Id,X', 'b,'));
  assert.deepEqual(r.foods.map((f) => f.id), ['a']);
  assert.equal(r.report.ok, false);
  assert.equal(r.report.errors.length, 3);
  assert.match(messages(r, 'errors')[0], /duplicado.*fila 2/);
  assert.equal(r.report.summary.rejected, 3);
});

test('número inválido o negativo rechaza la fila (no se convierte en "sin dato")', () => {
  const r = parse(csv('id,nombre,proteina_g,fibra_g', 'a,A,abc,1', 'b,B,2,-1', 'c,C,3,4'));
  assert.deepEqual(r.foods.map((f) => f.id), ['c']);
  assert.equal(r.report.errors.length, 2);
  assert.equal(r.report.errors[0].field, 'proteina_g');
});

test('valores imposibles dan aviso pero no rechazan', () => {
  const r = parse(csv('id,nombre,proteina_g,energia_kcal', 'a,A,120,1200'));
  assert.equal(r.foods.length, 1);
  assert.equal(r.report.warnings.length, 2);
});

test('cabecera desconocida: aviso, se conserva en extra y se exporta', () => {
  const r = parse(csv('id,nombre,marca', 'a,A,Hacendado'));
  assert.match(messages(r, 'warnings')[0], /cabecera desconocida "marca"/);
  assert.equal(r.foods[0].extra.marca, 'Hacendado');
  const out = parse(foodsToCSV(r.foods, { catalog, extraHeaders: r.extraHeaders }));
  assert.equal(out.foods[0].extra.marca, 'Hacendado');
});

test('unidad equivocada en la cabecera: sugiere la correcta', () => {
  const r = parse(csv('id,nombre,vitamina_b12_mg', 'a,A,1'));
  assert.match(messages(r, 'warnings')[0], /¿querías "vitamina_b12_ug"\?/);
  assert.equal('vitamina_b12_ug' in r.foods[0].nutrients, false);
});

test('columnas de trabajo se conservan y no son nutrientes', () => {
  const r = parse(csv('id,nombre,notas,incluir,termino_busqueda_usda', 'a,A,hola,si,"Milk, whole"'));
  assert.equal(r.report.warnings.length, 0);
  assert.deepEqual(r.foods[0].extra, { notas: 'hola', incluir: 'si', termino_busqueda_usda: 'Milk, whole' });
  assert.deepEqual(r.extraHeaders, ['notas', 'incluir', 'termino_busqueda_usda']);
});

test('cabecera antigua porciones_sugeridas se acepta como porciones', () => {
  const r = parse(csv('id,nombre,porciones_sugeridas', 'a,A,vaso:250'));
  assert.deepEqual(r.foods[0].porciones, [{ nombre: 'vaso', gramos: 250 }]);
  assert.match(messages(r, 'info')[0], /porciones_sugeridas/);
});

test('punto y coma + coma decimal (Excel en español) sin avisos', () => {
  const r = parse(csv('id;nombre;proteina_g', 'a;A;16,9'));
  assert.equal(r.foods[0].nutrients.proteina_g, 16.9);
  assert.equal(r.report.warnings.length, 0);
});

test('coma decimal en un CSV separado por comas: se interpreta con aviso', () => {
  const r = parse(csv('id,nombre,proteina_g', 'a,A,"16,9"'));
  assert.equal(r.foods[0].nutrients.proteina_g, 16.9);
  assert.equal(r.report.warnings.length, 1);
});

test('falta columna obligatoria o cabecera repetida: error de documento', () => {
  assert.equal(parse(csv('id,alias', 'a,x')).report.ok, false);
  const dup = parse(csv('id,nombre,nombre', 'a,A,B'));
  assert.equal(dup.report.ok, false);
  assert.equal(dup.foods.length, 0);
  assert.equal(parse('').report.ok, false);
});

test('estado: "cocido" se normaliza a "cocinado"; desconocido avisa', () => {
  const r = parse(csv('id,nombre,estado', 'a,A,cocido', 'b,B,frito'));
  assert.equal(r.foods[0].estado, 'cocinado');
  assert.equal(r.report.warnings.length, 1);
});

test('variante_por_defecto: si/no/vacío; valor raro avisa', () => {
  const r = parse(csv('id,nombre,variante_por_defecto', 'a,A,si', 'b,B,no', 'c,C,', 'd,D,quizá'));
  assert.deepEqual(r.foods.map((f) => f.varianteDefecto), [true, false, null, null]);
  assert.equal(r.report.warnings.length, 1);
});

test('grupos: avisa si no hay variante por defecto o hay varias; no avisa por alias compartidos del grupo', () => {
  const ok = parse(csv('id,nombre,alias,grupo,variante_por_defecto', 'arroz_crudo,Arroz crudo,arroz,arroz,si', 'arroz_cocido,Arroz cocido,arroz,arroz,no'));
  assert.equal(ok.report.warnings.length, 0);
  const none = parse(csv('id,nombre,grupo', 'a_crudo,A crudo,a', 'a_cocido,A cocido,a'));
  assert.match(messages(none, 'warnings')[0], /ninguna variante/);
  const many = parse(csv('id,nombre,grupo,variante_por_defecto', 'a_crudo,A crudo,a,si', 'a_cocido,A cocido,a,si'));
  assert.match(messages(many, 'warnings')[0], /varias variantes/);
});

test('alias repetido entre alimentos distintos avisa', () => {
  const r = parse(csv('id,nombre,alias', 'a,Yogur A,yogur griego', 'b,Yogur B,"Yogur Griego"'));
  assert.match(messages(r, 'warnings')[0], /yogur griego.*a, b/);
});

test('JSON con el mismo esquema (listas o texto) equivale al CSV', () => {
  const json = JSON.stringify({ foods: [
    { id: 'avena', nombre: 'Avena', alias: ['copos', 'avena molida'], porciones: [{ nombre: 'cucharada', gramos: 10 }], proteina_g: 16.9, vitamina_b12_ug: 0, hierro_mg: null, variante_por_defecto: true },
    { id: 'leche', nombre: 'Leche', alias: 'leche|leche de vaca', porciones: 'vaso:250' },
  ] });
  const r = parseFoodsJSON(json, { catalog });
  assert.equal(r.report.ok, true);
  assert.deepEqual(r.foods[0].alias, ['copos', 'avena molida']);
  assert.deepEqual(r.foods[0].nutrients, { proteina_g: 16.9, vitamina_b12_ug: 0 });
  assert.equal(r.foods[0].varianteDefecto, true);
  assert.deepEqual(r.foods[1].porciones, [{ nombre: 'vaso', gramos: 250 }]);
  assert.equal(parseFoodsJSON('{no', { catalog }).report.ok, false);
  assert.equal(parseFoodsJSON('{"a":1}', { catalog }).report.ok, false);
});

test('parseFoodsDocument elige formato por extensión o contenido', () => {
  assert.equal(parseFoodsDocument('[{"id":"a","nombre":"A"}]', { catalog, filename: 'x.json' }).foods.length, 1);
  assert.equal(parseFoodsDocument('[{"id":"a","nombre":"A"}]', { catalog }).foods.length, 1);
  assert.equal(parseFoodsDocument('id,nombre\na,A\n', { catalog, filename: 'x.csv' }).foods.length, 1);
});

test('ida y vuelta CSV y JSON con el fichero de ejemplo', () => {
  const first = parseFoodsCSV(readFile('../data/foods.sample.csv'), { catalog });
  assert.equal(first.report.ok, true);
  assert.equal(first.foods.length, 10);
  const viaCsv = parseFoodsCSV(foodsToCSV(first.foods, { catalog, extraHeaders: first.extraHeaders }), { catalog });
  assert.deepEqual(viaCsv.foods, first.foods);
  const viaJson = parseFoodsJSON(foodsToJSON(first.foods), { catalog });
  assert.deepEqual(viaJson.foods, first.foods);
  const semicolon = parseFoodsCSV(foodsToCSV(first.foods, { catalog, extraHeaders: first.extraHeaders, delimiter: ';' }), { catalog });
  assert.deepEqual(semicolon.foods, first.foods);
});

test('la plantilla es válida y está vacía', () => {
  const r = parseFoodsCSV(readFile('../data/foods.template.csv'), { catalog });
  assert.equal(r.report.ok, true);
  assert.equal(r.foods.length, 0);
});

test('lista inicial real de Victor: 64 alimentos, sin errores ni avisos (porciones, grupos, estados)', () => {
  const r = parseFoodsCSV(readFile('./fixtures/alimentos_iniciales.csv'), { catalog });
  assert.equal(r.report.ok, true);
  assert.equal(r.foods.length, 64);
  assert.deepEqual(r.report.warnings, []);
  assert.equal(r.foods.find((f) => f.id === 'leche_entera').porciones[0].gramos, 250);
  assert.equal(r.foods.find((f) => f.id === 'ron').extra.incluir, 'no');
  assert.equal(r.foods.find((f) => f.id === 'pistachos_tostados_sin_sal').estado, 'tostado');
  assert.equal(r.foods.find((f) => f.id === 'leche_entera').estado, 'procesado');
});

test('formatIssue', () => {
  assert.equal(formatIssue({ row: 5, id: 'a', field: 'proteina_g', message: 'mal' }), 'fila 5 [a] · proteina_g: mal');
  assert.equal(formatIssue({ message: 'vacío' }), 'documento: vacío');
});
