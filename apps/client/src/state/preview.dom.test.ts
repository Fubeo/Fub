// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CraftPreview } from "../host/craft";

const fake = vi.hoisted(() => ({
  render: vi.fn(),
  notify: vi.fn(),
  resolve: vi.fn(),
  asks: [] as Array<{ doc: string; size: string; options: unknown }>,
  preview: null as CraftPreview | null,
}));
vi.mock("../host/query", () => ({
  renderEmbed: fake.render,
  resolvedReference: fake.resolve,
  settings: async () => [],
}));
vi.mock("../ui/sanitize", async (original) => ({
  ...await original<typeof import("../ui/sanitize")>(),
  setSanitizedHtml: (el: HTMLElement, html: string) => { el.textContent = html; },
}));
vi.mock("../ui/notify", () => ({ notify: fake.notify }));
vi.mock("./store", () => ({ state: { currentDoc: "Nota.md", handledExtensions: ["md", "vectorcraft"] } }));
vi.mock("./layout", () => ({ activeDoc: () => null }));
vi.mock("./kernel", () => ({ onEvent: () => () => {} }));
// Le anteprime dei file Craft: lo store finto risponde e conta le domande.
vi.mock("./craft-previews", () => ({
  previewOf: async (doc: string, size: string, options: unknown) => {
    fake.asks.push({ doc, size, options });
    return fake.preview ? { preview: fake.preview, renderError: null } : null;
  },
  watchCraftPreviews: () => {},
  appPreviewSubject: (doc: string) => /\.pdf$/i.test(doc) ? "pdf" : /\.(docx|odt|rtf|doc)$/i.test(doc) ? "document" : null,
}));

import { hidePreview, previewStateForTest, showStickyPreview } from "./preview";
import { mountLinkPreview } from "../ui/link-preview";
import { openLifetime } from "../ui/lifetime";

afterEach(() => {
  hidePreview();
  fake.render.mockReset();
  fake.notify.mockReset();
  fake.resolve.mockReset();
  fake.asks = [];
  fake.preview = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("preview ownership", () => {
  it("disposes an in-flight preview and never paints an old reply after remount", async () => {
    const box = document.createElement("div");
    document.body.append(box);
    let resolve!: (value: { html: string }) => void;
    const promise = new Promise<{ html: string }>((accept) => {
      resolve = accept;
    });
    fake.render.mockReturnValueOnce(promise);
    const stale = showStickyPreview("old.md", box);
    hidePreview();
    fake.render.mockResolvedValueOnce({ html: "new text" });
    await showStickyPreview("new.md", box);
    resolve({ html: "old text" });
    await stale;
    expect(box.querySelectorAll(".doc-preview")).toHaveLength(1);
    expect(box.textContent).toBe("new text");
    expect(previewStateForTest()).toEqual({ doc: "new.md", sticky: true });
    expect(document.activeElement).toBe(box.querySelector(".doc-preview"));
  });
});

describe("l'anteprima al passaggio su un file Craft", () => {
  const LOGO = "Disegni/logo.vectorcraft";
  const FIGURE = `<figure class="fub-craft" data-embed-kind="craft" data-embed-doc="${LOGO}" data-craft-app="vectorcraft">`
    + "<figcaption>logo.vectorcraft</figcaption></figure>";
  const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

  function preview(image: boolean): CraftPreview {
    return {
      version: 2,
      doc: LOGO,
      revision: "r1",
      size: "small",
      origin: image ? "file" : "none",
      queued: false,
      image: image ? { media_type: "image/png", data: PNG, width: 40, height: 30, orientation: 1 } : null,
      missing: image ? null : "absent",
      limit_bytes: null,
      info: { app: "vectorcraft", editor: "VectorCraft", format_version: null, bytes: 2048, photo: null, edits: [], xmp: null },
      render: image ? null : { app: "VectorCraft", consent: "ask" },
    };
  }

  it("il passaggio su [[logo.vectorcraft]] mostra la figura senza chiedere di farla, e la chiusura libera il blob", async () => {
    fake.preview = preview(true);
    fake.resolve.mockResolvedValue({ doc: LOGO });
    fake.render.mockResolvedValue({ doc_id: LOGO, html: FIGURE, parts: [] });
    const revoked: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:logo");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => { revoked.push(url); });
    const life = openLifetime();
    mountLinkPreview(life);
    const link = document.createElement("a");
    link.className = "wikilink";
    link.dataset.wikilinkPage = "logo.vectorcraft";
    link.textContent = "logo.vectorcraft";
    document.body.append(link);
    link.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, ctrlKey: true }));
    await vi.waitFor(() => expect(document.querySelector(".link-preview .doc-preview figure.craft-figure img")).not.toBeNull());
    const shown = document.querySelector<HTMLImageElement>(".link-preview figure.craft-figure img")!;
    expect(shown.getAttribute("src")).toBe("blob:logo");
    expect(shown.alt).toBe("Anteprima di logo.vectorcraft");
    expect(document.querySelector(".link-preview figcaption")!.textContent).toBe("logo.vectorcraft");
    // Il segnaposto del provider non entra nella scheda.
    expect(document.querySelector(".link-preview .fub-craft")).toBeNull();
    expect(fake.render).toHaveBeenCalledWith(LOGO, null, null);
    expect(fake.asks).toEqual([{ doc: LOGO, size: "small", options: undefined }]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".link-preview")).toBeNull();
    expect(revoked).toEqual(["blob:logo"]);
    life.close();
  });

  it("senza anteprima la scheda è il riquadro col nome, e l'app non si avvia", async () => {
    fake.preview = preview(false);
    fake.render.mockResolvedValue({ doc_id: LOGO, html: FIGURE, parts: [] });
    const box = document.createElement("div");
    document.body.append(box);
    await showStickyPreview(LOGO, box);
    await vi.waitFor(() => expect(box.querySelector(".craft-figure-box")).not.toBeNull());
    expect(box.querySelector(".craft-figure-box")!.textContent).toContain("logo.vectorcraft");
    expect(box.querySelector("img")).toBeNull();
    expect(fake.asks.map((ask) => ask.options)).toEqual([undefined]);
  });

  it("un'altra nota dopo la figura torna HTML, e la figura vecchia non resta", async () => {
    fake.preview = preview(true);
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:logo");
    const revoked: string[] = [];
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => { revoked.push(url); });
    fake.render.mockResolvedValueOnce({ doc_id: LOGO, html: FIGURE, parts: [] });
    const box = document.createElement("div");
    document.body.append(box);
    await showStickyPreview(LOGO, box);
    await vi.waitFor(() => expect(box.querySelector("figure.craft-figure")).not.toBeNull());
    fake.render.mockResolvedValueOnce({ doc_id: "Altra.md", html: "altro testo", parts: [] });
    await showStickyPreview("Altra.md", box);
    expect(box.textContent).toBe("altro testo");
    expect(revoked).toEqual(["blob:logo"]);
    for (const ask of fake.asks) expect(ask.options).toBeUndefined();
  });
});

describe("l'anteprima al passaggio su un PDF o un documento", () => {
  const GUIDA = "Manuali/guida.pdf";
  const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

  function preview(doc: string, image: boolean): CraftPreview {
    const app = doc.endsWith(".pdf") ? "pdf" : "document";
    return {
      version: 2,
      doc,
      revision: "r1",
      size: "small",
      origin: image ? "file" : "none",
      queued: false,
      image: image ? { media_type: "image/png", data: PNG, width: 181, height: 256, orientation: 1 } : null,
      missing: image ? null : "absent",
      limit_bytes: null,
      info: { app, editor: app === "pdf" ? "PdfCraft" : "WordCraft", format_version: null, bytes: 4096, photo: null, edits: [], xmp: null },
      render: image ? null : { app: app === "pdf" ? "PdfCraft" : "WordCraft", consent: "ask" },
    };
  }

  function hover(page: string): void {
    const link = document.createElement("a");
    link.className = "wikilink";
    link.dataset.wikilinkPage = page;
    link.textContent = page;
    document.body.append(link);
    link.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, ctrlKey: true }));
  }

  it("il passaggio su [[guida.pdf]] con l'anteprima mostra la prima pagina col nome, senza farla fare", async () => {
    fake.preview = preview(GUIDA, true);
    fake.resolve.mockResolvedValue({ doc: GUIDA });
    fake.render.mockResolvedValue({ doc_id: GUIDA, html: "guida.pdf", parts: [] });
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:guida");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const life = openLifetime();
    mountLinkPreview(life);
    hover("guida.pdf");
    await vi.waitFor(() => expect(document.querySelector(".link-preview figure.craft-figure img")).not.toBeNull());
    const shown = document.querySelector<HTMLImageElement>(".link-preview figure.craft-figure img")!;
    expect(shown.classList.contains("craft-figure-page")).toBe(true);
    expect(shown.getAttribute("src")).toBe("blob:guida");
    expect(document.querySelector(".link-preview figcaption")!.textContent).toBe("guida.pdf");
    // Lo store finto non ha `renderPreview`: una richiesta all'app getterebbe.
    // Le domande sono tutte `craft.preview` piccole (lo store vero ne fa una).
    expect(fake.asks.length).toBeGreaterThan(0);
    for (const ask of fake.asks) expect(ask).toEqual({ doc: GUIDA, size: "small", options: undefined });
    life.close();
  });

  it("senza anteprima il passaggio su [[guida.pdf]] non apre niente, come un allegato", async () => {
    fake.preview = preview(GUIDA, false);
    fake.resolve.mockResolvedValue({ doc: GUIDA });
    const life = openLifetime();
    mountLinkPreview(life);
    hover("guida.pdf");
    await vi.waitFor(() => expect(fake.asks).toHaveLength(1));
    await new Promise((accept) => setTimeout(accept, 10));
    expect(document.querySelector(".link-preview")).toBeNull();
    expect(fake.render).not.toHaveBeenCalled();
    life.close();
  });

  it("senza anteprima il passaggio su un PDF mostra ciò che il canale dati rende", async () => {
    fake.preview = preview(GUIDA, false);
    fake.render.mockResolvedValue({ doc_id: GUIDA, html: "la resa del PDF", parts: [] });
    const box = document.createElement("div");
    document.body.append(box);
    await showStickyPreview(GUIDA, box);
    expect(box.textContent).toBe("la resa del PDF");
    expect(box.querySelector("figure")).toBeNull();
  });

  it("un documento di Word con l'anteprima è la stessa figura", async () => {
    const LETTERA = "Lettere/Lettera.DOCX";
    fake.preview = preview(LETTERA, true);
    fake.render.mockResolvedValue({ doc_id: LETTERA, html: "il testo", parts: [] });
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:lettera");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const box = document.createElement("div");
    document.body.append(box);
    await showStickyPreview(LETTERA, box);
    await vi.waitFor(() => expect(box.querySelector("figure.craft-figure img.craft-figure-page")).not.toBeNull());
    expect(box.querySelector("figcaption")!.textContent).toBe("Lettera.DOCX");
  });

  it("un guasto della resa con l'anteprima mostra comunque la figura", async () => {
    fake.preview = preview(GUIDA, true);
    fake.render.mockRejectedValue(new Error("formato non supportato"));
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:guida");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const box = document.createElement("div");
    document.body.append(box);
    await showStickyPreview(GUIDA, box);
    await vi.waitFor(() => expect(box.querySelector("figure.craft-figure img")).not.toBeNull());
  });
});
