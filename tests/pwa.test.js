import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fe = join(root, 'frontend');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p) => relative(fe, p).split(sep).join('/');

test('service worker: precachea TODOS los ficheros de la app (y solo ficheros que existen)', () => {
  const sw = readFileSync(join(fe, 'sw.js'), 'utf8');
  const list = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const a of list) if (a !== './') assert.ok(existsSync(resolve(fe, a)), `no existe: ${a}`);
  for (const f of walk(fe).map(rel).filter((p) => p !== 'sw.js')) assert.ok(list.includes(f), `falta en ASSETS: ${f}`);
  for (const d of ['../data/nutrients.json', '../data/settings.json', '../data/targets.json', '../data/foods.csv', '../data/retirados.json']) assert.ok(list.includes(d), d);
});

test('data/retirados.json: se carga como los demás data/*.json y, si falta o no se puede leer, la app arranca igual', () => {
  const main = readFileSync(join(fe, 'js', 'main.js'), 'utf8');
  assert.match(main, /try \{ retirados = JSON\.parse\(await fetchText\('retirados\.json'\)\); \} catch/);
  assert.match(main, /mountApp\(root, \{[^}]*\bretirados\b/);
  const r = JSON.parse(readFileSync(join(root, 'data', 'retirados.json'), 'utf8'));
  assert.equal(r.version, 1);
  assert.ok(Array.isArray(r.retirados) && r.retirados.every((x) => typeof x.id === 'string' && /^\d{4}-\d\d-\d\d$/.test(x.fecha) && typeof x.motivo === 'string'));
});

test('manifiesto e iconos: iOS/Android instalable (PNG con el tamaño declarado)', () => {
  const m = JSON.parse(readFileSync(join(fe, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.lang, 'es');
  for (const icon of m.icons) {
    const buf = readFileSync(resolve(fe, icon.src));
    assert.equal(buf.readUInt32BE(16), Number(icon.sizes.split('x')[0]), icon.src);
    assert.equal(buf.readUInt32BE(20), Number(icon.sizes.split('x')[1]), icon.src);
  }
  assert.equal(readFileSync(join(fe, 'icons', 'apple-touch-icon.png')).readUInt32BE(16), 180);
});

test('index.html: referencias existentes y metadatos de iOS', () => {
  const html = readFileSync(join(fe, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(existsSync(resolve(fe, m[1])), m[1]);
  for (const needle of ['manifest.webmanifest', 'apple-mobile-web-app-capable', 'apple-touch-icon', 'type="module" src="js/main.js"', 'lang="es"']) assert.ok(html.includes(needle), needle);
});

test('todos los imports relativos del frontend apuntan a ficheros que existen', () => {
  for (const f of walk(join(fe, 'js')).filter((p) => p.endsWith('.js'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/from '(\.[^']+)'/g)) assert.ok(existsSync(resolve(dirname(f), m[1])), `${rel(f)} importa ${m[1]}`);
  }
});

test('el frontend no contiene claves ni URLs privadas', () => {
  for (const f of walk(fe).filter((p) => /\.(js|html|json|webmanifest)$/.test(p))) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(t), `${rel(f)} parece contener una clave de Google`);
    assert.ok(!/generativelanguage\.googleapis\.com/.test(t), `${rel(f)} habla directo con Gemini`);
  }
});
