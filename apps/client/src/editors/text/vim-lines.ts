// La modalità Vim in una nota CRLF (#397): vedi `vimLines`.
import { EditorState, Facet, type Extension } from "@codemirror/state";
import { CodeMirror } from "@replit/codemirror-vim";

let vimReadsPatched = false;

/// Gli stati in cui Vim è acceso: solo lì una posizione sull'a capo vale "\n"
/// (vedi `oneBreakIsOneCharacter`).
const vimReadsOneBreak = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

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
///
/// L'estensione va accanto a `vim()`, nello stesso compartimento: ciò che
/// cambia vale negli stati che la portano, e smette quando Vim si spegne.
export function vimLines(): Extension {
  if (!vimReadsPatched) {
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
  return vimReadsOneBreak.of(true);
}

/// Una posizione, un carattere, **negli stati con Vim acceso**: in una nota
/// con un separatore di più caratteri, `sliceDoc` di una sola posizione che
/// cade sull'a capo dà "\n", non il separatore intero.
///
/// L'a capo conta una posizione in ogni nota, e Vim confronta il carattere
/// in una posizione con "\n" dove non lo si raggiunge dall'adattatore:
/// `goLineRight` (cioè `g$`) vedeva "\r\n", lo prendeva per l'ultimo
/// carattere della riga e tornava indietro di uno; il cursore a blocco, su
/// una riga vuota, scriveva "\r\n" dentro di sé invece dello spazio, andava a
/// capo ed era largo zero, cioè spariva.
///
/// Senza Vim la risposta non cambia: CodeMirror copia, taglia e trascina con
/// `sliceDoc`, e un a capo copiato da una nota CRLF resta "\r\n". Un tratto
/// più lungo di una posizione resta col separatore della nota anche con Vim:
/// è il testo che si salva e si confronta coi byte del file. Un "\n" che da
/// qui finisse in un inserimento lo riporta al separatore
/// `insertedLineBreaks`. In una nota LF la risposta è già "\n".
function oneBreakIsOneCharacter(): void {
  const sliceDoc = EditorState.prototype.sliceDoc;
  EditorState.prototype.sliceDoc = function oneCharacter(this: EditorState, from?: number, to?: number) {
    const text = sliceDoc.call(this, from, to);
    return from !== undefined &&
      to === from + 1 &&
      text.length > 1 &&
      text === this.lineBreak &&
      this.facet(vimReadsOneBreak)
      ? "\n"
      : text;
  };
}
