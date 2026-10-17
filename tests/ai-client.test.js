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

test('health no necesita token ni gasta IA', async () => {
  let url;
  const c = createAiClient({ endpoint: 'https://w.example', fetchImpl: async (u) => { url = u; return new Response('{"ok":true}'); } });
  assert.equal(await c.health(), true);
  assert.equal(url, 'https://w.example/health');
});
