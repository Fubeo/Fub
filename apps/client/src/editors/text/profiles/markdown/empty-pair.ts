// La coppia vuota di un gesto di formato, come in Word: Mod-b senza niente da
// avvolgere apre `**|**`, e se il cursore se ne va senza scrivere la coppia
// sparisce nella stessa transazione. Soltanto in Live e in Blocchi: in
// Sorgente i segni si vedono, e chi li lascia li vuole.
import { type ChangeSet, EditorState, type Extension, Prec, StateEffect, StateField, type Transaction, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import type { CursorElement } from "./cursor-elements";
import { brokenTwins, elementsTouching, type FormatElement } from "./format-toggle";

const JOINED: readonly FormatElement[] = ["strong", "em", "strike", "underline", "sup", "sub", "highlight"];

/// Una coppia vuota aperta da un gesto: da `from`, `open` segni e poi `close`.
export interface EmptyPair {
  readonly from: number;
  readonly open: number;
  readonly close: number;
  /// Gli elementi che la coppia apre: la barra li dice premuti.
  readonly elements?: readonly CursorElement[];
}

/// La coppia appena aperta, posata da chi avvolge (`toggleWrap`).
export const openedPair = StateEffect.define<EmptyPair>({
  map: (pair, changes) => ({ ...pair, from: changes.mapPos(pair.from, -1) }),
});

/// Le coppie di prima portate attraverso `tr`, più quelle che `tr` apre: le
/// sole che restano vuote nel documento nuovo.
function carried(pairs: readonly EmptyPair[], tr: Transaction): EmptyPair[] {
  const kept: EmptyPair[] = [];
  const opened = tr.effects.filter((effect) => effect.is(openedPair)).map((effect) => effect.value as EmptyPair);
  for (const pair of pairs) {
    const from = tr.changes.mapPos(pair.from, -1);
    const to = tr.changes.mapPos(pair.from + pair.open + pair.close, 1);
    // Cresciuta soltanto della coppia aperta in lei (`==|==` → `==*|*==`):
    // resta, e qui sotto le due diventano una.
    const inner = opened.some((next) => from < next.from && next.from + next.open + next.close < to
      && to - from === pair.open + pair.close + next.open + next.close);
    if (to - from === pair.open + pair.close) kept.push({ ...pair, from });
    else if (inner) kept.push({ ...pair, from, close: to - from - pair.open });
  }
  // Un gesto che cambia una coppia (`^|^` → `~|~`) o la avvolge (`**^|^**`)
  // la riapre: la nuova prende il posto di quelle che tocca. Una coppia
  // aperta dentro un'altra ancora vuota (`<u>~|~</u>`) diventa una con lei.
  for (const effect of tr.effects) {
    if (!effect.is(openedPair)) continue;
    let next = effect.value;
    const end = (pair: EmptyPair) => pair.from + pair.open + pair.close;
    for (let index = kept.length - 1; index >= 0; index--) {
      const pair = kept[index]!;
      if (!(pair.from < end(next) && next.from < end(pair))) continue;
      kept.splice(index, 1);
      if (pair.from <= next.from && end(next) <= end(pair) && (pair.from < next.from || end(next) < end(pair))) {
        const open = next.from + next.open - pair.from;
        next = { from: pair.from, open, close: end(pair) - pair.from - open, elements: [...(pair.elements ?? []), ...(next.elements ?? [])] };
      }
    }
    kept.push(next);
  }
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

/// Le modifiche che tolgono le coppie `pairs` da `state`, in fila: senza di
/// loro gli elementi attorno devono ancora leggersi. `moveSpaces` porta gli
/// spazi scritti prima di una coppia oltre i segni che chiudono.
function removing(state: EditorState, pairs: readonly EmptyPair[], moveSpaces: boolean): ChangeSet[] {
  const doc = state.doc;
  const changes = pairs.flatMap((pair) => {
    let start = pair.from;
    let end = pair.from + pair.open + pair.close;
    // Un elemento diviso per far posto alla coppia (`**a**|**b**`) torna uno:
    // senza la coppia, i segni di chi chiude e di chi riapre si toccherebbero.
    for (let joined = true; joined;) {
      joined = false;
      for (const element of JOINED) {
        const before = start === 0 ? undefined : elementsTouching(state, start - 1, start, element).find((marks) => marks.to === start);
        const after = end === doc.length ? undefined : elementsTouching(state, end, end + 1, element).find((marks) => marks.from === end);
        if (!before || !after || doc.sliceString(before.closeFrom, before.to) !== doc.sliceString(after.from, after.openTo)) continue;
        start = before.closeFrom;
        end = after.openTo;
        joined = true;
      }
    }
    if (start !== pair.from) return [{ from: start, to: end, insert: "" }];
    const out = [{ from: pair.from, to: end, insert: "" }];
    // Gli spazi scritti nella coppia stanno prima di lei: se dopo vengono i
    // segni di chiusura di un elemento (`**a |**`), senza la coppia quegli
    // spazi lo romperebbero, e vanno dopo i segni.
    const line = doc.lineAt(pair.from);
    const spaces = /[ \t]+$/.exec(doc.sliceString(line.from, pair.from))?.[0].length ?? 0;
    // Chiudono se dopo non viene una lettera: `^amma` apre.
    const signs = /^([*_~^=]+)(?:$|[^\p{L}\p{N}*_~^=])/u.exec(doc.sliceString(end, line.to))?.[1]!.length ?? 0;
    if (spaces && signs && moveSpaces) out.push({ from: pair.from - spaces, to: pair.from, insert: "" }, { from: end + signs, to: end + signs, insert: doc.sliceString(pair.from - spaces, pair.from) });
    return out;
  });
  // E se la coppia se ne va da sola, i vicini che spegne passano ai tag.
  const removal = state.changes(changes);
  const tags = brokenTwins(state, removal);
  return tags.length ? [removal, state.changes(tags).map(removal)] : [removal];
}

/// Il cursore lascia una coppia vuota: la coppia se ne va con lui, nella
/// stessa transazione e quindi nello stesso passo di annulla.
const leave = EditorState.transactionFilter.of((tr) => {
  const pairs = tr.startState.field(emptyPairs, false);
  if (!pairs?.length || (!tr.docChanged && !tr.selection)) return tr;
  const selection = tr.selection ?? tr.startState.selection.map(tr.changes);
  const left = carried(pairs, tr).filter((pair) => !held(selection, pair));
  if (!left.length) return tr;
  return [tr, ...removing(tr.state, left, true).map((changes) => ({ changes, sequential: true }))];
});

/// Backspace e Canc in una coppia vuota: la coppia, che non si vede, se ne va,
/// e il tasto fa poi quello che farebbe senza.
const dropHeld = (view: EditorView): boolean => {
  const pairs = view.state.field(emptyPairs, false) ?? [];
  const held = pairs.filter((pair) => view.state.selection.ranges.some((range) => range.empty && range.head === pair.from + pair.open));
  if (!held.length) return false;
  const [removal, tags] = removing(view.state, held, false);
  view.dispatch({ changes: removal! }, ...(tags ? [{ changes: tags, sequential: true }] : []));
  return false;
};

/// Le coppie vuote aperte, se lo stato le porta.
export function emptyPairsOf(state: EditorState): readonly EmptyPair[] {
  return state.field(emptyPairs, false) ?? [];
}

/// La coppia vuota in cui sta l'unico cursore, se c'è.
export function heldPairAt(state: EditorState): EmptyPair | null {
  const head = state.selection.main;
  if (state.selection.ranges.length > 1 || !head.empty) return null;
  return emptyPairsOf(state).find((candidate) => candidate.from + candidate.open === head.head) ?? null;
}

/// Uno spazio scritto in una coppia vuota: dentro farebbe `** **`, che non
/// è grassetto e lascia i segni a vista. Va prima della coppia, che resta
/// aperta per la lettera dopo, come in Word. `before` sposta il punto oltre
/// i segni d'apertura che lo precedono.
export function spaceBeforePair(state: EditorState, before: (pos: number) => number = (pos) => pos): TransactionSpec | null {
  const head = state.selection.main;
  const pair = heldPairAt(state);
  if (!pair) return null;
  return {
    changes: { from: before(pair.from), insert: " " },
    selection: { anchor: head.head + 1 },
    effects: openedPair.of({ ...pair, from: pair.from + 1 }),
    userEvent: "input.type",
    scrollIntoView: true,
  };
}

/// Gli elementi delle coppie vuote che tengono il cursore principale.
export function pairElementsAt(state: EditorState): ReadonlySet<CursorElement> {
  const head = state.selection.main;
  const found = new Set<CursorElement>();
  if (!head.empty) return found;
  for (const pair of emptyPairsOf(state)) {
    if (head.head === pair.from + pair.open) for (const element of pair.elements ?? []) found.add(element);
  }
  return found;
}

const hiddenSign = Decoration.replace({});

/// I segni di una coppia vuota non si vedono: come in Word, il formato
/// aspetta la prima lettera, e la barra lo dice premuto.
const hidePairs = EditorView.decorations.compute([emptyPairs], (state) =>
  Decoration.set(state.field(emptyPairs).flatMap((pair) => {
    const middle = pair.from + pair.open;
    return [hiddenSign.range(pair.from, middle), hiddenSign.range(middle, middle + pair.close)];
  }), true));

/// La coppia vuota che sparisce: il campo e il filtro, per la Live.
export function emptyPairsExtension(): Extension {
  return [emptyPairs, leave, hidePairs, Prec.highest(keymap.of([{ key: "Backspace", run: dropHeld }, { key: "Delete", run: dropHeld }]))];
}
