// Capturas headless de Inventario, Recuento, Dudas y Lista de la compra (375 px, claro y oscuro), con datos de ejemplo inventados
// que se escriben en un perfil vacío y temporal de Chrome (nunca tocan tus datos). Sin IA ni red: sirve la app con el servidor local
// (scripts/dev-server.mjs, KV en memoria) en un puerto libre.
//   node scripts/capturas-inventario.mjs [--out capturas] [--ancho 375] [--alto 812]
// Necesita Chrome, Chromium o Edge (o su ruta en CHROME_PATH). Escribe <out>/<pantalla>-<tema>-<ancho>.png y avisa si hay scroll horizontal.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buscarChrome, dormir, lanzarChrome } from './chrome-cdp.mjs';
import { createDevServer, kvEnMemoria } from './dev-server.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const out = resolve(opt('out', 'capturas'));
const ancho = Number(opt('ancho', 375));
const alto = Number(opt('alto', 812));
if (!buscarChrome()) { console.error('No encuentro Chrome: pon su ruta en CHROME_PATH.'); process.exit(1); }

// Datos de ejemplo (momentos relativos a hoy, en la hora del navegador).
const SEMILLA = `(async () => {
  const dos = (n) => String(n).padStart(2, '0');
  const dia = (d) => { const x = new Date(Date.now() + d * 86400000); return x.getFullYear() + '-' + dos(x.getMonth() + 1) + '-' + dos(x.getDate()); };
  const ev = (i, tipo, momento, food_id, gramos, extra = {}) => ({ id: 'cap' + i, tipo, momento, food_id, gramos, ...extra });
  const eventos = [
    ev(1, 'recuento', dia(-3) + 'T10:00', 'arroz_blanco_crudo', 2000), ev(2, 'recuento', dia(-3) + 'T10:00', 'avena_copos', 1000),
    ev(3, 'recuento', dia(-3) + 'T10:00', 'pasta_seca', 100), ev(4, 'recuento', dia(-3) + 'T10:00', 'lentejas_secas', 1000),
    ev(5, 'recuento', dia(-3) + 'T10:00', 'almendras_crudas', 400), ev(6, 'recuento', dia(-3) + 'T10:00', 'nueces', 270),
    ev(7, 'recuento', dia(-3) + 'T10:00', 'atun_lata_aceite', 720), ev(8, 'recuento', dia(-3) + 'T10:00', 'pechuga_pollo_cruda', 1200),
    ev(9, 'recuento', dia(-3) + 'T10:00', 'manzana_con_piel', 900), ev(10, 'recuento', dia(-3) + 'T10:00', 'cebolla', 1500),
    ev(11, 'ajuste', dia(-2) + 'T09:00', 'pasta_seca', -300, { motivo: 'caducado' }),
    ev(12, 'compra', dia(-1) + 'T20:58', 'avena_copos', 500, { ticket: 'h-demo', linea: 3 }),
  ];
  const dudas = [
    { id: 'dud1', ticket: 'h-demo', linea: 7, fecha: dia(-1), hora: '20:58', momento: dia(-1) + 'T20:58', descripcion: 'GRIEGO LIGERO P-6', cantidad: 1, peso_kg: null, candidatos: ['yogur_griego_ligero'], motivo: 'parecido', gramos_sugeridos: null },
    { id: 'dud2', ticket: 'h-demo', linea: 9, fecha: dia(-1), hora: '20:58', momento: dia(-1) + 'T20:58', descripcion: 'PECHUGA FAMILIAR', cantidad: 1, peso_kg: null, candidatos: ['pechuga_pollo_cruda'], motivo: 'preguntar_gramos', food_id: 'pechuga_pollo_cruda', gramos_sugeridos: null },
    { id: 'dud3', ticket: 'h-demo', linea: 11, fecha: dia(-1), hora: '20:58', momento: dia(-1) + 'T20:58', descripcion: 'MANDARINA', cantidad: 1, peso_kg: 0.798, candidatos: ['mandarina', 'kiwi_verde'], motivo: 'parecido', gramos_sugeridos: 798 },
  ];
  const inventario = { version: 1, eventos, tickets: { 'h-demo': { fecha: dia(-1), hora: '20:58', aplicado: dia(-1) + 'T21:00', origen: 'correo' } }, dudas, aprendido: {} };
  const plan = { periodos: [{ id: 'volumen_p20_rutina_nov', nombre: 'p20', inicio: dia(-30) }], excepciones: [] };
  const abre = () => new Promise((ok, ko) => { const r = indexedDB.open('nutrition-tracker', 1); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const db = await abre();
  const put = (store, v) => new Promise((ok, ko) => { const r = db.transaction(store, 'readwrite').objectStore(store).put(v); r.onsuccess = () => ok(); r.onerror = () => ko(r.error); });
  await put('settings', { key: 'inventario', value: inventario });
  await put('settings', { key: 'plan_objetivos', value: plan });
  await put('meals', { id: 'cap-m1', date: dia(0), meal: 'comida', createdAt: new Date().toISOString(), text: '', lines: [{ food_id: 'arroz_blanco_crudo', grams: 150, source_text: '' }, { food_id: 'pechuga_pollo_cruda', grams: 180, source_text: '' }] });
  db.close();
})()`;

const pulsar = (p, texto) => p.evaluar(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(texto)})); if (!b) throw new Error('no hay botón: ${texto.replace(/'/g, '')}'); b.click(); })()`);
const escribir = (p, selector, valor) => p.evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);

const servidor = createDevServer({ env: { APP_TOKEN: 'local', GEMINI_MODEL: 'm', GEMINI_API_KEY: 'x', TICKETS: kvEnMemoria() }, callModel: () => { throw new Error('las capturas no usan la IA'); } });
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${servidor.address().port}/frontend/`;
let chrome = null;
try {
  chrome = await lanzarChrome();
  await mkdir(out, { recursive: true });
  for (const tema of ['claro', 'oscuro']) {
    const p = await chrome.abrirPestana({ url: base, ancho, alto, tema });
    await dormir(1500); // primera carga: crea la base de datos y copia el documento
    await p.evaluar(SEMILLA);
    await p.evaluar('location.reload()').catch(() => {});
    await dormir(2000);
    const guarda = async (nombre, completa = false) => {
      await dormir(700);
      const desborde = await p.evaluar('document.documentElement.scrollWidth - window.innerWidth');
      const f = join(out, `${nombre}-${tema}-${ancho}.png`);
      await writeFile(f, await p.captura({ completa }));
      console.log(`${f}${desborde > 0 ? `  ⚠ scroll horizontal de ${desborde} px` : ''}`);
    };
    await pulsar(p, 'Alimentos'); await dormir(400);
    await guarda('alimentos');
    await pulsar(p, 'Ver inventario'); await dormir(900);
    await guarda('inventario');
    await guarda('inventario-completo', true);
    await pulsar(p, 'Hacer recuento'); await dormir(500);
    await escribir(p, '.rec-fila[data-id="avena_copos"] input[aria-label^="Envases"]', '2');
    await escribir(p, '.rec-fila[data-id="arroz_blanco_crudo"] input[aria-label^="Gramos"]', '1850');
    await guarda('recuento');
    await pulsar(p, 'Cancelar'); await dormir(400);
    await pulsar(p, 'Dudas ('); await dormir(500);
    await escribir(p, '.duda[data-id="dud2"] input.grams', '700');
    await p.evaluar('document.querySelector(\'.duda[data-id="dud1"] button.candidato\').click()');
    await guarda('dudas', true);
    await pulsar(p, '‹ Volver'); await dormir(400);
    await pulsar(p, 'Lista de la compra'); await dormir(700);
    await guarda('lista');
    await guarda('lista-completa', true);
    await pulsar(p, '‹ Volver'); await dormir(400);
    await p.evaluar('document.querySelector(\'.inv-fila[data-id="pasta_seca"] button\').click()'); await dormir(600);
    await guarda('ficha');
    await p.cerrar();
  }
  await chrome.cerrar();
} catch (e) {
  console.error(e.message);
  await chrome?.cerrar();
  process.exitCode = 1;
} finally {
  await new Promise((ok) => servidor.close(ok));
  process.exit(process.exitCode ?? 0);
}
