// Capturas headless de la app (para revisar cambios de UI): Chrome sin ventana, ancho de móvil, tema claro y oscuro.
//   node scripts/capturas.mjs --nombre diario [--url http://localhost:8080/] [--out capturas] [--ancho 375] [--alto 812]
//        [--tema claro|oscuro|ambos] [--js "código que se ejecuta tras cargar (puede devolver una promesa)"] [--espera 800]
//        [--completa]
// Necesita la app servida (node scripts/dev-server.mjs; sin --env-file basta para la parte que no usa la IA) y Chrome,
// Chromium o Edge (o su ruta en CHROME_PATH). Sin dependencias: habla con Chrome por el protocolo DevTools (WebSocket).
// Escribe <out>/<nombre>-<tema>-<ancho>.png y avisa si hay scroll horizontal. Cada ejecución usa un perfil vacío y temporal.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const url = opt('url', 'http://localhost:8080/');
const nombre = opt('nombre', 'captura');
const out = resolve(opt('out', 'capturas'));
const ancho = Number(opt('ancho', 375));
const alto = Number(opt('alto', 812));
const temas = { claro: ['claro'], oscuro: ['oscuro'], ambos: ['claro', 'oscuro'] }[opt('tema', 'ambos')];
const js = opt('js', '');
const espera = Number(opt('espera', 800));
const completa = args.includes('--completa');
if (!temas) { console.error('--tema debe ser claro, oscuro o ambos'); process.exit(1); }

const CANDIDATOS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
const chrome = CANDIDATOS.find((p) => p && existsSync(p));
if (!chrome) { console.error('No encuentro Chrome: pon su ruta en CHROME_PATH.'); process.exit(1); }

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = await mkdtemp(join(tmpdir(), 'nt-capturas-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run',
  '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });

async function cerrar(codigo) {
  proc.kill();
  for (let i = 0; i < 10; i++) { try { await rm(perfil, { recursive: true, force: true }); break; } catch { await dormir(300); } }
  process.exit(codigo);
}

try {
  const wsUrl = await new Promise((ok, ko) => {
    let buf = '';
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]); });
    proc.on('exit', () => ko(new Error('Chrome se cerró al arrancar')));
    setTimeout(() => ko(new Error('Chrome no arrancó en 15 s')), 15000);
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('No se pudo conectar con Chrome')); });
  let n = 0;
  const pend = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (!d.id || !pend.has(d.id)) return;
    const { ok, ko } = pend.get(d.id); pend.delete(d.id);
    if (d.error) ko(new Error(d.error.message)); else ok(d.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, ko) => {
    const id = ++n; pend.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const evaluar = async (expression, s) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
    if (r.exceptionDetails) throw new Error(`Error en la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };

  await mkdir(out, { recursive: true });
  for (const tema of temas) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 2, mobile: true }, s);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: tema === 'oscuro' ? 'dark' : 'light' }] }, s);
    await send('Page.navigate', { url }, s);
    for (let i = 0; i < 50 && (await evaluar('document.readyState', s)) !== 'complete'; i++) await dormir(200);
    await dormir(espera);
    if (js) { await evaluar(`(async () => { ${js} })()`, s); await dormir(espera); }
    const desborde = await evaluar('document.documentElement.scrollWidth - window.innerWidth', s);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: completa }, s);
    const fichero = join(out, `${nombre}-${tema}-${ancho}.png`);
    await writeFile(fichero, Buffer.from(data, 'base64'));
    console.log(`${fichero}${desborde > 0 ? `  ⚠ scroll horizontal de ${desborde} px` : ''}`);
    await send('Target.closeTarget', { targetId });
  }
  ws.close();
  await cerrar(0);
} catch (e) {
  console.error(e.message);
  await cerrar(1);
}
