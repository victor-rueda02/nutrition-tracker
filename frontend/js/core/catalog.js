// Catálogo de columnas de nutrientes (data/nutrients.json): clave, etiqueta y grupo.
// La unidad va en el sufijo de la clave: _g, _mg, _ug, _kcal.
export const UNIT_SUFFIX = /_(kcal|mg|ug|g)$/;
export const stripUnit = (key) => key.replace(UNIT_SUFFIX, '');
export const unitOf = (key) => (key.match(UNIT_SUFFIX) || [])[1] ?? '';

export function buildCatalog(list) {
  const byKey = new Map();
  for (const n of list) {
    if (!n.key || byKey.has(n.key)) throw new Error(`Catálogo de nutrientes: clave vacía o duplicada "${n.key}"`);
    byKey.set(n.key, n);
  }
  const stems = new Map(); // clave sin unidad -> clave completa (para detectar unidades equivocadas)
  for (const k of byKey.keys()) stems.set(stripUnit(k), k);
  return { list, byKey, keys: [...byKey.keys()], stems };
}
