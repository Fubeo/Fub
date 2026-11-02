// @vitest-environment happy-dom
//
// La scheda dei file Craft e degli XMP (N7) contro l'host finto: ogni forma
// della risposta di `craft.preview`, la domanda con `render: true` fatta una
// volta sola, il `job_done` che porta l'immagine, la revisione che cambia, la
// risposta che arriva a scheda chiusa, il componente spento, e la vista XMP
// con ogni campo e con ogni campo assente.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCraft, FakeCraftDoc, FakeHost } from "../../host/fake";
import type { CraftPreviewImage, CraftXmpInfo } from "../../host/craft";
import type { EditorSurface } from "../core/registry";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
  };
});

const { createFakeHost } = await import("../../host/fake");

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/// Aspetta che `ready` sia vera: il modulo della scheda arriva con un
/// `import()`, le risposte del finto con delle promesse.
async function until(ready: () => boolean): Promise<void> {
  for (let round = 0; round < 100 && !ready(); round++) await settle();
  expect(ready()).toBe(true);
}

function png(width: number, height: number): CraftPreviewImage {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return { media_type: "image/png", data: btoa(String.fromCharCode(...bytes)), width, height };
}

const LOGO = "Disegni/logo.vectorcraft";
const XMP = "Foto/IMG_0001.xmp";
const BYTES = { bytes: new Uint8Array([0x7b, 0x7d, 0xff]), mime: "application/octet-stream" };

interface Mounted {
  host: FakeHost;
  surface: EditorSurface;
  parent: HTMLElement;
  opened: string[];
  searched: string[];
}

async function mount(doc: string, craft: FakeCraft, profile = doc.endsWith(".xmp") ? "xmp" : "craft"): Promise<Mounted> {
  const host = createFakeHost({ resources: { [LOGO]: BYTES, [XMP]: BYTES }, craft });
  box.host = host;
  vi.resetModules();
  const store = await import("../../state/store");
  store.state.vaultRoot = "/vault";
  const kernel = await import("../../state/kernel");
  const { openLifetime } = await import("../../ui/lifetime");
  const previews = await import("../../state/craft-previews");
  const { mountCraftSurface } = await import("./index");
  await kernel.startKernelRouter();
  previews.mountCraftPreviews(openLifetime());
  const parent = document.createElement("div");
  document.body.replaceChildren(parent);
  const opened: string[] = [];
  const searched: string[] = [];
  const read = await host.module.api.readDocument(doc);
  const surface = mountCraftSurface(profile, { paneId: "p1", documentId: doc, parent, formatId: read.format_id, revision: read.revision }, {
    onOpenDocument: (id) => void opened.push(id),
    onSearchTag: (tag) => void searched.push(tag),
  });
  return { host, surface, parent, opened, searched };
}

function previewCalls(host: FakeHost): Record<string, unknown>[] {
  return host.atGate("invokeCommand")
    .filter((call) => call.args[0] === "craft.preview")
    .map((call) => call.args[1] as Record<string, unknown>);
}

const text = (parent: HTMLElement, selector: string) => parent.querySelector(selector)?.textContent ?? null;
const craft = (doc: FakeCraftDoc): FakeCraft => ({ docs: { [LOGO]: doc } });

beforeEach(() => {
  box.host = null;
});

describe("la scheda di un file Craft", () => {
  it("con l'anteprima nel file: la vista delle immagini e sotto la riga dei dati", async () => {
    const { host, parent, surface } = await mount(LOGO, craft({ image: png(256, 180), info: { format_version: "4" } }));
    await until(() => parent.querySelector(".media-image") !== null);
    expect(surface.family).toBe("craft");
    expect(parent.querySelector(".zoom-view")).not.toBeNull();
    expect(text(parent, ".craft-info")).toBe("Disegno di VectorCraft · formato 4 · 3 B");
    expect(parent.querySelector(".zoom-stage")?.getAttribute("aria-label") ?? parent.innerHTML).toContain("logo.vectorcraft");
    expect(previewCalls(host)).toEqual([{ doc: LOGO, size: "large", render: false }]);
    expect(parent.querySelector(".craft-render")).toBeNull();
  });

  it("un'immagine di 1×1 e una di 8000×8000 si mostrano tutte e due", async () => {
    for (const [w, h] of [[1, 1], [8000, 8000]] as const) {
      const { parent } = await mount(LOGO, craft({ image: png(w, h) }));
      await until(() => parent.querySelector(".media-image") !== null);
      expect(parent.querySelector("img")).not.toBeNull();
    }
  });

  it("senza anteprima e senza app: il riquadro col nome e i dati, nessun pulsante", async () => {
    const { host, parent } = await mount(LOGO, craft({ info: { app: "photocraft", editor: "PhotoCraft" } }));
    await until(() => parent.querySelector(".craft-empty") !== null);
    expect(text(parent, ".craft-empty-name")).toBe("logo.vectorcraft");
    expect(text(parent, ".craft-info")).toBe("Immagine di PhotoCraft · 3 B");
    expect(text(parent, ".craft-empty-state")).toBe("Il file non porta un'anteprima");
    expect(parent.querySelector(".craft-render")).toBeNull();
    expect(previewCalls(host).every((args) => args.render === false)).toBe(true);
  });

  it("con l'app installata chiede l'anteprima una volta da sola, e mentre aspetta dice «Preparo l'anteprima…»", async () => {
    const { host, parent } = await mount(LOGO, craft({ render: { app: "VectorCraft", done: null } }));
    await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
    expect(parent.querySelector(".craft-render")).toBeNull();
    // Un altro giro (la lingua, un avviso) non la richiede.
    host.emit({ type: "job_progress", id: "x", progress: { done: 0, total: null } } as never);
    await settle();
    expect(previewCalls(host).filter((args) => args.render === true)).toHaveLength(1);
  });

  it("il job_done porta l'immagine nella scheda", async () => {
    const { parent } = await mount(LOGO, craft({ render: { app: "VectorCraft", done: png(64, 32) } }));
    await until(() => parent.querySelector(".media-image") !== null);
    expect(text(parent, ".craft-info")).toBe("Disegno di VectorCraft · 3 B");
  });

  it("un job finito male rimette il pulsante, che chiede render: true una volta sola", async () => {
    const error = { kind: "unserved" as const, message: "Nessuna app Craft installata può fare l'anteprima." };
    const { host, parent } = await mount(LOGO, craft({ render: { app: "VectorCraft", done: error } }));
    await until(() => parent.querySelector(".craft-render") !== null);
    expect(text(parent, ".craft-empty-state")).toBe(`L'anteprima non è riuscita: ${error.message}`);
    const button = parent.querySelector<HTMLButtonElement>(".craft-render")!;
    expect(button.textContent).toBe("Crea l'anteprima con VectorCraft");
    const before = previewCalls(host).filter((args) => args.render === true).length;
    button.click();
    button.click();
    await settle();
    expect(previewCalls(host).filter((args) => args.render === true)).toHaveLength(before + 1);
  });

  it("un job_done di un altro documento non tocca la scheda", async () => {
    const { host, parent } = await mount(LOGO, craft({ render: { app: "VectorCraft", done: null } }));
    await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
    const other = { ...((await host.module.api.invokeCommand("craft.preview", { doc: XMP, size: "large" })).effect as { payload: unknown }).payload as object };
    host.emit({ type: "job_done", id: "j", job: "craft.render", result: { Ok: { ...other, image: png(2, 2), origin: "cli" } } });
    await settle();
    expect(text(parent, ".craft-empty-state")).toBe("Preparo l'anteprima…");
    expect(parent.querySelector(".media-image")).toBeNull();
  });

  it("un file oltre 64 MiB dice che è troppo grande, senza pulsante", async () => {
    const { parent } = await mount(LOGO, craft({ info: { bytes: 64 * 1024 * 1024 + 1 }, render: { app: "VectorCraft", done: null } }));
    await until(() => parent.querySelector(".craft-empty") !== null);
    expect(text(parent, ".craft-empty-state")).toBe("File troppo grande per l'anteprima");
    expect(parent.querySelector(".craft-render")).toBeNull();
  });

  it("il nome di un'app che il catalogo non ha si mostra com'è", async () => {
    const { parent } = await mount(LOGO, craft({ info: { editor: "VectorCraft Nightly" } }));
    await until(() => parent.querySelector(".craft-info") !== null);
    expect(text(parent, ".craft-info")).toBe("Disegno di VectorCraft Nightly · 3 B");
  });

  it("una revisione che cambia a scheda aperta si richiede e si ridisegna", async () => {
    const { host, parent } = await mount(LOGO, craft({}));
    await until(() => parent.querySelector(".craft-info") !== null);
    expect(text(parent, ".craft-info")).toBe("Disegno di VectorCraft · 3 B");
    host.writeFromOutside(LOGO, "{\"x\":12345}");
    await until(() => text(parent, ".craft-info") === "Disegno di VectorCraft · 11 B");
    expect(previewCalls(host)).toHaveLength(2);
  });

  it("la risposta che arriva a scheda chiusa si scarta", async () => {
    const host = createFakeHost({ resources: { [LOGO]: BYTES }, craft: craft({ image: png(4, 4) }) });
    const release = host.throttle("invokeCommand");
    box.host = host;
    vi.resetModules();
    (await import("../../state/store")).state.vaultRoot = "/vault";
    const { mountCraftSurface } = await import("./index");
    const parent = document.createElement("div");
    const surface = mountCraftSurface("craft", { paneId: "p", documentId: LOGO, parent }, { onOpenDocument: () => {}, onSearchTag: () => {} });
    await until(() => previewCalls(host).length === 1);
    surface.destroy();
    release();
    for (let i = 0; i < 5; i++) await settle();
    expect(parent.children).toHaveLength(0);
  });

  it("col componente spento dice ciò che dice un file senza superficie", async () => {
    const { parent } = await mount(LOGO, { component: false });
    await until(() => text(parent, ".craft-status") === "Nessuna superficie disponibile");
  });

  it("è in sola lettura, con la sola modalità di lettura", async () => {
    const { surface, parent } = await mount(LOGO, craft({}));
    expect(surface.modes.map((mode) => mode.id)).toEqual(["view"]);
    surface.setMode("view");
    surface.setReadOnly?.(true);
    surface.setReadOnly?.(false);
    expect(parent.querySelector("[contenteditable]")).toBeNull();
    expect(() => surface.setMode("source")).toThrow();
  });
});

describe("la scheda di un XMP", () => {
  const full: CraftXmpInfo = { rating: 3, label: "Red", flag: "pick", keywords: ["New York", "#mare", "mare", "  "] };

  async function xmp(xmpInfo: CraftXmpInfo | null, photo: string | null = null, edits: string[] = []) {
    return mount(XMP, { docs: { [XMP]: { info: { xmp: xmpInfo, photo, edits } } } });
  }

  it("mostra voto, etichetta, scelta, parole chiave, foto e copie, e la riga su LightCraft", async () => {
    const m = await xmp(full, "Foto/IMG_0001.CR3", ["Foto/IMG_0001-Edit.psd"]);
    const { parent } = m;
    await until(() => parent.querySelector(".craft-xmp") !== null);
    expect(text(parent, ".craft-xmp-title")).toBe("IMG_0001.xmp");
    expect(text(parent, ".craft-info")).toBe("Dati di una foto per LightCraft · 3 B");
    const stars = parent.querySelector(".craft-xmp-stars")!;
    expect(stars.getAttribute("aria-label")).toBe("3 stelle su 5");
    expect(stars.querySelectorAll('[data-on="true"]')).toHaveLength(3);
    expect(parent.querySelector(".craft-xmp-label")?.getAttribute("data-color")).toBe("red");
    expect(text(parent, ".craft-xmp-label")).toBe("Rossa");
    expect([...parent.querySelectorAll("dd")].map((dd) => dd.textContent)).toContain("Scelta");
    const tags = [...parent.querySelectorAll<HTMLButtonElement>(".craft-xmp-tag")];
    expect(tags.map((tag) => tag.textContent)).toEqual(["#New-York", "#mare"]);
    tags[0]!.click();
    expect(m.searched).toEqual(["New-York"]);
    const links = [...parent.querySelectorAll<HTMLButtonElement>(".craft-xmp-link")];
    expect(links.map((link) => link.textContent)).toEqual(["IMG_0001.CR3", "IMG_0001-Edit.psd"]);
    links[0]!.click();
    links[1]!.click();
    expect(m.opened).toEqual(["Foto/IMG_0001.CR3", "Foto/IMG_0001-Edit.psd"]);
    expect(text(parent, ".craft-xmp-note")).toContain("⌘S");
  });

  it("con ogni campo assente dice che cosa manca, e le copie non hanno una riga", async () => {
    const { parent } = await xmp(null);
    await until(() => parent.querySelector(".craft-xmp") !== null);
    expect([...parent.querySelectorAll(".craft-xmp-absent")].map((each) => each.textContent)).toEqual([
      "Nessun voto",
      "Nessuna etichetta",
      "Nessuna",
      "Nessuna parola chiave",
      "La foto non è nel vault",
    ]);
    expect(parent.querySelector(".craft-xmp-edits")).toBeNull();
    expect(parent.querySelector(".craft-xmp-note")).not.toBeNull();
  });

  it("-1 è «Scartata», un'etichetta che LightCraft non scrive resta senza colore", async () => {
    const { parent } = await xmp({ rating: -1, label: "Da rivedere", flag: "reject", keywords: [] });
    await until(() => parent.querySelector(".craft-xmp") !== null);
    expect(parent.querySelector(".craft-xmp-stars")).toBeNull();
    const values = [...parent.querySelectorAll("dd")].map((dd) => dd.textContent);
    expect(values[0]).toBe("Scartata");
    expect(values[2]).toBe("Scartata");
    const label = parent.querySelector(".craft-xmp-label")!;
    expect(label.hasAttribute("data-color")).toBe(false);
    expect(label.textContent).toBe("Da rivedere");
  });

  it("500 parole chiave stanno in una lista che va a capo", async () => {
    const keywords = Array.from({ length: 500 }, (_, i) => `parola ${i}`);
    const { parent } = await xmp({ rating: 1, label: null, flag: null, keywords });
    await until(() => parent.querySelector(".craft-xmp") !== null);
    expect(parent.querySelectorAll(".craft-xmp-tag")).toHaveLength(500);
    expect(parent.querySelector(".craft-xmp-stars")?.getAttribute("aria-label")).toBe("1 stella su 5");
  });
});

describe("la registrazione", () => {
  it("i formati Craft vanno alla famiglia craft, l'XMP al suo profilo", async () => {
    box.host = createFakeHost({});
    const { createDocumentSurfaceRegistry } = await import("../core/bootstrap");
    const registry = createDocumentSurfaceRegistry({
      onChange: vi.fn(), onSelectionChange: vi.fn(), onOpenWikilink: vi.fn(),
      onOpenPath: vi.fn(), onOpenDocument: vi.fn(), onSearchTag: vi.fn(),
      completions: { searchNotes: async () => [], listTags: async () => [] },
    });
    for (const [format, profile] of [
      ["craft-vectorcraft", "craft"], ["craft-photocraft", "craft"], ["craft-figcraft", "craft"], ["craft-xmp", "xmp"],
    ]) {
      expect(registry.resolve({ formatId: format, sourceKind: "bytes", documentId: "x" }))
        .toMatchObject({ owner: "fub.craft", family: "craft", profile });
    }
  });
});
