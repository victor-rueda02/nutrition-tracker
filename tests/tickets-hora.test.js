// Hora del ticket: momento de la compra = fecha + hora; hash sin nº de factura; aviso de posible duplicado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTicket, aplicarTicket, resolverDuda } from '../frontend/js/core/tickets.js';
import { textoDePdf } from '../frontend/js/core/pdf-texto.js';
import { inventarioVacio, alimentosDeLaDieta, calcularStock, anadirRecuento } from '../frontend/js/core/inventario.js';
import { pdfDeTicket } from './pdf-sintetico.js';
import { realFoods, readFile } from './helpers.js';

const tabla = JSON.parse(readFile('../data/tickets-mercadona.json'));
const dieta = JSON.parse(readFile('../data/dieta.json'));
const recetasJson = JSON.parse(readFile('../data/recetas.json'));
const conjunto = alimentosDeLaDieta(dieta, recetasJson.recetas ?? recetasJson, null, '2026-11-14', { noSeguidas: ['lentejas_caseras'] });
const foodsById = new Map(realFoods.map((f) => [f.id, f]));
const ids = (() => { let n = 0; return () => `h-${++n}`; })();
const aplica = (inv, t) => aplicarTicket(inv, t, { tabla, conjunto, foodsById, id: ids, ahora: new Date(2026, 10, 14, 10, 30) });
const texto = () => `MERCADONA, S.A. A-00000000
26/10/2026 20:58 OP: 4350
FACTURA SIMPLIFICADA: 1234-567-890123
Cnt. Descripción P. Unit Importe
2 BEBIDA AVENA 0,95 1,90
1 MANDARINA
0,798 kg 2,55 €/kg 2,03
TOTAL (€) 3,93`;

test('el momento de la compra es fecha + hora del ticket: un recuento a las 10:00 del mismo día suma la compra de las 20:58 y uno a las 21:30 no; sin hora, T00:00', async () => {
  const t = await parseTicket(texto());
  const conRecuento = (momento) => anadirRecuento(inventarioVacio(), { food_id: 'bebida_de_avena', gramos: 100, momento }, { id: ids });
  const stock = (inv) => calcularStock(inv, [], { conjunto, hoy: '2026-10-27' }).bebida_de_avena.gramos;
  const antes = aplica(conRecuento('2026-10-26T10:00'), t);
  assert.equal(antes.inventario.eventos.find((e) => e.tipo === 'compra').momento, '2026-10-26T20:58');
  assert.equal(stock(antes.inventario), 100 + 2 * 1030, 'el recuento de las 10:00 no incluía la compra de las 20:58');
  assert.equal(stock(aplica(conRecuento('2026-10-26T21:30'), t).inventario), 100, 'el de las 21:30 ya la incluye');
  assert.deepEqual(antes.inventario.tickets[t.hash], { fecha: '2026-10-26', hora: '20:58', aplicado: '2026-11-14T10:30', origen: 'app' });
  const sinHora = await parseTicket(texto().replace(' 20:58 OP: 4350', ''));
  assert.equal(aplica(inventarioVacio(), sinHora).inventario.eventos[0].momento, '2026-10-26T00:00');
});

test('las dudas guardan hora y momento del ticket y resolverDuda suma la compra en ese momento', async () => {
  const t = await parseTicket('01/11/2026 18:40 OP: 12\nCnt. Descripción P. Unit Importe\n2 GRIEGO LIGERO P-6 1,45 2,90\nTOTAL (€) 2,90');
  const r = aplica(inventarioVacio(), t);
  assert.deepEqual([r.dudas[0].hora, r.dudas[0].momento], ['18:40', '2026-11-01T18:40']);
  const res = resolverDuda(r.inventario, r.dudas[0].id, { food_id: 'yogur_griego_ligero', gramos: 1000 }, { foodsById, id: ids });
  assert.equal(res.inventario.eventos[0].momento, '2026-11-01T18:40');
});

test('aplicarTicket avisa posible_duplicado si ya hay otro ticket con la misma fecha y hora (y aun así aplica el nuevo)', async () => {
  const a = await parseTicket(texto());
  const b = await parseTicket(texto().replace('2 BEBIDA AVENA 0,95 1,90', '3 BEBIDA AVENA 0,95 2,85'));
  assert.notEqual(a.hash, b.hash);
  const r1 = aplica(inventarioVacio(), a);
  assert.equal(r1.posible_duplicado, null);
  const r2 = aplica(r1.inventario, b);
  assert.equal(r2.posible_duplicado, a.hash);
  assert.ok(r2.avisos.some((x) => x.startsWith('posible_duplicado')));
  assert.equal(r2.yaAplicado, false);
  // sin hora no se avisa: no hay con qué comparar
  const c = await parseTicket(texto().replace(' 20:58 OP: 4350', ''));
  assert.equal(aplica(aplica(inventarioVacio(), c).inventario, { ...c, hash: 'x'.repeat(64) }).posible_duplicado, null);
});

test('PDF sintético con factura y su texto sin la línea de factura dan el mismo hash', async () => {
  const conFactura = await parseTicket(await textoDePdf(pdfDeTicket(texto())));
  const sinFactura = await parseTicket(texto().replace(/FACTURA SIMPLIFICADA: .*\n/, ''));
  assert.equal(conFactura.hora, '20:58');
  assert.equal(conFactura.hash, sinFactura.hash);
});
