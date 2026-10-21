// Decisiones sobre el catálogo real (fixture = copia de data/foods.csv). Las respuestas del modelo son SIMULADAS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiResponse } from '../frontend/js/core/ai-validate.js';
import { normalizeText } from '../frontend/js/core/text.js';
import { realFoods, realList, readFile } from './helpers.js';

const byId = new Map(realFoods.map((f) => [f.id, f]));
const flagsOf = (food_id, source_text) => normalizeAiResponse({
  items: [{ food_id, cantidad: 100, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [],
}, realList).items[0].flags;

test('el fixture es copia exacta de data/foods.csv', () => {
  assert.equal(readFile('./fixtures/alimentos_iniciales.csv'), readFile('../data/foods.csv'));
});

test('alias: frases que antes no casaban con el alimento ahora sí (sin aviso sin_alias)', () => {
  for (const [id, text] of [
    ['nueces', '100 g de nuez'], // plural irregular
    ['muesli', '50 g de musli'],
    ['corn_flakes', '40 g de cornflakes'],
    ['queso_tierno_loncha', '100 g de lonchas de queso'],
    ['merluza_cruda', '200 g de pescadilla'],
    ['pechuga_pollo_cruda', '150 g de filete de pollo'],
    ['arroz_blanco_crudo', '80 g de arroz largo'],
    ['pan_molde_blanco', '40 g de pan bimbo'],
    ['solomillo_ternera', '150 g de solomillo de ternera'],
    ['jamon_curado', '30 g de jamón serrano'],
  ]) assert.ok(!flagsOf(id, text).includes('sin_alias'), text);
});

test('alias: "pan" es pan blanco de barra (no el integral) y "jamón" a secas no es el curado (también como cocido)', () => {
  assert.ok(flagsOf('pan_integral', '60 g de pan').includes('sin_alias'));
  assert.ok(flagsOf('pan_integral', '60 g de barra de pan').includes('sin_alias'));
  assert.ok(!flagsOf('pan_integral', '60 g de pan integral').includes('sin_alias'));
  assert.ok(flagsOf('jamon_curado', '30 g de jamón cocido').includes('sin_alias'));
  for (const [id, text] of [['pan_blanco_barra', '60 g de pan'], ['pan_blanco_barra', '60 g de barra de pan'], ['jamon_cocido', '30 g de jamón cocido'], ['jamon_cocido', '30 g de jamón york']]) {
    assert.ok(!flagsOf(id, text).includes('sin_alias'), text);
  }
  // pan de barra español sin enriquecer: B1, B2, B9 y hierro de BEDCA; B3 sin dato (USDA solo la tiene enriquecida)
  const pan = byId.get('pan_blanco_barra');
  assert.deepEqual(['vitamina_b9_ug', 'vitamina_b1_mg', 'vitamina_b2_mg', 'hierro_mg', 'vitamina_b3_mg'].map((k) => pan.nutrients[k]), [23, 0.08, 0.05, 1.6, undefined]);
  assert.match(pan.extra.fuente_usda, /^BEDCA 2160 /);
  assert.equal(pan.extra.fdc_id, '172675');
  assert.equal(byId.get('jamon_cocido').extra.fdc_id, '168295');
});

test('alias: regla de cortes y especies, sin genéricos de especie o de corte', () => {
  const terms = new Set(realFoods.flatMap((f) => [f.nombre, ...f.alias]).map(normalizeText));
  for (const generic of ['pollo', 'pavo', 'pechuga', 'ternera', 'solomillo', 'jamon']) assert.ok(!terms.has(generic), generic);
  assert.deepEqual(byId.get('solomillo_ternera').alias, ['solomillo de ternera']);
});

test('peso_en_crudo (regla general: lo dictado es peso en crudo): cocinar no cambia la fila ni pide confirmación', () => {
  const r1 = (food_id, source_text) => normalizeAiResponse({ items: [{ food_id, cantidad: 150, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'cocinado' }], unmatched: [] }, realList);
  for (const [id, text] of [['arroz_blanco_crudo', '150 g de arroz cocido'], ['pasta_seca', '150 g de macarrones hervidos'], ['salmon_atlantico', '150 g de salmón al horno'],
    ['merluza_cruda', '150 g de merluza a la plancha'], ['patata_cruda', '150 g de patata asada'], ['huevo', '150 g de huevos fritos'], ['calabacin', '150 g de calabacín a la plancha']]) {
    const r = r1(id, text);
    assert.deepEqual([r.items[0].food_id, r.items[0].confidence, r.items[0].flags, r.warnings.length], [id, 'alta', [], 0], text);
  }
});

test('merluza_cocida y patata_asada: se conservan (diario, elegir a mano) pero no viajan a la IA', () => {
  for (const id of ['merluza_cocida', 'patata_asada']) {
    assert.equal(byId.get(id).extra.incluir, 'no', id);
    assert.ok(!realList.some((f) => f.id === id), id);
  }
  // merluza queda con una sola variante en la lista: sin estado no se baja la confianza
  const r = normalizeAiResponse({ items: [{ food_id: 'merluza_cruda', cantidad: 200, unidad: 'g', source_text: '200 g de merluza', confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [] }, realList);
  assert.deepEqual([r.items[0].food_id, r.items[0].confidence], ['merluza_cruda', 'alta']);
});

test('incluir=no: activados mayonesa (con "mahonesa") y chorizo; el resto de puntuales sigue fuera', () => {
  const c = byId.get('chorizo');
  assert.deepEqual([c.extra.incluir, c.estado, c.extra.termino_busqueda_usda, c.nutrients.energia_kcal, c.nutrients.vitamina_b5_mg], ['si', 'procesado', undefined, 322, undefined]);
  assert.match(c.extra.fuente_usda, /^BEDCA 2264/); // chorizo español: BEDCA, huecos de USDA; sin término para que usda.mjs no lo pise
  const m = byId.get('mayonesa');
  assert.deepEqual([m.extra.incluir, m.estado, m.extra.fdc_id], ['si', 'procesado', '171009']);
  assert.ok(!flagsOf('mayonesa', '15 g de mahonesa').includes('sin_alias'));
  for (const id of ['coca_cola', 'tinto_verano', 'ron', 'lengua_cerdo', 'salsa_cerdo_lata', 'salchicha_desayuno_cerdo', 'yogur_griego_vainilla', 'queso_monterey_jack']) {
    assert.equal(byId.get(id).extra.incluir, 'no', id);
  }
});

test('recetas: filas cocinadas que se dictan en gramos de plato sin aviso ("verduras asadas" no pide variante)', () => {
  for (const [id, text, estado_dicho] of [['verduras_asadas_hacendado', '200 g de verduras asadas', 'cocinado'], ['verduras_asadas_hacendado', '200 g de verduras asadas', 'ninguno'], ['parrillada_verduras_hacendado', '250 g de parrillada de verduras', 'ninguno']]) {
    const r = normalizeAiResponse({ items: [{ food_id: id, cantidad: 200, unidad: 'g', source_text: text, confidence: 'alta', estado_dicho }], unmatched: [] }, realList);
    assert.deepEqual([r.items[0].food_id, r.items[0].confidence, r.items[0].flags], [id, 'alta', []], `${text} (${estado_dicho})`);
  }
});

test('chocolate negro 85: la vitamina D (D2 del cacao) no es un 0 falso; viene de CIQUAL 31074', () => {
  const c = byId.get('chocolate_negro_85');
  assert.equal(c.nutrients.vitamina_d_ug, 2.16);
  assert.equal(c.nutrients.vitamina_b9_ug, 52);
  assert.match(c.extra.fuente_usda, /vitamina_d_ug = 2\.16.*CIQUAL 31074/);
});

test('corn flakes: etiqueta de Hacendado 0 % azúcar; la fortificación de EE. UU. no declarada queda sin dato', () => {
  const c = byId.get('corn_flakes').nutrients;
  assert.deepEqual([c.energia_kcal, c.proteina_g, c.hidratos_g, c.azucares_g, c.fibra_g, c.sodio_mg], [373, 6.7, 82, 0.9, 4.4, 600]); // sodio = sal 1,5 g ÷ 2,5
  assert.deepEqual([c.vitamina_b1_mg, c.vitamina_b9_ug, c.vitamina_b12_ug, c.hierro_mg], [0.3, 282.2, 2.1, 7]); // B9 en DFE = 1,7 × 166 µg de ácido fólico
  for (const k of ['vitamina_a_ug', 'vitamina_c_mg', 'vitamina_d_ug']) assert.equal(c[k], undefined, k);
  assert.equal(c.potasio_mg, 107); // natural del maíz: de USDA
  assert.equal(byId.get('corn_flakes').extra.termino_busqueda_usda, undefined); // usda.mjs no la vuelve a rellenar
});

test('tarea 6: BEDCA para alimentos españoles, sin fdcId en eleccion.csv para que usda.mjs no los pise', () => {
  const eleccion = readFile('../usda/eleccion.csv');
  for (const [id, bedca] of [['merluza_cruda', 2347], ['jamon_curado', 2273], ['pan_blanco_barra', 2160], ['galleta_maria', 2675], ['brocoli', 1177], ['champinon', 2384]]) {
    const f = byId.get(id);
    assert.match(f.extra.fuente_usda, new RegExp(`(^|· )BEDCA ${bedca} `), id); // la merluza: macros de su etiqueta, micros de BEDCA
    assert.equal(f.extra.termino_busqueda_usda, undefined, id);
    assert.match(eleccion, new RegExp(`(^|\n)${id};[^;]*;;;`), id); // sin fdcId elegido
  }
  assert.match(eleccion, /(^|\n)corn_flakes;[^;]*;;;/); // etiqueta: igual
  for (const id of ['brocoli', 'champinon']) assert.equal(byId.get(id).pesoEnCrudo, true, id);
  assert.ok(!flagsOf('champinon', '50 g de champiñones laminados').includes('sin_alias'));
  assert.ok(!flagsOf('brocoli', '150 g de brécol').includes('sin_alias'));
  // EPA y DHA = 0 en vegetales (criterio de Victor): la chía queda completa
  for (const id of ['semillas_chia', 'pimiento_amarillo']) assert.deepEqual([byId.get(id).nutrients.epa_g, byId.get(id).nutrients.dha_g], [0, 0], id);
  // atún: escurrido y con sal (el aceite se dicta aparte)
  assert.equal(byId.get('atun_lata_aceite').extra.fdc_id, '173708');
});

test('merluza: macros de la etiqueta de Victor (merluza del Cabo), micros de BEDCA', () => {
  const m = byId.get('merluza_cruda');
  assert.deepEqual(['energia_kcal', 'proteina_g', 'grasa_total_g', 'grasas_saturadas_g', 'sodio_mg', 'hidratos_g'].map((k) => m.nutrients[k]), [82, 18, 1.2, 0.3, 96, 0]);
  assert.ok(m.nutrients.agua_g + m.nutrients.proteina_g + m.nutrients.grasa_total_g <= 100); // agua coherente con la etiqueta
  assert.match(m.extra.fuente_usda, /^Etiqueta de la merluza/);
});

test('lentejas caseras: receta cocinada, "lentejas" a secas es la receta y no choca con las lentejas secas', () => {
  const r = byId.get('lentejas_caseras');
  assert.deepEqual([r.estado, r.pesoEnCrudo, r.extra.incluir, r.varianteDefecto, r.grupo], ['cocinado', false, 'si', true, 'lentejas_caseras']);
  assert.deepEqual(r.alias, ['lentejas', 'lentejas caseras', 'lentejas con chorizo', 'lentejas guisadas']);
  assert.match(r.extra.notas, /^Gramos del plato cocinado\. Proporciones estimadas; sustituir por pesos reales cuando los pese/);
  assert.ok(!r.alias.some((a) => ['lentejas secas', 'lentejas crudas'].includes(a)));
  const s = byId.get('lentejas_secas');
  assert.deepEqual([s.estado, s.pesoEnCrudo, s.extra.incluir, s.grupo], ['crudo', true, 'si', 'lentejas_secas']);
  assert.ok(!flagsOf('lentejas_caseras', '300 g de lentejas con chorizo').includes('sin_alias'));
  assert.ok(!flagsOf('lentejas_secas', '80 g de lentejas secas').includes('sin_alias'));
  // ingrediente solo para la receta: fuera de la lista que va a la IA
  assert.equal(byId.get('morro_cerdo').extra.incluir, 'no');
  assert.ok(!realList.some((f) => f.id === 'morro_cerdo'));
  assert.equal(byId.get('morro_cerdo').extra.fdc_id, '167857'); // oreja de cerdo: ni BEDCA ni USDA tienen morro
});

test('lata de atún con aceite: receta de 80 g (60 g de atún + 20 g de aceite), "una lata de atún" = la porción; "atún" y "atún en lata" siguen siendo el atún escurrido', () => {
  const r = byId.get('atun_lata_con_aceite');
  assert.deepEqual([r.estado, r.pesoEnCrudo, r.extra.incluir, r.varianteDefecto, r.extra.rol_cena, r.extra.tipo], ['cocinado', false, 'si', true, 'proteina', 'receta']);
  assert.deepEqual(r.porciones, [{ nombre: 'lata', gramos: 80 }]);
  assert.deepEqual(r.alias, ['lata de atún']);
  const t = byId.get('atun_lata_aceite');
  for (const k of ['energia_kcal', 'proteina_g', 'grasa_total_g']) {
    assert.ok(Math.abs(r.nutrients[k] - (t.nutrients[k] * 60 + byId.get('aceite_oliva').nutrients[k] * 20) / 80) < 0.01, k);
  }
  const lata = normalizeAiResponse({ items: [{ food_id: 'atun_lata_con_aceite', cantidad: 80, unidad: 'g', source_text: 'una lata de atún', confidence: 'alta', estado_dicho: 'ninguno' }], unmatched: [] }, realList);
  assert.deepEqual([lata.items[0].food_id, lata.items[0].grams, lata.items[0].flags, lata.unmatched.length], ['atun_lata_con_aceite', 80, [], 0]);
  assert.ok(!flagsOf('atun_lata_aceite', '80 g de atún en lata').includes('sin_alias'));
  assert.ok(!flagsOf('atun_lata_aceite', '80 g de atún').includes('sin_alias'));
  assert.ok(flagsOf('atun_lata_con_aceite', '80 g de atún en lata').includes('sin_alias'));
  assert.ok(flagsOf('atun_lata_con_aceite', '80 g de atún').includes('sin_alias'));
});

test('salteados Hacendado: «salteado de verduras» = el normal; «salteado de verduras asadas» = las asadas (sin bajar la confianza; «asadas» no es estado); etiqueta fijada', () => {
  const n = byId.get('salteado_verduras_hacendado');
  const a = byId.get('verduras_asadas_hacendado');
  for (const f of [n, a]) {
    assert.deepEqual([f.estado, f.pesoEnCrudo, f.extra.incluir, f.varianteDefecto, f.extra.rol_cena], ['cocinado', false, 'si', true, 'verdura'], f.id);
  }
  assert.notEqual(n.grupo, a.grupo);
  assert.deepEqual(n.alias, ['salteado de verduras']);
  assert.deepEqual(a.alias, ['salteado de verduras asadas', 'verduras asadas']);
  // lo que declara la etiqueta (por 100 g; sodio = sal / 2,5)
  const ks = ['energia_kcal', 'grasa_total_g', 'grasas_saturadas_g', 'hidratos_g', 'azucares_g', 'fibra_g', 'proteina_g', 'sodio_mg'];
  assert.deepEqual(ks.map((k) => n.nutrients[k]), [31, 0.3, 0.1, 3.8, 3, 2.3, 2, 8]);
  assert.deepEqual(ks.map((k) => a.nutrients[k]), [46, 0.1, 0, 8, 6.6, 2.9, 1.8, 12]);
  assert.match(n.extra.fuente_usda, /etiqueta Hacendado/);
  assert.match(a.extra.fuente_usda, /etiqueta Hacendado/);
  const r = (food_id, source_text, estado_dicho = 'ninguno') => normalizeAiResponse({ items: [{ food_id, cantidad: 200, unidad: 'g', source_text, confidence: 'alta', estado_dicho }], unmatched: [] }, realList);
  for (const [id, texto, estado] of [
    ['salteado_verduras_hacendado', '200 g de salteado de verduras', 'ninguno'],
    ['verduras_asadas_hacendado', '200 g de salteado de verduras asadas', 'ninguno'],
    ['verduras_asadas_hacendado', '200 g de salteado de verduras asadas', 'cocinado'], // el modelo toma «asadas» por estado
    ['verduras_asadas_hacendado', '200 g de verduras asadas', 'cocinado'],
  ]) {
    const it = r(id, texto, estado).items[0];
    assert.deepEqual([it.food_id, it.confidence, it.flags], [id, 'alta', []], `${texto} (${estado})`);
  }
  // si la IA eligiera el normal con «asadas», lo dicho contiene su alias: no hay aviso (límite conocido, ver notas)
  assert.deepEqual(r('salteado_verduras_hacendado', '200 g de salteado de verduras asadas').items[0].flags, []);
});
