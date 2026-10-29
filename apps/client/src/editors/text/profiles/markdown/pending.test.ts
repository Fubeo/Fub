import { describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { liveGuide } from "../../live-reveal";
import { guideAt, leafTyping, openMarksInView, pendingMarks, spaceClosing } from "./pending";

// La guida (B1–B4, F5). `|` è il cursore.

const kinds = (line: string) => {
  const column = line.indexOf("|");
  return pendingMarks(line.replace("|", ""), column === -1 ? line.length : column).map((mark) => [mark.kind, mark.close]);
};

describe("il riconoscitore dei segni in sospeso", () => {
  it.each([
    ["una **importante|", [["strong", "**"]]],
    ["5 * 3|", []],
    ["costa $ 20|", []],
    ["costa $20|", []],
    ["E = mc^2|", [["sup", "^"]]],
    ["H~2|", [["sub", "~"]]],
    ["[testo](|", [["link", ")"]]],
    ["\\*testo|", []],
    ["`a*b`|", []],
    ["un *corsivo|", [["em", "*"]]],
    ["**chiuso** e *poi|", [["em", "*"]]],
    ["~~via|", [["strike", "~~"]]],
    ["la formula $x+|", [["math", "$"]]],
    ["un `codice|", [["code", "`"]]],
    ["snake_case_name|", []],
    ["mc^2 e altro|", []],
    ["**a *b|", [["strong", "**"], ["em", "*"]]],
    ["scrivo **|", [["strong", "**"]]],
    ["[link](https://x.it/a_b) *poi|", [["em", "*"]]],
    ["[[Nota_con*segni]] fine|", []],
  ])("%s", (line, expected) => {
    expect(kinds(line)).toEqual(expected);
  });

  it("un segno chiuso dopo il cursore non è in sospeso", () => {
    expect(kinds("**impor|tante**")).toEqual([]);
  });
});

function mk(spec: string, guide = true): EditorState {
  const head = spec.indexOf("|");
  const state = EditorState.create({
    doc: spec.replace("|", ""),
    selection: { anchor: head },
    extensions: [markdown({ base: markdownGrammar }), liveGuide.of(guide)],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

describe("lo stato della guida", () => {
  it("la chiusura in grigio a fine riga, la più interna per prima", () => {
    expect(guideAt(mk("**a *b|"))?.ghost).toBe("***");
    expect(guideAt(mk("E = mc^2|"))?.ghost).toBe("^");
  });

  it("in mezzo a una parola il testo è in sospeso, ma la chiusura non si vede", () => {
    const guide = guideAt(mk("**impor|tante"));
    expect(guide?.marks.map((mark) => mark.kind)).toEqual(["strong"]);
    expect(guide?.ghost).toBeNull();
  });

  it("tace nel codice, nel frontmatter, con una selezione e con la guida spenta", () => {
    expect(guideAt(mk("```\n**a|\n```"))).toBeNull();
    expect(guideAt(mk("---\ntitolo: *a|\n---\n"))).toBeNull();
    expect(guideAt(mk("**a|", false))).toBeNull();
    const selected = mk("**ab|").update({ selection: { anchor: 2, head: 4 } }).state;
    expect(guideAt(selected)).toBeNull();
  });

  it("un grassetto chiuso sulla riga dopo non è aperto", () => {
    expect(guideAt(mk("**prima|\nseconda**"))).toBeNull();
  });
});

describe("lo spazio chiude apice e pedice", () => {
  it("mc^2 e spazio dà mc^2^ e il cursore dopo lo spazio", () => {
    const state = mk("E = mc^2|");
    const next = state.update(spaceClosing(state)!).state;
    expect(next.doc.toString()).toBe("E = mc^2^ ");
    expect(next.selection.main.head).toBe(10);
  });

  it("col grassetto non fa niente, con la guida spenta nemmeno", () => {
    expect(spaceClosing(mk("**a|"))).toBeNull();
    expect(spaceClosing(mk("mc^2|", false))).toBeNull();
  });
});

describe("apice e pedice accanto ad altri segni", () => {
  /// Scrive `text` dov'è il cursore, con la regola se c'è: com'è il testo dopo.
  const type = (spec: string, text: string) => {
    const state = mk(spec);
    const rule = leafTyping(state, text);
    const next = rule ? state.update(rule).state : state.update(state.replaceSelection(text)).state;
    const head = next.selection.main.head;
    const doc = next.doc.toString();
    return doc.slice(0, head) + "|" + doc.slice(head);
  };

  it("il testo di un apice è letterale: dentro non si apre niente", () => {
    expect(kinds("x^2~3|")).toEqual([["sup", "^"]]);
    expect(kinds("x^a*b|")).toEqual([["sup", "^"]]);
    expect(kinds("x^2^~3|")).toEqual([["sub", "~"]]);
  });

  it("un pedice scritto dentro un apice in sospeso prima lo chiude, e viceversa", () => {
    expect(type("x^2|", "~")).toBe("x^2^~|");
    expect(type("H~2|", "^")).toBe("H~2~^|");
    expect(type("x^2|", "*")).toBe("x^2^*|");
    // Il proprio segno chiude, come sempre.
    expect(type("x^2|", "^")).toBe("x^2^|");
  });

  it("subito dopo il segno d'apertura, l'altro segno lo cambia", () => {
    expect(type("x^|", "~")).toBe("x~|");
    expect(type("x~|", "^")).toBe("x^|");
    // `~~` resta l'inizio di un barrato, e una chiusura resta una chiusura.
    expect(type("x~|", "~")).toBe("x~~|");
    expect(type("x^2^|", "~")).toBe("x^2^~|");
  });

  it("con la guida spenta i segni si scrivono come sono", () => {
    expect(leafTyping(mk("x^2|", false), "~")).toBeNull();
    expect(leafTyping(mk("x^|", false), "~")).toBeNull();
  });
});

describe("l'ondulato dei segni rimasti aperti", () => {
  it("sulle righe in vista fuori da quella del cursore", () => {
    const state = mk("una **importante\n\naltro|");
    expect(openMarksInView(state, [{ from: 0, to: state.doc.length }]).map((open) => open.sign)).toEqual(["**"]);
  });

  it("il riconoscitore non gira sulle righe fuori dalla vista (F5)", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `riga ${index} *aperta`);
    const state = mk(`${lines.join("\n")}|`);
    const scan = vi.fn(pendingMarks);
    const firstTen = state.doc.line(10).to;
    openMarksInView(state, [{ from: 0, to: firstTen }], scan);
    expect(scan).toHaveBeenCalledTimes(10);
  });
});
