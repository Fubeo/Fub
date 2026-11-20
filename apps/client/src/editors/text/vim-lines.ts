// La modalità Vim in una nota CRLF (#397): vedi `vimReadsLines`.
import { CodeMirror } from "@replit/codemirror-vim";

let vimReadsPatched = false;

/// La modalità Vim legge il testo con `state.sliceDoc`, che in una nota CRLF
/// mette "\r\n" fra le righe, e poi lo tratta come se gli a capo fossero "\n"
/// di una posizione: `yy` e `p` toglievano il "\n" finale e lasciavano un
/// "\r" dentro la riga (#397). Qui Vim legge le righe unite da "\n", come
/// CodeMirror conta le posizioni e come scrive chi passa da `withLineBreaks`;
/// ciò che Vim scrive con "\n" lo porta al separatore `insertedLineBreaks`
/// (`line-breaks.ts`).
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
}
