// Contrato compartido cliente/worker: qué viaja a la IA (lista compacta SIN nutrientes) y cómo se detecta el estado.
// El prompt y el esquema de salida viven en worker/src/prompt.js (para ajustarlos sin tocar la app).
import { normalizeText, removeTerms, sameWord } from './text.js';

export const MAX_GRAMS = 2000; // por encima se pide confirmación

// Alimento -> forma compacta que viaja a internet: id, nombre, alias, porciones y datos de variante
// (estado, grupo, defecto, peso_en_crudo). Nunca nutrientes ni densidad.
export function toCompact(food) {
  const c = { id: food.id, nombre: food.nombre };
  if (food.alias?.length) c.alias = [...food.alias];
  if (food.porciones?.length) c.porciones = food.porciones.map((p) => ({ nombre: p.nombre, gramos: p.gramos }));
  if (food.estado) c.estado = food.estado;
  if (food.grupo) { c.grupo = food.grupo; c.defecto = food.varianteDefecto === true; }
  if (food.pesoEnCrudo) c.peso_en_crudo = true; // solo si está marcado; lo necesita la regla de variantes del worker
  return c;
}

// Los alimentos con incluir=no (columna de trabajo) no se envían a la IA salvo que se pida.
export function buildCompactList(foods, { includeExcluded = false } = {}) {
  return foods
    .filter((f) => includeExcluded || normalizeText(f.extra?.incluir) !== 'no')
    .map(toCompact);
}

// Detecta en el texto de UNA línea si el usuario dijo el estado. null = no lo dijo (o es ambiguo).
const ESTADO_PATTERNS = {
  crudo: /\bcrud[oa]s?\b/,
  cocinado: /\b(cocid[oa]s?|cocinad[oa]s?|asad[oa]s?|hervid[oa]s?|frit[oa]s?|guisad[oa]s?|saltead[oa]s?|rehogad[oa]s?|al horno|a la plancha|plancha|al vapor|a la brasa|a la parrilla)\b/,
  tostado: /\btostad[oa]s?\b/,
};
export function detectEstado(text) {
  const t = normalizeText(text);
  const found = Object.keys(ESTADO_PATTERNS).filter((k) => ESTADO_PATTERNS[k].test(t));
  return found.length === 1 ? found[0] : null;
}

// ¿La línea expresa un volumen? ("5 ml", "medio litro", "2 cl", "0,5 l"). Para detectar que el modelo lo pasó como gramos.
const VOLUMEN = /(\b(ml|mililitros?|cl|centilitros?|litros?)\b|\d\s*l\b)/;
export const detectVolumen = (text) => VOLUMEN.test(normalizeText(text));

// ¿La línea dice un peso? ("150 g", "150gr", "200 gramos", "medio kilo", "1,5 kg").
const PESO = /(\b(g|gr|grs|gramos?|kg|kgs|kilos?|kilogramos?)\b|\d\s*(g|gr|kg)\b)/;
export const detectPeso = (text) => PESO.test(normalizeText(text));

// Un número dicho SIN unidad de peso ni de volumen: por debajo de este valor son unidades ("2 huevos", "1 manzana");
// desde este valor se asume que son gramos ("150 de arroz"), con el aviso "asumido en gramos". Cámbialo aquí: lo usan
// la validación, el borrador y el prompt.
export const UMBRAL_GRAMOS_SIN_UNIDAD = 20;

const PALABRAS_NUMERO = new Map(Object.entries({
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  medio: 0.5, media: 0.5, cuarto: 0.25, tercio: 1 / 3, par: 2, docena: 12,
}));

// Primera cantidad dicha: cifras ("150", "1,5", "1/2") o palabras ("dos", "medio", "un cuarto", "un par", "media docena",
// "dos y medio"). null si no hay. Quita antes los nombres del alimento (removeTerms) para no leer el 85 de "chocolate 85".
export function cantidadDicha(text) {
  const t = normalizeText(text);
  const m = t.match(/(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+))?/);
  if (m) {
    const n = Number(m[1].replace(',', '.'));
    return m[2] ? n / Number(m[2]) : n;
  }
  const w = t.split(/[^a-z0-9]+/).filter(Boolean);
  const i = w.findIndex((x) => PALABRAS_NUMERO.has(x));
  if (i < 0) return null;
  let n = PALABRAS_NUMERO.get(w[i]);
  if (['un', 'una', 'uno'].includes(w[i]) && ['cuarto', 'tercio', 'par', 'docena'].includes(w[i + 1])) n = PALABRAS_NUMERO.get(w[i + 1]);
  else if (['medio', 'media'].includes(w[i]) && w[i + 1] === 'docena') n = 6;
  if (w[i + 1] === 'y' && ['medio', 'media'].includes(w[i + 2])) n += 0.5;
  return n;
}

// Porción nombrada con su número ("4 flus de aceite", "25 flus de aceite", "2 cucharadas y media de aceite"): gramos =
// número × porción, sea cual sea el número (también 20 o más: no se asumen gramos si se nombra la porción). Solo cuando
// está claro: UNA porción del alimento nombrada una vez, su número justo delante («un cuarto de vaso», «un par de
// cucharadas»: el «de» se salta), «y medio/a» detrás suma 0,5, y ningún otro número en el fragmento («un vaso de leche
// con dos cucharaditas…», «3 rebanadas … de 30»). Si no, null y sigue la regla de siempre (sin porción o gramos asumidos).
// El nombre y los alias del alimento se quitan antes («125 de yogur» no nombra la porción «yogur»). Lo usan la validación
// de la IA y el borrador: el código decide los gramos (regla 3).
const ficha = (t) => t.replace(/[^a-z0-9.,/]/g, '');
export function gramosDePorcionNombrada(text, food) {
  const nombres = [food?.nombre, ...(food?.alias ?? [])].filter(Boolean);
  const tw = removeTerms(String(text ?? ''), nombres).split(' ').map(ficha).filter(Boolean);
  const letras = tw.map((t) => t.replace(/[^a-z0-9]/g, ''));
  const porciones = (food?.porciones ?? []).filter((x) => x.gramos > 0)
    .map((p) => ({ p, ws: normalizeText(p.nombre).split(/[^a-z0-9]+/).filter(Boolean) }))
    .sort((a, b) => b.ws.length - a.ws.length); // la más larga primero («rebanada fina» antes que «rebanada»)
  const hits = [];
  for (const { p, ws } of porciones) {
    for (let i = 0; i + ws.length <= letras.length; i++) {
      const e = i + ws.length;
      if (ws.every((w, j) => sameWord(letras[i + j], w)) && !hits.some((h) => i < h.e && e > h.s)) hits.push({ p, s: i, e });
    }
  }
  if (hits.length !== 1) return null;
  const { p, s, e } = hits[0];
  let ini = s;
  if (letras[ini - 1] === 'de') ini--;
  const desde = Math.max(0, ini - 2);
  const n0 = cantidadDicha(tw.slice(desde, ini).join(' '));
  if (n0 === null || !(n0 > 0)) return null;
  let fin = e;
  let n = n0;
  if (letras[e] === 'y' && ['medio', 'media'].includes(letras[e + 1])) { n += 0.5; fin = e + 2; }
  if (cantidadDicha([...tw.slice(0, desde), ...tw.slice(fin)].join(' ')) !== null) return null; // otro número: no está claro
  return Math.round(n * p.gramos * 1000) / 1000;
}
