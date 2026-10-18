// Il fondo del foglio delle annotazioni: la pagina del PDF disegnata da
// pdf.js sotto il disegno, dentro la carta dell'editor.
//
// Due canvas. La pagina intera a una risoluzione fissa c'è sempre, e segue la
// carta quando la vista si muove; il dettaglio della parte che si vede, alla
// risoluzione dello zoom, arriva quando la vista si ferma e solo se la pagina
// intera non basta. Ogni resa nasce in un canvas nuovo, che prende il posto
// del vecchio solo quando è finita: niente pagina a metà. I canvas stanno
// nella carta in percentuali, così lo zoom li porta con sé senza ridisegnarli.
//
// Le rese passano una alla volta, perché il motore ne interrompe una con la
// successiva, e una superata da un'altra pagina o da un'altra vista non si
// fa.

import type { PdfArea, PdfEngine } from "../../media/pdf-view";
import { sceneBox, type View } from "../view";

/// I pixel della pagina intera: una A4 a circa 2,8 pixel per punto.
const BASE_PIXELS = 4_000_000;
const BASE_MAX_SCALE = 4;
/// I pixel del dettaglio, e il lato che ogni browser regge in un canvas.
const DETAIL_PIXELS = 16_000_000;
const MAX_SIDE = 8192;
/// Quanto aspetta il dettaglio dopo l'ultimo movimento, in millisecondi.
const DETAIL_DELAY = 120;
/// Sotto questo rapporto fra lo zoom e la pagina intera il dettaglio non
/// serve.
const DETAIL_GAIN = 1.1;

export interface PageBackground {
  readonly element: HTMLElement;
  /// Il PDF da cui si disegna; `null` lascia le pagine bianche.
  setEngine(engine: PdfEngine | null): void;
  /// La pagina `index` (da 0) di misura `size` in punti: oltre l'ultima del
  /// PDF è bianca.
  show(index: number, size: readonly [number, number]): void;
  /// La vista è cambiata: la camera e la misura del foglio.
  view(camera: View, width: number, height: number): void;
  dispose(): void;
}

export interface PageBackgroundOptions {
  /// Una pagina che non si disegna: il motivo, per chi lo deve dire.
  readonly onError?: (error: unknown) => void;
}

function pixelRatio(): number {
  return typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

export function createPageBackground(options: PageBackgroundOptions = {}): PageBackground {
  const element = document.createElement("div");
  element.className = "pdf-background";
  element.setAttribute("aria-hidden", "true");

  let engine: PdfEngine | null = null;
  let index = -1;
  let size: readonly [number, number] = [1, 1];
  let baseScale = 0;
  let base: HTMLCanvasElement | null = null;
  let detail: { readonly canvas: HTMLCanvasElement; readonly area: PdfArea; readonly scale: number } | null = null;
  /// Cambia con la pagina e col PDF: una resa di prima non si mostra.
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let last: { camera: View; width: number; height: number } | null = null;

  const place = (canvas: HTMLCanvasElement, area: PdfArea): void => {
    canvas.style.left = `${(area.x / size[0]) * 100}%`;
    canvas.style.top = `${(area.y / size[1]) * 100}%`;
    canvas.style.width = `${(area.width / size[0]) * 100}%`;
    canvas.style.height = `${(area.height / size[1]) * 100}%`;
  };

  /// Mette in coda una resa di `area` a `scale`; `done` riceve il canvas
  /// finito, se nel frattempo niente l'ha superata.
  const render = (area: PdfArea, scale: number, done: (canvas: HTMLCanvasElement) => void): void => {
    const pdf = engine;
    const page = index;
    const mine = generation;
    queue = queue.then(async () => {
      if (disposed || mine !== generation || pdf === null) return;
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      try {
        if (!(await pdf.renderArea(page, canvas, scale, area))) return;
      } catch (error) {
        if (!disposed && mine === generation) options.onError?.(error);
        return;
      }
      if (disposed || mine !== generation) return;
      place(canvas, area);
      done(canvas);
    });
  };

  const clearDetail = (): void => {
    detail?.canvas.remove();
    detail = null;
  };

  /// La parte della pagina che si vede, in punti interi; `null` se non se
  /// ne vede niente. Sul foglio girato, il riquadro dritto attorno a ciò
  /// che si vede.
  const visible = (camera: View, width: number, height: number): PdfArea | null => {
    const seen = sceneBox(camera, { x: 0, y: 0, w: width, h: height });
    const x0 = Math.max(0, Math.floor(seen.min[0]));
    const y0 = Math.max(0, Math.floor(seen.min[1]));
    const x1 = Math.min(size[0], Math.ceil(seen.max[0]));
    const y1 = Math.min(size[1], Math.ceil(seen.max[1]));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  };

  const refine = (): void => {
    timer = null;
    if (disposed || engine === null || index < 0 || index >= engine.pageCount || last === null) return;
    const wanted = last.camera.scale * pixelRatio();
    if (wanted <= baseScale * DETAIL_GAIN) {
      clearDetail();
      return;
    }
    const area = visible(last.camera, last.width, last.height);
    if (area === null) return;
    let scale = Math.min(wanted, Math.sqrt(DETAIL_PIXELS / (area.width * area.height)), MAX_SIDE / Math.max(area.width, area.height));
    scale = Math.max(scale, baseScale);
    // Lo stesso dettaglio di prima non si ridisegna.
    if (detail !== null && detail.scale === scale && detail.area.x === area.x && detail.area.y === area.y && detail.area.width === area.width && detail.area.height === area.height) return;
    render(area, scale, (canvas) => {
      clearDetail();
      detail = { canvas, area, scale };
      element.append(canvas);
    });
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(refine, DETAIL_DELAY);
  };

  const redraw = (): void => {
    generation++;
    base?.remove();
    base = null;
    clearDetail();
    if (engine === null || index < 0 || index >= engine.pageCount) return;
    baseScale = Math.min(BASE_MAX_SCALE, Math.sqrt(BASE_PIXELS / (size[0] * size[1])), MAX_SIDE / Math.max(size[0], size[1]));
    render({ x: 0, y: 0, width: size[0], height: size[1] }, baseScale, (canvas) => {
      base = canvas;
      element.prepend(canvas);
    });
    schedule();
  };

  return {
    element,
    setEngine(next) {
      if (next === engine) return;
      engine = next;
      redraw();
    },
    show(next, nextSize) {
      if (next === index && nextSize[0] === size[0] && nextSize[1] === size[1]) return;
      index = next;
      size = nextSize;
      redraw();
    },
    view(camera, width, height) {
      last = { camera, width, height };
      if (engine !== null) schedule();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      if (timer !== null) clearTimeout(timer);
      element.remove();
    },
  };
}
