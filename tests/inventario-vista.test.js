// core/inventario-vista.js (textos, grupos, envases, historial, lista como texto), quitarEvento, la copia de seguridad con inventario
// y el KV en memoria del servidor local para la cola de tickets. Sin DOM ni red real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leerGrupos, agruparAlimentos, envasesDeTabla, textoCantidad, textoEnvases, textoStock, fechaCorta, historialDe, descripcionCompra, textoListaCompra, listaDias } from '../frontend/js/core/inventario-vista.js';
import { inventarioVacio, anadirRecuento, anadirAjuste, anadirCompra, quitarEvento, registrarTicket, alimentosDeLaDieta, limpiarConfig } from '../frontend/js/core/inventario.js';
import { buildBackup, backupToJSON, parseBackup } from '../frontend/js/core/backup.js';
import { createDevServer, kvEnMemoria } from '../scripts/dev-server.mjs';
import { realFoods, readFile } from './helpers.js';

const tabla = JSON.parse(readFile('../data/tickets-mercadona.json'));
const configJson = JSON.parse(readFile('../data/inventario.json'));
const foodsById = new Map(realFoods.map((f) => [f.id, f]));
const seq = (p = 'e') => { let n = 0; return () => `${p}${++n}`; };

test('data/inventario.json: los grupos cubren exactamente los alimentos de la dieta (36) y limpiarConfig los deja pasar', () => {
  const dieta = JSON.parse(readFile('../data/dieta.json'));
  const recetas = JSON.parse(readFile('../data/recetas.json')).recetas;
  const conjunto = alimentosDeLaDieta(dieta, recetas, null, '2026-11-16', { noSeguidas: limpiarConfig(configJson).recetas_no_seguidas });
  const grupos = leerGrupos(configJson);
  assert.deepEqual(grupos.map((g) => g.nombre), ['Despensa', 'Frutos secos', 'Latas', 'Frescos', 'Fruta y verdura', 'Congelados']);
  const enGrupos = grupos.flatMap((g) => g.ids);
  assert.equal(new Set(enGrupos).size, enGrupos.length, 'ningún alimento en dos grupos');
  assert.deepEqual([...enGrupos].sort(), conjunto, 'ni faltan ni sobran alimentos');
  assert.deepEqual(leerGrupos(null), []);
  assert.deepEqual(leerGrupos({ grupos: [] }), []);
});

test('agruparAlimentos: orden del fichero, por nombre dentro del grupo y «Otros» para lo que no está', () => {
  const grupos = [{ nombre: 'A', ids: ['z', 'b'] }, { nombre: 'B', ids: ['c'] }];
  const nombre = (id) => ({ z: 'Zanahoria', b: 'Bebida', c: 'Cebolla', n: 'Nuevo' })[id] ?? id;
  assert.deepEqual(agruparAlimentos(['c', 'n', 'z', 'b'], grupos, nombre), [{ nombre: 'A', ids: ['b', 'z'] }, { nombre: 'B', ids: ['c'] }, { nombre: 'Otros', ids: ['n'] }]);
  assert.deepEqual(agruparAlimentos(['b'], grupos, nombre), [{ nombre: 'A', ids: ['b'] }]); // un grupo vacío no sale
});

test('envasesDeTabla: el primer producto con su tamaño, en gramos comestibles; a peso o sin tamaño, sin envase', () => {
  const e = envasesDeTabla(tabla, foodsById);
  assert.deepEqual(e.arroz_blanco_crudo, { gramos: 1000, nombre: 'paquete 1 kg', unidad: 'paquete' });
  assert.equal(e.atun_lata_aceite.gramos, 360); // 6 latas × 60 g escurridos
  assert.equal(e.nueces.gramos, 270); // 600 g con cáscara × 0,45 comestible
  assert.equal(e.bebida_de_avena.gramos, 1030);
  assert.equal(e.mandarina, undefined); // a peso
  assert.equal(e.manzana_con_piel, undefined); // pregunta los gramos
  assert.equal(e.pechuga_pollo_cruda, undefined);
  assert.equal(e.huevo, undefined); // ignorado en la tabla
  // solo el PRIMERO de cada alimento: si no trae tamaño no se salta al siguiente
  const t2 = { productos: { a: { food_id: 'x', a_peso: true }, b: { food_id: 'x', unidades_por_envase: 1, gramos_por_unidad: 500, nombre_envase: 'bolsa 500 g' } } };
  assert.deepEqual(envasesDeTabla(t2, new Map()), {});
});

test('textoCantidad y textoStock: «1,2 kg», «≈ 1,2 paquetes», «sin contar», «0 · revisa (faltan X g)» y «hoy: −X g»', () => {
  assert.equal(textoCantidad(350), '350 g');
  assert.equal(textoCantidad(1200), '1,2 kg');
  assert.equal(textoCantidad(1000), '1 kg');
  const env = { gramos: 1000, unidad: 'paquete', nombre: 'paquete 1 kg' };
  assert.equal(textoEnvases(1000, env), '1 paquete');
  assert.equal(textoEnvases(1200, env), '1,2 paquetes');
  assert.deepEqual(textoStock({ contado: true, gramos: 1200, registradoHoy: 0 }, env), { texto: '1,2 kg · ≈ 1,2 paquetes', estado: 'ok', hoy: null });
  assert.deepEqual(textoStock({ contado: true, gramos: 350, registradoHoy: 80 }, null), { texto: '350 g', estado: 'ok', hoy: 'hoy: −80 g (se resta a las 00:00)' });
  assert.deepEqual(textoStock({ contado: false, gramos: null, registradoHoy: 0 }, env), { texto: 'sin contar', estado: 'sin_contar', hoy: null });
  assert.equal(textoStock({ contado: true, gramos: -120, negativo: true, faltanRevisar: 120, registradoHoy: 0 }).texto, '0 · revisa (faltan 120 g)');
  assert.equal(textoStock({ contado: true, gramos: 0, registradoHoy: 0 }, env).texto, '0 g'); // un 0 contado es un 0 real, no «sin contar»
});

test('historialDe: recuentos, compras (con la fecha de su ticket) y ajustes, del más reciente al más antiguo', () => {
  let inv = anadirRecuento(inventarioVacio(), { food_id: 'arroz', gramos: 1000, momento: '2026-11-14T10:00' }, { id: seq() });
  inv = registrarTicket(inv, 'h1', { fecha: '2026-11-15', hora: '20:58', origen: 'correo' });
  inv = anadirCompra(inv, { food_id: 'arroz', gramos: 1000, momento: '2026-11-15T20:58', ticket: 'h1', linea: 4 }, { id: seq('c') });
  inv = anadirAjuste(inv, { food_id: 'arroz', gramos: -200, momento: '2026-11-16T09:00', motivo: 'caducado' }, { id: seq('a') });
  inv = anadirAjuste(inv, { food_id: 'otro', gramos: 5, momento: '2026-11-16T09:00' }, { id: seq('o') });
  assert.deepEqual(historialDe(inv, 'arroz').map((e) => e.texto), ['Ajuste: −200 g · caducado', 'Compra: +1 kg · ticket del 15/11', 'Recuento: 1 kg']);
  assert.equal(fechaCorta('2026-11-15T20:58'), '15/11 20:58');
  assert.equal(fechaCorta('2026-11-15'), '15/11');
});

test('quitarEvento: borra por id, no toca lo demás y lanza si no existe; el ticket sigue aplicado', () => {
  let inv = anadirRecuento(inventarioVacio(), { food_id: 'a', gramos: 10, momento: '2026-11-14T10:00' }, { id: seq() });
  inv = registrarTicket(inv, 'h1', { fecha: '2026-11-15' });
  inv = anadirCompra(inv, { food_id: 'a', gramos: 5, momento: '2026-11-15T10:00', ticket: 'h1', linea: 1 }, { id: seq('c') });
  const sin = quitarEvento(inv, 'c1');
  assert.deepEqual(sin.eventos.map((e) => e.id), ['e1']);
  assert.ok('h1' in sin.tickets, 'borrar la compra no «desaplica» el ticket');
  assert.equal(inv.eventos.length, 2, 'el original no se toca');
  assert.throws(() => quitarEvento(inv, 'nope'), /No existe/);
});

test('descripcionCompra y textoListaCompra: «Faltan 300 g → 1 paquete (1 kg)», sin contar aparte y días sin menú', () => {
  const env = (g, cantidad) => ({ nombre: 'paquete 1 kg', gramos: g, cantidad });
  assert.equal(descripcionCompra({ faltan: 300, stockDesconocido: false, envase: env(1000, 1) }), 'Faltan 300 g → 1 paquete (1 kg)');
  assert.equal(descripcionCompra({ faltan: 2300, stockDesconocido: false, envase: env(1000, 3) }), 'Faltan 2,3 kg → 3 paquetes (1 kg cada uno)');
  assert.equal(descripcionCompra({ faltan: 300, stockDesconocido: true, envase: null }), 'Necesito 300 g');
  const lista = {
    desde: '2026-11-16', hasta: '2026-11-24', sinMenu: [{ fecha: '2026-11-21' }, { fecha: '2026-11-22' }],
    items: [
      { food_id: 'arroz', faltan: 300, stockDesconocido: false, envase: env(1000, 1) },
      { food_id: 'sal', faltan: 0, stockDesconocido: false, envase: null },
      { food_id: 'huevo', faltan: 600, stockDesconocido: true, envase: null },
    ],
  };
  const nombres = { arroz: 'Arroz', huevo: 'Huevo', sal: 'Sal' };
  const txt = textoListaCompra({ lista, grupos: [{ nombre: 'Despensa', ids: ['arroz', 'sal'] }], nombreDe: (id) => nombres[id], diaTexto: (f) => f.slice(8) });
  assert.equal(txt, 'Lista de la compra (16 – 24)\n\nDespensa\n- Arroz: faltan 300 g → 1 paquete (1 kg)\n\nStock desconocido (sin contar)\n- Huevo: necesito 600 g\n\n21 y 22: sin menú, no cuentan.\n');
  assert.equal(listaDias(['sáb 15', 'dom 16']), 'sáb 15 y dom 16');
  assert.equal(listaDias(['a', 'b', 'c']), 'a, b y c');
});

test('copia de seguridad: lleva el inventario solo si lo hay, y parseBackup lo limpia (lo inválido se ignora, sin lanzar)', () => {
  const inv = anadirRecuento(inventarioVacio(), { food_id: 'a', gramos: 10, momento: '2026-11-14T10:00' }, { id: seq() });
  assert.ok(!('inventario' in buildBackup({ meals: [] })), 'sin inventario, el JSON no cambia');
  const texto = backupToJSON(buildBackup({ meals: [], inventario: inv }));
  const p = parseBackup(texto);
  assert.ok(p.ok);
  assert.deepEqual(p.inventario.eventos.map((e) => e.id), ['e1']);
  assert.equal(parseBackup(backupToJSON(buildBackup({ meals: [] }))).inventario, null);
  const mala = JSON.parse(texto);
  mala.inventario = { eventos: [{ id: 'x', tipo: 'raro' }, ...mala.inventario.eventos] };
  assert.deepEqual(parseBackup(JSON.stringify(mala)).inventario.eventos.map((e) => e.id), ['e1']);
  mala.inventario = 'no es un objeto';
  assert.equal(parseBackup(JSON.stringify(mala)).inventario, null);
});

test('servidor local: /tickets con un KV en memoria (subir, recoger, acusar), sin IA y con el token de la app', async () => {
  const kv = kvEnMemoria();
  const server = createDevServer({ env: { APP_TOKEN: 'tok', GEMINI_MODEL: 'm', GEMINI_API_KEY: 'x', TICKETS: kv }, callModel: () => { throw new Error('los tickets no usan la IA'); } });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (ruta, body, token = 'tok') => fetch(`${base}${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-App-Token': token }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const texto = '26/10/2026 20:58 OP: 1\nCnt. Descripción P. Unit Importe\n1 ARROZ LARGO 1,20\nTOTAL (€) 1,20\n';
    const subido = await post('/tickets', { texto });
    assert.equal(subido.status, 200);
    assert.equal(subido.body.duplicado, false);
    assert.equal((await post('/tickets', { texto })).body.duplicado, true);
    const cola = await post('/tickets/pendientes', {});
    assert.equal(cola.body.tickets.length, 1);
    assert.equal(cola.body.tickets[0].hash, subido.body.hash);
    assert.equal((await post('/tickets/pendientes', {}, 'mal')).status, 401);
    assert.equal((await post('/tickets/recibidos', { hashes: [subido.body.hash] })).status, 200);
    assert.equal((await post('/tickets/pendientes', {})).body.tickets.length, 0);
  } finally { await new Promise((ok) => server.close(ok)); }
});
