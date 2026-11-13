// Texto por líneas de un PDF como el ticket digital de Mercadona (PDF 1.4 de openhtmltopdf: una página alta, flujos
// FlateDecode, fuentes Type0 / Identity-H con CMap ToUnicode). Sin dependencias ni DOM: lo usan el Worker (que recibe el PDF
// por correo) y la app (subir un ticket). Solo lo necesario:
//   1. indexa los objetos del fichero (sin la tabla xref: no hace falta y se rompe con PDFs mal cerrados);
//   2. descomprime solo lo que usa (contenido de las páginas y los CMap) con DecompressionStream('deflate')
//      (iOS 16.4+, Workers, Node 18+);
//   3. recorre el contenido con Tf / Tm / Td / TD / T* / Tj / TJ / ' / " y traduce cada código con el ToUnicode de SU fuente
//      (bfchar y bfrange);
//   4. agrupa las piezas por coordenada y (tolerancia según el cuerpo de letra) y las ordena por x: así las columnas
//      «Cnt. Descripción P. Unit Importe» vuelven a ser una línea.
// No cubre PDFs cifrados ni con objetos dentro de flujos (ObjStm): falla con un PdfError claro y queda «Pegar el texto».
export class PdfError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // pdf_invalido · pdf_cifrado · pdf_no_soportado · sin_descompresion · sin_texto
  }
}

const fallo = (code, msg) => new PdfError(code, msg);
const esNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Bytes -> cadena con un carácter por byte (no usa TextDecoder('latin1'): en los navegadores es windows-1252 y cambia 0x80-0x9F).
function aLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x4000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x4000));
  return s;
}

// ---------- lector de tokens PDF (objetos y flujos de contenido) ----------

// Espacio en blanco de PDF: NUL, tab, LF, FF, CR y espacio (no el \s de JS, que incluye 0xA0).
const ESPACIO = /[\0\t\n\f\r ]*(?:%[^\r\n]*[\0\t\n\f\r ]*)*/y;
const NUMERO = /[+-]?(?:\d+\.?\d*|\.\d+)/y;
const NOMBRE = /\/([^\0\t\n\f\r /[\]()<>{}%]*)/y;
const PALABRA = /[^\0\t\n\f\r /[\]()<>{}%]+/y;

const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

// Cadena literal (...) desde `i` (en '('): devuelve [texto con un carácter por byte, posición tras ')'].
function leerLiteral(s, i) {
  let prof = 1;
  let out = '';
  i++;
  while (i < s.length && prof > 0) {
    const c = s[i];
    if (c === '\\') {
      const d = s[i + 1];
      if (d >= '0' && d <= '7') {
        let j = i + 1;
        let oct = '';
        while (j < s.length && oct.length < 3 && s[j] >= '0' && s[j] <= '7') oct += s[j++];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        i = j;
        continue;
      }
      if (d === '\r') { i += s[i + 2] === '\n' ? 3 : 2; continue; } // continuación de línea
      if (d === '\n') { i += 2; continue; }
      out += d in ESCAPES ? ESCAPES[d] : (d ?? '');
      i += 2;
      continue;
    }
    if (c === '(') prof++;
    else if (c === ')') { prof--; if (prof === 0) { i++; break; } }
    out += c;
    i++;
  }
  return [out, i];
}

function leerHex(s, i) {
  const fin = s.indexOf('>', i);
  const limpio = s.slice(i + 1, fin < 0 ? s.length : fin).replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let k = 0; k < limpio.length; k += 2) out += String.fromCharCode(parseInt(limpio.slice(k, k + 2).padEnd(2, '0'), 16));
  return [out, fin < 0 ? s.length : fin + 1];
}

// Siguiente token desde `i`: { t, v, i } con t = 'num' | 'nom' | 'str' | 'op' (palabra) | '[' | ']' | '<<' | '>>' | 'fin'.
function token(s, i) {
  ESPACIO.lastIndex = i;
  ESPACIO.exec(s);
  i = ESPACIO.lastIndex;
  if (i >= s.length) return { t: 'fin', v: null, i };
  const c = s[i];
  if (c === '/') {
    NOMBRE.lastIndex = i;
    NOMBRE.exec(s);
    const v = s.slice(i + 1, NOMBRE.lastIndex).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return { t: 'nom', v, i: NOMBRE.lastIndex };
  }
  if (c === '(') { const [v, j] = leerLiteral(s, i); return { t: 'str', v, i: j }; }
  if (c === '<') {
    if (s[i + 1] === '<') return { t: '<<', v: null, i: i + 2 };
    const [v, j] = leerHex(s, i);
    return { t: 'str', v, i: j };
  }
  if (c === '>') return s[i + 1] === '>' ? { t: '>>', v: null, i: i + 2 } : { t: 'op', v: '>', i: i + 1 };
  if (c === '[' || c === ']') return { t: c, v: null, i: i + 1 };
  NUMERO.lastIndex = i;
  if (NUMERO.test(s) && !/[A-Za-z*'"]/.test(s[NUMERO.lastIndex] ?? '')) return { t: 'num', v: parseFloat(s.slice(i, NUMERO.lastIndex)), i: NUMERO.lastIndex };
  PALABRA.lastIndex = i;
  if (PALABRA.exec(s)) return { t: 'op', v: s.slice(i, PALABRA.lastIndex), i: PALABRA.lastIndex };
  return { t: 'op', v: c, i: i + 1 }; // '{' '}' sueltos
}

// ---------- objetos ----------
// Valores: número, true/false/null, nombre = { nom }, cadena = { str }, referencia = { ref }, array, diccionario (objeto plano).

const MAX_PROFUNDIDAD = 50; // arrays y diccionarios anidados: un PDF hostil no debe agotar la pila

function valor(s, tk, prof = 0) {
  if (prof > MAX_PROFUNDIDAD) throw fallo('pdf_invalido', 'El PDF tiene estructuras anidadas en exceso.');
  switch (tk.t) {
    case 'num': {
      // ¿«N G R»?
      if (Number.isInteger(tk.v) && tk.v >= 0) {
        const t2 = token(s, tk.i);
        if (t2.t === 'num' && Number.isInteger(t2.v)) {
          const t3 = token(s, t2.i);
          if (t3.t === 'op' && t3.v === 'R') return [{ ref: tk.v }, t3.i];
        }
      }
      return [tk.v, tk.i];
    }
    case 'nom': return [{ nom: tk.v }, tk.i];
    case 'str': return [{ str: tk.v }, tk.i];
    case '[': {
      const arr = [];
      let i = tk.i;
      for (;;) {
        const t = token(s, i);
        if (t.t === ']' || t.t === 'fin') return [arr, t.i];
        const [v, j] = valor(s, t, prof + 1);
        arr.push(v);
        i = j;
      }
    }
    case '<<': {
      const d = {};
      let i = tk.i;
      for (;;) {
        const k = token(s, i);
        if (k.t === '>>' || k.t === 'fin') return [d, k.i];
        if (k.t !== 'nom') { i = k.i; continue; } // basura: se salta
        const [v, j] = valor(s, token(s, k.i), prof + 1);
        d[k.v] = v;
        i = j;
      }
    }
    case 'op': return [tk.v === 'true' ? true : tk.v === 'false' ? false : null, tk.i];
    default: return [null, tk.i];
  }
}

// Todos los objetos «N G obj … endobj» del fichero: Map num -> { pos, ini, fin, v } con `pos` = dónde empieza su valor (se
// interpreta solo si hace falta: un ticket trae cientos de objetos de estructura que no importan y el Worker tiene poca CPU) e
// ini/fin = bytes del flujo, si lo tiene (-1 si no).
function indexarObjetos(s) {
  const objs = new Map();
  const cab = /(\d+)\s+\d+\s+$/; // «N G » justo antes de la palabra obj
  const fin = /endobj|stream\r?\n/g; // lo primero que aparece tras el valor: el final del objeto o el inicio de su flujo
  let ultimo = null;
  // Se busca la palabra «obj» con indexOf (nativo) y se mira atrás: un regex «\d+\s+\d+\s+obj» tropieza con la tabla xref.
  for (let k = s.indexOf('obj'); k >= 0; k = s.indexOf('obj', k + 3)) {
    if (s.startsWith('end', k - 3) || /[A-Za-z0-9]/.test(s[k + 3] ?? '')) continue; // «endobj» o una palabra más larga
    const m = cab.exec(s.slice(Math.max(0, k - 24), k));
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const pos = k + 3;
    const o = { pos, ini: -1, fin: -1, v: undefined };
    // El primer «endobj/stream» desde `pos` es el mismo que ya se encontró si éste está más adelante: no se vuelve a buscar
    // (con muchos «1 0 obj» sin cerrar, buscar cada vez hasta el final del fichero sería cuadrático).
    let h;
    if (ultimo && ultimo.index >= pos) h = ultimo;
    else {
      fin.lastIndex = pos;
      h = fin.exec(s);
      if (!h) break; // ya no hay más finales de objeto ni flujos: lo que queda no es un objeto cerrado
      ultimo = h;
    }
    if (h[0] !== 'endobj') {
      const ini = h.index + h[0].length;
      let f = -1;
      const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(s.slice(pos, h.index));
      if (lm && !lm[2]) { // longitud directa (si es una referencia se busca endstream)
        const len = parseInt(lm[1], 10);
        const e = s.indexOf('endstream', ini + len);
        if (e >= 0 && e - (ini + len) <= 4) f = ini + len; // la longitud declarada, comprobada
      }
      if (f < 0) {
        const e = s.indexOf('endstream', ini);
        f = e < 0 ? s.length : e;
        if (s[f - 1] === '\n') f--;
        if (s[f - 1] === '\r') f--;
      }
      o.ini = ini;
      o.fin = f;
      k = Math.max(k, f - 3); // se salta el binario
    }
    if (!objs.has(num)) objs.set(num, o); // si hay versiones del mismo objeto, vale la primera (no se usan actualizaciones incrementales)
  }
  return objs;
}

export const MAX_INFLADO = 20 * 1024 * 1024; // un flujo de un ticket descomprime a menos de 1 MB; más es una bomba de deflate

async function inflar(bytes) {
  if (typeof DecompressionStream === 'undefined') throw fallo('sin_descompresion', 'Este navegador no puede descomprimir PDF (hace falta iOS 16.4 o posterior): pega el texto del ticket.');
  const ds = new DecompressionStream('deflate');
  const lector = new Blob([bytes]).stream().pipeThrough(ds).getReader();
  const trozos = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > MAX_INFLADO) {
        lector.cancel().catch(() => {});
        throw fallo('pdf_no_soportado', 'Un flujo del PDF descomprime a un tamaño desmedido.');
      }
      trozos.push(value);
    }
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw fallo('pdf_invalido', `No se pudo descomprimir un flujo del PDF (${e?.message ?? e}).`);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const t of trozos) { out.set(t, off); off += t.length; }
  return out;
}

class Documento {
  constructor(bytes) {
    this.bytes = bytes;
    // Del fichero entero solo importa su parte de texto (diccionarios y números): TextDecoder (nativo) conserva un carácter por
    // byte y las posiciones; el binario no se lee de aquí (los flujos salen de `bytes` y de aLatin1, exactos).
    this.s = new TextDecoder('windows-1252').decode(bytes);
    this.objs = indexarObjetos(this.s);
    this.cache = new Map();
  }
  // Valor de un objeto indexado (se interpreta la primera vez que se pide).
  valorDe(o) {
    if (o && o.v === undefined) o.v = valor(this.s, token(this.s, o.pos))[0];
    return o ? o.v : null;
  }
  resolver(v) {
    for (let n = 0; v && typeof v === 'object' && 'ref' in v && n < 20; n++) v = this.valorDe(this.objs.get(v.ref));
    return v ?? null;
  }
  dic(v) {
    const r = this.resolver(v);
    return r && typeof r === 'object' && !Array.isArray(r) && !('nom' in r) && !('str' in r) && !('ref' in r) ? r : null;
  }
  lista(v) {
    const r = this.resolver(v);
    return Array.isArray(r) ? r : null;
  }
  // Datos del flujo de un objeto o referencia, descomprimidos (FlateDecode o sin filtro). Como cadena latin1.
  async flujo(v) {
    const ref = v && typeof v === 'object' && 'ref' in v ? v.ref : null;
    if (ref !== null && this.cache.has(ref)) return this.cache.get(ref);
    const o = ref !== null ? this.objs.get(ref) : null;
    if (!o || o.ini < 0) throw fallo('pdf_invalido', 'Falta un flujo del PDF.');
    const d = this.dic(this.valorDe(o)) ?? {};
    const f = d.Filter;
    const filtros = (Array.isArray(f) ? f : f ? [f] : []).map((x) => this.resolver(x)?.nom);
    let datos = this.bytes.subarray(o.ini, o.fin);
    for (const nombre of filtros) {
      if (nombre !== 'FlateDecode' && nombre !== 'Fl') throw fallo('pdf_no_soportado', `Filtro de PDF no soportado: ${nombre}.`);
      datos = await inflar(datos);
    }
    const texto = aLatin1(datos);
    this.cache.set(ref, texto);
    return texto;
  }
}

// Páginas en orden (árbol de /Pages desde el catálogo; sin catálogo, todas las /Page del fichero) con sus /Resources heredados.
function paginasDe(doc) {
  const out = [];
  const visto = new Set();
  const visitar = (v, heredado) => {
    const d = doc.dic(v);
    if (!d || visto.has(d)) return;
    visto.add(d);
    const res = d.Resources ?? heredado;
    const tipo = doc.resolver(d.Type)?.nom;
    if (tipo === 'Pages' || d.Kids) for (const k of doc.lista(d.Kids) ?? []) visitar(k, res);
    else out.push({ d, resources: res });
  };
  // El catálogo sale del trailer (/Root N G R); sin él, se mira objeto por objeto.
  const t = /\/Root\s+(\d+)\s+\d+\s+R/.exec(doc.s.slice(-2048)) ?? /\/Root\s+(\d+)\s+\d+\s+R/.exec(doc.s.slice(0, 2048));
  const catalogo = t ? doc.dic({ ref: parseInt(t[1], 10) }) : null;
  if (catalogo?.Pages) visitar(catalogo.Pages, null);
  if (!out.length) {
    for (const o of doc.objs.values()) {
      const d = o.ini < 0 ? doc.dic(doc.valorDe(o)) : null;
      if (d && doc.resolver(d.Type)?.nom === 'Page') out.push({ d, resources: d.Resources ?? null });
    }
  }
  return out;
}

// ---------- fuentes: ToUnicode y anchos ----------

// Destino de un CMap: texto en UTF-16BE en hexadecimal (4 dígitos por unidad; uno de 2 dígitos es un solo carácter).
const unidades = (hex) => {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex || '0', 16));
  let t = '';
  for (let i = 0; i < hex.length; i += 4) t += String.fromCharCode(parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16));
  return t;
};

// CMap ToUnicode -> { ancho: bytes por código, trad(código) -> texto }.
export function leerToUnicode(cmap) {
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap);
  const primero = cs ? /<([0-9A-Fa-f]+)>/.exec(cs[1]) : null;
  const ancho = primero ? Math.max(1, Math.round(primero[1].length / 2)) : 2;
  const chars = new Map();
  const rangos = []; // { lo, hi, base (texto) } o { lo, hi, lista }
  for (const b of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) chars.set(parseInt(p[1], 16), unidades(p[2]));
  }
  for (const b of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      if (p[3][0] === '[') rangos.push({ lo, hi, lista: [...p[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => unidades(x[1])) });
      else rangos.push({ lo, hi, base: unidades(p[3].slice(1, -1)) });
    }
  }
  const memo = new Map();
  const trad = (cod) => {
    if (memo.has(cod)) return memo.get(cod);
    let r = chars.get(cod);
    if (r === undefined) {
      for (const g of rangos) {
        if (cod < g.lo || cod > g.hi) continue;
        if (g.lista) r = g.lista[cod - g.lo];
        else if (g.base) r = g.base.slice(0, -1) + String.fromCharCode(g.base.charCodeAt(g.base.length - 1) + (cod - g.lo));
        if (r !== undefined) break;
      }
    }
    memo.set(cod, r ?? '');
    return r ?? '';
  };
  return { ancho, trad };
}

// Anchos (milésimas de em) del array /W de una CIDFont: [c [w1 w2 …] c1 c2 w …].
function anchosCid(doc, arr) {
  const m = new Map();
  const l = doc.lista(arr) ?? [];
  for (let i = 0; i < l.length;) {
    const c = l[i];
    const sig = doc.resolver(l[i + 1]);
    if (Array.isArray(sig)) { sig.forEach((w, k) => { const n = doc.resolver(w); if (esNum(n)) m.set(c + k, n); }); i += 2; }
    else { const w = doc.resolver(l[i + 2]); if (esNum(sig) && esNum(w) && sig >= c && sig - c <= 0xffff) for (let k = c; k <= sig; k++) m.set(k, w); i += 3; } // un rango de más de 65 536 códigos no es de este mundo: se salta
  }
  return m;
}

async function leerFuente(doc, ref) {
  const d = doc.dic(ref);
  if (!d) return null;
  const subtipo = doc.resolver(d.Subtype)?.nom;
  const f = { ancho: subtipo === 'Type0' ? 2 : 1, trad: null, w: new Map(), dw: 1000, simple: subtipo !== 'Type0' };
  if (d.ToUnicode) {
    const t = leerToUnicode(await doc.flujo(d.ToUnicode));
    f.ancho = t.ancho;
    f.trad = t.trad;
  }
  if (subtipo === 'Type0') {
    const desc = doc.dic((doc.lista(d.DescendantFonts) ?? [])[0]);
    if (desc) {
      const dw = doc.resolver(desc.DW);
      if (esNum(dw)) f.dw = dw;
      f.w = anchosCid(doc, desc.W);
    }
  } else {
    f.dw = 500;
    const primero = doc.resolver(d.FirstChar);
    const ws = doc.lista(d.Widths);
    if (esNum(primero) && ws) ws.forEach((w, k) => { const n = doc.resolver(w); if (esNum(n)) f.w.set(primero + k, n); });
  }
  return f;
}

// Texto de unos bytes (cadena latin1) con la fuente: [texto, ancho en milésimas de em].
function decodificar(f, bytes) {
  let texto = '';
  let ancho = 0;
  const n = f?.ancho ?? 1;
  for (let i = 0; i + n <= bytes.length; i += n) {
    let cod = 0;
    for (let k = 0; k < n; k++) cod = cod * 256 + bytes.charCodeAt(i + k);
    // Sin ToUnicode: una fuente simple da el byte tal cual (WinAnsi); una Type0 no dice nada con sus glifos, así que no aporta texto.
    texto += f?.trad ? f.trad(cod) : f && !f.simple ? '' : cod === 0x80 ? '€' : String.fromCharCode(cod);
    ancho += f?.w.get(cod) ?? f?.dw ?? 500;
  }
  return [texto, ancho];
}

// ---------- recorrido del contenido ----------

const mult = (m, t) => [ // m' = t × m (matrices PDF de 6 números)
  t[0] * m[0] + t[1] * m[2], t[0] * m[1] + t[1] * m[3],
  t[2] * m[0] + t[3] * m[2], t[2] * m[1] + t[3] * m[3],
  t[4] * m[0] + t[5] * m[2] + m[4], t[4] * m[1] + t[5] * m[3] + m[5],
];
const IDENT = [1, 0, 0, 1, 0, 0];

// Piezas de texto { x, y, tam, ancho, texto } de un flujo de contenido. `fuentes`: nombre -> fuente.
export function piezasDeContenido(s, fuentes) {
  const piezas = [];
  let tm = IDENT;
  let tlm = IDENT;
  let fuente = null;
  let tam = 0;
  let lead = 0;
  let ops = [];
  const mostrar = (bytes) => {
    const [texto, ancho] = decodificar(fuente, bytes);
    const anchoU = ((ancho * tam) / 1000) * Math.abs(tm[0]);
    if (texto) piezas.push({ x: tm[4], y: tm[5], tam: tam * Math.hypot(tm[2], tm[3]) || tam, ancho: anchoU, texto });
    tm = mult(tm, [1, 0, 0, 1, (ancho * tam) / 1000, 0]);
  };
  const mover = (tx, ty) => { tlm = mult(tlm, [1, 0, 0, 1, tx, ty]); tm = tlm; };
  const numeros = () => ops.filter(esNum);
  const ponerFuente = (nombre, t) => { fuente = fuentes.get(nombre) ?? null; tam = esNum(t) ? t : 0; };
  // Interpreta un bloque de texto desde `i` hasta su ET; devuelve dónde acaba.
  const bloque = (i) => {
    for (;;) {
      const tk = token(s, i);
      i = tk.i;
      if (tk.t === 'fin') break;
      if (tk.t === '[') { // arreglo de TJ: se guarda como un solo operando
        const arr = [];
        for (;;) {
          const t = token(s, i);
          i = t.i;
          if (t.t === ']' || t.t === 'fin') break;
          if (t.t === 'num' || t.t === 'str') arr.push(t.v);
        }
        ops.push(arr);
        continue;
      }
      if (tk.t !== 'op') { ops.push(tk.t === 'nom' ? { nom: tk.v } : tk.v); continue; }
      if (tk.v === 'ET') break;
      switch (tk.v) {
        case 'Tf': ponerFuente(ops[0]?.nom, ops[1]); break;
        case 'Tm': { const n = numeros(); if (n.length === 6) tm = tlm = n; break; }
        case 'Td': { const n = numeros(); if (n.length === 2) mover(n[0], n[1]); break; }
        case 'TD': { const n = numeros(); if (n.length === 2) { lead = -n[1]; mover(n[0], n[1]); } break; }
        case 'TL': if (esNum(ops[0])) lead = ops[0]; break;
        case 'T*': mover(0, -lead); break;
        case 'Tj': if (typeof ops[0] === 'string') mostrar(ops[0]); break;
        case "'": mover(0, -lead); if (typeof ops[0] === 'string') mostrar(ops[0]); break;
        case '"': mover(0, -lead); if (typeof ops[2] === 'string') mostrar(ops[2]); break;
        case 'TJ':
          for (const e of Array.isArray(ops[0]) ? ops[0] : []) {
            if (typeof e === 'string') mostrar(e);
            else if (esNum(e)) tm = mult(tm, [1, 0, 0, 1, (-e * tam) / 1000, 0]); // ajuste de kerning o hueco
          }
          break;
        default: break;
      }
      ops = [];
    }
    return i;
  };
  // Solo se interpretan los bloques BT … ET (lo demás son trazados: miles de «m / l / f» que no aportan nada y cuestan CPU).
  // Un Tf suelto entre bloques sí se tiene en cuenta (el cuerpo de letra vale para los bloques siguientes).
  const BT = /(?:^|[\0\t\n\f\r ])BT(?=[\0\t\n\f\r /([<]|$)/g;
  const TF = /\/([^\0\t\n\f\r /[\]()<>{}%]+)[\0\t\n\f\r ]+([+-]?[\d.]+)[\0\t\n\f\r ]+Tf(?=[\0\t\n\f\r ]|$)/g;
  let desde = 0;
  let m;
  while ((m = BT.exec(s))) {
    const hueco = s.slice(desde, m.index);
    if (hueco.includes('Tf')) for (const f of hueco.matchAll(TF)) ponerFuente(f[1], parseFloat(f[2]));
    tm = tlm = IDENT;
    ops = [];
    desde = bloque(BT.lastIndex);
    BT.lastIndex = desde;
  }
  return piezas;
}

// Piezas -> líneas de texto, de arriba abajo; dentro de cada línea, por x, con un espacio donde hay hueco.
export function lineasDePiezas(piezas) {
  const ord = piezas.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const filas = [];
  for (const p of ord) {
    const ult = filas[filas.length - 1];
    if (ult && Math.abs(ult.y - p.y) <= Math.max(1, 0.3 * Math.max(ult.tam, p.tam))) ult.piezas.push(p);
    else filas.push({ y: p.y, tam: p.tam, piezas: [p] });
  }
  const lineas = [];
  for (const f of filas) {
    f.piezas.sort((a, b) => a.x - b.x);
    let t = '';
    let fin = null;
    for (const p of f.piezas) {
      if (fin !== null && p.x - fin > 0.15 * p.tam) t += ' ';
      t += p.texto;
      fin = Math.max(fin ?? -Infinity, p.x + p.ancho);
    }
    const limpia = t.replace(/\s+/g, ' ').trim().normalize('NFC');
    if (limpia) lineas.push(limpia);
  }
  return lineas;
}

// Texto de un PDF, una línea por renglón (las páginas, una tras otra). `bytes`: Uint8Array (o ArrayBuffer).
export async function textoDePdf(bytes) {
  try {
    return await leerPdf(bytes);
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw fallo('pdf_invalido', `No se pudo leer el PDF (${String(e?.message ?? e).slice(0, 120)}).`); // nunca un error suelto: el Worker contesta 422, no 500
  }
}

async function leerPdf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 20 || aLatin1(b.subarray(0, 1024)).indexOf('%PDF-') < 0) throw fallo('pdf_invalido', 'El fichero no es un PDF.');
  const doc = new Documento(b);
  if (/\/Encrypt\s/.test(doc.s.slice(-2048)) || /\/Encrypt\s/.test(doc.s.slice(0, 2048))) {
    throw fallo('pdf_cifrado', 'El PDF está protegido con contraseña: pega el texto del ticket.');
  }
  const paginas = paginasDe(doc);
  if (!paginas.length) throw fallo(/\/ObjStm\b/.test(doc.s) ? 'pdf_no_soportado' : 'pdf_invalido', 'No se encontraron páginas en el PDF.');
  const lineas = [];
  for (const pg of paginas) {
    const res = doc.dic(pg.resources) ?? {};
    const fuentes = new Map();
    const fd = doc.dic(res.Font) ?? {};
    for (const [nombre, ref] of Object.entries(fd)) {
      const f = await leerFuente(doc, ref);
      if (f) fuentes.set(nombre, f);
    }
    const cont = doc.resolver(pg.d.Contents);
    const refs = Array.isArray(cont) ? cont : [pg.d.Contents];
    let contenido = '';
    for (const r of refs) contenido += `${await doc.flujo(r)}\n`;
    lineas.push(...lineasDePiezas(piezasDeContenido(contenido, fuentes)));
  }
  if (!lineas.length) throw fallo('sin_texto', 'El PDF no tiene texto que se pueda leer: pega el texto del ticket.');
  return lineas.join('\n');
}
