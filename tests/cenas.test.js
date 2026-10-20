// ¿Qué ceno?: motor puro (core/cenas.js), validación de «Más ideas» (core/cenas-validate.js) y borrador. Sin red ni DOM.
// Catálogo y semilla reales (data/foods.csv copiado en tests/fixtures y data/cenas-semilla.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { proponerCenas, deficitsParaIA, nombreParaIA, textoDescartados, fechaCorta, DIAS_PARA_HISTORIAL, R_NORMAL, R_LIGERO } from '../frontend/js/core/cenas.js';
import { checkCenasStructure, normalizeCenas, checkDeficits, MAX_CENAS_IA } from '../frontend/js/core/cenas-validate.js';
import { draftFromLines, validateDraft, toMealRecord } from '../frontend/js/core/draft.js';
import { sumLines } from '../frontend/js/core/nutrients.js';
import { foodSinDatos } from '../frontend/js/core/completeness.js';
import { isExcluded } from '../frontend/js/core/excluded.js';
import { loadTargets } from '../frontend/js/core/targets.js';
import { targetsForDate, planDeReferencia } from '../frontend/js/core/targets-plan.js';
import { shiftDate } from '../frontend/js/core/diary.js';
import { buildCompactList } from '../frontend/js/core/ai-contract.js';
import { catalog, settings, readFile, realFoods } from './helpers.js';

const semilla = JSON.parse(readFile('../data/cenas-semilla.json'));
const sinCenasSemilla = { ...semilla, cenas: [] }; // solo los roles (sin las cenas de Cronometer)
const targets = loadTargets(JSON.parse(readFile('../data/targets.json')), catalog).targets;
const foodsById = new Map(realFoods.map((f) => [f.id, f]));
const FECHA = '2026-10-20';
const ref = targetsForDate(FECHA, { plan: null, targets, catalog });
const conPlan = targetsForDate(FECHA, { plan: planDeReferencia({ fecha: '2026-10-01', perfil: 'hombre', targets, catalog }), targets, catalog });
const meal = (id, m, lines, date = FECHA) => ({ id, date, meal: m, createdAt: `${date}T10:00:00Z`, text: '', lines: lines.map(([food_id, grams]) => ({ food_id, grams })) });
// Un día típico: desayuno, comida y merienda (≈ 1.400 kcal).
const DIA_TIPICO = [
  meal('d', 'desayuno', [['avena_copos', 50], ['leche_entera', 200]]),
  meal('c', 'comida', [['arroz_blanco_crudo', 90], ['pechuga_pollo_cruda', 160], ['aceite_oliva', 15], ['brocoli', 120]]),
  meal('m', 'merienda', [['yogur_griego_natural', 125], ['manzana_con_piel', 150], ['pan_blanco_barra', 60]]),
];
const kcalDe = (lines) => sumLines(lines.map((l) => ({ food: foodsById.get(l.food_id), grams: l.grams ?? l.gramos })), ['energia_kcal']).energia_kcal.value ?? 0;
const consumidoTipico = DIA_TIPICO.reduce((a, m) => a + kcalDe(m.lines), 0);
// Objetivos del día con una meta de energía tal que queden exactamente R kcal.
const conR = (R, base = ref, consumido = consumidoTipico) => ({ ...base, list: base.list.map((t) => (t.clave === 'energia_kcal' ? { ...t, objetivo: consumido + R, valor: consumido + R, min: null, max: null } : t)) });
const entradaBase = { fecha: FECHA, comidasDelDia: DIA_TIPICO, historial: [], plantillas: [], recetas: [], semilla, foodsById, objetivos: conR(1000), catalog, settings, hoy: FECHA };
const proponer = (o = {}) => proponerCenas({ ...entradaBase, ...o });
const cena = (date, lines) => meal(`h${date}`, 'cena', lines, date);

test('el día típico del test ronda 1.400 kcal (la meta de 2.400 deja R ≈ 1.000)', () => {
  assert.ok(consumidoTipico > 1300 && consumidoTipico < 1500, `consumido ${consumidoTipico}`);
});

// ---------- 1, 2: puro y determinista ----------
test('core/cenas.js es puro: sin DOM, fetch ni almacenamiento', async () => {
  for (const f of ['cenas.js', 'cenas-validate.js']) {
    const src = readFile(`../frontend/js/core/${f}`).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\b(document|window|fetch|localStorage|indexedDB|navigator|crypto)\b/, f);
    assert.doesNotMatch(src, /\bhome\b|Inicio/, f);
  }
});

test('determinista: las mismas entradas dan las mismas propuestas en el mismo orden', () => {
  const a = proponer();
  const b = proponer();
  assert.deepEqual(a, b);
  assert.equal(a.propuestas.length, 3);
  // el orden no depende del orden de entrada del historial
  const hist = ['2026-10-10', '2026-10-12', '2026-10-14'].map((d, i) => cena(d, [[['merluza_cruda', 'salmon_atlantico', 'huevo'][i], 150], ['arroz_blanco_crudo', 100], ['calabacin', 80]]));
  assert.deepEqual(proponer({ historial: hist }), proponer({ historial: [...hist].reverse() }));
});

// ---------- 3: lo mostrado es siempre sumLines sobre los gramos finales ----------
test('kcal, proteína, hidratos y grasa de cada propuesta son exactamente sumLines de sus líneas', () => {
  for (const r of [proponer(), proponer({ objetivos: conR(300) }), proponer({ objetivos: conR(100) })]) {
    for (const p of [...r.propuestas, ...r.ideas]) {
      const s = sumLines(p.lineas.map((l) => ({ food: foodsById.get(l.food_id), grams: l.gramos })), ['energia_kcal', 'proteina_g', 'hidratos_g', 'grasa_total_g']);
      assert.equal(p.kcal, s.energia_kcal.value ?? 0);
      assert.equal(p.proteina, s.proteina_g.value ?? 0);
      assert.equal(p.hidratos, s.hidratos_g.value ?? 0);
      assert.equal(p.grasa, s.grasa_total_g.value ?? 0);
    }
  }
});

// ---------- 4: lo que nunca se propone ----------
test('con la semilla y el catálogo real no sale ningún alimento excluido, sin datos o equivalente antiguo; descartados los nombra', () => {
  const r = proponer();
  const PROHIBIDOS = ['tortilla_patata', 'crema_calabacin', 'yogur_griego_vainilla', 'queso_monterey_jack', 'pan_integral'];
  for (const p of r.propuestas) {
    for (const l of p.lineas) {
      const f = foodsById.get(l.food_id);
      assert.ok(!PROHIBIDOS.includes(l.food_id), l.food_id);
      assert.ok(f && !isExcluded(f) && !foodSinDatos(f), l.food_id);
    }
  }
  const ids = r.descartados.map((d) => d.food_id);
  for (const id of ['tortilla_patata', 'crema_calabacin', 'yogur_griego_vainilla', 'queso_monterey_jack']) assert.ok(ids.includes(id), id);
  assert.ok(r.descartados.every((d) => d.motivo === 'sin_datos'));
  assert.match(textoDescartados(r.descartados).join(' '), /No propongo .*(tortilla|crema de calabac).*: no tienen datos\./i);
  // la equivalencia: el pan de barra de la semilla es pan_blanco_barra
  assert.ok(semilla.cenas.flatMap((c) => c.lineas).some((l) => l.food_id === 'pan_blanco_barra'));
  assert.ok(!semilla.cenas.flatMap((c) => c.lineas).some((l) => l.food_id === 'pan_integral'));
});

test('la semilla solo usa ids que existen en data/foods.csv, con rol conocido, y no incluye la salida del 18-sep', () => {
  const ids = new Set(semilla.cenas.flatMap((c) => c.lineas.map((l) => l.food_id)));
  for (const id of ids) { assert.ok(foodsById.has(id), id); assert.ok(semilla.roles[id], `rol de ${id}`); }
  assert.ok(!semilla.cenas.some((c) => c.fecha === '2026-09-18'));
  assert.ok(!ids.has('tinto_verano') && !ids.has('ron') && !ids.has('coca_cola'));
  assert.equal(semilla.cenas.length, 6);
  const g = (fecha, id) => semilla.cenas.find((c) => c.fecha === fecha).lineas.filter((l) => l.food_id === id).map((l) => l.gramos);
  assert.deepEqual(g('2026-09-17', 'aceite_oliva'), [9.1]); // 10 ml × 0,91
  assert.deepEqual(g('2026-09-22', 'aceite_oliva'), [5.46]);
  assert.deepEqual(g('2026-09-24', 'aceite_oliva'), [22.46]); // 17 g + 6 ml
  assert.deepEqual([g('2026-09-22', 'pan_molde_blanco'), g('2026-09-23', 'queso_tierno_loncha')], [[75], [20]]);
  assert.ok(semilla.cenas.flatMap((c) => c.lineas).filter((l) => l.supuesto).length === 2);
  assert.deepEqual(g('2026-09-19', 'tortilla_patata'), [null]);
  assert.deepEqual([g('2026-09-21', 'kiwi_verde'), g('2026-09-22', 'zanahoria'), g('2026-09-21', 'chocolate_negro_85')], [[69], [61], [10]]);
});

// ---------- 5: UL ----------
test('ninguna propuesta hace superar un UL que antes de cenar no se superaba', () => {
  // el yogur de cada cena (≥ 100 mg de calcio) no cabe bajo un UL a 20 mg de lo ya consumido
  const consumidoCalcio = sumLines(DIA_TIPICO.flatMap((m) => m.lines).map((l) => ({ food: foodsById.get(l.food_id), grams: l.grams })), ['calcio_mg']).calcio_mg.value;
  const ajustado = (ul) => ({ ...entradaBase.objetivos, list: entradaBase.objetivos.list.map((t) => (t.clave === 'calcio_mg' ? { ...t, ul } : t)) });
  const estricto = proponer({ objetivos: ajustado(consumidoCalcio + 20) });
  for (const p of estricto.propuestas) assert.ok(consumidoCalcio + p.lineas.reduce((a, l) => a + (foodsById.get(l.food_id).nutrients.calcio_mg ?? 0) * l.gramos / 100, 0) <= consumidoCalcio + 20 + 1e-6);
  assert.equal(estricto.propuestas.length, 0);
  // con holgura suficiente, hay propuestas y ninguna pasa el UL
  const holgado = proponer({ objetivos: ajustado(consumidoCalcio + 400) });
  assert.ok(holgado.propuestas.length > 0);
  for (const p of holgado.propuestas) {
    const ca = p.lineas.reduce((a, l) => a + (foodsById.get(l.food_id).nutrients.calcio_mg ?? 0) * l.gramos / 100, 0);
    assert.ok(consumidoCalcio + ca <= consumidoCalcio + 400 + 1e-6);
  }
});

test('UL ya superado: no descarta por ese UL, avisa y penaliza', () => {
  const consumidoCalcio = sumLines(DIA_TIPICO.flatMap((m) => m.lines).map((l) => ({ food: foodsById.get(l.food_id), grams: l.grams })), ['calcio_mg']).calcio_mg.value;
  const objetivos = { ...entradaBase.objetivos, list: entradaBase.objetivos.list.map((t) => (t.clave === 'calcio_mg' ? { ...t, ul: consumidoCalcio - 10 } : t)) };
  const r = proponer({ objetivos });
  assert.equal(r.propuestas.length, 3);
  const av = r.avisos.filter((a) => a.codigo === 'ul_superado');
  assert.equal(av.length, 1);
  assert.match(av[0].texto, /Ya has superado el UL de Calcio hoy\./);
});

// ---------- 6, 9, 10: tamaño, postre, escalado, proteínas distintas ----------
test('día típico (R ≈ 1.000): 3 propuestas a ±10 % de R y nunca por encima de R + max(50, 5 %)', () => {
  const r = proponer();
  const R = r.resumen.kcal.restantes;
  assert.ok(R >= R_NORMAL);
  assert.equal(r.estado, 'normal');
  assert.equal(r.propuestas.length, 3);
  for (const p of r.propuestas) {
    assert.ok(p.kcal <= R + Math.max(50, 0.05 * R), `${p.origen}: ${p.kcal} > límite`);
    assert.ok(Math.abs(p.kcal - R) <= 0.1 * R, `${p.origen}: ${Math.round(p.kcal)} kcal vs R ${Math.round(R)}`);
  }
  for (const R2 of [500, 700, 1500]) {
    const x = proponer({ objetivos: conR(R2) });
    for (const p of x.propuestas) assert.ok(p.kcal <= R2 + Math.max(50, 0.05 * R2) + 1e-6, `R=${R2}: ${p.origen} ${p.kcal}`);
  }
});

test('cada propuesta normal lleva yogur griego natural; proteína e hidrato entre 0,6 y 1,5 × la base y a múltiplos de 5 g', () => {
  for (const objetivos of [conR(1000), conR(600), conR(1400), conPlan]) {
    const r = proponer({ objetivos });
    assert.equal(r.modo, 'normal');
    for (const p of r.propuestas) {
      assert.ok(p.lineas.some((l) => l.food_id === 'yogur_griego_natural'), p.origen);
      for (const l of p.lineas.filter((x) => ['proteina', 'hidrato', 'plato'].includes(x.rol))) {
        assert.equal(l.gramos % 5, 0, `${l.food_id} ${l.gramos}`);
        assert.ok(l.gramos >= 0.6 * l.base - 1e-9 && l.gramos <= 1.5 * l.base + 1e-9, `${l.food_id}: ${l.gramos} vs base ${l.base}`);
      }
    }
  }
});

test('hasta 3 propuestas; con al menos 3 proteínas habituales distintas, las 3 tienen proteína principal distinta', () => {
  const r = proponer();
  assert.ok(r.propuestas.length <= 3);
  const principales = r.propuestas.map((p) => p.principal);
  assert.equal(new Set(principales).size, r.propuestas.length);
  // como mucho una variante por cada cena de origen
  const porOrigen = r.propuestas.filter((p) => p.variante).map((p) => p.origenClave);
  assert.equal(new Set(porOrigen).size, porOrigen.length);
  // las variantes se etiquetan con el cambio
  const v = proponer({ objetivos: conR(1000) }).propuestas.find((p) => p.variante);
  if (v) assert.match(v.origen, /^Tu cena .* con .* en vez de /);
});

// ---------- 7: semilla frente a historial ----------
test('menos de 21 días con cena: se usa la semilla (aviso); con 21 o más, no', () => {
  const pocos = proponer();
  assert.ok(pocos.avisos.some((a) => a.codigo === 'semilla'));
  assert.match(pocos.avisos.find((a) => a.codigo === 'semilla').texto, /Aún tienes 0 días con cena en la app: uso también tus cenas de Cronometer\./);
  assert.ok(pocos.propuestas.some((p) => p.tipo === 'semilla'));
  const proteinas = ['merluza_cruda', 'salmon_atlantico', 'huevo', 'pechuga_pollo_cruda', 'atun_lata_aceite', 'sardina_lata_aceite', 'pechuga_pavo_cruda'];
  const mucho = Array.from({ length: DIAS_PARA_HISTORIAL }, (_, i) => cena(shiftDate(FECHA, -(i + 1)), [[proteinas[i % proteinas.length], 150 + (i % 3) * 10], [i % 2 ? 'arroz_blanco_crudo' : 'pasta_seca', 100], ['calabacin', 100], ['yogur_griego_natural', 125]]));
  const r = proponer({ historial: mucho });
  assert.ok(!r.avisos.some((a) => a.codigo === 'semilla'));
  assert.ok(r.propuestas.length > 0 && r.propuestas.every((p) => p.tipo !== 'semilla'));
  // con 20 días todavía se usa
  assert.ok(proponer({ historial: mucho.slice(0, DIAS_PARA_HISTORIAL - 1) }).avisos.some((a) => a.codigo === 'semilla'));
  // las cenas de hace más de 60 días no cuentan
  const viejas = mucho.map((m, i) => ({ ...m, id: `v${i}`, date: shiftDate(FECHA, -(61 + i)) }));
  assert.ok(proponer({ historial: viejas }).avisos.some((a) => a.codigo === 'semilla'));
});

test('el historial real manda: una cena repetida se cuenta y se nombra por su fecha', () => {
  const hist = ['2026-10-12', '2026-10-14', '2026-10-17'].map((d) => cena(d, [['salmon_atlantico', 150], ['arroz_blanco_crudo', 100], ['calabacin', 80]]));
  const r = proponer({ historial: hist, semilla: sinCenasSemilla });
  const real = r.propuestas.find((p) => p.tipo === 'historial' && !p.variante);
  assert.ok(real);
  assert.equal(real.origen, 'Tu cena del 17-oct');
  assert.equal(real.veces, 3);
  assert.equal(fechaCorta('2026-09-22'), '22-sep');
});

// ---------- 8: plantillas y recetas ----------
test('plantillas de cena y recetas con datos aparecen como candidatos; las de otra comida, no', () => {
  const plantillas = [
    { id: 'p1', nombre: 'Pollo con arroz', meal: 'cena', lines: [{ food_id: 'pechuga_pollo_cruda', grams: 150 }, { food_id: 'arroz_blanco_crudo', grams: 100 }, { food_id: 'brocoli', grams: 100 }] },
    { id: 'p2', nombre: 'Desayuno fuerte', meal: 'desayuno', lines: [{ food_id: 'avena_copos', grams: 80 }] },
  ];
  const r = proponer({ semilla: sinCenasSemilla, plantillas });
  const p = r.propuestas.find((x) => x.tipo === 'plantilla' && !x.variante);
  assert.ok(p);
  assert.equal(p.origen, 'Tu plantilla «Pollo con arroz»');
  assert.ok(!r.propuestas.some((x) => x.origen.includes('Desayuno fuerte')));
  const rec = proponer({ semilla: sinCenasSemilla, recetas: [{ id: 'lentejas_caseras' }, { id: 'tortilla_patata' }] });
  const l = rec.propuestas.find((x) => x.tipo === 'receta');
  assert.ok(l);
  assert.equal(l.origen, 'Tu receta «' + foodsById.get('lentejas_caseras').nombre + '»');
  assert.ok(l.lineas.some((x) => x.food_id === 'yogur_griego_natural'));
  assert.ok(!rec.propuestas.some((x) => x.lineas.some((y) => y.food_id === 'tortilla_patata'))); // sin datos
  // una receta nunca registrada parte de la ración de 300 g (escalable entre 0,6 y 1,5)
  assert.ok(l.lineas.find((x) => x.rol === 'plato').base === 300);
});

// ---------- 11: modos por kcal restantes ----------
test('R entre 150 y 400: modo ligero, todas dentro del límite de kcal', () => {
  for (const R of [150, 250, 399]) {
    const r = proponer({ objetivos: conR(R) });
    assert.equal(r.modo, 'ligero', `R=${R}`);
    assert.ok(r.propuestas.length > 0, `R=${R}`);
    for (const p of r.propuestas) assert.ok(p.kcal <= R + Math.max(50, 0.05 * R) + 1e-6, `R=${R}: ${p.origen} ${p.kcal}`);
  }
  assert.equal(proponer({ objetivos: conR(R_NORMAL) }).modo, 'normal');
});

test('R < 150: mensaje honesto y nada de cenas normales (solo opciones muy ligeras ≤ R)', () => {
  const r = proponer({ objetivos: conR(100) });
  assert.equal(r.estado, 'cubierto');
  assert.match(r.resumen.mensaje, /^Ya llevas \d+(\.\d+)? kcal de \d+(\.\d+)?: te faltan solo 100\.$/);
  assert.ok(r.propuestas.length > 0 && r.propuestas.length <= 3);
  for (const p of r.propuestas) { assert.ok(p.kcal <= 100 + 1e-6); assert.equal(p.lineas.length, 1); }
  assert.equal(r.recomendacion, 'muy_ligero');
  assert.ok(R_LIGERO > 100);
});

test('ya te has pasado: recomendación de no cenar y, como mucho, una verdura cruda ≤ 50 kcal marcada «por encima de tu objetivo»', () => {
  const r = proponer({ objetivos: conR(-80) });
  assert.equal(r.estado, 'cubierto');
  assert.equal(r.recomendacion, 'no_cenar');
  assert.match(r.resumen.mensaje, /^Te has pasado 80 kcal\.$/);
  assert.ok(r.propuestas.length <= 1);
  for (const p of r.propuestas) { assert.ok(p.kcal <= 50 + 1e-6); assert.equal(p.porEncimaObjetivo, true); assert.equal(foodsById.get(p.lineas[0].food_id).estado, 'crudo'); }
});

// ---------- 12: avisos ----------
test('avisos: cada uno aparece exactamente en su caso', () => {
  const codigos = (r) => r.avisos.map((a) => a.codigo);
  // dia_vacio
  const vacio = proponer({ comidasDelDia: [], objetivos: ref });
  assert.ok(codigos(vacio).includes('dia_vacio'));
  assert.match(vacio.avisos.find((a) => a.codigo === 'dia_vacio').texto, /^No has registrado nada hoy: la propuesta cubre solo la cena \(como mucho \d+ kcal\), no el día entero\.$/);
  assert.ok(vacio.propuestas.every((p) => p.kcal <= 1.5 * 2000)); // limitada por los factores
  assert.ok(!codigos(proponer()).includes('dia_vacio'));
  // sin_plan
  assert.ok(codigos(proponer({ objetivos: conR(1000, ref) })).includes('sin_plan'));
  assert.ok(!codigos(proponer({ objetivos: conR(1000, conPlan) })).includes('sin_plan'));
  assert.match(proponer().avisos.find((a) => a.codigo === 'sin_plan').texto, /^Sin plan de objetivos: uso las referencias EFSA\.$/);
  // cena_registrada
  const conCena = proponer({ comidasDelDia: [...DIA_TIPICO, meal('x', 'cena', [['huevo', 120]])], objetivos: conR(900) });
  assert.match(conCena.avisos.find((a) => a.codigo === 'cena_registrada').texto, /^Ya tienes una cena registrada \(\d+ kcal\): esto propone qué añadir\.$/);
  assert.ok(!codigos(proponer()).includes('cena_registrada'));
  // consumido_parcial
  const parcial = proponer({ comidasDelDia: [...DIA_TIPICO, meal('t', 'otro', [['tortilla_patata', 100]])] });
  assert.match(parcial.avisos.find((a) => a.codigo === 'consumido_parcial').texto, /no es completo: Tortilla de patata no tiene datos/);
  assert.ok(!codigos(proponer()).includes('consumido_parcial'));
  // semilla ya probado; sin_candidatos
  const sin = proponer({ semilla: sinCenasSemilla });
  assert.equal(sin.estado, 'sin_candidatos');
  assert.deepEqual(sin.propuestas, []);
  assert.match(sin.avisos.find((a) => a.codigo === 'sin_candidatos').texto, /^No tengo cenas habituales con tu documento actual: registra alguna cena o guarda una plantilla de cena\.$/);
  assert.ok(!codigos(proponer()).includes('sin_candidatos'));
  // en otro día, los avisos no dicen «hoy»
  const otro = proponer({ comidasDelDia: [], objetivos: ref, hoy: '2026-10-21' });
  assert.match(otro.avisos.find((a) => a.codigo === 'dia_vacio').texto, /nada ese día/);
});

test('un alimento borrado del documento o con incluir=no no se propone y se explica', () => {
  const sinSalmon = new Map(foodsById);
  sinSalmon.delete('salmon_atlantico');
  const hist = [cena('2026-10-15', [['salmon_atlantico', 150], ['arroz_blanco_crudo', 100], ['calabacin', 80]]), cena('2026-10-16', [['merluza_cocida', 150], ['patata_cruda', 100], ['calabacin', 80]])];
  const r = proponer({ semilla: sinCenasSemilla, historial: hist, foodsById: sinSalmon });
  for (const p of r.propuestas) for (const l of p.lineas) assert.ok(!['salmon_atlantico', 'merluza_cocida'].includes(l.food_id));
  const motivos = Object.fromEntries(r.descartados.map((d) => [d.food_id, d.motivo]));
  assert.equal(motivos.salmon_atlantico, 'fuera_documento');
  assert.equal(motivos.merluza_cocida, 'excluido'); // tiene datos pero incluir=no
  assert.match(textoDescartados(r.descartados, (id) => id).join(' '), /excluido/);
});

test('un alimento incompleto (< 80 %) se propone y se marca «pendiente de completar»', () => {
  const falso = new Map(foodsById);
  falso.set('semillas_chia', { ...foodsById.get('semillas_chia'), nutrients: { energia_kcal: 486, proteina_g: 17 } });
  const x = proponer({ foodsById: falso });
  assert.ok(x.propuestas.some((p) => p.incompletos.includes(foodsById.get('semillas_chia').nombre)));
  assert.ok(proponer().propuestas.every((p) => !p.incompletos.includes(foodsById.get('semillas_chia').nombre))); // la chía real (81 %) es completa
});

// ---------- resumen ----------
test('el resumen dice cuánto llevas, la meta, R, lo que falta de proteína/hidratos/grasa y los 5 micros con más % por cubrir', () => {
  const r = proponer();
  assert.ok(Math.abs(r.resumen.kcal.consumidas - consumidoTipico) < 1e-9);
  assert.equal(r.resumen.kcal.meta, consumidoTipico + 1000);
  assert.ok(Math.abs(r.resumen.kcal.restantes - 1000) < 1e-9);
  assert.deepEqual(r.resumen.macros.map((m) => m.clave), ['proteina_g', 'hidratos_g', 'grasa_total_g']);
  assert.equal(r.resumen.micros.length, 5);
  const pct = r.resumen.micros.map((m) => m.pctPorCubrir);
  assert.deepEqual([...pct].sort((a, b) => b - a), pct);
  assert.ok(r.faltan.every((f) => f.falta > 0 && f.clave !== 'energia_kcal'));
});

// ---------- «Más ideas»: motor ----------
test('las ideas de la IA entran como candidatos con S_hab = 0, mismo escalado y UL, y se marcan; no cambian las 3 de siempre', () => {
  const sin = proponer();
  const ideas = [
    { nombre: 'Pollo con arroz y brócoli', lineas: [{ food_id: 'pechuga_pollo_cruda', gramos: 180 }, { food_id: 'arroz_blanco_crudo', gramos: 90 }, { food_id: 'brocoli', gramos: 150 }] },
    { nombre: 'Huevos con patata', lineas: [{ food_id: 'huevo', gramos: 120 }, { food_id: 'patata_cruda', gramos: 200 }, { food_id: 'pimiento_rojo', gramos: 80 }] },
    { nombre: 'Con un alimento sin datos', lineas: [{ food_id: 'tortilla_patata', gramos: 200 }] },
  ];
  const r = proponer({ ideasIA: ideas });
  assert.deepEqual(r.propuestas, sin.propuestas);
  assert.ok(r.ideas.length >= 1 && r.ideas.length <= 3);
  for (const p of r.ideas) {
    assert.equal(p.ia, true);
    assert.match(p.origen, /^Idea de la IA: /);
    assert.ok(p.lineas.some((l) => l.food_id === 'yogur_griego_natural')); // mismo postre
    assert.ok(p.kcal <= 1000 + 50);
    const s = sumLines(p.lineas.map((l) => ({ food: foodsById.get(l.food_id), grams: l.gramos })), ['energia_kcal']);
    assert.equal(p.kcal, s.energia_kcal.value);
  }
  assert.ok(!r.ideas.some((p) => p.lineas.some((l) => l.food_id === 'tortilla_patata')));
});

test('nombres de nutrientes para la IA: sin dígitos, sin cantidades, como mucho 8, en el orden de lo que más falta', () => {
  for (const n of catalog.list) {
    const nombre = nombreParaIA(n.key, n.label);
    if (nombre !== null) assert.doesNotMatch(nombre, /\d/, n.key);
  }
  assert.equal(nombreParaIA('vitamina_b12_ug', 'Vitamina B12'), 'Cobalamina');
  assert.equal(nombreParaIA('vitamina_a_ug', 'Vitamina A (RAE)'), 'Vitamina A');
  assert.equal(nombreParaIA('epa_dha', 'EPA + DHA'), 'EPA y DHA');
  const r = proponer({ comidasDelDia: [], objetivos: ref });
  const d = deficitsParaIA(r.faltan);
  assert.equal(d.length, 8);
  assert.ok(d.every((x) => typeof x === 'string' && x.length <= 40 && !/\d/.test(x)));
  assert.deepEqual(checkDeficits(d), d); // lo que se envía lo acepta el Worker
});

// ---------- validación de la respuesta de la IA ----------
test('cenas-validate: descarta ids inventados, gramos inválidos y cenas sin proteína; suma repetidos; máximo 5 cenas y 8 líneas', () => {
  const lista = buildCompactList(realFoods);
  const roles = semilla.roles;
  const ok = { nombre: 'Salmón con arroz', lineas: [{ id: 'salmon_atlantico', gramos: 150 }, { id: 'arroz_blanco_crudo', gramos: 80 }, { id: 'inventado', gramos: 10 }, { id: 'calabacin', gramos: -5 }, { id: 'pasta_seca', gramos: 99999 }, { id: 'calabacin', gramos: 40 }, { id: 'calabacin', gramos: 40 }] };
  const sinProteina = { nombre: 'Solo arroz', lineas: [{ id: 'arroz_blanco_crudo', gramos: 100 }] };
  const r = normalizeCenas({ cenas: [ok, sinProteina, { nombre: 'x', lineas: 'no' }] }, lista, { roles });
  assert.equal(r.ok, true);
  assert.equal(r.cenas.length, 1);
  assert.deepEqual(r.cenas[0].lineas, [{ food_id: 'salmon_atlantico', gramos: 150 }, { food_id: 'arroz_blanco_crudo', gramos: 80 }, { food_id: 'calabacin', gramos: 80 }]);
  assert.ok(r.warnings.some((w) => /inventado/.test(w)) && r.warnings.some((w) => /sin proteína/.test(w)));
  // todas inválidas
  assert.equal(normalizeCenas({ cenas: [sinProteina] }, lista, { roles }).ok, false);
  assert.equal(checkCenasStructure({ cenas: [] }).ok, false);
  assert.equal(checkCenasStructure([]).ok, false);
  // límites
  const muchas = Array.from({ length: 9 }, (_, i) => ({ nombre: `c${i}`, lineas: [{ id: 'huevo', gramos: 100 + i }] }));
  assert.equal(normalizeCenas({ cenas: muchas }, lista, { roles }).cenas.length, MAX_CENAS_IA);
  const largas = { nombre: 'larga', lineas: ['huevo', 'arroz_blanco_crudo', 'pasta_seca', 'calabacin', 'berenjena', 'cebolla', 'pepino', 'zanahoria', 'brocoli', 'champinon'].map((id) => ({ id, gramos: 50 })) };
  assert.equal(normalizeCenas({ cenas: [largas] }, lista, { roles }).cenas[0].lineas.length, 8);
  // un alimento que no se envió (excluido o sin datos) es un id inventado
  const sinTortilla = buildCompactList(realFoods).filter((a) => a.id !== 'huevo');
  assert.equal(normalizeCenas({ cenas: [{ nombre: 'h', lineas: [{ id: 'huevo', gramos: 100 }] }] }, sinTortilla, { roles }).ok, false);
});

test('checkDeficits: solo nombres cortos, sin dígitos, hasta 8', () => {
  assert.deepEqual(checkDeficits(['Fibra', ' Magnesio ', 'Proteína']), ['Fibra', 'Magnesio', 'Proteína']);
  assert.deepEqual(checkDeficits([]), []);
  for (const mal of [['Fibra 12 g'], ['Vitamina B12'], ['x'.repeat(41)], [''], [3], 'Fibra', null, Array.from({ length: 9 }, (_, i) => `n${String.fromCharCode(97 + i)}`), [{ nombre: 'a' }]]) {
    assert.equal(checkDeficits(mal), null, JSON.stringify(mal));
  }
});

// ---------- borrador ----------
test('draftFromLines: borrador nuevo (sin editing) con líneas manuales, cena y origen en source_text; no guarda nada por sí solo', () => {
  const r = proponer();
  const p = r.propuestas[0];
  const d = draftFromLines({ lines: p.lineas, meal: 'cena', text: '¿Qué ceno?', sourceText: `¿Qué ceno?: ${p.origen}`, foodsById });
  assert.equal(d.editing, undefined);
  assert.equal(d.meal, 'cena');
  assert.deepEqual(d.lines.map((l) => [l.food_id, l.grams, l.confidence, l.source_text]), p.lineas.map((l) => [l.food_id, l.gramos, 'manual', `¿Qué ceno?: ${p.origen}`]));
  assert.equal(validateDraft(d).ok, true);
  const rec = toMealRecord(d, { now: new Date('2026-10-20T18:00:00Z'), idGen: () => 'x' });
  assert.deepEqual([rec.meal, rec.text, rec.lines.length], ['cena', '¿Qué ceno?', p.lineas.length]);
  // un alimento que ya no está queda sin resolver
  assert.equal(draftFromLines({ lines: [{ food_id: 'nada', gramos: 5 }], meal: 'cena', foodsById }).unmatched.length, 1);
});
