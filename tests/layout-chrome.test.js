// Layout real en Chrome headless (por el protocolo DevTools, scripts/chrome-cdp.mjs): en cada pantalla con una acción principal
// («Guardar receta», «Guardar», «Usar», «Añadir»…) el botón tiene que poder verse entero y pulsarse al hacer scroll hasta el
// final, sin que lo tape la barra inferior de navegación, el pie fijo de acciones ni la cabecera. jsdom no calcula layout, por
// eso este test usa Chrome de verdad; sin Chrome (o sin CHROME_PATH) se salta con un aviso y `npm test` sigue en verde.
// Sirve la app con un servidor local propio (copia temporal de frontend/ y data/, puerto libre, IA y USDA simulados): sin red.
// Tarda unos 40 s: con NT_SIN_CHROME=1 (p. ej. `NT_SIN_CHROME=1 npm test`; en PowerShell `$env:NT_SIN_CHROME='1'`) se salta con un aviso.
// Una comprobación estructural sin Chrome (que no dependa del layout) está en tests/ui-navegacion.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarChrome, lanzarChrome } from '../scripts/chrome-cdp.mjs';
import { createDevServer } from '../scripts/dev-server.mjs';
import { buildBackup, backupToJSON } from '../frontend/js/core/backup.js';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromeRuta = buscarChrome();
const skip = process.env.NT_SIN_CHROME === '1' ? 'NT_SIN_CHROME=1: prueba de layout con Chrome omitida'
  : chromeRuta ? false : 'No hay Chrome, Chromium ni Edge (o CHROME_PATH): prueba de layout omitida';

// IA simulada: «Estimar con IA» devuelve ingredientes de mi documento; nunca se llama a Gemini ni a USDA.
const ESTIMACION = JSON.stringify({ plato: 'Plato de prueba', gramos_total: 300, ingredientes: [
  { food_id: 'avena_copos', nombre: 'Avena', gramos: 100 }, { food_id: 'kiwi_verde', nombre: 'Kiwi', gramos: 100 }, { food_id: 'leche_entera', nombre: 'Leche', gramos: 100 }] });
const TOKEN = 'tok';

// Ayudas que se inyectan en la página (la app no expone nada: se navega tocando botones, como Victor).
const AYUDA = `window.H = {
  w: (ms) => new Promise((r) => setTimeout(r, ms)),
  botones: () => [...document.querySelectorAll('button')],
  nombre: (b) => b.getAttribute('aria-label') || b.textContent.trim(),
  buscar(t, exacto = false, indice = 0) { // t: texto (contiene, o exacto) o { re: 'expresión' }
    const ok = (b) => (typeof t === 'object' ? new RegExp(t.re).test(b.textContent.trim()) : b.getAttribute('aria-label') === t || (exacto ? b.textContent.trim() === t : b.textContent.includes(t)));
    const l = this.botones().filter(ok);
    return l[indice < 0 ? l.length + indice : indice];
  },
  async click(t, exacto = false, indice = 0) {
    const b = this.buscar(t, exacto, indice);
    if (!b) throw new Error('no hay botón «' + t + '»; hay: ' + this.botones().map(this.nombre).join(' | '));
    b.click(); await this.w(60);
  },
  async escribir(sel, valor, indice = 0) {
    const el = document.querySelectorAll(sel)[indice];
    if (!el) throw new Error('no hay campo ' + sel);
    el.value = valor; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); await this.w(30);
  },
  async elegir(busqueda) { // selector de alimentos (hoja inferior): escribe y toca el primer resultado
    await this.escribir('.overlay input[type=search]', busqueda);
    const b = document.querySelector('.overlay .pick'); if (!b) throw new Error('sin resultados para ' + busqueda);
    b.click(); await this.w(100);
  },
  async anadirAlimentos(boton, ...nombres) { for (const n of nombres) { await this.click(boton); await this.elegir(n); } },
  async ponerGramos(g) { const l = [...document.querySelectorAll('input.grams')]; for (let i = 0; i < l.length; i++) await this.escribir('input.grams', g, i); },
  async archivo(sel, nombre, texto) { // elige un fichero en un <input type=file> sin diálogo
    const el = document.querySelector(sel); if (!el) throw new Error('no hay ' + sel);
    const dt = new DataTransfer(); dt.items.add(new File([texto], nombre)); el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true })); await this.w(400);
  },
  // ¿Se puede ver y pulsar? Scroll hasta el final; solo si el botón queda a media página (con contenido debajo) se centra; los del final
  // (pie fijo o última cosa de la pantalla) tienen que verse con el scroll al final, que es justo lo que tapaba la barra inferior.
  async verificar(t, exacto = false, indice = 0) {
    const el = this.buscar(t, exacto, indice);
    if (!el) return { ok: false, motivos: ['no existe el botón «' + JSON.stringify(t) + '»; hay: ' + this.botones().map(this.nombre).join(' | ')] };
    window.scrollTo(0, document.documentElement.scrollHeight); await this.w(60);
    const cab = document.querySelector('header.top'); const cabAbajo = cab ? cab.getBoundingClientRect().bottom : 0;
    let r = el.getBoundingClientRect();
    const tras = document.documentElement.scrollHeight - (scrollY + r.bottom); // contenido que queda debajo del botón
    if ((r.top < cabAbajo || r.bottom > innerHeight) && tras > 220) { el.scrollIntoView({ block: 'center' }); await this.w(60); r = el.getBoundingClientRect(); }
    const motivos = [];
    const barra = document.querySelector('nav.tabbar'); const pie = document.querySelector('footer.bar');
    if (barra && pie) motivos.push('la pantalla lleva a la vez la barra inferior y su pie de acciones');
    if (r.height < 43.5) motivos.push('alto ' + Math.round(r.height) + ' px (< 44)');
    if (r.top < cabAbajo - 0.5) motivos.push('queda debajo de la cabecera');
    if (r.bottom > innerHeight + 0.5) motivos.push('se sale por abajo de la pantalla');
    if (barra && r.bottom > barra.getBoundingClientRect().top + 0.5) motivos.push('queda por debajo del borde superior de la barra inferior (' + Math.round(r.bottom) + ' > ' + Math.round(barra.getBoundingClientRect().top) + ')');
    for (const [fx, fy] of [[.5, .5], [.15, .25], [.85, .25], [.15, .75], [.85, .75]]) {
      const x = r.left + r.width * fx; const y = r.top + r.height * fy;
      const e = document.elementFromPoint(x, y);
      if (!e || !(e === el || el.contains(e))) { motivos.push('el punto (' + Math.round(x) + ', ' + Math.round(y) + ') lo ocupa ' + (e ? e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '') : 'nada')); break; }
    }
    return { ok: motivos.length === 0, motivos, rect: [r.left, r.top, r.width, r.height].map(Math.round) };
  },
  // Casilla (input checkbox) con su etiqueta: la etiqueta entera es la zona táctil (≥ 44 px), se ve y no la tapa nada (cabecera, pie fijo).
  async verificarCasilla(sel, indice = 0) {
    const c = document.querySelectorAll(sel)[indice];
    if (!c) return { ok: false, motivos: ['no existe la casilla ' + sel] };
    const el = c.closest('label') || c;
    el.scrollIntoView({ block: 'center' }); await this.w(60);
    const cab = document.querySelector('header.top'); const cabAbajo = cab ? cab.getBoundingClientRect().bottom : 0;
    const pie = document.querySelector('footer.bar'); const pieArriba = pie ? pie.getBoundingClientRect().top : innerHeight;
    const r = el.getBoundingClientRect(); const motivos = [];
    if (r.height < 43.5 || r.width < 43.5) motivos.push('zona táctil de ' + Math.round(r.width) + '×' + Math.round(r.height) + ' px (< 44)');
    if (r.top < cabAbajo - 0.5) motivos.push('queda debajo de la cabecera');
    if (r.bottom > pieArriba + 0.5) motivos.push('queda debajo del pie fijo');
    const cr = c.getBoundingClientRect();
    const e = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
    if (!e || !(e === c || el.contains(e))) motivos.push('el centro de la casilla lo ocupa ' + (e ? e.tagName.toLowerCase() : 'nada'));
    c.click(); await this.w(30); // y se puede pulsar: marca la comida
    if (!c.checked) motivos.push('pulsarla no la marca');
    c.click(); await this.w(30);
    return { ok: motivos.length === 0, motivos, rect: [r.left, r.top, r.width, r.height].map(Math.round) };
  },
};`;

// Cada pantalla: fases con pasos (JS que navega, se ejecuta en la página tras cargar) y el botón que debe quedar a mano
// (texto exacto, o { re } si lleva un número). Las primeras escenas dejan datos en IndexedDB, que se comparte entre pestañas
// del mismo Chrome: el orden importa.
const NUEVA_COMIDA = `await H.click('Añadir a desayuno'); await H.click('Añadir a mano'); await H.anadirAlimentos('+ Añadir alimento', 'avena', 'kiwi', 'leche entera', 'huevo'); await H.ponerGramos('100');`;
const RECETAS = `await H.click('Alimentos', true); await H.click('Ver recetas');`;
const ESCENARIOS = [
  { nombre: 'preparar: guardar una comida a mano', fases: [{ pasos: NUEVA_COMIDA, boton: 'Guardar', despues: `await H.click('Guardar', true); await H.w(500);` }] },
  { nombre: 'confirmación de un dictado (comida con varias líneas)', fases: [{ pasos: NUEVA_COMIDA, boton: 'Guardar' }] },
  { nombre: 'confirmación: editar una comida guardada', fases: [{ pasos: `await H.click('Editar', true);`, boton: 'Guardar cambios' }] },
  // Detalle de alimento y de nutriente: «Guardar» (pie fijo, sin barra inferior) al cambiar los gramos de una línea del Diario;
  // desde Mi catálogo, que la última fila (Selenio) queda por encima de la barra inferior y es pulsable. El detalle de un nutriente
  // no tiene botones de acción (solo enlaces y la barra inferior): se revisa con capturas.
  { nombre: 'detalle de una línea del Diario: cambiar la cantidad', fases: [{ pasos: `document.querySelector('button.line-open').click(); await H.w(80); await H.escribir('input.detalle-cantidad', '37.5');`, boton: 'Guardar' }] },
  { nombre: 'detalle de un alimento desde Mi catálogo', fases: [{ pasos: `await H.click('Alimentos', true); await H.click('Ver catálogo'); await H.click('Ver detalle de Aceite de oliva');`, boton: 'Ver detalle de Selenio' }] },
  { nombre: 'receta nueva (vacía)', fases: [{ pasos: `${RECETAS} await H.click('Nueva receta');`, boton: 'Guardar receta' }] },
  { nombre: 'receta nueva (con ingredientes)', fases: [{ pasos: `${RECETAS} await H.click('Nueva receta'); await H.anadirAlimentos('+ Añadir ingrediente', 'avena', 'kiwi', 'leche entera', 'huevo'); await H.ponerGramos('100');`, boton: 'Guardar receta' }] },
  { nombre: 'receta: editar una existente', fases: [{ pasos: `${RECETAS} await H.click('Editar', true);`, boton: 'Guardar receta' }] },
  { nombre: 'receta: guardar como receta desde el Diario', fases: [{ pasos: `await H.click('Guardar como receta');`, boton: 'Guardar receta' }] },
  { nombre: 'plantillas: guardar como plantilla', fases: [{ pasos: `await H.click('Guardar como plantilla');`, boton: 'Guardar plantilla', despues: `await H.escribir('.template-form input', 'Desayuno de prueba'); await H.click('Guardar plantilla', true); await H.w(400);` }] },
  { nombre: 'plantillas: lista y usar', fases: [
    { pasos: `await H.click('Alimentos', true); await H.click('Ver plantillas');`, boton: 'Usar' },
    { pasos: `await H.click('Usar', true);`, boton: { re: '^Añadir( [0-9]+ alimentos?)?$' } }] },
  { nombre: 'Repetir esta comida', fases: [{ pasos: `await H.click('Repetir esta comida');`, boton: { re: '^Añadir( [0-9]+ alimentos?)?$' } }] },
  { nombre: 'Repetir de ayer (desde el dictado)', fases: [{ pasos: `await H.click('Añadir comida'); await H.click('Repetir de ayer');`, boton: { re: '^Añadir( [0-9]+ alimentos?)?$' } }] },
  // El día de hoy como origen (con la comida guardada) y sin nada marcado: «Añadir» a la vista (desactivado) y la casilla de la comida
  // visible, de ≥ 44 px y pulsable.
  { nombre: 'Repetir de ayer: casilla de comida (origen con comidas, nada marcado)', fases: [{ pasos: `await H.click('Añadir comida'); await H.click('Repetir de ayer'); await H.click('Día de origen siguiente');`,
    boton: { re: '^Añadir( [0-9]+ alimentos?)?$' }, casilla: '.repeat-group input.meal-check' }] },
  { nombre: 'objetivos: editar y guardar', fases: [{ pasos: `await H.click('Más', true); await H.click('Objetivos');`, boton: 'Guardar' }] },
  { nombre: 'importar documento (informe de la importación)', fases: [{ pasos: `await H.click('Más', true); await H.click('Documento'); await H.archivo('input[aria-label="Elegir documento de alimentos"]', 'foods.csv', (await (await fetch('../data/foods.csv')).text()) + String.fromCharCode(10) + 'leche_entera,Una fila con el id repetido');`, boton: { re: '^Importar [0-9]+ alimentos' } }] },
  { nombre: 'copia de seguridad: importar con resumen', fases: [{ pasos: `await H.click('Más', true); await H.click('Copia de seguridad'); await H.archivo('input[aria-label="Elegir copia del diario"]', 'copia.json', %COPIA%);`, boton: { re: '^Importar [0-9]+ comida' } }] },
  { nombre: 'Estimar con IA (revisión del plato)', fases: [
    { pasos: `await H.click('Más', true); await H.click('Conexión con la IA'); await H.escribir('input[type=url]', location.origin); await H.escribir('input[type=password]', '${TOKEN}'); await H.click('Guardar', true); await H.w(150);` +
      ` await H.click('Volver'); await H.click('Añadir comida'); await H.escribir('textarea', '300 g de plato raro'); await H.click('Estimar con IA'); for (let i = 0; i < 50 && !H.buscar('Añadir a la comida', true); i++) await H.w(100);`, boton: 'Añadir a la comida' }] },
  { nombre: 'actualizar documento (revisión de la fusión)', actualizaDocumento: true, fases: [
    { pasos: `await H.click('Alimentos', true);`, boton: 'Revisar' },
    { pasos: `await H.click('Revisar', true);`, boton: 'Actualizar' }] },
];

// 375×667 (iPhone SE) con todas las pantallas; 375×812 con la zona segura de abajo (34 px, iPhone con barra de inicio) solo con las
// que llevan pie fijo o acaban en su botón, que son las que dependen de ese margen.
const TAMANOS = [{ ancho: 375, alto: 667, margenInferior: 0, todas: true }, { ancho: 375, alto: 812, margenInferior: 34, todas: false }];
const CON_MARGEN = ['detalle de', 'confirmación de un dictado', 'receta nueva (con ingredientes)', 'receta: editar', 'Repetir esta comida', 'Repetir de ayer: casilla', 'Estimar con IA', 'copia de seguridad', 'objetivos', 'actualizar documento'];

test('layout en Chrome: el botón principal de cada pantalla se ve entero y se puede pulsar (375×667 y 375×812 con zona segura)', { skip, timeout: 240000 }, async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'nt-layout-'));
  await cp(join(raiz, 'frontend'), join(tmp, 'frontend'), { recursive: true });
  await cp(join(raiz, 'data'), join(tmp, 'data'), { recursive: true });
  const servidor = createDevServer({ env: { GEMINI_API_KEY: 'CLAVE-FALSA', GEMINI_MODEL: 'm', APP_TOKEN: TOKEN }, callModel: async () => ESTIMACION, base: tmp });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${servidor.address().port}/`;
  const copia = (backupToJSON(buildBackup({ meals: [
    { id: 'copia1', date: '2026-01-05', meal: 'comida', createdAt: '2026-01-05T12:00:00Z', text: '', lines: [{ food_id: 'avena_copos', grams: 50, source_text: '' }] }], now: new Date('2026-10-17T10:00:00Z') })));
  let chrome;
  const sinZonaSegura = []; // pasadas de 375×812 en las que Chrome no aplicó la zona segura (se avisa, no es un fallo)
  const fallos = []; // se recogen todos para ver de una vez qué pantallas fallan
  try {
    chrome = await lanzarChrome();
    for (const tam of TAMANOS) {
      const etiqueta = `${tam.ancho}×${tam.alto}`;
      for (const esc of ESCENARIOS) {
        if (!tam.todas && !esc.actualizaDocumento && !CON_MARGEN.some((n) => esc.nombre.startsWith(n))) continue;
        // Cada escenario parte de una carga limpia de la página (la base de datos del perfil de Chrome se conserva).
        if (esc.actualizaDocumento) { // el documento publicado cambia: una fila nueva al final de foods.csv
          const f = join(tmp, 'data', 'foods.csv');
          const csv = (await readFile(f, 'utf8')).replace(/\r?\n$/, '');
          const ultima = csv.split(/\r?\n/).pop().split(',');
          ultima[0] = `zz_prueba_layout_${tam.alto}`; ultima[1] = `Alimento de prueba ${tam.alto}`;
          await writeFile(f, `${csv}\n${ultima.join(',')}\n`);
        }
        const p = await chrome.abrirPestana({ url, ...tam });
        if (tam.margenInferior && !p.zonaSegura) sinZonaSegura.push(esc.nombre);
        try {
          await p.evaluar(`(async () => { for (let i = 0; i < 300 && !document.querySelector('nav.tabbar'); i++) await new Promise((r) => setTimeout(r, 30)); })()`); // la app arranca (IndexedDB, datos)
          await p.evaluar(AYUDA);
          for (const fase of esc.fases) {
            await p.evaluar(`(async () => { ${fase.pasos.replace('%COPIA%', JSON.stringify(copia))} })()`);
            const r = await p.evaluar(`H.verificar(${JSON.stringify(fase.boton)}, true)`);
            const nombre = typeof fase.boton === 'string' ? fase.boton : fase.boton.re;
            if (!r.ok) fallos.push(`${etiqueta} · ${esc.nombre} · «${nombre}»: ${r.motivos.join('; ')}`);
            if (fase.casilla) {
              const c = await p.evaluar(`H.verificarCasilla(${JSON.stringify(fase.casilla)})`);
              if (!c.ok) fallos.push(`${etiqueta} · ${esc.nombre} · casilla «${fase.casilla}»: ${c.motivos.join('; ')}`);
            }
            if (fase.despues) await p.evaluar(`(async () => { ${fase.despues} })()`);
          }
        } catch (e) { fallos.push(`${etiqueta} · ${esc.nombre}: no se pudo recorrer (${e.message})`); } finally { await p.cerrar(); }
      }
    }
  } finally {
    await chrome?.cerrar();
    await new Promise((ok) => servidor.close(ok));
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  if (sinZonaSegura.length) t.diagnostic(`AVISO: este Chrome no admite Emulation.setSafeAreaInsetsOverride: ${sinZonaSegura.length} pasada(s) de 375×812 corrieron SIN zona segura (${[...new Set(sinZonaSegura)].join(', ')})`);
  else t.diagnostic('zona segura de 34 px aplicada en las pasadas de 375×812');
  t.diagnostic(`${ESCENARIOS.length} pantallas en 375×667 y las de pie fijo también en 375×812 con zona segura, con ${chrome?.ruta ?? 'Chrome'}`);
  assert.deepEqual(fallos, [], ['Botones principales tapados o fuera de alcance:', ...fallos].join(String.fromCharCode(10)));
});
