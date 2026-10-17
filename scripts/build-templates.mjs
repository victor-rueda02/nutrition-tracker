// Genera data/foods.template.csv (solo cabeceras) y data/foods.sample.csv (10 alimentos de ejemplo).
// Uso: npm run build:templates
// OJO: los valores de foods.sample.csv son APROXIMADOS y de ejemplo, no verificados contra USDA.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../frontend/js/core/catalog.js';
import { parseFoodsCSV, foodsToCSV, csvHeader } from '../frontend/js/core/foods-parser.js';
import { serializeCSV } from '../frontend/js/core/csv.js';
import { WORK_COLUMNS } from '../frontend/js/core/schema.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = (name) => resolve(root, 'data', name);

const catalog = buildCatalog(JSON.parse(readFileSync(data('nutrients.json'), 'utf8')));
const extraHeaders = ['termino_busqueda_usda', 'tipo', 'incluir', 'notas'];
if (!extraHeaders.every((h) => WORK_COLUMNS.includes(h))) throw new Error('columnas de trabajo desconocidas');

// Plantilla: solo la fila de cabeceras.
writeFileSync(data('foods.template.csv'), serializeCSV([csvHeader(catalog, extraHeaders)], { bom: true }));

const NOTE = 'Valores aproximados de ejemplo; no usar como catálogo';
const sample = [
  { id: 'huevo_grande', nombre: 'Huevo entero crudo', alias: ['huevo', 'huevos', 'huevo entero'], porciones: 'huevo grande:50|clara:33|yema:17', estado: 'crudo',
    n: { energia_kcal: 143, proteina_g: 12.56, grasa_total_g: 9.51, hidratos_g: 0.72, fibra_g: 0, azucares_g: 0.37, grasas_saturadas_g: 3.13, vitamina_a_ug: 160, vitamina_c_mg: 0, vitamina_d_ug: 2, vitamina_e_mg: 1.05, vitamina_k_ug: 0.3, vitamina_b1_mg: 0.04, vitamina_b2_mg: 0.457, vitamina_b3_mg: 0.075, vitamina_b5_mg: 1.533, vitamina_b6_mg: 0.17, vitamina_b9_ug: 47, vitamina_b12_ug: 0.89, colina_mg: 293.8, calcio_mg: 56, hierro_mg: 1.75, magnesio_mg: 12, fosforo_mg: 198, potasio_mg: 138, sodio_mg: 142, zinc_mg: 1.29, cobre_mg: 0.072, manganeso_mg: 0.028, selenio_ug: 30.7, ala_g: 0.033, epa_g: 0, dha_g: 0.058 } },
  { id: 'avena_copos', nombre: 'Avena (copos)', alias: ['avena', 'copos de avena'], porciones: 'cucharada:10', estado: '',
    n: { energia_kcal: 389, proteina_g: 16.9, grasa_total_g: 6.9, hidratos_g: 66.3, fibra_g: 10.6, vitamina_b1_mg: 0.763, vitamina_b2_mg: 0.139, vitamina_b3_mg: 0.961, vitamina_b5_mg: 1.349, vitamina_b6_mg: 0.119, vitamina_b9_ug: 56, calcio_mg: 54, hierro_mg: 4.7, magnesio_mg: 177, fosforo_mg: 523, potasio_mg: 429, sodio_mg: 2, zinc_mg: 3.97, cobre_mg: 0.626, manganeso_mg: 4.9, selenio_ug: 28.9 } },
  { id: 'leche_entera', nombre: 'Leche entera', alias: ['leche', 'leche de vaca'], porciones: 'vaso:250', estado: '', dens: 1.03,
    n: { energia_kcal: 61, proteina_g: 3.15, grasa_total_g: 3.25, hidratos_g: 4.8, fibra_g: 0, vitamina_a_ug: 46, vitamina_c_mg: 0, vitamina_b2_mg: 0.169, vitamina_b12_ug: 0.45, calcio_mg: 113, hierro_mg: 0.03, magnesio_mg: 10, fosforo_mg: 84, potasio_mg: 132, sodio_mg: 43, zinc_mg: 0.37, selenio_ug: 3.7 } },
  { id: 'platano', nombre: 'Plátano', alias: ['plátano', 'platano', 'banana'], porciones: 'unidad mediana:118', estado: 'crudo',
    n: { energia_kcal: 89, proteina_g: 1.09, grasa_total_g: 0.33, hidratos_g: 22.84, fibra_g: 2.6, azucares_g: 12.23, vitamina_c_mg: 8.7, vitamina_b6_mg: 0.367, calcio_mg: 5, hierro_mg: 0.26, magnesio_mg: 27, potasio_mg: 358 } },
  { id: 'arroz_blanco_crudo', nombre: 'Arroz blanco crudo', alias: ['arroz', 'arroz blanco'], porciones: '', estado: 'crudo', grupo: 'arroz_blanco', def: true,
    n: { energia_kcal: 365, proteina_g: 7.13, grasa_total_g: 0.66, hidratos_g: 80, fibra_g: 1.3 } },
  { id: 'arroz_blanco_cocido', nombre: 'Arroz blanco cocido', alias: ['arroz', 'arroz blanco'], porciones: '', estado: 'cocinado', grupo: 'arroz_blanco', def: false,
    n: { energia_kcal: 130, proteina_g: 2.69, grasa_total_g: 0.28, hidratos_g: 28.17, fibra_g: 0.4 } },
  { id: 'aceite_oliva', nombre: 'Aceite de oliva', alias: ['aceite', 'aove', 'aceite de oliva virgen extra'], porciones: 'cucharada:13.5|cucharadita:4.5', estado: '', dens: 0.91,
    n: { energia_kcal: 884, proteina_g: 0, grasa_total_g: 100, hidratos_g: 0, fibra_g: 0, grasas_saturadas_g: 13.8, vitamina_e_mg: 14.35, vitamina_k_ug: 60.2, vitamina_b12_ug: 0 } },
  { id: 'almendras_crudas', nombre: 'Almendras crudas', alias: ['almendras'], porciones: '', estado: 'crudo',
    n: { energia_kcal: 579, proteina_g: 21.15, grasa_total_g: 49.93, hidratos_g: 21.55, fibra_g: 12.5, vitamina_e_mg: 25.63, calcio_mg: 269, hierro_mg: 3.71, magnesio_mg: 270, potasio_mg: 733 } },
  { id: 'yogur_griego_natural', nombre: 'Yogur griego natural entero', alias: ['yogur griego', 'yogur natural'], porciones: 'yogur:125', estado: '',
    n: { energia_kcal: 97, proteina_g: 9, grasa_total_g: 5, hidratos_g: 3.98, fibra_g: 0, calcio_mg: 100, potasio_mg: 141, sodio_mg: 35 } },
  { id: 'kiwi_verde', nombre: 'Kiwi verde', alias: ['kiwi'], porciones: 'unidad:69', estado: 'crudo',
    n: { energia_kcal: 61, proteina_g: 1.14, grasa_total_g: 0.52, hidratos_g: 14.66, fibra_g: 3, azucares_g: 8.99, vitamina_c_mg: 92.7, vitamina_e_mg: 1.46, vitamina_k_ug: 40.3, vitamina_b9_ug: 25, vitamina_b12_ug: 0, calcio_mg: 34, hierro_mg: 0.31, magnesio_mg: 17, potasio_mg: 312 } },
];
const seed = [csvHeader(catalog, extraHeaders)];
for (const s of sample) {
  const row = Object.fromEntries(csvHeader(catalog, extraHeaders).map((h) => [h, '']));
  Object.assign(row, { id: s.id, nombre: s.nombre, alias: s.alias.join('|'), porciones: s.porciones, estado: s.estado, grupo: s.grupo ?? '',
    variante_por_defecto: s.def === true ? 'si' : s.def === false ? 'no' : '', densidad_g_ml: s.dens ?? '', notas: NOTE, ...s.n });
  seed.push(csvHeader(catalog, extraHeaders).map((h) => row[h]));
}
// Pasa por el parser para garantizar que el ejemplo es válido y se exporta con el formato canónico.
const parsed = parseFoodsCSV(serializeCSV(seed), { catalog });
if (!parsed.report.ok) throw new Error(JSON.stringify(parsed.report.errors, null, 2));
writeFileSync(data('foods.sample.csv'), foodsToCSV(parsed.foods, { catalog, extraHeaders: parsed.extraHeaders }));
console.log('OK: data/foods.template.csv y data/foods.sample.csv');
