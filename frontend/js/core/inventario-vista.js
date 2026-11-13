// Lo que las pantallas de Inventario, Dudas y Lista de la compra necesitan y no es cálculo de stock: grupos, envases de la tabla de
// productos, textos de cantidad y de stock, historial de un alimento y la lista como texto. Puro: sin DOM ni red.
// El cálculo (stock, lista, tickets) vive en inventario.js y tickets.js; aquí solo se presenta.
import { porcionComestible } from './inventario.js';

const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const esNum = (v) => typeof v === 'number' && Number.isFinite(v);
const cadena = (v) => (typeof v === 'string' ? v.trim() : '');

// ---------- grupos ----------

// data/inventario.json → `grupos`: { "Despensa": ["arroz_blanco_crudo", …], … } (el orden del fichero es el de la pantalla).
// Un alimento que no está en ninguno va a «Otros». Devuelve [{ nombre, ids }].
export function leerGrupos(raw) {
  const o = raw?.grupos;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
  return Object.entries(o).map(([nombre, ids]) => ({ nombre: cadena(nombre), ids: (Array.isArray(ids) ? ids : []).map(cadena).filter(Boolean) })).filter((g) => g.nombre);
}

// Reparte los ids en los grupos de la configuración (sin repetir; dentro de cada grupo, por nombre). -> [{ nombre, ids }]
export function agruparAlimentos(ids, grupos, nombreDe = (id) => id) {
  const vistos = new Set();
  const dentro = new Set(ids);
  const orden = (a, b) => nombreDe(a).localeCompare(nombreDe(b), 'es');
  const out = [];
  for (const g of grupos ?? []) {
    const mios = g.ids.filter((id) => dentro.has(id) && !vistos.has(id));
    mios.forEach((id) => vistos.add(id));
    if (mios.length) out.push({ nombre: g.nombre, ids: mios.sort(orden) });
  }
  const resto = [...dentro].filter((id) => !vistos.has(id)).sort(orden);
  if (resto.length) out.push({ nombre: 'Otros', ids: resto });
  return out;
}

// ---------- envases ----------

// El envase habitual de cada alimento: el PRIMER producto de la tabla (data/tickets-mercadona.json) con ese food_id, si trae su
// tamaño. Gramos comestibles = unidades_por_envase × gramos_por_unidad × porción comestible. -> { food_id: { gramos, nombre, unidad } }
// (`unidad` = la primera palabra del nombre del envase: «paquete», «bolsa», «brik»…). Un producto a peso o sin tamaño no da envase.
export function envasesDeTabla(tabla, foodsById) {
  const productos = tabla?.productos ?? tabla ?? {};
  const out = {};
  const visto = new Set();
  for (const p of Object.values(productos)) {
    if (!p || p.ignorar || !p.food_id || visto.has(p.food_id)) continue;
    visto.add(p.food_id); // solo el primero de cada alimento: si no trae tamaño, no hay envase (no se salta al siguiente)
    if (!Number.isInteger(p.unidades_por_envase) || !(p.unidades_por_envase > 0) || !esNum(p.gramos_por_unidad) || !(p.gramos_por_unidad > 0)) continue;
    const food = foodsById instanceof Map ? foodsById.get(p.food_id) : foodsById?.[p.food_id];
    const g = Math.round(p.unidades_por_envase * p.gramos_por_unidad * porcionComestible(food).factor * 1000) / 1000;
    const nombre = cadena(p.nombre_envase) || 'envase';
    out[p.food_id] = { gramos: g, nombre, unidad: nombre.split(/\s+/)[0].toLowerCase() };
  }
  return out;
}

// ---------- textos ----------

// 350 g · 1,2 kg
export function textoCantidad(gramos) {
  const g = Math.abs(gramos);
  return g >= 1000 ? `${nf2.format(gramos / 1000)} kg` : `${nf0.format(gramos)} g`;
}

const plural = (unidad, n) => (Math.abs(n - 1) < 0.05 ? unidad : `${unidad}s`);
// «1,2 paquetes» (n.º de envases con un decimal)
export function textoEnvases(gramos, envase) {
  const n = Math.round((gramos / envase.gramos) * 10) / 10;
  return `${nf1.format(n)} ${plural(envase.unidad, n)}`;
}

// El stock de un alimento para la lista de Inventario (s = calcularStock()[id]).
//   sin recuento: «sin contar»; negativo: «0 · revisa (faltan X g)»; si no: «1,2 kg» y, con envase, «≈ 1,2 paquetes».
// -> { texto, estado: 'sin_contar'|'revisar'|'ok', hoy: '«hoy: −X g (se resta a las 00:00)»' | null }
export function textoStock(s, envase = null) {
  const hoy = s?.registradoHoy > 0 ? `hoy: −${textoCantidad(s.registradoHoy)} (se resta a las 00:00)` : null;
  if (!s?.contado) return { texto: 'sin contar', estado: 'sin_contar', hoy };
  if (s.negativo) return { texto: `0 · revisa (faltan ${textoCantidad(s.faltanRevisar)})`, estado: 'revisar', hoy };
  const extra = envase && s.gramos > 0 ? ` · ≈ ${textoEnvases(s.gramos, envase)}` : '';
  return { texto: `${textoCantidad(s.gramos)}${extra}`, estado: 'ok', hoy };
}

const dos = (n) => String(n).padStart(2, '0');
// 'YYYY-MM-DD' -> «26/10» ; 'YYYY-MM-DDTHH:MM' -> «26/10 20:58»
export function fechaCorta(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(texto ?? ''));
  if (!m) return String(texto ?? '');
  return `${dos(m[3])}/${dos(m[2])}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

// ---------- historial de un alimento ----------

// Los eventos de un alimento, del más reciente al más antiguo, con una frase para cada uno:
//   recuento «Recuento: 1,2 kg», compra «Compra: 450 g · ticket del 26/10», ajuste «Ajuste: −200 g · caducado».
// -> [{ id, tipo, momento, gramos, texto, ticket }]
export function historialDe(inv, foodId) {
  const evs = (inv?.eventos ?? []).filter((e) => e.food_id === foodId);
  const menos = (g) => `${g < 0 ? '−' : '+'}${textoCantidad(Math.abs(g))}`;
  return evs.map((e) => {
    let texto;
    if (e.tipo === 'recuento') texto = `Recuento: ${textoCantidad(e.gramos)}`;
    else if (e.tipo === 'compra') {
      const t = e.ticket ? inv.tickets?.[e.ticket] : null;
      texto = `Compra: ${menos(e.gramos)}${e.ticket ? ` · ticket${t?.fecha ? ` del ${fechaCorta(t.fecha)}` : ''}` : ''}`;
    } else texto = `Ajuste: ${menos(e.gramos)}${e.motivo ? ` · ${e.motivo}` : ''}`;
    return { id: e.id, tipo: e.tipo, momento: e.momento, gramos: e.gramos, texto, ticket: e.ticket ?? null };
  }).sort((a, b) => (a.momento < b.momento ? 1 : a.momento > b.momento ? -1 : 0));
}

// ---------- lista de la compra como texto ----------

// «Faltan 300 g → 1 paquete (1 kg)»; sin contar: «Necesito 300 g → …». Sin envase en la tabla, solo los gramos.
export function descripcionCompra(it) {
  const falta = it.stockDesconocido ? `Necesito ${textoCantidad(it.faltan)}` : `Faltan ${textoCantidad(it.faltan)}`;
  const e = it.envase;
  const comprar = e && e.cantidad > 0
    ? ` → ${e.cantidad} ${plural(e.nombre ? e.nombre.split(/\s+/)[0].toLowerCase() : 'envase', e.cantidad)} (${textoCantidad(e.gramos)}${e.cantidad > 1 ? ' cada uno' : ''})`
    : '';
  return `${falta}${comprar}`;
}
const unaLinea = (it, nombre) => `${nombre}: ${descripcionCompra(it).replace(/^./, (c) => c.toLowerCase())}`;

// La lista para copiar o compartir. lista = listaCompra(); `diaTexto(fecha)` da «sáb 15». Solo lo que hay que comprar, por grupos;
// los alimentos sin contar aparte; los días sin menú, al final.
export function textoListaCompra({ lista, grupos, nombreDe, diaTexto }) {
  const hay = lista.items.filter((i) => i.faltan > 0 && !i.stockDesconocido);
  const sinContar = lista.items.filter((i) => i.faltan > 0 && i.stockDesconocido);
  const out = [`Lista de la compra (${diaTexto(lista.desde)} – ${diaTexto(lista.hasta)})`];
  for (const g of agruparAlimentos(hay.map((i) => i.food_id), grupos, nombreDe)) {
    out.push('', g.nombre);
    for (const id of g.ids) out.push(`- ${unaLinea(hay.find((i) => i.food_id === id), nombreDe(id))}`);
  }
  if (sinContar.length) {
    out.push('', 'Stock desconocido (sin contar)');
    for (const it of sinContar) out.push(`- ${unaLinea(it, nombreDe(it.food_id))}`);
  }
  if (!hay.length && !sinContar.length) out.push('', 'No falta nada.');
  if (lista.sinMenu.length) out.push('', `${listaDias(lista.sinMenu.map((d) => diaTexto(d.fecha)))}: sin menú, no cuentan.`);
  return `${out.join('\n')}\n`;
}

// «sáb 15 y dom 16» / «a, b y c»
export function listaDias(dias) {
  if (dias.length <= 1) return dias.join('');
  return `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]}`;
}
