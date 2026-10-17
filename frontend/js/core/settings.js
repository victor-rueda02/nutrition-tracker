// Ajustes de completitud (data/settings.json).
export const DEFAULT_THRESHOLD = 0.8;

// Valida los ajustes contra el catálogo. Devuelve { settings, warnings }.
export function loadSettings(raw, catalog) {
  const warnings = [];
  let threshold = raw?.completenessThreshold;
  if (typeof threshold !== 'number' || !(threshold >= 0 && threshold <= 1)) {
    if (threshold !== undefined) warnings.push('completenessThreshold debe estar entre 0 y 1 (0.8 = 80 %): se usa 0.8');
    threshold = DEFAULT_THRESHOLD;
  }
  const requiredNutrients = [];
  for (const k of Array.isArray(raw?.requiredNutrients) ? raw.requiredNutrients : []) {
    if (!catalog.byKey.has(k)) warnings.push(`requiredNutrients: "${k}" no existe en el catálogo (se ignora)`);
    else if (!requiredNutrients.includes(k)) requiredNutrients.push(k);
  }
  if (requiredNutrients.length === 0) warnings.push('requiredNutrients está vacío: no se puede calcular la completitud');
  return { settings: { completenessThreshold: threshold, requiredNutrients }, warnings };
}
