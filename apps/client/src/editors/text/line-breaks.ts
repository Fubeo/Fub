// Gli a capo del testo che l'editor scrive nella nota (#390, #394).
//
// In una nota tutta CRLF l'editor ha il separatore `\r\n` (engine.ts), e
// CodeMirror divide il testo inserito solo lì: un "\n" nudo resterebbe dentro
// la riga, e il file uscirebbe con a capo misti.
//
// Chi compone un inserimento lo fa con "\n", come `doc.sliceString` senza
// separatore: ogni a capo conta una posizione, come nel documento, qualunque
// sia il separatore, e i conti dei posti (cursore, selezioni, blocchi
// spostati) tornano. Solo il testo che entra nella nota prende gli a capo
// dello stato, con `withLineBreaks`; le lunghezze si contano prima.
import { type EditorState, Text } from "@codemirror/state";

/// `text`, con le righe divise da "\n", pronto da inserire in `state`.
export function withLineBreaks(state: EditorState, text: string): string {
  const nl = state.lineBreak;
  return nl === "\n" ? text : text.split("\n").join(nl);
}

/// Un testo venuto da fuori (gli appunti, il convertitore dell'HTML), con a
/// capo di qualunque forma, come righe vere di un documento: va bene in ogni
/// nota, e la sua lunghezza conta un a capo una posizione.
export function textLines(text: string): Text {
  return Text.of(text.split(/\r\n?|\n/));
}
