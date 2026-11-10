// @vitest-environment happy-dom
// La scheda PDF con un `PdfEngine` finto che conta rese e chiusure: la pagina
// di partenza dal `subpath`, PgSu/PgGiù/Home/Fine, la cache delle immagini
// ferme, il motore chiuso da ferma, il file mancante, il PDF rotto, le rese
// interrotte e le risposte tardive dopo `destroy`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { PdfEngine } from "../../media/pdf-view";
import { CardCache } from "../card-cache";
import { snapshotPart, type CardContext, type CardMode, type CardView } from "../cards";
import type { CanvasNode } from "../model";
import { PDF_CARD_MAX_SCALE, pdfCardFirstPage, pdfCardRenderer, pdfCardStartPage, type PdfCardPort } from "./pdf";

const PATH = "Corsi/manuale.pdf";
const WIDTH = 320;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

interface FakeEngine extends PdfEngine {
  readonly renders: { index: number; scale: number }[];
  destroyed: number;
  /// Se c'è, la resa della pagina `index` aspetta questa promessa.
  hold: Map<number, Deferred<void>>;
}

function fakeEngine(pages: number, size: readonly [number, number] = [600, 800]): FakeEngine {
  const engine: FakeEngine = {
    pageCount: pages,
    renders: [],
    destroyed: 0,
    hold: new Map(),
    search: async () => [],
    pageSize: async () => size,
    renderArea: async () => true,
    async renderPage(index, canvas, scale = 1) {
      engine.renders.push({ index, scale });
      const held = engine.hold.get(index);
      if (held) await held.promise;
      canvas.width = Math.ceil(size[0] * scale);
      canvas.height = Math.ceil(size[1] * scale);
      canvas.dataset.page = String(index + 1);
    },
    destroy() {
      engine.destroyed += 1;
    },
  };
  return engine;
}

interface Bench {
  readonly host: HTMLElement;
  readonly cache: CardCache;
  readonly lifetime: Lifetime;
  readonly port: PdfCardPort & { reads: number; loads: number; changed: (() => void) | null; unwatched: number };
  readonly missing: { count: number };
  readonly size: { width: number; height: number };
  readonly zoom: { value: number };
  /// Le pagine dette con `pageChanged`, in ordine.
  readonly changes: number[];
  mount(mode: CardMode, subpath?: string | null, initialPage?: number | null): CardView;
}

function bench(options: {
  engine?: () => Promise<PdfEngine>;
  read?: () => Promise<Uint8Array | null>;
  cache?: CardCache;
} = {}): Bench {
  const host = document.createElement("div");
  document.body.append(host);
  const cache = options.cache ?? new CardCache();
  const lifetime = openLifetime();
  const missing = { count: 0 };
  const size = { width: WIDTH, height: 400 };
  const zoom = { value: 1 };
  const changes: number[] = [];
  const port: Bench["port"] = {
    reads: 0,
    loads: 0,
    changed: null,
    unwatched: 0,
    async read() {
      port.reads += 1;
      return options.read ? options.read() : new Uint8Array([1, 2, 3]);
    },
    async load() {
      port.loads += 1;
      return options.engine ? options.engine() : fakeEngine(5);
    },
    watch(_path, changed) {
      port.changed = changed;
      return () => {
        port.unwatched += 1;
      };
    },
  };
  const renderer = pdfCardRenderer(port);
  const node: CanvasNode = { id: "n1", type: "file", file: PATH, x: 0, y: 0, width: WIDTH, height: 400 } as CanvasNode;
  return {
    host,
    cache,
    lifetime,
    port,
    missing,
    size,
    zoom,
    changes,
    mount(mode, subpath = null, initialPage) {
      const context: CardContext = {
        ...(initialPage === undefined ? {} : { initialPage }),
        pageChanged: (page) => {
          changes.push(page);
        },
        path: PATH,
        subpath,
        documentId: "Lavagne/studio.canvas",
        lifetime,
        snapshots: cache,
        size: () => size,
        zoom: () => zoom.value,
        missing: () => {
          missing.count += 1;
        },
      };
      return renderer.mount(node, host, mode, context);
    },
  };
}

function screen(host: HTMLElement): HTMLCanvasElement {
  const canvas = host.querySelector<HTMLCanvasElement>(".canvas-card-pdf-page");
  if (!canvas) throw new Error("manca il canvas della pagina");
  return canvas;
}

function status(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>(".canvas-card-pdf-status")!;
}

function message(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>(".canvas-card-pdf-message")!;
}

function button(host: HTMLElement, which: "previous" | "next"): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`.canvas-card-pdf-${which}`)!;
}

function press(view: CardView, key: string, init: KeyboardEventInit = {}): boolean {
  return view.key!(new KeyboardEvent("keydown", { key, ...init }));
}

beforeEach(() => {
  vi.stubGlobal("devicePixelRatio", 1);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("la pagina di partenza", () => {
  it("legge #page=N dal subpath, da 1", () => {
    expect(pdfCardStartPage("#page=3")).toBe(3);
    expect(pdfCardStartPage(null)).toBeNull();
    expect(pdfCardStartPage("#page=0")).toBeNull();
    expect(pdfCardStartPage("#page=abc")).toBeNull();
    expect(pdfCardStartPage("#Titolo")).toBeNull();
  });

  it("parte dalla pagina del subpath e la disegna larga quanto la scheda", async () => {
    const engine = fakeEngine(24);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live", "#page=3");
    expect(view.page!()).toBe(3);
    await settle();
    expect(engine.renders).toEqual([{ index: 2, scale: WIDTH / 600 }]);
    expect(status(b.host).textContent).toBe(t("canvas.card.page", { page: 3, pages: 24 }));
    expect(screen(b.host).hidden).toBe(false);
    expect(screen(b.host).width).toBe(WIDTH);
    view.destroy();
  });

  it.each(["#page=0", "#page=abc", "#page=99", null])("con %s parte dalla prima", async (subpath) => {
    const engine = fakeEngine(5);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live", subpath);
    await settle();
    expect(view.page!()).toBe(1);
    expect(engine.renders.map((r) => r.index)).toEqual([0]);
    view.destroy();
  });

  it("una pagina orizzontale si adatta alla larghezza", async () => {
    const engine = fakeEngine(1, [800, 600]);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    expect(engine.renders).toEqual([{ index: 0, scale: WIDTH / 800 }]);
    expect(screen(b.host).width).toBe(WIDTH);
    expect(screen(b.host).height).toBe(Math.ceil(600 * (WIDTH / 800)));
    view.destroy();
  });

  it("la resa segue lo zoom, al più due volte la scheda", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const engine = fakeEngine(2);
    const b = bench({ engine: async () => engine });
    b.zoom.value = 3;
    const view = b.mount("live");
    await settle();
    expect(engine.renders[0]!.scale).toBe((WIDTH * PDF_CARD_MAX_SCALE) / 600);
    view.destroy();
  });
});

describe("la pagina ricordata (T36)", () => {
  it("vince quella ricordata, poi il subpath, poi la prima", () => {
    expect(pdfCardFirstPage({ subpath: "#page=3", initialPage: 7 })).toBe(7);
    expect(pdfCardFirstPage({ subpath: "#page=3", initialPage: null })).toBe(3);
    expect(pdfCardFirstPage({ subpath: "#page=3" })).toBe(3);
    expect(pdfCardFirstPage({ subpath: null, initialPage: null })).toBe(1);
    // Una pagina ricordata che non è un intero da 1 in su non conta.
    expect(pdfCardFirstPage({ subpath: "#page=3", initialPage: 0 })).toBe(3);
    expect(pdfCardFirstPage({ subpath: "#page=3", initialPage: 2.5 })).toBe(3);
    expect(pdfCardFirstPage({ subpath: null, initialPage: Number.NaN })).toBe(1);
  });

  it("parte dalla pagina ricordata, anche con un altro #page", async () => {
    const engine = fakeEngine(24);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live", "#page=3", 9);
    expect(view.page!()).toBe(9);
    await settle();
    expect(engine.renders.map((r) => r.index)).toEqual([8]);
    expect(status(b.host).textContent).toBe(t("canvas.card.page", { page: 9, pages: 24 }));
    // Partire da lì non è un cambio.
    expect(b.changes).toEqual([]);
    view.destroy();
  });

  it("ferma, mostra dalla cache la pagina ricordata", async () => {
    const cache = new CardCache();
    const first = bench({ cache, engine: async () => fakeEngine(5) });
    const live = first.mount("live", null, 4);
    await settle();
    live.destroy();
    const second = bench({ cache });
    const view = second.mount("snapshot", null, 4);
    expect(screen(second.host).hidden).toBe(false);
    expect(second.port.reads).toBe(0);
    view.destroy();
  });

  it("una pagina ricordata oltre la fine torna alla prima, e lo dice", async () => {
    const engine = fakeEngine(5);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live", "#page=3", 40);
    await settle();
    expect(view.page!()).toBe(1);
    expect(engine.renders.map((r) => r.index)).toEqual([0]);
    expect(b.changes).toEqual([1]);
    view.destroy();
  });

  it("dice ogni pagina voltata, e niente quando la pagina non cambia", async () => {
    const b = bench({ engine: async () => fakeEngine(4) });
    const view = b.mount("live");
    await settle();
    press(view, "PageDown");
    press(view, "End");
    press(view, "PageDown");
    press(view, "Home");
    press(view, "PageUp");
    await settle();
    expect(b.changes).toEqual([2, 4, 1]);
    view.destroy();
  });

  it("il file cambiato con meno pagine resta all'ultima, e lo dice", async () => {
    let pages = 6;
    const b = bench({ engine: async () => fakeEngine(pages) });
    const view = b.mount("live", null, 6);
    await settle();
    expect(b.changes).toEqual([]);
    pages = 3;
    b.port.changed!();
    await settle();
    expect(view.page!()).toBe(3);
    expect(b.changes).toEqual([3]);
    view.destroy();
  });
});

describe("i tasti e le frecce", () => {
  it("PgGiù e PgSu cambiano pagina, Home e Fine vanno agli estremi", async () => {
    const engine = fakeEngine(4);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();

    expect(press(view, "PageDown")).toBe(true);
    await settle();
    expect(view.page!()).toBe(2);
    expect(status(b.host).textContent).toBe(t("canvas.card.page", { page: 2, pages: 4 }));

    expect(press(view, "End")).toBe(true);
    await settle();
    expect(view.page!()).toBe(4);
    // Oltre l'ultima: il tasto è della scheda, ma non si ridisegna niente.
    const before = engine.renders.length;
    expect(press(view, "PageDown")).toBe(true);
    await settle();
    expect(view.page!()).toBe(4);
    expect(engine.renders.length).toBe(before);

    expect(press(view, "PageUp")).toBe(true);
    await settle();
    expect(view.page!()).toBe(3);
    expect(press(view, "Home")).toBe(true);
    await settle();
    expect(view.page!()).toBe(1);
    expect(engine.renders.map((r) => r.index)).toEqual([0, 1, 3, 2]);
    view.destroy();
  });

  it("gli altri tasti e i tasti con modificatori non sono della scheda", async () => {
    const b = bench();
    const view = b.mount("live");
    await settle();
    expect(press(view, "ArrowDown")).toBe(false);
    expect(press(view, "PageDown", { ctrlKey: true })).toBe(false);
    expect(view.page!()).toBe(1);
    view.destroy();
  });

  it("da ferma i tasti non cambiano pagina", async () => {
    const b = bench();
    const view = b.mount("snapshot", "#page=2");
    expect(press(view, "PageDown")).toBe(false);
    expect(view.page!()).toBe(2);
    expect(b.port.loads).toBe(0);
    view.destroy();
  });

  it("le frecce ci sono solo con più pagine, e sfogliano", async () => {
    const b = bench();
    const view = b.mount("live");
    await settle();
    expect(button(b.host, "next").hidden).toBe(false);
    expect(button(b.host, "previous").disabled).toBe(true);
    button(b.host, "next").click();
    await settle();
    expect(view.page!()).toBe(2);
    button(b.host, "previous").click();
    await settle();
    expect(view.page!()).toBe(1);
    view.destroy();
  });

  it("un PDF di una pagina non ha frecce", async () => {
    const b = bench({ engine: async () => fakeEngine(1) });
    const view = b.mount("live");
    await settle();
    expect(button(b.host, "previous").hidden).toBe(true);
    expect(button(b.host, "next").hidden).toBe(true);
    expect(status(b.host).textContent).toBe(t("canvas.card.page", { page: 1, pages: 1 }));
    view.destroy();
  });
});

describe("la cache e la scheda ferma", () => {
  it("mette la pagina disegnata nella cache, alla sua parte", async () => {
    const b = bench();
    const view = b.mount("live", "#page=2");
    await settle();
    const cached = b.cache.get(PATH, snapshotPart("page-2", WIDTH));
    expect(cached).toBeDefined();
    expect(cached!.bytes).toBe(WIDTH * Math.ceil(800 * (WIDTH / 600)) * 4);
    // Il canvas in vista non è quello della cache, che la cache può chiudere.
    expect(cached!.bitmap).not.toBe(screen(b.host));
    view.destroy();
  });

  it("da ferma chiude il motore e tiene l'immagine della pagina", async () => {
    const engine = fakeEngine(3);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    view.setMode("snapshot");
    expect(engine.destroyed).toBe(1);
    expect(screen(b.host).hidden).toBe(false);
    expect(screen(b.host).width).toBe(WIDTH);
    expect(button(b.host, "next").hidden).toBe(true);
    view.destroy();
    expect(engine.destroyed).toBe(1);
  });

  it("montata ferma mostra la pagina dalla cache senza aprire il file", async () => {
    const cache = new CardCache();
    const first = bench({ cache });
    const live = first.mount("live", "#page=2");
    await settle();
    live.destroy();

    const second = bench({ cache });
    const view = second.mount("snapshot", "#page=2");
    expect(second.port.reads).toBe(0);
    expect(screen(second.host).hidden).toBe(false);
    expect(screen(second.host).width).toBe(WIDTH);
    view.destroy();
  });

  it("montata ferma senza cache non mostra niente e non apre il file", () => {
    const b = bench();
    const view = b.mount("snapshot");
    expect(b.port.reads).toBe(0);
    expect(screen(b.host).hidden).toBe(true);
    expect(status(b.host).hidden).toBe(true);
    view.destroy();
  });

  it("tornata viva su una pagina in cache non la ridisegna", async () => {
    const engine = fakeEngine(3);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    view.setMode("snapshot");
    view.setMode("live");
    await settle();
    expect(b.port.loads).toBe(2);
    expect(engine.renders.length).toBe(1);
    expect(press(view, "PageDown")).toBe(true);
    await settle();
    expect(engine.renders.length).toBe(2);
    view.destroy();
  });

  it("resize ridisegna alla nuova larghezza", async () => {
    const engine = fakeEngine(3);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    b.size.width = 640;
    view.resize!();
    await settle();
    expect(engine.renders.map((r) => r.scale)).toEqual([WIDTH / 600, 640 / 600]);
    expect(b.cache.get(PATH, snapshotPart("page-1", 640))).toBeDefined();
    expect(screen(b.host).width).toBe(640);
    view.destroy();
  });

  it("il file cambiato dimentica la cache e, da viva, si riapre", async () => {
    const engine = fakeEngine(3);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    b.port.changed!();
    expect(b.cache.get(PATH, snapshotPart("page-1", WIDTH))).toBeUndefined();
    await settle();
    expect(b.port.loads).toBe(2);
    expect(engine.destroyed).toBe(1);
    expect(engine.renders.length).toBe(2);
    view.destroy();
    expect(b.port.unwatched).toBe(1);
  });
});

describe("i casi limite", () => {
  it("il file mancante lo dice alla tela, senza aprire pdf.js", async () => {
    const b = bench({ read: async () => null });
    const view = b.mount("live");
    await settle();
    expect(b.missing.count).toBe(1);
    expect(b.port.loads).toBe(0);
    expect(message(b.host).hidden).toBe(true);
    view.destroy();
  });

  it("un PDF cifrato o rotto dice che non si può mostrare", async () => {
    const b = bench({ engine: async () => { throw new Error("PasswordException"); } });
    const view = b.mount("live");
    await settle();
    expect(message(b.host).hidden).toBe(false);
    expect(message(b.host).textContent).toBe(t("canvas.card.unreadable", { name: "manuale.pdf" }));
    expect(press(view, "PageDown")).toBe(false);
    view.destroy();
  });

  it("una resa fallita dice che non si può mostrare", async () => {
    const engine = fakeEngine(2);
    engine.renderPage = async () => { throw new Error("rotto"); };
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    expect(message(b.host).textContent).toBe(t("canvas.card.unreadable", { name: "manuale.pdf" }));
    view.destroy();
  });

  it("mentre carica dice «Apro…»", async () => {
    const reading = deferred<Uint8Array | null>();
    const b = bench({ read: () => reading.promise });
    const view = b.mount("live");
    expect(message(b.host).textContent).toBe(t("canvas.card.loading"));
    reading.resolve(new Uint8Array([1]));
    await settle();
    expect(message(b.host).hidden).toBe(true);
    view.destroy();
  });

  it("una resa interrotta da un'altra: vince l'ultima", async () => {
    const engine = fakeEngine(4);
    const first = deferred<void>();
    engine.hold.set(0, first);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    expect(press(view, "PageDown")).toBe(true);
    await settle();
    expect(screen(b.host).width).toBe(WIDTH);
    first.resolve();
    await settle();
    // La pagina 1 arriva tardi e non entra né in vista né in cache.
    expect(b.cache.get(PATH, snapshotPart("page-1", WIDTH))).toBeUndefined();
    expect(b.cache.get(PATH, snapshotPart("page-2", WIDTH))).toBeDefined();
    expect(view.page!()).toBe(2);
    expect(status(b.host).textContent).toBe(t("canvas.card.page", { page: 2, pages: 4 }));
    view.destroy();
  });

  it("destroy mentre pdf.js carica: il motore tardivo si chiude e non tocca niente", async () => {
    const engine = fakeEngine(3);
    const loading = deferred<PdfEngine>();
    const b = bench({ engine: () => loading.promise });
    const view = b.mount("live");
    await settle();
    view.destroy();
    expect(b.host.childElementCount).toBe(0);
    loading.resolve(engine);
    await settle();
    expect(engine.destroyed).toBe(1);
    expect(engine.renders.length).toBe(0);
    expect(b.cache.get(PATH, snapshotPart("page-1", WIDTH))).toBeUndefined();
  });

  it("destroy mentre legge: i byte tardivi non aprono niente", async () => {
    const reading = deferred<Uint8Array | null>();
    const b = bench({ read: () => reading.promise });
    const view = b.mount("live");
    view.destroy();
    reading.resolve(null);
    await settle();
    expect(b.port.loads).toBe(0);
    expect(b.missing.count).toBe(0);
  });

  it("destroy mentre disegna: la pagina tardiva non entra in cache", async () => {
    const engine = fakeEngine(3);
    const held = deferred<void>();
    engine.hold.set(0, held);
    const b = bench({ engine: async () => engine });
    const view = b.mount("live");
    await settle();
    view.destroy();
    held.resolve();
    await settle();
    expect(engine.destroyed).toBe(1);
    expect(b.cache.get(PATH, snapshotPart("page-1", WIDTH))).toBeUndefined();
  });

  it("chiudere la vita della scheda la smonta come destroy", async () => {
    const engine = fakeEngine(3);
    const b = bench({ engine: async () => engine });
    b.mount("live");
    await settle();
    b.lifetime.close();
    expect(engine.destroyed).toBe(1);
    expect(b.host.childElementCount).toBe(0);
    expect(b.port.unwatched).toBe(1);
  });
});
