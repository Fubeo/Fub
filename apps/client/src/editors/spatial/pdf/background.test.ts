// @vitest-environment happy-dom
// Il fondo del foglio delle annotazioni: la pagina intera, il dettaglio della
// parte che si vede quando la vista si ferma, e nessuna resa vecchia al posto
// di una nuova. Più l'adattatore di pdf.js per misura e parti di pagina.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePdfJsLoader, type PdfArea, type PdfEngine, type PdfJsModule } from "../../media/pdf-view";
import { createPageBackground, type PageBackground } from "./background";

interface Render {
  readonly index: number;
  readonly scale: number;
  readonly area: PdfArea;
  finish(ok?: boolean): void;
  fail(error: unknown): void;
}

/// Un motore che rende solo quando il test lo dice.
function fakeEngine(pageCount = 3): { engine: PdfEngine; renders: Render[] } {
  const renders: Render[] = [];
  const engine: PdfEngine = {
    pageCount,
    search: async () => [],
    renderPage: async () => {},
    pageSize: async () => [600, 800],
    renderArea: (index, _canvas, scale, area) =>
      new Promise<boolean>((resolve, reject) => {
        renders.push({ index, scale, area, finish: (ok = true) => resolve(ok), fail: reject });
      }),
    destroy: () => {},
  };
  return { engine, renders };
}

const canvases = (background: PageBackground): HTMLCanvasElement[] => [...background.element.querySelectorAll("canvas")];

let background: PageBackground;
let errors: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  errors = [];
  background = createPageBackground({ onError: (error) => errors.push(error) });
});

afterEach(() => {
  background.dispose();
  vi.useRealTimers();
});

describe("la pagina intera", () => {
  it("si rende a circa quattro milioni di pixel, ed entra nella carta in percentuali", async () => {
    const { engine, renders } = fakeEngine();
    expect(background.element.getAttribute("aria-hidden")).toBe("true");
    background.setEngine(engine);
    background.show(1, [600, 800]);
    await vi.advanceTimersByTimeAsync(0);
    expect(renders).toHaveLength(1);
    expect(renders[0]!.index).toBe(1);
    expect(renders[0]!.area).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(renders[0]!.scale).toBeCloseTo(Math.sqrt(4_000_000 / (600 * 800)));
    expect(canvases(background)).toHaveLength(0);
    renders[0]!.finish();
    await vi.advanceTimersByTimeAsync(0);
    const [canvas] = canvases(background);
    expect(canvas!.className).toBe("pdf-canvas");
    expect([canvas!.style.left, canvas!.style.top, canvas!.style.width, canvas!.style.height]).toEqual(["0%", "0%", "100%", "100%"]);
  });

  it("oltre l'ultima pagina del PDF, o senza PDF, la carta resta bianca", async () => {
    const { engine, renders } = fakeEngine(2);
    background.show(0, [600, 800]);
    await vi.advanceTimersByTimeAsync(500);
    background.setEngine(engine);
    background.show(5, [600, 800]);
    await vi.advanceTimersByTimeAsync(500);
    expect(renders).toHaveLength(0);
    expect(canvases(background)).toHaveLength(0);
  });

  it("una resa superata da un'altra pagina non si mostra, e la nuova prende il posto della vecchia", async () => {
    const { engine, renders } = fakeEngine();
    background.setEngine(engine);
    background.show(0, [600, 800]);
    await vi.advanceTimersByTimeAsync(0);
    background.show(1, [600, 800]);
    renders[0]!.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(canvases(background)).toHaveLength(0);
    expect(renders.map((render) => render.index)).toEqual([0, 1]);
    renders[1]!.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(canvases(background)).toHaveLength(1);
    background.setEngine(null);
    expect(canvases(background)).toHaveLength(0);
  });

  it("una pagina che non si rende lo dice a chi la mostra", async () => {
    const { engine, renders } = fakeEngine();
    background.setEngine(engine);
    background.show(0, [600, 800]);
    await vi.advanceTimersByTimeAsync(0);
    renders[0]!.fail(new Error("rotta"));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual([new Error("rotta")]);
    expect(canvases(background)).toHaveLength(0);
  });
});

describe("il dettaglio", () => {
  it("arriva quando la vista si ferma, per la parte che si vede, alla risoluzione dello zoom", async () => {
    const { engine, renders } = fakeEngine();
    background.setEngine(engine);
    background.show(0, [600, 800]);
    await vi.advanceTimersByTimeAsync(0);
    renders[0]!.finish();
    // Zoom 8, la vista larga 400 e alta 300 parte dal punto (100, 200).
    background.view({ scale: 8, tx: -800, ty: -1600 }, 400, 300);
    await vi.advanceTimersByTimeAsync(100);
    expect(renders).toHaveLength(1);
    background.view({ scale: 8, tx: -800, ty: -1600 }, 400, 300);
    await vi.advanceTimersByTimeAsync(120);
    expect(renders).toHaveLength(2);
    expect(renders[1]!.area).toEqual({ x: 100, y: 200, width: 50, height: 38 });
    expect(renders[1]!.scale).toBe(8);
    renders[1]!.finish();
    await vi.advanceTimersByTimeAsync(0);
    const [base, detail] = canvases(background);
    expect(base!.style.width).toBe("100%");
    expect(detail!.style.left).toBe(`${(100 / 600) * 100}%`);
    // Lo stesso dettaglio non si ridisegna.
    background.view({ scale: 8, tx: -800, ty: -1600 }, 400, 300);
    await vi.advanceTimersByTimeAsync(200);
    expect(renders).toHaveLength(2);
  });

  it("non serve quando la pagina intera basta, e se ne va tornando indietro", async () => {
    const { engine, renders } = fakeEngine();
    background.setEngine(engine);
    background.show(0, [600, 800]);
    await vi.advanceTimersByTimeAsync(0);
    renders[0]!.finish();
    background.view({ scale: 1, tx: 0, ty: 0 }, 400, 300);
    await vi.advanceTimersByTimeAsync(200);
    expect(renders).toHaveLength(1);
    background.view({ scale: 6, tx: 0, ty: 0 }, 400, 300);
    await vi.advanceTimersByTimeAsync(200);
    renders[1]!.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(canvases(background)).toHaveLength(2);
    background.view({ scale: 1, tx: 0, ty: 0 }, 400, 300);
    await vi.advanceTimersByTimeAsync(200);
    expect(canvases(background)).toHaveLength(1);
  });
});

describe("l'adattatore di pdf.js", () => {
  it("misura la pagina girata a scala 1 e rende un'area spostata nell'origine del canvas", async () => {
    const viewports: unknown[] = [];
    const page = {
      getViewport: (options: { scale: number; offsetX?: number; offsetY?: number }) => {
        viewports.push(options);
        return { width: 842 * options.scale, height: 595 * options.scale };
      },
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      getTextContent: async () => ({ items: [] }),
    };
    const module = {
      version: "6.3.289",
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 2, getPage: async () => page, destroy: async () => {} }),
        destroy: async () => {},
      }),
    } as unknown as PdfJsModule;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const engine = await makePdfJsLoader(async () => module, "/pdf.worker.mjs")(new Uint8Array([1]));
    expect(await engine.pageSize(1)).toEqual([842, 595]);
    const canvas = document.createElement("canvas");
    expect(await engine.renderArea(0, canvas, 2, { x: 10, y: 20, width: 100.5, height: 50 })).toBe(true);
    expect(viewports).toEqual([{ scale: 1 }, { scale: 2, offsetX: -20, offsetY: -40 }]);
    expect([canvas.width, canvas.height]).toEqual([201, 100]);
    await expect(engine.pageSize(2)).rejects.toThrow(/unavailable/);
    engine.destroy();
    await expect(engine.renderArea(0, canvas, 1, { x: 0, y: 0, width: 1, height: 1 })).rejects.toThrow(/unavailable/);
  });
});
