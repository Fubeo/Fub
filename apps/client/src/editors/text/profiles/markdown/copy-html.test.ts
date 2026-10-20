// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { clipboardHtml } from "./copy-html";

describe("clipboardHtml", () => {
  it("porta grassetto, titoli ed elenchi senza gli attributi della shell", () => {
    const html = clipboardHtml("# Titolo\n\nUn **forte** e un *corsivo*.\n\n- uno\n- due\n");
    expect(html).toContain("<h1>Titolo</h1>");
    expect(html).toContain("<strong>forte</strong>");
    expect(html).toContain("<em>corsivo</em>");
    expect(html).toContain("<li><p>uno</p></li>");
    expect(html).not.toMatch(/\s(?:class|data-[\w-]+|id|style)=/u);
  });

  it("tiene i link del web e lascia il testo dei wikilink", () => {
    const html = clipboardHtml("[sito](https://example.com) e [[Altra nota]]");
    expect(html).toContain('<a href="https://example.com">sito</a>');
    expect(html).toContain("Altra nota");
    expect(html.match(/<a\b/gu)?.length).toBe(1);
  });

  it("un compito diventa il suo segno e un'immagine del vault il suo testo", () => {
    const html = clipboardHtml("- [x] fatto\n- [ ] da fare\n\n![schizzo](img/a.png)\n");
    expect(html).toContain("☑ ");
    expect(html).toContain("☐ ");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<img");
    expect(html).toContain("schizzo");
  });
});
