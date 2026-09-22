import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedContent, RenderedDocument } from "./contract";

const channel = vi.hoisted(() => ({
  queryIndex: vi.fn(),
}));

vi.mock("./ipc", () => ({ api: channel }));

import { renderedDocument, renderedEmbed } from "./query";

describe("query helper di rendering", () => {
  beforeEach(() => {
    channel.queryIndex.mockReset();
  });

  it("apre il documento reso dalla variante corretta", async () => {
    const value = { html: "<p>ok</p>", parts: [] } as RenderedDocument;
    channel.queryIndex.mockResolvedValue({ kind: "render_preview", value });

    await expect(renderedDocument("Nota.md")).resolves.toBe(value);
    expect(channel.queryIndex).toHaveBeenCalledWith({ kind: "render_preview", doc: "Nota.md" });
  });

  it("mantiene il rigetto del canale per un embed", async () => {
    const failure = new Error("canale non disponibile");
    channel.queryIndex.mockRejectedValue(failure);

    await expect(renderedEmbed("Altra", "Sezione", "blocco")).rejects.toBe(failure);
    expect(channel.queryIndex).toHaveBeenCalledWith({
      kind: "render_embed",
      page: "Altra",
      heading: "Sezione",
      block: "blocco",
    });
  });

  it("rifiuta una variante diversa dalla domanda", async () => {
    const value = { doc_id: "Altra", html: "", parts: [] } as EmbedContent;
    channel.queryIndex.mockResolvedValue({ kind: "render_embed", value });

    await expect(renderedDocument("Nota.md")).rejects.toThrow("atteso render_preview");
  });
});
