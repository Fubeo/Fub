import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedContent, RenderedDocument } from "./contract";

const queryIndex = vi.hoisted(() => vi.fn());

vi.mock("./ipc", () => ({
  api: { queryIndex },
}));

import { documentOutline, documentsByFileName, renderEmbed, renderPreview } from "./query";

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

  it("mantiene la domanda dell'embed quando il canale rifiuta", async () => {
    const failure = new Error("canale non disponibile");
    queryIndex.mockRejectedValue(failure);

    await expect(renderEmbed("Altra", "Sezione", "blocco")).rejects.toBe(failure);
    expect(queryIndex).toHaveBeenCalledWith({
      kind: "render_embed",
      page: "Altra",
      heading: "Sezione",
      block: "blocco",
    });
  });
});

describe("i titoli di un documento", () => {
  beforeEach(() => {
    queryIndex.mockReset();
  });

  it("chiede l'outline del documento e ne apre la risposta", async () => {
    const outline = [{ level: 1, text: "Ciclo dell'acqua", slug: "ciclo-dell-acqua", span: { start: 0, end: 0 }, explicit_anchor: null }];
    queryIndex.mockResolvedValue({ kind: "outline", value: outline });

    await expect(documentOutline("disegni/acqua.svg")).resolves.toBe(outline);
    expect(queryIndex).toHaveBeenCalledWith({ kind: "outline", doc: "disegni/acqua.svg" });
  });

  it("rifiuta una risposta con discriminante diversa", async () => {
    queryIndex.mockResolvedValue({ kind: "render_embed", value: embedded });
    await expect(documentOutline("disegni/acqua.svg")).rejects.toThrow("atteso outline");
  });
});

// IMP-2803: «Esami.base» cerca il file per nome intero, estensione compresa;
// il campo dei nomi dell'indice è senza estensione e da solo non lo trova.
describe("i documenti per nome di file", () => {
  beforeEach(() => {
    queryIndex.mockReset();
  });

  const answer = (...docs: string[]) => ({ kind: "documents", value: { items: docs.map((doc) => ({ doc })), offset: 0, total: docs.length } });

  it("chiede il nome senza estensione e il predicato del file, e tiene solo il nome esatto", async () => {
    queryIndex.mockResolvedValue(answer("Area/Esami/Esami.base", "Archivio/Esami vecchi.base"));
    await expect(documentsByFileName("esami.BASE")).resolves.toEqual(["Area/Esami/Esami.base"]);
    const [query] = queryIndex.mock.calls[0]!;
    expect(query.kind).toBe("documents");
    const literals = query.matching.any[0].all;
    expect(literals[0].predicate).toMatchObject({ kind: "text", text: "esami", fields: ["name"], partial_last_term: false });
    expect(literals[1]).toEqual({ negated: false, predicate: { kind: "file", extension: "BASE" } });
  });

  it("con una barra il testo è la coda del path", async () => {
    queryIndex.mockResolvedValue(answer("Area/Esami/Esami.base", "Lavoro/Esami.base"));
    await expect(documentsByFileName("Esami/Esami.base")).resolves.toEqual(["Area/Esami/Esami.base"]);
    expect(queryIndex.mock.calls[0]![0].matching.any[0].all[0].predicate.text).toBe("Esami");
  });

  it("un nome con spazi e trattini resta intero davanti all'estensione", async () => {
    queryIndex.mockResolvedValue(answer("Tesi/Capitolo 3 - Analisi.pdf.fubann"));
    await expect(documentsByFileName("Capitolo 3 - Analisi.pdf.fubann")).resolves.toEqual(["Tesi/Capitolo 3 - Analisi.pdf.fubann"]);
    const literals = queryIndex.mock.calls[0]![0].matching.any[0].all;
    expect(literals[0].predicate.text).toBe("Capitolo 3 - Analisi.pdf");
    expect(literals[1].predicate.extension).toBe("fubann");
  });

  it("un testo senza estensione non domanda niente", async () => {
    await expect(documentsByFileName("Esami")).resolves.toEqual([]);
    await expect(documentsByFileName("Esami.")).resolves.toEqual([]);
    await expect(documentsByFileName(".base")).resolves.toEqual([]);
    await expect(documentsByFileName("Report v1. 2")).resolves.toEqual([]);
    expect(queryIndex).not.toHaveBeenCalled();
  });
});
