// Script de USDA (scripts/usda-lib.mjs): sin red ni clave; las respuestas de la API son simuladas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mapNutrients, usdaNutrients, coincidencia, suggest, sortCandidates, searchPlan, createUsdaClient, findCandidates,
  eleccionCSV, readEleccion, applyUsda, runCandidatos, runFilas, informeMarkdown, ELECCION_HEADER, FNDDS, searchQuery,
  fortificacion, valoresSospechosos, calorieFactors, preparacionesDeMas, toCandidate,
} from '../scripts/usda-lib.mjs';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { completenessReport } from '../frontend/js/core/completeness.js';
import { catalog, settings, readFile, realFoods, csv } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(readFile('../data/usda-map.json'));
const required = settings.requiredNutrients;
const threshold = settings.completenessThreshold;

// Número de USDA de cada columna obligatoria (para fabricar alimentos de prueba).
const NUM = Object.fromEntries(Object.entries(map.nutrientes).map(([k, s]) => [k, s]));
const nut = (n, value, unitName, shape = 'search') => (shape === 'search'
  ? { nutrientNumber: n, value, unitName }
  : { nutrient: { number: n, unitName }, amount: value });
// Alimento de USDA con los obligatorios indicados (todos por defecto), en forma de búsqueda o de detalle.
function usdaFood(fdcId, description, dataType, { keys = required, extra = [], shape = 'search' } = {}) {
  const foodNutrients = keys.map((k) => nut(NUM[k].n, 1, NUM[k].unidad === 'ug' ? 'UG' : NUM[k].unidad.toUpperCase(), shape));
  return { fdcId, description, dataType, foodNutrients: [...foodNutrients, ...extra.map(([n, v, u]) => nut(n, v, u, shape))] };
}

// ---------- mapeo ----------
test('usda-map.json cubre todas las columnas de nutrientes (omega3/omega6 sin mapear a propósito)', () => {
  const keys = JSON.parse(readFile('../data/nutrients.json')).map((n) => n.key);
  for (const k of keys) assert.ok(map.nutrientes[k] || map.sin_mapeo[k], k);
  assert.deepEqual(Object.keys(map.sin_mapeo).sort(), ['omega3_g', 'omega6_g']);
  for (const k of required) assert.ok(map.nutrientes[k], `obligatorio sin mapeo: ${k}`);
});

test('usdaNutrients acepta las formas de búsqueda, detalle y abreviada', () => {
  const f = { foodNutrients: [{ nutrientNumber: '203', value: 7, unitName: 'G' }, { nutrient: { number: '301', unitName: 'mg' }, amount: 28 }, { number: '320', amount: 0, unitName: 'µg' }] };
  const n = usdaNutrients(f);
  assert.deepEqual([n.get('203'), n.get('301'), n.get('320')], [{ value: 7, unit: 'g' }, { value: 28, unit: 'mg' }, { value: 0, unit: 'ug' }]);
});

test('mapeo directo: 0 es 0 real, lo ausente no se escribe, unidad distinta no se rellena', () => {
  const f = { foodNutrients: [nut('203', 7.13, 'G'), nut('418', 0, 'UG'), nut('301', 28, 'G')] };
  const m = mapNutrients(f, map);
  assert.equal(m.values.proteina_g, 7.13);
  assert.equal(m.values.vitamina_b12_ug, 0);
  assert.ok(!('calcio_mg' in m.values));
  assert.ok(!('hierro_mg' in m.values));
  assert.equal(m.unidades.length, 1);
  assert.match(m.unidades[0], /calcio_mg/);
});

test('las cuatro alternativas, anotadas; omega3/omega6 nunca se rellenan', () => {
  const m = mapNutrients({ foodNutrients: [nut('958', 360, 'KCAL'), nut('957', 355, 'KCAL'), nut('324', 40, 'IU'), nut('417', 20, 'UG'), nut('619', 0.05, 'G'), nut('851', 0.04, 'MG')] }, map);
  assert.equal(m.values.energia_kcal, 360); // 958 antes que 957
  assert.equal(m.values.vitamina_d_ug, 1); // 40 UI × 0,025
  assert.equal(m.values.vitamina_b9_ug, 20); // folato total, sin ácido fólico añadido
  assert.equal(m.values.ala_g, 0.05); // 851 viene en mg: no vale; se usa 619
  assert.equal(m.notas.length, 4);
  assert.ok(!('omega3_g' in m.values) && !('omega6_g' in m.values));
  // con el número principal presente no se usa la alternativa
  assert.equal(mapNutrients({ foodNutrients: [nut('208', 365, 'KCAL'), nut('958', 360, 'KCAL')] }, map).values.energia_kcal, 365);
  // folato total con ácido fólico añadido (> 0): no vale como DFE
  assert.ok(!('vitamina_b9_ug' in mapNutrients({ foodNutrients: [nut('417', 20, 'UG'), nut('431', 5, 'UG')] }, map).values));
  assert.equal(mapNutrients({ foodNutrients: [nut('417', 20, 'UG'), nut('431', 0, 'UG')] }, map).values.vitamina_b9_ug, 20);
});

// ---------- candidatos y sugerido ----------
const cand = (o) => ({ fdcId: 1, descripcion: 'x', tipo: 'SR Legacy', estimado: false, obligatorios: 0, total: 31, ratio: 0, coincidencia: 1, ...o });

test('orden por completitud sin distinguir Foundation de SR Legacy; FNDDS detrás', () => {
  const list = sortCandidates([cand({ fdcId: 1, tipo: 'Foundation', ratio: 0.5 }), cand({ fdcId: 2, ratio: 0.9 }), cand({ fdcId: 3, tipo: FNDDS, estimado: true, ratio: 1 })]);
  assert.deepEqual(list.map((c) => c.fdcId), [2, 1, 3]);
});

test('sugerido: Foundation/SR ≥ 80 %; si no, FNDDS (estimado); si no, el más completo; si no hay, sin candidatos', () => {
  assert.equal(suggest([cand({ fdcId: 1, ratio: 0.9, coincidencia: 0.5 }), cand({ fdcId: 2, ratio: 0.85, coincidencia: 1 }), cand({ fdcId: 3, estimado: true, ratio: 1 })], threshold).candidato.fdcId, 2);
  const e = suggest([cand({ fdcId: 1, ratio: 0.5 }), cand({ fdcId: 3, estimado: true, ratio: 1 })], threshold);
  assert.deepEqual([e.candidato.fdcId, e.estado], [3, 'completo_estimado']);
  const i = suggest([cand({ fdcId: 1, ratio: 0.5 }), cand({ fdcId: 2, ratio: 0.6 })], threshold);
  assert.deepEqual([i.candidato.fdcId, i.estado], [2, 'incompleto']);
  assert.deepEqual(suggest([], threshold), { candidato: null, estado: 'sin_candidatos', motivo: 'USDA no devolvió resultados para el término' });
});

test('coincidencia con el término: ignora mayúsculas y puntuación', () => {
  assert.equal(coincidencia('Milk, whole, 3.25% milkfat', 'Milk, whole, 3.25% milkfat, with added vitamin D'), 1);
  assert.ok(coincidencia('Milk, whole, 3.25% milkfat', 'Milk, dry, whole') < 1);
});

test('plan de búsqueda del documento real: omite incluir=no, sin término y recetas', () => {
  const plan = searchPlan(realFoods);
  const omit = (id) => plan.find((p) => p.food.id === id).omitido;
  assert.equal(omit('arroz_blanco_crudo'), null);
  assert.equal(omit('ron'), 'excluido (incluir=no)');
  assert.equal(plan.filter((p) => !p.omitido).length, 45);
});

// ---------- cliente HTTP simulado ----------
function fakeApi(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const data = handler(url, JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => data };
  };
  return { fetchImpl, calls };
}

test('cliente: clave en X-Api-Key (nunca en la URL ni en la caché) y caché en disco', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'usda-'));
  const api = fakeApi(() => ({ foods: [usdaFood(1, 'Rice, white, raw', 'SR Legacy')] }));
  const c = createUsdaClient({ apiKey: 'CLAVE-USDA-XYZ', fetchImpl: api.fetchImpl, cacheDir: dir });
  await c.search('rice', ['SR Legacy'], 10);
  await c.search('rice', ['SR Legacy'], 10); // de la caché
  assert.equal(c.calls, 1);
  assert.equal(api.calls[0].init.headers['X-Api-Key'], 'CLAVE-USDA-XYZ');
  assert.ok(!api.calls[0].url.includes('CLAVE'));
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(join(dir, f), 'utf8').includes('CLAVE'), f);
});

test('cliente: errores claros (clave rechazada, límite) sin mostrar la clave', async () => {
  for (const [status, re] of [[403, /USDA_API_KEY/], [429, /límite/]]) {
    const c = createUsdaClient({ apiKey: 'CLAVE-USDA-XYZ', fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
    await assert.rejects(c.search('x', ['SR Legacy'], 1), (e) => re.test(e.message) && !e.message.includes('CLAVE'));
  }
});

test('findCandidates: FNDDS solo si ningún Foundation/SR llega al umbral (llamadas solo las necesarias)', async () => {
  const completo = fakeApi(() => ({ foods: [usdaFood(1, 'Rice, white, raw', 'SR Legacy'), usdaFood(2, 'Rice, white, raw', 'Foundation', { keys: required.slice(0, 10) })] }));
  const c1 = createUsdaClient({ apiKey: 'k', fetchImpl: completo.fetchImpl });
  const r1 = await findCandidates(c1, 'Rice, white, raw', { map, required, threshold });
  assert.equal(c1.calls, 1);
  assert.deepEqual(completo.calls[0].body.dataType, ['Foundation', 'SR Legacy']);
  assert.deepEqual([r1.estado, r1.candidato.fdcId, r1.candidatos.map((c) => c.fdcId)], ['completo', 1, [1, 2]]);

  const pobre = fakeApi((url, body) => ({ foods: body.dataType.includes(FNDDS) ? [usdaFood(9, 'Rice, white, cooked', FNDDS)] : [usdaFood(2, 'Rice', 'Foundation', { keys: required.slice(0, 10) })] }));
  const c2 = createUsdaClient({ apiKey: 'k', fetchImpl: pobre.fetchImpl });
  const r2 = await findCandidates(c2, 'Rice', { map, required, threshold });
  assert.equal(c2.calls, 2);
  assert.deepEqual([r2.estado, r2.candidato.fdcId, r2.candidato.estimado], ['completo_estimado', 9, true]);
});

// ---------- eleccion.csv ----------
test('eleccion.csv: punto y coma + BOM para Excel; se lee con ; y con ,', () => {
  const text = eleccionCSV([{ id: 'arroz', nombre: 'Arroz; blanco', termino: 'Rice', estado: 'completo', candidato: cand({ fdcId: 7, descripcion: 'Rice, raw', obligatorios: 30 }), candidatos: [cand({ fdcId: 7 }), cand({ fdcId: 8, tipo: FNDDS, estimado: true })] }]);
  assert.ok(text.startsWith('﻿id;nombre;termino_busqueda_usda;fdcId;'));
  assert.ok(text.includes('"Arroz; blanco"'));
  assert.ok(text.includes('Survey (FNDDS) (estimado)'));
  assert.equal(text.split('\r\n')[0].split(';').length, ELECCION_HEADER.length);
  assert.deepEqual(readEleccion(text).elegidos, []); // fdcId vacío: aún no has elegido
  const conPuntoYComa = '﻿id;nombre;fdcId\r\narroz;Arroz;169756\r\nleche;Leche;\r\nhuevo;Huevo;abc\r\n';
  const conComa = 'id,nombre,fdcId\narroz,Arroz,169756\n';
  assert.deepEqual(readEleccion(conPuntoYComa), { elegidos: [{ id: 'arroz', fdcId: 169756, sinEnriquecer: false }], errores: ['huevo: fdcId "abc" no es un número'] });
  assert.deepEqual(readEleccion(conComa).elegidos, [{ id: 'arroz', fdcId: 169756, sinEnriquecer: false }]);
});

// ---------- filas propuestas ----------
const doc = () => parseFoodsCSV(csv('id,nombre,proteina_g,termino_busqueda_usda', 'arroz,Arroz,,Rice', 'leche,Leche,3.4,Milk', 'kiwi,Kiwi,,'), { catalog });

test('applyUsda: rellena solo celdas vacías (choques al informe), anota la fuente y no toca el original', () => {
  const { foods } = doc();
  const usda = new Map([[1, usdaFood(1, 'Rice, white, raw', 'SR Legacy', { shape: 'full' })], [2, usdaFood(2, 'Milk, whole', FNDDS, { shape: 'full', keys: ['proteina_g'] })]]);
  const r = applyUsda(foods, [{ id: 'arroz', fdcId: 1 }, { id: 'leche', fdcId: 2 }, { id: 'nada', fdcId: 3 }], usda, { map });
  const out = new Map(r.foods.map((f) => [f.id, f]));
  assert.equal(out.get('arroz').nutrients.proteina_g, 1);
  assert.equal(out.get('arroz').extra.fdc_id, '1');
  assert.equal(out.get('arroz').extra.fuente_usda, 'Rice, white, raw (SR Legacy)');
  assert.equal(out.get('leche').nutrients.proteina_g, 3.4); // se mantiene el tuyo
  assert.match(out.get('leche').extra.fuente_usda, /estimado/);
  assert.equal(r.resultado[1].choques.length, 1);
  assert.equal(r.resultado[2].error, 'id no está en el documento');
  assert.equal(foods.find((f) => f.id === 'arroz').nutrients.proteina_g, undefined); // el original intacto
  const s = applyUsda(foods, [{ id: 'leche', fdcId: 2 }], usda, { map, sobrescribir: true });
  assert.equal(s.foods.find((f) => f.id === 'leche').nutrients.proteina_g, 1);
});

test('flujo en lote: candidatos -> elección -> filas e informe', async () => {
  const { foods } = doc();
  const api = fakeApi((url, body) => (url.endsWith('/foods/search')
    ? { foods: body.query === 'Rice' ? [usdaFood(1, 'Rice, white, raw', 'SR Legacy')] : [usdaFood(2, 'Milk', 'Foundation', { keys: required.slice(0, 5) })] }
    : body.fdcIds.map((id) => usdaFood(id, id === 1 ? 'Rice, white, raw' : 'Milk', id === 1 ? 'SR Legacy' : 'Foundation', { shape: 'full', keys: id === 1 ? required : required.slice(0, 5) }))));
  const client = createUsdaClient({ apiKey: 'k', fetchImpl: api.fetchImpl });
  const c = await runCandidatos({ client, foods, map, required, threshold });
  assert.deepEqual(c.rows.map((r) => [r.id, r.estado]), [['arroz', 'completo'], ['leche', 'incompleto'], ['kiwi', 'omitido: sin termino_busqueda_usda']]);
  assert.equal(c.resumen.llamadas, 3); // arroz: 1; leche: 1 + FNDDS
  // Victor elige en Excel: arroz el sugerido, leche el incompleto
  const eleccion = eleccionCSV(c.rows).replace('arroz;Arroz;Rice;;', 'arroz;Arroz;Rice;1;').replace('leche;Leche;Milk;;', 'leche;Leche;Milk;2;');
  const f = await runFilas({ client, foods, eleccionText: eleccion, map });
  const report = completenessReport(f.propuestos, settings);
  assert.deepEqual(report.incomplete.map((p) => p.id), ['kiwi', 'leche']);
  const md = informeMarkdown({ report, resultado: f.resultado, plan: f.plan, elegidosIds: f.elegidosIds, labels: new Map(), fecha: '2026-10-17' });
  for (const s of ['Completos (≥ 80 % de 31 obligatorios): 1', '### arroz', '### leche', 'Faltan:', 'kiwi: 0/31 (0 %) — sin datos de USDA', 'kiwi: sin termino_busqueda_usda']) assert.ok(md.includes(s), s);
});

test('CLI sin USDA_API_KEY: mensaje claro con el nombre de la variable', () => {
  const env = { ...process.env };
  delete env.USDA_API_KEY;
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'usda.mjs'), 'candidatos'], { cwd: root, encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Falta la variable USDA_API_KEY/);
  assert.match(r.stderr, /--env-file=\.env/);
});

test('eleccion.csv explica el sugerido: completitud y parecido al término', () => {
  const s = suggest([cand({ fdcId: 1, ratio: 1, obligatorios: 31, coincidencia: 0.5 }), cand({ fdcId: 2, ratio: 0.9, obligatorios: 28, coincidencia: 1 })], threshold);
  assert.equal(s.motivo, 'Foundation/SR Legacy ≥ 80 % (el más parecido al término, 100 %): completitud 28/31 (90 %), parecido al término 100 %');
  assert.match(suggest([cand({ ratio: 0.5, obligatorios: 15 })], threshold).motivo, /ninguno llega al 80 %.*; el más completo/);
  const text = eleccionCSV([{ id: 'a', nombre: 'A', termino: 't', estado: s.estado, motivo: s.motivo, candidato: s.candidato, candidatos: [s.candidato] }]);
  const [head, row] = text.replace(/^﻿/, '').split('\r\n').map((l) => l.split(';'));
  const at = (name) => row[head.indexOf(name)];
  assert.deepEqual([at('sugerido'), at('sugerido_obligatorios'), at('sugerido_parecido'), at('c1_parecido')], ['2', '28/31', '100 %', '100 %']);
  assert.equal(at('motivo_sugerido'), s.motivo);
});

// Regresión de la primera ejecución real: la chía (incompleta) se cambiaba por sésamo (completo).
test('sugerido: primero el parecido; nunca otro alimento completo en lugar del correcto incompleto', async () => {
  const termino = 'Seeds, chia seeds, dried';
  const api = fakeApi((url, body) => ({ foods: body.dataType.includes(FNDDS) ? [] : [
    usdaFood(1, 'Seeds, sesame seeds, whole, dried', 'SR Legacy'),
    usdaFood(2, 'Seeds, chia seeds, dried', 'SR Legacy', { keys: required.slice(0, 20) }),
    ...[3, 4, 5, 6, 7].map((id) => usdaFood(id, `Seeds, other ${id}, dried`, 'SR Legacy')),
  ] }));
  const client = createUsdaClient({ apiKey: 'k', fetchImpl: api.fetchImpl });
  const r = await findCandidates(client, termino, { map, required, threshold });
  assert.deepEqual([r.estado, r.candidato.fdcId], ['incompleto', 2]);
  assert.match(r.motivo, /ninguno llega al 80 %/);
  assert.ok(r.candidatos.some((c) => c.fdcId === 2)); // el sugerido aparece aunque no esté entre los 5 más completos
  assert.equal(r.candidatos.length, 5);
  assert.equal(client.calls, 2); // sin un parecido completo, también se mira FNDDS
});

test('la búsqueda quita los signos que USDA interpreta como sintaxis ("/" daba HTTP 400)', async () => {
  assert.equal(searchQuery('Sauce, pasta, spaghetti/marinara, ready-to-serve'), 'Sauce, pasta, spaghetti marinara, ready-to-serve');
  assert.equal(searchQuery('Cookies, butter (aprox.)'), 'Cookies, butter aprox.');
  const api = fakeApi(() => ({ foods: [usdaFood(1, 'Sauce, pasta, spaghetti/marinara, ready-to-serve', 'SR Legacy')] }));
  const r = await findCandidates(createUsdaClient({ apiKey: 'k', fetchImpl: api.fetchImpl }), 'Sauce, pasta, spaghetti/marinara, ready-to-serve', { map, required, threshold });
  assert.equal(api.calls[0].body.query, 'Sauce, pasta, spaghetti marinara, ready-to-serve');
  assert.equal(r.candidato.coincidencia, 1); // el parecido se mide con el término original
});

// Regresión de la primera ejecución real: "Ham, serrano" sugería "Peppers, serrano"; "commercial" no casaba con "commercially".
test('parecido: categoría de USDA (primera palabra) y palabras con el mismo comienzo', () => {
  assert.ok(coincidencia('Ham, serrano', 'Peppers, serrano, raw') < coincidencia('Ham, serrano', 'Ham, sliced, regular'));
  assert.equal(coincidencia('Bread, whole-wheat, commercial', 'Bread, whole-wheat, commercially prepared'), 1);
  assert.equal(coincidencia('Seeds, chia seeds, dried', 'Seeds, chia seeds, dried'), 1);
  assert.ok(coincidencia('Seeds, chia seeds, dried', 'Seeds, sesame seeds, whole, dried') < 1);
  assert.equal(coincidencia('Rice, white', 'Rice'), 0.5); // "white" no está; la categoría sí
  assert.ok(coincidencia('Apples, raw, with skin', 'Apples, raw, without skin') < 1); // "with" no es "without"
  const s = suggest([cand({ fdcId: 1, ratio: 1, coincidencia: coincidencia('Ham, serrano', 'Peppers, serrano, raw') }), cand({ fdcId: 2, ratio: 0.7, coincidencia: coincidencia('Ham, serrano', 'Ham, sliced, regular') })], threshold);
  assert.deepEqual([s.candidato.fdcId, s.estado], [2, 'incompleto']);
});

// ---------- Fortificación de EE. UU. y valores imposibles ----------
test('sin_enriquecer=si: B9, B1, B2, B3 y hierro quedan vacíos y se anota (mejor sin dato que inflado)', () => {
  const { foods } = doc();
  const usda = new Map([[1, usdaFood(1, 'Bread, white, commercially prepared', 'SR Legacy', { shape: 'full', extra: [['431', 86, 'UG']] })]]);
  const r = applyUsda(foods, [{ id: 'arroz', fdcId: 1, sinEnriquecer: true }], usda, { map });
  const n = r.foods.find((f) => f.id === 'arroz').nutrients;
  for (const k of map.enriquecimiento.columnas) assert.ok(!(k in n), k);
  assert.equal(n.proteina_g, 1);
  assert.deepEqual(r.resultado[0].vaciados, map.enriquecimiento.columnas);
  assert.match(r.foods.find((f) => f.id === 'arroz').extra.fuente_usda, /sin enriquecer: vacíos vitamina_b9_ug/);
  assert.deepEqual(r.resultado[0].fortificacion, ['ácido fólico añadido (431) = 86 µg']);
  // sin la marca, se rellenan como siempre
  assert.equal(applyUsda(foods, [{ id: 'arroz', fdcId: 1 }], usda, { map }).foods.find((f) => f.id === 'arroz').nutrients.hierro_mg, 1);
});

test('aviso de fortificación: enriched / fortified / with added / ácido fólico > 0; no "unenriched" ni "without added"', () => {
  const f = (description, folico) => fortificacion({ description, foodNutrients: folico === undefined ? [] : [nut('431', folico, 'UG')] });
  assert.deepEqual(f('Cookies, butter, commercially prepared, enriched'), ['la descripción dice "enriched"']);
  assert.deepEqual(f('Milk, whole, 3.25% milkfat, with added vitamin D'), ['la descripción dice "with added"']);
  assert.deepEqual(f('Cereals, fortified'), ['la descripción dice "fortified"']);
  assert.deepEqual(f('Cereals ready-to-eat, RALSTON Corn Flakes', 300), ['ácido fólico añadido (431) = 300 µg']);
  for (const d of ['Cookies, butter, commercially prepared, unenriched', 'Milk, whole, 3.25% milkfat, without added vitamin A and vitamin D']) assert.deepEqual(f(d, 0), [], d);
});

test('valores sospechosos: g > 100, kcal fuera de rango, macros > 100 g, fibra/azúcares > hidratos, energía incoherente', () => {
  assert.deepEqual(valoresSospechosos({ energia_kcal: 365, proteina_g: 7.13, grasa_total_g: 0.66, hidratos_g: 80, fibra_g: 1.3, agua_g: 11.6 }), []); // arroz
  assert.deepEqual(valoresSospechosos({ energia_kcal: 884, grasa_total_g: 100, proteina_g: 0, hidratos_g: 0, grasas_saturadas_g: 13.8, grasas_monoinsaturadas_g: 73, grasas_poliinsaturadas_g: 10.5 }), []); // aceite
  const malo = valoresSospechosos({ energia_kcal: 1200, proteina_g: 120, grasa_total_g: 5, hidratos_g: 3, fibra_g: 4, azucares_g: 6 });
  for (const re of [/proteina_g = 120/, /fuera de 0–900/, /> 100 g\)$/, /fibra/, /azúcares/]) assert.ok(malo.some((x) => re.test(x)), re);
  assert.ok(valoresSospechosos({ energia_kcal: 100, proteina_g: 20, grasa_total_g: 20, hidratos_g: 20 }).some((x) => /los macros dan/.test(x)));
});

test('candidatos conserva las elecciones previas (fdcId y sin_enriquecer) al regenerar eleccion.csv', () => {
  const rows = [{ id: 'arroz', nombre: 'Arroz', termino: 'Rice', estado: 'completo', candidato: cand({ fdcId: 7 }), candidatos: [] }, { id: 'pan', nombre: 'Pan', termino: 'Bread', estado: 'completo', candidato: cand({ fdcId: 8 }), candidatos: [] }];
  const text = eleccionCSV(rows, [{ id: 'pan', fdcId: 174924, sinEnriquecer: true }]);
  assert.deepEqual(readEleccion(text).elegidos, [{ id: 'pan', fdcId: 174924, sinEnriquecer: true }]);
});

test('informe: secciones de fortificación y valores sospechosos', () => {
  const { foods } = doc();
  const usda = new Map([[1, usdaFood(1, 'Cookies, butter, enriched', 'SR Legacy', { shape: 'full' })]]);
  const r = applyUsda(foods, [{ id: 'arroz', fdcId: 1, sinEnriquecer: true }], usda, { map });
  const md = informeMarkdown({ report: completenessReport(r.foods, settings), resultado: r.resultado, plan: searchPlan(foods), elegidosIds: new Set(['arroz']), labels: new Map(), fecha: 'hoy' });
  assert.match(md, /## Avisos de fortificación[\s\S]*- arroz \(fdcId 1, Cookies, butter, enriched\): la descripción dice "enriched" — vaciados: vitamina_b9_ug/);
  assert.match(md, /## Valores sospechosos/);
});

// Regresiones de la ejecución real de "filas".
test('fortificación: "not fortified" no avisa; cereal con B1/hierro imposibles sin fortificar sí (aunque falte el 431)', () => {
  assert.deepEqual(fortificacion({ description: 'Cereals, oats, regular and quick, not fortified, dry', foodNutrients: [nut('404', 0.46, 'MG'), nut('303', 4.25, 'MG')] }), []);
  const corn = fortificacion({ description: 'Cereals ready-to-eat, RALSTON Corn Flakes', foodNutrients: [nut('404', 4.483, 'MG'), nut('303', 19.4, 'MG')] });
  assert.equal(corn.length, 2);
  assert.match(corn[0], /B1 = 4.483 mg/);
  // fuera de cereales, un hierro alto es natural (cacao)
  assert.deepEqual(fortificacion({ description: 'Cocoa, dry powder, unsweetened', foodNutrients: [nut('303', 13.86, 'MG')] }), []);
});

test('energía: se usan los factores calóricos propios del alimento (cacao 228 kcal no es sospechoso)', () => {
  const cacao = { energia_kcal: 228, proteina_g: 19.6, grasa_total_g: 13.7, hidratos_g: 57.9, fibra_g: 37 };
  assert.equal(valoresSospechosos(cacao).length, 1); // con Atwater general sí lo parecería
  const usda = { nutrientConversionFactors: [{ type: '.CalorieConversionFactor', proteinValue: 1.83, fatValue: 8.37, carbohydrateValue: 1.33 }] };
  assert.deepEqual(calorieFactors(usda), { p: 1.83, g: 8.37, h: 1.33 });
  assert.deepEqual(valoresSospechosos(cacao, calorieFactors(usda)), []);
});

test('filas se salta los alimentos que no se buscan (sin término, recetas, incluir=no) aunque tengan fdcId', async () => {
  const foods = parseFoodsCSV(csv('id,nombre,proteina_g,termino_busqueda_usda,incluir', 'arroz,Arroz,,Rice,si', 'chorizo,Chorizo,24,,si', 'ron,Ron,,Rum,no'), { catalog }).foods;
  const api = fakeApi((url, body) => body.fdcIds.map((id) => usdaFood(id, `x${id}`, 'SR Legacy', { shape: 'full' })));
  const client = createUsdaClient({ apiKey: 'k', fetchImpl: api.fetchImpl });
  const eleccion = 'id;fdcId\narroz;1\nchorizo;2\nron;3\n';
  const r = await runFilas({ client, foods, eleccionText: eleccion, map, sobrescribir: true });
  assert.deepEqual(api.calls[0].body.fdcIds, [1]);
  assert.equal(r.propuestos.find((f) => f.id === 'chorizo').nutrients.proteina_g, 24); // no se pisa (datos de BEDCA o etiqueta)
  assert.deepEqual(r.errores, ['chorizo: no se aplica el fdcId 2 porque el alimento no se busca en USDA (sin termino_busqueda_usda)', 'ron: no se aplica el fdcId 3 porque el alimento no se busca en USDA (excluido (incluir=no))']);
});

// Prueba real (paella): para "Mollusks, squid, mixed species, cooked" se sugería el calamar FRITO (más completo), que
// tiene mucha más grasa y kcal. Las preparaciones que el término no pide reducen el parecido a la mitad.
test('sugerido: una preparación que el término no pide (fried, breaded, battered, with sauce, canned...) no se sugiere', () => {
  const ctx = (termino) => ({ termino, map, required });
  const termino = 'Mollusks, squid, mixed species, cooked';
  const frito = usdaFood(1, 'Mollusks, squid, mixed species, cooked, fried', 'SR Legacy');
  const crudo = usdaFood(2, 'Mollusks, squid, mixed species, raw', 'SR Legacy', { keys: required.slice(0, 26) });
  const cands = [frito, crudo].map((f) => toCandidate(f, ctx(termino)));
  assert.deepEqual(cands[0].preparaciones, ['fried']);
  assert.ok(cands[0].coincidencia < cands[1].coincidencia);
  assert.equal(suggest(cands, threshold).candidato.fdcId, 2); // nunca el frito para "cooked"
  // si el término sí lo pide, el frito vale
  const pedido = [frito, crudo].map((f) => toCandidate(f, ctx('Squid, cooked, fried')));
  assert.deepEqual(pedido[0].preparaciones, []);
  assert.equal(suggest(pedido, threshold).candidato.fdcId, 1);
  assert.deepEqual(preparacionesDeMas('Chicken, breast, cooked', 'Chicken, breast, meat only, breaded, baked or fried'), ['fried', 'breaded']);
  assert.deepEqual(preparacionesDeMas('Fish, tuna', 'Fish, tuna, light, canned in oil, drained solids'), ['canned', 'in oil']);
  assert.deepEqual(preparacionesDeMas('Fish, tuna, light, canned in oil', 'Fish, tuna, light, canned in oil, drained solids'), []);
  assert.deepEqual(preparacionesDeMas('Pasta, cooked', 'Pasta with meatballs in tomato sauce, canned'), ['canned']);
  assert.deepEqual(preparacionesDeMas('Beef, cooked', 'Beef, sliced, with gravy'), ['with gravy']);
  assert.deepEqual(preparacionesDeMas('Shrimp, cooked', 'Crustaceans, shrimp, mixed species, cooked, breaded and fried'), ['fried', 'breaded']);
  assert.deepEqual(preparacionesDeMas('Rice, white, cooked', 'Rice, white, medium-grain, cooked, unenriched'), []);
});

test('--incluir-excluidos / --incluir id: los incluir=no se buscan y se rellenan sin activarlos (recetas)', async () => {
  const foods = parseFoodsCSV(csv('id,nombre,proteina_g,termino_busqueda_usda,incluir',
    'arroz,Arroz,,Rice,si', 'morro,Morro,,"Pork, ears",no', 'ron,Ron,,Rum,no', 'sin,Sin término,,,no', 'rec,Receta,,(receta: data/recetas.json),no'), { catalog }).foods;
  const motivo = (incluir) => Object.fromEntries(searchPlan(foods, { incluir }).map((p) => [p.food.id, p.omitido]));
  assert.deepEqual(motivo(undefined), { arroz: null, morro: 'excluido (incluir=no)', ron: 'excluido (incluir=no)', sin: 'excluido (incluir=no)', rec: 'excluido (incluir=no)' });
  assert.equal(motivo(['morro']).morro, null);
  assert.equal(motivo(['morro']).ron, 'excluido (incluir=no)'); // solo ese id
  assert.deepEqual(motivo('todos'), { arroz: null, morro: null, ron: null, sin: 'sin termino_busqueda_usda', rec: 'receta por descomponer' }); // sin término o receta siguen omitidos
  const api = fakeApi((url, body) => (url.endsWith('/foods/search') ? { foods: [usdaFood(7, body.query, 'SR Legacy')] } : body.fdcIds.map((id) => usdaFood(id, `x${id}`, 'SR Legacy', { shape: 'full' }))));
  const client = createUsdaClient({ apiKey: 'k', fetchImpl: api.fetchImpl });
  const c = await runCandidatos({ client, foods, map, required, threshold, incluir: ['morro'] });
  assert.deepEqual(c.rows.map((r) => [r.id, r.estado.startsWith('omitido')]), [['arroz', false], ['morro', false], ['ron', true], ['sin', true], ['rec', true]]);
  const r = await runFilas({ client, foods, eleccionText: 'id;fdcId\nmorro;7\nron;8\n', map, incluir: ['morro'] });
  assert.equal(r.resultado.find((x) => x.id === 'morro').error, undefined);
  const morro = r.propuestos.find((f) => f.id === 'morro');
  assert.equal(morro.extra.fdc_id, '7');
  assert.equal(morro.extra.incluir, 'no'); // sigue excluido
  assert.deepEqual(r.errores, ['ron: no se aplica el fdcId 8 porque el alimento no se busca en USDA (excluido (incluir=no))']);
  // CLI: la opción se reconoce (sin clave, el script se detiene antes de red, pero no debe rechazar la opción)
  const sc = spawnSync(process.execPath, [join(root, 'scripts', 'usda.mjs'), 'filas', '--incluir', 'morro'], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, USDA_API_KEY: '' } });
  assert.match(sc.stderr, /Falta la variable USDA_API_KEY/);
});
