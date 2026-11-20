// L'interruzione di pagina messa a mano (D17, E28): una riga `<!-- pagina -->`
// nella nota, prima del blocco che comincia la pagina nuova. È un commento
// HTML: gli altri programmi non lo mostrano, la Lettura e la Live di Fub
// nemmeno (la Live lo fa vedere solo sulla riga del cursore, per cancellarlo);
// la resa per la stampa del core ne fa un segnaposto `data-page-break` che lo
// spazio «Esporta in PDF» legge come interruzione (`export/paginate/breaks.ts`).
//
// La stessa regola del provider Markdown (`is_page_break` in
// `crates/fub-format-markdown/src/render.rs`): il solo commento, con gli spazi
// che si vogliono dentro e attorno; un commento che dice altro resta un
// commento.

/// La riga che il gesto «Comincia qui una pagina nuova» scrive.
export const PAGE_BREAK_LINE = "<!-- pagina -->";

const PAGE_BREAK = /^\s*<!--\s*pagina\s*-->\s*$/u;

/// Se `text` (una riga, o un blocco HTML intero) è l'interruzione a mano.
export function isPageBreak(text: string): boolean {
  return PAGE_BREAK.test(text);
}

/// Ciò che serve del testo della nota (il `Text` di CodeMirror, senza
/// legarsi all'editor).
interface NoteText {
  lineAt(pos: number): { readonly to: number; readonly number: number };
  sliceString(from: number, to: number): string;
}

/// Se la Live nasconde il commento `from..to` di `doc`: è l'interruzione a
/// mano, su una riga sola, e il cursore non è sulla sua riga (`shown`). Sta
/// qui e non nella Live perché il ponte del documento è al limite del suo peso.
export function hidesPageBreak(doc: NoteText, from: number, to: number, shown: { row(line: number): boolean }): boolean {
  const line = doc.lineAt(from);
  return to <= line.to && isPageBreak(doc.sliceString(from, to)) && !shown.row(line.number);
}
