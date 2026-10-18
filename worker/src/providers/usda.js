// ÚNICO sitio del Worker que habla con USDA (FoodData Central). La lógica (mapeo, candidatos, sugerido) es la del
// script manual: frontend/js/core/usda-core.js. A USDA solo viajan términos de búsqueda y fdcId; la clave va en la
// cabecera X-Api-Key (secreto USDA_API_KEY del Worker), nunca en la URL ni en las respuestas.
// Sin caché aquí: la Cache API no funciona en *.workers.dev; la caché está en el iPhone (core/usda-cache.js).
import { createUsdaClient } from '../../../frontend/js/core/usda-core.js';

// trim: un salto de línea pegado con `wrangler secret put` haría que USDA rechazara la clave (API_KEY_INVALID).
export const createUsda = (env, fetchImpl = globalThis.fetch?.bind(globalThis)) => createUsdaClient({ apiKey: String(env.USDA_API_KEY ?? '').trim(), fetchImpl });
