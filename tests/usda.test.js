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
  eleccionCSV, readEleccion, applyUsda, runCandidatos, runFilas, informeMarkdown, ELECCION_HEADER, FNDDS,
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
  assert.deepEqual(suggest([], threshold), { candidato: null, estado: 'sin_candidatos' });
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
  assert.equal(plan.filter((p) => !p.omitido).length, 49);
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
  assert.deepEqual(readEleccion(conPuntoYComa), { elegidos: [{ id: 'arroz', fdcId: 169756 }], errores: ['huevo: fdcId "abc" no es un número'] });
  assert.deepEqual(readEleccion(conComa).elegidos, [{ id: 'arroz', fdcId: 169756 }]);
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
