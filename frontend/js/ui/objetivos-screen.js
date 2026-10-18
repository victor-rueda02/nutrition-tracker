// Pantalla "Objetivos": perfil de referencia (EFSA) y tus kcal, macros y micros, guardados en el dispositivo.
import { resolveTargets, referenceValue } from '../core/targets.js';
import { parseNumber } from '../core/numbers.js';

const TIPO_TEXT = { min: 'al menos', max: 'como mucho', objetivo: 'objetivo' };

// ui: { h, state, root, store, targets, track, render, header, back, MACROS, UNIT_LABEL, nf2, fmtNum, fmtQty }
export function objetivosScreen(ui) {
  const { h, state, targets } = ui;

  // Guarda tus objetivos. Vacío = referencia; un valor no válido no se guarda y se dice cuál.
  async function saveObjetivos(perfil, inputs) {
    const valores = {};
    const malos = [];
    for (const [clave, raw] of Object.entries(inputs)) {
      if (!String(raw).trim()) continue;
      const n = parseNumber(raw);
      if (n.status === 'ok' && n.value > 0) valores[clave] = n.value;
      else malos.push(targets.list.find((t) => t.clave === clave)?.label ?? clave);
    }
    if (malos.length) return { ok: false, msg: `No guardado: valor no válido en ${malos.join(', ')}.` };
    state.objetivos = { perfil, valores };
    await ui.store.setSetting('objetivos', state.objetivos);
    return { ok: true, msg: 'Guardado.' };
  }

  const own = state.objetivos.valores ?? {};
  const perfilActual = resolveTargets(targets, state.objetivos)[0]?.perfil ?? targets.perfilPorDefecto;
  const perfilSel = h('select', { 'aria-label': 'Perfil de referencia' },
    Object.entries(targets.perfiles).map(([k, label]) => h('option', { value: k, selected: k === perfilActual }, label)));
  const inputs = new Map();
  const msg = h('p', { class: 'small', role: 'status' });
  const campo = (t) => {
    const ref = referenceValue(targets, t.clave, { perfil: perfilActual, valores: own });
    const unit = ui.UNIT_LABEL[t.unit] ?? t.unit;
    const input = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': `${t.label} (${unit})`, value: own[t.clave] === undefined ? '' : ui.nf2.format(own[t.clave]).replace(/\./g, ''), placeholder: ref === null ? '' : ui.fmtNum(ref, t.unit) });
    inputs.set(t.clave, input);
    return h('li', { class: `card k-${t.clave}` },
      h('label', {}, h('span', {}, `${t.label} (${unit}) · ${TIPO_TEXT[t.tipo]}`), input),
      h('div', { class: 'small muted' }, [ref === null ? '' : `Referencia: ${ui.fmtQty(ref, t.unit)}`, t.ul !== null ? `UL: ${ui.fmtQty(t.ul, t.unit)}` : '', t.nota].filter(Boolean).join(' · ')));
  };
  const save = (vaciar) => ui.track((async () => {
    const r = await saveObjetivos(perfilSel.value, vaciar ? {} : Object.fromEntries([...inputs].map(([k, el]) => [k, el.value])));
    if (r.ok) { ui.render(); ui.root.querySelector('[role=status]').textContent = r.msg; } else msg.textContent = r.msg;
  })());
  return h('main', {},
    ui.header('Objetivos', ui.back),
    h('label', {}, 'Perfil de referencia (EFSA)', perfilSel),
    h('p', { class: 'muted small' }, 'Vacío = valor de referencia. Tus objetivos se guardan en este dispositivo. B1, niacina y ALA se calculan con tu objetivo de kcal. Los UL no cambian.'),
    h('h2', {}, 'Energía y macros'), h('ul', { class: 'cards' }, targets.list.filter((t) => ui.MACROS.includes(t.clave)).map(campo)),
    h('h2', {}, 'Micronutrientes'), h('ul', { class: 'cards' }, targets.list.filter((t) => !ui.MACROS.includes(t.clave)).map(campo)),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => save(false) }, 'Guardar'), h('button', { class: 'secondary', onclick: () => save(true) }, 'Restablecer')),
    msg);
}
