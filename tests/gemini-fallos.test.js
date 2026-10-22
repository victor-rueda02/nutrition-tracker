// Regresiones de los tres fallos que destapó Gemini real (CLAUDE.md, sección 6, puntos 1-3).
// Las respuestas del modelo son SIMULADAS: se prueba la capa determinista, no la calidad del modelo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVolumen, toCompact, UMBRAL_GRAMOS_SIN_UNIDAD, cantidadDicha } from '../frontend/js/core/ai-contract.js';
import { normalizeAiResponse, stripNameStates } from '../frontend/js/core/ai-validate.js';
import { createDraft, mlToGrams, resolveUnmatched, lineProblem, gramsFromText, gramosAsumidos, validateDraft, setGrams, confirmFood, changeFood, toMealRecord } from '../frontend/js/core/draft.js';
import { parseFoodsCSV, foodsToCSV, foodsToJSON } from '../frontend/js/core/foods-parser.js';
import { normalizeText, removeTerms } from '../frontend/js/core/text.js';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA } from '../worker/src/prompt.js';
import { realFoods, realList, rulesList, catalog, csv } from './helpers.js';

const line = (food_id, source_text, o = {}) => ({ food_id, cantidad: 100, unidad: 'g', source_text, confidence: 'alta', estado_dicho: 'ninguno', ...o });
const run = (items, list = realList, unmatched = []) => normalizeAiResponse({ items, unmatched }, list);
const one = (item, list) => run([item], list).items[0];
const byId = new Map(realFoods.map((f) => [f.id, f]));
const draftOf = (items) => createDraft({ meal: 'comida', result: run(items), foodsById: byId });

// ---------- 1. "tomate frito": la palabra de estado es parte del nombre ----------
test('tomate frito: "frito" es parte del alias, no un estado (aunque el modelo diga cocinado)', () => {
  for (const [text, estado_dicho] of [['70 g de tomate frito', 'cocinado'], ['70 g de tomate frito', 'ninguno'], ['70 g de tomates fritos', 'cocinado']]) {
    const r = run([line('salsa_tomate_frito', text, { cantidad: 70, estado_dicho })]);
    assert.equal(r.items[0].food_id, 'salsa_tomate_frito', text);
    assert.equal(r.items[0].confidence, 'alta', text);
    assert.deepEqual(r.items[0].flags, [], text);
    assert.equal(r.items[0].requiresConfirmation, false, text);
    assert.deepEqual(r.warnings, [], text);
  }
});

test('pollo frito: "frito" sí es estado cuando no forma parte del nombre', () => {
  const list = [{ id: 'pollo_crudo', nombre: 'Pollo crudo', alias: ['pollo'], estado: 'crudo', grupo: 'pollo', defecto: true },
    { id: 'pollo_cocinado', nombre: 'Pollo cocinado', alias: ['pollo'], estado: 'cocinado', grupo: 'pollo', defecto: false }];
  const r = one(line('pollo_crudo', '200 g de pollo frito', { estado_dicho: 'cocinado' }), list);
  assert.equal(r.food_id, 'pollo_cocinado');
  assert.equal(r.confidence, 'alta');
  // En la copia congelada del documento (merluza con variante cocinada, sin peso_en_crudo).
  const p = run([line('merluza_cruda', '200 g de merluza frita', { estado_dicho: 'cocinado' })], rulesList);
  assert.equal(p.items[0].food_id, 'merluza_cocida'); // merluza sí tiene variante cocinada
  const k = run([line('kiwi_verde', 'un kiwi frito', { cantidad: 69, estado_dicho: 'cocinado' })]);
  assert.equal(k.items[0].confidence, 'baja');
  assert.ok(k.items[0].flags.includes('variante_no_disponible'));
});

test('el estado del propio alimento en su alias sí cuenta ("pistachos crudos", "merluza cruda")', () => {
  const c = one(line('pistachos_crudos', '30 g de pistachos crudos', { estado_dicho: 'crudo' }));
  assert.equal(c.food_id, 'pistachos_crudos');
  assert.equal(c.confidence, 'alta');
  const m = one(line('merluza_cruda', '200 g de merluza cruda', { estado_dicho: 'crudo' }));
  assert.equal(m.food_id, 'merluza_cruda');
  assert.equal(m.confidence, 'alta'); // dijo el estado: no se baja
  assert.equal(stripNameStates('pistachos crudos', byId.get('pistachos_crudos')).states.size, 0);
  assert.deepEqual([...stripNameStates('tomate frito', toCompact(byId.get('salsa_tomate_frito'))).states], ['cocinado']);
});

// ---------- 2. Cortes y especies ----------
test('documento: pechuga de pollo nueva; "pollo", "pavo" y "pechuga" a secas no identifican a ningún alimento', () => {
  const p = byId.get('pechuga_pollo_cruda');
  assert.deepEqual([p.nombre, p.alias, p.estado, p.grupo, p.varianteDefecto], ['Pechuga de pollo sin piel cruda', ['pechuga de pollo', 'filete de pollo'], 'crudo', 'pechuga_pollo', true]);
  assert.equal(p.extra.termino_busqueda_usda, 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw');
  assert.deepEqual(byId.get('muslo_pollo_con_piel').alias, ['muslo de pollo', 'contramuslo', 'jamoncito de pollo']);
  assert.deepEqual(byId.get('pechuga_pavo_cruda').alias, ['pechuga de pavo']);
  const terms = new Set(realList.flatMap((f) => [f.nombre, ...(f.alias ?? [])]).map(normalizeText));
  for (const generic of ['pollo', 'pavo', 'pechuga']) assert.ok(!terms.has(generic), generic);
});

test('prompt: regla de cortes y especies, nombre que no es estado, y volumen en ml', () => {
  for (const s of ['CORTES Y ESPECIES', '"pechuga de pollo" es la pechuga de pollo', '("pollo", "pavo", "pechuga")', 'motivo "ambiguo"', 'Nunca aproximes', 'tomate frito', 'NUNCA conviertas un volumen a gramos']) {
    assert.ok(SYSTEM_PROMPT.includes(s), s);
  }
  const item = RESPONSE_SCHEMA.properties.items.items;
  assert.deepEqual(item.properties.unidad.enum, ['g', 'ml']);
  assert.ok(item.required.includes('cantidad') && item.required.includes('unidad'));
});

// ---------- 3. Mililitros ----------
test('detectVolumen', () => {
  for (const t of ['5 ml de aceite', '200 mililitros de leche', '2 cl', 'medio litro de leche', '0,5 l de leche', '1l']) assert.equal(detectVolumen(t), true, t);
  for (const t of ['5 g de aceite', 'un vaso de leche', '1 lata de atún', 'lentejas', '']) assert.equal(detectVolumen(t), false, t);
});

test('densidad_g_ml: se lee, se valida y se exporta; no viaja a la IA', () => {
  assert.equal(byId.get('aceite_oliva').densidad, 0.91);
  assert.equal(byId.get('leche_entera').densidad, 1.03);
  assert.equal(byId.get('kiwi_verde').densidad, null);
  assert.ok(!JSON.stringify(realList).includes('densidad'));
  assert.ok(!JSON.stringify(realList).includes('0.91'));

  const es = parseFoodsCSV('id;nombre;densidad_g_ml\na;A;0,91\nb;B;\n', { catalog }); // Excel en español
  assert.deepEqual(es.foods.map((f) => f.densidad), [0.91, null]);
  assert.deepEqual(es.report.warnings, []);

  const bad = parseFoodsCSV(csv('id,nombre,densidad_g_ml', 'a,A,mucha', 'b,B,0', 'c,C,910'), { catalog });
  assert.equal(bad.report.ok, true); // un aviso, no un error: el alimento se importa
  assert.deepEqual(bad.foods.map((f) => f.densidad), [null, null, 910]);
  assert.equal(bad.report.warnings.filter((w) => w.field === 'densidad_g_ml').length, 3);

  const again = parseFoodsCSV(foodsToCSV(es.foods, { catalog }), { catalog });
  assert.deepEqual(again.foods.map((f) => f.densidad), [0.91, null]);
  assert.deepEqual(JSON.parse(foodsToJSON(es.foods)).foods.map((f) => f.densidad_g_ml), [0.91, null]);
});

test('worker: un volumen viaja como ml, sin convertir; gramos con un volumen en el texto -> revisar', () => {
  const r = one(line('aceite_oliva', '5 ml de aceite', { cantidad: 5, unidad: 'ml' }));
  assert.equal(r.grams, null);
  assert.equal(r.ml, 5);
  assert.equal(r.confidence, 'alta');
  // el fallo original: el modelo devolvía "5 ml" como 5 g
  const g = one(line('aceite_oliva', '5 ml de aceite', { cantidad: 5, unidad: 'g' }));
  assert.equal(g.grams, 5);
  assert.ok(g.flags.includes('unidad_discrepante'));
  assert.equal(g.requiresConfirmation, true);
  const sinUnidad = one(line('aceite_oliva', 'una cucharada de aceite', { cantidad: 13.5, unidad: undefined }));
  assert.deepEqual([sinUnidad.grams, sinUnidad.ml], [13.5, undefined]);
});

test('app: ml -> g con la densidad del documento; sin densidad -> no reconocido "sin_densidad"', () => {
  assert.equal(mlToGrams(5, 0.91), 4.55);
  const d = draftOf([
    line('aceite_oliva', '5 ml de aceite', { cantidad: 5, unidad: 'ml' }),
    line('leche_entera', '200 ml de leche', { cantidad: 200, unidad: 'ml' }),
    line('kiwi_verde', '100 ml de kiwi', { cantidad: 100, unidad: 'ml' }),
    line('avena_copos', '80 g de avena', { cantidad: 80 }),
  ]);
  assert.deepEqual(d.lines.map((l) => [l.food_id, l.grams]), [['aceite_oliva', 4.55], ['leche_entera', 206], ['avena_copos', 80]]);
  assert.ok(d.lines[0].flags.includes('convertido_ml'));
  assert.ok(!d.lines[2].flags.includes('convertido_ml'));
  assert.deepEqual(d.unmatched, [{ text: '100 ml de kiwi', motivo: 'sin_densidad', food_id: 'kiwi_verde' }]);
  // se resuelve como cualquier otro no reconocido: línea sin gramos para teclearlos
  const r = resolveUnmatched(d, 0, 'kiwi_verde');
  assert.deepEqual([r.lines.at(-1).food_id, r.lines.at(-1).grams], ['kiwi_verde', null]);
});

test('app: más de 2000 g tras convertir ml exige confirmación', () => {
  const d = draftOf([line('leche_entera', '2 litros de leche', { cantidad: 2000, unidad: 'ml' })]);
  assert.equal(d.lines[0].grams, 2060);
  assert.equal(lineProblem(d.lines[0]), 'gramos_altos');
});

// ---------- Frase 3 con Gemini real: "150 g de pechuga" acabó en pechuga de pollo con confianza alta ----------
test('lo dicho no nombra al alimento elegido: confianza baja, aviso "no coincide con tus alias" y confirmación', () => {
  const r = run([line('pechuga_pollo_cruda', '150 g de pechuga', { cantidad: 150 })]);
  assert.equal(r.items[0].food_id, 'pechuga_pollo_cruda');
  assert.equal(r.items[0].confidence, 'baja');
  assert.ok(r.items[0].flags.includes('sin_alias'));
  assert.equal(r.items[0].requiresConfirmation, true);
  assert.deepEqual(r.warnings, ['pechuga_pollo_cruda: "150 g de pechuga" no coincide con tus alias']);
});

test('coincidencia con nombre o alias: sin acentos, sin mayúsculas, con plurales y con variantes del grupo', () => {
  const ok = [
    ['pechuga_pollo_cruda', '200 G DE PECHUGAS DE POLLO'],
    ['salsa_tomate_frito', '70 g de tomates fritos'],
    ['jamon_curado', '30 g de jamon serrano'],
    ['pistachos_crudos', '30 g de pistachos'], // "pistachos" es alias de otra variante del grupo
    ['merluza_cocida', '200 g de merluza'],
    ['pasta_seca', '125 g de macarrón'],
    ['pasta_seca', '125 g de macarrones'],
    ['huevo', '2 huevos'],
    ['leche_entera', '2500 g de leche entera'],
  ];
  for (const [id, text] of ok) assert.ok(!one(line(id, text), rulesList).flags.includes('sin_alias'), text);
  for (const [id, text] of [['muslo_pollo_con_piel', '180 g de pollo'], ['pechuga_pavo_cruda', '100 g de pavo'], ['kiwi_verde', '100 g de una fruta']]) {
    assert.ok(one(line(id, text)).flags.includes('sin_alias'), text);
  }
});

test('prompt: "pechuga" a secas es ambiguo y los no reconocidos llevan su cantidad', () => {
  for (const s of ['"Pechuga" a secas SIEMPRE es ambiguo', '"150 g de pechuga"', 'nunca solo "pollo"']) assert.ok(SYSTEM_PROMPT.includes(s), s);
});

test('gramos del texto de un no reconocido: se rellenan al elegir el alimento', () => {
  const aceite = byId.get('aceite_oliva');
  assert.equal(gramsFromText('180 g de pollo'), 180);
  assert.equal(gramsFromText('180 gramos de pollo'), 180);
  assert.equal(gramsFromText('0,5 kg de arroz'), 500);
  assert.equal(gramsFromText('20 ml de aceite', aceite), 18.2);
  assert.equal(gramsFromText('20 ml de tomate frito', byId.get('salsa_tomate_frito')), null); // sin densidad
  for (const t of ['un puñado de pistachos', '100 g de pavo y 50 g de pollo', 'pollo', '']) assert.equal(gramsFromText(t), null, t);
  const d = createDraft({ meal: 'comida', result: { items: [], unmatched: [{ text: '180 g de pollo', motivo: 'ambiguo' }], warnings: [] }, foodsById: byId });
  const r = resolveUnmatched(d, 0, 'pechuga_pollo_cruda', null, byId.get('pechuga_pollo_cruda'));
  assert.deepEqual([r.lines[0].food_id, r.lines[0].grams, r.lines[0].source_text], ['pechuga_pollo_cruda', 180, '180 g de pollo']);
  assert.equal(resolveUnmatched(d, 0, 'pechuga_pollo_cruda', 200).lines[0].grams, 200); // los gramos dados mandan
});

// ---------- peso_en_crudo: "a la plancha" dice cómo lo cociné, no cómo lo pesé ----------
test('peso_en_crudo: pechuga de pollo a la plancha se queda en cruda, confianza alta y sin avisos', () => {
  for (const estado_dicho of ['cocinado', 'ninguno']) {
    const r = run([line('pechuga_pollo_cruda', '200 g de pechuga de pollo a la plancha', { cantidad: 200, estado_dicho })]);
    assert.deepEqual([r.items[0].food_id, r.items[0].grams, r.items[0].confidence], ['pechuga_pollo_cruda', 200, 'alta'], estado_dicho);
    assert.deepEqual(r.items[0].flags, []);
    assert.equal(r.items[0].requiresConfirmation, false);
    assert.deepEqual(r.warnings, []);
  }
});

test('sin peso_en_crudo, el arroz cocido sigue avisando', () => {
  const r = run([line('arroz_blanco_crudo', '150 g de arroz cocido', { cantidad: 150, estado_dicho: 'cocinado' })], rulesList); // copia congelada: arroz sin peso_en_crudo
  assert.equal(r.items[0].confidence, 'baja');
  assert.ok(r.items[0].flags.includes('variante_no_disponible'));
  assert.equal(r.warnings.length, 1);
});

test('peso_en_crudo con variante cocinada en el grupo: se queda en la fila marcada', () => {
  const list = [{ id: 'a_crudo', nombre: 'A', estado: 'crudo', grupo: 'a', defecto: true, peso_en_crudo: true },
    { id: 'a_cocido', nombre: 'A', estado: 'cocinado', grupo: 'a', defecto: false }];
  const r = one(line('a_crudo', '100 g de a al horno', { estado_dicho: 'cocinado' }), list);
  assert.deepEqual([r.food_id, r.confidence, r.flags], ['a_crudo', 'alta', []]);
});

test('peso_en_crudo: columna si/no (vacío = no), se exporta y solo viaja a la IA si está marcado', () => {
  assert.equal(byId.get('pechuga_pollo_cruda').pesoEnCrudo, true);
  const marcados = new Set(realFoods.filter((f) => f.pesoEnCrudo).map((f) => f.id));
  assert.equal(marcados.size, 22);
  for (const f of realList) assert.equal('peso_en_crudo' in f, marcados.has(f.id), f.id);
  assert.ok(realList.filter((f) => marcados.has(f.id)).every((f) => f.peso_en_crudo === true));

  const r = parseFoodsCSV(csv('id,nombre,peso_en_crudo', 'a,A,si', 'b,B,no', 'c,C,', 'd,D,quizá'), { catalog });
  assert.deepEqual(r.foods.map((f) => f.pesoEnCrudo), [true, false, false, false]);
  assert.equal(r.report.warnings.filter((w) => w.field === 'peso_en_crudo').length, 1);
  assert.deepEqual(parseFoodsCSV(foodsToCSV(r.foods, { catalog }), { catalog }).foods.map((f) => f.pesoEnCrudo), [true, false, false, false]);
  assert.deepEqual(JSON.parse(foodsToJSON(r.foods)).foods.map((f) => f.peso_en_crudo), [true, false, false, false]);
});

// Una línea "no coincide con tus alias" no se guarda sin un gesto explícito (ni por defecto).
test('sin_alias: la línea no se puede guardar hasta confirmar el alimento o cambiarlo; editar gramos no basta', () => {
  const d = draftOf([line('pechuga_pollo_cruda', '150 g de pechuga', { cantidad: 150 }), line('kiwi_verde', 'un kiwi', { cantidad: 69 })]);
  const [l1, l2] = d.lines;
  assert.deepEqual([l1.needsReview, l2.needsReview], [true, false]);
  assert.deepEqual(validateDraft(d).problems, [{ key: l1.key, code: 'sin_revisar' }]);
  assert.throws(() => toMealRecord(d));
  assert.equal(validateDraft(setGrams(d, l1.key, '160')).ok, false);
  assert.equal(validateDraft(confirmFood(d, l1.key)).ok, true);
  const cambiado = changeFood(d, l1.key, 'pechuga_pavo_cruda');
  assert.equal(validateDraft(cambiado).ok, true);
  assert.equal(cambiado.lines[0].grams, 150);
});

// ---------- Cantidades sin unidad de peso ni volumen (reales: "1 manzana" se guardó como 1 g; "150 de arroz") ----------
// Menos de UMBRAL_GRAMOS_SIN_UNIDAD (20) son unidades: porción o "sin porción". Desde 20, gramos asumidos con aviso.
const asumido = (r) => r.items[0]?.flags.includes('gramos_asumidos');

test('umbral en una constante (20) y en el prompt', () => {
  assert.equal(UMBRAL_GRAMOS_SIN_UNIDAD, 20);
  assert.ok(SYSTEM_PROMPT.includes('menor que 20') && SYSTEM_PROMPT.includes('de 20 o más'));
  assert.ok(SYSTEM_PROMPT.includes('"1 manzana"') && SYSTEM_PROMPT.includes('"150 de arroz"'));
});

test('"150 de arroz" -> 150 g con el aviso "asumido en gramos" (no bloquea el guardado)', () => {
  for (const [cantidad, unidad] of [[150, 'g'], [1, 'g'], [150, 'ml']]) { // lo que diga el modelo, cuenta lo dicho
    const r = run([line('arroz_blanco_crudo', '150 de arroz', { cantidad, unidad })]);
    assert.deepEqual(r.items.map((x) => [x.food_id, x.grams, x.ml]), [['arroz_blanco_crudo', 150, undefined]], `${cantidad} ${unidad}`);
    assert.ok(asumido(r));
    assert.equal(r.items[0].confidence, 'alta');
    assert.equal(r.items[0].requiresConfirmation, false);
    assert.match(r.warnings[0], /no dice la unidad: se asumen 150 g/);
  }
  const d = createDraft({ meal: 'comida', result: run([line('arroz_blanco_crudo', '150 de arroz', { cantidad: 150 })]), foodsById: byId });
  assert.equal(validateDraft(d).ok, true); // se puede guardar tal cual
  assert.ok(d.lines[0].flags.includes('gramos_asumidos'));
});

test('"25 de almendras" -> 25 g con aviso; 20 es el límite; "19 de nueces" son unidades', () => {
  const r = run([line('almendras_crudas', '25 de almendras', { cantidad: 25 })]);
  assert.deepEqual([r.items[0].grams, asumido(r)], [25, true]);
  assert.ok(asumido(run([line('nueces', '20 de nueces', { cantidad: 20 })])));
  assert.equal(run([line('nueces', '19 de nueces', { cantidad: 19 })]).unmatched[0].motivo, 'sin_porcion');
  assert.ok(asumido(run([line('arroz_blanco_crudo', '150,5 de arroz', { cantidad: 150.5 })])));
});

test('"1 manzana" -> "sin porción" (la manzana no tiene porción); no se rellenan gramos que nadie dijo', () => {
  for (const [cantidad, unidad] of [[1, 'g'], [120, 'g'], [1, 'ml']]) {
    const r = run([line('manzana_con_piel', '1 manzana', { cantidad, unidad })]);
    assert.deepEqual(r.items, [], `${cantidad} ${unidad}`);
    assert.deepEqual(r.unmatched, [{ text: '1 manzana', motivo: 'sin_porcion', food_id: 'manzana_con_piel' }]);
    assert.match(r.warnings[0], /no dice gramos/);
  }
  const d = createDraft({ meal: 'comida', result: run([line('manzana_con_piel', '1 manzana', { cantidad: 1 })]), foodsById: byId });
  const l = resolveUnmatched(d, 0, 'manzana_con_piel', null, byId.get('manzana_con_piel')).lines[0];
  assert.deepEqual([l.grams, l.flags], [null, []]);
});

test('"2 huevos" -> 100 g (2 × porción de 54 g); el número dicho manda: 150 g no valen para "2 huevos"', () => {
  const r = run([line('huevo', '2 huevos', { cantidad: 108 })]);
  assert.deepEqual(r.items.map((x) => [x.food_id, x.grams, x.flags]), [['huevo', 108, []]]);
  for (const cantidad of [2, 150, 50]) assert.equal(run([line('huevo', '2 huevos', { cantidad })]).unmatched[0]?.motivo, 'sin_porcion', String(cantidad));
});

test('"un café" -> 30 g (porción taza de 30 g del café expreso)', () => {
  const r = run([line('cafe_expreso', 'un café', { cantidad: 30 })]);
  assert.deepEqual(r.items.map((x) => [x.food_id, x.grams]), [['cafe_expreso', 30]]);
});

test('"3 galletas María" -> 16,8 g (3 × porción galleta de 5,6 g, de la etiqueta)', () => {
  const r = run([line('galleta_maria', '3 galletas María', { cantidad: 16.8 })]);
  assert.deepEqual(r.items.map((x) => [x.food_id, x.grams]), [['galleta_maria', 16.8]]);
  assert.equal(run([line('galleta_maria', '3 galletas María', { cantidad: 3 })]).unmatched[0]?.motivo, 'sin_porcion');
});

test('unidades con porción: número en cifras o palabras, y la porción nombrada tiene que ser esa', () => {
  const ok = [['kiwi_verde', 'un kiwi', 69], ['aceite_oliva', 'una cucharada de aceite', 13.5], ['aceite_oliva', 'una cucharadita de aceite', 4.5],
    ['aceite_oliva', 'media cucharadita de aceite', 2.25], ['leche_entera', 'medio vaso de leche', 125], ['leche_entera', 'dos vasos de leche', 500],
    ['yogur_griego_natural', 'un yogur griego', 125], ['zanahoria', 'una zanahoria', 61], ['huevo', 'un huevo', 54], ['huevo', 'un huevo y medio', 81],
    ['huevo', 'media docena de huevos', 324], ['leche_entera', 'vaso de leche', 250]]; // sin número: una porción entera
  for (const [id, text, cantidad] of ok) assert.deepEqual(run([line(id, text, { cantidad })]).items.map((x) => [x.food_id, x.grams]), [[id, cantidad]], text);
  const mal = [['kiwi_verde', 'un kiwi', 100, 'g'], ['aceite_oliva', 'una cucharadita de aceite', 13.5, 'g'], ['leche_entera', 'un vaso de leche', 250, 'ml'],
    ['aceite_oliva', '15 de aceite', 15, 'g']]; // 15 < 20: son unidades, y 15 cucharadas no son 15 g
  for (const [id, text, cantidad, unidad] of mal) assert.equal(run([line(id, text, { cantidad, unidad })]).unmatched[0]?.motivo, 'sin_porcion', text);
});

test('un número del nombre no es una cantidad ("chocolate 85")', () => {
  assert.equal(run([line('chocolate_negro_85', 'chocolate 85', { cantidad: 85 })]).unmatched[0]?.motivo, 'sin_porcion');
  const r = run([line('chocolate_negro_85', '20 de chocolate 85', { cantidad: 20 })]);
  assert.deepEqual([r.items[0].grams, asumido(r)], [20, true]);
  assert.equal(run([line('chocolate_negro_85', '20 g de chocolate 85', { cantidad: 20 })]).items[0].flags.includes('gramos_asumidos'), false);
});

test('cantidadDicha y removeTerms', () => {
  const casos = [['150 de arroz', 150], ['1,5 de algo', 1.5], ['1/2 vaso', 0.5], ['dos huevos', 2], ['un cuarto de vaso', 0.25], ['un par de kiwis', 2],
    ['media docena', 6], ['dos y medio', 2.5], ['medio vaso', 0.5], ['unos pistachos', null], ['leche', null], ['veinte de nueces', 20], ['dieciséis de nueces', 16]];
  for (const [t, n] of casos) assert.equal(cantidadDicha(t), n, t);
  assert.equal(removeTerms('Un huevo y medio', ['huevo']).trim().replace(/\s+/g, ' '), 'un y medio');
  assert.equal(cantidadDicha(removeTerms('Chocolate negro 85% y 20 de chocolate 85', ['Chocolate negro 85%', 'chocolate 85'])), 20);
});

test('al resolver un "sin resolver" como "150 de arroz", también se asumen los gramos (con aviso)', () => {
  const d = createDraft({ meal: 'comida', result: { items: [], unmatched: [{ text: '150 de arroz', motivo: 'sin_porcion', food_id: 'arroz_blanco_crudo' }], warnings: [] }, foodsById: byId });
  const l = resolveUnmatched(d, 0, 'arroz_blanco_crudo', null, byId.get('arroz_blanco_crudo')).lines[0];
  assert.deepEqual([l.grams, l.flags], [150, ['gramos_asumidos']]);
  assert.equal(gramosAsumidos('150 g de arroz'), null); // con unidad, no hay nada que asumir
  assert.equal(gramosAsumidos('3 rebanadas de pan'), null);
});

test('con unidad de peso o volumen dicha, se respetan los gramos aunque no haya porción y sin aviso', () => {
  for (const text of ['150 g de manzana', '150gr de manzana', '150 gramos de manzana', 'medio kilo de manzanas', '0,2 kg de manzana']) {
    const r = run([line('manzana_con_piel', text, { cantidad: 150 })]);
    assert.equal(r.items.length, 1, text);
    assert.equal(asumido(r), false, text);
  }
  assert.equal(run([line('leche_entera', '200 ml de leche', { cantidad: 200, unidad: 'ml' })]).items[0].ml, 200);
});

test('peso_en_crudo: si la IA elige la variante cocinada de un grupo con la cruda marcada, se usa la cruda (sin aviso)', () => {
  const list = [{ id: 'merluza_cruda', nombre: 'Merluza cruda', alias: ['merluza'], estado: 'crudo', grupo: 'merluza', defecto: true, peso_en_crudo: true },
    { id: 'merluza_cocida', nombre: 'Merluza cocida', alias: ['merluza'], estado: 'cocinado', grupo: 'merluza', defecto: false }];
  const r = one(line('merluza_cocida', '200 g de merluza a la plancha', { cantidad: 200, estado_dicho: 'cocinado' }), list);
  assert.deepEqual([r.food_id, r.confidence, r.flags], ['merluza_cruda', 'alta', []]);
  // sin palabras de cocinado se aplica la regla de siempre (variante por defecto)
  assert.equal(one(line('merluza_cocida', '200 g de merluza', { cantidad: 200 }), list).food_id, 'merluza_cruda');
});

test('"pan tostado": sin variante tostada, "tostado" se ignora sin aviso (se pesa antes de tostar)', () => {
  for (const estado_dicho of ['tostado', 'ninguno']) {
    const r = run([line('pan_blanco_barra', '60 g de pan tostado', { cantidad: 60, estado_dicho })]);
    assert.deepEqual([r.items[0].food_id, r.items[0].confidence, r.items[0].flags, r.warnings], ['pan_blanco_barra', 'alta', [], []], estado_dicho);
  }
  // con variante tostada en el grupo, "tostado" sigue eligiéndola
  const t = one(line('pistachos_crudos', '30 g de pistachos tostados', { estado_dicho: 'tostado' }));
  assert.equal(t.food_id, 'pistachos_tostados_sin_sal');
  // y "cocido" sin variante cocinada sigue avisando (salvo peso_en_crudo)
  assert.ok(run([line('kiwi_verde', 'un kiwi cocido', { cantidad: 69, estado_dicho: 'cocinado' })]).items[0].flags.includes('variante_no_disponible'));
});
