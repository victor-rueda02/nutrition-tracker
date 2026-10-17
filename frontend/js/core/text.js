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
