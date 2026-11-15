// Copiare un testo con dei commenti.
//
// In Scrittura i segni non si vedono, e una selezione che comincia o finisce
// accanto a un passo commentato può prenderne un segno senza che si veda:
// copiare il testo evidenziato deve dare il testo, non `passo==}{>>…<<}`. Un
// commento che sta tutto nella selezione invece si copia intero: incollato in
// Fub resta (`paste.ts` lo riconosce come Markdown), e l'HTML che va fuori da
// Fub non ha né segni né messaggi (`copy-html.ts`, la stessa resa della
// Lettura).
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxForm } from "../../../../../host/contract";
import { threadsIn } from "./mask";
import { threadCuts, type Range } from "./syntax";

/// Il Markdown di `[from, to)` da copiare: i commenti tagliati dalla
/// selezione perdono i segni e i messaggi che vi cadono, quelli interi
/// restano come sono.
export function copiedMarkdown(state: EditorState, from: number, to: number, forms?: readonly SyntaxForm[]): string {
  const text = state.sliceDoc(from, to);
  if (from >= to || !text.includes("{") && !text.includes("}")) return text;
  const drop: Range[] = [];
  for (const thread of threadsIn(state, from, to, forms)) {
    if (thread.to <= from || thread.from >= to) continue;
    if (from <= thread.from && thread.to <= to) continue;
    for (const cut of threadCuts(thread)) {
      const a = Math.max(cut.from, from);
      const b = Math.min(cut.to, to);
      if (a < b) drop.push({ from: a, to: b });
    }
  }
  if (drop.length === 0) return text;
  drop.sort((a, b) => a.from - b.from);
  let out = "";
  let at = from;
  for (const cut of drop) {
    if (cut.from > at) out += state.sliceDoc(at, cut.from);
    at = Math.max(at, cut.to);
  }
  return out + state.sliceDoc(at, to);
}

/// Il testo semplice di una copia o di un taglio coi commenti tagliati
/// ripuliti. La copia di una riga intera (la selezione vuota) resta quella di
/// CodeMirror: prende la riga tutta, coi suoi commenti interi.
export function commentCopy(forms?: readonly SyntaxForm[]): Extension {
  return EditorView.clipboardOutputFilter.of((text, state) => {
    const ranges = state.selection.ranges.filter((range) => !range.empty);
    if (ranges.length === 0) return text;
    if (ranges.map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak) !== text) return text;
    return ranges.map((range) => copiedMarkdown(state, range.from, range.to, forms)).join(state.lineBreak);
  });
}
