// La Base dentro una nota sta in `.markdown-rendered`, e le regole delle
// tabelle Markdown (`.markdown-rendered table`, `th`, `td`, `tr`) prendevano
// anche la sua tabella: bordi separati, angoli tondi, 9,75 px invece di 13,
// e la tabella usciva a destra del vassoio a 1280 (controllo del 2026-11-21).
// La misura vera la legge il banco della conformità (pezzi `base.tabella`,
// `base.incorporata`, due luci); qui si tiene la regola: ogni selettore delle
// tabelle Markdown lascia fuori la Base senza peso in più, e il vassoio che
// porta una Base si allarga lui, non la Base dentro.
import { describe, expect, it } from "vitest";
import { DOCUMENT_SKIN as document, EDITORS_SKIN as editors } from "./skin-text";
import structure from "./structure.css?raw";

const ESCLUSA = ":not(:where(.base-surface *))";

/// I selettori (uno per voce della virgola) di ogni regola del foglio.
function selectors(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/([^{}@]+)\{[^{}]*\}/g)].flatMap((rule) => rule[1]!.split(",").map((each) => each.trim()));
}

/// I selettori che toccano un elemento di tabella dentro `.markdown-rendered`.
/// Quelli che passano per `.markdown-table-scroll`, il contenitore che solo
/// una tabella Markdown ha, non possono prendere la Base.
function markdownTableSelectors(css: string): string[] {
  return selectors(css).filter(
    (each) => /\.markdown-rendered\b[^,]*\s(table|thead|tbody|tr|th|td)\b/.test(each) && !each.includes(".markdown-table-scroll"),
  );
}

describe("la tabella della Base dentro una nota", () => {
  for (const [name, css] of [
    ["skin/document*.css", document],
    ["structure.css", structure],
  ] as const) {
    it(`${name}: le tabelle Markdown lasciano fuori la Base`, () => {
      const list = markdownTableSelectors(css);
      expect(list.length, "le regole delle tabelle Markdown").toBeGreaterThan(0);
      for (const selector of list) expect(selector, selector).toContain(ESCLUSA);
    });
  }

  it("niente !important per tenere la pelle della Base", () => {
    const base = editors.match(/\.base-table\s*\{[^}]*\}/)?.[0] ?? "";
    expect(base).toContain("font-size");
    expect(base).not.toContain("!important");
  });

  it("si allarga il vassoio della trasclusione, e la Base resta nel suo filo", () => {
    const clean = editors.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(clean).toMatch(
      /\.cm-content \.embed\.transclusion:has\(> \.transclusion-body \.base-surface\[data-embedded="true"\]\)[^{]*\{\s*margin-right: -64px;/,
    );
    expect(clean).toMatch(/\.cm-content \.transclusion-body \.base-surface\[data-embedded="true"\][^{]*\{\s*margin-right: 0;/);
  });
});
