// Alimentos con incluir=no: no viajan a la IA, así que ella los devuelve como "no reconocido".
// Aquí (en el cliente, sin red) se detecta si lo que dijo el usuario es uno de ellos para ofrecer activarlo.
import { looseKey, normalizeText } from './text.js';

export const isExcluded = (food) => normalizeText(food.extra?.incluir) === 'no';

// ¿Aparece `term` como palabra(s) completas dentro de `text`?
const containsPhrase = (text, term) => {
  const t = ` ${looseKey(text)} `;
  const k = looseKey(term);
  return k !== '' && t.includes(` ${k} `);
};

// Ids de alimentos excluidos cuyo nombre o alias aparece en el texto.
export function findExcludedMatches(text, foods) {
  return foods
    .filter(isExcluded)
    .filter((f) => [f.nombre, ...f.alias].some((term) => containsPhrase(text, term)))
    .map((f) => f.id);
}

// Reescribe los "no reconocidos" de un resultado de la IA: los que corresponden a un alimento excluido pasan a
// motivo "excluido_catalogo" con la lista de candidatos (ids). No toca los que ya traen food_id (sin_porcion).
export function annotateExcluded(result, foods) {
  const unmatched = result.unmatched.map((u) => {
    if (u.motivo === 'sin_porcion' || u.food_id) return u;
    const candidates = findExcludedMatches(u.text, foods);
    return candidates.length ? { ...u, motivo: 'excluido_catalogo', candidates } : u;
  });
  return { ...result, unmatched };
}
