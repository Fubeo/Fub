// @vitest-environment happy-dom
// Le pagine dei PDF disegnate fuori dal thread principale (#525): il worker
// serve una pagina alla volta e l'ultima richiesta vince; il lato principale
// butta le pagine superate; il motore disegna nel thread principale finché
// il worker non c'è, se non sa disegnare o se cade; il visore mette la pagina
// in un canvas `bitmaprenderer`, e senza resta a `renderPage`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { Lifetime } from "../../ui/lifetime";
import { openPdfRenderWorker, PDF_RENDER_WORKER_MAX_BYTES, PdfRenderUnavailable, type RenderWorkerLike } from "./pdf-render-client";
import { pdfRenderer, type PdfRenderReply, type PdfRenderRequest, type RenderCanvas, type RendererPdfJs } from "./pdf-render-serve";
import { makePdfJsLoader, mountPdfView, PDFJS_VERSION, type PdfEngine, type PdfJsModule } from "./pdf-view";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

/// Una resa che finisce quando la si fa finire, o che si interrompe.
function task() {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const cancel = vi.fn(() => fail(new Error("annullata")));
  return { promise, cancel, finish };
}

/// Il pdf.js del worker, finto: pagine di 600 × 800 punti, rese tenute in mano.
function workerPdfJs(version = PDFJS_VERSION) {
  const tasks: ReturnType<typeof task>[] = [];
  const pdfjs: RendererPdfJs = {
    version,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: async () => ({
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render: () => {
            const made = task();
            tasks.push(made);
            return made;
          },
        }),
      }),
      destroy: async () => {},
    }),
  };
  return { pdfjs, tasks };
}

function renderCanvas(): RenderCanvas {
  return {
    width: 1,
    height: 1,
    getContext: () => ({}),
    transferToImageBitmap(this: RenderCanvas) {
      return bitmap(this.width, this.height);
    },
  };
}

function serving(options: { canvas?: boolean; fonts?: boolean; version?: string } = {}) {
  const { pdfjs, tasks } = workerPdfJs(options.version);
  const replies: { reply: PdfRenderReply; transfer?: Transferable[] }[] = [];
  const serve = pdfRenderer({
    loadPdfJs: async () => pdfjs,
    makeCanvas: () => (options.canvas === false ? null : renderCanvas()),
    fonts: options.fonts === false ? undefined : {},
    post: (reply, transfer) => replies.push({ reply, transfer }),
  });
  return { serve, replies, tasks };
}

const open: PdfRenderRequest = { type: "open", bytes: new Uint8Array([1]), workerSrc: "/pdf.worker.mjs", version: PDFJS_VERSION };

describe("il worker che disegna le pagine", () => {
  it("apre il PDF e manda la pagina come immagine, alla misura della scala", async () => {
    const { serve, replies, tasks } = serving();
    await serve(open);
    expect(replies.map(({ reply }) => reply)).toEqual([{ type: "opened", pageCount: 3 }]);
    const done = serve({ type: "render", id: 1, index: 0, scale: 1.5 });
    await vi.waitFor(() => expect(tasks).toHaveLength(1));
    tasks[0]!.finish();
    await done;
    const { reply, transfer } = replies[1]!;
    expect(reply).toMatchObject({ type: "rendered", id: 1, bitmap: { width: 900, height: 1200 } });
    expect(transfer).toEqual([(reply as { bitmap: ImageBitmap }).bitmap]);
  });

  it("una richiesta nuova interrompe quella in corso, che risponde «superata»", async () => {
    const { serve, replies, tasks } = serving();
    await serve(open);
    const first = serve({ type: "render", id: 1, index: 0, scale: 1 });
    await vi.waitFor(() => expect(tasks).toHaveLength(1));
    const second = serve({ type: "render", id: 2, index: 1, scale: 1 });
    expect(tasks[0]!.cancel).toHaveBeenCalled();
    await first;
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    tasks[1]!.finish();
    await second;
    expect(replies.slice(1).map(({ reply }) => [reply.type, (reply as { id: number }).id])).toEqual([["skipped", 1], ["rendered", 2]]);
  });

  it("una pagina fuori dal PDF è un errore di quella richiesta", async () => {
    const { serve, replies } = serving();
    await serve(open);
    await serve({ type: "render", id: 1, index: 9, scale: 1 });
    expect(replies[1]!.reply).toMatchObject({ type: "error", id: 1 });
  });

  it("senza OffscreenCanvas 2d, o senza font, dice che non sa disegnare", async () => {
    const noCanvas = serving({ canvas: false });
    await noCanvas.serve(open);
    expect(noCanvas.replies[0]!.reply).toMatchObject({ type: "unsupported" });
    const noFonts = serving({ fonts: false });
    await noFonts.serve(open);
    expect(noFonts.replies[0]!.reply).toMatchObject({ type: "unsupported" });
  });

  it("un pdf.js di un'altra versione non apre il PDF", async () => {
    const { serve, replies } = serving({ version: "1.0.0" });
    await serve(open);
    expect(replies[0]!.reply).toMatchObject({ type: "failed" });
  });
});

/// Un worker finto collegato a `pdfRenderer`, coi messaggi in differita come
/// quelli veri; `crash()` lo fa cadere.
function fakeWorker(options: Parameters<typeof serving>[0] = {}) {
  const side = serving(options);
  const listeners = new Map<string, ((event: { data: PdfRenderReply }) => void)[]>();
  const emit = (type: string, data?: PdfRenderReply) => {
    for (const listener of listeners.get(type) ?? []) listener({ data: data! });
  };
  const posted: PdfRenderRequest[] = [];
  let forwarded = 0;
  const worker = {
    postMessage(message: PdfRenderRequest) {
      posted.push(message);
      setTimeout(() => void side.serve(message), 0);
    },
    addEventListener(type: string, listener: (event: { data: PdfRenderReply }) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    terminate: vi.fn(),
  };
  // Le risposte di `pdfRenderer` arrivano al lato principale in differita.
  const pump = setInterval(() => {
    while (forwarded < side.replies.length) emit("message", side.replies[forwarded++]!.reply);
  }, 1);
  return {
    worker: worker as unknown as RenderWorkerLike,
    tasks: side.tasks,
    posted,
    terminate: worker.terminate,
    crash: () => emit("error"),
    stop: () => clearInterval(pump),
  };
}

const workers: ReturnType<typeof fakeWorker>[] = [];
function made(options: Parameters<typeof serving>[0] = {}) {
  const made = fakeWorker(options);
  workers.push(made);
  return made;
}

afterEach(() => {
  for (const worker of workers.splice(0)) worker.stop();
  vi.unstubAllGlobals();
});

describe("il lato principale del worker", () => {
  it("riceve la pagina; quella superata è `null` e la sua immagine si chiude", async () => {
    const fake = made();
    const renderer = await openPdfRenderWorker(fake.worker, { bytes: new Uint8Array([1]), workerSrc: "/w.mjs", version: PDFJS_VERSION });
    const first = renderer.render(0, 1);
    await vi.waitFor(() => expect(fake.tasks).toHaveLength(1));
    // La prima finisce davanti alla seconda richiesta: arriva tardi e si butta.
    fake.tasks[0]!.finish();
    const second = renderer.render(1, 2);
    await expect(first).resolves.toBeNull();
    await vi.waitFor(() => expect(fake.tasks).toHaveLength(2));
    fake.tasks[1]!.finish();
    await expect(second).resolves.toMatchObject({ width: 1200, height: 1600 });
    renderer.destroy();
    expect(fake.terminate).toHaveBeenCalled();
  });

  it("un worker che cade rifiuta la richiesta in corso e le prossime", async () => {
    const fake = made();
    const renderer = await openPdfRenderWorker(fake.worker, { bytes: new Uint8Array([1]), workerSrc: "/w.mjs", version: PDFJS_VERSION });
    const pending = renderer.render(0, 1);
    fake.crash();
    await expect(pending).rejects.toBeInstanceOf(PdfRenderUnavailable);
    await expect(renderer.render(1, 1)).rejects.toBeInstanceOf(PdfRenderUnavailable);
    expect(fake.terminate).toHaveBeenCalled();
  });

  it("un worker che non sa disegnare non si apre, e si chiude", async () => {
    const fake = made({ canvas: false });
    await expect(openPdfRenderWorker(fake.worker, { bytes: new Uint8Array([1]), workerSrc: "/w.mjs", version: PDFJS_VERSION }))
      .rejects.toBeInstanceOf(PdfRenderUnavailable);
    expect(fake.terminate).toHaveBeenCalled();
  });

  it("un worker che non risponde si lascia perdere dopo l'attesa", async () => {
    const silent = { postMessage: vi.fn(), addEventListener: vi.fn(), terminate: vi.fn() };
    await expect(openPdfRenderWorker(silent, { bytes: new Uint8Array([1]), workerSrc: "/w.mjs", version: PDFJS_VERSION }, { openTimeoutMs: 5 }))
      .rejects.toBeInstanceOf(PdfRenderUnavailable);
    expect(silent.terminate).toHaveBeenCalled();
  });

  it("una pagina che il worker non manda entro il tempo lo chiude: la richiesta rifiuta", async () => {
    const fake = made();
    const renderer = await openPdfRenderWorker(fake.worker, { bytes: new Uint8Array([1]), workerSrc: "/w.mjs", version: PDFJS_VERSION }, { pageTimeoutMs: 5 });
    // La resa non finisce mai e il worker non dà errore: è bloccato.
    await expect(renderer.render(0, 1)).rejects.toMatchObject({ name: "PdfRenderUnavailable", reason: "timeout" });
    expect(fake.terminate).toHaveBeenCalled();
    await expect(renderer.render(1, 1)).rejects.toBeInstanceOf(PdfRenderUnavailable);
  });

  it("chiuso il documento, l'apertura rifiuta subito, senza aspettare il tempo", async () => {
    const silent = { postMessage: vi.fn(), addEventListener: vi.fn(), terminate: vi.fn() };
    const closing = new AbortController();
    const bytes = new Uint8Array([1, 2, 3]);
    const opening = openPdfRenderWorker(silent, { bytes, workerSrc: "/w.mjs", version: PDFJS_VERSION }, { signal: closing.signal, openTimeoutMs: 60_000 });
    // I byte vanno al worker spostati, non copiati.
    expect(silent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "open", bytes }), [bytes.buffer]);
    closing.abort();
    await expect(opening).rejects.toMatchObject({ reason: "closed" });
    expect(silent.terminate).toHaveBeenCalled();
  });
});

/// Un worker che risponde solo quando lo dice il test, in modo sincrono.
function manualWorker() {
  const listeners = new Map<string, ((event: { data: PdfRenderReply }) => void)[]>();
  const posted: PdfRenderRequest[] = [];
  const worker = {
    postMessage: (message: PdfRenderRequest) => void posted.push(message),
    addEventListener(type: string, listener: (event: { data: PdfRenderReply }) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    terminate: vi.fn(),
  };
  const reply = (data: PdfRenderReply) => {
    for (const listener of listeners.get("message") ?? []) listener({ data });
  };
  return { worker: worker as unknown as RenderWorkerLike, posted, reply, terminate: worker.terminate };
}

/// Il pdf.js del thread principale, finto: le rese finiscono subito e si contano.
function mainPdfJs() {
  const renders: number[] = [];
  const document_ = {
    numPages: 3,
    getPage: async (page: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      getTextContent: async () => ({ items: [] }),
      render: () => {
        renders.push(page);
        return { promise: Promise.resolve(), cancel: () => {} };
      },
    }),
    getData: async () => new Uint8Array([1, 2, 3]),
  };
  const pdfjs = {
    version: PDFJS_VERSION,
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({ promise: Promise.resolve(document_), destroy: async () => {} }),
  } as unknown as PdfJsModule;
  return { pdfjs, renders };
}

/// La WebView sa disegnare fuori dallo schermo: `OffscreenCanvas`,
/// `createImageBitmap` e un canvas 2d (happy-dom non ne ha).
function offscreenWebView() {
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("createImageBitmap", vi.fn(async (source: HTMLCanvasElement) => bitmap(source.width, source.height)));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({}) as never);
}

describe("il motore e le pagine in immagine", () => {
  afterEach(() => vi.restoreAllMocks());

  it("senza OffscreenCanvas il motore non offre le immagini: il visore resta a `renderPage`", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const makeWorker = vi.fn(() => made().worker);
    const engine = await makePdfJsLoader(async () => mainPdfJs().pdfjs, "/pdf.worker.mjs", makeWorker)(new Uint8Array([1]));
    expect(engine.renderBitmap).toBeUndefined();
    expect(makeWorker).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("senza il worker del composer il motore non offre le immagini", async () => {
    offscreenWebView();
    const engine = await makePdfJsLoader(async () => mainPdfJs().pdfjs, "/pdf.worker.mjs")(new Uint8Array([1]));
    expect(engine.renderBitmap).toBeUndefined();
    engine.destroy();
  });

  it("la prima pagina si disegna qui mentre il worker apre il PDF, le altre nel worker", async () => {
    offscreenWebView();
    const { pdfjs, renders } = mainPdfJs();
    const fake = made();
    const engine = await makePdfJsLoader(async () => pdfjs, "/pdf.worker.mjs", () => fake.worker)(new Uint8Array([1]));
    await expect(engine.renderBitmap!(0, 2)).resolves.toMatchObject({ width: 1200, height: 1600 });
    expect(renders).toEqual([1]);
    expect(fake.posted[0]).toMatchObject({ type: "open", workerSrc: `${location.origin}/pdf.worker.mjs`, version: PDFJS_VERSION });
    await vi.waitFor(() => expect(fake.posted.length).toBe(1));
    await settle();
    await settle();
    const second = engine.renderBitmap!(1, 1);
    await vi.waitFor(() => expect(fake.tasks).toHaveLength(1));
    fake.tasks[0]!.finish();
    await expect(second).resolves.toMatchObject({ width: 600, height: 800 });
    expect(renders).toEqual([1]);
    await expect(engine.renderBitmap!(7, 1)).rejects.toThrow();
    engine.destroy();
    expect(fake.terminate).toHaveBeenCalled();
  });

  it("caduto il worker, la pagina in corso e le prossime si disegnano qui", async () => {
    offscreenWebView();
    const { pdfjs, renders } = mainPdfJs();
    const fake = made();
    const engine = await makePdfJsLoader(async () => pdfjs, "/pdf.worker.mjs", () => fake.worker)(new Uint8Array([1]));
    await engine.renderBitmap!(0, 1);
    await vi.waitFor(async () => {
      await settle();
      expect(fake.posted).toHaveLength(1);
    });
    await settle();
    await settle();
    const pending = engine.renderBitmap!(1, 1);
    await vi.waitFor(() => expect(fake.tasks).toHaveLength(1));
    fake.crash();
    await expect(pending).resolves.toMatchObject({ width: 600 });
    await engine.renderBitmap!(2, 1);
    expect(renders).toEqual([1, 2, 3]);
    engine.destroy();
  });

  it("un PDF oltre il limite non apre il worker: la sua memoria non raddoppia", async () => {
    offscreenWebView();
    const makeWorker = vi.fn(() => made().worker);
    const load = makePdfJsLoader(async () => mainPdfJs().pdfjs, "/pdf.worker.mjs", makeWorker);
    const big = await load(new Uint8Array(PDF_RENDER_WORKER_MAX_BYTES + 1));
    expect(big.renderBitmap).toBeUndefined();
    const fits = await load(new Uint8Array(PDF_RENDER_WORKER_MAX_BYTES));
    expect(fits.renderBitmap).toBeTypeOf("function");
    big.destroy();
    fits.destroy();
    expect(makeWorker).not.toHaveBeenCalled();
  });

  it("una WebView che non sa disegnare nel worker lo dice una volta: i PDF dopo non aprono il worker", async () => {
    offscreenWebView();
    const fake = made({ fonts: false });
    const makeWorker = vi.fn(() => fake.worker);
    const load = makePdfJsLoader(async () => mainPdfJs().pdfjs, "/pdf.worker.mjs", makeWorker);
    const first = await load(new Uint8Array([1]));
    await first.renderBitmap!(0, 1);
    await vi.waitFor(() => expect(fake.terminate).toHaveBeenCalled());
    await settle();
    const second = await load(new Uint8Array([1]));
    expect(second.renderBitmap).toBeUndefined();
    expect(makeWorker).toHaveBeenCalledTimes(1);
    first.destroy();
    second.destroy();
  });

  it("una pagina del worker arrivata a documento chiuso si chiude, e il motore dà `null`", async () => {
    offscreenWebView();
    const manual = manualWorker();
    const engine = await makePdfJsLoader(async () => mainPdfJs().pdfjs, "/pdf.worker.mjs", () => manual.worker)(new Uint8Array([1]));
    await engine.renderBitmap!(0, 1);
    await vi.waitFor(() => expect(manual.posted).toHaveLength(1));
    manual.reply({ type: "opened", pageCount: 3 });
    await settle();
    const pending = engine.renderBitmap!(1, 1);
    await vi.waitFor(() => expect(manual.posted).toHaveLength(2));
    const late = bitmap(600, 800);
    const id = (manual.posted[1] as { id: number }).id;
    // La pagina arriva, e nello stesso giro il documento si chiude.
    manual.reply({ type: "rendered", id, bitmap: late });
    engine.destroy();
    await expect(pending).resolves.toBeNull();
    expect(late.close).toHaveBeenCalled();
  });

  it("chiuso il PDF mentre il worker lo apre, il worker si chiude", async () => {
    offscreenWebView();
    const silent = { postMessage: vi.fn(), addEventListener: vi.fn(), terminate: vi.fn() };
    const engine = await makePdfJsLoader(async () => mainPdfJs().pdfjs, "/pdf.worker.mjs", () => silent)(new Uint8Array([1]));
    await engine.renderBitmap!(0, 1);
    await vi.waitFor(() => expect(silent.postMessage).toHaveBeenCalled());
    engine.destroy();
    expect(silent.terminate).toHaveBeenCalled();
  });
});

describe("il visore e le pagine in immagine", () => {
  const lives: Lifetime[] = [];
  afterEach(() => {
    for (const life of lives.splice(0)) life.close();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function engine(extra: Partial<PdfEngine>): PdfEngine {
    return {
      pageCount: 2,
      search: async () => [],
      renderPage: vi.fn(async () => {}),
      pageSize: async () => [600, 800] as const,
      renderArea: async () => true,
      destroy: () => {},
      ...extra,
    };
  }

  async function mount(loaded: PdfEngine) {
    const life = new Lifetime();
    lives.push(life);
    const view = mountPdfView({ id: "manuale.pdf", mime: "application/pdf" } as never, new Uint8Array([1]), { loader: async () => loaded }, life);
    document.body.append(view.element);
    await settle();
    await settle();
    await settle();
    return view.element.querySelector<HTMLCanvasElement>(".media-pdf-page canvas")!;
  }

  it("mette l'immagine del motore nel canvas, alla misura della pagina", async () => {
    const transfer = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "bitmaprenderer" ? { transferFromImageBitmap: transfer } : null) as never);
    const image = bitmap(1200, 1600);
    const loaded = engine({ renderBitmap: vi.fn(async () => image) });
    const canvas = await mount(loaded);
    expect(transfer).toHaveBeenCalledWith(image);
    expect(loaded.renderPage).not.toHaveBeenCalled();
    expect([canvas.width, canvas.height]).toEqual([1200, 1600]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["600px", "800px"]);
  });

  it("una pagina superata non tocca il canvas", async () => {
    const transfer = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "bitmaprenderer" ? { transferFromImageBitmap: transfer } : null) as never);
    const canvas = await mount(engine({ renderBitmap: vi.fn(async () => null) }));
    expect(transfer).not.toHaveBeenCalled();
    expect(canvas.style.width).toBe("");
  });

  /// Un motore che tiene in mano misure e pagine: le si danno quando lo dice il test.
  function heldEngine(slowSize: number | null) {
    let releaseSize!: () => void;
    const sizeGate = new Promise<void>((resolve) => { releaseSize = resolve; });
    const asked: { index: number; scale: number; give(image: ImageBitmap | null): void }[] = [];
    const loaded = engine({
      pageCount: 5,
      pageSize: async (index: number) => {
        if (index === slowSize) await sizeGate;
        return [600, 800] as const;
      },
      renderBitmap: vi.fn((index: number, scale: number) => new Promise<ImageBitmap | null>((give) => asked.push({ index, scale, give }))),
    });
    return { loaded, asked, releaseSize };
  }

  async function mountView(loaded: PdfEngine) {
    const life = new Lifetime();
    lives.push(life);
    const view = mountPdfView({ id: "manuale.pdf", mime: "application/pdf" } as never, new Uint8Array([1]), { loader: async () => loaded }, life);
    document.body.append(view.element);
    await settle();
    await settle();
    return view;
  }

  it("una pagina lasciata mentre si misura non chiede l'immagine e non scavalca quella dopo", async () => {
    const transfer = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "bitmaprenderer" ? { transferFromImageBitmap: transfer } : null) as never);
    const { loaded, asked, releaseSize } = heldEngine(4);
    const view = await mountView(loaded);
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    asked[0]!.give(bitmap(600, 800));
    // La 5 misura piano; intanto si va alla 3, che si misura subito.
    void view.goToPage(5);
    const third = view.goToPage(3);
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    releaseSize();
    await settle();
    await settle();
    expect(asked.map((ask) => ask.index)).toEqual([0, 2]);
    const image = bitmap(600, 800);
    asked[1]!.give(image);
    await third;
    expect(transfer).toHaveBeenLastCalledWith(image);
  });

  it("una pagina fatta con lo zoom di prima non si mette nel canvas", async () => {
    const transfer = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "bitmaprenderer" ? { transferFromImageBitmap: transfer } : null) as never);
    const { loaded, asked } = heldEngine(null);
    const view = await mountView(loaded);
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    // «Adatta alla larghezza» mentre la pagina a zoom 1 è ancora nel worker.
    view.element.querySelector<HTMLButtonElement>(`button[aria-label="${t("media.pdf.fit_width")}"]`)!.click();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    const fitted = bitmap(900, 1200);
    asked[1]!.give(fitted);
    await settle();
    const old = bitmap(600, 800);
    asked[0]!.give(old);
    await settle();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer).toHaveBeenLastCalledWith(fitted);
    expect(old.close).toHaveBeenCalled();
  });

  it("senza `bitmaprenderer` disegna con `renderPage`", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    const renderBitmap = vi.fn(async () => bitmap(1, 1));
    const loaded = engine({ renderBitmap });
    await mount(loaded);
    expect(renderBitmap).not.toHaveBeenCalled();
    expect(loaded.renderPage).toHaveBeenCalled();
  });
});
