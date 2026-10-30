// Le letture del menu del tasto destro: che cosa sta in un punto della nota.
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { codeBlockAt, headingText, listItemAt, sectionAt, tagAt } from "./menu";

const stateOf = (doc: string): EditorState => {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
};

describe("il punto sotto il tasto destro", () => {
  it("una voce di lista sa se può rientrare e uscire", () => {
    const state = stateOf("- uno\n  - due\n- tre\n1. quattro\n- [ ] cinque\n");
    expect(listItemAt(state, 2)).toEqual({ kind: "bullet", indent: false, dedent: false });
    expect(listItemAt(state, 10)).toEqual({ kind: "bullet", indent: false, dedent: true });
    expect(listItemAt(state, 16)).toEqual({ kind: "bullet", indent: true, dedent: false });
    expect(listItemAt(state, 22)?.kind).toBe("ordered");
    expect(listItemAt(state, 34)?.kind).toBe("task");
    expect(listItemAt(stateOf("testo\n"), 2)).toBeNull();
  });

  it("la sezione di un titolo arriva al titolo seguente dello stesso livello, fuori dal codice", () => {
    const doc = "## Uno\ntesto\n```\n## non conta\n```\n### Sotto\nancora\n\n## Due\n";
    const state = stateOf(doc);
    const section = sectionAt(state, 2)!;
    expect(doc.slice(section.from, section.to)).toBe("## Uno\ntesto\n```\n## non conta\n```\n### Sotto\nancora");
    expect(headingText(stateOf("## Formula ##\n"), 1)).toBe("Formula");
    expect(sectionAt(state, 8)).toBeNull();
  });

  it("un tag si legge fuori dal codice, e il blocco di codice dice dove sta il linguaggio", () => {
    const state = stateOf("Vedi #esame qui\n```py\n#non\n```\n");
    expect(tagAt(state, 7)).toEqual({ name: "esame", from: 5, to: 11 });
    expect(tagAt(state, 2)).toBeNull();
    expect(tagAt(state, 24)).toBeNull();
    const code = codeBlockAt(state, 24)!;
    expect(code.language).toBe("py");
    expect(state.sliceDoc(code.info.from, code.info.to)).toBe("py");
    const bare = stateOf("```\nx\n```\n");
    const empty = codeBlockAt(bare, 4)!;
    expect(empty.info).toEqual({ from: 3, to: 3 });
  });
});
