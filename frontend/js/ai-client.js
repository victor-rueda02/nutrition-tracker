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
// Inventario (sin IA): ticketsPendientes, ticketsRecibidos y subirTicket hablan con la cola de tickets del Worker (ver abajo).
//
// El prompt, el esquema de Gemini y la validación viven en el Worker (worker/src/prompt.js): para ajustar el
// comportamiento de la IA se edita allí y se redespliega el Worker, sin tocar la app. Si cambia este contrato
// (campos de entrada o salida), es lo único que hay que adaptar aquí.
import { textoDescarteCenas } from './core/cenas-validate.js';
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
  worker_antiguo: 'El Worker publicado aún no tiene esta función: hay que desplegarlo (npm run worker:deploy).',
  proveedor_ia: 'El servicio de IA ha fallado. Prueba de nuevo en un momento.',
  respuesta_invalida: 'La IA devolvió una respuesta que no se pudo entender. Prueba a reformular la frase.',
  limite_usda: 'USDA ha llegado a su límite de consultas (1000 por hora). Prueba más tarde; lo ya consultado está guardado.',
  usda_sin_configurar: 'El Worker no tiene la clave de USDA (secreto USDA_API_KEY): ver docs/notas-ia-recetas.md.',
  usda_clave: 'USDA rechaza la clave del Worker: revisa el secreto USDA_API_KEY.',
  usda: 'USDA no ha respondido bien. Prueba de nuevo en un momento.',
  // Cola de tickets de Mercadona (Inventario; sin IA)
  tickets_sin_configurar: 'El Worker aún no tiene la cola de tickets (falta el KV «TICKETS» y el secreto MAIL_TOKEN): ver docs/inventario/CORREO.md.',
  ticket_ilegible: 'No he podido leer el ticket. Prueba con «Pegar el texto del ticket».',
  ticket_invalido: 'Falta el PDF o el texto del ticket.',
  pdf_invalido: 'Ese fichero no es un PDF válido. Prueba con «Pegar el texto del ticket».',
  pdf_cifrado: 'El PDF está protegido con contraseña. Prueba con «Pegar el texto del ticket».',
  pdf_no_soportado: 'No sé leer este tipo de PDF. Prueba con «Pegar el texto del ticket».',
  sin_descompresion: 'Este navegador no puede leer el PDF (hace falta iOS 16.4 o posterior). Prueba con «Pegar el texto del ticket».',
  sin_texto: 'El PDF no tiene texto que se pueda leer. Prueba con «Pegar el texto del ticket».',
  pdf_demasiado_grande: 'El PDF es demasiado grande (máximo 2 MB).',
  texto_demasiado_largo: 'El texto del ticket es demasiado largo.',
  cuerpo_demasiado_grande: 'El ticket es demasiado grande para enviarlo.',
  hashes_invalidos: 'Lista de tickets no válida.',
};
// Errores de la cola de tickets que el Worker manda con código propio (no son de la IA).
const ERRORES_TICKETS = ['tickets_sin_configurar', 'ticket_ilegible', 'ticket_invalido', 'pdf_invalido', 'pdf_cifrado', 'pdf_no_soportado', 'sin_descompresion', 'sin_texto', 'pdf_demasiado_grande', 'texto_demasiado_largo', 'cuerpo_demasiado_grande', 'hashes_invalidos'];
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
      if (ERRORES_TICKETS.includes(body?.error)) throw Object.assign(fail(body.error, body.detalle ?? `HTTP ${res.status}`), { codigo: body.codigo });
      if (res.status === 429) throw fail('limite_de_uso');
      if (res.status === 404 && body?.error === 'no_encontrado') throw fail('worker_antiguo', path);
      if (body?.error === 'respuesta_invalida') throw Object.assign(fail('respuesta_invalida', body.detalle), { recibidas: body.recibidas, descartes: body.descartes });
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
    // alimentos lleva el `rol` (rol_cena) de cada uno. Devuelve también cuántas cenas mandó la IA y cuántas se descartaron en el Worker.
    async ideasCena({ alimentos, deficits }) {
      let b;
      try {
        b = await post('/cenas', { alimentos, deficits }, (x) => Array.isArray(x.cenas));
      } catch (e) {
        if (e.code !== 'respuesta_invalida') throw e;
        // El Worker no pudo sacar ninguna cena válida (dos intentos): se dice por qué, no "reformula la frase".
        const quedan = e.descartes ? textoDescarteCenas({ recibidas: e.recibidas ?? 0, descartes: e.descartes }) : '';
        throw new AiClientError('respuesta_invalida', quedan || 'La IA no devolvió ninguna cena que se pueda usar. Prueba de nuevo.', e.message);
      }
      return { cenas: b.cenas, warnings: Array.isArray(b.warnings) ? b.warnings : [], recibidas: b.recibidas ?? b.cenas.length, descartes: b.descartes ?? {}, model: b.model };
    },
    async usdaSearch({ terminos }) {
      const b = await post('/usda/search', { terminos }, (x) => Array.isArray(x.resultados));
      return { resultados: b.resultados };
    },
    async usdaFoods({ fdcIds }) {
      const b = await post('/usda/foods', { fdcIds }, (x) => Array.isArray(x.fichas));
      return { fichas: b.fichas, faltan: b.faltan ?? [] };
    },

    // Tickets de Mercadona (Inventario). Sin IA: el Worker solo lee el ticket y guarda fecha, líneas y hash en su cola (KV).
    // Nunca viaja el diario ni el inventario. Un 401 aquí es el token de la app; el del correo es otro y vive en el Apps Script.
    //   await ai.ticketsPendientes()                          -> { tickets: [{ hash, fecha, lineas, recibido, origen }] }
    //   await ai.ticketsRecibidos({ hashes })                 -> { borrados }  (la app ya los aplicó: se quitan de la cola)
    //   await ai.subirTicket({ pdf_base64 } | { texto })      -> { hash, fecha, lineas, duplicado }  (entra en la cola; luego se recoge)
    async ticketsPendientes() {
      const b = await post('/tickets/pendientes', {}, (x) => Array.isArray(x.tickets));
      return { tickets: b.tickets };
    },
    async ticketsRecibidos({ hashes }) {
      const b = await post('/tickets/recibidos', { hashes }, (x) => x.ok === true);
      return { borrados: b.borrados ?? hashes.length };
    },
    async subirTicket({ pdf_base64, texto }) {
      const payload = pdf_base64 ? { pdf_base64 } : { texto };
      const b = await post('/tickets', payload, (x) => x.ok === true && typeof x.hash === 'string');
      return { hash: b.hash, fecha: b.fecha, lineas: b.lineas, duplicado: b.duplicado === true };
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
