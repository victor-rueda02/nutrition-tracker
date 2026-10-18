import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../frontend/js/core/catalog.js';
import { loadSettings } from '../frontend/js/core/settings.js';

// Rutas relativas a este fichero, portables a Windows (nada de new URL(...).pathname).
const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), 'utf8');
export const readFile = read;
export const catalog = buildCatalog(JSON.parse(read('../data/nutrients.json')));
export const { settings, warnings: settingsWarnings } = loadSettings(JSON.parse(read('../data/settings.json')), catalog);

// Documento mínimo: cabeceras + filas ya separadas por coma.
export const csv = (...lines) => lines.join('\n') + '\n';

import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { buildCompactList } from '../frontend/js/core/ai-contract.js';
// Documento real de Victor (fixture) y su lista compacta para la IA.
export const realFoods = parseFoodsCSV(read('./fixtures/alimentos_iniciales.csv'), { catalog }).foods;
export const realList = buildCompactList(realFoods);
// Copia CONGELADA del catálogo (18-10-2026, antes de marcar peso_en_crudo en general y excluir merluza_cocida y
// patata_asada) para probar las reglas de variantes con grupos crudo/cocinado. No se actualiza al pulir el catálogo.
export const rulesFoods = parseFoodsCSV(read('./fixtures/reglas_variantes.csv'), { catalog }).foods;
export const rulesList = buildCompactList(rulesFoods);
