// L'editor del disegno: le sfumature sul foglio. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import type { InkPointerType } from "../../pen/pen-input";
import type { Point } from "../../scene/matrix";
import type { DocumentModel, ElementPart } from "../../scene/model";
import { t, type DrawKey } from "../../strings";
import {
  fadeOf,
  gradientHandles,
  gradientOps,
  paintedParts,
  placeGrips,
  pointAt as placePoint,
  sameLook,
  withStop,
  type GradientChange,
  type GradientHandles,
  type GradientKind,
  type GradientLook,
  type GradientPlace,
  type GradientStop,
  type PaintChannel,
  type PlaceGrip,
} from "../gradients";
import { GuideIndex } from "../guides";
import type { Unit } from "../hit";
import { swatchOf } from "../palette";
import { HIT_PX, NODE_PX } from "./constants";
import type { EditorContext } from "./context";
import type { GradientGesture, GradientRead, GradientSpot } from "./types";

/// I nomi dei capi di una sfumatura, e il nome nella cronologia di chi li
/// sposta: il centro sposta la sfumatura intera.
const GRIP_NAMES: Readonly<Record<PlaceGrip, DrawKey>> = {
  start: "draw.gradient.grip.start",
  end: "draw.gradient.grip.end",
  center: "draw.gradient.grip.center",
  a: "draw.gradient.grip.a",
  b: "draw.gradient.grip.b",
  focus: "draw.gradient.grip.focus",
};

/// Quanto pende dalla linea di una sfumatura, sullo schermo, il quadratino
/// di un punto, in pixel: a destra della linea nel suo verso, come sotto la
/// barra di Illustrator, così non copre mai i capi.
const STOP_HANG_PX = 16;

/// Ciò che le sfumature sul foglio dà agli altri pezzi dell'editor.
export interface GradientToolContext {
  gradientTarget: (model: DocumentModel, units: readonly Unit[]) => PaintChannel | null;
  gradientNow: () => GradientRead | null;
  gradientPicked: (read: GradientRead) => GradientSpot | null;
  pickGradient: (read: GradientRead, spot: GradientSpot) => void;
  rekeyGradient: (before: string) => void;
  rampOf: (place: GradientPlace) => readonly [Point, Point];
  rampSpot: (place: GradientPlace, p: Point) => { readonly t: number; readonly across: number };
  gripPoint: (place: GradientPlace, grip: PlaceGrip) => Point | null;
  stopSpot: (place: GradientPlace, t: number) => { readonly at: Point; readonly chip: Point };
  focusShown: (place: GradientPlace, chosen: boolean) => boolean;
  spotPoint: (read: GradientRead, spot: GradientSpot) => Point;
  gradientSpotAt: (read: GradientRead, p: Point, pointer: InkPointerType, focus: boolean) => GradientSpot | null;
  gradientSpotText: (read: GradientRead, spot: GradientSpot, cursor?: boolean) => string;
  gradientFor: () => string;
  groupParts: (group: GradientHandles) => ReadonlySet<ElementPart>;
  sameLookParts: (read: GradientRead, look: GradientLook) => ReadonlySet<ElementPart>;
  drawnKind: (read: GradientRead) => GradientKind;
  drawnStops: (read: GradientRead) => readonly GradientStop[];
  gripPivot: (place: GradientPlace, grip: PlaceGrip, origin: Point) => Point | null;
  sameStops: (a: readonly GradientStop[], b: readonly GradientStop[]) => boolean;
  gradientGuides: (g: GradientGesture) => GuideIndex;
  writeGradient: (target: PaintChannel, change: GradientChange, only: ReadonlySet<ElementPart> | null, label: DrawKey) => boolean;
  settleMovedStop: (group: number, place: GradientPlace, index: number) => void;
  placeGradient: (read: GradientRead, group: number, place: GradientPlace, label: DrawKey, grip: PlaceGrip | null) => void;
  addGradientStop: (read: GradientRead, group: number, at: number) => void;
  removeGradientStop: (read: GradientRead, group: number, index: number) => void;
}

/// Monta le sfumature sul foglio.
export function installGradientTool(ctx: EditorContext): void {
  const {
    has, measureText, panel, editable, currentIndex, newIds, announce, coordText, selectedUnits, showHandles, clearPreviews, syncProperties,
    changeFromPanel, previewGradient, guidesFor, percentText
  } = ctx;
  // --- Lo strumento Sfumatura ---------------------------------------------------

  /// L'altro colore: il contorno del riempimento, e viceversa.
  const otherChannel = (channel: PaintChannel): PaintChannel => (channel === "fill" ? "stroke" : "fill");

  /// Il colore degli oggetti scelti `units` che prende le sfumature: quello
  /// scelto in «Applica a», se lo mostrano, o l'altro; `null` se non ne
  /// mostrano nessuno. Lo stesso della sezione «Sfumatura».
  const gradientTarget = (model: DocumentModel, units: readonly Unit[]): PaintChannel | null => {
    const chosen = panel.colorTarget();
    for (const target of [chosen, otherChannel(chosen)]) if (paintedParts(model, units, target).length > 0) return target;
    return null;
  };
  ctx.gradientTarget = gradientTarget;

  /// Le sfumature degli oggetti scelti come le mostra lo strumento Sfumatura,
  /// lette una volta per la scena, la selezione, «Applica a» e lo zoom: due
  /// che sullo schermo stanno a meno di mezzo pixel sono una. `null` senza lo
  /// strumento, o senza oggetti scelti che mostrino un colore.
  const gradientNow = (): GradientRead | null => {
    const model = ctx.engine.model;
    if (ctx.tool !== "gradient" || !has("gradient") || !editable() || model === null || ctx.selection.length === 0) return null;
    const index = currentIndex();
    const keys = ctx.selection.join("\n");
    const chosen = panel.colorTarget();
    const cached = ctx.gradientCache;
    if (cached !== null && cached.index === index && cached.keys === keys && cached.chosen === chosen && cached.scale === ctx.camera.scale) return cached.read;
    const units = selectedUnits();
    let read: GradientRead | null = null;
    for (const target of [chosen, otherChannel(chosen)]) {
      const painted = paintedParts(model, units, target);
      if (painted.length === 0) continue;
      read = { target, painted, groups: gradientHandles(painted, 0.5 / ctx.camera.scale) };
      break;
    }
    ctx.gradientCache = { index, keys, chosen, scale: ctx.camera.scale, read };
    return read;
  };
  ctx.gradientNow = gradientNow;

  /// Il capo scelto sul foglio, se vale per `read`: per gli stessi oggetti e
  /// lo stesso colore, su una sfumatura che lo ha.
  const gripChosen = (read: GradientRead): { readonly group: number; readonly grip: PlaceGrip } | null => {
    const chosen = ctx.gradientGrip;
    if (chosen === null || chosen.keys !== ctx.selection.join("\n") || chosen.target !== read.target) return null;
    const group = read.groups[chosen.group];
    return group !== undefined && gripPoint(group.place, chosen.grip) !== null ? chosen : null;
  };

  /// Il punto scelto, se vale sul foglio per `read`.
  const stopChosen = (read: GradientRead): { readonly group: number; readonly index: number } | null => {
    const chosen = ctx.gradientStop;
    if (chosen === null || chosen.keys !== ctx.selection.join("\n") || chosen.target !== read.target) return null;
    const group = read.groups[chosen.group];
    return group !== undefined && chosen.index < group.look.stops.length ? chosen : null;
  };

  /// Ciò che è scelto sul foglio: il capo, o senza capo il punto.
  const gradientPicked = (read: GradientRead): GradientSpot | null => {
    const grip = gripChosen(read);
    if (grip !== null) return { kind: "grip", group: grip.group, grip: grip.grip };
    const stop = stopChosen(read);
    return stop === null ? null : { kind: "stop", group: stop.group, index: stop.index };
  };
  ctx.gradientPicked = gradientPicked;

  /// Sceglie sul foglio il capo o il punto `spot` delle sfumature `read`: il
  /// punto è anche quello del pannello, e lascia il capo.
  const pickGradient = (read: GradientRead, spot: GradientSpot): void => {
    const keys = ctx.selection.join("\n");
    if (spot.kind === "grip") {
      ctx.gradientGrip = { keys, target: read.target, group: spot.group, grip: spot.grip };
    } else if (spot.kind === "stop") {
      ctx.gradientGrip = null;
      ctx.gradientStop = { keys, target: read.target, index: spot.index, group: spot.group };
    }
    showHandles();
    syncProperties();
  };
  ctx.pickGradient = pickGradient;

  /// Dopo un cambio scritto, il punto e il capo scelti per gli oggetti di
  /// chiavi `before` restano scelti: gli oggetti possono aver preso un id, o
  /// un altro posto nel documento.
  function rekeyGradient(before: string): void {
    const keys = ctx.selection.join("\n");
    if (keys === before) return;
    if (ctx.gradientStop?.keys === before) ctx.gradientStop = { ...ctx.gradientStop, keys };
    if (ctx.gradientGrip?.keys === before) ctx.gradientGrip = { ...ctx.gradientGrip, keys };
    showHandles();
    syncProperties();
  }
  ctx.rekeyGradient = rekeyGradient;

  /// La linea di `place`: da un capo all'altro, o dal centro al capo del
  /// primo raggio.
  const rampOf = (place: GradientPlace): readonly [Point, Point] => (place.kind === "linear" ? [place.start, place.end] : [place.center, place.a]);
  ctx.rampOf = rampOf;

  /// Dove cade `p` lungo la linea di `place`: 0 al primo capo, 1 al secondo,
  /// oltre fuori; e quanto le sta a destra, nella scena.
  const rampSpot = (place: GradientPlace, p: Point): { readonly t: number; readonly across: number } => {
    const [from, to] = rampOf(place);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const squared = dx * dx + dy * dy;
    if (!(squared > 0)) return { t: 0, across: 0 };
    const px = p[0] - from[0];
    const py = p[1] - from[1];
    return { t: (px * dx + py * dy) / squared, across: (py * dx - px * dy) / Math.sqrt(squared) };
  };
  ctx.rampSpot = rampSpot;

  /// Dove sta il capo `grip` di `place`; `null` se `place` non lo ha.
  const gripPoint = (place: GradientPlace, grip: PlaceGrip): Point | null => placeGrips(place).find(([each]) => each === grip)?.[1] ?? null;
  ctx.gripPoint = gripPoint;

  /// Dove sta sulla linea di `place` il punto della sfumatura in `t`, e dove
  /// pende il suo quadratino: [`STOP_HANG_PX`] pixel alla destra della linea.
  const stopSpot = (place: GradientPlace, t: number): { readonly at: Point; readonly chip: Point } => {
    const [from, to] = rampOf(place);
    const at = placePoint(place, t);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    const hang = STOP_HANG_PX / ctx.camera.scale;
    const [nx, ny] = length > 0 ? [-dy / length, dx / length] : [0, 1];
    return { at, chip: [at[0] + nx * hang, at[1] + ny * hang] };
  };
  ctx.stopSpot = stopSpot;

  /// Vero se il fuoco di `place` si vede: lontano dal centro almeno un pixel,
  /// o scelto. Sul centro lo si prende con Alt.
  const focusShown = (place: GradientPlace, chosen: boolean): boolean =>
    place.kind === "radial" && (chosen || Math.hypot(place.focus[0] - place.center[0], place.focus[1] - place.center[1]) * ctx.camera.scale >= 1);
  ctx.focusShown = focusShown;

  /// Dove sta, sul foglio, ciò che lo strumento Sfumatura guarda in `spot`.
  const spotPoint = (read: GradientRead, spot: GradientSpot): Point => {
    const { place, look } = read.groups[spot.group]!;
    switch (spot.kind) {
      case "grip":
        return gripPoint(place, spot.grip)!;
      case "stop":
        return stopSpot(place, look.stops[spot.index]!.offset).chip;
      case "line":
        return placePoint(place, spot.t);
    }
  };
  ctx.spotPoint = spotPoint;

  /// Le sfumature di `read` dalla più in alto sul foglio: quella di ciò che è
  /// scelto, poi le altre dall'ultima.
  const gradientOrder = (read: GradientRead): number[] => {
    const top = gradientPicked(read)?.group ?? null;
    const out: number[] = [];
    for (let at = read.groups.length - 1; at >= 0; at--) if (at !== top) out.push(at);
    return top === null ? out : [top, ...out];
  };

  /// Ciò che lo strumento Sfumatura prende in `p` col puntatore `pointer`: il
  /// capo o il quadratino più vicino della sfumatura più in alto che ne ha
  /// uno a portata, o la linea. Con `focus`, sul centro di una radiale si
  /// prende il fuoco, che di solito gli sta sotto. `null` lontano da tutto.
  const gradientSpotAt = (read: GradientRead, p: Point, pointer: InkPointerType, focus: boolean): GradientSpot | null => {
    const order = gradientOrder(read);
    const picked = gripChosen(read);
    const reach = NODE_PX[pointer] / ctx.camera.scale;
    const away = (q: Point): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
    for (const group of order) {
      const { place, look } = read.groups[group]!;
      let best: GradientSpot | null = null;
      let near = Infinity;
      // A pari distanza un capo vince su quelli dopo, e il centro sul fuoco;
      // un quadratino su quelli prima, che gli stanno sotto.
      for (const [grip, at] of placeGrips(place)) {
        if (grip === "focus" && !focusShown(place, picked?.group === group && picked.grip === "focus")) continue;
        const d = away(at);
        if (d <= reach && d < near) {
          best = { kind: "grip", group, grip };
          near = d;
        }
      }
      for (let index = 0; index < look.stops.length; index++) {
        const d = away(stopSpot(place, look.stops[index]!.offset).chip);
        if (d <= reach && d <= near) {
          best = { kind: "stop", group, index };
          near = d;
        }
      }
      if (focus && place.kind === "radial" && best?.kind === "grip" && best.grip === "center" && away(place.focus) <= reach) return { kind: "grip", group, grip: "focus" };
      if (best !== null) return best;
    }
    const line = HIT_PX[pointer] / ctx.camera.scale;
    for (const group of order) {
      const { place } = read.groups[group]!;
      const t = Math.min(1, Math.max(0, rampSpot(place, p).t));
      if (away(placePoint(place, t)) <= line) return { kind: "line", group, t };
    }
    return null;
  };
  ctx.gradientSpotAt = gradientSpotAt;

  /// Il colore del punto `stop`, a parole, come lo dice il pannello: il nome
  /// della tavolozza o il codice, con l'opacità se non è piena.
  const stopColorText = (stop: GradientStop): string => {
    const swatch = swatchOf(stop.color);
    const color = swatch === null ? stop.color : t(swatch.label);
    return stop.opacity >= 1 ? color : t("draw.gradient.stop.alpha", { color, opacity: percentText(stop.opacity) });
  };

  /// `text`, e di quale sfumatura si parla, se sul foglio ce n'è più d'una.
  const ofGroup = (read: GradientRead, group: number, text: string): string =>
    read.groups.length < 2 ? text : `${text} ${t("draw.gradient.cursor.group", { index: group + 1, count: read.groups.length })}`;

  /// Ciò che lo strumento Sfumatura guarda in `spot`, a parole: un capo e
  /// dove sta, un punto col suo colore e dove sta, o la linea. Per il
  /// cursore, che dice già dove sta, il capo è soltanto il suo nome.
  const gradientSpotText = (read: GradientRead, spot: GradientSpot, cursor = false): string => {
    const { place, look } = read.groups[spot.group]!;
    switch (spot.kind) {
      case "grip": {
        const name = t(GRIP_NAMES[spot.grip]);
        if (cursor) return ofGroup(read, spot.group, `${name}.`);
        const p = gripPoint(place, spot.grip)!;
        return ofGroup(read, spot.group, t("draw.gradient.cursor.grip", { name, x: coordText(p[0]), y: coordText(p[1]) }));
      }
      case "stop": {
        const stop = look.stops[spot.index]!;
        const words = { index: spot.index + 1, count: look.stops.length, color: stopColorText(stop), at: percentText(stop.offset) };
        return ofGroup(read, spot.group, t("draw.gradient.cursor.stop", words));
      }
      case "line":
        return ofGroup(read, spot.group, t("draw.gradient.line", { at: percentText(spot.t) }));
    }
  };
  ctx.gradientSpotText = gradientSpotText;

  /// A che cosa va la sfumatura, a parole: al riempimento o al contorno degli
  /// oggetti scelti; o perché non va da nessuna parte.
  const gradientFor = (): string => {
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return t("draw.gradient.no_selection");
    const target = gradientTarget(model, units);
    if (target === null) return t(panel.colorTarget() === "fill" ? "draw.gradient.no_fill" : "draw.gradient.no_stroke");
    return t(target === "fill" ? "draw.gradient.for.fill" : "draw.gradient.for.stroke");
  };
  ctx.gradientFor = gradientFor;

  /// Le parti di `group`, a cui va un cambio di dove sta.
  const groupParts = (group: GradientHandles): ReadonlySet<ElementPart> => new Set(group.parts.map((part) => part.node));
  ctx.groupParts = groupParts;

  /// Le parti di `read` che mostrano la sfumatura `look`, ovunque stia: un
  /// cambio dei punti va a tutte, come dal pannello.
  const sameLookParts = (read: GradientRead, look: GradientLook): ReadonlySet<ElementPart> =>
    new Set(read.painted.filter((part) => part.gradient !== null && sameLook(part.gradient.look, look)).map((part) => part.node));
  ctx.sameLookParts = sameLookParts;

  /// Il tipo di una sfumatura tracciata sul foglio: radiale se lo sono tutte
  /// quelle degli oggetti scelti, altrimenti lineare.
  const drawnKind = (read: GradientRead): GradientKind => {
    const shaded = read.painted.filter((part) => part.gradient !== null);
    return shaded.length > 0 && shaded.every((part) => part.gradient!.look.kind === "radial") ? "radial" : "linear";
  };
  ctx.drawnKind = drawnKind;

  /// I punti di una sfumatura che si traccia, come li mostra il foglio:
  /// quelli della prima sfumatura degli oggetti scelti, o la dissolvenza del
  /// colore da cui nasce, come dal pannello.
  const drawnStops = (read: GradientRead): readonly GradientStop[] => {
    const shaded = read.painted.find((part) => part.gradient !== null);
    return shaded !== undefined ? shaded.gradient!.look.stops : fadeOf(read.painted[0]?.base ?? null);
  };
  ctx.drawnStops = drawnStops;

  /// Attorno a che cosa va, con Maiusc, il capo `grip` di `place` che stava
  /// in `origin`: un capo di una lineare attorno all'altro, il raggio attorno
  /// al centro, il centro attorno a dove stava. `null` per il secondo raggio
  /// e il fuoco, che vanno liberi.
  const gripPivot = (place: GradientPlace, grip: PlaceGrip, origin: Point): Point | null => {
    if (place.kind === "linear") return grip === "start" ? place.end : place.start;
    return grip === "a" ? place.center : grip === "center" ? origin : null;
  };
  ctx.gripPivot = gripPivot;

  /// Vero se `a` e `b` hanno i capi negli stessi punti.
  const samePlaced = (a: GradientPlace, b: GradientPlace): boolean => {
    const p = placeGrips(a);
    const q = placeGrips(b);
    return p.length === q.length && p.every(([, at], k) => at[0] === q[k]![1][0] && at[1] === q[k]![1][1]);
  };

  /// Vero se `a` e `b` sono gli stessi punti.
  const sameStops = (a: readonly GradientStop[], b: readonly GradientStop[]): boolean =>
    a.length === b.length && a.every((stop, k) => stop.offset === b[k]!.offset && stop.color === b[k]!.color && stop.opacity === b[k]!.opacity);
  ctx.sameStops = sameStops;

  /// La sfumatura di `read` che sta più vicina a `place`, dello stesso tipo:
  /// dopo un cambio scritto, quella che si è cambiata. `null` se non c'è.
  const groupNear = (read: GradientRead, place: GradientPlace): number | null => {
    const grips = placeGrips(place);
    let best: number | null = null;
    let near = Infinity;
    for (let at = 0; at < read.groups.length; at++) {
      const other = placeGrips(read.groups[at]!.place);
      if (other.length !== grips.length) continue;
      const d = grips.reduce((sum, [, p], k) => sum + Math.hypot(p[0] - other[k]![1][0], p[1] - other[k]![1][1]), 0);
      if (d < near) {
        best = at;
        near = d;
      }
    }
    return best;
  };

  /// Le guide del gesto `g` dello strumento Sfumatura: gli oggetti, la
  /// griglia e gli altri capi della sfumatura che si sposta, o il punto da
  /// cui se ne traccia una.
  const gradientGuides = (g: GradientGesture): GuideIndex =>
    guidesFor(g, [], () => {
      const grab = g.grab;
      if (grab?.kind === "sheet") return g.from === null ? [] : [g.from];
      if (grab?.kind !== "grip" || g.read === null) return [];
      return placeGrips(g.read.groups[grab.group]!.place)
        .filter(([grip]) => grip !== grab.grip)
        .map(([, p]) => p);
    });
  ctx.gradientGuides = gradientGuides;

  /// Scrive `change` per il colore `target` degli oggetti scelti, o delle
  /// sole parti `only`, col nome `label`; ciò che era scelto resta scelto.
  /// Vero se l'ha scritto; altrimenti dice perché no.
  const writeGradient = (target: PaintChannel, change: GradientChange, only: ReadonlySet<ElementPart> | null, label: DrawKey): boolean => {
    const model = ctx.engine.model;
    previewGradient(target, null);
    const units = selectedUnits();
    if (model === null || units.length === 0) return false;
    const changed = gradientOps(model, units, target, change, measureText, newIds(), only);
    if (changed.reached === 0) {
      showHandles();
      announce(t("draw.gradient.no_place"));
      return false;
    }
    const before = ctx.selection.join("\n");
    const failure = changeFromPanel(label, changed.ops, changed.keys);
    if (failure !== null) {
      showHandles();
      announce(failure);
      return false;
    }
    rekeyGradient(before);
    return true;
  };
  ctx.writeGradient = writeGradient;

  /// Dopo un cambio scritto, le sfumature di adesso e quella che sta più
  /// vicina a `place`, la sfumatura `group` di prima: ciò che vi era scelto
  /// passa a lei. `null` se non c'è più.
  const settleGradient = (group: number, place: GradientPlace): { readonly read: GradientRead; readonly group: number } | null => {
    const read = gradientNow();
    const found = read === null ? null : groupNear(read, place);
    if (read === null || found === null) return null;
    if (ctx.gradientGrip !== null && ctx.gradientGrip.group === group) ctx.gradientGrip = { ...ctx.gradientGrip, group: found };
    if (ctx.gradientStop !== null && ctx.gradientStop.group === group) ctx.gradientStop = { ...ctx.gradientStop, group: found };
    return { read, group: found };
  };

  /// Dopo un cambio dei punti scritto, il punto `index` della sfumatura
  /// `group`, che stava in `place`, diventa quello scelto: le sfumature di
  /// adesso, e dove sta. `null` se non c'è più.
  const settleStop = (group: number, place: GradientPlace, index: number): { readonly read: GradientRead; readonly spot: GradientSpot } | null => {
    const settled = settleGradient(group, place);
    if (settled === null) return null;
    const spot: GradientSpot = { kind: "stop", group: settled.group, index: Math.min(index, settled.read.groups[settled.group]!.look.stops.length - 1) };
    pickGradient(settled.read, spot);
    return { read: settled.read, spot };
  };

  /// Dopo un punto spostato e scritto, lo sceglie e lo dice.
  const settleMovedStop = (group: number, place: GradientPlace, index: number): void => {
    const settled = settleStop(group, place, index);
    if (settled !== null) announce(gradientSpotText(settled.read, settled.spot));
  };
  ctx.settleMovedStop = settleMovedStop;

  /// Porta in `place` la sfumatura `group` di `read`, col nome `label`; ciò
  /// che vi era scelto resta scelto, e con `grip` il capo che si è spostato,
  /// di cui si dice dove sta, anche se non si è potuto spostare.
  const placeGradient = (read: GradientRead, group: number, place: GradientPlace, label: DrawKey, grip: PlaceGrip | null): void => {
    const handles = read.groups[group]!;
    if (samePlaced(place, handles.place)) {
      clearPreviews();
      announce(grip === null ? t("draw.unchanged") : gradientSpotText(read, { kind: "grip", group, grip }));
      return;
    }
    if (!writeGradient(read.target, { place }, groupParts(handles), label)) return;
    const settled = settleGradient(group, place);
    if (settled === null) return;
    const spot: GradientSpot = { kind: "grip", group: settled.group, grip: grip ?? placeGrips(place)[0]![0] };
    if (grip !== null) pickGradient(settled.read, spot);
    announce(gradientSpotText(settled.read, spot));
  };
  ctx.placeGradient = placeGradient;

  /// Aggiunge alla sfumatura `group` di `read` un punto in `at`, del colore
  /// che si vede lì, e lo sceglie.
  const addGradientStop = (read: GradientRead, group: number, at: number): void => {
    const { look, place } = read.groups[group]!;
    const out = withStop(look.stops, at);
    if (!writeGradient(read.target, { stops: out.stops }, sameLookParts(read, look), "draw.action.gradient_stop_add")) return;
    settleStop(group, place, out.index);
    announce(t("draw.gradient.added", { index: out.index + 1, at: percentText(out.stops[out.index]!.offset) }));
  };
  ctx.addGradientStop = addGradientStop;

  /// Toglie dalla sfumatura `group` di `read` il punto `index`, se ne restano
  /// almeno due; il seguente diventa quello scelto, come nel pannello.
  const removeGradientStop = (read: GradientRead, group: number, index: number): void => {
    const { look, place } = read.groups[group]!;
    if (look.stops.length <= 2) {
      announce(t("draw.gradient.problem.last"));
      return;
    }
    const left = look.stops.filter((_, at) => at !== index);
    if (!writeGradient(read.target, { stops: left }, sameLookParts(read, look), "draw.action.gradient_stop_remove")) return;
    settleStop(group, place, Math.min(index, left.length - 1));
    announce(t("draw.gradient.removed", { index: index + 1 }));
  };
  ctx.removeGradientStop = removeGradientStop;
}
