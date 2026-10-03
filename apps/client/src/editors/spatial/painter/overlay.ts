// Lo strato sopra la scena: l'inchiostro mentre si scrive e le maniglie
// della selezione, su un canvas 2D grande quanto la vista.
//
// Non entra mai nel documento: è ciò che la superficie mostra fra un
// evento e l'operazione che lo registrerà. L'inchiostro in corso si riempie
// con la stessa costruzione di `outlinePath` (curve quadratiche per i punti
// medi del contorno), così il tratto non cambia forma quando l'operazione lo
// scrive; manca solo l'arrotondamento a due decimali, che a schermo non si
// vede. Più tratti insieme hanno chiavi diverse: quello della penna locale e
// quelli che una sessione live riceve dal tablet.
//
// I ridisegni si raccolgono in un fotogramma; `flush` disegna subito.

import type { Matrix, Point } from "../scene/matrix";
import type { OutlinePoint } from "../ink/pf1";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { PainterView } from "./svg-dom";

/// Un tratto in corso.
export interface InkPreview {
  /// Il contorno di `pf1Outline`, nelle coordinate locali del tratto.
  readonly outline: readonly OutlinePoint[];
  /// Da coordinate locali a coordinate della scena: la trasformazione del
  /// livello in cui il tratto entrerà.
  readonly matrix: Matrix;
  /// Un colore CSS.
  readonly color: string;
  readonly opacity: number;
}

/// Una maniglia, in coordinate della scena.
export type OverlayHandle =
  /// Il riquadro di un elemento selezionato: il rettangolo locale portato
  /// nella scena da `matrix`.
  | { readonly kind: "box"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly matrix: Matrix }
  /// Un punto da trascinare, di misura fissa sullo schermo.
  | { readonly kind: "grip"; readonly x: number; readonly y: number }
  /// Il contorno di una selezione a mano libera, tratteggiato.
  | { readonly kind: "lasso"; readonly points: readonly Point[] };

export interface SceneOverlay {
  setView(view: PainterView): void;
  /// Mostra, aggiorna o toglie (`null`) il tratto `key`.
  setInk(key: string, ink: InkPreview | null): void;
  setHandles(handles: readonly OverlayHandle[]): void;
  /// Disegna adesso ciò che aspetta il prossimo fotogramma.
  flush(): void;
  dispose(): void;
}

/// Il lato di una maniglia, in pixel CSS.
const GRIP = 8;

/// Monta lo strato dentro `host`, sopra ciò che c'è.
export function createOverlay(host: HTMLElement, owner: Lifetime): SceneOverlay {
  const life = openLifetime();
  const canvas = document.createElement("canvas");
  canvas.className = "spatial-overlay";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const context = canvas.getContext("2d");

  let view: PainterView = { scale: 1, tx: 0, ty: 0 };
  let width = 0;
  let height = 0;
  let ratio = 1;
  const inks = new Map<string, InkPreview>();
  let handles: readonly OverlayHandle[] = [];
  let disposed = false;

  let frame: number | null = null;
  const cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  life.add(cancel);

  const resize = (): boolean => {
    const nextRatio = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const nextWidth = host.clientWidth;
    const nextHeight = host.clientHeight;
    if (nextWidth === width && nextHeight === height && nextRatio === ratio) return false;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    canvas.width = Math.max(0, Math.round(width * ratio));
    canvas.height = Math.max(0, Math.round(height * ratio));
    return true;
  };

  const accent = (): string => {
    if (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches) return "Highlight";
    const value = getComputedStyle(canvas).getPropertyValue("--accent").trim();
    return value === "" ? "Highlight" : value;
  };

  const paper = (): string => {
    if (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches) return "Canvas";
    const value = getComputedStyle(canvas).getPropertyValue("--bg").trim();
    return value === "" ? "Canvas" : value;
  };

  /// Un punto della scena sullo schermo, in pixel CSS.
  const screen = (x: number, y: number): Point => [x * view.scale + view.tx, y * view.scale + view.ty];

  const drawInk = (ctx: CanvasRenderingContext2D, ink: InkPreview): void => {
    const points = ink.outline;
    const n = points.length;
    if (n < 3) return;
    const [a, b, c, d, e, f] = ink.matrix;
    const s = view.scale * ratio;
    ctx.setTransform(a * s, b * s, c * s, d * s, (e * view.scale + view.tx) * ratio, (f * view.scale + view.ty) * ratio);
    ctx.globalAlpha = Math.min(1, Math.max(0, ink.opacity));
    ctx.fillStyle = ink.color;
    ctx.beginPath();
    const last = points[n - 1]!;
    const first = points[0]!;
    ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    for (let i = 0; i < n; i++) {
      const [x, y] = points[i]!;
      const [nx, ny] = points[i + 1 === n ? 0 : i + 1]!;
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    ctx.closePath();
    // Il contorno di pf1 si sovrappone a sé stesso nelle curve strette: la
    // regola non zero lo riempie come lo riempie il `path` scritto.
    ctx.fill("nonzero");
  };

  const drawHandles = (ctx: CanvasRenderingContext2D): void => {
    if (handles.length === 0) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = 1;
    const line = accent();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (const handle of handles) {
      if (handle.kind === "box") {
        const [a, b, c, d, e, f] = handle.matrix;
        const corner = (x: number, y: number): Point => screen(a * x + c * y + e, b * x + d * y + f);
        const { x, y, width: w, height: h } = handle;
        const corners = [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)];
        ctx.setLineDash([]);
        ctx.beginPath();
        corners.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
        ctx.stroke();
      } else if (handle.kind === "lasso") {
        if (handle.points.length < 2) continue;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        handle.points.forEach(([x, y], i) => {
          const [px, py] = screen(x, y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.fillStyle = paper();
    for (const handle of handles) {
      if (handle.kind !== "grip") continue;
      const [px, py] = screen(handle.x, handle.y);
      // Sul mezzo pixel, perché il bordo di un pixel resti netto.
      const x = Math.round(px - GRIP / 2) + 0.5;
      const y = Math.round(py - GRIP / 2) + 0.5;
      ctx.fillRect(x, y, GRIP, GRIP);
      ctx.strokeRect(x, y, GRIP, GRIP);
    }
  };

  const draw = (): void => {
    frame = null;
    if (disposed) return;
    resize();
    if (context === null) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const ink of inks.values()) drawInk(context, ink);
    drawHandles(context);
  };

  const schedule = (): void => {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(draw);
  };

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      if (resize()) schedule();
    });
    resizeObserver.observe(host);
    life.add(() => resizeObserver.disconnect());
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    inks.clear();
    handles = [];
    canvas.remove();
    life.close();
  };
  owner.add(dispose);

  return {
    setView(next) {
      if (next.scale === view.scale && next.tx === view.tx && next.ty === view.ty) return;
      view = { scale: next.scale, tx: next.tx, ty: next.ty };
      if (inks.size > 0 || handles.length > 0) schedule();
    },
    setInk(key, ink) {
      if (ink === null) {
        if (!inks.delete(key)) return;
      } else {
        inks.set(key, ink);
      }
      schedule();
    },
    setHandles(next) {
      if (next.length === 0 && handles.length === 0) return;
      handles = next;
      schedule();
    },
    flush() {
      if (disposed) return;
      cancel();
      draw();
    },
    dispose,
  };
}
