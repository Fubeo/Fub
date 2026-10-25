// @vitest-environment happy-dom
// Il tasto destro sul visualizzatore: l'immagine offre copia e zoom, ogni file
// il suo link da incorporare e l'apertura esterna; sul lettore di audio e
// video resta il menu del sistema.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import type { ResourceDescriptor } from "./media-types";
import { mountMediaSurface, type MediaSurfaceDeps } from "./media-surface";

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
