// Aviso de totales parciales del Diario: a qué nutrientes afecta y por qué alimentos. Función pura, sin DOM.
// Parte de las filas de diaryReport (lo que muestran el Diario y el informe) y de las comidas del día; no cambia
// cómo se calculan los totales: solo explica qué alimentos del día no traen dato de cada nutriente (celda vacía = sin dato).
import { foodSinDatos } from './completeness.js';

// Importante: kcal y los macros que el Diario muestra como tales (proteína, hidratos y grasa). Fibra, azúcares y
// grasas saturadas, aunque estén entre las filas de macros del informe, cuentan como menores.
export const NUTRIENTES_IMPORTANTES = ['energia_kcal', 'proteina_g', 'hidratos_g', 'grasa_total_g'];
export const MAX_ALIMENTOS_RESUMEN = 3;
export const MAX_NUTRIENTES_RESUMEN = 2;

// «A», «A y B», «A, B y C».
export function listaEs(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

// Etiqueta dentro de una frase: «Vitamina K y colina» (minúscula inicial salvo siglas como «EPA» o «ALA»).
const enFrase = (label) => (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);
const etiquetas = (nutrientes, resumen = false) => listaEs(nutrientes.map((n, i) => {
  const t = resumen && n.clave === 'energia_kcal' ? 'kcal' : n.label;
  return i === 0 && !resumen ? t : enFrase(t);
}));

// Nombre del alimento: el del documento (nombre_corto es solo para los títulos de «¿Qué ceno?»), como en «Sin datos nutricionales».
export function nombreAlimento(food, id) {
  return food?.nombre ?? id;
}

// rows: filas de diaryReport(...).rows (con label, missing, parcial). Devuelve null si no hay nada que avisar o
// { importante, menor }, cada uno null o { nivel, grupos, resumen, completo }:
//   grupos: [{ nutrientes: [{ clave, label }], alimentos: [{ id, nombre }], texto }] agrupados por los mismos alimentos sin dato,
//           los que afectan a más nutrientes primero; los alimentos, de más a menos gramos del día.
//   resumen: una línea para el Diario; completo: el resumen ya dice todo lo que dicen los grupos.
// Quedan fuera: alimentos con 0 g ese día y alimentos sin ningún dato nutricional (ya se avisan aparte como «Sin datos
// nutricionales»; si entraran, afectarían a todos los nutrientes y taparían el aviso útil).
export function avisoParciales(meals, foodsById, rows) {
  const gramos = new Map();
  for (const m of meals) for (const l of m.lines) gramos.set(l.food_id, (gramos.get(l.food_id) ?? 0) + l.grams);
  const cuenta = (id) => (gramos.get(id) ?? 0) > 0 && !foodSinDatos(foodsById.get(id) ?? { nutrients: {} });
  const afectados = rows
    .map((r) => ({ clave: r.clave, label: r.label, ids: (r.missing ?? []).filter(cuenta) }))
    .filter((r) => r.ids.length);
  const nivel = (importante) => {
    const lista = afectados.filter((r) => NUTRIENTES_IMPORTANTES.includes(r.clave) === importante);
    if (!lista.length) return null;
    const porAlimentos = new Map();
    for (const r of lista) {
      const ids = [...r.ids].sort((a, b) => gramos.get(b) - gramos.get(a) || (a < b ? -1 : 1));
      const k = [...ids].sort().join('|');
      if (!porAlimentos.has(k)) porAlimentos.set(k, { nutrientes: [], alimentos: ids.map((id) => ({ id, nombre: nombreAlimento(foodsById.get(id), id) })) });
      porAlimentos.get(k).nutrientes.push({ clave: r.clave, label: r.label });
    }
    const grupos = [...porAlimentos.values()].sort((a, b) => b.nutrientes.length - a.nutrientes.length) // sort estable: empata por orden de filas
      .map((g) => ({ ...g, texto: `${etiquetas(g.nutrientes)}: faltan datos de ${listaEs(g.alimentos.map((a) => a.nombre))}` }));
    const nutrientes = grupos.flatMap((g) => g.nutrientes);
    const alimentos = [...new Map(grupos.flatMap((g) => g.alimentos).map((a) => [a.id, a])).values()];
    const hay = alimentos.slice(0, MAX_ALIMENTOS_RESUMEN).map((a) => a.nombre);
    if (alimentos.length > MAX_ALIMENTOS_RESUMEN) hay.push(`${alimentos.length - MAX_ALIMENTOS_RESUMEN} más`);
    const cuantos = importante || nutrientes.length <= MAX_NUTRIENTES_RESUMEN
      ? etiquetas(nutrientes, true)
      : `${nutrientes.length} nutrientes`;
    return {
      nivel: importante ? 'importante' : 'menor',
      grupos,
      resumen: `${importante ? 'Importante: totales' : 'Totales'} parciales en ${cuantos} (faltan datos de ${listaEs(hay)})`,
      completo: grupos.length === 1 && alimentos.length <= MAX_ALIMENTOS_RESUMEN && (importante || nutrientes.length <= MAX_NUTRIENTES_RESUMEN),
    };
  };
  const importante = nivel(true);
  const menor = nivel(false);
  return importante || menor ? { importante, menor } : null;
}
