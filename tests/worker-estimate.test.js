// Worker: POST /estimate (Gemini simulado) y POST /usda/search y /usda/foods (USDA simulado). Sin red ni claves reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, MAX_TERMINOS } from '../worker/src/index.js';
import { createUsda } from '../worker/src/providers/usda.js';
import { ProviderError } from '../worker/src/providers/gemini.js';
import { ESTIMATE_SCHEMA, ESTIMATE_SYSTEM_PROMPT } from '../worker/src/prompt.js';
import { realList, settings, readFile } from './helpers.js';

const ORIGIN = 'https://victor.github.io';
const env = { APP_TOKEN: 'tok-123', ALLOWED_ORIGIN: ORIGIN, GEMINI_MODEL: 'modelo-de-prueba', GEMINI_API_KEY: 'CLAVE-GEMINI', USDA_API_KEY: 'CLAVE-USDA-XYZ' };
const map = JSON.parse(readFile('../data/usda-map.json'));
const required = settings.requiredNutrients;

const req = (path, body, { token = 'tok-123', origin = ORIGIN } = {}) => new Request(`https://worker.example${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(token ? { 'X-App-Token': token } : {}) }, body: JSON.stringify(body),
});
const model = (...outputs) => { const calls = []; const fn = async (e, args) => { calls.push(args); const o = outputs[Math.min(calls.length - 1, outputs.length - 1)]; if (o instanceof Error) throw o; return o; }; fn.calls = calls; return fn; };

const ESTIMATE = JSON.stringify({ plato: 'lasaña', gramos_total: 300, ingredientes: [
  { food_id: null, termino_usda: 'Pasta, cooked, unenriched, without added salt', nombre: 'pasta cocida', estado: 'cocinado', gramos: 120 },
  { food_id: 'salsa_tomate_frito', termino_usda: null, nombre: 'tomate frito', estado: 'procesado', gramos: 80 },
  { food_id: 'queso_tierno_loncha', termino_usda: null, nombre: 'queso', estado: 'procesado', gramos: 100 },
] });

test('/estimate: una llamada a Gemini con el prompt de estimar; devuelve ingredientes validados en código', async () => {
  const cm = model(ESTIMATE);
  const res = await handleRequest(req('/estimate', { texto: '300 g de lasaña', alimentos: realList }), env, { callModel: cm });
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(res.status, 200);
  assert.equal(cm.calls.length, 1);
  assert.equal(cm.calls[0].system, ESTIMATE_SYSTEM_PROMPT);
  assert.equal(cm.calls[0].schema, ESTIMATE_SCHEMA);
  assert.match(cm.calls[0].user, /PLATO DICTADO:\n300 g de lasaña/);
  assert.ok(!cm.calls[0].user.includes('nutrients') && !cm.calls[0].user.includes('energia_kcal')); // nunca nutrientes
  assert.deepEqual([body.plato, body.gramos, body.total_estimado, body.attempts], ['lasaña', 300, false, 1]);
  assert.deepEqual(body.ingredientes.map((i) => i.origen), ['usda', 'catalogo', 'catalogo']);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.ok(!text.includes('CLAVE'));
});

test('/estimate: el prompt pide gramos del plato terminado, catálogo solo en el mismo estado y términos de USDA; nunca nutrientes', () => {
  assert.match(ESTIMATE_SYSTEM_PROMPT, /NO calculas calorías ni nutrientes/);
  assert.match(ESTIMATE_SYSTEM_PROMPT, /plato TERMINADO/);
  assert.match(ESTIMATE_SYSTEM_PROMPT, /"peso_en_crudo": true NO sirve/);
  assert.match(ESTIMATE_SYSTEM_PROMPT, /CATÁLOGO PRIMERO/); // prueba real: pedía la leche entera a USDA teniéndola en el catálogo
  assert.match(ESTIMATE_SYSTEM_PROMPT, /nunca les subas los gramos/); // prueba real: azafrán a 5 g para no quitarlo
  assert.match(ESTIMATE_SYSTEM_PROMPT, /unenriched/);
  assert.match(ESTIMATE_SYSTEM_PROMPT, /pechuga ≠ muslo, pollo ≠ pavo/);
  assert.deepEqual(ESTIMATE_SCHEMA.properties.ingredientes.items.required, ['food_id', 'termino_usda', 'nombre', 'estado', 'gramos']);
});

test('/estimate: reintenta UNA vez si el JSON es inválido o no trae ingredientes válidos; después, 502', async () => {
  const cm = model('{roto', ESTIMATE);
  const ok = await handleRequest(req('/estimate', { texto: '300 g de lasaña', alimentos: realList }), env, { callModel: cm });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).attempts, 2);
  const malo = model(JSON.stringify({ plato: 'x', gramos_total: 1, ingredientes: [{ food_id: 'inventado', termino_usda: null, nombre: 'x', estado: 'crudo', gramos: 5 }] }));
  const r = await handleRequest(req('/estimate', { texto: '300 g de lasaña', alimentos: realList }), env, { callModel: malo });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, 'respuesta_invalida');
  assert.equal(malo.calls.length, 2); // nunca más de dos
});

test('/estimate: 429 de Gemini -> limite_de_uso; token, origen y entrada como en /parse', async () => {
  const r = await handleRequest(req('/estimate', { texto: 'x', alimentos: realList }), env, { callModel: model(new ProviderError(429, 'quota')) });
  assert.deepEqual([r.status, (await r.json()).error], [429, 'limite_de_uso']);
  const cm = model(ESTIMATE);
  assert.equal((await handleRequest(req('/estimate', { texto: 'x', alimentos: realList }, { token: 'otro' }), env, { callModel: cm })).status, 401);
  assert.equal((await handleRequest(req('/estimate', { texto: 'x', alimentos: realList }, { origin: 'https://malo.example' }), env, { callModel: cm })).status, 403);
  assert.equal((await handleRequest(req('/estimate', { texto: '', alimentos: realList }), env, { callModel: cm })).status, 400);
  assert.equal(cm.calls.length, 0);
});

// ---------- USDA simulado ----------
const NUM = map.nutrientes;
const nut = (n, value, unitName) => ({ nutrientNumber: n, value, unitName });
function usdaFood(fdcId, description, dataType, { keys = required, extra = [], shape = 'search' } = {}) {
  const ns = [...keys.map((k) => [NUM[k].n, 1, NUM[k].unidad === 'ug' ? 'UG' : NUM[k].unidad.toUpperCase()]), ...extra];
  return { fdcId, description, dataType, foodNutrients: ns.map(([n, v, u]) => (shape === 'search' ? nut(n, v, u) : { nutrient: { number: n, unitName: u }, amount: v })) };
}
function fakeUsda(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => handler(url, JSON.parse(init.body)) }; };
  return { calls, usdaClient: (e) => createUsda(e, fetchImpl) };
}

test('/usda/search: solo Foundation y SR Legacy, una búsqueda por término (sin FNDDS); a USDA solo viaja el término', async () => {
  const api = fakeUsda((url, body) => ({ foods: body.query.startsWith('Pasta')
    ? [usdaFood(1, 'Pasta, cooked, unenriched, without added salt', 'SR Legacy'), usdaFood(2, 'Pasta, cooked, enriched, without added salt', 'SR Legacy', { extra: [['431', 86, 'UG']] })]
    : [usdaFood(3, 'Beef, ground, cooked', 'Foundation', { keys: required.slice(0, 5) })] }));
  const res = await handleRequest(req('/usda/search', { terminos: ['Pasta, cooked, unenriched, without added salt', 'Beef, ground, cooked', 'beef, ground, COOKED'] }), env, { usdaClient: api.usdaClient });
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(res.status, 200);
  assert.equal(api.calls.length, 2); // el tercero repite el segundo
  for (const c of api.calls) {
    assert.deepEqual(Object.keys(c.body).sort(), ['dataType', 'pageSize', 'query']);
    assert.deepEqual(c.body.dataType, ['Foundation', 'SR Legacy']);
    assert.equal(c.init.headers['X-Api-Key'], 'CLAVE-USDA-XYZ');
    assert.ok(!c.url.includes('CLAVE'));
  }
  assert.ok(!text.includes('CLAVE'));
  // un salto de línea pegado en el secreto no llega a USDA
  const conSalto = fakeUsda(() => ({ foods: [] }));
  const conSaltoEnv = { ...env, USDA_API_KEY: `CLAVE-USDA-XYZ${String.fromCharCode(13, 10)}` };
  await handleRequest(req('/usda/search', { terminos: ['x'] }), conSaltoEnv, { usdaClient: conSalto.usdaClient });
  assert.equal(conSalto.calls[0].init.headers['X-Api-Key'], 'CLAVE-USDA-XYZ');
  const [pasta, beef] = body.resultados;
  assert.equal(pasta.sugerido, 1);
  assert.deepEqual(pasta.candidatos.map((c) => [c.fdcId, c.obligatorios, c.total]), [[1, 31, 31], [2, 31, 31]]);
  assert.deepEqual(pasta.candidatos[1].fortificacion, ['la descripción dice "enriched"', 'ácido fólico añadido (431) = 86 µg']);
  assert.deepEqual(pasta.candidatos[0].preparaciones, []);
  assert.equal(beef.estado, 'incompleto');
  assert.equal(beef.sugerido, 3);
});

test('/usda/search y /usda/foods: sin USDA_API_KEY -> usda_sin_configurar; 429 de USDA -> limite_usda; clave rechazada -> usda_clave', async () => {
  const sin = await handleRequest(req('/usda/search', { terminos: ['x'] }), { ...env, USDA_API_KEY: '' });
  assert.deepEqual([sin.status, (await sin.json()).error], [500, 'usda_sin_configurar']);
  for (const [status, esperado, code] of [[429, 429, 'limite_usda'], [403, 502, 'usda_clave'], [500, 502, 'usda']]) {
    const usdaClient = (e) => createUsda(e, async () => ({ ok: false, status, json: async () => ({}) }));
    const r = await handleRequest(req('/usda/search', { terminos: ['x'] }), env, { usdaClient });
    const t = await r.text();
    assert.deepEqual([r.status, JSON.parse(t).error], [esperado, code]);
    assert.ok(!t.includes('CLAVE'));
  }
  assert.equal((await handleRequest(req('/usda/foods', { fdcIds: [1] }, { token: 'otro' }), env)).status, 401);
});

test('/usda/search: términos inválidos o demasiados -> 400 sin llamar a USDA', async () => {
  const api = fakeUsda(() => ({ foods: [] }));
  for (const terminos of [[], [''], ['x'.repeat(151)], Array.from({ length: MAX_TERMINOS + 1 }, (_, i) => `t${i}`), 'pasta', [3]]) {
    assert.equal((await handleRequest(req('/usda/search', { terminos }), env, { usdaClient: api.usdaClient })).status, 400, JSON.stringify(terminos));
  }
  assert.equal(api.calls.length, 0);
});

test('/usda/foods: fichas con los valores mapeados por 100 g, fuente_usda y columnas que «sin enriquecer» vaciaría; una llamada', async () => {
  const api = fakeUsda((url, body) => body.fdcIds.filter((id) => id !== 9).map((id) => usdaFood(id, 'Pasta, cooked, enriched', 'SR Legacy', { shape: 'full', extra: [['431', 86, 'UG']] })));
  const res = await handleRequest(req('/usda/foods', { fdcIds: [1, 9, 1] }), env, { usdaClient: api.usdaClient });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0].body, { fdcIds: [1, 9], format: 'full' });
  assert.deepEqual(body.faltan, [9]);
  const [f] = body.fichas;
  assert.equal(f.fdcId, 1);
  assert.equal(f.values.proteina_g, 1);
  assert.equal(f.fuente, 'Pasta, cooked, enriched (SR Legacy)');
  assert.deepEqual(f.enriquecibles, map.enriquecimiento.columnas);
  assert.ok(f.fortificacion.length >= 1);
  for (const fdcIds of [[], [0], [1.5], ['1'], Array.from({ length: 21 }, (_, i) => i + 1)]) {
    assert.equal((await handleRequest(req('/usda/foods', { fdcIds }), env, { usdaClient: api.usdaClient })).status, 400);
  }
});

test('/parse sigue igual: mismo contrato y sin tocar USDA', async () => {
  const good = JSON.stringify({ items: [{ food_id: 'kiwi_verde', cantidad: 69, unidad: 'g', source_text: 'un kiwi', confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [] });
  const usdaClient = () => { throw new Error('no debe usar USDA'); };
  const r = await handleRequest(req('/parse', { texto: 'un kiwi', alimentos: realList }), env, { callModel: model(good), usdaClient });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['attempts', 'items', 'model', 'unmatched', 'warnings']);
});

test('/usda/search admite en una petición tantos términos como ingredientes puede tener una estimación', async () => {
  const { MAX_INGREDIENTES } = await import('../frontend/js/core/estimate-validate.js');
  assert.equal(MAX_TERMINOS, MAX_INGREDIENTES);
  const api = fakeUsda(() => ({ foods: [] }));
  const terminos = Array.from({ length: MAX_INGREDIENTES }, (_, i) => `t${i}`);
  assert.equal((await handleRequest(req('/usda/search', { terminos }), env, { usdaClient: api.usdaClient })).status, 200);
  assert.equal(api.calls.length, MAX_INGREDIENTES);
});
