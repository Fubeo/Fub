// I commenti di un tratto dello stato, letti dall'albero: per chi lavora fuori
// dalla resa (la cancellazione in `mask.ts`, la copia in `copy.ts`, la
// Sorgente in `source.ts`, i gesti di formato in `format-toggle.ts`). La resa
// li legge da sé, contenitore per contenitore (`livepreview.ts`).
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { SyntaxForm } from "../../../../../host/contract";
import { commentsDeclared, containerComments, containerMath, isMathContainer, nativeInlines, writtenLink } from "../render-inline";
import { mayHaveComments, type CommentThread } from "./syntax";

/// I commenti dei contenitori che toccano `[from, to]`, in ordine. Nessuno se
/// le forme `forms` non accendono `fub:comments`.
export function threadsIn(state: EditorState, from: number, to: number, forms?: readonly SyntaxForm[]): CommentThread[] {
  if (!commentsDeclared(forms)) return [];
  const doc = state.doc;
  const slice = (a: number, b: number) => doc.sliceString(a, b);
  const found: CommentThread[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (!isMathContainer(node.name)) return;
      const text = slice(node.from, node.to);
      if (mayHaveComments(text)) {
        const container: SyntaxNode = node.node;
        const formulas = containerMath(text, container).formulas;
        const natives = nativeInlines(container, container.from, container.to, (link) => writtenLink(slice, link), formulas);
        found.push(...containerComments(text, container, natives, formulas));
      }
      return false;
    },
  });
  return found;
}
