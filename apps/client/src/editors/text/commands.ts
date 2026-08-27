import { EditorSelection, type StateCommand } from "@codemirror/state";
import { moveLineDown, moveLineUp } from "@codemirror/commands";
import type { KeyBinding } from "@codemirror/view";

/// Duplica sotto la riga corrente (o il blocco di righe della selezione). Il
/// cursore scende sulla copia, così ripetere il comando accumula copie invece
/// di raddoppiare sempre l'originale.
export const duplicateLines: StateCommand = ({ state, dispatch }) => {
  const seen = new Set<string>();
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const first = state.doc.lineAt(range.from);
        const nextLine = range.to < state.doc.length ? state.doc.lineAt(range.to) : null;
        let toLine = nextLine?.number ?? first.number;
        if (!range.empty && nextLine && range.to === nextLine.from) toLine -= 1;
        const last = state.doc.line(toLine);
        const copy = `${state.lineBreak}${state.sliceDoc(first.from, last.to)}`;
        const key = `${first.number}:${last.number}`;
        if (seen.has(key)) {
          return {
            range: EditorSelection.range(range.anchor + copy.length, range.head + copy.length),
          };
        }
        seen.add(key);
        return {
          changes: { from: last.to, insert: copy },
          range: EditorSelection.range(range.anchor + copy.length, range.head + copy.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};

/// Accordi il cui significato è soltanto quello della manipolazione del testo.
/// L'ordine resta quello montato dall'adapter esistente.
export const textKeymap: KeyBinding[] = [
  { key: "Mod-d", run: duplicateLines },
  { key: "Alt-ArrowUp", run: moveLineUp },
  { key: "Alt-ArrowDown", run: moveLineDown },
];
