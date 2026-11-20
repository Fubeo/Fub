// Copiare e incollare le formule (T65): i delimitatori che se ne vanno, le
// formule di un assistente che diventano quelle di Fub, i dollari che non
// sono formule e restano, il MathML per i documenti.
import katex from "katex";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "../grammar";
import { parsed } from "../test-support";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { readOptions } from "../math";
import { notePaste, pastedFormulas, unwrapFormula, equationMathml } from "./paste";

const stateOf = (doc: string): EditorState => parsed(EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] }));

describe("una formula incollata entra senza i suoi delimitatori", () => {
  it.each([
    ["\\(x^2\\)", "x^2", false],
    ["\\[\\frac{a}{b}\\]", "\\frac{a}{b}", true],
    ["  \\[\n  E = mc^2\n\\]\n", "E = mc^2", true],
    ["$\\alpha$", "\\alpha", false],
    ["$$\\sum_{i=1}^n i$$", "\\sum_{i=1}^n i", true],
    ["```latex\n\\int_0^1 x\\,dx\n```", "\\int_0^1 x\\,dx", true],
    ["```math\n\\[a+b\\]\n```", "a+b", true],
    ["\\[a \\\\[2pt] b\\]", "a \\\\[2pt] b", true],
    ["$\\$5$", "\\$5", false],
  ])("%j → %j", (text, tex, display) => {
    expect(unwrapFormula(text)).toEqual({ tex, display });
  });

  it.each([
    ["costa $5 e $6"],
    ["$x$ e $y$"],
    ["\\(a\\) + \\(b\\)"],
    ["\\[a\\] e \\[b\\]"],
    ["$ x $"],
    ["$$"],
    ["\\(\\)"],
    ["x^2"],
    ["```python\nprint(1)\n```"],
    ["$a\\$"],
  ])("%j resta com'è", (text) => {
    expect(unwrapFormula(text)).toBeNull();
  });
});

describe("nella nota le formule di un assistente diventano quelle di Fub", () => {
  it("in riga e a blocco, il testo intorno com'era", () => {
    const text = "L'energia \\(E = mc^2\\) dice che:\n\n\\[\nE = mc^2\n\\]\n\ndove \\( c \\) è la luce.";
    expect(pastedFormulas(text)).toBe("L'energia $E = mc^2$ dice che:\n\n$$\nE = mc^2\n$$\n\ndove $c$ è la luce.");
  });

  it("il codice resta com'è, in riga e nei recinti", () => {
    const text = "Scrivi `\\(x\\)` così:\n```\n\\(x\\)\n```\ne \\(y\\).";
    expect(pastedFormulas(text)).toBe("Scrivi `\\(x\\)` così:\n```\n\\(x\\)\n```\ne $y$.");
  });

  it("i dollari che non sono formule non cambiano, e senza delimitatori non c'è niente da fare", () => {
    expect(pastedFormulas("costa $5 e $6")).toBeNull();
    expect(pastedFormulas("già $x$ e $$y$$")).toBeNull();
    expect(pastedFormulas("costa $5 e \\(x\\) vale")).toBe("costa $5 e $x$ vale");
  });

  it("una coppia non si cerca oltre una riga vuota, e una `\\` protetta non apre", () => {
    expect(pastedFormulas("\\(a\n\nb\\)")).toBeNull();
    expect(pastedFormulas("\\\\(x\\\\)")).toBeNull();
  });

  it("un dollaro di chiusura prima di una cifra diventerebbe testo: lì due dollari", () => {
    expect(pastedFormulas("\\(x\\)2")).toBe("$$x$$2");
  });

  it("dentro una formula della nota entra il TeX nudo; nel codice niente", () => {
    const doc = "Prima $a+$ dopo\n\n```\ncodice\n```\n";
    const state = stateOf(doc);
    expect(notePaste(state, doc.indexOf("+") + 1, "\\(b\\)")).toBe("b");
    expect(notePaste(state, doc.indexOf("dopo"), "\\(b\\)")).toBe("$b$");
    expect(notePaste(state, doc.indexOf("codice"), "\\(b\\)")).toBeNull();
    expect(notePaste(state, doc.indexOf("dopo"), "testo semplice")).toBeNull();
  });
});

describe("la copia come equazione", () => {
  it("il solo <math>, con lo spazio dei nomi, senza l'annotazione del TeX", () => {
    const made = equationMathml(katex.renderToString("\\frac{a}{b} + \\sqrt{x}", { ...readOptions(false), output: "mathml" }));
    expect(made).not.toBeNull();
    expect(made!.startsWith("<math xmlns=\"http://www.w3.org/1998/Math/MathML\"")).toBe(true);
    expect(made!.endsWith("</math>")).toBe(true);
    expect(made).toContain("<mfrac><mi>a</mi><mi>b</mi></mfrac>");
    expect(made).toContain("<msqrt>");
    expect(made).not.toContain("annotation");
    expect(made).not.toContain("semantics");
    expect(made).not.toContain("katex");
  });

  it("a blocco dice display=\"block\"; senza <math> non c'è niente", () => {
    expect(equationMathml(katex.renderToString("x", { ...readOptions(true), output: "mathml" }))).toContain("display=\"block\"");
    expect(equationMathml("<span>niente</span>")).toBeNull();
  });
});
