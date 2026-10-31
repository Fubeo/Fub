// Il ripiegabile in Live e nei Blocchi (K2). Dell'apertura resta il sommario,
// con la freccia davanti; `<details>`, `<summary>` e `</details>` non si
// vedono, e il contenuto sta rientrato sotto. Aperto o chiuso è della vista:
// la freccia non scrive niente, e un ripiegabile comincia come dice il suo
// `open` (che si cambia dal menu del blocco). Un cursore che entra nel
// contenuto chiuso lo apre. Con `elemento` e `riga` la sorgente
// dell'apertura torna col cursore sopra. Un `<details>` senza chiusura resta
// sorgente, con l'ondulato.
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Extension, MapMode, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { liveReveal } from "../../live-reveal";
import { type DetailsPair, pairDetails, type TopBlock } from "./details";
import { liveStrings } from "./strings";

/// La freccia di un ripiegabile: aperto o chiuso, nella vista.
export const setDetailsOpen = StateEffect.define<{ at: number; open: boolean }>({
  map: (value, mapping) => ({ at: mapping.mapPos(value.at, 1), open: value.open }),
});

/// Le frecce toccate in questa vista, per l'inizio dell'apertura.
const toggled = StateField.define<ReadonlyMap<number, boolean>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value;
    if (tr.docChanged && value.size > 0) {
      const moved = new Map<number, boolean>();
      for (const [at, open] of value) {
        const to = tr.changes.mapPos(at, 1, MapMode.TrackDel);
        if (to !== null) moved.set(to, open);
      }
      next = moved;
    }
    for (const effect of tr.effects) {
      if (!effect.is(setDetailsOpen)) continue;
      if (next === value) next = new Map(value);
      (next as Map<number, boolean>).set(effect.value.at, effect.value.open);
    }
    return next;
  },
});

/// I ripiegabili del documento, dai blocchi HTML di primo livello.
export function detailsOf(state: EditorState): ReturnType<typeof pairDetails> {
  const tops: TopBlock[] = [];
  const cursor = syntaxTree(state).cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "HTMLBlock") tops.push({ from: cursor.from, to: cursor.to, html: state.sliceDoc(cursor.from, cursor.to) });
    } while (cursor.nextSibling());
  }
  return pairDetails(tops);
}

/// Dove sta il contenuto: dalla riga dopo l'apertura alla fine della chiusura.
function bodyOf(state: EditorState, pair: DetailsPair): { from: number; to: number } {
  const after = state.doc.lineAt(pair.open.to);
  const from = after.number < state.doc.lines ? state.doc.line(after.number + 1).from : after.to;
  return { from, to: pair.close.to };
}

/// Se il ripiegabile è aperto nella vista: la freccia, se toccata, o il suo
/// `open`; aperto comunque con un cursore dentro il contenuto.
export function detailsShownOpen(state: EditorState, pair: DetailsPair): boolean {
  const body = bodyOf(state, pair);
  if (state.selection.ranges.some((range) => range.head >= body.from && range.head < state.doc.lineAt(pair.close.from).from)) return true;
  return state.field(toggled, false)?.get(pair.open.from) ?? pair.head.open;
}

class DetailsArrowWidget extends WidgetType {
  constructor(readonly open: boolean, readonly empty: boolean) { super(); }
  eq(other: DetailsArrowWidget): boolean { return other.open === this.open && other.empty === this.empty; }
  toDOM(): HTMLElement {
    const holder = document.createElement("span");
    holder.className = "cm-fub-details-head";
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.className = "cm-fub-details-arrow";
    arrow.setAttribute("aria-expanded", String(this.open));
    arrow.setAttribute("aria-label", liveStrings.t(this.open ? "live.details.open" : "live.details.closed"));
    arrow.textContent = this.open ? "▾" : "▸";
    holder.append(arrow);
    if (this.empty) {
      const hint = document.createElement("span");
      hint.className = "cm-fub-details-empty";
      hint.setAttribute("aria-hidden", "true");
      hint.textContent = liveStrings.t("blocks.kind.details");
      holder.append(hint);
    }
    return holder;
  }
  // I tasti restano al pulsante, che con Invio e Spazio fa il suo clic.
  ignoreEvent(event: Event): boolean { return event instanceof KeyboardEvent; }
}

const hidden = Decoration.replace({});
const hiddenLines = Decoration.replace({ block: true });
// Le frasi si leggono alla prima resa, non all'import (`strings.ts`).
let unclosed: Decoration | null = null;
const unclosedMark = () => (unclosed ??= Decoration.mark({
  class: "cm-fub-wavy",
  attributes: { title: liveStrings.t("live.details.unclosed") },
}));
const lineMarks = new Map<string, Decoration>();
function lineMark(kind: "summary" | "body", depth: number): Decoration {
  const key = `${kind}${depth}`;
  let mark = lineMarks.get(key);
  if (!mark) {
    mark = Decoration.line({ class: `cm-fub-details-${kind}`, attributes: { "data-details-depth": String(Math.min(depth, 6)) } });
    lineMarks.set(key, mark);
  }
  return mark;
}

const touches = (state: EditorState, from: number, to: number) =>
  state.selection.ranges.some((range) => range.from <= to && range.to >= from);

function decorate(state: EditorState): DecorationSet {
  const { pairs, unclosed: open_ } = detailsOf(state);
  if (pairs.length === 0 && open_.length === 0) return Decoration.none;
  const doc = state.doc;
  const policy = state.facet(liveReveal);
  const out: Range<Decoration>[] = [];
  const depthOf = new Map<number, number>();
  const deepen = (line: number, depth: number) => depthOf.set(line, Math.max(depthOf.get(line) ?? 0, depth));
  const folded: { from: number; to: number }[] = [];
  let hiddenTo = -1;
  for (const pair of pairs) {
    if (pair.open.from < hiddenTo) continue;
    const first = doc.lineAt(pair.open.from);
    const last = doc.lineAt(pair.open.to);
    const close = doc.lineAt(pair.close.from);
    const closeEnd = doc.lineAt(pair.close.to);
    const open = detailsShownOpen(state, pair);
    const revealHead = policy !== "mai" && touches(state, first.from, last.to);
    if (!revealHead) {
      // Il sommario, o senza sommario la riga di `<details>`: la freccia al
      // posto dei tag, e le altre righe dell'apertura via.
      const summaryAt = pair.head.summary ? pair.open.from + pair.head.summary.from : first.from;
      const line = doc.lineAt(summaryAt);
      if (line.number > first.number) out.push(hiddenLines.range(first.from, doc.line(line.number - 1).to));
      if (line.number < last.number) out.push(hiddenLines.range(doc.line(line.number + 1).from, last.to));
      out.push(lineMark("summary", pair.depth).range(line.from));
      const summaryTo = pair.head.summary ? pair.open.from + pair.head.summary.to : line.to;
      const empty = !pair.head.summary || summaryTo === summaryAt;
      out.push(Decoration.replace({ widget: new DetailsArrowWidget(open, empty) }).range(line.from, pair.head.summary ? summaryAt : line.to));
      if (pair.head.summary && line.to > summaryTo) out.push(hidden.range(summaryTo, line.to));
    }
    const body = bodyOf(state, pair);
    if (!open) {
      out.push(hiddenLines.range(body.from, closeEnd.to));
      folded.push({ from: body.from, to: closeEnd.to });
      hiddenTo = closeEnd.to;
      continue;
    }
    // Le righe vuote che tengono il contenuto Markdown, la prima e l'ultima,
    // sono sintassi: non si vedono, se resta una riga in mezzo e il cursore
    // non ci sta.
    const top = doc.lineAt(body.from).number;
    const bottom = close.number - 1;
    const blank = (n: number) => doc.line(n).length === 0 && !touches(state, doc.line(n).from, doc.line(n).to);
    const trimTop = bottom - top >= 2 && blank(top);
    const trimBottom = bottom - top >= 2 && blank(bottom);
    if (trimTop) out.push(hiddenLines.range(doc.line(top).from, doc.line(top).to));
    if (trimBottom) out.push(hiddenLines.range(doc.line(bottom).from, doc.line(bottom).to));
    for (let n = top + (trimTop ? 1 : 0); n <= bottom - (trimBottom ? 1 : 0); n++) deepen(n, pair.depth + 1);
    if (!(policy !== "mai" && touches(state, close.from, closeEnd.to))) out.push(hiddenLines.range(close.from, closeEnd.to));
  }
  for (const [line, depth] of depthOf) {
    const at = doc.line(line).from;
    // Le righe di un ripiegabile chiuso dentro uno aperto non si vedono.
    if (folded.some((range) => at >= range.from && at <= range.to)) continue;
    out.push(lineMark("body", depth).range(at));
  }
  for (const head of open_) out.push(unclosedMark().range(head.from, doc.lineAt(head.from).to));
  return Decoration.set(out, true);
}

const decorations = StateField.define<DecorationSet>({
  create: (state) => decorate(state),
  update(value, tr) {
    if (
      tr.docChanged || tr.selection || tr.effects.some((effect) => effect.is(setDetailsOpen))
      || syntaxTree(tr.startState) !== syntaxTree(tr.state)
      || tr.startState.facet(liveReveal) !== tr.state.facet(liveReveal)
    ) return decorate(tr.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/// `open` sì o no sull'apertura del ripiegabile che comincia in `at`: come si
/// apre la nota, nella Lettura e nella stampa. Si riscrive soltanto il tag.
export function setDetailsDefault(state: EditorState, at: number, open: boolean) {
  const pair = detailsOf(state).pairs.find((each) => each.open.from === at);
  if (!pair || pair.head.open === open) return null;
  const tag = /^[ \t]*<details[^>]*>/i.exec(state.sliceDoc(pair.open.from, pair.open.to));
  if (!tag) return null;
  const from = pair.open.from + tag[0].indexOf("<");
  return {
    changes: { from, to: pair.open.from + tag[0].length, insert: open ? "<details open>" : "<details>" },
    effects: setDetailsOpen.of({ at: pair.open.from, open }),
    userEvent: "input",
  } as const;
}

/// Apre o chiude il ripiegabile della freccia; chiudendolo, un cursore che
/// stava dentro torna alla fine del sommario.
function toggleAt(view: EditorView, pos: number): boolean {
  const state = view.state;
  const pair = detailsOf(state).pairs.find((each) => pos >= state.doc.lineAt(each.open.from).from && pos <= each.open.to);
  if (!pair) return false;
  const open = !detailsShownOpen(state, pair);
  const body = bodyOf(state, pair);
  const inside = state.selection.ranges.some((range) => range.head >= body.from && range.head <= body.to);
  const summaryEnd = pair.head.summary ? pair.open.from + pair.head.summary.to : state.doc.lineAt(pair.open.from).to;
  view.dispatch({
    effects: setDetailsOpen.of({ at: pair.open.from, open }),
    ...(!open && inside ? { selection: EditorSelection.cursor(summaryEnd) } : {}),
  });
  return true;
}

const gestures = EditorView.domEventHandlers({
  mousedown(event) {
    if ((event.target as Element | null)?.closest?.(".cm-fub-details-arrow")) {
      event.preventDefault();
      return true;
    }
    return false;
  },
  click(event, view) {
    const arrow = (event.target as Element | null)?.closest?.<HTMLElement>(".cm-fub-details-arrow");
    if (!arrow) return false;
    event.preventDefault();
    return toggleAt(view, view.posAtDOM(arrow));
  },
});

const theme = EditorView.baseTheme({
  // I colori sono della pelle (`document.css`); qui la forma.
  ".cm-fub-details-head": { display: "inline-flex", alignItems: "baseline", gap: "0.25em" },
  ".cm-fub-details-arrow": {
    font: "inherit",
    lineHeight: "1",
    border: "none",
    background: "none",
    padding: "0 0.15em",
    margin: "0 0.15em 0 -1.4em",
    width: "1.25em",
    cursor: "pointer",
  },
  // Il rientro è un margine: il `padding` delle righe è della pelle e del
  // rientro sospeso degli elenchi (`hanging.ts`), che si sommano.
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((depth) => [
    `.cm-line[data-details-depth="${depth}"]`, { marginLeft: `${depth * 1.4}em` },
  ])),
});

/// Il ripiegabile della Live e dei Blocchi.
export function detailsLive(): Extension {
  return [toggled, decorations, gestures, theme];
}
