// CSV mínimo (RFC 4180): comillas dobles, saltos de línea dentro de celdas, BOM,
// y autodetección de separador (coma, punto y coma o tabulador).

export function detectDelimiter(text) {
  const src = text.replace(/^\uFEFF/, '');
  const end = src.search(/\r?\n/);
  const line = end === -1 ? src : src.slice(0, end);
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

// Devuelve { rows, rowNumbers, delimiter, unterminatedQuote }.
// rowNumbers[i] es el nº de registro (1 = cabecera) de rows[i]; las filas totalmente vacías se saltan.
export function parseCSV(text, delimiter = detectDelimiter(text)) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  const rowNumbers = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let recordNo = 0;
  let i = 0;

  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    recordNo++;
    if (row.some((c) => c.trim() !== '')) { rows.push(row); rowNumbers.push(recordNo); }
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { endCell(); i++; continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) endRow(); // último registro sin salto de línea final
  return { rows, rowNumbers, delimiter, unterminatedQuote: inQuotes };
}

export function serializeCSV(rows, { delimiter = ',', bom = false, eol = '\n' } = {}) {
  const quote = (v) => {
    const s = v == null ? '' : String(v);
    return /["\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (bom ? '\uFEFF' : '') + rows.map((r) => r.map(quote).join(delimiter)).join(eol) + eol;
}
