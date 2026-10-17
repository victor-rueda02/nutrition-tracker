// Hito 4, paso 4: preparación del despliegue (GitHub Pages + Worker) y README al día con el código.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../worker/src/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));

test('GitHub Pages publica la raíz: index.html redirige a la app y .nojekyll sirve los ficheros tal cual', () => {
  const html = read('index.html');
  assert.match(html, /http-equiv="refresh" content="0; url=frontend\/"/);
  assert.match(html, /href="frontend\/"/);
  assert.ok(existsSync(resolve(root, '.nojekyll')));
  const manifest = JSON.parse(read('frontend/manifest.webmanifest'));
  assert.deepEqual([manifest.start_url, manifest.scope], ['./', './']); // rutas relativas: vale bajo /TU-REPO/frontend/
});

test('README: los comandos y scripts que cita existen', () => {
  const npmRuns = [...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  assert.ok(npmRuns.length >= 8);
  for (const s of new Set(npmRuns)) assert.ok(pkg.scripts[s], `npm run ${s}`);
  for (const m of readme.matchAll(/scripts\/([\w-]+\.mjs)/g)) assert.ok(existsSync(resolve(root, 'scripts', m[1])), m[1]);
  for (const f of ['data/SCHEMA.md', 'worker/wrangler.toml', 'data/foods.csv', 'data/targets.json']) assert.ok(readme.includes(f) && existsSync(resolve(root, f)), f);
});

test('README: la respuesta de /health que enseña es la real (Worker configurado, sin token)', async () => {
  const ejemplo = readme.match(/`(\{"ok":true[^`]*\})`/)[1];
  const env = { GEMINI_MODEL: 'm', GEMINI_API_KEY: 'k', APP_TOKEN: 't', ALLOWED_ORIGIN: 'https://x.github.io' };
  const r = await handleRequest(new Request('https://w.dev/health'), env);
  assert.equal(await r.text(), ejemplo);
});

test('wrangler.toml: modelo y origen en [vars]; ningún secreto en el repositorio', () => {
  const toml = read('worker/wrangler.toml');
  assert.match(toml, /^GEMINI_MODEL = "/m);
  assert.match(toml, /^ALLOWED_ORIGIN = "https:\/\/[^/"]+"$/m); // solo el origen, sin ruta ni barra final
  for (const secreto of [/^GEMINI_API_KEY\s*=/m, /^APP_TOKEN\s*=/m, /^USDA_API_KEY\s*=/m]) assert.doesNotMatch(toml, secreto);
  const ignore = read('.gitignore');
  for (const l of ['.env', '.dev.vars', '.wrangler/']) assert.ok(ignore.split(/\r?\n/).includes(l), l);
});

test('wrangler solo como dependencia de desarrollo; ninguna dependencia de ejecución', () => {
  assert.ok(pkg.devDependencies.wrangler);
  assert.equal(pkg.dependencies, undefined);
});
