// INTERFAZ CON LA IA (única puerta de la app hacia el Worker).
//
//   const ai = createAiClient({ endpoint, token });
//   const result = await ai.interpretMeal({ texto, alimentos });   // alimentos = lista compacta (buildCompactList)
//   result = { items: [{ food_id, grams, source_text, confidence, flags, requiresConfirmation }],
//              unmatched: [{ text, motivo, food_id? }], warnings: [string], model }
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
  red: 'No se pudo contactar con el servidor de la IA. Revisa la dirección y tu conexión.',
  token_invalido: 'El token no es correcto. Revísalo en Documento → Conexión.',
  origen: 'El servidor rechaza esta página (CORS): revisa ALLOWED_ORIGIN en el Worker.',
  limite_de_uso: 'Se ha alcanzado el límite de uso gratuito de la IA. Prueba más tarde o añade a mano.',
  proveedor_ia: 'El servicio de IA ha fallado. Prueba de nuevo en un momento.',
  respuesta_invalida: 'La IA devolvió una respuesta que no se pudo entender. Prueba a reformular la frase.',
};
const fail = (code, detail) => new AiClientError(code, MESSAGES[code] ?? `Error: ${code}`, detail);

export function createAiClient({ endpoint, token, fetchImpl = globalThis.fetch?.bind(globalThis), isOnline = () => globalThis.navigator?.onLine !== false } = {}) {
  const base = String(endpoint ?? '').trim().replace(/\/+$/, '');
  return {
    async interpretMeal({ texto, alimentos }) {
      if (!base || !token) throw fail('sin_configurar');
      if (!isOnline()) throw fail('sin_conexion');
      let res;
      try {
        res = await fetchImpl(`${base}/parse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-App-Token': token },
          body: JSON.stringify({ texto, alimentos }),
        });
      } catch (e) {
        throw fail('red', e.message);
      }
      let body = null;
      try { body = await res.json(); } catch { /* cuerpo no JSON */ }
      if (!res.ok) {
        if (res.status === 401) throw fail('token_invalido');
        if (res.status === 403) throw fail('origen');
        if (res.status === 429) throw fail('limite_de_uso');
        if (body?.error === 'respuesta_invalida') throw fail('respuesta_invalida', body.detalle);
        throw fail('proveedor_ia', `HTTP ${res.status} ${body?.error ?? ''}`);
      }
      if (!body || !Array.isArray(body.items) || !Array.isArray(body.unmatched)) throw fail('respuesta_invalida', 'forma inesperada');
      return { items: body.items, unmatched: body.unmatched, warnings: Array.isArray(body.warnings) ? body.warnings : [], model: body.model };
    },

    // Comprobación de que el Worker responde (no gasta IA).
    async health() {
      if (!base) throw fail('sin_configurar');
      try { const r = await fetchImpl(`${base}/health`); return r.ok; } catch (e) { throw fail('red', e.message); }
    },
  };
}
