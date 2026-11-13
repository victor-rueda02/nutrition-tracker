// Tabla de productos de Mercadona (data/tickets-mercadona.json) y columna porcion_comestible de foods.csv.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realFoods, readFile } from './helpers.js';

const tabla = JSON.parse(readFile('../data/tickets-mercadona.json'));
const byId = new Map(realFoods.map((f) => [f.id, f]));
const normaliza = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const entradas = Object.entries(tabla.productos);

test('tickets-mercadona.json: versión 1, productos y claves normalizadas', () => {
  assert.equal(tabla.version, 1);
  assert.ok(entradas.length > 0);
  for (const [clave, p] of entradas) {
    assert.equal(clave, normaliza(clave), `clave sin normalizar: ${clave}`);
    assert.equal(typeof p.descripcion, 'string', clave);
    assert.equal(normaliza(p.descripcion), clave, `la clave no sale de la descripción: ${clave}`);
  }
});

test('tickets-mercadona.json: ignorar con motivo; el resto con food_id existente y una sola forma de cantidad', () => {
  const formas = (p) => [
    p.unidades_por_envase !== undefined || p.nombre_envase !== undefined || p.gramos_por_unidad !== undefined,
    p.a_peso === true,
    p.preguntar_gramos === true,
  ].filter(Boolean).length;
  for (const [clave, p] of entradas) {
    if (p.ignorar) {
      assert.equal(p.ignorar, true, clave);
      assert.ok(typeof p.motivo === 'string' && p.motivo.length > 3, `falta motivo: ${clave}`);
      assert.equal(p.food_id, undefined, `un ignorado no lleva food_id: ${clave}`);
      assert.equal(formas(p), 0, clave);
      continue;
    }
    assert.ok(byId.has(p.food_id), `food_id inexistente en ${clave}: ${p.food_id}`);
    assert.equal(formas(p), 1, `debe tener exactamente una forma de cantidad: ${clave}`);
    if (p.unidades_por_envase !== undefined) {
      assert.ok(Number.isInteger(p.unidades_por_envase) && p.unidades_por_envase > 0, clave);
      assert.ok(p.gramos_por_unidad === null || (typeof p.gramos_por_unidad === 'number' && p.gramos_por_unidad > 0), clave);
      assert.ok(typeof p.nombre_envase === 'string' && p.nombre_envase, clave);
      assert.match(p.fuente || '', /^https:\/\/tienda\.mercadona\.es\/.+consultado el \d\d-\d\d-\d{4}/, `fuente con URL y fecha: ${clave}`);
    }
    if (p.estimado) assert.ok(p.confirmar, `un valor estimado se marca para confirmar: ${clave}`);
  }
});

test('tickets-mercadona.json: las correspondencias confirmadas por Victor están (y el tomate frito casero)', () => {
  const esperado = {
    'arroz largo': 'arroz_blanco_crudo', 'avena molida': 'avena_copos', macarron: 'pasta_seca', 'lenteja pardina': 'lentejas_secas',
    'copos de maiz 0%': 'corn_flakes', 'muesli crunchy 0%': 'muesli', 'bebida avena': 'bebida_de_avena', 'porciones 85% cacao': 'chocolate_negro_85',
    chia: 'semillas_chia', 'almendra natural': 'almendras_crudas', 'nuez cascara natural': 'nueces', 'datil sin hueso': 'datiles_deglet_noor',
    'roja dulce bolsa': 'manzana_con_piel', 'roja acidulce bolsa': 'manzana_con_piel', mandarina: 'mandarina', patata: 'patata_cruda',
    'filete pechuga fino': 'pechuga_pollo_cruda', 'pechuga familiar': 'pechuga_pollo_cruda', 'filete salmon': 'salmon_atlantico',
    'atun claro oliva pk6': 'atun_lata_aceite', 'sardinilla re. sal o': 'sardina_lata_reducida_sal', '12 huevos super gran': 'huevo',
    '6 huevos grandes-l': 'huevo', 'cebolla tubo': 'cebolla', 'barra 100% integral': 'pan_integral',
    'salteado verd. asada': 'verduras_asadas_hacendado', 'salteado de verduras': 'salteado_verduras_hacendado', 'tom.frito est.casero': 'salsa_tomate_frito',
  };
  for (const [k, id] of Object.entries(esperado)) assert.equal(tabla.productos[k]?.food_id, id, k);
  for (const k of ['lenteja cocida', 'muesli con frutas', 'griego natural p-6', 'tom. receta artesana', 'tomate frito brick', 't.cherry pera negro',
    'parrillada verdura a', 'pim piq tradicional', 'patata prefreg. fina', 'salmon con verduras', 'leche semi', 'leche etera gaza pa']) {
    assert.equal(tabla.productos[k]?.ignorar, true, k);
  }
});

test('tickets-mercadona.json: tamaños coherentes con el catálogo (latas escurridas, bebida con su densidad, huevos con cáscara)', () => {
  const p = tabla.productos;
  assert.deepEqual([p['atun claro oliva pk6'].unidades_por_envase, p['atun claro oliva pk6'].gramos_por_unidad], [6, 60]);
  assert.deepEqual([p['sardinilla re. sal o'].unidades_por_envase, p['sardinilla re. sal o'].gramos_por_unidad], [2, 65]);
  assert.equal(p['bebida avena'].gramos_por_unidad, Math.round(1000 * byId.get('bebida_de_avena').densidad));
  assert.equal(p['12 huevos super gran'].unidades_por_envase, 12);
  assert.equal(p['6 huevos grandes-l'].unidades_por_envase, 6);
  assert.ok(p['12 huevos super gran'].gramos_por_unidad > p['6 huevos grandes-l'].gramos_por_unidad);
  assert.ok(p['12 huevos super gran'].estimado && p['6 huevos grandes-l'].estimado);
});

test('porcion_comestible: vacía o en (0, 1], con su fuente en fuente_usda; huevo 0,88 y nueces con cáscara', () => {
  let con = 0;
  for (const f of realFoods) {
    const v = f.extra.porcion_comestible;
    if (v === undefined || v === '') continue;
    const x = Number(v);
    assert.ok(x > 0 && x <= 1, `${f.id}: ${v}`);
    assert.match(f.extra.fuente_usda || '', /porcion_comestible = [\d,]+: /, `${f.id}: falta la fuente`);
    con++;
  }
  assert.ok(con >= 30);
  assert.equal(Number(byId.get('huevo').extra.porcion_comestible), 0.88);
  assert.equal(Number(byId.get('nueces').extra.porcion_comestible), 0.45);
  assert.match(byId.get('nueces').extra.fuente_usda, /con cáscara/i);
});

test('el fixture alimentos_iniciales.csv sigue siendo copia de foods.csv y conserva todas las columnas', () => {
  assert.equal(readFile('./fixtures/alimentos_iniciales.csv'), readFile('../data/foods.csv'));
  assert.ok(readFile('../data/foods.csv').split('\n')[0].includes('porcion_comestible'));
});
