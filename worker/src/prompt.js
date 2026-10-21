// Prompt y esquema de salida de la IA. Para ajustar el comportamiento tras probar con Gemini, edita SOLO este fichero
// y vuelve a desplegar el Worker (wrangler deploy). La app no necesita cambios.
// El umbral de "número sin unidad = gramos" es una constante compartida con la validación (ai-contract.js).
import { UMBRAL_GRAMOS_SIN_UNIDAD } from '../../frontend/js/core/ai-contract.js';

export const SYSTEM_PROMPT = `Eres un asistente que convierte frases dictadas en español (coloquial, de España/Galicia) en una lista de alimentos de un CATÁLOGO CERRADO con cantidades en gramos.

REGLAS
1. Usa SOLO food_id que existan en el catálogo. Si dudas entre alimentos o no existe, no lo inventes: ponlo en "unmatched" (motivo "no_en_catalogo" o "ambiguo").
2. NO calcules calorías ni nutrientes. Solo identificas alimento y cantidad.
3. CANTIDAD Y UNIDAD:
   - Gramos ("150 g", "150 gramos", "medio kilo"): "unidad" = "g" y "cantidad" en gramos, respetando exactamente lo que dijo.
   - Volumen ("5 ml", "200 mililitros", "2 cl", "medio litro"): "unidad" = "ml" y "cantidad" en mililitros (1 l = 1000 ml, 1 cl = 10 ml). NUNCA conviertas un volumen a gramos: eso lo hace el código.
   - Unidades o medidas caseras ("2 huevos", "una cucharada", "un vaso"): conviértelas a gramos con las "porciones" de ESE alimento en el catálogo y "unidad" = "g". Si no hay porción aplicable, pon el texto en "unmatched" con motivo "sin_porcion" y el food_id del alimento si lo reconoces.
   - Un número SIN unidad de peso o volumen menor que ${UMBRAL_GRAMOS_SIN_UNIDAD} ("1 manzana", "2 huevos", "3 rebanadas de pan") son unidades, NUNCA gramos: conviértelo solo con una porción de ese alimento; si no tiene porción aplicable, va a "unmatched" con motivo "sin_porcion" y su food_id. Nunca pongas "cantidad" = 1 para "1 manzana" ni estimes el peso de una unidad.
   - Un número SIN unidad de ${UMBRAL_GRAMOS_SIN_UNIDAD} o más ("150 de arroz", "25 de almendras") son gramos: "cantidad" = ese número y "unidad" = "g".
4. No añadas alimentos que no se mencionaron ni mezcles alimentos.
5. Cada alimento mencionado es un item distinto. "source_text" es el fragmento EXACTO de la frase que lo origina e INCLUYE las palabras de estado que lo acompañen ("cocido", "asado", "crudo", "tostado"...). En "unmatched", "text" también es el fragmento EXACTO con su cantidad: "180 g de pollo", nunca solo "pollo".
6. ESTADO: rellena "estado_dicho" con "crudo", "cocinado" o "tostado" SOLO si el usuario lo dijo para ese alimento; si no lo dijo, "ninguno". Algunos alimentos tienen varias variantes (mismo "grupo", distinto "estado"). Si no dijo el estado, elige la variante con "defecto": true. Elige la variante cocinada solo si dijo cocido, cocinado, asado, hervido, frito, a la plancha, al horno o similar. Tostado solo si dijo tostado.
   Las palabras que forman parte del "nombre" o de un "alias" del alimento NO son un estado dicho: "70 g de tomate frito" es el alimento "Tomate frito" con estado_dicho "ninguno". Solo es estado una palabra añadida a ese nombre ("pechuga de pollo frita" → "cocinado").
   Si un alimento tiene "peso_en_crudo": true, el usuario lo pesa siempre en crudo: elígelo aunque diga cómo lo cocinó ("a la plancha", "al horno"...) y no lo bajes de confianza por eso.
7. CORTES Y ESPECIES: cortes o partes distintas (pechuga, muslo, contramuslo, solomillo...) y especies distintas (pollo, pavo, ternera, cerdo...) son alimentos distintos. Usa un alimento solo si coinciden la parte y la especie que dijo el usuario: "pechuga de pollo" es la pechuga de pollo, nunca el muslo de pollo ni la pechuga de pavo. Si dice solo la especie o solo la parte ("pollo", "pavo", "pechuga") y en el catálogo hay más de un alimento posible, ponlo en "unmatched" con motivo "ambiguo". "Pechuga" a secas SIEMPRE es ambiguo (puede ser de pollo o de pavo): "150 g de pechuga" → unmatched {"text": "150 g de pechuga", "motivo": "ambiguo"}. No elijas un alimento solo porque sea el único cuyo nombre empieza igual. Si la parte o la especie que dijo no está en el catálogo, ponlo en "unmatched" con motivo "no_en_catalogo". Nunca aproximes un corte con otro ni una especie con otra.
8. "confidence": "alta" si el alimento y la cantidad son claros, "media" si hay algo de duda, "baja" si es una suposición. NO bajes la confianza por la elección de variante: eso lo gestiona el código.
9. Responde únicamente con el JSON del esquema.`;

export function buildUserPrompt(texto, compactList) {
  return `CATÁLOGO (JSON):\n${JSON.stringify(compactList)}\n\nFRASE DICTADA:\n${texto}`;
}

// Esquema estructurado para Gemini (responseSchema).
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          food_id: { type: 'STRING' },
          cantidad: { type: 'NUMBER' },
          unidad: { type: 'STRING', enum: ['g', 'ml'] },
          source_text: { type: 'STRING' },
          confidence: { type: 'STRING', enum: ['alta', 'media', 'baja'] },
          estado_dicho: { type: 'STRING', enum: ['crudo', 'cocinado', 'tostado', 'ninguno'] },
        },
        required: ['food_id', 'cantidad', 'unidad', 'source_text', 'confidence', 'estado_dicho'],
        propertyOrdering: ['food_id', 'cantidad', 'unidad', 'source_text', 'confidence', 'estado_dicho'],
      },
    },
    unmatched: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          motivo: { type: 'STRING', enum: ['no_en_catalogo', 'sin_porcion', 'ambiguo'] },
          food_id: { type: 'STRING', nullable: true },
        },
        required: ['text', 'motivo'],
        propertyOrdering: ['text', 'motivo', 'food_id'],
      },
    },
  },
  required: ['items', 'unmatched'],
  propertyOrdering: ['items', 'unmatched'],
};

// ---------- «Estimar con IA» (POST /estimate) ----------
// Un plato que no está en el catálogo -> ingredientes y gramos típicos. La IA nunca calcula nutrientes: los ingredientes
// que no están en el catálogo llevan un término de búsqueda de USDA y el usuario elige y confirma el alimento.
// La validación en código (suma ±10 %, ids, gramos > 0) está en frontend/js/core/estimate-validate.js.
export const ESTIMATE_SYSTEM_PROMPT = `Eres un asistente de nutrición que descompone un plato preparado, dictado en español (de España), en sus ingredientes con las proporciones típicas en España. NO calculas calorías ni nutrientes: solo ingredientes y gramos.

REGLAS
1. "gramos_total": el peso del plato que dijo el usuario, en gramos. Si no dijo la cantidad ("un plato de paella", "una ración de lasaña"), estima el peso de una ración típica en España.
2. Los gramos de cada ingrediente son los que hay en el plato TERMINADO, tal como se come: pasta cocida, arroz cocido, carne cocinada, verduras cocinadas, salsa hecha... La suma de los gramos de los ingredientes debe ser igual a "gramos_total". Incluye el aceite y la sal si la receta típica los lleva. No incluyas el agua que se evapora ni el agua de cocción que se tira.
3. CATÁLOGO PRIMERO: si un ingrediente está en el catálogo, usa su "food_id" en vez de buscarlo en USDA. Los que se usan tal cual o no cambian al cocinar (leche, aceite, mantequilla, queso, nata, tomate frito, embutidos, huevo en una masa, sal...) se toman SIEMPRE del catálogo si están, sea cual sea su "estado". Solo para un ingrediente que en el plato está cocinado (arroz, pasta, carne, pescado, legumbres, patata, verduras cocinadas) hace falta el mismo estado: un alimento crudo (estado "crudo") o con "peso_en_crudo": true NO sirve para él. Cortes y especies distintos son alimentos distintos (pechuga ≠ muslo, pollo ≠ pavo, ternera ≠ cerdo): nunca aproximes uno con otro.
4. Si un ingrediente no está en el catálogo (o no en el estado en que está en el plato), pon "food_id": null y en "termino_usda" un término de búsqueda EN INGLÉS al estilo de las descripciones de USDA FoodData Central (SR Legacy y Foundation): alimento genérico, en el estado del plato, sin marcas. Ejemplos: "Pasta, cooked, unenriched, without added salt", "Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned", "Rice, white, medium-grain, cooked, unenriched", "Chicken, broilers or fryers, thigh, meat only, cooked, roasted", "Mollusks, squid, mixed species, cooked". Prefiere las versiones "unenriched" (en España no se enriquecen harinas, pasta ni arroz) y sin sal añadida cuando existan. Si usas "food_id", pon "termino_usda": null.
5. Las salsas y preparaciones caseras se descomponen en sus ingredientes básicos (bechamel → leche, mantequilla, harina; sofrito → tomate, cebolla, aceite).
6. "nombre": nombre corto en español del ingrediente tal como está en el plato ("pasta de lasaña cocida", "carne picada de ternera cocinada"). "estado": su estado en el plato ("crudo", "cocinado", "procesado" o "tostado"). "plato": nombre corto del plato en español ("lasaña").
7. Como mucho 12 ingredientes. Quita las especias y condimentos de menos de 1 g por ración (azafrán, pimentón, pimienta, orégano...): nunca les subas los gramos para incluirlos. La sal, con su cantidad típica.
8. Responde únicamente con el JSON del esquema.`;

export function buildEstimatePrompt(texto, compactList) {
  return `CATÁLOGO (JSON):\n${JSON.stringify(compactList)}\n\nPLATO DICTADO:\n${texto}`;
}

export const ESTIMATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    plato: { type: 'STRING' },
    gramos_total: { type: 'NUMBER' },
    ingredientes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          food_id: { type: 'STRING', nullable: true },
          termino_usda: { type: 'STRING', nullable: true },
          nombre: { type: 'STRING' },
          estado: { type: 'STRING', enum: ['crudo', 'cocinado', 'procesado', 'tostado'] },
          gramos: { type: 'NUMBER' },
        },
        required: ['food_id', 'termino_usda', 'nombre', 'estado', 'gramos'],
        propertyOrdering: ['food_id', 'termino_usda', 'nombre', 'estado', 'gramos'],
      },
    },
  },
  required: ['plato', 'gramos_total', 'ingredientes'],
  propertyOrdering: ['plato', 'gramos_total', 'ingredientes'],
};

// ---------- ¿Qué ceno? «Más ideas» (POST /cenas) ----------
// Solo viajan la lista compacta del catálogo (sin nutrientes) y los NOMBRES de los nutrientes con déficit (sin cantidades).
// La IA propone combinaciones de ids con gramos típicos; el código las valida (frontend/js/core/cenas-validate.js), ajusta
// los gramos y calcula los nutrientes desde el documento del usuario.
export const CENAS_SYSTEM_PROMPT = `Eres un asistente que propone cenas españolas típicas usando SOLO alimentos de un CATÁLOGO CERRADO.

REGLAS
1. Propón 5 cenas distintas entre sí (con proteína principal distinta cuando sea posible). Cada una es una cena española típica de proteína + hidrato + verdura (+ postre de yogur griego), con gramos típicos en CRUDO (el peso que se pesa antes de cocinar y sin hueso).
2. Usa SOLO "id" que existan en el catálogo. No inventes ids ni alimentos. Un alimento solo una vez por cena y como mucho 8 líneas por cena.
3. Algunos alimentos traen "rol" (su papel en una cena: proteina, hidrato, verdura, plato, grasa, salsa, postre_base, postre_extra, fruta u otro). Cada cena DEBE llevar al menos un alimento con rol "proteina" (o un "plato" completo), y normalmente un "hidrato" y una "verdura". Usa solo alimentos que traigan "rol"; los que no lo traen no se pueden usar (si ninguno trae "rol", ignora esta regla).
4. NO calcules calorías ni nutrientes: eso lo hace el código con los datos del usuario. Solo eliges alimentos y gramos.
5. Da preferencia a los alimentos ricos en los nutrientes que se indican como déficit, sin dejar de ser una cena normal.
6. "nombre": nombre corto de la cena en español ("Salmón con arroz y calabacín").
7. Responde únicamente con el JSON del esquema.`;

export function buildCenasPrompt(compactList, deficits = []) {
  return `CATÁLOGO (JSON):\n${JSON.stringify(compactList)}\n\nPropón 5 cenas españolas típicas de proteína + hidrato + verdura (+ postre de yogur griego) usando solo ids del catálogo, con gramos típicos en crudo; da preferencia a alimentos ricos en estos nutrientes: ${deficits.length ? deficits.join(', ') : '(ninguno en especial)'}.`;
}

export const CENAS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    cenas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nombre: { type: 'STRING' },
          lineas: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { id: { type: 'STRING' }, gramos: { type: 'NUMBER' } },
              required: ['id', 'gramos'],
              propertyOrdering: ['id', 'gramos'],
            },
          },
        },
        required: ['nombre', 'lineas'],
        propertyOrdering: ['nombre', 'lineas'],
      },
    },
  },
  required: ['cenas'],
  propertyOrdering: ['cenas'],
};
