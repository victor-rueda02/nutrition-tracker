// Servidor local (scripts/dev-server.mjs): sirve solo frontend/ y data/ y atiende /parse con el código del Worker.
// El modelo es SIMULADO: los tests nunca llaman a Gemini.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createDevServer, staticPath } from '../scripts/dev-server.mjs';
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
