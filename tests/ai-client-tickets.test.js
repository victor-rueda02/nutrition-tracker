// ai-client.js: la cola de tickets de Mercadona (ticketsPendientes, ticketsRecibidos, subirTicket). Sin red: fetch simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiClient, AiClientError } from '../frontend/js/ai-client.js';

const respond = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const client = (fetchImpl, o = {}) => createAiClient({ endpoint: 'https://w.example/', token: 'tok', fetchImpl, isOnline: () => true, ...o });
const falla = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof AiClientError); assert.ok(e.userMessage.length > 10); return e; } assert.fail('debía fallar'); };
const hash = 'a'.repeat(64);

test('ticketsPendientes: POST /tickets/pendientes con el token de la app; devuelve la cola', async () => {
  let visto;
  const cola = [{ hash, fecha: '2026-10-26', lineas: [{ n: 1, cantidad: 1, descripcion: 'ARROZ LARGO', precio_unitario: null, importe: 1.2, peso_kg: null }], recibido: '2026-11-14T09:00:00.000Z', origen: 'correo' }];
  const c = client(async (url, init) => { visto = { url, init }; return new Response(JSON.stringify({ tickets: cola }), { status: 200 }); });
  assert.deepEqual(await c.ticketsPendientes(), { tickets: cola });
  assert.equal(visto.url, 'https://w.example/tickets/pendientes');
  assert.equal(visto.init.method, 'POST');
  assert.equal(visto.init.headers['X-App-Token'], 'tok');
  assert.ok(!('X-Mail-Token' in visto.init.headers), 'la app nunca usa el token del correo');
  await falla(client(respond(200, { otra: 1 })).ticketsPendientes()); // forma inesperada
});

test('ticketsRecibidos: manda solo los hashes', async () => {
  let visto;
  const c = client(async (url, init) => { visto = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ ok: true, borrados: 2 }), { status: 200 }); });
  assert.deepEqual(await c.ticketsRecibidos({ hashes: [hash, 'b'.repeat(64)] }), { borrados: 2 });
  assert.equal(visto.url, 'https://w.example/tickets/recibidos');
  assert.deepEqual(visto.body, { hashes: [hash, 'b'.repeat(64)] });
});

test('subirTicket: PDF en base64 o texto (uno solo) y devuelve hash, fecha, nº de líneas y si ya estaba', async () => {
  const cuerpos = [];
  const c = client(async (url, init) => { cuerpos.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, hash, fecha: '2026-10-26', lineas: 22, duplicado: cuerpos.length > 1 }), { status: 200 }); });
  assert.deepEqual(await c.subirTicket({ pdf_base64: 'JVBERi0=' }), { hash, fecha: '2026-10-26', lineas: 22, duplicado: false });
  assert.deepEqual(await c.subirTicket({ texto: '26/10/2026\nCnt. …' }), { hash, fecha: '2026-10-26', lineas: 22, duplicado: true });
  assert.deepEqual(cuerpos.map((x) => [x.url, Object.keys(x.body)]), [['https://w.example/tickets', ['pdf_base64']], ['https://w.example/tickets', ['texto']]]);
  await falla(client(respond(200, { ok: true })).subirTicket({ texto: 'x' }));
});

test('errores de la cola de tickets: cada código con su mensaje (no «la IA ha fallado») y el detalle del ticket', async () => {
  const llamada = (status, body) => client(respond(status, body)).subirTicket({ texto: 'x' });
  const codigos = [
    [500, { error: 'tickets_sin_configurar' }], [422, { error: 'ticket_ilegible', codigo: 'sin_detalle', detalle: 'No encuentro el detalle' }],
    [422, { error: 'pdf_invalido' }], [422, { error: 'pdf_cifrado' }], [422, { error: 'pdf_no_soportado' }], [422, { error: 'sin_texto' }],
    [413, { error: 'pdf_demasiado_grande' }], [413, { error: 'texto_demasiado_largo' }], [413, { error: 'cuerpo_demasiado_grande' }],
    [400, { error: 'ticket_invalido' }], [400, { error: 'hashes_invalidos' }],
  ];
  const mensajes = new Set();
  for (const [status, body] of codigos) {
    const e = await falla(llamada(status, body));
    assert.equal(e.code, body.error);
    assert.doesNotMatch(e.userMessage, /servicio de IA/);
    mensajes.add(e.userMessage);
  }
  assert.equal(mensajes.size, codigos.length, 'mensajes distintos');
  const e = await falla(llamada(422, { error: 'ticket_ilegible', codigo: 'sin_fecha', detalle: 'No encuentro la fecha del ticket' }));
  assert.equal(e.codigo, 'sin_fecha');
  assert.match(e.message, /No encuentro la fecha/);
  assert.match((await falla(llamada(500, { error: 'tickets_sin_configurar' }))).userMessage, /CORREO\.md/);
  // los de siempre
  assert.equal((await falla(llamada(401, { error: 'token_invalido' }))).code, 'token_invalido');
  assert.equal((await falla(llamada(403, { error: 'origen_no_permitido' }))).code, 'origen');
  assert.equal((await falla(llamada(404, { error: 'no_encontrado' }))).code, 'worker_antiguo', 'un Worker sin /tickets pide desplegar');
  assert.equal((await falla(client(async () => { throw new TypeError('Failed to fetch'); }).ticketsPendientes())).code, 'red');
});

test('sin configurar o sin conexión: no se llama al Worker', async () => {
  let llamado = false;
  const espia = async () => { llamado = true; return new Response('{}'); };
  assert.equal((await falla(createAiClient({ endpoint: '', token: 't', fetchImpl: espia }).ticketsPendientes())).code, 'sin_configurar');
  assert.equal((await falla(client(espia, { isOnline: () => false }).subirTicket({ texto: 'x' }))).code, 'sin_conexion');
  assert.equal(llamado, false);
});
