// Sin zoom con doble toque en el iPhone, conservando el pellizco: `touch-action: manipulation` en html y un viewport que no
// bloquea el zoom (user-scalable=no o maximum-scale quitarían también el pellizco). Se lee como texto: jsdom no calcula esto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fe = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');

test('styles.css declara touch-action: manipulation en html', () => {
  const css = readFileSync(join(fe, 'css', 'styles.css'), 'utf8');
  assert.match(css, /(^|\n)\s*html\s*\{[^}]*touch-action\s*:\s*manipulation/);
});

test('ningún CSS contradice touch-action: manipulation (none o pan-x/pan-y quitarían el pellizco)', () => {
  for (const f of readdirSync(join(fe, 'css')).filter((n) => n.endsWith('.css'))) {
    const css = readFileSync(join(fe, 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/touch-action\s*:\s*([^;}]+)/g)) {
      assert.match(m[1].trim(), /^(manipulation|auto)$/, `${f}: touch-action ${m[1]}`);
    }
  }
});

test('el viewport de index.html no bloquea el zoom con pellizco', () => {
  const html = readFileSync(join(fe, 'index.html'), 'utf8');
  const vp = html.match(/<meta[^>]*name="viewport"[^>]*>/)[0];
  assert.doesNotMatch(vp, /user-scalable/);
  assert.doesNotMatch(vp, /maximum-scale/);
});
