// La modalità Vim in una nota CRLF (#397): vedi `vimReadsLines`.
import { EditorState } from "@codemirror/state";
import { CodeMirror } from "@replit/codemirror-vim";

let vimReadsPatched = false;

/// La modalità Vim legge il testo con `state.sliceDoc`, che in una nota CRLF
/// mette "\r\n" fra le righe, e poi lo tratta come se gli a capo fossero "\n"
/// di una posizione: `yy` e `p` toglievano il "\n" finale e lasciavano un
/// "\r" dentro la riga (#397). Qui Vim legge le righe unite da "\n", come
/// CodeMirror conta le posizioni e come scrive chi passa da `withLineBreaks`;
/// ciò che Vim scrive con "\n" lo porta al separatore `insertedLineBreaks`
/// (`line-breaks.ts`).
///
/// Lo stesso vale per il carattere sotto il cursore, che Vim chiede con
/// `sliceDoc(pos, pos + 1)` e confronta con "\n" anche fuori dall'adattatore
/// (il cursore a blocco, `goLineRight`): vedi `oneBreakIsOneCharacter`.
/// In una nota LF non cambia niente: là `sliceDoc` dà già "\n".
export function vimReadsLines(): void {
  if (vimReadsPatched) return;
  vimReadsPatched = true;
  CodeMirror.prototype.getRange = function getRange(this: CodeMirror, from, to) {
    return this.cm6.state.doc.sliceString(this.indexFromPos(from), this.indexFromPos(to));
  };
  CodeMirror.prototype.getSelections = function getSelections(this: CodeMirror) {
    const { state } = this.cm6;
    return state.selection.ranges.map((range) => state.doc.sliceString(range.from, range.to));
  };
  oneBreakIsOneCharacter();
}

/// Una posizione, un carattere: in una nota con un separatore di più
/// caratteri, `sliceDoc` di una sola posizione che cade sull'a capo dà "\n",
/// non il separatore intero.
///
/// L'a capo conta una posizione in ogni nota, e chi chiede il carattere in
/// una posizione lo confronta con "\n". La modalità Vim lo fa dove non la si
/// raggiunge dall'adattatore: `goLineRight` (cioè `g$`) vedeva "\r\n", lo
/// prendeva per l'ultimo carattere della riga e tornava indietro di uno; il
/// cursore a blocco, su una riga vuota, scriveva "\r\n" dentro di sé invece
/// dello spazio, andava a capo ed era largo zero, cioè spariva.
///
/// Un tratto più lungo di una posizione resta col separatore della nota: è
/// il testo che si salva, si copia e si confronta coi byte del file. Un "\n"
/// che da qui finisse in un inserimento lo riporta al separatore
/// `insertedLineBreaks`. In una nota LF la risposta è già "\n".
function oneBreakIsOneCharacter(): void {
  const sliceDoc = EditorState.prototype.sliceDoc;
  EditorState.prototype.sliceDoc = function oneCharacter(this: EditorState, from?: number, to?: number) {
    const text = sliceDoc.call(this, from, to);
    return from !== undefined && to === from + 1 && text.length > 1 && text === this.lineBreak ? "\n" : text;
  };
}
