// Il titolo e il primo H1 (E3, T7). Il titolo della testata è il nome del
// file; un primo H1 che dice la stessa cosa si ripiega nel titolo, perché la
// nota non abbia due titoli uno sopra l'altro. Il file non cambia: in
// Scrittura e in Lettura l'H1 ripiegato non si vede, in Sorgente sì.
//
// Qui sta la regola, pura: quando un H1 è «lo stesso» del nome
// (`sameTitle`), quale H1 è il primo (`firstHeading`), che cosa si scrive
// quando il nome cambia (`retitled`). Chi la usa: la testata in Scrittura
// (`../blocks/page.ts`), che nasconde l'H1 e lo riscrive con la rinomina; la
// Lettura (`header.ts`, `mountReadingHeader`), che lo nasconde nella resa; e
// la rinomina dal titolo del foglio (`shells/scrittoio/sheets/title-rename.ts`)
// attraverso `retitleIn`.

/// Ciò che la regola legge di un documento: le righe, come le dà il `Text` di
/// CodeMirror (che le soddisfa così com'è).
export interface TitleLines {
  readonly lines: number;
  readonly length: number;
  line(number: number): { readonly from: number; readonly to: number; readonly text: string; readonly number: number };
  lineAt(position: number): { readonly from: number; readonly to: number; readonly text: string; readonly number: number };
}

/// Il primo H1 della nota.
export interface FirstHeading {
  /// La riga del titolo, senza l'a capo.
  readonly from: number;
  readonly to: number;
  /// Il testo del titolo nella riga (senza `#` né la chiusura `###`).
  readonly textFrom: number;
  readonly textTo: number;
  readonly text: string;
  /// Fin dove arriva ciò che si nasconde: il titolo e le righe vuote che lo
  /// seguono, fino alla riga prima del testo (o alla fine della nota).
  readonly hideTo: number;
}

/// Quante righe si guardano in cima al testo: commenti e righe vuote prima
/// dell'H1 sono pochi, e la regola non deve leggere una nota intera.
const LOOK_AHEAD = 400;

/// Un H1 ATX: fino a tre spazi, `#`, uno spazio (o la fine), il testo e una
/// chiusura facoltativa di `#`. Un H1 Setext (`Titolo` sopra `===`) resta un
/// titolo del testo: è raro in cima a una nota, e riscriverlo vorrebbe dire
/// toccare due righe.
const ATX_H1 = /^ {0,3}#(?=[ \t]|$)[ \t]*(.*?)(?:[ \t]+#+)?[ \t]*$/;

/// La chiave del confronto: il testo che si legge, senza maiuscole, spazi e
/// punteggiatura. Prima si toglie la formattazione Markdown che non si legge
/// (`**`, `` ` ``, i link col loro testo, i tag HTML), poi ogni segno che non
/// è una lettera, una cifra o un simbolo che si vede (un'emoji conta).
export function titleKey(text: string): string {
  return text
    .normalize("NFC")
    // `![testo](dove)` e `[testo](dove)`: conta il testo.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // `[[nota|testo]]` e `[[nota]]`: conta ciò che si legge.
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    // I tag HTML in riga (`<kbd>`, `<br>`).
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    // Punteggiatura, spazi e i segni della formattazione (`` ` ``, `~`, `=`,
    // `^`, `+`, `|`, `<`, `>`).
    .replace(/[\p{P}\p{Z}\p{Sk}\p{Sm}\s]/gu, "")
    .toLowerCase();
}

/// L'H1 e il nome dicono la stessa cosa, a parte maiuscole, spazi e
/// punteggiatura. Un nome (o un H1) fatto solo di punteggiatura non è uguale a
/// niente.
export function sameTitle(heading: string, name: string): boolean {
  const key = titleKey(name);
  return key !== "" && titleKey(heading) === key;
}

/// Un commento che si apre su questa riga: `%%` di Obsidian o `<!-- -->` di
/// HTML. `closed` dice se si chiude sulla stessa riga, `after` se dopo la
/// chiusura resta del testo (allora la riga si legge). `null` se la riga non
/// comincia con un commento.
function commentOpener(text: string): { readonly close: string; readonly closed: boolean; readonly after: boolean } | null {
  const trimmed = text.trimStart();
  const open = trimmed.startsWith("%%") ? "%%" : trimmed.startsWith("<!--") ? "<!--" : null;
  if (open === null) return null;
  const close = open === "%%" ? "%%" : "-->";
  const at = trimmed.indexOf(close, open.length);
  if (at < 0) return { close, closed: false, after: false };
  return { close, closed: true, after: trimmed.slice(at + close.length).trim() !== "" };
}

/// Il primo H1 della nota: la prima riga che si legge dopo `bodyFrom` (la
/// fine del frontmatter, o 0), saltando righe vuote e commenti. Se quella
/// riga non è un H1 la nota non ha un primo H1 da ripiegare: un H1 più in
/// basso è un titolo del testo.
export function firstHeading(doc: TitleLines, bodyFrom: number): FirstHeading | null {
  if (bodyFrom > doc.length) return null;
  let number = doc.lineAt(bodyFrom).number;
  const last = Math.min(doc.lines, number + LOOK_AHEAD);
  for (; number <= last; number++) {
    const line = doc.line(number);
    if (line.text.trim() === "") continue;
    const comment = commentOpener(line.text);
    if (comment) {
      if (comment.after) return null;
      if (comment.closed) continue;
      // Il commento va avanti fino alla riga che lo chiude.
      let end = number + 1;
      while (end <= last && !doc.line(end).text.includes(comment.close)) end++;
      if (end > last) return null;
      const tail = doc.line(end).text;
      if (tail.slice(tail.indexOf(comment.close) + comment.close.length).trim() !== "") return null;
      number = end;
      continue;
    }
    const match = ATX_H1.exec(line.text);
    if (!match) return null;
    const text = match[1] ?? "";
    const offset = line.text.indexOf(text, line.text.indexOf("#") + 1);
    const textFrom = text === "" ? line.to : line.from + offset;
    let hideTo = line.to;
    for (let next = number + 1; next <= doc.lines && doc.line(next).text.trim() === ""; next++) hideTo = doc.line(next).to;
    return { from: line.from, to: line.to, textFrom, textTo: textFrom + text.length, text, hideTo };
  }
  return null;
}

/// Il primo H1, se si ripiega nel titolo `name`.
export function foldedHeading(doc: TitleLines, bodyFrom: number, name: string | null): FirstHeading | null {
  if (!name) return null;
  const heading = firstHeading(doc, bodyFrom);
  return heading && sameTitle(heading.text, name) ? heading : null;
}

/// Il nome scritto come testo di un titolo Markdown: i segni che la resa
/// leggerebbe come formattazione vanno sotto barra, così l'H1 riscritto si
/// legge come il nome (e la barra, punteggiatura, non cambia il confronto).
export function headingText(name: string): string {
  return name.trim().replace(/[\\`*_[\]<>~=|]/g, (char) => `\\${char}`);
}

/// La modifica che porta l'H1 ripiegato col nome `before` al nome `after`, o
/// `null` se il primo H1 non si ripiega più (cambiato nel frattempo, o mai
/// stato uguale). Si cambia soltanto il testo: `#` e la chiusura restano.
export function retitled(
  doc: TitleLines,
  bodyFrom: number,
  before: string,
  after: string,
): { readonly from: number; readonly to: number; readonly insert: string } | null {
  const heading = foldedHeading(doc, bodyFrom, before);
  if (!heading) return null;
  const insert = headingText(after);
  if (insert === "" || heading.text === insert) return null;
  return { from: heading.textFrom, to: heading.textTo, insert };
}

/// Chi tiene allineato l'H1 al titolo in un posto della finestra: una
/// superficie Markdown, col suo elemento.
export interface TitleKeeper {
  readonly root: Element;
  /// Il nome della pagina è passato da `before` ad `after` con un gesto del
  /// titolo: riscrive l'H1 ripiegato, se c'è, con un passo d'annullamento.
  retitle(before: string, after: string): void;
}

const keepers = new Set<TitleKeeper>();

/// Registra chi tiene l'H1 di una superficie; dà lo smontaggio.
export function keepTitle(keeper: TitleKeeper): () => void {
  keepers.add(keeper);
  return () => {
    keepers.delete(keeper);
  };
}

/// Una rinomina dal titolo del foglio: le superfici dentro `container` (il
/// riquadro) riscrivono l'H1 ripiegato col nome nuovo. Solo dopo una rinomina
/// riuscita: se è fallita l'H1 non cambia.
export function retitleIn(container: Element, before: string, after: string): void {
  for (const keeper of [...keepers]) {
    if (container.contains(keeper.root)) keeper.retitle(before, after);
  }
}
