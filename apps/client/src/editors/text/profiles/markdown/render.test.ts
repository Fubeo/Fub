// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render";

function content(source: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(source).html;
  return root;
}

describe("contenuto Markdown reso", () => {
  it("mostra una task una sola volta, conservando le voci annidate", () => {
    const root = content("- [ ] Da fare\n  - dettaglio\n- [x] Fatto\n");
    expect(Array.from(root.querySelectorAll("li.task"), (item) => item.textContent)).toEqual(["Da faredettaglio", "Fatto"]);
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'), (box) => box.checked)).toEqual([false, true]);
  });

  it("rimuove i marcatori di citazione senza spezzare l'enfasi multilinea", () => {
    const root = content("> **prima\n> seconda**\n");
    expect(root.querySelector("blockquote")?.textContent?.replace(/\s+/g, " ").trim()).toBe("prima seconda");
    expect(root.querySelector("blockquote strong")?.textContent?.replace(/\s+/g, " ").trim()).toBe("prima seconda");
  });

  it("riconosce gli embed senza attivarli dentro il codice", () => {
    const root = content("![[Nota]]\n\n`![[Nota]]`");
    expect(root.querySelectorAll(".embed")).toHaveLength(1);
    expect(root.querySelector(".embed")?.getAttribute("data-embed-page")).toBe("Nota");
    expect(root.querySelector("code")?.textContent).toBe("![[Nota]]");
  });

  it("espone formule inline e a blocco allo stesso idratatore", () => {
    const root = content("Prima $x^2 + y$ dopo\n\n$$\n\\\\frac{a}{b}\n$$\n\n`$non-matematica$`");
    const inline = root.querySelector<HTMLElement>(".math-inline");
    const block = root.querySelector<HTMLElement>(".math-block");
    expect(inline?.dataset.tex).toBe("x^2 + y");
    expect(inline?.textContent).toBe("x^2 + y");
    expect(block?.dataset.tex).toBe("\\\\frac{a}{b}");
    expect(block?.textContent).toBe("\\\\frac{a}{b}");
    expect(root.querySelector("code")?.textContent).toBe("$non-matematica$");
  });

  it("lascia letterali dollari escapati e formule incomplete", () => {
    const root = content(String.raw`Costo \$5 e formula $incompleta`);
    expect(root.querySelector(".math-inline")).toBeNull();
    expect(root.textContent).toBe("Costo $5 e formula $incompleta");
  });

  it("rende la nota inline sul proprio span e conserva la formattazione senza HTML attivo", () => {
    const source = "Été ^[nota **forte** & <script>alert(1)</script>] fine";
    const root = content(source);
    const note = root.querySelector<HTMLElement>("sup.footnote-inline");
    expect(note?.getAttribute("data-md-from")).toBe(String(source.indexOf("^[")));
    expect(note?.getAttribute("data-md-to")).toBe(String(source.indexOf("] fine") + 1));
    expect(note?.querySelector("strong")?.textContent).toBe("forte");
    expect(note?.querySelector("script")).toBeNull();
    expect(note?.textContent).toContain("alert(1)");
  });

  it("non interpreta note inline escapate, nel codice o in HTML a blocco", () => {
    const root = content("Normale ^[sì] ed \\^[escape] e `^[code]`\n\n<div>\n^[html]\n</div>\n");
    expect(Array.from(root.querySelectorAll("sup.footnote-inline"), (node) => node.textContent)).toEqual(["sì"]);
    expect(root.querySelector("code")?.textContent).toBe("^[code]");
  });

  it("nasconde un commento e ciò che contiene, senza toccare il resto della riga", () => {
    const root = content("Prima %%segreto [[Altra]] #tag ==no==%% dopo ==sì==");
    expect(root.textContent).toBe("Prima  dopo sì");
    expect(root.querySelector(".wikilink, .tag")).toBeNull();
    expect(root.querySelector("mark")?.textContent).toBe("sì");
  });

  it("legge la dimensione di un embed e mostra il bersaglio, non il numero", () => {
    const root = content("![[foto.png|120]] e ![[schema.png|200x100]] e ![[Nota|alias]]");
    const embeds = Array.from(root.querySelectorAll<HTMLElement>(".embed"));
    expect(embeds.map((e) => [e.textContent, e.dataset.embedSize])).toEqual([
      ["foto.png", "120"],
      ["schema.png", "200x100"],
      ["alias", undefined],
    ]);
  });

  it("applica dimensioni esplicite alle immagini senza includerle nell'alt", () => {
    const root = content("![Schema|640x360](assets/schema.png)\n\n![Logo|128](logo.png)");
    const images = root.querySelectorAll("img");
    expect(images[0]?.getAttribute("alt")).toBe("Schema");
    expect(images[0]?.getAttribute("width")).toBe("640");
    expect(images[0]?.getAttribute("height")).toBe("360");
    expect(images[1]?.getAttribute("alt")).toBe("Logo");
    expect(images[1]?.getAttribute("width")).toBe("128");
    expect(images[1]?.hasAttribute("height")).toBe(false);
  });
});
