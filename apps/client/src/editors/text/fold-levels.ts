import { foldable, foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/// «Piega di più» e «Piega di meno» lavorano per livelli sull'intera nota.
/// Piegare procede dall'interno: chiude le regioni più profonde ancora aperte
/// e visibili. Aprire procede dall'esterno: riapre le pieghe più esterne, e
/// quelle interne restano chiuse. I due comandi si annullano a vicenda e,
/// ripetuti, arrivano a «Piega tutto» e ad «Apri tutto».
interface Span {
  from: number;
  to: number;
}

function regions(state: EditorState): Span[] {
  const found: Span[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const range = foldable(state, line.from, line.to);
    if (range) found.push(range);
  }
  return found;
}

function folds(state: EditorState): Span[] {
  const found: Span[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    found.push({ from, to });
  });
  return found;
}

const within = (inner: Span, outer: Span) =>
  outer.from <= inner.from && inner.to <= outer.to && (outer.from !== inner.from || outer.to !== inner.to);

export const foldMore = (view: EditorView): boolean => {
  const folded = folds(view.state);
  const open = regions(view.state).filter(
    (range) => !folded.some((fold) => (fold.from === range.from && fold.to === range.to) || within(range, fold)),
  );
  if (!open.length) return false;
  const depth = (range: Span) => open.filter((other) => within(range, other)).length;
  const deepest = Math.max(...open.map(depth));
  const effects = open.filter((range) => depth(range) === deepest).map((range) => foldEffect.of(range));
  view.dispatch({ effects });
  return true;
};

export const foldLess = (view: EditorView): boolean => {
  const folded = folds(view.state);
  const outer = folded.filter((fold) => !folded.some((other) => within(fold, other)));
  if (!outer.length) return false;
  view.dispatch({ effects: outer.map((fold) => unfoldEffect.of(fold)) });
  return true;
};
