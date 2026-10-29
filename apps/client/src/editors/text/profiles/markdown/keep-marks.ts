// Una cancellazione che taglia un elemento a metà, in Live. Scelto
// `x</u> be` in `<u>2x</u> beta`, togliere tutto lascerebbe `<u>2ta`, e il
// tag senza compagno resterebbe a vista. Come in Word, se ne va il testo e
// il formato resta attorno a ciò che ne avanza:
//
// - i segni di un elemento che la cancellazione prende solo in parte restano;
// - un elemento preso tutto se ne va coi suoi segni;
// - un elemento a cui non resta testo perde anche i segni, che vuoti
//   resterebbero a vista (`****`).
//
// Tocca soltanto le cancellazioni e le scritture sopra una selezione, con un
// cursore solo, che prendono anche del testo: chi toglie soltanto segni (la
// guida, le due fermate al bordo) sa già che cosa fa.
import { EditorSelection, EditorState, type Extension, Transaction, type TransactionSpec } from "@codemirror/state";
import type { ElementMarks } from "./cursor-elements";
import { openedPair } from "./empty-pair";
import { brokenTwins, elementsTouching, type FormatElement } from "./format-toggle";

const ELEMENTS: readonly FormatElement[] = ["strong", "em", "strike", "underline", "sup", "sub", "highlight"];

/// Una modifica nelle posizioni del documento di prima.
export interface Cut {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

function cutsOf(tr: Transaction): Cut[] {
  const out: Cut[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => out.push({ from: fromA, to: toA, insert: inserted.toString() }));
  return out;
}

/// Le modifiche che tengono i segni degli elementi tagliati, o `null` se
/// `cuts` non ne taglia nessuno.
export function keptMarks(state: EditorState, cuts: readonly Cut[]): {
  changes: { from: number; to: number; insert?: string }[];
  cursor: number;
} | null {
  const deleted = new Set<number>();
  for (const cut of cuts) for (let at = cut.from; at < cut.to; at++) deleted.add(at);
  if (!deleted.size) return null;
  const from = Math.min(...cuts.map((cut) => cut.from));
  const to = Math.max(...cuts.map((cut) => cut.to));
  const elements: ElementMarks[] = ELEMENTS.flatMap((element) => elementsTouching(state, from, Math.max(to, from + 1), element));
  const signs = new Set<number>();
  for (const marks of elements) {
    for (let at = marks.from; at < marks.openTo; at++) signs.add(at);
    for (let at = marks.closeFrom; at < marks.to; at++) signs.add(at);
  }
  const kept = new Set<number>();
  const dropped = new Set<number>();
  const touched = (a: number, b: number) => {
    for (let at = a; at < b; at++) if (deleted.has(at)) return true;
    return false;
  };
  // Chi toglie soltanto segni sa che cosa fa, se li toglie a coppie o ne
  // scrive altri: il gesto che toglie un formato, l'apice che passa al tag.
  // Una lettera scritta sopra un segno solo invece lo lascerebbe spaiato, e
  // il segno resta.
  if (![...deleted].some((at) => !signs.has(at))) {
    if (cuts.some((cut) => /[*_~^=<>]/.test(cut.insert))) return null;
    for (const marks of elements) {
      if (touched(marks.from, marks.openTo) === touched(marks.closeFrom, marks.to)) continue;
      for (let at = marks.from; at < marks.to; at++) if (deleted.has(at)) kept.add(at);
    }
    if (!kept.size) return null;
  }
  const every = (a: number, b: number) => {
    for (let at = a; at < b; at++) if (!deleted.has(at)) return false;
    return true;
  };
  // Un elemento che si svuota svuota quello che lo contiene: `<u>*~~^a^~~*</u>`
  // senza la `a` non lascia niente. Si ripete finché nessuno cambia.
  const emptied = new Set<ElementMarks>();
  const gone = (at: number) => deleted.has(at) || dropped.has(at);
  const all = (a: number, b: number) => {
    for (let at = a; at < b; at++) if (!gone(at)) return false;
    return true;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const marks of elements) {
      if (emptied.has(marks) || every(marks.from, marks.to)) continue;
      const written = cuts.some((cut) => cut.insert && marks.openTo <= cut.from && cut.from <= marks.closeFrom);
      if (written || !all(marks.openTo, marks.closeFrom)) continue;
      emptied.add(marks);
      changed = true;
      for (let at = marks.from; at < marks.openTo; at++) dropped.add(at);
      for (let at = marks.closeFrom; at < marks.to; at++) dropped.add(at);
    }
  }
  for (const marks of elements) {
    if (emptied.has(marks) || every(marks.from, marks.to)) continue;
    for (let at = marks.from; at < marks.openTo; at++) if (deleted.has(at)) kept.add(at);
    for (let at = marks.closeFrom; at < marks.to; at++) if (deleted.has(at)) kept.add(at);
  }
  if (!kept.size && ![...dropped].some((at) => !deleted.has(at))) return null;
  const removed = (at: number) => (deleted.has(at) && !kept.has(at)) || dropped.has(at);
  const changes: { from: number; to: number; insert?: string }[] = [];
  const lo = Math.min(from, ...dropped);
  const hi = Math.max(to, ...[...dropped].map((at) => at + 1));
  // Il testo scritto resta dove lo si scriveva: le cancellazioni si fermano
  // lì, perché un inserto dentro una di loro finirebbe al suo inizio.
  const writes = new Set(cuts.filter((cut) => cut.insert).map((cut) => cut.from));
  for (let at = lo; at < hi;) {
    if (!removed(at)) { at++; continue; }
    const start = at;
    do at++; while (at < hi && removed(at) && !writes.has(at));
    changes.push({ from: start, to: at });
  }
  for (const cut of cuts) if (cut.insert) changes.push({ from: cut.from, to: cut.from, insert: cut.insert });
  const set = state.changes(changes);
  const last = cuts[cuts.length - 1]!;
  const cursor = last.insert ? set.mapPos(last.from, -1) + last.insert.length : set.mapPos(last.to, -1);
  return { changes, cursor };
}

const guard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent("delete") || tr.isUserEvent("input") || tr.isUserEvent("cut"))) return tr;
  if (tr.startState.selection.ranges.length > 1) return tr;
  const userEvent = tr.annotation(Transaction.userEvent);
  // Un gesto di formato (`input` e basta) toglie e cambia segni di proposito.
  const plan = userEvent === "input" ? null : keptMarks(tr.startState, cutsOf(tr));
  if (plan) {
    const changes = tr.startState.changes(plan.changes);
    const tags = brokenTwins(tr.startState, changes);
    const kept: TransactionSpec = {
      changes,
      selection: EditorSelection.cursor(plan.cursor),
      scrollIntoView: tr.scrollIntoView,
      ...(userEvent ? { userEvent } : {}),
    };
    return tags.length ? [kept, { changes: tr.startState.changes(tags).map(changes), sequential: true }] : kept;
  }
  // Il gesto che apre una coppia vuota l'ha già provata con una lettera
  // dentro: vuota, si legge diversa (`**====**`), e non dice niente.
  if (!tr.isUserEvent("input.type") && tr.effects.some((effect) => effect.is(openedPair))) return tr;
  const tags = brokenTwins(tr.startState, tr.changes);
  if (!tags.length) return tr;
  const twins = tr.startState.changes(tags).map(tr.changes);
  // Le due modifiche in una: il passo di annulla resta uno.
  return [tr, { changes: twins, sequential: true }];
});

/// La cancellazione che non taglia gli elementi, per la Live.
export function keepMarks(): Extension {
  return guard;
}
