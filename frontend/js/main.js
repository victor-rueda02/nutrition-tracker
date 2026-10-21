// Arranque: abre IndexedDB, carga el documento (o la copia por defecto del repo) y monta la interfaz.
import { DATA_BASE } from './config.js';
import { buildCatalog } from './core/catalog.js';
import { loadSettings } from './core/settings.js';
import { parseFoodsCSV } from './core/foods-parser.js';
import { hashText } from './core/catalog-update.js';
import { openIdbStore } from './storage/idb-store.js';
import { createAiClient } from './ai-client.js';
import { mountApp } from './ui/app.js';

async function fetchText(path) {
  const res = await fetch(DATA_BASE + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

// El foods.csv publicado, sin caché (ni la del navegador ni la del service worker: "fresco" la salta), para ver si hay
// una versión nueva. La copia del dispositivo solo se hace la primera vez; después se ofrece actualizar.
async function fetchPublished() {
  const res = await fetch(`${DATA_BASE}foods.csv?fresco=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`foods.csv: ${res.status}`);
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
        const text = await fetchText('foods.csv');
        const parsed = parseFoodsCSV(text, { catalog });
        rec = { foods: parsed.foods, extraHeaders: parsed.extraHeaders, name: 'foods.csv (por defecto)', importedAt: new Date().toISOString() };
        await store.putCatalogRecord(rec);
        await store.setSetting('catalogo_base', { hash: hashText(text), text }); // base para futuras actualizaciones
      } catch { rec = { foods: [], extraHeaders: [], name: '' }; }
    }
    let targets = null; // sin targets.json el diario muestra totales, pero sin objetivos
    try { targets = JSON.parse(await fetchText('targets.json')); } catch { /* se sigue sin objetivos */ }
    let recetasBase = []; // data/recetas.json del repositorio (las del dispositivo se guardan aparte)
    try { recetasBase = JSON.parse(await fetchText('recetas.json')).recetas ?? []; } catch { /* sin recetas publicadas */ }
    let semilla = null; // data/cenas-semilla.json: cenas de Cronometer y roles de ¿Qué ceno? (sin ella, solo tu historial)
    try { semilla = JSON.parse(await fetchText('cenas-semilla.json')); } catch { /* sin semilla */ }
    let nutrientesInfo = null; // data/nutrientes-info.json: textos del detalle de nutriente (sin él, «Información aún no disponible»)
    try { nutrientesInfo = JSON.parse(await fetchText('nutrientes-info.json')); } catch { /* sin información de nutrientes */ }
    mountApp(root, {
      store, createAiClient, catalog, settings, targets, fetchPublished, recetasBase, semilla, nutrientesInfo,
      objetivos: (await store.getSetting('objetivos')) ?? {},
      initial: { foods: rec.foods, extraHeaders: rec.extraHeaders, docName: rec.name }, conn: (await store.getSetting('conn')) ?? {},
    });
  } catch (e) {
    root.textContent = `No se pudo iniciar la app: ${e.message}`;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
