// Pantallas de Inventario, Recuento, ficha de un alimento, Dudas y Lista de la compra. Solo presentación: cada acción la decide
// app.js (ui/inventario-actions.js) y todo el cálculo está en core/inventario.js. Estilos propios en css/inventario.css.
// ui: { h, doc, state, byId, header, a (acciones), shortDate, back (de cada pantalla, ver app.js) }
import { MOTIVOS_DUDA } from '../core/tickets.js';
import { agruparAlimentos, textoStock, textoCantidad, descripcionCompra, textoListaCompra, listaDias, historialDe, fechaCorta } from '../core/inventario-vista.js';
import { icon } from './nav.js';

const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const nombreDe = (ui) => (id) => ui.byId().get(id)?.nombre ?? id;
const masGrupo = (ui, ids) => agruparAlimentos(ids, ui.state.inv.vista.grupos, nombreDe(ui));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const aviso = (ui) => (ui.state.inv.msg ? ui.h('p', { class: 'ok', role: 'status' }, ui.state.inv.msg) : null);
const copiaDieta = (ui) => (ui.state.inv.dietaCopia ? ui.h('p', { class: 'muted small' }, 'Sin conexión: se usa la última dieta descargada; puede no ser la más reciente.') : null);

// ---------- Inventario ----------
export function inventarioScreen(ui) {
  const { h, state, a } = ui;
  const inv = state.inv;
  const v = inv.vista;
  const nDudas = inv.data.dudas.length;
  const nombre = nombreDe(ui);

  const panelSubir = () => {
    const s = inv.subir;
    const file = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, 'aria-label': 'Elegir el PDF del ticket', onchange: (e) => a.subirPdf(e.target.files[0]) });
    const ta = h('textarea', { class: 'dictado ticket-texto', rows: '5', placeholder: 'Pega aquí el texto del ticket…', 'aria-label': 'Texto del ticket', value: s.texto ?? '', oninput: (e) => a.setTextoSubir(e.target.value) });
    return h('section', { class: 'panel subir-ticket', 'aria-label': 'Subir un ticket' },
      h('h2', {}, 'Subir un ticket'),
      h('p', { class: 'muted small' }, 'El PDF se lee en este dispositivo; al Worker solo viaja el texto del ticket. Sin conexión, se aplica aquí mismo.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', onclick: () => file.click() }, 'Elegir el PDF del ticket'), file),
      s.error ? h('p', { class: 'error', role: 'alert' }, s.error) : null,
      h('label', {}, 'Pegar el texto del ticket', ta),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: a.subirTexto }, 'Aplicar el texto'), h('button', { type: 'button', class: 'link', onclick: a.cerrarSubir }, 'Cerrar')));
  };

  const preguntas = inv.preguntas.map((p) => h('section', { class: 'panel pregunta-ticket', role: 'alert' },
    h('p', {}, h('strong', {}, `¿Es el mismo ticket que el del ${fechaCorta(`${p.ticket.fecha}${p.ticket.hora ? `T${p.ticket.hora}` : ''}`)}?`)),
    h('p', { class: 'muted small' }, `Tiene la misma fecha y hora que uno ya aplicado (${plural(p.ticket.lineas.length, 'línea', 'líneas')}). Si es el mismo, no se suma otra vez.`),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', onclick: () => a.responderDuplicado(p.ticket.hash, true) }, 'Sí, es el mismo'),
      h('button', { type: 'button', class: 'secondary', onclick: () => a.responderDuplicado(p.ticket.hash, false) }, 'No, aplicarlo'))));

  const fila = (id) => {
    const s = v.stock[id];
    const t = textoStock(s, v.envases[id] ?? null);
    return h('li', { class: `inv-fila ${t.estado}`, 'data-id': id },
      h('button', { type: 'button', class: 'inv-abre', 'aria-label': `Ver ${nombre(id)}`, onclick: () => a.abrirFicha(id) },
        h('span', { class: 'inv-nombre' }, nombre(id)),
        h('span', { class: 'inv-stock' }, t.texto),
        t.hoy ? h('span', { class: 'inv-hoy muted small' }, t.hoy) : null,
        icon(ui.doc, 'chevron', 'inv-chev')));
  };

  return h('main', { class: 'inventario' },
    ui.header('Inventario', ui.back),
    aviso(ui),
    ...preguntas,
    inv.subir ? panelSubir() : null,
    h('section', { class: 'panel inv-acciones' },
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', class: 'primary', disabled: inv.sincronizando, onclick: a.sincronizar }, inv.sincronizando ? 'Sincronizando…' : 'Sincronizar inventario'),
        h('button', { type: 'button', class: 'secondary', onclick: a.abrirSubir }, 'Subir ticket'),
        nDudas ? h('button', { type: 'button', class: 'secondary', onclick: () => a.abrirDudas('inventario') }, `Dudas (${nDudas})`) : null,
        h('button', { type: 'button', class: 'secondary', onclick: () => a.abrirRecuento(null) }, 'Hacer recuento'),
        h('button', { type: 'button', class: 'secondary', onclick: () => a.abrirCompra('inventario') }, 'Lista de la compra'))),
    copiaDieta(ui),
    v.conjunto.length === 0 ? h('p', { class: 'muted' }, 'La dieta no tiene alimentos que seguir.') : masGrupo(ui, v.conjunto).map((g) => h('section', { class: 'card inv-grupo' },
      h('h2', {}, g.nombre), h('ul', { class: 'inv-lista' }, g.ids.map(fila)))),
    h('p', { class: 'muted small' }, 'El stock sale del último recuento, más lo comprado, menos lo que registras en el Diario (se resta cada día a las 00:00). Un alimento «sin contar» no se calcula: cuéntalo en «Hacer recuento».'));
}

// ---------- Recuento ----------
export function recuentoScreen(ui) {
  const { h, state, a } = ui;
  const inv = state.inv;
  const v = inv.vista;
  const r = inv.recuento;
  const nombre = nombreDe(ui);
  const ids = r.soloId ? [r.soloId] : v.conjunto;

  const fila = (id) => {
    const env = v.envases[id] ?? null;
    const val = r.valores[id] ?? { g: '', env: '' };
    const g = h('input', { type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': `Gramos de ${nombre(id)}`, value: val.g,
      oninput: (e) => a.setValor(id, 'g', e.target.value) });
    const unidades = env ? h('input', { type: 'text', inputmode: 'decimal', class: 'grams envases', 'aria-label': `Envases de ${nombre(id)} (${env.nombre})`, value: val.env,
      oninput: (e) => {
        a.setValor(id, 'env', e.target.value);
        const n = Number(String(e.target.value).replace(',', '.'));
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0) { const gr = Math.round(n * env.gramos * 1000) / 1000; g.value = String(gr).replace('.', ','); a.setValor(id, 'g', g.value); }
      } }) : null;
    const s = v.stock[id];
    return h('li', { class: 'rec-fila', 'data-id': id },
      h('div', { class: 'rec-nombre' }, h('strong', {}, nombre(id)), h('small', { class: 'muted' }, `ahora: ${textoStock(s, env).texto}`)),
      h('div', { class: 'row rec-campos' }, g, h('span', {}, 'g'), unidades, unidades ? h('span', { class: 'muted small' }, `${env.unidad}s de ${textoCantidad(env.gramos)}`) : null));
  };

  return h('main', { class: 'inventario recuento' },
    ui.header(r.soloId ? `Recontar: ${nombre(r.soloId)}` : 'Recuento', ui.back),
    h('p', { class: 'muted' }, 'Cuenta lo que hay ahora, con lo registrado hoy ya comido.'),
    h('p', { class: 'muted small' }, 'Un campo vacío = no se cuenta (no se pone a 0). Un 0 escrito sí es un 0 real. Si hay envase, escribe los envases y los gramos se rellenan.'),
    r.error ? h('p', { class: 'error', role: 'alert' }, r.error) : null,
    masGrupo(ui, ids).map((g) => h('section', { class: 'card inv-grupo' }, h('h2', {}, g.nombre), h('ul', { class: 'inv-lista' }, g.ids.map(fila)))),
    h('footer', { class: 'bar' }, h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', onclick: a.guardarRecuento }, 'Guardar recuento'),
      h('button', { type: 'button', class: 'link', onclick: ui.back }, 'Cancelar'))));
}

// ---------- ficha de un alimento ----------
export function fichaScreen(ui) {
  const { h, state, a } = ui;
  const inv = state.inv;
  const v = inv.vista;
  const f = inv.ficha;
  const id = f.foodId;
  const s = v.stock[id];
  const env = v.envases[id] ?? null;
  const t = textoStock(s, env);
  const hist = historialDe(inv.data, id);

  const desglose = s?.contado ? h('ul', { class: 'inv-desglose small' },
    h('li', {}, `Último recuento: ${textoCantidad(s.recuento.gramos)} (${fechaCorta(s.recuento.momento)})`),
    s.comprado ? h('li', {}, `Comprado desde entonces: +${textoCantidad(s.comprado)}`) : null,
    s.ajustado ? h('li', {}, `Ajustes desde entonces: ${s.ajustado < 0 ? '−' : '+'}${textoCantidad(Math.abs(s.ajustado))}`) : null,
    h('li', {}, `Restado hasta ayer: −${textoCantidad(s.consumido)}`),
    h('li', {}, `Registrado hoy (se resta a las 00:00): ${textoCantidad(s.registradoHoy)}`)) : h('p', { class: 'muted small' }, 'Aún no hay recuento de este alimento: cuéntalo para que se calcule.');

  const formAjuste = () => {
    const g = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Gramos a sumar o restar', placeholder: 'Por ejemplo −200', value: f.gramos, oninput: (e) => a.setFicha({ gramos: e.target.value }) });
    const m = h('input', { type: 'text', 'aria-label': 'Motivo del ajuste', placeholder: 'Motivo (caducado, regalo…)', maxlength: '60', value: f.motivo, oninput: (e) => a.setFicha({ motivo: e.target.value }) });
    return h('div', { class: 'ajuste-form' },
      h('label', {}, 'Gramos (+ suma, − resta)', g), h('label', {}, 'Motivo', m),
      f.error ? h('p', { class: 'error small', role: 'alert' }, f.error) : null,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', onclick: a.ajustar }, 'Guardar ajuste'),
        h('button', { type: 'button', class: 'link', onclick: () => { a.setFicha({ abierto: false, gramos: '', motivo: '' }); ui.render(); } }, 'Cancelar')));
  };

  const evento = (e) => h('li', { class: 'inv-evento', 'data-id': e.id },
    h('span', { class: 'ev-fecha muted small' }, fechaCorta(e.momento)), h('span', { class: 'ev-texto' }, e.texto),
    f.borrar === e.id
      ? h('span', { class: 'confirm-delete', role: 'group', 'aria-label': 'Confirmar borrado' },
        h('span', { class: 'small' }, e.tipo === 'compra' ? '¿Borrar esta compra? (el ticket no vuelve a sumarse) ' : '¿Borrar? '),
        h('button', { type: 'button', class: 'danger', onclick: () => a.borrarEvento(e.id) }, 'Sí, borrar'),
        h('button', { type: 'button', class: 'link', onclick: () => { a.setFicha({ borrar: null }); ui.render(); } }, 'Cancelar'))
      : h('button', { type: 'button', class: 'link danger', 'aria-label': `Borrar: ${e.texto}`, onclick: () => a.pedirBorrar(e.id) }, 'Borrar'));

  return h('main', { class: 'inventario ficha' },
    ui.header(nombreDe(ui)(id), () => { state.screen = 'inventario'; ui.render(); }),
    aviso(ui),
    h('section', { class: 'panel' },
      h('p', { class: 'inv-stock-grande' }, h('strong', {}, t.texto)),
      t.hoy ? h('p', { class: 'muted small' }, t.hoy) : null,
      desglose,
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', class: 'primary', onclick: () => a.abrirRecuento(id, 'ficha') }, 'Recontar'),
        h('button', { type: 'button', class: 'secondary', 'aria-expanded': String(f.abierto), onclick: () => { a.setFicha({ abierto: !f.abierto }); ui.render(); } }, 'Ajustar')),
      f.abierto ? formAjuste() : null),
    h('section', { class: 'panel' }, h('h2', {}, 'Historial'),
      hist.length ? h('ul', { class: 'inv-historial' }, hist.map(evento)) : h('p', { class: 'muted' }, 'Sin recuentos, compras ni ajustes.')),
    s?.consumos?.length ? h('section', { class: 'panel' }, h('h2', {}, 'Consumo desde el último recuento'),
      h('ul', { class: 'inv-historial' }, [...s.consumos].reverse().map((c) => h('li', { class: 'inv-evento' }, h('span', { class: 'ev-fecha muted small' }, fechaCorta(c.fecha)), h('span', { class: 'ev-texto' }, `−${textoCantidad(c.gramos)}`))))) : null);
}

// ---------- Dudas ----------
export function dudasScreen(ui) {
  const { h, state, a } = ui;
  const inv = state.inv;
  const v = inv.vista;
  const nombre = nombreDe(ui);

  const tarjeta = (d) => {
    const f = a.formDeDuda(d);
    const g = h('input', { type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': `Gramos comprados de «${d.descripcion}»`, value: f.gramos, oninput: (e) => a.setDuda(d, { gramos: e.target.value }) });
    const cand = (id) => h('button', { type: 'button', class: 'secondary candidato', 'aria-pressed': String(f.food_id === id), onclick: () => { a.setDuda(d, { food_id: id }); ui.render(); } }, nombre(id));
    const otros = v.conjunto.filter((id) => !d.candidatos.includes(id));
    const sel = h('select', { 'aria-label': 'Otro alimento de tu dieta', onchange: (e) => { if (e.target.value) { a.setDuda(d, { food_id: e.target.value }); ui.render(); } } },
      h('option', { value: '' }, 'Otro alimento de tu dieta…'), otros.map((id) => h('option', { value: id }, nombre(id))));
    const cantidad = [d.cantidad != null ? `cantidad ${d.cantidad}` : null, d.peso_kg ? `${nf1.format(d.peso_kg)} kg` : null].filter(Boolean).join(' · ');
    return h('li', { class: 'card duda', 'data-id': d.id },
      h('div', { class: 'duda-texto' }, h('strong', {}, d.descripcion)),
      h('div', { class: 'muted small' }, `Ticket del ${fechaCorta(d.fecha ?? inv.data.tickets[d.ticket]?.fecha ?? '')}${cantidad ? ` · ${cantidad}` : ''}`),
      h('div', { class: 'flag' }, MOTIVOS_DUDA[d.motivo] ?? d.motivo),
      h('div', { class: 'candidatos', role: 'group', 'aria-label': 'Qué alimento es' }, d.candidatos.map(cand)),
      otros.length ? sel : null,
      h('label', {}, 'Gramos comprados (brutos)', h('div', { class: 'row' }, g, h('span', {}, 'g'))),
      h('p', { class: 'muted small' }, 'Pon el peso tal cual (con cáscara, piel o hueso): la app cuenta solo la parte comestible.'),
      h('label', { class: 'row recordar' }, h('input', { type: 'checkbox', checked: f.recordar, onchange: (e) => a.setDuda(d, { recordar: e.target.checked }) }), h('span', {}, 'Recordar para la próxima vez')),
      f.error ? h('p', { class: 'error', role: 'alert' }, f.error) : null,
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', class: 'primary', onclick: () => a.resolver(d) }, 'Sumar la compra'),
        h('button', { type: 'button', class: 'secondary', onclick: () => a.resolver(d, { ignorar: true }) }, 'No es de la dieta')));
  };

  return h('main', { class: 'inventario dudas' },
    ui.header(`Dudas (${inv.data.dudas.length})`, ui.back),
    aviso(ui),
    h('p', { class: 'muted small' }, 'Estas líneas de tickets no suman al inventario hasta que las resuelvas: nunca se adivina.'),
    inv.data.dudas.length ? h('ul', { class: 'cards' }, inv.data.dudas.map(tarjeta)) : h('p', { class: 'muted' }, 'No hay dudas pendientes.'));
}

// ---------- Lista de la compra ----------
export function compraScreen(ui) {
  const { h, state, a } = ui;
  const inv = state.inv;
  const v = inv.vista;
  const lista = a.calcularCompra();
  const nombre = nombreDe(ui);
  const falta = lista.items.filter((i) => i.faltan > 0 && !i.stockDesconocido);
  const sinContar = lista.items.filter((i) => i.faltan > 0 && i.stockDesconocido);
  const deSobra = lista.items.filter((i) => i.faltan === 0).length;
  const sinTodo = lista.sinMenu.length === lista.dias.length;
  const diaTexto = (f) => ui.shortDate(f).replace(',', '').replace(/\s+\S+$/, ''); // «sáb 21» (sin el mes)
  const texto = textoListaCompra({ lista, grupos: v.grupos, nombreDe: nombre, diaTexto });

  const dias = h('input', { type: 'text', inputmode: 'numeric', class: 'grams', 'aria-label': 'Días a cubrir', value: String(inv.horizonte),
    onchange: (e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 60) a.setHorizonte(n); else { e.target.value = String(inv.horizonte); } } });

  const item = (it) => h('li', { class: `compra-item${it.negativo ? ' revisar' : ''}`, 'data-id': it.food_id },
    h('strong', {}, nombre(it.food_id)),
    h('span', { class: 'compra-linea' }, descripcionCompra(it)),
    it.negativo ? h('span', { class: 'muted small' }, 'El stock sale negativo: revisa el recuento.') : null,
    it.stockDesconocido ? h('span', { class: 'muted small' }, 'Stock desconocido: cuéntalo para saber cuánto falta de verdad.') : null);

  return h('main', { class: 'inventario compra' },
    ui.header('Lista de la compra', ui.back),
    aviso(ui),
    h('section', { class: 'panel' },
      h('div', { class: 'row' }, h('label', { class: 'compra-dias' }, 'Días a cubrir', h('span', { class: 'row' }, dias, h('span', {}, 'días')))),
      h('p', { class: 'muted small' }, `Del ${diaTexto(lista.desde)} al ${diaTexto(lista.hasta)}: ${plural(lista.horizonte, 'día', 'días')} + ${plural(lista.margen, 'día', 'días')} de margen. El stock de hoy no se vuelve a restar.`)),
    copiaDieta(ui),
    sinTodo ? h('p', { class: 'error', role: 'alert' }, `Ningún día tiene menú: ${lista.sinMenu[0].error}`)
      : lista.sinMenu.length ? h('p', { class: 'warn small', role: 'status' }, `${listaDias(lista.sinMenu.map((d) => diaTexto(d.fecha)))}: sin menú, no cuentan.`) : null,
    falta.length ? masGrupoItems(ui, falta).map((g) => h('section', { class: 'card inv-grupo' }, h('h2', {}, g.nombre), h('ul', { class: 'inv-lista' }, g.ids.map((id) => item(falta.find((i) => i.food_id === id)))))) : (!sinContar.length && !sinTodo ? h('p', { class: 'ok' }, 'No falta nada para esos días.') : null),
    sinContar.length ? h('section', { class: 'card inv-grupo sin-contar' }, h('h2', {}, 'Stock desconocido (sin contar)'), h('ul', { class: 'inv-lista' }, sinContar.map(item))) : null,
    deSobra && !sinTodo ? h('p', { class: 'muted small' }, `${plural(deSobra, 'alimento', 'alimentos')} con stock de sobra: no ${deSobra === 1 ? 'sale' : 'salen'} en la lista.`) : null,
    h('div', { class: 'row wrap' },
      h('button', { type: 'button', class: 'primary', onclick: () => a.copiarLista(texto) }, 'Copiar lista'),
      h('button', { type: 'button', class: 'secondary', onclick: () => a.compartirLista(texto) }, 'Compartir lista'),
      h('button', { type: 'button', class: 'link', onclick: () => a.abrir('alimentos') }, 'Ver el inventario')));
}
const masGrupoItems = (ui, items) => masGrupo(ui, items.map((i) => i.food_id));
