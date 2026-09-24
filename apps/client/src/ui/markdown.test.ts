// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedContent } from "../host/contract";
import { renderMarkdown } from "../editors/text/profiles/markdown/render";

const query = vi.hoisted(() => ({ renderEmbed: vi.fn() }));
vi.mock("../host/query", () => query);
import { mountMarkdown, sourceElementAt } from "./markdown";

const disposers: (() => void)[] = [];
function mount(html: string, element: HTMLElement = document.createElement("div")): HTMLElement {
  document.body.append(element);
  disposers.push(mountMarkdown(element, html, { documentId: "Nota.md" }));
  return element;
}
function deferred() {
  let resolve!: (content: EmbedContent) => void;
  const promise = new Promise<EmbedContent>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  query.renderEmbed.mockReset().mockResolvedValue({ doc_id: "Altra.md", html: "<p>contenuto</p>", parts: [] });
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("montaggio Markdown condiviso", () => {
  it("non confonde un'ancora della nota con quella di una trasclusione", () => {
    const root = mount('<div class="embed-loaded"><h2 id="sezione">Incorporata</h2></div><a href="#sezione">Vai</a><h2 id="sezione">Nota</h2>');
    const embedded = vi.spyOn(root.querySelector<HTMLElement>(".embed-loaded h2")!, "scrollIntoView");
    const own = vi.spyOn(root.querySelector<HTMLElement>(":scope > h2")!, "scrollIntoView");
    root.querySelector("a")!.click();
    expect(own).toHaveBeenCalledOnce();
    expect(embedded).not.toHaveBeenCalled();
  });

  it("consente un ritaglio della nota corrente ma interrompe il riferimento ricorsivo", async () => {
    const reference = '<div class="embed" data-embed-page="" data-embed-heading="Sezione"></div>';
    query.renderEmbed.mockResolvedValue({ doc_id: "Nota.md", html: `<p>Ritaglio</p>${reference}`, parts: [] });
    const root = mount(reference);
    await vi.waitFor(() => expect(root.querySelector(".embed-cycle")).not.toBeNull());
    expect(root.querySelectorAll("p")).toHaveLength(1);
    expect(root.textContent).toBe("Ritaglio");
    expect(query.renderEmbed).toHaveBeenCalledWith("Nota.md", "Sezione", null);
  });

  it("condivide richieste identiche senza confondere heading e ancore di blocco", async () => {
    query.renderEmbed.mockImplementation(async (_page: string, heading: string | null, block: string | null) => ({
      doc_id: "Glossario.md",
      html: `<p>${heading ?? block}</p>`,
      parts: [],
    }));
    const element = mount(
      '<div class="embed" data-embed-page="Glossario" data-embed-heading="A"></div>' +
      '<div class="embed" data-embed-page="Glossario" data-embed-heading="B"></div>' +
      '<div class="embed" data-embed-page="Glossario" data-embed-block="A"></div>' +
      '<div class="embed" data-embed-page="Glossario" data-embed-heading="A"></div>',
    );
    await vi.waitFor(() => expect(Array.from(element.querySelectorAll(".embed-loaded"), (embed) => embed.textContent))
      .toEqual(["A", "B", "A", "A"]));
    expect(query.renderEmbed).toHaveBeenCalledTimes(3);
  });

  it("un embed della versione precedente non sostituisce la nuova lettura", async () => {
    const old = deferred();
    const next = deferred();
    query.renderEmbed.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const element = mount('<h1>Prima</h1><div class="embed" data-embed-page="Vecchia"></div>');
    mount('<h1>Corrente</h1><div class="embed" data-embed-page="Nuova"></div>', element);
    old.resolve({ doc_id: "Vecchia.md", html: "<p>Scaduto</p>", parts: [] });
    next.resolve({ doc_id: "Nuova.md", html: "<p>Nuovo contenuto</p>", parts: [] });
    await vi.waitFor(() => expect(element.querySelector(".embed-loaded")?.textContent).toBe("Nuovo contenuto"));
    expect(element.querySelector("h1")?.textContent).toBe("Corrente");
    expect(element.textContent).not.toContain("Scaduto");
  });

  it("due superfici completano gli embed indipendentemente", async () => {
    const first = deferred();
    const second = deferred();
    query.renderEmbed.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = mount('<div class="embed" data-embed-page="A"></div>');
    const b = mount('<div class="embed" data-embed-page="B"></div>');
    second.resolve({ doc_id: "B.md", html: "<p>Secondo</p>", parts: [] });
    first.resolve({ doc_id: "A.md", html: "<p>Primo</p>", parts: [] });
    await vi.waitFor(() => {
      expect(a.querySelector(".embed-loaded")?.textContent).toBe("Primo");
      expect(b.querySelector(".embed-loaded")?.textContent).toBe("Secondo");
    });
  });

  it("copia soltanto il codice, non le etichette del controllo", async () => {
    let clipboard = "";
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    disposers.push(() => {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { clipboard = text; } },
    });
    const element = mount('<pre><code>if (a &lt; b) {\n  return "c";\n}</code></pre>');
    element.querySelector<HTMLButtonElement>(".markdown-code-copy")!.click();
    await vi.waitFor(() => expect(clipboard).toBe('if (a < b) {\n  return "c";\n}'));
  });

  it("monta solo l'HTML consentito senza reinterpretare Markdown o contratti shell", () => {
    const source = [
      '<div class="tag internal-path" data-tag="finto" onclick="attack()">',
      '<mark id="sezione">**letterale**</mark>',
      '<a class="wikilink" data-wikilink-page="Segreto" href="https://example.org">esterno</a>',
      "<script>attack()</script>",
      "</div>",
    ].join("\n");
    const root = mount(renderMarkdown(source).html);
    const mark = root.querySelector("mark");
    const link = root.querySelector("a");
    expect(mark?.textContent).toBe("**letterale**");
    expect(mark?.id).toBe("fub-contenuto-sezione");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector('[onclick], [data-tag], [data-wikilink-page]')).toBeNull();
    expect(link?.className).toBe("");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("posizione nel testo reso", () => {
  function preview(html: string): HTMLElement {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element;
  }

  it("trova il titolo dall'offset sorgente invece di contare marcatori nascosti", () => {
    const element = preview('<h2 data-md-from="0" data-md-to="11">Primo</h2><p data-md-from="13" data-md-to="28">testo reso</p><h2 data-md-from="30" data-md-to="43">Secondo</h2>');
    expect(sourceElementAt(element, 30)?.textContent).toBe("Secondo");
  });

  it("sceglie il segmento annidato senza entrare nelle coordinate di una trasclusione", () => {
    const element = preview('<blockquote data-md-from="0" data-md-to="80"><p data-md-from="12" data-md-to="31">testo annidato</p></blockquote><div class="embed-loaded" data-md-from="82" data-md-to="100"><p data-md-from="19" data-md-to="22">altro documento</p></div>');
    expect(sourceElementAt(element, 20)?.textContent).toBe("testo annidato");
    expect(sourceElementAt(element, 90)?.classList.contains("embed-loaded")).toBe(true);
  });

  it("ignora coordinate invalide e sceglie il blocco più vicino nei separatori", () => {
    const element = preview('<p data-md-from="no" data-md-to="9">rotto</p><p data-md-from="10" data-md-to="20">primo</p><p data-md-from="25">incompleto</p><p data-md-from="30" data-md-to="40">secondo</p>');
    expect(sourceElementAt(element, 2)?.textContent).toBe("primo");
    expect(sourceElementAt(element, 25)?.textContent).toBe("secondo");
    expect(sourceElementAt(element, 99)?.textContent).toBe("secondo");
  });
});
