// Registro local de frases problemáticas (para pulir el documento: añadir alias o alimentos). Solo en el dispositivo:
// nunca se envía fuera. Se anota la frase dictada con sus líneas problemáticas (no reconocido, confianza baja,
// "no coincide con tus alias") y, al guardar, qué alimento elegiste al final. Funciones puras, sin DOM.
import { newId } from './ids.js';
import { serializeCSV } from './csv.js';

export const MAX_ENTRADAS = 300; // las más antiguas se descartan
export const TIPOS = { no_reconocido: 'No reconocido', sin_alias: 'No coincide con tus alias', confianza_baja: 'Confianza baja' };

// Problemas de una respuesta de la IA (ya validada): un problema por línea, el más importante.
export function problemsFromResult(result) {
  const out = (result.unmatched ?? []).map((u) => ({ texto: u.text, tipo: 'no_reconocido', motivo: u.motivo ?? null, food_id: u.food_id ?? null }));
  for (const it of result.items ?? []) {
    if (it.flags?.includes('sin_alias')) out.push({ texto: it.source_text, tipo: 'sin_alias', motivo: null, food_id: it.food_id });
    else if (it.confidence === 'baja') out.push({ texto: it.source_text, tipo: 'confianza_baja', motivo: null, food_id: it.food_id });
  }
  return out;
}

// Entrada nueva (o null si la frase no tuvo problemas).
export function newEntry({ texto, result, now = new Date(), idGen = newId }) {
  const problemas = problemsFromResult(result);
  return problemas.length ? { id: idGen(), fecha: now.toISOString(), texto, problemas: problemas.map((p) => ({ ...p, resolucion: null })) } : null;
}

// Al guardar la comida: qué alimento quedó en la línea de cada problema (por su texto), o "descartado".
export function resolveEntry(entry, lines) {
  return {
    ...entry,
    problemas: entry.problemas.map((p) => {
      const l = lines.find((x) => x.source_text === p.texto);
      return { ...p, resolucion: l ? l.food_id : 'descartado' };
    }),
  };
}

const valida = (e) => e && typeof e.id === 'string' && typeof e.fecha === 'string' && typeof e.texto === 'string' && Array.isArray(e.problemas)
  && e.problemas.every((p) => p && typeof p.texto === 'string' && Object.hasOwn(TIPOS, p.tipo));
export const cleanLog = (raw) => (Array.isArray(raw) ? raw.filter(valida) : []);
export const addEntry = (log, entry, max = MAX_ENTRADAS) => [entry, ...log.filter((e) => e.id !== entry.id)].slice(0, max);
export const updateEntry = (log, entry) => log.map((e) => (e.id === entry.id ? entry : e));
export const removeEntry = (log, id) => log.filter((e) => e.id !== id);

// Importar el registro de una copia: se añaden las frases que no hay (por id), sin pisar las tuyas; lo más reciente
// primero y como mucho MAX_ENTRADAS.
export function mergeLog(local, incoming, max = MAX_ENTRADAS) {
  const ids = new Set(local.map((e) => e.id));
  const nuevas = cleanLog(incoming).filter((e) => !ids.has(e.id));
  const list = [...local, ...nuevas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, max);
  return { list, nuevas: nuevas.filter((e) => list.includes(e)) };
}

// CSV para Excel en español (punto y coma y BOM): una fila por problema.
export function logToCSV(log, foodsById) {
  const nombre = (id) => (id ? foodsById.get(id)?.nombre ?? id : '');
  const resolucion = (r) => (r === null ? 'sin guardar' : r === 'descartado' ? 'descartado' : nombre(r));
  const rows = [['fecha', 'frase', 'texto', 'problema', 'motivo', 'alimento_ia', 'resolucion', 'id_resolucion']];
  for (const e of log) {
    for (const p of e.problemas) rows.push([e.fecha, e.texto, p.texto, TIPOS[p.tipo], p.motivo ?? '', nombre(p.food_id), resolucion(p.resolucion), p.resolucion && p.resolucion !== 'descartado' ? p.resolucion : '']);
  }
  return serializeCSV(rows, { delimiter: ';', bom: true, eol: '\r\n' });
}
