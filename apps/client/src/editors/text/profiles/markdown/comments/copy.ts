// Copiare e tagliare un testo con dei commenti.
//
// In Scrittura i segni non si vedono, e una selezione che comincia o finisce
// accanto a un passo commentato può prenderne un segno senza che si veda:
// copiare il testo evidenziato deve dare il testo, non `passo==}{>>…<<}`. Un
// commento che sta tutto nella selezione invece si copia intero: incollato in
// Fub resta (`paste.ts` lo riconosce come Markdown), e l'HTML che va fuori da
// Fub non ha né segni né messaggi (`copy-html.ts`, la stessa resa della
// Lettura).
//
// Tagliare tutto il testo di un passo è spostarlo, come in Word: il commento
// va col testo. Gli appunti di Fub (`FUB_MARKDOWN_TYPE`, e per i gesti del
// menu, che scrivono dagli appunti asincroni senza tipi propri, l'ultimo
// taglio ricordato qui) portano il Markdown col commento intero; il testo
// semplice resta senza segni, come per una copia. Incollando in Fub il
// commento torna attaccato al testo.
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxForm } from "../../../../../host/contract";
import { threadsIn } from "./threads";
import { threadCuts, type Range } from "./syntax";

/// Il tipo degli appunti con cui un taglio porta il Markdown col commento
/// intero, da Fub a Fub. Gli altri programmi non lo leggono.
export const FUB_MARKDOWN_TYPE = "application/x-fub-markdown";

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

/// Il Markdown di una selezione da copiare, un tratto per riga di
/// separazione come fa CodeMirror; `null` senza testo scelto.
export function copiedSelection(state: EditorState, forms?: readonly SyntaxForm[]): string | null {
  const parts = state.selection.ranges.filter((range) => !range.empty)
    .map((range) => copiedMarkdown(state, range.from, range.to, forms));
  return parts.length > 0 ? parts.join(state.lineBreak) : null;
}

/// Ciò che un taglio porta negli appunti quando prende tutto il testo di un
/// passo commentato senza i suoi segni: `plain`, il testo semplice di sempre,
/// e `markdown`, lo stesso col commento intero.
export interface CarriedCut {
  readonly plain: string;
  readonly markdown: string;
}

/// Il taglio della selezione di `state`, se porta con sé un commento: un
/// tratto che contiene tutto il testo di un passo (non vuoto) ma non tutto il
/// commento si allarga ai segni e ai messaggi. `null` se nessun tratto lo fa:
/// il taglio parziale, e quello che prende già il commento intero, restano
/// quelli di sempre.
export function commentCut(state: EditorState, forms?: readonly SyntaxForm[]): CarriedCut | null {
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (ranges.length === 0) return null;
  let carried = false;
  const plain: string[] = [];
  const markdown: string[] = [];
  for (const range of ranges) {
    let from = range.from;
    let to = range.to;
    for (const thread of threadsIn(state, range.from, range.to, forms)) {
      const passage = thread.passage;
      if (!passage || passage.contentFrom === passage.contentTo) continue;
      if (range.from <= thread.from && thread.to <= range.to) continue;
      if (range.from > passage.contentFrom || passage.contentTo > range.to) continue;
      from = Math.min(from, thread.from);
      to = Math.max(to, thread.to);
      carried = true;
    }
    plain.push(copiedMarkdown(state, range.from, range.to, forms));
    markdown.push(copiedMarkdown(state, from, to, forms));
  }
  return carried ? { plain: plain.join(state.lineBreak), markdown: markdown.join(state.lineBreak) } : null;
}

let lastCut: CarriedCut | null = null;

/// Ricorda il taglio che porta un commento, per l'incolla dal menu (gli
/// appunti asincroni portano soltanto il testo e l'HTML). Un taglio o una
/// copia che non porta commenti lo dimentica: ciò che è negli appunti non è
/// più quel taglio.
export function rememberCut(cut: CarriedCut | null): void {
  lastCut = cut;
}

/// Il Markdown col commento intero che gli appunti `data` portano da un
/// taglio di Fub, o `null`: dal tipo di Fub, o dall'ultimo taglio ricordato
/// se il testo semplice è proprio il suo. Un incolla di solo testo («Incolla
/// come testo», Mod-Maiusc-V) non ha l'HTML che il taglio scrive sempre, e
/// resta il testo semplice.
export function carriedMarkdown(data: DataTransfer): string | null {
  const typed = data.getData(FUB_MARKDOWN_TYPE);
  if (typed) return typed;
  const cut = lastCut;
  if (!cut || !data.getData("text/html")) return null;
  return data.getData("text/plain").replace(/\r\n?/g, "\n") === cut.plain ? cut.markdown : null;
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
