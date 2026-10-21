// Worker y servidor local: POST /cenas («Más ideas» de ¿Qué ceno?). Gemini SIMULADO: nunca hay llamadas reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/src/index.js';
import { ProviderError } from '../worker/src/providers/gemini.js';
import { CENAS_SYSTEM_PROMPT, CENAS_SCHEMA, buildCenasPrompt } from '../worker/src/prompt.js';
import { createDevServer, RUTAS_WORKER } from '../scripts/dev-server.mjs';
import { createAiClient } from '../frontend/js/ai-client.js';
import { buildCompactList } from '../frontend/js/core/ai-contract.js';
import { realFoods } from './helpers.js';
import { foodSinDatos } from '../frontend/js/core/completeness.js';

const ORIGIN = 'https://victor.github.io';
const env = { APP_TOKEN: 'tok-123', ALLOWED_ORIGIN: ORIGIN, GEMINI_MODEL: 'modelo-de-prueba', GEMINI_API_KEY: 'CLAVE-GEMINI' };
const lista = buildCompactList(realFoods).filter((a) => !foodSinDatos(realFoods.find((f) => f.id === a.id)));
const req = (body, { token = 'tok-123', origin = ORIGIN } = {}) => new Request('https://worker.example/cenas', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(token ? { 'X-App-Token': token } : {}) }, body: JSON.stringify(body),
});
const model = (...outputs) => { const calls = []; const fn = async (e, args) => { calls.push(args); const o = outputs[Math.min(calls.length - 1, outputs.length - 1)]; if (o instanceof Error) throw o; return o; }; fn.calls = calls; return fn; };

const CENAS = JSON.stringify({ cenas: [
  { nombre: 'Salmón con arroz y calabacín', lineas: [{ id: 'salmon_atlantico', gramos: 150 }, { id: 'arroz_blanco_crudo', gramos: 80 }, { id: 'calabacin', gramos: 120 }, { id: 'yogur_griego_natural', gramos: 125 }] },
  { nombre: 'Con ids inventados', lineas: [{ id: 'lubina_a_la_sal', gramos: 200 }, { id: 'huevo', gramos: 100 }, { id: 'pasta_seca', gramos: -3 }] },
  { nombre: 'Sin proteína', lineas: [{ id: 'arroz_blanco_crudo', gramos: 100 }] },
] });
const cuerpo = { alimentos: lista, deficits: ['Fibra', 'Magnesio', 'Proteína'] };

test('/cenas: una llamada a Gemini con el prompt de cenas; respuesta validada en código (ids inventados y gramos fuera; los roles los comprueba la app)', async () => {
  const cm = model(CENAS);
  const res = await handleRequest(req(cuerpo), env, { callModel: cm });
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(res.status, 200);
  assert.equal(cm.calls.length, 1);
  assert.equal(cm.calls[0].system, CENAS_SYSTEM_PROMPT);
  assert.equal(cm.calls[0].schema, CENAS_SCHEMA);
  assert.equal(cm.calls[0].user, buildCenasPrompt(lista, ['Fibra', 'Magnesio', 'Proteína']));
  assert.match(cm.calls[0].user, /da preferencia a alimentos ricos en estos nutrientes: Fibra, Magnesio, Proteína\./);
  assert.deepEqual(body.cenas.map((c) => c.nombre), ['Salmón con arroz y calabacín', 'Con ids inventados', 'Sin proteína']); // «sin proteína» lo descarta la app (rol_cena)
  assert.deepEqual(body.cenas[1].lineas, [{ food_id: 'huevo', gramos: 100 }]); // sin el id inventado ni el gramo negativo
  assert.equal(body.attempts, 1);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.ok(!text.includes('CLAVE'));
  assert.match(CENAS_SYSTEM_PROMPT, /NO calcules calorías ni nutrientes/);
  assert.match(CENAS_SYSTEM_PROMPT, /SOLO "id" que existan en el catálogo/);
});

test('/cenas: al proveedor solo viajan la lista compacta y los nombres; nada más aunque el cliente lo envíe', async () => {
  const sucio = lista.map((f) => ({ ...f, nutrients: { proteina_g: 12.5 }, energia_kcal: 777, densidad: 9.87 }));
  const cm = model(CENAS);
  await handleRequest(req({ alimentos: sucio, deficits: ['Fibra'], diario: [{ dia: '2026-10-16' }], objetivos: { energia_kcal: 2500 }, fecha: '2026-10-16', consumido: 1400 }), env, { callModel: cm });
  const { user, system } = cm.calls[0];
  for (const leak of ['proteina_g', '12.5', '777', '9.87', 'densidad', 'nutrients', '2026-10-16', '2500', '1400', 'diario', 'CLAVE-GEMINI']) { assert.ok(!user.includes(leak), leak); assert.ok(!system.includes(leak), leak); }
  assert.ok(user.includes('"id":"salmon_atlantico"'));
  assert.ok(user.includes('Fibra'));
});

test('/cenas: deficits con números, demasiado largos, más de 8 o que no son una lista -> 400 sin llamar a Gemini', async () => {
  for (const deficits of [['Fibra 12 g'], ['Vitamina B12'], ['x'.repeat(41)], Array.from({ length: 9 }, (_, i) => `Nombre${String.fromCharCode(97 + i)}`), 'Fibra', [3], [''], [null], { a: 1 }]) {
    const cm = model(CENAS);
    const r = await handleRequest(req({ alimentos: lista, deficits }), env, { callModel: cm });
    assert.equal(r.status, 400, JSON.stringify(deficits));
    assert.equal((await r.json()).error, 'deficits_invalidos');
    assert.equal(cm.calls.length, 0);
  }
  // sin deficits es válido (no hay preferencia); alimentos inválidos -> 400
  assert.equal((await handleRequest(req({ alimentos: lista }), env, { callModel: model(CENAS) })).status, 200);
  assert.equal((await handleRequest(req({ alimentos: [], deficits: [] }), env, { callModel: model(CENAS) })).status, 400);
  assert.equal((await handleRequest(req({ deficits: [] }), env, { callModel: model(CENAS) })).status, 400);
});

test('/cenas: token, origen y errores de proveedor como en /parse y /estimate (429 y 5xx con su código; sin reintento ante 429)', async () => {
  assert.equal((await handleRequest(req(cuerpo, { token: 'otro' }), env, { callModel: model(CENAS) })).status, 401);
  assert.equal((await handleRequest(req(cuerpo, { origin: 'https://malo.example' }), env, { callModel: model(CENAS) })).status, 403);
  const c429 = model(new ProviderError(429, 'cuota agotada con CLAVE-GEMINI'));
  const r429 = await handleRequest(req(cuerpo), env, { callModel: c429 });
  const t429 = await r429.text();
  assert.deepEqual([r429.status, JSON.parse(t429).error], [429, 'limite_de_uso']);
  assert.equal(c429.calls.length, 1);
  assert.ok(!t429.includes('CLAVE'));
  const c404 = model(new ProviderError(404, 'no existe'));
  assert.deepEqual((await (await handleRequest(req(cuerpo), env, { callModel: c404 })).json()).error, 'modelo_no_disponible');
  const c503 = model(new ProviderError(503, 'caído'));
  assert.deepEqual((await (await handleRequest(req(cuerpo), env, { callModel: c503 })).json()).error, 'google_caido');
});

test('/cenas: reintenta UNA vez si el JSON es inválido o ninguna cena es válida; después, 502', async () => {
  const cm = model('{roto', CENAS);
  const ok = await handleRequest(req(cuerpo), env, { callModel: cm });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).attempts, 2);
  const malo = model(JSON.stringify({ cenas: [{ nombre: 'x', lineas: [{ id: 'inventado', gramos: 5 }] }] }));
  const r = await handleRequest(req(cuerpo), env, { callModel: malo });
  assert.equal(r.status, 502);
  assert.equal(malo.calls.length, 2);
  assert.equal((await r.json()).error, 'respuesta_invalida');
});

test('/cenas: el rol de cada alimento (rol_cena) viaja a la IA en la lista compacta, solo en /cenas y solo si es un rol válido; el prompt lo explica', async () => {
  const conRol = lista.map((f, i) => ({ ...f, ...(i % 2 ? { rol: 'proteina' } : { rol: 'inventado' }) }));
  const cm = model(CENAS);
  await handleRequest(req({ alimentos: conRol, deficits: ['Fibra'] }), env, { callModel: cm });
  const enviada = JSON.parse(cm.calls[0].user.split('CATÁLOGO (JSON):\n')[1].split('\n\n')[0]);
  assert.equal(enviada.length, lista.length);
  enviada.forEach((f, i) => assert.equal(f.rol, i % 2 ? 'proteina' : undefined));
  assert.match(CENAS_SYSTEM_PROMPT, /"rol"/);
  assert.match(CENAS_SYSTEM_PROMPT, /al menos un alimento con rol "proteina"/);
  // /parse ignora el rol aunque lo envíen
  const parse = model(JSON.stringify({ items: [], unmatched: [] }));
  await handleRequest(new Request('https://worker.example/parse', { method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN, 'X-App-Token': 'tok-123' }, body: JSON.stringify({ texto: 'huevo', alimentos: conRol }) }), env, { callModel: parse });
  assert.ok(!parse.calls[0].user.includes('"rol"'));
});

test('/cenas: si ninguna cena vale, el 502 dice cuántas llegaron y por qué (la app lo muestra en vez de «reformula la frase»)', async () => {
  const malo = model(JSON.stringify({ cenas: [{ nombre: 'x', lineas: [{ id: 'inventado', gramos: 5 }] }, { nombre: 'y', lineas: [{ id: 'huevo', gramos: -1 }] }] }));
  const r = await handleRequest(req(cuerpo), env, { callModel: malo });
  const b = await r.json();
  assert.equal(r.status, 502);
  assert.deepEqual([b.error, b.recibidas, b.descartes], ['respuesta_invalida', 2, { fuera_catalogo: 1, no_enviado: 0, gramos: 1, sin_proteina: 0 }]);
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => b });
  const ai = createAiClient({ endpoint: 'https://w', token: 'tk', fetchImpl, isOnline: () => true });
  await assert.rejects(ai.ideasCena(cuerpo), (e) => e.code === 'respuesta_invalida' && e.userMessage === 'La IA propuso 2 cenas, pero ninguna vale: 1 con alimentos que no están en tu catálogo y 1 con gramos no válidos.');
});

test('cliente: un Worker publicado sin /cenas (404 no_encontrado) dice que hay que desplegarlo, no «el servicio de IA ha fallado»', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_encontrado' }) });
  const ai = createAiClient({ endpoint: 'https://w', token: 'tk', fetchImpl, isOnline: () => true });
  await assert.rejects(ai.ideasCena(cuerpo), (e) => e.code === 'worker_antiguo' && e.userMessage === 'El Worker publicado aún no tiene esta función: hay que desplegarlo (npm run worker:deploy).');
});

test('/cenas lo atiende también el servidor local, con el mismo código del Worker y el modelo simulado', async () => {
  assert.ok(RUTAS_WORKER.includes('/cenas'));
  let llamadas = 0;
  const server = createDevServer({ env: { GEMINI_API_KEY: 'CLAVE-FALSA', GEMINI_MODEL: 'm', APP_TOKEN: 'tok' }, callModel: async () => { llamadas++; return CENAS; } });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ai = createAiClient({ endpoint: base, token: 'tok', isOnline: () => true });
    const r = await ai.ideasCena(cuerpo);
    assert.equal(llamadas, 1);
    assert.deepEqual(r.cenas.map((c) => c.nombre), ['Salmón con arroz y calabacín', 'Con ids inventados', 'Sin proteína']);
    assert.ok(Array.isArray(r.warnings));
    const mal = await fetch(`${base}/cenas`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-token': 'tok' }, body: JSON.stringify({ alimentos: lista, deficits: ['Fibra 3'] }) });
    assert.equal(mal.status, 400);
    assert.equal(llamadas, 1);
  } finally { await new Promise((ok) => server.close(ok)); }
});

test('cliente: ideasCena envía solo { alimentos, deficits } a /cenas con el token y devuelve las cenas', async () => {
  const visto = [];
  const fetchImpl = async (url, init) => { visto.push([url, JSON.parse(init.body), init.headers['X-App-Token']]); return { ok: true, status: 200, json: async () => ({ cenas: [{ nombre: 'a', lineas: [] }], warnings: ['w'], model: 'm' }) }; };
  const ai = createAiClient({ endpoint: 'https://w/', token: 'tk', fetchImpl, isOnline: () => true });
  const r = await ai.ideasCena({ alimentos: lista, deficits: ['Fibra'], algoMas: 'no viaja' });
  assert.deepEqual(visto[0][0], 'https://w/cenas');
  assert.deepEqual(Object.keys(visto[0][1]), ['alimentos', 'deficits']);
  assert.equal(visto[0][2], 'tk');
  assert.deepEqual([r.cenas.length, r.warnings, r.model], [1, ['w'], 'm']);
  // sin conexión
  await assert.rejects(createAiClient({ endpoint: 'https://w', token: 'tk', fetchImpl, isOnline: () => false }).ideasCena(cuerpo), /Sin conexión/);
});
