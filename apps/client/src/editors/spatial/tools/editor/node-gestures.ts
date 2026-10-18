// L'editor del disegno: i gesti dei nodi. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { keyOf } from "../../describe";
import { straight, toLocal } from "../../../../ink/geometry";
import { closedAtLimit } from "../../../../ink/tools/tool";
import { buildStroke } from "../../../../ink/tools/stroke";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { FinishedStroke } from "../../../../ink/input/session";
import { BoundsBuilder } from "../../scene/geometry";
import { apply, compose, type Matrix, type Point } from "../../scene/matrix";
import { pathOf } from "../../scene/model";
import type { Op } from "../../scene/ops";
import { plural, t, type DrawKey } from "../../strings";
import type { PaintNode } from "../../painter/paint";
import { addOp, gesture as asGesture, strokeElem, type Destination } from "../edit";
import {
  bend,
  handleAt,
  handleNode,
  insertNode,
  linkAt,
  moveHandle,
  moveNodes,
  nodeAt,
  nodeKey,
  nodesWithin,
  openNode,
  parseKey,
  pullHandles,
  pullSide,
  realizeHandle,
  samePlace,
  type Edited,
  type HandleRef,
  type NodeKey,
  type Subpath,
} from "../nodes";
import { draftOf } from "../nodable";
import { viewMatrix } from "../../view";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX, KIND_NAMES, NO_KINDS, NO_NODES, NODE_PX } from "./constants";
import type { EditorContext } from "./context";
import { allNodes, holdsPath, innerNode, remapped, sameDestination, samePath } from "./helpers";
import type { Editing, EraseGesture, InkGesture, NodeChange, NodeGrab, NodePick, NodesGesture } from "./types";

/// Il raggio della gomma, in pixel.

/// Un tratto entrato nel disegno: il suo id, il livello che l'ha ricevuto
/// e le sue copie in simmetria, ognuna con la trasformazione che porta il
/// tratto su di lei nelle coordinate del livello.
interface WrittenInk {
  readonly id: string;
  readonly to: Destination;
  readonly copies: readonly { readonly id: string; readonly matrix: Matrix }[];
}

/// I nodi di `keys` che `subs` ha.
function presentNodes(subs: readonly Subpath[], keys: Iterable<NodeKey>): NodeKey[] {
  return [...keys].filter((key) => {
    const [s, at] = parseKey(key);
    return subs[s]?.nodes[at] !== undefined;
  });
}

/// I nodi scelti `pick` coi nodi `keys` della forma `shape` in più.
function adding(pick: NodePick, shape: string, keys: Iterable<NodeKey>): Map<string, ReadonlySet<NodeKey>> {
  const out = new Map(pick);
  out.set(shape, new Set([...(pick.get(shape) ?? []), ...keys]));
  return out;
}

/// I nodi scelti `pick` senza il nodo `key` della forma `shape`.
function removing(pick: NodePick, shape: string, key: NodeKey): Map<string, ReadonlySet<NodeKey>> {
  const out = new Map(pick);
  const keys = new Set(pick.get(shape));
  keys.delete(key);
  if (keys.size === 0) out.delete(shape);
  else out.set(shape, keys);
  return out;
}

/// Ciò che i gesti dei nodi dà agli altri pezzi dell'editor.
export interface NodeGesturesContext {
  nodeCount: (subs: readonly Subpath[]) => number;
  nodePoint: (edit: Editing, key: NodeKey) => Point;
  nodeText: (edit: Editing, key: NodeKey) => string;
  targetText: () => string;
  announceTarget: () => void;
  announceNodes: (lead?: string) => void;
  refreshNodes: () => void;
  setNodes: (pick: ReadonlyMap<string, Iterable<NodeKey>>) => void;
  pickOf: (edit: Editing, keys: Iterable<NodeKey>) => ReadonlyMap<string, Iterable<NodeKey>>;
  changeOf: (edit: Editing, edited: Edited) => NodeChange;
  localDelta: (edit: Editing, a: Point, b: Point) => Point;
  showNodeDraft: (draft: ReadonlyMap<string, readonly Subpath[]>) => void;
  nodesStart: (g: NodesGesture, p: Point) => void;
  nodesUpdate: (g: NodesGesture) => void;
  nodesEnd: (g: NodesGesture, time: number) => void;
  eraseAlong: (g: EraseGesture, p: Point) => void;
  showErased: (g: EraseGesture) => void;
  writeInk: (g: InkGesture, split: boolean) => WrittenInk | null;
  copiesText: (copies: number) => string;
  finishInk: (g: InkGesture, stroke: FinishedStroke) => void;
}

/// Monta i gesti dei nodi.
export function installNodeGestures(ctx: EditorContext): void {
  const {
    suggestions, painter, currentIndex, grownPage, announce, objects, announceSelection, coordText, inOrder, nodableAt, resolveNodes, shapesKey, editOf,
    pickedIn, chosenCount, chosenEdits, editedUnits, kindsOf, shownHandles, showHandles, outlineNow, describeNode, labelOf, syncNodesBar, syncArrange,
    syncControls, drawnPaint, commit, select, target, nodeDragTo, snapNote, noted, straightened, boxAround, slantedMarquee, marqueed
  } = ctx;
  // --- I gesti dei nodi --------------------------------------------------------

  /// Quanti nodi ha il tracciato.
  const nodeCount = (subs: readonly Subpath[]): number => subs.reduce((count, sub) => count + sub.nodes.length, 0);
  ctx.nodeCount = nodeCount;

  /// Dove sta il nodo `key` della forma `edit`, nella scena.
  const nodePoint = (edit: Editing, key: NodeKey): Point => {
    const [s, at] = parseKey(key);
    return apply(edit.matrix, edit.subs[s]!.nodes[at]!);
  };
  ctx.nodePoint = nodePoint;

  /// Il nome a parole della forma `edit`: quello del suo oggetto, se è lui;
  /// altrimenti il suo, come nell'albero.
  const shapeLabel = (edit: Editing): string => {
    const node = samePath(edit.unit.path, edit.path) ? undefined : outlineNow().byKey.get(keyOf({ id: edit.leaf.facts.id, path: edit.path }));
    return node === undefined ? labelOf(edit.unit) : describeNode(node, undefined);
  };

  /// Il nodo `key` della forma `edit` a parole: quale, di che tipo e dove;
  /// con più forme, prima la forma.
  const nodeText = (edit: Editing, key: NodeKey): string => {
    const [s, at] = parseKey(key);
    let index = at + 1;
    for (let i = 0; i < s; i++) index += edit.subs[i]!.nodes.length;
    const sub = edit.subs[s]!;
    const end = !sub.closed && (at === 0 || at === sub.nodes.length - 1);
    const [x, y] = nodePoint(edit, key);
    const values = { index, count: nodeCount(edit.subs), kind: t(KIND_NAMES[end ? "end" : kindsOf(edit)(s, at)]), x: coordText(x), y: coordText(y) };
    return ctx.edits.length > 1 ? t("draw.nodes.walk_in", { ...values, object: shapeLabel(edit) }) : t("draw.nodes.walk", values);
  };
  ctx.nodeText = nodeText;

  /// Di che cosa si modificano i nodi, o perché di niente; vuoto se non
  /// c'è niente di scelto.
  const targetText = (): string => {
    resolveNodes();
    if (ctx.edits.length === 0) return ctx.noEditing === null ? "" : t(ctx.noEditing);
    const count = ctx.edits.reduce((sum, edit) => sum + nodeCount(edit.subs), 0);
    const objects = editedUnits().length;
    if (objects > 1) return plural(count, "draw.nodes.shown_in.one", "draw.nodes.shown_in.other", { objects });
    return plural(count, "draw.nodes.shown.one", "draw.nodes.shown.other", { object: labelOf(ctx.edits[0]!.unit) });
  };
  ctx.targetText = targetText;

  /// Dice di che cosa si modificano i nodi; senza niente di scelto, la
  /// selezione.
  const announceTarget = (): void => {
    const text = targetText();
    if (text === "") announceSelection();
    else announce(text);
  };
  ctx.announceTarget = announceTarget;

  /// I nodi scelti a parole: quello solo, o quanti, e di quanti oggetti se
  /// sono di più d'uno; con `lead` prima.
  const announceNodes = (lead = ""): void => {
    const chosen = chosenEdits();
    const count = chosenCount();
    const objects = new Set(chosen.map((edit) => edit.unit.key)).size;
    const text = count === 1
      ? nodeText(chosen[0]!, [...pickedIn(chosen[0]!)][0]!)
      : count === 0
        ? t("draw.nodes.selected.none")
        : objects > 1
          ? plural(count, "draw.nodes.selected_in.one", "draw.nodes.selected_in.other", { objects })
          : plural(count, "draw.nodes.selected.one", "draw.nodes.selected.other");
    announce(lead === "" ? text : `${lead} ${text}`);
  };
  ctx.announceNodes = announceNodes;

  /// Ritrova le forme, e se sono cambiate rifà le barre.
  const refreshNodes = (): void => {
    if (resolveNodes()) syncArrange();
  };
  ctx.refreshNodes = refreshNodes;

  /// I nodi di `pick`, per forma, diventano quelli scelti: di una forma che
  /// non si modifica, o che non li ha, nessuno.
  const setNodes = (pick: ReadonlyMap<string, Iterable<NodeKey>>): void => {
    refreshNodes();
    const next = new Map<string, ReadonlySet<NodeKey>>();
    for (const edit of ctx.edits) {
      const keys = pick.get(edit.key);
      const present = keys === undefined ? [] : presentNodes(edit.subs, keys);
      if (present.length > 0) next.set(edit.key, new Set(present));
    }
    ctx.nodeSelection = next;
    syncNodesBar();
    showHandles();
  };
  ctx.setNodes = setNodes;

  /// Soltanto i nodi `keys` della forma `edit`.
  const pickOf = (edit: Editing, keys: Iterable<NodeKey>): ReadonlyMap<string, Iterable<NodeKey>> => new Map([[edit.key, keys]]);
  ctx.pickOf = pickOf;

  /// Si modificano soltanto i nodi della forma `edit`, e il suo oggetto è il
  /// solo scelto, come con la Selezione diretta di Illustrator.
  const narrowTo = (edit: Editing): void => {
    if (ctx.edits.length === 1 && ctx.selection.length === 1) return;
    ctx.focused = [edit.path];
    select([edit.unit.key]);
  };

  /// La modifica `edited` dei nodi della forma `edit`, coi tipi dati portati
  /// dove vanno i nodi.
  const changeOf = (edit: Editing, edited: Edited): NodeChange => ({
    edit,
    subs: edited.subs,
    selected: edited.selected,
    kinds: remapped(ctx.nodeKinds.get(edit.key) ?? NO_KINDS, edited.moved),
    moved: edited.moved,
    changed: edited.changed,
  });
  ctx.changeOf = changeOf;

  /// Lo spostamento da `a` a `b`, due punti della scena, nelle coordinate
  /// della forma `edit`.
  const localDelta = (edit: Editing, a: Point, b: Point): Point => {
    const p = apply(edit.inverse, a);
    const q = apply(edit.inverse, b);
    return [q[0] - p[0], q[1] - p[1]];
  };
  ctx.localDelta = localDelta;

  /// Il nodo o la maniglia sotto `p`, fra le forme `among`: il più vicino
  /// entro il raggio del puntatore; a pari distanza la forma più in alto, e
  /// nella stessa forma il nodo.
  const grabAt = (
    among: readonly Editing[],
    p: Point,
    pointer: InkPointerType,
  ): { readonly edit: Editing; readonly node: NodeKey } | { readonly edit: Editing; readonly handle: HandleRef; readonly at: Point } | null => {
    const tolerance = NODE_PX[pointer] / ctx.camera.scale;
    const gap = (q: Point): number => Math.hypot(q[0] - p[0], q[1] - p[1]);
    let best: ReturnType<typeof grabAt> = null;
    let nearest = Infinity;
    for (let i = among.length - 1; i >= 0; i--) {
      const edit = among[i]!;
      const node = nodeAt(edit.subs, edit.matrix, p, tolerance);
      if (node !== null && gap(nodePoint(edit, node)) < nearest) {
        best = { edit, node };
        nearest = gap(nodePoint(edit, node));
      }
      const spot = handleAt(shownHandles(edit), edit.matrix, p, tolerance);
      const at = spot === null ? null : apply(edit.matrix, spot.point);
      if (spot !== null && gap(at!) < nearest) {
        best = { edit, handle: spot.handle, at: at! };
        nearest = gap(at!);
      }
    }
    return best;
  };

  /// Le forme come le lascia il trascinamento, sul foglio e nei nodi: la
  /// freccia con la sua punta, il tratto col contorno del pennello.
  const showNodeDraft = (draft: ReadonlyMap<string, readonly Subpath[]>): void => {
    const paths = new Map<PaintNode, string>();
    // Il tracciato di un testo cambia dove sta, e il testo lo segue.
    const tracks = new Map<string, string>();
    for (const [key, subs] of draft) {
      const edit = editOf(key);
      const d = edit === undefined ? null : draftOf(edit.nodable, subs);
      if (d === null) continue;
      if (edit!.nodable.kind === "track") tracks.set(edit!.nodable.target, d);
      else for (const paint of edit!.paints) paths.set(paint, d);
    }
    painter.setDraft(paths.size === 0 && tracks.size === 0 ? null : { paths, tracks });
    showHandles();
  };
  ctx.showNodeDraft = showNodeDraft;

  /// Tutti i nodi della forma `edit` scelti, e presi per trascinarli
  /// insieme: con Maiusc in aggiunta; senza, al posto degli altri. Se lo
  /// sono già tutti, si trascinano con gli altri scelti, e un tocco lascia
  /// soltanto loro.
  const grabAll = (g: NodesGesture, edit: Editing): void => {
    const keys = allNodes(edit.subs);
    const all = pickedIn(edit).size === keys.length;
    if (ctx.shift) setNodes(adding(ctx.nodeSelection, edit.key, keys));
    else if (!all) {
      narrowTo(edit);
      setNodes(pickOf(edit, keys));
    }
    const alone = !ctx.shift && all && (chosenCount() > keys.length || ctx.edits.length > 1) ? keys : null;
    g.grab = { kind: "node", shape: edit.key, key: keys[0]!, origin: nodePoint(edit, keys[0]!), toggle: false, alone, pull: false };
  };

  /// Ciò che `p` prende delle forme `among`: un nodo, che si sceglie e si
  /// potrà trascinare, e con Maiusc si aggiunge o si toglie, o con Alt
  /// tirarne fuori le maniglie; una maniglia, con Alt da sola, o un
  /// segmento da trascinare. L'asta di una freccia non si piega: si porta
  /// coi suoi due capi. Falso se `p` non prende niente.
  const grabOn = (g: NodesGesture, p: Point, among: readonly Editing[] = ctx.edits): boolean => {
    const hit = grabAt(among, p, g.pointer);
    const tolerance = HIT_PX[g.pointer] / ctx.camera.scale;
    if (hit !== null && "node" in hit) {
      const { edit, node } = hit;
      const chosen = pickedIn(edit).has(node);
      if (!chosen && ctx.shift) setNodes(adding(ctx.nodeSelection, edit.key, [node]));
      else if (!chosen) {
        narrowTo(edit);
        setNodes(pickOf(edit, [node]));
      }
      const alone = !ctx.shift && chosen && (chosenCount() > 1 || ctx.edits.length > 1) ? [node] : null;
      g.grab = { kind: "node", shape: edit.key, key: node, origin: nodePoint(edit, node), toggle: ctx.shift && chosen, alone, pull: ctx.alt && !ctx.shift };
      return true;
    }
    if (hit !== null) {
      // La maniglia di una linea sta sulla linea, a un terzo da un capo:
      // toccarla è toccare la linea lì.
      const { edit, handle } = hit;
      let segment: { readonly sub: number; readonly link: number; readonly t: number } | null = null;
      if (edit.subs[handle.sub]!.links[handle.link]!.kind === "line") {
        const link = linkAt(edit.subs, edit.matrix, p, tolerance);
        segment = link !== null && link.sub === handle.sub && link.link === handle.link ? link : { sub: handle.sub, link: handle.link, t: handle.which === "c1" ? 1 / 3 : 2 / 3 };
      }
      g.grab = { kind: "handle", shape: edit.key, handle, origin: hit.at, alone: ctx.alt && handle.which !== "control", segment };
      return true;
    }
    for (let i = among.length - 1; i >= 0; i--) {
      const edit = among[i]!;
      const link = linkAt(edit.subs, edit.matrix, p, tolerance);
      if (link === null) continue;
      if (edit.nodable.kind === "arrow") grabAll(g, edit);
      else g.grab = { kind: "segment", shape: edit.key, sub: link.sub, link: link.link, t: link.t };
      return true;
    }
    return false;
  };

  /// Il primo punto di un gesto dei nodi: un nodo, una maniglia o un
  /// segmento delle forme che si modificano (vedi [`grabOn`]). Dentro una di
  /// loro, lontano da nodi e segmenti, si scelgono tutti i suoi nodi, che si
  /// trascinano insieme, come con la Selezione diretta di Illustrator.
  /// Un'altra forma prende il posto di quelle che si modificano, o con Maiusc
  /// si aggiunge, e il punto prende subito ciò che tocca dei suoi nodi, allo
  /// stesso modo; una forma senza nodi sceglie il suo oggetto, e il tocco
  /// dice perché. Il vuoto comincia un riquadro.
  const nodesStart = (g: NodesGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    if (grabOn(g, p)) return;
    const tolerance = HIT_PX[g.pointer] / ctx.camera.scale;
    const unit = currentIndex().at(p, tolerance);
    const shape = unit?.shapeAt(p, tolerance) ?? null;
    if (unit === null || shape === null) {
      g.grab = { kind: "marquee", additive: ctx.shift };
      return;
    }
    const path = pathOf(shape);
    const inside = ctx.edits.find((edit) => samePath(edit.path, path));
    if (inside !== undefined) {
      grabAll(g, inside);
      return;
    }
    const nodable = nodableAt(shape);
    g.grab = { kind: "none" };
    if (typeof nodable === "string") {
      g.missed = NO_NODES[nodable];
      if (ctx.shift) select([...ctx.selection, unit.key]);
      else if (ctx.selection.length !== 1 || ctx.selection[0] !== unit.key) {
        ctx.focused = ctx.focused.filter((each) => holdsPath(unit.path, each));
        select([unit.key]);
      }
      return;
    }
    ctx.focused = ctx.shift ? [...ctx.edits.map((edit) => edit.path), path] : [path];
    select(ctx.shift ? [...ctx.selection, unit.key] : [unit.key]);
    const next = ctx.edits.find((edit) => samePath(edit.path, path));
    if (next === undefined) g.missed = "draw.nodes.flat";
    else if (!grabOn(g, p, [next])) grabAll(g, next);
  };
  ctx.nodesStart = nodesStart;

  /// Il riquadro dei nodi da `from` a `end`: sceglie i nodi che racchiude,
  /// di tutte le forme del disegno che ne hanno, e con loro i loro oggetti;
  /// un oggetto senza nodi, se lo racchiude tutto. Con `additive` aggiunge a
  /// ciò che era scelto prima del gesto `g`. Sul foglio girato di traverso
  /// vale ciò che si vede dentro il rettangolo dello schermo.
  const marqueeNodes = (g: NodesGesture, from: Point, end: Point, additive: boolean): void => {
    const slanted = slantedMarquee(from, end);
    let area = boxAround(from, end);
    if (slanted !== null) {
      const box = new BoundsBuilder();
      for (const corner of slanted.corners) box.include(corner);
      area = box.finish()!;
    }
    const view = viewMatrix(ctx.camera);
    const keys = additive ? [...g.selection] : [];
    const shapes = additive ? [...g.shapes] : [];
    const pick = new Map<string, Set<NodeKey>>();
    if (additive) for (const [key, chosen] of g.nodes) pick.set(key, new Set(chosen));
    for (const unit of currentIndex().units) {
      const bounds = unit.bounds;
      if (bounds === null || bounds.max[0] < area.min[0] || bounds.min[0] > area.max[0] || bounds.max[1] < area.min[1] || bounds.min[1] > area.max[1]) continue;
      for (const shape of unit.shapes()) {
        const nodable = nodableAt(shape.leaf);
        if (typeof nodable === "string") continue;
        const within = slanted === null
          ? nodesWithin(nodable.subs, shape.matrix, area)
          : nodesWithin(nodable.subs, compose(view, shape.matrix), slanted.screen);
        if (within.length === 0) continue;
        const path = pathOf(shape.leaf);
        const key = path.join(".");
        keys.push(unit.key);
        shapes.push(path);
        const chosen = pick.get(key) ?? new Set<NodeKey>();
        for (const node of within) chosen.add(node);
        pick.set(key, chosen);
      }
    }
    for (const unit of marqueed(from, end)) keys.push(unit.key);
    ctx.focused = shapes;
    ctx.selection = inOrder(keys);
    syncControls();
    setNodes(pick);
  };

  /// I nodi `keys` portati da `moved` dove sono finiti, se una modifica ne
  /// ha aggiunti.
  const movedKeys = (keys: Iterable<NodeKey>, moved: ReadonlyMap<NodeKey, NodeKey> | null): ReadonlySet<NodeKey> =>
    new Set(moved === null ? keys : [...keys].flatMap((key) => {
      const to = moved.get(key);
      return to === undefined ? [] : [to];
    }));

  /// I nodi della forma `edit` con la maniglia presa dove il trascinamento
  /// `g` la porta. Quella di una linea o di un arco diventa prima vera, e
  /// con lei l'arco dall'altra parte di un nodo liscio ([`realizeHandle`]).
  /// Con Alt la maniglia si sposta da sola, e il suo nodo diventa uno
  /// spigolo.
  const dragHandle = (g: NodesGesture, edit: Editing, grab: Extract<NodeGrab, { readonly kind: "handle" }>): Subpath[] => {
    const was = kindsOf(edit);
    const owner = handleNode(edit.subs[grab.handle.sub]!, grab.handle);
    const smooth = !grab.alone && grab.handle.which !== "control" && was(grab.handle.sub, owner) !== "corner";
    const real = realizeHandle(edit.subs, grab.handle, smooth);
    const given = ctx.nodeKinds.get(edit.key) ?? NO_KINDS;
    const kinds = real.moved === null ? new Map(given) : remapped(given, real.moved);
    if (grab.alone) {
      const s = real.handle.sub;
      const at = handleNode(real.subs[s]!, real.handle);
      if (innerNode(real.subs[s]!, at)) kinds.set(nodeKey(s, at), "corner");
    }
    g.reshaped = { shape: edit.key, chosen: movedKeys(pickedIn(edit), real.moved), kinds, moved: real.moved };
    return moveHandle(real.subs, real.handle, apply(edit.inverse, nodeDragTo(g, grab)), kindsOf(edit, real.subs, kinds));
  };

  /// I nodi della forma `edit` con le maniglie del nodo preso tirate fuori
  /// fin dove il trascinamento `g` porta il puntatore, come con lo strumento
  /// Punto di ancoraggio di Illustrator: i segmenti ai suoi lati diventano
  /// cubiche ([`openNode`]), quella dal lato verso cui il trascinamento
  /// comincia segue il puntatore e l'altra le sta opposta, e il nodo
  /// diventa simmetrico. `null` se il nodo non ha segmenti.
  const pullFrom = (g: NodesGesture, edit: Editing, grab: Extract<NodeGrab, { readonly kind: "node" }>): Subpath[] | null => {
    const opened = openNode(edit.subs, grab.key);
    const to = apply(edit.inverse, nodeDragTo(g, grab));
    const [s, at] = parseKey(opened.key);
    const node = opened.subs[s]!.nodes[at]!;
    g.side ??= pullSide(opened.subs, opened.key, [to[0] - node[0], to[1] - node[1]]);
    if (g.side === null) return null;
    const given = ctx.nodeKinds.get(edit.key) ?? NO_KINDS;
    const kinds = opened.moved === null ? new Map(given) : remapped(given, opened.moved);
    if (innerNode(opened.subs[s]!, at)) kinds.set(opened.key, "symmetric");
    g.reshaped = { shape: edit.key, chosen: movedKeys(pickedIn(edit), opened.moved), kinds, moved: opened.moved };
    return pullHandles(opened.subs, opened.key, g.side, to);
  };

  /// Il gesto dei nodi fino al punto di adesso. Oltre la soglia trascina: un
  /// nodo con quelli scelti di ogni forma, e con l'aggancio il nodo preso
  /// sulla griglia; le maniglie tirate fuori da un nodo preso con Alt; una
  /// maniglia; o il segmento, nel punto preso. Il riquadro sceglie.
  const nodesUpdate = (g: NodesGesture): void => {
    const grab = g.grab;
    if (g.from === null || g.end === null || grab === null || grab.kind === "none") return;
    if (!g.dragging) {
      if (Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale <= DRAG_PX[g.pointer]) return;
      if (grab.kind === "node" && grab.pull && editOf(grab.shape)?.nodable.kind === "arrow") {
        // L'asta di una freccia non si piega: non ha maniglie da tirare.
        g.grab = { kind: "none" };
        g.missed = "draw.nodes.arrow";
        return;
      }
      g.dragging = true;
      ctx.lastSegmentTap = null;
    }
    if (grab.kind === "marquee") {
      marqueeNodes(g, g.from, g.end, grab.additive);
      return;
    }
    const edit = editOf(grab.shape);
    if (edit === undefined) return;
    const draft = new Map<string, readonly Subpath[]>();
    if (grab.kind === "segment") {
      draft.set(edit.key, bend(edit.subs, grab.sub, grab.link, grab.t, localDelta(edit, g.from, g.end), kindsOf(edit)));
    } else if (grab.kind === "handle") {
      draft.set(edit.key, dragHandle(g, edit, grab));
    } else if (grab.pull) {
      const pulled = pullFrom(g, edit, grab);
      if (pulled !== null) draft.set(edit.key, pulled);
    } else {
      const to = nodeDragTo(g, grab);
      for (const each of chosenEdits()) draft.set(each.key, moveNodes(each.subs, pickedIn(each), localDelta(each, grab.origin, to), kindsOf(each)));
    }
    g.draft = draft;
    showNodeDraft(draft);
  };
  ctx.nodesUpdate = nodesUpdate;

  /// Il gesto dei nodi finisce. Un trascinamento si scrive, in un passo
  /// solo per tutte le forme; un tocco su un nodo lo sceglie da solo, o con
  /// Maiusc lo toglie; uno su un segmento sceglie i suoi due nodi, e il
  /// doppio tocco ci aggiunge un nodo; uno sul vuoto toglie la scelta dei
  /// nodi, poi quella degli oggetti. Se le forme che si modificano sono
  /// cambiate, si dicono prima dei nodi scelti.
  const nodesEnd = (g: NodesGesture, time: number): void => {
    const note = snapNote();
    ctx.current = null;
    const grab: NodeGrab = g.grab ?? { kind: "none" };
    const lead = (): string => {
      resolveNodes();
      return shapesKey(g.shapes) === shapesKey(ctx.edits.map((edit) => edit.path)) ? "" : targetText();
    };
    if (g.dragging) {
      if (grab.kind === "marquee") {
        showHandles();
        if (ctx.edits.length === 0) announceTarget();
        else announceNodes(lead());
        return;
      }
      painter.setDraft(null);
      const changes = [...(g.draft ?? [])].flatMap(([key, subs]): NodeChange[] => {
        const edit = editOf(key);
        if (edit === undefined) return [];
        const reshaped = g.reshaped?.shape === key ? g.reshaped : null;
        if (reshaped === null) return [{ edit, subs, selected: pickedIn(edit), kinds: ctx.nodeKinds.get(key) ?? NO_KINDS }];
        return [{ edit, subs, selected: reshaped.chosen, kinds: reshaped.kinds, ...(reshaped.moved === null ? {} : { moved: reshaped.moved }) }];
      });
      if (changes.length === 0) {
        showHandles();
        return;
      }
      const pulled = grab.kind === "node" && grab.pull;
      const label: DrawKey = pulled
        ? "draw.action.handles_pull"
        : grab.kind === "node" ? "draw.action.nodes_move" : grab.kind === "handle" ? "draw.action.handle" : "draw.action.bend";
      // Ciò che si dice si legge dai nodi di prima.
      const said: DrawKey = grab.kind === "handle" ? handleText(grab) : pulled ? pullText(grab) : "draw.nodes.bent";
      if (ctx.writeEdits(label, changes)?.written !== true) return;
      if (grab.kind === "node" && !pulled) ctx.announceMoved(note);
      else announce(ctx.afterEdit(noted(t(said), note)));
      return;
    }
    switch (grab.kind) {
      case "node": {
        const edit = editOf(grab.shape);
        if (edit !== undefined && grab.toggle) setNodes(removing(ctx.nodeSelection, grab.shape, grab.key));
        else if (edit !== undefined && grab.alone !== null) {
          narrowTo(edit);
          setNodes(pickOf(edit, grab.alone));
        }
        announceNodes(lead());
        return;
      }
      case "segment":
        tapSegment(g, grab.shape, grab, time, lead);
        return;
      case "marquee":
        if (grab.additive) return;
        if (chosenCount() > 0) {
          setNodes(new Map());
          announceNodes();
        } else {
          select([]);
          announceSelection();
        }
        return;
      case "none":
        if (g.missed !== null && ctx.edits.length > 0) announce(t(g.missed));
        else announceTarget();
        return;
      case "handle":
        if (grab.segment !== null) tapSegment(g, grab.shape, grab.segment, time, lead);
        return;
    }
  };
  ctx.nodesEnd = nodesEnd;

  /// Un tocco del gesto `g` sul punto `at` di un segmento della forma
  /// `shape`: sceglie i due nodi del segmento, con Maiusc in aggiunta; il
  /// doppio tocco ci aggiunge un nodo. `lead` dice le forme, se sono
  /// cambiate.
  const tapSegment = (
    g: NodesGesture,
    shape: string,
    at: { readonly sub: number; readonly link: number; readonly t: number },
    time: number,
    lead: () => string,
  ): void => {
    const edit = editOf(shape);
    if (edit === undefined || g.from === null) return;
    const tap = { shape, sub: at.sub, link: at.link, time, at: g.from };
    const previous = ctx.lastSegmentTap;
    ctx.lastSegmentTap = tap;
    const again = previous !== null && previous.shape === tap.shape && previous.sub === tap.sub && previous.link === tap.link &&
      tap.time - previous.time <= DOUBLE_TAP_MS && Math.hypot(tap.at[0] - previous.at[0], tap.at[1] - previous.at[1]) * ctx.camera.scale <= DOUBLE_TAP_PX[g.pointer];
    if (again) {
      ctx.lastSegmentTap = null;
      const done = ctx.writeEdits("draw.action.nodes_insert", [changeOf(edit, insertNode(edit.subs, at.sub, at.link, at.t))]);
      if (done?.written === true) announce(ctx.afterEdit(plural(done.count, "draw.nodes.inserted.one", "draw.nodes.inserted.other")));
      return;
    }
    const sub = edit.subs[at.sub]!;
    const ends = [nodeKey(at.sub, at.link), nodeKey(at.sub, (at.link + 1) % sub.nodes.length)];
    if (ctx.shift) setNodes(adding(ctx.nodeSelection, edit.key, ends));
    else {
      narrowTo(edit);
      setNodes(pickOf(edit, ends));
    }
    announceNodes(lead());
  };

  /// Ciò che si dice di una maniglia trascinata, dai nodi di prima: tirata
  /// fuori da una linea o dal suo nodo, spostata da sola da un nodo che non
  /// era uno spigolo, o spostata.
  const handleText = (grab: Extract<NodeGrab, { readonly kind: "handle" }>): DrawKey => {
    const edit = editOf(grab.shape);
    if (edit === undefined || grab.handle.which === "control") return "draw.nodes.handle_moved";
    const sub = edit.subs[grab.handle.sub]!;
    const at = handleNode(sub, grab.handle);
    const link = sub.links[grab.handle.link]!;
    if (grab.alone && innerNode(sub, at) && kindsOf(edit)(grab.handle.sub, at) !== "corner") return "draw.nodes.handle_alone";
    if (link.kind === "line" || (link.kind === "cubic" && samePlace(link[grab.handle.which], sub.nodes[at]!))) return "draw.nodes.handle_out";
    return "draw.nodes.handle_moved";
  };

  /// Ciò che si dice delle maniglie tirate da un nodo: di un nodo in mezzo,
  /// che è diventato simmetrico; di un capo, che ne ha una sola.
  const pullText = (grab: Extract<NodeGrab, { readonly kind: "node" }>): DrawKey => {
    const edit = editOf(grab.shape);
    if (edit === undefined) return "draw.nodes.handle_out";
    const [s, at] = parseKey(grab.key);
    return innerNode(edit.subs[s]!, at) ? "draw.nodes.pulled" : "draw.nodes.handle_out";
  };

  const eraseAlong = (g: EraseGesture, p: Point): void => {
    g.sweep.along(currentIndex(), p, ctx.camera.scale);
  };
  ctx.eraseAlong = eraseAlong;

  const showErased = (g: EraseGesture): void => {
    const faded = new Set<PaintNode>();
    const fadedContainers = new Set<object>();
    for (const unit of g.sweep.marked()) {
      for (const paint of unit.paints) faded.add(paint);
      if (unit.node.kind === "container") fadedContainers.add(unit.node);
    }
    painter.setDraft(faded.size === 0 && fadedContainers.size === 0 ? null : { faded, fadedContainers });
  };
  ctx.showErased = showErased;

  /// Il tratto del gesto `g` entra nel disegno, sottile alla fine se non
  /// continua in un altro, con le sue copie in simmetria, in un passo solo.
  /// Torna il suo id, il livello che l'ha ricevuto e le copie, con la
  /// trasformazione che le porta nelle coordinate del livello; `null` se non
  /// è entrato.
  const writeInk = (g: InkGesture, split: boolean): WrittenInk | null => {
    // Il livello di adesso: mentre il gesto durava, il disegno può essere
    // cambiato.
    const to = target(g.ids);
    if (to === null) return null;
    const local = sameDestination(to, g.to) ? g.local : g.scene.map((sample) => toLocal(sample, to.inverse));
    const brush = closedAtLimit(g.brush, split);
    const samples = straightened(g) ? straight(local) : local;
    // Ogni copia è il tratto portato dalla sua trasformazione, nelle
    // coordinate del livello: un tratto vero, col suo inchiostro. Una che
    // uscirebbe dai numeri dell'inchiostro non si scrive.
    const built = buildStroke(samples, brush, g.copies.map((m) => compose(to.inverse, compose(m, to.matrix))));
    if (!built.ok) {
      if (built.reason === "failed") announce(t("draw.ink_failed"));
      return null;
    }
    const bounds = new BoundsBuilder();
    for (const point of built.outline) bounds.include(apply(to.matrix, point));
    const id = g.ids.next("object");
    const at = new Date(performance.timeOrigin + g.began).toISOString();
    const paint = drawnPaint(g.color);
    const ops: Op[] = [...to.prelude, addOp(to, strokeElem(id, paint, brush, built.ink, at, g.tool))];
    const copies: WrittenInk["copies"][number][] = [];
    for (const copy of built.copies) {
      for (const point of copy.outline) bounds.include(apply(to.matrix, point));
      const copyId = g.ids.next("object");
      ops.push(addOp(to, strokeElem(copyId, paint, brush, copy.ink, at, g.tool)));
      copies.push({ id: copyId, matrix: copy.matrix });
    }
    const page = grownPage(bounds.finish());
    if (page !== null) ops.push({ op: "page", viewBox: page });
    return commit(g.tool === "highlighter" ? "draw.action.highlight" : "draw.action.stroke", asGesture(ops)) === null ? null : { id, to, copies };
  };
  ctx.writeInk = writeInk;

  /// Ciò che si dice di un tratto appena scritto con `copies` copie in
  /// simmetria: nulla senza copie.
  const copiesText = (copies: number): string => (copies === 0 ? "" : ` ${plural(copies, "draw.symmetry.copies.one", "draw.symmetry.copies.other")}`);
  ctx.copiesText = copiesText;

  const finishInk = (g: InkGesture, stroke: FinishedStroke): void => {
    const written = writeInk(g, stroke.split);
    if (written === null) return;
    announce(`${t(g.tool === "highlighter" ? "draw.added.highlight" : "draw.added.stroke")}${copiesText(written.copies.length)} ${objects()}`);
    if (!stroke.split) offerAfterInk(g);
  };
  ctx.finishInk = finishInk;

  /// Dopo un tratto: col dito, le due dita che muovono il foglio; dopo uno
  /// che somiglia a una forma, il tratto tenuto fermo che lo diventa.
  const offerAfterInk = (g: InkGesture): void => {
    if (g.pointer === "touch" && suggestions.offer("two-fingers")) return;
    if (g.holds && ctx.shapesOn() && suggestions.wants("hold-shape") && ctx.strokeShapeOf(g) !== null) suggestions.offer("hold-shape");
  };
}
