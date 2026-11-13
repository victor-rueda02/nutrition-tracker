// core/ticket-parse.js + core/tickets.js: leer un ticket de Mercadona, clasificar sus líneas contra la dieta y aplicarlo al inventario.
// Los fixtures son los de tests/fixtures/tickets (líneas de producto y fecha) y la tabla real data/tickets-mercadona.json; los
// gramos esperados se calculan a mano aquí (envase × unidades × gramos × porción comestible).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseTicket, sha256Hex, TicketError, normalizarDescripcion, clasificarLinea, aplicarTicket, resolverDuda, indiceParecido, candidatosParecidos } from '../frontend/js/core/tickets.js';
import { sha256Bytes } from '../frontend/js/core/ticket-parse.js';
import { inventarioVacio, alimentosDeLaDieta, calcularStock, anadirRecuento } from '../frontend/js/core/inventario.js';
import { realFoods, readFile } from './helpers.js';

const tabla = JSON.parse(readFile('../data/tickets-mercadona.json'));
const dieta = JSON.parse(readFile('../data/dieta.json'));
const recetasJson = JSON.parse(readFile('../data/recetas.json'));
const recetas = recetasJson.recetas ?? recetasJson;
const conjunto = alimentosDeLaDieta(dieta, recetas, null, '2026-11-14', { noSeguidas: ['lentejas_caseras'] });
const foodsById = new Map(realFoods.map((f) => [f.id, f]));
const fixture = (f) => readFile(`./fixtures/tickets/${f}`);
const ctx = { tabla, conjunto, foodsById };
const ids = (() => { let n = 0; return () => `id-${++n}`; })();
const aplica = (inv, t, extra = {}) => aplicarTicket(inv, t, { ...ctx, id: ids, ahora: new Date(2026, 10, 14, 10, 30), ...extra });
const gramosDe = (r) => Object.fromEntries(r.compras.map((c) => [`${c.food_id}#${c.linea}`, c.gramos]));
const totalPor = (r) => { const o = {}; for (const c of r.compras) o[c.food_id] = (o[c.food_id] ?? 0) + c.gramos; return o; };

// ---------- lectura ----------

test('parseTicket: fixtures — fecha, líneas y la línea a peso en dos renglones', async () => {
  const t = await parseTicket(fixture('ticket-2026-09-09.txt'));
  assert.equal(t.fecha, '2026-09-09');
  assert.match(t.hash, /^[0-9a-f]{64}$/);
  assert.equal(t.lineas.length, 67);
  assert.deepEqual(t.lineas[0], { n: 1, cantidad: 3, descripcion: 'ATÚN CLARO OLIVA PK6', precio_unitario: 4.9, importe: 14.7, peso_kg: null });
  assert.deepEqual(t.lineas[2], { n: 3, cantidad: 1, descripcion: '12 HUEVOS SUPER GRAN', precio_unitario: null, importe: 4.3, peso_kg: null }, 'el número de la descripción no es la cantidad');
  assert.deepEqual(t.lineas[66], { n: 67, cantidad: 1, descripcion: 'PATATA', precio_unitario: 1.9, importe: 1.65, peso_kg: 0.87 }, '«PATATA» + «0,870 kg 1,90 €/kg 1,65» es una sola línea');
  assert.ok(t.lineas.every((l) => !l.ilegible));
  const b = await parseTicket(fixture('ticket-2026-10-26.txt'));
  assert.equal(b.fecha, '2026-10-26');
  assert.equal(b.lineas.length, 22);
  assert.deepEqual(b.lineas[21], { n: 22, cantidad: 1, descripcion: 'MANDARINA', precio_unitario: 2.55, importe: 2.03, peso_kg: 0.798 });
  assert.notEqual(t.hash, b.hash);
});

// Texto como el que sale del PDF real (cabecera, hora, OP, factura, IVA y tarjeta), con datos inventados.
const textoDePdfReal = (factura = '1234-567-890123') => `MERCADONA, S.A. A-00000000
C/ DE PRUEBA, 1
00000 CIUDAD
TELÉFONO: 900000000
26/10/2026 20:58 OP: 4350
FACTURA SIMPLIFICADA: ${factura}
Cnt. Descripción P. Unit Importe
2 BEBIDA AVENA 0,95 1,90
1 MANDARINA
0,798 kg 2,55 €/kg 2,03
TOTAL (€) 3,93
TOTAL (€) Entregado (€) Cambio (€)
10% 3,57 0,36 3,93
TARJETA BANCARIA: **** **** **** 1234
AUT: 123456 AID: A0000000031010
Importe: 3,93 €`;

test('parseTicket: texto con cabecera y pie reales — solo fecha y líneas; nada de tienda, NIF, hora, OP, factura, tarjeta ni IVA', async () => {
  const t = await parseTicket(textoDePdfReal());
  assert.equal(t.fecha, '2026-10-26');
  assert.deepEqual(t.lineas.map((l) => [l.descripcion, l.cantidad, l.importe, l.peso_kg]), [['BEBIDA AVENA', 2, 1.9, null], ['MANDARINA', 1, 2.03, 0.798]]);
  const json = JSON.stringify(t);
  for (const dato of ['A-00000000', 'PRUEBA', '900000000', '20:58', 'OP:', '4350', '1234-567-890123', 'FACTURA', 'TARJETA', '****', 'AUT', '10%']) assert.ok(!json.includes(dato), `no debe aparecer ${dato}`);
});

test('parseTicket: el hash es el SHA-256 de «FACTURA SIMPLIFICADA: …» + fecha (no depende de las líneas); sin factura, de la fecha y las líneas', async () => {
  const t = await parseTicket(textoDePdfReal('1234-567-890123'));
  assert.equal(t.hash, createHash('sha256').update('FACTURA SIMPLIFICADA: 1234-567-890123|2026-10-26').digest('hex'));
  assert.equal((await parseTicket(textoDePdfReal('1234-567-890123').replace('BEBIDA AVENA 0,95 1,90', 'BEBIDA AVENA 0,95 1,90 '))).hash, t.hash, 'espacios sobrantes no cambian el hash');
  assert.notEqual((await parseTicket(textoDePdfReal('1234-567-890124'))).hash, t.hash);
  const a = await parseTicket(fixture('ticket-2026-10-26.txt'));
  assert.equal(a.hash, (await parseTicket(fixture('ticket-2026-10-26.txt').replace(/\r\n/g, '\n'))).hash, 'mismo texto, mismo hash (CRLF o LF)');
  assert.notEqual(a.hash, (await parseTicket(fixture('ticket-2026-10-26.txt').replace('1 ARROZ LARGO 1,20', '2 ARROZ LARGO 1,20 2,40'))).hash);
});

test('SHA-256 en JS (sin crypto.subtle, para http por IP) da lo mismo que Node, también en los límites del relleno', async () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
    const s = 'aÁ€x'.repeat(Math.ceil(n / 4)).slice(0, n);
    const esperado = createHash('sha256').update(s).digest('hex');
    assert.equal(sha256Bytes(new TextEncoder().encode(s)), esperado, `${n} caracteres`);
    assert.equal(await sha256Hex(s), esperado);
  }
  const antes = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    assert.equal(await sha256Hex('hola'), createHash('sha256').update('hola').digest('hex'));
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: antes, configurable: true });
  }
});

test('parseTicket: lo ilegible se marca (sin precio ni peso, sin cantidad); sin cabecera, sin fecha o sin líneas lanza TicketError', async () => {
  const t = await parseTicket('12/11/2026\nCnt. Descripción P. Unit Importe\n1 ARROZ LARGO 1,20\n1 PATATA\n??? raro\n0,500 kg 1,00 €/kg 0,50\nTOTAL (€) 1,70');
  assert.deepEqual(t.lineas.map((l) => [l.descripcion, !!l.ilegible]), [['ARROZ LARGO', false], ['PATATA', true], ['??? raro', true], ['0,500 kg 1,00 €/kg 0,50', true]]);
  const falla = (texto, code) => assert.rejects(parseTicket(texto), (e) => e instanceof TicketError && e.code === code, code);
  await falla('12/11/2026\n1 ARROZ 1,00', 'sin_detalle');
  await falla('Cnt. Descripción P. Unit Importe\n1 ARROZ 1,00', 'sin_fecha');
  await falla('31/02/2026\nCnt. Descripción P. Unit Importe\n1 ARROZ 1,00', 'sin_fecha');
  await falla('12/11/2026\nCnt. Descripción P. Unit Importe\nTOTAL (€) 0,00', 'sin_lineas');
});

test('normalizarDescripcion: es la clave de data/tickets-mercadona.json', () => {
  for (const [clave, p] of Object.entries(tabla.productos)) assert.equal(normalizarDescripcion(p.descripcion), clave);
  assert.equal(normalizarDescripcion('  ATÚN   CLARO OLIVA PK6 '), 'atun claro oliva pk6');
});

// ---------- clasificar ----------

const lin = (descripcion, extra = {}) => ({ n: 1, cantidad: 1, descripcion, precio_unitario: null, importe: 1, peso_kg: null, ...extra });

test('clasificarLinea: tabla — envase, a peso con porción comestible y peso del ticket', () => {
  const c = (l, e = {}) => clasificarLinea(l, { ...ctx, ...e });
  assert.deepEqual(c(lin('ARROZ LARGO', { cantidad: 4 })), { tipo: 'compra', food_id: 'arroz_blanco_crudo', gramos: 4000, bruto: 4000, factor: 1, sinPorcionComestible: false, origen: 'tabla', confirmar: false });
  const nueces = c(lin('NUEZ CASCARA NATURAL'));
  assert.equal(nueces.gramos, 270); // 600 g con cáscara × 0,45
  assert.equal(nueces.bruto, 600);
  assert.equal(c(lin('MANDARINA', { peso_kg: 0.798 })).gramos, 574.56); // 798 g × 0,72
  assert.equal(c(lin('PATATA', { peso_kg: 0.87 })).gramos, 870);
  assert.equal(c(lin('  atún claro oliva pk6 ', { cantidad: 3 })).gramos, 1080, 'sin acentos ni mayúsculas ni espacios sobrantes');
});

test('clasificarLinea: cantidad no clara = Duda aunque el alimento sea seguro', () => {
  const c = (l) => clasificarLinea(l, ctx);
  assert.deepEqual([c(lin('FILETE PECHUGA FINO')).tipo, c(lin('FILETE PECHUGA FINO')).motivo, c(lin('FILETE PECHUGA FINO')).candidatos], ['duda', 'preguntar_gramos', ['pechuga_pollo_cruda']]);
  assert.equal(c(lin('ROJA DULCE BOLSA')).motivo, 'preguntar_gramos');
  assert.equal(c(lin('MANDARINA')).motivo, 'sin_peso', 'a peso y sin los kg');
  assert.equal(c(lin('ARROZ LARGO', { ilegible: true })).motivo, 'ilegible');
  assert.equal(c(lin('ARROZ LARGO', { cantidad: null })).motivo, 'ilegible');
  assert.equal(c(lin('ARROZ LARGO', { cantidad: 0 })).motivo, 'ilegible');
  // envase sin tamaño en la tabla
  const sinTamano = { productos: { 'arroz raro': { food_id: 'arroz_blanco_crudo', nombre_envase: 'paquete', unidades_por_envase: 1, gramos_por_unidad: null } } };
  assert.equal(clasificarLinea(lin('ARROZ RARO'), { ...ctx, tabla: sinTamano }).motivo, 'sin_tamano_envase');
  // con el peso del ticket, la pechuga ya no pregunta
  const conPeso = c(lin('FILETE PECHUGA FINO', { peso_kg: 0.45 }));
  assert.equal(conPeso.tipo, 'compra');
  assert.equal(conPeso.gramos, 450);
  assert.equal(c(lin('FILETE PECHUGA FINO')).gramos_sugeridos, null);
  assert.equal(c(lin('NUEZ RARA', { peso_kg: 0.5 })).gramos_sugeridos, 500, 'una duda con peso lo sugiere (brutos)');
});

test('clasificarLinea: ignorar de la tabla, lo que no se parece a la dieta y lo que ya no está en la dieta se descartan', () => {
  const c = (l, e = {}) => clasificarLinea(l, { ...ctx, ...e });
  assert.deepEqual([c(lin('LECHE SEMI')).tipo, c(lin('LECHE SEMI')).motivo], ['descartada', 'ignorar']);
  for (const d of ['12 HUEVOS SUPER GRAN', '6 HUEVOS GRANDES-L', 'LIMPIAHOGAR PH NEUTR', 'PAPEL HUMEDO WC', 'DEO ROLL.ON HOMBRE', 'PISTACHO TOST 0% SAL', 'QUESO LONCHAS TIERNO', 'BOLSA PLASTICO']) {
    assert.equal(c(lin(d)).tipo, 'descartada', d);
  }
  assert.equal(c(lin('PISTACHO TOST 0% SAL')).motivo, 'sin_parecido', 'lo que va tras «0 %» o «sin» no cuenta: no es sal');
  // la dieta cambió: el alimento de la tabla ya no está en el conjunto
  const sinArroz = conjunto.filter((id) => id !== 'arroz_blanco_crudo');
  const r = c(lin('ARROZ LARGO', { cantidad: 4 }), { conjunto: sinArroz });
  assert.deepEqual([r.tipo, r.motivo, r.food_id], ['descartada', 'fuera_de_dieta', 'arroz_blanco_crudo']);
});

test('clasificarLinea: una descripción nueva parecida a la dieta va a Dudas con candidatos (abreviaturas incluidas)', () => {
  const c = (d) => clasificarLinea(lin(d), ctx);
  const yogur = c('GRIEGO LIGERO P-6');
  assert.deepEqual([yogur.tipo, yogur.motivo, yogur.candidatos], ['duda', 'parecido', ['yogur_griego_ligero']]);
  assert.deepEqual(c('YOGUR GRIEGO LIGERO').candidatos, ['yogur_griego_ligero']);
  assert.ok(c('GRIEGO NATURAL P-4').candidatos.includes('yogur_griego_ligero'), 'una palabra del nombre basta para preguntar');
  assert.deepEqual(c('TOM. PERA').candidatos.slice(0, 2).sort(), ['salsa_tomate_frito', 'tomate'], 'tom. = tomate');
  assert.equal(c('PIM ROJO BOLSA').candidatos[0], 'pimiento_rojo', 'pim = pimiento');
  assert.equal(c('VERD. ASADA FAMILIAR').candidatos[0], 'verduras_asadas_hacendado', 'verd. = verduras; plurales sin importar');
  assert.equal(c('ACEITE OLIVA VIRGEN EXTRA 1L').candidatos[0], 'aceite_oliva');
  assert.equal(c('PLATANOS CANARIAS').candidatos[0], 'platano');
  assert.equal(c('SAL FINA').candidatos[0], 'sal');
  // el índice se puede reutilizar
  const indice = indiceParecido(conjunto, foodsById);
  assert.deepEqual(candidatosParecidos('KIWI ZESPRI', indice), ['kiwi_verde']);
  assert.deepEqual(candidatosParecidos('LIMPIAHOGAR', indice), []);
});

test('clasificarLinea: lo aprendido manda sobre la tabla y se aplica con sus gramos por unidad', () => {
  const aprendido = { 'arroz largo': 'ignorar', 'griego ligero p-6': 'yogur_griego_ligero:500', 'filete pechuga fino': 'pechuga_pollo_cruda', 'zumo raro': 'tomate:300' };
  const c = (l) => clasificarLinea(l, { ...ctx, aprendido });
  assert.deepEqual([c(lin('ARROZ LARGO')).tipo, c(lin('ARROZ LARGO')).motivo], ['descartada', 'ignorar']);
  const y = c(lin('GRIEGO LIGERO P-6', { cantidad: 2 }));
  assert.deepEqual([y.tipo, y.food_id, y.gramos, y.origen], ['compra', 'yogur_griego_ligero', 1000, 'aprendido']);
  assert.equal(c(lin('GRIEGO LIGERO P-6', { cantidad: 2, peso_kg: 0.9 })).gramos, 900, 'el peso del ticket manda');
  const p = c(lin('FILETE PECHUGA FINO'));
  assert.deepEqual([p.tipo, p.motivo, p.food_id], ['duda', 'preguntar_gramos', 'pechuga_pollo_cruda']);
  // un alimento aprendido que salió de la dieta se descarta
  assert.equal(clasificarLinea(lin('ZUMO RARO'), { ...ctx, aprendido, conjunto: conjunto.filter((x) => x !== 'tomate') }).motivo, 'fuera_de_dieta');
});

// ---------- aplicar ----------

test('aplicarTicket (09-09-2026, tabla real): las líneas de la dieta suman lo esperado, lo de fuera se ignora y lo dudoso queda en Dudas', async () => {
  const t = await parseTicket(fixture('ticket-2026-09-09.txt'));
  const r = aplica(inventarioVacio(), t);
  assert.equal(r.yaAplicado, false);
  assert.deepEqual(totalPor(r), {
    atun_lata_aceite: 1080, // 3 packs × 6 latas × 60 g escurridos
    pasta_seca: 1000,
    arroz_blanco_crudo: 4000, // 4 paquetes de 1 kg
    corn_flakes: 500,
    chocolate_negro_85: 200,
    nueces: 270, // 600 g con cáscara × 0,45
    almendras_crudas: 200,
    salsa_tomate_frito: 380,
    semillas_chia: 250,
    cebolla: 1000, // malla de 1 kg; sin porción comestible en el documento: se cuenta entera y avisa
    muesli: 500,
    patata_cruda: 870, // 0,870 kg a peso
  });
  assert.equal(r.compras.length, 12);
  assert.ok(r.avisos.some((a) => a.includes('CEBOLLA TUBO') && a.includes('porción comestible')));
  // dudas: carne y pescado sin peso y la bolsa de manzanas
  assert.deepEqual(r.dudas.map((d) => [d.descripcion, d.motivo, d.candidatos]), [
    ['FILETE PECHUGA FINO', 'preguntar_gramos', ['pechuga_pollo_cruda']],
    ['FILETE SALMÓN', 'preguntar_gramos', ['salmon_atlantico']],
    ['PECHUGA FAMILIAR', 'preguntar_gramos', ['pechuga_pollo_cruda']],
    ['ROJA DULCE BOLSA', 'preguntar_gramos', ['manzana_con_piel']],
  ]);
  // lo que no es de la dieta no se guarda en ningún sitio
  const guardado = JSON.stringify(r.inventario);
  for (const fuera of ['LIMPIAHOGAR', 'PAPEL HUMEDO', 'HIGIENICO', 'DEO ROLL', 'LECHE', 'PISTACHO', 'HUEVOS', 'MAYONESA', 'BOLSA PLASTICO', 'KETCHUP']) assert.ok(!guardado.includes(fuera), fuera);
  assert.equal(r.inventario.eventos.length, 12);
  assert.equal(r.inventario.dudas.length, 4);
  for (const motivo of ['ignorar', 'sin_parecido']) assert.ok(r.descartadas.some((d) => d.motivo === motivo), motivo);
  for (const d of ['12 HUEVOS SUPER GRAN', '6 HUEVOS GRANDES-L', 'LECHE SEMI', 'LECHE ETERA GAZA PA', 'PISTACHO TOST 0% SAL', 'LIMPIAHOGAR PH NEUTR']) assert.ok(r.descartadas.some((x) => x.descripcion === d), d);
  assert.equal(r.compras.length + r.dudas.length + r.descartadas.length, 67, 'cada línea acaba en una cosa');
  // el ticket queda registrado con su hash, fecha y origen, y las compras llevan su hash y su línea
  assert.deepEqual(r.inventario.tickets[t.hash], { fecha: '2026-09-09', aplicado: '2026-11-14T10:30', origen: 'app' });
  const arroz = r.inventario.eventos.find((e) => e.food_id === 'arroz_blanco_crudo');
  assert.deepEqual([arroz.tipo, arroz.gramos, arroz.ticket, arroz.linea, arroz.momento], ['compra', 4000, t.hash, 23, '2026-09-09T00:00']);
});

test('aplicarTicket (26-10-2026): envases de varias unidades, bebida en gramos, mandarina a peso con su porción comestible', async () => {
  const t = await parseTicket(fixture('ticket-2026-10-26.txt'));
  const r = aplica(inventarioVacio(), t, { origen: 'correo' });
  assert.deepEqual(totalPor(r), {
    sardina_lata_reducida_sal: 130, // pack de 2 latas × 65 g escurridos
    atun_lata_aceite: 360, // 6 × 60
    lentejas_secas: 1000,
    arroz_blanco_crudo: 1000,
    pasta_seca: 1000,
    avena_copos: 500,
    verduras_asadas_hacendado: 450,
    salteado_verduras_hacendado: 600,
    datiles_deglet_noor: 250,
    corn_flakes: 1000, // 2 cajas de 500 g
    muesli: 500,
    bebida_de_avena: 3090, // 3 bricks × 1 L × 1,03
    pan_integral: 230,
    mandarina: 574.56, // 0,798 kg × 1000 × 0,72
  });
  assert.deepEqual(r.dudas.map((d) => d.descripcion), ['ROJA ACIDULCE BOLSA']);
  assert.equal(r.inventario.tickets[t.hash].origen, 'correo');
  for (const d of ['GRIEGO NATURAL P-6', 'PARRILLADA VERDURA A', 'QUESO BURGOS NATURAL', 'ALCOHOL ETILICO 96', 'JAMÓN COCIDO 92%']) assert.ok(r.descartadas.some((x) => x.descripcion === d), d);
});

test('aplicarTicket: el mismo ticket dos veces no suma dos veces («Ticket ya aplicado»), ni aunque llegue otra vez por otro camino', async () => {
  const t = await parseTicket(fixture('ticket-2026-10-26.txt'));
  const a = aplica(inventarioVacio(), t);
  const b = aplica(a.inventario, t, { origen: 'correo' });
  assert.equal(b.yaAplicado, true);
  assert.deepEqual([b.compras, b.dudas, b.descartadas], [[], [], []]);
  assert.equal(b.inventario, a.inventario, 'ni un cambio en el inventario');
  assert.equal(a.inventario.eventos.length, 14);
  // el mismo ticket leído de nuevo (otro objeto, mismo hash) tampoco
  const otra = await parseTicket(fixture('ticket-2026-10-26.txt'));
  assert.equal(aplica(a.inventario, otra).yaAplicado, true);
  // y un ticket con la misma factura pero texto algo distinto (p. ej. PDF vs texto pegado) tiene el mismo hash
  const x = await parseTicket(textoDePdfReal());
  const y = await parseTicket(textoDePdfReal().replace('BEBIDA AVENA', 'BEBIDA  AVENA'));
  assert.equal(x.hash, y.hash);
  assert.equal(aplica(aplica(inventarioVacio(), x).inventario, y).yaAplicado, true);
});

test('aplicarTicket: el stock sale del recuento más lo comprado después (un recuento del mismo día ya cuenta el ticket)', async () => {
  const t = await parseTicket(fixture('ticket-2026-10-26.txt'));
  let inv = anadirRecuento(inventarioVacio(), { food_id: 'arroz_blanco_crudo', gramos: 250, momento: '2026-10-20T09:00' }, { id: ids });
  inv = anadirRecuento(inv, { food_id: 'pasta_seca', gramos: 100, momento: '2026-10-26T18:00' }, { id: ids }); // recuento el mismo día del ticket
  const r = aplica(inv, t);
  const stock = calcularStock(r.inventario, [], { conjunto, hoy: '2026-10-27' });
  assert.equal(stock.arroz_blanco_crudo.gramos, 1250); // 250 + 1000
  assert.equal(stock.pasta_seca.gramos, 100); // el recuento del 26 ya incluye lo comprado ese día
  assert.equal(stock.bebida_de_avena.gramos, null, 'sin recuento: sin contar, no 0');
  assert.equal(stock.bebida_de_avena.comprado, 3090);
});

test('aplicarTicket: una descripción nueva parecida a «yogur griego ligero» y una línea ilegible acaban en Dudas sin sumar', async () => {
  const t = await parseTicket('01/11/2026\nCnt. Descripción P. Unit Importe\n2 GRIEGO LIGERO P-6 1,45 2,90\n1 ARROZ LARGO\nTOTAL (€) 2,90');
  const r = aplica(inventarioVacio(), t);
  assert.deepEqual(r.compras, []);
  assert.deepEqual(r.inventario.eventos, []);
  assert.deepEqual(r.dudas.map((d) => [d.descripcion, d.motivo, d.candidatos, d.cantidad]), [['GRIEGO LIGERO P-6', 'parecido', ['yogur_griego_ligero'], 2], ['ARROZ LARGO', 'ilegible', ['arroz_blanco_crudo'], 1]]);
  assert.equal(r.dudas[0].ticket, t.hash);
  assert.equal(r.dudas[0].linea, 1);
  assert.equal(r.dudas[0].fecha, '2026-11-01');
});

// ---------- resolver dudas ----------

test('resolverDuda: suma la compra (con su porción comestible), quita la duda y, con recordar, el siguiente ticket lo asigna solo', async () => {
  const t1 = await parseTicket('01/11/2026\nFACTURA SIMPLIFICADA: 0001-001-000001\nCnt. Descripción P. Unit Importe\n2 GRIEGO LIGERO P-6 1,45 2,90\nTOTAL (€) 2,90');
  const r1 = aplica(inventarioVacio(), t1);
  assert.equal(r1.dudas.length, 1);
  const res = resolverDuda(r1.inventario, r1.dudas[0].id, { food_id: 'yogur_griego_ligero', gramos: 1000, recordar: true }, { foodsById, conjunto, id: ids });
  assert.deepEqual(res.compra, { food_id: 'yogur_griego_ligero', gramos: 1000, bruto: 1000, factor: 1, sinPorcionComestible: false, linea: 1 });
  assert.equal(res.inventario.dudas.length, 0);
  const ev = res.inventario.eventos[0];
  assert.deepEqual([ev.tipo, ev.food_id, ev.gramos, ev.ticket, ev.linea, ev.momento], ['compra', 'yogur_griego_ligero', 1000, t1.hash, 1, '2026-11-01T00:00']);
  assert.deepEqual(res.inventario.aprendido, { 'griego ligero p-6': 'yogur_griego_ligero:500' }, '1000 g / 2 unidades = 500 g por unidad');
  // el siguiente ticket con esa descripción lo asigna solo: 3 × 500
  const t2 = await parseTicket('08/11/2026\nFACTURA SIMPLIFICADA: 0001-001-000002\nCnt. Descripción P. Unit Importe\n3 GRIEGO LIGERO P-6 1,45 4,35\nTOTAL (€) 4,35');
  const r2 = aplica(res.inventario, t2);
  assert.deepEqual(r2.dudas, []);
  assert.deepEqual(r2.compras.map((c) => [c.food_id, c.gramos, c.origen]), [['yogur_griego_ligero', 1500, 'aprendido']]);
  // y resolver otra vez la misma duda no la duplica (la duda ya no existe)
  assert.throws(() => resolverDuda(res.inventario, r1.dudas[0].id, { food_id: 'yogur_griego_ligero', gramos: 1000 }), /No existe la duda/);
});

test('resolverDuda: porción comestible, «no es de la dieta» recordado y carne que siempre pregunta los gramos', async () => {
  const t = await parseTicket('01/11/2026\nCnt. Descripción P. Unit Importe\n1 ROJA DULCE BOLSA 2,88\n1 PIM PIQ RARO 1,00\n1 FILETE PECHUGA FINO 4,39\nTOTAL (€) 8,27');
  const r = aplica(inventarioVacio(), t);
  assert.equal(r.dudas.length, 3);
  const [manzana, piquillo, pechuga] = r.dudas;
  assert.deepEqual(manzana.candidatos, ['manzana_con_piel']);
  // la bolsa de manzanas pesa 1,2 kg en la etiqueta: lo comestible es el 90 %
  const a = resolverDuda(r.inventario, manzana.id, { food_id: 'manzana_con_piel', gramos: 1200 }, { foodsById, id: ids });
  assert.deepEqual([a.compra.gramos, a.compra.bruto, a.compra.factor], [1080, 1200, 0.9]);
  assert.deepEqual(a.inventario.aprendido, {}, 'sin recordar no se apunta nada');
  // «No es de la dieta» con recordar
  const b = resolverDuda(a.inventario, piquillo.id, { ignorar: true, recordar: true }, { id: ids });
  assert.equal(b.compra, null);
  assert.deepEqual(b.inventario.aprendido, { 'pim piq raro': 'ignorar' });
  assert.equal(b.inventario.eventos.length, 1, 'ignorar no suma nada');
  // la pechuga pesa distinto cada vez: se recuerda el alimento, no los gramos
  const c = resolverDuda(b.inventario, pechuga.id, { food_id: 'pechuga_pollo_cruda', gramos: 620, recordar: true }, { foodsById, id: ids });
  assert.deepEqual(c.inventario.aprendido['filete pechuga fino'], 'pechuga_pollo_cruda');
  assert.equal(c.inventario.dudas.length, 0);
  // errores claros
  assert.throws(() => resolverDuda(r.inventario, manzana.id, { food_id: 'manzana_con_piel' }, { foodsById }), /gramos/);
  assert.throws(() => resolverDuda(r.inventario, manzana.id, { food_id: 'manzana_con_piel', gramos: 0 }, { foodsById }), /gramos/);
  assert.throws(() => resolverDuda(r.inventario, manzana.id, { gramos: 100 }, { foodsById }), /Elige el alimento/);
  assert.throws(() => resolverDuda(r.inventario, manzana.id, { food_id: 'pechuga_cruda_inventada', gramos: 100 }, { foodsById, conjunto }), /no está en la dieta/);
});

test('resolverDuda: una duda a peso sugiere los gramos y recordar guarda solo el alimento (el peso sale del ticket)', async () => {
  const t = await parseTicket('01/11/2026\nCnt. Descripción P. Unit Importe\n1 PLATANOS CANARIAS\n0,640 kg 1,99 €/kg 1,27\nTOTAL (€) 1,27');
  const r = aplica(inventarioVacio(), t);
  const d = r.dudas[0];
  assert.deepEqual([d.motivo, d.candidatos, d.gramos_sugeridos, d.peso_kg], ['parecido', ['platano'], 640, 0.64]);
  const res = resolverDuda(r.inventario, d.id, { food_id: 'platano', gramos: d.gramos_sugeridos, recordar: true }, { foodsById, id: ids });
  assert.equal(res.compra.gramos, 422.4); // 640 × 0,66
  assert.deepEqual(res.inventario.aprendido, { 'platanos canarias': 'platano' });
  const t2 = await parseTicket('09/11/2026\nCnt. Descripción P. Unit Importe\n1 PLATANOS CANARIAS\n0,500 kg 1,99 €/kg 1,00\nTOTAL (€) 1,00');
  assert.deepEqual(aplica(res.inventario, t2).compras.map((c) => [c.food_id, c.gramos]), [['platano', 330]]);
});
