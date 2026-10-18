import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/src/index.js';
import { rulesList, readFile } from './helpers.js';

const phrases = JSON.parse(readFile('./fixtures/phrases.json'));
const env = { APP_TOKEN: 't', ALLOWED_ORIGIN: 'https://x.github.io', GEMINI_MODEL: 'm', GEMINI_API_KEY: 'k' };

// Frases de ejemplo sobre la copia congelada del documento real (helpers.js) con una respuesta del modelo SIMULADA (no es Gemini):
// prueba la capa determinista (validación, variantes, gramos), no la calidad del modelo.
for (const p of phrases) {
  test(`frase: "${p.frase}"`, async () => {
    const request = new Request('https://w.example/parse', { method: 'POST', headers: { 'X-App-Token': 't' }, body: JSON.stringify({ texto: p.frase, alimentos: rulesList }) });
    const res = await handleRequest(request, env, { callModel: async () => JSON.stringify(p.modelo_simulado) });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.items.map((i) => [i.food_id, i.grams, i.confidence]), p.esperado.items);
    assert.deepEqual(body.unmatched.map((u) => [u.text, u.motivo]), p.esperado.unmatched);
  });
}
