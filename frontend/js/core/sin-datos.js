// Líneas que no se pueden fiar de los totales: alimentos sin datos nutricionales y fragmentos que suenan a un plato
// y la IA ha partido en varios alimentos. Funciones puras sobre el borrador (sin DOM); la UI solo pinta los avisos
// y llama a estas funciones. Ver CLAUDE.md, sección 4 («Sin datos nutricionales» y «Un plato partido»).
import { foodSinDatos } from './completeness.js';
import { gramsFromText } from './draft.js';
import { containsTerm, words } from './text.js';

export { foodSinDatos };

// Claves de las líneas del borrador cuyo alimento no tiene ningún nutriente (se avisa siempre, venga de donde venga).
export const lineasSinDatos = (d, foodsById) => d.lines
  .filter((l) => foodsById.has(l.food_id) && foodSinDatos(foodsById.get(l.food_id)))
  .map((l) => l.key);

// Texto con el que se estima una línea: lo dicho y, si no trae cantidad, sus gramos.
const textoDeLinea = (l, food) => {
  const base = (l.source_text || food.nombre).trim();
  return gramsFromText(base) === null && l.grams > 0 ? `${l.grams} g de ${base}` : base;
};

// Una línea sin datos pasa a "sin resolver" (motivo no_en_catalogo) para «Estimar con IA». `origen` guarda la línea
// por si se deja sin estimar y se quiere volver (deshacerPlato). Devuelve { draft, index } (índice del sin resolver).
export function lineaAEstimar(d, key, foodsById) {
  const l = d.lines.find((x) => x.key === key);
  const food = l && foodsById.get(l.food_id);
  if (!l || !food) return { draft: d, index: -1 };
  const unmatched = [...d.unmatched, { text: textoDeLinea(l, food), motivo: 'no_en_catalogo', origen: [l] }];
  return { draft: { ...d, lines: d.lines.filter((x) => x.key !== key), unmatched }, index: unmatched.length - 1 };
}

// ---------- un plato partido ----------
// Un fragmento del dictado (entre comas, «y», «+») suena a plato si:
//  · lleva «con» y la IA lo ha repartido en 2 o más alimentos, con a lo sumo una cantidad dicha y antes del «con»
//    ("lentejas con chorizo", "300 g de lasaña con carne"; "170 g de arroz con 2 huevos" pesa cada cosa: no es un plato), o
//  · lleva «casero/a(s)» y la IA lo repartió en 2 o más alimentos. Una sola línea (la receta "lentejas caseras"
//    resuelta como tal) no es un plato partido.
// Las líneas ya estimadas con IA no cuentan. Al editar una comida guardada solo cuenta lo que entró por «Dictar más».
const SEPARADOR = /\s*(?:,|;|\+|\s+y\s+|\s+e\s+)\s*/i;
const NUMERO_PALABRA = new Set(['dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'medio', 'media']);
const cantidades = (ws) => ws.filter((w) => /^\d+$/.test(w) || NUMERO_PALABRA.has(w)).length;
// ¿Hay un «con» con, como mucho, una cantidad antes y ninguna después?
const conUnaCantidad = (seg) => {
  const ws = words(seg);
  const i = ws.indexOf('con');
  return i >= 0 && cantidades(ws.slice(0, i)) <= 1 && cantidades(ws.slice(i + 1)) === 0;
};
const esCasero = (seg) => words(seg).some((w) => /^caser[oa]s?$/.test(w));

// Al editar una comida guardada solo cuenta lo que entró por «Dictar más» (su texto y sus líneas): lo anterior ya estaba guardado.
export function detectarPlatos(d, foodsById) {
  const texto = d.editing ? d.textoMas : d.text;
  if (!texto) return [];
  const candidatas = d.lines.filter((l) => foodsById.has(l.food_id) && !l.flags.includes('estimado_ia') && (!d.editing || l.deMas));
  const usadas = new Set();
  const platos = [];
  for (const seg of texto.split(SEPARADOR).map((s) => s.trim()).filter(Boolean)) {
    const lleva = (l) => {
      if (usadas.has(l.key)) return false;
      const f = foodsById.get(l.food_id);
      return (l.source_text && containsTerm(seg, l.source_text)) || [f.nombre, ...(f.alias ?? [])].some((t) => containsTerm(seg, t));
    };
    const keys = candidatas.filter(lleva).map((l) => l.key);
    const conCon = keys.length >= 2 && conUnaCantidad(seg);
    const casero = esCasero(seg) && keys.length >= 2;
    if (!conCon && !casero) continue;
    keys.forEach((k) => usadas.add(k));
    platos.push({ texto: seg, keys });
  }
  return platos;
}

// «Tratar como un plato y estimar con IA»: las líneas del plato pasan a un solo "sin resolver" con el fragmento dicho.
// Devuelve { draft, index } (índice del sin resolver, para lanzar «Estimar con IA»).
export function tratarComoPlato(d, plato) {
  const origen = d.lines.filter((l) => plato.keys.includes(l.key));
  if (!origen.length) return { draft: d, index: -1 };
  const unmatched = [...d.unmatched, { text: plato.texto, motivo: 'no_en_catalogo', origen }];
  return { draft: { ...d, lines: d.lines.filter((l) => !plato.keys.includes(l.key)), unmatched }, index: unmatched.length - 1 };
}

// Deja sin estimar y vuelve a los alimentos de antes (los que había antes de «Tratar como un plato» o «Estimar con IA»).
export function deshacerPlato(d, index) {
  const u = d.unmatched[index];
  if (!u?.origen) return d;
  return { ...d, lines: [...d.lines, ...u.origen], unmatched: d.unmatched.filter((_, i) => i !== index) };
}

