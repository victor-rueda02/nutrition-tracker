// Cola de tickets de Mercadona (especificación en docs/inventario/ESPEC.md §4, pasos en docs/inventario/CORREO.md):
//   POST /tickets { pdf_base64 } | { texto }     -> lee el ticket (core/pdf-texto.js + core/ticket-parse.js) y lo deja en la cola
//   POST /tickets/pendientes                      -> { tickets: [{ hash, fecha, hora, lineas, recibido, origen }] }
//   POST /tickets/recibidos { hashes }            -> los borra de la cola (la app ya los ha recogido)
// Autenticación: /tickets acepta X-Mail-Token (secreto MAIL_TOKEN; lo usa el Apps Script del correo; sin CORS; solo vale para
// esta ruta) o X-App-Token (la app, con CORS); las otras dos rutas, solo X-App-Token (si se filtrara el del correo, nadie leería
// la cola). Lo único que se guarda en KV es { hash, fecha, hora, lineas, recibido, origen }: nunca el PDF ni el texto original, ni
// tienda, NIF, OP, nº de factura, tarjeta o IVA (la hora sí: con la fecha es el momento de la compra). Nada de esto va a Gemini ni a USDA (regla 6). Clave por hash (un ticket que
// ya está no se duplica) y caducidad de 30 días por si la app no llega a recogerlo.
import { textoDePdf, PdfError } from '../../frontend/js/core/pdf-texto.js';
import { parseTicket, TicketError } from '../../frontend/js/core/ticket-parse.js';

export const MAX_PDF = 2_000_000; // bytes de un PDF de ticket (los reales pesan 150-270 KB)
export const MAX_BODY_TICKETS = 3_000_000; // el JSON con el PDF en base64 (4/3 del PDF + margen)
export const MAX_TEXTO = 20_000; // caracteres de un ticket pegado (los reales, unos 3000)
export const TTL_TICKETS = 30 * 24 * 3600; // segundos
export const MAX_PENDIENTES = 200;
export const MAX_HASHES = 200;
const HASH = /^[0-9a-f]{64}$/;
const clave = (hash) => `ticket:${hash}`;

// Base64 (también la variante de URL) -> Uint8Array, o null si no lo es.
function deBase64(b64) {
  const s = String(b64).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function leerCuerpo(request, json, cors) {
  const declarado = Number(request.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_BODY_TICKETS) return { error: json(413, { error: 'cuerpo_demasiado_grande' }, cors) }; // sin leerlo
  const raw = await request.text();
  if (raw.length > MAX_BODY_TICKETS) return { error: json(413, { error: 'cuerpo_demasiado_grande' }, cors) };
  try { return { body: JSON.parse(raw) }; } catch { return { error: json(400, { error: 'json_invalido' }, cors) }; }
}

// Recibe un ticket (PDF o texto), lo lee y lo deja en la cola.
async function recibir(request, env, { json, cors, origen }) {
  const { body, error } = await leerCuerpo(request, json, cors);
  if (error) return error;
  const pdf = typeof body?.pdf_base64 === 'string' ? body.pdf_base64.trim() : '';
  const texto = typeof body?.texto === 'string' ? body.texto.trim() : '';
  if ((pdf ? 1 : 0) + (texto ? 1 : 0) !== 1) return json(400, { error: 'ticket_invalido', detalle: 'manda pdf_base64 o texto (uno solo)' }, cors);
  let plano;
  if (pdf) {
    if (Math.floor((pdf.length * 3) / 4) > MAX_PDF) return json(413, { error: 'pdf_demasiado_grande', detalle: `máximo ${MAX_PDF / 1_000_000} MB` }, cors);
    const bytes = deBase64(pdf);
    if (!bytes) return json(400, { error: 'pdf_invalido', detalle: 'base64 no válido' }, cors);
    if (bytes.length > MAX_PDF) return json(413, { error: 'pdf_demasiado_grande', detalle: `máximo ${MAX_PDF / 1_000_000} MB` }, cors);
    try {
      plano = await textoDePdf(bytes);
    } catch (e) {
      if (!(e instanceof PdfError)) throw e;
      console.error(`Tickets: PDF no legible (${e.code}): ${e.message}`);
      return json(422, { error: e.code, detalle: e.message }, cors);
    }
  } else {
    if (texto.length > MAX_TEXTO) return json(413, { error: 'texto_demasiado_largo', detalle: `máximo ${MAX_TEXTO} caracteres` }, cors);
    plano = texto;
  }
  let t;
  try {
    t = await parseTicket(plano);
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    console.error(`Tickets: ticket no legible (${e.code})`);
    return json(422, { error: 'ticket_ilegible', codigo: e.code, detalle: e.message }, cors);
  }
  const k = clave(t.hash);
  if (await env.TICKETS.get(k)) return json(200, { ok: true, hash: t.hash, fecha: t.fecha, lineas: t.lineas.length, duplicado: true }, cors);
  const registro = { hash: t.hash, fecha: t.fecha, hora: t.hora, lineas: t.lineas, recibido: new Date().toISOString(), origen };
  await env.TICKETS.put(k, JSON.stringify(registro), { expirationTtl: TTL_TICKETS });
  return json(200, { ok: true, hash: t.hash, fecha: t.fecha, lineas: t.lineas.length, duplicado: false }, cors);
}

// La cola: todos los tickets guardados (como mucho MAX_PENDIENTES), por fecha.
async function pendientes(env, { json, cors }) {
  const tickets = [];
  let cursor;
  for (;;) {
    const page = await env.TICKETS.list({ prefix: 'ticket:', limit: 100, ...(cursor ? { cursor } : {}) });
    for (const k of page.keys ?? []) {
      if (tickets.length >= MAX_PENDIENTES) break;
      const v = await env.TICKETS.get(k.name);
      if (!v) continue;
      try { tickets.push(JSON.parse(v)); } catch { console.error('Tickets: registro de la cola ilegible, se salta'); }
    }
    if (page.list_complete || !page.cursor || tickets.length >= MAX_PENDIENTES) break;
    cursor = page.cursor;
  }
  tickets.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : String(a.recibido) < String(b.recibido) ? -1 : 1));
  return json(200, { tickets }, cors);
}

async function recibidos(request, env, { json, cors }) {
  const { body, error } = await leerCuerpo(request, json, cors);
  if (error) return error;
  const hashes = Array.isArray(body?.hashes) ? [...new Set(body.hashes)] : null;
  if (!hashes || !hashes.length || hashes.length > MAX_HASHES || !hashes.every((h) => typeof h === 'string' && HASH.test(h))) {
    return json(400, { error: 'hashes_invalidos', detalle: `entre 1 y ${MAX_HASHES} hashes (SHA-256 en hexadecimal)` }, cors);
  }
  for (const h of hashes) await env.TICKETS.delete(clave(h));
  return json(200, { ok: true, borrados: hashes.length }, cors);
}

const RUTAS_TICKETS = ['/tickets', '/tickets/pendientes', '/tickets/recibidos'];
export const esRutaDeTickets = (path) => RUTAS_TICKETS.includes(path);

// `h`: utilidades de index.js ({ json, safeEqual, cors (las de la app), origin }).
export async function handleTickets(request, env, url, h) {
  const { json, safeEqual, origin } = h;
  if (request.method !== 'POST' || !esRutaDeTickets(url.pathname)) return json(404, { error: 'no_encontrado' }, h.cors);
  // Correo (Apps Script): solo /tickets, con su propio token y sin CORS (no lo llama un navegador).
  const mail = request.headers.get('X-Mail-Token');
  const porCorreo = url.pathname === '/tickets' && mail !== null && Boolean(env.MAIL_TOKEN) && safeEqual(mail, env.MAIL_TOKEN);
  const cors = porCorreo ? {} : h.cors;
  if (!porCorreo) {
    if (origin && !h.cors['Access-Control-Allow-Origin']) return json(403, { error: 'origen_no_permitido' });
    if (!env.APP_TOKEN || !safeEqual(request.headers.get('X-App-Token'), env.APP_TOKEN)) return json(401, { error: 'token_invalido' }, cors);
  }
  if (!env.TICKETS) return json(500, { error: 'tickets_sin_configurar' }, cors);
  const ctx = { json, cors };
  try {
    if (url.pathname === '/tickets') return await recibir(request, env, { ...ctx, origen: porCorreo ? 'correo' : 'app' });
    if (url.pathname === '/tickets/pendientes') return await pendientes(env, ctx);
    return await recibidos(request, env, ctx);
  } catch (e) {
    console.error(`Tickets: fallo inesperado: ${String(e?.message ?? e).slice(0, 200)}`); // para `npm run worker:logs`; nunca el contenido del ticket
    return json(500, { error: 'error_worker' }, cors);
  }
}
