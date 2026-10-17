// Interpreta un número escrito en una celda.
// Acepta "12.5", "12,5" (coma decimal de hojas de cálculo en español) y notación científica.
// Devuelve { status: 'empty' | 'ok' | 'invalid', value, comma }.
const DOT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const COMMA = /^[+-]?\d+,\d+$/;

export function parseNumber(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { status: 'empty', value: null, comma: false };
  let value;
  let comma = false;
  if (DOT.test(s)) value = Number(s);
  else if (COMMA.test(s)) { value = Number(s.replace(',', '.')); comma = true; }
  else return { status: 'invalid', value: null, comma: false };
  if (!Number.isFinite(value)) return { status: 'invalid', value: null, comma: false };
  return { status: 'ok', value, comma };
}
