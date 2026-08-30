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
import type { RenderedDocument } from "../host/contract";

const rendered = vi.hoisted(() => ({ value: null as RenderedDocument | null }));

vi.mock("../host/ipc", () => ({
  api: {
    queryIndex: async (q: { kind: string; doc?: string }) => {
      if (q.kind === "render_preview") return { kind: "render_preview", value: rendered.value };
      throw new Error(`query inattesa: ${q.kind}`);
    },
  },
}));

import { configurePreview, sourceBlockAt, updatePreview } from "./preview";

describe("un wikilink cliccato in Lettura", () => {
  const calls: [string, string | undefined, string | undefined][] = [];

  beforeEach(() => {
    calls.length = 0;
    document.body.innerHTML = "";
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
