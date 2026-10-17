// Prueba el flujo de la IA con frases y muestra entradas y salidas.
//   Simulado (sin red, respuestas de modelo de tests/fixtures/phrases.json):
//     node scripts/try-phrases.mjs --simulated
//   Real (llama a Gemini; una llamada por frase; la clave sale de .env, que git ignora):
//     node --env-file=.env scripts/try-phrases.mjs [--foods data/foods.csv] "frase 1" "frase 2"
//   El modelo es GEMINI_MODEL de worker/wrangler.toml; la variable de entorno GEMINI_MODEL lo sustituye si la pones.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../frontend/js/core/catalog.js';
import { parseFoodsDocument } from '../frontend/js/core/foods-parser.js';
import { buildCompactList } from '../frontend/js/core/ai-contract.js';
import { createDraft } from '../frontend/js/core/draft.js';
import { handleRequest } from '../worker/src/index.js';
import { callGemini } from '../worker/src/providers/gemini.js';

// Rutas siempre con fileURLToPath/resolve (new URL(...).pathname rompe en Windows: "/C:/...").
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (...parts) => resolve(root, ...parts);

const args = process.argv.slice(2);
const simulated = args.includes('--simulated');
const fi = args.indexOf('--foods');
const foodsPath = fi >= 0 ? resolve(args[fi + 1]) : fromRoot('tests', 'fixtures', 'alimentos_iniciales.csv');
const read = (p) => readFileSync(p, 'utf8');
const catalog = buildCatalog(JSON.parse(read(fromRoot('data', 'nutrients.json'))));
const { foods } = parseFoodsDocument(read(foodsPath), { catalog, filename: foodsPath });
const list = buildCompactList(foods);
const names = new Map(foods.map((f) => [f.id, f.nombre]));

const foodsById = new Map(foods.map((f) => [f.id, f]));

// El modelo sale de UN sitio: GEMINI_MODEL de worker/wrangler.toml (o la variable de entorno, si la pones).
const tomlModel = read(fromRoot('worker', 'wrangler.toml')).match(/^\s*GEMINI_MODEL\s*=\s*"([^"]+)"/m)?.[1];
const model = process.env.GEMINI_MODEL || tomlModel;
if (!model) { console.error('No encuentro GEMINI_MODEL en worker/wrangler.toml.'); process.exit(1); }
const env = { APP_TOKEN: 'local', ALLOWED_ORIGIN: 'http://localhost', GEMINI_MODEL: model, GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? 'simulado' };
const phrases = simulated
  ? JSON.parse(read(fromRoot('tests', 'fixtures', 'phrases.json'))).map((p) => ({ frase: p.frase, modelo: p.modelo_simulado }))
  : args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--foods').map((frase) => ({ frase }));
if (!simulated && !process.env.GEMINI_API_KEY) {
  console.error('Falta la variable GEMINI_API_KEY. Ponla en .env y ejecuta: node --env-file=.env scripts/try-phrases.mjs "frase" (o usa --simulated).');
  process.exit(1);
}

console.log(`Documento: ${foods.length} alimentos, ${list.length} enviados a la IA (sin nutrientes)`);
console.log(`Modelo: ${simulated ? 'simulado' : model}\n`);
let totalCalls = 0; // llamadas reales a Gemini, reintentos incluidos (la cuota es limitada)
for (const p of phrases) {
  console.log(`ENTRADA: "${p.frase}"`);
  if (p.modelo) console.log(`  [modelo simulado] ${JSON.stringify(p.modelo)}`);
  const request = new Request('https://local/parse', { method: 'POST', headers: { 'X-App-Token': 'local' }, body: JSON.stringify({ texto: p.frase, alimentos: list }) });
  let calls = 0;
  const res = await handleRequest(request, env, p.modelo
    ? { callModel: async () => JSON.stringify(p.modelo) }
    : { callModel: (e, a) => { calls++; return callGemini({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL, ...a }); } });
  totalCalls += calls;
  const body = await res.json();
  if (!simulated) console.log(`  [${calls} llamada${calls === 1 ? '' : 's'} a Gemini]`);
  if (res.status !== 200) { console.log(`  ERROR ${res.status}: ${JSON.stringify(body)}\n`); continue; }
  // Lo que vería la app en la confirmación (incluye la conversión ml -> g con densidad_g_ml).
  const d = createDraft({ text: p.frase, meal: 'otro', result: body, foodsById });
  const ml = new Map(body.items.filter((i) => i.ml).map((i) => [i.source_text, i.ml]));
  for (const l of d.lines) console.log(`  → ${l.food_id} (${names.get(l.food_id)}) ${l.grams} g${ml.has(l.source_text) ? ` (de ${ml.get(l.source_text)} ml)` : ''} · confianza ${l.confidence}${l.flags.length ? ' · ' + l.flags.join(', ') : ''}`);
  for (const u of d.unmatched) console.log(`  ✗ no reconocido: "${u.text}" (${u.motivo}${u.food_id ? ', ' + u.food_id : ''})`);
  for (const w of d.warnings) console.log(`  ! ${w}`);
  console.log('');
}
if (!simulated) console.log(`Total: ${totalCalls} llamada${totalCalls === 1 ? '' : 's'} a Gemini para ${phrases.length} frase${phrases.length === 1 ? '' : 's'}.`);
