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
/// l'albero, anche dopo 60 s di lavoro, non arriva in fondo al documento, o
/// se la transazione vuota cambia testo o selezione (un filtro o un
/// estensore che reagisce anche a lei): il test partirebbe da un altro stato.
/// Conta la lunghezza e non `syntaxTreeAvailable`: un blocco di codice in una
/// lingua caricata in modo asincrono resta da analizzare anche ad albero
/// completo.
export function parsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 60_000);
  const next = state.update({}).state;
  sameStart(state, next);
  return next;
}

/// Lo stesso per una vista, o per la vista montata in `parent`: la
/// transazione vuota passa dalla vista, così anche le decorazioni si rifanno
/// sull'albero intero.
export function parsedView(target: EditorView | HTMLElement): EditorView {
  const view = target instanceof EditorView ? target : EditorView.findFromDOM(target);
  if (!view) throw new Error("l'editor non è montato");
  const before = view.state;
  ensureSyntaxTree(before, before.doc.length, 60_000);
  view.dispatch({});
  sameStart(before, view.state);
  return view;
}

function sameStart(before: EditorState, after: EditorState): void {
  if (syntaxTree(after).length < after.doc.length) throw new Error("l'albero sintattico non copre tutto il documento");
  if (!after.doc.eq(before.doc)) throw new Error("la transazione vuota ha cambiato il testo");
  if (!after.selection.eq(before.selection)) throw new Error("la transazione vuota ha cambiato la selezione");
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
