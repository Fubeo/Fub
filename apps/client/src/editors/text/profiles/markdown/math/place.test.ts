// «Da riga a blocco» e ritorno (T65): la formula cambia posto, il resto della
// nota resta byte per byte.
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "../grammar";
import { parsed } from "../test-support";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { formulaAt } from "../menu";
import { toBlock, toInline } from "./place";

const stateOf = (doc: string): EditorState => parsed(EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] }));

function apply(doc: string, at: string, display: boolean): string | null {
  const state = stateOf(doc);
  const formula = formulaAt(state, doc.indexOf(at));
  if (!formula) throw new Error(`nessuna formula in ${at}`);
  const change = display ? toBlock(state, formula) : toInline(formula);
  if (!change) return null;
  const next = state.update({ changes: change.changes }).state.doc.toString();
  expect(next.slice(change.at).startsWith(display ? "$$" : "$")).toBe(true);
  return next;
}

describe("il posto della formula", () => {
  it("una formula da sola sulla sua riga diventa un blocco", () => {
    expect(apply("Prima\n\n$x^2$\n\nDopo\n", "x^2", true)).toBe("Prima\n\n$$\nx^2\n$$\n\nDopo\n");
  });

  it("in mezzo a una frase la divide: la frase prima, il blocco, la frase dopo", () => {
    expect(apply("Sia $a=b$ come detto.\n", "a=b", true)).toBe("Sia\n\n$$\na=b\n$$\n\ncome detto.\n");
    expect(apply("Alla fine $y$\n", "$y", true)).toBe("Alla fine\n\n$$\ny\n$$\n");
  });

  it("le altre formule della frase restano com'erano", () => {
    expect(apply("Con $a$ e $b$ insieme\n", "$b", true)).toBe("Con $a$ e\n\n$$\nb\n$$\n\ninsieme\n");
  });

  it("un blocco torna in riga, gli a capo diventano spazi", () => {
    expect(apply("Testo\n\n$$\n\\begin{aligned}\na &= b \\\\\n&= c\n\\end{aligned}\n$$\n\nAltro\n", "aligned", false))
      .toBe("Testo\n\n$\\begin{aligned} a &= b \\\\ &= c \\end{aligned}$\n\nAltro\n");
  });

  it("andata e ritorno ridanno la formula", () => {
    const block = apply("$\\frac{1}{2}$\n", "frac", true)!;
    expect(block).toBe("$$\n\\frac{1}{2}\n$$\n");
    expect(apply(block, "frac", false)).toBe("$\\frac{1}{2}$\n");
  });

  it("in un elenco, in una citazione, in una tabella il posto non cambia", () => {
    for (const [doc, at] of [["- voce $x$\n", "x$"], ["> cit $x$\n", "x$"], ["| a | $x$ |\n|---|---|\n| 1 | 2 |\n", "x$"]] as const) {
      const state = stateOf(doc);
      const formula = formulaAt(state, doc.indexOf(at));
      expect(formula?.plain).toBe(false);
      expect(toBlock(state, formula!)).toBeNull();
    }
  });

  it("un blocco con un commento del TeX non va su una riga sola", () => {
    expect(apply("$$\na % nota\n\\cdot b\n$$\n", "a %", false)).toBeNull();
  });

  it("un `$$` in mezzo a una frase è in riga: si fa blocco, non torna in riga", () => {
    const doc = "Vedi $$x$$ qui\n";
    const formula = formulaAt(stateOf(doc), doc.indexOf("x"))!;
    expect(formula.block).toBe(false);
    expect(toInline(formula)).toBeNull();
    expect(apply(doc, "x", true)).toBe("Vedi\n\n$$\nx\n$$\n\nqui\n");
  });
});
