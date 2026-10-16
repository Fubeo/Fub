// L'editor del disegno: il gesto dello strumento Sfumatura. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import type { InkPointerType } from "../../../../ink/dom/pen-input";
import type { Segment } from "../../scene/geometry";
import { translate, type Point } from "../../scene/matrix";
import { t, type DrawKey } from "../../strings";
import type { NodeShape, OverlayHandle } from "../../painter/overlay";
import {
  constrained,
  drawnPlace,
  movedStop,
  placeAngle,
  placeGrips,
  placeMapped,
  placeWith,
  sameLook,
  type GradientPlace,
  type GradientStop,
  type PlaceGrip,
} from "../gradients";
import { GRID_MAJOR, lineBeyond } from "../grid";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX, NUDGE, NUDGE_SHIFT } from "./constants";
import type { EditorContext } from "./context";
import { holdsPath, sign } from "./helpers";
import type { GradientGesture, GradientGrab, GradientRead, GradientSpot } from "./types";

/// Come si vedono i capi di una sfumatura sul foglio: il primo capo e il
/// centro tondi, l'altro capo e quello del raggio quadrati; il secondo
/// raggio e il fuoco, che si toccano meno, più piccoli, e il fuoco a rombo.
const GRIP_SHAPES: Readonly<Record<PlaceGrip, { readonly shape: NodeShape; readonly small: boolean }>> = {
  start: { shape: "circle", small: false },
  end: { shape: "square", small: false },
  center: { shape: "circle", small: false },
  a: { shape: "square", small: false },
  b: { shape: "square", small: true },
  focus: { shape: "diamond", small: true },
};

const GRIP_ACTIONS: Readonly<Record<PlaceGrip, DrawKey>> = {
  start: "draw.action.gradient_end",
  end: "draw.action.gradient_end",
  center: "draw.action.gradient_move",
  a: "draw.action.gradient_end",
  b: "draw.action.gradient_end",
  focus: "draw.action.gradient_focus",
};

/// Quanto lontano dalla riga dei punti, in pixel, un punto trascinato si
/// stacca e, lasciato, si toglie: quanto dalla barra del pannello.
const STOP_TEAR_PX = 32;

/// Di quanto si sposta un punto di una sfumatura con le frecce, e con
/// Maiusc.
const STOP_STEP = 0.01;

const STOP_STEP_SHIFT = 0.1;

/// Sotto quale coseno fra una freccia e la linea di una sfumatura la freccia
/// le va di traverso: oltre 67,5°, a metà fra due direzioni di 45°.
const STOP_ALONG = 0.38;

/// Il cerchio di raggio uno attorno all'origine, in quattro cubiche: il
/// bordo di una sfumatura radiale, portato dove sta dalla sua matrice.
const RING_K = 0.5522847498;

const UNIT_RING: readonly Segment[] = [
  { kind: "move", to: [1, 0] },
  { kind: "cubic", c1: [1, RING_K], c2: [RING_K, 1], to: [0, 1] },
  { kind: "cubic", c1: [-RING_K, 1], c2: [-1, RING_K], to: [-1, 0] },
  { kind: "cubic", c1: [-1, -RING_K], c2: [-RING_K, -1], to: [0, -1] },
  { kind: "cubic", c1: [RING_K, -1], c2: [1, -RING_K], to: [1, 0] },
  { kind: "close" },
];

/// Ciò che il gesto dello strumento Sfumatura dà agli altri pezzi dell'editor.
export interface GradientGestureContext {
  gradientStart: (g: GradientGesture, p: Point) => void;
  gradientUpdate: (g: GradientGesture) => void;
  gradientEnd: (g: GradientGesture, time: number) => void;
  gradientOverlay: () => OverlayHandle[];
  hoverGradient: (p: Point | null, pointer: InkPointerType) => void;
  gradientKeysOn: () => boolean;
  gradientEntries: (read: GradientRead) => GradientSpot[];
  visitGradient: (at: number) => boolean;
  walkGradient: (step: 1 | -1) => boolean;
  nudgeGradient: (x: number, y: number, direction: readonly [number, number], fine: boolean, big: boolean) => boolean;
  deleteGradientStop: () => void;
  insertGradientStop: () => void;
  unpickGradient: () => boolean;
  editGradient: () => void;
}

/// Monta il gesto dello strumento Sfumatura.
export function installGradientGesture(ctx: EditorContext): void {
  const {
    has, panel, currentIndex, announce, selectionSaid, stepNow, lengthText, lengthSpoken, selectedUnits, degreesText, showGrip, showHandles, clearPreviews,
    showPanel, syncProperties, previewGradient, select, frameBounds, cancelGesture, gridOn, guided, percentText, gradientNow, gradientPicked, pickGradient,
    rampOf, rampSpot, gripPoint, stopSpot, focusShown, spotPoint, gradientSpotAt, gradientSpotText, gradientFor, groupParts, sameLookParts, drawnKind,
    drawnStops, gripPivot, sameStops, gradientGuides, writeGradient, settleMovedStop, placeGradient, addGradientStop, removeGradientStop
  } = ctx;
  /// Il primo punto del gesto dello strumento Sfumatura: un capo, un punto o
  /// la linea di una sfumatura degli oggetti scelti; altrimenti il foglio, da
  /// cui se ne traccia una nuova, con l'oggetto sotto il puntatore per un
  /// tocco. Con Ctrl o ⌘ l'oggetto più dentro, come con la Selezione.
  const gradientStart = (g: GradientGesture, p: Point): void => {
    g.from = p;
    g.read = gradientNow();
    const spot = g.read === null ? null : gradientSpotAt(g.read, p, g.pointer, ctx.alt);
    if (spot !== null) {
      g.grab = spot;
      return;
    }
    const index = currentIndex();
    const tolerance = HIT_PX[g.pointer] / ctx.camera.scale;
    g.grab = { kind: "sheet", hit: ctx.free && has("selection") ? index.deepAt(p, tolerance) : index.at(p, tolerance) };
  };
  ctx.gradientStart = gradientStart;

  /// Il gesto `g` dello strumento Sfumatura col puntatore in `g.end`: oltre la
  /// soglia del trascinamento, ciò che ha preso lo segue, e il disegno lo
  /// mostra senza scriverlo. Dal foglio si traccia una sfumatura per tutti
  /// gli oggetti scelti, o senza selezione per quello da cui si parte. Le
  /// estremità vanno sulla griglia e sulle guide, finché Ctrl o ⌘ non è
  /// tenuto; con Maiusc la linea va di 45° in 45°.
  const gradientUpdate = (g: GradientGesture): void => {
    const { from, end, grab } = g;
    if (from === null || end === null || grab === null) return;
    if (!g.dragging) {
      if (Math.hypot(end[0] - from[0], end[1] - from[1]) * ctx.camera.scale <= DRAG_PX[g.pointer]) return;
      g.dragging = true;
      if (grab.kind === "sheet" && ctx.selection.length === 0 && grab.hit !== null) {
        select([grab.hit.key]);
        g.read = gradientNow();
      }
    }
    const read = g.read;
    if (read === null) return;
    g.snapped = null;
    const delta: Point = [end[0] - from[0], end[1] - from[1]];
    switch (grab.kind) {
      case "sheet": {
        const start = guided(from, () => gradientGuides(g), g.pointer);
        const to = ctx.shift ? constrained(start, end) : guided(end, () => gradientGuides(g), g.pointer);
        if (!ctx.shift) g.snapped = to;
        g.place = drawnPlace(drawnKind(read), start, to);
        g.change = g.place === null ? null : { place: g.place };
        g.only = null;
        break;
      }
      case "grip": {
        const group = read.groups[grab.group]!;
        const origin = gripPoint(group.place, grab.grip)!;
        const moved: Point = [origin[0] + delta[0], origin[1] + delta[1]];
        const pivot = gripPivot(group.place, grab.grip, origin);
        const to = ctx.shift && pivot !== null ? constrained(pivot, moved) : guided(moved, () => gradientGuides(g), g.pointer);
        if (!(ctx.shift && pivot !== null)) g.snapped = to;
        g.place = placeWith(group.place, grab.grip, to);
        g.change = { place: g.place };
        g.only = groupParts(group);
        break;
      }
      case "line": {
        const group = read.groups[grab.group]!;
        const [first] = rampOf(group.place);
        const moved: Point = [first[0] + delta[0], first[1] + delta[1]];
        const to = ctx.shift ? constrained(first, moved) : guided(moved, () => gradientGuides(g), g.pointer);
        if (!ctx.shift) g.snapped = to;
        g.place = placeMapped(group.place, translate(to[0] - first[0], to[1] - first[1]));
        g.change = { place: g.place };
        g.only = groupParts(group);
        break;
      }
      case "stop": {
        const group = read.groups[grab.group]!;
        const stops = group.look.stops;
        const was = rampSpot(group.place, from);
        const now = rampSpot(group.place, end);
        // Lontano dalla linea, sullo schermo, il punto si stacca: lasciato
        // lì, si toglie.
        if (stops.length > 2 && Math.abs(now.across - was.across) * ctx.camera.scale > STOP_TEAR_PX) {
          g.torn = { at: end, stop: stops[grab.index]! };
          g.stops = stops.filter((_, at) => at !== grab.index);
          g.stop = null;
        } else {
          g.torn = null;
          const moved = movedStop(stops, grab.index, stops[grab.index]!.offset + now.t - was.t);
          g.stops = moved.stops;
          g.stop = moved.index;
        }
        g.change = { stops: g.stops };
        g.only = sameLookParts(read, group.look);
        break;
      }
    }
    previewGradient(read.target, g.change, g.only);
    showHandles();
  };
  ctx.gradientUpdate = gradientUpdate;

  /// Il gesto dello strumento Sfumatura finisce. Un trascinamento scrive ciò
  /// che mostra; un tocco sceglie il capo o il punto che tocca, due su un
  /// punto portano al suo colore e due sulla linea aggiungono un punto lì.
  /// Un tocco sul foglio sceglie l'oggetto toccato, con Maiusc lo aggiunge o
  /// lo toglie, e sul vuoto lascia la selezione.
  const gradientEnd = (g: GradientGesture, time: number): void => {
    ctx.current = null;
    const { grab, read, from } = g;
    if (grab === null || from === null) {
      showHandles();
      return;
    }
    if (g.dragging) {
      gradientDrop(g, grab, read);
      return;
    }
    showHandles();
    if (grab.kind === "sheet") {
      const hit = grab.hit;
      if (hit !== null && ctx.shift) {
        select(ctx.selection.includes(hit.key) ? ctx.selection.filter((key) => key !== hit.key) : [...selectedUnits().filter((unit) => !holdsPath(unit.path, hit.path)).map((unit) => unit.key), hit.key]);
      } else if (hit !== null) {
        select([hit.key]);
      } else if (!ctx.shift && ctx.selection.length > 0) {
        select([]);
      }
      announce(ctx.selection.length === 0 ? gradientFor() : `${selectionSaid()} ${gradientFor()}`);
      return;
    }
    if (read === null) return;
    const tap = ctx.gradientTap;
    const index = grab.kind === "stop" ? grab.index : -1;
    const twice =
      grab.kind !== "grip" &&
      tap !== null &&
      tap.kind === grab.kind &&
      tap.group === grab.group &&
      tap.index === index &&
      time - tap.time <= DOUBLE_TAP_MS &&
      Math.hypot(tap.at[0] - from[0], tap.at[1] - from[1]) * ctx.camera.scale <= DOUBLE_TAP_PX[g.pointer];
    ctx.gradientTap = grab.kind === "grip" || twice ? null : { kind: grab.kind, group: grab.group, index, at: from, time };
    if (grab.kind === "line") {
      if (twice) addGradientStop(read, grab.group, grab.t);
      else announce(gradientSpotText(read, grab));
      return;
    }
    pickGradient(read, grab);
    if (twice && has("properties")) editGradient();
    else announce(gradientSpotText(read, grab));
  };
  ctx.gradientEnd = gradientEnd;

  /// Scrive ciò che il trascinamento `g` dello strumento Sfumatura mostra.
  const gradientDrop = (g: GradientGesture, grab: GradientGrab, read: GradientRead | null): void => {
    if (read === null) {
      clearPreviews();
      announce(gradientFor());
      return;
    }
    switch (grab.kind) {
      case "sheet": {
        const place = g.place;
        if (place === null) {
          clearPreviews();
          announce(t("draw.unchanged"));
          return;
        }
        if (!writeGradient(read.target, { place }, null, "draw.action.gradient_draw")) return;
        // Una sfumatura nuova non ha niente di scelto.
        ctx.gradientGrip = null;
        ctx.gradientStop = null;
        showHandles();
        syncProperties();
        const [a, b] = rampOf(place);
        const length = lengthSpoken(Math.hypot(b[0] - a[0], b[1] - a[1]));
        announce(
          place.kind === "linear"
            ? t("draw.gradient.drawn.linear", { angle: degreesText(placeAngle(place)), length })
            : t("draw.gradient.drawn.radial", { length }),
        );
        return;
      }
      case "grip":
      case "line":
        if (g.place === null) {
          clearPreviews();
          return;
        }
        placeGradient(read, grab.group, g.place, grab.kind === "grip" ? GRIP_ACTIONS[grab.grip] : "draw.action.gradient_move", grab.kind === "grip" ? grab.grip : null);
        return;
      case "stop": {
        const { look, place } = read.groups[grab.group]!;
        if (g.torn !== null) {
          clearPreviews();
          removeGradientStop(read, grab.group, grab.index);
          return;
        }
        if (g.stops === null || g.stop === null || sameStops(g.stops, look.stops)) {
          clearPreviews();
          pickGradient(read, grab);
          announce(gradientSpotText(read, grab));
          return;
        }
        if (!writeGradient(read.target, { stops: g.stops }, g.only, "draw.action.gradient_stop_move")) return;
        settleMovedStop(grab.group, place, g.stop);
        return;
      }
    }
  };

  /// La misura che il trascinamento `g` mostra accanto al puntatore: l'angolo
  /// della linea, la lunghezza del raggio, o dove sta il punto.
  const gradientDragText = (g: GradientGesture): string | null => {
    const grab = g.grab;
    if (grab === null || grab.kind === "line") return null;
    if (grab.kind === "stop") return g.torn !== null || g.stops === null || g.stop === null ? null : percentText(g.stops[g.stop]!.offset);
    const place = g.place;
    if (place === null || (grab.kind === "grip" && grab.grip !== "start" && grab.grip !== "end" && grab.grip !== "a")) return null;
    if (place.kind === "linear") return degreesText(placeAngle(place));
    return lengthText(Math.hypot(place.a[0] - place.center[0], place.a[1] - place.center[1]));
  };

  /// Le maniglie di una sfumatura che sta in `place` coi punti `stops`: il
  /// bordo tratteggiato di una radiale, la linea, i capi, col capo `grip`
  /// scelto, e i quadratini dei punti, col punto `stop` scelto.
  const gradientMarks = (place: GradientPlace, stops: readonly GradientStop[], grip: PlaceGrip | null, stop: number | null): OverlayHandle[] => {
    const out: OverlayHandle[] = [];
    if (place.kind === "radial") {
      const { center: c, a, b } = place;
      out.push({ kind: "outline", segments: UNIT_RING, matrix: [a[0] - c[0], a[1] - c[1], b[0] - c[0], b[1] - c[1], c[0], c[1]], dashed: true });
    }
    const [from, to] = rampOf(place);
    out.push({ kind: "ramp", from, to });
    for (const [each, p] of placeGrips(place)) {
      if (each === "focus" && !focusShown(place, grip === "focus")) continue;
      const { shape, small } = GRIP_SHAPES[each];
      out.push({ kind: "node", x: p[0], y: p[1], shape, selected: each === grip, ...(small ? { hint: true } : {}) });
    }
    stops.forEach((each, index) => {
      const { at, chip } = stopSpot(place, each.offset);
      out.push({ kind: "stop", x: chip[0], y: chip[1], at, color: each.color, opacity: each.opacity, selected: index === stop });
    });
    return out;
  };

  /// Le sfumature degli oggetti scelti, con lo strumento Sfumatura: per
  /// ognuna la linea coi capi e coi quadratini dei punti; di una radiale
  /// anche il bordo. Sopra sta quella di ciò che è scelto, e il punto scelto
  /// si vede in tutte quelle uguali, che cambiano con lui. Mentre si
  /// trascina, com'è nel gesto, con la misura accanto al puntatore; mentre
  /// se ne traccia una, quella sola.
  const gradientOverlay = (): OverlayHandle[] => {
    if (ctx.tool !== "gradient") return [];
    const g = ctx.current?.kind === "gradient" && ctx.current.dragging ? ctx.current : null;
    const read = g?.read ?? gradientNow();
    if (read === null) return [];
    const out: OverlayHandle[] = [];
    const grab = g?.grab ?? null;
    if (g !== null && grab?.kind === "sheet") {
      if (g.place !== null) out.push(...gradientMarks(g.place, drawnStops(read), null, null));
    } else {
      const picked = g === null ? gradientPicked(read) : null;
      const top = grab !== null && grab.kind !== "sheet" ? grab.group : (picked?.group ?? null);
      const order = read.groups.map((_, at) => at).filter((at) => at !== top);
      if (top !== null) order.push(top);
      const pickedStop = picked?.kind === "stop" ? { look: read.groups[picked.group]!.look, index: picked.index } : null;
      const dragged = grab?.kind === "stop" ? read.groups[grab.group]!.look : null;
      for (const at of order) {
        const group = read.groups[at]!;
        if (g !== null && dragged !== null && sameLook(group.look, dragged)) {
          out.push(...gradientMarks(group.place, g.stops ?? group.look.stops, null, g.stop));
          continue;
        }
        const moved = g !== null && (grab?.kind === "grip" || grab?.kind === "line") && grab.group === at && g.place !== null ? g.place : null;
        const grip = grab?.kind === "grip" && grab.group === at ? grab.grip : picked?.kind === "grip" && picked.group === at ? picked.grip : null;
        const stop = pickedStop !== null && sameLook(group.look, pickedStop.look) ? pickedStop.index : null;
        out.push(...gradientMarks(moved ?? group.place, group.look.stops, grip, stop));
      }
      const torn = g?.torn ?? null;
      if (torn !== null) out.push({ kind: "stop", x: torn.at[0], y: torn.at[1], at: torn.at, color: torn.stop.color, opacity: torn.stop.opacity, selected: true, torn: true });
    }
    const text = g === null ? null : gradientDragText(g);
    if (g !== null && text !== null && g.end !== null) out.push({ kind: "label", x: g.end[0], y: g.end[1], text });
    return out;
  };
  ctx.gradientOverlay = gradientOverlay;

  /// Il puntatore passa sopra `p` senza premere: con lo strumento Sfumatura,
  /// sopra un capo, un punto o la linea il cursore dice che li sposta.
  const hoverGradient = (p: Point | null, pointer: InkPointerType): void => {
    if (ctx.tool !== "gradient") return;
    const read = p === null ? null : gradientNow();
    showGrip(p !== null && read !== null && gradientSpotAt(read, p, pointer, ctx.alt) !== null ? "move" : null);
  };
  ctx.hoverGradient = hoverGradient;

  /// Vero se i tasti valgono per le sfumature sul foglio: lo strumento
  /// Sfumatura ne mostra, e la tastiera non sta premendo.
  const gradientKeysOn = (): boolean => ctx.pressed === null && (gradientNow()?.groups.length ?? 0) > 0;
  ctx.gradientKeysOn = gradientKeysOn;

  /// I capi e i punti delle sfumature sul foglio, nell'ordine della
  /// tastiera: sfumatura per sfumatura, prima i capi e poi i punti.
  const gradientEntries = (read: GradientRead): GradientSpot[] =>
    read.groups.flatMap((group, at): GradientSpot[] => [
      ...placeGrips(group.place).map(([grip]): GradientSpot => ({ kind: "grip", group: at, grip })),
      ...group.look.stops.map((_, index): GradientSpot => ({ kind: "stop", group: at, index })),
    ]);
  ctx.gradientEntries = gradientEntries;

  /// Se `a` e `b` sono lo stesso capo o lo stesso punto della stessa
  /// sfumatura.
  const sameSpot = (a: GradientSpot, b: GradientSpot): boolean =>
    a.group === b.group &&
    (a.kind === "grip" ? b.kind === "grip" && a.grip === b.grip : a.kind === "stop" && b.kind === "stop" && a.index === b.index);

  /// Sceglie il capo o il punto `at` delle sfumature sul foglio, in ordine,
  /// lo porta in vista e lo dice. `false` se non c'è.
  const visitGradient = (at: number): boolean => {
    const read = gradientNow();
    const entry = read === null ? undefined : gradientEntries(read)[at];
    if (read === null || entry === undefined) return false;
    cancelGesture();
    pickGradient(read, entry);
    const p = spotPoint(read, entry);
    frameBounds({ min: p, max: p });
    announce(gradientSpotText(read, entry));
    return true;
  };
  ctx.visitGradient = visitGradient;

  /// Tab con lo strumento Sfumatura: il capo o il punto dopo quello scelto, o
  /// con Maiusc prima, anche di un'altra sfumatura; senza, il primo o
  /// l'ultimo. Oltre le estremità, `false`.
  const walkGradient = (step: 1 | -1): boolean => {
    const read = gradientNow();
    if (read === null) return false;
    const entries = gradientEntries(read);
    const picked = gradientPicked(read);
    const at = picked === null ? -1 : entries.findIndex((entry) => sameSpot(entry, picked));
    return visitGradient(at < 0 ? (step > 0 ? 0 : entries.length - 1) : at + step);
  };
  ctx.walkGradient = walkGradient;

  /// Le frecce con lo strumento Sfumatura: muovono ciò che è scelto sul
  /// foglio. Un capo va come un nodo, di 1, di 10 con Maiusc, di un pixel
  /// dello schermo con Ctrl o ⌘, e con l'aggancio di riga in riga della
  /// griglia; un punto va lungo la linea, dell'1% o con Maiusc del 10%,
  /// verso dove punta la freccia, e di traverso alla linea → e ↑ lo portano
  /// avanti. Falso se non c'è niente di scelto.
  const nudgeGradient = (x: number, y: number, direction: readonly [number, number], fine: boolean, big: boolean): boolean => {
    const read = gradientNow();
    const picked = read === null ? null : gradientPicked(read);
    if (read === null || picked === null) return false;
    const group = read.groups[picked.group]!;
    if (picked.kind === "grip") {
      const p = gripPoint(group.place, picked.grip)!;
      let delta: Point;
      if (fine) {
        delta = [x / ctx.camera.scale, y / ctx.camera.scale];
      } else if (gridOn()) {
        const lines = big ? GRID_MAJOR : 1;
        delta = [x === 0 ? 0 : lineBeyond(p[0], stepNow(), sign(x), lines) - p[0], y === 0 ? 0 : lineBeyond(p[1], stepNow(), sign(y), lines) - p[1]];
      } else {
        const step = big ? NUDGE_SHIFT : NUDGE;
        delta = [x * step, y * step];
      }
      placeGradient(read, picked.group, placeWith(group.place, picked.grip, [p[0] + delta[0], p[1] + delta[1]]), GRIP_ACTIONS[picked.grip], picked.grip);
      return true;
    }
    if (picked.kind !== "stop") return false;
    const [from, to] = rampOf(group.place);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) * Math.hypot(x, y);
    const cos = length > 0 ? (x * dx + y * dy) / length : 0;
    const forward = Math.abs(cos) >= STOP_ALONG ? cos > 0 : direction[0] > 0 || direction[1] < 0;
    const step = big ? STOP_STEP_SHIFT : STOP_STEP;
    const stops = group.look.stops;
    const offset = Math.round((stops[picked.index]!.offset + (forward ? step : -step)) * 1e4) / 1e4;
    const moved = movedStop(stops, picked.index, offset);
    if (sameStops(moved.stops, stops)) {
      announce(gradientSpotText(read, picked));
      return true;
    }
    if (!writeGradient(read.target, { stops: moved.stops }, sameLookParts(read, group.look), "draw.action.gradient_stop_move")) return true;
    settleMovedStop(picked.group, group.place, moved.index);
    return true;
  };
  ctx.nudgeGradient = nudgeGradient;

  /// Il punto scelto sul foglio, e la sua sfumatura; `null` se ciò che è
  /// scelto non è un punto, e lo si dice.
  const pickedStop = (): { readonly read: GradientRead; readonly group: number; readonly index: number } | null => {
    const read = gradientNow();
    const picked = read === null ? null : gradientPicked(read);
    if (read === null || picked === null || picked.kind !== "stop") {
      announce(t("draw.gradient.no_stop"));
      return null;
    }
    return { read, group: picked.group, index: picked.index };
  };

  /// Canc con lo strumento Sfumatura: toglie il punto scelto, mai l'oggetto.
  const deleteGradientStop = (): void => {
    const chosen = pickedStop();
    if (chosen !== null) removeGradientStop(chosen.read, chosen.group, chosen.index);
  };
  ctx.deleteGradientStop = deleteGradientStop;

  /// Ins con lo strumento Sfumatura: un punto a metà fra quello scelto e il
  /// seguente, o il precedente se è l'ultimo, del colore che si vede lì.
  const insertGradientStop = (): void => {
    const chosen = pickedStop();
    if (chosen === null) return;
    const stops = chosen.read.groups[chosen.group]!.look.stops;
    const stop = stops[chosen.index]!;
    const next = stops[chosen.index + 1];
    const before = stops[chosen.index - 1];
    const at = next !== undefined ? (stop.offset + next.offset) / 2 : before !== undefined ? (before.offset + stop.offset) / 2 : stop.offset;
    addGradientStop(chosen.read, chosen.group, at);
  };
  ctx.insertGradientStop = insertGradientStop;

  /// Esc con lo strumento Sfumatura: lascia il capo o il punto scelto. Falso
  /// se non ce n'era uno.
  const unpickGradient = (): boolean => {
    const read = gradientNow();
    if (read === null || gradientPicked(read) === null) return false;
    ctx.gradientGrip = null;
    ctx.gradientStop = null;
    showHandles();
    syncProperties();
    announce(t("draw.gradient.unpicked"));
    return true;
  };
  ctx.unpickGradient = unpickGradient;

  /// Invio con lo strumento Sfumatura, o due tocchi su un punto: il pannello,
  /// al colore del punto scelto o alla sezione «Sfumatura».
  function editGradient(): void {
    showPanel(true, false);
    const read = gradientNow();
    if (read !== null && gradientPicked(read)?.kind === "stop" && panel.focusGradientColor()) return;
    if (!panel.focusSection("gradient")) panel.focus();
  }
  ctx.editGradient = editGradient;
}
