// Capturas headless de la app (para revisar cambios de UI): Chrome sin ventana, ancho de móvil, tema claro y oscuro.
//   node scripts/capturas.mjs --nombre diario [--url http://localhost:8080/] [--out capturas] [--ancho 375] [--alto 812]
//        [--tema claro|oscuro|ambos] [--js "código que se ejecuta tras cargar (puede devolver una promesa)"] [--espera 800]
//        [--completa]
// Necesita la app servida (node scripts/dev-server.mjs; sin --env-file basta para la parte que no usa la IA) y Chrome,
// Chromium o Edge (o su ruta en CHROME_PATH). Sin dependencias: habla con Chrome por el protocolo DevTools (scripts/chrome-cdp.mjs).
// Escribe <out>/<nombre>-<tema>-<ancho>.png y avisa si hay scroll horizontal. Cada ejecución usa un perfil vacío y temporal.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buscarChrome, dormir, lanzarChrome } from './chrome-cdp.mjs';

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
if (!buscarChrome()) { console.error('No encuentro Chrome: pon su ruta en CHROME_PATH.'); process.exit(1); }

let chrome = null;
async function cerrar(codigo) {
  await chrome?.cerrar();
  process.exit(codigo);
}

try {
  chrome = await lanzarChrome();
  await mkdir(out, { recursive: true });
  for (const tema of temas) {
    const p = await chrome.abrirPestana({ url, ancho, alto, tema });
    await dormir(espera);
    if (js) { await p.evaluar(`(async () => { ${js} })()`); await dormir(espera); }
    const desborde = await p.evaluar('document.documentElement.scrollWidth - window.innerWidth');
    const fichero = join(out, `${nombre}-${tema}-${ancho}.png`);
    await writeFile(fichero, await p.captura({ completa }));
    console.log(`${fichero}${desborde > 0 ? `  ⚠ scroll horizontal de ${desborde} px` : ''}`);
    await p.cerrar();
  }
  await cerrar(0);
} catch (e) {
  console.error(e.message);
  await cerrar(1);
}
