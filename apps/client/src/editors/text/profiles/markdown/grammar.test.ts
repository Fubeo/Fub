import { describe, expect, it } from "vitest";
import type { SyntaxNode } from "@lezer/common";
import { markdownGrammar } from "./grammar";

/// I blocchi dell'albero con il loro testo, i figli dei contenitori dentro.
function blocks(source: string): unknown[] {
  const walk = (node: SyntaxNode): unknown[] => {
    const out: unknown[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (/Mark$/.test(child.name)) continue;
      const text = source.slice(child.from, child.to);
      out.push(["Blockquote", "BulletList", "ListItem"].includes(child.name) ? [child.name, walk(child)] : [child.name, text]);
    }
    return out;
  };
  return walk(markdownGrammar.parser.parse(source).topNode);
}

function names(source: string, from: number): string[] {
  const out: string[] = [];
  const tree = markdownGrammar.parser.parse(source);
  for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent) out.push(node.name);
  return out;
}

describe("grammatica Markdown della shell", () => {
  it("legge una definizione di nota come un paragrafo, anche di una parola sola", () => {
    expect(blocks("[^1]: $x$\n")).toEqual([["Paragraph", "[^1]: $x$"]]);
    expect(names("[^1]: **b**\n", 8)).toContain("StrongEmphasis");
    expect(names("[^1]: [[Nota]] [l](u)\n", 16)).toContain("Link");
    // I due punti non chiedono uno spazio dopo, come in comrak.
    expect(blocks("[^a]:x\n")).toEqual([["Paragraph", "[^a]:x"]]);
    // Un riferimento di link resta tale, anche con un'etichetta che comincia
    // con `^` ma è vuota o ha uno spazio.
    expect(blocks("[x]: https://example.test\n")).toEqual([["LinkReference", "[x]: https://example.test"]]);
    expect(blocks("[^]: x\n")).toEqual([["LinkReference", "[^]: x"]]);
    expect(blocks("[^a b]: x\n")).toEqual([["LinkReference", "[^a b]: x"]]);
  });

  it("tiene nella definizione le righe che comrak vi lascia", () => {
    expect(blocks("[^1]: $x$\nseguito\n")).toEqual([["Paragraph", "[^1]: $x$\nseguito"]]);
    expect(blocks("[^1]: x\n===\n")).toEqual([["Paragraph", "[^1]: x\n==="]]);
    expect(blocks("[^1]: a|b\n-|-\n")).toEqual([["Paragraph", "[^1]: a|b\n-|-"]]);
    expect(blocks("> [^1]: $x$\n> seguito\n")).toEqual([["Blockquote", [["Paragraph", "[^1]: $x$\n> seguito"]]]]);
    expect(blocks("- a\n\n  [^1]: **b**\n  c\n")).toEqual([
      ["BulletList", [["ListItem", [["Paragraph", "a"], ["Paragraph", "[^1]: **b**\n  c"]]]]],
    ]);
  });

  it("chiude la definizione su una riga di trattini, che resta una riga", () => {
    for (const label of ["x", "testo x"]) {
      expect(blocks(`[^1]: ${label}\n---\n`)).toEqual([["Paragraph", `[^1]: ${label}`], ["HorizontalRule", "---"]]);
    }
    // Fuori da una definizione i trattini sottolineano ancora un titolo, e le
    // pipe fanno ancora una tabella.
    expect(blocks("a\n---\n")).toEqual([["SetextHeading2", "a\n---"]]);
    expect(blocks("a|b\n-|-\n")[0]).toEqual(["Table", "a|b\n-|-"]);
  });

  it("comincia una definizione dove comrak la comincia, anche dentro un altro blocco", () => {
    const note = ["Paragraph", "[^a]: y"];
    expect(blocks("x\n[^a]: y\n")).toEqual([["Paragraph", "x"], note]);
    expect(blocks("[^b]: x\n[^a]: y\n")).toEqual([["Paragraph", "[^b]: x"], note]);
    expect(blocks("a|b\n-|-\n[^a]: y\n")).toEqual([["Table", "a|b\n-|-"], note]);
    expect(blocks("> x\n[^a]: y\n")).toEqual([["Blockquote", [["Paragraph", "x"]]], note]);
    expect(blocks("- x\n[^a]: y\n")).toEqual([["BulletList", [["ListItem", [["Paragraph", "x"]]]]], note]);
  });

  it("una definizione senza corpo non prende la riga che la segue, se non è rientrata", () => {
    expect(blocks("[^a]:\ncontinua\n")).toEqual([["Paragraph", "[^a]:"], ["Paragraph", "continua"]]);
    expect(blocks("[^a]: \t\n===\n")).toEqual([["Paragraph", "[^a]: \t"], ["Paragraph", "==="]]);
    expect(blocks("[^a]:\n    continua\n")).toEqual([["Paragraph", "[^a]:\n    continua"]]);
  });
});
