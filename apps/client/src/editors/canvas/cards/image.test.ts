// @vitest-environment happy-dom
// La scheda d'immagine: un raster si riduce al doppio della scheda con una
// sola decodifica e va in cache (la seconda accensione non rilegge), un SVG è
// un `<img>` col blob e mai SVG nel DOM, il tetto di 64 MiB, il file mancante,
// i formati che il motore non decodifica, la revoca degli URL e le risposte
// tardive che non toccano il DOM. `createImageBitmap` e il contesto 2D sono
// finti: happy-dom non decodifica immagini.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_CARD_MAX_BYTES, imageCardRenderer, rasterSize, type ImageCardPort, type ImageCardRead } from "./image";
import { CardCache } from "../card-cache";
import type { CardContext, CardMode, CardView } from "../cards";
import type { CanvasNode } from "../model";
import type { ResourceDescriptor } from "../../media/media-types";
import { openLifetime } from "../../../ui/lifetime";
import { t } from "../../../i18n/strings";

function descriptor(id: string, mime: string, len = 0): ResourceDescriptor {
  return { id, mime, len, handle: "1", kind: "image", revision: "1" } as unknown as ResourceDescriptor;
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/// Un JPEG con APP0 e poi SOF0 di `width`×`height`, o senza SOF.
function jpeg(size: [number, number] | null): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof = size
    ? [0xff, 0xc0, 0x00, 0x0b, 0x08, size[1] >> 8, size[1] & 0xff, size[0] >> 8, size[0] & 0xff, 0x01, 0x01, 0x11, 0x00]
    : [0xff, 0xda, 0x00, 0x02, 0, 0, 0, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

const utf8 = (text: string) => new TextEncoder().encode(text);

interface FakeBitmap {
  width: number;
  height: number;
  closed: number;
  close(): void;
}

function fakeBitmap(width: number, height: number): FakeBitmap {
  const bitmap: FakeBitmap = { width, height, closed: 0, close: () => void (bitmap.closed += 1) };
  return bitmap;
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

/// `createImageBitmap` finto: rende un bitmap largo `resizeWidth` se chiesto,
/// sennò `natural`; si può tenere in sospeso.
function stubCreateImageBitmap(natural: [number, number], options: { honorResize?: boolean } = {}) {
  const made: FakeBitmap[] = [];
  const pending: Deferred<void>[] = [];
  let hold = false;
  const create = vi.fn(async (source: unknown, request?: ImageBitmapOptions) => {
    if (hold) {
      const wait = deferred<void>();
      pending.push(wait);
      await wait.promise;
    }
    const base = (source as Partial<FakeBitmap>).width !== undefined && !(source instanceof Blob)
      ? [(source as FakeBitmap).width, (source as FakeBitmap).height] as const
      : natural;
    const width = request?.resizeWidth !== undefined && options.honorResize !== false ? request.resizeWidth : base[0];
    const bitmap = fakeBitmap(width, Math.round((base[1] * width) / base[0]));
    made.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  });
  vi.stubGlobal("createImageBitmap", create);
  return {
    create,
    made,
    hold: () => void (hold = true),
    release: () => {
      hold = false;
      for (const wait of pending.splice(0)) wait.resolve();
    },
  };
}

function fakePort(files: Record<string, ImageCardRead | null | (() => Promise<ImageCardRead | null>)>) {
  const watchers = new Map<string, () => void>();
  const port = {
    read: vi.fn(async (path: string) => {
      const file = files[path];
      if (typeof file === "function") return file();
      return file ?? null;
    }),
    open: vi.fn(),
    unwatched: 0,
    watch: vi.fn((path: string, changed: () => void) => {
      watchers.set(path, changed);
      return () => {
        watchers.delete(path);
        port.unwatched += 1;
      };
    }),
  };
  return { port: port as typeof port & ImageCardPort, change: (path: string) => watchers.get(path)?.() };
}

function node(path: string): CanvasNode {
  return { id: "n1", type: "file", file: path, x: 0, y: 0, width: 300, height: 200 } as CanvasNode;
}

function context(path: string, cache: CardCache, width = 300) {
  const missing = vi.fn();
  const lifetime = openLifetime();
  const ctx: CardContext = {
    path,
    subpath: null,
    documentId: "Lavagna.canvas",
    lifetime,
    snapshots: cache,
    size: () => ({ width, height: 200 }),
    zoom: () => 1,
    missing,
  };
  return { ctx, missing, lifetime };
}

function mount(port: ImageCardPort, path: string, cache = new CardCache(), mode: CardMode = "live", width = 300) {
  const host = document.createElement("div");
  document.body.append(host);
  const { ctx, missing, lifetime } = context(path, cache, width);
  const view: CardView = imageCardRenderer(port).mount(node(path), host, mode, ctx);
  const root = () => host.querySelector<HTMLElement>(".canvas-card-image");
  return { host, view, missing, lifetime, cache, root, state: () => root()?.dataset.state };
}

const settle = () => new Promise<void>((done) => setTimeout(done, 0));

let drawn: unknown[];
let urls: string[];
let revoked: string[];

beforeEach(() => {
  drawn = [];
  urls = [];
  revoked = [];
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:immagine-${++next}`;
    urls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => void revoked.push(url));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage: (source: unknown) => void drawn.push(source) }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("la riduzione", () => {
  it("chiede a createImageBitmap il doppio della scheda, una volta sola, e mette l'immagine in cache", async () => {
    const raster = stubCreateImageBitmap([20_000, 20_000]);
    const { port } = fakePort({ "Foto/grande.png": { bytes: png(20_000, 20_000), descriptor: descriptor("g", "image/png") } });
    const card = mount(port, "Foto/grande.png");
    await settle();

    // 300 × 2 = 600, arrotondato a 32: 608.
    expect(raster.create).toHaveBeenCalledTimes(1);
    expect(raster.create.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(raster.create.mock.calls[0]![1]).toMatchObject({ resizeWidth: 608 });
    expect(card.state()).toBe("picture");
    const canvas = card.host.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([608, 608]);
    expect(canvas.getAttribute("aria-label")).toBe("grande.png");
    expect(card.cache.get("Foto/grande.png", "whole@608")?.bitmap).toBe(raster.made[0]);
    expect(card.cache.size()).toBe(608 * 608 * 4);
    // L'URL del raster serve solo a decodificare: revocato subito.
    expect(revoked).toEqual(urls);
  });

  it("un'immagine 1×1 non si ingrandisce: niente resizeWidth", async () => {
    const raster = stubCreateImageBitmap([1, 1]);
    const { port } = fakePort({ "punto.png": { bytes: png(1, 1), descriptor: descriptor("p", "image/png") } });
    const card = mount(port, "punto.png");
    await settle();
    expect(raster.create).toHaveBeenCalledTimes(1);
    expect(raster.create.mock.calls[0]![1]).toBeUndefined();
    expect(card.host.querySelector("canvas")!.width).toBe(1);
  });

  it("legge la larghezza del JPEG dall'intestazione e riduce in una decodifica", async () => {
    expect(rasterSize("JPEG", jpeg([4000, 3000]))).toEqual([4000, 3000]);
    const raster = stubCreateImageBitmap([4000, 3000]);
    const { port } = fakePort({ "f.jpg": { bytes: jpeg([4000, 3000]), descriptor: descriptor("f", "image/jpeg") } });
    mount(port, "f.jpg");
    await settle();
    expect(raster.create).toHaveBeenCalledTimes(1);
    expect(raster.create.mock.calls[0]![1]).toMatchObject({ resizeWidth: 608 });
  });

  it("con la larghezza ignota decodifica una volta, poi riduce il bitmap e chiude l'intero", async () => {
    const raster = stubCreateImageBitmap([3000, 1500]);
    const { port } = fakePort({ "f.jpg": { bytes: jpeg(null), descriptor: descriptor("f", "image/jpeg") } });
    const card = mount(port, "f.jpg");
    await settle();
    expect(raster.create).toHaveBeenCalledTimes(2);
    expect(raster.create.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(raster.create.mock.calls[1]![0]).toBe(raster.made[0]);
    expect(raster.create.mock.calls[1]![1]).toMatchObject({ resizeWidth: 608 });
    expect(raster.made[0]!.closed).toBe(1);
    expect(card.cache.get("f.jpg", "whole@608")?.bitmap).toBe(raster.made[1]);
  });

  it("se il motore ignora resizeWidth, riduce in un canvas 2D e chiude il bitmap", async () => {
    const raster = stubCreateImageBitmap([2000, 1000], { honorResize: false });
    const { port } = fakePort({ "a.png": { bytes: png(2000, 1000), descriptor: descriptor("a", "image/png") } });
    const card = mount(port, "a.png");
    await settle();
    expect(raster.made[0]!.closed).toBe(1);
    const cached = card.cache.get("a.png", "whole@608")!;
    expect(cached.bitmap).toBeInstanceOf(HTMLCanvasElement);
    expect([cached.bitmap.width, cached.bitmap.height]).toEqual([608, 304]);
    expect(card.state()).toBe("picture");
  });

  it("senza createImageBitmap decodifica in un <img> fuori dal DOM e riduce in un canvas", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(600);
    const { port } = fakePort({ "a.png": { bytes: png(1200, 600), descriptor: descriptor("a", "image/png") } });
    const card = mount(port, "a.png");
    await settle();
    const cached = card.cache.get("a.png", "whole@608")!;
    expect([cached.bitmap.width, cached.bitmap.height]).toEqual([608, 304]);
    expect(card.host.querySelector("img")).toBeNull();
  });

  it("una GIF animata è la sua prima immagine, ferma: un bitmap, nessun <img>", async () => {
    const raster = stubCreateImageBitmap([10, 10]);
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 10, 0]);
    const { port } = fakePort({ "g.gif": { bytes: gif, descriptor: descriptor("g", "image/gif") } });
    const card = mount(port, "g.gif");
    await settle();
    expect(raster.create).toHaveBeenCalledTimes(1);
    expect(card.state()).toBe("picture");
    expect(card.host.querySelector("img")).toBeNull();
  });
});

describe("la cache", () => {
  it("la seconda accensione mostra l'immagine in cache senza leggere né decodificare", async () => {
    const raster = stubCreateImageBitmap([1000, 500]);
    const { port } = fakePort({ "a.png": { bytes: png(1000, 500), descriptor: descriptor("a", "image/png") } });
    const cache = new CardCache();
    const first = mount(port, "a.png", cache);
    await settle();
    first.view.destroy();

    const second = mount(port, "a.png", cache);
    await settle();
    expect(port.read).toHaveBeenCalledTimes(1);
    expect(raster.create).toHaveBeenCalledTimes(1);
    expect(second.state()).toBe("picture");
    expect(drawn[drawn.length - 1]).toBe(raster.made[0]);
  });

  it("ferma mostra l'immagine in cache se c'è, sennò titolo e specie, senza leggere", async () => {
    stubCreateImageBitmap([1000, 500]);
    const { port } = fakePort({ "a.png": { bytes: png(1000, 500), descriptor: descriptor("a", "image/png") } });
    const cache = new CardCache();
    const cold = mount(port, "a.png", cache, "snapshot");
    expect(cold.state()).toBe("placeholder");
    expect(cold.host.textContent).toBe("IMAGE · a.png");
    expect(port.read).not.toHaveBeenCalled();

    cold.view.setMode("live");
    await settle();
    expect(cold.state()).toBe("picture");
    cold.view.destroy();

    const warm = mount(port, "a.png", cache, "snapshot");
    expect(warm.state()).toBe("picture");
    expect(port.read).toHaveBeenCalledTimes(1);
  });

  it("una scheda che cambia misura chiede la nuova larghezza", async () => {
    const raster = stubCreateImageBitmap([4000, 2000]);
    const { port } = fakePort({ "a.png": { bytes: png(4000, 2000), descriptor: descriptor("a", "image/png") } });
    const host = document.createElement("div");
    let width = 300;
    const { ctx } = context("a.png", new CardCache());
    const view = imageCardRenderer(port).mount(node("a.png"), host, "live", { ...ctx, size: () => ({ width, height: 200 }) });
    await settle();
    width = 500;
    view.resize?.();
    await settle();
    expect(raster.create.mock.calls.map((call) => call[1]?.resizeWidth)).toEqual([608, 992]);
    // Un ritocco che arrotonda alla stessa parte non rilegge.
    width = 501;
    view.resize?.();
    await settle();
    expect(port.read).toHaveBeenCalledTimes(2);
  });
});

describe("l'SVG", () => {
  const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><script>alert(1)</script></svg>');

  it("è un <img> con l'URL del blob, mai un elemento svg nel DOM, e l'URL si revoca a destroy", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockReturnValue(new Promise(() => {}));
    const { port } = fakePort({ "logo.svg": { bytes: svg, descriptor: descriptor("l", "image/svg+xml") } });
    const card = mount(port, "logo.svg");
    await settle();
    expect(card.state()).toBe("vector");
    const img = card.host.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(urls[0]);
    expect(img.alt).toBe("logo.svg");
    expect(card.host.querySelector("svg, script")).toBeNull();
    expect(revoked).toEqual([]);

    card.view.destroy();
    expect(revoked).toEqual([urls[0]]);
    expect(card.root()).toBeNull();
  });

  it("dipinto, va in cache per la scheda ferma; fermandosi l'URL si revoca", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
    const { port } = fakePort({ "logo.svg": { bytes: svg, descriptor: descriptor("l", "image/svg+xml") } });
    const card = mount(port, "logo.svg");
    await settle();
    const cached = card.cache.get("logo.svg", "whole@608")!;
    expect([cached.bitmap.width, cached.bitmap.height]).toEqual([608, 304]);

    card.view.setMode("snapshot");
    expect(revoked).toEqual([urls[0]]);
    expect(card.state()).toBe("picture");
    expect(card.host.querySelector("img")).toBeNull();
  });
});

describe("i limiti e gli errori", () => {
  it("oltre 64 MiB dice che è troppo grande e non decodifica", async () => {
    const raster = stubCreateImageBitmap([10, 10]);
    const big = new Uint8Array(IMAGE_CARD_MAX_BYTES + 1);
    big.set(png(10, 10));
    const { port } = fakePort({
      "big.png": { bytes: big, descriptor: descriptor("b", "image/png", big.byteLength) },
      "declared.png": { bytes: png(10, 10), descriptor: descriptor("d", "image/png", IMAGE_CARD_MAX_BYTES + 1) },
    });
    for (const path of ["big.png", "declared.png"]) {
      const card = mount(port, path);
      await settle();
      expect(card.state()).toBe("too-large");
      expect(card.host.querySelector(".canvas-card-message")!.textContent).toBe(t("canvas.card.too_large", { name: path }));
    }
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(raster.create).not.toHaveBeenCalled();
  });

  it("proprio 64 MiB passa", async () => {
    stubCreateImageBitmap([10, 10]);
    const { port } = fakePort({ "ok.png": { bytes: png(10, 10), descriptor: descriptor("o", "image/png", IMAGE_CARD_MAX_BYTES) } });
    const card = mount(port, "ok.png");
    await settle();
    expect(card.state()).toBe("picture");
  });

  it("il file mancante chiama context.missing una volta e non apre il visore", async () => {
    const { port } = fakePort({});
    const card = mount(port, "via.png");
    await settle();
    expect(card.missing).toHaveBeenCalledTimes(1);
    expect(card.state()).toBe("missing");
    card.root()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(port.open).not.toHaveBeenCalled();
  });

  it("HEIC e un AVIF che il motore non decodifica sono schede di file con «Apri»", async () => {
    const raster = stubCreateImageBitmap([10, 10]);
    raster.create.mockRejectedValueOnce(new DOMException("unsupported", "InvalidStateError"));
    const avif = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    const { port } = fakePort({
      "a.heic": { bytes: new Uint8Array([1, 2, 3]), descriptor: descriptor("h", "image/heic") },
      "b.avif": { bytes: avif, descriptor: descriptor("v", "image/avif") },
    });
    for (const path of ["a.heic", "b.avif"]) {
      const card = mount(port, path);
      await settle();
      expect(card.state()).toBe("unreadable");
      expect(card.host.querySelector(".canvas-card-message")!.textContent).toBe(t("canvas.card.unreadable", { name: path }));
      const open = card.host.querySelector<HTMLButtonElement>(".canvas-card-open")!;
      expect(open.textContent).toBe(t("canvas.card.open"));
      open.click();
      expect(port.open).toHaveBeenLastCalledWith(path);
    }
    // L'URL dell'AVIF non decodificato si revoca lo stesso.
    expect(revoked).toEqual(urls);
  });

  it("una lettura che fallisce è una scheda di file, non un errore che esce", async () => {
    const { port } = fakePort({ "x.png": () => Promise.reject(new Error("rete")) });
    const card = mount(port, "x.png");
    await settle();
    expect(card.state()).toBe("unreadable");
  });
});

describe("il ciclo di vita", () => {
  it("il doppio clic apre il visore", async () => {
    stubCreateImageBitmap([10, 10]);
    const { port } = fakePort({ "a.png": { bytes: png(10, 10), descriptor: descriptor("a", "image/png") } });
    const card = mount(port, "a.png");
    await settle();
    card.root()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(port.open).toHaveBeenCalledWith("a.png");
  });

  it("una lettura che risponde dopo destroy non tocca il DOM e non decodifica", async () => {
    const raster = stubCreateImageBitmap([10, 10]);
    const late = deferred<ImageCardRead | null>();
    const { port } = fakePort({ "a.png": () => late.promise });
    const card = mount(port, "a.png");
    expect(card.state()).toBe("loading");
    card.view.destroy();
    expect(card.host.childElementCount).toBe(0);
    expect(port.unwatched).toBe(1);

    late.resolve({ bytes: png(10, 10), descriptor: descriptor("a", "image/png") });
    await settle();
    expect(card.host.childElementCount).toBe(0);
    expect(raster.create).not.toHaveBeenCalled();
    expect(card.missing).not.toHaveBeenCalled();
  });

  it("una decodifica che finisce dopo destroy chiude il bitmap, non lo mette in cache e revoca l'URL", async () => {
    const raster = stubCreateImageBitmap([10, 10]);
    raster.hold();
    const { port } = fakePort({ "a.png": { bytes: png(10, 10), descriptor: descriptor("a", "image/png") } });
    const card = mount(port, "a.png");
    await settle();
    card.view.destroy();
    expect(revoked).toEqual(urls);
    raster.release();
    await settle();
    expect(raster.made[0]!.closed).toBe(1);
    expect(card.cache.size()).toBe(0);
    expect(card.host.childElementCount).toBe(0);
  });

  it("il file che cambia mentre si decodifica: vince la lettura nuova, la vecchia si chiude", async () => {
    const raster = stubCreateImageBitmap([1000, 500]);
    raster.hold();
    const files = { "a.png": { bytes: png(1000, 500), descriptor: descriptor("a", "image/png") } };
    const { port, change } = fakePort(files);
    const card = mount(port, "a.png");
    await settle();
    expect(raster.create).toHaveBeenCalledTimes(1);

    change("a.png");
    await settle();
    raster.release();
    await settle();
    raster.release();
    await settle();
    expect(port.read).toHaveBeenCalledTimes(2);
    expect(raster.made).toHaveLength(2);
    expect(raster.made[0]!.closed).toBe(1);
    expect(card.cache.get("a.png", "whole@608")?.bitmap).toBe(raster.made[1]);
    expect(card.state()).toBe("picture");
  });

  it("un cambio del file a scheda ferma dimentica la cache e torna a titolo e specie", async () => {
    stubCreateImageBitmap([1000, 500]);
    const { port, change } = fakePort({ "a.png": { bytes: png(1000, 500), descriptor: descriptor("a", "image/png") } });
    const card = mount(port, "a.png");
    await settle();
    card.view.setMode("snapshot");
    expect(card.state()).toBe("picture");
    change("a.png");
    expect(card.cache.size()).toBe(0);
    expect(card.state()).toBe("placeholder");
    expect(port.read).toHaveBeenCalledTimes(1);
  });

  it("destroy chiude la Lifetime: niente più ascolti, setMode non fa niente", async () => {
    stubCreateImageBitmap([10, 10]);
    const { port } = fakePort({ "a.png": { bytes: png(10, 10), descriptor: descriptor("a", "image/png") } });
    const card = mount(port, "a.png", new CardCache(), "snapshot");
    card.view.destroy();
    expect(card.lifetime.closed).toBe(true);
    card.view.setMode("live");
    await settle();
    expect(port.read).not.toHaveBeenCalled();
  });
});
