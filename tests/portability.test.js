import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  if (n === 'node_modules' || n.startsWith('.')) return [];
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const sources = ['scripts', 'tests', 'worker', 'frontend'].flatMap((d) => walk(join(root, d))).filter((f) => /\.(m?js)$/.test(f));

test('regresión Windows: new URL(...).pathname da "/C:/..." y fileURLToPath la ruta correcta', () => {
  const url = new URL('file:///C:/Users/Victor/Documents/alimentos.csv');
  assert.equal(url.pathname, '/C:/Users/Victor/Documents/alimentos.csv'); // por eso salía C:\C:\...
  assert.equal(fileURLToPath(url, { windows: true }), 'C:\\Users\\Victor\\Documents\\alimentos.csv');
  assert.equal(fileURLToPath(new URL('file:///home/victor/a.csv'), { windows: false }), '/home/victor/a.csv');
});

test('ningún fichero mezcla import.meta.url con .pathname', () => {
  for (const f of sources.filter((x) => basename(x) !== 'portability.test.js')) {
    for (const [i, line] of readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
      if (line.includes('import.meta.url') && line.includes('.pathname')) assert.fail(`${basename(f)}:${i + 1} usa .pathname con import.meta.url`);
    }
  }
});

test('en scripts/ y tests/, import.meta.url solo se usa dentro de fileURLToPath(...)', () => {
  for (const f of sources.filter((x) => /[\\/](scripts|tests)[\\/]/.test(x) && basename(x) !== 'portability.test.js')) {
    for (const [i, line] of readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
      if (line.includes('import.meta.url')) assert.ok(line.includes('fileURLToPath(import.meta.url)'), `${basename(f)}:${i + 1}: ${line.trim()}`);
    }
  }
});

test('try-phrases --simulated funciona desde cualquier directorio de trabajo', () => {
  const script = join(root, 'scripts', 'try-phrases.mjs');
  // Copia congelada del documento: las frases simuladas de phrases.json se escribieron sobre ella.
  const r = spawnSync(process.execPath, [script, '--simulated', '--foods', join(root, 'tests', 'fixtures', 'reglas_variantes.csv')], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ENTRADA: "para desayunar 80 g de avena/);
  assert.match(r.stdout, /merluza_cruda/);
});

test('try-phrases acepta --foods con ruta absoluta o relativa', () => {
  const script = join(root, 'scripts', 'try-phrases.mjs');
  const abs = join(root, 'tests', 'fixtures', 'alimentos_iniciales.csv');
  const a = spawnSync(process.execPath, [script, '--simulated', '--foods', abs], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /Documento: 69 alimentos, 66 enviados/);
  const b = spawnSync(process.execPath, [script, '--simulated', '--foods', join('tests', 'fixtures', 'alimentos_iniciales.csv')], { cwd: root, encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
});

test('try-phrases sin GEMINI_API_KEY: mensaje claro con el nombre de la variable y sin llamar a la red', () => {
  const script = join(root, 'scripts', 'try-phrases.mjs');
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  const r = spawnSync(process.execPath, [script, 'una frase'], { cwd: root, encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Falta la variable GEMINI_API_KEY/);
  assert.match(r.stderr, /--env-file=\.env/);
});
