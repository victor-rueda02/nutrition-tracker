// «Estimar con IA»: validación en código de la respuesta (core/estimate-validate.js), estado de la pantalla de revisión
// (core/estimate.js) y caché de USDA en el dispositivo (core/usda-cache.js). Sin red: todo simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEstimate, checkEstimateStructure, gramosDichos, TOLERANCIA_SUMA } from '../frontend/js/core/estimate-validate.js';
import {
  createEstimate, sugerirDelDocumento, coincideConDocumento, preseleccionar, usarAlternativa, setIngGrams, setTotal, removeIng, chooseCandidate, setSinEnriquecer, useCatalog, addCatalogIng, setBusqueda, setReceta,
  validateEstimate, fdcIdsPendientes, aplicarEstimacion, nuevoAlimento, pendientesRevision, marcarRevisado, suma, TIPO_USDA_APP,
} from '../frontend/js/core/estimate.js';
import { claveTermino, emptyCache, putBusquedas, getBusqueda, buscarConCache, fichasConCache, cleanCache, MAX_BUSQUEDAS } from '../frontend/js/core/usda-cache.js';
import { resolveUnmatchedWithLines, createDraft, validateDraft, toMealRecord } from '../frontend/js/core/draft.js';
import { foodsToCSV, parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { realFoods, realList, catalog } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const ING = (o) => ({ food_id: null, termino_usda: null, nombre: 'x', estado: 'cocinado', gramos: 10, ...o });
const LASANA = {
  plato: 'lasaña', gramos_total: 300,
  ingredientes: [
    ING({ termino_usda: 'Pasta, cooked, unenriched, without added salt', nombre: 'pasta de lasaña cocida', gramos: 90 }),
    ING({ termino_usda: 'Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned', nombre: 'carne picada de ternera cocinada', gramos: 70 }),
    ING({ food_id: 'salsa_tomate_frito', nombre: 'tomate frito', estado: 'procesado', gramos: 50 }),
    ING({ food_id: 'leche_entera', nombre: 'leche', estado: 'procesado', gramos: 60 }),
    ING({ food_id: 'aceite_oliva', nombre: 'aceite', estado: 'procesado', gramos: 8 }),
    ING({ food_id: 'queso_tierno_loncha', nombre: 'queso', estado: 'procesado', gramos: 22 }),
  ],
};

// ---------- validación ----------
test('estructura: hace falta una lista de ingredientes no vacía (si no, el Worker reintenta)', () => {
  assert.equal(checkEstimateStructure(LASANA).ok, true);
  for (const d of [null, [], {}, { ingredientes: [] }, { ingredientes: 'x' }]) assert.equal(checkEstimateStructure(d).ok, false);
});

test('cantidad dicha en código: gramos, kg, "300 de" (asumido); "un plato" no dice cantidad', () => {
  assert.equal(gramosDichos('300 g de lasaña'), 300);
  assert.equal(gramosDichos('medio kilo de paella'), null); // no adivina palabras: vale la ración de la IA, marcada
  assert.equal(gramosDichos('0,4 kg de paella'), 400);
  assert.equal(gramosDichos('300 de lasaña'), 300);
  assert.equal(gramosDichos('un plato de paella'), null);
  assert.equal(gramosDichos('2 raciones de lasaña'), null);
});

test('respuesta buena: ingredientes del catálogo y de USDA; suma dentro del ±10 % sin tocar', () => {
  const r = normalizeEstimate(LASANA, realList, { texto: '300 g de lasaña' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.plato, r.gramos, r.total_estimado, r.ajustado], ['lasaña', 300, false, false]);
  assert.equal(r.ingredientes.length, 6);
  assert.deepEqual(r.ingredientes[0], { origen: 'usda', termino: 'Pasta, cooked, unenriched, without added salt', nombre: 'pasta de lasaña cocida', estado: 'cocinado', gramos: 90 });
  assert.deepEqual(r.ingredientes[2], { origen: 'catalogo', food_id: 'salsa_tomate_frito', nombre: 'tomate frito', gramos: 50 });
  assert.equal(r.ingredientes.reduce((a, i) => a + i.gramos, 0), 300);
  assert.deepEqual(r.warnings, []);
});

test('suma fuera del ±10 %: se reescala en proporción a lo dicho, con aviso', () => {
  const data = { ...LASANA, gramos_total: 300, ingredientes: LASANA.ingredientes.map((i) => ({ ...i, gramos: i.gramos * 2 })) }; // suman 600
  const r = normalizeEstimate(data, realList, { texto: '300 g de lasaña' });
  assert.equal(r.ajustado, true);
  assert.equal(r.ingredientes[0].gramos, 90);
  assert.ok(Math.abs(r.ingredientes.reduce((a, i) => a + i.gramos, 0) - 300) < 0.5);
  assert.match(r.warnings.join(' '), /sumaban 600 g y no 300 g: se han ajustado en proporción/);
  // en el límite (+10 %) no se toca
  const justo = normalizeEstimate({ gramos_total: 100, ingredientes: [ING({ food_id: 'huevo', gramos: 110 })] }, realList, { texto: '100 g de algo' });
  assert.deepEqual([justo.ajustado, justo.ingredientes[0].gramos], [false, 110]);
  assert.equal(TOLERANCIA_SUMA, 0.1);
});

test('lo que dice el código manda sobre el total de la IA; sin cantidad dicha, vale la ración de la IA (marcada)', () => {
  const r = normalizeEstimate({ ...LASANA, gramos_total: 450 }, realList, { texto: '300 g de lasaña' });
  assert.equal(r.gramos, 300);
  const p = normalizeEstimate({ plato: 'paella', gramos_total: 350, ingredientes: [ING({ termino_usda: 'Rice, white, medium-grain, cooked, unenriched', gramos: 200 }), ING({ food_id: 'aceite_oliva', gramos: 10 }), ING({ termino_usda: 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted', gramos: 140 })] }, realList, { texto: 'un plato de paella' });
  assert.deepEqual([p.gramos, p.total_estimado, p.ajustado], [350, true, false]);
  assert.match(p.warnings.join(' '), /ración estimada de 350 g/);
});

test('ids inexistentes, gramos no válidos, sin alimento ni término y repetidos', () => {
  const r = normalizeEstimate({ gramos_total: 200, ingredientes: [
    ING({ food_id: 'bechamel_inventada', termino_usda: 'Sauce, white, homemade', nombre: 'bechamel', gramos: 100 }), // id que no existe -> USDA
    ING({ food_id: 'otro_inventado', nombre: 'nada', gramos: 5 }), // sin término -> se quita
    ING({ food_id: 'huevo', gramos: 0 }), ING({ food_id: 'huevo', gramos: -3 }), ING({ food_id: 'huevo', gramos: 'mucho' }),
    ING({ nombre: 'sin nada', gramos: 4 }),
    ING({ food_id: 'aceite_oliva', gramos: 50 }), ING({ food_id: 'aceite_oliva', gramos: 50 }), // se suman
  ] }, realList, { texto: '200 g de canelones' });
  assert.deepEqual(r.ingredientes.map((i) => [i.origen, i.food_id ?? i.termino, i.gramos]), [['usda', 'Sauce, white, homemade', 100], ['catalogo', 'aceite_oliva', 100]]);
  assert.match(r.warnings.join('\n'), /"bechamel_inventada" no está en tu documento, se busca en USDA/);
  assert.match(r.warnings.join('\n'), /"otro_inventado" no está en tu documento, se quita/);
  assert.match(r.warnings.join('\n'), /gramos no válidos/);
  assert.equal(normalizeEstimate({ ingredientes: [ING({ food_id: 'inventado' })] }, realList, { texto: 'x' }).ok, false);
});

test('los excluidos (incluir=no) no están en la lista compacta: no valen como ingrediente del catálogo', () => {
  const excluido = realFoods.find((f) => f.extra?.incluir === 'no');
  const r = normalizeEstimate({ gramos_total: 100, ingredientes: [ING({ food_id: excluido.id, termino_usda: null, gramos: 100 })] }, realList, { texto: '100 g de x' });
  assert.equal(r.ok, false);
});

// ---------- caché del dispositivo ----------
const RES = (termino, fdcIds) => ({ termino, estado: 'completo', motivo: 'm', sugerido: fdcIds[0] ?? null, candidatos: fdcIds.map((fdcId) => ({ fdcId, descripcion: `d${fdcId}`, tipo: 'SR Legacy', obligatorios: 30, total: 31, coincidencia: 1, fortificacion: [] })) });
function fakeAi(resultados = {}, fichas = {}) {
  const calls = { search: [], foods: [] };
  return {
    calls,
    async usdaSearch({ terminos }) { calls.search.push(terminos); return { resultados: terminos.map((t) => resultados[t] ?? RES(t, [])) }; },
    async usdaFoods({ fdcIds }) { calls.foods.push(fdcIds); return { fichas: fdcIds.filter((id) => fichas[id]).map((id) => fichas[id]), faltan: fdcIds.filter((id) => !fichas[id]) }; },
  };
}

test('caché: solo se busca en USDA lo que no está guardado, en una sola petición; mismo término con otras mayúsculas = el mismo', async () => {
  const ai = fakeAi({ 'Pasta, cooked': RES('Pasta, cooked', [1, 2]), 'Beef, cooked': RES('Beef, cooked', [3]) });
  const r1 = await buscarConCache(ai, emptyCache(), ['Pasta, cooked', 'Beef, cooked', 'pasta, COOKED']);
  assert.deepEqual(ai.calls.search, [['Pasta, cooked', 'Beef, cooked']]);
  assert.equal(r1.consultados, 2);
  const r2 = await buscarConCache(ai, r1.cache, ['PASTA,  cooked', 'Beef, cooked']);
  assert.equal(ai.calls.search.length, 1); // nada nuevo
  assert.equal(r2.porTermino.get(claveTermino('Pasta, cooked')).sugerido, 1);
  assert.equal(claveTermino('Beef/veal (cooked)'), claveTermino('beef veal cooked'));
});

test('caché: fichas por fdcId; las que ya están no se piden; tamaño limitado y lo inválido se descarta', async () => {
  const ai = fakeAi({}, { 1: { fdcId: 1, values: { proteina_g: 5 } }, 2: { fdcId: 2, values: {} } });
  const a = await fichasConCache(ai, emptyCache(), [1, 2, 1]);
  assert.deepEqual(ai.calls.foods, [[1, 2]]);
  const b = await fichasConCache(ai, a.cache, [2, 3]);
  assert.deepEqual(ai.calls.foods, [[1, 2], [3]]);
  assert.deepEqual(b.faltan, [3]);
  assert.deepEqual([...b.fichas.keys()], [2]);
  let c = emptyCache();
  for (let i = 0; i < MAX_BUSQUEDAS + 5; i++) c = putBusquedas(c, [RES(`t${i}`, [i + 1])], new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
  assert.equal(Object.keys(c.busquedas).length, MAX_BUSQUEDAS);
  assert.equal(getBusqueda(c, 't0'), null); // las más antiguas fuera
  assert.deepEqual(cleanCache({ busquedas: { x: { at: 1 } }, fichas: 'no' }), emptyCache());
});

// ---------- pantalla de revisión ----------
const resultado = () => normalizeEstimate(LASANA, realList, { texto: '300 g de lasaña' });
const porTermino = new Map([
  [claveTermino('Pasta, cooked, unenriched, without added salt'), RES('Pasta, cooked, unenriched, without added salt', [101, 102])],
  [claveTermino('Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned'), RES('Beef, ground', [])],
]);
const nueva = () => createEstimate({ result: resultado(), texto: '300 g de lasaña', index: 0, porTermino });

test('revisión: candidatos y sugerido de USDA; sin candidatos no se puede confirmar hasta elegir', () => {
  const e = nueva();
  assert.equal(e.ings[0].fdcId, 101);
  assert.equal(e.ings[1].fdcId, null);
  assert.equal(e.receta.nombre, 'Lasaña');
  const v = validateEstimate(e, byId);
  assert.equal(v.ok, false);
  assert.deepEqual(v.problems, [{ key: 'i2', code: 'sin_alimento' }]);
  // «Buscar otro término» o «Usar uno de mi documento»
  const e2 = setBusqueda(e, 'i2', 'Beef, ground, cooked', RES('Beef, ground, cooked', [201]));
  assert.deepEqual([e2.ings[1].termino, e2.ings[1].fdcId], ['Beef, ground, cooked', 201]);
  assert.equal(validateEstimate(e2, byId).ok, true);
  const e3 = useCatalog(e, 'i2', byId.get('solomillo_ternera'));
  assert.deepEqual([e3.ings[1].origen, e3.ings[1].food_id, e3.ings[1].gramos], ['catalogo', 'solomillo_ternera', 70]);
  assert.equal(validateEstimate(e3, byId).ok, true);
});

test('sugerencia del documento: un ingrediente de USDA que nombra un alimento tuyo (prueba real: leche entera a USDA)', () => {
  const s = (nombre, estado = 'procesado') => sugerirDelDocumento({ nombre, estado }, realFoods);
  assert.equal(s('leche entera'), 'leche_entera');
  assert.equal(s('queso tierno rallado'), 'queso_tierno_loncha');
  assert.equal(s('pechuga de pollo cocinada', 'cocinado'), null); // la tuya es cruda (peso en crudo): no vale cocinada
  assert.equal(s('carne picada cocinada', 'cocinado'), null);
  assert.equal(sugerirDelDocumento({ nombre: 'carne picada cocinada', estado: 'cocinado', termino: 'Beef, ground, cooked, pan-browned' }, realFoods), null); // nunca por el término en inglés
  assert.equal(s('pasta de lasaña cocida', 'cocinado'), null); // pasta seca no vale para pasta cocida
  assert.equal(s('ron', 'procesado'), null); // excluido (incluir=no)
  const e = createEstimate({ result: { plato: 'x', gramos: 100, ingredientes: [{ origen: 'usda', termino: 'Milk, whole', nombre: 'leche entera', estado: 'procesado', gramos: 100 }] }, texto: 'x', index: 0, foods: realFoods });
  assert.equal(e.ings[0].sugerido, 'leche_entera');
  assert.equal(e.ings[0].origen, 'usda'); // solo se sugiere: no cambia hasta que lo toques
});

test('preselección: solo si el nombre o el término ES el nombre o un alias tuyo y el estado casa (nada de "pan-browned" -> pan)', () => {
  const c = (nombre, estado, termino = '') => coincideConDocumento({ nombre, estado, termino }, realFoods);
  assert.equal(c('leche entera', 'procesado', 'Milk, whole, 3.25% milkfat'), 'leche_entera');
  assert.equal(c('Leches enteras', 'procesado'), 'leche_entera'); // sin acentos, mayúsculas ni plurales
  assert.equal(c('leche', 'procesado'), 'leche_entera'); // alias
  assert.equal(c('queso mozzarella', 'procesado', 'Cheese, mozzarella'), null); // otro queso: solo sugerencia
  assert.equal(c('carne picada cocinada', 'cocinado', 'Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned'), null);
  assert.equal(c('pasta', 'cocinado', 'Pasta, cooked'), null); // tu pasta es seca: no vale para pasta cocida
  assert.equal(c('pechuga de pollo', 'cocinado'), null); // la tuya se pesa en crudo
  assert.equal(c('aceite de oliva', 'procesado', 'Oil, olive'), 'aceite_oliva');
  const r = preseleccionar({ plato: 'x', gramos: 100, ingredientes: [
    { origen: 'usda', termino: 'Milk, whole', nombre: 'leche entera', estado: 'procesado', gramos: 60 },
    { origen: 'usda', termino: 'Pasta, cooked', nombre: 'pasta', estado: 'cocinado', gramos: 40 }] }, realFoods);
  assert.deepEqual(r.ingredientes[0], { origen: 'catalogo', food_id: 'leche_entera', nombre: 'Leche entera', gramos: 60, alternativa: { termino: 'Milk, whole', nombre: 'leche entera', estado: 'procesado' } });
  assert.equal(r.ingredientes[1].origen, 'usda');
  // en la revisión, «Usar USDA en su lugar» vuelve a USDA con los candidatos y deja el tuyo como sugerencia
  let e = createEstimate({ result: r, texto: 'x', index: 0, foods: realFoods });
  assert.deepEqual([e.ings[0].origen, e.ings[0].alternativa.termino], ['catalogo', 'Milk, whole']);
  e = usarAlternativa(e, 'i1', RES('Milk, whole', [301]));
  assert.deepEqual([e.ings[0].origen, e.ings[0].termino, e.ings[0].nombre, e.ings[0].fdcId, e.ings[0].sugerido, e.ings[0].gramos], ['usda', 'Milk, whole', 'leche entera', 301, 'leche_entera', 60]);
});

test('revisión: gramos editables, total que reescala, quitar y añadir; la suma fuera del ±10 % solo avisa', () => {
  let e = setBusqueda(nueva(), 'i2', 'Beef', RES('Beef', [201]));
  e = setIngGrams(e, 'i1', '');
  assert.deepEqual(validateEstimate(e, byId).problems, [{ key: 'i1', code: 'sin_gramos' }]);
  e = setIngGrams(e, 'i1', '90,5');
  assert.equal(e.ings[0].gramos, 90.5);
  e = setTotal(e, '600');
  assert.equal(e.gramos, 600);
  assert.ok(Math.abs(suma(e) - 600) < 0.5);
  e = removeIng(e, 'i6');
  const v = validateEstimate(e, byId);
  assert.equal(v.ok, true);
  e = addCatalogIng(e, byId.get('huevo'));
  assert.equal(validateEstimate(e, byId).ok, false); // sin gramos
  e = setIngGrams(e, e.ings.at(-1).key, '1000');
  const v2 = validateEstimate(e, byId);
  assert.deepEqual([v2.ok, v2.fueraDeRango], [true, true]);
  e = setReceta(e, { guardar: true, nombre: ' ' });
  assert.deepEqual(validateEstimate(e, byId).problems, [{ key: null, code: 'receta_sin_nombre' }]);
});

const FICHA = (fdcId, o = {}) => ({ fdcId, descripcion: `USDA ${fdcId}`, tipo: 'SR Legacy', estimado: false, values: { energia_kcal: 150, proteina_g: 5.8, vitamina_b1_mg: 0.02, hierro_mg: 0.5 }, notas: [], unidades: [], vaciados: [], fuente: `USDA ${fdcId} (SR Legacy)`, fortificacion: [], sospechosos: [], enriquecibles: ['vitamina_b1_mg', 'hierro_mg'], ...o });

test('confirmar: filas nuevas de USDA (incluir=si, tipo usda_app, pendiente de revisar) y líneas de la comida', () => {
  let e = setBusqueda(nueva(), 'i2', 'Beef', RES('Beef', [201]));
  e = setSinEnriquecer(e, 'i1', true);
  assert.deepEqual(fdcIdsPendientes(e, realFoods), [101, 201]);
  const fichas = new Map([[101, FICHA(101, { fortificacion: ['la descripción dice "enriched"'] })], [201, FICHA(201, { sospechosos: ['energia_kcal = 150, pero los macros dan ≈ 300 kcal'] })]]);
  const r = aplicarEstimacion(e, { foods: realFoods, fichas, fecha: '2026-10-18' });
  assert.equal(r.nuevos.length, 2);
  const [pasta, carne] = r.nuevos;
  assert.deepEqual([pasta.id, pasta.nombre, pasta.estado, pasta.grupo, pasta.varianteDefecto], ['pasta_de_lasana_cocida', 'pasta de lasaña cocida', 'cocinado', 'pasta_de_lasana_cocida', true]);
  assert.deepEqual(pasta.extra, {
    incluir: 'si', tipo: TIPO_USDA_APP, termino_busqueda_usda: 'Pasta, cooked, unenriched, without added salt', fdc_id: '101', pendiente_revisar: 'si',
    fuente_usda: 'USDA 101 (SR Legacy) · sin enriquecer: vacíos vitamina_b1_mg, hierro_mg (USDA está enriquecido)',
    notas: 'Añadido con «Estimar con IA» el 2026-10-18 (lasaña). Gramos del plato terminado.',
  });
  assert.deepEqual(pasta.nutrients, { energia_kcal: 150, proteina_g: 5.8 }); // sin enriquecer: B1 y hierro vacíos (sin dato, no 0)
  assert.equal(carne.nutrients.hierro_mg, 0.5);
  assert.deepEqual(r.lines, [
    { food_id: 'pasta_de_lasana_cocida', grams: 90 }, { food_id: carne.id, grams: 70 }, { food_id: 'salsa_tomate_frito', grams: 50 },
    { food_id: 'leche_entera', grams: 60 }, { food_id: 'aceite_oliva', grams: 8 }, { food_id: 'queso_tierno_loncha', grams: 22 }]);
  assert.match(r.avisos.join('\n'), /valor sospechoso/);
  assert.ok(!/enriquecido/.test(r.avisos.join('\n'))); // la pasta se marcó sin enriquecer: ya no avisa
  // el documento resultante se exporta y se vuelve a importar sin errores ni avisos de columnas desconocidas
  const extra = ['incluir', 'tipo', 'termino_busqueda_usda', 'fdc_id', 'fuente_usda', 'notas', 'pendiente_revisar'];
  const back = parseFoodsCSV(foodsToCSV(r.foods, { catalog, extraHeaders: extra }), { catalog });
  assert.equal(back.report.ok, true);
  assert.ok(!back.report.warnings.some((w) => /cabecera desconocida/.test(w.message)));
  assert.equal(back.foods.find((f) => f.id === 'pasta_de_lasana_cocida').extra.pendiente_revisar, 'si');
});

test('confirmar: un fdcId que ya está en el documento se reutiliza (no se duplica); dos ingredientes con el mismo, una fila', () => {
  const existente = { ...realFoods[0], id: 'pasta_cocida', nombre: 'Pasta cocida', extra: { fdc_id: '101' } };
  const foods = [...realFoods, existente];
  let e = setBusqueda(nueva(), 'i2', 'Pasta', RES('Pasta', [101]));
  assert.deepEqual(fdcIdsPendientes(e, foods), []);
  const r = aplicarEstimacion(e, { foods, fichas: new Map(), fecha: '2026-10-18' });
  assert.equal(r.nuevos.length, 0);
  assert.deepEqual(r.lines.slice(0, 2), [{ food_id: 'pasta_cocida', grams: 90 }, { food_id: 'pasta_cocida', grams: 70 }]);
  e = setBusqueda(nueva(), 'i2', 'Pasta', RES('Pasta', [101]));
  const r2 = aplicarEstimacion(e, { foods: realFoods, fichas: new Map([[101, FICHA(101)]]), fecha: '2026-10-18' });
  assert.equal(r2.nuevos.length, 1);
  assert.throws(() => aplicarEstimacion(chooseCandidate(e, 'i1', 999), { foods: realFoods, fichas: new Map([[101, FICHA(101)]]), fecha: 'x' }), /USDA no devolvió el alimento 999/);
});

test('id nuevo único aunque el nombre coincida con un id del documento', () => {
  const f = nuevoAlimento({ nombre: 'Huevo', estado: 'cocinado', termino: 't', sinEnriquecer: false }, FICHA(5), { ids: new Set(['huevo', 'huevo_2']), fecha: 'f' });
  assert.equal(f.id, 'huevo_3');
});

test('pendientes de revisar: se listan y «Revisado» quita la marca', () => {
  const r = aplicarEstimacion(setBusqueda(nueva(), 'i2', 'B', RES('B', [201])), { foods: realFoods, fichas: new Map([[101, FICHA(101)], [201, FICHA(201)]]), fecha: 'f' });
  assert.equal(pendientesRevision(realFoods).length, 0);
  const p = pendientesRevision(r.foods);
  assert.equal(p.length, 2);
  const tras = marcarRevisado(r.foods, p[0].id);
  assert.deepEqual(pendientesRevision(tras).map((f) => f.id), [p[1].id]);
  assert.equal(tras.find((f) => f.id === p[0].id).extra.tipo, TIPO_USDA_APP);
});

test('borrador: la línea sin resolver pasa a las líneas de sus ingredientes, marcadas «estimado con IA», y se guardan', () => {
  let d = createDraft({ text: 'para comer 300 g de lasaña', meal: 'comida', result: { items: [], unmatched: [{ text: '300 g de lasaña', motivo: 'no_en_catalogo' }], warnings: [] }, foodsById: byId });
  d = resolveUnmatchedWithLines(d, 0, [{ food_id: 'aceite_oliva', grams: 8 }, { food_id: 'leche_entera', grams: 60 }]);
  assert.equal(d.unmatched.length, 0);
  assert.deepEqual(d.lines.map((l) => [l.food_id, l.grams, l.source_text, l.flags, l.confidence]), [['aceite_oliva', 8, '300 g de lasaña', ['estimado_ia'], 'estimado'], ['leche_entera', 60, '300 g de lasaña', ['estimado_ia'], 'estimado']]);
  assert.equal(validateDraft(d).ok, true);
  assert.equal(toMealRecord(d, { now: new Date('2026-10-18T12:00:00Z'), idGen: () => 'm1' }).lines.length, 2);
});

test('los módulos que carga la app no usan lookbehind en expresiones regulares (Safari antiguos no cargarían la app)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { dirname, join, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'js');
  const ficheros = ['core', 'ui', 'storage'].flatMap((d) => readdirSync(join(dir, d)).map((f) => join(dir, d, f))).concat([join(dir, 'main.js'), join(dir, 'ai-client.js')]);
  for (const f of ficheros.filter((x) => x.endsWith('.js'))) assert.ok(!/\(\?<[!=]/.test(readFileSync(f, 'utf8')), f);
});
