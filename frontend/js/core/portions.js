import { normalizeText, looseKey } from './text.js';
import { parseNumber } from './numbers.js';

// "huevo mediano:50|clara:33" -> [{ nombre, gramos }]. Vacío = sin porciones (sin aviso).
// Las entradas mal formadas se ignoran y se devuelven como avisos.
export function parsePortions(raw) {
  const portions = [];
  const warnings = [];
  const text = String(raw ?? '').trim();
  if (!text) return { portions, warnings };
  const seen = new Set();
  for (const part of text.split('|')) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.lastIndexOf(':');
    if (idx === -1) { warnings.push(`porción "${entry}": falta ":gramos" (se ignora)`); continue; }
    const nombre = entry.slice(0, idx).trim();
    const gramsRaw = entry.slice(idx + 1).trim();
    if (!nombre) { warnings.push(`porción ":${gramsRaw}": falta el nombre (se ignora)`); continue; }
    const n = parseNumber(gramsRaw);
    if (n.status === 'empty') { warnings.push(`porción "${nombre}": falta el peso en gramos (se ignora)`); continue; }
    if (n.status === 'invalid' || !(n.value > 0)) { warnings.push(`porción "${nombre}": peso no válido "${gramsRaw}" (se ignora)`); continue; }
    const key = normalizeText(nombre);
    if (seen.has(key)) { warnings.push(`porción "${nombre}" repetida (se ignora la repetición)`); continue; }
    seen.add(key);
    portions.push({ nombre, gramos: n.value });
  }
  return { portions, warnings };
}

export const serializePortions = (portions) => (portions ?? []).map((p) => `${p.nombre}:${p.gramos}`).join('|');

// Alimento sin ninguna porción definida: "pendiente de definir porción".
export const needsPortion = (food) => !food.porciones || food.porciones.length === 0;

const portionKey = looseKey;

// Convierte "nombre de porción" x cantidad a gramos usando las porciones del alimento.
// Coincidencia exacta; si no, una única porción que empiece por lo dicho (o al revés). Si hay duda -> null.
export function portionToGrams(food, name, quantity = 1) {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  const q = portionKey(name);
  if (!q) return null;
  const list = food.porciones ?? [];
  let match = list.filter((p) => portionKey(p.nombre) === q);
  if (match.length !== 1) {
    match = list.filter((p) => {
      const k = portionKey(p.nombre);
      return k.startsWith(q + ' ') || q.startsWith(k + ' ');
    });
  }
  return match.length === 1 ? match[0].gramos * quantity : null;
}
