// Script MANUAL para calcular las filas de receta del catálogo a partir de data/recetas.json (formato en
// data/SCHEMA.md). No usa la red ni la IA: nutrientes del propio catálogo × gramos ÷ peso final.
//   node scripts/recetas.mjs [--recetas data/recetas.json] [--foods data/foods.csv]
//       Solo informa: nutrientes obligatorios por receta, cuáles quedan sin dato y por culpa de qué ingrediente.
//   node scripts/recetas.mjs --aplicar [...]
//       Escribe las filas de receta en el catálogo (las crea si no existen). Las recetas con "ejemplo": true nunca
//       se escriben. Fila de receta: estado=cocinado, sin peso_en_crudo, notas "Gramos del plato cocinado".
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../frontend/js/core/catalog.js';
import { loadSettings } from '../frontend/js/core/settings.js';
import { parseFoodsDocument } from '../frontend/js/core/foods-parser.js';
import { parseRecetas, validateRecetas, computeReceta, aplicarRecetas, completitud } from '../frontend/js/core/recetas.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (...p) => resolve(root, ...p);
const read = (p) => readFileSync(p, 'utf8');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? resolve(args[i + 1]) : def; };

const catalog = buildCatalog(JSON.parse(read(fromRoot('data', 'nutrients.json'))));
const { settings } = loadSettings(JSON.parse(read(fromRoot('data', 'settings.json'))), catalog);
const required = settings.requiredNutrients;
const foodsPath = opt('foods', fromRoot('data', 'foods.csv'));
const recetasPath = opt('recetas', fromRoot('data', 'recetas.json'));

const salir = (msg) => { console.error(msg); process.exitCode = 1; };
const csvText = read(foodsPath);
const parsed = parseFoodsDocument(csvText, { catalog, filename: foodsPath });
const { recetas, errores: errJson } = parseRecetas(read(recetasPath));
if (!parsed.report.ok) salir(`${foodsPath} tiene errores; corrígelos antes (importa el documento en la app para verlos)`);
else if (errJson.length) salir(`${recetasPath}: ${errJson.join('; ')}`);
else {
  const foodsById = new Map(parsed.foods.map((f) => [f.id, f]));
  const errores = validateRecetas(recetas, foodsById);
  if (errores.length) salir(`${recetasPath} tiene errores:\n${errores.map((e) => `  - ${e}`).join('\n')}`);
  else {
    const resultados = recetas.map((r) => computeReceta(r, foodsById, catalog.keys));
    for (const [i, res] of resultados.entries()) {
      const r = recetas[i];
      const faltan = required.filter((k) => !(k in res.nutrients));
      console.log(`${r.id}${r.ejemplo ? ' (ejemplo: no se escribe)' : ''}: ${completitud(res, required)}/${required.length} obligatorios · ${res.nutrients.energia_kcal ?? '¿?'} kcal/100 g · peso ${res.pesoIngredientes} g → ${res.pesoFinal} g`);
      for (const k of faltan) console.log(`  sin dato ${k}: falta en ${res.sinDato[k]?.join(', ') ?? '¿?'}`);
      for (const a of res.avisos) console.log(`  ! ${a}`);
    }
    if (args.includes('--aplicar')) {
      const { text, cambios, omitidas } = aplicarRecetas(csvText, recetas, resultados, catalog.keys);
      writeFileSync(foodsPath, text);
      console.log(`\nEscrito ${foodsPath}: ${cambios.map((c) => `${c.id}${c.nueva ? ' (nueva)' : ''}`).join(', ') || 'nada'}${omitidas.length ? ` · ejemplos omitidos: ${omitidas.join(', ')}` : ''}`);
    } else console.log('\nNo se ha escrito nada. Para escribir las filas en el catálogo: --aplicar');
  }
}
