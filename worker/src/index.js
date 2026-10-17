// Cloudflare Worker: POST /parse { texto, alimentos } -> { items, unmatched, warnings }.
// Solo recibe la frase dictada y la lista compacta (id, nombre, alias, porciones, variante). Nunca nutrientes ni diario.
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserPrompt } from './prompt.js';
import { parseModelJson, checkStructure, normalizeAiResponse } from '../../frontend/js/core/ai-validate.js';
import { callGemini, ProviderError } from './providers/gemini.js';

const MAX_BODY = 200_000;
const MAX_TEXT = 1000;
const MAX_FOODS = 600;

// Llama al proveedor configurado. El modelo sale de UNA variable: GEMINI_MODEL (wrangler.toml).
const defaultCallModel = (env, args) => callGemini({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, ...args });

function corsHeaders(origin, env) {
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    out.push(c);
  }
  return out;
}

export async function handleRequest(request, env, { callModel = defaultCallModel } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);

  if (request.method === 'OPTIONS') return cors['Access-Control-Allow-Origin'] ? new Response(null, { status: 204, headers: cors }) : json(403, { error: 'origen_no_permitido' });
  if (url.pathname === '/health' && request.method === 'GET') return json(200, { ok: true }, cors);
  if (url.pathname !== '/parse' || request.method !== 'POST') return json(404, { error: 'no_encontrado' }, cors);

  if (origin && !cors['Access-Control-Allow-Origin']) return json(403, { error: 'origen_no_permitido' });
  if (!env.APP_TOKEN || !safeEqual(request.headers.get('X-App-Token'), env.APP_TOKEN)) return json(401, { error: 'token_invalido' }, cors);
  if (!env.GEMINI_MODEL || !env.GEMINI_API_KEY) return json(500, { error: 'configuracion_incompleta' }, cors);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: 'cuerpo_demasiado_grande' }, cors);
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'json_invalido' }, cors); }
  const texto = typeof body?.texto === 'string' ? body.texto.trim() : '';
  if (!texto || texto.length > MAX_TEXT) return json(400, { error: 'texto_invalido', detalle: `entre 1 y ${MAX_TEXT} caracteres` }, cors);
  const alimentos = sanitizeFoods(body?.alimentos);
  if (!alimentos) return json(400, { error: 'alimentos_invalidos' }, cors);

  const args = { system: SYSTEM_PROMPT, user: buildUserPrompt(texto, alimentos), schema: RESPONSE_SCHEMA };
  let lastError = 'sin intentos';
  for (let attempt = 1; attempt <= 2; attempt++) { // reintenta UNA vez si el JSON es inválido
    let rawModel;
    try {
      rawModel = await callModel(env, args);
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : 502;
      return json(status === 429 ? 429 : 502, { error: status === 429 ? 'limite_de_uso' : 'proveedor_ia', status }, cors);
    }
    const parsed = parseModelJson(rawModel);
    if (!parsed.ok) { lastError = parsed.error; continue; }
    const structure = checkStructure(parsed.data);
    if (!structure.ok) { lastError = structure.error; continue; }
    const result = normalizeAiResponse(parsed.data, alimentos);
    return json(200, { ...result, model: env.GEMINI_MODEL, attempts: attempt }, cors);
  }
  return json(502, { error: 'respuesta_invalida', detalle: lastError }, cors);
}

export default { fetch: (request, env) => handleRequest(request, env) };
