import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Transaction } from "@codemirror/state";
import { markdownGrammar } from "./grammar";
import { closeFenceEnter, taskShortcut } from "./commands";

// Il recinto che si chiude da solo (B7) e `[]` a inizio riga (B8). `|` è il
// cursore.

function mk(spec: string): EditorState {
  const state = EditorState.create({
    doc: spec.replace("|", ""),
    selection: { anchor: spec.indexOf("|") },
    extensions: markdown({ base: markdownGrammar }),
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

function enter(spec: string): string | null {
  let tr: Transaction | null = null;
  const state = mk(spec);
  if (!closeFenceEnter({ state, dispatch: (t) => { tr = t; } })) return null;
  const next = (tr as unknown as Transaction).state;
  const doc = next.doc.toString();
  const head = next.selection.main.head;
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

describe("Invio su un recinto senza chiusura", () => {
  it("scrive la chiusura e mette il cursore in mezzo", () => {
    expect(enter("testo\n```js|")).toBe("testo\n```js\n|\n```");
    expect(enter("~~~~|")).toBe("~~~~\n|\n~~~~");
  });

  it("anche con un recinto più avanti, che appartiene al suo blocco", () => {
    expect(enter("```py|\n\naltro\n\n```\nvecchio\n```")).toBe("```py\n|\n```\n\naltro\n\n```\nvecchio\n```");
  });

  it("non su un recinto che ha già la sua chiusura, né su quella", () => {
    expect(enter("```js|\ncodice\n```")).toBeNull();
    expect(enter("```js\ncodice\n```|")).toBeNull();
    expect(enter("```js| e altro")).toBeNull();
    expect(enter("``` a`b|")).toBeNull();
  });
});

describe("[] a inizio riga", () => {
  const typeSpace = (spec: string) => {
    const state = mk(spec);
    const at = state.selection.main.head;
    return taskShortcut(state, at, at, " ")?.insert ?? null;
  };

  it("diventa una voce da fare, [x] una voce fatta", () => {
    expect(typeSpace("[]|")).toBe("- [ ] ");
    expect(typeSpace("[x]|")).toBe("- [x] ");
    expect(typeSpace("  [|]")).toBe("  - [ ] ");
  });

  it("in mezzo alla riga e nel codice no", () => {
    expect(typeSpace("testo []|")).toBeNull();
    expect(typeSpace("```\n[]|\n```")).toBeNull();
    expect(typeSpace("[]| dopo")).toBeNull();
  });
});
