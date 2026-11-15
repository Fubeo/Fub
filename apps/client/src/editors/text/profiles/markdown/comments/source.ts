// I commenti in Sorgente: tutto si vede, segni e messaggi compresi, e un
// colore dice dove comincia e dove finisce ogni commento.
//
// Si colorano soltanto i tratti visibili, e una modifica rilegge i commenti
// solo se nei tratti visibili ce n'è almeno uno (`{>>`): una battuta in una
// nota senza commenti costa la ricerca di tre caratteri.
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxForm } from "../../../../../host/contract";
import { threadsIn } from "./mask";
import { mayHaveComments } from "./syntax";

const sourceMark = Decoration.mark({ class: "cm-fub-comment-source" });

function build(view: EditorView, forms?: readonly SyntaxForm[]): DecorationSet {
  const { state } = view;
  const marks: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    if (!mayHaveComments(state.doc.sliceString(visible.from, visible.to))) continue;
    for (const thread of threadsIn(state, visible.from, visible.to, forms)) {
      if (seen.has(thread.from)) continue;
      seen.add(thread.from);
      // Un segno per riga: il passo può andare a capo.
      for (let at = thread.from; at < thread.to;) {
        const end = Math.min(state.doc.lineAt(at).to, thread.to);
        if (end > at) marks.push(sourceMark.range(at, end));
        at = end + 1;
      }
    }
  }
  return Decoration.set(marks, true);
}

/// Il colore dei commenti in Sorgente.
export function commentSource(forms?: readonly SyntaxForm[]): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view, forms);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = build(update.view, forms);
      }
    }
  }, { decorations: (value) => value.decorations });
}
