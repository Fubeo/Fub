// L'editor del disegno: lo strumento Ritaglia immagine del Disegno completo,
// come quello di VectorCraft (`vendor/vectorcraft/crates/tools/src/cropimage.rs`).
// Un pezzo di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.
//
// - Un riquadro sopra l'immagine scelta: parte dalla parte che si vede (tutta,
//   o il ritaglio che ha già), le maniglie e l'interno lo tirano, sempre dentro
//   l'immagine e di almeno un punto per lato; fuori dal riquadro l'immagine è
//   scurita.
// - Invio, il doppio clic o «Ritaglia immagine» di nuovo ritagliano, in un passo
//   di annulla; un riquadro uguale a ciò che si vede non cambia niente. Esc
//   lascia l'immagine com'era. In tutti e due i casi lo strumento si chiude.
// - Diverso da VectorCraft, per non perdere dati: il ritaglio non riscrive i
//   pixel, è il `clipPath` di `../crop.ts`. I byte dell'immagine e il suo `href`
//   (un file del vault resta collegato) non cambiano, e un altro ritaglio può
//   ridare la parte tolta, che mentre si ritaglia si vede scurita.
// - Il riquadro sta nelle coordinate dell'immagine: con un'immagine ruotata o
//   inclinata gira con lei.

import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { isWritingField } from "../../../../ui/field-history";
import { t } from "../../strings";
import type { Bounds } from "../../scene/geometry";
import { apply, compose, invert, type Matrix, type Point } from "../../scene/matrix";
import { viewMatrix } from "../../view";
import { hrefOf, plainAttributes, nodeOf } from "../arrange";
import { cropOps, cropState, dragCrop, type Crop, type CropHandle } from "../crop";
import type { Unit } from "../hit";
import type { EditorContext } from "./context";

const SVG_NS = "http://www.w3.org/2000/svg";

/// Il lato più corto del riquadro, nelle unità dell'immagine (VectorCraft: `MIN`).
export const MIN_SIDE = 1;

/// Quanto lontano, in pixel dello schermo, una maniglia si prende.
const REACH_PX = 8;

/// Il lato di una maniglia disegnata, in pixel.
const HANDLE_PX = 7;

/// Le maniglie, in giro dall'angolo in alto a sinistra.
const HANDLES: readonly CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/// Ciò che il ritaglio dà agli altri pezzi dell'editor.
export interface CropImageContext {
  /// «Ritaglia immagine»: apre il riquadro sull'immagine scelta, o lo applica se
  /// è già aperto.
  cropImage: () => void;
  /// Vero mentre il riquadro è aperto.
  croppingImage: () => boolean;
}

/// Il punto della maniglia `handle` su `rect`.
export function handleSpot(rect: Bounds, handle: CropHandle): Point {
  const x = handle.includes("w") ? rect.min[0] : handle.includes("e") ? rect.max[0] : (rect.min[0] + rect.max[0]) / 2;
  const y = handle.includes("n") ? rect.min[1] : handle.includes("s") ? rect.max[1] : (rect.min[1] + rect.max[1]) / 2;
  return [x, y];
}

/// Il riquadro `rect` spostato di `delta` tutto intero, e riportato dentro
/// `box` senza cambiare misura (VectorCraft: `slid_within`).
export function slidWithin(rect: Bounds, box: Bounds, delta: Point): Bounds {
  const w = rect.max[0] - rect.min[0];
  const h = rect.max[1] - rect.min[1];
  const x0 = Math.max(box.min[0], Math.min(box.max[0] - w, rect.min[0] + delta[0]));
  const y0 = Math.max(box.min[1], Math.min(box.max[1] - h, rect.min[1] + delta[1]));
  return { min: [x0, y0], max: [x0 + w, y0 + h] };
}

/// Vero se `a` e `b` sono lo stesso riquadro a un millesimo (VectorCraft: `same`).
export function sameRect(a: Bounds, b: Bounds): boolean {
  return [a.min[0] - b.min[0], a.min[1] - b.min[1], a.max[0] - b.max[0], a.max[1] - b.max[1]].every((d) => Math.abs(d) < 1e-3);
}

/// Il riquadro da cui si parte: la parte dell'immagine che si vede.
export function startRect(crop: Crop): Bounds {
  return crop.rect;
}

/// La maniglia sotto `at`, nello schermo, per il riquadro `rect` disegnato con
/// `toScreen`: la più vicina entro `reach` pixel; `null` se nessuna.
export function handleAt(rect: Bounds, toScreen: (p: Point) => Point, at: Point, reach = REACH_PX): CropHandle | null {
  let best: CropHandle | null = null;
  let nearest = reach;
  for (const handle of HANDLES) {
    const [x, y] = toScreen(handleSpot(rect, handle));
    const away = Math.hypot(x - at[0], y - at[1]);
    if (away <= nearest) {
      nearest = away;
      best = handle;
    }
  }
  return best;
}

/// Vero se `p`, nelle coordinate dell'immagine, sta dentro `rect`.
const inside = (rect: Bounds, [x, y]: Point): boolean => x >= rect.min[0] && x <= rect.max[0] && y >= rect.min[1] && y <= rect.max[1];

/// Il cursore di una maniglia (VectorCraft: `cursor`).
const handleCursor = (handle: CropHandle): string =>
  handle === "n" || handle === "s" ? "ns" : handle === "e" || handle === "w" ? "ew" : handle === "nw" || handle === "se" ? "nwse" : "nesw";

interface Session {
  readonly key: string;
  readonly loaded: number;
  readonly crop: Crop;
  rect: Bounds;
  drag: { readonly kind: "handle"; readonly handle: CropHandle; readonly from: Bounds; readonly offset: Point } | { readonly kind: "move"; readonly start: Point; readonly from: Bounds } | null;
  readonly life: Lifetime;
  /// L'immagine intera, per vedere scurita anche la parte già tolta.
  url: string | null;
}

/// Monta lo strumento Ritaglia immagine.
export function installCropImage(ctx: EditorContext): void {
  let session: Session | null = null;
  let svg: SVGSVGElement | null = null;

  /// L'immagine che si ritaglia, nell'indice di adesso.
  const unitNow = (): Unit | null => (session === null ? null : ctx.currentIndex().get(session.key));

  /// Dalle coordinate dell'immagine allo schermo.
  const screenMatrix = (unit: Unit): Matrix => compose(viewMatrix(ctx.camera), unit.matrix);

  const close = (): void => {
    if (session === null) return;
    session.life.close();
    session = null;
    delete ctx.surface.dataset.ritaglio;
    svg?.replaceChildren();
  };

  const draw = (): void => {
    if (ctx.disposed) return;
    if (session !== null && (ctx.loads !== session.loaded || !ctx.editable())) close();
    const unit = unitNow();
    if (session !== null && (unit === null || ctx.selection.length !== 1 || ctx.selection[0] !== session.key)) close();
    if (session === null || unit === null) {
      svg?.replaceChildren();
      return;
    }
    if (svg === null) {
      svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
      svg.setAttribute("class", "draw-ritaglio");
      svg.setAttribute("aria-hidden", "true");
      ctx.surface.append(svg);
      const questo = svg;
      ctx.life.add(() => {
        questo.remove();
        svg = null;
      });
    }
    const m = screenMatrix(unit);
    const { box } = session.crop;
    const r = session.rect;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", `matrix(${m.join(" ")})`);
    const figli: SVGElement[] = [];
    // La parte già tolta non la disegna il foglio: qui l'immagine intera, sotto l'ombra.
    if (session.url !== null && !sameRect(session.crop.rect, box)) {
      const image = document.createElementNS(SVG_NS, "image");
      image.setAttribute("href", session.url);
      image.setAttribute("x", String(box.min[0]));
      image.setAttribute("y", String(box.min[1]));
      image.setAttribute("width", String(box.max[0] - box.min[0]));
      image.setAttribute("height", String(box.max[1] - box.min[1]));
      const node = nodeOf(ctx.engine.model!, unit);
      const ratio = plainAttributes(node).get("preserveAspectRatio");
      if (ratio !== undefined) image.setAttribute("preserveAspectRatio", ratio);
      figli.push(image);
    }
    const shade = document.createElementNS(SVG_NS, "path");
    shade.setAttribute("class", "draw-ritaglio-ombra");
    shade.setAttribute("fill-rule", "evenodd");
    const rettangolo = (b: Bounds): string => `M${b.min[0]} ${b.min[1]}H${b.max[0]}V${b.max[1]}H${b.min[0]}Z`;
    shade.setAttribute("d", rettangolo(box) + rettangolo(r));
    figli.push(shade);
    const bordo = document.createElementNS(SVG_NS, "path");
    bordo.setAttribute("class", "draw-ritaglio-bordo");
    bordo.setAttribute("d", rettangolo(r));
    figli.push(bordo);
    g.replaceChildren(...figli);
    const maniglie: SVGElement[] = HANDLES.map((handle) => {
      const [x, y] = apply(m, handleSpot(r, handle));
      const q = document.createElementNS(SVG_NS, "rect");
      q.setAttribute("class", "draw-ritaglio-maniglia");
      q.setAttribute("x", String(x - HANDLE_PX / 2));
      q.setAttribute("y", String(y - HANDLE_PX / 2));
      q.setAttribute("width", String(HANDLE_PX));
      q.setAttribute("height", String(HANDLE_PX));
      return q;
    });
    const misura = document.createElementNS(SVG_NS, "text");
    misura.setAttribute("class", "draw-ritaglio-misura");
    // Il bordo scuro sotto il testo: un attributo SVG, perché la pelle non ammette `paint-order`.
    misura.setAttribute("paint-order", "stroke");
    const [lx, ly] = apply(m, [r.min[0], r.max[1]]);
    misura.setAttribute("x", String(lx));
    misura.setAttribute("y", String(ly + 16));
    const sx = Math.hypot(unit.matrix[0], unit.matrix[1]);
    const sy = Math.hypot(unit.matrix[2], unit.matrix[3]);
    misura.textContent = ctx.measuresText([(r.max[0] - r.min[0]) * sx, (r.max[1] - r.min[1]) * sy]);
    svg.replaceChildren(g, ...maniglie, misura);
  };

  /// Scrive il ritaglio, se cambia ciò che si vede, e chiude.
  const applyCrop = (): void => {
    const now = session;
    const unit = unitNow();
    if (now === null || unit === null) return close();
    const rect = now.rect;
    close();
    if (sameRect(rect, now.crop.rect)) return;
    const model = ctx.engine.model;
    if (model === null) return;
    const node = nodeOf(model, unit);
    const ops = cropOps(model, node, { box: now.crop.box, rect }, ctx.newIds());
    if (ops.length === 0) return;
    // Un'immagine senza id ne riceve uno dal ritaglio: la scelta resta su di lei.
    const own = [...ops].reverse().find((op) => op.op === "set" && op.part === undefined);
    const key = node.facts.id ?? (own?.op === "set" ? own.id : null) ?? unit.key;
    if (ctx.arrange("draw.action.cropImage", { ops, keys: [key] }) !== null) announce("draw.crop.done");
  };

  const announce = (key: "draw.crop.done" | "draw.crop.none" | "draw.crop.other" | "draw.crop.hint" | "draw.crop.cancelled"): void => ctx.announce(t(key));

  const cancelCrop = (): void => {
    if (session === null) return;
    close();
    announce("draw.crop.cancelled");
  };

  ctx.croppingImage = () => session !== null;

  ctx.cropImage = () => {
    if (session !== null) return applyCrop();
    if (!ctx.editable()) return;
    const model = ctx.engine.model;
    // La prima immagine della scelta, come VectorCraft (`selected_image`).
    const unit = ctx.selectedUnits().find((u) => u.role === "image") ?? null;
    if (model === null || unit === null) return announce("draw.crop.none");
    const state = cropState(model, nodeOf(model, unit));
    if (state === null) return announce("draw.crop.none");
    if (state.kind === "other") return announce("draw.crop.other");
    ctx.cancelGesture();
    // Il riquadro è dell'immagine sola: la scelta si stringe a lei.
    if (ctx.selection.length !== 1 || ctx.selection[0] !== unit.key) ctx.select([unit.key]);
    const life = openLifetime();
    session = { key: unit.key, loaded: ctx.loads, crop: state.crop, rect: startRect(state.crop), drag: null, life, url: null };
    const mine = session;
    if (state.kind === "crop") {
      const href = hrefOf(nodeOf(model, unit));
      if (href !== null && href.startsWith("data:")) mine.url = href;
      else if (href !== null && ctx.options.images !== undefined) {
        void ctx.options.images.url(href, life).then((url) => {
          if (session !== mine || url === null) return;
          mine.url = url;
          draw();
        }, () => undefined);
      }
    }
    draw();
    announce("draw.crop.hint");
  };

  ctx.life.add(ctx.status.subscribe(draw));
  ctx.life.add(close);

  // I gesti, prima di quelli degli strumenti: sulla radice, in cattura.
  const onSurface = (event: Event): boolean => session !== null && event.target instanceof Node && ctx.surface.contains(event.target);
  const localOf = (event: PointerEvent | MouseEvent): Point | null => {
    const unit = unitNow();
    const inverse = unit === null ? null : invert(unit.matrix);
    return inverse === null ? null : apply(inverse, ctx.sceneAt(event.clientX, event.clientY));
  };
  const screenOf = (event: PointerEvent | MouseEvent): Point => {
    const box = ctx.surface.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  const swallow = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  ctx.life.listen(ctx.root, "pointerdown", (event: PointerEvent) => {
    if (!onSurface(event) || session === null) return;
    swallow(event);
    if (event.button !== 0) return;
    const unit = unitNow();
    const p = localOf(event);
    if (unit === null || p === null) return;
    const m = screenMatrix(unit);
    const handle = handleAt(session.rect, (q) => apply(m, q), screenOf(event));
    if (handle !== null) {
      const spot = handleSpot(session.rect, handle);
      session.drag = { kind: "handle", handle, from: session.rect, offset: [spot[0] - p[0], spot[1] - p[1]] };
    } else if (inside(session.rect, p)) {
      session.drag = { kind: "move", start: p, from: session.rect };
    } else return;
    ctx.surface.setPointerCapture?.(event.pointerId);
  }, { capture: true });

  ctx.life.listen(ctx.root, "pointermove", (event: PointerEvent) => {
    if (!onSurface(event) || session === null) return;
    swallow(event);
    const p = localOf(event);
    const unit = unitNow();
    if (p === null || unit === null) return;
    const drag = session.drag;
    if (drag === null) {
      const m = screenMatrix(unit);
      const handle = handleAt(session.rect, (q) => apply(m, q), screenOf(event));
      const cursor = handle !== null ? handleCursor(handle) : inside(session.rect, p) ? "move" : "";
      if (cursor === "") delete ctx.surface.dataset.ritaglio;
      else ctx.surface.dataset.ritaglio = cursor;
      return;
    }
    const box = session.crop.box;
    session.rect =
      drag.kind === "move"
        ? slidWithin(drag.from, box, [p[0] - drag.start[0], p[1] - drag.start[1]])
        : dragCrop({ box, rect: drag.from }, drag.handle, [p[0] + drag.offset[0], p[1] + drag.offset[1]], { ratio: event.shiftKey, centered: event.altKey, min: MIN_SIDE }).rect;
    draw();
  }, { capture: true });

  const up = (event: PointerEvent): void => {
    if (!onSurface(event) || session === null) return;
    swallow(event);
    session.drag = null;
  };
  ctx.life.listen(ctx.root, "pointerup", up, { capture: true });
  ctx.life.listen(ctx.root, "pointercancel", up, { capture: true });
  for (const name of ["click", "contextmenu"] as const) {
    ctx.life.listen(ctx.root, name, (event: MouseEvent) => {
      if (onSurface(event)) swallow(event);
    }, { capture: true });
  }
  ctx.life.listen(ctx.root, "dblclick", (event: MouseEvent) => {
    if (!onSurface(event)) return;
    swallow(event);
    applyCrop();
  }, { capture: true });
  ctx.life.listen(ctx.root, "keydown", (event: KeyboardEvent) => {
    if (session === null || event.isComposing || isWritingField(event.target)) return;
    if (event.key === "Enter") {
      swallow(event);
      applyCrop();
    } else if (event.key === "Escape") {
      swallow(event);
      cancelCrop();
    }
  }, { capture: true });
}
