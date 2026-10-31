// Lo strato sopra la scena: l'inchiostro mentre si scrive, le maniglie
// della selezione, il riquadro che sceglie, la punta sotto la penna sospesa
// e il righello, su un canvas 2D grande quanto la vista.
//
// Non entra mai nel documento: è ciò che la superficie mostra fra un
// evento e l'operazione che lo registrerà. L'inchiostro in corso si riempie
// con la stessa costruzione di `outlinePath` (curve quadratiche per i punti
// medi del contorno), così il tratto non cambia forma quando l'operazione lo
// scrive; manca solo l'arrotondamento a due decimali, che a schermo non si
// vede. Più tratti insieme hanno chiavi diverse: quello della penna locale e
// quelli che una sessione live riceve dal tablet.
//
// Con la vista girata l'inchiostro e i riquadri girano col foglio; le
// maniglie e le scritte restano diritte sullo schermo.
//
// I ridisegni si raccolgono in un fotogramma; `flush` disegna subito.

import { compose, type Matrix, type Point } from "../scene/matrix";
import type { OutlinePoint } from "../../../ink/pf1";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { toScreen, viewMatrix } from "../view";
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
  /// Il riquadro che sceglie, tratteggiato: sul foglio girato di traverso, i
  /// quattro angoli che ha nella scena.
  | { readonly kind: "lasso"; readonly points: readonly Point[] }
  /// Una linea fra due punti, piena o tratteggiata: quella che il tratto
  /// seguirà fino al puntatore.
  | { readonly kind: "guide"; readonly from: Point; readonly to: Point; readonly dashed: boolean }
  /// La punta sotto la penna sospesa: il contorno di ciò che lascerebbe, alla
  /// misura vera, col mirino in mezzo (vedi [`NibShape`]). `width` e `height`
  /// sono in unità della scena, girate di `angle` gradi nella scena; per la
  /// gomma, `width` è il diametro in pixel CSS, che non cambia con lo zoom.
  | { readonly kind: "nib"; readonly x: number; readonly y: number; readonly shape: NibShape; readonly width: number; readonly height: number; readonly angle: number }
  /// Il righello (P13): una riga larga `width` pixel dello schermo, col
  /// centro e il bordo girato di `angle` gradi nella scena, le tacche sui due
  /// bordi e l'angolo scritto in mezzo; `active` mentre lo si tira.
  | { readonly kind: "ruler"; readonly center: Point; readonly angle: number; readonly width: number; readonly text: string; readonly active?: boolean };

/// La forma della punta: `round` un cerchio, `flat` l'ellisse stretta della
/// punta piatta, `block` il rettangolo tondo dell'evidenziatore, `eraser` il
/// cerchio tratteggiato della gomma.
export type NibShape = "round" | "flat" | "block" | "eraser";

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

/// Quanto spazio prende sotto il suo punto una scritta di una riga, in
/// pixel CSS: la barra della selezione ci si mette sotto.
export const LABEL_ROOM_PX = LABEL_GAP + LABEL_SIZE + 2 * LABEL_PAD;

/// La punta: quanto sporgono le stanghette del mirino, e la misura più
/// piccola del contorno sullo schermo, in pixel CSS.
const NIB_TICK = 4;
const NIB_MIN = 2;

/// Il righello: quanto copre la sua carta, il passo delle tacche e la loro
/// lunghezza, corta e lunga ogni cinque, in pixel dello schermo.
const RULER_ALPHA = 0.72;
const RULER_TICK_STEP = 10;
const RULER_TICK = 6;
const RULER_TICK_LONG = 12;

/// Monta lo strato dentro `host`, sopra ciò che c'è.
export function createOverlay(host: HTMLElement, owner: Lifetime): SceneOverlay {
  const life = openLifetime();
  const canvas = document.createElement("canvas");
  canvas.className = "spatial-overlay";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const context = canvas.getContext("2d");

  let view: PainterView = { scale: 1, angle: 0, tx: 0, ty: 0 };
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

  /// Il righello sta sulla carta, che è bianca in tutti e due i temi
  /// (DEC-13): è un righello chiaro anche col tema scuro.
  const rulerPaper = (): string => (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches ? "Canvas" : "#ffffff");

  /// Il testo sopra il colore della linea.
  const onAccent = (): string => {
    if (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches) return "HighlightText";
    const value = getComputedStyle(canvas).getPropertyValue("--accent-contrast").trim();
    return value === "" ? "HighlightText" : value;
  };

  /// Quanto è larga e alta la scritta `text`, col suo margine; prepara il
  /// carattere, quello dell'interfaccia, che lo strato non eredita.
  const labelSize = (ctx: CanvasRenderingContext2D, text: string): [number, number] => {
    const family = getComputedStyle(host).fontFamily;
    ctx.font = `${LABEL_SIZE}px ${family === "" ? "sans-serif" : family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    return [Math.ceil(ctx.measureText(text).width) + 2 * LABEL_PAD, LABEL_SIZE + 2 * LABEL_PAD];
  };

  /// La scritta `text`, larga `w` e alta `h` come dice `labelSize`, da
  /// `left`, `top` sullo schermo, dentro la vista anche vicino a un bordo,
  /// sul colore della linea.
  const paintLabel = (ctx: CanvasRenderingContext2D, left: number, top: number, w: number, h: number, text: string, line: string): void => {
    const x = Math.max(0, Math.min(Math.round(left), width - w));
    const y = Math.max(0, Math.min(Math.round(top), height - h));
    ctx.fillStyle = line;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 3);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.fillStyle = onAccent();
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  };

  /// Una scritta sotto `x`, `y` sullo schermo, o centrata lì.
  const drawLabel = (ctx: CanvasRenderingContext2D, x: number, y: number, text: string, line: string, place: "below" | "center"): void => {
    const [w, h] = labelSize(ctx, text);
    paintLabel(ctx, x - w / 2, place === "below" ? y + LABEL_GAP : y - h / 2, w, h, text, line);
  };

  /// Un punto della scena sullo schermo, in pixel CSS.
  const screen = (x: number, y: number): Point => toScreen(view, [x, y]);

  /// Come `screen`, sul mezzo pixel: una linea dritta di un pixel resta
  /// netta. Su un foglio girato di sbieco le linee della scena sono oblique,
  /// e il mezzo pixel non le aiuta: restano dove sono.
  const crisp = ([x, y]: Point): Point => {
    const [px, py] = screen(x, y);
    if (view.angle % 90 !== 0) return [px, py];
    return [Math.round(px - 0.5) + 0.5, Math.round(py - 0.5) + 0.5];
  };

  const drawInk = (ctx: CanvasRenderingContext2D, ink: InkPreview): void => {
    const points = ink.outline;
    const n = points.length;
    if (n < 3) return;
    const [a, b, c, d, e, f] = compose(viewMatrix(view), ink.matrix);
    ctx.setTransform(a * ratio, b * ratio, c * ratio, d * ratio, e * ratio, f * ratio);
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
    // Il righello sotto ogni altra cosa.
    for (const handle of handles) if (handle.kind === "ruler") drawRuler(ctx, handle, line, rulerPaper());
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
      } else if (handle.kind === "rotor") {
        const [px, py] = screen(handle.x, handle.y);
        ctx.beginPath();
        ctx.arc(px, py, ROTOR / 2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
    for (const handle of handles) {
      if (handle.kind !== "label") continue;
      const [px, py] = screen(handle.x, handle.y);
      drawLabel(ctx, px, py, handle.text, line, "below");
    }
    // La punta sopra ogni altra cosa.
    for (const handle of handles) if (handle.kind === "nib") drawNib(ctx, handle, line, fill);
  };

  /// Il righello: una striscia di carta un po' trasparente che passa da un
  /// bordo all'altro della vista, i due bordi, le tacche e l'angolo.
  const drawRuler = (ctx: CanvasRenderingContext2D, ruler: Extract<OverlayHandle, { kind: "ruler" }>, line: string, base: string): void => {
    const [cx, cy] = screen(ruler.center[0], ruler.center[1]);
    const turn = ((ruler.angle + view.angle) * Math.PI) / 180;
    const reach = Math.ceil((width + height) / RULER_TICK_STEP) * RULER_TICK_STEP;
    const half = ruler.width / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(turn);
    ctx.setLineDash([]);
    ctx.globalAlpha = RULER_ALPHA;
    ctx.fillStyle = base;
    ctx.fillRect(-reach, -half, 2 * reach, 2 * half);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = line;
    ctx.lineWidth = ruler.active === true ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(-reach, -half);
    ctx.lineTo(reach, -half);
    ctx.moveTo(-reach, half);
    ctx.lineTo(reach, half);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -reach, k = -reach / RULER_TICK_STEP; x <= reach; x += RULER_TICK_STEP, k++) {
      const tick = k % 5 === 0 ? RULER_TICK_LONG : RULER_TICK;
      ctx.moveTo(x, -half);
      ctx.lineTo(x, -half + tick);
      ctx.moveTo(x, half);
      ctx.lineTo(x, half - tick);
    }
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, cx, cy, ruler.text, line, "center");
  };

  /// La punta: il contorno su un filo di carta più largo, perché si veda
  /// sopra ogni colore, e il mirino.
  const drawNib = (ctx: CanvasRenderingContext2D, nib: Extract<OverlayHandle, { kind: "nib" }>, line: string, base: string): void => {
    const [px, py] = screen(nib.x, nib.y);
    const fixed = nib.shape === "eraser";
    const w = Math.max(NIB_MIN, fixed ? nib.width : nib.width * view.scale);
    const h = Math.max(NIB_MIN, fixed ? nib.width : nib.height * view.scale);
    const turn = ((nib.angle + view.angle) * Math.PI) / 180;
    const outline = (): void => {
      ctx.beginPath();
      if (nib.shape === "block") {
        const r = Math.min(w, h) / 4;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(turn);
        if (typeof ctx.roundRect === "function") ctx.roundRect(-w / 2, -h / 2, w, h, r);
        else ctx.rect(-w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        ctx.ellipse(px, py, w / 2, h / 2, turn, 0, 2 * Math.PI);
      }
    };
    ctx.save();
    ctx.setLineDash(nib.shape === "eraser" ? [3, 3] : []);
    ctx.lineWidth = 3;
    ctx.strokeStyle = base;
    outline();
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    outline();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(px - NIB_TICK, py);
    ctx.lineTo(px + NIB_TICK, py);
    ctx.moveTo(px, py - NIB_TICK);
    ctx.lineTo(px, py + NIB_TICK);
    ctx.lineWidth = 3;
    ctx.strokeStyle = base;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    ctx.stroke();
    ctx.restore();
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
      if (next.scale === view.scale && next.angle === view.angle && next.tx === view.tx && next.ty === view.ty) return;
      view = { scale: next.scale, angle: next.angle, tx: next.tx, ty: next.ty };
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
