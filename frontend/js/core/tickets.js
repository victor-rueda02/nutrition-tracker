// Tickets de Mercadona -> compras del inventario (especificación en docs/inventario/ESPEC.md §4; formato de la tabla en
// data/SCHEMA.md). Puro: sin DOM ni red. Las pantallas (F4) solo llaman a estas funciones. La lectura del texto del ticket vive en
// ticket-parse.js (sin dependencias, también la usa el Worker) y aquí se vuelve a exportar.
//
// Cada línea de ticket acaba en una de tres cosas (clasificarLinea), en este orden de preferencia:
//   1. lo aprendido en el dispositivo (respuestas a Dudas) -> la tabla data/tickets-mercadona.json -> compra, duda o descartada;
//   2. si no está en ninguna, el parecido con un alimento DEL CONJUNTO de la dieta -> Duda con candidatos (nunca se adivina);
//   3. si no se parece a nada de la dieta -> descartada en silencio (limpieza, bebidas, caprichos): no se guarda.
// Una cantidad no clara es Duda aunque el alimento sea seguro. Los gramos que suman son los COMESTIBLES (porción comestible).
import { words, sameWord, spansIn } from './text.js';
import { gramosComestibles, momentoLocal, anadirCompra, anadirDuda, quitarDuda, aprender, registrarTicket, ticketAplicado } from './inventario.js';
import { normalizarDescripcion } from './ticket-parse.js';

export { parseTicket, normalizarDescripcion, sha256Hex, TicketError } from './ticket-parse.js';

const esNum = (v) => typeof v === 'number' && Number.isFinite(v);
const propio = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const conjuntoDe = (c) => (c instanceof Set ? c : new Set(c ?? []));
const alimento = (foodsById, id) => (foodsById instanceof Map ? foodsById.get(id) : foodsById?.[id]);
const r3 = (x) => Math.round(x * 1000) / 1000;

// Por qué una línea va a Dudas (para las pantallas).
export const MOTIVOS_DUDA = {
  parecido: 'Se parece a un alimento de tu dieta, pero no está en la tabla de productos: dime cuál es (o que no es de la dieta).',
  preguntar_gramos: 'El ticket no trae el peso: pon los gramos.',
  sin_peso: 'Se vende a peso y el ticket no trae los kg: pon los gramos.',
  sin_tamano_envase: 'No sé cuánto trae este envase: pon los gramos.',
  ilegible: 'No he podido leer bien la línea o su cantidad: confírmala.',
};

// ---------- parecido con la dieta ----------

// Abreviaturas de Mercadona (palabra suelta del ticket -> palabra completa).
export const ABREVIATURAS = {
  tom: 'tomate', pim: 'pimiento', verd: 'verdura', verdu: 'verdura', zan: 'zanahoria', pat: 'patata', manz: 'manzana', plat: 'platano',
  yog: 'yogur', ceb: 'cebolla', alm: 'almendra', sard: 'sardina', choc: 'chocolate', mand: 'mandarina', salm: 'salmon', pech: 'pechuga',
};

// Palabras que no identifican un alimento por sí solas (estado, color, marca, calificativos).
const GENERICAS = new Set(`crudo cruda crudos crudas cocido cocida cocidos cocidas cocinado tostado tostada procesado natural naturales seco seca secos secas
entero entera enteros fresco fresca blanco blanca negro negra verde rojo roja extra virgen light ligero ligera integral frito frita hacendado
escurrido escurrida escurridos escurridas reducido reducida reducidos reducidas enriquecer enriquecido azucar mesa`.split(/\s+/));
const PREPOSICIONES = new Set(['de', 'del', 'en', 'con', 'sin', 'para', 'al', 'a', 'y', 'o']);

// Una descripción de ticket como palabras ya normalizadas y con las abreviaturas expandidas. Lo que sigue a «sin» o a «0 %» está
// ausente a propósito («PISTACHO TOST 0% SAL» no es sal) y no cuenta.
const palabrasDeTicket = (desc) => {
  const w = words(desc);
  return w.filter((_, i) => i === 0 || (w[i - 1] !== 'sin' && w[i - 1] !== '0')).map((x) => ABREVIATURAS[x] ?? x);
};

// Índice de parecido de los alimentos del conjunto: para cada uno, las frases (nombre y alias completos) y las palabras sueltas
// que bastan por sí solas (las del nombre antes de la primera preposición y los alias de una palabra).
export function indiceParecido(conjunto, foodsById) {
  const out = [];
  for (const id of conjuntoDe(conjunto)) {
    const f = alimento(foodsById, id);
    if (!f) continue;
    const frases = [];
    const sueltas = new Set();
    const nombre = String(f.nombre ?? '');
    const nw = words(nombre);
    if (nw.length) frases.push(nw);
    for (const w of words(nombre.split(/[,(]/)[0])) {
      if (PREPOSICIONES.has(w)) break;
      if (w.length >= 4 && !GENERICAS.has(w)) sueltas.add(w);
    }
    for (const a of Array.isArray(f.alias) ? f.alias : []) {
      const aw = words(a);
      if (!aw.length) continue;
      frases.push(aw);
      if (aw.length === 1 && aw[0].length >= 3 && !GENERICAS.has(aw[0])) sueltas.add(aw[0]);
    }
    out.push({ id, frases, sueltas: [...sueltas] });
  }
  return out;
}

// Candidatos de la dieta que se parecen a una descripción, del que más se parece al que menos (máx. 4).
// Frase completa (nombre o alias, palabras seguidas; sin acentos ni plurales): 2 puntos por palabra + 1; palabra suelta: 1.
export function candidatosParecidos(descripcion, indice) {
  const tw = palabrasDeTicket(descripcion);
  if (!tw.length) return [];
  const res = [];
  for (const it of indice) {
    let puntos = 0;
    for (const fr of it.frases) if (spansIn(tw, fr).length) puntos = Math.max(puntos, fr.length * 2 + 1);
    for (const w of it.sueltas) if (tw.some((t) => sameWord(t, w))) puntos = Math.max(puntos, 1);
    if (puntos) res.push({ id: it.id, puntos });
  }
  return res.sort((a, b) => b.puntos - a.puntos || (a.id < b.id ? -1 : 1)).slice(0, 4).map((r) => r.id);
}

// ---------- clasificar una línea ----------

const descartada = (motivo, detalle, extra = {}) => ({ tipo: 'descartada', motivo, detalle, ...extra });
const duda = (linea, motivo, candidatos, extra = {}) => ({
  tipo: 'duda',
  motivo,
  candidatos,
  gramos_sugeridos: esNum(linea.peso_kg) && linea.peso_kg > 0 ? r3(linea.peso_kg * 1000) : null,
  ...extra,
});

// Gramos BRUTOS de la línea (lo comprado, con cáscara, piel…) o el motivo por el que no se saben.
function cantidadBruta(linea, r) {
  if (esNum(linea.peso_kg) && linea.peso_kg > 0) return { bruto: r3(linea.peso_kg * 1000) }; // el peso del ticket es lo real
  if (linea.ilegible || !Number.isInteger(linea.cantidad) || linea.cantidad < 1) return { motivo: 'ilegible' };
  if (r.a_peso) return { motivo: 'sin_peso' };
  if (r.preguntar_gramos) return { motivo: 'preguntar_gramos' };
  if (r.origen === 'aprendido') return esNum(r.gpu) && r.gpu > 0 ? { bruto: r3(linea.cantidad * r.gpu) } : { motivo: 'preguntar_gramos' };
  const u = r.unidades_por_envase;
  const g = r.gramos_por_unidad;
  if (Number.isInteger(u) && u > 0 && esNum(g) && g > 0) return { bruto: r3(linea.cantidad * u * g) };
  return { motivo: 'sin_tamano_envase' }; // gramos_por_unidad: null o sin dato de envase
}

// Respuesta recordada: 'food_id', 'food_id:gramos_por_unidad' o 'ignorar'.
const leerAprendido = (v) => {
  const m = /^([^:]+?)(?::(\d+(?:\.\d+)?))?$/.exec(String(v));
  return m ? { food_id: m[1], gpu: m[2] ? Number(m[2]) : null } : null;
};

// Clasifica una línea de parseTicket. ctx: { tabla (el JSON de data/tickets-mercadona.json o su `productos`), aprendido (inv.aprendido),
// conjunto (alimentosDeLaDieta), foodsById (Map o objeto), indice (indiceParecido, opcional: se calcula si falta) }. Devuelve:
//   { tipo: 'compra', food_id, gramos (comestibles), bruto, factor, sinPorcionComestible, origen: 'aprendido'|'tabla', confirmar }
//   { tipo: 'duda', motivo (MOTIVOS_DUDA), candidatos: [food_id], gramos_sugeridos (brutos o null), food_id? (el seguro, si lo hay) }
//   { tipo: 'descartada', motivo: 'ignorar' | 'fuera_de_dieta' | 'sin_parecido', detalle }
export function clasificarLinea(linea, ctx = {}) {
  const { tabla, aprendido, foodsById } = ctx;
  const productos = tabla?.productos ?? tabla ?? {};
  const dentro = conjuntoDe(ctx.conjunto);
  const clave = normalizarDescripcion(linea.descripcion);
  let regla = null;
  if (propio(aprendido, clave)) {
    if (aprendido[clave] === 'ignorar') return descartada('ignorar', 'Marcado por ti como «no es de la dieta».');
    const a = leerAprendido(aprendido[clave]);
    if (a) regla = { ...a, origen: 'aprendido' };
  } else if (propio(productos, clave)) {
    const p = productos[clave];
    if (p.ignorar) return descartada('ignorar', p.motivo ?? '');
    regla = { ...p, origen: 'tabla' };
  }
  if (regla) {
    if (!dentro.has(regla.food_id)) return descartada('fuera_de_dieta', `${regla.food_id} ya no está en la dieta.`, { food_id: regla.food_id });
    const b = cantidadBruta(linea, regla);
    if (b.motivo) return duda(linea, b.motivo, [regla.food_id], { food_id: regla.food_id });
    const c = gramosComestibles(b.bruto, alimento(foodsById, regla.food_id));
    if (!(c.gramos > 0)) return duda(linea, 'ilegible', [regla.food_id], { food_id: regla.food_id });
    return { tipo: 'compra', food_id: regla.food_id, gramos: c.gramos, bruto: b.bruto, factor: c.factor, sinPorcionComestible: c.sinDato, origen: regla.origen, confirmar: regla.confirmar === true };
  }
  const cand = candidatosParecidos(linea.descripcion, ctx.indice ?? indiceParecido(dentro, foodsById));
  if (!cand.length) return descartada('sin_parecido', 'No se parece a nada de la dieta.');
  return duda(linea, 'parecido', cand);
}

// ---------- aplicar un ticket ----------

// Momento de las compras de un ticket: su fecha y hora (el stock solo suma lo posterior al recuento: un recuento hecho antes
// de comprar suma la compra y uno hecho después ya la cuenta). Sin hora en el ticket, el principio del día. Se puede forzar con ctx.momento.
const momentoDeTicket = (fecha, hora) => `${fecha}T${hora && /^\d{2}:\d{2}$/.test(hora) ? hora : '00:00'}`;

// Aplica un ticket parseado al inventario. ctx: { tabla, conjunto, foodsById, origen ('correo'|'app'), ahora (Date), momento, id }.
// -> { inventario, compras: [{ food_id, gramos, linea, descripcion, ... }], dudas: [duda creada], descartadas: [{ linea, descripcion,
//      motivo, detalle }], avisos: [texto], yaAplicado }. Un hash ya aplicado no suma nada. La misma línea nunca suma dos veces
// (anadirCompra es idempotente por ticket + línea + alimento). Las descartadas no se guardan en ningún sitio.
export function aplicarTicket(inv, ticket, ctx = {}) {
  const vacio = { compras: [], dudas: [], descartadas: [], avisos: [] };
  if (ticketAplicado(inv, ticket.hash)) return { inventario: inv, ...vacio, posible_duplicado: null, yaAplicado: true };
  const { tabla, conjunto, foodsById, origen = 'app', ahora = new Date(), id } = ctx;
  const indice = ctx.indice ?? indiceParecido(conjunto, foodsById);
  const momento = ctx.momento ?? momentoDeTicket(ticket.fecha, ticket.hora);
  const opciones = id ? { id } : undefined;
  let cur = inv;
  const { compras, dudas, descartadas, avisos } = vacio;
  // Otro ticket ya aplicado con la misma fecha y hora (p. ej. PDF y texto con alguna línea distinta): quizá es el mismo.
  const parecido = ticket.hora ? Object.entries(inv.tickets).find(([h, t]) => h !== ticket.hash && t.fecha === ticket.fecha && t.hora === ticket.hora) : null;
  const posible_duplicado = parecido ? parecido[0] : null;
  if (posible_duplicado) avisos.push(`posible_duplicado: ya hay otro ticket del ${ticket.fecha} a las ${ticket.hora}; comprueba que no es el mismo.`);
  for (const l of ticket.lineas) {
    const c = clasificarLinea(l, { tabla, aprendido: inv.aprendido, conjunto, foodsById, indice });
    if (c.tipo === 'compra') {
      cur = anadirCompra(cur, { food_id: c.food_id, gramos: c.gramos, momento, ticket: ticket.hash, linea: l.n }, opciones);
      compras.push({ ...c, linea: l.n, descripcion: l.descripcion });
      if (c.sinPorcionComestible) avisos.push(`«${l.descripcion}»: ${c.food_id} no tiene porción comestible en tu documento; se cuenta el peso entero.`);
      if (c.confirmar) avisos.push(`«${l.descripcion}»: el tamaño del envase está pendiente de confirmar.`);
    } else if (c.tipo === 'duda') {
      const d = {
        ticket: ticket.hash, linea: l.n, fecha: ticket.fecha, hora: ticket.hora ?? null, momento, descripcion: l.descripcion, cantidad: l.cantidad, peso_kg: l.peso_kg,
        candidatos: c.candidatos, motivo: c.motivo, gramos_sugeridos: c.gramos_sugeridos,
      };
      if (c.food_id) d.food_id = c.food_id;
      cur = anadirDuda(cur, d, opciones);
      dudas.push(cur.dudas[cur.dudas.length - 1]);
    } else {
      descartadas.push({ linea: l.n, descripcion: l.descripcion, motivo: c.motivo, detalle: c.detalle });
    }
  }
  cur = registrarTicket(cur, ticket.hash, { fecha: ticket.fecha, hora: ticket.hora, aplicado: momentoLocal(ahora), origen });
  return { inventario: cur, compras, dudas, descartadas, avisos, posible_duplicado, yaAplicado: false };
}

// ---------- resolver una duda ----------

// Respuesta de Victor a una duda: { food_id, gramos } (gramos BRUTOS del ticket: se aplica la porción comestible) o { ignorar: true }.
// Suma la compra (con el momento y la línea del ticket), quita la duda y, con `recordar`, apunta la respuesta en `aprendido` para
// que el siguiente ticket con esa descripción se asigne solo:
//   - ignorar -> 'ignorar';
//   - a peso, o que pregunta los gramos cada vez (motivo preguntar_gramos / sin_peso) -> solo el alimento (los gramos se
//     vuelven a preguntar, o salen del peso);
//   - el resto -> 'food_id:gramos_por_unidad' (gramos ÷ cantidad), para repetir la cantidad.
// ctx: { foodsById, conjunto (si viene, el alimento debe estar), momento, id }. -> { inventario, compra: {…}|null }.
export function resolverDuda(inv, dudaId, { food_id, ignorar, gramos, recordar } = {}, ctx = {}) {
  const d = inv.dudas.find((x) => x.id === dudaId);
  if (!d) throw new Error(`No existe la duda ${dudaId}.`);
  const clave = normalizarDescripcion(d.descripcion);
  if (ignorar) {
    let n = quitarDuda(inv, dudaId);
    if (recordar) n = aprender(n, clave, 'ignorar');
    return { inventario: n, compra: null };
  }
  if (!food_id) throw new Error('Elige el alimento (o «No es de la dieta»).');
  if (ctx.conjunto && !conjuntoDe(ctx.conjunto).has(food_id)) throw new Error(`${food_id} no está en la dieta.`);
  if (!esNum(gramos) || !(gramos > 0)) throw new Error('Pon los gramos comprados (más de 0).');
  const c = gramosComestibles(gramos, alimento(ctx.foodsById, food_id));
  const momento = ctx.momento ?? (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.momento ?? '') ? d.momento : momentoDeTicket(d.fecha ?? momentoLocal().slice(0, 10), d.hora));
  let n = anadirCompra(inv, { food_id, gramos: c.gramos, momento, ticket: d.ticket, linea: d.linea }, ctx.id ? { id: ctx.id } : undefined);
  n = quitarDuda(n, dudaId);
  if (recordar) {
    const porPeso = esNum(d.peso_kg) && d.peso_kg > 0;
    const fijo = !porPeso && d.motivo !== 'preguntar_gramos' && d.motivo !== 'sin_peso' && Number.isInteger(d.cantidad) && d.cantidad > 0;
    n = aprender(n, clave, fijo ? `${food_id}:${r3(gramos / d.cantidad)}` : food_id);
  }
  return { inventario: n, compra: { food_id, gramos: c.gramos, bruto: gramos, factor: c.factor, sinPorcionComestible: c.sinDato, linea: d.linea } };
}
