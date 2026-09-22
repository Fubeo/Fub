// @vitest-environment happy-dom
//
// Il presidio del **gemello**: in modalità Lettura un wikilink è un `<a>` con
// dei `data-`, e chi lo cliccava passava dallo stesso `if (!page) return` che
// fermava l'editor. Due superfici, la stessa premessa sbagliata: che un
// wikilink senza pagina non nomini niente.
//
// Vuoto e assente sono la stessa cosa per un `dataset`, e non per un legame:
// `[[#Sezione]]` arriva dal renderer come `data-wikilink-page=""` più
// l'ancora, ed è un riferimento **dentro** la nota che si sta leggendo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedContent, RenderedDocument } from "../host/contract";

const rendered = vi.hoisted(() => ({ value: null as RenderedDocument | null }));
const query = vi.hoisted(() => ({
  renderPreview: vi.fn(),
  renderEmbed: vi.fn(),
}));

vi.mock("../host/query", () => query);

import { configurePreview, describeReadingVersion, markReadingVersion, sourceBlockAt, updatePreview } from "./preview";

describe("un wikilink cliccato in Lettura", () => {
  const calls: [string, string | undefined, string | undefined][] = [];
  beforeEach(() => {
    calls.length = 0;
    query.renderPreview.mockReset().mockImplementation(async () => {
      if (!rendered.value) throw new Error("rendered preview missing");
      return rendered.value;
    });
    document.body.innerHTML = "";
    query.renderEmbed.mockReset().mockImplementation(
      async (page: string): Promise<EmbedContent> => ({ doc_id: page, html: "", parts: [] }),
    );
    configurePreview({
      openPage: async (page, heading, block) => {
        calls.push([page, heading, block]);
      },
    });
  });


  async function renderPreview(html: string): Promise<HTMLElement> {
    rendered.value = { html, parts: [] } as unknown as RenderedDocument;
    const el = document.createElement("div");
    document.body.appendChild(el);
    await updatePreview(el, "Nota.md");
    return el;
  }

  it("porta la pagina, l'ancora e il blocco a chi sa aprire", async () => {
    const el = await renderPreview(
      '<a class="wikilink" data-wikilink-page="Altra" data-wikilink-heading="Sezione">Altra</a>',
    );
    el.querySelector<HTMLElement>("a.wikilink")!.click();
    expect(calls).toEqual([["Altra", "Sezione", undefined]]);
  });

  it("e un riferimento senza pagina è un riferimento dentro questa nota", async () => {
    // Chi sa dove siamo è `openWikilink`, che lo chiede a `activeDoc()`: qui si
    // guarda solo che la superficie di lettura **lo lasci passare** invece di
    // spegnere il click sulla soglia.
    const el = await renderPreview(
      '<a class="wikilink" data-wikilink-page="" data-wikilink-block="blocco">quassù</a>',
    );
    el.querySelector<HTMLElement>("a.wikilink")!.click();
    expect(calls).toEqual([["", undefined, "blocco"]]);
  });
  it("nomina blocchi di codice e task con chiavi localizzabili", async () => {
    const el = await renderPreview(
      '<pre>const x = 1;</pre><ul><li><input type="checkbox"></li><li><input type="checkbox" checked></li></ul>',
    );
    const code = el.querySelector("pre")!;
    expect(code.getAttribute("data-i18n-label")).toBe("preview.code_block");
    expect(code.getAttribute("aria-label")).toBe("Blocco di codice");
    const tasks = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(tasks.map((task) => task.getAttribute("data-i18n-label"))).toEqual([
      "editor.task.pending",
      "editor.task.completed",
    ]);
    expect(tasks.map((task) => task.getAttribute("aria-label"))).toEqual([
      "Attività da completare",
      "Attività completata",
    ]);
  });

  it("passa il documento al helper tipizzato", async () => {
    await renderPreview("<p>contenuto</p>");
    expect(query.renderPreview).toHaveBeenCalledWith("Nota.md");
  });

  it("propaga l'errore del helper che rende il documento", async () => {
    const failure = new Error("render fallito");
    query.renderPreview.mockRejectedValueOnce(failure);
    const element = document.createElement("div");
    document.body.appendChild(element);

    await expect(updatePreview(element, "Rotta.md")).rejects.toBe(failure);
    expect(element.innerHTML).toBe("");
  });

  it("segna come irrisolto un embed quando il helper restituisce un errore", async () => {
    query.renderEmbed.mockRejectedValueOnce(new Error("embed fallito"));
    const element = await renderPreview(
      '<div class="embed" data-embed-page="Altra"></div>',
    );

    expect(query.renderEmbed).toHaveBeenCalledWith("Altra", null, null);
    expect(element.querySelector(".embed.unresolved")).not.toBeNull();
  });
});

describe("mappatura dagli offset sorgente ai blocchi dell'anteprima", () => {
  function preview(html: string): HTMLElement {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element;
  }

  it("trova il secondo heading dai byte sorgente senza contare i marker Markdown nascosti", () => {
    const element = preview(`
      <h2 data-fub-source-start="0" data-fub-source-end="11">Primo</h2>
      <p data-fub-source-start="13" data-fub-source-end="28">testo <strong>reso</strong></p>
      <h2 data-fub-source-start="30" data-fub-source-end="43">Secondo</h2>
    `);

    const selected = sourceBlockAt(element, 30);
    expect(selected?.textContent).toBe("Secondo");
    expect(element.textContent).not.toContain("##");
  });

  it("preferisce lo span annidato più stretto al contenitore", () => {
    const element = preview(`
      <blockquote data-fub-source-start="0" data-fub-source-end="80">
        <p data-fub-source-start="12" data-fub-source-end="31">testo annidato</p>
      </blockquote>
    `);

    expect(sourceBlockAt(element, 20)?.tagName).toBe("P");
  });

  it("ignora attributi malformati e applica fallback deterministici", () => {
    const element = preview(`
      <p data-fub-source-start="no" data-fub-source-end="9">rotto</p>
      <p id="primo" data-fub-source-start="10" data-fub-source-end="20">primo</p>
      <p data-fub-source-start="25">incompleto</p>
      <p id="secondo" data-fub-source-start="30" data-fub-source-end="40">secondo</p>
    `);

    expect(sourceBlockAt(element, 2)?.id).toBe("primo");
    expect(sourceBlockAt(element, 25)?.id).toBe("secondo");
    expect(sourceBlockAt(element, 99)?.id).toBe("secondo");
  });
});

describe("versione dichiarata della Lettura (U32)", () => {
  it("annuncia buffer sporco col testo esistente, mai chiave nuda", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    markReadingVersion(el, true);
    expect(el.getAttribute("aria-label")).toBe(describeReadingVersion(true));
    expect(el.getAttribute("data-reading-dirty")).toBe("true");
    expect(describeReadingVersion(true)).not.toContain("document.reading");
    markReadingVersion(el, false);
    expect(el.hasAttribute("data-reading-dirty")).toBe(false);
    expect(describeReadingVersion(false)).not.toContain("document.reading");
  });
});
