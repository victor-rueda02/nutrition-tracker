// Inventario, Dudas y Lista de la compra: las acciones (guardar, sincronizar, subir un ticket, recontar, ajustar, resolver dudas).
// Las pantallas (inventario-screen.js) solo pintan; aquí se decide cada acción y se guarda en el ajuste `inventario`. Toda la
// cuenta está en core/inventario.js y core/tickets.js; esto solo las une con el Worker, el almacén y la dieta. Sin IA: ni el ticket
// ni el inventario ni el Diario viajan a Gemini ni a USDA (regla 6); al Worker solo va el texto del ticket (o sus hashes).
import { inventarioVacio, limpiarInventario, limpiarConfig, alimentosDeLaDieta, calcularStock, listaCompra, anadirRecuentos, anadirAjuste, quitarEvento, ticketAplicado, registrarTicket, momentoLocal } from '../core/inventario.js';
import { aplicarTicket, resolverDuda, parseTicket, indiceParecido, TicketError } from '../core/tickets.js';
import { envasesDeTabla, leerGrupos } from '../core/inventario-vista.js';
import { textoDePdf } from '../core/pdf-texto.js';
import { parseDieta } from '../core/dieta.js';
import { parseNumber } from '../core/numbers.js';
import { madridNow } from '../core/meal-defaults.js';

// Errores del Worker con los que se sigue en local (o, al abrir la app, se calla): sin Worker, sin red o sin cola de tickets.
const SIN_COLA = ['sin_configurar', 'sin_conexion', 'red', 'tickets_sin_configurar', 'worker_antiguo'];
const SILENCIOSOS = ['sin_configurar', 'sin_conexion', 'tickets_sin_configurar', 'worker_antiguo'];
const dos = (n) => String(n).padStart(2, '0');
const traducir = (e) => (e?.userMessage ? new Error(e.userMessage) : e); // el mensaje para Victor, no «codigo: detalle»
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const numero = (raw) => { const v = parseNumber(String(raw ?? '').replace('−', '-')); return v.status === 'ok' ? v.value : null; };

// ctx: { state, deps, track, render, byId, now, saveFile, today, cargarDieta, recetasTodas }
export function inventarioActions(ctx) {
  const { state, deps, track, render, byId, now } = ctx;
  const readBytes = deps.readBytes ?? ((f) => f.arrayBuffer());
  const config = () => limpiarConfig(deps.inventarioConfig);
  state.inv = {
    data: inventarioVacio(), vista: null, dieta: null, msg: '', preguntas: [], subir: null, recuento: null, ficha: null, dudaForm: {},
    horizonte: config().horizonte_dias, back: 'alimentos', compraBack: 'alimentos', sincronizando: false, listoCompra: null,
  };
  const inv = state.inv;
  const momentoAhora = () => { const m = madridNow(now()); return `${m.date}T${dos(Math.floor(m.minutes / 60))}:${dos(m.minutes % 60)}`; };

  // Tareas en segundo plano (al abrir la app): solo repintan donde no hay nada a medias (un borrador, un formulario).
  const repintar = () => { if (['diary', 'alimentos', 'mas', 'inventario', 'dudas', 'compra'].includes(state.screen)) render(); };

  async function guardar(nuevo) {
    await deps.store.setSetting('inventario', nuevo);
    inv.data = nuevo;
  }

  // Al arrancar y al abrir Documento: lo guardado (limpiarInventario nunca lanza) y el horizonte elegido.
  async function cargar() {
    const { inventario, avisos } = limpiarInventario(await deps.store.getSetting('inventario'));
    inv.data = inventario;
    const h = await deps.store.getSetting('inventario_horizonte');
    if (Number.isInteger(h) && h >= 1 && h <= 60) inv.horizonte = h;
    if (avisos.length) inv.msg = avisos.join(' ');
    return inventario;
  }

  // Conjunto de alimentos que se siguen y el stock de cada uno, con la dieta (siempre fresca; sin red, la última copia), el plan y
  // las recetas. La dieta se lee una vez por sesión, salvo que se pida otra vez («Sincronizar»).
  async function contexto({ recargarDieta = false } = {}) {
    if (!inv.dieta || recargarDieta) {
      const { text, copia } = await ctx.cargarDieta();
      const res = parseDieta(text);
      if (!res.ok) throw new Error(`data/dieta.json no es válido: ${res.errores.slice(0, 2).join(' ')}`);
      inv.dieta = res.dieta; inv.dietaCopia = copia;
    }
    const cfg = config();
    const recetas = await ctx.recetasTodas();
    const hoy = ctx.today();
    const conjunto = alimentosDeLaDieta(inv.dieta, recetas, state.plan, hoy, { noSeguidas: cfg.recetas_no_seguidas });
    return { dieta: inv.dieta, recetas, noSeguidas: cfg.recetas_no_seguidas, conjunto, hoy, cfg };
  }

  async function refrescar(opciones) {
    const c = await contexto(opciones);
    const registros = await deps.store.allMeals();
    const stock = calcularStock(inv.data, registros, { conjunto: c.conjunto, recetas: c.recetas, noSeguidas: c.noSeguidas, hoy: c.hoy });
    inv.vista = { ...c, stock, envases: envasesDeTabla(deps.ticketsTabla, byId()), grupos: leerGrupos(deps.inventarioConfig) };
    return inv.vista;
  }

  // ---------- navegación ----------
  const ir = (pantalla, hecho) => track((async () => { await refrescar(); hecho?.(); state.screen = pantalla; state.pendingDelete = null; render(); })(), 'No se pudo abrir el inventario');
  const abrir = (back) => ir('inventario', () => { if (back) inv.back = back; });
  const abrirDudas = (back) => ir('dudas', () => { inv.dudasBack = back ?? 'inventario'; });
  const abrirCompra = (back) => ir('compra', () => { if (back) inv.compraBack = back; });
  const abrirRecuento = (soloId = null, back = 'inventario') => ir('recuento', () => { inv.recuento = { soloId, valores: {}, error: '', back }; });
  const abrirFicha = (foodId) => ir('inv-ficha', () => { inv.ficha = { foodId, abierto: false, gramos: '', motivo: '', error: '', borrar: null }; });
  const cerrar = () => { state.screen = 'inventario'; render(); };

  // ---------- tickets ----------
  const ctxTicket = (c, origen) => ({ tabla: deps.ticketsTabla ?? {}, conjunto: c.conjunto, foodsById: byId(), origen, ahora: now(), ...(deps.idGen ? { id: deps.idGen } : {}) });

  // Aplica tickets ya leídos ({ hash, fecha, hora, lineas, origen? }). `enCola`: vienen de la cola del Worker (hay que acusar recibo).
  // Guarda ANTES de acusar: si el aviso falla, nada se pierde y el siguiente «Sincronizar» lo acusa como «ya aplicado».
  // Un posible duplicado (misma fecha y hora que otro ya aplicado) no se aplica ni se acusa hasta que respondas.
  async function aplicarTickets(tickets, { enCola, ai }) {
    const c = await contexto();
    const indice = indiceParecido(c.conjunto, byId());
    let cur = inv.data;
    const r = { aplicados: 0, yaAplicados: 0, compras: 0, dudas: 0, preguntas: 0 };
    const acusar = [];
    for (const t of tickets) {
      if (!t?.hash || inv.preguntas.some((p) => p.ticket.hash === t.hash)) continue;
      const res = aplicarTicket(cur, t, { ...ctxTicket(c, t.origen === 'correo' ? 'correo' : 'app'), indice });
      if (res.yaAplicado) { r.yaAplicados++; acusar.push(t.hash); continue; }
      if (res.posible_duplicado) { inv.preguntas.push({ ticket: t, otro: res.posible_duplicado, otraFecha: cur.tickets[res.posible_duplicado], enCola }); r.preguntas++; continue; }
      cur = res.inventario;
      r.aplicados++; r.compras += res.compras.length; r.dudas += res.dudas.length;
      acusar.push(t.hash);
    }
    if (cur !== inv.data) await guardar(cur);
    if (enCola && acusar.length) { try { await ai.ticketsRecibidos({ hashes: acusar }); } catch (e) { throw new Error(`Los tickets se han aplicado, pero no se pudo avisar al Worker (${traducir(e).message}); se avisará la próxima vez.`); } }
    return r;
  }

  const resumen = (r) => {
    const partes = [];
    if (r.aplicados) partes.push(`${plural(r.aplicados, 'ticket nuevo', 'tickets nuevos')} (${plural(r.compras, 'compra', 'compras')}${r.dudas ? `, ${plural(r.dudas, 'duda', 'dudas')}` : ''})`);
    if (r.yaAplicados) partes.push(`${plural(r.yaAplicados, 'ticket ya aplicado', 'tickets ya aplicados')}: no se suma otra vez`);
    if (r.preguntas) partes.push(`${plural(r.preguntas, 'ticket', 'tickets')} por confirmar (abajo)`);
    return partes.length ? `Sincronizado: ${partes.join('; ')}.` : 'Sincronizado: no hay tickets nuevos.';
  };

  // «Sincronizar inventario»: recoge la cola del Worker y aplica cada ticket. auto = al abrir la app: sin Worker configurado, sin
  // red o sin cola de tickets (el Worker responde `tickets_sin_configurar`) no dice nada.
  async function sincronizar({ auto = false } = {}) {
    if (inv.sincronizando) return;
    if (!state.conn?.endpoint || !state.conn?.token) {
      if (auto) return;
      throw new Error('Falta configurar la conexión con el Worker (Más → Conexión con la IA).');
    }
    inv.sincronizando = true;
    if (!auto && state.screen === 'inventario') render();
    try {
      const ai = deps.createAiClient(state.conn);
      if (typeof ai?.ticketsPendientes !== 'function') { if (auto) return; throw new Error('Esta conexión no tiene la cola de tickets.'); } // cliente sin cola de tickets
      let cola;
      try { cola = (await ai.ticketsPendientes()).tickets; } catch (e) { if (auto && SILENCIOSOS.includes(e.code)) return; throw traducir(e); }
      const r = cola.length ? await aplicarTickets(cola, { enCola: true, ai }) : { aplicados: 0, yaAplicados: 0, compras: 0, dudas: 0, preguntas: 0 };
      if (!auto || cola.length) inv.msg = resumen(r);
      if (state.screen === 'inventario') await refrescar();
    } finally { inv.sincronizando = false; repintar(); }
  }
  const sincronizarTrack = () => track(sincronizar(), 'No se pudo sincronizar');
  // Al abrir la app (sin bloquear el arranque ni molestar).
  const arrancar = async () => { await cargar(); await sincronizar({ auto: true }); repintar(); };

  // ¿Es el mismo ticket? Sí: no se aplica y se marca como recibido. No: se aplica.
  const responderDuplicado = (hash, esElMismo) => track((async () => {
    const p = inv.preguntas.find((x) => x.ticket.hash === hash);
    if (!p) return;
    inv.preguntas = inv.preguntas.filter((x) => x !== p);
    const c = await contexto();
    let cur = inv.data;
    if (esElMismo) cur = registrarTicket(cur, hash, { fecha: p.ticket.fecha, hora: p.ticket.hora, aplicado: momentoLocal(now()), origen: p.ticket.origen === 'correo' ? 'correo' : 'app' });
    else cur = aplicarTicket(cur, p.ticket, { ...ctxTicket(c, p.ticket.origen === 'correo' ? 'correo' : 'app') }).inventario;
    await guardar(cur);
    if (p.enCola) { try { await deps.createAiClient(state.conn).ticketsRecibidos({ hashes: [hash] }); } catch (e) { throw new Error(`Guardado, pero no se pudo avisar al Worker (${traducir(e).message}); se avisará la próxima vez.`); } }
    inv.msg = esElMismo ? 'Era el mismo ticket: no se ha sumado otra vez.' : 'Ticket aplicado.';
    await refrescar(); render();
  })(), 'No se pudo guardar');

  // Texto de un ticket (de un PDF o pegado): lo valida, y si hay Worker lo sube a su cola y sincroniza (así hay un único camino);
  // sin Worker o sin red se aplica aquí mismo y se avisa.
  async function procesarTexto(texto) {
    let t;
    try { t = await parseTicket(texto); } catch (e) {
      if (!(e instanceof TicketError)) throw e;
      inv.subir = { abierto: true, texto, error: `${e.message} Revisa que has pegado el ticket entero.` }; render(); return;
    }
    if (ticketAplicado(inv.data, t.hash)) { inv.subir = null; inv.msg = 'Ticket ya aplicado: no se suma otra vez.'; render(); return; }
    let aviso = '';
    if (state.conn?.endpoint && state.conn?.token) {
      const ai = deps.createAiClient(state.conn);
      try { await ai.subirTicket({ texto }); } catch (e) {
        if (!SIN_COLA.includes(e.code)) throw traducir(e);
        aviso = ` Sin conexión con el Worker (${e.userMessage}): aplicado solo en este dispositivo.`;
      }
      if (!aviso) { inv.subir = null; await sincronizar(); return; }
    } else aviso = ' Sin Worker configurado: aplicado solo en este dispositivo.';
    const r = await aplicarTickets([{ ...t, origen: 'app' }], { enCola: false });
    inv.subir = null;
    inv.msg = `${resumen(r)}${aviso}`;
    await refrescar(); render();
  }

  const abrirSubir = () => { inv.subir = { abierto: true, texto: '', error: '' }; render(); };
  const cerrarSubir = () => { inv.subir = null; render(); };
  const setTextoSubir = (texto) => { inv.subir = { ...(inv.subir ?? { abierto: true }), texto, error: '' }; };
  // PDF elegido: se lee aquí (en el iPhone) y al Worker solo va el texto: así no gasta CPU leyendo el PDF.
  const subirPdf = (file) => (file ? track((async () => {
    let texto;
    try { texto = await textoDePdf(new Uint8Array(await readBytes(file))); } catch (e) {
      inv.subir = { abierto: true, texto: inv.subir?.texto ?? '', error: `No he podido leer ese PDF (${e?.message ?? e}). Pega el texto del ticket aquí abajo.` };
      render(); return;
    }
    await procesarTexto(texto);
  })(), 'No se pudo subir el ticket') : undefined);
  const subirTexto = () => track((async () => {
    const texto = (inv.subir?.texto ?? '').trim();
    if (!texto) { inv.subir = { ...inv.subir, error: 'Pega primero el texto del ticket.' }; render(); return; }
    await procesarTexto(texto);
  })(), 'No se pudo subir el ticket');

  // ---------- recuento y ficha ----------
  const setValor = (id, campo, valor) => { const r = inv.recuento; r.valores[id] = { ...(r.valores[id] ?? { g: '', env: '' }), [campo]: valor }; r.error = ''; };
  // Un campo vacío = no se cuenta (nunca 0 por defecto); «0» escrito es un 0 real.
  const guardarRecuento = () => track((async () => {
    const r = inv.recuento;
    const ids = r.soloId ? [r.soloId] : inv.vista.conjunto;
    const items = [];
    for (const id of ids) {
      const txt = String(r.valores[id]?.g ?? '').trim();
      if (txt === '') continue;
      const g = numero(txt);
      if (g === null || g < 0) { r.error = `Los gramos de «${byId().get(id)?.nombre ?? id}» no son un número válido.`; render(); return; }
      items.push({ food_id: id, gramos: g });
    }
    if (!items.length) { r.error = 'No has puesto ninguna cantidad: un campo vacío no se cuenta.'; render(); return; }
    await guardar(anadirRecuentos(inv.data, items, momentoAhora(), deps.idGen ? { id: deps.idGen } : undefined));
    inv.msg = `Recuento guardado: ${plural(items.length, 'alimento', 'alimentos')}.`;
    await refrescar();
    state.screen = r.soloId ? 'inv-ficha' : 'inventario';
    if (r.soloId) inv.ficha = { foodId: r.soloId, abierto: false, gramos: '', motivo: '', error: '', borrar: null };
    render();
  })(), 'No se pudo guardar el recuento');

  const setFicha = (patch) => { inv.ficha = { ...inv.ficha, ...patch, error: patch.error ?? '' }; };
  const ajustar = () => track((async () => {
    const f = inv.ficha;
    const g = numero(f.gramos);
    if (g === null || g === 0) { setFicha({ error: 'Pon los gramos a sumar o restar (por ejemplo −200).' }); render(); return; }
    await guardar(anadirAjuste(inv.data, { food_id: f.foodId, gramos: g, momento: momentoAhora(), motivo: f.motivo }, deps.idGen ? { id: deps.idGen } : undefined));
    inv.msg = 'Ajuste guardado.';
    setFicha({ abierto: false, gramos: '', motivo: '' });
    await refrescar(); render();
  })(), 'No se pudo guardar el ajuste');
  const pedirBorrar = (id) => { setFicha({ borrar: id }); render(); };
  const borrarEvento = (id) => track((async () => {
    await guardar(quitarEvento(inv.data, id));
    inv.msg = 'Evento borrado.';
    setFicha({ borrar: null });
    await refrescar(); render();
  })(), 'No se pudo borrar');

  // ---------- dudas ----------
  // Formulario de una duda: alimento elegido, gramos brutos (rellenos con los sugeridos) y «recordar» (marcado por defecto).
  function formDeDuda(d) {
    if (!inv.dudaForm[d.id]) {
      const unico = d.food_id ?? (d.candidatos.length === 1 ? d.candidatos[0] : null);
      inv.dudaForm[d.id] = { food_id: unico, gramos: d.gramos_sugeridos != null ? String(d.gramos_sugeridos).replace('.', ',') : '', recordar: true, error: '' };
    }
    return inv.dudaForm[d.id];
  }
  const setDuda = (d, patch) => { Object.assign(formDeDuda(d), patch, patch.error === undefined ? { error: '' } : {}); };
  const resolver = (d, { ignorar = false } = {}) => track((async () => {
    const f = formDeDuda(d);
    try {
      const orden = ignorar ? { ignorar: true, recordar: f.recordar } : { food_id: f.food_id, gramos: numero(f.gramos), recordar: f.recordar };
      const { inventario } = resolverDuda(inv.data, d.id, orden, { foodsById: byId(), conjunto: inv.vista.conjunto, ...(deps.idGen ? { id: deps.idGen } : {}) });
      await guardar(inventario);
    } catch (e) { f.error = e.message; render(); return; }
    delete inv.dudaForm[d.id];
    inv.msg = ignorar ? 'Duda resuelta: no es de la dieta.' : `Duda resuelta: ${byId().get(f.food_id)?.nombre ?? f.food_id}.`;
    await refrescar();
    if (!inv.data.dudas.length) state.screen = 'inventario';
    render();
  })(), 'No se pudo guardar');

  // ---------- lista de la compra ----------
  const setHorizonte = (dias) => track((async () => {
    if (!Number.isInteger(dias) || dias < 1 || dias > 60) return;
    inv.horizonte = dias;
    await deps.store.setSetting('inventario_horizonte', dias);
    render();
  })(), 'No se pudo guardar');
  function calcularCompra() {
    const v = inv.vista;
    return listaCompra({ dieta: v.dieta, recetas: v.recetas, plan: state.plan, hoy: v.hoy, noSeguidas: v.noSeguidas, conjunto: v.conjunto, stock: v.stock, horizonte: inv.horizonte, margen: v.cfg.margen_dias, envases: v.envases });
  }
  // «Copiar lista»: al portapapeles si el contexto lo permite (https); si no (http con la IP del PC), compartir o descargar como texto.
  const compartir = async (texto) => {
    const r = await ctx.saveFile({ name: `lista-compra-${ctx.today()}.txt`, text: texto, type: 'text/plain' });
    inv.msg = r === 'cancelado' ? 'Compartir cancelado.' : r === 'descargado' ? 'Lista descargada como texto.' : 'Lista compartida.';
    render();
  };
  const copiarLista = (texto) => track((async () => {
    const win = ctx.doc?.defaultView;
    const nav = win?.navigator;
    if (nav?.clipboard?.writeText && win.isSecureContext !== false) {
      try { await nav.clipboard.writeText(texto); inv.msg = 'Lista copiada.'; render(); return; } catch { /* sin permiso: se comparte */ }
    }
    await compartir(texto);
  })(), 'No se pudo copiar la lista');
  const compartirLista = (texto) => track(compartir(texto), 'No se pudo compartir la lista');

  // ---------- copia de seguridad ----------
  const hayInventario = () => inv.data.eventos.length || inv.data.dudas.length || Object.keys(inv.data.tickets).length || Object.keys(inv.data.aprendido).length;
  const importar = async (nuevo) => { await guardar(nuevo); };

  return { cargar, arrancar, abrir, abrirDudas, abrirCompra, abrirRecuento, abrirFicha, cerrar, refrescar, sincronizar: sincronizarTrack, responderDuplicado, abrirSubir, cerrarSubir, setTextoSubir, subirPdf, subirTexto, setValor, guardarRecuento, setFicha, ajustar, pedirBorrar, borrarEvento, formDeDuda, setDuda, resolver, setHorizonte, calcularCompra, copiarLista, compartirLista, hayInventario, importar };
}
