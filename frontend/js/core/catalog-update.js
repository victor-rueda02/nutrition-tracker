// Actualizar el documento del dispositivo con el data/foods.csv publicado, sin perder lo que cambiaste desde la app.
// Fusión a tres bandas por alimento y por campo:
//   base = el foods.csv publicado que el dispositivo copió la última vez (ajuste "catalogo_base"),
//   mío = el documento del dispositivo (con lo que cambiaste: activar alimentos, alias, porciones...),
//   publicado = el foods.csv publicado ahora.
// Solo cambió el publicado -> se actualiza; solo cambiaste tú -> se conserva; los dos -> conflicto (eliges tú).
// Sin base (instalaciones anteriores a esto), lo único que se ha podido cambiar desde la app es activar alimentos:
// solo "incluir" puede dar conflicto y el resto viene del publicado. Nunca se borra un alimento (puede estar en el
// diario): los que ya no están publicados se mantienen. Funciones puras, sin DOM.
import { serializePortions } from './portions.js';

// Huella de un texto (FNV-1a de 32 bits): no necesita crypto.subtle (que exige https).
export function hashText(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const CORE = [
  ['nombre', 'nombre'], ['alias', 'alias'], ['porciones', 'porciones'], ['estado', 'estado'], ['grupo', 'grupo'],
  ['varianteDefecto', 'variante_por_defecto'], ['densidad', 'densidad_g_ml'], ['pesoEnCrudo', 'peso_en_crudo'],
];
// Sin base, lo único que la app ha podido cambiar es activar un alimento (incluir de "no" a "si"): solo es conflicto
// si en el dispositivo está activo y en lo publicado excluido; lo demás viene del publicado.
const incluido = (v) => String(v ?? '').trim().toLowerCase() !== 'no';

// Todos los campos de un alimento como { id del campo -> valor comparable (texto) }.
function campos(food, catalog) {
  const out = new Map();
  if (!food) return out;
  for (const [k] of CORE) {
    const v = food[k];
    out.set(`core:${k}`, k === 'alias' ? (v ?? []).join('|') : k === 'porciones' ? serializePortions(v ?? []) : v === null || v === undefined || v === '' ? '' : String(v));
  }
  for (const k of catalog.keys) out.set(`nutriente:${k}`, typeof food.nutrients?.[k] === 'number' ? String(food.nutrients[k]) : '');
  for (const [k, v] of Object.entries(food.extra ?? {})) out.set(`extra:${k}`, v ?? '');
  return out;
}

// Copia un campo de un alimento a otro (para aplicar el valor publicado).
function copiar(to, from, campo) {
  const [tipo, k] = [campo.slice(0, campo.indexOf(':')), campo.slice(campo.indexOf(':') + 1)];
  if (tipo === 'core') to[k] = structuredCloneSafe(from?.[k]);
  else if (tipo === 'nutriente') { if (typeof from?.nutrients?.[k] === 'number') to.nutrients[k] = from.nutrients[k]; else delete to.nutrients[k]; }
  else if (from?.extra?.[k]) to.extra[k] = from.extra[k]; else delete to.extra[k];
}
const structuredCloneSafe = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const copia = (f) => ({ ...f, alias: [...(f.alias ?? [])], porciones: (f.porciones ?? []).map((p) => ({ ...p })), nutrients: { ...f.nutrients }, extra: { ...f.extra } });

// Nombre legible de un campo (para enseñar los conflictos y los cambios).
export function etiquetaCampo(campo, catalog) {
  const k = campo.slice(campo.indexOf(':') + 1);
  if (campo.startsWith('core:')) return CORE.find(([c]) => c === k)?.[1] ?? k;
  if (campo.startsWith('nutriente:')) return catalog.byKey.get(k)?.label ?? k;
  return k;
}

// Plan de actualización. Devuelve { foods (con los conflictos resueltos como "mío"), nuevos, actualizados,
// retirados, conflictos: [{ id, nombre, campo, etiqueta, mio, publicado }], hayCambios }.
export function planCatalogUpdate({ local, remote, base = null, catalog }) {
  const L = new Map(local.map((f) => [f.id, f]));
  const R = new Map(remote.map((f) => [f.id, f]));
  const B = base ? new Map(base.map((f) => [f.id, f])) : null;
  const fusion = new Map(); // id -> alimento resultante, de los que están en el dispositivo y publicados
  const nuevos = [];
  const actualizados = [];
  const conflictos = [];
  for (const l of local) {
    const r = R.get(l.id);
    if (!r) continue; // ya no está publicado: se mantiene (al final)
    const out = copia(l);
    const cl = campos(l, catalog);
    const cr = campos(r, catalog);
    const cb = B ? campos(B.get(l.id), catalog) : null;
    const cambiados = [];
    for (const campo of new Set([...cl.keys(), ...cr.keys()])) {
      const vl = cl.get(campo) ?? '';
      const vr = cr.get(campo) ?? '';
      if (vl === vr) continue;
      let publicado;
      if (cb && B.has(l.id)) {
        const vb = cb.get(campo) ?? '';
        if (vl === vb) publicado = true; // solo cambió el publicado
        else if (vr === vb) publicado = false; // solo lo cambiaste tú
        else publicado = null; // los dos: conflicto
      } else if (cb) publicado = null; // alimento que la base no tenía pero los dos sí: conflicto si difieren
      else publicado = campo === 'extra:incluir' ? (incluido(vl) && !incluido(vr) ? null : true) : true; // sin base
      if (publicado === true) { copiar(out, r, campo); cambiados.push(campo); }
      else if (publicado === null) conflictos.push({ id: l.id, nombre: l.nombre, campo, etiqueta: etiquetaCampo(campo, catalog), mio: vl, publicado: vr });
    }
    if (cambiados.length) actualizados.push({ id: l.id, nombre: out.nombre, campos: cambiados.map((c) => etiquetaCampo(c, catalog)) });
    fusion.set(l.id, out);
  }
  // En el orden del documento publicado; los que ya no están publicados, al final.
  const foods = remote.map((r) => fusion.get(r.id) ?? copia(r));
  for (const r of remote) if (!L.has(r.id)) nuevos.push({ id: r.id, nombre: r.nombre });
  const quedan = local.filter((l) => !R.has(l.id));
  foods.push(...quedan);
  const retirados = quedan.map((l) => ({ id: l.id, nombre: l.nombre }));
  return { foods, nuevos, actualizados, retirados, conflictos, hayCambios: nuevos.length + actualizados.length + conflictos.length > 0 };
}

// Aplica tus elecciones en los conflictos: elecciones = { "id|campo": "publicado" | "mio" } (por defecto, "mío").
export function applyChoices(plan, remote, elecciones = {}) {
  const R = new Map(remote.map((f) => [f.id, f]));
  const foods = plan.foods.map((f) => copia(f));
  const porId = new Map(foods.map((f) => [f.id, f]));
  for (const c of plan.conflictos) {
    if (elecciones[`${c.id}|${c.campo}`] === 'publicado') copiar(porId.get(c.id), R.get(c.id), c.campo);
  }
  return foods;
}

// Cabeceras extra (columnas de trabajo) de los dos documentos, sin repetir y en orden.
export const unirCabeceras = (a = [], b = []) => [...a, ...b.filter((h) => !a.includes(h))];
