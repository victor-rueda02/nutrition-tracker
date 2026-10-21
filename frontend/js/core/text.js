// Normaliza texto para comparar: minúsculas, sin acentos, espacios colapsados.
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Clave "laxa" para comparar frases: sin acentos, minúsculas y plural simple por palabra
// ("huevos grandes" = "huevo grande").
const singularWord = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
export const looseKey = (s) => normalizeText(s).split(' ').map(singularWord).join(' ');

// Palabras de un texto normalizado; los signos separan ("Chocolate 85%" -> ["chocolate", "85"]).
export const words = (s) => normalizeText(s).split(/[^a-z0-9]+/).filter(Boolean);
// Misma palabra tolerando el plural simple ("huevo" ~ "huevos", "macarron" ~ "macarrones").
export const sameWord = (a, b) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

// ¿Aparece el término (sus palabras, seguidas) en el texto? Sin acentos, sin mayúsculas y tolerando plurales.
export function containsTerm(text, term) {
  const t = words(text);
  const w = words(term);
  if (!w.length) return false;
  for (let i = 0; i + w.length <= t.length; i++) if (w.every((x, j) => sameWord(t[i + j], x))) return true;
  return false;
}

// Dónde aparece el término en el texto: [[inicio, fin)] en palabras, mismas reglas que containsTerm. Sirve para saber si
// una aparición queda dentro de otra más larga ("pan" dentro de "pan de molde").
export function termSpans(text, term) {
  const t = words(text);
  const w = words(term);
  const out = [];
  if (!w.length) return out;
  for (let i = 0; i + w.length <= t.length; i++) if (w.every((x, j) => sameWord(t[i + j], x))) out.push([i, i + w.length]);
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// El texto normalizado sin las apariciones de estos términos (tolerando plurales). Sirve para no confundir un número
// del nombre ("chocolate 85") con una cantidad dicha. Sin lookbehind, por compatibilidad con Safari antiguos.
export function removeTerms(text, terms) {
  let t = normalizeText(text);
  const lista = [...new Set(terms.map(normalizeText).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const term of lista) {
    const ws = words(term);
    if (!ws.length) continue;
    const re = new RegExp(`(^|[^a-z0-9])${ws.map((w) => `${escapeRe(w)}(?:e?s)?`).join('[^a-z0-9]+')}(?=$|[^a-z0-9])`, 'g');
    t = t.replace(re, '$1 ');
  }
  return t;
}
