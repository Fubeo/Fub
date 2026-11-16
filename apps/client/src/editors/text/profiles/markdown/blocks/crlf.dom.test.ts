// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { markdownGrammar } from "../grammar";
import { blockAnchor } from "./anchor";
import { dropAsColumn, intoColumns } from "./columns";
import { addBelow } from "./handles";
import { blockModel } from "./model";
import { moveBlockBy, moveSiblings, nestRun, outdentRun } from "./move";
import { subpageLink } from "./page";
import { duplicateRun } from "./selection";
import { transformTo } from "./transform";

// I gesti dei blocchi in una nota tutta CRLF (#390). L'editor la apre col
// separatore `\r\n` (engine.ts), e CodeMirror divide il testo inserito solo
// lì: ogni a capo che un gesto scrive deve diventare un a capo vero della
// nota, e il file salvato (`sliceDoc()`) restare tutto CRLF. Ogni caso gira
// anche in LF, dove il risultato deve essere quello di sempre.

const CRLF = "\r\n";

function stateOf(doc: string, cursor = 0, separator: string | null = null): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      ...(separator === null ? [] : [EditorState.lineSeparator.of(separator)]),
      markdown({ base: markdownGrammar }),
      blockModel,
      history(),
    ],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

const crlf = (text: string) => text.replace(/\n/g, CRLF);
const blocksOf = (state: EditorState) => state.field(blockModel).blocks;
const indexAt = (state: EditorState, text: string) =>
  blocksOf(state).findIndex((block) => state.doc.sliceString(block.from, block.to).startsWith(text));

/// Il file che si salverebbe: senza `\n` nudi, se la nota è CRLF.
function saved(state: EditorState): string {
  const text = state.sliceDoc();
  if (state.lineBreak === CRLF) expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  return text;
}

/// Il gesto `make` (sullo stato di partenza) in LF e in CRLF: in LF il
/// risultato è `expected`, in CRLF lo stesso con gli a capo CRLF.
function both(doc: string, cursor: string | null, make: (state: EditorState) => TransactionSpec | null, expected: string): EditorState[] {
  return [null, CRLF].map((separator) => {
    const source = separator === null ? doc : crlf(doc);
    const state = stateOf(source, cursor === null ? 0 : doc.indexOf(cursor), separator);
    const spec = make(state);
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;
    expect(saved(next)).toBe(separator === null ? expected : crlf(expected));
    return next;
  });
}

function command(state: EditorState, run: StateCommand): TransactionSpec {
  const specs: TransactionSpec[] = [];
  expect(run({ state, dispatch: (tr) => { specs.push({ changes: tr.changes, selection: tr.selection }); } })).toBe(true);
  // Una transazione sola: un passo d'annullamento per gesto.
  expect(specs).toHaveLength(1);
  return specs[0]!;
}

describe("i blocchi in una nota CRLF", () => {
  it("Mod+Maiusc+↑/↓ scambia i blocchi, il cursore li segue e un annulla torna indietro", () => {
    const doc = "Uno\nriga due\n\nDue\n\nTre";
    both(doc, "Uno", (state) => command(state, moveBlockBy(1)), "Due\n\nUno\nriga due\n\nTre");
    both(doc, "Tre", (state) => command(state, moveBlockBy(-1)), "Uno\nriga due\n\nTre\n\nDue");
    const state = stateOf(crlf(doc), doc.indexOf("ue"), CRLF);
    let next = state;
    moveBlockBy(-1)({ state, dispatch: (tr) => { next = tr.state; } });
    expect(next.sliceDoc(next.selection.main.head, next.selection.main.head + 2)).toBe("ue");
    let back = next;
    undo({ state: next, dispatch: (tr) => { back = tr.state; } });
    expect(back.sliceDoc()).toBe(crlf(doc));
  });

  it("il trascinamento e «In fondo» spostano i blocchi, con le righe vuote giuste", () => {
    const doc = "- a\n- b\n\nTesto\ncontinua\n\nUltimo";
    both(doc, null, (state) => {
      const i = indexAt(state, "Testo");
      return moveSiblings(state, blocksOf(state), i, i, indexAt(state, "- a"));
    }, "Testo\ncontinua\n\n- a\n- b\n\nUltimo");
    // «In fondo»: davanti a nessuno.
    const [, next] = both(doc, null, (state) => {
      const i = indexAt(state, "Testo");
      return moveSiblings(state, blocksOf(state), i, i, -1);
    }, "- a\n- b\n\nUltimo\n\nTesto\ncontinua");
    // Dove dice di aver messo i blocchi c'è davvero il blocco spostato.
    const state = stateOf(crlf(doc), 0, CRLF);
    const i = indexAt(state, "Testo");
    const spec = moveSiblings(state, blocksOf(state), i, i, -1)!;
    expect(next!.doc.sliceString(spec.moved.from, spec.moved.to)).toBe("Testo\ncontinua");
  });

  it("annidare e portare fuori col gesto di lato", () => {
    const [, nested] = both("- uno\n- due\n  altra riga\n- tre", null, (state) => {
      const due = indexAt(state, "- due");
      return nestRun(state, blocksOf(state), { first: due, last: due }, indexAt(state, "- uno"));
    }, "- uno\n  - due\n    altra riga\n- tre");
    const state = stateOf(crlf("- uno\n- due\n  altra riga\n- tre"), 0, CRLF);
    const due = indexAt(state, "- due");
    const spec = nestRun(state, blocksOf(state), { first: due, last: due }, indexAt(state, "- uno"))!;
    expect(nested!.doc.sliceString(spec.moved.from, spec.moved.to)).toBe("  - due\n    altra riga");
    both("- uno\n  - a\n  - b\n- due", null, (state) => {
      const a = indexAt(state, "  - a");
      return outdentRun(state, blocksOf(state), { first: a, last: a });
    }, "- uno\n  - b\n- a\n- due");
    // Verso una voce più in basso: il testo fra i due posti si riscrive anche lui.
    both("- uno\n- due\n- tre", null, (state) => {
      const uno = indexAt(state, "- uno");
      return nestRun(state, blocksOf(state), { first: uno, last: uno }, indexAt(state, "- tre"));
    }, "- due\n- tre\n  - uno");
  });

  it("duplicare seleziona la copia", () => {
    for (const next of both("Uno\ndue\n\nTre", null, (state) => duplicateRun(state, blocksOf(state), { first: 0, last: 0 }), "Uno\ndue\n\nUno\ndue\n\nTre")) {
      expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe("Uno\ndue");
    }
    both("- a\n- b", null, (state) => {
      const b = indexAt(state, "- b");
      return duplicateRun(state, blocksOf(state), { first: b, last: b });
    }, "- a\n- b\n- b");
  });

  it("le colonne: «In colonne» e il blocco lasciato sul bordo", () => {
    both("Uno\n\nDue\n\nTre", null, (state) => intoColumns(state, blocksOf(state), [indexAt(state, "Uno"), indexAt(state, "Due")]),
      "> [!columns]\n> > [!column]\n> > Uno\n>\n> > [!column]\n> > Due\n\nTre");
    const columns = "> [!columns]\n> > [!column]\n> > A\n>\n> > [!column]\n> > B\n\nC";
    both(columns, null, (state) => dropAsColumn(state, blocksOf(state), { first: indexAt(state, "C"), last: indexAt(state, "C") }, 0, "left"),
      "> [!columns]\n> > [!column]\n> > C\n>\n> > [!column]\n> > A\n>\n> > [!column]\n> > B");
    both(columns, null, (state) => dropAsColumn(state, blocksOf(state), { first: indexAt(state, "C"), last: indexAt(state, "C") }, 0, "right"),
      "> [!columns]\n> > [!column]\n> > A\n>\n> > [!column]\n> > B\n>\n> > [!column]\n> > C");
  });

  it("«Trasforma in» scrive le righe nuove come righe", () => {
    both("Testo\ncontinua\n\nDopo", "Testo", (state) => command(state, transformTo("code")), "```\nTesto\ncontinua\n```\n\nDopo");
    both("- [ ] fare\n  - sotto", "fare", (state) => command(state, transformTo("paragraph")), "fare\n\n- sotto");
  });

  it("il link al blocco, «+» e la sottopagina aggiungono righe vere", () => {
    both("```\nx\n```\n\nDopo", null, (state) => ({ changes: blockAnchor(state, blocksOf(state), 0, () => 0.5).changes! }), "```\nx\n```\n\n^i00000\n\nDopo");
    for (const next of both("- a\n\nTesto", null, (state) => {
      const { changes, cursor } = addBelow(state, blocksOf(state), indexAt(state, "- a"));
      return { changes, selection: { anchor: cursor } };
    }, "- a\n- \n\nTesto")) {
      expect(next.doc.lineAt(next.selection.main.head).text).toBe("- ");
      expect(next.selection.main.head).toBe(next.doc.lineAt(next.selection.main.head).to);
    }
    for (const next of both("Testo", "Testo", (state) => {
      const at = subpageLink(state, "Nuova");
      return { changes: { from: at.from, insert: at.insert }, selection: { anchor: at.cursor } };
    }, "Testo\n\n[[Nuova]]")) {
      expect(next.selection.main.head).toBe(next.doc.length);
    }
  });
});
