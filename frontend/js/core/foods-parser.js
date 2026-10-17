// Parser y validador del documento de alimentos (CSV o JSON) -> catálogo en memoria.
// Funciones puras: sin DOM ni red, para poder probarlas con Node.
import { parseCSV, serializeCSV } from './csv.js';
import { parseNumber } from './numbers.js';
import { parsePortions, serializePortions } from './portions.js';
import { normalizeText } from './text.js';
import { stripUnit } from './catalog.js';
import { CORE_COLUMNS, LEGACY_HEADERS, WORK_COLUMNS, ESTADOS, ESTADO_SYNONYMS, ID_PATTERN, DENSIDAD_RANGO } from './schema.js';

const add = (report, level, message, ctx = {}) => report[level].push({ message, ...ctx });

// ---------- Cabeceras ----------
function mapHeaders(rawHeaders, catalog, report) {
  const columns = [];
  const seen = new Map();
  let fatal = false;
  rawHeaders.forEach((raw, index) => {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return; // columna sin cabecera: se ignora
    let key = trimmed.toLowerCase();
    if (LEGACY_HEADERS[key]) {
      add(report, 'info', `cabecera "${trimmed}" interpretada como "${LEGACY_HEADERS[key]}"`);
      key = LEGACY_HEADERS[key];
    }
    let kind;
    if (CORE_COLUMNS.includes(key)) kind = 'core';
    else if (catalog.byKey.has(key)) kind = 'nutrient';
    else {
      kind = 'extra';
      if (WORK_COLUMNS.includes(key)) {
        // columna de trabajo conocida: se conserva
      } else {
        key = trimmed;
        const similar = catalog.stems.get(stripUnit(trimmed.toLowerCase()));
        add(report, 'warnings', similar
          ? `cabecera "${trimmed}": ¿querías "${similar}"? La unidad no coincide, así que se trata como columna desconocida (se conserva pero no se usa)`
          : `cabecera desconocida "${trimmed}": se conserva pero no se usa en los cálculos`);
      }
    }
    if (seen.has(key)) {
      add(report, 'errors', `cabecera repetida "${key}" (columnas ${seen.get(key) + 1} y ${index + 1})`);
      fatal = true;
      return;
    }
    seen.set(key, index);
    columns.push({ index, key, kind });
  });
  for (const req of ['id', 'nombre']) {
    if (!seen.has(req)) { add(report, 'errors', `falta la columna obligatoria "${req}"`); fatal = true; }
  }
  return { columns, fatal };
}

function parseBool(raw) {
  const s = normalizeText(raw);
  if (s === '') return { value: null };
  if (['si', 'true', '1', 'x', 'yes'].includes(s)) return { value: true };
  if (['no', 'false', '0'].includes(s)) return { value: false };
  return { value: null, invalid: true };
}

// ---------- Filas ----------
function buildFoods(table, columns, nHeaders, catalog, report, delimiter) {
  const foods = [];
  const seenIds = new Map();
  const extraHeaders = columns.filter((c) => c.kind === 'extra').map((c) => c.key);

  table.rows.forEach((cells, r) => {
    const row = table.rowNumbers[r];
    const val = {};
    for (const c of columns) val[c.key] = String(cells[c.index] ?? '').trim();
    const id = val.id ?? '';
    const ctx = { row, id: id || undefined };
    const errs = [];
    const warn = (field, message) => add(report, 'warnings', message, { ...ctx, field });

    if (cells.length > nHeaders && cells.slice(nHeaders).some((c) => String(c).trim() !== '')) {
      warn(undefined, 'la fila tiene más celdas que cabeceras (las sobrantes se ignoran)');
    }

    if (!id) errs.push(['id', 'falta el id']);
    else if (!ID_PATTERN.test(id)) errs.push(['id', `id "${id}" no válido: usa minúsculas, números y guiones bajos (ej. arroz_blanco_crudo)`]);
    else if (seenIds.has(id)) errs.push(['id', `id duplicado (ya definido en la fila ${seenIds.get(id)})`]);
    if (!val.nombre) errs.push(['nombre', 'falta el nombre']);

    // nutrientes: vacío = sin dato; 0 = cero real
    const nutrients = {};
    for (const c of columns.filter((x) => x.kind === 'nutrient')) {
      const n = parseNumber(val[c.key]);
      if (n.status === 'empty') continue;
      if (n.status === 'invalid') { errs.push([c.key, `valor no numérico "${val[c.key]}" (deja la celda vacía si no hay dato)`]); continue; }
      if (n.value < 0) { errs.push([c.key, `valor negativo ${n.value}`]); continue; }
      if (n.comma && delimiter === ',') warn(c.key, `coma decimal interpretada en "${val[c.key]}" → ${n.value}`);
      if (c.key.endsWith('_g') && n.value > 100) warn(c.key, `${n.value} g por 100 g es imposible (¿error de unidad?)`);
      if (c.key === 'energia_kcal' && n.value > 950) warn(c.key, `${n.value} kcal por 100 g es inusualmente alto`);
      nutrients[c.key] = n.value;
    }

    if (errs.length) {
      for (const [field, message] of errs) add(report, 'errors', message, { ...ctx, field });
      return;
    }
    seenIds.set(id, row);

    const alias = [];
    const aliasSeen = new Set();
    for (const a of (val.alias ?? '').split('|').map((s) => s.trim()).filter(Boolean)) {
      const k = normalizeText(a);
      if (!aliasSeen.has(k)) { aliasSeen.add(k); alias.push(a); }
    }

    const { portions: porciones, warnings: pw } = parsePortions(val.porciones);
    pw.forEach((m) => warn('porciones', m));

    let estado = (val.estado ?? '').toLowerCase();
    estado = ESTADO_SYNONYMS[estado] ?? estado;
    if (estado && !ESTADOS.includes(estado)) warn('estado', `estado "${val.estado}" no reconocido (valores: ${ESTADOS.join(', ')})`);

    const bool = parseBool(val.variante_por_defecto);
    if (bool.invalid) warn('variante_por_defecto', `valor "${val.variante_por_defecto}" no válido (usa si/no)`);

    let grupo = val.grupo ?? '';
    if (grupo && !ID_PATTERN.test(grupo)) { warn('grupo', `grupo "${grupo}" no válido (mismo formato que un id); se ignora`); grupo = ''; }

    // densidad_g_ml: opcional; un valor no válido se ignora con aviso (el alimento sigue valiendo, solo sin conversión de ml).
    let densidad = null;
    const dn = parseNumber(val.densidad_g_ml);
    if (dn.status === 'invalid' || (dn.status === 'ok' && !(dn.value > 0))) warn('densidad_g_ml', `densidad "${val.densidad_g_ml}" no válida (g/ml, mayor que 0); se ignora`);
    else if (dn.status === 'ok') {
      densidad = dn.value;
      if (dn.comma && delimiter === ',') warn('densidad_g_ml', `coma decimal interpretada en "${val.densidad_g_ml}" → ${dn.value}`);
      if (densidad < DENSIDAD_RANGO[0] || densidad > DENSIDAD_RANGO[1]) warn('densidad_g_ml', `densidad ${densidad} g/ml fuera de lo habitual (${DENSIDAD_RANGO.join('–')}): ¿error de unidad?`);
    }

    // peso_en_crudo: si = lo peso siempre en crudo; las palabras de cocinado no cambian de variante. Vacío = no.
    const crudo = parseBool(val.peso_en_crudo);
    if (crudo.invalid) warn('peso_en_crudo', `valor "${val.peso_en_crudo}" no válido (usa si/no); se toma como no`);

    const extra = {};
    for (const h of extraHeaders) if (val[h]) extra[h] = val[h];

    foods.push({ id, nombre: val.nombre, alias, porciones, estado, varianteDefecto: bool.value, grupo, densidad, pesoEnCrudo: crudo.value === true, nutrients, extra });
  });
  return { foods, extraHeaders };
}

// ---------- Comprobaciones entre alimentos ----------
function crossChecks(foods, report) {
  const groups = new Map();
  for (const f of foods) if (f.grupo) (groups.get(f.grupo) ?? groups.set(f.grupo, []).get(f.grupo)).push(f);
  for (const [g, members] of groups) {
    if (members.length < 2) continue;
    const defaults = members.filter((m) => m.varianteDefecto === true);
    if (defaults.length === 0) add(report, 'warnings', `grupo "${g}": ninguna variante tiene variante_por_defecto=si (${members.map((m) => m.id).join(', ')})`, { field: 'variante_por_defecto' });
    else if (defaults.length > 1) add(report, 'warnings', `grupo "${g}": varias variantes por defecto (${defaults.map((m) => m.id).join(', ')})`, { field: 'variante_por_defecto' });
  }
  const owners = new Map();
  for (const f of foods) {
    for (const term of [f.nombre, ...f.alias]) {
      const k = normalizeText(term);
      (owners.get(k) ?? owners.set(k, new Set()).get(k)).add(f.id);
    }
  }
  const groupOf = new Map(foods.map((f) => [f.id, f.grupo]));
  for (const [term, ids] of owners) {
    if (ids.size < 2) continue;
    const gs = new Set([...ids].map((id) => groupOf.get(id)));
    if (gs.size === 1 && [...gs][0]) continue; // variantes del mismo grupo comparten alias a propósito
    add(report, 'warnings', `"${term}" identifica a varios alimentos (${[...ids].join(', ')}): la IA podría confundirlos`, { field: 'alias' });
  }
}

function finish(foods, extraHeaders, report, rows, delimiter, rowLabel) {
  crossChecks(foods, report);
  return {
    foods,
    extraHeaders,
    delimiter,
    report: { ...report, ok: report.errors.length === 0, rowLabel, summary: { rows, imported: foods.length, rejected: rows - foods.length } },
  };
}

const emptyResult = (report, rowLabel) => ({
  foods: [], extraHeaders: [],
  report: { ...report, ok: false, rowLabel, summary: { rows: 0, imported: 0, rejected: 0 } },
});

// ---------- CSV ----------
export function parseFoodsCSV(text, { catalog }) {
  const report = { errors: [], warnings: [], info: [] };
  const table = parseCSV(text);
  if (table.unterminatedQuote) add(report, 'warnings', 'el CSV termina con unas comillas sin cerrar');
  if (table.rows.length === 0) { add(report, 'errors', 'el documento está vacío'); return emptyResult(report, 'fila'); }
  const header = table.rows[0];
  const dataTable = { rows: table.rows.slice(1), rowNumbers: table.rowNumbers.slice(1) };
  const { columns, fatal } = mapHeaders(header, catalog, report);
  if (fatal) return emptyResult(report, 'fila');
  const hidden = header.map((h, i) => ({ h, i })).filter(({ h }) => !String(h).trim());
  for (const { i } of hidden) {
    if (dataTable.rows.some((cells) => String(cells[i] ?? '').trim() !== '')) add(report, 'warnings', `la columna ${i + 1} tiene datos pero no cabecera (se ignora)`);
  }
  const { foods, extraHeaders } = buildFoods(dataTable, columns, header.length, catalog, report, table.delimiter);
  return finish(foods, extraHeaders, report, dataTable.rows.length, table.delimiter, 'fila');
}

// ---------- JSON ----------
// Lista de objetos (o { "foods": [...] }) con las mismas claves que las columnas del CSV.
// alias/porciones pueden ser texto "a|b" o listas; un nutriente ausente o null = sin dato.
function jsonCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'si' : 'no';
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? `${x.nombre}:${x.gramos}` : String(x))).join('|');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}:${x}`).join('|');
  return String(v);
}

export function parseFoodsJSON(text, { catalog }) {
  const report = { errors: [], warnings: [], info: [] };
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) {
    add(report, 'errors', `JSON no válido: ${e.message}`);
    return emptyResult(report, 'elemento');
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.foods) ? data.foods : null;
  if (!list) { add(report, 'errors', 'el JSON debe ser una lista de alimentos o un objeto {"foods": [...]}'); return emptyResult(report, 'elemento'); }
  const headers = [];
  const seen = new Set();
  for (const o of list) {
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
  }
  const rows = list.map((o) => headers.map((h) => jsonCell(o && typeof o === 'object' ? o[h] : undefined)));
  const { columns, fatal } = mapHeaders(headers, catalog, report);
  if (fatal) return emptyResult(report, 'elemento');
  const table = { rows, rowNumbers: rows.map((_, i) => i + 1) };
  const { foods, extraHeaders } = buildFoods(table, columns, headers.length, catalog, report, '.');
  return finish(foods, extraHeaders, report, rows.length, null, 'elemento');
}

// Elige CSV o JSON por extensión o por el primer carácter.
export function parseFoodsDocument(text, { catalog, filename = '' }) {
  const isJson = /\.json$/i.test(filename) || (!/\.csv$/i.test(filename) && /^[\s\uFEFF]*[[{]/.test(text));
  return isJson ? parseFoodsJSON(text, { catalog }) : parseFoodsCSV(text, { catalog });
}

// ---------- Exportación ----------
export const csvHeader = (catalog, extraHeaders = []) => [...CORE_COLUMNS, ...catalog.keys, ...extraHeaders];

// decimalComma: números con coma decimal (para Excel en español, con delimiter ';').
export function foodsToCSV(foods, { catalog, extraHeaders = [], delimiter = ',', bom = true, decimalComma = false } = {}) {
  const num = (n) => (typeof n === 'number' ? (decimalComma ? String(n).replace('.', ',') : n) : '');
  const rows = [csvHeader(catalog, extraHeaders)];
  for (const f of foods) {
    rows.push([
      f.id, f.nombre, f.alias.join('|'), serializePortions(f.porciones), f.estado,
      f.varianteDefecto === true ? 'si' : f.varianteDefecto === false ? 'no' : '', f.grupo,
      num(f.densidad), f.pesoEnCrudo ? 'si' : '',
      ...catalog.keys.map((k) => num(f.nutrients[k])),
      ...extraHeaders.map((h) => f.extra[h] ?? ''),
    ]);
  }
  return serializeCSV(rows, { delimiter, bom });
}

export function foodsToJSON(foods) {
  const out = foods.map((f) => ({
    id: f.id, nombre: f.nombre, alias: f.alias, porciones: f.porciones, estado: f.estado,
    variante_por_defecto: f.varianteDefecto, grupo: f.grupo, densidad_g_ml: f.densidad ?? null, peso_en_crudo: f.pesoEnCrudo === true, ...f.nutrients, ...f.extra,
  }));
  return JSON.stringify({ formatVersion: 1, foods: out }, null, 2);
}

// Texto legible de un aviso/error para la pantalla de informe.
export function formatIssue(issue, rowLabel = 'fila') {
  const where = issue.row ? `${rowLabel} ${issue.row}` : 'documento';
  const id = issue.id ? ` [${issue.id}]` : '';
  const field = issue.field ? ` · ${issue.field}` : '';
  return `${where}${id}${field}: ${issue.message}`;
}
