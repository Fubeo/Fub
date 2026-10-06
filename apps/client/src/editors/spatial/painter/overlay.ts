// Lo strato sopra la scena: l'inchiostro mentre si scrive, le maniglie
// della selezione, i nodi del tracciato che si modifica, le linee delle guide
// e le misure, su un canvas 2D grande quanto la vista.
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

import { arcToCubics } from "../scene/curves";
import type { Segment } from "../scene/geometry";
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
  /// La maniglia tonda che ruota, legata da un gambo al punto `stem`.
  | { readonly kind: "rotor"; readonly x: number; readonly y: number; readonly stem: Point }
  /// Una scritta breve, come le misure mentre si ridimensiona: centrata
  /// sotto il punto, su un fondo del colore della linea.
  | { readonly kind: "label"; readonly x: number; readonly y: number; readonly text: string }
  /// Il contorno di una selezione a mano libera, tratteggiato.
  | { readonly kind: "lasso"; readonly points: readonly Point[] }
  /// Il contorno di un tracciato di cui si modificano i nodi: i segmenti
  /// nelle coordinate del tracciato, portati nella scena da `matrix`.
  | { readonly kind: "outline"; readonly segments: readonly Segment[]; readonly matrix: Matrix }
  /// Un nodo di un tracciato, di misura fissa sullo schermo: la forma dice
  /// il tipo, e un nodo scelto è pieno.
  | { readonly kind: "node"; readonly x: number; readonly y: number; readonly shape: NodeShape; readonly selected: boolean }
  /// La maniglia di un nodo: un punto, legato al nodo da una linea.
  | { readonly kind: "control"; readonly x: number; readonly y: number; readonly node: Point }
  /// Una linea delle guide fra due punti: piena, o tratteggiata quando
  /// prolunga un bordo fino a una misura.
  | { readonly kind: "guide"; readonly from: Point; readonly to: Point; readonly dashed: boolean }
  /// Il segno a croce dove una guida passa per un bordo o per un centro.
  | { readonly kind: "cross"; readonly x: number; readonly y: number }
  /// Una misura: la linea fra due punti, con le stanghette ai capi, e la
  /// distanza scritta a metà.
  | { readonly kind: "measure"; readonly from: Point; readonly to: Point; readonly text: string };

/// La forma di un nodo: un rombo per lo spigolo, un quadrato per il nodo
/// liscio, un cerchio per quello simmetrico.
export type NodeShape = "diamond" | "square" | "circle";

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

/// La misura di un nodo, in pixel CSS: il lato del quadrato, e il diametro
/// del cerchio; il rombo è largo quanto la sua diagonale. Il punto di una
/// maniglia è più piccolo, perché non si confonda con un nodo.
const NODE = 9;
const CONTROL = 6;

/// Il diametro della maniglia che ruota, in pixel CSS.
const ROTOR = 10;

/// Quanto una maniglia sporge dal suo punto, in pixel CSS: la metà della più
/// grande, quella che ruota.
export const HANDLE_REACH_PX = Math.max(GRIP, ROTOR) / 2;

/// La scritta: il corpo, il margine attorno, e la distanza dal punto, in
/// pixel CSS.
const LABEL_SIZE = 12;
const LABEL_PAD = 4;
const LABEL_GAP = 12;

/// Mezzo braccio del segno a croce, e mezza stanghetta di una misura, in
/// pixel CSS.
const CROSS = 3;
const TICK = 4;

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

  /// Il testo sopra il colore della linea.
  const onAccent = (): string => {
    if (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches) return "HighlightText";
    const value = getComputedStyle(canvas).getPropertyValue("--accent-contrast").trim();
    return value === "" ? "HighlightText" : value;
  };

  /// Una scritta sotto `x`, `y` sullo schermo, o centrata lì, sul colore
  /// della linea; nel carattere dell'interfaccia, che lo strato non eredita.
  const drawLabel = (ctx: CanvasRenderingContext2D, x: number, y: number, text: string, line: string, place: "below" | "center"): void => {
    const family = getComputedStyle(host).fontFamily;
    ctx.font = `${LABEL_SIZE}px ${family === "" ? "sans-serif" : family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.ceil(ctx.measureText(text).width) + 2 * LABEL_PAD;
    const h = LABEL_SIZE + 2 * LABEL_PAD;
    // Dentro la vista, anche vicino a un bordo.
    const left = Math.max(0, Math.min(Math.round(x - w / 2), width - w));
    const top = Math.max(0, Math.min(Math.round(place === "below" ? y + LABEL_GAP : y - h / 2), height - h));
    ctx.fillStyle = line;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(left, top, w, h, 3);
    else ctx.rect(left, top, w, h);
    ctx.fill();
    ctx.fillStyle = onAccent();
    ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
  };

  /// Un punto della scena sullo schermo, in pixel CSS.
  const screen = (x: number, y: number): Point => [x * view.scale + view.tx, y * view.scale + view.ty];

  /// Come `screen`, sul mezzo pixel: una linea dritta di un pixel resta
  /// netta.
  const crisp = ([x, y]: Point): Point => {
    const [px, py] = screen(x, y);
    return [Math.round(px - 0.5) + 0.5, Math.round(py - 0.5) + 0.5];
  };

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

  /// Il contorno di un tracciato, nella scena: gli archi come le cubiche
  /// che li approssimano, che `matrix` porta come porta l'arco.
  const traceOutline = (ctx: CanvasRenderingContext2D, segments: readonly Segment[], matrix: Matrix): void => {
    const [a, b, c, d, e, f] = matrix;
    const at = ([x, y]: Point): Point => screen(a * x + c * y + e, b * x + d * y + f);
    let current: Point = [0, 0];
    let start: Point = [0, 0];
    ctx.beginPath();
    for (const segment of segments) {
      switch (segment.kind) {
        case "move":
          ctx.moveTo(...at(segment.to));
          start = segment.to;
          break;
        case "line":
          ctx.lineTo(...at(segment.to));
          break;
        case "quad":
          ctx.quadraticCurveTo(...at(segment.control), ...at(segment.to));
          break;
        case "cubic":
          ctx.bezierCurveTo(...at(segment.c1), ...at(segment.c2), ...at(segment.to));
          break;
        case "arc":
          for (const piece of arcToCubics(current, segment)) {
            if (piece.kind === "cubic") ctx.bezierCurveTo(...at(piece.c1), ...at(piece.c2), ...at(piece.to));
            else ctx.lineTo(...at(piece.to));
          }
          break;
        case "close":
          ctx.closePath();
          current = start;
          continue;
      }
      current = segment.to;
    }
    ctx.stroke();
  };

  /// Un nodo in `x`, `y` sullo schermo.
  const drawNode = (ctx: CanvasRenderingContext2D, x: number, y: number, shape: NodeShape): void => {
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(x, y, NODE / 2, 0, 2 * Math.PI);
    } else if (shape === "diamond") {
      const r = (NODE + 2) / 2;
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    } else {
      // Sul mezzo pixel, perché il bordo di un pixel resti netto.
      ctx.rect(Math.round(x - NODE / 2) + 0.5, Math.round(y - NODE / 2) + 0.5, NODE - 1, NODE - 1);
    }
    ctx.fill();
    ctx.stroke();
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
      } else if (handle.kind === "outline") {
        ctx.setLineDash([]);
        traceOutline(ctx, handle.segments, handle.matrix);
      } else if (handle.kind === "control") {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(...screen(handle.node[0], handle.node[1]));
        ctx.lineTo(...screen(handle.x, handle.y));
        ctx.stroke();
      } else if (handle.kind === "rotor") {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(...screen(handle.stem[0], handle.stem[1]));
        ctx.lineTo(...screen(handle.x, handle.y));
        ctx.stroke();
      } else if (handle.kind === "guide") {
        ctx.setLineDash(handle.dashed ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(...crisp(handle.from));
        ctx.lineTo(...crisp(handle.to));
        ctx.stroke();
      } else if (handle.kind === "cross") {
        ctx.setLineDash([]);
        const [px, py] = screen(handle.x, handle.y);
        ctx.beginPath();
        ctx.moveTo(px - CROSS, py - CROSS);
        ctx.lineTo(px + CROSS, py + CROSS);
        ctx.moveTo(px + CROSS, py - CROSS);
        ctx.lineTo(px - CROSS, py + CROSS);
        ctx.stroke();
      } else if (handle.kind === "measure") {
        ctx.setLineDash([]);
        const [ax, ay] = crisp(handle.from);
        const [bx, by] = crisp(handle.to);
        const length = Math.hypot(bx - ax, by - ay);
        // Le stanghette di traverso alla linea.
        const nx = length > 0 ? ((ay - by) / length) * TICK : 0;
        const ny = length > 0 ? ((bx - ax) / length) * TICK : TICK;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.moveTo(ax - nx, ay - ny);
        ctx.lineTo(ax + nx, ay + ny);
        ctx.moveTo(bx - nx, by - ny);
        ctx.lineTo(bx + nx, by + ny);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const fill = paper();
    ctx.fillStyle = fill;
    for (const handle of handles) {
      if (handle.kind === "grip") {
        const [px, py] = screen(handle.x, handle.y);
        // Sul mezzo pixel, perché il bordo di un pixel resti netto.
        const x = Math.round(px - GRIP / 2) + 0.5;
        const y = Math.round(py - GRIP / 2) + 0.5;
        ctx.fillRect(x, y, GRIP, GRIP);
        ctx.strokeRect(x, y, GRIP, GRIP);
      } else if (handle.kind === "control" || handle.kind === "rotor") {
        const [px, py] = screen(handle.x, handle.y);
        ctx.beginPath();
        ctx.arc(px, py, (handle.kind === "rotor" ? ROTOR : CONTROL) / 2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
    // I nodi sopra le maniglie, e quelli scelti pieni del colore della linea.
    for (const handle of handles) {
      if (handle.kind !== "node") continue;
      const [px, py] = screen(handle.x, handle.y);
      ctx.fillStyle = handle.selected ? line : fill;
      drawNode(ctx, px, py, handle.shape);
    }
    for (const handle of handles) {
      if (handle.kind === "label") {
        const [px, py] = screen(handle.x, handle.y);
        drawLabel(ctx, px, py, handle.text, line, "below");
      } else if (handle.kind === "measure") {
        const [px, py] = screen((handle.from[0] + handle.to[0]) / 2, (handle.from[1] + handle.to[1]) / 2);
        drawLabel(ctx, px, py, handle.text, line, "center");
      }
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
