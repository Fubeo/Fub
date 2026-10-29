import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownGrammar } from "../grammar";
import { blockModel } from "./model";
import { targetOf, transformTo, unwrap, type TransformTarget } from "./transform";

// «Trasforma in» (H6): ogni coppia (da, a) tiene il contenuto, su blocchi di
// una e di più righe.

function stateOf(doc: string, cursor = 0): EditorState {
  const state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownGrammar }), blockModel] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function run(state: EditorState, target: TransformTarget): EditorState {
  let next = state;
  transformTo(target)({ state, dispatch: (tr) => { next = tr.state; } });
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next.update({}).state;
}

const SOURCES: Record<string, string> = {
  paragraph: "Una riga\ne la seconda",
  heading: "## Un titolo",
  bullet: "- una voce\n  che continua",
  ordered: "3. terza voce",
  task: "- [ ] da fare",
  quote: "> citata\n> due righe",
  callout: "> [!tip] Il titolo\n> il corpo",
  code: "```js\nconst a = 1;\nconst b = 2;\n```",
  details: "<details>\n<summary>Apri</summary>\n\nIl contenuto\n\n</details>",
};

const TARGETS: TransformTarget[] = [
  "paragraph", "heading1", "heading2", "heading3", "bullet", "ordered", "task", "quote", "callout", "code", "details",
];

/// Le parole del contenuto, in ordine: un titolo unisce le righe, e i figli
/// di un ripiegabile disfatto restano blocchi sotto.
const contentOf = (state: EditorState) => {
  const { blocks } = state.field(blockModel);
  const words: string[] = [];
  blocks.forEach((block, index) => {
    if (block.depth !== 0) return;
    const parts = unwrap(state, blocks, index)!;
    for (const line of [...parts.own, ...parts.children]) words.push(...line.split(/\s+/).filter((word) => word !== ""));
  });
  return words;
};

describe("ogni coppia", () => {
  for (const [kind, source] of Object.entries(SOURCES)) {
    for (const target of TARGETS) {
      it(`${kind} → ${target}`, () => {
        const before = stateOf(source);
        const words = contentOf(before);
        const after = run(before, target);
        const { blocks } = after.field(blockModel);
        expect(targetOf(blocks[0]!)).toBe(target);
        // Un blocco solo, tranne i figli del ripiegabile che un titolo o un
        // paragrafo non possono tenere.
        const keepsChildren = !(kind === "details" && (target === "paragraph" || target.startsWith("heading")));
        if (keepsChildren) expect(blocks.filter((block) => block.depth === 0)).toHaveLength(1);
        expect(contentOf(after)).toEqual(words);
      });
    }
  }
});

describe("il resto", () => {
  it("un file con CRLF si trasforma come uno con LF", () => {
    const after = run(stateOf("Uno\r\ndue\r\n\r\nTre"), "bullet");
    expect(after.doc.toString()).toBe("- Uno\n  due\n\nTre");
  });

  it("la voce con le sottovoci le porta con sé, col rientro nuovo", () => {
    const after = run(stateOf("- padre\n  - figlio\n- altro"), "ordered");
    expect(after.doc.toString()).toBe("1. padre\n   - figlio\n- altro");
  });

  it("una voce numerata nuova continua il numero del fratello sopra", () => {
    const doc = "1. uno\n2. due\n- tre";
    const after = run(stateOf(doc, doc.indexOf("tre")), "ordered");
    expect(after.doc.toString()).toBe("1. uno\n2. due\n3. tre");
  });

  it("il cursore resta sullo stesso carattere del contenuto", () => {
    const doc = "Testo qui";
    const after = run(stateOf(doc, 6), "heading2");
    expect(after.doc.toString()).toBe("## Testo qui");
    expect(after.sliceDoc(after.selection.main.head)).toBe("qui");
  });

  it("due cursori nello stesso blocco lo trasformano una volta", () => {
    const state = EditorState.create({
      doc: "Una frase lunga",
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(8)]),
      extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: markdownGrammar }), blockModel],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    expect(run(state, "bullet").doc.toString()).toBe("- Una frase lunga");
  });

  it("una tabella non si trasforma, e il comando lo dice", () => {
    const state = stateOf("| a |\n| - |\n| 1 |");
    expect(transformTo("heading1")({ state, dispatch: () => {} })).toBe(false);
  });

  it("un passo di annulla", () => {
    const state = stateOf("Testo");
    let tr: Parameters<Parameters<ReturnType<typeof transformTo>>[0]["dispatch"]>[0] | null = null;
    transformTo("quote")({ state, dispatch: (t) => { tr = t; } });
    expect(tr!.isUserEvent("input")).toBe(true);
    expect(tr!.changes.length).toBe(5);
  });
});
