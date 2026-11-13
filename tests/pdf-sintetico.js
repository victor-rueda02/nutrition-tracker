// PDF SINTÉTICO para probar core/pdf-texto.js: la misma estructura que el ticket digital de Mercadona (PDF 1.4 de openhtmltopdf:
// una página alta, contenido y CMap con FlateDecode, fuentes Type0 / Identity-H con ToUnicode, cada celda de la tabla en su propio
// bloque BT … ET con Tm, varias columnas en la misma y, trazados de relleno y una imagen binaria). Se genera aquí: nunca se
// copia un PDF real al repositorio. Cada fuente numera sus glifos por orden de aparición (como una fuente en subconjunto), así que
// el mismo carácter tiene códigos distintos en cada fuente y solo vale el ToUnicode de la suya.
import { deflateSync } from 'node:zlib';

const latin1 = (s) => Buffer.from(s, 'latin1');
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const utf16hex = (ch) => [...ch].map((c) => hex4(c.charCodeAt(0))).join('');

// Fuente en subconjunto: asigna códigos (desde 3 = espacio) a los caracteres que se le piden.
class Fuente {
  constructor(nombre, { estilo = 'rangos' } = {}) {
    this.nombre = nombre;
    this.estilo = estilo; // 'rangos' (bfrange), 'chars' (bfchar) o 'mixto'
    this.cids = new Map([[' ', 3]]);
  }
  cid(ch) {
    if (!this.cids.has(ch)) this.cids.set(ch, this.cids.size + 3);
    return this.cids.get(ch);
  }
  // Bytes de un texto: dos por carácter (Identity-H).
  bytes(texto) {
    const out = [];
    for (const ch of texto) { const c = this.cid(ch); out.push(c >> 8, c & 255); }
    return Buffer.from(out);
  }
  tounicode() {
    const e = [...this.cids].map(([ch, cid]) => ({ ch, cid })).sort((a, b) => a.cid - b.cid);
    const chars = [];
    const rangos = [];
    for (let i = 0; i < e.length;) {
      // tramo de códigos seguidos cuyos caracteres también son seguidos (como en un bfrange real)
      let j = i;
      while (j + 1 < e.length && e[j + 1].cid === e[j].cid + 1 && e[j + 1].ch.charCodeAt(0) === e[j].ch.charCodeAt(0) + 1 && e[j].ch.length === 1) j++;
      const usaRango = this.estilo === 'rangos' || (this.estilo === 'mixto' && j > i);
      if (usaRango && j > i) rangos.push(`<${hex4(e[i].cid)}> <${hex4(e[j].cid)}> <${utf16hex(e[i].ch)}>`);
      else for (let k = i; k <= j; k++) chars.push(`<${hex4(e[k].cid)}> <${utf16hex(e[k].ch)}>`);
      i = j + 1;
    }
    const partes = ['/CIDInit /ProcSet findresource begin', '12 dict begin', '', 'begincmap', '/CIDSystemInfo', '<< /Registry (Adobe)', '/Ordering (UCS)', '/Supplement 0', '>> def', '',
      '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def', '', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange', ''];
    for (let i = 0; i < chars.length; i += 100) partes.push(`${Math.min(100, chars.length - i)} beginbfchar`, ...chars.slice(i, i + 100), 'endbfchar', '');
    for (let i = 0; i < rangos.length; i += 100) partes.push(`${Math.min(100, rangos.length - i)} beginbfrange`, ...rangos.slice(i, i + 100), 'endbfrange', '');
    partes.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end', '');
    return partes.join('\n');
  }
  anchos() { // /W: todos los glifos a 500 milésimas de em (como un Times)
    return `[ 3 [250] ${[...this.cids.values()].filter((c) => c !== 3).map((c) => `${c} [500]`).join(' ')} ]`;
  }
}

// Cadena literal PDF de unos bytes, con los escapes de ( ) \ y de los saltos de línea.
function literal(buf) {
  let s = '(';
  const trozos = [];
  for (const b of buf) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) trozos.push(Buffer.from([0x5c, b]));
    else if (b === 0x0d) trozos.push(latin1('\\r'));
    else if (b === 0x0a) trozos.push(latin1('\\n'));
    else trozos.push(Buffer.from([b]));
  }
  return Buffer.concat([latin1(s), ...trozos, latin1(')')]);
}
const hexString = (buf) => latin1(`<${[...buf].map((b) => b.toString(16).padStart(2, '0')).join('')}>`);

// Construye el PDF. `bloques`: [{ fuente: 'F1'|'F2', tam, x, y, texto, modo? }] con modo 'Tm' (por defecto), 'hex' (cadena
// hexadecimal), 'TJ' (texto partido con kerning y un hueco) o 'Td' (posición relativa dentro del mismo bloque).
//   opciones: { cifrado, sinToUnicode, contenidos: 'uno'|'varios', estilos: { F1, F2 } }
export function crearPdf(bloques, opciones = {}) {
  const fuentes = { F1: new Fuente('AAAECD+NimbusRoman-Bold', { estilo: opciones.estilos?.F1 ?? 'rangos' }), F2: new Fuente('AAAXMG+NimbusRoman-Regular', { estilo: opciones.estilos?.F2 ?? 'mixto' }) };
  const partes = [];
  partes.push(latin1('0.0375 w\n2 J\n0 j\n10 M\n[] 0 d\nq\n36 1503.67505 m\n576 1503.67505 l\n576 0.03748 l\n36 0.03748 l\n36 1503.67505 l\nh\nW\nn\n'));
  const num = (n) => String(Math.round(n * 1e5) / 1e5);
  for (const b of bloques) {
    const f = fuentes[b.fuente ?? 'F2'];
    const tam = b.tam ?? 20.4;
    partes.push(latin1(`/Artifact /Prop1 BDC\n1 1 1 rg\n${num(b.x)} ${num(b.y)} m\n${num(b.x + 50)} ${num(b.y)} l\n${num(b.x + 50)} ${num(b.y - 20)} l\nh\nf\nEMC\n/Span /Prop2 BDC\n0 0 0 rg\nBT\n/${b.fuente ?? 'F2'} ${num(tam)} Tf\n`));
    if (b.modo === 'hex') {
      partes.push(latin1(`1 0 0 1 ${num(b.x)} ${num(b.y)} Tm\n`), hexString(f.bytes(b.texto)), latin1(' Tj\n'));
    } else if (b.modo === 'TJ') {
      // «ABC DEF» -> [(AB) 20 (C) -900 (DEF)]: el kerning pequeño no parte la palabra y el hueco grande sí es un espacio
      const [a, c] = b.texto.split(' ');
      const mitad = Math.max(1, Math.floor(a.length / 2));
      partes.push(latin1(`1 0 0 1 ${num(b.x)} ${num(b.y)} Tm\n[`), literal(f.bytes(a.slice(0, mitad))), latin1(' 25 '), literal(f.bytes(a.slice(mitad))), latin1(' -900 '), literal(f.bytes(c)), latin1('] TJ\n'));
    } else if (b.modo === 'Td') {
      // dos trozos en el mismo bloque: el segundo, 300 unidades a la derecha del primero con Td
      const [a, c] = b.texto.split('|');
      partes.push(latin1(`${num(b.x)} ${num(b.y)} Td\n`), literal(f.bytes(a)), latin1(' Tj\n300 0 Td\n'), literal(f.bytes(c)), latin1(' Tj\n'));
    } else {
      partes.push(latin1(`1 0 0 1 ${num(b.x)} ${num(b.y)} Tm\n`), literal(f.bytes(b.texto)), latin1(' Tj\n'));
    }
    partes.push(latin1('ET\nEMC\n'));
  }
  partes.push(latin1('Q\n'));
  const contenido = Buffer.concat(partes);

  const cuerpos = []; // [{ num, dict, stream? }]
  const flate = (buf) => deflateSync(buf);
  const obj = (num, dict, stream) => cuerpos.push({ num, dict, stream });
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const contenidos = opciones.contenidos === 'varios' ? [5, 13] : [5];
  obj(3, `<< /Type /Page /MediaBox [0.0 0.0 612.0 1539.675] /Parent 2 0 R /Contents ${contenidos.length > 1 ? `[${contenidos.map((n) => `${n} 0 R`).join(' ')}]` : '5 0 R'} /Resources 4 0 R /Tabs /S >>`);
  obj(4, '<< /Properties 14 0 R /XObject << /Im1 15 0 R >> /Font 6 0 R >>');
  if (contenidos.length > 1) {
    const corte = contenido.indexOf('/Artifact /Prop1 BDC', Math.floor(contenido.length / 2));
    const a = flate(contenido.subarray(0, corte));
    const b = flate(contenido.subarray(corte));
    obj(5, `<< /Length ${a.length} /Filter /FlateDecode >>`, a);
    obj(13, `<< /Length ${b.length} /Filter /FlateDecode >>`, b);
  } else {
    const c = flate(contenido);
    obj(5, `<< /Length ${c.length} /Filter /FlateDecode >>`, c);
  }
  obj(6, '<<\n/F1 7 0 R\n/F2 8 0 R\n>>');
  for (const [n, nombre, desc, tu, f] of [[7, 'F1', 9, 11, fuentes.F1], [8, 'F2', 10, 12, fuentes.F2]]) {
    obj(n, `<< /Type /Font /BaseFont /${f.nombre} /Subtype /Type0 /Encoding /Identity-H /DescendantFonts [${desc} 0 R]${opciones.sinToUnicode ? '' : ` /ToUnicode ${tu} 0 R`} >>`);
    obj(desc, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.nombre} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /W ${f.anchos()} >>`);
    if (!opciones.sinToUnicode) { const t = flate(latin1(f.tounicode())); obj(tu, `<< /Length ${t.length} /Filter /FlateDecode >>`, t); }
  }
  obj(14, '<< >>');
  // una «imagen» con bytes que parecen sintaxis de PDF: el lector no debe tropezar con ellos
  const ruido = Buffer.concat([latin1('7 0 obj << /Mal true >> endobj stream\nendstream\n12 0 obj '), Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 37 + 11) & 255))]);
  obj(15, `<< /Length ${ruido.length} /Type /XObject /Subtype /Image /Width 20 /Height 20 /ColorSpace /DeviceGray /BitsPerComponent 8 >>`, ruido);
  if (opciones.cifrado) obj(16, '<< /Filter /Standard /V 4 /R 4 /O (x) /U (y) /P -4 >>');

  const out = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let pos = out[0].length;
  const offsets = new Map();
  for (const c of cuerpos.sort((a, b) => a.num - b.num)) {
    offsets.set(c.num, pos);
    const trozo = c.stream
      ? Buffer.concat([latin1(`${c.num} 0 obj\n${c.dict}\nstream\n`), c.stream, latin1('\nendstream\nendobj\n')])
      : latin1(`${c.num} 0 obj\n${c.dict}\nendobj\n`);
    out.push(trozo);
    pos += trozo.length;
  }
  const max = Math.max(...offsets.keys());
  let xref = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= max; n++) xref += offsets.has(n) ? `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n` : '0000000000 00000 f \n';
  out.push(latin1(`${xref}trailer\n<< /Size ${max + 1} /Root 1 0 R${opciones.cifrado ? ' /Encrypt 16 0 R' : ''} >>\nstartxref\n${pos}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(out));
}

// Un ticket (texto por líneas) como PDF: una fila por línea, cada celda en su bloque y en su columna, en orden DESORDENADO y con
// una pequeña variación de y, como los generan los maquetadores. Es lo que debe volver a leer textoDePdf.
export function pdfDeTicket(texto, opciones = {}) {
  const lineas = texto.split(/\r?\n/).filter(Boolean);
  const bloques = [];
  let y = 1389.375;
  lineas.forEach((l, i) => {
    let celdas;
    const prod = /^(\d+) (.+?)(?: (\d+,\d\d))?(?: (\d+,\d\d))?$/.exec(l);
    const peso = /^(\d+,\d+ kg) (\d+,\d\d €\/kg) (\d+,\d\d)$/.exec(l);
    const total = /^(TOTAL \(€\)) (\d+,\d\d)$/.exec(l);
    if (peso) celdas = [[peso[1], 61.7625], [peso[2], 300.5], [peso[3], 538.8]];
    else if (total) celdas = [[total[1], 37.5], [total[2], 538.8]];
    else if (/^Cnt\./.test(l)) celdas = [['Cnt.', 37.5], ['Descripción', 82.1625], ['P. Unit', 404.85], ['Importe', 509.8875]];
    else if (prod && !/^\d{2}\/\d{2}\/\d{4}$/.test(l)) celdas = [[prod[1], 61.7625], [prod[2], 82.1625], ...(prod[3] && prod[4] ? [[prod[3], 426.975]] : []), ...(prod[4] ? [[prod[4], 538.8]] : prod[3] ? [[prod[3], 538.8]] : [])];
    else celdas = [[l, 156.675]];
    celdas.forEach(([texto2, x], k) => bloques.push({ fuente: i % 5 === 0 ? 'F1' : 'F2', tam: 20.4, x, y: y + ((i + k) % 3) * 0.12 - 0.12, texto: texto2, modo: (i + k) % 7 === 3 ? 'hex' : 'Tm' }));
    y -= 25.5;
  });
  // orden desordenado pero determinista
  const orden = bloques.map((b, i) => ({ b, k: (i * 7919) % 104729 })).sort((a, c) => a.k - c.k).map((x) => x.b);
  return crearPdf(orden, opciones);
}
