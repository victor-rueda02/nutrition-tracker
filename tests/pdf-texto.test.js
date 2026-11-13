// core/pdf-texto.js: texto por líneas de un PDF como el ticket de Mercadona. El PDF se genera aquí (tests/pdf-sintetico.js, misma
// estructura que el real: Flate + Type0/Identity-H + ToUnicode, varias columnas en la misma y); los PDF reales nunca están en el repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textoDePdf, leerToUnicode, lineasDePiezas, piezasDeContenido, PdfError } from '../frontend/js/core/pdf-texto.js';
import { crearPdf, pdfDeTicket } from './pdf-sintetico.js';
import { readFile } from './helpers.js';

const ticket = (f) => readFile(`./fixtures/tickets/${f}`).replace(/\r\n/g, '\n').trim();

test('PDF sintético de los dos tickets de prueba: el texto sale idéntico a los fixtures (columnas, orden y euro incluidos)', async () => {
  for (const f of ['ticket-2026-09-09.txt', 'ticket-2026-10-26.txt']) {
    const esperado = ticket(f);
    const pdf = pdfDeTicket(esperado);
    assert.ok(pdf.length > 5000, 'el PDF tiene cuerpo');
    assert.equal(await textoDePdf(pdf), esperado, f);
  }
});

test('el mismo glifo tiene códigos distintos en cada fuente: solo vale el ToUnicode de la suya', async () => {
  // F1 y F2 numeran los glifos por orden de aparición: «AB» en F1 y «BA» en F2 daría códigos cruzados con un mapa común
  const pdf = crearPdf([
    { fuente: 'F1', x: 50, y: 700, texto: 'AB€é' },
    { fuente: 'F2', x: 50, y: 600, texto: 'BA€é' },
  ]);
  assert.equal(await textoDePdf(pdf), 'AB€é\nBA€é');
});

test('cadenas literales con paréntesis y barras escapadas, hexadecimales y los dos estilos de CMap (bfrange y bfchar)', async () => {
  const texto = 'Dto (2%) \\ 1/2 [x] ñ';
  for (const estilos of [{ F2: 'rangos' }, { F2: 'chars' }, { F2: 'mixto' }]) {
    const pdf = crearPdf([{ x: 10, y: 300, texto }, { x: 10, y: 200, texto, modo: 'hex' }], { estilos });
    assert.equal(await textoDePdf(pdf), `${texto}\n${texto}`, JSON.stringify(estilos));
  }
});

test('TJ: el kerning pequeño no parte la palabra y un hueco grande es un espacio; Td coloca el segundo trozo a su derecha', async () => {
  const pdf = crearPdf([
    { x: 40, y: 900, texto: 'PALABRA OTRA', modo: 'TJ' },
    { x: 40, y: 800, texto: 'Izquierda|Derecha', modo: 'Td' },
  ]);
  assert.equal(await textoDePdf(pdf), 'PALABRA OTRA\nIzquierda Derecha');
});

test('varias columnas en la misma y se unen por x (aunque el PDF las escriba al revés) y las filas van de arriba abajo', async () => {
  const pdf = crearPdf([
    { x: 500, y: 1000, texto: 'C' }, { x: 100, y: 1000.2, texto: 'A' }, { x: 300, y: 999.9, texto: 'B' },
    { x: 100, y: 900, texto: 'abajo' }, { x: 100, y: 1100, texto: 'arriba' },
  ]);
  assert.equal(await textoDePdf(pdf), 'arriba\nA B C\nabajo');
});

test('el contenido de la página en varios flujos (/Contents [..]) se lee entero', async () => {
  const esperado = ticket('ticket-2026-10-26.txt');
  assert.equal(await textoDePdf(pdfDeTicket(esperado, { contenidos: 'varios' })), esperado);
});

test('una «imagen» binaria con texto que parece sintaxis de PDF no confunde al lector', async () => {
  const esperado = 'Cnt. Descripción P. Unit Importe\n1 ARROZ LARGO 1,20';
  assert.equal(await textoDePdf(pdfDeTicket(esperado)), esperado); // el relleno del ruido incluye "7 0 obj" y "endstream"
});

test('errores claros: no es un PDF, cifrado, sin ToUnicode (sin texto) y vacío', async () => {
  const falla = async (bytes, code) => {
    await assert.rejects(textoDePdf(bytes), (e) => e instanceof PdfError && e.code === code, code);
  };
  await falla(new TextEncoder().encode('Esto no es un PDF, es un texto cualquiera que sigue y sigue.'), 'pdf_invalido');
  await falla(new Uint8Array(0), 'pdf_invalido');
  await falla(crearPdf([{ x: 1, y: 1, texto: 'hola' }], { cifrado: true }), 'pdf_cifrado');
  await falla(crearPdf([{ x: 1, y: 1, texto: 'hola' }], { sinToUnicode: true }), 'sin_texto');
  await falla(crearPdf([]), 'sin_texto');
});

test('leerToUnicode: bfchar, bfrange con destino y con lista, varias letras (ligadura) y ancho de código', () => {
  const t = leerToUnicode(`/CIDInit /ProcSet findresource begin
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar
<0003> <0020>
<00BD> <20AC>
endbfchar
2 beginbfrange
<0024> <0026> <0041>
<0030> <0032> [<0066> <00660069> <00E9>]
endbfrange
1 beginbfchar
<0040> <00660069>
endbfchar`);
  assert.equal(t.ancho, 2);
  assert.equal(t.trad(3), ' ');
  assert.equal(t.trad(0xbd), '€');
  assert.equal([0x24, 0x25, 0x26].map(t.trad).join(''), 'ABC');
  assert.equal([0x30, 0x31, 0x32].map(t.trad).join(''), 'ffié');
  assert.equal(t.trad(0x40), 'fi');
  assert.equal(t.trad(0x99), '', 'un código sin mapa no aporta texto');
  assert.equal(leerToUnicode('1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <0042> endbfchar').ancho, 1);
});

test('lineasDePiezas: tolerancia en y según el cuerpo de letra y espacio solo donde hay hueco', () => {
  const p = (x, y, texto, ancho = 10) => ({ x, y, tam: 20, ancho, texto });
  assert.deepEqual(lineasDePiezas([p(10, 100, 'AB'), p(20, 100.5, 'CD'), p(100, 99.8, 'EF'), p(10, 50, 'abajo')]), ['ABCD EF', 'abajo']);
  assert.deepEqual(lineasDePiezas([p(0, 10, ' '), p(0, 40, 'x')]), ['x'], 'una línea solo de espacios no cuenta');
});

test('piezasDeContenido: Td/TD/T*/TL/\'/" y Tf suelto antes del bloque', () => {
  const f = { ancho: 1, trad: null, w: new Map(), dw: 500, simple: true };
  const piezas = piezasDeContenido('/F1 10 Tf\n0 0 m 1 1 l S\nBT\n20 100 Td (uno) Tj\n0 -12 TD (dos) Tj\nT* (tres) Tj\n(cuatro) \'\nET\n', new Map([['F1', f]]));
  assert.deepEqual(piezas.map((x) => [x.texto, x.x, x.y]), [['uno', 20, 100], ['dos', 20, 88], ['tres', 20, 76], ['cuatro', 20, 64]]);
});
