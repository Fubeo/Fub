// @vitest-environment happy-dom
//
// Il presidio del **gemello**: in modalità Lettura un wikilink è un `<a>` con
// dei `data-`, e chi lo cliccava passava dallo stesso `if (!page) return` che
// fermava l'editor. Due superfici, la stessa premessa sbagliata: che un
// wikilink senza pagina non nomini niente.
//
// Vuoto e assente sono la stessa cosa per un `dataset`, e non per un link:
// `[[#Sezione]]` arriva dal renderer come `data-wikilink-page=""` più
// l'ancora, ed è un riferimento **dentro** la nota che si sta leggendo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../host/contract";

const reso = vi.hoisted(() => ({ value: null as RenderedDocument | null }));

vi.mock("../host/ipc", () => ({
  api: {
    queryIndex: async (q: { kind: string; doc?: string }) => {
      if (q.kind === "render_preview") return { kind: "render_preview", value: reso.value };
      throw new Error(`query inattesa: ${q.kind}`);
    },
  },
}));

import { configurePreview, updatePreview } from "./preview";

describe("un wikilink cliccato in Lettura", () => {
  const chiamate: [string, string | undefined, string | undefined][] = [];

  beforeEach(() => {
    chiamate.length = 0;
    document.body.innerHTML = "";
    configurePreview({
      openPage: async (page, heading, block) => {
        chiamate.push([page, heading, block]);
      },
    });
  });

  async function rendi(html: string): Promise<HTMLElement> {
    reso.value = { html, parts: [] } as unknown as RenderedDocument;
    const el = document.createElement("div");
    document.body.appendChild(el);
    await updatePreview(el, "Nota.md");
    return el;
  }

  it("porta la pagina, l'ancora e il blocco a chi sa aprire", async () => {
    const el = await rendi(
      '<a class="wikilink" data-wikilink-page="Altra" data-wikilink-heading="Sezione">Altra</a>',
    );
    el.querySelector<HTMLElement>("a.wikilink")!.click();
    expect(chiamate).toEqual([["Altra", "Sezione", undefined]]);
  });

  it("e un riferimento senza pagina è un riferimento dentro questa nota", async () => {
    // Chi sa dove siamo è `openWikilink`, che lo chiede a `docAttivo()`: qui si
    // guarda solo che la superficie di lettura **lo lasci passare** invece di
    // spegnere il click sulla soglia.
    const el = await rendi(
      '<a class="wikilink" data-wikilink-page="" data-wikilink-block="blocco">quassù</a>',
    );
    el.querySelector<HTMLElement>("a.wikilink")!.click();
    expect(chiamate).toEqual([["", undefined, "blocco"]]);
  });
});
