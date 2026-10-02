import { describe, expect, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import { containerMath, mathBlock, renderInline, scanDollarMath } from "./render-inline";

// La regola delle formule fra dollari, una proprietà alla volta. Il confronto
// col provider vero sta nella famiglia `math` di `corpus.test.ts`; qui ogni
// clausola ha il suo caso, e i casi sono quelli che comrak decide così.

function formulas(value: string, opaque: { from: number; to: number }[] = []): unknown[] {
  return scanDollarMath(value, opaque).map((math) => [math.from, math.to, math.tex, math.display]);
}

function container(source: string, name = "Paragraph"): SyntaxNode {
  let found: SyntaxNode | null = null;
  markdownLanguage.parser.parse(source).iterate({
    enter: (node) => {
      if (found === null && node.name === name) found = node.node;
    },
  });
  if (found === null) throw new Error(`nessun ${name} in ${JSON.stringify(source)}`);
  return found;
}

function read(source: string, name?: string) {
  const node = container(source, name);
  return containerMath(source.slice(node.from, node.to), node);
}

describe("le formule fra dollari", () => {
  it("un dollaro chiude se non segue uno spazio e non precede una cifra", () => {
    expect(formulas("$x$ e $y$.")).toEqual([[0, 3, "x", false], [6, 9, "y", false]]);
    expect(formulas("vale $x$2")).toEqual([]);
    expect(formulas("$x $ e $ x$")).toEqual([]);
    expect(formulas("$")).toEqual([]);
    expect(formulas("$x$0 $x$9")).toEqual([]);
    expect(formulas("$x$/ e $y$:")).toEqual([[0, 3, "x", false], [7, 10, "y", false]]);
    for (const space of [" ", "\t", "\n", "\v", "\f", "\r"]) {
      expect(formulas(`$${space}x$ e $x${space}$`), JSON.stringify(space)).toEqual([]);
    }
  });

  it("un backslash protegge l'apertura se è dispari, e salta la chiusura comunque", () => {
    expect(formulas("\\$x$")).toEqual([]);
    expect(formulas("\\\\$x$")).toEqual([[2, 5, "x", false]]);
    expect(formulas("$a\\\\$ b$")).toEqual([[0, 8, "a\\\\$ b", false]]);
  });

  it("tre dollari sono testo, due chiudono sul primo `$$`", () => {
    expect(formulas("$$$x$$$")).toEqual([]);
    expect(formulas("$$$x$")).toEqual([]);
    expect(formulas("$$a$$b$$")).toEqual([[0, 5, "a", true]]);
    expect(formulas("$$a$b$$ e $$ $$")).toEqual([[0, 7, "a$b", true], [10, 15, " ", true]]);
    expect(formulas("$$x")).toEqual([]);
  });

  it("va a capo: le righe perdono il rientro, in riga l'a capo è uno spazio", () => {
    expect(formulas("$a\n  b$")).toEqual([[0, 7, "a b", false]]);
    expect(formulas("$a\r\nb$")).toEqual([[0, 6, "a\r b", false]]);
    expect(formulas("$$\n  x\n$$")).toEqual([[0, 9, "\nx\n", true]]);
  });

  it("gli spazi sono quelli ASCII: un NBSP non ferma i dollari", () => {
    expect(formulas("$a $ e $ b$")).toEqual([[0, 4, "a ", false], [7, 11, " b", false]]);
  });

  it("non apre dentro un intervallo opaco, ma ci chiude", () => {
    expect(formulas("$x$ y$z$", [{ from: 0, to: 3 }])).toEqual([[5, 8, "z", false]]);
    expect(formulas("`a`$x$", [{ from: 0, to: 3 }])).toEqual([[3, 6, "x", false]]);
    expect(formulas("a $x [b$] e $y$", [{ from: 5, to: 9 }])).toEqual([[2, 8, "x [b", false], [12, 15, "y", false]]);
  });

  it("una formula che ingoia un backtick lascia il contenitore senza formule", () => {
    expect(formulas("$y$ e $x `b$`")).toEqual([]);
  });

  it("resta lineare quando ogni dollaro apre e nessuno chiude", () => {
    // Ogni `\\$` apre, e in chiusura si salta: senza memoria ogni ricerca
    // rileggerebbe tutte le seguenti, fino in fondo o fino al `$` che la ferma.
    const run = `$a${"\\\\$a".repeat(30_000)}`;
    for (const value of [run, `${run} $`]) {
      const started = performance.now();
      expect(scanDollarMath(value)).toEqual([]);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});

describe("le formule di un contenitore", () => {
  it("i marcatori della citazione valgono come spazi", () => {
    expect(read("> a $x\n>$ b").formulas).toEqual([]);
    expect(read("> a $x\n> y$").formulas).toEqual([{ from: 4, to: 11, display: false, tex: "x y" }]);
  });

  it("codice, HTML, autolink, destinazione e titolo di un link non aprono; un URL nudo sì", () => {
    for (const source of [
      "`$a` b$", "<b title=\"$a\"> b$", "a <!-- $a --> b$", "<http://x.com/$a> b$",
      "[t](u$) b$", "[t]($u) b$", "![t](u$) b$", "[t](u \"$a\") b$",
    ]) {
      expect(read(source).formulas, source).toEqual([]);
    }
    expect(read("http://x.com/$a$ e").formulas).toEqual([{ from: 13, to: 16, display: false, tex: "a" }]);
  });

  it("in una cella `\\|` è una pipe anche nella formula", () => {
    const cell = read("| $x \\| y$ |\n|---|\n", "TableCell");
    expect(cell.formulas.map((formula) => formula.tex)).toEqual(["x | y"]);
  });

  it("è un blocco soltanto una formula `$$` da sola, fino al punto dato", () => {
    expect(mathBlock(read("  $$ x $$  "))).toBe("x");
    expect(mathBlock(read("> $$\n> x\n> $$"))).toBe("x");
    expect(mathBlock(read("$$x$$ e"))).toBeNull();
    expect(mathBlock(read("e $$x$$"))).toBeNull();
    expect(mathBlock(read("$$a$$ $$b$$"))).toBeNull();
    expect(mathBlock(read("$x$"))).toBeNull();
    expect(mathBlock(read("$$x$$ ^abc"))).toBeNull();
    expect(mathBlock(read("$$x$$ ^abc"), 6)).toBe("x");
    expect(mathBlock(read("$$x$$"), 3)).toBeNull();
  });
});

describe("la resa in riga", () => {
  it("legge le formule anche senza un nodo di partenza", () => {
    const source = "> a $x\n> y$ b";
    const html = renderInline({ source, references: new Map(), footnotes: new Map() }, 0, source.length);
    expect(html).toContain('<span class="math-inline" data-tex="x y" data-md-from="4" data-md-to="11">');
    // L'albero è quello della shell: il corpo di una nota di una parola sola
    // ha i suoi inline.
    const note = "[^1]: **b**";
    expect(renderInline({ source: note, references: new Map(), footnotes: new Map() }, 6, note.length)).toBe(
      '<strong data-md-from="6" data-md-to="11"><span data-md-from="8" data-md-to="9">b</span></strong>',
    );
  });

  it("legge le formule di un paragrafo di cui rende soltanto un pezzo", () => {
    const source = "a $x$ b";
    const html = renderInline({ source, references: new Map(), footnotes: new Map() }, 1, source.length);
    expect(html).toContain('<span class="math-inline" data-tex="x" data-md-from="2" data-md-to="5">');
  });
});
