// @vitest-environment happy-dom
// La scheda dei file Craft (T18): l'anteprima di N7 ridotta al doppio della
// scheda e messa in cache (la seconda accensione non richiede), «Apri» e
// «Apri con…», il componente spento (niente domande, la ragione e «Apri con…»)
// e acceso mentre la scheda è viva, il consenso alle anteprime delle app
// (spento o da chiedere: niente comando), il file senza anteprima, il file
// rotto, il file mancante e le risposte tardive. `createImageBitmap` e il
// contesto 2D sono finti: happy-dom non decodifica immagini.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { craftCardRenderer, type CraftCardPort } from "./craft";
import { CardCache } from "../card-cache";
import type { CardContext, CardMode, CardView } from "../cards";
import type { CanvasNode } from "../model";
import type { CraftPreview, CraftRenderConsent } from "../../../host/craft";
import type { CraftPreviewAnswer } from "../../../state/craft-previews";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { t } from "../../../i18n/strings";

const PATH = "Fisica/schema-pendolo.vectorcraft";

/// Un'anteprima di `PATH`: con un'immagine 1200×800, o senza.
function preview(extra: Partial<CraftPreview> = {}): CraftPreview {
  return {
    version: 2,
    doc: PATH,
    revision: "r1",
    size: "large",
    origin: "file",
    queued: false,
    image: { media_type: "image/png", data: btoa("png"), width: 1200, height: 800, orientation: 1 },
    missing: null,
    limit_bytes: null,
    info: { app: "vectorcraft", editor: "VectorCraft", format_version: "4", bytes: 2048, photo: null, edits: [], xmp: null },
    render: null,
    ...extra,
  };
}

function withoutImage(extra: Partial<CraftPreview> = {}): CraftPreview {
  return preview({ image: null, missing: "absent", ...extra });
}

function offer(consent: CraftRenderConsent): CraftPreview["render"] {
  return { app: "VectorCraft", consent };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function fakePort(answer: () => Promise<CraftPreviewAnswer | null>, options: { served?: boolean; component?: string | null } = {}) {
  let served = options.served ?? true;
  const servedListeners = new Set<() => void>();
  const previewWatchers = new Set<(doc: string) => void>();
  const fileWatchers = new Map<string, () => void>();
  const port = {
    served: vi.fn(() => served),
    offComponent: vi.fn(() => (options.component === undefined ? "File delle app Craft" : options.component)),
    onServed: vi.fn((changed: () => void) => {
      servedListeners.add(changed);
      return () => servedListeners.delete(changed);
    }),
    preview: vi.fn((_path: string) => answer()),
    watchPreviews: vi.fn((lifetime: Lifetime, watcher: (doc: string) => void) => {
      previewWatchers.add(watcher);
      lifetime.add(() => previewWatchers.delete(watcher));
    }),
    render: vi.fn(async (_path: string): Promise<CraftPreviewAnswer | null> => null),
    open: vi.fn(),
    openWith: vi.fn(),
    watch: vi.fn((path: string, changed: () => void) => {
      fileWatchers.set(path, changed);
      return () => fileWatchers.delete(path);
    }),
  } satisfies CraftCardPort;
  return {
    port,
    setServed: (next: boolean) => {
      served = next;
      for (const listener of [...servedListeners]) listener();
    },
    announce: (doc: string) => {
      for (const watcher of [...previewWatchers]) watcher(doc);
    },
    change: (path: string) => fileWatchers.get(path)?.(),
    listeners: () => servedListeners.size + previewWatchers.size + fileWatchers.size,
  };
}

const answered = (value: CraftPreview, renderError: unknown = null) => async (): Promise<CraftPreviewAnswer> => ({ preview: value, renderError });

function node(): CanvasNode {
  return { id: "n1", type: "file", file: PATH, x: 0, y: 0, width: 300, height: 200 } as CanvasNode;
}

function mount(port: CraftCardPort, cache = new CardCache(), mode: CardMode = "live") {
  const host = document.createElement("div");
  document.body.append(host);
  const missing = vi.fn();
  const contentShown = vi.fn();
  const lifetime = openLifetime();
  const ctx: CardContext = {
    path: PATH,
    subpath: null,
    documentId: "Lavagna.canvas",
    lifetime,
    snapshots: cache,
    size: () => ({ width: 300, height: 200 }),
    zoom: () => 1,
    missing,
    contentShown,
  };
  const view: CardView = craftCardRenderer(port).mount(node(), host, mode, ctx);
  const root = () => host.querySelector<HTMLElement>(".canvas-card-craft")!;
  const button = (name: string) => host.querySelector<HTMLButtonElement>(`.canvas-card-craft-${name}`);
  return { host, view, missing, contentShown, lifetime, cache, root, button, state: () => root()?.dataset.cardState };
}

const settle = () => new Promise<void>((done) => setTimeout(done, 0));

let created: { width: number; height: number; close(): void }[];
let createImageBitmapMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  created = [];
  createImageBitmapMock = vi.fn(async (_blob: Blob, request?: ImageBitmapOptions) => {
    const width = request?.resizeWidth ?? 1200;
    const bitmap = { width, height: Math.round((800 * width) / 1200), close: vi.fn() };
    created.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  });
  vi.stubGlobal("createImageBitmap", createImageBitmapMock);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage: () => {} }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("l'anteprima", () => {
  it("chiede l'anteprima large, la riduce al doppio della scheda e la mette in cache", async () => {
    const { port } = fakePort(answered(preview()));
    const card = mount(port);
    expect(card.state()).toBe("loading");
    await settle();

    expect(port.preview).toHaveBeenCalledWith(PATH);
    // 300 × 2 = 600, arrotondato a 32: 608.
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(createImageBitmapMock.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(createImageBitmapMock.mock.calls[0]![1]).toMatchObject({ resizeWidth: 608 });
    expect(card.state()).toBe("picture");
    const picture = card.root().querySelector("canvas.canvas-card-picture")!;
    expect(picture.getAttribute("aria-label")).toBe(t("craft.figure.alt", { name: "schema-pendolo.vectorcraft" }));
    expect(card.cache.get(PATH, "craft@608")).toBeDefined();
    expect(card.view.contentAspect?.()).toBeCloseTo(1.5);
    expect(card.contentShown).toHaveBeenCalled();
  });

  it("tornando sulla scheda l'anteprima in cache c'è subito, senza chiedere", async () => {
    const cache = new CardCache();
    const first = fakePort(answered(preview()));
    mount(first.port, cache);
    await settle();

    const again = fakePort(answered(preview()));
    const card = mount(again.port, cache);
    expect(card.state()).toBe("picture");
    await settle();
    expect(again.port.preview).not.toHaveBeenCalled();
  });

  it("ferma mostra l'anteprima in cache, o la specie e il percorso", async () => {
    const cache = new CardCache();
    const empty = mount(fakePort(answered(preview())).port, cache, "snapshot");
    expect(empty.state()).toBe("placeholder");
    expect(empty.root().textContent).toBe(`VECTORCRAFT · ${PATH}`);

    const live = mount(fakePort(answered(preview())).port, cache);
    await settle();
    live.view.setMode("snapshot");
    expect(live.state()).toBe("picture");

    const still = mount(fakePort(answered(preview())).port, cache, "snapshot");
    expect(still.state()).toBe("picture");
  });

  it("un file cambiato dimentica l'immagine ferma e richiede", async () => {
    const fake = fakePort(answered(preview()));
    const card = mount(fake.port);
    await settle();
    fake.change(PATH);
    expect(card.cache.get(PATH, "craft@608")).toBeUndefined();
    await settle();
    expect(fake.port.preview).toHaveBeenCalledTimes(2);
    expect(card.state()).toBe("picture");
  });

  it("una risposta che arriva dopo destroy non tocca niente", async () => {
    const wait = deferred<CraftPreviewAnswer | null>();
    const fake = fakePort(() => wait.promise);
    const card = mount(fake.port);
    card.view.destroy();
    wait.resolve({ preview: preview(), renderError: null });
    await settle();
    expect(card.host.querySelector(".canvas-card-craft")).toBeNull();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(fake.listeners()).toBe(0);
  });
});

describe("Apri e Apri con", () => {
  it("«Apri» apre la modalità di Fub, «Apri con…» il menu delle app sotto il pulsante", async () => {
    const { port } = fakePort(answered(preview()));
    const card = mount(port);
    await settle();

    const open = card.button("open")!;
    const openWith = card.button("open-with")!;
    expect(open.textContent).toBe(t("canvas.card.open"));
    expect(openWith.textContent).toBe(t("canvas.card.open_with"));
    expect(openWith.getAttribute("aria-haspopup")).toBe("menu");

    open.click();
    expect(port.open).toHaveBeenCalledWith(PATH);
    openWith.click();
    expect(port.openWith).toHaveBeenCalledWith(PATH, openWith);
    expect(port.open).toHaveBeenCalledTimes(1);
  });

  it("il doppio clic apre come «Apri», quello su un pulsante no", async () => {
    const { port } = fakePort(answered(preview()));
    const card = mount(port);
    await settle();
    card.root().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(port.open).toHaveBeenCalledTimes(1);
    card.button("open-with")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(port.open).toHaveBeenCalledTimes(1);
  });
});

describe("il componente spento", () => {
  it("non chiede anteprime: dice quale componente serve e offre solo «Apri con…»", async () => {
    const { port } = fakePort(answered(preview()), { served: false });
    const card = mount(port);
    await settle();

    expect(port.preview).not.toHaveBeenCalled();
    expect(card.state()).toBe("off");
    expect(card.root().querySelector(".canvas-card-craft-name")!.textContent).toBe("schema-pendolo.vectorcraft");
    expect(card.root().querySelector(".canvas-card-craft-info")!.textContent).toBe(t("craft.kind.vectorcraft", { app: "VectorCraft" }));
    expect(card.root().querySelector(".canvas-card-craft-state")!.textContent).toBe(t("file_only.note", { name: "File delle app Craft" }));
    expect(card.button("open")).toBeNull();
    card.button("open-with")!.click();
    expect(port.openWith).toHaveBeenCalledWith(PATH, card.button("open-with"));
  });

  it("senza il nome del componente lo dice lo stesso", async () => {
    const card = mount(fakePort(answered(preview()), { served: false, component: null }).port);
    await settle();
    expect(card.root().querySelector(".canvas-card-craft-state")!.textContent).toBe(t("file_only.note_unnamed"));
  });

  it("acceso mentre la scheda è viva, la scheda chiede l'anteprima e la mostra", async () => {
    const fake = fakePort(answered(preview()), { served: false });
    const card = mount(fake.port);
    await settle();
    expect(card.state()).toBe("off");

    fake.setServed(true);
    await settle();
    expect(fake.port.preview).toHaveBeenCalledTimes(1);
    expect(card.state()).toBe("picture");
    expect(card.button("open")).not.toBeNull();

    fake.setServed(false);
    await settle();
    expect(card.state()).toBe("off");
  });

  it("ferma col componente spento non mostra l'immagine in cache", async () => {
    const cache = new CardCache();
    mount(fakePort(answered(preview())).port, cache);
    await settle();
    const card = mount(fakePort(answered(preview()), { served: false }).port, cache, "snapshot");
    expect(card.state()).toBe("placeholder");
  });
});

describe("il consenso alle anteprime delle app", () => {
  it("spento: lo dice e non offre nessun comando", async () => {
    const { port } = fakePort(answered(withoutImage({ render: offer("off") })));
    const card = mount(port);
    await settle();
    expect(card.state()).toBe("card");
    expect(card.root().querySelector(".canvas-card-craft-consent")!.textContent).toBe(t("craft.consent.off"));
    expect(card.button("render")).toBeNull();
    expect(port.render).not.toHaveBeenCalled();
  });

  it("da chiedere: rimanda al file, senza comando", async () => {
    const { port } = fakePort(answered(withoutImage({ render: offer("ask") })));
    const card = mount(port);
    await settle();
    expect(card.root().querySelector(".canvas-card-craft-consent")!.textContent).toBe(t("canvas.card.craft_ask", { app: "VectorCraft" }));
    expect(card.button("render")).toBeNull();
    expect(port.render).not.toHaveBeenCalled();
  });

  it("acceso: la scheda non la chiede da sé; il clic sul pulsante sì, una volta", async () => {
    const fake = fakePort(answered(withoutImage({ render: offer("on") })));
    const card = mount(fake.port);
    await settle();
    expect(fake.port.render).not.toHaveBeenCalled();
    const render = card.button("render")!;
    expect(render.textContent).toBe(t("craft.render", { app: "VectorCraft" }));
    render.click();
    render.click();
    expect(fake.port.render).toHaveBeenCalledTimes(1);
    expect(fake.port.render).toHaveBeenCalledWith(PATH);
  });

  it("un rifiuto della richiesta si legge nella scheda", async () => {
    const fake = fakePort(answered(withoutImage({ render: offer("on") })));
    fake.port.render.mockRejectedValueOnce(new Error("no_consent"));
    const card = mount(fake.port);
    await settle();
    card.button("render")!.click();
    await settle();
    expect(card.root().querySelector(".canvas-card-craft-state")!.textContent).toBe(t("craft.render_failed", { reason: "no_consent" }));
    expect(card.button("render")!.disabled).toBe(false);
  });

  it("l'anteprima in coda e poi arrivata ridisegna la scheda", async () => {
    let current = withoutImage({ queued: true, render: offer("on") });
    const fake = fakePort(async () => ({ preview: current, renderError: null }));
    const card = mount(fake.port);
    await settle();
    expect(card.root().querySelector(".canvas-card-craft-state")!.textContent).toBe(t("craft.queued"));

    current = preview();
    fake.announce(PATH);
    await settle();
    expect(card.state()).toBe("picture");
  });
});

describe("senza anteprima", () => {
  it("è una scheda di file: il nome, i dati, perché manca, «Apri» e «Apri con…»", async () => {
    const { port } = fakePort(answered(withoutImage()));
    const card = mount(port);
    await settle();
    expect(card.state()).toBe("card");
    expect(card.root().querySelector(".canvas-card-craft-info")!.textContent).toContain("VectorCraft");
    expect(card.root().querySelector(".canvas-card-craft-state")!.textContent).toBe(t("craft.no_preview"));
    expect(card.button("open")).not.toBeNull();
    expect(card.button("open-with")).not.toBeNull();
    expect(card.view.contentAspect?.()).toBeNull();
  });

  it("un file rotto lo dice, e «Apri» resta", async () => {
    const card = mount(fakePort(answered(withoutImage({ missing: "unreadable" }))).port);
    await settle();
    expect(card.root().querySelector(".canvas-card-craft-state")!.textContent).toBe(t("craft.unreadable"));
    expect(card.button("open")).not.toBeNull();
  });

  it("un'anteprima che non si decodifica è una scheda illeggibile", async () => {
    createImageBitmapMock.mockRejectedValueOnce(new Error("immagine rotta"));
    const card = mount(fakePort(answered(preview())).port);
    await settle();
    expect(card.state()).toBe("unreadable");
    expect(card.root().querySelector(".canvas-card-craft-state")!.textContent).toBe(t("craft.failed", { reason: "immagine rotta" }));
  });

  it("un comando che non risponde è una scheda illeggibile", async () => {
    const card = mount(fakePort(() => Promise.reject(new Error("guasto"))).port);
    await settle();
    expect(card.state()).toBe("unreadable");
    expect(card.button("open-with")).not.toBeNull();
  });

  it("un file che non c'è è una scheda mancante", async () => {
    const card = mount(fakePort(() => Promise.reject({ kind: "not_found", message: "manca" })).port);
    await settle();
    expect(card.state()).toBe("missing");
    expect(card.missing).toHaveBeenCalledTimes(1);
  });
});
