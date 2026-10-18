// Plan de objetivos: formato (docs/OBJETIVOS-FORMATO.md), validación, prioridad por fecha y edición.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargets, resolveTargets } from '../frontend/js/core/targets.js';
import { diaryReport, evaluate } from '../frontend/js/core/diary.js';
import {
  parsePlan, validatePlan, targetsForDate, periodoVigente, dayContext, editPeriod, setDayType, setPerfil, planFromLegacy, emptyPlan, planToJSON, claveDia,
  planDeReferencia, TIPOS_SEMANA,
} from '../frontend/js/core/targets-plan.js';
import { catalog, readFile, realFoods } from './helpers.js';

const { targets } = loadTargets(JSON.parse(readFile('../data/targets.json')), catalog);
const ctx = { targets, catalog };
const [EJEMPLO, EJEMPLO_SEMANA] = [...readFile('../docs/OBJETIVOS-FORMATO.md').matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
const ejemplo = parsePlan(EJEMPLO, ctx).plan;
const PLAN = (o = {}) => ({ tipo: 'plan_objetivos', version: 1, periodos: [], ...o });
const P = (o = {}) => ({ id: 'p', nombre: 'P', inicio: '2026-01-01', ...o });
const en = (plan, fecha) => targetsForDate(fecha, { plan, ...ctx });
const lim = (r, clave) => {
  const t = r.list.find((x) => x.clave === clave);
  return t ? [t.min, t.objetivo, t.max, t.origen] : undefined;
};
const errores = (raw) => validatePlan(raw, ctx).errors;

// ---------- el ejemplo del formato ----------
test('el ejemplo de docs/OBJETIVOS-FORMATO.md es un plan válido, sin errores ni avisos', () => {
  const r = parsePlan(EJEMPLO, ctx);
  assert.deepEqual([r.ok, r.errors, r.avisos], [true, [], []]);
  assert.equal(r.plan.periodos.length, 3);
});

test('prioridad: tipo del día (por la semana) > valores del periodo > referencia EFSA; g/kg y %kcal calculados', () => {
  const lun = en(ejemplo, '2026-10-19'); // lunes: entreno
  assert.equal(lun.periodo.nombre, 'Volumen otoño 2026');
  assert.deepEqual(lun.tipoDia, { clave: 'entreno', nombre: 'Entreno', origen: 'semana' });
  assert.deepEqual([lun.peso_kg, lun.kcal], [74, 3100]);
  assert.deepEqual(lim(lun, 'energia_kcal'), [null, 3100, null, 'tipo']);
  assert.deepEqual(lim(lun, 'hidratos_g'), [null, 407, null, 'tipo']); // 5,5 g/kg × 74
  assert.deepEqual(lim(lun, 'proteina_g'), [133.2, 148, null, 'periodo']); // 1,8 y 2,0 g/kg × 74
  assert.deepEqual(lim(lun, 'grasa_total_g'), [86.1, null, 120.6, 'periodo']); // 25-35 % de 3100 kcal / 9
  assert.deepEqual(lim(lun, 'magnesio_mg'), [350, null, null, 'referencia']);
  assert.deepEqual(lim(lun, 'vitamina_b1_mg'), [1.3, null, null, 'referencia']); // 0,1 mg/MJ con las kcal del día
  const dom = en(ejemplo, '2026-10-18'); // domingo: descanso
  assert.equal(dom.tipoDia.clave, 'descanso');
  assert.deepEqual(lim(dom, 'energia_kcal'), [null, 2700, null, 'tipo']);
  assert.deepEqual(lim(dom, 'grasa_total_g'), [75, null, 105, 'periodo']); // el % sigue a las kcal del día
});

test('prioridad: la excepción manda; su tipo cambia el del día; null quita el objetivo', () => {
  const jue = en(ejemplo, '2026-10-22'); // jueves de descanso, pasado a entreno
  assert.deepEqual(jue.tipoDia, { clave: 'entreno', nombre: 'Entreno', origen: 'excepcion' });
  assert.deepEqual(lim(jue, 'energia_kcal'), [null, 3100, null, 'tipo']);
  assert.equal(en(ejemplo, '2026-10-23').tipoDia.clave, 'descanso'); // viernes de entreno, pasado a descanso
  const nochebuena = en(ejemplo, '2026-12-24');
  assert.equal(nochebuena.periodo.nombre, 'Navidad');
  assert.deepEqual(nochebuena.excepcion, { nota: 'Nochebuena' });
  assert.deepEqual(lim(nochebuena, 'energia_kcal'), [null, null, 3500, 'excepcion']);
  assert.equal(nochebuena.kcal, 3500); // solo un límite: ese
  const sodio = nochebuena.list.find((t) => t.clave === 'sodio_mg');
  assert.deepEqual([sodio.valor, sodio.tipo, sodio.origen, sodio.ul], [null, null, 'excepcion', null]);
  assert.deepEqual(lim(nochebuena, 'proteina_g'), [121.6, null, null, 'periodo']); // 1,6 g/kg × 76
  assert.deepEqual(lim(nochebuena, 'hidratos_g'), [null, 260, null, 'referencia']);
});

test('periodo sin fin hasta el siguiente; %kcal y kcal/kg; un día sin periodo usa la referencia', () => {
  const mant = en(ejemplo, '2027-03-02'); // martes: sin tipo
  assert.equal(mant.periodo.nombre, 'Mantenimiento');
  assert.equal(mant.tipoDia, null);
  assert.deepEqual(lim(mant, 'energia_kcal'), [null, 2584, null, 'periodo']); // 34 kcal/kg × 76
  assert.deepEqual(lim(mant, 'hidratos_g'), [null, 323, null, 'periodo']); // 50 % de 2584 / 4
  assert.deepEqual(lim(en(ejemplo, '2027-03-01'), 'hidratos_g'), [null, 355.3, null, 'tipo']); // lunes: 55 %
  assert.equal(en(ejemplo, '2035-01-01').periodo.nombre, 'Mantenimiento');
  const antes = en(ejemplo, '2026-09-01');
  assert.deepEqual([antes.periodo, antes.tipoDia, antes.peso_kg, antes.kcal], [null, null, null, 2000]);
  assert.ok(antes.list.every((t) => t.origen === 'referencia'));
});

test('sin plan, targetsForDate da lo mismo que la referencia de siempre (resolveTargets), con el perfil del plan', () => {
  const ref = resolveTargets(targets);
  const sin = en(null, '2026-10-18');
  assert.deepEqual(sin.list.map((t) => [t.clave, t.valor, t.tipo, t.ul]), ref.map((t) => [t.clave, t.valor, t.tipo, t.ul]));
  assert.equal(lim(en(PLAN({ perfil: 'mujer' }), '2026-10-18'), 'hierro_mg')[0], 16);
  assert.equal(en(PLAN({ perfil: 'mujer' }), '2026-10-18').perfil, 'mujer');
});

test('la entrada de un nutriente se sustituye entera: no se arrastran límites de otra capa', () => {
  const plan = PLAN({ periodos: [P({ valores: { proteina_g: { min: 150, max: 220 } }, tipos: { entreno: { valores: { proteina_g: { objetivo: 180 } } } }, semana: { lun: 'entreno' } })] });
  assert.deepEqual(lim(en(plan, '2026-10-19'), 'proteina_g'), [null, 180, null, 'tipo']);
  assert.deepEqual(lim(en(plan, '2026-10-20'), 'proteina_g'), [150, null, 220, 'periodo']);
});

test('periodo vigente: manda el que empezó más tarde (anidados y sucesivos sin fin)', () => {
  const plan = PLAN({ periodos: [P({ id: 'base', nombre: 'Base' }), P({ id: 'vac', nombre: 'Vacaciones', inicio: '2026-08-01', fin: '2026-08-15' }), P({ id: 'def', nombre: 'Definición', inicio: '2026-10-01' })] });
  assert.equal(periodoVigente(plan, '2025-12-31'), null);
  assert.deepEqual(['2026-07-31', '2026-08-01', '2026-08-15', '2026-08-16', '2026-09-30', '2026-10-01', '2027-05-05'].map((f) => periodoVigente(plan, f).id), ['base', 'vac', 'vac', 'base', 'base', 'def', 'def']);
});

test('nutrientes que no están en targets.json también valen (sin UL); los quitados sin referencia no salen', () => {
  const plan = PLAN({ periodos: [P({ valores: { cafeina_mg: { max: 400 }, alcohol_g: null } })] });
  const r = en(plan, '2026-10-18');
  const cafeina = r.list.find((t) => t.clave === 'cafeina_mg');
  assert.deepEqual([cafeina.label, cafeina.unit, cafeina.max, cafeina.ul, cafeina.origen], ['Cafeína', 'mg', 400, null, 'periodo']);
  assert.equal(r.list.some((t) => t.clave === 'alcohol_g'), false);
  assert.ok(validatePlan(plan, ctx).ok);
});

// ---------- validación ----------
test('validación: cada error se dice con su sitio, todos a la vez, y el plan no se usa', () => {
  const casos = [
    [{ ...PLAN(), tipo: undefined }, /Falta "tipo": "plan_objetivos"/],
    [PLAN({ version: 2 }), /"version" tiene que ser 1/],
    [PLAN({ perfil: 'marciano' }), /"perfil": "marciano" no existe/],
    [PLAN({ periodos: undefined }), /"periodos" tiene que ser una lista/],
    [PLAN({ periodos: [P({ inicio: '2026-02-30' })] }), /Periodo «P»: "inicio" tiene que ser una fecha/],
    [PLAN({ periodos: [P({ fin: '2025-12-31' })] }), /"fin" \(2025-12-31\) es anterior a "inicio"/],
    [PLAN({ periodos: [P(), P({ inicio: '2026-02-01' })] }), /"id" "p" repetido/],
    [PLAN({ periodos: [P(), P({ id: 'q', nombre: 'Q' })] }), /Periodo «Q»: empieza el mismo día que «P»/],
    [PLAN({ periodos: [P({ id: 'con espacio' })] }), /"id" tiene que ser un texto sin espacios/],
    [PLAN({ periodos: [P({ nombre: '' })] }), /falta "nombre"/],
    [PLAN({ periodos: [P({ valores: { vitamina_z_mg: { min: 1 } } })] }), /Periodo «P» → vitamina_z_mg: no es un nutriente/],
    [PLAN({ periodos: [P({ valores: { fibra_g: 30 } })] }), /fibra_g: tiene que ser un objeto.*¿\{ "objetivo": 30 \}\?/],
    [PLAN({ periodos: [P({ valores: { fibra_g: {} } })] }), /fibra_g: sin ningún límite/],
    [PLAN({ periodos: [P({ valores: { fibra_g: { min: '30' } } })] }), /"min" tiene que ser un número/],
    [PLAN({ periodos: [P({ valores: { fibra_g: { objetivo: 0 } } })] }), /"objetivo" tiene que ser mayor que 0/],
    [PLAN({ periodos: [P({ valores: { fibra_g: { min: 40, max: 30 } } })] }), /min \(40\) es mayor que max \(30\)/],
    [PLAN({ periodos: [P({ valores: { fibra_g: { min: 40, objetivo: 30 } } })] }), /min \(40\) es mayor que objetivo \(30\)/],
    [PLAN({ periodos: [P({ valores: { fibra_g: { objetivo: 40, max: 30 } } })] }), /objetivo \(40\) es mayor que max \(30\)/],
    [PLAN({ periodos: [P({ peso_kg: 70, valores: { vitamina_c_mg: { unidad: 'g/kg', min: 1 } } })] }), /vitamina_c_mg: unidad "g\/kg" no vale para este nutriente \(valen: "mg"\)/],
    [PLAN({ periodos: [P({ valores: { energia_kcal: { unidad: '%kcal', objetivo: 100 } } })] }), /energia_kcal: unidad "%kcal" no vale/],
    [PLAN({ periodos: [P({ valores: { proteina_g: { unidad: 'g/kg', min: 2 } } })] }), /proteina_g: usa "g\/kg" pero no hay peso_kg/],
    [PLAN({ periodos: [P({ peso_kg: -70 })] }), /"peso_kg" tiene que ser un número mayor que 0/],
    [PLAN({ periodos: [P({ tipos: { entreno: {} }, semana: { lun: 'pierna' } })] }), /semana → lun: el tipo "pierna" no está en "tipos"/],
    [PLAN({ periodos: [P({ semana: { funday: null } })] }), /"funday" no es un día de la semana/],
    [PLAN({ periodos: [P({ tipos: { entreno: { valores: { proteina_g: { unidad: 'g/kg', min: 2 } } } } })] }), /tipo «entreno» → proteina_g: usa "g\/kg" pero no hay peso_kg/],
    [PLAN({ excepciones: [{ fecha: '2026-10-18' }, { fecha: '2026-10-18' }] }), /Excepción 2026-10-18: hay otra excepción con la misma fecha/],
    [PLAN({ excepciones: [{ fecha: '18/10/2026' }] }), /"fecha" tiene que ser una fecha AAAA-MM-DD/],
    [PLAN({ excepciones: [{ fecha: '2026-10-18', tipo: 'entreno' }] }), /"tipo" "entreno", pero ningún periodo cubre esa fecha/],
    [PLAN({ periodos: [P()], excepciones: [{ fecha: '2026-10-18', tipo: 'entreno' }] }), /el tipo "entreno" no está en el periodo «P»/],
    [PLAN({ periodos: [P()], excepciones: [{ fecha: '2026-10-18', valores: { proteina_g: { unidad: 'g/kg', min: 2 } } }] }), /Excepción 2026-10-18 → proteina_g: usa "g\/kg" pero no hay peso_kg/],
  ];
  for (const [raw, re] of casos) {
    const r = validatePlan(raw, ctx);
    assert.equal(r.ok, false, String(re));
    assert.equal(r.plan, null);
    assert.ok(r.errors.some((e) => re.test(e)), `${re} en ${JSON.stringify(r.errors)}`);
  }
  assert.equal(errores(PLAN({ version: 2, perfil: 'x', periodos: [P({ fin: '2025-01-01' })] })).length, 3);
  assert.match(parsePlan('{ "tipo": ', ctx).errors[0], /No es un JSON válido/);
  assert.match(parsePlan('[]', ctx).errors[0], /tiene que ser un objeto JSON/);
});

test('validación: lo que vale (peso de la excepción, unidad de la columna, µg, null en límites, días con nombre largo)', () => {
  const r = validatePlan(PLAN({
    periodos: [P({ tipos: { entreno: {}, descanso: {} }, semana: { Lunes: 'entreno', 'miércoles': 'entreno', SÁB: null }, valores: { fibra_g: { unidad: 'g', min: 30, max: null }, vitamina_d_ug: { unidad: 'µg', min: 20 }, epa_dha: { min: 0.5 }, sodio_mg: null } })],
    excepciones: [{ fecha: '2026-10-18', peso_kg: 75, valores: { proteina_g: { unidad: 'g/kg', min: 2 } } }],
  }), ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.plan.periodos[0].semana, { lun: 'entreno', mie: 'entreno', sab: null });
  assert.deepEqual(lim(en(r.plan, '2026-10-18'), 'proteina_g'), [150, null, null, 'excepcion']);
  assert.deepEqual(lim(en(r.plan, '2026-10-18'), 'epa_dha'), [0.5, null, null, 'periodo']);
  assert.deepEqual(['lunes', 'MIE', 'Sábado', 'domingo', 'x'].map(claveDia), ['lun', 'mie', 'sab', 'dom', null]);
});

test('avisos: campos desconocidos (se conservan) y periodos con fin que se solapan (dice cuál manda)', () => {
  const r = validatePlan(PLAN({ color: 'azul', periodos: [P({ id: 'a', nombre: 'Base', fin: '2026-12-31', emoji: '💪' }), P({ id: 'b', nombre: 'Vacaciones', inicio: '2026-08-01', fin: '2026-08-15' })] }), ctx);
  assert.equal(r.ok, true);
  assert.equal(r.plan.color, 'azul');
  assert.equal(r.plan.periodos[0].emoji, '💪');
  assert.ok(r.avisos.some((a) => /El plan: campo desconocido "color"/.test(a)));
  assert.ok(r.avisos.some((a) => /Periodo «Base»: campo desconocido "emoji"/.test(a)));
  assert.ok(r.avisos.some((a) => /«Base» y «Vacaciones» se solapan del 2026-08-01 al 2026-08-15: esos días manda «Vacaciones»/.test(a)));
  // sucesivos o abiertos: sin aviso
  assert.deepEqual(validatePlan(PLAN({ periodos: [P({ id: 'a' }), P({ id: 'b', inicio: '2026-06-01' })] }), ctx).avisos, []);
});

// ---------- edición desde la app ----------
test('editar «desde hoy»: el periodo termina ayer y sigue un tramo nuevo; los días pasados no cambian', () => {
  const hoy = '2026-10-18'; // domingo: descanso
  const { plan, periodoId } = editPeriod(ejemplo, { fecha: hoy, capa: 'descanso', valores: { energia_kcal: { objetivo: 2600 } } });
  assert.deepEqual(validatePlan(plan, ctx).errors, []);
  const [viejo, nuevo] = plan.periodos;
  assert.deepEqual([viejo.inicio, viejo.fin, nuevo.id, nuevo.nombre, nuevo.inicio, nuevo.fin], ['2026-09-15', '2026-10-17', periodoId, 'Volumen otoño 2026', hoy, '2026-12-20']);
  assert.equal(periodoId, 'volumen_otono_2026_20261018');
  assert.deepEqual(nuevo.semana, viejo.semana);
  assert.deepEqual(lim(en(plan, '2026-10-17'), 'energia_kcal'), [null, 2700, null, 'tipo']); // sábado pasado: como estaba
  assert.deepEqual(lim(en(plan, hoy), 'energia_kcal'), [null, 2600, null, 'tipo']);
  assert.deepEqual(lim(en(plan, '2026-12-24'), 'energia_kcal'), [null, null, 3500, 'excepcion']); // lo demás, igual
  assert.equal(ejemplo.periodos.length, 3); // el original no se toca
  // otra vez el mismo día: se edita el tramo de hoy, sin partirlo de nuevo
  const otra = editPeriod(plan, { fecha: hoy, valores: { energia_kcal: { objetivo: 2950 } }, peso_kg: 75 });
  assert.equal(otra.plan.periodos.length, 4);
  assert.deepEqual([otra.plan.periodos[1].valores.energia_kcal, otra.plan.periodos[1].peso_kg], [{ objetivo: 2950 }, 75]);
});

test('editar «a todo el periodo», quitar una entrada de la capa y crear periodo si no hay', () => {
  const todo = editPeriod(ejemplo, { fecha: '2026-10-18', capa: 'descanso', valores: { energia_kcal: { objetivo: 2600 } }, modo: 'todo' }).plan;
  assert.equal(todo.periodos.length, 3);
  assert.deepEqual(lim(en(todo, '2026-10-17'), 'energia_kcal'), [null, 2600, null, 'tipo']);
  const quitado = editPeriod(ejemplo, { fecha: '2026-10-18', capa: 'descanso', valores: { energia_kcal: null, hidratos_g: null }, modo: 'todo' }).plan;
  assert.deepEqual(lim(en(quitado, '2026-10-18'), 'energia_kcal'), [null, 2900, null, 'periodo']); // pasa a la capa siguiente
  const nuevo = editPeriod(null, { fecha: '2026-10-18', valores: { energia_kcal: { objetivo: 2500 } } });
  assert.deepEqual(validatePlan(nuevo.plan, ctx).errors, []);
  assert.deepEqual([nuevo.plan.periodos[0].inicio, nuevo.plan.periodos[0].nombre], ['2026-10-18', 'Mis objetivos']);
  assert.deepEqual(lim(en(nuevo.plan, '2026-10-17'), 'energia_kcal'), [null, 2000, null, 'referencia']);
  assert.throws(() => editPeriod(ejemplo, { fecha: '2026-10-18', capa: 'pierna', valores: {} }), /no tiene el tipo "pierna"/);
  // g/kg sin peso: lo detecta la validación
  const sinPeso = editPeriod(ejemplo, { fecha: '2026-10-18', peso_kg: null }).plan;
  assert.match(validatePlan(sinPeso, ctx).errors.join('\n'), /usa "g\/kg" pero no hay peso_kg/);
});

test('«Hoy es»: excepción con el tipo; quitarlo vuelve a la semana y conserva la nota', () => {
  let plan = setDayType(ejemplo, '2026-10-18', 'entreno');
  assert.deepEqual(dayContext(plan, '2026-10-18').tipoClave, 'entreno');
  assert.deepEqual(plan.excepciones.find((e) => e.fecha === '2026-10-18'), { fecha: '2026-10-18', tipo: 'entreno' });
  assert.deepEqual(plan.excepciones.map((e) => e.fecha), ['2026-10-18', '2026-10-22', '2026-10-23', '2026-12-24']);
  plan = setDayType(plan, '2026-10-18', null);
  assert.equal(plan.excepciones.some((e) => e.fecha === '2026-10-18'), false);
  assert.equal(dayContext(plan, '2026-10-18').tipoClave, 'descanso');
  plan = setDayType(plan, '2026-10-22', null);
  assert.deepEqual(plan.excepciones.find((e) => e.fecha === '2026-10-22'), { fecha: '2026-10-22', nota: 'Cambié el entreno del viernes al jueves' });
  assert.ok(validatePlan(plan, ctx).ok);
});

test('migración: los objetivos de la pantalla anterior pasan a un periodo abierto desde la primera fecha del diario', () => {
  const plan = planFromLegacy({ perfil: 'mujer', valores: { energia_kcal: 2500, proteina_g: 150, hierro_mg: -1 } }, { desde: '2026-10-01', targets });
  assert.deepEqual(validatePlan(plan, ctx).errors, []);
  assert.deepEqual(plan.periodos, [{ id: 'mis_objetivos', nombre: 'Mis objetivos', inicio: '2026-10-01', valores: { energia_kcal: { objetivo: 2500 }, proteina_g: { min: 150 } } }]);
  const r = en(plan, '2026-10-16');
  const viejo = resolveTargets(targets, { perfil: 'mujer', valores: { energia_kcal: 2500, proteina_g: 150 } });
  assert.deepEqual(r.list.map((t) => [t.clave, t.valor]), viejo.map((t) => [t.clave, t.valor])); // nada cambia
  assert.deepEqual(planFromLegacy({ perfil: 'mujer', valores: {} }, { desde: '2026-10-01', targets }).periodos, []);
  assert.equal(planFromLegacy({}, { desde: '2026-10-01', targets }), null);
  assert.equal(planFromLegacy(null, { desde: '2026-10-01', targets }), null);
});

test('perfil, plan vacío y JSON exportado (se vuelve a importar igual)', () => {
  assert.deepEqual(setPerfil(null, 'mujer'), { ...emptyPlan(), perfil: 'mujer' });
  const r = parsePlan(planToJSON(ejemplo), ctx);
  assert.deepEqual(r.plan, ejemplo);
  assert.ok(planToJSON(ejemplo).endsWith('}\n'));
});

// ---------- evaluación con límites ----------
test('evaluate con min, objetivo y max combinados (rangos)', () => {
  const t = (o) => ({ min: null, objetivo: null, max: null, ul: null, ...o });
  const tot = (value) => ({ value, missing: [] });
  const estados = (target, valores) => valores.map((v) => evaluate(tot(v), target).estado);
  assert.deepEqual(estados(t({ min: 80, max: 110 }), [79, 80, 110, 111]), ['por_debajo', 'en_objetivo', 'en_objetivo', 'por_encima']);
  assert.equal(evaluate(tot(55), t({ min: 80, max: 110 })).pct, 0.5); // sobre el máximo
  assert.deepEqual(estados(t({ min: 130, objetivo: 150 }), [129, 130, 165, 166]), ['por_debajo', 'en_objetivo', 'en_objetivo', 'por_encima']);
  assert.deepEqual(estados(t({ objetivo: 100, max: 105 }), [89, 90, 105, 106]), ['por_debajo', 'en_objetivo', 'en_objetivo', 'por_encima']);
  assert.deepEqual(estados(t({ min: 30 }), [29, 30]), ['por_debajo', 'cumplido']);
  assert.deepEqual(estados(t({ max: 30 }), [30, 31]), ['dentro', 'excedido']);
  assert.deepEqual(estados(t({}), [30]), ['sin_objetivo']);
  assert.equal(evaluate(tot(150), t({ min: 130, objetivo: 150 })).pct, 1);
});

test('el diario evalúa cada día con los objetivos de ese día', () => {
  const byId = new Map(realFoods.map((f) => [f.id, f]));
  const meals = [{ id: 'm', date: '2026-10-19', meal: 'comida', createdAt: '', text: '', lines: [{ food_id: 'arroz_blanco_crudo', grams: 100, source_text: '' }] }];
  const kcalDe = (fecha) => diaryReport(meals, byId, en(ejemplo, fecha).list, catalog).rows.find((r) => r.clave === 'energia_kcal');
  const [lun, dom, antes] = ['2026-10-19', '2026-10-18', '2026-09-01'].map(kcalDe);
  assert.deepEqual([lun.valor, lun.origen], [3100, 'tipo']);
  assert.deepEqual([dom.valor, dom.origen], [2700, 'tipo']);
  assert.deepEqual([antes.valor, antes.origen], [2000, 'referencia']);
  assert.equal(lun.total, dom.total);
  assert.ok(lun.pct < dom.pct);
});

// ---------- cualquier número de tipos de día ----------
const CUATRO = PLAN({
  periodos: [P({
    peso_kg: 75,
    tipos: {
      fuerza: { nombre: 'Fuerza', valores: { energia_kcal: { objetivo: 2900 } } },
      pierna: { nombre: 'Pierna', valores: { energia_kcal: { objetivo: 3000 } } },
      rh_movilidad: { nombre: 'RH + movilidad', valores: { energia_kcal: { objetivo: 2600 } } },
      descanso: { nombre: 'Descanso', valores: { energia_kcal: { objetivo: 2400 } } },
    },
    semana: { lun: 'fuerza', mar: 'pierna', mie: 'fuerza', jue: 'pierna', vie: 'fuerza', sab: 'rh_movilidad', dom: 'descanso' },
  })],
});

test('el segundo ejemplo del formato (tres tipos) es válido: el sábado es «RH + movilidad»', () => {
  const r = parsePlan(EJEMPLO_SEMANA, ctx);
  assert.deepEqual([r.ok, r.errors, r.avisos], [true, [], []]);
  const sab = en(r.plan, '2026-10-24');
  assert.deepEqual(sab.tipoDia, { clave: 'rh_movilidad', nombre: 'RH + movilidad', origen: 'semana' });
  assert.deepEqual(lim(sab, 'energia_kcal'), [null, 2600, null, 'tipo']);
  assert.deepEqual(lim(sab, 'hidratos_g'), [null, 300, null, 'tipo']);
  assert.deepEqual(lim(sab, 'proteina_g'), [135, null, null, 'periodo']);
  assert.deepEqual(lim(sab, 'grasa_total_g'), [null, 70, null, 'referencia']);
  assert.deepEqual(['2026-10-19', '2026-10-23', '2026-10-25'].map((f) => en(r.plan, f).tipoDia.nombre), ['Fuerza', 'Fuerza', 'Descanso']);
});

test('cuatro tipos de día: cada día de la semana con el suyo; la excepción y la edición valen para cualquiera', () => {
  assert.deepEqual(validatePlan(CUATRO, ctx).errors, []);
  const semana = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map((f) => {
    const r = en(CUATRO, f);
    return [r.tipoDia.nombre, r.kcal];
  });
  assert.deepEqual(semana, [['Fuerza', 2900], ['Pierna', 3000], ['Fuerza', 2900], ['Pierna', 3000], ['Fuerza', 2900], ['RH + movilidad', 2600], ['Descanso', 2400]]);
  const movido = setDayType(CUATRO, '2026-10-24', 'pierna');
  assert.deepEqual(en(movido, '2026-10-24').tipoDia, { clave: 'pierna', nombre: 'Pierna', origen: 'excepcion' });
  const editado = editPeriod(CUATRO, { fecha: '2026-10-24', capa: 'rh_movilidad', valores: { energia_kcal: { objetivo: 2700 } } }).plan;
  assert.deepEqual(validatePlan(editado, ctx).errors, []);
  assert.deepEqual(['2026-10-17', '2026-10-24'].map((f) => en(editado, f).kcal), [2600, 2700]); // desde hoy: el sábado anterior igual
  assert.equal(en(editado, '2026-10-24').tipoDia.nombre, 'RH + movilidad');
});

test('«Crear plan»: periodo abierto desde hoy con la referencia explícita y tus tres tipos de día', () => {
  const plan = planDeReferencia({ fecha: '2026-10-18', perfil: 'hombre', ...ctx });
  assert.deepEqual(validatePlan(plan, ctx), { ok: true, plan, errors: [], avisos: [] });
  assert.equal(plan.perfil, 'hombre');
  const [p] = plan.periodos;
  assert.deepEqual([plan.periodos.length, p.id, p.nombre, p.inicio, p.fin], [1, 'objetivos_20261018', 'Mis objetivos', '2026-10-18', undefined]);
  // todos los objetivos de targets.json, escritos con su valor de referencia
  assert.deepEqual(Object.keys(p.valores), targets.list.map((t) => t.clave));
  assert.deepEqual(p.valores.energia_kcal, { objetivo: 2000 });
  assert.deepEqual(p.valores.proteina_g, { min: 50 });
  assert.deepEqual(p.valores.sodio_mg, { max: 2000 });
  assert.deepEqual(p.valores.hierro_mg, { min: 11 });
  assert.deepEqual(p.valores.vitamina_b1_mg, { min: 0.84 }); // ya calculada: no depende de las kcal
  assert.deepEqual(p.valores.epa_dha, { min: 0.25 });
  // los tres tipos, con kcal y macros de referencia, y la semana
  assert.deepEqual(Object.entries(p.tipos).map(([k, x]) => [k, x.nombre]), [['fuerza', 'Fuerza'], ['rh_movilidad', 'RH + movilidad'], ['descanso', 'Descanso']]);
  assert.deepEqual(p.tipos.rh_movilidad.valores, { energia_kcal: { objetivo: 2000 }, proteina_g: { min: 50 }, hidratos_g: { objetivo: 260 }, grasa_total_g: { objetivo: 70 } });
  assert.deepEqual(p.semana, { lun: 'fuerza', mar: 'fuerza', mie: 'fuerza', jue: 'fuerza', vie: 'fuerza', sab: 'rh_movilidad', dom: 'descanso' });
  assert.equal(TIPOS_SEMANA.length, 3);
  // los objetivos del día son los mismos que la referencia
  const ref = en(null, '2026-10-19');
  const creado = en(plan, '2026-10-19');
  assert.deepEqual(creado.list.map((t) => [t.clave, t.min, t.objetivo, t.max, t.ul]), ref.list.map((t) => [t.clave, t.min, t.objetivo, t.max, t.ul]));
  assert.deepEqual([creado.tipoDia.nombre, en(plan, '2026-10-24').tipoDia.nombre, en(plan, '2026-10-25').tipoDia.nombre], ['Fuerza', 'RH + movilidad', 'Descanso']);
  // perfil mujer: sus valores
  assert.deepEqual(planDeReferencia({ fecha: '2026-10-18', perfil: 'mujer', ...ctx }).periodos[0].valores.hierro_mg, { min: 16 });
  assert.equal(planDeReferencia({ fecha: '2026-10-18', perfil: 'marciano', ...ctx }).perfil, 'hombre');
});

test('regresión: lo escrito en la unidad de la columna no se redondea (0,25 g de EPA + DHA no pasa a 0,3)', () => {
  const plan = PLAN({ periodos: [P({ peso_kg: 74.5, valores: { epa_dha: { min: 0.25 }, ala_g: { min: 1.11 }, fibra_g: { objetivo: 32.75 }, proteina_g: { unidad: 'g/kg', min: 1.85 } } })] });
  const r = en(plan, '2026-10-18');
  assert.deepEqual([lim(r, 'epa_dha')[0], lim(r, 'ala_g')[0], lim(r, 'fibra_g')[1]], [0.25, 1.11, 32.75]);
  assert.equal(lim(r, 'proteina_g')[0], 137.8); // convertido (1,85 × 74,5 = 137,825): se redondea a 1 decimal
});
