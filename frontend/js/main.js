// Arranque: abre IndexedDB, carga el documento (o la copia por defecto del repo) y monta la interfaz.
import { DATA_BASE } from './config.js';
import { buildCatalog } from './core/catalog.js';
import { loadSettings } from './core/settings.js';
import { parseFoodsCSV } from './core/foods-parser.js';
import { openIdbStore } from './storage/idb-store.js';
import { createAiClient } from './ai-client.js';
import { mountApp } from './ui/app.js';

async function fetchText(path) {
  const res = await fetch(DATA_BASE + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

async function boot() {
  const root = document.getElementById('app');
  try {
    const catalog = buildCatalog(JSON.parse(await fetchText('nutrients.json')));
    const { settings } = loadSettings(JSON.parse(await fetchText('settings.json')), catalog);
    const store = await openIdbStore();
    let rec = await store.getCatalogRecord();
    if (!rec) { // primera ejecución: copia por defecto incluida en el repositorio (opcional)
      try {
        const parsed = parseFoodsCSV(await fetchText('foods.csv'), { catalog });
        rec = { foods: parsed.foods, extraHeaders: parsed.extraHeaders, name: 'foods.csv (por defecto)', importedAt: new Date().toISOString() };
        await store.putCatalogRecord(rec);
      } catch { rec = { foods: [], extraHeaders: [], name: '' }; }
    }
    mountApp(root, { store, createAiClient, catalog, settings, initial: { foods: rec.foods, extraHeaders: rec.extraHeaders, docName: rec.name }, conn: (await store.getSetting('conn')) ?? {} });
  } catch (e) {
    root.textContent = `No se pudo iniciar la app: ${e.message}`;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
