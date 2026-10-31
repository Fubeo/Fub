// La rinumerazione degli elenchi (D4). Invio la fa già (`smartListEnter`);
// qui la fanno una cancellazione e uno spostamento di righe: dopo, le voci
// numerate sorelle che seguono riprendono la sequenza dal numero d'inizio
// della tratta, nella stessa transazione, e cambiano soltanto le cifre che
// cambiano. Il delimitatore (`.` o `)`) resta quello di ogni voce.
import { EditorState, type ChangeSpec, type Text, type Transaction } from "@codemirror/state";
import { listItem, type ListEntry } from "../../../../rules/syntax";
import { smartLists } from "../../smart-lists";

/// Le voci della tratta numerata a cui appartiene la riga `n`: dalla prima
/// sorella in su all'ultima in giù, con le stesse regole di Invio.
function runOf(doc: Text, n: number): { line: number; item: ListEntry }[] | null {
  const here = listItem(doc.line(n).text);
  if (!here || here.kind !== "ordered") return null;
  const sibling = (m: number): ListEntry | "skip" | null => {
    const text = doc.line(m).text;
    const entry = listItem(text);
    const body = text.slice(here.quote.length);
    if (text.startsWith(here.quote) && (!entry || entry.kind === "quote")) {
      if (body.trim() === "" || /^\s*/.exec(body)![0].length > here.indent.length) return "skip";
    }
    if (!entry || entry.quote !== here.quote) return null;
    if (entry.indent.length > here.indent.length) return "skip";
    if (entry.indent.length < here.indent.length || entry.kind !== "ordered") return null;
    return entry;
  };
  let first = n;
  for (let m = n - 1; m >= 1; m--) {
    const found = sibling(m);
    if (found === null) break;
    if (found !== "skip") first = m;
  }
  const run: { line: number; item: ListEntry }[] = [];
  for (let m = first; m <= doc.lines; m++) {
    const found = sibling(m);
    if (found === null) break;
    if (found !== "skip") run.push({ line: m, item: found });
  }
  return run;
}

/// Le modifiche che rinumerano le tratte che toccano le righe date. `start`
/// è il numero d'inizio che la tratta aveva prima della modifica, se c'era:
/// togliere la prima voce non cambia da dove si conta.
export function renumberChanges(doc: Text, lines: Iterable<{ line: number; start?: number }>): ChangeSpec[] {
  const out: ChangeSpec[] = [];
  const done = new Set<number>();
  for (const { line: n, start } of lines) {
    for (const m of [n, n + 1]) {
      if (m < 1 || m > doc.lines || done.has(m)) continue;
      const run = runOf(doc, m);
      if (!run?.length) continue;
      let expected = start ?? run[0]!.item.number!;
      for (const { line, item } of run) {
        done.add(line);
        if (item.number !== expected) {
          const row = doc.line(line);
          const start = item.quote.length + item.indent.length;
          out.push({ from: row.from + start, to: row.from + row.text.indexOf(item.bullet, start), insert: String(expected) });
        }
        expected++;
      }
    }
  }
  return out;
}

const RENUMBERED = ["delete", "move", "input.drop", "input.paste"];

/// Dopo una cancellazione o uno spostamento di righe, le voci che seguono si
/// rinumerano nella stessa transazione.
export const renumberLists = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || !RENUMBERED.some((event) => tr.isUserEvent(event)) || !tr.startState.facet(smartLists)) return tr;
  const doc = tr.newDoc;
  const old = tr.startState.doc;
  const lines: { line: number; start?: number }[] = [];
  tr.changes.iterChangedRanges((fromA, _ta, fromB, toB) => {
    const start = runOf(old, old.lineAt(fromA).number)?.[0]?.item.number ?? undefined;
    for (let n = doc.lineAt(fromB).number; n <= doc.lineAt(toB).number; n++) lines.push({ line: n, start });
  });
  const changes = renumberChanges(doc, lines);
  return changes.length ? [tr, { changes, sequential: true }] : tr;
});
