// Lo strato sopra la scena: l'inchiostro mentre si scrive, le maniglie
// della selezione, i nodi del tracciato che si modifica, le linee delle guide
// e le misure, l'anteprima del contagocce, le linee delle sfumature coi loro
// punti, su un canvas 2D grande quanto la vista.
//
// Non entra mai nel documento: è ciò che la superficie mostra fra un
// evento e l'operazione che lo registrerà. L'inchiostro in corso si riempie
// con la stessa costruzione di `outlinePath` (curve quadratiche per i punti
// medi del contorno), così il tratto non cambia forma quando l'operazione lo
// scrive; manca solo l'arrotondamento a due decimali, che a schermo non si
// vede. Più tratti insieme hanno chiavi diverse: quello della penna locale e
// quelli che una sessione live riceve dal tablet.
//
// Con la vista girata l'inchiostro, i riquadri e le guide girano col foglio;
// le maniglie, i nodi e le scritte restano diritti sullo schermo.
//
// I ridisegni si raccolgono in un fotogramma; `flush` disegna subito.

import { arcToCubics } from "../scene/curves";
import type { Bounds, Segment } from "../scene/geometry";
import { compose, type Matrix, type Point } from "../scene/matrix";
import type { OutlinePoint } from "../ink/pf1";
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
  /// La maniglia degli angoli arrotondati: un anello col punto in mezzo,
  /// diverso dalle maniglie della cornice e dai nodi.
  | { readonly kind: "corner"; readonly x: number; readonly y: number }
  /// Una scritta breve, come le misure mentre si ridimensiona: centrata
  /// sotto il punto, su un fondo del colore della linea.
  | { readonly kind: "label"; readonly x: number; readonly y: number; readonly text: string }
  /// Il contorno di una selezione a mano libera, tratteggiato.
  | { readonly kind: "lasso"; readonly points: readonly Point[] }
  /// La scia di un trascinamento, aperta: per dove è passato il puntatore.
  | { readonly kind: "trail"; readonly points: readonly Point[] }
  /// Una regione del Costruttore di forme: i segmenti nelle coordinate delle
  /// forme, portati nella scena da `matrix`. Il tono dice che cosa ne sarà
  /// (vedi [`RegionTone`]); `active` è quella a cui è arrivata la tastiera,
  /// col bordo spesso.
  | { readonly kind: "region"; readonly segments: readonly Segment[]; readonly matrix: Matrix; readonly tone: RegionTone; readonly active?: boolean }
  /// Il contorno di un tracciato di cui si modificano i nodi: i segmenti
  /// nelle coordinate del tracciato, portati nella scena da `matrix`. Un
  /// `hint` è il contorno dell'oggetto sotto il puntatore, più tenue; uno
  /// `dashed`, tratteggiato, è il bordo di una sfumatura radiale.
  | { readonly kind: "outline"; readonly segments: readonly Segment[]; readonly matrix: Matrix; readonly hint?: boolean; readonly dashed?: boolean }
  /// Un nodo di un tracciato, di misura fissa sullo schermo: la forma dice
  /// il tipo, e un nodo scelto è pieno. Un `hint` è un nodo dell'oggetto
  /// sotto il puntatore, più piccolo.
  | { readonly kind: "node"; readonly x: number; readonly y: number; readonly shape: NodeShape; readonly selected: boolean; readonly hint?: boolean }
  /// La maniglia di un nodo: un punto, legato al nodo da una linea. Una
  /// maniglia `folded` è ritirata sul nodo e si mostra accanto, da tirare
  /// fuori: la sua linea è tratteggiata.
  | { readonly kind: "control"; readonly x: number; readonly y: number; readonly node: Point; readonly folded?: boolean }
  /// Una linea delle guide fra due punti: piena, o tratteggiata quando
  /// prolunga un bordo fino a una misura.
  | { readonly kind: "guide"; readonly from: Point; readonly to: Point; readonly dashed: boolean }
  /// Il segno a croce dove una guida passa per un bordo o per un centro.
  | { readonly kind: "cross"; readonly x: number; readonly y: number }
  /// Una misura: la linea fra due punti, con le stanghette ai capi, e la
  /// distanza scritta a metà.
  | { readonly kind: "measure"; readonly from: Point; readonly to: Point; readonly text: string }
  /// La linea di una sfumatura, dal primo capo al secondo o dal centro al
  /// capo del raggio: un filo del colore della linea su uno della carta più
  /// largo, perché si veda sopra ogni colore.
  | { readonly kind: "ramp"; readonly from: Point; readonly to: Point }
  /// Un punto di una sfumatura: un quadratino del suo colore in `x`, `y`,
  /// appeso con un'asta al punto `at` della linea, con la scacchiera sotto
  /// un colore trasparente. Uno scelto ha il bordo spesso del colore della
  /// linea; uno `torn`, trascinato via dalla linea, è tenue e senza asta.
  | {
    readonly kind: "stop";
    readonly x: number;
    readonly y: number;
    readonly at: Point;
    readonly color: string;
    readonly opacity: number;
    readonly selected: boolean;
    readonly torn?: boolean;
  }
  /// L'anteprima del contagocce accanto al punto: un disco di ciò che
  /// prende, vuoto se non c'è un colore da mostrare, con l'anello del
  /// contorno quando prende l'aspetto, e il suo nome. Sta in alto a destra
  /// del punto, dove la mano non lo copre, o dall'altra parte vicino a un
  /// bordo; `lifted`, sotto un dito, più lontano e proprio sopra.
  | { readonly kind: "sample"; readonly x: number; readonly y: number; readonly fill: SamplePaint | null; readonly ring?: SamplePaint; readonly text: string; readonly lifted?: boolean };

/// Ciò che mostra l'anteprima del contagocce: un colore CSS, nessun colore o
/// un motivo.
export type SamplePaint = { readonly color: string } | "none" | "pattern";

/// Come si vede una regione del Costruttore: `plain` col solo bordo, tenue;
/// `hover` sotto il puntatore, appena colorata; `chosen` scelta, che si
/// unirà, più colorata; `erase`, che si toglierà, a righe oblique e col bordo
/// tratteggiato, perché non lo dica il solo colore.
export type RegionTone = "plain" | "hover" | "chosen" | "erase";

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

/// La misura dei nodi dell'oggetto sotto il puntatore, e la forza del suo
/// contorno: si vedono, senza confondersi con quelli che si modificano.
const HINT_NODE = 7;
const HINT_ALPHA = 0.6;

/// Quanto è colorata una regione sotto il puntatore e una scelta, e quanto
/// distano le righe di una che si toglie, in pixel CSS.
const REGION_HOVER_ALPHA = 0.16;
const REGION_CHOSEN_ALPHA = 0.32;
const REGION_HATCH = 6;

/// Il diametro della maniglia che ruota, in pixel CSS.
const ROTOR = 10;

/// Il lato del quadratino di un punto di una sfumatura e dei quadretti della
/// sua scacchiera, quanto è tenue uno trascinato via, e lo spessore della
/// carta sotto la linea, in pixel CSS.
const STOP = 12;
const STOP_CHECK = 5;
const STOP_TORN_ALPHA = 0.4;
const RAMP_CASING = 3;

/// Il diametro della maniglia degli angoli, e del punto in mezzo, in pixel
/// CSS.
const CORNER = 10;
const CORNER_DOT = 3;

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

/// L'anteprima del contagocce, in pixel CSS: il diametro del disco, lo
/// spessore dell'anello del contorno, il bordo di carta attorno, e quanto il
/// centro sta lontano dal punto in ciascuna direzione, di più sopra un dito,
/// che copre ciò che tocca; lo spazio fra il disco e il nome, e il lato dei
/// quadretti di un motivo.
const SAMPLE = 28;
const SAMPLE_RING = 6;
const SAMPLE_HALO = 3;
const SAMPLE_REACH = 26;
const SAMPLE_LIFT = 60;
const SAMPLE_GAP = 6;
const SAMPLE_CHECK = 5;

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

  /// Il testo sopra il colore della linea.
  const onAccent = (): string => {
    if (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches) return "HighlightText";
    const value = getComputedStyle(canvas).getPropertyValue("--accent-contrast").trim();
    return value === "" ? "HighlightText" : value;
  };

  /// Il colore del testo, sulla carta.
  const ink = (): string => {
    if (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches) return "CanvasText";
    const value = getComputedStyle(canvas).getPropertyValue("--text").trim();
    return value === "" ? "CanvasText" : value;
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

  /// Il contorno di un tracciato sullo schermo, da riempire o da tracciare:
  /// gli archi come le cubiche che li approssimano, che `matrix` porta come
  /// porta l'arco. Torna il riquadro dei punti sullo schermo, maniglie
  /// comprese: contiene il tracciato.
  const tracePath = (ctx: CanvasRenderingContext2D, segments: readonly Segment[], matrix: Matrix): Bounds => {
    const [a, b, c, d, e, f] = matrix;
    const box = { min: [Infinity, Infinity] as Point, max: [-Infinity, -Infinity] as Point };
    const at = ([x, y]: Point): Point => {
      const p = screen(a * x + c * y + e, b * x + d * y + f);
      box.min = [Math.min(box.min[0], p[0]), Math.min(box.min[1], p[1])];
      box.max = [Math.max(box.max[0], p[0]), Math.max(box.max[1], p[1])];
      return p;
    };
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
    return box;
  };

  /// Il contorno di un tracciato, nella scena.
  const traceOutline = (ctx: CanvasRenderingContext2D, segments: readonly Segment[], matrix: Matrix): void => {
    tracePath(ctx, segments, matrix);
    ctx.stroke();
  };

  /// Una regione del Costruttore, col suo tono, nel colore `line`.
  const drawRegion = (ctx: CanvasRenderingContext2D, region: Extract<OverlayHandle, { kind: "region" }>, line: string): void => {
    const box = tracePath(ctx, region.segments, region.matrix);
    // I bordi delle regioni non si incrociano: pari e dispari riconosce i
    // buchi in qualunque verso girino.
    if (region.tone === "hover" || region.tone === "chosen") {
      ctx.fillStyle = line;
      ctx.globalAlpha = region.tone === "hover" ? REGION_HOVER_ALPHA : REGION_CHOSEN_ALPHA;
      ctx.fill("evenodd");
    } else if (region.tone === "erase") {
      ctx.save();
      ctx.clip("evenodd");
      ctx.globalAlpha = HINT_ALPHA;
      ctx.beginPath();
      // Le righe solo dove si vedono, anche da molto vicino.
      const left = Math.max(box.min[0], 0);
      const right = Math.min(box.max[0], width);
      const top = Math.max(box.min[1], 0);
      const bottom = Math.min(box.max[1], height);
      const span = bottom - top;
      for (let x = left - span; x < right; x += REGION_HATCH) {
        ctx.moveTo(x, bottom);
        ctx.lineTo(x + span, top);
      }
      ctx.stroke();
      ctx.restore();
      tracePath(ctx, region.segments, region.matrix);
    }
    ctx.globalAlpha = region.tone === "plain" && region.active !== true ? HINT_ALPHA : 1;
    ctx.setLineDash(region.tone === "erase" ? [4, 3] : []);
    ctx.lineWidth = region.active === true ? 3 : region.tone === "plain" ? 1 : 2;
    ctx.stroke();
    if (region.tone === "erase") ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  };

  /// Il cerchio di centro `x`, `y` sullo schermo e raggio `r`, pieno di
  /// `paint` e con un filo del colore del testo, perché si veda anche un
  /// colore uguale alla carta: nessun colore è la carta con una riga
  /// obliqua, un motivo una scacchiera, come nei campioni del pannello;
  /// `null`, niente da mostrare, la carta sola.
  const fillPaint = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, paint: SamplePaint | null, base: string, text: string): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = paint === null || typeof paint === "string" ? base : paint.color;
    ctx.fill();
    if (typeof paint === "string") {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = text;
      ctx.strokeStyle = text;
      ctx.beginPath();
      if (paint === "none") {
        ctx.lineWidth = 2;
        ctx.moveTo(x - r, y + r);
        ctx.lineTo(x + r, y - r);
        ctx.stroke();
      } else {
        const cells = Math.ceil(r / SAMPLE_CHECK);
        for (let i = -cells; i < cells; i++) {
          for (let j = -cells; j < cells; j++) if (((i + j) & 1) === 0) ctx.rect(x + i * SAMPLE_CHECK, y + j * SAMPLE_CHECK, SAMPLE_CHECK, SAMPLE_CHECK);
        }
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = HINT_ALPHA / 2;
    ctx.strokeStyle = text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /// L'anteprima del contagocce, col nome accanto al disco: in alto a
  /// destra del punto, o sopra un dito, se c'è posto; altrimenti dall'altra
  /// parte.
  const drawSample = (ctx: CanvasRenderingContext2D, sample: Extract<OverlayHandle, { kind: "sample" }>, line: string, base: string): void => {
    const [px, py] = screen(sample.x, sample.y);
    const r = SAMPLE / 2;
    const halo = r + SAMPLE_HALO;
    const [w, h] = labelSize(ctx, sample.text);
    const reach = sample.lifted === true ? SAMPLE_LIFT : SAMPLE_REACH;
    const spots: readonly Point[] =
      sample.lifted === true
        ? [
            [px, py - reach],
            [px - reach, py],
            [px + reach, py],
            [px, py + reach],
          ]
        : [
            [px + reach, py - reach],
            [px - reach, py - reach],
            [px + reach, py + reach],
            [px - reach, py + reach],
          ];
    // Il nome dalla parte opposta al punto: a sinistra del disco quando il
    // disco ne sta a sinistra.
    const labelLeft = ([cx]: Point): number => (cx < px ? cx - halo - SAMPLE_GAP - w : cx + halo + SAMPLE_GAP);
    const fits = (spot: Point): boolean => {
      const left = Math.min(spot[0] - halo, labelLeft(spot));
      const right = Math.max(spot[0] + halo, labelLeft(spot) + w);
      const rise = Math.max(halo, h / 2);
      return left >= 0 && right <= width && spot[1] - rise >= 0 && spot[1] + rise <= height;
    };
    const spot = spots.find(fits) ?? spots[0]!;
    const [cx, cy] = spot;
    ctx.beginPath();
    ctx.arc(cx, cy, halo, 0, 2 * Math.PI);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();
    const text = ink();
    if (sample.ring === undefined) {
      fillPaint(ctx, cx, cy, r, sample.fill, base, text);
    } else {
      // L'anello del contorno, poi un filo di carta, che separa due colori
      // uguali, e il disco del riempimento.
      fillPaint(ctx, cx, cy, r, sample.ring, base, text);
      ctx.beginPath();
      ctx.arc(cx, cy, r - SAMPLE_RING, 0, 2 * Math.PI);
      ctx.fillStyle = base;
      ctx.fill();
      fillPaint(ctx, cx, cy, r - SAMPLE_RING - 1, sample.fill, base, text);
    }
    paintLabel(ctx, labelLeft(spot), cy - h / 2, w, h, sample.text, line);
    ctx.strokeStyle = line;
  };

  /// Il quadratino di un punto di una sfumatura: la carta, la scacchiera
  /// sotto un colore trasparente come nei campioni del pannello, il colore,
  /// e il bordo del testo, o della linea se è scelto.
  const drawStop = (ctx: CanvasRenderingContext2D, stop: Extract<OverlayHandle, { kind: "stop" }>, line: string, base: string): void => {
    const [px, py] = screen(stop.x, stop.y);
    const x = Math.round(px - STOP / 2);
    const y = Math.round(py - STOP / 2);
    ctx.globalAlpha = stop.torn === true ? STOP_TORN_ALPHA : 1;
    ctx.fillStyle = base;
    ctx.fillRect(x, y, STOP, STOP);
    if (stop.opacity < 1) {
      ctx.fillStyle = "#c8c8c8";
      for (let i = 0; i * STOP_CHECK < STOP; i++) {
        for (let j = 0; j * STOP_CHECK < STOP; j++) {
          if (((i + j) & 1) === 0) ctx.fillRect(x + i * STOP_CHECK, y + j * STOP_CHECK, Math.min(STOP_CHECK, STOP - i * STOP_CHECK), Math.min(STOP_CHECK, STOP - j * STOP_CHECK));
        }
      }
    }
    ctx.globalAlpha *= Math.min(1, Math.max(0, stop.opacity));
    ctx.fillStyle = stop.color;
    ctx.fillRect(x, y, STOP, STOP);
    ctx.globalAlpha = stop.torn === true ? STOP_TORN_ALPHA : 1;
    if (stop.selected) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, STOP + 2, STOP + 2);
    } else {
      ctx.strokeStyle = ink();
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, STOP + 1, STOP + 1);
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  };

  /// Un nodo in `x`, `y` sullo schermo, largo `size`.
  const drawNode = (ctx: CanvasRenderingContext2D, x: number, y: number, shape: NodeShape, size: number): void => {
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(x, y, size / 2, 0, 2 * Math.PI);
    } else if (shape === "diamond") {
      const r = (size + 2) / 2;
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    } else {
      // Sul mezzo pixel, perché il bordo di un pixel resti netto.
      ctx.rect(Math.round(x - size / 2) + 0.5, Math.round(y - size / 2) + 0.5, size - 1, size - 1);
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
    // Le regioni sotto ogni altra cosa.
    for (const handle of handles) if (handle.kind === "region") drawRegion(ctx, handle, line);
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
      } else if (handle.kind === "trail") {
        if (handle.points.length < 2) continue;
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        handle.points.forEach(([x, y], i) => {
          const [px, py] = screen(x, y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.lineJoin = "miter";
        ctx.lineCap = "butt";
      } else if (handle.kind === "outline") {
        ctx.setLineDash(handle.dashed === true ? [4, 3] : []);
        ctx.globalAlpha = handle.hint === true ? HINT_ALPHA : 1;
        traceOutline(ctx, handle.segments, handle.matrix);
        ctx.globalAlpha = 1;
      } else if (handle.kind === "ramp") {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(...screen(handle.from[0], handle.from[1]));
        ctx.lineTo(...screen(handle.to[0], handle.to[1]));
        ctx.strokeStyle = paper();
        ctx.lineWidth = RAMP_CASING;
        ctx.stroke();
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (handle.kind === "stop") {
        if (handle.torn === true) continue;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(...screen(handle.at[0], handle.at[1]));
        ctx.lineTo(...screen(handle.x, handle.y));
        ctx.stroke();
      } else if (handle.kind === "control") {
        ctx.setLineDash(handle.folded === true ? [2, 2] : []);
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
      } else if (handle.kind === "corner") {
        const [px, py] = screen(handle.x, handle.y);
        ctx.beginPath();
        ctx.arc(px, py, CORNER / 2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = line;
        ctx.beginPath();
        ctx.arc(px, py, CORNER_DOT / 2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = fill;
      }
    }
    // I nodi sopra le maniglie, e quelli scelti pieni del colore della linea.
    for (const handle of handles) {
      if (handle.kind !== "node") continue;
      const [px, py] = screen(handle.x, handle.y);
      ctx.fillStyle = handle.selected ? line : fill;
      drawNode(ctx, px, py, handle.shape, handle.hint === true ? HINT_NODE : NODE);
    }
    for (const handle of handles) if (handle.kind === "stop") drawStop(ctx, handle, line, fill);
    for (const handle of handles) {
      if (handle.kind === "label") {
        const [px, py] = screen(handle.x, handle.y);
        drawLabel(ctx, px, py, handle.text, line, "below");
      } else if (handle.kind === "measure") {
        const [px, py] = screen((handle.from[0] + handle.to[0]) / 2, (handle.from[1] + handle.to[1]) / 2);
        drawLabel(ctx, px, py, handle.text, line, "center");
      }
    }
    // L'anteprima del contagocce sopra ogni altra cosa.
    for (const handle of handles) if (handle.kind === "sample") drawSample(ctx, handle, line, fill);
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
