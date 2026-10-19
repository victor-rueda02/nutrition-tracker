// Script MANUAL para completar nutrientes desde FoodData Central (USDA). La app nunca consulta USDA.
// La clave sale de .env (ignorado por git):
//   node --env-file=.env scripts/usda.mjs candidatos [--foods data/foods.csv] [--out usda/eleccion.csv]
//       Busca cada termino_busqueda_usda y escribe usda/eleccion.csv (punto y coma + BOM, para Excel).
//       Tú escribes en la columna "fdcId" el que eliges (o copias el "sugerido"). Con "sin_enriquecer" = si, "filas"
//       deja vacíos B9, B1, B2, B3 y hierro (USDA enriquece harinas y cereales; en España normalmente no).
//       Si vuelves a ejecutarlo, se conservan tus fdcId y sin_enriquecer.
//   node --env-file=.env scripts/usda.mjs filas [--eleccion usda/eleccion.csv] [--foods data/foods.csv] [--sobrescribir]
//       Genera usda/foods.propuesto.csv (tu documento con los nutrientes rellenos) y usda/informe.md (completitud,
//       avisos de fortificación de EE. UU. y valores sospechosos).
//       NUNCA toca data/foods.csv: lo revisas y lo copias tú. Sin --sobrescribir no pisa celdas con valor.
//   --incluir-excluidos | --incluir id1,id2   (en candidatos y filas) también trata los incluir=no (todos o solo esos ids), para volcar
//       datos en ingredientes que solo se usan en recetas SIN activarlos: la fila sigue con incluir=no.
//   node --env-file=.env scripts/usda.mjs buscar "Rice, white, long-grain, raw"
//   node --env-file=.env scripts/usda.mjs fila 169756 [--id arroz_blanco_crudo]
// Las respuestas se guardan en usda/cache/ (fuera de git) para no repetir llamadas.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../frontend/js/core/catalog.js';
import { loadSettings } from '../frontend/js/core/settings.js';
import { parseFoodsDocument, foodsToCSV } from '../frontend/js/core/foods-parser.js';
import { completenessReport } from '../frontend/js/core/completeness.js';
import {
  createUsdaClient, findCandidates, runCandidatos, runFilas, eleccionCSV, readEleccion, informeMarkdown, mapNutrients, countRequired, applyUsda, UsdaError, FNDDS, pct,
} from './usda-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (...p) => resolve(root, ...p);
const read = (p) => readFileSync(p, 'utf8');
const write = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

const [cmd, ...args] = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? resolve(args[i + 1]) : def; };
const CON_VALOR = ['--foods', '--out', '--eleccion', '--id', '--incluir'];
const incluirIdx = args.indexOf('--incluir');
const incluir = args.includes('--incluir-excluidos') ? 'todos' : incluirIdx >= 0 ? String(args[incluirIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
const positional = args.filter((a, i) => !a.startsWith('--') && !CON_VALOR.includes(args[i - 1]));

const nutrientList = JSON.parse(read(fromRoot('data', 'nutrients.json')));
const catalog = buildCatalog(nutrientList);
const { settings } = loadSettings(JSON.parse(read(fromRoot('data', 'settings.json'))), catalog);
const map = JSON.parse(read(fromRoot('data', 'usda-map.json')));
const required = settings.requiredNutrients;
const threshold = settings.completenessThreshold;
const labels = new Map(nutrientList.map((n) => [n.key, n.label]));

const USO = 'Uso: node --env-file=.env scripts/usda.mjs candidatos | filas | buscar "término" | fila <fdcId>';
if (!['candidatos', 'filas', 'buscar', 'fila'].includes(cmd)) { console.error(USO); process.exit(1); }
if (!process.env.USDA_API_KEY) {
  console.error('Falta la variable USDA_API_KEY. Ponla en .env y ejecuta: node --env-file=.env scripts/usda.mjs ' + cmd);
  process.exit(1);
}
// Comprobación de forma (sin mostrar la clave) antes de gastar una llamada: las de api.data.gov son 40 alfanuméricos.
if (/[\s"']/.test(process.env.USDA_API_KEY)) {
  console.error('USDA_API_KEY contiene espacios, saltos o comillas: revisa esa línea de .env (debe ser USDA_API_KEY=tuclave, sola en su línea).');
  process.exit(1);
}
const client = createUsdaClient({ apiKey: process.env.USDA_API_KEY, cacheDir: fromRoot('usda', 'cache') });
const loadFoods = () => {
  const path = opt('foods', fromRoot('data', 'foods.csv'));
  const parsed = parseFoodsDocument(read(path), { catalog, filename: path });
  if (!parsed.report.ok) throw new UsdaError(`${path} tiene errores; corrígelos antes (importa el documento en la app para verlos)`);
  return parsed;
};
const linea = (c) => `${c.fdcId} · ${c.obligatorios}/${c.total} · ${c.tipo}${c.estimado ? ' (estimado)' : ''} · ${c.descripcion}`;

try {
  if (cmd === 'candidatos') {
    const { foods } = loadFoods();
    const out = opt('out', fromRoot('usda', 'eleccion.csv'));
    const { rows, resumen } = await runCandidatos({
      client, foods, map, required, threshold, incluir,
      onProgress: (id, r) => console.log(`${id}: ${r.estado}${r.candidato ? ` → ${linea(r.candidato)}` : ''}`),
    });
    // Conserva lo que ya elegiste (fdcId y sin_enriquecer) si el fichero existe.
    const previo = existsSync(out) ? readEleccion(read(out)).elegidos : [];
    write(out, eleccionCSV(rows, previo));
    console.log(`\nEscrito ${out}${previo.length ? ` (conservadas ${previo.length} elecciones previas)` : ''}`);
    console.log(`Sugerido completo (Foundation/SR Legacy ≥ ${pct(threshold)}): ${resumen.completo}`);
    console.log(`Sugerido completo solo en FNDDS (estimado): ${resumen.completo_estimado}`);
    console.log(`Solo candidatos incompletos: ${resumen.incompleto}`);
    console.log(`Sin candidatos: ${resumen.sin_candidatos}`);
    console.log(`Omitidos (incluir=no, sin término o recetas): ${resumen.omitidos}`);
    console.log(`Llamadas a USDA: ${resumen.llamadas} (el resto, de la caché)`);
  } else if (cmd === 'filas') {
    const { foods, extraHeaders } = loadFoods();
    const eleccion = opt('eleccion', fromRoot('usda', 'eleccion.csv'));
    const r = await runFilas({ client, foods, eleccionText: read(eleccion), map, sobrescribir: args.includes('--sobrescribir'), incluir });
    const headers = [...extraHeaders, ...['fdc_id', 'fuente_usda'].filter((h) => !extraHeaders.includes(h))];
    const outCsv = fromRoot('usda', 'foods.propuesto.csv');
    const outMd = fromRoot('usda', 'informe.md');
    write(outCsv, foodsToCSV(r.propuestos, { catalog, extraHeaders: headers }));
    const report = completenessReport(r.propuestos, settings);
    write(outMd, informeMarkdown({ report, resultado: r.resultado, plan: r.plan, elegidosIds: r.elegidosIds, errores: r.errores, labels, fecha: new Date().toISOString().slice(0, 10) }));
    console.log(`Escrito ${outCsv} y ${outMd}`);
    const ok = r.resultado.filter((x) => !x.error);
    console.log(`Completos: ${report.summary.complete} · incompletos: ${report.summary.incomplete} · con fdcId: ${ok.length}`);
    console.log(`Avisos de fortificación: ${ok.filter((x) => x.fortificacion.length).length} · valores sospechosos: ${ok.filter((x) => x.sospechosos.length).length} (detalle en el informe)`);
    for (const e of [...r.errores, ...r.resultado.filter((x) => x.error).map((x) => `${x.id}: ${x.error}`)]) console.log(`! ${e}`);
    console.log(`Llamadas a USDA: ${client.calls}`);
  } else if (cmd === 'buscar') {
    const termino = positional[0];
    if (!termino) throw new UsdaError('Falta el término: scripts/usda.mjs buscar "Rice, white, long-grain, raw"');
    const r = await findCandidates(client, termino, { map, required, threshold });
    console.log(`Sugerido (${r.estado}): ${r.candidato ? linea(r.candidato) : '—'}\nCandidatos (por completitud):`);
    for (const c of r.candidatos) console.log(`  ${linea(c)}`);
    console.log(`Llamadas a USDA: ${client.calls}`);
  } else if (cmd === 'fila') {
    const fdcId = Number(positional[0]);
    if (!Number.isInteger(fdcId)) throw new UsdaError('Falta el fdcId: scripts/usda.mjs fila 169756 [--id mi_alimento]');
    const [usda] = await client.foods([fdcId]);
    if (!usda) throw new UsdaError(`USDA no devolvió el fdcId ${fdcId}`);
    const i = args.indexOf('--id');
    const id = i >= 0 ? args[i + 1] : 'nuevo_alimento';
    const base = { id, nombre: usda.description, alias: [], porciones: [], estado: '', varianteDefecto: null, grupo: '', densidad: null, pesoEnCrudo: false, nutrients: {}, extra: {} };
    const { foods: [food], resultado: [res] } = applyUsda([base], [{ id, fdcId }], new Map([[fdcId, usda]]), { map });
    const m = mapNutrients(usda, map);
    console.log(foodsToCSV([food], { catalog, extraHeaders: ['fdc_id', 'fuente_usda'], bom: false }));
    console.log(`Obligatorios: ${countRequired(m.values, required)}/${required.length}${usda.dataType === FNDDS ? ' · estimado (FNDDS)' : ''}`);
    for (const n of res.notas) console.log(`Alternativa usada: ${n}`);
    for (const u of res.unidades) console.log(`Unidad no coincide: ${u}`);
    console.log(`Llamadas a USDA: ${client.calls}`);
  }
} catch (e) {
  // exitCode y no process.exit(): salir a la fuerza con conexiones abiertas rompe libuv en Windows.
  if (e instanceof UsdaError) { console.error(e.message); process.exitCode = 1; } else throw e;
}
