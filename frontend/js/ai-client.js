// INTERFAZ CON LA IA (única puerta de la app hacia el Worker).
//
//   const ai = createAiClient({ endpoint, token });
//   const result = await ai.interpretMeal({ texto, alimentos });   // alimentos = lista compacta (buildCompactList)
//   result = { items: [{ food_id, grams, source_text, confidence, flags, requiresConfirmation }],
//              unmatched: [{ text, motivo, food_id? }], warnings: [string], model }
//
// «Estimar con IA» (solo tras una acción del usuario, en una línea no reconocida):
//   await ai.estimateDish({ texto, alimentos })  -> { plato, gramos, total_estimado, ajustado, ingredientes, warnings }
//   await ai.usdaSearch({ terminos })            -> { resultados: [{ termino, sugerido, candidatos, estado, motivo }] }
//   await ai.usdaFoods({ fdcIds })               -> { fichas: [{ fdcId, values, fuente, enriquecibles, ... }], faltan }
// ¿Qué ceno? «Más ideas» (solo tras pulsar el botón):
//   await ai.ideasCena({ alimentos, deficits })  -> { cenas: [{ nombre, lineas: [{ food_id, gramos }] }], warnings }
//   alimentos = lista compacta (sin nutrientes); deficits = solo los NOMBRES de los nutrientes con déficit (sin cantidades).
// A USDA solo viajan términos y fdcId; la clave de USDA es un secreto del Worker.
//
// El prompt, el esquema de Gemini y la validación viven en el Worker (worker/src/prompt.js): para ajustar el
// comportamiento de la IA se edita allí y se redespliega el Worker, sin tocar la app. Si cambia este contrato
// (campos de entrada o salida), es lo único que hay que adaptar aquí.
export class AiClientError extends Error {
  constructor(code, userMessage, detail) {
    super(`${code}: ${detail ?? userMessage}`);
    this.code = code;
    this.userMessage = userMessage;
  }
}

const MESSAGES = {
  sin_configurar: 'Falta configurar la conexión con la IA (Documento → Conexión).',
  sin_conexion: 'Sin conexión: la IA necesita internet. Puedes añadir los alimentos a mano.',
  red: 'No se pudo contactar con el servidor de la IA. Revisa la dirección, tu conexión y que ALLOWED_ORIGIN del Worker sea esta página.',
  token_invalido: 'El token no es correcto. Revísalo en Documento → Conexión.',
  origen: 'El servidor rechaza esta página (CORS): revisa ALLOWED_ORIGIN en el Worker.',
  limite_de_uso: 'Se ha alcanzado el límite de uso gratuito de la IA. Prueba más tarde o añade a mano.',
  google_caido: 'Google tiene el servicio de IA sobrecargado o caído (suele ser temporal). Prueba de nuevo en un minuto o añade los alimentos a mano; tu texto se conserva.',
  modelo_no_disponible: 'Google ha retirado o no encuentra el modelo de IA configurado (GEMINI_MODEL del Worker). Hay que cambiarlo y volver a desplegar el Worker.',
  clave_ia: 'Google rechaza la clave de IA del Worker (secreto GEMINI_API_KEY). Revísala.',
  error_worker: 'El Worker ha fallado antes de llegar a Google. Prueba de nuevo; si sigue, mira npm run worker:logs.',
  proveedor_ia: 'El servicio de IA ha fallado. Prueba de nuevo en un momento.',
  respuesta_invalida: 'La IA devolvió una respuesta que no se pudo entender. Prueba a reformular la frase.',
  limite_usda: 'USDA ha llegado a su límite de consultas (1000 por hora). Prueba más tarde; lo ya consultado está guardado.',
  usda_sin_configurar: 'El Worker no tiene la clave de USDA (secreto USDA_API_KEY): ver docs/notas-ia-recetas.md.',
  usda_clave: 'USDA rechaza la clave del Worker: revisa el secreto USDA_API_KEY.',
  usda: 'USDA no ha respondido bien. Prueba de nuevo en un momento.',
};
const fail = (code, detail) => new AiClientError(code, MESSAGES[code] ?? `Error: ${code}`, detail);

export function createAiClient({ endpoint, token, fetchImpl = globalThis.fetch?.bind(globalThis), isOnline = () => globalThis.navigator?.onLine !== false } = {}) {
  const base = String(endpoint ?? '').trim().replace(/\/+$/, '');
  // POST al Worker con el token; errores con mensaje claro (un 429 de USDA no es el de la IA).
  async function post(path, payload, check) {
    if (!base || !token) throw fail('sin_configurar');
    if (!isOnline()) throw fail('sin_conexion');
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-App-Token': token },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw fail('red', e.message);
    }
    let body = null;
    try { body = await res.json(); } catch { /* cuerpo no JSON */ }
    if (!res.ok) {
      if (res.status === 401) throw fail('token_invalido');
      if (res.status === 403) throw fail('origen');
      if (['limite_usda', 'usda_sin_configurar', 'usda_clave', 'usda'].includes(body?.error)) throw fail(body.error, `HTTP ${res.status}`);
      if (res.status === 429) throw fail('limite_de_uso');
      if (body?.error === 'respuesta_invalida') throw fail('respuesta_invalida', body.detalle);
      if (['google_caido', 'modelo_no_disponible', 'clave_ia', 'error_worker'].includes(body?.error)) throw fail(body.error, `HTTP ${res.status} Google ${body.status ?? '-'}`);
      throw fail('proveedor_ia', `HTTP ${res.status} ${body?.error ?? ''}`);
    }
    if (!body || !check(body)) throw fail('respuesta_invalida', 'forma inesperada');
    return body;
  }

  return {
    async interpretMeal({ texto, alimentos }) {
      const body = await post('/parse', { texto, alimentos }, (b) => Array.isArray(b.items) && Array.isArray(b.unmatched));
      return { items: body.items, unmatched: body.unmatched, warnings: Array.isArray(body.warnings) ? body.warnings : [], model: body.model };
    },

    // Una llamada a la IA: ingredientes y gramos de un plato que no está en el documento (nunca nutrientes).
    async estimateDish({ texto, alimentos }) {
      const b = await post('/estimate', { texto, alimentos }, (x) => Array.isArray(x.ingredientes) && x.gramos > 0);
      return { plato: b.plato, gramos: b.gramos, total_estimado: b.total_estimado === true, ajustado: b.ajustado === true, ingredientes: b.ingredientes, warnings: Array.isArray(b.warnings) ? b.warnings : [], model: b.model };
    },
    // Una llamada a la IA: cenas (ids del catálogo y gramos típicos). Nunca nutrientes ni nada del diario.
    async ideasCena({ alimentos, deficits }) {
      const b = await post('/cenas', { alimentos, deficits }, (x) => Array.isArray(x.cenas));
      return { cenas: b.cenas, warnings: Array.isArray(b.warnings) ? b.warnings : [], model: b.model };
    },
    async usdaSearch({ terminos }) {
      const b = await post('/usda/search', { terminos }, (x) => Array.isArray(x.resultados));
      return { resultados: b.resultados };
    },
    async usdaFoods({ fdcIds }) {
      const b = await post('/usda/foods', { fdcIds }, (x) => Array.isArray(x.fichas));
      return { fichas: b.fichas, faltan: b.faltan ?? [] };
    },

    // "Probar" (no gasta IA): ¿responde?, ¿tiene sus secretos?, ¿el token es el correcto? -> { ok, configurado, token }.
    // Un fallo de red aquí suele ser ALLOWED_ORIGIN: el navegador bloquea la respuesta si el Worker no admite esta página.
    async health() {
      if (!base) throw fail('sin_configurar');
      let res;
      try { res = await fetchImpl(`${base}/health`, token ? { headers: { 'X-App-Token': token } } : undefined); } catch (e) { throw fail('red', e.message); }
      if (!res.ok) return { ok: false };
      let b = null;
      try { b = await res.json(); } catch { /* sin JSON */ }
      return { ok: true, configurado: b?.configurado !== false, token: b?.token ?? null };
    },
  };
}
