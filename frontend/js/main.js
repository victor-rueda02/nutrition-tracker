// Arranque: abre IndexedDB, carga el documento (o la copia por defecto del repo) y monta la interfaz.
import { DATA_BASE, APP_VERSION } from './config.js';
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

// Service worker y avisos de versión nueva. iOS suele reanudar la app instalada sin volver a cargarla, y sin carga no busca
// versión nueva: al volver a primer plano se pide (como mucho cada 5 min) y, cuando la versión nueva toma el control, se avisa
// arriba con «Recargar». Nunca se recarga solo: un borrador sin guardar se perdería.
function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const habiaVersion = Boolean(sw.controller); // la primera instalación no es «versión nueva»
  sw.register('sw.js').then((reg) => {
    let ultima = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultima < 5 * 60 * 1000) return;
      ultima = Date.now();
      reg.update().catch((e) => globalThis.console?.error?.('No se pudo buscar una versión nueva de la app', e));
    });
  }).catch((e) => globalThis.console?.error?.('No se pudo registrar el service worker', e));
  sw.addEventListener('controllerchange', () => {
    if (!habiaVersion || document.querySelector('.aviso-version')) return;
    const aviso = document.createElement('div');
    aviso.className = 'aviso-version';
    aviso.setAttribute('role', 'status');
    const texto = document.createElement('span');
    texto.textContent = 'Hay una versión nueva de la app.';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Recargar';
    boton.addEventListener('click', () => location.reload());
    aviso.append(texto, boton);
    document.body.append(aviso);
  });
}

// data/dieta.json publicado, siempre fresco (como el foods.csv: sin caché del navegador ni del service worker). Lanza si no hay red.
async function fetchDieta({ signal } = {}) {
  const res = await fetch(`${DATA_BASE}dieta.json?fresco=${Date.now()}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`dieta.json: ${res.status}`);
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
    let retirados = null; // data/retirados.json: alimentos que Victor retira del documento (sin él, nada se elimina)
    try { retirados = JSON.parse(await fetchText('retirados.json')); } catch { /* sin lista de retirados */ }
    mountApp(root, {
      store, createAiClient, catalog, settings, targets, fetchPublished, appVersion: APP_VERSION, fetchDieta, fetchDietaCopia: () => fetchText('dieta.json'), recetasBase, semilla, nutrientesInfo, retirados,
      objetivos: (await store.getSetting('objetivos')) ?? {},
      initial: { foods: rec.foods, extraHeaders: rec.extraHeaders, docName: rec.name }, conn: (await store.getSetting('conn')) ?? {},
    });
  } catch (e) {
    root.textContent = `No se pudo iniciar la app: ${e.message}`;
  }
  registrarServiceWorker();
}
boot();
