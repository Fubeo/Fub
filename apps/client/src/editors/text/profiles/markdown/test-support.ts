import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vi } from "vitest";

// Il parser di CodeMirror lavora a tempo: 20 ms quando nasce uno stato e a
// ogni transazione, e solo fino a 3000 caratteri quando lo stato nasce. Il
// resto lo fa in sottofondo, e lo consegna a `syntaxTree(state)` con la
// transazione successiva. `ensureSyntaxTree` finisce l'analisi nel contesto
// condiviso ma non cambia l'albero che lo stato già espone: chi confronta
// decorazioni o nodi su quello stesso stato vede l'albero a metà, che sotto
// carico si ferma prima (issue #529).

/// Finisce l'analisi e la consegna a `syntaxTree` con una transazione vuota,
/// come fa l'editor vero quando il parser in sottofondo avanza. Fallisce se
/// l'albero, anche dopo 60 s di lavoro, non arriva in fondo al documento.
/// Conta la lunghezza e non `syntaxTreeAvailable`: un blocco di codice in una
/// lingua caricata in modo asincrono resta da analizzare anche ad albero
/// completo.
export function parsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 60_000);
  const next = state.update({}).state;
  if (syntaxTree(next).length < next.doc.length) throw new Error("l'albero sintattico non copre tutto il documento");
  return next;
}

/// Lo stesso per la vista montata in `parent`: finisce l'analisi e la consegna
/// con una transazione vuota, così le decorazioni si rifanno sull'albero intero.
export function parsedView(parent: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(parent);
  if (!view) throw new Error("l'editor non è montato");
  if (ensureSyntaxTree(view.state, view.state.doc.length, 60_000)) view.dispatch({});
  return view;
}

/// Esegue `create` con il parser a corto di tempo, come su un PC molto
/// carico: ogni lettura dell'orologio salta avanti di un secondo, così ogni
/// lavoro a tempo del parser si ferma dopo un solo passo. Serve a provare
/// che un test non dipende da quanto il parser riesce a fare da solo.
export function withStarvedParser<T>(create: () => T): T {
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
  try {
    return create();
  } finally {
    clock.mockRestore();
  }
}
