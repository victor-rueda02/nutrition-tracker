// Almacenamiento en IndexedDB (diario, documento de alimentos y ajustes). Misma interfaz que store.js.
import { DB_NAME } from '../config.js';

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function openIdbStore({ indexedDB = globalThis.indexedDB, name = DB_NAME } = {}) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const d = open.result;
      d.createObjectStore('catalog', { keyPath: 'key' });
      d.createObjectStore('settings', { keyPath: 'key' });
      d.createObjectStore('meals', { keyPath: 'id' }).createIndex('date', 'date');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const store = (n, mode = 'readonly') => db.transaction(n, mode).objectStore(n);
  const byCreated = (a, b) => a.createdAt.localeCompare(b.createdAt);
  return {
    async getCatalogRecord() { const r = await req(store('catalog').get('current')); return r ? r.value : null; },
    async putCatalogRecord(rec) { await req(store('catalog', 'readwrite').put({ key: 'current', value: rec })); },
    async getSetting(key) { const r = await req(store('settings').get(key)); return r?.value; },
    async setSetting(key, value) { await req(store('settings', 'readwrite').put({ key, value })); },
    async addMeal(rec) { await req(store('meals', 'readwrite').put(rec)); },
    async listMealsByDate(date) { return (await req(store('meals').index('date').getAll(date))).sort(byCreated); },
    async allMeals() { return (await req(store('meals').getAll())).sort(byCreated); },
    async deleteMeal(id) { await req(store('meals', 'readwrite').delete(id)); },
    close() { db.close(); },
  };
}
