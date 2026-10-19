import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiClient, AiClientError } from '../frontend/js/ai-client.js';

const ok = { items: [{ food_id: 'a', grams: 1, source_text: 's', confidence: 'alta', flags: [] }], unmatched: [], warnings: ['w'], model: 'm' };
const respond = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const client = (fetchImpl, o = {}) => createAiClient({ endpoint: 'https://w.example/', token: 'tok', fetchImpl, isOnline: () => true, ...o });
const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof AiClientError); assert.ok(e.userMessage.length > 10); return e.code; } return null; };

test('envía texto y lista compacta al Worker con el token y devuelve el resultado', async () => {
  let seen;
  const c = client(async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(ok), { status: 200 }); });
  const r = await c.interpretMeal({ texto: 'hola', alimentos: [{ id: 'a', nombre: 'A' }] });
  assert.equal(seen.url, 'https://w.example/parse');
  assert.equal(seen.init.headers['X-App-Token'], 'tok');
  assert.deepEqual(JSON.parse(seen.init.body), { texto: 'hola', alimentos: [{ id: 'a', nombre: 'A' }] });
  assert.deepEqual(r, { items: ok.items, unmatched: [], warnings: ['w'], model: 'm' });
});

test('errores traducidos a códigos con mensaje para el usuario', async () => {
  const call = (f, o) => code(client(f, o).interpretMeal({ texto: 'x', alimentos: [] }));
  assert.equal(await call(respond(401, { error: 'token_invalido' })), 'token_invalido');
  assert.equal(await call(respond(403, { error: 'origen_no_permitido' })), 'origen');
  assert.equal(await call(respond(429, { error: 'limite_de_uso' })), 'limite_de_uso');
  assert.equal(await call(respond(502, { error: 'respuesta_invalida', detalle: 'x' })), 'respuesta_invalida');
  assert.equal(await call(respond(502, { error: 'proveedor_ia' })), 'proveedor_ia');
  assert.equal(await call(respond(500, 'no json')), 'proveedor_ia');
  // el Worker distingue qué le pasa a Google; cada caso, su mensaje
  const mensajes = new Set();
  for (const [error, status] of [['google_caido', 503], ['modelo_no_disponible', 404], ['clave_ia', 403], ['error_worker', null], ['proveedor_ia', 418]]) {
    try { await client(respond(502, { error, status })).interpretMeal({ texto: 'x', alimentos: [] }); assert.fail('debía fallar'); } catch (e) { assert.equal(e.code, error); mensajes.add(e.userMessage); }
  }
  assert.equal(mensajes.size, 5); // mensajes distintos
  assert.match([...mensajes][0], /sobrecargado o caído/);
  assert.equal(await call(respond(200, { items: [] })), 'respuesta_invalida');
  assert.equal(await call(async () => { throw new TypeError('Failed to fetch'); }), 'red');
});

test('sin configurar o sin conexión: no se intenta la llamada', async () => {
  let called = false;
  const spy = async () => { called = true; return new Response('{}'); };
  assert.equal(await code(createAiClient({ endpoint: '', token: 't', fetchImpl: spy }).interpretMeal({ texto: 'x', alimentos: [] })), 'sin_configurar');
  assert.equal(await code(createAiClient({ endpoint: 'https://w', token: '', fetchImpl: spy }).interpretMeal({ texto: 'x', alimentos: [] })), 'sin_configurar');
  assert.equal(await code(client(spy, { isOnline: () => false }).interpretMeal({ texto: 'x', alimentos: [] })), 'sin_conexion');
  assert.equal(called, false);
});

test('health ("Probar") no gasta IA: dice si responde, si tiene sus secretos y si el token es el correcto', async () => {
  let url;
  let init;
  const c = createAiClient({ endpoint: 'https://w.example', fetchImpl: async (u, i) => { url = u; init = i; return new Response('{"ok":true}'); } });
  assert.deepEqual(await c.health(), { ok: true, configurado: true, token: null });
  assert.equal(url, 'https://w.example/health');
  assert.equal(init, undefined); // sin token no manda cabecera
  const conToken = createAiClient({ endpoint: 'https://w.example/', token: 'tok', fetchImpl: async (u, i) => { init = i; return new Response('{"ok":true,"configurado":false,"token":"incorrecto"}'); } });
  assert.deepEqual(await conToken.health(), { ok: true, configurado: false, token: 'incorrecto' });
  assert.equal(init.headers['X-App-Token'], 'tok');
  assert.deepEqual(await createAiClient({ endpoint: 'https://w', fetchImpl: async () => new Response('x', { status: 500 }) }).health(), { ok: false });
  await assert.rejects(createAiClient({ endpoint: 'https://w', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }).health(), (e) => /ALLOWED_ORIGIN/.test(e.userMessage));
});
