// @vitest-environment happy-dom
// Il tasto destro sul visualizzatore: l'immagine offre copia e zoom, ogni file
// il suo link da incorporare e l'apertura esterna; sul lettore di audio e
// video resta il menu del sistema.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import type { ResourceDescriptor } from "./media-types";
import { mountMediaSurface, type MediaSurfaceDeps, type PdfAnnotationsPort } from "./media-surface";
import type { PdfEngine } from "./pdf-view";
import { t } from "../../i18n/strings";

// Quante volte si carica il codice che disegna le annotazioni.
const annotationLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./pdf-annotations", async (importOriginal) => {
  annotationLoads.count++;
  return importOriginal();
});

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

describe("le annotazioni nel visore del PDF", () => {
  // Il primo disegno carica il modulo delle annotazioni con un `import()`:
  // sotto carico supera il secondo di serie di `vi.waitFor`.
  const waitFor = <T>(check: () => T | Promise<T>) => vi.waitFor(check, { timeout: 5000 });

  const PAGE = (id: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"><g fub:page="1" fub:page-size="600 800"><path id="${id}" d="M10 10L50 50"/></g></svg>`;

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

  /// Un vault finto per il `.fubann`: le letture si possono trattenere, e
  /// chi ascolta i cambi si conta.
  function vault(files: Record<string, string>) {
    const listeners = new Set<() => void>();
    const reads: string[] = [];
    let hold: ((id: string) => Promise<string | null>) | null = null;
    const port: PdfAnnotationsPort = {
      available: () => true,
      read: async (id) => {
        reads.push(id);
        if (hold) return hold(id);
        return files[id] ?? null;
      },
      watch: (_id, changed) => {
        listeners.add(changed);
        return () => void listeners.delete(changed);
      },
    };
    return {
      port,
      files,
      reads,
      listeners,
      save: () => {
        for (const listener of [...listeners]) listener();
      },
      holdWith: (next: ((id: string) => Promise<string | null>) | null) => {
        hold = next;
      },
    };
  }

  const made = new Map<string, Blob>();
  beforeEach(() => {
    made.clear();
    let next = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = `blob:fubann-${++next}`;
      made.set(url, blob as Blob);
      return url;
    });
  });

  /// Il visore di `doc/bando.pdf`; `served` dice se il vault serve le
  /// annotazioni (la feature `draw`, col suo «Annota»).
  function mount(files: Record<string, string>, served = true) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const fake = vault(files);
    const deps: MediaSurfaceDeps = {
      ...depsFor("doc/bando.pdf", "application/pdf", new Uint8Array([1, 2])),
      pdfLoader: async () => pdfEngine(2),
      annotate: { available: () => served, run: async () => {} },
      annotations: { ...fake.port, available: () => served },
    };
    const surface = mountMediaSurface("media-pdf", { paneId: "p", documentId: "doc/bando.pdf", parent }, deps);
    return { parent, surface, fake };
  }

  const toggle = (parent: HTMLElement) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${t("media.pdf.annotations")}"]`)!;
  const drawn = async (parent: HTMLElement): Promise<string | null> => {
    const img = parent.querySelector<HTMLImageElement>("img.media-pdf-annotations");
    return img ? made.get(img.getAttribute("src")!)!.text() : null;
  };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 10));

  // Va per prima: il modulo del disegno, una volta caricato, resta.
  it("senza .fubann niente interruttore e il codice del disegno non si scarica", async () => {
    const { parent, surface, fake } = mount({});
    await waitFor(() => expect(parent.querySelector(".media-pdf-sheet")).not.toBeNull());
    expect(fake.reads).toEqual(["doc/bando.pdf.fubann"]);
    await pause();
    expect(toggle(parent).closest("[hidden]")).not.toBeNull();
    expect(parent.querySelector("img")).toBeNull();
    expect(annotationLoads.count).toBe(0);
    surface.destroy();
    expect(fake.listeners.size).toBe(0);
  });

  it("senza la feature il visore non chiede niente", async () => {
    const { parent, surface, fake } = mount({ "doc/bando.pdf.fubann": PAGE("a") }, false);
    await waitFor(() => expect(parent.querySelector(".media-pdf-sheet")).not.toBeNull());
    await pause();
    expect(fake.reads).toEqual([]);
    expect(fake.listeners.size).toBe(0);
    expect(parent.querySelector("img")).toBeNull();
    surface.destroy();
  });

  it("col .fubann le annotazioni stanno sopra la pagina, e un salvataggio le ridisegna", async () => {
    const { parent, surface, fake } = mount({ "doc/bando.pdf.fubann": PAGE("primo") });
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="primo"`));
    expect(annotationLoads.count).toBe(1);
    expect(toggle(parent).closest("[hidden]")).toBeNull();
    expect(toggle(parent).getAttribute("aria-pressed")).toBe("true");
    fake.files["doc/bando.pdf.fubann"] = PAGE("secondo");
    fake.save();
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="secondo"`));
    // Il file che sparisce toglie strato e interruttore.
    delete fake.files["doc/bando.pdf.fubann"];
    fake.save();
    await waitFor(() => expect(parent.querySelector("img.media-pdf-annotations")).toBeNull());
    expect(toggle(parent).closest("[hidden]")).not.toBeNull();
    // E uno che nasce dopo l'apertura (il primo «Annota») lo fa comparire.
    fake.files["doc/bando.pdf.fubann"] = PAGE("nuovo");
    fake.save();
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="nuovo"`));
    expect(toggle(parent).closest("[hidden]")).toBeNull();
    surface.destroy();
    expect(fake.listeners.size).toBe(0);
  });

  it("a raffica vale l'ultimo salvataggio: una lettura vecchia arrivata dopo non lo copre", async () => {
    const { parent, surface, fake } = mount({ "doc/bando.pdf.fubann": PAGE("primo") });
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="primo"`));
    let releaseOld: (text: string) => void = () => {};
    fake.holdWith(() => new Promise((resolve) => (releaseOld = resolve)));
    fake.save();
    fake.holdWith(async () => PAGE("nuovo"));
    fake.save();
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="nuovo"`));
    releaseOld(PAGE("vecchio"));
    await pause();
    expect(await drawn(parent)).toContain(`id="nuovo"`);
    surface.destroy();
  });

  it("smontato a metà lettura, niente resta vivo e niente si disegna", async () => {
    let release: (text: string) => void = () => {};
    const { parent, surface, fake } = mount({});
    await waitFor(() => expect(parent.querySelector(".media-pdf-sheet")).not.toBeNull());
    fake.holdWith(() => new Promise((resolve) => (release = resolve)));
    fake.save();
    surface.destroy();
    expect(fake.listeners.size).toBe(0);
    release(PAGE("tardi"));
    await pause();
    expect(parent.querySelector("img")).toBeNull();
  });

  it("un .fubann ostile non fa partire niente: un <img> da blob, niente script, niente risorse esterne", async () => {
    const fetched = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("niente rete"));
    const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" xmlns:xlink="http://www.w3.org/1999/xlink" fub:version="1" onload="globalThis.__fubann_pwned = 1">
  <script>globalThis.__fubann_pwned = 2</script>
  <g fub:page="1">
    <script>globalThis.__fubann_pwned = 3</script>
    <image href="https://example.invalid/spia.png" width="10" height="10"/>
    <image xlink:href="file:///etc/passwd" width="10" height="10"/>
    <foreignObject width="10" height="10"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://example.invalid/"/></foreignObject>
    <a href="https://example.invalid/"><path id="tratto" d="M0 0L9 9"/></a>
  </g>
</svg>`;
    const { parent, surface } = mount({ "doc/bando.pdf.fubann": hostile });
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="tratto"`));
    const viewer = parent.querySelector(".media-pdf-page")!;
    // Nel DOM della shell entra solo l'immagine: il testo del file resta nel blob.
    expect(viewer.querySelectorAll("script, iframe, svg, image, foreignObject, a")).toHaveLength(0);
    const img = parent.querySelector<HTMLImageElement>("img.media-pdf-annotations")!;
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(made.get(img.getAttribute("src")!)!.type).toBe("image/svg+xml");
    await pause();
    expect((globalThis as { __fubann_pwned?: number }).__fubann_pwned).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();
    surface.destroy();
  });

  it("il PDF cambiato dopo le annotazioni: si disegnano lo stesso, e la riga lo dice", async () => {
    const changed = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:digest="sha256:${"0".repeat(64)}" fub:pages="5"><g fub:page="1"><path id="t" d="M0 0L1 1"/></g></svg>`;
    const { parent, surface } = mount({ "doc/bando.pdf.fubann": changed });
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="t"`));
    const line = parent.querySelector<HTMLElement>(".media-pdf-note")!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toContain(t("pdf.changed"));
    expect(line.textContent).toContain(t("pdf.changed.pages", { before: 5, after: 2 }));
    surface.destroy();
  });

  it("la stessa versione del PDF: nessuna riga", async () => {
    // L'impronta dei byte [1, 2] del PDF finto.
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([1, 2])));
    const hash = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const same = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:digest="sha256:${hash}" fub:pages="2"><g fub:page="1"><path id="t" d="M0 0L1 1"/></g></svg>`;
    const { parent, surface } = mount({ "doc/bando.pdf.fubann": same });
    await waitFor(async () => expect(await drawn(parent)).toContain(`id="t"`));
    await pause();
    expect(parent.querySelector<HTMLElement>(".media-pdf-note")!.hidden).toBe(true);
    surface.destroy();
  });

  it("un .fubann d'un altro programma, o che non si legge, non si disegna: niente interruttore, una riga", async () => {
    const foreign = mount({ "doc/bando.pdf.fubann": `<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>` });
    await waitFor(() => expect(foreign.parent.querySelector(".media-pdf-note")!.textContent).toBe(t("media.pdf.annotations_foreign")));
    expect(toggle(foreign.parent).closest("[hidden]")).not.toBeNull();
    expect(foreign.parent.querySelector("img")).toBeNull();
    foreign.surface.destroy();
    const broken = mount({ "doc/bando.pdf.fubann": "<svg" });
    await waitFor(() => expect(broken.parent.querySelector(".media-pdf-note")!.textContent).toBe(t("media.pdf.annotations_unreadable")));
    expect(toggle(broken.parent).closest("[hidden]")).not.toBeNull();
    broken.surface.destroy();
  });
});
