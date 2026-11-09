// @vitest-environment happy-dom
// Il tasto destro sul visualizzatore: l'immagine offre copia e zoom, ogni file
// il suo link da incorporare e l'apertura esterna; sul lettore di audio e
// video resta il menu del sistema.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import type { ResourceDescriptor } from "./media-types";
import { mountMediaSurface, type MediaSurfaceDeps } from "./media-surface";
import type { PdfEngine } from "./pdf-view";
import { t } from "../../i18n/strings";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function depsFor(id: string, mime: string, bytes: Uint8Array): MediaSurfaceDeps & { copied: string[]; external: string[] } {
  const copied: string[] = [];
  const external: string[] = [];
  return {
    copied,
    external,
    transport: {
      open: async () => ({ id, mime, len: bytes.byteLength, handle: "1", revision: "1" }) as unknown as ResourceDescriptor,
      read_chunk: async (_handle, offset, len) => bytes.slice(offset, offset + len).buffer,
      close: async () => {},
    },
    assetUrl: (handle) => `fub-asset://${handle}`,
    copyText: async (text) => void copied.push(text),
    openExternal: (file) => void external.push(file),
  };
}

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:immagine");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("il menu del visualizzatore", () => {
  it("su un'immagine: copia, zoom, il link ![[ ]], l'apertura esterna e l'albero", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const deps = depsFor("foto.png", "image/png", png(4, 3));
    const surface = mountMediaSurface("media-image", { paneId: "p", documentId: "foto.png", parent }, deps);
    await vi.waitFor(() => expect(parent.querySelector(".zoom-view")).not.toBeNull());
    vi.spyOn(document, "elementFromPoint").mockReturnValue(parent.querySelector("img"));
    const menu = surface.contextMenu!({ x: 1, y: 1 })!;
    expect(menu.target).toEqual({ kind: "media", ref: "foto.png" });
    expect(menu.note).toEqual({ kind: "file", id: "foto.png" });
    const items = menu.context as readonly SurfaceMenuItem[];
    expect(items.map((item) => item.id)).toEqual(["media.image.copy", "media.zoom", "media.copy_embed"]);
    items[2]!.run!();
    await vi.waitFor(() => expect(deps.copied).toEqual(["![[foto.png]]"]));
    const tail = menu.tail!;
    (tail[0] as SurfaceMenuItem).run!();
    expect(deps.external).toEqual(["foto.png"]);
    expect(tail[1]).toBe("shell.explorer.reveal");
    surface.destroy();
  });

  it("con un'app Craft installata, «Apri con un'altra app» è il sottomenu con l'app di sistema per prima", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const opened: string[] = [];
    const deps: MediaSurfaceDeps & { external: string[] } = {
      ...depsFor("foto.png", "image/png", png(4, 3)),
      openWith: {
        installed: () => true,
        editors: async () => [
          { id: "photocraft", name: "PhotoCraft", opens: ["png"], installed: true, running: false },
          { id: "lightcraft", name: "LightCraft", opens: ["png"], installed: false, running: false },
        ],
        open: async (doc, editor) => {
          opened.push(`${editor}:${doc}`);
          return { editor, how: "new_process" };
        },
      },
    };
    const surface = mountMediaSurface("media-image", { paneId: "p", documentId: "foto.png", parent }, deps);
    await vi.waitFor(() => expect(parent.querySelector(".zoom-view")).not.toBeNull());
    vi.spyOn(document, "elementFromPoint").mockReturnValue(parent.querySelector("img"));
    const open = surface.contextMenu!({ x: 1, y: 1 })!.tail![0] as SurfaceMenuItem;
    expect(open.id).toBe("media.open_external");
    expect(open.label).toBe("Apri con un'altra app");
    expect(open.run).toBeUndefined();
    const items = (await open.load!()) as readonly SurfaceMenuItem[];
    expect(items.map((item) => [item.id, item.label, item.enabled, item.description])).toEqual([
      ["media.open_with.system", "L'app predefinita del sistema", undefined, undefined],
      ["media.open_with.photocraft", "PhotoCraft", undefined, undefined],
      ["media.open_with.lightcraft", "LightCraft", false, "Non installata"],
    ]);
    items[0]!.run!();
    expect(deps.external).toEqual(["foto.png"]);
    items[1]!.run!();
    await vi.waitFor(() => expect(opened).toEqual(["photocraft:foto.png"]));
    surface.destroy();
  });

  it("sul lettore lascia il menu del sistema", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    const parent = document.createElement("div");
    document.body.append(parent);
    const surface = mountMediaSurface("media-audio", { paneId: "p", documentId: "voce.mp3", parent }, depsFor("voce.mp3", "audio/mpeg", new Uint8Array(8)));
    await vi.waitFor(() => expect(parent.querySelector("audio")).not.toBeNull());
    vi.spyOn(document, "elementFromPoint").mockReturnValue(parent.querySelector("audio"));
    expect(surface.contextMenu!({ x: 1, y: 1 })).toBeNull();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(parent.firstElementChild);
    expect(surface.contextMenu!({ x: 1, y: 1 })!.target.kind).toBe("media");
    surface.destroy();
  });
});

describe("la pagina del PDF nella banda", () => {
  function pdfEngine(pageCount: number): PdfEngine {
    return {
      pageCount,
      search: async () => [],
      renderPage: async () => {},
      pageSize: async () => [600, 800] as const,
      renderArea: async () => true,
      destroy: () => {},
    };
  }

  it("dice «Pagina N di M» e la cambia quando la pagina cambia", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const deps: MediaSurfaceDeps = { ...depsFor("manuale.pdf", "application/pdf", new Uint8Array([1, 2])), pdfLoader: async () => pdfEngine(12) };
    const surface = mountMediaSurface("media-pdf", { paneId: "p", documentId: "manuale.pdf#page=3", parent }, deps);
    const changes = vi.fn();
    const unsubscribe = surface.status!.subscribe(changes);
    expect(surface.status!.counts).toBe(false);
    await vi.waitFor(() => expect(surface.status!.items()).toEqual([{ id: "page", text: t("media.pdf.page", { page: 3, count: 12 }) }]));
    expect(changes).toHaveBeenCalled();
    changes.mockClear();
    surface.showPage!(7);
    await vi.waitFor(() => expect(surface.status!.items()).toEqual([{ id: "page", text: t("media.pdf.page", { page: 7, count: 12 }) }]));
    expect(changes).toHaveBeenCalled();
    // Due pagine affiancate: «Pagine 7–8 di 12».
    parent.querySelector<HTMLButtonElement>(`button[aria-label="${t("media.pdf.two_pages")}"]`)!.click();
    await vi.waitFor(() => expect(surface.status!.items()[0]?.text).toBe(t("media.pdf.pages", { first: 7, last: 8, count: 12 })));
    // La pagina sta nella banda; la riga del visore la tiene per il lettore di schermo.
    expect(parent.querySelector(".media-pdf > [role=status]")!.classList.contains("sr-only")).toBe(true);
    unsubscribe();
    surface.destroy();
    expect(surface.status!.items()).toEqual([]);
  });

  it("un PDF che non si apre: la nota d'errore e niente voce nella banda", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const deps: MediaSurfaceDeps = {
      ...depsFor("rotto.pdf", "application/pdf", new Uint8Array([1])),
      pdfLoader: async () => Promise.reject(new Error("non è un PDF")),
    };
    const surface = mountMediaSurface("media-pdf", { paneId: "p", documentId: "rotto.pdf", parent }, deps);
    await vi.waitFor(() => expect(parent.textContent).toContain("non è un PDF"));
    expect(surface.status!.items()).toEqual([]);
    surface.destroy();
  });

  it("un'immagine non dice niente nella banda", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const surface = mountMediaSurface("media-image", { paneId: "p", documentId: "foto.png", parent }, depsFor("foto.png", "image/png", png(4, 3)));
    await vi.waitFor(() => expect(parent.querySelector(".zoom-view")).not.toBeNull());
    expect(surface.status!.items()).toEqual([]);
    surface.destroy();
  });
});

describe("i dati della foto", () => {
  it("sotto un'immagine, dopo la foto, una volta, con l'id senza frammento", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const shown: string[] = [];
    const deps: MediaSurfaceDeps = {
      ...depsFor("foto.jpg", "image/png", png(4, 3)),
      photoData: {
        show: (root, doc) => {
          shown.push(doc);
          const row = document.createElement("section");
          row.className = "photo-data";
          root.append(row);
        },
      },
    };
    const surface = mountMediaSurface("media-image", { paneId: "p", documentId: "foto.jpg", parent }, deps);
    await vi.waitFor(() => expect(parent.querySelector(".photo-data")).not.toBeNull());
    expect(shown).toEqual(["foto.jpg"]);
    const root = parent.querySelector(".photo-data")!.parentElement!;
    expect(root.lastElementChild?.className).toBe("photo-data");
    expect(root.querySelector(".zoom-view")).not.toBeNull();
    surface.destroy();
  });

  it("anche sotto la frase di una foto che non si apre", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const shown: string[] = [];
    const base = depsFor("foto.heic", "image/heic", new Uint8Array(4));
    const deps: MediaSurfaceDeps = {
      ...base,
      transport: { ...base.transport, open: async () => Promise.reject(new Error("non si apre")) },
      photoData: { show: (_root, doc) => void shown.push(doc) },
    };
    const surface = mountMediaSurface("media-image", { paneId: "p", documentId: "foto.heic", parent }, deps);
    await vi.waitFor(() => expect(shown).toEqual(["foto.heic"]));
    expect(parent.textContent).toContain("non si apre");
    surface.destroy();
  });

  it("non sotto un audio", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    const parent = document.createElement("div");
    document.body.append(parent);
    const shown: string[] = [];
    const deps: MediaSurfaceDeps = { ...depsFor("voce.mp3", "audio/mpeg", new Uint8Array(8)), photoData: { show: (_r, doc) => void shown.push(doc) } };
    const surface = mountMediaSurface("media-audio", { paneId: "p", documentId: "voce.mp3", parent }, deps);
    await vi.waitFor(() => expect(parent.querySelector("audio")).not.toBeNull());
    expect(shown).toEqual([]);
    surface.destroy();
  });
});
