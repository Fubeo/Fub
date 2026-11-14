// Il navigatore della lavagna (N6 T55, B3 di `lavagna.md`): in basso a destra
// della vista, la mappa dei gruppi e delle schede col riquadro di ciò che si
// vede. Un clic porta la vista lì (un salto: passa dalla tela, `jump`, come
// Maiusc+1); trascinare sposta la vista sotto la mano. Sparisce da solo quando
// tutta la lavagna sta già nella vista, e «Nascondi il navigatore» lo spegne
// per questa lavagna (lo stato di vista, T36).
//
// La mappa è una sola `<canvas>`, mai un elemento per scheda: con 2000 schede
// restano 2000 rettangoli dipinti. Si ridisegna quando la tela lo chiede
// (`settle`, a fine gesto e al cambio del documento), mai a ogni fotogramma di
// un trascinamento della lavagna. Durante il trascinamento del riquadro la
// mappa resta ferma (lo stesso inquadramento, le schede dipinte una volta in
// un livello a parte) e si rifà solo il riquadro.
//
// I colori li dice la pelle (`skin/editors.css`): le variabili di
// `.canvas-navigator`, lette una volta per disegno, e per una scheda colorata
// `--canvas-color` della sua chiave, letto da un campione nascosto che porta
// la stessa `data-canvas-color` delle schede. Un colore libero è un dato del
// file e si dipinge com'è.
//
// La tastiera: F6 ci arriva (la tela lo mette fra le sue zone), le frecce
// spostano il riquadro di un decimo della vista, con Maiusc di metà.

import { t } from "../../../i18n/strings";
import type { Lifetime } from "../../../ui/lifetime";
import type { Bounds } from "../../spatial/scene/geometry";
import type { Point } from "../../spatial/scene/matrix";
import { navigatorBox } from "../../spatial/tools/editor/chrome/navigator";
import { colorLook } from "../colors";
import type { CanvasNode } from "../model";

/// La camera della lavagna: lo spostamento della vista in px e lo zoom.
export interface NavigatorCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/// La vista: la camera e la misura della vista in px.
export interface NavigatorView {
  readonly camera: NavigatorCamera;
  readonly width: number;
  readonly height: number;
}

/// Ciò che il navigatore legge della tela e ciò che le chiede.
export interface CanvasNavigatorPort {
  /// Il padrone degli ascolti: chiuso, il navigatore non ascolta più niente.
  readonly lifetime: Lifetime;
  /// Le schede e i gruppi adesso; `null` senza una lavagna da mostrare.
  nodes(): readonly CanvasNode[] | null;
  /// La vista adesso.
  view(): NavigatorView;
  /// Il navigatore è acceso per questa lavagna (non nascosto da «Nascondi»).
  enabled(): boolean;
  /// Un salto della camera (il clic): la tela lo fa volare e lo ricorda.
  jump(camera: NavigatorCamera): void;
  /// Uno spostamento della camera sotto la mano, subito, senza volo.
  pan(camera: NavigatorCamera): void;
  /// Il trascinamento (o lo spostamento coi tasti) è finito.
  settled(): void;
}

export interface CanvasNavigator {
  /// `.canvas-navigator`: un fratello della vista, in basso a destra.
  readonly element: HTMLElement;
  /// Rilegge la lavagna e la vista: si mostra o si toglie, e ridipinge se
  /// qualcosa è cambiato. La tela lo chiama a fine gesto.
  settle(): void;
  /// Un trascinamento del riquadro è in corso: per la tela è un gesto.
  dragging(): boolean;
  /// Rifà le parole nella lingua di adesso.
  relabel(): void;
}

/// Quanto si muove il puntatore prima che un clic diventi un trascinamento, in px.
export const NAVIGATOR_DRAG_SLOP = 3;
/// Quanto sposta una freccia, in parti della vista; con Maiusc `NAVIGATOR_KEY_FAR`.
export const NAVIGATOR_KEY_STEP = 0.1;
export const NAVIGATOR_KEY_FAR = 0.5;
/// La misura della mappa quando la pelle non ne dà una (una vista non disposta).
const FALLBACK_SIZE = { width: 168, height: 120 } as const;

/// Lo spazio occupato da gruppi e schede, o `null` se non ce ne sono.
export function boardBounds(nodes: readonly CanvasNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + Math.max(0, node.width || 0));
    maxY = Math.max(maxY, node.y + Math.max(0, node.height || 0));
  }
  if (!Number.isFinite(minX)) return null;
  return { min: [minX, minY], max: [maxX, maxY] };
}

/// Ciò che si vede, in coordinate della lavagna.
export function seenBounds(view: NavigatorView): Bounds {
  const { camera, width, height } = view;
  const zoom = camera.zoom || 1;
  const x = -camera.x / zoom;
  const y = -camera.y / zoom;
  return { min: [x, y], max: [x + width / zoom, y + height / zoom] };
}

/// I quattro angoli di `box`, in senso orario.
function corners(box: Bounds): Point[] {
  return [box.min, [box.max[0], box.min[1]], box.max, [box.min[0], box.max[1]]];
}

/// Se `inner` sta tutto dentro `outer`.
function inside(inner: Bounds, outer: Bounds): boolean {
  return inner.min[0] >= outer.min[0] && inner.min[1] >= outer.min[1] && inner.max[0] <= outer.max[0] && inner.max[1] <= outer.max[1];
}

/// Se il navigatore si mostra: c'è una lavagna con qualcosa, è acceso, e la
/// lavagna non sta già tutta nella vista.
export function navigatorShown(nodes: readonly CanvasNode[] | null, view: NavigatorView, enabled: boolean): boolean {
  if (!enabled || nodes === null) return false;
  const board = boardBounds(nodes);
  if (board === null) return false;
  return !inside(board, seenBounds(view));
}

/// Ciò che la mappa inquadra: la lavagna e la vista, col margine di
/// `navigatorBox` (lo stesso del disegno).
export function navigatorFrame(nodes: readonly CanvasNode[], view: NavigatorView): Bounds {
  return navigatorBox(boardBounds(nodes), corners(seenBounds(view)));
}

/// Come la mappa mette l'inquadratura `frame` in un rettangolo di `width`×`height`:
/// la scala e lo scarto, al centro, senza deformare.
export interface MapFit {
  readonly scale: number;
  readonly left: number;
  readonly top: number;
  readonly frame: Bounds;
}

export function mapFit(frame: Bounds, width: number, height: number): MapFit {
  const w = Math.max(frame.max[0] - frame.min[0], 1e-6);
  const h = Math.max(frame.max[1] - frame.min[1], 1e-6);
  const scale = Math.min(width / w, height / h) || 1;
  return { scale, left: (width - w * scale) / 2, top: (height - h * scale) / 2, frame };
}

/// Il punto della lavagna sotto il punto `x`, `y` della mappa.
export function mapToBoard(fit: MapFit, x: number, y: number): Point {
  return [fit.frame.min[0] + (x - fit.left) / fit.scale, fit.frame.min[1] + (y - fit.top) / fit.scale];
}

/// Il punto della mappa del punto `p` della lavagna.
export function boardToMap(fit: MapFit, p: Point): Point {
  return [fit.left + (p[0] - fit.frame.min[0]) * fit.scale, fit.top + (p[1] - fit.frame.min[1]) * fit.scale];
}

/// La camera che mette il punto `p` della lavagna al centro della vista, con lo stesso zoom.
export function centeredOn(view: NavigatorView, p: Point): NavigatorCamera {
  const zoom = view.camera.zoom;
  return { x: view.width / 2 - p[0] * zoom, y: view.height / 2 - p[1] * zoom, zoom };
}

/// Il centro della vista, in coordinate della lavagna.
function seenCenter(view: NavigatorView): Point {
  const seen = seenBounds(view);
  return [(seen.min[0] + seen.max[0]) / 2, (seen.min[1] + seen.max[1]) / 2];
}

/// I colori della pelle per un disegno.
interface Palette {
  readonly card: string;
  readonly group: string;
  readonly view: string;
  readonly viewFill: string;
  color(value: string | undefined): string | null;
}

/// La firma di ciò che la mappa mostra: si ridipinge solo se cambia.
function signature(nodes: readonly CanvasNode[], view: NavigatorView, size: { width: number; height: number }): string {
  // Un numero per le schede (posto, misura, specie e colore), così la firma
  // resta corta anche con 2000 schede.
  let hash = 2166136261;
  const mix = (value: number): void => {
    hash = Math.imul(hash ^ (value | 0), 16777619);
    hash = Math.imul(hash ^ Math.round((value % 1) * 1e4), 16777619);
  };
  for (const node of nodes) {
    mix(node.x);
    mix(node.y);
    mix(node.width);
    mix(node.height);
    mix(node.type === "group" ? 1 : 2);
    const color = node.color ?? "";
    for (let k = 0; k < color.length; k++) mix(color.charCodeAt(k));
  }
  const { camera } = view;
  return `${nodes.length}|${hash >>> 0}|${camera.x}|${camera.y}|${camera.zoom}|${view.width}|${view.height}|${size.width}|${size.height}`;
}

export function createCanvasNavigator(port: CanvasNavigatorPort): CanvasNavigator {
  const element = document.createElement("div");
  element.className = "canvas-navigator";
  element.hidden = true;
  element.tabIndex = 0;
  element.setAttribute("role", "group");
  const map = document.createElement("canvas");
  map.className = "canvas-navigator-map";
  map.setAttribute("aria-hidden", "true");
  // Il campione dei colori: porta la chiave di una scheda alla volta, e la
  // pelle gli dà il suo `--canvas-color` come alle schede.
  const swatch = document.createElement("span");
  swatch.className = "canvas-navigator-swatch";
  swatch.hidden = true;
  swatch.setAttribute("aria-hidden", "true");
  element.append(map, swatch);

  /// Le schede dipinte una volta, per il trascinamento: la mappa ci aggiunge il riquadro.
  let layer: HTMLCanvasElement | null = null;
  /// L'inquadratura dell'ultimo disegno: un trascinamento la tiene ferma.
  let fit: MapFit | null = null;
  let painted = "";
  let drag: { readonly id: number; readonly startX: number; readonly startY: number; offset: Point | null; moved: boolean } | null = null;

  const relabel = (): void => {
    element.setAttribute("aria-label", t("canvas.navigator"));
    element.title = t("canvas.navigator.hint");
  };
  relabel();

  /// La misura della mappa in px dello schermo, e quella della tela col rapporto dei pixel.
  const mapSize = (): { width: number; height: number; ratio: number } => {
    const width = element.clientWidth || FALLBACK_SIZE.width;
    const height = element.clientHeight || FALLBACK_SIZE.height;
    const ratio = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    return { width, height, ratio };
  };

  const palette = (): Palette => {
    const css = getComputedStyle(element);
    const token = (name: string): string => css.getPropertyValue(name).trim();
    const card = token("--canvas-navigator-card") || "gray";
    const group = token("--canvas-navigator-group") || card;
    const known = new Map<string, string | null>();
    return {
      card,
      group,
      view: token("--canvas-navigator-view") || card,
      viewFill: token("--canvas-navigator-view-fill") || "transparent",
      color(value) {
        const look = colorLook(value);
        if (look === null) return null;
        if (look.custom !== null) return look.custom;
        if (!known.has(look.key)) {
          swatch.dataset.canvasColor = look.key;
          known.set(look.key, getComputedStyle(swatch).getPropertyValue("--canvas-color").trim() || null);
        }
        return known.get(look.key) ?? null;
      },
    };
  };

  /// Dipinge le schede di `nodes` su `ctx`, con l'inquadratura `at`.
  const paintCards = (ctx: CanvasRenderingContext2D, nodes: readonly CanvasNode[], at: MapFit, colors: Palette): void => {
    // Prima i gruppi, sotto le schede che contengono.
    for (const pass of ["group", "card"] as const) {
      for (const node of nodes) {
        if ((node.type === "group") !== (pass === "group")) continue;
        const [x, y] = boardToMap(at, [node.x, node.y]);
        const w = Math.max(node.width * at.scale, 1);
        const h = Math.max(node.height * at.scale, 1);
        const color = colors.color(node.color);
        if (pass === "group") {
          ctx.strokeStyle = color ?? colors.group;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, Math.max(w - 1, 1), Math.max(h - 1, 1));
        } else {
          ctx.fillStyle = color ?? colors.card;
          ctx.fillRect(x, y, w, h);
        }
      }
    }
  };

  /// Il riquadro di ciò che si vede.
  const paintView = (ctx: CanvasRenderingContext2D, view: NavigatorView, at: MapFit, colors: Palette): void => {
    const seen = seenBounds(view);
    const [x, y] = boardToMap(at, seen.min);
    const [x2, y2] = boardToMap(at, seen.max);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = colors.viewFill;
    ctx.fillRect(x, y, x2 - x, y2 - y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.view;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, Math.max(x2 - x - 1.5, 0), Math.max(y2 - y - 1.5, 0));
  };

  /// Un disegno intero: rifà l'inquadratura, le schede e il riquadro.
  const paint = (nodes: readonly CanvasNode[], view: NavigatorView): void => {
    const size = mapSize();
    fit = mapFit(navigatorFrame(nodes, view), size.width, size.height);
    const pixels = { width: Math.round(size.width * size.ratio), height: Math.round(size.height * size.ratio) };
    if (map.width !== pixels.width) map.width = pixels.width;
    if (map.height !== pixels.height) map.height = pixels.height;
    const ctx = map.getContext("2d");
    if (!ctx) return;
    const colors = palette();
    layer ??= document.createElement("canvas");
    layer.width = pixels.width;
    layer.height = pixels.height;
    const cards = layer.getContext("2d");
    if (cards) {
      cards.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
      cards.clearRect(0, 0, size.width, size.height);
      paintCards(cards, nodes, fit, colors);
    }
    compose(view, colors);
  };

  /// La mappa: le schede già dipinte e il riquadro della vista sopra.
  const compose = (view: NavigatorView, colors: Palette = palette()): void => {
    const ctx = map.getContext("2d");
    if (!ctx || fit === null) return;
    const ratio = map.width / (element.clientWidth || FALLBACK_SIZE.width) || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, map.width, map.height);
    if (layer) ctx.drawImage(layer, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Il riquadro che esce dalla mappa (un trascinamento lontano) si taglia al bordo.
    paintView(ctx, view, fit, colors);
  };

  const settle = (): void => {
    if (drag !== null) return;
    const nodes = port.nodes();
    const view = port.view();
    const shown = navigatorShown(nodes, view, port.enabled());
    if (element.hidden === shown) element.hidden = !shown;
    if (!shown || nodes === null) {
      painted = "";
      return;
    }
    const key = signature(nodes, view, mapSize());
    if (key === painted) return;
    painted = key;
    paint(nodes, view);
  };

  /// Il punto della lavagna sotto il puntatore, con l'inquadratura ferma.
  const boardAt = (event: PointerEvent): Point | null => {
    if (fit === null) return null;
    const box = element.getBoundingClientRect();
    return mapToBoard(fit, event.clientX - box.left, event.clientY - box.top);
  };

  port.lifetime.listen(element, "pointerdown", (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const at = boardAt(event);
    if (at === null) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
    // Dentro il riquadro la vista si prende dove la mano l'ha presa; fuori il
    // centro va sotto la mano al primo movimento.
    const view = port.view();
    const seen = seenBounds(view);
    const center = seenCenter(view);
    const held = at[0] >= seen.min[0] && at[0] <= seen.max[0] && at[1] >= seen.min[1] && at[1] <= seen.max[1];
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, offset: held ? [center[0] - at[0], center[1] - at[1]] : [0, 0], moved: false };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Non catturabile: il trascinamento prosegue finché il puntatore resta sopra.
    }
  });
  port.lifetime.listen(element, "pointermove", (event: PointerEvent) => {
    if (drag === null || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) <= NAVIGATOR_DRAG_SLOP) return;
    drag.moved = true;
    const at = boardAt(event);
    if (at === null || drag.offset === null) return;
    const camera = centeredOn(port.view(), [at[0] + drag.offset[0], at[1] + drag.offset[1]]);
    port.pan(camera);
    compose(port.view());
  });
  const end = (event: PointerEvent, cancelled: boolean): void => {
    const current = drag;
    if (current === null || event.pointerId !== current.id) return;
    drag = null;
    if (!current.moved && !cancelled) {
      // Un clic: un salto, che la tela fa volare e ricorda.
      const at = boardAt(event);
      if (at !== null) port.jump(centeredOn(port.view(), at));
      return;
    }
    port.settled();
  };
  port.lifetime.listen(element, "pointerup", (event: PointerEvent) => end(event, false));
  port.lifetime.listen(element, "pointercancel", (event: PointerEvent) => end(event, true));
  port.lifetime.listen(element, "lostpointercapture", (event: PointerEvent) => end(event, true));

  port.lifetime.listen(element, "keydown", (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const steps: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[event.key];
    if (!step || drag !== null) return;
    event.preventDefault();
    const view = port.view();
    const part = event.shiftKey ? NAVIGATOR_KEY_FAR : NAVIGATOR_KEY_STEP;
    // Il riquadro va dalla parte della freccia: la lavagna scorre al contrario.
    port.pan({ ...view.camera, x: view.camera.x - step[0] * view.width * part, y: view.camera.y - step[1] * view.height * part });
    port.settled();
  });

  port.lifetime.add(() => {
    drag = null;
    layer = null;
  });

  return {
    element,
    settle,
    dragging: () => drag !== null && drag.moved,
    relabel,
  };
}
