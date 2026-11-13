// Inventario (núcleo puro, ESPEC §2, §3 y §6): conjunto de alimentos de la dieta, recetas, estado de eventos, consumo derivado,
// stock derivado, porción comestible, fusión de copias y lista de la compra. Sin DOM ni red.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  limpiarConfig, expandirLinea, versionesVigentes, alimentosDeLaDieta, inventarioVacio, limpiarInventario, anadirRecuentos, anadirRecuento,
  anadirAjuste, anadirCompra, sustituirEvento, ticketAplicado, registrarTicket, anadirDuda, quitarDuda, aprender, fusionarInventario,
  consumoPorDia, consumoDelDia, calcularStock, gramosComestibles, porcionComestible, listaCompra, hoyLocal, momentoLocal, diaDe,
} from '../frontend/js/core/inventario.js';
import { mergeRecetas } from '../frontend/js/core/recetas.js';
import { validarDieta } from '../frontend/js/core/dieta.js';
import { readFile } from './helpers.js';

const dietaReal = JSON.parse(readFile('../data/dieta.json'));
const recetasReales = JSON.parse(readFile('../data/recetas.json')).recetas;
const configReal = limpiarConfig(JSON.parse(readFile('../data/inventario.json')));
const L = (food_id, gramos) => ({ food_id, gramos });
const seq = (p = 'ev') => { let n = 0; return () => `${p}${++n}`; };

// ---------- configuración ----------

test('data/inventario.json: horizonte 7, margen 2 y lentejas_caseras sin seguir; limpiarConfig rellena lo que falta', () => {
  assert.deepEqual(configReal, { version: 1, recetas_no_seguidas: ['lentejas_caseras'], horizonte_dias: 7, margen_dias: 2 });
  assert.deepEqual(limpiarConfig(null), { version: 1, recetas_no_seguidas: [], horizonte_dias: 7, margen_dias: 2 });
  assert.deepEqual(limpiarConfig({ recetas_no_seguidas: ['a', ' a ', '', 3], horizonte_dias: 0, margen_dias: -1 }), { version: 1, recetas_no_seguidas: ['a'], horizonte_dias: 1, margen_dias: 2 });
});

// ---------- conjunto de alimentos de la dieta ----------

// Un plan mínimo con un periodo por cada versión de data/dieta.json (ids reales), todos vigentes a 13-11-2026 o futuros.
const periodosReales = dietaReal.versiones.map((v, i) => ({ id: v.periodo, nombre: v.nombre, inicio: `2026-11-${String(2 + 7 * i).padStart(2, '0')}`, fin: i === 0 ? '2026-11-15' : undefined })); // el primero vigente hoy, el resto futuros
const planReal = { tipo: 'plan_objetivos', version: 1, periodos: periodosReales, excepciones: [] };

test('alimentosDeLaDieta con los datos reales: 36 alimentos (sin plan y con un plan que cubre las versiones)', () => {
  const opciones = { noSeguidas: configReal.recetas_no_seguidas };
  const sinPlan = alimentosDeLaDieta(dietaReal, recetasReales, null, '2026-11-13', opciones);
  const conPlan = alimentosDeLaDieta(dietaReal, recetasReales, planReal, '2026-11-13', opciones);
  assert.equal(sinPlan.length, 36);
  assert.deepEqual(conPlan, sinPlan);
  // los de la tabla de ESPEC §2
  const esperados = ['arroz_blanco_crudo', 'avena_copos', 'pasta_seca', 'lentejas_secas', 'corn_flakes', 'muesli', 'cacao_polvo', 'crema_cacahuete', 'chocolate_negro_85', 'semillas_chia', 'aceite_oliva', 'sal', 'salsa_tomate_frito',
    'almendras_crudas', 'anacardos', 'nueces', 'datiles_deglet_noor', 'atun_lata_aceite', 'sardina_lata_reducida_sal', 'huevo', 'pechuga_pollo_cruda', 'salmon_atlantico', 'bebida_de_avena', 'yogur_griego_ligero', 'pan_integral',
    'manzana_con_piel', 'platano', 'kiwi_verde', 'mandarina', 'tomate', 'patata_cruda', 'zanahoria', 'cebolla', 'pimiento_rojo', 'verduras_asadas_hacendado', 'salteado_verduras_hacendado'];
  assert.deepEqual(sinPlan, [...esperados].sort());
  assert.equal(sinPlan.includes('lentejas_caseras'), false);
  // sin marcar lentejas_caseras como no seguida, se expandiría en sus ingredientes: la marca es lo que las deja fuera
  const sinMarcar = alimentosDeLaDieta(dietaReal, recetasReales, null, '2026-11-13');
  // (morro_cerdo y chorizo solo están en esa receta)
  assert.deepEqual(sinMarcar.filter((id) => !sinPlan.includes(id)), ['chorizo', 'morro_cerdo']);
});

test('alimentosDeLaDieta: solo versiones vigentes o futuras; un tramo <id>_AAAAMMDD cuenta para su versión; sin plan, todas', () => {
  const dieta = validarDieta({ version: 2, versiones: [
    { periodo: 'viejo', dias: { lunes: { cena: [L('huevo', 100)] } } },
    { periodo: 'actual', dias: { lunes: { cena: [L('arroz_blanco_crudo', 100)] } }, tipos: { descanso: { lunes: { cena: [L('pasta_seca', 80)] } } } },
    { periodo: 'futuro', dias: { lunes: { cena: [L('avena_copos', 50)] } } },
    { periodo: 'sin_periodo', dias: { lunes: { cena: [L('nueces', 10)] } } },
  ] }).dieta;
  const plan = { periodos: [
    { id: 'viejo', inicio: '2026-09-01', fin: '2026-11-01' },
    { id: 'actual', inicio: '2026-11-02', fin: '2026-11-09' }, // terminado el día 9 por una edición «desde hoy»...
    { id: 'actual_20261110', inicio: '2026-11-10' }, // ...y su tramo nuevo
    { id: 'futuro', inicio: '2026-12-01', fin: '2026-12-31' },
  ] };
  const hoy = '2026-11-13';
  assert.deepEqual(versionesVigentes(dieta, plan, hoy).map((v) => v.periodo), ['actual', 'futuro']);
  assert.deepEqual(alimentosDeLaDieta(dieta, [], plan, hoy), ['arroz_blanco_crudo', 'avena_copos', 'pasta_seca']); // incluye los tipos
  // el último día de un periodo todavía cuenta; al día siguiente ya no
  assert.deepEqual(versionesVigentes(dieta, { periodos: [{ id: 'viejo', inicio: '2026-09-01', fin: '2026-11-13' }] }, '2026-11-13').map((v) => v.periodo), ['viejo']);
  assert.deepEqual(versionesVigentes(dieta, { periodos: [{ id: 'viejo', inicio: '2026-09-01', fin: '2026-11-13' }] }, '2026-11-14'), []);
  assert.deepEqual(alimentosDeLaDieta(dieta, [], null, hoy), ['arroz_blanco_crudo', 'avena_copos', 'huevo', 'nueces', 'pasta_seca']);
  // dieta de versión 1: sus días
  assert.deepEqual(alimentosDeLaDieta({ dias: { lunes: { cena: [L('huevo', 1)] } } }, [], null, hoy), ['huevo']);
});

test('recetas en el conjunto: no seguida fuera (con sus ingredientes), envasada como sí misma, casera de la app expandida', () => {
  const recetas = mergeRecetas(recetasReales, [{ id: 'arroz_con_huevo_app', nombre: 'Arroz con huevo', peso_final_g: 400, ingredientes: [L('arroz_blanco_crudo', 150), L('huevo', 100), L('aceite_oliva', 10)] }]);
  const dieta = validarDieta({ versiones: [{ periodo: 'p', dias: { lunes: { comida: [L('lentejas_caseras', 625), L('salteado_verduras_hacendado', 200), L('arroz_con_huevo_app', 400)] } } }] }).dieta;
  const ids = alimentosDeLaDieta(dieta, recetas, null, '2026-11-13', { noSeguidas: ['lentejas_caseras'] });
  assert.deepEqual(ids, ['aceite_oliva', 'arroz_blanco_crudo', 'huevo', 'salteado_verduras_hacendado']);
  // el salteado lleva ingredientes en recetas.json, pero al tener etiqueta NO se expande
  assert.equal(ids.includes('judias_verdes'), false);
  // expandirLinea: no seguida = nada; envasada = ella; casera = proporción del peso final
  const ctx = { recetas, noSeguidas: ['lentejas_caseras'] };
  assert.deepEqual(expandirLinea('lentejas_caseras', 625, ctx), []);
  assert.deepEqual(expandirLinea('salteado_verduras_hacendado', 200, ctx), [L('salteado_verduras_hacendado', 200)]);
  assert.deepEqual(expandirLinea('arroz_con_huevo_app', 200, ctx), [L('arroz_blanco_crudo', 75), L('huevo', 50), L('aceite_oliva', 5)]);
  assert.deepEqual(expandirLinea('huevo', 108, ctx), [L('huevo', 108)]);
  // sin peso final: se reparte entre la suma de los ingredientes (150 + 100 = 250): 250 g de plato = los ingredientes tal cual
  const sinPeso = [{ id: 'r', nombre: 'r', ingredientes: [L('arroz_blanco_crudo', 150), L('huevo', 100)] }];
  assert.deepEqual(expandirLinea('r', 250, { recetas: sinPeso }), [L('arroz_blanco_crudo', 150), L('huevo', 100)]);
  assert.deepEqual(expandirLinea('r', 125, { recetas: sinPeso }), [L('arroz_blanco_crudo', 75), L('huevo', 50)]);
});

// ---------- estado: eventos, limpieza y fusión ----------

test('eventos: recuentos (varios a la vez), compra, ajuste; devuelven estados nuevos y no tocan el anterior', () => {
  const id = seq();
  const v0 = inventarioVacio();
  assert.deepEqual(v0, { version: 1, eventos: [], tickets: {}, dudas: [], aprendido: {} });
  const v1 = anadirRecuentos(v0, [L('arroz_blanco_crudo', 1000), L('huevo', 600)], '2026-11-14T10:00', { id });
  const v2 = anadirCompra(v1, { food_id: 'huevo', gramos: 720, momento: '2026-11-16T19:00', ticket: 'h1', linea: 3 }, { id });
  const v3 = anadirAjuste(v2, { food_id: 'huevo', gramos: -60, momento: '2026-11-17T09:00', motivo: 'caducado' }, { id });
  assert.equal(v0.eventos.length, 0);
  assert.equal(v1.eventos.length, 2);
  assert.deepEqual(v3.eventos.map((e) => [e.id, e.tipo, e.food_id, e.gramos]), [['ev1', 'recuento', 'arroz_blanco_crudo', 1000], ['ev2', 'recuento', 'huevo', 600], ['ev3', 'compra', 'huevo', 720], ['ev4', 'ajuste', 'huevo', -60]]);
  assert.deepEqual(v3.eventos[2], { id: 'ev3', tipo: 'compra', momento: '2026-11-16T19:00', food_id: 'huevo', gramos: 720, ticket: 'h1', linea: 3 });
  assert.equal(v3.eventos[3].motivo, 'caducado');
  // ids reales de core/ids.js por defecto
  assert.match(anadirRecuento(v0, { food_id: 'huevo', gramos: 0, momento: '2026-11-14T10:00' }).eventos[0].id, /^[0-9a-f-]{36}$/);
  // un recuento a 0 es un 0 real y vale; valores inválidos lanzan
  assert.throws(() => anadirRecuento(v0, { food_id: 'huevo', gramos: -1, momento: '2026-11-14T10:00' }), /no válido/);
  assert.throws(() => anadirCompra(v0, { food_id: 'huevo', gramos: 0, momento: '2026-11-14T10:00' }), /no válido/);
  assert.throws(() => anadirAjuste(v0, { food_id: 'huevo', gramos: 0, momento: '2026-11-14T10:00' }), /no válido/);
  assert.throws(() => anadirRecuento(v0, { food_id: 'huevo', gramos: 5, momento: '14/11/2026' }), /no válido/);
  assert.throws(() => anadirRecuento(v1, { food_id: 'huevo', gramos: 5, momento: '2026-11-14T10:00' }, { id: () => 'ev1' }), /repetido/);
  // la misma línea de un ticket nunca suma dos veces
  assert.equal(anadirCompra(v3, { food_id: 'huevo', gramos: 720, momento: '2026-11-16T19:05', ticket: 'h1', linea: 3 }, { id }), v3);
  // editar = sustituir por id
  const v4 = sustituirEvento(v3, { ...v3.eventos[3], gramos: -100 });
  assert.equal(v4.eventos[3].gramos, -100);
  assert.equal(v4.eventos.length, 4);
  assert.throws(() => sustituirEvento(v3, { ...v3.eventos[3], id: 'zzz' }), /No existe/);
});

test('tickets, dudas y aprendido', () => {
  let inv = inventarioVacio();
  assert.equal(ticketAplicado(inv, 'abc'), false);
  inv = registrarTicket(inv, 'abc', { fecha: '2026-10-26', aplicado: '2026-10-26T21:03', origen: 'correo' });
  assert.equal(ticketAplicado(inv, 'abc'), true);
  assert.deepEqual(inv.tickets.abc, { fecha: '2026-10-26', aplicado: '2026-10-26T21:03', origen: 'correo' });
  inv = anadirDuda(inv, { ticket: 'abc', linea: 7, descripcion: 'GRIEGO LIGERO P-6', cantidad: 1, candidatos: ['yogur_griego_ligero'], motivo: 'sin_tabla' }, { id: () => 'd1' });
  assert.equal(inv.dudas[0].id, 'd1');
  inv = aprender(inv, 'griego ligero p-6', 'yogur_griego_ligero');
  inv = aprender(inv, 'tom. receta artesana', 'ignorar');
  assert.deepEqual(inv.aprendido, { 'griego ligero p-6': 'yogur_griego_ligero', 'tom. receta artesana': 'ignorar' });
  assert.deepEqual(quitarDuda(inv, 'd1').dudas, []);
  assert.equal(inv.dudas.length, 1);
});

test('limpiarInventario: descarta lo no válido y repetido con aviso, conserva lo bueno y no lanza con basura', () => {
  const bueno = { id: 'a', tipo: 'recuento', momento: '2026-11-14T10:00', food_id: 'huevo', gramos: 600 };
  const { inventario, avisos } = limpiarInventario({
    version: 1,
    eventos: [bueno, bueno, { ...bueno, id: 'b', tipo: 'otro' }, { ...bueno, id: 'c', gramos: 'mucho' }, { ...bueno, id: 'd', momento: 'ayer' }, { ...bueno, id: 'e', food_id: '' }, null,
      { id: 'f', tipo: 'compra', momento: '2026-11-16T19:00', food_id: 'huevo', gramos: -5 }, { id: 'g', tipo: 'ajuste', momento: '2026-11-16T19:00', food_id: 'huevo', gramos: -50, motivo: ' roto ', extra: 1 }],
    tickets: { h: { fecha: '2026-10-26', origen: 'app', otro: 5 }, vacio: 'x' },
    dudas: [{ id: 'd1', ticket: 'h', candidatos: ['a', ' ', 3] }, { ticket: 'sin id' }],
    aprendido: { 'a b': 'huevo', '': 'x', c: '' },
  });
  assert.deepEqual(inventario.eventos.map((e) => e.id), ['a', 'g']);
  assert.deepEqual(inventario.eventos[1], { id: 'g', tipo: 'ajuste', momento: '2026-11-16T19:00', food_id: 'huevo', gramos: -50, motivo: 'roto' });
  assert.match(avisos[0], /7 eventos/);
  assert.deepEqual(inventario.tickets, { h: { fecha: '2026-10-26', origen: 'app' } });
  assert.deepEqual(inventario.dudas, [{ id: 'd1', ticket: 'h', candidatos: ['a'] }]);
  assert.deepEqual(inventario.aprendido, { 'a b': 'huevo' });
  for (const basura of [undefined, null, 5, 'x', [], { eventos: 'x', tickets: [], dudas: 3, aprendido: [] }]) assert.deepEqual(limpiarInventario(basura).inventario, inventarioVacio());
});

test('fusionarInventario: por id sin duplicar, gana lo local, tickets y aprendido se unen, nunca borra', () => {
  const ev = (id, gramos, extra = {}) => ({ id, tipo: 'compra', momento: '2026-11-16T19:00', food_id: 'huevo', gramos, ...extra });
  const local = { version: 1, eventos: [ev('a', 720, { ticket: 'h1', linea: 1 }), ev('b', 100)], tickets: { h1: { fecha: '2026-11-16', origen: 'app' } }, dudas: [{ id: 'd1', ticket: 'h2', linea: 4, candidatos: [] }], aprendido: { x: 'huevo' } };
  const copia = { version: 1,
    eventos: [ev('a', 999, { ticket: 'h1', linea: 1 }), ev('c', 50), ev('z', 40, { ticket: 'h3', linea: 2 })],
    tickets: { h1: { fecha: 'otra', origen: 'correo' }, h3: { fecha: '2026-11-18', origen: 'correo' } },
    dudas: [{ id: 'd1', ticket: 'h2', linea: 4, candidatos: [] }, { id: 'd2', ticket: 'h3', linea: 2, candidatos: [] }, { id: 'd3', ticket: 'h3', linea: 9, candidatos: [] }],
    aprendido: { x: 'ignorar', y: 'ignorar' } };
  const { inventario, nuevos } = fusionarInventario(local, copia);
  assert.deepEqual(inventario.eventos.map((e) => [e.id, e.gramos]), [['a', 720], ['b', 100], ['c', 50], ['z', 40]]); // local gana en 'a'; sin duplicados
  assert.deepEqual(inventario.tickets, { h1: { fecha: '2026-11-16', origen: 'app' }, h3: { fecha: '2026-11-18', origen: 'correo' } });
  assert.deepEqual(inventario.aprendido, { x: 'huevo', y: 'ignorar' });
  assert.deepEqual(inventario.dudas.map((d) => d.id), ['d1', 'd3']); // d2 ya está resuelta por la compra 'z' (ticket h3, línea 2)
  assert.deepEqual(nuevos, { eventos: 2, tickets: 1, dudas: 1, aprendido: 1 });
  // importar dos veces lo mismo no cambia nada; y no se modifica lo recibido
  const otra = fusionarInventario(inventario, copia);
  assert.deepEqual(otra.inventario, inventario);
  assert.deepEqual(otra.nuevos, { eventos: 0, tickets: 0, dudas: 0, aprendido: 0 });
  assert.equal(local.eventos.length, 2);
  assert.equal(fusionarInventario(undefined, copia).inventario.eventos.length, 3);
});

// ---------- consumo y stock derivados ----------

const reg = (date, ...lines) => ({ id: `m-${date}-${lines.length}`, date, meal: 'comida', lines: lines.map(([food_id, grams]) => ({ food_id, grams })), createdAt: `${date}T12:00:00.000Z` });
const recetasPrueba = [
  { id: 'arroz_con_huevo', nombre: 'Arroz con huevo', peso_final_g: 400, ingredientes: [L('arroz_blanco_crudo', 150), L('huevo', 100), L('aceite_oliva', 10)] },
  { id: 'lentejas_caseras', nombre: 'Lentejas', peso_final_g: 2800, ingredientes: [L('lentejas_secas', 400), L('cebolla', 100)] },
  { id: 'salteado_verduras_hacendado', nombre: 'Salteado', etiqueta: { energia_kcal: 31 }, ingredientes: [L('cebolla', 20), L('pimiento_rojo', 20)] },
];
const CONJUNTO = ['arroz_blanco_crudo', 'huevo', 'aceite_oliva', 'salteado_verduras_hacendado', 'pasta_seca', 'lentejas_secas', 'cebolla'];
const ctxBase = { conjunto: CONJUNTO, recetas: recetasPrueba, noSeguidas: ['lentejas_caseras'] };

test('consumo de un día: recetas expandidas, no seguidas = nada, fuera del conjunto o borrado = nada', () => {
  const dia = [reg('2026-11-15', ['arroz_blanco_crudo', 100], ['huevo', 108], ['arroz_con_huevo', 200], ['pan_integral', 70], ['borrado_del_documento', 50]), reg('2026-11-16', ['arroz_blanco_crudo', 999])];
  const c = consumoDelDia(dia, '2026-11-15', ctxBase);
  // 100 + 200 × 150/400 = 175 de arroz; 108 + 200 × 100/400 = 158 de huevo; 200 × 10/400 = 5 de aceite
  assert.deepEqual([...c].sort(), [['aceite_oliva', 5], ['arroz_blanco_crudo', 175], ['huevo', 158]]);
  assert.deepEqual([...consumoDelDia([reg('2026-11-16', ['lentejas_caseras', 625])], '2026-11-16', ctxBase)], []); // no seguida: ni ella ni sus lentejas ni su cebolla
  assert.deepEqual([...consumoDelDia([reg('2026-11-16', ['salteado_verduras_hacendado', 200])], '2026-11-16', ctxBase)], [['salteado_verduras_hacendado', 200]]); // envasada: ella, no su cebolla
  assert.deepEqual([...consumoDelDia(dia, '2026-11-20', ctxBase)], []);
  assert.equal(consumoPorDia(dia, ctxBase).size, 2);
});

// Inventario inicial el 14-11 a las 10:00; hoy = 20-11.
const MOMENTO_R = '2026-11-14T10:00';
const HOY = '2026-11-20';
const inventarioBase = () => {
  const id = seq();
  let inv = anadirRecuentos(inventarioVacio(), [L('arroz_blanco_crudo', 1000), L('huevo', 600), L('aceite_oliva', 500), L('salteado_verduras_hacendado', 1200)], MOMENTO_R, { id });
  inv = anadirCompra(inv, { food_id: 'arroz_blanco_crudo', gramos: 500, momento: '2026-11-13T18:00', ticket: 'viejo', linea: 1 }, { id }); // ANTES del recuento: ya está dentro
  inv = anadirCompra(inv, { food_id: 'arroz_blanco_crudo', gramos: 1000, momento: '2026-11-16T19:00', ticket: 't1', linea: 1 }, { id });
  inv = anadirCompra(inv, { food_id: 'huevo', gramos: 720, momento: '2026-11-16T19:00', ticket: 't1', linea: 2 }, { id });
  inv = anadirCompra(inv, { food_id: 'pasta_seca', gramos: 500, momento: '2026-11-16T19:00', ticket: 't1', linea: 3 }, { id });
  return inv;
};
const diarioBase = (arroz17) => [
  reg('2026-11-14', ['arroz_blanco_crudo', 500]), // día del recuento: ya está dentro del recuento, no se vuelve a restar
  reg('2026-11-15', ['arroz_blanco_crudo', 100], ['huevo', 108], ['arroz_con_huevo', 200], ['pan_integral', 70]), // con receta expandida y un alimento fuera de la dieta
  reg('2026-11-16', ['lentejas_caseras', 625], ['salteado_verduras_hacendado', 200], ['arroz_blanco_crudo', 50]), // una no seguida y una envasada
  reg('2026-11-17', ['arroz_blanco_crudo', arroz17], ['huevo', 54]),
  reg('2026-11-20', ['arroz_blanco_crudo', 60]), // hoy: se registra pero aún no se resta
  reg('2026-11-21', ['arroz_blanco_crudo', 999]), // futuro (dieta preparada por adelantado): nunca resta
];

test('criterio de terminado: inventario inicial + 3 días de diario (receta, alimento fuera de la dieta, día editado) + 1 ticket = stock a mano', () => {
  const inv = inventarioBase();
  // Arroz: recuento 1000 (14-11 10:00) + compra del ticket t1 (16-11, 19:00) 1000 [la de antes del recuento, 500, no suma]
  //        − 15-11: 100 directos + 200 g de arroz_con_huevo × 150/400 = 75  → 175
  //        − 16-11: 50
  //        − 17-11: 70 (antes de editar)  → 1000 + 1000 − 175 − 50 − 70 = 1705
  //        14-11 (día del recuento), hoy y mañana no restan.
  const antes = calcularStock(inv, diarioBase(70), { ...ctxBase, hoy: HOY });
  assert.equal(antes.arroz_blanco_crudo.gramos, 1705);
  // Día editado después (el 17-11 eran 120 g y no 70): 1000 + 1000 − 175 − 50 − 120 = 1655
  const despues = calcularStock(inv, diarioBase(120), { ...ctxBase, hoy: HOY });
  assert.equal(despues.arroz_blanco_crudo.gramos, 1655);
  assert.equal(despues.arroz_blanco_crudo.consumido, 345);
  assert.deepEqual(despues.arroz_blanco_crudo.consumos, [{ fecha: '2026-11-15', gramos: 175 }, { fecha: '2026-11-16', gramos: 50 }, { fecha: '2026-11-17', gramos: 120 }]);
  assert.equal(despues.arroz_blanco_crudo.registradoHoy, 60);
  assert.equal(despues.arroz_blanco_crudo.comprado, 1000);
  // Huevo: 600 + 720 (compra) − (108 + 200 × 100/400 = 158 el 15) − 54 (el 17) = 1108
  assert.equal(despues.huevo.gramos, 1108);
  // Aceite: 500 − 200 × 10/400 = 5 → 495
  assert.equal(despues.aceite_oliva.gramos, 495);
  // Salteado (bolsa): 1200 − 200 = 1000. Las lentejas caseras del 16 no restan nada (ni lentejas ni cebolla).
  assert.equal(despues.salteado_verduras_hacendado.gramos, 1000);
  // Pasta: comprada pero sin recuento → sin contar (null, nunca 0), con lo comprado
  assert.deepEqual([despues.pasta_seca.contado, despues.pasta_seca.gramos, despues.pasta_seca.comprado], [false, null, 500]);
  assert.equal(despues.lentejas_secas.gramos, null);
  assert.equal(despues.cebolla.gramos, null);
  // el alimento fuera de la dieta no aparece
  assert.equal('pan_integral' in despues, false);
  // determinista: mismo resultado en cualquier momento del mismo día
  assert.equal(hoyLocal(new Date(2026, 10, 20, 0, 1)), hoyLocal(new Date(2026, 10, 20, 23, 59)));
  assert.deepEqual(calcularStock(inv, diarioBase(120), { ...ctxBase, hoy: hoyLocal(new Date(2026, 10, 20, 23, 59)) }), despues);
  // al cerrarse hoy (21-11) lo del 20 ya resta: 1655 − 60
  assert.equal(calcularStock(inv, diarioBase(120), { ...ctxBase, hoy: '2026-11-21' }).arroz_blanco_crudo.gramos, 1595);
});

test('editar un día pasado posterior al recuento cambia el stock; uno anterior al recuento, no; hoy y futuros no restan', () => {
  const inv = inventarioBase();
  const base = calcularStock(inv, diarioBase(70), { ...ctxBase, hoy: HOY }).arroz_blanco_crudo.gramos;
  const editaPosterior = diarioBase(70).map((m) => (m.date === '2026-11-15' ? { ...m, lines: [...m.lines, { food_id: 'arroz_blanco_crudo', grams: 40 }] } : m));
  assert.equal(calcularStock(inv, editaPosterior, { ...ctxBase, hoy: HOY }).arroz_blanco_crudo.gramos, base - 40);
  const editaAnterior = [...diarioBase(70), reg('2026-11-10', ['arroz_blanco_crudo', 300])];
  assert.equal(calcularStock(inv, editaAnterior, { ...ctxBase, hoy: HOY }).arroz_blanco_crudo.gramos, base);
  const editaDelRecuento = diarioBase(70).map((m) => (m.date === '2026-11-14' ? reg('2026-11-14', ['arroz_blanco_crudo', 5]) : m));
  assert.equal(calcularStock(inv, editaDelRecuento, { ...ctxBase, hoy: HOY }).arroz_blanco_crudo.gramos, base);
  const futuro = [...diarioBase(70), reg('2026-12-24', ['arroz_blanco_crudo', 800])];
  assert.equal(calcularStock(inv, futuro, { ...ctxBase, hoy: HOY }).arroz_blanco_crudo.gramos, base);
  // borrar el registro del 15-11 devuelve sus gramos al stock
  assert.equal(calcularStock(inv, diarioBase(70).filter((m) => m.date !== '2026-11-15'), { ...ctxBase, hoy: HOY }).arroz_blanco_crudo.gramos, base + 175);
});

test('recuento a mitad de periodo: el último recuento manda y solo se restan los días cerrados posteriores', () => {
  const idX = seq('x');
  let inv = inventarioBase();
  inv = anadirRecuento(inv, { food_id: 'arroz_blanco_crudo', gramos: 800, momento: '2026-11-17T08:00' }, { id: idX });
  const diario = [...diarioBase(70), reg('2026-11-18', ['arroz_blanco_crudo', 100]), reg('2026-11-19', ['arroz_blanco_crudo', 30])];
  // 800 (17-11 08:00); la compra del 16-11 es anterior y ya está en el recuento; el 17-11 es el día del recuento (no resta);
  // restan el 18 (100) y el 19 (30) → 670
  const s = calcularStock(inv, diario, { ...ctxBase, hoy: HOY }).arroz_blanco_crudo;
  assert.equal(s.gramos, 670);
  assert.equal(s.recuento.gramos, 800);
  assert.equal(s.comprado, 0);
  // una compra o ajuste posterior al recuento sí suma; con el mismo momento que el recuento, no
  inv = anadirCompra(inv, { food_id: 'arroz_blanco_crudo', gramos: 250, momento: '2026-11-17T08:01' }, { id: idX });
  inv = anadirCompra(inv, { food_id: 'arroz_blanco_crudo', gramos: 9999, momento: '2026-11-17T08:00' }, { id: idX });
  inv = anadirAjuste(inv, { food_id: 'arroz_blanco_crudo', gramos: -20, momento: '2026-11-18T12:00', motivo: 'se derramó' }, { id: idX });
  assert.equal(calcularStock(inv, diario, { ...ctxBase, hoy: HOY }).arroz_blanco_crudo.gramos, 900); // 670 + 250 − 20
});

test('stock negativo: se marca y no se recorta', () => {
  const inv = anadirRecuento(inventarioVacio(), { food_id: 'huevo', gramos: 100, momento: '2026-11-14T10:00' });
  const s = calcularStock(inv, [reg('2026-11-15', ['huevo', 250])], { ...ctxBase, hoy: HOY }).huevo;
  assert.deepEqual([s.gramos, s.negativo, s.faltanRevisar], [-150, true, 150]);
  // un recuento a 0 es un 0 real (contado), no «sin contar»
  const cero = calcularStock(anadirRecuento(inventarioVacio(), { food_id: 'huevo', gramos: 0, momento: '2026-11-14T10:00' }), [], { ...ctxBase, hoy: HOY }).huevo;
  assert.deepEqual([cero.contado, cero.gramos, cero.negativo], [true, 0, false]);
});

test('cambio de dieta: un alimento nuevo entra sin contar (null); uno que sale deja de seguirse y sus eventos se conservan', () => {
  const inv = inventarioBase();
  const registros = diarioBase(120);
  const conNuevo = calcularStock(inv, registros, { ...ctxBase, conjunto: [...CONJUNTO, 'kiwi_verde'], hoy: HOY });
  assert.equal(conNuevo.kiwi_verde.gramos, null); // nunca 0
  assert.equal(conNuevo.kiwi_verde.contado, false);
  assert.equal(conNuevo.arroz_blanco_crudo.gramos, 1655); // el resto, igual
  // sale el huevo: no aparece, pero sus eventos siguen en el estado...
  const sinHuevo = calcularStock(inv, registros, { ...ctxBase, conjunto: CONJUNTO.filter((x) => x !== 'huevo'), hoy: HOY });
  assert.equal('huevo' in sinHuevo, false);
  assert.equal(inv.eventos.filter((e) => e.food_id === 'huevo').length, 2);
  // ...y si vuelve, su stock sigue ahí
  assert.equal(calcularStock(inv, registros, { ...ctxBase, hoy: HOY }).huevo.gramos, 1108);
  // y con la dieta real: el conjunto sale de los datos, no a mano
  const conjuntoNuevo = alimentosDeLaDieta(validarDieta({ versiones: [{ periodo: 'p', dias: { lunes: { cena: [L('huevo', 1), L('kiwi_verde', 100)] } } }] }).dieta, [], null, HOY);
  assert.deepEqual(conjuntoNuevo, ['huevo', 'kiwi_verde']);
});

test('fechas locales: momentoLocal, hoyLocal y diaDe', () => {
  const d = new Date(2026, 10, 3, 7, 5, 59);
  assert.equal(momentoLocal(d), '2026-11-03T07:05');
  assert.equal(hoyLocal(d), '2026-11-03');
  assert.equal(diaDe('2026-11-03T07:05'), '2026-11-03');
});

// ---------- porción comestible ----------

test('gramosComestibles: fracción de porcion_comestible; vacío o inválido = 1 con sinDato', () => {
  const f = (v) => ({ id: 'x', extra: v === undefined ? {} : { porcion_comestible: v } });
  assert.deepEqual(gramosComestibles(1000, f('0.5')), { gramos: 500, factor: 0.5, sinDato: false });
  assert.deepEqual(gramosComestibles(1000, f('0,52')), { gramos: 520, factor: 0.52, sinDato: false }); // coma decimal de Excel
  assert.deepEqual(gramosComestibles(1000, f(0.85)), { gramos: 850, factor: 0.85, sinDato: false });
  assert.deepEqual(gramosComestibles(1000, f('1')), { gramos: 1000, factor: 1, sinDato: false });
  for (const mal of [undefined, '', '  ', 'mucho', '0', '-0,3', '1,5', '85']) assert.deepEqual(gramosComestibles(1000, f(mal)), { gramos: 1000, factor: 1, sinDato: true }, `valor ${JSON.stringify(mal)}`);
  assert.deepEqual(gramosComestibles(1000, { id: 'sin_extra' }), { gramos: 1000, factor: 1, sinDato: true });
  assert.deepEqual(porcionComestible(null), { factor: 1, sinDato: true });
});

// ---------- lista de la compra ----------

const DIETA_LISTA = validarDieta({ versiones: [{ periodo: 'p', dias: {
  lunes: { comida: [L('arroz_blanco_crudo', 100), L('lentejas_caseras', 625)], cena: [L('huevo', 108)] },
  martes: { comida: [L('arroz_blanco_crudo', 80)] },
} }] }).dieta;
const PLAN_LISTA = { periodos: [{ id: 'p', nombre: 'P', inicio: '2026-11-01' }], excepciones: [] };

test('lista de la compra: necesidad de hoy a hoy+horizonte−1+margen, faltan, sin contar, envases enteros y días sin menú', () => {
  const hoy = '2026-11-16'; // lunes
  const conjunto = ['arroz_blanco_crudo', 'huevo', 'lentejas_secas'];
  const id = seq();
  let inv = anadirRecuento(inventarioVacio(), { food_id: 'arroz_blanco_crudo', gramos: 300, momento: '2026-11-15T10:00' }, { id });
  inv = anadirRecuento(inv, { food_id: 'lentejas_secas', gramos: 1000, momento: '2026-11-15T10:00' }, { id });
  const registros = [reg('2026-11-16', ['arroz_blanco_crudo', 50])]; // registrado hoy
  const stock = calcularStock(inv, registros, { conjunto, recetas: recetasPrueba, noSeguidas: ['lentejas_caseras'], hoy });
  assert.deepEqual([stock.arroz_blanco_crudo.gramos, stock.arroz_blanco_crudo.registradoHoy], [300, 50]);
  const l = listaCompra({ dieta: DIETA_LISTA, recetas: recetasPrueba, plan: PLAN_LISTA, hoy, noSeguidas: ['lentejas_caseras'], conjunto, stock, horizonte: 7, margen: 2, envases: { arroz_blanco_crudo: { gramos: 100, nombre: 'paquete de 1 kg' }, huevo: { gramos: 720, nombre: 'caja de 12' } } });
  // 7 días + 2 de margen: del lunes 16 al martes 24
  assert.deepEqual([l.desde, l.hasta, l.dias.length], ['2026-11-16', '2026-11-24', 9]);
  // menús: lunes 16 y 23, martes 17 y 24. Arroz: 100 + 80 + 100 + 80 = 360; huevo: 108 × 2 = 216; las lentejas caseras no suman
  const arroz = l.items.find((i) => i.food_id === 'arroz_blanco_crudo');
  // faltan = 360 − (300 − 50 registrado hoy) = 110 → 2 paquetes de 100 g
  assert.deepEqual([arroz.necesidad, arroz.stock, arroz.registradoHoy, arroz.faltan, arroz.stockDesconocido], [360, 300, 50, 110, false]);
  assert.deepEqual(arroz.envase, { nombre: 'paquete de 1 kg', gramos: 100, cantidad: 2 });
  // huevo sin contar: necesidad entera y «stock desconocido»
  const huevo = l.items.find((i) => i.food_id === 'huevo');
  assert.deepEqual([huevo.necesidad, huevo.stock, huevo.faltan, huevo.stockDesconocido], [216, null, 216, true]);
  assert.equal(huevo.envase.cantidad, 1); // 216 g / 720 g -> 1 caja
  // lentejas_secas solo estaban en la dieta por otro lado: aquí necesidad 0 y nada que comprar
  const lent = l.items.find((i) => i.food_id === 'lentejas_secas');
  assert.deepEqual([lent.necesidad, lent.faltan, lent.stock], [0, 0, 1000]);
  assert.equal(lent.envase, null);
  // días sin menú: miércoles 18 a domingo 22
  assert.deepEqual(l.sinMenu.map((d) => d.fecha), ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.match(l.sinMenu[0].error, /No hay dieta para el miércoles/);
  // con stock de sobra no hay que comprar (y nunca sale negativo); un múltiplo exacto de envase no sube uno más
  const sobra = { ...stock, arroz_blanco_crudo: { ...stock.arroz_blanco_crudo, gramos: 5000 } };
  const l2 = listaCompra({ dieta: DIETA_LISTA, recetas: recetasPrueba, plan: PLAN_LISTA, hoy, conjunto, stock: sobra, horizonte: 7, margen: 2, envases: { arroz_blanco_crudo: { gramos: 100 } } });
  assert.deepEqual([l2.items[0].faltan, l2.items[0].envase.cantidad], [0, 0]);
  const exacto = listaCompra({ dieta: DIETA_LISTA, recetas: [], plan: PLAN_LISTA, hoy, conjunto: ['arroz_blanco_crudo'], stock: { arroz_blanco_crudo: { contado: true, gramos: 160, registradoHoy: 0 } }, horizonte: 7, margen: 2, envases: { arroz_blanco_crudo: { gramos: 100 } } });
  assert.deepEqual([exacto.items[0].faltan, exacto.items[0].envase.cantidad], [200, 2]); // 360 − 160 = 200 g = 2 envases justos
  // sin margen: solo 7 días (16 a 22): arroz 100 + 80
  const sinMargen = listaCompra({ dieta: DIETA_LISTA, recetas: [], plan: PLAN_LISTA, hoy, conjunto: ['arroz_blanco_crudo'], stock: {}, horizonte: 7, margen: 0 });
  assert.deepEqual([sinMargen.hasta, sinMargen.items[0].necesidad, sinMargen.items[0].stockDesconocido], ['2026-11-22', 180, true]);
});

test('lista de la compra: las recetas del menú se expanden igual que en el conjunto y el día de un plan sin periodo se avisa', () => {
  const dieta = validarDieta({ versiones: [{ periodo: 'p', dias: { lunes: { cena: [L('arroz_con_huevo', 200), L('salteado_verduras_hacendado', 100)] } } }] }).dieta;
  const conjunto = alimentosDeLaDieta(dieta, recetasPrueba, PLAN_LISTA, '2026-11-16');
  assert.deepEqual(conjunto, ['aceite_oliva', 'arroz_blanco_crudo', 'huevo', 'salteado_verduras_hacendado']);
  const l = listaCompra({ dieta, recetas: recetasPrueba, plan: PLAN_LISTA, hoy: '2026-11-16', conjunto, stock: {}, horizonte: 1, margen: 0 });
  assert.deepEqual(l.items.map((i) => [i.food_id, i.necesidad]), [['aceite_oliva', 5], ['arroz_blanco_crudo', 75], ['huevo', 50], ['salteado_verduras_hacendado', 100]]);
  // antes del primer periodo del plan: sin menú, con el motivo
  const antes = listaCompra({ dieta, recetas: recetasPrueba, plan: PLAN_LISTA, hoy: '2026-10-26', conjunto, stock: {}, horizonte: 1, margen: 0 });
  assert.match(antes.sinMenu[0].error, /no tiene ningún periodo/);
  assert.equal(antes.items[0].necesidad, 0);
});

test('lista de la compra con la dieta real y un plan que cubre sus periodos: los fines de semana salen sin menú', () => {
  const plan = { periodos: [{ id: 'volumen_p20_rutina_nov', nombre: 'p20', inicio: '2026-11-02' }], excepciones: [] };
  const conjunto = alimentosDeLaDieta(dietaReal, recetasReales, plan, '2026-11-16', { noSeguidas: configReal.recetas_no_seguidas });
  const l = listaCompra({ dieta: dietaReal, recetas: recetasReales, plan, hoy: '2026-11-16', noSeguidas: configReal.recetas_no_seguidas, conjunto, stock: {}, horizonte: configReal.horizonte_dias, margen: configReal.margen_dias });
  assert.deepEqual(l.sinMenu.map((d) => d.dia), ['sabado', 'domingo']);
  assert.ok(l.items.length > 0 && l.items.every((i) => i.stockDesconocido));
  // los ingredientes que solo estaban en las lentejas caseras no entran en la lista
  assert.equal(l.items.some((i) => ['chorizo', 'morro_cerdo'].includes(i.food_id)), false);
});
