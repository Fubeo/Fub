// Il motore della lavagna: la geometria e il DOM senza stato. Tolti da
// `engine.ts`.

import { type Spot } from "../../ink/tools/sweep";
import { type Rect } from "../core/cards/contract";
import { DEFAULT_TEXT_STYLE, textStyle } from "./text-style";
// I colori delle schede e dei fili (T47).
import { colorLook } from "./colors";
import { type Camera } from "../../spatial/camera";
import { type CanvasNode } from "./model";
import { type GuideSide } from "./guides";
import {
  CANVAS_SNAP,
  MEASURE_IMAGE_TIMEOUT_MS,
  ERASE_ALONG_MAX_POINTS,
  ERASE_ALONG_WORK,
  CanvasEngineOptions,
} from "./engine-options";
import { Viewport, EDGE_SCROLL_ZONE, EDGE_SCROLL_MAX } from "./engine-parts";

/** La camera della tela nella forma di `spatial/camera.ts`, e ritorno. */
export function toCamera(view: Viewport): Camera {
  return { scale: view.zoom, tx: view.x, ty: view.y };
}

export function fromCamera(camera: Camera): Viewport {
  return { x: camera.tx, y: camera.ty, zoom: camera.scale };
}

/**
 * La velocità dello scorrimento al bordo su un asse, in px al ms: `near` è la
 * distanza dal bordo di inizio, `far` da quello di fine (negative fuori dalla
 * vista). Positiva verso la fine, negativa verso l'inizio, zero fuori dalla
 * fascia; più veloce più si è vicini, la massima sul bordo e oltre.
 */
export function edgeScrollSpeed(near: number, far: number): number {
  const pull = (distance: number): number =>
    distance >= EDGE_SCROLL_ZONE ? 0 : EDGE_SCROLL_MAX * Math.min(1, 1 - Math.max(0, distance) / EDGE_SCROLL_ZONE);
  return pull(far) - pull(near);
}

/** Le due camere sono la stessa. */
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/**
 * Il rettangolo di `node` e `view` si sovrappongono davvero: una scheda che
 * tocca la vista solo sul bordo è fuori.
 */
export function overlaps(node: Rect, view: Rect): boolean {
  return node.x < view.x + view.width && node.x + node.width > view.x
    && node.y < view.y + view.height && node.y + node.height > view.y;
}

/**
 * Le schede libere, come le sceglie `layout` senza `ids` (`loose_cards` di
 * `ops/layout.rs`): non gruppi, e non dentro un gruppo (tutto il rettangolo
 * nel suo, bordi compresi).
 */
export function looseCards(nodes: readonly CanvasNode[]): CanvasNode[] {
  const groups = nodes.filter((node) => node.type === "group");
  const inside = (card: CanvasNode, group: CanvasNode): boolean =>
    card.id !== group.id && card.x >= group.x && card.y >= group.y
    && card.x + card.width <= group.x + group.width && card.y + card.height <= group.y + group.height;
  return nodes.filter((node) => node.type !== "group" && !groups.some((group) => inside(node, group)));
}

export function snap(value: number): number {
  return Math.round(value / CANVAS_SNAP) * CANVAS_SNAP;
}

/** `value` al multiplo di `step` più vicino (`canvas.snap_step`, #411 C-05). */
export function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Quanto dura la scheda che scivola al suo posto agganciato quando la si
 * lascia (#411 C-05); col movimento ridotto ci va subito.
 */
export const SETTLE_MS = 120;

/** Spostando una scheda o una selezione, tutti e tre i punti di ogni asse si agganciano (T71). */
export const MOVE_SIDES: readonly GuideSide[] = ["start", "center", "end"];

// --- ridimensionare (T66) -------------------------------------------------------

/** Un angolo di una scheda, o della cornice della scelta: dove sta una maniglia. */
export type ResizeCorner = "nw" | "ne" | "sw" | "se";

/**
 * Le quattro maniglie, nell'ordine in cui stanno nel DOM: prima quella in
 * basso a destra, la maniglia di sempre, che resta l'unica sotto
 * `RESIZE_ONE_HANDLE_PX`.
 */
export const RESIZE_CORNERS: readonly ResizeCorner[] = ["se", "sw", "ne", "nw"];

/** Sotto questa misura sullo schermo, in px, una scheda ha solo la maniglia in basso a destra. */
export const RESIZE_ONE_HANDLE_PX = 24;

/**
 * La metà della presa del dito, in px sullo schermo: un'area di 44 px
 * centrata sull'angolo. Col mouse la presa è l'elemento della maniglia, 20
 * px, misurata dalla pelle.
 */
export const RESIZE_FINGER_GRIP_PX = 22;

/**
 * La larghezza più grande che una scheda di testo prende da sé: col doppio
 * clic su una maniglia (T66) e mentre ci si scrive (T44). Oltre, il testo va a
 * capo e la scheda cresce in altezza.
 */
export const CANVAS_TEXT_FIT_MAX_WIDTH = 480;

/** L'altezza di nascita di una scheda di testo, come la mette lo strumento Testo. */
export const TEXT_CARD_HEIGHT = 160;

/** Lo spazio fra una scheda e quella che Ctrl+Invio (sotto) o Ctrl+Maiusc+Invio (a destra) le apre accanto (T44). */
export const NEXT_CARD_GAP = 24;

/** Quante volte la scheda di Ctrl+Invio scende cercando un posto libero, prima di cadere sopra un'altra (T44). */
export const NEXT_CARD_TRIES = 20;

/** Un rettangolo nella lavagna. */
export interface ResizeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Come si tira una maniglia. */
export interface ResizeOptions {
  /** Maiusc: le proporzioni di partenza restano. */
  readonly keepRatio: boolean;
  /** Alt: il centro resta fermo e la misura cambia dai due lati. */
  readonly fromCenter: boolean;
  /** L'aggancio delle misure alla griglia (A-23); con le proporzioni tenute non c'è. */
  readonly snap: boolean;
  /**
   * Il passo della griglia (`canvas.snap_step`, #411 C-05): di serie
   * `CANVAS_SNAP`; `null` senza griglia, e la misura si aggancia solo alle guide.
   */
  readonly step?: number | null;
  /** Gli assi che una guida ha già messo (T71): su quelli la misura non si aggancia alla griglia. */
  readonly guided?: { readonly x: boolean; readonly y: boolean };
  readonly minWidth: number;
  readonly minHeight: number;
}

/**
 * Il rettangolo `start` tirato dalla maniglia `corner` di `(dx, dy)`, in
 * unità della lavagna. Senza Alt sta fermo l'angolo opposto, con Alt il
 * centro; con Maiusc vince il lato che cresce di più, e l'altro lo segue.
 * Mai sotto il minimo, mai `NaN`.
 */
export function resizeBox(start: ResizeBox, corner: ResizeCorner, dx: number, dy: number, options: ResizeOptions): ResizeBox {
  const east = corner === "ne" || corner === "se";
  const south = corner === "sw" || corner === "se";
  const reach = options.fromCenter ? 2 : 1;
  let width = start.width + (east ? dx : -dx) * reach;
  let height = start.height + (south ? dy : -dy) * reach;
  if (options.keepRatio && start.width > 0 && start.height > 0) {
    const scale = Math.max(
      width / start.width,
      height / start.height,
      options.minWidth / start.width,
      options.minHeight / start.height,
    );
    width = start.width * scale;
    height = start.height * scale;
  } else if (options.snap && options.step !== null) {
    const step = options.step ?? CANVAS_SNAP;
    if (!options.guided?.x) width = snapTo(width, step);
    if (!options.guided?.y) height = snapTo(height, step);
  }
  width = Math.round(Math.max(options.minWidth, Number.isFinite(width) ? width : start.width));
  height = Math.round(Math.max(options.minHeight, Number.isFinite(height) ? height : start.height));
  const x = options.fromCenter
    ? Math.round(start.x + (start.width - width) / 2)
    : east ? start.x : start.x + start.width - width;
  const y = options.fromCenter
    ? Math.round(start.y + (start.height - height) / 2)
    : south ? start.y : start.y + start.height - height;
  return { x, y, width, height };
}

/** Il rettangolo che contiene tutte le schede `nodes`; `null` senza schede. */
export function boxAround(nodes: readonly ResizeBox[]): ResizeBox | null {
  if (nodes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * La scheda `node` dentro la cornice `from` portata nella cornice `to`: la
 * posizione e la misura scalano come la cornice (le maniglie della scelta).
 */
export function scaleInto(node: ResizeBox, from: ResizeBox, to: ResizeBox, min: number): ResizeBox {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    x: Math.round(to.x + (node.x - from.x) * sx),
    y: Math.round(to.y + (node.y - from.y) * sy),
    width: Math.max(min, Math.round(node.width * sx)),
    height: Math.max(min, Math.round(node.height * sy)),
  };
}

/** Il primo multiplo di `CANVAS_SNAP` che non taglia `value`. */
function snapUp(value: number): number {
  return Math.ceil(value / CANVAS_SNAP) * CANVAS_SNAP;
}

/** L'angolo scritto su una maniglia; senza, quello in basso a destra. */
export function cornerOf(value: string | undefined): ResizeCorner {
  return value === "nw" || value === "ne" || value === "sw" ? value : "se";
}

/** Un lato del rettangolo `box` è sotto `RESIZE_ONE_HANDLE_PX` sullo schermo. */
export function tinyOnScreen(box: ResizeBox, zoom: number): boolean {
  return box.width * zoom < RESIZE_ONE_HANDLE_PX || box.height * zoom < RESIZE_ONE_HANDLE_PX;
}

/**
 * Una maniglia: l'area di presa all'angolo `corner`, che la pelle misura e
 * disegna. `node` è la scheda che ridimensiona; `null` per la cornice della
 * scelta, che ridimensiona tutte le schede scelte.
 */
export function resizeHandle(corner: ResizeCorner, node: string | null): HTMLElement {
  const handle = document.createElement("div");
  handle.className = "canvas-resize";
  handle.dataset.corner = corner;
  if (node === null) handle.dataset.resizeFrame = "";
  else handle.dataset.resize = node;
  handle.setAttribute("aria-hidden", "true");
  return handle;
}

/** Una scheda (o la cornice) troppo piccola sullo schermo tiene solo la maniglia in basso a destra: le altre la coprirebbero. */
export function markHandles(el: HTMLElement, box: ResizeBox, zoom: number): void {
  if (tinyOnScreen(box, zoom)) el.dataset.handles = "one";
  else delete el.dataset.handles;
}

/**
 * La misura del testo di una scheda (`article`, col corpo `body`): la
 * larghezza che il testo vuole senza andare a capo, fino a
 * `CANVAS_TEXT_FIT_MAX_WIDTH`, e l'altezza che allora gli serve, la testata
 * compresa; agganciate per eccesso a `CANVAS_SNAP`, così niente si taglia.
 * Misura sullo stile della scheda e lo rimette com'era. `null` senza
 * impaginazione.
 */
export function measureText(article: HTMLElement, body: HTMLElement): { width: number; height: number } | null {
  const { width, height } = article.style;
  try {
    article.style.width = "max-content";
    // La larghezza usata, coi decimali: `offsetWidth` arrotonda, e un testo
    // largo 320,3 px a 320 andrebbe a capo.
    let measured = Math.max(article.offsetWidth, parseFloat(getComputedStyle(article).width) || 0);
    if (measured > CANVAS_TEXT_FIT_MAX_WIDTH) {
      article.style.width = `${CANVAS_TEXT_FIT_MAX_WIDTH}px`;
      measured = CANVAS_TEXT_FIT_MAX_WIDTH;
    } else {
      article.style.width = `${measured}px`;
    }
    // La testata e i bordi: quello che non è il corpo. Poi il corpo a zero,
    // perché scorra tutto e `scrollHeight` dica l'altezza del testo.
    const chrome = Math.max(0, article.offsetHeight - body.offsetHeight);
    article.style.height = `${chrome}px`;
    const content = body.scrollHeight;
    if (measured <= 0 || content <= 0) return null;
    return { width: Math.min(CANVAS_TEXT_FIT_MAX_WIDTH, snapUp(measured)), height: snapUp(chrome + content) };
  } finally {
    article.style.width = width;
    article.style.height = height;
  }
}

/**
 * La misura che vuole la scheda di testo `article` mentre ci si scrive in
 * `place` (il campo semplice, o il contenitore dell'editor delle note, T44):
 * la larghezza del testo senza andare a capo, fino a
 * `CANVAS_TEXT_FIT_MAX_WIDTH` (se `keepWidth`, quella di adesso), e l'altezza
 * che allora gli serve. Mai più piccola della misura di adesso; agganciata per
 * eccesso a `CANVAS_SNAP` solo dove cresce. Misura sullo stile della scheda e
 * lo rimette com'era. `null` senza impaginazione.
 */
export function measureWriting(article: HTMLElement, place: HTMLElement, keepWidth: boolean): { width: number; height: number } | null {
  const current = { width: article.offsetWidth, height: article.offsetHeight };
  if (current.width <= 0 || current.height <= 0) return null;
  const { width, height } = article.style;
  try {
    let wanted = current.width;
    if (!keepWidth && current.width < CANVAS_TEXT_FIT_MAX_WIDTH) {
      const natural = naturalWritingWidth(article, place);
      if (natural > current.width) wanted = Math.min(CANVAS_TEXT_FIT_MAX_WIDTH, snapUp(natural));
      article.style.width = `${wanted}px`;
    }
    // L'altezza alla larghezza nuova: quanto il testo esce da ciò che scorre.
    const overflow = writingOverflow(place);
    return { width: wanted, height: overflow > 0 ? snapUp(current.height + overflow) : current.height };
  } finally {
    article.style.width = width;
    article.style.height = height;
  }
}

/**
 * La larghezza che la scheda vorrebbe perché il testo che si scrive in
 * `place` stia senza andare a capo. Il campo semplice non ha una misura sua:
 * lo si mette per un attimo su righe che non vanno a capo, e conta quanto
 * esce. L'editor delle note sì: la scheda larga quanto il suo contenuto
 * (`max-content`), come il doppio clic su una maniglia.
 */
function naturalWritingWidth(article: HTMLElement, place: HTMLElement): number {
  if (place instanceof HTMLTextAreaElement || place instanceof HTMLInputElement) {
    const wrap = place.style.whiteSpace;
    place.style.whiteSpace = "pre";
    try {
      const out = place.scrollWidth - place.clientWidth;
      // Un pixel in più: `scrollWidth` è arrotondato all'intero.
      return out > 0 ? article.offsetWidth + out + 1 : 0;
    } finally {
      place.style.whiteSpace = wrap;
    }
  }
  article.style.width = "max-content";
  // Coi decimali: `offsetWidth` arrotonda, e un testo largo 320,3 px a 320 andrebbe a capo.
  return Math.max(article.offsetWidth, parseFloat(getComputedStyle(article).width) || 0);
}

/**
 * Quanto il testo che si scrive in `place` esce in basso da ciò che lo fa
 * scorrere: il campo semplice stesso, o gli elementi dell'editor delle note
 * dal contenuto modificabile fino al contenitore escluso (il contenitore
 * tiene sotto l'editor anche ciò che non si vede, e non conta).
 */
function writingOverflow(place: HTMLElement): number {
  const start = place.querySelector<HTMLElement>('[contenteditable="true"]') ?? place;
  let overflow = start === place ? place.scrollHeight - place.clientHeight : 0;
  for (let el: HTMLElement | null = start; el && el !== place; el = el.parentElement) {
    overflow = Math.max(overflow, el.scrollHeight - el.clientHeight);
  }
  return overflow;
}

/**
 * Il primo posto libero per una scheda `box` nuova: se cadrebbe sopra
 * un'altra scheda (i gruppi no: ci stanno sotto), scende sotto di lei, a
 * `NEXT_CARD_GAP`, al più `NEXT_CARD_TRIES` volte; poi resta dove doveva
 * nascere, sopra l'altra (T44).
 */
export function freeSpot(nodes: readonly CanvasNode[], box: ResizeBox): ResizeBox {
  let y = box.y;
  for (let tries = 0; tries < NEXT_CARD_TRIES; tries++) {
    const at = { ...box, y };
    const blocker = nodes.find((node) => node.type !== "group"
      && node.x < at.x + at.width && at.x < node.x + node.width
      && node.y < at.y + at.height && at.y < node.y + node.height);
    if (!blocker) return at;
    y = blocker.y + blocker.height + NEXT_CARD_GAP;
  }
  return box;
}

/** La misura del contenuto disegnato nel corpo: l'immagine, o la pagina del PDF. `null` se non c'è ancora. */
export function naturalSize(body: HTMLElement): { width: number; height: number } | null {
  for (const picture of body.querySelectorAll<HTMLImageElement | HTMLCanvasElement>("img, canvas")) {
    const width = picture instanceof HTMLImageElement ? picture.naturalWidth : picture.width;
    const height = picture instanceof HTMLImageElement ? picture.naturalHeight : picture.height;
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

/**
 * Il colore `color` sull'elemento `el` di una scheda o di un filo (T47): la
 * chiave in `data-canvas-color` e, per un colore libero, il suo valore in
 * `--canvas-color`, com'è nel file. L'aspetto lo dà la pelle; un valore che
 * non è un colore non segna niente.
 */
export function paintColor(el: HTMLElement | SVGElement, color: string | undefined): void {
  const look = colorLook(color);
  if (look) el.dataset.canvasColor = look.key;
  else delete el.dataset.canvasColor;
  if (look?.custom) el.style.setProperty("--canvas-color", look.custom);
  else el.style.removeProperty("--canvas-color");
}

/**
 * La misura e l'allineamento del testo di una scheda (T92, `fub:text`) su
 * `el`, in `data-text-size` e `data-text-align`; quelli di serie non si
 * segnano. L'aspetto lo dà la pelle.
 */
export function paintTextStyle(el: HTMLElement, node: CanvasNode): void {
  const style = node.type === "text" ? textStyle(node) : DEFAULT_TEXT_STYLE;
  if (style.size === DEFAULT_TEXT_STYLE.size) delete el.dataset.textSize;
  else if (el.dataset.textSize !== style.size) el.dataset.textSize = style.size;
  if (style.align === DEFAULT_TEXT_STYLE.align) delete el.dataset.textAlign;
  else if (el.dataset.textAlign !== style.align) el.dataset.textAlign = style.align;
}

/**
 * La misura di un'immagine dalla porta, o `null` se non arriva entro
 * `MEASURE_IMAGE_TIMEOUT_MS`, fallisce o non è una misura.
 */
export async function measuredImage(
  measure: NonNullable<CanvasEngineOptions["measureImage"]>,
  path: string,
): Promise<{ width: number; height: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), MEASURE_IMAGE_TIMEOUT_MS);
  });
  try {
    const size = await Promise.race([measure(path).catch(() => null), late]);
    return size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
      ? { width: size.width, height: size.height }
      : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Un path relativo alla radice del vault, senza risalite né caratteri di controllo. */
export function isVaultPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 8192
    && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..")
    && !/[\u0000-\u001f]/u.test(path);
}

export function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Quanti segmenti al più ha il cammino di un `erase_along` sui tratti `units`
 * (i punti in coordinate della lavagna) con la gomma di raggio `radius`:
 * sotto `MAX_ERASE_POINTS` del nucleo, e sotto metà del suo `MAX_ERASE_WORK`.
 * Il lavoro del nucleo (`split_work` in `crates/fub-ink-codec/src/cut.rs`) è,
 * per ogni segmento del cammino vicino a un tratto, uno più un passo per
 * coppia di campioni più la lunghezza del tratto diviso metà della portata
 * (raggio più metà dello spessore): la stima prende il raggio da solo, e
 * conta ogni segmento vicino a ogni tratto. In unità della lavagna la scala
 * della scheda si semplifica.
 */
export function eraseAlongSegments(units: readonly { readonly points: readonly number[] }[], radius: number): number {
  let work = 0;
  for (const { points } of units) {
    let length = 0;
    for (let i = 2; i + 1 < points.length; i += 2) {
      length += Math.hypot(points[i]! - points[i - 2]!, points[i + 1]! - points[i - 1]!);
    }
    work += 1 + points.length / 2 + (2 * length) / radius;
  }
  const perSegment = Number.isFinite(work) && work > 0 ? work : 1;
  return Math.max(1, Math.min(ERASE_ALONG_MAX_POINTS - 1, Math.floor(ERASE_ALONG_WORK / perSegment)));
}

/**
 * Il cammino `path` in pezzi di fila di al più `segments` segmenti: l'ultimo
 * punto di un pezzo è il primo del seguente, così nessun tratto fra due punti
 * resta senza gomma. Un cammino corto è un pezzo solo.
 */
export function erasePathPieces(path: readonly Spot[], segments: number): Spot[][] {
  const step = Math.max(1, Math.floor(segments));
  if (path.length <= step + 1) return [path.slice()];
  const pieces: Spot[][] = [];
  for (let start = 0; start < path.length - 1; start += step) {
    pieces.push(path.slice(start, Math.min(path.length, start + step + 1)));
  }
  return pieces;
}
