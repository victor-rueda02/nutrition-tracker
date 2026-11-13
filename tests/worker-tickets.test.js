// Worker: cola de tickets de Mercadona (POST /tickets, /tickets/pendientes, /tickets/recibidos) con un KV simulado.
// Sin llamadas reales y sin IA: ni Gemini ni USDA se tocan (regla 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/src/index.js';
import { MAX_PDF, MAX_TEXTO, MAX_BODY_TICKETS, TTL_TICKETS, MAX_HASHES } from '../worker/src/tickets.js';
import { pdfDeTicket } from './pdf-sintetico.js';
import { readFile } from './helpers.js';

const ORIGIN = 'https://victor.github.io';
const baseEnv = { APP_TOKEN: 'tok-app', MAIL_TOKEN: 'tok-mail', ALLOWED_ORIGIN: ORIGIN, GEMINI_MODEL: 'm', GEMINI_API_KEY: 'CLAVE-SECRETA', USDA_API_KEY: 'CLAVE-USDA' };

// KV simulado: get / put (con expirationTtl) / delete / list con prefijo, límite y cursor.
function kvFalso() {
  const m = new Map();
  const ttl = new Map();
  const llamadas = { put: 0, get: 0, delete: 0, list: 0 };
  return {
    m, ttl, llamadas,
    async get(k) { llamadas.get++; return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) { llamadas.put++; m.set(k, v); ttl.set(k, o?.expirationTtl); },
    async delete(k) { llamadas.delete++; m.delete(k); },
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      llamadas.list++;
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const ini = cursor ? Number(cursor) : 0;
      const fin = ini + limit;
      return { keys: keys.slice(ini, fin).map((name) => ({ name })), list_complete: fin >= keys.length, cursor: fin < keys.length ? String(fin) : undefined };
    },
  };
}
const sinIA = { callModel: () => { throw new Error('los tickets no usan la IA'); }, usdaClient: () => { throw new Error('los tickets no usan USDA'); } };

function post(path, body, { token = 'tok-app', mail = null, origin = ORIGIN, raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (token) headers['X-App-Token'] = token;
  if (mail) headers['X-Mail-Token'] = mail;
  return new Request(`https://worker.example${path}`, { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
}
const llama = (req, env) => handleRequest(req, env, sinIA);
const fixture = (f) => readFile(`./fixtures/tickets/${f}`).replace(/\r\n/g, '\n').trim();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// Un ticket con cabecera y pie como los reales (datos inventados) para comprobar que no se guarda nada de eso.
const lineasPdf = `MERCADONA, S.A. A-00000000
C/ DE PRUEBA, 1
TELÉFONO: 900000000
26/10/2026 20:58 OP: 4350
FACTURA SIMPLIFICADA: 1234-567-890123
Cnt. Descripción P. Unit Importe
3 BEBIDA AVENA 0,95 2,85
1 MANDARINA
0,798 kg 2,55 €/kg 2,03
TOTAL (€) 4,88
TARJETA BANCARIA: **** **** **** 1234
AUT: 123456 AID: A0000000031010`;

test('POST /tickets con el token del correo: lee el PDF, guarda solo {hash, fecha, líneas, recibido, origen} con caducidad y no usa CORS', async () => {
  const kv = kvFalso();
  const env = { ...baseEnv, TICKETS: kv };
  const res = await llama(post('/tickets', { pdf_base64: b64(pdfDeTicket(lineasPdf)) }, { token: null, mail: 'tok-mail', origin: null }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, 'el correo no pasa por CORS');
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.fecha, '2026-10-26');
  assert.equal(b.lineas, 2);
  assert.equal(b.duplicado, false);
  assert.match(b.hash, /^[0-9a-f]{64}$/);
  assert.equal(kv.m.size, 1);
  const [[clave, valor]] = [...kv.m];
  assert.equal(clave, `ticket:${b.hash}`);
  assert.equal(kv.ttl.get(clave), TTL_TICKETS);
  assert.equal(TTL_TICKETS, 30 * 24 * 3600);
  const reg = JSON.parse(valor);
  assert.deepEqual(Object.keys(reg).sort(), ['fecha', 'hash', 'lineas', 'origen', 'recibido']);
  assert.equal(reg.origen, 'correo');
  assert.match(reg.recibido, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(reg.lineas, [
    { n: 1, cantidad: 3, descripcion: 'BEBIDA AVENA', precio_unitario: 0.95, importe: 2.85, peso_kg: null },
    { n: 2, cantidad: 1, descripcion: 'MANDARINA', precio_unitario: 2.55, importe: 2.03, peso_kg: 0.798 },
  ]);
  for (const dato of ['A-00000000', 'PRUEBA', '900000000', '20:58', 'OP:', '4350', '1234-567-890123', 'TARJETA', '****', 'AUT', 'MERCADONA']) assert.ok(!valor.includes(dato), `no debe guardarse ${dato}`);
  assert.ok(!JSON.stringify(b).includes('1234-567-890123'), 'la respuesta tampoco lleva el nº de factura');
});

test('POST /tickets con el token de la app: con CORS y origen «app»; también acepta el texto pegado', async () => {
  const kv = kvFalso();
  const env = { ...baseEnv, TICKETS: kv };
  const res = await llama(post('/tickets', { texto: fixture('ticket-2026-10-26.txt') }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const b = await res.json();
  assert.equal(b.lineas, 22);
  assert.equal(JSON.parse([...kv.m.values()][0]).origen, 'app');
});

test('el mismo ticket por correo y por la app no se duplica en la cola (clave por hash)', async () => {
  const kv = kvFalso();
  const env = { ...baseEnv, TICKETS: kv };
  const pdf = b64(pdfDeTicket(lineasPdf));
  const a = await (await llama(post('/tickets', { pdf_base64: pdf }, { token: null, mail: 'tok-mail', origin: null }), env)).json();
  const b = await (await llama(post('/tickets', { texto: lineasPdf }), env)).json(); // el texto trae la misma factura y fecha
  assert.equal(a.duplicado, false);
  assert.equal(b.duplicado, true);
  assert.equal(b.hash, a.hash);
  assert.equal(kv.m.size, 1);
  assert.equal(kv.llamadas.put, 1, 'no se vuelve a escribir');
  assert.equal(JSON.parse([...kv.m.values()][0]).origen, 'correo', 'se queda el primero');
});

test('autenticación: sin token, token malo y token del correo en rutas que no son /tickets -> 401; origen ajeno -> 403', async () => {
  const kv = kvFalso();
  const env = { ...baseEnv, TICKETS: kv };
  const cuerpo = { texto: fixture('ticket-2026-10-26.txt') };
  assert.equal((await llama(post('/tickets', cuerpo, { token: null, origin: null }), env)).status, 401);
  assert.equal((await llama(post('/tickets', cuerpo, { token: 'otro' }), env)).status, 401);
  assert.equal((await llama(post('/tickets', cuerpo, { token: null, mail: 'otro', origin: null }), env)).status, 401);
  assert.equal((await llama(post('/tickets', cuerpo, { token: null, mail: '', origin: null }), env)).status, 401);
  assert.equal((await llama(post('/tickets', cuerpo, { origin: 'https://malo.example' }), env)).status, 403);
  // el token del correo solo vale para POST /tickets
  for (const ruta of ['/tickets/pendientes', '/tickets/recibidos']) {
    assert.equal((await llama(post(ruta, { hashes: ['a'.repeat(64)] }, { token: null, mail: 'tok-mail', origin: null }), env)).status, 401, ruta);
  }
  assert.equal((await llama(post('/parse', { texto: 'x', alimentos: [] }, { token: null, mail: 'tok-mail', origin: null }), env)).status, 401, 'ni a la IA');
  // sin MAIL_TOKEN en el Worker, un X-Mail-Token cualquiera no entra (ni siquiera uno vacío)
  const sinMail = { ...baseEnv, MAIL_TOKEN: undefined, TICKETS: kv };
  assert.equal((await llama(post('/tickets', cuerpo, { token: null, mail: 'tok-mail', origin: null }), sinMail)).status, 401);
  assert.equal((await llama(post('/tickets', cuerpo, { token: null, mail: '', origin: null }), sinMail)).status, 401);
  assert.equal(kv.m.size, 0, 'nada llegó a la cola');
  // el token de la app no es el del correo y viceversa: el del correo en X-App-Token no vale
  assert.equal((await llama(post('/tickets', cuerpo, { token: 'tok-mail' }), env)).status, 401);
  // la ruta y el método
  assert.equal((await llama(new Request('https://worker.example/tickets', { method: 'GET', headers: { 'X-App-Token': 'tok-app' } }), env)).status, 404);
  assert.equal((await llama(post('/tickets/otra', {}), env)).status, 404);
});

test('CORS: la comprobación previa admite X-App-Token pero no X-Mail-Token (el correo no es de un navegador)', async () => {
  const pre = await llama(new Request('https://worker.example/tickets', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-app-token,content-type' } }), { ...baseEnv, TICKETS: kvFalso() });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-App-Token/);
  assert.doesNotMatch(pre.headers.get('Access-Control-Allow-Headers'), /Mail/i);
  assert.equal((await llama(new Request('https://worker.example/tickets', { method: 'OPTIONS', headers: { Origin: 'https://malo.example' } }), baseEnv)).status, 403);
});

test('sin KV configurado: 500 tickets_sin_configurar (tras autenticar); el resto del Worker sigue igual', async () => {
  const res = await llama(post('/tickets', { texto: fixture('ticket-2026-10-26.txt') }), baseEnv);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'tickets_sin_configurar');
  for (const ruta of ['/tickets/pendientes', '/tickets/recibidos']) assert.equal((await llama(post(ruta, { hashes: ['a'.repeat(64)] }), baseEnv)).status, 500, ruta);
  assert.equal((await llama(post('/tickets', {}, { token: 'otro' }), baseEnv)).status, 401, 'primero el token');
  assert.equal((await llama(post('/tickets', {}, { token: null, mail: 'tok-mail', origin: null }), baseEnv)).status, 500, 'el correo también ve el error');
});

test('entradas inválidas: 400 (JSON, ni PDF ni texto, los dos, base64), 413 (tamaños) y 422 (no se entiende)', async () => {
  const kv = kvFalso();
  const env = { ...baseEnv, TICKETS: kv };
  const status = async (body, opts) => (await llama(post('/tickets', body, opts), env)).status;
  assert.equal(await status(null, { raw: '{no json' }), 400);
  assert.equal(await status({}), 400);
  assert.equal(await status({ texto: '   ' }), 400);
  assert.equal(await status({ texto: 'a', pdf_base64: 'AAAA' }), 400, 'o PDF o texto, no los dos');
  assert.equal(await status({ pdf_base64: 'esto no es base64 !!!' }), 400);
  assert.equal(await status({ pdf_base64: 5 }), 400);
  // tamaños
  assert.equal(MAX_PDF, 2_000_000);
  const r = await llama(post('/tickets', { pdf_base64: Buffer.alloc(MAX_PDF + 10, 1).toString('base64') }), env);
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error, 'pdf_demasiado_grande');
  assert.equal(await status({ texto: 'x'.repeat(MAX_TEXTO + 1) }), 413);
  assert.equal(await status(null, { raw: JSON.stringify({ texto: 'x'.repeat(MAX_BODY_TICKETS) }) }), 413);
  // un PDF de tamaño razonable que cabe pero no es un PDF / un texto que no es un ticket
  const noPdf = await llama(post('/tickets', { pdf_base64: Buffer.from('esto no es un pdf, ni de lejos, ni con buena voluntad').toString('base64') }), env);
  assert.equal(noPdf.status, 422);
  assert.equal((await noPdf.json()).error, 'pdf_invalido');
  const ilegible = await llama(post('/tickets', { texto: 'hola, esto no es un ticket' }), env);
  assert.equal(ilegible.status, 422);
  assert.deepEqual([(await ilegible.json()).error], ['ticket_ilegible']);
  assert.equal(kv.m.size, 0);
  // un PDF de buen tamaño (casi 2 MB de datos) sí se acepta para leer (falla por no ser PDF, no por tamaño)
  assert.equal((await llama(post('/tickets', { pdf_base64: Buffer.alloc(1_900_000, 1).toString('base64') }), env)).status, 422);
});

test('POST /tickets/pendientes: la cola ordenada por fecha; /tickets/recibidos los borra y solo acepta hashes válidos', async () => {
  const kv = kvFalso();
  const env = { ...baseEnv, TICKETS: kv };
  const sube = async (f) => (await (await llama(post('/tickets', { texto: fixture(f) }), env)).json()).hash;
  const h2 = await sube('ticket-2026-10-26.txt');
  const h1 = await sube('ticket-2026-09-09.txt');
  const res = await llama(post('/tickets/pendientes', {}), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const { tickets } = await res.json();
  assert.deepEqual(tickets.map((t) => [t.hash, t.fecha, t.lineas.length, t.origen]), [[h1, '2026-09-09', 67, 'app'], [h2, '2026-10-26', 22, 'app']]);
  for (const t of tickets) assert.deepEqual(Object.keys(t).sort(), ['fecha', 'hash', 'lineas', 'origen', 'recibido']);
  // recibidos: borra uno
  const rec = await llama(post('/tickets/recibidos', { hashes: [h1] }), env);
  assert.equal(rec.status, 200);
  assert.deepEqual(await rec.json(), { ok: true, borrados: 1 });
  assert.deepEqual([...kv.m.keys()], [`ticket:${h2}`]);
  assert.deepEqual((await (await llama(post('/tickets/pendientes', {}), env)).json()).tickets.map((t) => t.hash), [h2]);
  // borrar uno que ya no está no falla
  assert.equal((await llama(post('/tickets/recibidos', { hashes: [h1, h2] }), env)).status, 200);
  assert.equal(kv.m.size, 0);
  assert.deepEqual((await (await llama(post('/tickets/pendientes', {}), env)).json()).tickets, []);
  // hashes inválidos
  for (const body of [{}, { hashes: [] }, { hashes: 'x' }, { hashes: ['corto'] }, { hashes: [5] }, { hashes: ['G'.repeat(64)] }, { hashes: Array.from({ length: MAX_HASHES + 1 }, (_, i) => i.toString(16).padStart(64, '0')) }]) {
    assert.equal((await llama(post('/tickets/recibidos', body), env)).status, 400, JSON.stringify(body).slice(0, 40));
  }
});

test('la cola pagina el KV (más de una página de claves) y salta registros ilegibles', async () => {
  const kv = kvFalso();
  const env = { ...baseEnv, TICKETS: kv };
  for (let i = 0; i < 130; i++) kv.m.set(`ticket:${String(i).padStart(64, '0')}`, JSON.stringify({ hash: String(i).padStart(64, '0'), fecha: '2026-10-01', lineas: [], recibido: `2026-11-01T00:00:${String(i % 60).padStart(2, '0')}Z`, origen: 'app' }));
  kv.m.set('ticket:roto', '{no json');
  kv.m.set('otra-cosa:1', '{}');
  const { tickets } = await (await llama(post('/tickets/pendientes', {}), env)).json();
  assert.equal(tickets.length, 130);
  assert.ok(kv.llamadas.list >= 2, 'hubo más de una página');
});

test('un fallo del KV no tira el Worker: 500 error_worker sin el contenido del ticket', async () => {
  const kv = kvFalso();
  kv.put = async () => { throw new Error('KV caído'); };
  const log = console.error;
  const salida = [];
  console.error = (...a) => salida.push(a.join(' '));
  try {
    const res = await llama(post('/tickets', { texto: fixture('ticket-2026-10-26.txt') }), { ...baseEnv, TICKETS: kv });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'error_worker');
  } finally { console.error = log; }
  assert.ok(salida.every((l) => !l.includes('ARROZ')), 'el registro de errores no lleva el ticket');
});

test('/health: dice si hay KV y token del correo, sin revelar valores', async () => {
  const health = async (env) => {
    const r = await handleRequest(new Request('https://worker.example/health', { headers: { 'X-App-Token': 'tok-app' } }), env, sinIA);
    return [await r.text()];
  };
  const [con] = await health({ ...baseEnv, TICKETS: kvFalso() });
  assert.deepEqual(JSON.parse(con), { ok: true, configurado: true, token: 'ok', tickets: true, mail: true });
  assert.ok(!con.includes('tok-mail') && !con.includes('tok-app'));
  const [sin] = await health({ ...baseEnv, MAIL_TOKEN: undefined });
  assert.deepEqual(JSON.parse(sin), { ok: true, configurado: true, token: 'ok', tickets: false, mail: false });
});
