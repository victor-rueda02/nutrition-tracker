// Almacenamiento en IndexedDB (diario, documento de alimentos y ajustes). Misma interfaz que store.js.
// iOS cierra la conexión cuando la app pasa un rato en segundo plano («The database connection is closing»):
// entonces se vuelve a abrir y la operación se repite una vez (todas son idempotentes: get, put, delete).
import { DB_NAME } from '../config.js';

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

// Errores de una conexión cerrada (o que se está cerrando) por el sistema, no por un fallo de la operación.
const CONEXION_CERRADA = new Set(['InvalidStateError', 'AbortError', 'UnknownError', 'TransactionInactiveError']);

function openDb(indexedDB, name) {
  return new Promise((resolve, reject) => {
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
}

export async function openIdbStore({ indexedDB = globalThis.indexedDB, name = DB_NAME } = {}) {
  let db = null;
  let cerrado = false; // close() explícito: no se reabre
  const conectar = async () => {
    if (db) return db;
    const d = await openDb(indexedDB, name);
    const olvidar = () => { if (db === d) db = null; };
    d.onclose = olvidar; // cierre anómalo (el sistema)
    d.onversionchange = () => { d.close(); olvidar(); };
    db = d;
    return d;
  };
  await conectar();

  // Ejecuta op(objectStore) en una transacción; si la conexión estaba cerrada, reabre y lo intenta una vez más.
  const run = async (n, mode, op) => {
    for (let intento = 0; ; intento++) {
      if (cerrado) throw new Error('El almacén está cerrado.');
      const d = await conectar();
      try {
        return await req(op(d.transaction(n, mode).objectStore(n)));
      } catch (e) {
        if (intento > 0 || !CONEXION_CERRADA.has(e?.name)) throw e;
        if (db === d) db = null;
        try { d.close(); } catch { /* ya cerrada */ }
      }
    }
  };
  const byCreated = (a, b) => a.createdAt.localeCompare(b.createdAt);
  return {
    async getCatalogRecord() { const r = await run('catalog', 'readonly', (s) => s.get('current')); return r ? r.value : null; },
    async putCatalogRecord(rec) { await run('catalog', 'readwrite', (s) => s.put({ key: 'current', value: rec })); },
    async getSetting(key) { const r = await run('settings', 'readonly', (s) => s.get(key)); return r?.value; },
    async setSetting(key, value) { await run('settings', 'readwrite', (s) => s.put({ key, value })); },
    async addMeal(rec) { await run('meals', 'readwrite', (s) => s.put(rec)); },
    async listMealsByDate(date) { return (await run('meals', 'readonly', (s) => s.index('date').getAll(date))).sort(byCreated); },
    async allMeals() { return (await run('meals', 'readonly', (s) => s.getAll())).sort(byCreated); },
    async deleteMeal(id) { await run('meals', 'readwrite', (s) => s.delete(id)); },
    close() { cerrado = true; db?.close(); db = null; },
  };
}
