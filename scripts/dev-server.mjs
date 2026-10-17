// Servidor local para probar la app en tu PC con datos reales, sin desplegar nada:
//   node --env-file=.env scripts/dev-server.mjs [--port 8080] [--lan]
// - Sirve la app como GitHub Pages (la raíz del repo): http://localhost:8080/ -> /frontend/.
// - Atiende /parse y /health con el MISMO código del Worker (worker/src/index.js) y tu GEMINI_API_KEY de .env.
//   Cada dictado es una llamada real a Gemini (se cuentan en la consola).
// - Solo sirve frontend/ y data/: nunca .env, ficheros ocultos ni nada más del proyecto.
// - Por defecto solo escucha en tu PC. Con --lan escucha en tu red para abrirla desde el iPhone (misma Wi-Fi).
// En la app: Documento -> Conexión. Worker = la dirección de este servidor; token = APP_TOKEN de .env (o "local").
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../worker/src/index.js';
import { callGemini } from '../worker/src/providers/gemini.js';
import { geminiModel } from './gemini-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLICO = ['frontend', 'data'];
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.md': 'text/plain; charset=utf-8',
};

// Ruta de fichero para una URL, o null si no se puede servir (fuera de frontend/ y data/, "..", ocultos).
export function staticPath(pathname, base = root) {
  let parts;
  try { parts = decodeURIComponent(pathname).split('/').filter(Boolean); } catch { return null; }
  if (!parts.length || !PUBLICO.includes(parts[0])) return null;
  if (parts.some((p) => p === '..' || p.startsWith('.') || p.includes('\\') || p.includes(':'))) return null;
  const file = resolve(base, ...parts, ...(pathname.endsWith('/') ? ['index.html'] : []));
  const dir = resolve(base, parts[0]);
  return file === dir || file.startsWith(dir + sep) ? file : null;
}

const readBody = (req) => new Promise((ok, ko) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c)).on('end', () => ok(Buffer.concat(chunks))).on('error', ko);
});

export function createDevServer({ env, callModel, base = root }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname === '/parse' || url.pathname === '/health') {
        const headers = {};
        for (const h of ['content-type', 'x-app-token', 'origin']) if (req.headers[h]) headers[h] = req.headers[h];
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        // La app y el "Worker" comparten origen: se permite el de este mismo servidor (localhost o la IP de tu PC).
        const r = await handleRequest(new Request(url, { method: req.method, headers, body }), { ...env, ALLOWED_ORIGIN: `http://${req.headers.host}` }, callModel ? { callModel } : {});
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      if (url.pathname === '/') { res.writeHead(302, { Location: '/frontend/' }); res.end(); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      const file = staticPath(url.pathname, base);
      const info = file && await stat(file).catch(() => null);
      if (info?.isDirectory()) { res.writeHead(302, { Location: `${url.pathname}/` }); res.end(); return; }
      if (!info) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); return; }
      res.writeHead(200, { 'Content-Type': TIPOS[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Error del servidor local: ${e.message}`);
    }
  });
}

// ---------- ejecución directa ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--port');
  const port = pi >= 0 ? Number(args[pi + 1]) : 8080;
  const lan = args.includes('--lan');
  const model = geminiModel(root);
  if (!process.env.GEMINI_API_KEY) console.warn('Aviso: falta GEMINI_API_KEY (arranca con node --env-file=.env ...). La app funcionará, pero "Procesar" dará error de configuración.');
  const token = process.env.APP_TOKEN || 'local';
  let llamadas = 0;
  const callModel = (e, a) => { llamadas++; console.log(`[gemini] llamada n.º ${llamadas} (${e.GEMINI_MODEL})`); return callGemini({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL, ...a }); };
  const server = createDevServer({ env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: model, APP_TOKEN: token }, callModel });
  server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`App: http://localhost:${port}/  (modelo: ${model})`);
    if (lan) {
      const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
      for (const ip of ips) console.log(`En el iPhone (misma Wi-Fi): http://${ip}:${port}/`);
      console.log('Windows puede pedir permiso en el firewall: acéptalo solo para redes privadas.');
    }
    console.log(`En la app: Documento -> Conexión. Worker = la misma dirección (sin /frontend/). Token = ${process.env.APP_TOKEN ? 'tu APP_TOKEN de .env' : '"local"'}.`);
    console.log('Ctrl+C para parar.');
  });
}
