// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { detailsHead, isDetailsClose, pairDetails, type TopBlock } from "./details";
import { renderMarkdown } from "./render";
import { mountMarkdown } from "./mount";

// Il ripiegabile (K2): l'apertura, la chiusura, l'accoppiamento.

const html = (from: number, text: string): TopBlock => ({ from, to: from + text.length, html: text });
const other = (from: number): TopBlock => ({ from, to: from + 1, html: null });

describe("l'apertura", () => {
  it("legge `open` e il sommario, sulla stessa riga o sotto", () => {
    expect(detailsHead("<details>\n<summary>Titolo</summary>")).toEqual({ open: false, summary: { from: 19, to: 25 } });
    expect(detailsHead("<details open><summary>Sì</summary>")).toMatchObject({ open: true, summary: { from: 23, to: 25 } });
    expect(detailsHead('<DETAILS open="">')).toEqual({ open: true, summary: null });
    expect(detailsHead("<details>")).toEqual({ open: false, summary: null });
  });

  it("altro HTML o altro testo la lasciano HTML", () => {
    expect(detailsHead('<details class="x">')).toBeNull();
    expect(detailsHead("<details>\n<summary><b>T</b></summary>")).toBeNull();
    expect(detailsHead("<details>\n<summary>T</summary>\ntesto")).toBeNull();
    expect(detailsHead("<details><summary>T</summary></details>")).toBeNull();
    expect(isDetailsClose("</details>")).toBe(true);
    expect(isDetailsClose("</details> e poi")).toBe(false);
  });
});

describe("l'accoppiamento", () => {
  it("accoppia gli annidati dall'interno e lascia soli quelli senza chiusura", () => {
    const { pairs, unclosed } = pairDetails([
      html(0, "<details>"), other(10), html(20, "<details open>"), other(40), html(50, "</details>"),
      html(60, "</details>"), html(70, "</details>"), html(80, "<details>"),
    ]);
    expect(pairs.map((pair) => [pair.open.from, pair.close.from, pair.depth])).toEqual([[0, 60, 0], [20, 50, 1]]);
    expect(unclosed).toEqual([{ from: 80, to: 89 }]);
  });
});

describe("la Lettura", () => {
  const note = "<details>\n<summary>Ingredienti</summary>\n\n- **farina**\n- acqua\n\n</details>\n\nDopo.";

  it("mette il contenuto Markdown dentro il ripiegabile", () => {
    const out = renderMarkdown(note).html;
    expect(out).toMatch(/^<details class="fub-details" data-md-from="0" data-md-to="\d+"><summary>Ingredienti<\/summary><ul/);
    expect(out).toContain("<strong");
    expect(out).toMatch(/<\/ul><\/details><p[^>]*><span[^>]*>Dopo\.<\/span><\/p>$/);
    // Passa la pulizia della Lettura con il suo contenuto dentro.
    const root = document.createElement("div");
    const unmount = mountMarkdown(root, out, {});
    expect(root.querySelector("details.fub-details > summary")?.textContent).toBe("Ingredienti");
    expect(root.querySelector("details > ul strong")?.textContent).toBe("farina");
    expect(root.querySelector("details")!.open).toBe(false);
    unmount();
  });

  it("`open` lo apre; senza chiusura resta HTML", () => {
    expect(renderMarkdown(note.replace("<details>", "<details open>")).html).toContain(' open><summary>');
    const unclosed = renderMarkdown("<details>\n<summary>T</summary>\n\nTesto").html;
    expect(unclosed).not.toContain("fub-details");
    expect(unclosed).toContain("block-html");
  });

  it("perdere la chiusura rifà l'apertura anche nella resa incrementale", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { renderMarkdownState } = await import("./render");
    const { markdown } = await import("@codemirror/lang-markdown");
    const { ensureSyntaxTree } = await import("@codemirror/language");
    const { markdownGrammar } = await import("./grammar");
    const state = EditorState.create({ doc: note, extensions: markdown({ base: markdownGrammar }) });
    ensureSyntaxTree(state, state.doc.length, 1000);
    const first = renderMarkdownState(state);
    const at = note.indexOf("</details>");
    const tr = state.update({ changes: { from: at, to: at + "</details>".length } });
    ensureSyntaxTree(tr.state, tr.state.doc.length, 1000);
    const second = renderMarkdownState(tr.state, undefined, { document: first, changes: tr.changes });
    expect(first.html).toContain("fub-details");
    expect(second.html).not.toContain("fub-details");
  });
});
