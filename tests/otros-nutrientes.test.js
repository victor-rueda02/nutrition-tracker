// Encargo U: todos los nutrientes del catálogo en el informe diario, con el mismo formato de fila. Referencias nuevas de
// targets.json (aminoácidos esenciales de la OMS por kg de peso, cafeína de la EFSA y grasas trans de la OMS) que no son
// objetivos del plan ni UL. Lógica pura (diaryReport, targetsForDate, agrupación); la UI, en otros-nutrientes-ui.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargets } from '../frontend/js/core/targets.js';
import { targetsForDate, planDeReferencia, validatePlan } from '../frontend/js/core/targets-plan.js';
import { diaryReport, sinReferencia } from '../frontend/js/core/diary.js';
import { gruposInforme, filasAlimento, GRUPOS_DETALLE, rangoNutriente } from '../frontend/js/core/detalle.js';
import { columnasVacias } from '../frontend/js/core/nutrients.js';
import { proponerCenas } from '../frontend/js/core/cenas.js';
import { avisoParciales } from '../frontend/js/core/parciales.js';
import { catalog, settings, readFile, realFoods } from './helpers.js';

const raw = JSON.parse(readFile('../data/targets.json'));
const info = JSON.parse(readFile('../data/nutrientes-info.json')).nutrientes;
const { targets, warnings } = loadTargets(raw, catalog);
const ctx = { targets, catalog };
const FECHA = '2026-10-20';
const plan = (extra = {}) => ({ tipo: 'plan_objetivos', version: 1, periodos: [{ id: 'p', nombre: 'P', inicio: '2026-01-01', ...extra }], excepciones: [] });
const CON_PESO = plan({ peso_kg: 75 });
const SIN_PESO = plan();
const en = (p, fecha = FECHA) => targetsForDate(fecha, { plan: p, ...ctx });
const get = (list, clave) => list.find((t) => t.clave === clave);
const meal = (id, lines) => ({ id, date: FECHA, meal: 'comida', createdAt: `${FECHA}T10:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams, source_text: '' })) });
const food = (id, nutrients) => ({ id, nombre: id, nutrients, porciones: [], extra: {} });
const mapa = (...foods) => new Map(foods.map((f) => [f.id, f]));
const redondea = (x) => Math.round(x * 1e6) / 1e6;

const AMINOS = { triptofano_g: 4, treonina_g: 15, isoleucina_g: 20, leucina_g: 39, lisina_g: 30, valina_g: 26, histidina_g: 10 }; // mg/kg/día, OMS 935 tabla 23
const SUMAS = { metionina_cistina: [['metionina_g', 'cistina_g'], 15], fenilalanina_tirosina: [['fenilalanina_g', 'tirosina_g'], 25] };

// ---------- targets.json ----------
test('targets.json: sin avisos; aminoácidos de la OMS (mg/kg convertidos a g/kg), cafeína y trans, cada uno con su fuente y sin UL', () => {
  assert.deepEqual(warnings, []);
  for (const [k, mg] of Object.entries(AMINOS)) {
    const t = get(targets.list, k);
    assert.equal(redondea(t.porKg * 1000), mg, k);
    assert.deepEqual([t.tipo, t.soloReferencia, t.ul, t.valor], ['min', true, null, null], k);
    assert.match(t.fuente, /OMS\/FAO\/UNU, informe técnico 935 \(2007\), tabla 23/, k);
  }
  for (const [k, [partes, mg]] of Object.entries(SUMAS)) {
    const t = get(targets.list, k);
    assert.deepEqual(t.suma, partes);
    assert.equal(redondea(t.porKg * 1000), mg, k);
    assert.equal(t.unit, 'g', k);
    assert.ok(t.soloReferencia);
  }
  const cafeina = get(targets.list, 'cafeina_mg');
  assert.deepEqual([cafeina.tipo, cafeina.valor, cafeina.ul, cafeina.soloReferencia], ['max', 400, null, true]);
  assert.match(cafeina.fuente, /EFSA 2015/);
  const trans = get(targets.list, 'grasas_trans_g');
  assert.deepEqual([trans.tipo, trans.pctEnergia, trans.ul, trans.soloReferencia], ['max', 1, null, true]);
  assert.match(trans.fuente, /OMS/);
  // los UL siguen siendo los de siempre: ninguna referencia nueva es un UL
  assert.deepEqual(targets.list.filter((t) => t.ul !== null).map((t) => t.clave).sort(),
    ['calcio_mg', 'cobre_mg', 'selenio_ug', 'vitamina_a_ug', 'vitamina_b6_mg', 'vitamina_b9_ug', 'vitamina_d_ug', 'vitamina_e_mg', 'zinc_mg']);
});

test('las cifras de targets.json coinciden con las de data/nutrientes-info.json', () => {
  const mgkg = (k) => info[k].necesidades.match(/(\d+) mg\/kg/g).map((x) => Number(x.split(' ')[0]));
  for (const [k, mg] of Object.entries(AMINOS)) assert.ok(mgkg(k).includes(mg), `${k}: ${mg} mg/kg en la información`);
  assert.ok(mgkg('metionina_g').includes(15) && mgkg('cistina_g').includes(15), 'metionina + cisteína: 15 mg/kg');
  assert.ok(mgkg('fenilalanina_g').includes(25) && mgkg('tirosina_g').includes(25), 'fenilalanina + tirosina: 25 mg/kg');
  assert.match(info.cafeina_mg.necesidades, /hasta 400 mg al día/);
  assert.match(info.grasas_trans_g.necesidades, /menos del 1 % de la energía/);
  assert.doesNotMatch(info.grasas_trans_g.necesidades, /no tiene objetivo/); // ahora la app usa ese 1 % como máximo de referencia
});

// ---------- targetsForDate ----------
test('con 75 kg en el plan: leucina 39 mg/kg × 75 = 2,925 g; las sumas y el resto, por kg', () => {
  const r = en(CON_PESO);
  const leu = get(r.list, 'leucina_g');
  assert.deepEqual([leu.min, leu.objetivo, leu.max, leu.tipo, leu.origen, leu.faltaPeso, leu.soloReferencia], [2.925, null, null, 'min', 'referencia', false, true]);
  assert.equal(get(r.list, 'triptofano_g').min, 0.3);
  assert.equal(get(r.list, 'metionina_cistina').min, 1.125);
  assert.equal(get(r.list, 'fenilalanina_tirosina').min, 1.875);
});

test('sin peso en el plan (o sin plan): sin referencia por kg y se dice que falta el peso', () => {
  for (const p of [SIN_PESO, null]) {
    const leu = get(en(p).list, 'leucina_g');
    assert.deepEqual([leu.min, leu.valor, leu.tipo, leu.faltaPeso], [null, null, null, true]);
    assert.equal(sinReferencia(leu), true);
  }
});

test('grasas trans: 1 % de la energía objetivo del día ÷ 9; cafeína: máximo de 400 mg', () => {
  assert.equal(get(en(null).list, 'grasas_trans_g').max, 2.22); // 2000 kcal: 20 kcal ÷ 9
  const p = plan({ valores: { energia_kcal: { objetivo: 2700 } } });
  const trans = get(en(p).list, 'grasas_trans_g');
  assert.deepEqual([trans.max, trans.tipo, trans.faltaPeso], [3, 'max', false]);
  const cafeina = get(en(null).list, 'cafeina_mg');
  assert.deepEqual([cafeina.max, cafeina.tipo, cafeina.ul], [400, 'max', null]);
});

test('no tocan tu plan: «Crear plan» no las escribe y, si tu plan define el nutriente, manda el plan (y ya no es solo referencia)', () => {
  const creado = planDeReferencia({ fecha: '2026-10-18', perfil: 'hombre', ...ctx });
  const claves = Object.keys(creado.periodos[0].valores);
  for (const k of [...Object.keys(AMINOS), ...Object.keys(SUMAS), 'cafeina_mg', 'grasas_trans_g']) assert.ok(!claves.includes(k), k);
  assert.deepEqual(validatePlan(creado, ctx).errors, []);
  const propio = plan({ peso_kg: 75, valores: { cafeina_mg: { max: 300 }, leucina_g: { min: 3 } } });
  const r = en(propio);
  assert.deepEqual([get(r.list, 'cafeina_mg').max, get(r.list, 'cafeina_mg').origen, get(r.list, 'cafeina_mg').soloReferencia], [300, 'periodo', false]);
  assert.deepEqual([get(r.list, 'leucina_g').min, get(r.list, 'leucina_g').soloReferencia], [3, false]);
  assert.equal(get(r.list, 'treonina_g').soloReferencia, true);
});

// ---------- diaryReport ----------
const A = food('a', { energia_kcal: 100, leucina_g: 1.6, metionina_g: 0.4, cistina_g: 0.2, grasas_trans_g: 0.5, cafeina_mg: 150, almidon_g: 12, agua_g: 0 });
const B = food('b', { energia_kcal: 50, leucina_g: null }); // sin dato de los aminoácidos
const fila = (rep, clave) => rep.otros.find((o) => o.clave === clave);

test('informe: aminoácido con su estado frente al mínimo de la OMS (75 kg), suma de aminoácidos y «parcial»', () => {
  const objetivos = en(CON_PESO).list;
  let rep = diaryReport([meal('m', [['a', 200]])], mapa(A, B), objetivos, catalog);
  let leu = fila(rep, 'leucina_g');
  assert.deepEqual([redondea(leu.total), leu.min, leu.estado, leu.parcial, leu.group], [3.2, 2.925, 'cumplido', false, 'aminoácidos']);
  assert.equal(redondea(leu.pct), redondea(3.2 / 2.925));
  // 150 g: 2,4 g < 2,925 g
  rep = diaryReport([meal('m', [['a', 150]])], mapa(A, B), objetivos, catalog);
  assert.equal(fila(rep, 'leucina_g').estado, 'por_debajo');
  // con un alimento sin dato de leucina: parcial, y el total sigue siendo el de los que lo tienen (nunca suma 0)
  rep = diaryReport([meal('m', [['a', 200], ['b', 100]])], mapa(A, B), objetivos, catalog);
  leu = fila(rep, 'leucina_g');
  assert.deepEqual([redondea(leu.total), leu.parcial, leu.missing], [3.2, true, ['b']]);
  // la suma: metionina 0,8 + cistina 0,4 = 1,2 g frente a 15 mg/kg × 75 = 1,125 g; va justo detrás de la cistina
  const suma = fila(rep, 'metionina_cistina');
  assert.deepEqual([redondea(suma.total), suma.min, suma.estado, suma.label, suma.group], [1.2, 1.125, 'cumplido', 'Metionina + cistina', 'aminoácidos']);
  const orden = rep.otros.map((o) => o.clave);
  assert.equal(orden.indexOf('metionina_cistina'), orden.indexOf('cistina_g') + 1);
  // fenilalanina y tirosina sin dato: la suma queda sin dato, no 0
  const ft = fila(rep, 'fenilalanina_tirosina');
  assert.deepEqual([ft.total, ft.estado, ft.min], [null, 'sin_dato', 1.875]);
});

test('informe: grasas trans en % de las kcal y cafeína por encima de 400 mg', () => {
  const objetivos = en(null).list; // 2000 kcal: trans como mucho 2,22 g
  let rep = diaryReport([meal('m', [['a', 300]])], mapa(A), objetivos, catalog); // 1,5 g de trans y 450 mg de cafeína
  const trans = fila(rep, 'grasas_trans_g');
  assert.deepEqual([redondea(trans.total), trans.max, trans.estado], [1.5, 2.22, 'dentro']);
  const cafeina = fila(rep, 'cafeina_mg');
  assert.deepEqual([cafeina.total, cafeina.max, cafeina.estado, cafeina.superaUl], [450, 400, 'excedido', false]); // máximo de referencia, no UL
  rep = diaryReport([meal('m', [['a', 500]])], mapa(A), objetivos, catalog); // 2,5 g de trans
  assert.equal(fila(rep, 'grasas_trans_g').estado, 'excedido');
  assert.deepEqual(rep.avisosUl, []);
});

test('informe: sin peso, el aminoácido enseña su valor sin referencia; sin objetivo (almidón, agua) también; 0 escrito es 0 y sin dato es null', () => {
  const rep = diaryReport([meal('m', [['a', 100]])], mapa(A, food('vino', { alcohol_g: 10 })), en(SIN_PESO).list, catalog);
  const leu = fila(rep, 'leucina_g');
  assert.deepEqual([leu.total, leu.estado, leu.pct, leu.faltaPeso], [1.6, 'sin_objetivo', null, true]);
  const almidon = fila(rep, 'almidon_g');
  assert.deepEqual([almidon.total, almidon.estado, almidon.pct, almidon.faltaPeso ?? false], [12, 'sin_objetivo', null, false]);
  assert.equal(fila(rep, 'agua_g').total, 0);
  assert.equal(fila(rep, 'agua_g').estado, 'sin_objetivo'); // un 0 escrito es un 0 real
  const alcohol = fila(rep, 'alcohol_g');
  assert.deepEqual([alcohol.total, alcohol.estado], [null, 'sin_dato']); // el alimento no tiene dato; otro del documento sí (abajo)
});

test('informe: omega-3 y omega-6 (columna vacía en todo el documento) no salen; con un dato en cualquier alimento, aparecen solos', () => {
  const objetivos = en(CON_PESO).list;
  const rep = diaryReport([meal('m', [['a', 100]])], mapa(A, B), objetivos, catalog);
  for (const k of ['omega3_g', 'omega6_g', 'alcohol_g']) assert.equal(fila(rep, k), undefined, k);
  assert.ok(fila(rep, 'almidon_g'));
  // un alimento del documento (aunque no esté en el día) con omega-3: la fila aparece
  const C = food('c', { omega3_g: 0.2 });
  const con = diaryReport([meal('m', [['a', 100]])], mapa(A, B, C), objetivos, catalog);
  assert.deepEqual([fila(con, 'omega3_g').total, fila(con, 'omega3_g').estado], [null, 'sin_dato']);
  assert.equal(fila(con, 'omega6_g'), undefined);
  // un nutriente con objetivo no se oculta nunca, tenga o no dato en el documento
  assert.ok(diaryReport([], mapa(food('x', {})), objetivos, catalog).rows.some((r) => r.clave === 'calcio_mg'));
  // columnasVacias: un 0 escrito es dato
  assert.deepEqual([...columnasVacias([food('z', { agua_g: 0 })], ['agua_g', 'alcohol_g'])], ['alcohol_g']);
});

test('informe: cada nutriente del catálogo sale una sola vez (en rows o en otros) y las referencias nuevas no entran en rows ni en los parciales', () => {
  const objetivos = en(CON_PESO).list;
  const rep = diaryReport([meal('m', [['a', 100], ['b', 100]])], mapa(A, B), objetivos, catalog);
  const claves = [...rep.rows.filter((r) => !r.suma), ...rep.otros.filter((r) => !r.suma)].map((r) => r.clave);
  assert.equal(new Set(claves).size, claves.length);
  // todo el catálogo menos lo oculto (sin objetivo y con la columna vacía en el documento): aquí omega-3, omega-6, alcohol, ALA, EPA, DHA...
  const ocultas = columnasVacias([A, B], catalog.keys);
  const conObjetivo = new Set([...rep.rows.map((r) => r.clave), ...objetivos.filter((t) => t.soloReferencia).map((t) => t.clave)]); // los que tienen referencia salen aunque su columna esté vacía
  for (const k of catalog.keys) assert.equal(claves.includes(k), conObjetivo.has(k) || !ocultas.has(k), k);
  assert.ok(ocultas.has('omega3_g') && !claves.includes('omega3_g'));
  for (const k of [...Object.keys(AMINOS), ...Object.keys(SUMAS), 'cafeina_mg', 'grasas_trans_g']) assert.ok(!rep.rows.some((r) => r.clave === k), k);
  // los parciales siguen hablando solo de lo que tiene objetivo: leucina sin dato en «b» no genera aviso
  const aviso = avisoParciales(rep.rows.length ? [meal('m', [['a', 100], ['b', 100]])] : [], mapa(A, B), rep.rows);
  const textos = [aviso?.importante, aviso?.menor].filter(Boolean).flatMap((x) => x.grupos.map((g) => g.texto)).join(' ');
  assert.doesNotMatch(textos, /Leucina|Triptófano|Cafeína|trans/i);
});

test('gruposInforme: los seis grupos del detalle, en su orden; las sumas tras su última parte; los macros del panel de arriba, fuera', () => {
  const rep = diaryReport([meal('m', [['a', 100]])], mapa(A, B, food('c', { omega3_g: 1, epa_g: 0.1, dha_g: 0.2, fenilalanina_g: 1, tirosina_g: 1 })), en(CON_PESO).list, catalog);
  const excluir = new Set(['energia_kcal', 'proteina_g', 'grasa_total_g', 'grasas_saturadas_g', 'hidratos_g', 'azucares_g', 'fibra_g']);
  const grupos = gruposInforme({ rep, catalog, excluir });
  assert.deepEqual(grupos.map((g) => g.titulo), GRUPOS_DETALLE.map((g) => g.titulo));
  assert.deepEqual(GRUPOS_DETALLE.map((g) => g.titulo), ['General', 'Hidratos', 'Lípidos', 'Proteínas y aminoácidos', 'Vitaminas', 'Minerales']);
  const claves = (id) => grupos.find((g) => g.id === id).filas.map((f) => f.clave);
  assert.deepEqual(claves('general'), ['agua_g', 'cafeina_mg']); // sin la energía (panel de arriba) ni el alcohol (columna vacía)
  assert.ok(!claves('general').includes('energia_kcal'));
  const lip = claves('lipidos');
  assert.equal(lip.indexOf('epa_dha'), lip.indexOf('dha_g') + 1);
  assert.ok(lip.includes('grasas_trans_g') && lip.includes('omega3_g'));
  const prot = claves('proteinas');
  assert.equal(prot.indexOf('metionina_cistina'), prot.indexOf('cistina_g') + 1);
  assert.equal(prot.indexOf('fenilalanina_tirosina'), prot.indexOf('tirosina_g') + 1);
  assert.ok(prot.includes('leucina_g') && prot.includes('fenilalanina_g'));
  assert.ok(!prot.includes('proteina_g')); // el macro está arriba
  assert.ok(claves('vitaminas').includes('vitamina_c_mg') && claves('minerales').includes('hierro_mg') && claves('hidratos').includes('almidon_g'));
});

// ---------- detalle de alimento y de nutriente ----------
test('detalle de alimento: las mismas referencias (leucina con su %), y lo vacío en todo el documento se oculta', () => {
  const objetivos = en(CON_PESO).list;
  const r = filasAlimento({ food: A, grams: 200, objetivos, catalog, foods: [A, B] });
  const todas = r.grupos.flatMap((g) => g.filas);
  const leu = todas.find((f) => f.clave === 'leucina_g');
  assert.deepEqual([redondea(leu.total), leu.min, leu.estado], [3.2, 2.925, 'cumplido']);
  assert.ok(todas.some((f) => f.clave === 'metionina_cistina'));
  assert.ok(!todas.some((f) => f.clave === 'omega3_g' || f.clave === 'omega6_g'));
  assert.ok(r.filas.has('omega3_g'), 'la fila existe (para la pantalla del nutriente), solo no se lista');
  // sin `foods` se listan todos (compatibilidad)
  assert.ok(filasAlimento({ food: A, grams: 200, objetivos, catalog }).grupos.flatMap((g) => g.filas).some((f) => f.clave === 'omega3_g'));
});

test('detalle de nutriente: un aminoácido con peso tiene barra con su mínimo; sin referencia, valor y «sin referencia» sin barra', () => {
  const objetivos = en(CON_PESO).list;
  const fila_ = filasAlimento({ food: A, grams: 200, objetivos, catalog }).filas.get('leucina_g');
  const rango = rangoNutriente({ fila: fila_ });
  assert.equal(rango.sinReferencia, false);
  assert.ok(rango.barra);
  assert.deepEqual(rango.marcas.map((m) => [m.id, m.valor]), [['min', 2.925]]);
  assert.deepEqual(rango.filas.map((f) => f.id), ['alimento', 'min']);
  assert.equal(redondea(rango.filas[0].valor), 3.2);
  assert.equal(rango.filas[1].valor, 2.925);
  // sin peso: sin referencia, sin barra y con el aviso de qué falta
  const sin = rangoNutriente({ fila: filasAlimento({ food: A, grams: 200, objetivos: en(SIN_PESO).list, catalog }).filas.get('leucina_g') });
  assert.deepEqual([sin.sinReferencia, sin.faltaPeso, sin.barra, sin.marcas], [true, true, null, []]);
  // y un nutriente que nunca tiene referencia (almidón)
  const alm = rangoNutriente({ fila: filasAlimento({ food: A, grams: 200, objetivos, catalog }).filas.get('almidon_g') });
  assert.deepEqual([alm.sinReferencia, alm.faltaPeso, alm.barra], [true, false, null]);
});

// ---------- ¿Qué ceno? ----------
test('«¿Qué ceno?» no usa estas referencias: ni como metas (déficit) ni como máximos ni como UL', () => {
  const foodsById = new Map(realFoods.map((f) => [f.id, f]));
  const base = { fecha: FECHA, comidasDelDia: [meal('d', [['avena_copos', 50]])], historial: [], plantillas: [], recetas: [], semilla: null, foodsById, catalog, settings, hoy: FECHA };
  const con = proponerCenas({ ...base, objetivos: en(CON_PESO) });
  const sin = proponerCenas({ ...base, objetivos: { ...en(CON_PESO), list: en(CON_PESO).list.filter((t) => !t.soloReferencia) } });
  const claves = (r) => r.faltan.map((f) => f.clave);
  assert.deepEqual(claves(con), claves(sin));
  assert.deepEqual(con.avisos.map((a) => a.codigo ?? a.tipo), sin.avisos.map((a) => a.codigo ?? a.tipo));
  for (const k of [...Object.keys(AMINOS), ...Object.keys(SUMAS), 'cafeina_mg', 'grasas_trans_g']) assert.ok(!claves(con).includes(k), k);
  assert.deepEqual(con.propuestas.map((p) => p.lineas?.map((l) => l.food_id)), sin.propuestas.map((p) => p.lineas?.map((l) => l.food_id)));
});
