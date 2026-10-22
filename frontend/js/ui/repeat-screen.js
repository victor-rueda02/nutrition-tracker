// Pantalla "Repetir": comidas de otro día con casilla y gramos, ajuste rápido (−10 −5 +5 +10) y totales en vivo,
// sin IA. "Añadir" guarda directamente: esta pantalla es la confirmación editable (regla 5).
// Estilos propios en css/repeat.css (los globales son de la rama estetica).
import { toggleItem, toggleComida, estadoComida, setItemGrams, nudge, setTarget, repeatTotals, validateRepeat, findItem, PASOS, DESTINO_ORIGEN } from '../core/repeat.js';
import { MEALS } from '../core/meal-defaults.js';
import { MAX_GRAMS } from '../core/ai-contract.js';

const fmtGramos = (g) => (g === null || g === undefined ? '' : String(g).replace('.', ','));
const signo = (d) => `${d > 0 ? '+' : '−'}${Math.abs(d)}`;

// Al tocar el campo se selecciona el número para escribir encima (en iOS hace falta repetirlo tras el foco).
function seleccionar(el) {
  try { el.select(); } catch { /* sin selección */ }
  el.ownerDocument.defaultView.setTimeout(() => { try { el.setSelectionRange(0, el.value.length); } catch { /* sin selección */ } }, 0);
}

// ui: { h, state, byId, header, fmtTotal, nf0, nf1, MEAL_LABEL, dayLabel, today, shiftDate, openRepeat, saveRepeat, back }
export function repeatScreen(ui) {
  const { h, state } = ui;
  const r = state.repeat;
  const totalsEl = h('div', { class: 'totals', role: 'status' });
  const hint = h('div', { class: 'muted small' });
  const addBtn = h('button', { class: 'primary', onclick: () => ui.saveRepeat() }, 'Añadir');

  const mealChecks = new Map(); // comida -> su casilla
  const refrescos = []; // una por alimento: repinta casilla, atenuado y aviso de gramos desde el estado
  const paint = () => {
    const cur = state.repeat;
    const t = repeatTotals(cur, ui.byId());
    const v = validateRepeat(cur);
    // Sin nada marcado no hay total que dar ("sin dato" sería engañoso: no es un alimento sin dato, es que no hay nada).
    totalsEl.textContent = v.empty ? 'Total: nada marcado' : `Total: ${ui.fmtTotal(t, 'energia_kcal', 'kcal', ui.nf0)} · ${ui.fmtTotal(t, 'proteina_g', 'g de proteína', ui.nf1)}`;
    addBtn.disabled = !v.ok;
    addBtn.textContent = v.count ? `Añadir ${v.count} ${v.count === 1 ? 'alimento' : 'alimentos'}` : 'Añadir';
    const code = (c) => v.problems.some((p) => p.code === c);
    for (const [meal, c] of mealChecks) { // casilla de cada comida: vacía, marcada o indeterminada según sus alimentos
      const e = estadoComida(cur, meal);
      c.checked = e === 'all'; c.indeterminate = e === 'some';
    }
    hint.textContent = v.empty ? 'Marca al menos un alimento.' : code('fecha') ? 'La fecha no es válida.' : code('gramos_altos') ? `Más de ${MAX_GRAMS} g en una línea: corrígelo.` : code('sin_gramos') ? 'Pon los gramos de las líneas marcadas.' : '';
  };

  const itemRow = (it) => {
    let row;
    const input = h('input', {
      type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': `Gramos de ${it.nombre}`, value: fmtGramos(it.grams), disabled: !it.known,
      onfocus: (e) => seleccionar(e.target),
      oninput: (e) => { state.repeat = setItemGrams(state.repeat, it.key, e.target.value); marcarMal(); paint(); },
    });
    const marcarMal = () => {
      const cur = findItem(state.repeat, it.key);
      const mal = cur.checked && !(cur.grams > 0 && cur.grams <= MAX_GRAMS);
      input.classList.toggle('bad', mal);
      input.setAttribute('aria-invalid', String(mal));
    };
    const check = h('input', {
      type: 'checkbox', checked: it.checked, disabled: !it.known, 'aria-label': `Añadir ${it.nombre}`,
      onchange: (e) => { state.repeat = toggleItem(state.repeat, it.key, e.target.checked); row.classList.toggle('off', !e.target.checked); marcarMal(); paint(); },
    });
    const boton = (d) => h('button', {
      type: 'button', class: 'nudge', disabled: !it.known, 'aria-label': `${signo(d)} g a ${it.nombre}`,
      onclick: () => { state.repeat = nudge(state.repeat, it.key, d); input.value = fmtGramos(findItem(state.repeat, it.key).grams); marcarMal(); paint(); },
    }, signo(d));
    row = h('li', { class: `repeat-item${it.checked ? '' : ' off'}`, 'data-key': it.key },
      h('label', { class: 'row repeat-name' }, check, h('span', {}, it.nombre), it.known ? null : h('span', { class: 'tag' }, 'ya no está en tu documento')),
      h('div', { class: 'row repeat-qty' }, boton(PASOS[0]), boton(PASOS[1]), input, h('span', {}, 'g'), boton(PASOS[2]), boton(PASOS[3])));
    marcarMal();
    refrescos.push(() => { const cur = findItem(state.repeat, it.key); check.checked = cur.checked; row.classList.toggle('off', !cur.checked); marcarMal(); });
    return row;
  };

  // Casilla de una comida, a la izquierda de su nombre: marca todos sus alimentos si no lo estaban, o desmarca todos.
  const mealCheck = (g) => {
    const c = h('input', {
      type: 'checkbox', class: 'meal-check', disabled: !g.items.some((i) => i.known),
      onchange: () => { state.repeat = toggleComida(state.repeat, g.meal); refrescos.forEach((f) => f()); paint(); },
    });
    mealChecks.set(g.meal, c);
    return h('h2', {}, h('label', { class: 'row repeat-meal-name' }, c, h('span', {}, ui.MEAL_LABEL[g.meal])));
  };

  const irAOrigen = (date) => ui.openRepeat({ sourceDate: date, targetDate: state.repeat.targetDate, targetMeal: state.repeat.targetMeal });
  const dateIn = h('input', { type: 'date', 'aria-label': 'Fecha de destino', value: r.targetDate, max: ui.today(), onchange: (e) => { state.repeat = setTarget(state.repeat, { date: e.target.value }); paint(); } });
  const mealSel = h('select', { 'aria-label': 'Comida de destino', onchange: (e) => { state.repeat = setTarget(state.repeat, { meal: e.target.value }); paint(); } },
    h('option', { value: DESTINO_ORIGEN, selected: r.targetMeal === DESTINO_ORIGEN }, 'Como en el origen'),
    MEALS.map((m) => h('option', { value: m, selected: r.targetMeal === m }, ui.MEAL_LABEL[m])));

  const screen = h('main', { class: 'repeat' },
    ui.header(r.template ? 'Usar plantilla' : 'Repetir', ui.back),
    r.template ? h('p', { class: 'repeat-source' }, h('strong', { class: 'source-label' }, `De: plantilla «${r.template.nombre}»`)) : h('nav', { class: 'row between daynav repeat-source', 'aria-label': 'Día de origen' },
      h('button', { class: 'icon', 'aria-label': 'Día de origen anterior', onclick: () => irAOrigen(ui.shiftDate(r.sourceDate, -1)) }, '‹'),
      h('strong', { class: 'source-label' }, `De: ${ui.dayLabel(r.sourceDate)}`),
      h('button', { class: 'icon', 'aria-label': 'Día de origen siguiente', disabled: r.sourceDate >= ui.today(), onclick: () => irAOrigen(ui.shiftDate(r.sourceDate, 1)) }, '›')),
    r.recordId ? h('p', { class: 'muted small' }, 'Solo la comida que elegiste en el Diario. Con las flechas ves el día entero.') : null,
    r.groups.length === 0 ? h('p', { class: 'muted' }, 'No hay comidas guardadas ese día.') : r.groups.map((g) => h('section', { class: 'card meal repeat-group' },
      h('div', { class: 'row between meal-head' }, mealCheck(g), h('span', { class: 'muted small' }, `${g.items.length} ${g.items.length === 1 ? 'alimento' : 'alimentos'}`)),
      h('ul', { class: 'lines' }, g.items.map(itemRow)))),
    h('section', { class: 'panel repeat-target' }, h('h2', {}, 'Añadir a'), h('label', {}, 'Fecha', dateIn), h('label', {}, 'Comida', mealSel)),
    h('footer', { class: 'bar' }, totalsEl, hint, h('div', { class: 'row' }, addBtn)));
  paint();
  return screen;
}
