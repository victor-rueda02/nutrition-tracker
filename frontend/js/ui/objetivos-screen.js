// Pantalla "Objetivos": tu plan de objetivos (docs/OBJETIVOS-FORMATO.md). Qué aplica hoy (periodo, tipo de día y
// valores con su origen), «Hoy es: Entreno / Descanso», edición sencilla de kcal, macros y peso del periodo vigente
// («desde hoy» por defecto, para no cambiar los días pasados) e importar y exportar el plan (JSON).
// La lógica está en core/targets-plan.js; estilos propios en css/objetivos.css.
import {
  parsePlan, validatePlan, targetsForDate, dayContext, editPeriod, setDayType, setPerfil, planToJSON, nombreTipo, unidadesPara, LIMITES,
} from '../core/targets-plan.js';
import { parseNumber } from '../core/numbers.js';

const EDITABLES = ['energia_kcal', 'proteina_g', 'hidratos_g', 'grasa_total_g'];
const LIMITE_TEXT = { min: 'Mínimo', objetivo: 'Objetivo', max: 'Máximo' };
const ORIGEN_TEXT = { excepcion: 'excepción del día', periodo: 'periodo', referencia: 'EFSA' };
const UNIDAD_TEXT = { 'g/kg': 'g/kg de peso', 'kcal/kg': 'kcal/kg de peso', '%kcal': '% de las kcal' };
const numTexto = (v) => (v === undefined || v === null ? '' : String(v).replace('.', ','));
const fechaCorta = (f) => f.split('-').reverse().join('-');

// ui: { h, state, store, targets, catalog, track, render, header, back, today, saveFile, readFile, MACROS, UNIT_LABEL,
//       fmtNum, fmtQty }
export function objetivosScreen(ui) {
  const { h, state, targets, catalog } = ui;
  const o = (state.obj ??= { capa: 'periodo', modo: 'desde_hoy', importe: null, msg: '', errores: [] });
  const hoy = ui.today();
  const t = targetsForDate(hoy, { plan: state.plan, targets, catalog });
  const d = dayContext(state.plan, hoy);
  const periodo = d.periodo;
  if (o.capa !== 'periodo' && !periodo?.tipos?.[o.capa]) o.capa = 'periodo';

  const guardar = (plan, msg) => ui.track((async () => {
    const v = validatePlan(plan, { targets, catalog });
    if (!v.ok) { o.errores = v.errors; o.msg = ''; ui.render(); return; }
    state.plan = v.plan;
    await ui.store.setSetting('plan_objetivos', v.plan);
    o.errores = []; o.msg = msg; ui.render();
  })(), 'No se pudo guardar el plan');

  // ---------- texto de un objetivo ----------
  const unitLabel = (u) => ui.UNIT_LABEL[u] ?? u;
  const limitesTexto = (x) => {
    if (x.tipo === null) return 'sin objetivo';
    const q = (v) => ui.fmtQty(v, x.unit);
    const { min, objetivo, max } = x;
    if (objetivo !== null) {
      const extra = [min !== null ? `al menos ${q(min)}` : '', max !== null ? `como mucho ${q(max)}` : ''].filter(Boolean).join(', ');
      return extra ? `${q(objetivo)} (${extra})` : q(objetivo);
    }
    if (min !== null && max !== null) return `entre ${ui.fmtNum(min, x.unit)} y ${q(max)}`;
    return min !== null ? `al menos ${q(min)}` : `como mucho ${q(max)}`;
  };
  const enUnidad = (x) => {
    const u = x.entrada?.unidad;
    if (!UNIDAD_TEXT[u]) return '';
    return ` · ${LIMITES.filter((k) => typeof x.entrada[k] === 'number').map((k) => numTexto(x.entrada[k])).join('–')} ${u}`;
  };
  const origenTexto = (x) => (x.origen === 'tipo' ? `tipo «${t.tipoDia?.nombre}»` : ORIGEN_TEXT[x.origen]);
  const fila = (x) => h('li', { class: `objetivo-hoy k-${x.clave}`, 'data-clave': x.clave },
    h('span', { class: 'objetivo-label' }, x.label),
    h('span', { class: 'objetivo-valor' }, limitesTexto(x), h('span', { class: 'muted small' }, enUnidad(x))),
    h('span', { class: x.origen === 'referencia' ? 'objetivo-origen muted small' : 'objetivo-origen small' }, origenTexto(x)));

  // ---------- hoy ----------
  const hoyEs = () => {
    if (!periodo?.tipos || !Object.keys(periodo.tipos).length) return null;
    const porSemana = d.tipoSemana ? nombreTipo(periodo, d.tipoSemana) : 'sin tipo';
    const actual = d.excepcion?.tipo && periodo.tipos[d.excepcion.tipo] ? d.excepcion.tipo : '';
    return h('label', {}, 'Hoy es',
      h('select', { 'aria-label': 'Hoy es', onchange: (e) => guardar(setDayType(state.plan, hoy, e.target.value || null), e.target.value ? `Hoy: ${nombreTipo(periodo, e.target.value)}.` : 'Hoy: según la semana.') },
        h('option', { value: '', selected: actual === '' }, `Según la semana (${porSemana})`),
        Object.keys(periodo.tipos).map((k) => h('option', { value: k, selected: k === actual }, nombreTipo(periodo, k)))));
  };
  const macros = t.list.filter((x) => ui.MACROS.includes(x.clave));
  const micros = t.list.filter((x) => !ui.MACROS.includes(x.clave));
  const deTuPlan = micros.filter((x) => x.origen !== 'referencia').length;
  const notasHoy = [t.peso_kg !== null ? `Peso: ${numTexto(t.peso_kg)} kg` : '', t.excepcion ? `Excepción de hoy${t.excepcion.nota ? `: ${t.excepcion.nota}` : ''}` : ''].filter(Boolean);
  const seccionHoy = h('section', { class: 'panel objetivos-hoy', 'aria-label': 'Hoy' },
    h('h2', {}, 'Hoy'),
    h('p', {}, periodo
      ? [h('strong', {}, periodo.nombre), ` · desde el ${fechaCorta(periodo.inicio)}${periodo.fin ? ` hasta el ${fechaCorta(periodo.fin)}` : ''}`, t.tipoDia ? ` · ${t.tipoDia.nombre}` : '']
      : 'Ningún periodo de tu plan cubre hoy: se usan las referencias EFSA.'),
    notasHoy.length ? h('p', { class: 'muted small' }, notasHoy.join(' · ')) : null,
    hoyEs(),
    h('ul', { class: 'objetivos-lista' }, macros.map(fila)),
    h('details', {}, h('summary', {}, `Micronutrientes (${deTuPlan ? `${deTuPlan} de tu plan, ` : ''}el resto EFSA)`),
      h('ul', { class: 'objetivos-lista' }, micros.map(fila))),
    h('p', { class: 'muted small' }, 'Los UL (máximo tolerable) siempre son los de la EFSA. El Diario evalúa cada día con los objetivos de ese día.'));

  // ---------- editar kcal y macros ----------
  const capaValores = () => (o.capa === 'periodo' ? periodo?.valores : periodo?.tipos?.[o.capa]?.valores) ?? {};
  const campos = new Map();
  const editorMacro = (clave) => {
    const info = t.list.find((x) => x.clave === clave);
    const entrada = capaValores()[clave];
    const unidades = unidadesPara(clave, info.unit).filter((u) => u && u !== 'µg');
    const unidad = typeof entrada?.unidad === 'string' && unidades.includes(entrada.unidad) ? entrada.unidad : info.unit;
    const sel = h('select', { 'aria-label': `Unidad de ${info.label}` }, unidades.map((u) => h('option', { value: u, selected: u === unidad }, unitLabel(u))));
    const inputs = Object.fromEntries(LIMITES.map((k) => [k, h('input', { type: 'text', inputmode: 'decimal', 'aria-label': `${info.label}: ${LIMITE_TEXT[k].toLowerCase()}`, value: numTexto(entrada?.[k]) })]));
    campos.set(clave, { sel, inputs, info });
    return h('li', { class: `card k-${clave}` },
      h('div', { class: 'row between' }, h('strong', {}, info.label), h('span', { class: 'unidad' }, sel)),
      h('div', { class: 'row limites' }, LIMITES.map((k) => h('label', {}, h('span', { class: 'small muted' }, LIMITE_TEXT[k]), inputs[k]))),
      h('div', { class: 'small muted' }, entrada === undefined ? `Vacío: ${o.capa === 'periodo' ? 'referencia EFSA' : 'lo del periodo'} (hoy: ${limitesTexto(info)}).` : entrada === null ? 'En tu plan: sin objetivo.' : `Hoy: ${limitesTexto(info)} (${origenTexto(info)}).`));
  };
  const pesoIn = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Peso (kg)', value: numTexto(periodo?.peso_kg) });
  const capaSel = periodo?.tipos && Object.keys(periodo.tipos).length ? h('label', {}, 'Qué valores',
    h('select', { 'aria-label': 'Qué valores', onchange: (e) => { o.capa = e.target.value; ui.render(); } },
      h('option', { value: 'periodo', selected: o.capa === 'periodo' }, 'Por defecto del periodo'),
      Object.keys(periodo.tipos).map((k) => h('option', { value: k, selected: o.capa === k }, `Días de tipo «${nombreTipo(periodo, k)}»`)))) : null;
  const partir = periodo && periodo.inicio < hoy;
  const modoSel = partir ? h('label', {}, 'Aplicar',
    h('select', { 'aria-label': 'Aplicar', onchange: (e) => { o.modo = e.target.value; } },
      h('option', { value: 'desde_hoy', selected: o.modo !== 'todo' }, 'Desde hoy (los días pasados no cambian)'),
      h('option', { value: 'todo', selected: o.modo === 'todo' }, `A todo el periodo (desde el ${fechaCorta(periodo.inicio)})`))) : null;
  const guardarEdicion = () => {
    const malos = [];
    const num = (raw, que) => {
      if (!String(raw).trim()) return undefined;
      const n = parseNumber(raw);
      if (n.status === 'ok' && n.value >= 0) return n.value;
      malos.push(que); return undefined;
    };
    const valores = {};
    for (const [clave, c] of campos) {
      const e = {};
      for (const k of LIMITES) { const v = num(c.inputs[k].value, `${c.info.label} (${LIMITE_TEXT[k].toLowerCase()})`); if (v !== undefined) e[k] = v; }
      if (!LIMITES.some((k) => k in e)) { valores[clave] = null; continue; } // vacío: se quita de esta capa
      valores[clave] = c.sel.value === c.info.unit ? e : { unidad: c.sel.value, ...e };
    }
    const peso = num(pesoIn.value, 'peso');
    if (malos.length) { o.errores = [`Valor no válido en ${malos.join(', ')}.`]; o.msg = ''; ui.render(); return; }
    const modo = partir ? o.modo : 'todo';
    const r = editPeriod(state.plan, { fecha: hoy, capa: o.capa, valores, peso_kg: peso ?? null, modo });
    return guardar(r.plan, modo === 'desde_hoy' ? 'Guardado desde hoy: los días anteriores siguen con los objetivos de antes.' : 'Guardado.');
  };
  const seccionEditar = h('section', { class: 'panel objetivos-editar', 'aria-label': 'Editar kcal y macros' },
    h('h2', {}, 'Kcal y macros'),
    h('p', { class: 'muted small' }, periodo ? `Periodo «${periodo.nombre}». Vacío = sin valor en tu plan.` : 'Sin periodo vigente: al guardar se crea «Mis objetivos» desde hoy. Vacío = referencia EFSA.'),
    capaSel,
    h('label', {}, 'Peso (kg), para g/kg y kcal/kg', pesoIn),
    h('ul', { class: 'cards' }, EDITABLES.map(editorMacro)),
    modoSel,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: guardarEdicion }, 'Guardar')));

  // ---------- el plan: importar, exportar y perfil ----------
  const fileIn = h('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true, 'aria-label': 'Elegir plan de objetivos', onchange: (e) => importar(e.target.files[0]) });
  function importar(file) {
    if (!file) return;
    return ui.track((async () => {
      o.importe = { name: file.name, ...parsePlan(await ui.readFile(file), { targets, catalog }) };
      o.msg = ''; o.errores = []; ui.render();
    })(), 'No se pudo leer el plan');
  }
  const exportar = () => ui.track(ui.saveFile({ name: `nutritiontracker-objetivos-${hoy}.json`, text: planToJSON(state.plan), type: 'application/json' }).then((r) => {
    o.msg = r === 'cancelado' ? 'Exportación cancelada.' : 'Plan exportado.'; ui.render();
  }), 'No se pudo exportar');
  const usarImportado = () => {
    const plan = o.importe.plan;
    o.importe = null; o.capa = 'periodo'; o.modo = 'desde_hoy'; // plan nuevo: se empieza por sus valores por defecto
    return guardar(plan, `Plan importado: ${plan.periodos.length} ${plan.periodos.length === 1 ? 'periodo' : 'periodos'}.`);
  };
  const importeView = (r) => h('section', { class: 'report', 'aria-label': 'Importar plan' },
    r.ok ? h('p', {}, `«${r.name}»: ${r.plan.nombre ?? 'plan'} con ${r.plan.periodos.length} ${r.plan.periodos.length === 1 ? 'periodo' : 'periodos'} y ${r.plan.excepciones.length} ${r.plan.excepciones.length === 1 ? 'excepción' : 'excepciones'}.`)
      : h('p', { class: 'error', role: 'alert' }, `No se puede importar «${r.name}»: ${r.errors.length} ${r.errors.length === 1 ? 'error' : 'errores'}.`),
    r.errors.length ? h('details', { class: 'errors', open: true }, h('summary', {}, `Errores (${r.errors.length})`), h('ul', {}, r.errors.map((e) => h('li', {}, e)))) : null,
    r.avisos.length ? h('details', { class: 'warnings', open: true }, h('summary', {}, `Avisos (${r.avisos.length})`), h('ul', {}, r.avisos.map((e) => h('li', {}, e)))) : null,
    r.ok && state.plan ? h('p', { class: 'muted small' }, 'Sustituye al plan que tienes en este dispositivo (expórtalo antes si quieres conservarlo).') : null,
    h('div', { class: 'row' },
      r.ok ? h('button', { class: 'primary', onclick: usarImportado }, 'Usar este plan') : null,
      h('button', { class: 'link', onclick: () => { o.importe = null; ui.render(); } }, r.ok ? 'Cancelar' : 'Cerrar')));
  const perfilSel = h('select', { 'aria-label': 'Perfil de referencia', onchange: (e) => guardar(setPerfil(state.plan, e.target.value), 'Perfil guardado.') },
    Object.entries(targets.perfiles).map(([k, label]) => h('option', { value: k, selected: k === t.perfil }, label)));
  const periodos = [...(state.plan?.periodos ?? [])].sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  const seccionPlan = h('section', { class: 'panel objetivos-plan', 'aria-label': 'Plan de objetivos' },
    h('h2', {}, 'Plan'),
    h('p', {}, state.plan ? `${state.plan.nombre ?? 'Plan'}: ${periodos.length} ${periodos.length === 1 ? 'periodo' : 'periodos'}, ${state.plan.excepciones.length} ${state.plan.excepciones.length === 1 ? 'excepción' : 'excepciones'}.` : 'Sin plan: se usan las referencias EFSA.'),
    periodos.length ? h('ul', { class: 'lines' }, periodos.map((p) => h('li', { class: p === periodo ? 'line vigente' : 'line' },
      h('span', { class: 'line-name' }, p.nombre, p === periodo ? h('span', { class: 'tag' }, 'vigente') : null), h('span', { class: 'sep' }, ' · '),
      h('span', { class: 'line-grams' }, `${fechaCorta(p.inicio)} → ${p.fin ? fechaCorta(p.fin) : 'sin fin'}`)))) : null,
    h('label', {}, 'Perfil de referencia (EFSA)', perfilSel),
    h('div', { class: 'row wrap' },
      h('button', { class: 'secondary', onclick: () => fileIn.click() }, 'Importar plan'), fileIn,
      h('button', { class: 'secondary', disabled: !state.plan, onclick: exportar }, 'Exportar plan')),
    o.importe ? importeView(o.importe) : null,
    h('p', { class: 'muted small' }, 'El formato está en docs/OBJETIVOS-FORMATO.md del repositorio: puedes redactar tu plan con otro asistente e importarlo aquí.'));

  return h('main', { class: 'objetivos' },
    ui.header('Objetivos', () => { o.importe = null; o.msg = ''; o.errores = []; ui.back(); }),
    o.msg ? h('p', { class: 'ok', role: 'status' }, o.msg) : null,
    o.errores.length ? h('section', { class: 'report', role: 'alert' }, h('p', { class: 'error' }, 'No guardado:'), h('ul', { class: 'small' }, o.errores.map((e) => h('li', {}, e)))) : null,
    seccionHoy, seccionEditar, seccionPlan);
}
