// Cálculo determinista de nutrientes. Valores del documento por 100 g x gramos / 100.
// Sin dato (celda vacía) NO es 0: se devuelve null.

const hasValue = (v) => typeof v === 'number' && Number.isFinite(v);

export function assertGrams(grams) {
  if (!hasValue(grams) || grams < 0) throw new RangeError(`Gramos no válidos: ${grams}`);
}

export const nutrientPer100 = (food, key) => (hasValue(food.nutrients?.[key]) ? food.nutrients[key] : null);

// { clave: valor | null } para una cantidad concreta de un alimento.
export function nutrientsForGrams(food, grams, keys) {
  assertGrams(grams);
  const out = {};
  for (const key of keys) {
    const per100 = nutrientPer100(food, key);
    out[key] = per100 === null ? null : (per100 * grams) / 100;
  }
  return out;
}

// Suma líneas [{ food, grams }].
// Por nutriente: value = suma de las líneas con dato (null si ninguna lo tiene),
// missing = ids de alimentos sin dato (el total es parcial si no está vacío), withData = nº de líneas con dato.
export function sumLines(lines, keys) {
  const result = {};
  for (const key of keys) result[key] = { value: null, missing: [], withData: 0 };
  for (const { food, grams } of lines) {
    assertGrams(grams);
    for (const key of keys) {
      const per100 = nutrientPer100(food, key);
      const r = result[key];
      if (per100 === null) {
        if (!r.missing.includes(food.id)) r.missing.push(food.id);
      } else {
        r.value = (r.value ?? 0) + (per100 * grams) / 100;
        r.withData++;
      }
    }
  }
  return result;
}
