// Gli a capo del testo che l'editor scrive nella nota (#390, #394, #397).
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
//
// La regola che vale per ogni inserimento, anche di chi non passa di qui (la
// modalità Vim, gli appunti, un comando nuovo), è `insertedLineBreaks`: un
// filtro sulle transazioni che porta gli a capo nudi al separatore della nota.
import { EditorState, Text, type ChangeSpec, type Extension } from "@codemirror/state";

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

const BARE_BREAK = /\r\n?|\n/g;

/// In una nota con un separatore diverso da "\n", ogni "\n" o "\r" nudo nel
/// testo che una transazione inserisce diventa un a capo vero della nota.
/// Un a capo nudo e un a capo vero contano entrambi una posizione, quindi la
/// selezione e gli effetti della transazione restano quelli; la correzione
/// viaggia nella stessa transazione (stesso passo di annullamento). Un
/// inserimento già fatto di righe vere, come quelli di `withLineBreaks`, non
/// ha niente da correggere.
export function insertedLineBreaks(): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.startState.lineBreak === "\n") return tr;
    const lineBreak = tr.startState.lineBreak;
    const fixes: ChangeSpec[] = [];
    tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
      let at = fromB;
      for (const line of inserted.iterLines()) {
        // Dentro una riga il separatore non c'è: ogni a capo nudo è un
        // carattere solo, e diventa un a capo solo.
        for (const match of line.matchAll(BARE_BREAK)) {
          fixes.push({ from: at + match.index, to: at + match.index + match[0].length, insert: lineBreak });
        }
        at += line.length + 1;
      }
    });
    if (fixes.length === 0) return tr;
    return [tr, { changes: fixes, sequential: true }];
  });
}
