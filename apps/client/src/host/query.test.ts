import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedContent, RenderedDocument } from "./contract";

const queryIndex = vi.hoisted(() => vi.fn());

vi.mock("./ipc", () => ({
  api: { queryIndex },
}));

import { renderEmbed, renderPreview } from "./query";

const rendered: RenderedDocument = { html: "<p>ciao</p>", parts: [] };
const embedded: EmbedContent = { doc_id: "Nota.md", html: "<p>ritaglio</p>", parts: [] };

describe("helper tipizzati per la resa", () => {
  beforeEach(() => {
    queryIndex.mockReset();
  });

  it("apre la risposta render_preview e costruisce la query", async () => {
    queryIndex.mockResolvedValue({ kind: "render_preview", value: rendered });

    await expect(renderPreview("Nota.md")).resolves.toBe(rendered);
    expect(queryIndex).toHaveBeenCalledWith({ kind: "render_preview", doc: "Nota.md" });
  });

  it("apre la risposta render_embed mantenendo heading e block nullabili", async () => {
    queryIndex.mockResolvedValue({ kind: "render_embed", value: embedded });

    await expect(renderEmbed("Nota.md", "Sezione", "blocco")).resolves.toBe(embedded);
    expect(queryIndex).toHaveBeenCalledWith({
      kind: "render_embed",
      page: "Nota.md",
      heading: "Sezione",
      block: "blocco",
    });
  });

  it("rifiuta una risposta con discriminante diversa per ogni helper", async () => {
    queryIndex.mockResolvedValue({ kind: "render_embed", value: embedded });
    await expect(renderPreview("Nota.md")).rejects.toThrow("atteso render_preview");

    queryIndex.mockResolvedValue({ kind: "render_preview", value: rendered });
    await expect(renderEmbed("Nota.md")).rejects.toThrow("atteso render_embed");
  });

  it("propaga gli errori di trasporto senza sostituirli", async () => {
    const failure = new Error("transport down");
    queryIndex.mockRejectedValue(failure);

    await expect(renderPreview("Nota.md")).rejects.toBe(failure);
    await expect(renderEmbed("Nota.md")).rejects.toBe(failure);
  });
});
