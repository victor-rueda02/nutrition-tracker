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
// Sin crear cadenas (se llama miles de veces por petición en el Worker): compara longitudes y el sufijo.
export function sameWord(a, b) {
  if (a === b) return true;
  const d = a.length - b.length;
  if (d === 0 || d > 2 || d < -2) return false;
  const [l, s] = d > 0 ? [a, b] : [b, a]; // l = la larga, s = la corta
  return l.startsWith(s) && l.endsWith(Math.abs(d) === 1 ? 's' : 'es');
}

// ¿Aparece el término (sus palabras, seguidas) en el texto? Sin acentos, sin mayúsculas y tolerando plurales.
export function containsTerm(text, term) {
  const t = words(text);
  const w = words(term);
  if (!w.length) return false;
  for (let i = 0; i + w.length <= t.length; i++) if (w.every((x, j) => sameWord(t[i + j], x))) return true;
  return false;
}

// Dónde aparece una secuencia de palabras en otra (ya tokenizadas con `words`): [[inicio, fin)], mismas reglas que
// containsTerm. No normaliza: quien llama tokeniza una vez (el Worker tiene 10 ms de CPU).
export function spansIn(tw, ws) {
  const out = [];
  if (!ws.length) return out;
  for (let i = 0; i + ws.length <= tw.length; i++) if (ws.every((x, j) => sameWord(tw[i + j], x))) out.push([i, i + ws.length]);
  return out;
}

// Dónde aparece el término en el texto, en palabras. Sirve para saber si una aparición queda dentro de otra más larga
// ("pan" dentro de "pan de molde").
export const termSpans = (text, term) => spansIn(words(text), words(term));

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
