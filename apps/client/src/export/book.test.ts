// @vitest-environment happy-dom
// Più note in un PDF (T78): l'ordine, le note che non si leggono, i
// capitoli che cominciano su una pagina loro e i collegamenti fra le note.

import { describe, expect, it } from "vitest";
import type { RenderedDocument } from "../host/contract";
import { BookMeasure, ChapterTargets, bookNotes, createBook, markChapterLinks, noteName, relativeTo } from "./book";
import { CHAPTER_BREAK_PREFIX } from "./paginate/breaks";

const rendered = (html: string): RenderedDocument => ({ html, parts: [] });

describe("le note di un libro", () => {
  it("tengono l'ordine dato, una volta sola, e mettono a parte ciò che non è Markdown", () => {
    expect(bookNotes(["B.md", "a/A.MD", "Disegno.excalidraw", "B.md", "c.markdown"])).toEqual({
      notes: ["B.md", "a/A.MD", "c.markdown"],
      others: ["Disegno.excalidraw"],
    });
  });

  it("si chiamano col nome del file", () => {
    expect(noteName("Progetto/Alfa.md")).toBe("Alfa");
    expect(noteName("v1.2/Note")).toBe("Note");
    expect(noteName(".nascosta")).toBe(".nascosta");
  });

  it("risolvono i percorsi relativi senza uscire dal vault", () => {
    expect(relativeTo("Progetto/Alfa.md", "Beta.md")).toBe("Progetto/Beta.md");
    expect(relativeTo("Progetto/Sotto/Alfa.md", "../Beta.md")).toBe("Progetto/Beta.md");
    expect(relativeTo("Progetto/Alfa.md", "/Radice.md")).toBe("Radice.md");
    expect(relativeTo("Alfa.md", "../Fuori.md")).toBeNull();
  });
});

describe("i capitoli dei collegamenti", () => {
  const targets = new ChapterTargets(["Progetto/Alfa.md", "Progetto/Beta.md", "2024/Diario.md", "2025/Diario.md"]);

  it("un wikilink trova la nota col nome o col percorso, senza badare alle maiuscole", () => {
    expect(targets.wiki("beta")).toBe(1);
    expect(targets.wiki("Progetto/Alfa")).toBe(0);
    expect(targets.wiki("/Progetto/Alfa.md")).toBe(0);
    expect(targets.wiki("Gamma")).toBeNull();
    expect(targets.wiki("Altro/Beta")).toBeNull();
  });

  it("due note con lo stesso nome non si indovinano: serve il percorso", () => {
    expect(targets.wiki("Diario")).toBeNull();
    expect(targets.wiki("2025/Diario")).toBe(3);
  });

  it("un collegamento a un file si legge dalla cartella della nota", () => {
    expect(targets.path("Progetto/Alfa.md", "Beta.md")).toBe(1);
    expect(targets.path("Progetto/Alfa.md", "Beta.md#Metodo")).toBe(1);
    expect(targets.path("Progetto/Alfa.md", "../2024/Diario.md")).toBe(2);
    expect(targets.path("Progetto/Alfa.md", "Progetto%20Due.md")).toBeNull();
  });

  it("segna solo i collegamenti verso le note del libro, con la sezione", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <a class="wikilink" data-wikilink-page="Beta" data-wikilink-heading="Metodo" href="#">a</a>
      <a class="wikilink" data-wikilink-page="Fuori" href="#">b</a>
      <a class="internal-path" data-path="../2024/Diario.md" href="#">c</a>
      <a href="https://fub.example/">d</a>`;
    expect(markChapterLinks(root, "Progetto/Alfa.md", targets)).toBe(2);
    const links = [...root.querySelectorAll<HTMLElement>("a")];
    expect(links.map((link) => link.dataset["exportChapter"] ?? null)).toEqual(["1", null, "2", null]);
    expect(links[0]!.dataset["exportSection"]).toBe("Metodo");
  });
});

describe("il libro nello spazio", () => {
  const notes: Record<string, string> = {
    "Alfa.md": `<p>Vedi <a class="wikilink" data-wikilink-page="Gamma" href="#">Gamma</a></p>`,
    "Beta.md": "",
    "Gamma.md": `<p>Torna ad <a class="wikilink" data-wikilink-page="Alfa" href="#">Alfa</a></p>`,
  };
  const render = async (doc: string) => {
    const html = notes[doc];
    if (html === undefined || html === "") throw new Error(`«${doc}» non si legge`);
    return rendered(html);
  };

  it("salta la nota che non si legge, la nomina, e monta le altre in ordine", async () => {
    const book = createBook({ docs: ["Alfa.md", "Beta.md", "Gamma.md"], render });
    expect(await book.render("Alfa.md", "print")).toEqual({ html: "", parts: [] });
    expect(book.skipped()).toEqual(["Beta.md"]);
    expect(book.chapters()).toEqual(["Alfa.md", "Gamma.md"]);

    const page = document.createElement("div");
    const mounted = book.mount(page, { html: "", parts: [] });
    await mounted.ready;
    const shape = [...page.children].map((node) => (node as HTMLElement).dataset["exportChapterBreak"] !== undefined
      ? "pagina"
      : `${node.tagName}:${node.textContent?.trim().slice(0, 12)}`);
    expect(shape).toEqual(["H1:Alfa", "DIV:Vedi Gamma", "pagina", "H1:Gamma", "DIV:Torna ad Alf"]);
    const links = [...page.querySelectorAll<HTMLElement>("a.wikilink")].map((link) => link.dataset["exportChapter"]);
    expect(links).toEqual(["1", "0"]);
    mounted.dispose();
    expect(page.children).toHaveLength(0);
  });

  it("se nessuna nota si legge, l'errore è quello della prima", async () => {
    const book = createBook({ docs: ["Beta.md", "Manca.md"], render });
    await expect(book.render("Beta.md", "print")).rejects.toThrow("«Beta.md» non si legge");
  });

  it("monta ogni capitolo con la sua nota", async () => {
    const seen: string[] = [];
    const book = createBook({
      docs: ["Alfa.md", "Gamma.md"],
      render,
      title: (doc) => `Nota ${doc}`,
      mount: (container, chapter, doc) => {
        seen.push(doc);
        container.innerHTML = chapter.html;
        return { ready: Promise.resolve(), dispose: () => container.replaceChildren() };
      },
    });
    await book.render("Alfa.md", "print");
    const page = document.createElement("div");
    await book.mount(page, { html: "", parts: [] }).ready;
    expect(seen).toEqual(["Alfa.md", "Gamma.md"]);
    expect(page.querySelector(".export-chapter-title")?.textContent).toBe("Nota Alfa.md");
  });

  it("dà a ogni capitolo l'aspetto comune dei diagrammi, mai quello di una posizione", async () => {
    const asked: (number | null)[] = [];
    const looks: unknown[] = [];
    const book = createBook({
      docs: ["Alfa.md", "Gamma.md"],
      render,
      mount: (container, _chapter, _doc, diagramLook) => {
        looks.push(diagramLook());
        return { ready: Promise.resolve(), dispose: () => container.replaceChildren() };
      },
    });
    await book.render("Alfa.md", "print");
    const aurora = { style: "aurora" as const };
    await book.mount(document.createElement("div"), { html: "", parts: [] }, {
      diagramLook: (index) => {
        asked.push(index);
        return aurora;
      },
    }).ready;
    expect(looks).toEqual([aurora, aurora]);
    expect(asked).toEqual([null, null]);
  });

  it("la misura legge il segno fra due note come un'interruzione «capitolo»", () => {
    const page = document.createElement("article");
    page.className = "print-page";
    page.innerHTML = `<h1>Libro</h1><div class="print-body markdown-rendered">
      <h1 class="export-chapter-title">Alfa</h1><div class="markdown-rendered export-chapter"><p>uno</p></div>
      <div class="export-chapter-break" data-export-chapter-break="1"></div>
      <h1 class="export-chapter-title">Gamma</h1><div class="markdown-rendered export-chapter"><p>due</p></div></div>`;
    document.body.append(page);
    const measure = new BookMeasure(page);
    const kinds = Array.from({ length: measure.count }, (_, i) => {
      const { box } = measure.measure(i, "stima");
      return box.kind === "separator" ? box.id : box.kind;
    });
    expect(kinds).toEqual(["heading", "heading", "paragraph", `${CHAPTER_BREAK_PREFIX}1`, "heading", "paragraph"]);
    measure.dispose();
    page.remove();
  });
});
