// La scrittura «Live»: le pillole intere e le cancellazioni di ciò che è nascosto.
import { type EditorState } from "@codemirror/state";
import {
  CharCategory,
  EditorSelection,
  findClusterBreak,
  RangeSet,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { Coverage, grownSpan, SpanIndex } from "./live-spans";
import type { LiveDeco, LiveDecoKind } from "./livepreview-model";

/// Le decorazioni che una pastiglia può attraversare: quelle di riga, e il
/// barrato della voce fatta, che finisce col fine riga (dove la pastiglia, se
/// continua, va comunque a capo).
export const LINE_KINDS: ReadonlySet<LiveDecoKind> = new Set(["quote-line", "codeblock-line", "callout-line", "done"]);

/// La pastiglia della scadenza, allargata finché non taglia più niente.
///
/// Un segno che ne attraversa il bordo — il codice in cui sta la data, il
/// wikilink che la porta, i suoi segni nascosti, un evidenziato — spezzerebbe
/// la pastiglia in due toppe: CodeMirror chiude e riapre il segno che finisce
/// prima. Così la pastiglia prende per intero l'elemento che tocca, come in
/// Lettura (`markTaskDues`): sta dentro un elemento che la contiene o
/// contiene quelli che tocca, mai a cavallo.
///
/// E un elemento di cui la pastiglia copre tutto ciò che si vede (il codice
/// `` `📅 2026-11-16` `` fuori dalla riga del cursore) sta dentro di lei, coi
/// suoi segni nascosti: intorno, il suo fondo farebbe una toppa sulla toppa.
export function wholePill(pill: LiveDeco, others: readonly LiveDeco[]): LiveDeco {
  let { from, to } = pill;
  const marks = others.filter((d) => d !== pill && !LINE_KINDS.has(d.kind) && d.from < d.to);
  const hides = marks.filter((d) => d.kind === "hide");
  // I tratti nascosti uniti: un tratto è nascosto se uno solo lo copre.
  const hidden = new Coverage(hides);
  const grow = () => ({ from, to } = grownSpan(from, to, marks));
  grow();
  const covered = marks.some((other) => other.kind !== "hide" && other.from <= from && to <= other.to
    && hidden.covers(other.from, from) && hidden.covers(to, other.to));
  if (covered) {
    for (let moved = true; moved; ) {
      moved = false;
      for (const hide of hides) {
        if (hide.to === from) { from = hide.from; moved = true; }
        if (hide.from === to) { to = hide.to; moved = true; }
      }
    }
    grow();
  }
  return { ...pill, from, to };
}

/// Le pastiglie intere (`wholePill`), guardando per ognuna soltanto i segni
/// del suo compito: un segno in riga non esce dal paragrafo, e il paragrafo
/// di un compito comincia alla riga della casella. I segni si ordinano una
/// volta, e ogni pastiglia ne legge solo il tratto suo: nella battuta da 4 ms
/// non si scorre tutto il viewport per ogni compito.
export function wholePills(
  pills: readonly { pill: LiveDeco; from: number; to: number }[],
  decos: readonly LiveDeco[],
): LiveDeco[] {
  if (pills.length === 0) return [];
  const sorted = decos.filter((d) => d.from < d.to && !LINE_KINDS.has(d.kind)).sort((a, b) => a.from - b.from);
  return pills.map(({ pill, from, to }) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]!.from < from) low = middle + 1;
      else high = middle;
    }
    const near: LiveDeco[] = [];
    for (let at = low; at < sorted.length && sorted[at]!.from <= to; at++) near.push(sorted[at]!);
    return wholePill(pill, near);
  });
}

const REPLACED: ReadonlySet<LiveDecoKind> = new Set(["hide", "math", "entity", "image", "cell-value", "link-pill", "footnote-back"]);

/// La punteggiatura che non comincia una riga.
const TRAILING_PUNCTUATION = /^[,.;:!?)\]»”’]+/;

/// Un pezzo sostituito (un segno nascosto, una formula, un'immagine, una
/// pastiglia) seguito da punteggiatura non va a capo da solo: la lettera prima
/// del pezzo, il pezzo e la punteggiatura stanno sotto un `cm-fub-nobreak`.
export function keepPunctuation(doc: EditorState["doc"], out: LiveDeco[]): void {
  const glued: LiveDeco[] = [];
  // Letti una volta: i pezzi sostituiti, e dove finisce uno stile. Una
  // lettera `letter = d.from - 1` sta sotto uno stile che finisce entro
  // `d.from` soltanto se lo stile finisce proprio lì e non è vuoto.
  let replaced: SpanIndex | null = null;
  let styleEnds: Set<number> | null = null;
  for (const d of out) {
    if (!REPLACED.has(d.kind)) continue;
    if (d.from === d.to) continue;
    const line = doc.lineAt(d.from);
    if (d.to > line.to) continue;
    const after = TRAILING_PUNCTUATION.exec(doc.sliceString(d.to, Math.min(line.to, d.to + 8)));
    if (!after) continue;
    // La lettera prima, se c'è, nessun altro pezzo la sostituisce e nessuno
    // stile finisce su di lei: uno stile tagliato in due mostra il suo fondo
    // e il suo margine due volte («ricordar e»).
    const letter = d.from - 1;
    replaced ??= new SpanIndex(out.filter((o) => REPLACED.has(o.kind)));
    styleEnds ??= new Set(out.filter((o) => !REPLACED.has(o.kind) && o.kind !== "nobreak" && o.from < o.to).map((o) => o.to));
    const free = letter >= line.from && !/\s/.test(doc.sliceString(letter, d.from))
      && !replaced.covers(letter)
      && !styleEnds.has(d.from);
    const before = free ? letter : d.from;
    glued.push({ from: before, to: d.to + after[0].length, kind: "nobreak" });
  }
  out.push(...glued);
}

/// Gli elementi in riga che hanno un segno d'apertura e uno di chiusura come
/// figli, e il nome di quei segni.
const MARKED_ELEMENTS: Readonly<Record<string, string>> = {
  StrongEmphasis: "EmphasisMark",
  Emphasis: "EmphasisMark",
  Strikethrough: "StrikethroughMark",
  Superscript: "SuperscriptMark",
  Subscript: "SubscriptMark",
  InlineCode: "CodeMark",
};

/// L'elemento coi segni il cui contenuto è esattamente `from`–`to`: è quello
/// che una cancellazione lascerebbe vuoto.
function elementOfContent(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    const mark = MARKED_ELEMENTS[node.name];
    if (!mark) continue;
    const marks = node.getChildren(mark);
    if (marks.length >= 2 && marks[0]!.to === from && marks[marks.length - 1]!.from === to) return node;
    if (node.from < from && to < node.to) return null;
  }
  return null;
}

/// La cancellazione di un carattere con la politica `mai`, accanto ai segni
/// nascosti (`hidden`): il cursore salta i segni e cancella la lettera dopo
/// di loro, e una lettera che è tutto il contenuto del suo elemento porta via
/// anche i segni. `null` quando non c'è niente di questo, e vale il tasto di
/// sempre: una selezione, un segno a inizio o fine riga (il prefisso di un
/// blocco), una lettera qualunque.
export function hiddenDeletion(
  state: EditorState,
  hidden: RangeSet<Decoration>,
  forward: boolean,
): TransactionSpec | null {
  if (state.selection.ranges.some((range) => !range.empty)) return null;
  let special = false;
  let blocked = false;
  const result = state.changeByRange((range) => {
    let pos = range.head;
    let skipped = false;
    for (;;) {
      let next = -1;
      hidden.between(pos, pos, (from, to) => {
        if (!forward && to === pos && from < pos) next = from;
        if (forward && from === pos && to > pos) next = to;
      });
      if (next < 0) break;
      pos = next;
      skipped = true;
    }
    const line = state.doc.lineAt(pos);
    if ((!forward && pos === line.from) || (forward && pos === line.to)) {
      if (skipped) blocked = true;
      return { range };
    }
    const column = pos - line.from;
    const from = forward ? pos : line.from + findClusterBreak(line.text, column, false);
    const to = forward ? line.from + findClusterBreak(line.text, column, true) : pos;
    let element = elementOfContent(state, from, to);
    // `***x***`: l'elemento vuoto è tutto il contenuto di quello che lo
    // contiene, e se ne vanno anche i segni di fuori.
    for (let outer = element; outer; outer = elementOfContent(state, outer.from, outer.to)) element = outer;
    if (element) {
      special = true;
      return { changes: { from: element.from, to: element.to }, range: EditorSelection.cursor(element.from) };
    }
    if (skipped) special = true;
    return { changes: { from, to }, range: EditorSelection.cursor(from) };
  });
  if (!special || blocked) return null;
  return { ...result, scrollIntoView: true, userEvent: forward ? "delete.forward" : "delete.backward" };
}

/// La cancellazione di una parola (Mod-Backspace, Mod-Canc) con la politica
/// `mai`, accanto ai segni nascosti (`hidden`): il cursore salta i segni e
/// cancella la parola che si vede dopo di loro, come `deleteGroupBackward` e
/// `deleteGroupForward` di CodeMirror, senza entrare nel segno che viene dopo.
/// Senza questo la parola si fermava al segno: un segno nascosto è atomico, e
/// un segno di commento non si cancella da solo (`comments/mask.ts`), quindi
/// il gesto non faceva niente. `null` se nessun cursore sta accanto a un
/// segno, o c'è una selezione: vale il tasto di sempre.
export function hiddenGroupDeletion(
  state: EditorState,
  hidden: RangeSet<Decoration>,
  forward: boolean,
): TransactionSpec | null {
  if (state.selection.ranges.some((range) => !range.empty)) return null;
  const hiddenEdge = (pos: number): boolean => {
    let found = false;
    hidden.between(pos, pos, (from, to) => {
      if ((!forward && to === pos && from < pos) || (forward && from === pos && to > pos)) found = true;
    });
    return found;
  };
  let special = false;
  const result = state.changeByRange((range) => {
    let start = range.head;
    let skipped = false;
    for (;;) {
      let next = -1;
      hidden.between(start, start, (from, to) => {
        if (!forward && to === start && from < start) next = from;
        if (forward && from === start && to > start) next = to;
      });
      if (next < 0) break;
      start = next;
      skipped = true;
    }
    if (skipped) special = true;
    const line = state.doc.lineAt(start);
    const categorize = state.charCategorizer(start);
    let pos = start;
    for (let category: CharCategory | null = null; ;) {
      if (pos === (forward ? line.to : line.from)) {
        if (pos === start && !skipped && line.number !== (forward ? state.doc.lines : 1)) pos += forward ? 1 : -1;
        break;
      }
      if (pos !== start && hiddenEdge(pos)) break;
      const next = findClusterBreak(line.text, pos - line.from, forward) + line.from;
      const char = line.text.slice(Math.min(pos, next) - line.from, Math.max(pos, next) - line.from);
      const nextCategory = categorize(char);
      if (category !== null && nextCategory !== category) break;
      if (char !== " " || pos !== start) category = nextCategory;
      pos = next;
    }
    if (pos === start) return { range };
    const from = Math.min(pos, start);
    const to = Math.max(pos, start);
    // La parola che è tutto il contenuto del suo elemento porta via anche i
    // segni, come l'ultima lettera: nel file non resta un `****`.
    let element = skipped ? elementOfContent(state, from, to) : null;
    for (let outer = element; outer; outer = elementOfContent(state, outer.from, outer.to)) element = outer;
    if (element) return { changes: { from: element.from, to: element.to }, range: EditorSelection.cursor(element.from) };
    return { changes: { from, to }, range: EditorSelection.cursor(from) };
  });
  if (!special) return null;
  return { ...result, scrollIntoView: true, userEvent: forward ? "delete.forward" : "delete.backward" };
}
