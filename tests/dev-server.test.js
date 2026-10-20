// Servidor local (scripts/dev-server.mjs): sirve solo frontend/ y data/ y atiende /parse con el código del Worker.
// El modelo es SIMULADO: los tests nunca llaman a Gemini.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevServer, staticPath, crearCallModel } from '../scripts/dev-server.mjs';
import { ProviderError } from '../worker/src/providers/gemini.js';
import { geminiModelFallback } from '../scripts/gemini-model.mjs';
import { realList } from './helpers.js';

const modelo = JSON.stringify({ items: [{ food_id: 'kiwi_verde', cantidad: 69, unidad: 'g', source_text: 'un kiwi', confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [] });

async function withServer(fn) {
  let calls = 0;
  const server = createDevServer({ env: { GEMINI_API_KEY: 'CLAVE-FALSA', GEMINI_MODEL: 'm', APP_TOKEN: 'tok' }, callModel: async () => { calls++; return modelo; } });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, () => calls); } finally { await new Promise((ok) => server.close(ok)); }
}

// GET sin normalizar la ruta (fetch quitaría los "..").
const rawGet = (base, path) => new Promise((ok, ko) => {
  const u = new URL(base);
  request({ host: u.hostname, port: u.port, path, method: 'GET' }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode)); }).on('error', ko).end();
});

test('staticPath: solo frontend/ y data/; nada de "..", ocultos ni otras carpetas', () => {
  assert.ok(staticPath('/frontend/index.html'));
  assert.ok(staticPath('/frontend/').endsWith('index.html'));
  assert.ok(staticPath('/data/foods.csv'));
  for (const p of ['/.env', '/package.json', '/usda/eleccion.csv', '/scripts/dev-server.mjs', '/frontend/../.env', '/frontend/%2e%2e/.env', '/data/..%2f.env', '/frontend/.oculto', '/.git/config', '/data/..\\.env', '/']) {
    assert.equal(staticPath(p), null, p);
  }
});

test('sirve la app y los datos; .env y lo demás, 404', async () => {
  await withServer(async (base) => {
    const raiz = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(raiz.status, 302);
    assert.equal(raiz.headers.get('location'), '/frontend/');
    const index = await fetch(`${base}/frontend/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /js\/main\.js/);
    assert.match((await fetch(`${base}/frontend/js/main.js`)).headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${base}/data/targets.json`)).status, 200);
    assert.equal((await fetch(`${base}/frontend`, { redirect: 'manual' })).status, 302);
    for (const p of ['/.env', '/package.json', '/usda/eleccion.csv', '/frontend/no-existe.js']) assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    for (const p of ['/frontend/../.env', '/frontend/%2e%2e/.env', '/data/..%2f..%2f.env']) assert.equal(await rawGet(base, p), 404, p);
  });
});

test('/parse y /health con el código del Worker: token, mismo origen y una llamada por dictado', async () => {
  await withServer(async (base, calls) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const body = JSON.stringify({ texto: 'un kiwi', alimentos: realList });
    const ok = await fetch(`${base}/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': 'tok', Origin: base.replace('127.0.0.1', '127.0.0.1') }, body });
    assert.equal(ok.status, 200);
    const r = await ok.json();
    assert.deepEqual(r.items.map((i) => [i.food_id, i.grams]), [['kiwi_verde', 69]]);
    assert.ok(!JSON.stringify(r).includes('CLAVE-FALSA'));
    assert.equal(calls(), 1);
    assert.equal((await fetch(`${base}/parse`, { method: 'POST', headers: { 'X-App-Token': 'otro' }, body })).status, 401);
    assert.equal((await fetch(`${base}/parse`, { method: 'POST', headers: { 'X-App-Token': 'tok', Origin: 'https://otra-web.example' }, body })).status, 403);
    assert.equal(calls(), 1);
  });
});

// ---------- el servidor local reintenta y usa el respaldo como el Worker ----------
test('servidor local: 5xx -> reintento tras 2 s -> modelo de respaldo, con cada llamada contada en la consola', async () => {
  const vistos = [];
  const esperas = [];
  const logs = [];
  const fallos = [new ProviderError(503, 'high demand'), new ProviderError(503, 'high demand')];
  const call = async ({ model, apiKey }) => { vistos.push([model, apiKey]); if (fallos.length) throw fallos.shift(); return modelo; };
  const callModel = crearCallModel({ call, sleep: async (ms) => { esperas.push(ms); }, log: (m) => logs.push(m) });
  const env = { GEMINI_API_KEY: 'CLAVE-FALSA', GEMINI_MODEL: 'principal', GEMINI_MODEL_FALLBACK: 'respaldo', APP_TOKEN: 'tok' };
  const r = await callModel(env, { system: 's', user: 'u', schema: {} });
  assert.deepEqual(r, { text: modelo, model: 'respaldo' });
  assert.deepEqual(vistos.map((v) => v[0]), ['principal', 'principal', 'respaldo']);
  assert.deepEqual(esperas, [2000]);
  assert.deepEqual(logs, ['[gemini] llamada n.º 1 (principal)', '[gemini] llamada n.º 2 (principal)', '[gemini] llamada n.º 3 (respaldo)']);
});

test('servidor local de punta a punta: Google devuelve 503 y la app recibe la respuesta del respaldo (modelo en la respuesta)', async () => {
  const modelos = [];
  const call = async ({ model }) => { modelos.push(model); if (model === 'principal') throw new ProviderError(503, 'x'); return modelo; };
  const server = createDevServer({ env: { GEMINI_API_KEY: 'CLAVE-FALSA', GEMINI_MODEL: 'principal', GEMINI_MODEL_FALLBACK: 'respaldo', APP_TOKEN: 'tok' }, callModel: crearCallModel({ call, sleep: async () => {}, log: () => {} }) });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/parse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-token': 'tok' }, body: JSON.stringify({ texto: 'un kiwi', alimentos: realList }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).model, 'respaldo');
    assert.deepEqual(modelos, ['principal', 'principal', 'respaldo']);
  } finally { await new Promise((ok) => server.close(ok)); }
});

test('el modelo de respaldo sale de wrangler.toml (o de GEMINI_MODEL_FALLBACK) en un solo sitio', () => {
  const guardado = process.env.GEMINI_MODEL_FALLBACK;
  delete process.env.GEMINI_MODEL_FALLBACK;
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    assert.match(geminiModelFallback(root), /^gemini-/);
    process.env.GEMINI_MODEL_FALLBACK = 'otro';
    assert.equal(geminiModelFallback(root), 'otro');
  } finally { if (guardado === undefined) delete process.env.GEMINI_MODEL_FALLBACK; else process.env.GEMINI_MODEL_FALLBACK = guardado; }
});
