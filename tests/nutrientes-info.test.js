// Formato de data/nutrientes-info.json: información estática de cada nutriente para la pantalla «Detalle de nutriente».
// Una entrada por cada clave de data/nutrients.json, en español, con referencias de fuentes fiables (EFSA, NIH ODS,
// AESAN/BEDCA, OMS, Harvard T.H. Chan). Mientras se redacta, "completo": false salta la comprobación de que están todas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const info = JSON.parse(readFileSync(resolve(root, 'data/nutrientes-info.json'), 'utf8'));
const claves = JSON.parse(readFileSync(resolve(root, 'data/nutrients.json'), 'utf8')).map((n) => n.key);

const TEXTOS = ['resumen', 'necesidades', 'deficit', 'exceso', 'fuentes_alimentos', 'consejos'];
const OPCIONALES = ['discrepancias'];
const ORGANISMOS = ['EFSA', 'NIH ODS', 'AESAN', 'BEDCA', 'OMS', 'Harvard T.H. Chan'];
const DOMINIOS = ['efsa.europa.eu', 'efsa.onlinelibrary.wiley.com', 'ods.od.nih.gov', 'aesan.gob.es', 'bedca.net', 'who.int', 'hsph.harvard.edu', 'nutritionsource.hsph.harvard.edu'];
const MAX_PALABRAS = 220; // objetivo 150-200 por nutriente, con algo de margen
const palabras = (s) => s.trim().split(/\s+/).filter(Boolean).length;

test('nutrientes-info: estructura general', () => {
  assert.equal(info.version, 1);
  assert.equal(typeof info.completo, 'boolean');
  assert.equal(typeof info.nutrientes, 'object');
  for (const k of Object.keys(info.nutrientes)) assert.ok(claves.includes(k), `clave desconocida: ${k}`);
});

test('nutrientes-info: cada entrada tiene sus textos, ≤ 220 palabras y referencias de fuentes permitidas', () => {
  for (const [k, e] of Object.entries(info.nutrientes)) {
    for (const campo of Object.keys(e)) assert.ok([...TEXTOS, ...OPCIONALES, 'referencias'].includes(campo), `${k}: campo desconocido ${campo}`);
    for (const campo of TEXTOS) assert.ok(typeof e[campo] === 'string' && e[campo].trim().length > 0, `${k}: falta ${campo}`);
    if (e.discrepancias !== undefined) assert.ok(typeof e.discrepancias === 'string' && e.discrepancias.trim(), `${k}: discrepancias vacío`);
    const total = [...TEXTOS, ...OPCIONALES].reduce((n, c) => n + (e[c] ? palabras(e[c]) : 0), 0);
    assert.ok(total <= MAX_PALABRAS, `${k}: ${total} palabras (máximo ${MAX_PALABRAS})`);
    assert.ok(Array.isArray(e.referencias) && e.referencias.length > 0, `${k}: sin referencias`);
    for (const r of e.referencias) {
      assert.ok(ORGANISMOS.includes(r.organismo), `${k}: organismo no permitido ${r.organismo}`);
      assert.ok(typeof r.titulo === 'string' && r.titulo.trim(), `${k}: referencia sin título`);
      const u = new URL(r.url);
      assert.equal(u.protocol, 'https:', `${k}: ${r.url} no es https`);
      assert.ok(DOMINIOS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`)), `${k}: dominio no permitido ${u.hostname}`);
      assert.match(r.consultado, /^\d{4}-\d{2}-\d{2}$/, `${k}: fecha de consulta ${r.consultado}`);
    }
  }
});

test('nutrientes-info: una entrada por cada nutriente de data/nutrients.json', (t) => {
  if (!info.completo) { t.skip('"completo": false (en redacción)'); return; }
  const faltan = claves.filter((k) => !info.nutrientes[k]);
  assert.deepEqual(faltan, [], `faltan: ${faltan.join(', ')}`);
});
