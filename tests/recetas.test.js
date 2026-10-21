// Script de recetas (frontend/js/core/recetas.js y recetas.mjs): cálculo determinista con nutrientes del catálogo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRecetas, validateRecetas, computeReceta, aplicarRecetas, fuenteReceta, NOTA_RECETA, TERMINO_RECETA } from '../frontend/js/core/recetas.js';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { searchPlan } from '../scripts/usda-lib.mjs';
import { catalog, csv, readFile, realFoods } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keys = catalog.keys;
const byIdOf = (foods) => new Map(foods.map((f) => [f.id, f]));
// A: proteína 10, agua 80, sin dato de fibra. B: proteína 20, agua 50, fibra 0 (cero real). C: incluir=no.
const DOC = csv('id,nombre,estado,incluir,proteina_g,agua_g,fibra_g,energia_kcal',
  'a,A,crudo,si,10,80,,100', 'b,B,crudo,si,20,50,0,200', 'c,C,crudo,no,5,90,1,40');
const foods = parseFoodsCSV(DOC, { catalog }).foods;
const byId = byIdOf(foods);
const R = (o = {}) => ({ id: 'r', nombre: 'R', ingredientes: [{ food_id: 'a', gramos: 100 }, { food_id: 'b', gramos: 50 }], ...o });

test('cálculo: suma de ingredientes ÷ peso final × 100; el cambio de peso es agua', () => {
  const res = computeReceta(R({ peso_final_g: 300 }), byId, keys);
  assert.equal(res.nutrients.proteina_g, 6.667); // (10 + 10) / 300 × 100
  assert.equal(res.nutrients.energia_kcal, 66.667); // (100 + 100) / 300 × 100
  assert.equal(res.nutrients.agua_g, 85); // (80 + 25 + 150 de agua añadida) / 300 × 100
  assert.deepEqual([res.pesoIngredientes, res.pesoFinal], [150, 300]);
});

test('sin peso_final_g: el peso final es la suma (proporciones, como "20 g de cada verdura")', () => {
  const res = computeReceta(R({ ingredientes: [{ food_id: 'a', gramos: 20 }, { food_id: 'b', gramos: 20 }] }), byId, keys);
  assert.equal(res.nutrients.proteina_g, 15);
  assert.equal(res.nutrients.agua_g, 65);
  assert.equal(res.pesoFinal, 40);
});

test('un ingrediente sin dato deja la receta sin dato en ese nutriente (nunca un total parcial); un 0 es un 0', () => {
  const res = computeReceta(R(), byId, keys);
  assert.equal(res.nutrients.fibra_g, undefined);
  assert.deepEqual(res.sinDato.fibra_g, ['a']);
  const soloB = computeReceta(R({ ingredientes: [{ food_id: 'b', gramos: 50 }] }), byId, keys);
  assert.equal(soloB.nutrients.fibra_g, 0);
  assert.equal(soloB.nutrients.vitamina_c_mg, undefined); // nadie la tiene
});

test('etiqueta: sustituye a lo calculado, también donde el cálculo lo dejaba sin dato; un 0 de la etiqueta es un 0', () => {
  const sin = computeReceta(R({ peso_final_g: 300 }), byId, keys);
  assert.equal(sin.nutrients.fibra_g, undefined);
  const res = computeReceta(R({ peso_final_g: 300, etiqueta: { energia_kcal: 50, fibra_g: 3, vitamina_c_mg: 0 } }), byId, keys);
  assert.equal(res.nutrients.energia_kcal, 50); // calculado: 66,667
  assert.equal(res.nutrients.fibra_g, 3); // calculado: sin dato
  assert.equal(res.nutrients.vitamina_c_mg, 0); // nadie la tenía: 0 real de la etiqueta
  assert.equal(res.nutrients.proteina_g, 6.667); // el resto sigue calculado
  assert.equal(res.sinDato.fibra_g, undefined); // ya no falta
  assert.match(fuenteReceta(R({ peso_final_g: 300, etiqueta: { energia_kcal: 50, fibra_g: 3 } }), res), /peso final 300 g; etiqueta: energia_kcal, fibra_g; resto calculado de la receta$/);
  assert.doesNotMatch(fuenteReceta(R({ peso_final_g: 300 }), sin), /etiqueta/);
});

test('etiqueta: validación (clave que no es del catálogo, valor negativo o no numérico, no es un objeto)', () => {
  assert.deepEqual(validateRecetas([R({ etiqueta: { energia_kcal: 36, sodio_mg: 0 } })], byId, keys), []);
  const errs = validateRecetas([
    R({ id: 'a1', etiqueta: { inventado_g: 3 } }), R({ id: 'a2', etiqueta: { energia_kcal: -1 } }), R({ id: 'a3', etiqueta: { energia_kcal: '36' } }),
    R({ id: 'a4', etiqueta: [1] }), R({ id: 'a5', etiqueta: { energia_kcal: null } }),
  ], byId, keys);
  for (const s of ['"a1": etiqueta: "inventado_g" no es un nutriente', '"a2": etiqueta: "energia_kcal" debe ser un número mayor o igual que 0',
    '"a3": etiqueta: "energia_kcal" debe ser un número', '"a4": etiqueta debe ser un objeto', '"a5": etiqueta: "energia_kcal" debe ser un número']) assert.ok(errs.some((e) => e.includes(s)), s);
  assert.equal(errs.length, 5);
});

test('etiqueta: aplicar escribe los valores de la etiqueta y la fuente en la fila (y los recalculos no los pierden)', () => {
  const doc = csv('id,nombre,estado,proteina_g,fibra_g,energia_kcal,fuente_usda', 'r,Vieja,crudo,99,99,99,x', 'a,A,crudo,10,,100,');
  const recetas = [R({ peso_final_g: 300, etiqueta: { energia_kcal: 50, fibra_g: 3 } })];
  let texto = doc;
  for (let vez = 0; vez < 2; vez++) { // aplicar dos veces (como recalcular) da lo mismo
    const out = aplicarRecetas(texto, recetas, recetas.map((r) => computeReceta(r, byId, keys)), keys);
    texto = out.text;
    const r = parseFoodsCSV(out.text, { catalog }).foods.find((f) => f.id === 'r');
    assert.deepEqual([r.nutrients.energia_kcal, r.nutrients.fibra_g, r.nutrients.proteina_g], [50, 3, 6.667]);
    assert.match(r.extra.fuente_usda, /etiqueta: energia_kcal, fibra_g; resto calculado de la receta$/);
  }
});

test('aviso si el peso final es menor que el agua de los ingredientes o sospechosamente bajo', () => {
  const res = computeReceta(R({ peso_final_g: 10 }), byId, keys);
  assert.equal(res.nutrients.agua_g, undefined);
  assert.equal(res.avisos.length, 2);
});

test('validación: id, nombre, gramos, peso final, ingredientes del catálogo (excluidos valen) y sin anidar recetas', () => {
  assert.deepEqual(validateRecetas([R(), R({ id: 'c2', ingredientes: [{ food_id: 'c', gramos: 10 }] })], byId), []); // c es incluir=no: vale
  const errs = validateRecetas([
    R({ id: 'Mal id' }), R({ id: 'x', nombre: '' }), R({ id: 'y', peso_final_g: 0 }), R({ id: 'z', ingredientes: [] }),
    R({ id: 'w', ingredientes: [{ food_id: 'nada', gramos: 5 }, { food_id: 'a', gramos: -1 }] }),
    R({ id: 'v', ingredientes: [{ food_id: 'w', gramos: 5 }] }), R({ id: 'v' }),
  ], byId);
  for (const s of ['"Mal id": id vacío', '"x": falta el nombre', '"y": peso_final_g', '"z": sin ingredientes', '"nada" no está en el catálogo',
    'ingrediente 2: gramos', '"v": id repetido']) assert.ok(errs.some((e) => e.includes(s)), s);
  assert.deepEqual(parseRecetas('{').errores.length, 1);
  assert.deepEqual(parseRecetas('{"x":1}').errores, ['falta la lista "recetas"']);
  assert.equal(parseRecetas('[]').recetas.length, 0);
});

test('aplicar: crea o actualiza la fila (cocinado, sin peso_en_crudo, notas, incluir=si) y vacía lo que no tiene dato', () => {
  const doc = csv('id,nombre,alias,estado,peso_en_crudo,incluir,tipo,notas,termino_busqueda_usda,fdc_id,proteina_g,fibra_g',
    'r,Vieja,,crudo,si,no,receta_descompuesta,x,(descomponer),123,99,99', 'a,A,,crudo,,si,,,,,10,');
  const recetas = [R({ alias: ['erre', 'r2'], peso_final_g: 300 }), R({ id: 'nueva', nombre: 'Nueva' }), R({ id: 'ej', ejemplo: true })];
  const resultados = recetas.map((r) => computeReceta(r, byId, keys));
  const out = aplicarRecetas(doc, recetas, resultados, keys);
  assert.deepEqual(out.cambios, [{ id: 'r', nueva: false }, { id: 'nueva', nueva: true }]);
  assert.deepEqual(out.omitidas, ['ej']);
  const { foods: f2, report } = parseFoodsCSV(out.text, { catalog });
  assert.equal(report.ok, true);
  const r = f2.find((f) => f.id === 'r');
  assert.deepEqual([r.nombre, r.alias, r.estado, r.pesoEnCrudo, r.extra.incluir, r.extra.tipo], ['R', ['erre', 'r2'], 'cocinado', false, 'si', 'receta_descompuesta']);
  assert.equal(r.extra.notas, `${NOTA_RECETA}.`);
  assert.deepEqual([r.extra.termino_busqueda_usda, r.extra.fdc_id], [TERMINO_RECETA, undefined]);
  assert.match(r.extra.fuente_usda, /^Receta \(data\/recetas\.json\): a 100 g, b 50 g; peso final 300 g$/);
  assert.equal(r.nutrients.proteina_g, 6.667);
  assert.equal(r.nutrients.fibra_g, undefined); // tenía 99: sin dato ahora
  const n = f2.find((f) => f.id === 'nueva');
  assert.deepEqual([n.estado, n.grupo, n.varianteDefecto, n.extra.tipo, n.extra.incluir], ['cocinado', 'nueva', true, 'receta', 'si']);
  assert.equal(f2.find((f) => f.id === 'a').nutrients.proteina_g, 10); // el resto, intacto
  assert.equal(searchPlan(f2).find((p) => p.food.id === 'r').omitido, 'receta por descomponer'); // usda.mjs no la pisa
});

test('aplicar: conserva separador, BOM y fin de línea; coma decimal con punto y coma (Excel en español)', () => {
  const doc = '﻿id;nombre;proteina_g\r\na;A;10\r\nb;B;20\r\n';
  const recetas = [R({ peso_final_g: 300 })];
  const out = aplicarRecetas(doc, recetas, recetas.map((r) => computeReceta(r, byId, keys)), keys);
  assert.ok(out.text.startsWith('﻿id;nombre;proteina_g;'));
  assert.ok(out.text.includes('\r\nr;R;6,667;'));
  assert.ok(!/[^\r]\n/.test(out.text));
});

test('data/recetas.json: válido con el catálogo real, con una receta de ejemplo que nunca va al catálogo', () => {
  const { recetas, errores } = parseRecetas(readFile('../data/recetas.json'));
  assert.deepEqual(errores, []);
  const real = byIdOf(realFoods);
  assert.deepEqual(validateRecetas(recetas, real, keys), []);
  const ej = recetas.filter((r) => r.ejemplo);
  assert.deepEqual(ej.map((r) => r.id), ['ejemplo_arroz_con_huevo']);
  assert.ok(!real.has('ejemplo_arroz_con_huevo'));
});

test('las filas de receta del catálogo coinciden con data/recetas.json (se recalculan igual)', () => {
  const { recetas } = parseRecetas(readFile('../data/recetas.json'));
  const real = byIdOf(realFoods);
  for (const r of recetas.filter((x) => !x.ejemplo)) {
    const fila = real.get(r.id);
    assert.ok(fila, r.id);
    assert.deepEqual([fila.estado, fila.pesoEnCrudo, fila.extra.incluir], ['cocinado', false, 'si'], r.id);
    assert.ok(fila.extra.notas.startsWith(NOTA_RECETA), r.id);
    const res = computeReceta(r, real, keys);
    // los salteados de Hacendado llevan fijados los valores de su etiqueta (recetas.mjs --aplicar los pisaría)
    const etiqueta = ETIQUETA_FIJADA.has(r.id) ? ETIQUETA_FIJADA.get(r.id) : [];
    if (etiqueta.length) assert.match(fila.extra.fuente_usda, /etiqueta Hacendado/, r.id);
    for (const k of keys.filter((x) => !etiqueta.includes(x))) assert.equal(fila.nutrients[k], res.nutrients[k], `${r.id}.${k}`);
  }
});
const KS_ETIQUETA = ['energia_kcal', 'grasa_total_g', 'grasas_saturadas_g', 'hidratos_g', 'azucares_g', 'fibra_g', 'proteina_g', 'sodio_mg'];
const ETIQUETA_FIJADA = new Map([['salteado_verduras_hacendado', KS_ETIQUETA], ['verduras_asadas_hacendado', KS_ETIQUETA]]);

test('CLI: sin --aplicar no escribe; con --aplicar escribe las recetas y omite el ejemplo (rutas de Windows y Linux)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recetas-'));
  const foodsCopy = join(dir, 'foods.csv');
  copyFileSync(join(root, 'tests', 'fixtures', 'alimentos_iniciales.csv'), foodsCopy);
  const recetasFile = join(dir, 'recetas.json');
  writeFileSync(recetasFile, JSON.stringify({ recetas: [
    { id: 'ejemplo_x', nombre: 'Ej', ejemplo: true, ingredientes: [{ food_id: 'huevo', gramos: 50 }] },
    { id: 'prueba_tortilla', nombre: 'Tortilla de prueba', peso_final_g: 500, ingredientes: [{ food_id: 'huevo', gramos: 300 }, { food_id: 'patata_cruda', gramos: 300 }, { food_id: 'aceite_oliva', gramos: 30 }] },
  ] }));
  const script = join(root, 'scripts', 'recetas.mjs');
  const antes = readFileSync(foodsCopy, 'utf8');
  const a = spawnSync(process.execPath, [script, '--foods', foodsCopy, '--recetas', recetasFile], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /prueba_tortilla: \d+\/31 obligatorios/);
  assert.match(a.stdout, /No se ha escrito nada/);
  assert.equal(readFileSync(foodsCopy, 'utf8'), antes);
  const b = spawnSync(process.execPath, [script, '--aplicar', '--foods', foodsCopy, '--recetas', recetasFile], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /prueba_tortilla \(nueva\) · ejemplos omitidos: ejemplo_x/);
  const { foods: f2, report } = parseFoodsCSV(readFileSync(foodsCopy, 'utf8'), { catalog });
  assert.equal(report.ok, true);
  assert.equal(f2.length, realFoods.length + 1);
  assert.ok(!f2.some((f) => f.id === 'ejemplo_x'));
  const c = spawnSync(process.execPath, [script, '--foods', foodsCopy, '--recetas', join(dir, 'no-existe.json')], { cwd: tmpdir(), encoding: 'utf8' });
  assert.notEqual(c.status, 0);
});
