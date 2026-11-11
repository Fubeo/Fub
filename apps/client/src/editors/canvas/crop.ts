// Il ritaglio di un'immagine della lavagna (N6 T78, l'area S di `lavagna.md`):
// di un'immagine si prende una zona e la si ruota, senza toccare il file. La
// zona è il campo `fub:parts` `image` della scheda (`docs/reference/
// canvas-parts.md`, T73): `rect` in frazioni dell'immagine come si vede,
// `rotate` in gradi in senso orario.
//
// Qui stanno due cose, come nel ritaglio del disegno
// (`editors/spatial/tools/crop.ts`, che si imita: A-27):
//
// - **I conti del gesto**, puri: la zona letta dal campo, la zona vista
//   dopo la rotazione e ritorno, una maniglia trascinata (l'angolo opposto
//   resta fermo, ogni lato almeno `CROP_MIN` del suo lato, tutto dentro
//   l'immagine), la zona spostata, la rotazione di un quarto di giro e le
//   proporzioni della zona ruotata, che la scheda prende.
// - **Il ritaglio sopra la scheda** (`openCropEditor`), con le classi del
//   prototipo T28: `canvas-crop` sul contenuto della scheda con l'immagine
//   intera ruotata (`canvas-crop-picture`), la zona `canvas-crop-box` col
//   velo attorno e le quattro maniglie `canvas-crop-handle` (`role="slider"`),
//   e sotto la scheda la barra `canvas-crop-bar` (↺ ↻, «Togli il ritaglio»,
//   «Fatto») e, se sulla scheda c'è inchiostro, la riga `canvas-crop-note`.
//   Barra e riga stanno fuori dalla lavagna che scala, nel piede
//   `canvas-crop-foot`: hanno la stessa misura a ogni zoom e si posano come
//   la barra della selezione (`place`, con `selectionBarPlaceBelow`).
//   Il ritaglio non scrive niente: dice a chi lo apre la zona scelta
//   (`onDone`), che la scrive in un commit; Esc lascia com'era.
//
// La zona si tiene nelle frazioni dell'immagine dritta, come la scrive il
// file; le maniglie lavorano sull'immagine come si vede, ruotata: i conti
// passano dall'una all'altra con `viewRect` e `fromViewRect`.

import { t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { selectionBarPlaceBelow, type SelectionBarBox } from "./chrome/selection-bar";
import type { CanvasParts, PartRect, PartsExtra } from "./parts";

/// Il lato più corto di una zona, in frazioni del lato dell'immagine: 1/100.
export const CROP_MIN = 0.01;
/// Di quanto muove una freccia, e con Maiusc.
export const CROP_STEP = 0.01;
export const CROP_STEP_FAR = 0.1;
/// Le cifre con cui si scrivono le frazioni della zona: un decimillesimo
/// del lato, più fine di un pixel anche per un'immagine di 8000 px.
const WRITTEN_DIGITS = 4;
/// Il lato più lungo dell'immagine intera disegnata sopra la scheda.
const PICTURE_MAX = 4096;

/// Un quarto di giro, in gradi in senso orario.
export type CropTurn = 0 | 90 | 180 | 270;

/// Gli angoli della zona, come `data-corner`.
export type CropCorner = "nw" | "ne" | "sw" | "se";
export const CROP_CORNERS: readonly CropCorner[] = ["nw", "ne", "sw", "se"];

/// La zona di un'immagine: il rettangolo nell'immagine dritta e la rotazione.
export interface ImageZone {
  readonly rect: PartRect;
  readonly turn: CropTurn;
}

/// L'immagine intera e dritta.
export const WHOLE_ZONE: ImageZone = { rect: [0, 0, 1, 1], turn: 0 };

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

/// Una rotazione qualsiasi portata al quarto di giro più vicino, fra 0 e 270:
/// il file può dire qualsiasi numero (Fub ne scrive solo multipli di 90).
export function cropTurn(degrees: number | null | undefined): CropTurn {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return 0;
  const quarters = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return (quarters * 90) as CropTurn;
}

/// La zona che le parti della scheda dicono; l'immagine intera se non sono
/// di un'immagine.
export function zoneOf(parts: CanvasParts | null | undefined): ImageZone {
  if (!parts || parts.kind !== "image") return WHOLE_ZONE;
  return { rect: parts.rect, turn: cropTurn(parts.rotate) };
}

/// La zona è l'immagine intera e dritta.
export function isWholeZone(zone: ImageZone): boolean {
  const [x, y, width, height] = zone.rect;
  return zone.turn === 0 && x === 0 && y === 0 && width === 1 && height === 1;
}

/// Il nome della zona nella parte dell'immagine ferma (`snapshotPart`):
/// `whole`, o `zone-0.45,0.1,0.5,0.8-r90`. Due tagli dello stesso file hanno
/// nomi diversi, e la stessa zona ritrova la sua immagine.
export function zoneKey(zone: ImageZone): string {
  if (isWholeZone(zone)) return "whole";
  return `zone-${zone.rect.map((value) => String(value)).join(",")}-r${zone.turn}`;
}

/// Il rettangolo `rect` dell'immagine dritta, nell'immagine ruotata di
/// `turn` gradi in senso orario.
export function turnRect(rect: PartRect, turn: CropTurn): PartRect {
  const [x, y, width, height] = rect;
  switch (turn) {
    case 0:
      return rect;
    case 90:
      return [1 - y - height, x, height, width];
    case 180:
      return [1 - x - width, 1 - y - height, width, height];
    case 270:
      return [y, 1 - x - width, height, width];
  }
}

/// La zona come si vede, nell'immagine ruotata.
export function viewRect(zone: ImageZone): PartRect {
  return turnRect(zone.rect, zone.turn);
}

/// Il rettangolo visto nell'immagine ruotata di `turn`, riportato
/// nell'immagine dritta.
export function fromViewRect(rect: PartRect, turn: CropTurn): PartRect {
  return turnRect(rect, ((360 - turn) % 360) as CropTurn);
}

/// La zona dopo un quarto di giro (`90` in senso orario, `-90` al
/// contrario): il rettangolo nell'immagine dritta non cambia.
export function turnZone(zone: ImageZone, by: 90 | -90): ImageZone {
  return { rect: zone.rect, turn: cropTurn(zone.turn + by) };
}

/// Un rettangolo dai suoi lati.
const fromEdges = (x0: number, y0: number, x1: number, y1: number): PartRect => [x0, y0, x1 - x0, y1 - y0];

/// Il rettangolo `rect` con l'angolo `corner` portato al punto `to`, in
/// frazioni: l'angolo opposto resta fermo, ogni lato è almeno `min` e tutto
/// sta in 0…1.
export function dragCorner(rect: PartRect, corner: CropCorner, to: readonly [number, number], min = CROP_MIN): PartRect {
  let [x0, y0] = rect;
  let x1 = rect[0] + rect[2];
  let y1 = rect[1] + rect[3];
  if (corner.includes("w")) x0 = clamp(to[0], 0, Math.max(0, x1 - min));
  else x1 = clamp(to[0], Math.min(1, x0 + min), 1);
  if (corner.includes("n")) y0 = clamp(to[1], 0, Math.max(0, y1 - min));
  else y1 = clamp(to[1], Math.min(1, y0 + min), 1);
  return fromEdges(x0, y0, x1, y1);
}

/// L'angolo `corner` di `rect`.
export function cornerPoint(rect: PartRect, corner: CropCorner): [number, number] {
  return [corner.includes("w") ? rect[0] : rect[0] + rect[2], corner.includes("n") ? rect[1] : rect[1] + rect[3]];
}

/// L'angolo `corner` spostato di `dx`, `dy` (una freccia).
export function nudgeCorner(rect: PartRect, corner: CropCorner, dx: number, dy: number, min = CROP_MIN): PartRect {
  const [x, y] = cornerPoint(rect, corner);
  return dragCorner(rect, corner, [x + dx, y + dy], min);
}

/// Il rettangolo spostato di `dx`, `dy`, fermato al bordo dell'immagine.
export function moveRect(rect: PartRect, dx: number, dy: number): PartRect {
  const [x, y, width, height] = rect;
  return [clamp(x + dx, 0, 1 - width), clamp(y + dy, 0, 1 - height), width, height];
}

/// Le proporzioni (larghezza su altezza) della zona ruotata, per
/// un'immagine di `natural` pixel.
export function zoneRatio(zone: ImageZone, natural: { readonly width: number; readonly height: number }): number {
  const width = zone.rect[2] * natural.width;
  const height = zone.rect[3] * natural.height;
  return zone.turn % 180 === 0 ? width / height : height / width;
}

/// Una frazione come si scrive: a quattro cifre.
const written = (value: number): number => Number(value.toFixed(WRITTEN_DIGITS));

/// Il rettangolo come si scrive: i lati a quattro cifre, dentro 0…1, ogni
/// lato almeno `CROP_MIN`. Si arrotondano i bordi, non le misure, così
/// l'ultimo bordo non esce dall'immagine.
export function writtenRect(rect: PartRect): PartRect {
  let x0 = clamp(written(rect[0]), 0, 1);
  let y0 = clamp(written(rect[1]), 0, 1);
  let x1 = clamp(written(rect[0] + rect[2]), 0, 1);
  let y1 = clamp(written(rect[1] + rect[3]), 0, 1);
  if (x1 - x0 < CROP_MIN) [x0, x1] = x0 + CROP_MIN <= 1 ? [x0, written(x0 + CROP_MIN)] : [written(1 - CROP_MIN), 1];
  if (y1 - y0 < CROP_MIN) [y0, y1] = y0 + CROP_MIN <= 1 ? [y0, written(y0 + CROP_MIN)] : [written(1 - CROP_MIN), 1];
  return [x0, y0, written(x1 - x0), written(y1 - y0)];
}

/// Le parti da scrivere per la zona: la specie `image` con il rettangolo
/// come si scrive e la rotazione (0 non si scrive: `writeParts` lo toglie).
/// `extra` sono i campi sconosciuti del campo di prima, che restano.
export function zoneParts(zone: ImageZone, extra: PartsExtra = {}): CanvasParts {
  return { kind: "image", rect: writtenRect(zone.rect), rotate: zone.turn === 0 ? null : zone.turn, extra };
}

// ---------------------------------------------------------------------------
// Il ritaglio sopra la scheda.
// ---------------------------------------------------------------------------

/// Ciò che il ritaglio disegna: l'immagine intera, com'è nel corpo della
/// scheda (il suo `<canvas>`, o l'`<img>` di un SVG).
export type CropPicture = HTMLCanvasElement | HTMLImageElement;

export interface CropEditorOptions {
  /// Il corpo della scheda: il ritaglio ne copre il contenuto.
  readonly frame: HTMLElement;
  /// Dove sta il piede con la barra e la riga dell'inchiostro: fuori dalla
  /// lavagna che scala, come la barra della selezione. Lo posa `place`.
  readonly chrome: HTMLElement;
  /// La zona di adesso.
  readonly zone: ImageZone;
  /// Sulla scheda c'è inchiostro: la riga lo dice.
  readonly ink: boolean;
  /// L'immagine intera nel corpo, quando c'è.
  readonly picture: () => CropPicture | null;
  readonly lifetime: Lifetime;
  /// Un quarto di giro: la zona di adesso.
  readonly onTurn?: (zone: ImageZone) => void;
  /// L'immagine intera ha le sue misure (è arrivata, o è cambiata).
  readonly onMeasured?: () => void;
  /// «Fatto», Invio: la zona scelta.
  readonly onDone: (zone: ImageZone) => void;
  /// Esc: com'era.
  readonly onCancel: () => void;
  /// «Togli il ritaglio».
  readonly onRemove: () => void;
}

export interface CropEditor {
  /// La zona scelta adesso.
  zone(): ImageZone;
  /// La misura in pixel dell'immagine intera, dritta, se si sa.
  natural(): { readonly width: number; readonly height: number } | null;
  /// Il tasto è del ritaglio (Invio, Esc): lo prende.
  key(event: KeyboardEvent): boolean;
  /// L'elemento è del ritaglio (la zona, le maniglie, la barra).
  contains(target: EventTarget | null): boolean;
  /// Rifà la misura (la scheda ha cambiato misura, l'immagine è arrivata).
  layout(): void;
  /// Posa il piede sotto la scheda `box` (in pixel della vista `view`, che
  /// sta a `offset` nel suo contenitore), o sopra se sotto non c'è posto.
  place(box: SelectionBarBox, view: { width: number; height: number }, offset?: { left: number; top: number }): void;
  focus(): void;
  close(): void;
  readonly closed: boolean;
}

/// Il nome di un angolo per il lettore di schermo.
const CORNER_KEYS = {
  nw: "canvas.crop.corner.nw",
  ne: "canvas.crop.corner.ne",
  sw: "canvas.crop.corner.sw",
  se: "canvas.crop.corner.se",
} as const;

/// La misura dell'immagine nel corpo: le misure del `<canvas>`, o quelle
/// naturali di un `<img>` già caricato.
function pictureSize(picture: CropPicture): { width: number; height: number } | null {
  const width = picture instanceof HTMLImageElement ? picture.naturalWidth : picture.width;
  const height = picture instanceof HTMLImageElement ? picture.naturalHeight : picture.height;
  return width > 0 && height > 0 ? { width, height } : null;
}

/// Apre il ritaglio sopra la scheda.
export function openCropEditor(options: CropEditorOptions): CropEditor {
  const life = openLifetime();
  options.lifetime.add(() => life.close());
  let zone = options.zone;
  let closed = false;

  const overlay = document.createElement("div");
  overlay.className = "canvas-crop";
  const picture = document.createElement("canvas");
  picture.className = "canvas-crop-picture";
  picture.setAttribute("aria-hidden", "true");
  picture.hidden = true;
  const box = document.createElement("div");
  box.className = "canvas-crop-box";
  box.setAttribute("role", "group");
  box.tabIndex = 0;
  box.setAttribute("aria-label", t("canvas.crop.box"));
  const handles = new Map<CropCorner, HTMLElement>();
  for (const corner of CROP_CORNERS) {
    const handle = document.createElement("div");
    handle.className = "canvas-crop-handle";
    handle.dataset.corner = corner;
    handle.setAttribute("role", "slider");
    handle.tabIndex = -1;
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", "100");
    handle.setAttribute("aria-label", t("canvas.crop.handle", { corner: t(CORNER_KEYS[corner]) }));
    handles.set(corner, handle);
    box.append(handle);
  }
  overlay.append(picture, box);

  const bar = document.createElement("div");
  bar.className = "canvas-crop-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t("canvas.crop"));
  const button = (className: string, text: string, label: string | null, run: () => void, kind?: string): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.textContent = text;
    if (label !== null) control.setAttribute("aria-label", label);
    if (kind) control.dataset.kind = kind;
    life.listen(control, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!closed) run();
    });
    bar.append(control);
    return control;
  };
  button("canvas-button", "↺", t("canvas.crop.rotate_left"), () => turn(-90)).dataset.crop = "rotate-left";
  button("canvas-button", "↻", t("canvas.crop.rotate_right"), () => turn(90)).dataset.crop = "rotate-right";
  button("kit-button", t("canvas.crop.remove"), null, () => options.onRemove(), "normal").dataset.crop = "remove";
  const done = button("kit-button", t("canvas.crop.done"), null, () => options.onDone(zone), "primary");
  done.dataset.crop = "done";
  done.setAttribute("aria-keyshortcuts", "Enter");
  const foot = document.createElement("div");
  foot.className = "canvas-crop-foot";
  foot.append(bar);
  if (options.ink) {
    const note = document.createElement("p");
    note.className = "canvas-crop-note";
    note.textContent = t("canvas.crop.ink");
    foot.append(note);
  }
  const parts: HTMLElement[] = [foot];

  options.frame.append(overlay);
  options.chrome.append(foot);

  const place = (target: SelectionBarBox, view: { width: number; height: number }, offset = { left: 0, top: 0 }): void => {
    if (closed) return;
    const at = selectionBarPlaceBelow(target, { width: foot.offsetWidth, height: foot.offsetHeight }, view);
    if (!at) return;
    foot.style.left = `${at.left + offset.left}px`;
    foot.style.top = `${at.top + offset.top}px`;
  };

  /// Dove sta l'immagine intera ruotata nel ritaglio, in pixel del ritaglio:
  /// la più grande che ci entra, al centro. Senza l'immagine, tutto il
  /// ritaglio.
  let stage = { left: 0, top: 0, width: 0, height: 0 };
  let drawn: CropPicture | null = null;
  let drawnTurn: CropTurn | null = null;
  let waiting: HTMLImageElement | null = null;
  let measured = "";

  const natural = (): { width: number; height: number } | null => {
    const source = options.picture();
    return source ? pictureSize(source) : null;
  };

  const paintPicture = (source: CropPicture, size: { width: number; height: number }): void => {
    const turned = zone.turn % 180 !== 0;
    const scale = Math.min(1, PICTURE_MAX / Math.max(size.width, size.height));
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    picture.width = turned ? height : width;
    picture.height = turned ? width : height;
    const drawing = picture.getContext("2d");
    if (!drawing) return;
    drawing.save?.();
    drawing.translate?.(picture.width / 2, picture.height / 2);
    if (zone.turn !== 0) drawing.rotate?.((zone.turn * Math.PI) / 180);
    drawing.drawImage(source, -width / 2, -height / 2, width, height);
    drawing.restore?.();
    drawn = source;
    drawnTurn = zone.turn;
  };

  const layout = (): void => {
    if (closed) return;
    // Il ritaglio copre il contenuto del corpo, dentro il suo margine.
    const style = getComputedStyle(options.frame);
    overlay.style.top = `${parseFloat(style.paddingTop) || 0}px`;
    overlay.style.right = `${parseFloat(style.paddingRight) || 0}px`;
    overlay.style.bottom = `${parseFloat(style.paddingBottom) || 0}px`;
    overlay.style.left = `${parseFloat(style.paddingLeft) || 0}px`;
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    const source = options.picture();
    const size = source ? pictureSize(source) : null;
    if (source instanceof HTMLImageElement && size === null && waiting !== source) {
      // Un SVG che non ha ancora le sue misure: si riprova quando le ha.
      waiting = source;
      life.listen(source, "load", () => layout());
    }
    const sized = size ? `${size.width}x${size.height}` : "";
    const fresh = sized !== measured;
    measured = sized;
    if (source && size) {
      if (drawn !== source || drawnTurn !== zone.turn) paintPicture(source, size);
      const turned = zone.turn % 180 !== 0;
      const ratio = turned ? size.height / size.width : size.width / size.height;
      const fit = width > 0 && height > 0 ? Math.min(width / ratio, height) : 0;
      stage = { width: fit * ratio, height: fit, left: (width - fit * ratio) / 2, top: (height - fit) / 2 };
      picture.hidden = false;
    } else {
      stage = { left: 0, top: 0, width, height };
      picture.hidden = true;
    }
    const place = (element: HTMLElement, left: number, top: number, w: number, h: number): void => {
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.width = `${w}px`;
      element.style.height = `${h}px`;
    };
    place(picture, stage.left, stage.top, stage.width, stage.height);
    const [x, y, w, h] = viewRect(zone);
    place(box, stage.left + x * stage.width, stage.top + y * stage.height, w * stage.width, h * stage.height);
    for (const [corner, handle] of handles) {
      const [cx, cy] = cornerPoint([x, y, w, h], corner);
      handle.setAttribute("aria-valuenow", String(Math.round(cx * 100)));
      handle.setAttribute("aria-valuetext", `${Math.round(cx * 100)} %, ${Math.round(cy * 100)} %`);
    }
    if (fresh && size) options.onMeasured?.();
  };

  /// Cambia la zona vista (il rettangolo nell'immagine ruotata).
  const setView = (rect: PartRect): void => {
    zone = { rect: fromViewRect(rect, zone.turn), turn: zone.turn };
    layout();
  };

  const turn = (by: 90 | -90): void => {
    zone = turnZone(zone, by);
    layout();
    options.onTurn?.(zone);
  };

  /// Il punto del puntatore in frazioni dell'immagine ruotata.
  const pointAt = (event: PointerEvent): [number, number] => {
    const rect = overlay.getBoundingClientRect();
    const scale = overlay.clientWidth > 0 ? rect.width / overlay.clientWidth : 1;
    const left = rect.left + stage.left * scale;
    const top = rect.top + stage.top * scale;
    const width = stage.width * scale || 1;
    const height = stage.height * scale || 1;
    return [(event.clientX - left) / width, (event.clientY - top) / height];
  };

  // I gesti: una maniglia sposta il suo angolo, la zona si sposta tutta.
  // Ogni evento del puntatore resta qui: la lavagna non sposta la scheda.
  let gesture: { pointer: number; corner: CropCorner | null; from: [number, number]; start: PartRect } | null = null;
  const stop = (event: Event): void => event.stopPropagation();
  life.listen(overlay, "pointerdown", (event) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>(".canvas-crop-handle");
    if (!handle && !target?.closest(".canvas-crop-box")) return;
    event.preventDefault();
    const corner = (handle?.dataset.corner as CropCorner | undefined) ?? null;
    gesture = { pointer: event.pointerId, corner, from: pointAt(event), start: viewRect(zone) };
    try {
      overlay.setPointerCapture(event.pointerId);
    } catch {
      // Un puntatore già finito: il gesto resta finché arriva il rilascio.
    }
    (handle ?? box).focus({ preventScroll: true });
  });
  life.listen(overlay, "pointermove", (event) => {
    event.stopPropagation();
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const at = pointAt(event);
    if (gesture.corner) setView(dragCorner(gesture.start, gesture.corner, at));
    else setView(moveRect(gesture.start, at[0] - gesture.from[0], at[1] - gesture.from[1]));
  });
  const end = (event: PointerEvent): void => {
    event.stopPropagation();
    if (gesture && event.pointerId === gesture.pointer) gesture = null;
  };
  life.listen(overlay, "pointerup", end);
  life.listen(overlay, "pointercancel", end);
  for (const element of [overlay, ...parts]) {
    life.listen(element, "dblclick", stop);
    life.listen(element, "click", stop);
    life.listen(element, "contextmenu", stop);
  }
  for (const element of parts) life.listen(element, "pointerdown", stop);

  const key = (event: KeyboardEvent): boolean => {
    if (closed || event.defaultPrevented) return false;
    if (event.key === "Escape") {
      options.onCancel();
      return true;
    }
    if (event.key === "Enter") {
      // Invio su un pulsante della barra è il suo clic.
      if (event.target instanceof HTMLButtonElement && bar.contains(event.target)) return false;
      options.onDone(zone);
      return true;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const way = arrows[event.key];
    if (!way || event.ctrlKey || event.metaKey) return false;
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>(".canvas-crop-handle");
    if (!handle && target !== box) return false;
    const step = event.shiftKey ? CROP_STEP_FAR : CROP_STEP;
    const [dx, dy] = [way[0] * step, way[1] * step];
    const now = viewRect(zone);
    // Su una maniglia la freccia sposta il suo angolo; sulla zona la sposta
    // tutta, e con Alt ne allarga o stringe l'angolo in basso a destra.
    if (handle) setView(nudgeCorner(now, handle.dataset.corner as CropCorner, dx, dy));
    else if (event.altKey) setView(nudgeCorner(now, "se", dx, dy));
    else setView(moveRect(now, dx, dy));
    return true;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (key(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  life.listen(overlay, "keydown", onKey);
  life.listen(bar, "keydown", onKey);

  // L'immagine arriva dopo (la scheda la sta leggendo), o cambia misura.
  if (typeof MutationObserver !== "undefined") {
    const watch = new MutationObserver(() => layout());
    watch.observe(options.frame, { childList: true, subtree: true });
    life.add(() => watch.disconnect());
  }
  if (typeof ResizeObserver !== "undefined") {
    const resize = new ResizeObserver(() => layout());
    resize.observe(overlay);
    life.add(() => resize.disconnect());
  }
  life.add(() => {
    closed = true;
    gesture = null;
    overlay.remove();
    for (const part of parts) part.remove();
  });

  layout();

  return {
    zone: () => zone,
    natural,
    key,
    contains: (target) => target instanceof Node && (overlay.contains(target) || parts.some((part) => part.contains(target))),
    layout,
    place,
    focus: () => box.focus({ preventScroll: true }),
    close: () => life.close(),
    get closed() {
      return closed;
    },
  };
}
