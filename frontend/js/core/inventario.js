// Inventario y lista de la compra (especificación en docs/inventario/ESPEC.md; formato en data/SCHEMA.md). Funciones puras,
// sin DOM ni red: devuelven estados nuevos y nunca tocan lo recibido. Todo se calcula por código y desde el Diario: el stock
// no se guarda, se deriva (recuento + compras y ajustes − consumo de los días cerrados), así que editar un día pasado lo corrige
// solo y nada cuenta dos veces. Sin recuento = «sin contar» (null), nunca 0.
import { newId } from './ids.js';
import { shiftDate } from './diary.js';
import { elegirMenu, versionDelPeriodo, diaDeSemana } from './dieta.js';

export const INVENTARIO_VERSION = 1;
export const TIPOS_EVENTO = ['recuento', 'compra', 'ajuste'];
export const CONFIG_DEFECTO = { recetas_no_seguidas: [], horizonte_dias: 7, margen_dias: 2 };

const MOMENTO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const esNum = (v) => typeof v === 'number' && Number.isFinite(v);
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r3 = (x) => Math.round(x * 1000) / 1000; // los gramos se redondean al final, nunca por el camino
const cadena = (v) => (typeof v === 'string' ? v.trim() : '');

// ---------- fechas ----------

const dos = (n) => String(n).padStart(2, '0');
// 'YYYY-MM-DD' de la hora local de `fecha` (el día del Diario es el día local).
export const hoyLocal = (fecha = new Date()) => `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
// 'YYYY-MM-DDTHH:MM' local: el formato de `momento` de los eventos (se compara como texto).
export const momentoLocal = (fecha = new Date()) => `${hoyLocal(fecha)}T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
export const diaDe = (momento) => String(momento).slice(0, 10);

// ---------- configuración (data/inventario.json) ----------

// Lo que falte o sea inválido toma el valor por defecto. recetas_no_seguidas: ids de recetas que Victor no compra.
export function limpiarConfig(raw) {
  const o = esObjeto(raw) ? raw : {};
  const entero = (v, def) => (Number.isInteger(v) && v >= 0 ? v : def);
  return {
    version: INVENTARIO_VERSION,
    recetas_no_seguidas: [...new Set((Array.isArray(o.recetas_no_seguidas) ? o.recetas_no_seguidas : []).map(cadena).filter(Boolean))],
    horizonte_dias: Math.max(1, entero(o.horizonte_dias, CONFIG_DEFECTO.horizonte_dias)),
    margen_dias: entero(o.margen_dias, CONFIG_DEFECTO.margen_dias),
  };
}

// ---------- alimentos de la dieta y recetas ----------

const indiceRecetas = (recetas) => (recetas instanceof Map ? recetas : new Map((Array.isArray(recetas) ? recetas : []).map((r) => [r.id, r])));
const conjuntoDe = (c) => (c instanceof Set ? c : new Set(c ?? []));
const noSeguidasDe = (n) => (n instanceof Set ? n : new Set(n ?? []));
// Una receta con `etiqueta` es un producto envasado (salteados Hacendado): se sigue como un alimento, no se expande.
const esEnvasada = (r) => esObjeto(r?.etiqueta) && Object.keys(r.etiqueta).length > 0;

// Una línea de menú o de Diario como alimentos del inventario: [{ food_id, gramos }].
// - receta no seguida: [] (no suma ni resta nada);
// - receta con etiqueta: ella misma;
// - receta casera o de la app: sus ingredientes (gramos_línea × gramos_ingrediente / peso_final_g, o / suma de ingredientes);
// - cualquier otro alimento: él mismo.
export function expandirLinea(foodId, gramos, { recetas = [], noSeguidas = [] } = {}) {
  const porId = indiceRecetas(recetas);
  const no = noSeguidasDe(noSeguidas);
  if (no.has(foodId)) return [];
  const r = porId.get(foodId);
  if (!r || esEnvasada(r) || !Array.isArray(r.ingredientes) || !r.ingredientes.length) return [{ food_id: foodId, gramos }];
  const suma = r.ingredientes.reduce((s, i) => s + i.gramos, 0);
  const pesoFinal = esNum(r.peso_final_g) && r.peso_final_g > 0 ? r.peso_final_g : suma;
  return r.ingredientes.filter((i) => !no.has(i.food_id)).map((i) => ({ food_id: i.food_id, gramos: (gramos * i.gramos) / pesoFinal }));
}

// Las versiones de la dieta (versión 2) cuyo periodo del plan está vigente o es futuro en `hoy` (el periodo no ha terminado:
// sin `fin` o fin >= hoy). Un tramo `<id>_AAAAMMDD` cuenta para la versión de su periodo de origen. Sin plan: todas.
// Con plan, una versión sin ningún periodo vigente o futuro no cuenta. Dieta de versión 1: [] (usa `dias`, ver lineasDeDieta).
export function versionesVigentes(dieta, plan, hoy) {
  if (!Array.isArray(dieta?.versiones)) return [];
  if (!plan) return dieta.versiones;
  const vivas = new Set();
  for (const p of plan.periodos ?? []) {
    if (!p?.id || (p.fin && p.fin < hoy)) continue;
    const v = versionDelPeriodo(dieta.versiones, p.id);
    if (v) vivas.add(v);
  }
  return dieta.versiones.filter((v) => vivas.has(v));
}

const lineasDeDias = (dias) => Object.values(dias ?? {}).flatMap((comidas) => Object.values(comidas ?? {}).flat());

// Todas las líneas {food_id, gramos} de la dieta (menú normal y de cada tipo de día) de las versiones vigentes o futuras.
export function lineasDeDieta(dieta, plan, hoy) {
  if (!Array.isArray(dieta?.versiones)) return lineasDeDias(dieta?.dias);
  return versionesVigentes(dieta, plan, hoy).flatMap((v) => [...lineasDeDias(v.dias), ...Object.values(v.tipos ?? {}).flatMap(lineasDeDias)]);
}

// Los alimentos que sigue el inventario: los de la dieta (versiones vigentes o futuras), con las recetas sustituidas por sus
// ingredientes salvo las no seguidas (fuera) y las envasadas (ellas mismas). Lista ordenada y sin repetidos. Se calcula siempre.
// `recetas`: lista ya fusionada (mergeRecetas); `opciones.noSeguidas`: ids de recetas que no se siguen.
export function alimentosDeLaDieta(dieta, recetas, plan, hoy, { noSeguidas = [] } = {}) {
  const ids = new Set();
  for (const l of lineasDeDieta(dieta, plan, hoy)) for (const e of expandirLinea(l.food_id, l.gramos, { recetas, noSeguidas })) ids.add(e.food_id);
  return [...ids].sort();
}

// ---------- estado del ajuste `inventario` ----------

export const inventarioVacio = () => ({ version: INVENTARIO_VERSION, eventos: [], tickets: {}, dudas: [], aprendido: {} });

function limpiarEvento(e) {
  if (!esObjeto(e)) return null;
  const id = cadena(e.id);
  const food_id = cadena(e.food_id);
  if (!id || !food_id || !TIPOS_EVENTO.includes(e.tipo) || !MOMENTO_RE.test(String(e.momento)) || !esNum(e.gramos)) return null;
  if (e.tipo === 'recuento' && e.gramos < 0) return null;
  if (e.tipo === 'compra' && e.gramos <= 0) return null;
  if (e.tipo === 'ajuste' && e.gramos === 0) return null;
  const o = { id, tipo: e.tipo, momento: e.momento, food_id, gramos: e.gramos };
  if (e.tipo === 'compra') {
    if (cadena(e.ticket)) o.ticket = cadena(e.ticket);
    if (Number.isInteger(e.linea)) o.linea = e.linea;
  }
  if (e.tipo === 'ajuste' && cadena(e.motivo)) o.motivo = cadena(e.motivo);
  return o;
}

function limpiarDuda(d) {
  if (!esObjeto(d) || !cadena(d.id)) return null;
  return { ...d, id: cadena(d.id), candidatos: (Array.isArray(d.candidatos) ? d.candidatos : []).map(cadena).filter(Boolean) };
}

// Para lo guardado y para importar copias: deja solo lo válido, sin lanzar. Devuelve { inventario, avisos: [texto] }.
export function limpiarInventario(raw) {
  const avisos = [];
  const inv = inventarioVacio();
  if (!esObjeto(raw)) return { inventario: inv, avisos: raw === undefined || raw === null ? [] : ['El inventario no es un objeto; se ignora.'] };
  const vistos = new Set();
  let malos = 0;
  for (const e of Array.isArray(raw.eventos) ? raw.eventos : []) {
    const l = limpiarEvento(e);
    if (!l || vistos.has(l.id)) { malos++; continue; }
    vistos.add(l.id);
    inv.eventos.push(l);
  }
  if (malos) avisos.push(`${malos} evento${malos === 1 ? '' : 's'} del inventario no válido${malos === 1 ? '' : 's'} o repetido${malos === 1 ? '' : 's'}: se ignora${malos === 1 ? '' : 'n'}.`);
  if (esObjeto(raw.tickets)) {
    for (const [hash, t] of Object.entries(raw.tickets)) {
      if (!cadena(hash) || !esObjeto(t)) continue;
      inv.tickets[hash] = Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'string' && v));
    }
  }
  const idsDudas = new Set();
  for (const d of Array.isArray(raw.dudas) ? raw.dudas : []) {
    const l = limpiarDuda(d);
    if (l && !idsDudas.has(l.id)) { idsDudas.add(l.id); inv.dudas.push(l); }
  }
  if (esObjeto(raw.aprendido)) for (const [k, v] of Object.entries(raw.aprendido)) if (cadena(k) && cadena(v)) inv.aprendido[k] = cadena(v);
  return { inventario: inv, avisos };
}

const con = (inv, cambios) => ({ ...inv, ...cambios });
const nuevoEvento = (inv, e, id) => {
  const l = limpiarEvento({ ...e, id: e.id ?? id() });
  if (!l) throw new Error(`Evento de inventario no válido: ${JSON.stringify(e)}`);
  if (inv.eventos.some((x) => x.id === l.id)) throw new Error(`Evento de inventario repetido: ${l.id}`);
  return l;
};

// Recuentos (valor absoluto, «lo que hay ahora»): uno o varios a la vez (el inventario inicial). items: [{ food_id, gramos }].
export function anadirRecuentos(inv, items, momento, { id = newId } = {}) {
  const nuevos = items.map((it) => nuevoEvento(inv, { tipo: 'recuento', momento, food_id: it.food_id, gramos: it.gramos }, id));
  return con(inv, { eventos: [...inv.eventos, ...nuevos] });
}
export const anadirRecuento = (inv, { food_id, gramos, momento }, opciones) => anadirRecuentos(inv, [{ food_id, gramos }], momento, opciones);

// Ajuste manual (delta con signo, p. ej. −200 por caducado).
export function anadirAjuste(inv, { food_id, gramos, momento, motivo }, { id = newId } = {}) {
  return con(inv, { eventos: [...inv.eventos, nuevoEvento(inv, { tipo: 'ajuste', momento, food_id, gramos, motivo }, id)] });
}

// Compra (delta positivo; de un ticket: con su hash y número de línea). Idempotente por (ticket, línea, alimento): la misma
// línea de un ticket nunca suma dos veces.
export function anadirCompra(inv, { food_id, gramos, momento, ticket, linea }, { id = newId } = {}) {
  if (cadena(ticket) && Number.isInteger(linea) && inv.eventos.some((e) => e.tipo === 'compra' && e.ticket === cadena(ticket) && e.linea === linea && e.food_id === food_id)) return inv;
  return con(inv, { eventos: [...inv.eventos, nuevoEvento(inv, { tipo: 'compra', momento, food_id, gramos, ticket, linea }, id)] });
}

// Sustituye un evento por id (editar = sustituir); nunca se borra. Lanza si no existe o el resultado no es válido.
export function sustituirEvento(inv, evento) {
  const l = limpiarEvento(evento);
  if (!l) throw new Error(`Evento de inventario no válido: ${JSON.stringify(evento)}`);
  if (!inv.eventos.some((e) => e.id === l.id)) throw new Error(`No existe el evento ${l.id}`);
  return con(inv, { eventos: inv.eventos.map((e) => (e.id === l.id ? l : e)) });
}

export const ticketAplicado = (inv, hash) => Object.prototype.hasOwnProperty.call(inv.tickets, hash);
export const registrarTicket = (inv, hash, { fecha, aplicado, origen }) => con(inv, { tickets: { ...inv.tickets, [hash]: { ...(fecha ? { fecha } : {}), ...(aplicado ? { aplicado } : {}), ...(origen ? { origen } : {}) } } });
export const anadirDuda = (inv, duda, { id = newId } = {}) => con(inv, { dudas: [...inv.dudas, limpiarDuda({ ...duda, id: duda.id ?? id() })] });
export const quitarDuda = (inv, idDuda) => con(inv, { dudas: inv.dudas.filter((d) => d.id !== idDuda) });
// Respuesta a una duda para la próxima vez: descripción normalizada -> food_id o 'ignorar'.
export const aprender = (inv, descripcion, destino) => con(inv, { aprendido: { ...inv.aprendido, [cadena(descripcion)]: cadena(destino) } });

// Importar una copia: une por id de evento (gana lo local en conflicto), tickets y aprendido (gana lo local) y dudas (por id).
// Nunca borra nada. Una duda de la copia cuya línea ya tiene su compra aquí no vuelve. Devuelve { inventario, avisos, nuevos }
// con lo que se ha añadido, para el resumen antes de aplicar.
export function fusionarInventario(local, entrante) {
  const a = limpiarInventario(local).inventario;
  const { inventario: b, avisos } = limpiarInventario(entrante);
  const ids = new Set(a.eventos.map((e) => e.id));
  const eventosNuevos = b.eventos.filter((e) => !ids.has(e.id));
  const eventos = [...a.eventos, ...eventosNuevos];
  const tickets = { ...b.tickets, ...a.tickets };
  const ticketsNuevos = Object.keys(b.tickets).filter((h) => !(h in a.tickets));
  const aprendido = { ...b.aprendido, ...a.aprendido };
  const aprendidoNuevo = Object.keys(b.aprendido).filter((k) => !(k in a.aprendido));
  const idsDudas = new Set(a.dudas.map((d) => d.id));
  const resuelta = (d) => eventos.some((e) => e.tipo === 'compra' && e.ticket === d.ticket && e.linea === d.linea);
  const dudasNuevas = b.dudas.filter((d) => !idsDudas.has(d.id) && !resuelta(d));
  return {
    inventario: { version: INVENTARIO_VERSION, eventos, tickets, dudas: [...a.dudas, ...dudasNuevas], aprendido },
    avisos,
    nuevos: { eventos: eventosNuevos.length, tickets: ticketsNuevos.length, dudas: dudasNuevas.length, aprendido: aprendidoNuevo.length },
  };
}

// ---------- consumo derivado ----------

// Consumo de cada día: Map fecha -> Map food_id -> gramos, de los registros del Diario ({ date, lines: [{ food_id, grams }] }).
// Solo cuentan los alimentos del conjunto (con las recetas expandidas); lo demás, borrado del documento o fuera de la dieta, nada.
export function consumoPorDia(registros, { conjunto, recetas = [], noSeguidas = [] }) {
  const dentro = conjuntoDe(conjunto);
  const dias = new Map();
  for (const m of registros ?? []) {
    if (!FECHA_RE.test(String(m?.date))) continue;
    for (const l of m.lines ?? []) {
      if (!esNum(l?.grams) || l.grams <= 0) continue;
      for (const e of expandirLinea(l.food_id, l.grams, { recetas, noSeguidas })) {
        if (!dentro.has(e.food_id)) continue;
        if (!dias.has(m.date)) dias.set(m.date, new Map());
        const d = dias.get(m.date);
        d.set(e.food_id, (d.get(e.food_id) ?? 0) + e.gramos);
      }
    }
  }
  return dias;
}

// Consumo de un día: Map food_id -> gramos (redondeado).
export function consumoDelDia(registros, fecha, { conjunto, recetas, noSeguidas }) {
  const d = consumoPorDia((registros ?? []).filter((m) => m?.date === fecha), { conjunto, recetas, noSeguidas }).get(fecha) ?? new Map();
  return new Map([...d].map(([k, v]) => [k, r3(v)]));
}

// ---------- stock derivado ----------

// Último recuento de un alimento (el de momento más tardío; con el mismo momento, el último añadido).
function ultimoRecuento(eventos, foodId) {
  let r = null;
  for (const e of eventos) if (e.tipo === 'recuento' && e.food_id === foodId && (!r || e.momento >= r.momento)) r = e;
  return r;
}

// Stock de cada alimento del conjunto, a fecha `hoy` ('YYYY-MM-DD'). Devuelve { [food_id]: {
//   food_id, contado, recuento: {id, momento, gramos}|null,
//   gramos: stock en gramos, o null si no hay recuento (nunca 0), sin recortar si sale negativo,
//   comprado, ajustado: Σ de compras / ajustes (desde el recuento; sin recuento, todos: «comprado desde entonces»),
//   consumido: Σ de los días cerrados d con díaDe(recuento) < d < hoy, consumos: [{ fecha, gramos }],
//   registradoHoy: lo registrado hoy, que aún no se resta (se resta a las 00:00),
//   negativo, faltanRevisar: gramos que faltan en el inventario si sale negativo (0 si no) } }.
// Determinista: depende solo de los eventos, los registros y `hoy`. Los días futuros nunca restan (d < hoy).
// Una compra o ajuste con el mismo momento que el recuento NO suma (el recuento ya cuenta lo que hay entonces).
export function calcularStock(inv, registros, { conjunto, recetas = [], noSeguidas = [], hoy }) {
  const ids = [...conjuntoDe(conjunto)];
  const porDia = consumoPorDia(registros, { conjunto: ids, recetas, noSeguidas });
  const fechas = [...porDia.keys()].sort();
  const out = {};
  for (const id of ids) {
    const mios = (inv?.eventos ?? []).filter((e) => e.food_id === id);
    const R = ultimoRecuento(mios, id);
    const despues = R ? mios.filter((e) => e.momento > R.momento) : mios;
    const comprado = despues.filter((e) => e.tipo === 'compra').reduce((s, e) => s + e.gramos, 0);
    const ajustado = despues.filter((e) => e.tipo === 'ajuste').reduce((s, e) => s + e.gramos, 0);
    const consumos = R ? fechas.filter((d) => diaDe(R.momento) < d && d < hoy && porDia.get(d).has(id)).map((d) => ({ fecha: d, gramos: r3(porDia.get(d).get(id)) })) : [];
    const consumido = consumos.reduce((s, c) => s + porDia.get(c.fecha).get(id), 0);
    const gramos = R ? r3(R.gramos + comprado + ajustado - consumido) : null;
    out[id] = {
      food_id: id,
      contado: Boolean(R),
      recuento: R ? { id: R.id, momento: R.momento, gramos: R.gramos } : null,
      gramos,
      comprado: r3(comprado),
      ajustado: r3(ajustado),
      consumido: r3(consumido),
      consumos,
      registradoHoy: r3(porDia.get(hoy)?.get(id) ?? 0),
      negativo: gramos !== null && gramos < 0,
      faltanRevisar: gramos !== null && gramos < 0 ? -gramos : 0,
    };
  }
  return out;
}

// ---------- porción comestible ----------

// La columna de trabajo `porcion_comestible` (food.extra.porcion_comestible): fracción comestible, en (0, 1]. Vacía o inválida
// (texto, 0, negativa, mayor que 1): 1 y sinDato = true, para avisar.
export function porcionComestible(food) {
  const bruto = food?.extra?.porcion_comestible;
  const n = typeof bruto === 'number' ? bruto : Number(String(bruto ?? '').trim().replace(',', '.'));
  const valido = String(bruto ?? '').trim() !== '' && Number.isFinite(n) && n > 0 && n <= 1;
  return { factor: valido ? n : 1, sinDato: !valido };
}

// Gramos comestibles de unos gramos brutos (lo comprado, con piel, cáscara, hueso...). { gramos, factor, sinDato }.
export function gramosComestibles(gramosBrutos, food) {
  const { factor, sinDato } = porcionComestible(food);
  return { gramos: r3(gramosBrutos * factor), factor, sinDato };
}

// ---------- lista de la compra ----------

// Qué comprar para los próximos días (ESPEC §6). Parámetros:
//   dieta, recetas (lista fusionada), plan, hoy ('YYYY-MM-DD'), noSeguidas,
//   conjunto: alimentos que se siguen (alimentosDeLaDieta), stock: resultado de calcularStock,
//   horizonte (días desde hoy) y margen (días extra de colchón): se miran hoy … hoy + horizonte − 1 + margen,
//   envases: { food_id: { gramos, nombre } } opcional (gramos comestibles de un envase del producto habitual).
// necesidad = Σ gramos del menú de cada día (elegirMenu con el plan; recetas como en alimentosDeLaDieta);
// faltan = max(0, necesidad − (stock − registradoHoy)); sin contar: faltan = necesidad y stockDesconocido.
// Los días sin menú suman 0 y se devuelven aparte (sinMenu) para avisar.
export function listaCompra({ dieta, recetas = [], plan = null, hoy, noSeguidas = [], conjunto, stock = {}, horizonte, margen = 0, envases = {} }) {
  const dentro = conjuntoDe(conjunto);
  const total = Math.max(1, horizonte) + Math.max(0, margen);
  const necesidad = new Map();
  const dias = [];
  const sinMenu = [];
  for (let n = 0; n < total; n++) {
    const fecha = shiftDate(hoy, n);
    const sel = elegirMenu(dieta, fecha, plan);
    dias.push({ fecha, dia: diaDeSemana(fecha), conMenu: sel.ok });
    if (!sel.ok) { sinMenu.push({ fecha, dia: diaDeSemana(fecha), error: sel.error }); continue; }
    for (const m of sel.comidas) for (const l of m.lines) {
      for (const e of expandirLinea(l.food_id, l.grams, { recetas, noSeguidas })) if (dentro.has(e.food_id)) necesidad.set(e.food_id, (necesidad.get(e.food_id) ?? 0) + e.gramos);
    }
  }
  const items = [...dentro].map((id) => {
    const nec = necesidad.get(id) ?? 0;
    const s = stock[id];
    const contado = Boolean(s?.contado);
    const registradoHoy = s?.registradoHoy ?? 0;
    const faltan = r3(contado ? Math.max(0, nec - (s.gramos - registradoHoy)) : nec);
    const env = envases[id];
    const envase = esNum(env?.gramos) && env.gramos > 0 ? { nombre: env.nombre ?? null, gramos: env.gramos, cantidad: faltan > 0 ? Math.ceil(faltan / env.gramos - 1e-9) : 0 } : null;
    return { food_id: id, necesidad: r3(nec), stock: contado ? s.gramos : null, registradoHoy, faltan, stockDesconocido: !contado, negativo: Boolean(s?.negativo), envase };
  });
  return { desde: hoy, hasta: shiftDate(hoy, total - 1), horizonte: Math.max(1, horizonte), margen: Math.max(0, margen), dias, sinMenu, items };
}
