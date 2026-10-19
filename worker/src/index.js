// Cloudflare Worker:
//   POST /parse { texto, alimentos } -> { items, unmatched, warnings }
//   POST /estimate { texto, alimentos } -> { plato, gramos, total_estimado, ingredientes, warnings }   («Estimar con IA»)
//   POST /usda/search { terminos } -> { resultados }        POST /usda/foods { fdcIds } -> { fichas }
//   GET /health
// A Gemini solo viajan la frase dictada y la lista compacta (id, nombre, alias, porciones, variante); a USDA, solo
// términos de búsqueda y fdcId. Nunca nutrientes ni diario. USDA solo se consulta tras una acción del usuario.
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserPrompt, ESTIMATE_SYSTEM_PROMPT, ESTIMATE_SCHEMA, buildEstimatePrompt } from './prompt.js';
import { parseModelJson, checkStructure, normalizeAiResponse } from '../../frontend/js/core/ai-validate.js';
import { checkEstimateStructure, normalizeEstimate, MAX_TERMINO, MAX_INGREDIENTES } from '../../frontend/js/core/estimate-validate.js';
import { findCandidates, fichaUsda, fortificacion, UsdaError } from '../../frontend/js/core/usda-core.js';
import { callGemini, ProviderError } from './providers/gemini.js';
import { createUsda } from './providers/usda.js';
import usdaMap from '../../data/usda-map.json' with { type: 'json' };
import settingsData from '../../data/settings.json' with { type: 'json' };

const MAX_BODY = 200_000;
const MAX_TEXT = 1000;
const MAX_FOODS = 600;
export const MAX_TERMINOS = MAX_INGREDIENTES; // búsquedas de USDA por petición: una por ingrediente que falta, todos en una
export const MAX_FDC = 20; // detalle de USDA: una sola llamada

// Llama al proveedor configurado. El modelo sale de UNA variable: GEMINI_MODEL (wrangler.toml).
// Si Google falla (5xx), UN reintento con el mismo modelo tras RETRY_MS y, si vuelve a fallar, UNA llamada al modelo de
// respaldo GEMINI_MODEL_FALLBACK (si está puesto y es otro). Un modelo que Google ya no encuentra (404) pasa directo al
// respaldo. 429, clave y demás errores no se reintentan. Devuelve { text, model } (el modelo que contestó).
export const RETRY_MS = 2000;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function callModelResiliente(env, args, { call = callGemini, sleep = esperar } = {}) {
  const ask = async (model) => ({ text: await call({ apiKey: env.GEMINI_API_KEY, model, ...args }), model });
  const respaldo = env.GEMINI_MODEL_FALLBACK && env.GEMINI_MODEL_FALLBACK !== env.GEMINI_MODEL ? env.GEMINI_MODEL_FALLBACK : null;
  const caido = (e) => e instanceof ProviderError && e.status >= 500;
  let error;
  try {
    return await ask(env.GEMINI_MODEL);
  } catch (e) {
    error = e;
  }
  if (caido(error)) {
    console.error(`IA: ${env.GEMINI_MODEL} falló (${error.status}); reintento en ${RETRY_MS / 1000} s`);
    await sleep(RETRY_MS);
    try {
      return await ask(env.GEMINI_MODEL);
    } catch (e) {
      error = e;
    }
  }
  if (respaldo && (caido(error) || (error instanceof ProviderError && error.status === 404))) {
    console.error(`IA: ${env.GEMINI_MODEL} sigue fallando (${error.status}); pruebo el respaldo ${respaldo}`);
    return ask(respaldo); // si también falla, su error es el que se clasifica
  }
  throw error;
}
const defaultCallModel = (env, args) => callModelResiliente(env, args);

function corsHeaders(origin, env) {
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''));
  const y = new TextEncoder().encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Se queda SOLO con los campos permitidos, aunque el cliente envíe más (p. ej. nutrientes).
function sanitizeFoods(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_FOODS) return null;
  const out = [];
  for (const f of list) {
    if (!f || typeof f.id !== 'string' || typeof f.nombre !== 'string' || !f.id) return null;
    const c = { id: f.id, nombre: f.nombre };
    if (Array.isArray(f.alias)) c.alias = f.alias.filter((a) => typeof a === 'string');
    if (Array.isArray(f.porciones)) {
      c.porciones = f.porciones.filter((p) => p && typeof p.nombre === 'string' && Number.isFinite(p.gramos)).map((p) => ({ nombre: p.nombre, gramos: p.gramos }));
    }
    if (typeof f.estado === 'string' && f.estado) c.estado = f.estado;
    if (typeof f.grupo === 'string' && f.grupo) { c.grupo = f.grupo; c.defecto = f.defecto === true; }
    if (f.peso_en_crudo === true) c.peso_en_crudo = true;
    out.push(c);
  }
  return out;
}

// Cuerpo JSON de una petición POST, o la respuesta de error.
async function readJson(request, cors) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { error: json(413, { error: 'cuerpo_demasiado_grande' }, cors) };
  try { return { body: JSON.parse(raw) }; } catch { return { error: json(400, { error: 'json_invalido' }, cors) }; }
}

// Frase + lista compacta (lo mismo en /parse y /estimate).
function readTextoYAlimentos(body, cors) {
  const texto = typeof body?.texto === 'string' ? body.texto.trim() : '';
  if (!texto || texto.length > MAX_TEXT) return { error: json(400, { error: 'texto_invalido', detalle: `entre 1 y ${MAX_TEXT} caracteres` }, cors) };
  const alimentos = sanitizeFoods(body?.alimentos);
  if (!alimentos) return { error: json(400, { error: 'alimentos_invalidos' }, cors) };
  return { texto, alimentos };
}

// Qué le pasa al proveedor, para que la app diga algo útil (el código viaja en `error`; `status` es el de Google):
// limite_de_uso (429, cuota) · modelo_no_disponible (404, retirado o mal escrito) · clave_ia (401/403 o clave no válida) ·
// google_caido (5xx: sobrecarga o caída, suele ser temporal) · error_worker (el Worker no llegó a Google) · proveedor_ia (otro).
export function classifyProviderError(e, env = {}) {
  if (!(e instanceof ProviderError)) return { error: 'error_worker', status: null, detalle: String(e?.message ?? e).slice(0, 200) };
  const clave = env.GEMINI_API_KEY;
  const detalle = (clave ? String(e.message).split(clave).join('***') : String(e.message)).slice(0, 300);
  const s = e.status;
  let error = 'proveedor_ia';
  if (s === 429) error = 'limite_de_uso';
  else if (s === 404) error = 'modelo_no_disponible';
  else if (s === 401 || s === 403 || (s === 400 && /api key/i.test(detalle))) error = 'clave_ia';
  else if (s >= 500) error = 'google_caido';
  return { error, status: s, detalle };
}

// Una llamada al modelo y, solo si el JSON es inválido, UN reintento. validate(data) -> { ok, result?, error? }.
async function askModel(env, callModel, args, validate, cors) {
  let lastError = 'sin intentos';
  for (let attempt = 1; attempt <= 2; attempt++) {
    let rawModel;
    let modelo = env.GEMINI_MODEL;
    try {
      const r = await callModel(env, args);
      rawModel = typeof r === 'string' ? r : r.text; // los simulados devuelven el texto; el real, { text, model }
      if (typeof r !== 'string' && r.model) modelo = r.model;
    } catch (e) {
      const c = classifyProviderError(e, env);
      console.error(`IA: ${c.error} (${c.status ?? 'sin respuesta'}) ${c.detalle}`); // para `npm run worker:logs`; nunca la clave
      return json(c.error === 'limite_de_uso' ? 429 : 502, { error: c.error, status: c.status }, cors);
    }
    const parsed = parseModelJson(rawModel);
    if (!parsed.ok) { lastError = parsed.error; continue; }
    const v = validate(parsed.data);
    if (!v.ok) { lastError = v.error; continue; }
    return json(200, { ...v.result, model: modelo, attempts: attempt }, cors);
  }
  return json(502, { error: 'respuesta_invalida', detalle: lastError }, cors);
}

const parseValidate = (alimentos) => (data) => {
  const structure = checkStructure(data);
  return structure.ok ? { ok: true, result: normalizeAiResponse(data, alimentos) } : structure;
};

const estimateValidate = (alimentos, texto) => (data) => {
  const structure = checkEstimateStructure(data);
  if (!structure.ok) return structure;
  const r = normalizeEstimate(data, alimentos, { texto });
  if (!r.ok) return r;
  const { ok, ...result } = r;
  return { ok: true, result };
};

// ---------- USDA ----------
const required = settingsData.requiredNutrients;
const threshold = settingsData.completenessThreshold;
const r2 = (x) => Math.round(x * 100) / 100;

function usdaFail(e, cors) {
  const status = e instanceof UsdaError ? e.status : 502;
  if (status === 429) return json(429, { error: 'limite_usda' }, cors);
  if (status === 401 || status === 403) return json(502, { error: 'usda_clave', status }, cors);
  return json(502, { error: 'usda', status }, cors);
}

// Candidatos de cada término: solo Foundation y SR Legacy, una búsqueda por término, ordenados por completitud.
async function usdaSearch(body, client, cors) {
  const vistos = new Set();
  const terminos = [];
  for (const t of Array.isArray(body?.terminos) ? body.terminos : []) {
    const s = typeof t === 'string' ? t.trim().replace(/\s+/g, ' ') : '';
    if (!s || s.length > MAX_TERMINO) return json(400, { error: 'terminos_invalidos', detalle: `entre 1 y ${MAX_TERMINO} caracteres` }, cors);
    const k = s.toLowerCase();
    if (!vistos.has(k)) { vistos.add(k); terminos.push(s); }
  }
  if (!terminos.length || terminos.length > MAX_TERMINOS) return json(400, { error: 'terminos_invalidos', detalle: `entre 1 y ${MAX_TERMINOS} términos` }, cors);
  // Se guardan los alimentos que devuelve la búsqueda para los avisos de fortificación (sin otra llamada).
  const encontrados = new Map();
  const conRegistro = { search: async (...a) => { const r = await client.search(...a); for (const f of r) encontrados.set(f.fdcId, f); return r; } };
  const resultados = [];
  try {
    for (const termino of terminos) {
      const r = await findCandidates(conRegistro, termino, { map: usdaMap, required, threshold, fndds: false });
      resultados.push({
        termino, estado: r.estado, motivo: r.motivo, sugerido: r.candidato?.fdcId ?? null,
        candidatos: r.candidatos.map((c) => ({ fdcId: c.fdcId, descripcion: c.descripcion, tipo: c.tipo, obligatorios: c.obligatorios, total: c.total, coincidencia: r2(c.coincidencia), preparaciones: c.preparaciones, fortificacion: fortificacion(encontrados.get(c.fdcId) ?? {}) })),
      });
    }
  } catch (e) { return usdaFail(e, cors); }
  return json(200, { resultados, llamadas: client.calls }, cors);
}

// Ficha de cada fdcId (valores por 100 g en las columnas del documento, avisos y fuente_usda). "Sin enriquecer" lo
// aplica la app con quitarEnriquecimiento y las columnas "enriquecibles" de cada ficha (así sirve desde su caché).
async function usdaFoods(body, client, cors) {
  const ids = Array.isArray(body?.fdcIds) ? [...new Set(body.fdcIds)] : [];
  if (!ids.length || ids.length > MAX_FDC || !ids.every((n) => Number.isInteger(n) && n > 0)) return json(400, { error: 'fdcids_invalidos', detalle: `entre 1 y ${MAX_FDC} números` }, cors);
  let usda;
  try { usda = await client.foods(ids); } catch (e) { return usdaFail(e, cors); }
  const columnas = usdaMap.enriquecimiento?.columnas ?? [];
  const fichas = usda.filter((u) => ids.includes(u?.fdcId)).map((u) => {
    const f = fichaUsda(u, usdaMap);
    return { ...f, enriquecibles: columnas.filter((k) => k in f.values) };
  });
  const faltan = ids.filter((id) => !fichas.some((f) => f.fdcId === id));
  return json(200, { fichas, faltan, llamadas: client.calls }, cors);
}

const RUTAS = ['/parse', '/estimate', '/usda/search', '/usda/foods'];

export async function handleRequest(request, env, { callModel = defaultCallModel, usdaClient = (e) => createUsda(e) } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);

  if (request.method === 'OPTIONS') return cors['Access-Control-Allow-Origin'] ? new Response(null, { status: 204, headers: cors }) : json(403, { error: 'origen_no_permitido' });
  // "Probar" de la app (no gasta IA): ¿tiene sus secretos? ¿el token enviado es el correcto? Nunca los valores.
  if (url.pathname === '/health' && request.method === 'GET') {
    const t = request.headers.get('X-App-Token');
    const token = t === null ? 'sin_token' : env.APP_TOKEN && safeEqual(t, env.APP_TOKEN) ? 'ok' : 'incorrecto';
    return json(200, { ok: true, configurado: Boolean(env.GEMINI_MODEL && env.GEMINI_API_KEY && env.APP_TOKEN), token }, cors);
  }
  if (!RUTAS.includes(url.pathname) || request.method !== 'POST') return json(404, { error: 'no_encontrado' }, cors);

  if (origin && !cors['Access-Control-Allow-Origin']) return json(403, { error: 'origen_no_permitido' });
  if (!env.APP_TOKEN || !safeEqual(request.headers.get('X-App-Token'), env.APP_TOKEN)) return json(401, { error: 'token_invalido' }, cors);

  if (url.pathname.startsWith('/usda/')) {
    if (!env.USDA_API_KEY) return json(500, { error: 'usda_sin_configurar' }, cors);
    const { body, error } = await readJson(request, cors);
    if (error) return error;
    const client = usdaClient(env);
    return url.pathname === '/usda/search' ? usdaSearch(body, client, cors) : usdaFoods(body, client, cors);
  }

  if (!env.GEMINI_MODEL || !env.GEMINI_API_KEY) return json(500, { error: 'configuracion_incompleta' }, cors);
  const { body, error } = await readJson(request, cors);
  if (error) return error;
  const entrada = readTextoYAlimentos(body, cors);
  if (entrada.error) return entrada.error;
  const { texto, alimentos } = entrada;

  if (url.pathname === '/estimate') {
    const args = { system: ESTIMATE_SYSTEM_PROMPT, user: buildEstimatePrompt(texto, alimentos), schema: ESTIMATE_SCHEMA };
    return askModel(env, callModel, args, estimateValidate(alimentos, texto), cors);
  }
  const args = { system: SYSTEM_PROMPT, user: buildUserPrompt(texto, alimentos), schema: RESPONSE_SCHEMA };
  return askModel(env, callModel, args, parseValidate(alimentos), cors);
}

export default { fetch: (request, env) => handleRequest(request, env) };
