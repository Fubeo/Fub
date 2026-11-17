// @vitest-environment happy-dom
//
// La scheda dei file Craft e degli XMP (N7) contro l'host finto: ogni forma
// della risposta di `craft.preview` (ogni `missing` con la sua frase, un
// JPEG, la revisione nulla), il pulsante, il `job_done` che porta
// l'immagine, la revisione che cambia, la
// risposta che arriva a scheda chiusa, il componente spento, e la vista XMP
// con ogni campo e con ogni campo assente. Poi la scheda di un RAW: il JPEG
// che ha dentro, dritto, la riga dei dati e quelli del suo XMP; senza JPEG,
// la domanda di LightCraft; e il RAW che va alla sua scheda solo col
// componente acceso.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCraft, FakeCraftDoc, FakeHost } from "../../host/fake";
import type { CraftPreview, CraftPreviewImage, CraftXmpInfo } from "../../host/craft";
import type { EditorSurface } from "../core/registry";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// L'host finto non sa dire l'anteprima di un RAW (lo dice il bundle vero,
  /// T27): la danno i test del RAW, prima di passare all'host.
  raw: null as ((name: string, args: unknown[]) => Promise<unknown> | undefined) | null,
}));

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
          box.raw?.(name, args) ?? (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
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
  return { media_type: "image/png", data: btoa(String.fromCharCode(...bytes)), width, height, orientation: 1 };
}

/// Un JPEG di `width`×`height` in base64: l'inizio e il `SOF0` bastano.
function jpeg(width: number, height: number): CraftPreviewImage {
  const bytes = [0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0, 0xff, 0xd9];
  return { media_type: "image/jpeg", data: btoa(String.fromCharCode(...bytes)), width, height, orientation: 6 };
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
  box.raw = null;
});

describe("la scheda di un file Craft", () => {
  it("con l'anteprima nel file: la vista delle immagini e sotto la riga dei dati", async () => {
    const { host, parent, surface } = await mount(LOGO, craft({ image: png(256, 180), info: { format_version: "4" } }));
    await until(() => parent.querySelector(".media-image") !== null);
    expect(surface.family).toBe("craft");
    expect(parent.querySelector(".zoom-view")).not.toBeNull();
    expect(text(parent, ".craft-info")).toBe("Disegno di VectorCraft · formato 4 · 3 B");
    expect(parent.querySelector(".zoom-stage")?.getAttribute("aria-label") ?? parent.innerHTML).toContain("logo.vectorcraft");
    expect(previewCalls(host)).toEqual([{ doc: LOGO, size: "large" }]);
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
    expect(previewCalls(host).every((args) => !("render" in args))).toBe(true);
  });

  it("con l'app installata e il consenso acceso c'è il pulsante, e senza gesto la scheda non chiede l'anteprima", async () => {
    const { host, parent } = await mount(LOGO, craft({ render: { app: "VectorCraft", consent: "on" } }));
    await until(() => parent.querySelector(".craft-render") !== null);
    expect(text(parent, ".craft-empty-state")).toBe("Il file non porta un'anteprima");
    const button = parent.querySelector<HTMLButtonElement>(".craft-render")!;
    expect(button.textContent).toBe("Crea l'anteprima con VectorCraft");
    expect(host.atGate("craftRender")).toHaveLength(0);
    // Il pulsante è un gesto: una richiesta a craft_render, anche con due
    // clic. Senza la porta servita, il rifiuto si dice e il pulsante torna.
    button.click();
    button.click();
    await until(() => parent.querySelector<HTMLButtonElement>(".craft-render")?.disabled === false);
    expect(host.atGate("craftRender").map((call) => call.args)).toEqual([[LOGO, "large"]]);
    expect(text(parent, ".craft-empty-state")).toMatch(/^L'anteprima non è riuscita: /);
    expect(previewCalls(host).every((args) => !("render" in args))).toBe(true);
  });

  it("il job_done porta l'immagine nella scheda", async () => {
    const { host, parent } = await mount(LOGO, craft({ render: { app: "VectorCraft", consent: "on" } }));
    await until(() => parent.querySelector(".craft-render") !== null);
    const mine = ((await host.module.api.invokeCommand("craft.preview", { doc: LOGO, size: "large" })).effect as { payload: object }).payload;
    host.emit({ type: "job_done", id: "j", job: "craft.render", result: { Ok: { ...mine, image: png(64, 32), origin: "cli", missing: null, render: null } } });
    await until(() => parent.querySelector(".media-image") !== null);
    expect(text(parent, ".craft-info")).toBe("Disegno di VectorCraft · 3 B");
  });

  it("un job finito male o di un altro documento non tocca la scheda", async () => {
    const { host, parent } = await mount(LOGO, craft({ render: { app: "VectorCraft", consent: "on" } }));
    await until(() => parent.querySelector(".craft-render") !== null);
    const other = ((await host.module.api.invokeCommand("craft.preview", { doc: XMP, size: "large" })).effect as { payload: object }).payload;
    host.emit({ type: "job_done", id: "j", job: "craft.render", result: { Ok: { ...other, image: png(2, 2), origin: "cli" } } });
    host.emit({ type: "job_done", id: "k", job: "craft.render", result: { Err: { kind: "unserved", message: "no" } } });
    await settle();
    expect(text(parent, ".craft-empty-state")).toBe("Il file non porta un'anteprima");
    expect(parent.querySelector(".media-image")).toBeNull();
    expect(parent.querySelector(".craft-render")).not.toBeNull();
  });

  it("over_limit dice il peso massimo in MiB interi, senza pulsante; il peso da solo non lo dice", async () => {
    const big = await mount(LOGO, craft({ missing: "over_limit", limit_bytes: 64 * 1024 * 1024 + 5000, info: { bytes: 64 * 1024 * 1024 + 1 }, render: { app: "VectorCraft", consent: "on" } }));
    await until(() => big.parent.querySelector(".craft-empty") !== null);
    expect(text(big.parent, ".craft-empty-state")).toBe("Il file pesa più del massimo da leggere per un'anteprima (64\u00a0MiB)");
    expect(big.parent.querySelector(".craft-render")).toBeNull();
    expect(big.parent.querySelector(".craft-ask")).toBeNull();
    // La shell non rifà il conto del peso: lo dice `missing`.
    const heavy = await mount(LOGO, craft({ info: { bytes: 64 * 1024 * 1024 + 1 } }));
    await until(() => heavy.parent.querySelector(".craft-empty") !== null);
    expect(text(heavy.parent, ".craft-empty-state")).toBe("Il file non porta un'anteprima");
  });

  it("unreadable e failed hanno la loro frase", async () => {
    const said = { unreadable: "Il file non si legge: forse è rotto", failed: "VectorCraft non è riuscita a fare l'anteprima" };
    for (const missing of ["unreadable", "failed"] as const) {
      const { parent } = await mount(LOGO, craft({ missing }));
      await until(() => parent.querySelector(".craft-empty") !== null);
      expect(text(parent, ".craft-empty-state"), missing).toBe(said[missing]);
      expect(parent.querySelector(".craft-render, .craft-ask"), missing).toBeNull();
    }
  });

  it("un JPEG si mostra col suo tipo", async () => {
    const { parent } = await mount(LOGO, craft({ image: jpeg(30, 20) }));
    await until(() => parent.querySelector(".media-image") !== null);
    expect(parent.querySelector(".craft-empty")).toBeNull();
  });

  it("una revisione nulla vale come appena letta: la scheda non richiede", async () => {
    const { host, parent } = await mount(LOGO, craft({ image: png(4, 4), revision: null }));
    await until(() => parent.querySelector(".media-image") !== null);
    expect(previewCalls(host)).toHaveLength(1);
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

describe("la scheda di un RAW", () => {
  const RAW = "Foto/IMG_0412.CR3";
  const RAW_XMP = "Foto/IMG_0412.xmp";

  interface RawMounted extends Mounted {
    asked: Record<string, unknown>[];
  }

  /// Il RAW con l'anteprima che il bundle darebbe (`preview`), il suo XMP
  /// accanto se `xmp` lo dice, e la scheda montata col profilo `raw`.
  async function mountRaw(preview: Partial<CraftPreview>, xmp: CraftXmpInfo | null = null, component = true): Promise<RawMounted> {
    const resources: Record<string, { bytes: Uint8Array; mime: string }> = { [RAW]: BYTES };
    if (xmp) resources[RAW_XMP] = { bytes: new TextEncoder().encode("<x:xmpmeta/>"), mime: "application/rdf+xml" };
    const host = createFakeHost({ resources, craft: { component, docs: xmp ? { [RAW_XMP]: { info: { xmp } } } : {} } });
    box.host = host;
    const asked: Record<string, unknown>[] = [];
    box.raw = (name, args) => {
      if (name !== "invokeCommand" || args[0] !== "craft.preview" || (args[1] as { doc?: string }).doc !== RAW) return undefined;
      asked.push(args[1] as Record<string, unknown>);
      if (!component) return Promise.reject({ kind: "unknown_command", message: "craft.preview" });
      const payload: CraftPreview = {
        version: 2, doc: RAW, revision: null, size: "large", origin: "file", queued: false, image: null,
        missing: "absent", limit_bytes: null, render: null,
        info: { app: "raw", editor: "LightCraft", format_version: null, bytes: 27_011_420, photo: null, edits: [], xmp: null },
        ...preview,
      };
      return Promise.resolve({ notify: null, effect: { kind: "custom", ns: "fub.craft", payload }, undo: null, partial: null });
    };
    vi.resetModules();
    const store = await import("../../state/store");
    store.state.vaultRoot = "/vault";
    store.setCommandSpecs(await host.module.api.listCommands());
    const kernel = await import("../../state/kernel");
    const { openLifetime } = await import("../../ui/lifetime");
    const previews = await import("../../state/craft-previews");
    const photos = await import("../../state/craft-photos");
    const { mountCraftSurface, MEDIA_RAW_PROFILE } = await import("./index");
    await kernel.startKernelRouter();
    previews.mountCraftPreviews(openLifetime());
    photos.mountCraftPhotos(openLifetime());
    const parent = document.createElement("div");
    document.body.replaceChildren(parent);
    const opened: string[] = [];
    const searched: string[] = [];
    const surface = mountCraftSurface("raw", { paneId: "p1", documentId: RAW, parent, formatId: null }, {
      onOpenDocument: (id) => void opened.push(id),
      onSearchTag: (tag) => void searched.push(tag),
    }, { family: "viewer", profile: MEDIA_RAW_PROFILE });
    return { host, surface, parent, opened, searched, asked };
  }

  it("col JPEG e l'orientamento 6: la foto dritta, la riga del RAW e i dati dell'XMP, e nessuna app", async () => {
    const m = await mountRaw({ image: jpeg(1200, 800) }, { rating: 5, label: null, flag: "pick", keywords: ["faro", "Liguria"] });
    const { parent, surface, host } = m;
    await until(() => parent.querySelector(".craft-card .photo-data") !== null);
    expect(surface).toMatchObject({ family: "viewer", profile: "media-raw" });
    expect(m.asked).toEqual([{ doc: RAW, size: "large" }]);
    const image = parent.querySelector<HTMLImageElement>(".zoom-content")!;
    expect(image.style.imageOrientation).toBe("none");
    expect(image.style.transform).toContain("rotate(90deg)");
    expect(text(parent, ".zoom-info")).toMatch(/^JPEG · 800 × 1200 px · /);
    expect(text(parent, ".craft-info")).toBe("Foto RAW · CR3 · 25.8 MiB");
    // I dati dell'XMP stanno nella scheda, dopo la riga del RAW.
    const card = parent.querySelector(".craft-card")!;
    expect([...card.children].map((child) => child.className)).toEqual(["media-image", "craft-info", "photo-data"]);
    expect(card.querySelectorAll(".craft-xmp-star[data-on='true']")).toHaveLength(5);
    expect([...card.querySelectorAll(".craft-xmp-tag")].map((tag) => tag.textContent)).toEqual(["#faro", "#Liguria"]);
    card.querySelector<HTMLButtonElement>(".photo-data-open")!.click();
    expect(m.opened).toEqual([RAW_XMP]);
    // Con il JPEG la scheda non chiede mai l'anteprima all'app.
    expect(host.atGate("craftRender")).toHaveLength(0);
    expect(parent.querySelector(".craft-render, .craft-ask")).toBeNull();
  });

  it("un RAW dritto non gira, e nemmeno la sua riga", async () => {
    const { parent } = await mountRaw({ image: { ...jpeg(1500, 1000), orientation: 1 } });
    await until(() => parent.querySelector(".media-image") !== null);
    expect(parent.querySelector<HTMLImageElement>(".zoom-content")!.style.transform).toContain("rotate(0deg)");
    expect(text(parent, ".zoom-info")).toMatch(/^JPEG · 1500 × 1000 px · /);
    // Senza XMP accanto, nessuna riga dei dati.
    await settle();
    expect(parent.querySelector(".photo-data")).toBeNull();
  });

  it("senza JPEG e col consenso «ask»: il riquadro con la domanda di LightCraft, e i dati dell'XMP sotto", async () => {
    const { parent, host } = await mountRaw(
      { origin: "none", render: { app: "LightCraft", consent: "ask" } },
      { rating: 2, label: null, flag: "reject", keywords: [] },
    );
    await until(() => parent.querySelector(".craft-ask") !== null && parent.querySelector(".photo-data") !== null);
    expect(text(parent, ".craft-empty-name")).toBe("IMG_0412.CR3");
    expect(text(parent, ".craft-info")).toBe("Foto RAW · CR3 · 25.8 MiB");
    expect(text(parent, ".craft-empty-state")).toBe("Il file non porta un'anteprima");
    expect(parent.querySelector(".craft-ask")?.textContent).toContain("LightCraft");
    // La riga dei dati è sorella del riquadro, dopo di lui.
    const surface = parent.firstElementChild!;
    expect([...surface.children].map((child) => child.className)).toEqual(["craft-empty", "photo-data"]);
    expect(host.atGate("craftRender")).toHaveLength(0);
  });

  it("col componente spento dice ciò che dice un file senza superficie", async () => {
    const { parent } = await mountRaw({}, null, false);
    await until(() => text(parent, ".craft-status") === "Nessuna superficie disponibile");
  });
});

describe("la registrazione di un RAW", () => {
  async function registry(component: boolean) {
    box.host = createFakeHost({ craft: { component } });
    vi.resetModules();
    const store = await import("../../state/store");
    store.setCommandSpecs(await box.host.module.api.listCommands());
    const { createDocumentSurfaceRegistry } = await import("../core/bootstrap");
    return createDocumentSurfaceRegistry({
      onChange: vi.fn(), onSelectionChange: vi.fn(), onOpenWikilink: vi.fn(),
      onOpenPath: vi.fn(), onOpenDocument: vi.fn(), onSearchTag: vi.fn(),
      completions: { searchNotes: async () => [], listTags: async () => [] },
    });
  }

  it("col componente acceso un RAW, in ogni caso di lettere, va al profilo media-raw del viewer", async () => {
    const reg = await registry(true);
    for (const doc of ["Foto/IMG_0001.CR3", "foto/img.nef", "scatto.Dng", "a.rw2"]) {
      expect(reg.showsBytes(doc), doc).toBe(true);
      expect(reg.resolve({ formatId: null, sourceKind: "bytes", documentId: doc }), doc)
        .toMatchObject({ family: "viewer", profile: "media-raw" });
    }
    // Una foto resta della vista delle immagini, un XMP accanto non è un RAW.
    expect(reg.resolve({ formatId: null, sourceKind: "bytes", documentId: "foto.jpg" })).toMatchObject({ profile: "media-image" });
    expect(reg.showsBytes("Foto/IMG_0001.CR3.xmp")).toBe(false);
  });

  it("col componente spento un RAW resta un file senza vista", async () => {
    const reg = await registry(false);
    expect(reg.showsBytes("Foto/IMG_0001.CR3")).toBe(false);
    expect(reg.opensWithoutFormat("Foto/IMG_0001.CR3")).toBe(false);
  });

  it("la scheda montata dal registro si presenta come media-raw", async () => {
    const reg = await registry(true);
    const parent = document.createElement("div");
    const surface = reg.mount({ formatId: null, sourceKind: "bytes", documentId: "Foto/IMG_0001.CR3" }, { paneId: "p", documentId: "Foto/IMG_0001.CR3", parent });
    expect(surface).toMatchObject({ family: "viewer", profile: "media-raw" });
    expect(parent.querySelector(".craft-surface")?.getAttribute("data-profile")).toBe("raw");
    surface.destroy();
  });
});
