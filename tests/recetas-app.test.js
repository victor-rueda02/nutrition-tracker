// «Guardar como receta» desde la app (frontend/js/core/recetas.js): misma fila que el script, ids, validación, fusión
// de definiciones (data/recetas.json + dispositivo), copia de seguridad y la actualización del catálogo publicado,
// que conserva lo creado en el dispositivo (recetas y añadidos con «Estimar con IA»).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReceta, aplicarRecetas, recetaToFood, recetaFromLines, recetaErrors, slugId, cleanRecetas, mergeRecetas, upsertReceta, mergeRecetasImport,
  recetasToJSON, parseRecetas, TERMINO_RECETA,
} from '../frontend/js/core/recetas.js';
import { parseFoodsCSV, foodsToCSV } from '../frontend/js/core/foods-parser.js';
import { planCatalogUpdate, applyChoices } from '../frontend/js/core/catalog-update.js';
import { buildBackup, backupToJSON, parseBackup } from '../frontend/js/core/backup.js';
import { aplicarEstimacion, createEstimate } from '../frontend/js/core/estimate.js';
import { claveTermino } from '../frontend/js/core/usda-cache.js';
import { catalog, csv, readFile } from './helpers.js';

const keys = catalog.keys;
const DOC = csv('id,nombre,estado,incluir,tipo,proteina_g,agua_g,fibra_g,energia_kcal',
  'a,A,crudo,si,,10,80,,100', 'b,B,crudo,si,,20,50,0,200', 'rec,Receta vieja,cocinado,si,receta,1,1,1,1');
const foods = parseFoodsCSV(DOC, { catalog }).foods;
const byId = new Map(foods.map((f) => [f.id, f]));

test('slugId: sin acentos ni signos, único (sufijo _2, _3...) y válido como id del documento', () => {
  assert.equal(slugId('Lasaña casera', []), 'lasana_casera');
  assert.equal(slugId('  Pollo  al curry!! ', ['pollo_al_curry']), 'pollo_al_curry_2');
  assert.equal(slugId('Ñ', new Set(['n', 'n_2'])), 'n_3');
  assert.equal(slugId('¿?', []), 'receta');
  assert.match(slugId('x'.repeat(80) + ' _y', []), /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
});

test('recetaToFood da la misma fila que aplicarRecetas (el script) sobre el CSV', () => {
  const receta = { id: 'nueva', nombre: 'Nueva', alias: ['nuevita'], peso_final_g: 300, ingredientes: [{ food_id: 'a', gramos: 100 }, { food_id: 'b', gramos: 50 }], notas: 'De la app.' };
  const res = computeReceta(receta, byId, keys);
  const app = recetaToFood(receta, res);
  const script = parseFoodsCSV(aplicarRecetas(DOC, [receta], [res], keys).text, { catalog }).foods.find((f) => f.id === 'nueva');
  for (const k of ['id', 'nombre', 'alias', 'estado', 'varianteDefecto', 'grupo', 'pesoEnCrudo', 'nutrients']) assert.deepEqual(app[k], script[k], k);
  assert.deepEqual(app.extra, script.extra);
  assert.deepEqual([app.estado, app.extra.tipo, app.extra.incluir, app.extra.termino_busqueda_usda], ['cocinado', 'receta', 'si', TERMINO_RECETA]);
  assert.equal(app.nutrients.fibra_g, undefined); // a no tiene dato de fibra: la receta queda sin dato
  // actualizar una fila existente conserva lo demás (grupo, variante, porciones)
  const previa = { ...app, porciones: [{ nombre: 'plato', gramos: 350 }], grupo: 'otro', extra: { ...app.extra, fdc_id: '1' } };
  const otra = recetaToFood({ ...receta, nombre: 'Nueva 2', alias: undefined }, res, previa);
  assert.deepEqual([otra.nombre, otra.alias, otra.grupo, otra.porciones, otra.extra.fdc_id], ['Nueva 2', ['nuevita'], 'otro', [{ nombre: 'plato', gramos: 350 }], undefined]);
});

test('recetaFromLines: ingredientes de una comida (repetidos se suman); sin peso final son proporciones', () => {
  const r = recetaFromLines({ id: 'x', nombre: ' X ', alias: ['x', ' ', 'equis'], lines: [{ food_id: 'a', grams: 50 }, { food_id: 'b', grams: 25 }, { food_id: 'a', grams: 25.5 }] });
  assert.deepEqual(r, { id: 'x', nombre: 'X', alias: ['x', 'equis'], ingredientes: [{ food_id: 'a', gramos: 75.5 }, { food_id: 'b', gramos: 25 }] });
  assert.equal(recetaFromLines({ id: 'x', nombre: 'X', lines: [{ food_id: 'a', grams: 1 }], peso_final_g: 900 }).peso_final_g, 900);
});

test('recetaErrors: no se anidan recetas (del fichero o filas tipo=receta), no pisa un alimento y valida lo del script', () => {
  const ok = recetaFromLines({ id: 'nueva', nombre: 'Nueva', lines: [{ food_id: 'a', grams: 10 }] });
  assert.deepEqual(recetaErrors(ok, byId, []), []);
  assert.match(recetaErrors(recetaFromLines({ id: 'n', nombre: 'N', lines: [{ food_id: 'rec', grams: 10 }] }), byId, []).join(), /es una receta \(no se anidan/);
  assert.match(recetaErrors({ ...ok, id: 'a' }, byId, []).join(), /ya es un alimento de tu documento/);
  assert.deepEqual(recetaErrors({ ...ok, id: 'rec' }, byId, []), []); // editar la receta que ya existe
  assert.match(recetaErrors(recetaFromLines({ id: 'n', nombre: 'N', lines: [{ food_id: 'nada', grams: 10 }] }), byId, []).join(), /"nada" no está en el catálogo/);
  assert.match(recetaErrors({ ...ok, nombre: 'x'.repeat(61) }, byId, []).join(), /más de 60/);
});

test('definiciones: las del repositorio + las del dispositivo (gana la del dispositivo); recetas.json exportado vale para el script', () => {
  const base = parseRecetas(readFile('../data/recetas.json')).recetas;
  const mia = { id: 'parrillada_verduras_hacendado', nombre: 'Parrillada (mía)', ingredientes: [{ food_id: 'calabacin', gramos: 50 }], actualizada: '2026-10-18T10:00:00.000Z' };
  const nueva = { id: 'lasana', nombre: 'Lasaña', alias: ['lasaña'], ingredientes: [{ food_id: 'leche_entera', gramos: 60 }] };
  const todas = mergeRecetas(base, [mia, nueva, { id: 'MAL', nombre: '', ingredientes: [] }]);
  assert.deepEqual(todas.map((r) => r.id), [...base.map((r) => r.id), 'lasana']);
  assert.equal(todas.find((r) => r.id === mia.id).nombre, 'Parrillada (mía)');
  const json = recetasToJSON(todas);
  assert.ok(!json.includes('actualizada'));
  const vuelta = parseRecetas(json);
  assert.deepEqual(vuelta.errores, []);
  assert.equal(vuelta.recetas.find((r) => r.id === 'ejemplo_arroz_con_huevo').ejemplo, true); // el ejemplo se conserva
  assert.deepEqual(upsertReceta([nueva], { ...nueva, nombre: 'L2' }).map((r) => r.nombre), ['L2']);
  const imp = mergeRecetasImport([nueva], [nueva, mia]);
  assert.deepEqual(imp.nuevas.map((r) => r.id), [mia.id]);
  assert.equal(cleanRecetas('no').length, 0);
});

test('copia de seguridad: lleva las recetas del dispositivo y al leerla se recuperan (las inválidas se ignoran)', () => {
  const r = { id: 'lasana', nombre: 'Lasaña', ingredientes: [{ food_id: 'a', gramos: 10 }] };
  const back = parseBackup(backupToJSON(buildBackup({ meals: [], recetas: [r, { id: 'x' }] })));
  assert.equal(back.ok, true);
  assert.deepEqual(back.recetas, [r]);
  assert.deepEqual(parseBackup(backupToJSON(buildBackup({ meals: [] }))).recetas, []);
});

// ---------- requisito: la actualización del catálogo publicado conserva lo creado en el dispositivo ----------
test('actualizar el catálogo publicado conserva los añadidos con IA (tipo usda_app) y las recetas creadas en la app: ni se borran ni son conflicto', () => {
  const publicadoText = readFile('./fixtures/alimentos_iniciales.csv');
  const base = parseFoodsCSV(publicadoText, { catalog }).foods;
  // En el dispositivo: un alimento de USDA añadido al estimar y una receta guardada desde la app.
  const est = createEstimate({
    result: { plato: 'lasaña', gramos: 300, total_estimado: false, ingredientes: [{ origen: 'usda', termino: 'Pasta, cooked', nombre: 'pasta cocida', estado: 'cocinado', gramos: 200 }, { origen: 'catalogo', food_id: 'aceite_oliva', nombre: 'aceite', gramos: 100 }] },
    texto: '300 g de lasaña', index: 0,
    porTermino: new Map([[claveTermino('Pasta, cooked'), { termino: 'Pasta, cooked', sugerido: 101, candidatos: [{ fdcId: 101 }] }]]),
  });
  const ficha = { fdcId: 101, descripcion: 'Pasta, cooked', tipo: 'SR Legacy', values: { energia_kcal: 158, proteina_g: 5.8 }, notas: [], fuente: 'Pasta, cooked (SR Legacy)', fortificacion: [], sospechosos: [], enriquecibles: [] };
  const { foods: conUsda, nuevos } = aplicarEstimacion(est, { foods: base, fichas: new Map([[101, ficha]]), fecha: '2026-10-18' });
  const conUsdaById = new Map(conUsda.map((f) => [f.id, f]));
  const receta = recetaFromLines({ id: 'lasana', nombre: 'Lasaña', alias: ['lasaña'], lines: [{ food_id: nuevos[0].id, grams: 200 }, { food_id: 'aceite_oliva', grams: 100 }] });
  const local = [...conUsda, recetaToFood(receta, computeReceta(receta, conUsdaById, keys))];
  const propios = ['pasta_cocida', 'lasana'];
  // El publicado cambia algo (un alias nuevo en el arroz) y no sabe nada de lo del dispositivo.
  const publicado = base.map((f) => (f.id === 'arroz_blanco_crudo' ? { ...f, alias: [...f.alias, 'arroz redondo'] } : f));
  for (const [nombre, b] of [['con base', base], ['sin base (instalación antigua)', null]]) {
    const p = planCatalogUpdate({ local, remote: publicado, base: b, catalog });
    assert.deepEqual(p.conflictos, [], nombre);
    assert.ok(p.actualizados.some((a) => a.id === 'arroz_blanco_crudo'), nombre);
    const final = applyChoices(p, publicado, {});
    for (const id of propios) assert.deepEqual(final.find((f) => f.id === id), local.find((f) => f.id === id), `${nombre}: ${id}`);
    if (b) {
      assert.deepEqual(p.propios.map((x) => x.id), propios, nombre);
      assert.deepEqual(p.retirados, [], nombre);
    } else assert.ok(p.propios.some((x) => x.id === 'pasta_cocida'), nombre); // sin base se reconoce por tipo=usda_app
  }
  // Y si después publico mi documento con esas filas (exportado e importado tal cual), tampoco hay conflictos.
  const extra = ['incluir', 'tipo', 'termino_busqueda_usda', 'fdc_id', 'fuente_usda', 'notas', 'pendiente_revisar', ...new Set(base.flatMap((f) => Object.keys(f.extra)))];
  const republicado = parseFoodsCSV(foodsToCSV(local, { catalog, extraHeaders: [...new Set(extra)] }), { catalog }).foods;
  const p2 = planCatalogUpdate({ local, remote: republicado, base, catalog });
  assert.deepEqual([p2.conflictos, p2.retirados, p2.propios, p2.hayCambios], [[], [], [], false]);
});

test('integración con objetivos: la copia lleva a la vez el plan de objetivos y las recetas, y se leen los dos', () => {
  const r = { id: 'lasana', nombre: 'Lasaña', ingredientes: [{ food_id: 'a', gramos: 10 }] };
  const plan = { version: 1, periodos: [] };
  const json = backupToJSON(buildBackup({ meals: [], plan, recetas: [r] }));
  const back = parseBackup(json);
  assert.equal(back.ok, true);
  assert.deepEqual(back.plan, plan);
  assert.deepEqual(back.recetas, [r]);
  assert.deepEqual(Object.keys(JSON.parse(json)).filter((k) => ['plan_objetivos', 'recetas'].includes(k)), ['plan_objetivos', 'recetas']);
});
