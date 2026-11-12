// Catálogo para las herramientas de la dieta: data/foods.csv del repositorio (el mismo que publica la app).
// Nutrientes = valor por 100 g × gramos / 100; celda vacía = sin dato (regla 4).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const { buildCatalog } = await imp('frontend/js/core/catalog.js');
const { parseFoodsCSV } = await imp('frontend/js/core/foods-parser.js');
const catalog = buildCatalog(JSON.parse(readFileSync(resolve(ROOT, 'data/nutrients.json'), 'utf8')));
const foods = parseFoodsCSV(readFileSync(resolve(ROOT, 'data/foods.csv'), 'utf8'), { catalog }).foods;
export const F = new Map(foods.map((f) => [f.id, f]));
export const KEYS = catalog.keys;
