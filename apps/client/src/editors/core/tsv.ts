/// Il TSV della clipboard dei fogli (Excel, LibreOffice, Google Sheets), per
/// ogni griglia della shell: il foglio e la tabella Markdown copiano e
/// incollano allo stesso modo, fra loro e con le altre applicazioni.

/// Il testo incollato come matrice. Una cella con tab, a capo o virgolette in
/// testa viaggia fra virgolette, con le virgolette interne raddoppiate. Fuori
/// dalle virgolette tab separa le celle e un a capo (`\n`, `\r\n` o `\r`)
/// chiude la riga; quello in coda non apre una riga vuota. Una cella che
/// comincia con virgolette senza chiuderle davanti a un separatore resta testo
/// com'è, così la prosa incollata non si perde.
export function parseTsv(source: string): string[][] {
  const rows: string[][] = [];
  let at = 0;
  while (at < source.length) {
    const row: string[] = [];
    for (;;) {
      const [value, end] = tsvField(source, at);
      row.push(value);
      at = end;
      if (source[at] !== "\t") break;
      at += 1;
    }
    if (at < source.length) at += source.startsWith("\r\n", at) ? 2 : 1;
    rows.push(row);
  }
  return rows;
}

/// Le righe per la clipboard, nel TSV che legge [`parseTsv`]. Ogni riga
/// finisce con un a capo, come in Excel: un'ultima riga di celle vuote resta
/// una riga, e incollarla le svuota.
export function tsvRows(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(tsvCell).join("\t")}\n`).join("");
}

const SEPARATOR = /[\t\r\n]/g;

function tsvField(source: string, start: number): [string, number] {
  if (source[start] === '"') {
    let value = "";
    let from = start + 1;
    for (let quote = source.indexOf('"', from); quote >= 0; quote = source.indexOf('"', from)) {
      value += source.slice(from, quote);
      from = quote + 1;
      if (source[from] === '"') {
        value += '"';
        from += 1;
      } else if (from === source.length || "\t\r\n".includes(source[from])) {
        return [value, from];
      } else {
        break;
      }
    }
  }
  SEPARATOR.lastIndex = start;
  const end = SEPARATOR.exec(source)?.index ?? source.length;
  return [source.slice(start, end), end];
}

function tsvCell(value: string): string {
  return /^"|[\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
