// La coppia vuota di un gesto di formato, come in Word: Mod-b senza niente da
// avvolgere apre `**|**`, e se il cursore se ne va senza scrivere la coppia
// sparisce nella stessa transazione. Soltanto in Live e in Blocchi: in
// Sorgente i segni si vedono, e chi li lascia li vuole.
import { EditorState, type Extension, StateEffect, StateField, type Transaction, type TransactionSpec } from "@codemirror/state";

/// Una coppia vuota aperta da un gesto: da `from`, `open` segni e poi `close`.
export interface EmptyPair {
  readonly from: number;
  readonly open: number;
  readonly close: number;
}

/// La coppia appena aperta, posata da chi avvolge (`toggleWrap`).
export const openedPair = StateEffect.define<EmptyPair>({
  map: (pair, changes) => ({ ...pair, from: changes.mapPos(pair.from, -1) }),
});

/// Le coppie di prima portate attraverso `tr`, più quelle che `tr` apre: le
/// sole che restano vuote nel documento nuovo.
function carried(pairs: readonly EmptyPair[], tr: Transaction): EmptyPair[] {
  const kept: EmptyPair[] = [];
  for (const pair of pairs) {
    const from = tr.changes.mapPos(pair.from, -1);
    const to = tr.changes.mapPos(pair.from + pair.open + pair.close, 1);
    if (to - from === pair.open + pair.close) kept.push({ ...pair, from });
  }
  for (const effect of tr.effects) if (effect.is(openedPair)) kept.push(effect.value);
  return kept;
}

/// Un cursore sta ancora fra i segni della coppia.
function held(selection: EditorState["selection"], pair: EmptyPair): boolean {
  return selection.ranges.some((range) => range.empty && range.head === pair.from + pair.open);
}

const opens = (tr: Transaction): boolean => tr.effects.some((effect) => effect.is(openedPair));

const emptyPairs = StateField.define<readonly EmptyPair[]>({
  create: () => [],
  update(pairs, tr) {
    if (!pairs.length && !opens(tr)) return pairs;
    return carried(pairs, tr).filter((pair) => held(tr.state.selection, pair));
  },
});

/// Il cursore lascia una coppia vuota: la coppia se ne va con lui, nella
/// stessa transazione e quindi nello stesso passo di annulla.
const leave = EditorState.transactionFilter.of((tr) => {
  const pairs = tr.startState.field(emptyPairs, false);
  if (!pairs?.length || (!tr.docChanged && !tr.selection)) return tr;
  const selection = tr.selection ?? tr.startState.selection.map(tr.changes);
  const left = carried(pairs, tr).filter((pair) => !held(selection, pair));
  if (!left.length) return tr;
  const removal: TransactionSpec = {
    changes: left.map((pair) => ({ from: pair.from, to: pair.from + pair.open + pair.close })),
    sequential: true,
  };
  return [tr, removal];
});

/// La coppia vuota che sparisce: il campo e il filtro, per la Live.
export function emptyPairsExtension(): Extension {
  return [emptyPairs, leave];
}
