import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/src/index.js';
import { callGemini, ProviderError } from '../worker/src/providers/gemini.js';
import { realList } from './helpers.js';

const ORIGIN = 'https://victor.github.io';
const env = { APP_TOKEN: 'tok-123', ALLOWED_ORIGIN: ORIGIN, GEMINI_MODEL: 'modelo-de-prueba', GEMINI_API_KEY: 'CLAVE-SECRETA-XYZ' };
const good = JSON.stringify({ items: [{ food_id: 'kiwi_verde', cantidad: 69, unidad: 'g', source_text: 'un kiwi', confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [] });

function req({ method = 'POST', path = '/parse', origin = ORIGIN, token = 'tok-123', body = { texto: 'un kiwi', alimentos: realList }, raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (token) headers['X-App-Token'] = token;
  return new Request(`https://worker.example${path}`, { method, headers, body: method === 'GET' || method === 'OPTIONS' ? undefined : (raw ?? JSON.stringify(body)) });
}
const model = (...outputs) => { const calls = []; const fn = async (e, args) => { calls.push({ env: e, args }); const o = outputs[Math.min(calls.length - 1, outputs.length - 1)]; if (o instanceof Error) throw o; return o; }; fn.calls = calls; return fn; };

test('preflight: origen permitido -> 204 con CORS; otro origen -> 403', async () => {
  const ok = await handleRequest(req({ method: 'OPTIONS' }), env);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /X-App-Token/);
  assert.equal((await handleRequest(req({ method: 'OPTIONS', origin: 'https://malo.example' }), env)).status, 403);
});

test('token ausente o incorrecto -> 401; origen no permitido -> 403', async () => {
  const cm = model(good);
  assert.equal((await handleRequest(req({ token: null }), env, { callModel: cm })).status, 401);
  assert.equal((await handleRequest(req({ token: 'otro' }), env, { callModel: cm })).status, 401);
  assert.equal((await handleRequest(req({ origin: 'https://malo.example' }), env, { callModel: cm })).status, 403);
  assert.equal(cm.calls.length, 0); // nunca se llega al proveedor
});

test('sin Origin (curl/script) y con token correcto: funciona', async () => {
  const res = await handleRequest(req({ origin: null }), env, { callModel: model(good) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('entradas inválidas -> 400', async () => {
  const cm = model(good);
  for (const body of [{ texto: '', alimentos: realList }, { texto: 'x'.repeat(1001), alimentos: realList }, { texto: 'hola' }, { texto: 'hola', alimentos: [] }, { texto: 'hola', alimentos: [{ nombre: 'sin id' }] }]) {
    assert.equal((await handleRequest(req({ body }), env, { callModel: cm })).status, 400);
  }
  assert.equal((await handleRequest(req({ raw: '{no json' }), env, { callModel: cm })).status, 400);
  assert.equal(cm.calls.length, 0);
});

test('configuración incompleta -> 500; ruta desconocida -> 404; /health', async () => {
  assert.equal((await handleRequest(req(), { ...env, GEMINI_API_KEY: '' }, { callModel: model(good) })).status, 500);
  assert.equal((await handleRequest(req({ path: '/otra' }), env)).status, 404);
  assert.equal((await handleRequest(req({ method: 'GET', path: '/health' }), env)).status, 200);
});

test('/health ("Probar"): secretos configurados y token correcto, sin revelar valores ni gastar IA', async () => {
  const health = async (headers, e = env) => {
    const r = await handleRequest(new Request('https://w.example/health', { headers }), e, { callModel: () => { throw new Error('no debe llamar a la IA'); } });
    return [r.status, await r.text()];
  };
  const [status, body] = await health({ Origin: ORIGIN, 'X-App-Token': 'tok-123' });
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { ok: true, configurado: true, token: 'ok' });
  assert.ok(!body.includes('CLAVE-SECRETA-XYZ') && !body.includes('tok-123'));
  assert.equal(JSON.parse((await health({ 'X-App-Token': 'otro' }))[1]).token, 'incorrecto');
  assert.equal(JSON.parse((await health({}))[1]).token, 'sin_token');
  assert.equal(JSON.parse((await health({}, { ...env, GEMINI_API_KEY: '' }))[1]).configurado, false);
  // la app manda el token en un GET: la comprobación previa del navegador lo permite
  const pre = await handleRequest(new Request('https://w.example/health', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-app-token' } }), env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /GET/);
  assert.match(pre.headers.get('access-control-allow-headers'), /X-App-Token/);
});

test('flujo correcto: devuelve JSON validado; la clave no aparece en la respuesta', async () => {
  const cm = model(good);
  const res = await handleRequest(req(), env, { callModel: cm });
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(res.status, 200);
  assert.deepEqual(body.items.map((i) => [i.food_id, i.grams, i.confidence]), [['kiwi_verde', 69, 'alta']]);
  assert.equal(body.model, 'modelo-de-prueba');
  assert.equal(body.attempts, 1);
  assert.ok(!text.includes('CLAVE-SECRETA-XYZ'));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('al proveedor solo viaja la frase y la lista compacta: los nutrientes se eliminan aunque el cliente los envíe', async () => {
  const sucio = realList.map((f) => ({ ...f, nutrients: { proteina_g: 12.5 }, energia_kcal: 777, densidad: 9.87, extra: { notas: 'secreto' } }));
  const cm = model(good);
  await handleRequest(req({ body: { texto: 'un kiwi', alimentos: sucio, diario: [{ dia: '2026-10-16' }] } }), env, { callModel: cm });
  const { user, system } = cm.calls[0].args;
  for (const leak of ['proteina_g', '12.5', '777', 'secreto', 'nutrients', '2026-10-16', 'CLAVE-SECRETA-XYZ', '9.87', 'densidad']) { assert.ok(!user.includes(leak), leak); assert.ok(!system.includes(leak), leak); }
  assert.ok(user.includes('un kiwi'));
  assert.ok(user.includes('"id":"kiwi_verde"'));
  assert.ok(user.includes('"peso_en_crudo":true')); // dato de variante permitido (regla 6)
});

test('reintenta UNA vez si el JSON es inválido', async () => {
  const cm = model('esto no es json', good);
  const res = await handleRequest(req(), env, { callModel: cm });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).attempts, 2);
  assert.equal(cm.calls.length, 2);
});

test('estructura inválida también cuenta como inválido; dos fallos -> 502', async () => {
  const cm = model('{"items": []}', '[1,2]');
  const res = await handleRequest(req(), env, { callModel: cm });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'respuesta_invalida');
  assert.equal(cm.calls.length, 2);
});

test('errores del proveedor: 429 -> 429, otros -> 502, sin reintento', async () => {
  const c429 = model(new ProviderError(429, 'cuota'));
  const r429 = await handleRequest(req(), env, { callModel: c429 });
  assert.equal(r429.status, 429);
  assert.equal(c429.calls.length, 1);
  const c500 = model(new ProviderError(500, 'x'));
  assert.equal((await handleRequest(req(), env, { callModel: c500 })).status, 502);
  assert.equal((await handleRequest(req(), env, { callModel: model(new Error('red caída')) })).status, 502);
});

test('el worker aplica la validación y las reglas de variantes (merluza sin estado -> cruda, confianza media)', async () => {
  const raw = JSON.stringify({ items: [{ food_id: 'merluza_cocida', cantidad: 200, unidad: 'g', source_text: '200 g de merluza', confidence: 'alta', estado_dicho: 'ninguno' }, { food_id: 'inventado', cantidad: 5, unidad: 'g', source_text: 'cosa', confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [] });
  const body = await (await handleRequest(req({ body: { texto: '200 g de merluza y cosa', alimentos: realList } }), env, { callModel: model(raw) })).json();
  assert.deepEqual(body.items.map((i) => [i.food_id, i.confidence]), [['merluza_cruda', 'media']]);
  assert.equal(body.unmatched[0].text, 'cosa');
});

// ---------- proveedor Gemini (con fetch simulado) ----------
test('callGemini: modelo en la URL, clave en cabecera (no en la URL), JSON y esquema solicitados', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"items":[],' }, { text: '"unmatched":[]}' }] } }] }), { status: 200 }); };
  const text = await callGemini({ apiKey: 'K', model: 'gemini-x', system: 'S', user: 'U', schema: { type: 'OBJECT' }, fetchImpl });
  assert.equal(text, '{"items":[],"unmatched":[]}');
  assert.match(seen.url, /\/models\/gemini-x:generateContent$/);
  assert.ok(!seen.url.includes('K='));
  assert.equal(seen.init.headers['x-goog-api-key'], 'K');
  assert.equal(seen.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(seen.body.generationConfig.responseSchema, { type: 'OBJECT' });
  assert.equal(seen.body.systemInstruction.parts[0].text, 'S');
  assert.equal(seen.body.contents[0].parts[0].text, 'U');
});

test('callGemini: respuesta HTTP de error o vacía lanza ProviderError', async () => {
  const bad = async () => new Response('cuota agotada', { status: 429 });
  await assert.rejects(callGemini({ apiKey: 'K', model: 'm', system: '', user: '', schema: {}, fetchImpl: bad }), (e) => e instanceof ProviderError && e.status === 429);
  const empty = async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 });
  await assert.rejects(callGemini({ apiKey: 'K', model: 'm', system: '', user: '', schema: {}, fetchImpl: empty }), ProviderError);
});
