// L'editor del disegno: la penna di Bézier. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { formatNumber } from "../../number";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { Matrix, Point } from "../../scene/matrix";
import { pathData, type Elem } from "../../scene/serialize";
import { t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import type { Destination } from "../edit";
import { GuideIndex } from "../guides";
import { writeNodes, type NodeKind } from "../nodes";
import { collapsed, penKind, penNode, penPath, type PenNode } from "../bezier";
import { curved, type CurveKind, type DraftNode } from "../curvature";
import { constrainEnd } from "../shapes";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, KIND_NAMES, NODE_PX, NODE_SHAPES } from "./constants";
import type { EditorContext } from "./context";
import type { BezierGesture, Drafting } from "./types";

/// Il tipo di un nodo della penna: quello che gli si è dato con la
/// Curvatura, o quello che dicono le sue maniglie.
function draftKind(node: DraftNode): NodeKind {
  return node.curve ?? penKind(node);
}

/// I nodi `nodes` col nodo `index` punto della Curvatura di tipo `kind`.
function withKind(nodes: readonly DraftNode[], index: number, kind: CurveKind): DraftNode[] {
  const next = nodes.slice();
  next[index] = { at: nodes[index]!.at, in: null, out: null, curve: kind };
  return next;
}

/// Il nodo `node` portato in `at`, con le sue maniglie.
function movedNode(node: DraftNode, at: Point): DraftNode {
  const dx = at[0] - node.at[0];
  const dy = at[1] - node.at[1];
  const by = (handle: Point | null): Point | null => (handle === null ? null : [handle[0] + dx, handle[1] + dy]);
  return { ...node, at, in: by(node.in), out: by(node.out) };
}

/// Ciò che la penna di Bézier dà agli altri pezzi dell'editor.
export interface BezierToolContext {
  drawing: () => Drafting | null;
  bezierTarget: (p: Point, pointer: InkPointerType, curve?: boolean) => "add" | "close" | "last" | "point";
  middlePoint: (p: Point, pointer: InkPointerType) => number;
  bezierPoint: (p: Point, pointer: InkPointerType) => Point;
  bezierHandle: (g: BezierGesture) => Point | null;
  curveGuides: (g: BezierGesture) => GuideIndex;
  curveMoved: (g: BezierGesture) => Point;
  bezierElem: (id: string, nodes: readonly DraftNode[], closed: boolean, to: Destination) => Elem | null;
  bezierHandles: () => OverlayHandle[];
  showBezier: () => void;
  bezierNodeText: (nodes: readonly DraftNode[], at: number) => string;
  bezierStart: (g: BezierGesture, p: Point) => void;
  bezierUpdate: (g: BezierGesture) => void;
  bezierStep: (draft: Drafting, nodes: readonly PenNode[], label: DrawKey, index: number) => void;
  bezierEnd: (g: BezierGesture, time: number) => void;
  curveKindKey: (kind: CurveKind) => void;
}

/// Monta la penna di Bézier.
export function installBezierTool(ctx: EditorContext): void {
  const {
    style, announce, coordText, showHandles, showShape, syncControls, drawnPaint, guidesFor, guided, noNodes, bezierGuides, snapNote, noted
  } = ctx;
  // --- La penna di Bézier ------------------------------------------------------
  //
  // Il tracciato si disegna in più gesti, e vive fra un gesto e l'altro: un
  // tocco mette uno spigolo, un trascinamento un nodo simmetrico, un tocco
  // sul primo nodo chiude il tracciato, uno sull'ultimo lo conclude. Si
  // scrive quando si conclude, in un passo solo; fino ad allora Annulla e
  // Ripeti percorrono i suoi passi.
  //
  // Con la Curvatura un tocco posa un punto liscio, e la curva passa morbida
  // per tutti; con Alt, o col doppio tocco, uno spigolo. Un trascinamento
  // sposta il punto che prende, un tocco su un punto in mezzo lo fa passare
  // da liscio a spigolo e ritorno. Le maniglie non si vedono: vengono dai
  // punti (`curvature.ts`).

  /// Il tracciato della penna, se ha almeno un nodo.
  const drawing = (): Drafting | null => (ctx.drafting !== null && ctx.drafting.nodes.length > 0 ? ctx.drafting : null);
  ctx.drawing = drawing;

  /// Vero se `p` prende il nodo in `node` col puntatore `pointer`.
  const onNode = (p: Point, node: Point, pointer: InkPointerType): boolean =>
    Math.hypot(p[0] - node[0], p[1] - node[1]) * ctx.camera.scale <= NODE_PX[pointer];

  /// Che cosa prende un tocco in `p`: il primo nodo, che chiude il
  /// tracciato, l'ultimo, o il vuoto, dove va un nodo nuovo. Fra il primo e
  /// l'ultimo, vicini, vince il più vicino; a pari distanza l'ultimo, così
  /// un nodo solo, che è l'uno e l'altro, non si chiude. Con la Curvatura,
  /// `curve`, anche un punto in mezzo ([`middlePoint`]).
  const bezierTarget = (p: Point, pointer: InkPointerType, curve = ctx.curvature): "add" | "close" | "last" | "point" => {
    const nodes = ctx.drafting?.nodes ?? [];
    const last = nodes[nodes.length - 1];
    if (last === undefined) return "add";
    const first = nodes[0]!;
    const closes = onNode(p, first.at, pointer);
    const ends = onNode(p, last.at, pointer);
    if (closes && ends) return Math.hypot(p[0] - first.at[0], p[1] - first.at[1]) < Math.hypot(p[0] - last.at[0], p[1] - last.at[1]) ? "close" : "last";
    if (closes || ends) return closes ? "close" : "last";
    return curve && middlePoint(p, pointer) >= 0 ? "point" : "add";
  };
  ctx.bezierTarget = bezierTarget;

  /// Il nodo in mezzo al tracciato della penna, né il primo né l'ultimo,
  /// che il puntatore `pointer` prende in `p`: il più vicino; -1 se nessuno.
  const middlePoint = (p: Point, pointer: InkPointerType): number => {
    const nodes = ctx.drafting?.nodes ?? [];
    let best = -1;
    let near = Infinity;
    for (let i = 1; i < nodes.length - 1; i++) {
      const at = nodes[i]!.at;
      const apart = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (apart < near && onNode(p, at, pointer)) {
        best = i;
        near = apart;
      }
    }
    return best;
  };
  ctx.middlePoint = middlePoint;

  /// Il nodo che un gesto della penna prende col bersaglio `mode` in `p`.
  const targetIndex = (mode: "add" | "close" | "last" | "point", p: Point, pointer: InkPointerType): number => {
    const nodes = ctx.drafting?.nodes ?? [];
    return mode === "close" ? 0 : mode === "last" ? nodes.length - 1 : mode === "point" ? middlePoint(p, pointer) : -1;
  };

  /// Dove va un nodo nuovo puntato in `p` col puntatore `pointer`:
  /// sull'incrocio della griglia o in linea con gli oggetti e coi nodi già
  /// posati, e con Maiusc a passi di 15° dall'ultimo nodo, come una linea.
  const bezierPoint = (p: Point, pointer: InkPointerType): Point => {
    const point = guided(p, bezierGuides, pointer);
    const nodes = ctx.drafting?.nodes ?? [];
    const last = nodes[nodes.length - 1];
    return ctx.shift && last !== undefined ? constrainEnd("line", last.at, point) : point;
  };
  ctx.bezierPoint = bezierPoint;

  /// La maniglia che il trascinamento di `g` tira dal suo nodo: sulla
  /// griglia o in linea con gli oggetti e coi nodi, e con Maiusc a passi di
  /// 15°. `null` per un tocco, o se torna sul nodo, e con la Curvatura, che
  /// non tira maniglie.
  const bezierHandle = (g: BezierGesture): Point | null => {
    if (g.curve || !g.dragging || g.at === null || g.end === null) return null;
    const point = guided(g.end, bezierGuides, g.pointer);
    const handle = ctx.shift ? constrainEnd("line", g.at, point) : point;
    return Math.hypot(handle[0] - g.at[0], handle[1] - g.at[1]) * ctx.camera.scale <= DRAG_PX[g.pointer] ? null : handle;
  };
  ctx.bezierHandle = bezierHandle;

  /// I bersagli della Curvatura mentre `g` sposta un punto: gli oggetti e
  /// gli altri punti.
  const curveGuides = (g: BezierGesture): GuideIndex => {
    const nodes = ctx.drafting?.nodes ?? noNodes;
    return guidesFor(g, [], () => nodes.filter((_, i) => i !== g.index).map((node) => node.at));
  };
  ctx.curveGuides = curveGuides;

  /// Dove il trascinamento della Curvatura `g` porta il punto che prende:
  /// quello nuovo dove va il puntatore, come un tocco; uno che c'è già di
  /// quanto si è mosso il puntatore, sulla griglia o in linea con gli
  /// oggetti e con gli altri punti.
  const curveMoved = (g: BezierGesture): Point => {
    if (g.mode === "add") return bezierPoint(g.end!, g.pointer);
    const p: Point = [g.at![0] + g.end![0] - g.from![0], g.at![1] + g.end![1] - g.from![1]];
    return guided(p, () => curveGuides(g), g.pointer);
  };
  ctx.curveMoved = curveMoved;

  /// Il gesto della penna che cambia il suo tracciato: non uno della
  /// Curvatura su una forma scelta.
  const penGesture = (): BezierGesture | null => (ctx.current?.kind === "bezier" && ctx.current.mode !== null && ctx.current.mode !== "path" ? ctx.current : null);

  /// I nodi come li lascia il gesto `g`, e se il tracciato si chiude.
  const bezierAfter = (g: BezierGesture): { readonly nodes: readonly DraftNode[]; readonly closed: boolean } => {
    const nodes = (ctx.drafting?.nodes ?? []).slice();
    if (g.curve) {
      // La Curvatura posa un punto, liscio o con Alt uno spigolo, o sposta
      // quello che prende; un tocco sul primo chiude.
      const moved = g.dragging ? curveMoved(g) : null;
      if (g.mode === "add") nodes.push({ at: moved ?? g.at!, in: null, out: null, curve: ctx.alt ? "corner" : "smooth" });
      else if (moved !== null) nodes[g.index] = movedNode(nodes[g.index]!, moved);
      return { nodes, closed: g.mode === "close" && !g.dragging };
    }
    const handle = bezierHandle(g);
    if (g.mode === "add") nodes.push(penNode(g.at!, handle));
    // Trascinato, il primo nodo diventa simmetrico: il tracciato vi passa
    // senza spigolo. L'ultimo cambia solo la maniglia verso il nodo dopo.
    else if (g.mode === "close" && handle !== null) nodes[0] = penNode(nodes[0]!.at, handle);
    else if (g.mode === "last" && g.dragging) nodes[nodes.length - 1] = { ...nodes[nodes.length - 1]!, out: handle };
    return { nodes, closed: g.mode === "close" };
  };

  /// Il tracciato dei nodi `nodes` come lo scrive la penna, coi punti della
  /// Curvatura risolti in maniglie, nelle coordinate del livello `to`, col
  /// colore e lo spessore di adesso. `null` se si scriverebbe in un punto.
  const bezierElem = (id: string, nodes: readonly DraftNode[], closed: boolean, to: Destination): Elem | null => {
    const sub = penPath(curved(nodes, closed), closed, to.inverse);
    if (collapsed(sub)) return null;
    const { color, width } = style();
    return {
      tag: "path",
      attrs: {
        id,
        d: pathData(writeNodes([sub])),
        fill: "none",
        stroke: drawnPaint(color),
        "stroke-width": formatNumber(width, 2),
        // Un tracciato chiuso non ha capi.
        ...(closed ? {} : { "stroke-linecap": "round" }),
        "stroke-linejoin": "round",
      },
    };
  };
  ctx.bezierElem = bezierElem;

  /// Sopra il tracciato della penna: il segmento che verrebbe dove punta il
  /// puntatore, le maniglie del nodo che il gesto tiene o dell'ultimo, e i
  /// nodi, pieno quello che il gesto tiene o che un tocco prenderebbe. Con
  /// la Curvatura, al posto del segmento, i due che il punto nuovo farebbe,
  /// o i tre attorno alla chiusura, e niente maniglie.
  const bezierHandles = (): OverlayHandle[] => {
    const g = penGesture();
    const nodes = g === null ? ctx.drafting?.nodes ?? [] : bezierAfter(g).nodes;
    const last = nodes[nodes.length - 1];
    if (last === undefined) return [];
    const curve = g?.curve ?? ctx.curvature;
    const out: OverlayHandle[] = [];
    const aim = g === null && ctx.hover !== null ? bezierTarget(ctx.hover.at, ctx.hover.pointer) : null;
    const identity: Matrix = [1, 0, 0, 1, 0, 0];
    if ((aim === "add" || aim === "close") && curve) {
      const next = aim === "close" ? nodes : [...nodes, { at: bezierPoint(ctx.hover!.at, ctx.hover!.pointer), in: null, out: null, curve: ctx.alt ? "corner" : "smooth" } satisfies DraftNode];
      const all = curved(next, aim === "close");
      const n = all.length;
      const part = aim === "add" ? all.slice(-3) : n <= 3 ? [...all, all[0]!] : [all[n - 2]!, all[n - 1]!, all[0]!, all[1]!];
      out.push({ kind: "outline", segments: writeNodes([penPath(part, false, identity)]), matrix: identity });
    } else if (aim === "add" || aim === "close") {
      const next = aim === "close" ? nodes[0]! : penNode(bezierPoint(ctx.hover!.at, ctx.hover!.pointer), null);
      out.push({ kind: "outline", segments: writeNodes([penPath([last, next], false, identity)]), matrix: identity });
    }
    const held = g !== null ? (g.mode === "add" ? nodes.length - 1 : g.index) : nodes.length - 1;
    const node = nodes[held]!;
    if (!curve) for (const handle of [node.in, node.out]) if (handle !== null) out.push({ kind: "control", x: handle[0], y: handle[1], node: node.at });
    const hot = g !== null ? held : aim === null || aim === "add" ? -1 : targetIndex(aim, ctx.hover!.at, ctx.hover!.pointer);
    nodes.forEach((each, i) => out.push({ kind: "node", x: each.at[0], y: each.at[1], shape: NODE_SHAPES[draftKind(each)], selected: i === hot }));
    return out;
  };
  ctx.bezierHandles = bezierHandles;

  /// Il tracciato della penna come si scriverà, col gesto che lo cambia, e
  /// sopra i suoi nodi.
  function showBezier(): void {
    const g = penGesture();
    const to = g?.to ?? ctx.drafting?.to ?? null;
    const { nodes, closed } = g === null ? { nodes: ctx.drafting?.nodes ?? [], closed: false } : bezierAfter(g);
    const elem = to === null ? null : bezierElem("preview", nodes, closed, to);
    showShape(elem, to?.matrix ?? [1, 0, 0, 1, 0, 0]);
    showHandles();
  }
  ctx.showBezier = showBezier;

  /// Il nodo `at` del tracciato della penna a parole: quale, di che tipo e
  /// dove.
  const bezierNodeText = (nodes: readonly DraftNode[], at: number): string => {
    const node = nodes[at]!;
    return t("draw.bezier.node", { index: at + 1, kind: t(KIND_NAMES[draftKind(node)]), x: coordText(node.at[0]), y: coordText(node.at[1]) });
  };
  ctx.bezierNodeText = bezierNodeText;

  /// Il primo punto di un gesto della penna: che cosa prende, e il nodo.
  const bezierStart = (g: BezierGesture, p: Point): void => {
    g.from = p;
    ctx.hover = null;
    // La Curvatura, senza un tracciato in corso, prende prima le forme
    // scelte.
    g.path = g.curve && ctx.drafting === null ? ctx.curveGrab(p, g.pointer) : null;
    if (g.path !== null) {
      g.mode = "path";
      return;
    }
    g.mode = bezierTarget(p, g.pointer, g.curve);
    g.index = targetIndex(g.mode, p, g.pointer);
    g.at = g.mode === "add" ? bezierPoint(p, g.pointer) : (ctx.drafting?.nodes ?? [])[g.index]!.at;
    ctx.hover = null;
  };
  ctx.bezierStart = bezierStart;

  const bezierUpdate = (g: BezierGesture): void => {
    if (g.from === null || g.end === null) return;
    if (!g.dragging && Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
    if (g.mode === "path") ctx.curvePathUpdate(g);
    else showBezier();
  };
  ctx.bezierUpdate = bezierUpdate;

  /// Un passo del tracciato della penna: i nodi diventano `nodes`, e
  /// Ripeti non ha più niente da rimettere.
  const bezierStep = (draft: Drafting, nodes: readonly PenNode[], label: DrawKey, index: number): void => {
    draft.done.push({ nodes: draft.nodes, label, index });
    draft.undone.length = 0;
    draft.nodes = nodes;
  };
  ctx.bezierStep = bezierStep;

  /// La fine di un gesto della penna, alzato al tempo `time`: il nodo entra
  /// nel tracciato, o il tracciato si chiude o si conclude.
  const bezierEnd = (g: BezierGesture, time: number): void => {
    const note = snapNote();
    ctx.current = null;
    if (g.mode === null) return;
    if (g.mode === "path") {
      ctx.curvePathEnd(g, time, note);
      return;
    }
    if (g.curve) {
      curveEnd(g, time, note);
      return;
    }
    if (g.mode === "last" && !g.dragging) {
      ctx.finishBezier(false);
      return;
    }
    const { nodes, closed } = bezierAfter(g);
    if (closed) {
      ctx.drafting!.nodes = nodes;
      ctx.finishBezier(true);
      return;
    }
    const draft = ctx.drafting ?? { nodes: [], done: [], undone: [], to: g.to };
    bezierStep(draft, nodes, g.mode === "add" ? "draw.bezier.step.node" : "draw.bezier.step.handle", nodes.length);
    draft.to = g.to;
    ctx.drafting = draft;
    showBezier();
    syncControls();
    announce(noted(bezierNodeText(nodes, nodes.length - 1), note));
  };
  ctx.bezierEnd = bezierEnd;

  /// La fine di un gesto della Curvatura, con la nota `note` di ciò a cui si
  /// è agganciato: il punto entra nel tracciato o si sposta; un tocco
  /// sull'ultimo conclude il tracciato, e sul primo lo chiude, ma subito
  /// dopo averlo posato, nello stesso posto, ne fa uno spigolo; un tocco su
  /// un punto in mezzo lo fa passare da liscio a spigolo e ritorno.
  const curveEnd = (g: BezierGesture, time: number, note: string): void => {
    const tap = ctx.curveTap;
    ctx.curveTap = null;
    if (!g.dragging && g.mode === "last") {
      const draft = drawing()!;
      const twice = tap !== null && tap.index === g.index && time - tap.time <= DOUBLE_TAP_MS &&
        Math.hypot(tap.at[0] - g.from![0], tap.at[1] - g.from![1]) * ctx.camera.scale <= DOUBLE_TAP_PX[g.pointer];
      if (!twice) {
        ctx.finishBezier(false);
        return;
      }
      // Il doppio tocco posa uno spigolo in un passo solo: Annulla toglie il
      // punto, non solo il suo tipo.
      draft.nodes = withKind(draft.nodes, g.index, draftKind(draft.nodes[g.index]!) === "corner" ? "smooth" : "corner");
      showBezier();
      announce(bezierNodeText(draft.nodes, g.index));
      return;
    }
    if (!g.dragging && g.mode === "point") {
      const draft = drawing()!;
      setDraftKind(draft, g.index, draftKind(draft.nodes[g.index]!) === "corner" ? "smooth" : "corner");
      return;
    }
    const { nodes, closed } = bezierAfter(g);
    if (closed) {
      ctx.drafting!.nodes = nodes;
      ctx.finishBezier(true);
      return;
    }
    const draft = ctx.drafting ?? { nodes: [], done: [], undone: [], to: g.to };
    const index = g.mode === "add" ? nodes.length - 1 : g.index;
    bezierStep(draft, nodes, g.mode === "add" ? "draw.bezier.step.node" : "draw.bezier.step.move", index + 1);
    draft.to = g.to;
    ctx.drafting = draft;
    if (g.mode === "add" && !g.dragging) ctx.curveTap = { index, at: g.from!, time };
    showBezier();
    syncControls();
    announce(noted(bezierNodeText(nodes, index), note));
  };

  /// Il nodo `index` del tracciato della penna diventa un punto della
  /// Curvatura di tipo `kind`, in un passo che si annulla.
  const setDraftKind = (draft: Drafting, index: number, kind: CurveKind): void => {
    bezierStep(draft, withKind(draft.nodes, index, kind), "draw.bezier.step.kind", index + 1);
    showBezier();
    syncControls();
    announce(bezierNodeText(draft.nodes, index));
  };

  /// Maiusc+C e Maiusc+S con la Curvatura: il punto sotto il cursore, o
  /// l'ultimo, diventa uno spigolo o liscio.
  const curveKindKey = (kind: CurveKind): void => {
    const draft = drawing();
    if (draft === null) return;
    const p = ctx.cursorPoint();
    const aim = bezierTarget(p, "mouse", true);
    const index = aim === "add" ? draft.nodes.length - 1 : targetIndex(aim, p, "mouse");
    ctx.curveTap = null;
    if (draft.nodes[index]!.curve === kind) announce(`${t("draw.unchanged")} ${bezierNodeText(draft.nodes, index)}`);
    else setDraftKind(draft, index, kind);
  };
  ctx.curveKindKey = curveKindKey;
}
