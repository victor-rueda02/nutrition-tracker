// Interfaz de almacenamiento (la implementan idb-store.js para el navegador y esta versión en memoria para tests).
//   getCatalogRecord() -> { foods, extraHeaders, name, importedAt } | null     putCatalogRecord(rec)
//   getSetting(key) -> valor | undefined                                       setSetting(key, value)
//   addMeal(rec) inserta o sustituye (mismo id: así se guarda una comida editada)   listMealsByDate('YYYY-MM-DD') -> [rec] por hora de creación  allMeals()   deleteMeal(id)
const clone = (v) => (v === undefined ? v : structuredClone(v));

export function createMemoryStore() {
  let catalog = null;
  const settings = new Map();
  const meals = new Map();
  const byCreated = (a, b) => a.createdAt.localeCompare(b.createdAt);
  return {
    async getCatalogRecord() { return clone(catalog); },
    async putCatalogRecord(rec) { catalog = clone(rec); },
    async getSetting(key) { return clone(settings.get(key)); },
    async setSetting(key, value) { settings.set(key, clone(value)); },
    async addMeal(rec) { meals.set(rec.id, clone(rec)); },
    async listMealsByDate(date) { return [...meals.values()].filter((m) => m.date === date).sort(byCreated).map(clone); },
    async allMeals() { return [...meals.values()].sort(byCreated).map(clone); },
    async deleteMeal(id) { meals.delete(id); },
  };
}
