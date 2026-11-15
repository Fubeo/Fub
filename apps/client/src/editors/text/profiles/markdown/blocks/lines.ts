// Gli a capo del testo che i gesti dei blocchi scrivono nella nota (#390).
// I gesti compongono il testo con "\n", come `doc.sliceString` senza
// separatore: ogni a capo conta una posizione, come nel documento, e i conti
// dei posti (cursore, blocchi spostati) tornano. Prima di entrare nella nota
// gli a capo diventano quelli dello stato: in una nota tutta CRLF l'editor
// ha il separatore `\r\n` (engine.ts) e CodeMirror divide il testo inserito
// solo lì, così un "\n" resterebbe dentro la riga e il file uscirebbe con a
// capo misti.
import { type EditorState } from "@codemirror/state";

/// `text`, con le righe divise da "\n", pronto da inserire in `state`.
export function withLineBreaks(state: EditorState, text: string): string {
  const nl = state.lineBreak;
  return nl === "\n" ? text : text.split("\n").join(nl);
}
