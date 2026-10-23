// Service worker: la app funciona sin conexión (todo se sirve de caché; solo la llamada a la IA necesita internet).
// Estrategia: caché primero y actualización en segundo plano (los cambios se ven en la siguiente apertura).
// Sube VERSION cuando cambies la lista de ASSETS para limpiar cachés antiguas.
const VERSION = 'nt-v36'; // nt-v35 + Confirmar: «Dictar más» (añade lo dictado al final del borrador sin tocar lo que había); nt-v34 + informe: cada nutriente abre su detalle del día con «Qué te ha aportado hoy»; nt-v33 + referencias de grasas poliinsaturadas (FAO/OMS) y monoinsaturadas (NNR, nórdica) en % de la energía; nt-v32 + informe: filas sin referencia en dos columnas y títulos de grupo planos; nt-v31 + informe con todos los nutrientes en sus grupos (sin «Otros nutrientes») y referencias de aminoácidos (OMS), cafeína y trans; nt-v30 + retirados: se eliminan aunque la base ya no los tenga (si no son usda_app ni receta); nt-v29 + alimentos retirados (data/retirados.json): la actualización del documento los elimina tras enseñarlos;  nt-v28 + actualizar documento: elegir todo un alimento o todos los conflictos, y los añadidos con IA llegan como lo publicado;  nt-v27 + Repetir: sin nada marcado al repetir un día y casilla por comida; nt-v26 + UL informativo (vitamina A y folato no avisan ni descartan cenas), cabecera del detalle y EPA + DHA con información; nt-v25 + detalle: aviso de UL, secciones plegables, EPA + DHA, scroll al volver; nt-v24 + detalle de alimento y de nutriente (data/nutrientes-info.json); nt-v23 + aviso «alias más específico» (pan de molde, lata de atún...); nt-v22 + icono nuevo (anillos con hoja morada; fuente en docs/icono-app.svg); nt-v21 + recetas con valores de etiqueta (campo "etiqueta"); nt-v20 + vista previa de recetas sin el texto «null»; nt-v19 + sin barra de navegación bajo el pie fijo de acciones (Guardar receta visible)
const ASSETS = [
  './',
  'css/catalogo.css',
  'css/cenas.css',
  'css/detalle.css',
  'css/frases.css',
  'css/ia-recetas.css',
  'css/navegacion.css',
  'css/objetivos.css',
  'css/plantillas.css',
  'css/repeat.css',
  'css/styles.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'index.html',
  'js/ai-client.js',
  'js/config.js',
  'js/core/ai-contract.js',
  'js/core/ai-validate.js',
  'js/core/backup.js',
  'js/core/catalog-update.js',
  'js/core/catalog.js',
  'js/core/cenas-validate.js',
  'js/core/cenas.js',
  'js/core/completeness.js',
  'js/core/sin-datos.js',
  'js/core/csv.js',
  'js/core/detalle.js',
  'js/core/diary.js',
  'js/core/parciales.js',
  'js/core/draft.js',
  'js/core/estimate-validate.js',
  'js/core/estimate.js',
  'js/core/excluded.js',
  'js/core/foods-parser.js',
  'js/core/ids.js',
  'js/core/meal-defaults.js',
  'js/core/numbers.js',
  'js/core/phrase-log.js',
  'js/core/repeat.js',
  'js/core/nutrients.js',
  'js/core/portions.js',
  'js/core/recetas.js',
  'js/core/schema.js',
  'js/core/settings.js',
  'js/core/targets-plan.js',
  'js/core/targets.js',
  'js/core/templates.js',
  'js/core/text.js',
  'js/core/usda-cache.js',
  'js/core/usda-core.js',
  'js/main.js',
  'js/storage/idb-store.js',
  'js/storage/store.js',
  'js/ui/app.js',
  'js/ui/catalog-update-screen.js',
  'js/ui/cenas-screen.js',
  'js/ui/detalle-alimento-screen.js',
  'js/ui/detalle-nutriente-screen.js',
  'js/ui/estimate-screen.js',
  'js/ui/foods-screen.js',
  'js/ui/more-screen.js',
  'js/ui/nav.js',
  'js/ui/objetivos-screen.js',
  'js/ui/phrase-log-screen.js',
  'js/ui/recetas-screen.js',
  'js/ui/repeat-screen.js',
  'js/ui/report-screen.js',
  'js/ui/templates-screen.js',
  'manifest.webmanifest',
  '../data/nutrients.json',
  '../data/settings.json',
  '../data/targets.json',
  '../data/foods.csv',
  '../data/recetas.json',
  '../data/cenas-semilla.json',
  '../data/nutrientes-info.json',
  '../data/retirados.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Solo GET del mismo origen: las llamadas al Worker de IA (otro origen, POST) pasan sin tocar.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // ?fresco= (comprobar si hay un foods.csv nuevo): siempre a la red y sin guardarlo en caché.
  if (new URL(req.url).searchParams.has('fresco')) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((cache) => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    }));
});
