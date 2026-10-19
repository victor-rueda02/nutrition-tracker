// Completitud: nutrientes OBLIGATORIOS rellenos / total de obligatorios. Un 0 escrito cuenta como relleno.

const hasValue = (food, key) => typeof food.nutrients?.[key] === 'number' && Number.isFinite(food.nutrients[key]);

// Sin datos nutricionales: ni un solo nutriente con valor (un 0 escrito sí cuenta como valor).
export const foodSinDatos = (food) => !Object.values(food?.nutrients ?? {}).some((v) => typeof v === 'number' && Number.isFinite(v));

export function foodCompleteness(food, requiredKeys) {
  const missing = requiredKeys.filter((k) => !hasValue(food, k));
  const total = requiredKeys.length;
  const filled = total - missing.length;
  return { filled, total, ratio: total === 0 ? 1 : filled / total, missing };
}

// Incompleto = por debajo del umbral (justo en el umbral cuenta como completo).
export const isIncomplete = (c, threshold) => c.ratio + 1e-9 < threshold;

// Informe para la pantalla "Alimentos pendientes de completar".
export function completenessReport(foods, { requiredNutrients, completenessThreshold }) {
  const perFood = foods.map((food) => {
    const c = foodCompleteness(food, requiredNutrients);
    return { id: food.id, nombre: food.nombre, ...c, incomplete: isIncomplete(c, completenessThreshold) };
  });
  const incomplete = perFood
    .filter((f) => f.incomplete)
    .sort((a, b) => a.ratio - b.ratio || a.id.localeCompare(b.id));
  return {
    perFood,
    incomplete,
    summary: {
      total: foods.length,
      incomplete: incomplete.length,
      complete: foods.length - incomplete.length,
      threshold: completenessThreshold,
      requiredCount: requiredNutrients.length,
    },
  };
}
