// Chrome headless por el protocolo DevTools (WebSocket), sin dependencias. Lo comparten scripts/capturas.mjs (capturas de la
// app) y tests/layout-chrome.test.js (comprobaciones de layout que jsdom no puede hacer).
//   const chrome = await lanzarChrome();                       // lanza Chrome con un perfil vacío y temporal
//   const p = await chrome.abrirPestana({ url, ancho: 375, alto: 667, tema: 'claro', margenInferior: 34 });
//   await p.evaluar('document.title');                         // Runtime.evaluate (espera promesas, devuelve el valor)
//   p.zonaSegura;                                              // true si Chrome aplicó la zona segura pedida (margenInferior)
//   await p.captura({ completa: false });                      // Buffer PNG
//   await p.cerrar(); await chrome.cerrar();
// Chrome, Chromium o Edge: ruta en CHROME_PATH o las habituales de Windows y Linux. Sin ninguno, buscarChrome() devuelve null.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATOS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const TIEMPO_SEND_MS = 30000; // si Chrome se cuelga, cada orden se rechaza a los 30 s en vez de dejar colgado el proceso

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function buscarChrome() {
  return CANDIDATOS.find((p) => p && existsSync(p)) ?? null;
}

export async function lanzarChrome({ chrome = buscarChrome() } = {}) {
  if (!chrome) throw new Error('No encuentro Chrome: pon su ruta en CHROME_PATH.');
  const perfil = await mkdtemp(join(tmpdir(), 'nt-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let ws = null;
  const cerrar = async () => {
    try { ws?.close(); } catch { /* ya cerrado */ }
    proc.kill();
    for (let i = 0; i < 10; i++) { try { await rm(perfil, { recursive: true, force: true }); break; } catch { await dormir(300); } }
  };
  try {
    const wsUrl = await new Promise((ok, ko) => {
      let buf = '';
      const limite = setTimeout(() => ko(new Error('Chrome no arrancó en 15 s')), 15000);
      const fin = (f, v) => { clearTimeout(limite); f(v); };
      proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) fin(ok, m[1]); });
      proc.on('exit', () => fin(ko, new Error('Chrome se cerró al arrancar')));
      proc.on('error', (e) => fin(ko, new Error(`No se pudo lanzar Chrome (${chrome}): ${e.message}`)));
    });
    ws = new WebSocket(wsUrl);
    await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('No se pudo conectar con Chrome')); });
  } catch (e) { await cerrar(); throw e; }
  let n = 0;
  const pend = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (!d.id || !pend.has(d.id)) return;
    const { ok, ko } = pend.get(d.id); pend.delete(d.id);
    if (d.error) ko(new Error(d.error.message)); else ok(d.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, ko) => {
    const id = ++n;
    const limite = setTimeout(() => { pend.delete(id); ko(new Error(`Chrome no contestó a ${method} en ${TIEMPO_SEND_MS / 1000} s`)); }, TIEMPO_SEND_MS);
    pend.set(id, { ok: (v) => { clearTimeout(limite); ok(v); }, ko: (e) => { clearTimeout(limite); ko(e); } });
    try { ws.send(JSON.stringify({ id, method, params, sessionId })); } catch (e) { clearTimeout(limite); pend.delete(id); ko(e); }
  });

  // Una pestaña con tamaño de móvil y tema claro u oscuro; espera a que la página cargue.
  async function abrirPestana({ url, ancho = 375, alto = 812, tema = 'claro', factor = 2, margenInferior = 0 }) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: factor, mobile: true }, s);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: tema === 'oscuro' ? 'dark' : 'light' }] }, s);
    // Zona segura del iPhone (la barra de inicio): env(safe-area-inset-bottom). Si esta versión de Chrome no lo admite se sigue sin ella,
    // pero `zonaSegura` queda en false para que quien llama lo avise (sin pedirla, es false).
    let zonaSegura = false;
    if (margenInferior) zonaSegura = await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: margenInferior } }, s).then(() => true, () => false);
    await send('Page.navigate', { url }, s);
    const evaluar = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
      if (r.exceptionDetails) throw new Error(`Error en la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    for (let i = 0; i < 50 && (await evaluar('document.readyState')) !== 'complete'; i++) await dormir(200);
    const captura = async ({ completa = false } = {}) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: completa }, s);
      return Buffer.from(data, 'base64');
    };
    return { evaluar, captura, zonaSegura, cerrar: () => send('Target.closeTarget', { targetId }) };
  }

  return { abrirPestana, cerrar, ruta: chrome };
}
