// L'editor del disegno: lo Spessore. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { resolvedLanguage } from "../../../../i18n/strings";
import { promptForm, type FormField } from "../../../../ui/form-dialog";
import type { InkPointerType } from "../../pen/pen-input";
import { widthsAt, type WidthPoint } from "../../scene/varwidth";
import { apply, invert, type Point } from "../../scene/matrix";
import { elementChildren, pathOf, type ElementPart, type LeafNode } from "../../scene/model";
import { pathData } from "../../scene/serialize";
import { t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import { nodeOf, Plan } from "../arrange";
import { strokeFill } from "../paths";
import { movedPoint, profileWidth, rightOf, SpineMeasure, widthOutline, withoutPoint, withPoint, withWidths, type WidthShape } from "../profile";
import { widthTarget, writeWidth, type NoWidth, type WidthTarget } from "../width";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX, NODE_PX } from "./constants";
import type { EditorContext } from "./context";
import { samePath, scaleOf } from "./helpers";
import type { WidthGesture, WidthGrab, WidthLine, WidthSide, WidthSpot } from "./types";

/// Perché un oggetto non ha nodi da modificare, a parole.
/// Perché una forma non cambia spessore, a parole.
const NO_WIDTH: Readonly<Record<NoWidth, DrawKey>> = {
  unstroked: "draw.width.unstroked",
  dashed: "draw.width.dashed",
  tipped: "draw.width.tipped",
  pieces: "draw.width.pieces",
  foreign: "draw.width.foreign",
  kind: "draw.width.kind",
};

/// Ciò che lo Spessore dà agli altri pezzi dell'editor.
export interface WidthToolContext {
  widthSpotAt: (p: Point, pointer: InkPointerType) => WidthSpot | DrawKey;
  pickedWidth: () => (WidthLine & { readonly point: number }) | null;
  widthSpotText: (found: WidthSpot) => string;
  hoverWidth: (p: Point | null, pointer: InkPointerType) => void;
  widthHandles: () => OverlayHandle[];
  widthStart: (g: WidthGesture, p: Point) => void;
  widthUpdate: (g: WidthGesture) => void;
  widthEnd: (g: WidthGesture, time: number) => void;
  percentText: (value: number) => string;
  widthKeysOn: () => boolean;
  deleteWidthPoint: () => void;
  widthDialog: () => Promise<void>;
}

/// Monta lo Spessore.
export function installWidthTool(ctx: EditorContext): void {
  const {
    has, painter, builder, editable, currentIndex, newIds, announce, lengthText, lengthSpoken, lengthField, fieldValue, selectedUnits, showHandles,
    clearPreviews, labelOf, cancelGesture
  } = ctx;
  // --- Lo Spessore -------------------------------------------------------------

  /// Quanto distano due punti.
  const apart = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /// Le linee dello Spessore delle forme, finché la forma è la stessa.
  const widthLines = new WeakMap<LeafNode, { readonly target: WidthTarget; readonly measure: SpineMeasure } | NoWidth>();

  /// La linea a spessore variabile di `leaf`, com'è o come la diventa il suo
  /// contorno, misurata; o perché non ne ha una.
  const widthLineOf = (leaf: LeafNode): { readonly target: WidthTarget; readonly measure: SpineMeasure } | NoWidth => {
    let found = widthLines.get(leaf);
    if (found === undefined) {
      const target = widthTarget(leaf);
      found = typeof target === "string" ? target : { target, measure: new SpineMeasure(target.shape.spine) };
      widthLines.set(leaf, found);
    }
    return found;
  };

  /// Il punto `index` del profilo di `shape`, nelle coordinate della forma:
  /// il centro sulla linea, il verso verso destra lì, e la fine dei due
  /// lati.
  const widthPoint = (shape: WidthShape, measure: SpineMeasure, index: number): { readonly at: Point; readonly normal: Point; readonly right: Point; readonly left: Point } => {
    const [u, left, right] = shape.profile[index]!;
    const { at, along } = measure.placeAt(u);
    const normal = rightOf(along);
    return { at, normal, right: [at[0] + normal[0] * right, at[1] + normal[1] * right], left: [at[0] - normal[0] * left, at[1] - normal[1] * left] };
  };

  /// Che cosa prende lo Spessore in `p`, un punto della scena, sulla linea
  /// `line`: il lato o il centro più vicino di un punto del profilo, entro
  /// `near`; altrimenti la linea, se `p` cade sul suo contorno o a meno di
  /// `reach` da lui. Un lato si prende più vicino a lui che al centro, e a
  /// pari distanza vince il lato, che allarga anche un punto largo zero; i
  /// capi non si spostano, e il loro centro è la linea.
  const widthGrabAt = (line: WidthLine, p: Point, near: number, reach: number): WidthGrab | null => {
    const { profile } = line.target.shape;
    const local = apply(line.inverse, p);
    const spot = line.measure.spotAt(local);
    // Da che parte della linea sta `p`, sullo schermo: a meno di un pixel
    // da lei, o oltre un capo nel suo verso, non lo dice ancora.
    const offset = (spot.along[0] * (local[1] - spot.at[1]) - spot.along[1] * (local[0] - spot.at[0])) * scaleOf(line.matrix) * ctx.camera.scale;
    const side: WidthSide = Math.abs(offset) < 1 ? 0 : offset > 0 ? 1 : -1;
    let best: WidthGrab | null = null;
    let nearest = near;
    for (let index = 0; index < profile.length; index++) {
      const point = widthPoint(line.target.shape, line.measure, index);
      const [, left, right] = profile[index]!;
      const centre = apart(apply(line.matrix, point.at), p);
      const sides: ReadonlyArray<readonly [1 | -1, Point]> = [[1, point.right], [-1, point.left]];
      for (const [which, end] of sides) {
        const gap = apart(apply(line.matrix, end), p);
        if (gap <= nearest && gap <= centre) {
          // I lati di un punto largo zero stanno sul centro.
          best = { kind: "side", index, side: left + right > 0 ? which : side };
          nearest = gap;
        }
      }
      if (index > 0 && index < profile.length - 1 && centre < nearest) {
        best = { kind: "point", index };
        nearest = centre;
      }
    }
    if (best !== null) return best;
    const [left, right] = widthsAt(profile, spot.u);
    const wide = (spot.side === 1 ? right : left) * scaleOf(line.matrix);
    return apart(apply(line.matrix, spot.at), p) <= wide + reach ? { kind: "line", u: spot.u, side } : null;
  };

  /// Dove lavora lo Spessore vicino a `p`, un punto della scena: sulla
  /// forma più in alto il cui contorno vi passa, o i cui punti vi stanno.
  /// Altrimenti perché no: la forma sotto non ha un contorno che cambia
  /// spessore, o lì non passa un contorno.
  const widthSpotAt = (p: Point, pointer: InkPointerType): WidthSpot | DrawKey => {
    const index = currentIndex();
    const near = NODE_PX[pointer] / ctx.camera.scale;
    const reach = HIT_PX[pointer] / ctx.camera.scale;
    const around = Math.max(near, reach);
    let refusal: DrawKey | null = null;
    for (let i = index.units.length - 1; i >= 0; i--) {
      const unit = index.units[i]!;
      if (!unit.hits(p, around)) continue;
      const shapes = unit.shapes();
      for (let k = shapes.length - 1; k >= 0; k--) {
        const { leaf, matrix } = shapes[k]!;
        const found = widthLineOf(leaf);
        const inverse = invert(matrix);
        if (typeof found === "string" || inverse === null) {
          if (unit.shapeAt(p, around) === leaf) refusal ??= typeof found === "string" ? NO_WIDTH[found] : "draw.nodes.flat";
          continue;
        }
        const line: WidthLine = { unit, leaf, ...found, matrix, inverse };
        const grab = widthGrabAt(line, p, near, reach);
        if (grab !== null) return { ...line, grab };
      }
    }
    return refusal ?? "draw.width.miss";
  };
  ctx.widthSpotAt = widthSpotAt;

  /// La linea del punto scelto dello Spessore, se c'è ancora nella scena di
  /// adesso, e l'indice del punto.
  const pickedWidth = (): (WidthLine & { readonly point: number }) | null => {
    const picked = ctx.widthPicked;
    const model = ctx.engine.model;
    if (picked === null || model === null || ctx.tool !== "width" || !has("width")) return null;
    let node: ElementPart | undefined = model.root;
    for (const step of picked.path) node = node?.kind === "container" ? elementChildren(node)[step] : undefined;
    if (node === undefined || node.kind !== "leaf") return null;
    const units = currentIndex().units;
    for (let at: ElementPart | null = node; at !== null; at = at.parent) {
      const unit = units.find((each) => each.node === at);
      const shape = unit?.shapes().find((each) => each.leaf === node);
      if (unit === undefined || shape === undefined) continue;
      const found = widthLineOf(shape.leaf);
      const inverse = invert(shape.matrix);
      if (typeof found === "string" || inverse === null || picked.point >= found.target.shape.profile.length) return null;
      return { unit, leaf: shape.leaf, ...found, matrix: shape.matrix, inverse, point: picked.point };
    }
    return null;
  };
  ctx.pickedWidth = pickedWidth;

  /// Le larghezze del punto `index` del profilo di `shape` sulla linea
  /// `line`, come si dicono: nella scena, nell'unità del documento.
  const widthWords = (line: WidthLine, shape: WidthShape, index: number): { readonly width: string; readonly left: string; readonly right: string } => {
    const k = scaleOf(line.matrix);
    const [, left, right] = shape.profile[index]!;
    return { width: lengthSpoken((left + right) * k), left: lengthSpoken(left * k), right: lengthSpoken(right * k) };
  };

  /// Il punto `index` della linea `line`, a parole.
  const widthPointText = (line: WidthLine, index: number): string =>
    t("draw.width.cursor.point", { index: index + 1, count: line.target.shape.profile.length, name: labelOf(line.unit), ...widthWords(line, line.target.shape, index) });

  /// Dove lavora lo Spessore, a parole: il punto, o il contorno e quanto è
  /// largo lì.
  const widthSpotText = (found: WidthSpot): string => {
    if (found.grab.kind !== "line") return widthPointText(found, found.grab.index);
    const [left, right] = widthsAt(found.target.shape.profile, found.grab.u);
    return t("draw.width.cursor.line", { name: labelOf(found.unit), width: lengthSpoken((left + right) * scaleOf(found.matrix)) });
  };
  ctx.widthSpotText = widthSpotText;

  /// Il puntatore, o il cursore della tastiera, passa sopra `p` senza
  /// premere: con lo Spessore si vedono la linea e i punti della forma
  /// sotto. Il dito non passa: tocca.
  const hoverWidth = (p: Point | null, pointer: InkPointerType): void => {
    let next: typeof ctx.widthHover = null;
    if (p !== null && pointer !== "touch" && ctx.tool === "width" && has("width") && editable()) {
      const found = widthSpotAt(p, pointer);
      if (typeof found !== "string") next = { index: currentIndex(), spot: found };
    }
    if (next === null && ctx.widthHover === null) return;
    ctx.widthHover = next;
    showHandles();
  };
  ctx.hoverWidth = hoverWidth;

  /// Lo Spessore: la linea della forma sotto il puntatore e di quella col
  /// punto scelto, sottile, coi punti del profilo e i loro lati; dove un
  /// trascinamento aggiungerebbe un punto, quel punto, tenue. Mentre lo si
  /// trascina, la linea come la lascia, e quanto è larga lì.
  const widthHandles = (): OverlayHandle[] => {
    if (ctx.tool !== "width" || !has("width")) return [];
    const out: OverlayHandle[] = [];
    const show = (line: WidthLine, shape: WidthShape, chosen: number, hint: boolean): void => {
      out.push({ kind: "outline", segments: shape.spine, matrix: line.matrix, hint });
      for (let index = 0; index < shape.profile.length; index++) {
        const point = widthPoint(shape, line.measure, index);
        const at = apply(line.matrix, point.at);
        for (const end of [point.right, point.left]) {
          const [x, y] = apply(line.matrix, end);
          out.push({ kind: "control", x, y, node: at });
        }
        out.push({ kind: "node", x: at[0], y: at[1], shape: "diamond", selected: index === chosen, hint });
      }
    };
    const g = ctx.current?.kind === "width" ? ctx.current : null;
    if (g !== null && g.dragging && typeof g.spot === "object" && g.spot !== null && g.shape !== null) {
      show(g.spot, g.shape, g.index, false);
      if (g.end !== null) out.push({ kind: "label", x: g.end[0], y: g.end[1], text: lengthText(profileWidthAt(g.shape, g.index) * scaleOf(g.spot.matrix)) });
      return out;
    }
    const picked = pickedWidth();
    if (picked !== null) show(picked, picked.target.shape, picked.point, false);
    const hovered = ctx.widthHover;
    if (hovered === null || hovered.index !== currentIndex()) return out;
    const { spot } = hovered;
    if (picked === null || picked.leaf !== spot.leaf) show(spot, spot.target.shape, -1, true);
    if (spot.grab.kind === "line") {
      const { at, along } = spot.measure.placeAt(spot.grab.u);
      const normal = rightOf(along);
      const [left, right] = widthsAt(spot.target.shape.profile, spot.grab.u);
      const centre = apply(spot.matrix, at);
      for (const end of [[at[0] + normal[0] * right, at[1] + normal[1] * right], [at[0] - normal[0] * left, at[1] - normal[1] * left]] as Point[]) {
        const [x, y] = apply(spot.matrix, end);
        out.push({ kind: "control", x, y, node: centre });
      }
      out.push({ kind: "node", x: centre[0], y: centre[1], shape: "circle", selected: false, hint: true });
    }
    return out;
  };
  ctx.widthHandles = widthHandles;

  /// La larghezza del punto `index` del profilo di `shape`, da un lato
  /// all'altro.
  const profileWidthAt = (shape: WidthShape, index: number): number => shape.profile[index]![1] + shape.profile[index]![2];

  /// Il primo punto del gesto dello Spessore: ciò che prende.
  const widthStart = (g: WidthGesture, p: Point): void => {
    g.from = p;
    g.spot = widthSpotAt(p, g.pointer);
  };
  ctx.widthStart = widthStart;

  /// Il gesto `g` dello Spessore col puntatore in `g.end`: oltre la soglia
  /// del trascinamento, il lato preso si allarga o si stringe di quanto il
  /// puntatore si è allontanato dalla linea o avvicinato, e senza Alt
  /// l'altro dello stesso tanto; un punto in mezzo preso al centro segue il
  /// puntatore lungo la linea. Chi è partito sulla linea tira la parte verso
  /// cui va.
  const widthUpdate = (g: WidthGesture): void => {
    const spot = g.spot;
    if (typeof spot !== "object" || spot === null || g.from === null || g.end === null) return;
    if (!g.dragging) {
      if (Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale <= DRAG_PX[g.pointer]) return;
      g.dragging = true;
    }
    const base = spot.target.shape;
    const p = apply(spot.inverse, g.end);
    const { grab } = spot;
    let profile: WidthPoint[];
    if (grab.kind === "point") {
      profile = movedPoint(base.profile, grab.index, spot.measure.spotAt(p).u);
      g.index = grab.index;
    } else {
      const added = grab.kind === "line" ? withPoint(base.profile, grab.u) : { profile: [...base.profile], index: grab.index };
      const { at, normal } = widthPoint({ ...base, profile: added.profile }, spot.measure, added.index);
      // Quanto il puntatore sta a destra della linea, nel verso del punto.
      const across = (q: Point): number => (q[0] - at[0]) * normal[0] + (q[1] - at[1]) * normal[1];
      if (g.side === 0) g.side = grab.side !== 0 ? grab.side : across(p) < 0 ? -1 : 1;
      const side = g.side;
      const delta = (across(p) - across(apply(spot.inverse, g.from))) * side;
      const [, left, right] = added.profile[added.index]!;
      const [pulled, other] = side === 1 ? [right + delta, ctx.alt ? left : left + delta] : [left + delta, ctx.alt ? right : right + delta];
      profile = side === 1 ? withWidths(added.profile, added.index, other, pulled) : withWidths(added.profile, added.index, pulled, other);
      g.index = added.index;
    }
    // Una linea senza nessuna larghezza non si scrive: resta l'ultima.
    if (profileWidth(profile) > 0) g.shape = { ...base, profile };
    showWidthDraft(g);
  };
  ctx.widthUpdate = widthUpdate;

  /// La linea del gesto `g` sul foglio, al posto di quella dipinta: una
  /// linea a spessore variabile col contorno nuovo, una forma senza il suo
  /// contorno e col contorno nuovo sopra.
  const showWidthDraft = (g: WidthGesture): void => {
    const spot = g.spot;
    if (typeof spot !== "object" || spot === null || g.shape === null) return;
    const outline = widthOutline(g.shape);
    if (typeof outline === "string" || outline.length === 0) painter.setDraft(null);
    else {
      const d = pathData(outline);
      const paints = builder.paintsOf(spot.leaf);
      const fill = spot.target.converts ? strokeFill(spot.leaf) : null;
      painter.setDraft(fill === null ? { paths: new Map(paints.map((paint) => [paint, d])) } : { strokes: new Map(paints.map((paint) => [paint, { d, ...fill }])) });
    }
    showHandles();
  };

  /// Il gesto dello Spessore finisce: un trascinamento scrive la linea, un
  /// tocco sceglie il punto che tocca, e due aprono le sue misure.
  const widthEnd = (g: WidthGesture, time: number): void => {
    ctx.current = null;
    const spot = g.spot;
    if (g.dragging) {
      if (typeof spot !== "object" || spot === null || g.shape === null) {
        clearPreviews();
        return;
      }
      const shape = g.shape;
      if (!writeWidthLine(spot, shape, g.index, spot.grab.kind === "point" ? "draw.action.width_move" : "draw.action.width")) return;
      if (spot.grab.kind === "point") announce(t("draw.width.moved", { percent: percentText(shape.profile[g.index]![0]) }));
      else announce(t("draw.width.changed", widthWords(spot, shape, g.index)));
      return;
    }
    showHandles();
    if (spot === null || g.from === null) return;
    if (typeof spot === "string") {
      announce(t(spot));
      return;
    }
    if (spot.grab.kind === "line") {
      if (ctx.widthPicked !== null) {
        ctx.widthPicked = null;
        showHandles();
      }
      announce(t("draw.width.tap"));
      return;
    }
    const point = spot.grab.index;
    const path = pathOf(spot.leaf);
    const tap = ctx.widthTap;
    const twice = tap !== null && samePath(tap.path, path) && tap.point === point && time - tap.time <= DOUBLE_TAP_MS &&
      Math.hypot(tap.at[0] - g.from[0], tap.at[1] - g.from[1]) * ctx.camera.scale <= DOUBLE_TAP_PX[g.pointer];
    ctx.widthPicked = { path, point };
    ctx.widthTap = twice ? null : { path, point, at: g.from, time };
    showHandles();
    if (twice) void widthDialog();
    else announcePickedWidth();
  };
  ctx.widthEnd = widthEnd;

  /// Dice il punto scelto dello Spessore, e che cosa ci si fa.
  const announcePickedWidth = (): void => {
    const picked = pickedWidth();
    if (picked === null) return;
    const count = picked.target.shape.profile.length;
    announce(t("draw.width.picked", { index: picked.point + 1, count, ...widthWords(picked, picked.target.shape, picked.point) }));
  };

  /// Una frazione come percentuale, nella lingua di adesso.
  const percentText = (value: number): string => new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 1 }).format(value);
  ctx.percentText = percentText;

  /// Scrive la linea `line` come `shape` in un passo di annulla, col punto
  /// `point` scelto dopo; la selezione resta la stessa. Vero se l'ha
  /// scritta.
  const writeWidthLine = (line: WidthLine, shape: WidthShape, point: number | null, label: DrawKey): boolean => {
    const model = ctx.engine.model;
    painter.setDraft(null);
    if (model === null) return false;
    const plan = new Plan(model, newIds());
    const path = writeWidth(plan, line.target, shape);
    if (path === null) {
      clearPreviews();
      announce(t("draw.width.unwritable"));
      return false;
    }
    const keys = selectedUnits().map((unit) => plan.keyOf(nodeOf(model, unit), unit.key));
    const before = ctx.widthPicked;
    ctx.widthPicked = point === null ? null : { path, point };
    if (ctx.arrange(label, plan.finish(keys)) === null) {
      ctx.widthPicked = before;
      showHandles();
      return false;
    }
    return true;
  };

  /// Vero se i tasti dello Spessore hanno un punto scelto su cui lavorare.
  const widthKeysOn = (): boolean => editable() && pickedWidth() !== null;
  ctx.widthKeysOn = widthKeysOn;

  /// Canc con lo Spessore: toglie il punto scelto. I capi restano, e anche
  /// l'ultima larghezza della linea.
  const deleteWidthPoint = (): void => {
    const picked = pickedWidth();
    if (picked === null) return;
    const { profile } = picked.target.shape;
    if (picked.point === 0 || picked.point === profile.length - 1) {
      announce(t("draw.width.ends"));
      return;
    }
    const left = withoutPoint(profile, picked.point);
    if (left === null) {
      announce(t("draw.width.last"));
      return;
    }
    if (writeWidthLine(picked, { ...picked.target.shape, profile: left }, null, "draw.action.width_remove")) announce(t("draw.width.removed"));
  };
  ctx.deleteWidthPoint = deleteWidthPoint;

  /// Le misure del punto scelto dello Spessore, come la finestra del punto
  /// di Illustrator: le larghezze ai due lati e, per un punto in mezzo, dove
  /// sta lungo la linea. Si apre con Invio o con un doppio tocco.
  async function widthDialog(): Promise<void> {
    const picked = pickedWidth();
    if (ctx.asking || picked === null || !editable()) return;
    cancelGesture();
    const opened = ctx.loads;
    const k = scaleOf(picked.matrix);
    const { profile } = picked.target.shape;
    const [u, left, right] = profile[picked.point]!;
    const inner = picked.point > 0 && picked.point < profile.length - 1;
    const fields: FormField[] = [
      lengthField("left", t("draw.width.left"), left * k, 0),
      lengthField("right", t("draw.width.right"), right * k, 0),
      ...(inner ? [{ id: "at", label: t("draw.width.at"), value: String(Math.round(u * 10000) / 100), kind: "number", min: 0, max: 100 } as const] : []),
    ];
    const shown = new Map(fields.map((field) => [field.id, field.value]));
    ctx.asking = true;
    let answer: Readonly<Record<string, string>> | null;
    try {
      answer = await promptForm({ title: t("draw.width.title"), message: t("draw.width.message"), okLabel: t("draw.width.ok"), fields });
    } finally {
      ctx.asking = false;
    }
    if (answer === null || ctx.disposed || ctx.loads !== opened) return;
    // Mentre la finestra era aperta il disegno può essere cambiato: vale il
    // punto scelto adesso, se c'è ancora. Un campo non toccato resta esatto,
    // e se nessuno è cambiato la forma resta com'è.
    const now = pickedWidth();
    if (now === null || !editable()) return;
    const typed = (id: string): string | null => {
      const text = answer[id];
      return text === undefined || text === shown.get(id) || !Number.isFinite(Number(text)) ? null : text;
    };
    if (["left", "right", "at"].every((id) => typed(id) === null)) {
      announce(t("draw.unchanged"));
      return;
    }
    const length = (id: string, unchanged: number): number => {
      const text = typed(id);
      return text === null ? unchanged : Math.max(0, fieldValue(text) / scaleOf(now.matrix));
    };
    const [, wasLeft, wasRight] = now.target.shape.profile[now.point]!;
    let next = withWidths(now.target.shape.profile, now.point, length("left", wasLeft), length("right", wasRight));
    const place = typed("at");
    if (inner && place !== null) next = movedPoint(next, now.point, Number(place) / 100);
    if (profileWidth(next) <= 0) {
      announce(t("draw.width.last"));
      return;
    }
    const shape = { ...now.target.shape, profile: next };
    if (writeWidthLine(now, shape, now.point, "draw.action.width")) announce(t("draw.width.changed", widthWords(now, shape, now.point)));
  }
  ctx.widthDialog = widthDialog;
}
