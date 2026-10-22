// Actualizar el documento del dispositivo con el foods.csv publicado (fusión a tres bandas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText, planCatalogUpdate, applyChoices, unirCabeceras, anadidoConIA, eleccionesPorDefecto, elegirAlimento, elegirTodos, eleccionAlimento, cleanRetirados, usoDeRetirados } from '../frontend/js/core/catalog-update.js';
import { parseFoodsCSV } from '../frontend/js/core/foods-parser.js';
import { catalog, csv, readFile } from './helpers.js';

const H = 'id,nombre,alias,porciones,energia_kcal,proteina_g,incluir';
const doc = (...rows) => parseFoodsCSV(csv(H, ...rows), { catalog }).foods;
const plan = (local, remote, base) => planCatalogUpdate({ local, remote, base, catalog });
const de = (foods, id) => foods.find((f) => f.id === id);

test('huella del texto: estable y distinta si cambia algo', () => {
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
  assert.match(hashText(''), /^[0-9a-f]{8}$/);
});

test('con base: lo que solo cambió en lo publicado se actualiza; lo que solo cambiaste tú se conserva', () => {
  const base = doc('arroz,Arroz,arroz,,365,7,si', 'kiwi,Kiwi,kiwi,unidad:69,61,1,no');
  const mio = doc('arroz,Arroz,arroz|arroz largo,,365,7,si', 'kiwi,Kiwi,kiwi,unidad:69,61,1,si'); // alias propio y kiwi activado
  const publicado = doc('arroz,Arroz,arroz,,360,7.1,si', 'kiwi,Kiwi,kiwi,unidad:75,61,1,no', 'pera,Pera,pera,,57,0.4,si');
  const p = plan(mio, publicado, base);
  assert.deepEqual(p.conflictos, []);
  assert.deepEqual(p.nuevos, [{ id: 'pera', nombre: 'Pera' }]);
  assert.deepEqual(p.actualizados.map((a) => [a.id, a.campos]), [['arroz', ['Energía', 'Proteína']], ['kiwi', ['porciones']]]);
  const arroz = de(p.foods, 'arroz');
  assert.deepEqual([arroz.alias, arroz.nutrients.energia_kcal, arroz.nutrients.proteina_g], [['arroz', 'arroz largo'], 360, 7.1]);
  const kiwi = de(p.foods, 'kiwi');
  assert.deepEqual([kiwi.extra.incluir, kiwi.porciones], ['si', [{ nombre: 'unidad', gramos: 75 }]]);
  assert.equal(p.hayCambios, true);
});

test('con base: si los dos cambiaron el mismo campo, es un conflicto; por defecto se queda lo tuyo, y puedes elegir', () => {
  const base = doc('arroz,Arroz,arroz,,365,7,si');
  const mio = doc('arroz,Arroz,arroz|arroz blanco,,365,7,si');
  const publicado = doc('arroz,Arroz,arroz|arroz largo,,365,7,si');
  const p = plan(mio, publicado, base);
  assert.deepEqual(p.conflictos, [{ id: 'arroz', nombre: 'Arroz', campo: 'core:alias', etiqueta: 'alias', mio: 'arroz|arroz blanco', publicado: 'arroz|arroz largo' }]);
  assert.deepEqual(de(p.foods, 'arroz').alias, ['arroz', 'arroz blanco']);
  assert.deepEqual(de(applyChoices(p, publicado, { 'arroz|core:alias': 'publicado' }), 'arroz').alias, ['arroz', 'arroz largo']);
  assert.deepEqual(de(applyChoices(p, publicado, { 'arroz|core:alias': 'mio' }), 'arroz').alias, ['arroz', 'arroz blanco']);
});

test('nunca se borra un alimento: los que ya no están publicados se mantienen; sin cambios, nada que hacer', () => {
  const base = doc('arroz,Arroz,arroz,,365,7,si', 'ron,Ron,ron,,231,0,no');
  const publicado = doc('arroz,Arroz,arroz,,365,7,si');
  const p = plan(base, publicado, base);
  assert.deepEqual(p.retirados, [{ id: 'ron', nombre: 'Ron' }]);
  assert.ok(de(p.foods, 'ron'));
  assert.equal(p.hayCambios, false);
  assert.equal(plan(publicado, publicado, publicado).hayCambios, false);
});

test('sin base (instalación anterior): todo viene de lo publicado salvo un alimento que activaste y ahora está excluido', () => {
  const mio = doc('arroz,Arroz,arroz,,365,7,si', 'merluza_cocida,Merluza cocida,merluza,,116,23,si', 'mayonesa,Mayonesa,mayonesa,,680,1,no');
  const publicado = doc('arroz,Arroz,arroz|arroz largo,,360,7,si', 'merluza_cocida,Merluza cocida,merluza,,116,23,no', 'mayonesa,Mayonesa,mayonesa|mahonesa,,680,1,si');
  const p = plan(mio, publicado, null);
  assert.deepEqual(p.conflictos.map((c) => [c.id, c.campo, c.mio, c.publicado]), [['merluza_cocida', 'extra:incluir', 'si', 'no']]);
  assert.deepEqual(de(p.foods, 'arroz').alias, ['arroz', 'arroz largo']);
  assert.equal(de(p.foods, 'arroz').nutrients.energia_kcal, 360);
  assert.equal(de(p.foods, 'mayonesa').extra.incluir, 'si'); // activar desde lo publicado no es conflicto
  assert.equal(de(applyChoices(p, publicado, { 'merluza_cocida|extra:incluir': 'publicado' }), 'merluza_cocida').extra.incluir, 'no');
});

test('documento real: actualizar del catálogo de antes (64) al de ahora sin base no pierde nada ni da conflictos', () => {
  const ahora = parseFoodsCSV(readFile('../data/foods.csv'), { catalog }).foods;
  const antes = ahora.filter((f) => !['brocoli', 'champinon'].includes(f.id)).map((f) => ({ ...f, alias: f.alias.slice(0, 1), nutrients: {}, extra: { ...f.extra } }));
  const p = plan(antes, ahora, null);
  assert.equal(p.foods.length, ahora.length);
  assert.deepEqual(p.nuevos.map((n) => n.id).sort(), ['brocoli', 'champinon']);
  assert.deepEqual(p.conflictos, []);
  assert.deepEqual(applyChoices(p, ahora).map((f) => f.nutrients), ahora.map((f) => f.nutrients));
  assert.deepEqual(unirCabeceras(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
});

// ---------- Elegir todo un alimento, todos, y los añadidos con IA ----------
const HX = 'id,nombre,alias,energia_kcal,proteina_g,tipo,pendiente_revisar';
const docX = (...rows) => parseFoodsCSV(csv(HX, ...rows), { catalog }).foods;
const fix = (f) => parseFoodsCSV(readFile(`./fixtures/${f}`), { catalog }).foods;

test('conflictos agrupados por alimento: cuántos campos tiene cada uno y si lo añadiste con IA', () => {
  const base = docX('arroz,Arroz,arroz,365,7,,', 'pasta,Pasta,pasta,350,12,,');
  const mio = docX('arroz,Arroz,arroz|blanco,360,7,,', 'pasta,Pasta,pasta,340,11,usda_app,si');
  const pub = docX('arroz,Arroz,arroz|largo,350,7,,', 'pasta,Pasta,pasta,355,13,,');
  const p = plan(mio, pub, base);
  assert.deepEqual(p.alimentosConflicto, [
    { id: 'arroz', nombre: 'Arroz', campos: 2, anadidoConIA: false },
    { id: 'pasta', nombre: 'Pasta', campos: 2, anadidoConIA: true },
  ]);
  assert.equal(anadidoConIA(mio[1]), true);
  assert.equal(anadidoConIA(mio[0]), false);
  assert.equal(anadidoConIA(docX('x,X,x,1,1,,si')[0]), true); // pendiente_revisar=si sin tipo
});

test('valor por defecto: «mío» en todo, salvo los alimentos añadidos con IA, que llegan como lo publicado', () => {
  const base = docX('arroz,Arroz,arroz,365,7,,', 'pasta,Pasta,pasta,350,12,,');
  const mio = docX('arroz,Arroz,arroz|blanco,360,7,,', 'pasta,Pasta,pasta,340,11,usda_app,si');
  const pub = docX('arroz,Arroz,arroz|largo,350,7,,', 'pasta,Pasta,pasta,355,13,,');
  const p = plan(mio, pub, base);
  const def = eleccionesPorDefecto(p);
  assert.deepEqual(Object.keys(def).sort(), p.conflictos.filter((c) => c.id === 'pasta').map((c) => `pasta|${c.campo}`).sort());
  assert.ok(Object.keys(def).length >= 2);
  const foods = applyChoices(p, pub, def);
  assert.equal(de(foods, 'pasta').nutrients.energia_kcal, 355); // IA -> publicado
  assert.deepEqual(de(foods, 'arroz').alias, ['arroz', 'blanco']); // normal -> mío
  assert.equal(de(foods, 'arroz').nutrients.energia_kcal, 360);
});

test('elegir todo un alimento, todos, y la marca de cada alimento', () => {
  const base = docX('arroz,Arroz,arroz,365,7,,', 'pasta,Pasta,pasta,350,12,,');
  const mio = docX('arroz,Arroz,arroz|blanco,360,8,,', 'pasta,Pasta,pasta,340,11,,');
  const pub = docX('arroz,Arroz,arroz|largo,350,9,,', 'pasta,Pasta,pasta,355,13,,');
  const p = plan(mio, pub, base);
  assert.deepEqual(eleccionesPorDefecto(p), {});
  assert.equal(eleccionAlimento(p, {}, 'arroz'), 'mio');
  const uno = elegirAlimento(p, {}, 'arroz', 'publicado');
  assert.equal(eleccionAlimento(p, uno, 'arroz'), 'publicado');
  assert.equal(eleccionAlimento(p, uno, 'pasta'), 'mio'); // el otro alimento no cambia
  const foods = applyChoices(p, pub, uno);
  assert.deepEqual([de(foods, 'arroz').alias, de(foods, 'arroz').nutrients.proteina_g, de(foods, 'pasta').nutrients.energia_kcal], [['arroz', 'largo'], 9, 340]);
  const mixto = { ...uno, 'arroz|nutriente:proteina_g': 'mio' };
  assert.equal(eleccionAlimento(p, mixto, 'arroz'), 'mixto');
  assert.equal(eleccionAlimento(p, elegirAlimento(p, mixto, 'arroz', 'mio'), 'arroz'), 'mio');
  assert.deepEqual(uno, { 'arroz|core:alias': 'publicado', 'arroz|nutriente:energia_kcal': 'publicado', 'arroz|nutriente:proteina_g': 'publicado' });
  const todos = elegirTodos(p, {}, 'publicado');
  const f2 = applyChoices(p, pub, todos);
  assert.deepEqual(f2.map((f) => [f.alias, f.nutrients.energia_kcal, f.nutrients.proteina_g]), pub.map((f) => [f.alias, f.nutrients.energia_kcal, f.nutrients.proteina_g]));
  assert.equal(eleccionAlimento(p, elegirTodos(p, todos, 'mio'), 'pasta'), 'mio');
  assert.deepEqual(elegirTodos(p, {}, 'mio') && applyChoices(p, pub, elegirTodos(p, {}, 'mio')).map((f) => f.nutrients.energia_kcal), [360, 340]);
});

test('export real de Victor: sus 4 alimentos de Estimar con IA ya publicados con etiqueta salen con muchos conflictos y se resuelven de una vez', () => {
  const mio = fix('actualizar_local_ia.csv');
  const pub = fix('actualizar_publicado_ia.csv');
  assert.equal(mio.length, 4);
  assert.ok(mio.every(anadidoConIA));
  const base = docX('arroz,Arroz,arroz,365,7,,'); // la base anterior no tenía esos ids
  const p = plan(mio, pub, base);
  assert.deepEqual(p.alimentosConflicto.map((a) => a.id).sort(), ['anacardos', 'bebida_de_avena', 'cafe_expreso', 'salchichon']);
  assert.equal(p.conflictos.length, 96);
  assert.deepEqual(p.alimentosConflicto.map((a) => [a.id, a.campos]), [['salchichon', 31], ['bebida_de_avena', 40], ['cafe_expreso', 6], ['anacardos', 19]]);
  assert.ok(p.alimentosConflicto.every((a) => a.anadidoConIA && a.campos > 0));
  assert.equal(p.alimentosConflicto.reduce((n, a) => n + a.campos, 0), p.conflictos.length);
  // Por defecto (IA) ya se queda lo publicado: no hay que pulsar nada.
  const foods = applyChoices(p, pub, eleccionesPorDefecto(p));
  for (const r of pub) {
    const f = de(foods, r.id);
    assert.deepEqual(f.nutrients, r.nutrients, r.id);
    assert.deepEqual(f.alias, r.alias, r.id);
  }
  // Y mantener lo mío en un alimento sigue siendo posible.
  const mantener = elegirAlimento(p, eleccionesPorDefecto(p), 'salchichon', 'mio');
  assert.deepEqual(de(applyChoices(p, pub, mantener), 'salchichon').nutrients, de(mio, 'salchichon').nutrients);
});

// ---------- Alimentos retirados (data/retirados.json): la única excepción a «nunca se borra un alimento» ----------
const RET = [{ id: 'ron', fecha: '2026-10-23', motivo: 'sin datos, no se usa' }, { id: 'coca', fecha: '2026-10-23', motivo: 'sin datos, no se usa' }, { id: 'ya_no_esta', fecha: '2026-10-23', motivo: 'ya borrado' }];

test('retirados: se borran los que están en el dispositivo y no en lo publicado, aunque los hubieras cambiado; los demás no', () => {
  const base = doc('arroz,Arroz,arroz,,365,7,si', 'ron,Ron,ron,,,,no', 'coca,Coca-Cola,coca,,,,no', 'chorizo,Chorizo,chorizo,,322,20,si', 'viejo,Viejo,viejo,,10,1,si');
  const mio = doc('arroz,Arroz,arroz,,365,7,si', 'ron,Ron,ron|ron añejo,,,,si', 'coca,Coca-Cola,coca,,,,no', 'chorizo,Chorizo,chorizo,,322,20,si', 'viejo,Viejo,viejo,,10,1,si', 'puntual,Puntual,puntual,,50,1,no');
  const publicado = doc('arroz,Arroz,arroz,,365,7,si', 'chorizo,Chorizo,chorizo,,322,20,si');
  const p = planCatalogUpdate({ local: mio, remote: publicado, base, catalog, retirados: RET });
  assert.deepEqual(p.eliminados, [{ id: 'ron', nombre: 'Ron' }, { id: 'coca', nombre: 'Coca-Cola' }]);
  assert.deepEqual(p.foods.map((f) => f.id), ['arroz', 'chorizo', 'viejo', 'puntual']);
  assert.equal(p.hayCambios, true); // aunque no cambie nada más
  assert.deepEqual([p.nuevos, p.actualizados, p.conflictos], [[], [], []]);
  // «ya no publicado» (se mantiene) no se mezcla con «retirado» (se borra)
  assert.deepEqual([p.retirados.map((r) => r.id), p.propios.map((r) => r.id)], [['viejo'], ['puntual']]);
  assert.deepEqual(applyChoices(p, publicado).map((f) => f.id), ['arroz', 'chorizo', 'viejo', 'puntual']);
});

test('retirados: uno que lo publicado sí trae no se borra nunca; uno ya ausente no hace nada; sin lista, como antes', () => {
  const mio = doc('arroz,Arroz,arroz,,365,7,si', 'ron,Ron,ron,,,,no');
  const publicado = doc('arroz,Arroz,arroz,,365,7,si', 'ron,Ron,ron,,,,no');
  const p = planCatalogUpdate({ local: mio, remote: publicado, base: mio, catalog, retirados: RET });
  assert.deepEqual(p.eliminados, []); // publicado lo trae: se queda
  assert.ok(de(p.foods, 'ron'));
  assert.equal(p.hayCambios, false);
  // 'ya_no_esta' y 'coca' no están en el dispositivo: nada que borrar
  const sinRon = doc('arroz,Arroz,arroz,,365,7,si');
  const q = planCatalogUpdate({ local: sinRon, remote: sinRon, base: sinRon, catalog, retirados: RET });
  assert.deepEqual([q.eliminados, q.hayCambios, q.foods.length], [[], false, 1]);
  // sin retirados (o con formatos raros), el comportamiento de siempre: no se borra nada
  for (const r of [undefined, null, [], 'basura', { retirados: 7 }, [null, 3, {}, { id: '' }]]) {
    const z = planCatalogUpdate({ local: mio, remote: sinRon, base: mio, catalog, retirados: r });
    assert.deepEqual([z.eliminados, z.retirados.map((x) => x.id), z.hayCambios, z.foods.length], [[], ['ron'], false, 2], String(r));
  }
  // un retirado que se hubiera quedado en un conflicto no lo deja: no se pregunta por lo que se va a borrar
  const base = doc('ron,Ron,ron,,,,no', 'arroz,Arroz,arroz,,365,7,si');
  const local = doc('ron,Ron,ron|a,,,,no', 'arroz,Arroz,arroz,,365,7,si');
  const remoto = doc('ron,Ron,ron|b,,,,no', 'arroz,Arroz,arroz,,365,7,si');
  assert.equal(planCatalogUpdate({ local, remote: remoto, base, catalog, retirados: RET }).conflictos.length, 1); // publicado lo trae: conflicto normal
});

test('cleanRetirados: acepta { version, retirados } o una lista, ignora lo inválido y los repetidos', () => {
  assert.deepEqual(cleanRetirados({ version: 1, retirados: [{ id: 'a', fecha: '2026-10-23', motivo: 'm' }, { id: ' b ' }, { id: 'a' }, null, { id: 5 }, 'c'] }),
    [{ id: 'a', fecha: '2026-10-23', motivo: 'm' }, { id: 'b', fecha: '', motivo: '' }, { id: 'c', fecha: '', motivo: '' }]);
  assert.deepEqual(cleanRetirados(['x', 'y']).map((r) => r.id), ['x', 'y']);
  for (const v of [undefined, null, 4, 'a', {}, { retirados: {} }]) assert.deepEqual(cleanRetirados(v), [], String(v));
  // el fichero real: 11 ids únicos con fecha y motivo
  const real = cleanRetirados(JSON.parse(readFile('../data/retirados.json')));
  assert.equal(real.length, 11);
  assert.ok(real.every((r) => /^[a-z0-9_]+$/.test(r.id) && /^\d{4}-\d\d-\d\d$/.test(r.fecha) && r.motivo));
  // y ninguno sigue en el catálogo publicado
  const publicado = new Set(parseFoodsCSV(readFile('../data/foods.csv'), { catalog }).foods.map((f) => f.id));
  assert.ok(real.every((r) => !publicado.has(r.id)));
});

test('usoDeRetirados: cuenta las líneas del diario y nombra las recetas que usan un retirado, sin tocar nada', () => {
  const eliminados = [{ id: 'ron', nombre: 'Ron' }, { id: 'coca', nombre: 'Coca-Cola' }];
  const meals = [{ lines: [{ food_id: 'arroz' }, { food_id: 'coca' }] }, { lines: [{ food_id: 'ron' }, { food_id: 'coca' }] }, { lines: [{ food_id: 'arroz' }] }, { lines: [] }, {}];
  const recetas = [{ id: 'r1', nombre: 'R1', ingredientes: [{ food_id: 'arroz' }, { food_id: 'ron' }, { food_id: 'ron' }] }, { id: 'r2', nombre: 'R2', ingredientes: [{ food_id: 'arroz' }] }, { id: 'r3', ingredientes: [{ food_id: 'coca' }, { food_id: 'ron' }] }];
  const u = usoDeRetirados({ eliminados, meals, recetas });
  assert.deepEqual(u, { lineas: 3, comidas: 2, recetas: [{ id: 'r1', nombre: 'R1', ingredientes: ['Ron'] }, { id: 'r3', nombre: 'r3', ingredientes: ['Coca-Cola', 'Ron'] }] });
  assert.deepEqual(usoDeRetirados({}), { lineas: 0, comidas: 0, recetas: [] });
  assert.deepEqual(usoDeRetirados({ eliminados, meals: [{ lines: [{ food_id: 'arroz' }] }] }), { lineas: 0, comidas: 0, recetas: [] });
});

test('export real de Victor (22-10-2026): al actualizar desaparecen los 11 retirados y lo demás queda igual', () => {
  const retirados = JSON.parse(readFile('../data/retirados.json'));
  const ids = retirados.retirados.map((r) => r.id);
  const exportado = parseFoodsCSV(readFile('./fixtures/export_iphone_2026-10-22.csv'), { catalog }).foods; // con ; y coma decimal
  const publicado = parseFoodsCSV(readFile('../data/foods.csv'), { catalog }).foods;
  assert.equal(exportado.length, 80);
  assert.ok(ids.every((id) => de(exportado, id)), 'el dispositivo de Victor tiene los 11');
  for (const [nombre, base] of [['sin base', null], ['con base = lo que copió', exportado]]) {
    const p = planCatalogUpdate({ local: exportado, remote: publicado, base, catalog, retirados });
    assert.deepEqual(p.eliminados.map((e) => e.id).sort(), [...ids].sort(), nombre);
    assert.deepEqual(p.conflictos, [], nombre);
    const final = applyChoices(p, publicado, {});
    const porId = new Map(final.map((f) => [f.id, f]));
    assert.ok(ids.every((id) => !porId.has(id)), nombre); // los 11 desaparecen
    // todo lo que tenía sigue (salvo los 11); lo que trae lo publicado, con lo publicado
    const restantes = exportado.filter((f) => !ids.includes(f.id));
    assert.equal(restantes.length, 69, nombre);
    assert.ok(restantes.every((f) => porId.has(f.id)), nombre);
    assert.equal(final.length, restantes.length + p.nuevos.length, nombre); // y nada más desaparece ni se duplica
    for (const f of publicado) assert.deepEqual(porId.get(f.id).nutrients, f.nutrients, `${nombre}: ${f.id}`);
    // lo que el dispositivo tiene y lo publicado no (los tres «recetas de un ingrediente» del iPhone) queda tal cual
    for (const id of ['salchichon_2', 'bebida_de_avena_2', 'cafe_solo_expreso']) assert.deepEqual(porId.get(id), de(exportado, id), `${nombre}: ${id}`);
    // y los alimentos que no cambian entre el dispositivo y lo publicado quedan exactamente igual
    const sinCambios = restantes.filter((f) => !p.actualizados.some((a) => a.id === f.id) && de(publicado, f.id));
    assert.ok(sinCambios.length > 20, nombre);
    for (const f of sinCambios) assert.deepEqual(porId.get(f.id), f, `${nombre}: ${f.id}`);
  }
});

test('retirados: un alimento con un id retirado que creaste después en la app (Estimar con IA, receta) no se borra', () => {
  const base = docX('arroz,Arroz,arroz,365,7,,');
  const publicado = docX('arroz,Arroz,arroz,365,7,,');
  const mio = docX('arroz,Arroz,arroz,365,7,,', 'ron,Ron casero,ron,230,0,usda_app,si', 'coca,Mi receta de cola,cola,40,0,receta,');
  // con base: lo que la base no tenía es tuyo (propios) y no se elimina
  const p = planCatalogUpdate({ local: mio, remote: publicado, base, catalog, retirados: RET });
  assert.deepEqual(p.eliminados, []);
  assert.deepEqual(p.propios.map((x) => x.id), ['ron', 'coca']);
  assert.deepEqual(p.foods.map((f) => f.id), ['arroz', 'ron', 'coca']);
  assert.equal(p.hayCambios, false);
  // sin base, ante la duda no se borra lo creado en la app (tipo usda_app o receta)
  const q = planCatalogUpdate({ local: mio, remote: publicado, base: null, catalog, retirados: RET });
  assert.deepEqual(q.eliminados, []);
  assert.deepEqual(q.foods.map((f) => f.id), ['arroz', 'ron', 'coca']);
  // pero el mismo id, cuando venía de lo publicado (la base lo tenía), sí se borra
  const baseConRon = docX('arroz,Arroz,arroz,365,7,,', 'ron,Ron,ron,,,,', 'coca,Coca-Cola,coca,,,,');
  const viejo = docX('arroz,Arroz,arroz,365,7,,', 'ron,Ron,ron,,,,', 'coca,Coca-Cola,coca,,,,');
  assert.deepEqual(planCatalogUpdate({ local: viejo, remote: publicado, base: baseConRon, catalog, retirados: RET }).eliminados.map((x) => x.id), ['ron', 'coca']);
  assert.deepEqual(planCatalogUpdate({ local: viejo, remote: publicado, base: null, catalog, retirados: RET }).eliminados.map((x) => x.id), ['ron', 'coca']);
});
