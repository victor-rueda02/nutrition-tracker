// Pantallas de Inventario, Recuento, ficha, Dudas y Lista de la compra, y su conexión con la app (jsdom, Worker SIMULADO: nunca red).
// Datos reales: data/dieta.json, data/tickets-mercadona.json, data/inventario.json y el catálogo del fixture. Hoy = lunes 16-11-2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../frontend/js/ui/app.js';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { AiClientError } from '../frontend/js/ai-client.js';
import { parseTicket } from '../frontend/js/core/tickets.js';
import { inventarioVacio, anadirRecuento, calcularStock, alimentosDeLaDieta, listaCompra, limpiarConfig } from '../frontend/js/core/inventario.js';
import { descripcionCompra } from '../frontend/js/core/inventario-vista.js';
import { pdfDeTicket } from './pdf-sintetico.js';
import { realFoods, catalog, settings, readFile } from './helpers.js';

const TARGETS = JSON.parse(readFile('../data/targets.json'));
const DIETA = readFile('../data/dieta.json');
const CONFIG = JSON.parse(readFile('../data/inventario.json'));
const TABLA = JSON.parse(readFile('../data/tickets-mercadona.json'));
const RECETAS = JSON.parse(readFile('../data/recetas.json')).recetas;
const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';
const NOW = new Date('2026-11-16T09:00:00Z'); // lunes, 10:00 en Madrid
const PLAN = { periodos: [{ id: 'volumen_p20_rutina_nov', nombre: 'p20', inicio: '2026-11-02' }], excepciones: [] };
const MEAL = (id, date, meal, lines) => ({ id, date, meal, createdAt: `${date}T08:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const textoTicket = (fecha, hora, ...lineas) => `${fecha} ${hora} OP: 1\nCnt. Descripción P. Unit Importe\n${lineas.join('\n')}\nTOTAL (€) 9,99\n`;
const ddmmaaaa = (iso) => iso.split('-').reverse().join('/');
const ticket = async (fecha, hora, ...lineas) => ({ ...(await parseTicket(textoTicket(ddmmaaaa(fecha), hora, ...lineas))), origen: 'correo' });
const hoyInv = (...recuentos) => recuentos.reduce((inv, [food_id, gramos, momento]) => anadirRecuento(inv, { food_id, gramos, momento }, { id: () => `r-${food_id}-${momento}` }), inventarioVacio());

// ai: lo que responde el Worker simulado (cola, acuses y subidas). Se anotan las llamadas.
function aiSimulado({ cola = [], falla = null, falloSubida = null } = {}) {
  const llamadas = { pendientes: 0, recibidos: [], subidas: [] };
  const ai = {
    llamadas,
    async ticketsPendientes() { llamadas.pendientes++; if (falla) throw falla; return { tickets: [...cola] }; },
    async ticketsRecibidos({ hashes }) { llamadas.recibidos.push(hashes); for (const h of hashes) { const i = cola.findIndex((t) => t.hash === h); if (i >= 0) cola.splice(i, 1); } return { borrados: hashes.length }; },
    async subirTicket(payload) {
      llamadas.subidas.push(payload);
      if (falloSubida) throw falloSubida;
      const t = { ...(await parseTicket(payload.texto)), origen: 'app' };
      if (!cola.some((x) => x.hash === t.hash)) cola.push(t);
      return { hash: t.hash, fecha: t.fecha, lineas: t.lineas.length, duplicado: false };
    },
  };
  return ai;
}

async function setup({ ai = aiSimulado(), conn = { endpoint: 'https://w', token: 't' }, meals = [], inventario = null, plan = PLAN, fetchDieta = async () => DIETA, saveFile = async () => 'compartido', readFile: leer = (f) => f.text() } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
  const { document, Event } = dom.window;
  const root = document.getElementById('app');
  const store = createMemoryStore();
  for (const m of meals) await store.addMeal(m);
  if (plan) await store.setSetting('plan_objetivos', plan);
  if (inventario) await store.setSetting('inventario', inventario);
  const app = mountApp(root, {
    store, createAiClient: () => ai, catalog, settings, targets: TARGETS, objetivos: {}, fetchDieta, recetasBase: RECETAS, inventarioConfig: CONFIG, ticketsTabla: TABLA,
    initial: { foods: realFoods, extraHeaders: [], docName: 'doc.csv' }, conn, now: () => NOW,
    idGen: (() => { let n = 0; return () => `m${++n}`; })(), readFile: leer, saveFile,
  });
  await app.whenIdle();
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const btn = (text) => $$('button').find((b) => b.textContent.includes(text));
  const act = async (fn) => { await fn(); await app.whenIdle(); };
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const inventarioGuardado = async () => (await store.getSetting('inventario')) ?? inventarioVacio();
  const abrirInventario = async () => { await act(() => btn('Alimentos').click()); await act(() => btn('Ver inventario').click()); };
  const elegirArchivo = async (input, file) => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); await act(() => input.dispatchEvent(new Event('change', { bubbles: true }))); };
  return { app, root, store, ai, $, $$, btn, act, type, inventarioGuardado, abrirInventario, elegirArchivo, dom };
}
const fila = (t, id) => t.$(`.inv-fila[data-id="${id}"]`);
const sinAlerta = (t) => assert.equal(t.$('[role=alert]'), null, t.$('[role=alert]')?.textContent);

test('al abrir la app sincroniza solo: 2 tickets nuevos (uno con duda) y uno ya aplicado; se acusan los tres y el Diario avisa de la duda', { skip }, async () => {
  const A = await ticket('2026-10-26', '20:58', '1 ARROZ LARGO 1,20', '1 GRIEGO LIGERO P-6 3,50'); // compra de arroz + duda de yogur
  const B = await ticket('2026-10-27', '10:00', '1 MACARRON 1,15');
  const C = await ticket('2026-10-20', '12:00', '1 AVENA MOLIDA 1,15'); // ya aplicado antes
  const ai = aiSimulado({ cola: [A, B, C] });
  const previo = { ...inventarioVacio(), tickets: { [C.hash]: { fecha: '2026-10-20', hora: '12:00', aplicado: '2026-10-20T13:00', origen: 'correo' } } };
  const t = await setup({ ai, inventario: previo });
  assert.equal(ai.llamadas.pendientes, 1);
  assert.deepEqual(ai.llamadas.recibidos, [[A.hash, B.hash, C.hash]], 'se acusan los aplicados Y los ya aplicados');
  const inv = await t.inventarioGuardado();
  assert.deepEqual(inv.eventos.filter((e) => e.tipo === 'compra').map((e) => [e.food_id, e.gramos]).sort(), [['arroz_blanco_crudo', 1000], ['pasta_seca', 1000]]);
  assert.equal(inv.dudas.length, 1);
  assert.equal(inv.dudas[0].descripcion, 'GRIEGO LIGERO P-6');
  assert.ok(A.hash in inv.tickets && B.hash in inv.tickets);
  // el Diario avisa y la tira lleva a Dudas
  assert.match(t.$('.aviso-dudas').textContent, /1 duda de tickets/);
  await t.act(() => t.$('.aviso-dudas button').click());
  assert.ok(t.$('.dudas'));
  assert.match(t.$('.duda').textContent, /GRIEGO LIGERO P-6/);
  sinAlerta(t);
});

test('al abrir la app sin Worker, sin KV (tickets_sin_configurar) o sin red no molesta; con otro fallo, sí', { skip }, async () => {
  const sin = await setup({ conn: {} });
  sinAlerta(sin);
  for (const code of ['tickets_sin_configurar', 'sin_conexion']) {
    const t = await setup({ ai: aiSimulado({ falla: new AiClientError(code, 'mensaje claro del fallo') }) });
    sinAlerta(t);
    assert.equal(t.$('.aviso-dudas'), null);
  }
  const mal = await setup({ ai: aiSimulado({ falla: new AiClientError('token_invalido', 'El token no es correcto. Revísalo en Documento → Conexión.') }) });
  assert.match(mal.$('[role=alert]').textContent, /El token no es correcto/);
  assert.doesNotMatch(mal.$('[role=alert]').textContent, /token_invalido:/, 'el mensaje para Victor, no el código');
});

test('«Sincronizar inventario»: resumen, y un fallo del Worker se ve arriba sin perder lo que había', { skip }, async () => {
  const A = await ticket('2026-10-26', '20:58', '1 ARROZ LARGO 1,20');
  const ai = aiSimulado({ cola: [] });
  const t = await setup({ ai });
  await t.abrirInventario();
  await t.act(() => t.btn('Sincronizar inventario').click());
  assert.match(t.$('[role=status]').textContent, /no hay tickets nuevos/);
  ai.llamadas.pendientes = 0;
  const cola = [A];
  ai.ticketsPendientes = async () => ({ tickets: [...cola] });
  await t.act(() => t.btn('Sincronizar inventario').click());
  assert.match(t.$('[role=status]').textContent, /1 ticket nuevo \(1 compra\)/);
  assert.equal((await t.inventarioGuardado()).eventos.length, 1);
  // ahora el Worker falla: error visible y el inventario sigue como estaba
  ai.ticketsPendientes = async () => { throw new AiClientError('red', 'No se pudo contactar con el servidor de la IA.'); };
  await t.act(() => t.btn('Sincronizar inventario').click());
  assert.match(t.$('.alert-fail').textContent, /No se pudo sincronizar: No se pudo contactar/);
  assert.equal((await t.inventarioGuardado()).eventos.length, 1);
  assert.ok(t.$('.inventario'), 'sigue en la pantalla');
});

test('un ticket con la misma fecha y hora que otro aplicado pregunta «¿Es el mismo?»: Sí no suma y lo acusa; No lo aplica', { skip }, async () => {
  const X = await ticket('2026-10-26', '20:58', '1 ARROZ LARGO 1,20');
  const Y = await ticket('2026-10-26', '20:58', '1 MACARRON 1,15'); // otro hash, misma fecha y hora
  const previo = { ...inventarioVacio(), tickets: { [X.hash]: { fecha: '2026-10-26', hora: '20:58', aplicado: '2026-10-26T21:00', origen: 'correo' } } };
  for (const esElMismo of [true, false]) {
    const ai = aiSimulado({ cola: [{ ...Y }] });
    const t = await setup({ ai, inventario: previo });
    await t.abrirInventario();
    assert.match(t.$('.pregunta-ticket').textContent, /¿Es el mismo ticket que el del 26\/10 20:58\?/);
    assert.deepEqual(ai.llamadas.recibidos, [], 'hasta que contestes no se acusa ni se aplica');
    assert.equal((await t.inventarioGuardado()).eventos.length, 0);
    await t.act(() => t.btn(esElMismo ? 'Sí, es el mismo' : 'No, aplicarlo').click());
    assert.deepEqual(ai.llamadas.recibidos, [[Y.hash]]);
    const inv = await t.inventarioGuardado();
    assert.ok(Y.hash in inv.tickets);
    assert.equal(inv.eventos.length, esElMismo ? 0 : 1);
    assert.equal(t.$('.pregunta-ticket'), null);
    sinAlerta(t);
  }
});

test('«Subir ticket» con un PDF: se lee en el dispositivo, al Worker solo va el texto y se aplica como los demás', { skip }, async () => {
  const pdf = pdfDeTicket(textoTicket('26/10/2026', '20:58', '1 ARROZ LARGO 1,20', '1 MACARRON 1,15'));
  const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);
  const ai = aiSimulado();
  const t = await setup({ ai });
  await t.abrirInventario();
  await t.act(() => t.btn('Subir ticket').click());
  await t.elegirArchivo(t.$('input[type=file]'), { name: 'ticket.pdf', arrayBuffer: async () => bytes });
  assert.equal(ai.llamadas.subidas.length, 1);
  assert.deepEqual(Object.keys(ai.llamadas.subidas[0]), ['texto'], 'nunca el PDF');
  assert.match(ai.llamadas.subidas[0].texto, /ARROZ LARGO/);
  const inv = await t.inventarioGuardado();
  assert.deepEqual(inv.eventos.map((e) => [e.food_id, e.gramos]).sort(), [['arroz_blanco_crudo', 1000], ['pasta_seca', 1000]]);
  assert.equal(ai.llamadas.recibidos.length, 1, 'recogido de la cola y acusado');
  assert.equal(t.$('.subir-ticket'), null, 'el panel se cierra');
  // el mismo ticket otra vez: «ya aplicado», sin sumar
  await t.act(() => t.btn('Subir ticket').click());
  await t.elegirArchivo(t.$('input[type=file]'), { name: 'ticket.pdf', arrayBuffer: async () => bytes });
  assert.match(t.$('[role=status]').textContent, /Ticket ya aplicado/);
  assert.equal((await t.inventarioGuardado()).eventos.length, 2);
  sinAlerta(t);
});

test('un PDF que no se puede leer lo dice y deja pegar el texto; pegarlo con Worker lo sube y sin Worker se aplica aquí con aviso', { skip }, async () => {
  const malo = new Uint8Array([1, 2, 3, 4]).buffer;
  const sinWorker = await setup({ conn: {} });
  await sinWorker.abrirInventario();
  await sinWorker.act(() => sinWorker.btn('Subir ticket').click());
  await sinWorker.elegirArchivo(sinWorker.$('input[type=file]'), { name: 'x.pdf', arrayBuffer: async () => malo });
  assert.match(sinWorker.$('.subir-ticket .error').textContent, /No he podido leer ese PDF.*Pega el texto del ticket/);
  const ta = sinWorker.$('textarea.ticket-texto');
  assert.ok(ta);
  // texto que no es un ticket
  sinWorker.type(ta, 'hola');
  await sinWorker.act(() => sinWorker.btn('Aplicar el texto').click());
  assert.match(sinWorker.$('.subir-ticket .error').textContent, /No encuentro el detalle/);
  assert.equal((await sinWorker.inventarioGuardado()).eventos.length, 0);
  // el ticket bueno, sin Worker: local y avisa
  sinWorker.type(sinWorker.$('textarea.ticket-texto'), textoTicket('26/10/2026', '20:58', '1 ARROZ LARGO 1,20'));
  await sinWorker.act(() => sinWorker.btn('Aplicar el texto').click());
  assert.match(sinWorker.$('[role=status]').textContent, /aplicado solo en este dispositivo/);
  assert.deepEqual((await sinWorker.inventarioGuardado()).eventos.map((e) => [e.food_id, e.gramos]), [['arroz_blanco_crudo', 1000]]);
  // con Worker pero sin red al subir: también local, con el mensaje del cliente
  const sinRed = await setup({ ai: aiSimulado({ falloSubida: new AiClientError('sin_conexion', 'Sin conexión: la IA necesita internet.') }) });
  await sinRed.abrirInventario();
  await sinRed.act(() => sinRed.btn('Subir ticket').click());
  sinRed.type(sinRed.$('textarea.ticket-texto'), textoTicket('26/10/2026', '20:58', '1 MACARRON 1,15'));
  await sinRed.act(() => sinRed.btn('Aplicar el texto').click());
  assert.match(sinRed.$('[role=status]').textContent, /aplicado solo en este dispositivo/);
  assert.equal((await sinRed.inventarioGuardado()).eventos.length, 1);
  // con Worker y otro error (token): se ve arriba y no se aplica
  const token = await setup({ ai: aiSimulado({ falloSubida: new AiClientError('token_invalido', 'El token no es correcto.') }) });
  await token.abrirInventario();
  await token.act(() => token.btn('Subir ticket').click());
  token.type(token.$('textarea.ticket-texto'), textoTicket('26/10/2026', '20:58', '1 MACARRON 1,15'));
  await token.act(() => token.btn('Aplicar el texto').click());
  assert.match(token.$('.alert-fail').textContent, /No se pudo subir el ticket: El token no es correcto/);
  assert.equal((await token.inventarioGuardado()).eventos.length, 0);
});

test('Inventario: grupos, «sin contar», stock con envase, «0 · revisa» y lo registrado hoy; el stock lo calcula el código', { skip }, async () => {
  const meals = [MEAL('d15', '2026-11-15', 'comida', [['arroz_blanco_crudo', 150], ['pasta_seca', 400]]), MEAL('h', '2026-11-16', 'comida', [['arroz_blanco_crudo', 80]])];
  const inventario = hoyInv(['arroz_blanco_crudo', 1000, '2026-11-14T10:00'], ['pasta_seca', 100, '2026-11-14T10:00']);
  const t = await setup({ meals, inventario });
  await t.abrirInventario();
  assert.deepEqual(t.$$('.inv-grupo h2').map((x) => x.textContent), ['Despensa', 'Frutos secos', 'Latas', 'Frescos', 'Fruta y verdura', 'Congelados']);
  assert.equal(t.$$('.inv-fila').length, 36);
  // arroz: 1000 − 150 (domingo, día cerrado) = 850 g; hoy 80 g aún no se resta; envase de 1 kg
  assert.match(fila(t, 'arroz_blanco_crudo').textContent, /850 g · ≈ 0,9 paquetes/);
  assert.match(fila(t, 'arroz_blanco_crudo').textContent, /hoy: −80 g \(se resta a las 00:00\)/);
  // pasta: 100 − 400 = −300 → «0 · revisa (faltan 300 g)»
  assert.match(fila(t, 'pasta_seca').textContent, /0 · revisa \(faltan 300 g\)/);
  assert.match(fila(t, 'avena_copos').textContent, /sin contar/);
  assert.equal(t.$$('.inv-fila.sin_contar').length, 34);
  // botones; «Dudas» solo si las hay
  assert.deepEqual(t.$$('.inv-acciones button').map((b) => b.textContent), ['Sincronizar inventario', 'Subir ticket', 'Hacer recuento', 'Lista de la compra']);
  // «‹ Volver» a Alimentos; y la entrada desde Más
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.alimentos'));
  await t.act(() => t.btn('Más').click());
  assert.deepEqual(t.$$('.menu-row').map((b) => b.textContent).slice(0, 3), ['Objetivos', 'Inventario', 'Lista de la compra']);
  await t.act(() => t.btn('Inventario').click());
  assert.ok(t.$('.inventario'));
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.mas'));
});

test('Recuento: un campo vacío no se cuenta (nunca 0); los envases rellenan los gramos; un 0 escrito es un 0 real; guarda con el momento actual', { skip }, async () => {
  const meals = [MEAL('h', '2026-11-16', 'desayuno', [['avena_copos', 60]])];
  const t = await setup({ meals });
  await t.abrirInventario();
  await t.act(() => t.btn('Hacer recuento').click());
  assert.match(t.$('.recuento').textContent, /Cuenta lo que hay ahora, con lo registrado hoy ya comido/);
  assert.equal(t.$$('.rec-fila').length, 36);
  // sin escribir nada: no guarda
  await t.act(() => t.btn('Guardar recuento').click());
  assert.match(t.$('.recuento .error').textContent, /un campo vacío no se cuenta/);
  assert.equal((await t.inventarioGuardado()).eventos.length, 0);
  const campo = (id, aria) => t.$(`.rec-fila[data-id="${id}"] input[aria-label^="${aria}"]`);
  t.type(campo('avena_copos', 'Envases de'), '2'); // paquete de 500 g
  assert.equal(campo('avena_copos', 'Gramos de').value, '1000');
  t.type(campo('arroz_blanco_crudo', 'Gramos de'), '850,5');
  t.type(campo('sal', 'Gramos de'), '0'); // un 0 escrito es un 0 real
  t.type(campo('huevo', 'Gramos de'), 'mucho');
  await t.act(() => t.btn('Guardar recuento').click());
  assert.match(t.$('.recuento .error').textContent, /«Huevo.*» no son un número válido|no son un número válido/);
  t.type(campo('huevo', 'Gramos de'), '');
  await t.act(() => t.btn('Guardar recuento').click());
  const inv = await t.inventarioGuardado();
  assert.deepEqual(inv.eventos.map((e) => [e.tipo, e.food_id, e.gramos]).sort(), [['recuento', 'arroz_blanco_crudo', 850.5], ['recuento', 'avena_copos', 1000], ['recuento', 'sal', 0]]);
  assert.ok(inv.eventos.every((e) => e.momento === '2026-11-16T10:00'), 'el momento de la app (Madrid)');
  assert.match(t.$('[role=status]').textContent, /Recuento guardado: 3 alimentos/);
  // el stock cuenta lo contado y lo registrado hoy no se vuelve a restar
  assert.match(fila(t, 'avena_copos').textContent, /1 kg · ≈ 2 paquetes/);
  assert.match(fila(t, 'avena_copos').textContent, /hoy: −60 g/);
  assert.match(fila(t, 'sal').textContent, /0 g/);
  assert.match(fila(t, 'huevo').textContent, /sin contar/);
});

test('ficha de un alimento: historial, «Ajustar» con motivo, borrar un evento con confirmación y «Recontar» de ese alimento', { skip }, async () => {
  const inventario = hoyInv(['arroz_blanco_crudo', 1000, '2026-11-14T10:00']);
  const t = await setup({ inventario });
  await t.abrirInventario();
  await t.act(() => fila(t, 'arroz_blanco_crudo').querySelector('button').click());
  assert.match(t.$('.ficha .inv-stock-grande').textContent, /1 kg/);
  assert.match(t.$('.inv-historial').textContent, /Recuento: 1 kg/);
  // ajustar −200 caducado
  await t.act(() => t.btn('Ajustar').click());
  await t.act(() => t.btn('Guardar ajuste').click());
  assert.match(t.$('.ajuste-form .error').textContent, /Pon los gramos/);
  t.type(t.$('input[aria-label="Gramos a sumar o restar"]'), '−200');
  t.type(t.$('input[aria-label="Motivo del ajuste"]'), 'caducado');
  await t.act(() => t.btn('Guardar ajuste').click());
  assert.match(t.$('.ficha .inv-stock-grande').textContent, /800 g/);
  assert.match(t.$('.inv-historial').textContent, /Ajuste: −200 g · caducado/);
  const ajuste = (await t.inventarioGuardado()).eventos.find((e) => e.tipo === 'ajuste');
  assert.deepEqual([ajuste.gramos, ajuste.motivo], [-200, 'caducado']);
  // borrar con confirmación
  const borrarAjuste = () => t.$$('.inv-evento').find((e) => /Ajuste/.test(e.textContent)).querySelector('button.link');
  assert.match(borrarAjuste().getAttribute('aria-label'), /Borrar: Ajuste/);
  await t.act(() => borrarAjuste().click());
  assert.match(t.$('.confirm-delete').textContent, /¿Borrar\?/);
  await t.act(() => t.btn('Cancelar').click());
  assert.equal((await t.inventarioGuardado()).eventos.length, 2);
  await t.act(() => borrarAjuste().click());
  await t.act(() => t.btn('Sí, borrar').click());
  assert.equal((await t.inventarioGuardado()).eventos.length, 1);
  assert.match(t.$('.ficha .inv-stock-grande').textContent, /1 kg/);
  // recontar solo este alimento
  await t.act(() => t.btn('Recontar').click());
  assert.equal(t.$$('.rec-fila').length, 1);
  t.type(t.$('input[aria-label^="Gramos de"]'), '600');
  await t.act(() => t.btn('Guardar recuento').click());
  assert.ok(t.$('.ficha'), 'vuelve a la ficha');
  assert.match(t.$('.ficha .inv-stock-grande').textContent, /600 g/);
  assert.match(t.$('.inv-historial').textContent, /Recuento: 600 g/);
});

test('Dudas: motivo y candidatos, gramos editables, «Recordar» marcado por defecto (aprende) o desmarcado, y «No es de la dieta»', { skip }, async () => {
  const A = await ticket('2026-10-26', '20:58', '1 GRIEGO LIGERO P-6 3,50', '1 PECHUGA FAMILIAR 6,00', '1 FILETE SALMÓN 5,00');
  const t = await setup({ ai: aiSimulado({ cola: [A] }) });
  const dudas = (await t.inventarioGuardado()).dudas;
  assert.equal(dudas.length, 3);
  await t.act(() => t.$('.aviso-dudas button').click());
  assert.equal(t.$$('.duda').length, 3);
  const tarjeta = (txt) => t.$$('.duda').find((d) => d.textContent.includes(txt));
  const yogur = tarjeta('GRIEGO LIGERO');
  assert.match(yogur.textContent, /Ticket del 26\/10/);
  assert.match(yogur.textContent, /Se parece a un alimento de tu dieta/);
  const pechuga = tarjeta('PECHUGA FAMILIAR');
  assert.match(pechuga.textContent, /El ticket no trae el peso: pon los gramos/);
  assert.equal(pechuga.querySelector('input.grams').value, '', 'sin peso en el ticket, no hay sugerido');
  // sin gramos no se suma: el error sale en la propia tarjeta
  await t.act(() => yogur.querySelector('button.candidato').click());
  assert.equal(yogur.querySelector('input[type=checkbox]').checked, true, 'recordar marcado por defecto');
  await t.act(() => t.$$('.duda').find((d) => d.textContent.includes('GRIEGO')).querySelector('button.primary').click());
  assert.match(t.$$('.duda').find((d) => d.textContent.includes('GRIEGO')).querySelector('.error').textContent, /Pon los gramos/);
  t.type(t.$$('.duda').find((d) => d.textContent.includes('GRIEGO')).querySelector('input.grams'), '500');
  await t.act(() => t.$$('.duda').find((d) => d.textContent.includes('GRIEGO')).querySelector('button.primary').click());
  let inv = await t.inventarioGuardado();
  assert.deepEqual(inv.eventos.filter((e) => e.tipo === 'compra').map((e) => [e.food_id, e.gramos, e.ticket === A.hash]), [['yogur_griego_ligero', 500, true]]);
  assert.match(inv.aprendido['griego ligero p-6'], /^yogur_griego_ligero/);
  assert.equal(inv.dudas.length, 2);
  // pechuga: sin recordar, 700 g
  const p = tarjeta('PECHUGA FAMILIAR');
  t.type(p.querySelector('input.grams'), '700');
  await t.act(() => p.querySelector('input[type=checkbox]').click());
  await t.act(() => t.$$('.duda').find((d) => d.textContent.includes('PECHUGA')).querySelector('button.primary').click());
  inv = await t.inventarioGuardado();
  assert.ok(inv.eventos.some((e) => e.food_id === 'pechuga_pollo_cruda' && e.gramos === 700));
  assert.equal(inv.aprendido['pechuga familiar'], undefined, 'sin la casilla, no se recuerda');
  // salmón: «No es de la dieta» recuerda «ignorar»
  await t.act(() => t.btn('No es de la dieta').click());
  inv = await t.inventarioGuardado();
  assert.equal(inv.aprendido['filete salmon'], 'ignorar');
  assert.equal(inv.dudas.length, 0);
  assert.ok(t.$('.inventario'), 'sin dudas vuelve al Inventario');
  assert.equal(t.$('.dudas'), null);
  sinAlerta(t);
});

test('Dudas: los gramos son BRUTOS (se aplica la porción comestible) y el peso del ticket viene rellenado', { skip }, async () => {
  const A = await ticket('2026-10-26', '20:58', '1 NUEZ DE LA INDIA 2,00', '1 NUEZ ENTERA 3,00');
  const t = await setup({ ai: aiSimulado({ cola: [A] }) });
  const inv0 = await t.inventarioGuardado();
  const nuez = inv0.dudas.find((d) => d.candidatos.includes('nueces'));
  assert.ok(nuez, 'se parece a nueces');
  await t.act(() => t.$('.aviso-dudas button').click());
  const tj = t.$$('.duda').find((d) => d.textContent.includes(nuez.descripcion));
  await t.act(() => [...tj.querySelectorAll('button.candidato')].find((b) => b.textContent === 'Nueces con cáscara' || /nuez|nueces/i.test(b.textContent)).click());
  t.type(t.$$('.duda').find((d) => d.textContent.includes(nuez.descripcion)).querySelector('input.grams'), '600');
  await t.act(() => t.$$('.duda').find((d) => d.textContent.includes(nuez.descripcion)).querySelector('button.primary').click());
  const compra = (await t.inventarioGuardado()).eventos.find((e) => e.food_id === 'nueces');
  assert.equal(compra.gramos, 270, '600 g brutos × 0,45 comestible');
});

test('Lista de la compra: faltan en envases enteros, sin contar aparte, días sin menú avisados, horizonte persistido y copiar como texto', { skip }, async () => {
  const guardados = [];
  const t = await setup({ inventario: hoyInv(['arroz_blanco_crudo', 100, '2026-11-16T09:00']), saveFile: async (f) => { guardados.push(f); return 'descargado'; } });
  await t.abrirInventario();
  await t.act(() => t.btn('Lista de la compra').click());
  assert.ok(t.$('.compra'));
  assert.equal(t.$('input[aria-label="Días a cubrir"]').value, '7');
  // el mismo cálculo que el núcleo, con los mismos datos
  const cfg = limpiarConfig(CONFIG);
  const dieta = JSON.parse(DIETA);
  const conjunto = alimentosDeLaDieta(dieta, RECETAS, PLAN, '2026-11-16', { noSeguidas: cfg.recetas_no_seguidas });
  const stock = calcularStock(hoyInv(['arroz_blanco_crudo', 100, '2026-11-16T09:00']), [], { conjunto, recetas: RECETAS, noSeguidas: cfg.recetas_no_seguidas, hoy: '2026-11-16' });
  const esperada = listaCompra({ dieta, recetas: RECETAS, plan: PLAN, hoy: '2026-11-16', noSeguidas: cfg.recetas_no_seguidas, conjunto, stock, horizonte: 7, margen: 2, envases: { arroz_blanco_crudo: { gramos: 1000, nombre: 'paquete 1 kg' } } });
  const arroz = esperada.items.find((i) => i.food_id === 'arroz_blanco_crudo');
  assert.ok(arroz.faltan > 0 && arroz.envase.cantidad >= 1);
  const li = t.$('.compra-item[data-id="arroz_blanco_crudo"]');
  assert.equal(li.querySelector('.compra-linea').textContent, descripcionCompra(arroz));
  assert.match(li.textContent, /Faltan [\d.,]+ (g|kg) → \d+ paquetes? \(1 kg( cada uno)?\)/);
  // los sin contar, aparte y con su motivo
  assert.match(t.$('.sin-contar h2').textContent, /Stock desconocido/);
  assert.ok(t.$$('.sin-contar .compra-item').length >= 30);
  assert.equal(t.$('.compra-item[data-id="arroz_blanco_crudo"]').closest('.sin-contar'), null);
  // sábado 21 y domingo 22 caen dentro de los 9 días y no tienen menú
  assert.match(t.$('.warn').textContent, /sáb 21 y dom 22: sin menú, no cuentan\./);
  // otro horizonte: se recalcula y se recuerda en un ajuste
  t.$('input[aria-label="Días a cubrir"]').value = '3';
  await t.act(() => t.$('input[aria-label="Días a cubrir"]').dispatchEvent(new t.dom.window.Event('change', { bubbles: true })));
  assert.equal(await t.store.getSetting('inventario_horizonte'), 3);
  assert.match(t.$('.compra .panel .muted').textContent, /3 días \+ 2 días de margen/);
  // copiar: sin portapapeles (http), cae a compartir/descargar como texto
  await t.act(() => t.btn('Copiar lista').click());
  assert.equal(guardados.length, 1);
  assert.match(guardados[0].text, /^Lista de la compra \(/);
  assert.equal(guardados[0].type, 'text/plain');
  assert.match(t.$('[role=status]').textContent, /Lista descargada como texto/);
  // «‹ Volver» desde Inventario regresa a Inventario
  await t.act(() => t.btn('‹ Volver').click());
  assert.ok(t.$('.inventario'));
});

test('Lista de la compra desde Alimentos y sin plan: dice que ningún día tiene menú y no inventa nada', { skip }, async () => {
  const t = await setup({ plan: null });
  await t.act(() => t.btn('Alimentos').click());
  await t.act(() => t.btn('Ver la lista').click());
  assert.match(t.$('.compra .error').textContent, /Ningún día tiene menú.*plan de objetivos/);
  assert.equal(t.$$('.compra-item').length, 36 === 0 ? 1 : t.$$('.compra-item').length); // los sin contar salen con necesidad 0: no entran
  assert.equal(t.$$('.compra-item').length, 0);
});

test('la dieta que no se puede cargar (sin red y sin copia) se ve arriba y no deja el Inventario a medias', { skip }, async () => {
  const t = await setup({ fetchDieta: async () => { throw new Error('sin red'); }, conn: {} });
  await t.act(() => t.btn('Alimentos').click());
  await t.act(() => t.btn('Ver inventario').click());
  assert.match(t.$('.alert-fail').textContent, /No se pudo abrir el inventario: no se pudo cargar data\/dieta\.json/);
  assert.ok(t.$('.alimentos'), 'se queda donde estaba');
});

test('copia de seguridad: lleva el inventario, y al importar en otro dispositivo enseña el resumen, fusiona sin borrar y no repite', { skip }, async () => {
  const origen = await setup({ inventario: { ...hoyInv(['arroz_blanco_crudo', 1000, '2026-11-14T10:00']), aprendido: { 'griego ligero p-6': 'yogur_griego_ligero' } } });
  let texto = null;
  const guardar = async ({ text }) => { texto = text; return 'compartido'; };
  const exp = await setup({ inventario: await origen.inventarioGuardado(), saveFile: guardar });
  await exp.act(() => exp.btn('Más').click());
  await exp.act(() => exp.btn('Copia de seguridad').click());
  await exp.act(() => exp.btn('Exportar diario').click());
  const copia = JSON.parse(texto);
  assert.deepEqual(copia.inventario.eventos.map((e) => e.food_id), ['arroz_blanco_crudo']);
  assert.equal(copia.inventario.aprendido['griego ligero p-6'], 'yogur_griego_ligero');
  // otro dispositivo: ya tiene un recuento propio de avena
  const otro = await setup({ inventario: hoyInv(['avena_copos', 500, '2026-11-15T10:00']), readFile: async (f) => f.contenido });
  await otro.act(() => otro.btn('Más').click());
  await otro.act(() => otro.btn('Copia de seguridad').click());
  await otro.elegirArchivo(otro.$('input[type=file][aria-label="Elegir copia del diario"]'), { name: 'copia.json', contenido: texto });
  assert.match(otro.$('section.report').textContent, /Inventario: 1 evento, 0 tickets, 0 dudas, 1 respuesta recordada nuevos/);
  assert.equal((await otro.inventarioGuardado()).eventos.length, 1, 'hasta pulsar el botón no se toca nada');
  await otro.act(() => otro.btn('Importar el inventario').click());
  const inv = await otro.inventarioGuardado();
  assert.deepEqual(inv.eventos.map((e) => e.food_id).sort(), ['arroz_blanco_crudo', 'avena_copos'], 'se añade y se mantiene lo propio');
  assert.equal(inv.aprendido['griego ligero p-6'], 'yogur_griego_ligero');
  assert.match(otro.$('.ok').textContent, /Copia importada:.*inventario: 1 evento/);
  // otra vez: ya estaba todo
  await otro.elegirArchivo(otro.$('input[type=file][aria-label="Elegir copia del diario"]'), { name: 'copia.json', contenido: texto });
  assert.match(otro.$('section.report').textContent, /Inventario: ya estaba todo/);
  assert.equal(otro.btn('Importar el inventario'), undefined);
});

test('ninguna pantalla del inventario lleva colores sueltos y el CSS está enlazado y en la caché del service worker', () => {
  const css = readFile('../frontend/css/inventario.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'solo tokens de la paleta (var(--…))');
  assert.match(readFile('../frontend/index.html'), /css\/inventario\.css/);
  const sw = readFile('../frontend/sw.js');
  for (const f of ['css/inventario.css', 'js/ui/inventario-screen.js', 'js/ui/inventario-actions.js', 'js/core/inventario-vista.js', '../data/inventario.json', '../data/tickets-mercadona.json']) assert.ok(sw.includes(`'${f}'`), f);
});
