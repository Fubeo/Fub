// L'editor del disegno: la Curvatura sui tracciati che ci sono già. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { showContextMenu, type MenuItem } from "../../../../ui/menu";
import type { InkSample } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/input/pointer";
import { attachInkInput, type InkInputOptions, type InkInput } from "../../../../ink/dom/pointer-adapter";
import { isDefaultCurve, pressureCurve, type PenCurve } from "../../../../ink/input/pressure";
import { NO_STABILIZER } from "../../../../ink/input/stabilizer";
import { stabilizerOf } from "../grid";
import { apply, type Point } from "../../scene/matrix";
import type { Op } from "../../scene/ops";
import { plural, t } from "../../strings";
import { addOp, gesture as asGesture, removeOps } from "../edit";
import { gripAt } from "../frame";
import { deleteNodes, insertNode, linkAt, moveNodes, nodeAt, nodeKey, parseKey, type NodeKey, type Subpath } from "../nodes";
import { recurve, type CurveKind } from "../curvature";
import { GUIDE_HIT_PX, guideAt } from "../rulers";
import { toScene, toScreen } from "../../view";
import { elemBounds, type ForeignBlock, type Unit } from "../hit";
import { cornerCursor } from "../reshape";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, DRAG_PX, HIT_PX, MADE, NO_KINDS, NODE_PX } from "./constants";
import type { EditorContext } from "./context";
import { toLocal } from "../../../../ink/geometry";
import { comparePaths, holdsPath, innerNode, remapped } from "./helpers";
import type { BezierGesture, CurveDraft, CurveGrab, Drafting, Editing, EraseGesture, NodeChange } from "./types";

/// Quanto dopo il tasto laterale della penna lasciato arriva il menu
/// contestuale che il sistema gli manda dietro, in millisecondi.
const RADIAL_ECHO_MS = 500;

/// Dopo il menu aperto dalla tastiera, per tanti millisecondi il tasto del
/// menu non ne apre un altro.
const KEYED_MENU_MS = 1000;

/// Ciò che la Curvatura sui tracciati che ci sono già dà agli altri pezzi dell'editor.
export interface CurvatureToolContext {
  curveGrab: (p: Point, pointer: InkPointerType) => CurveGrab | null;
  curvePathUpdate: (g: BezierGesture) => void;
  curvePathEnd: (g: BezierGesture, time: number, note: string) => void;
  curveDelete: () => void;
  dropBezier: () => boolean;
  finishBezier: (closed: boolean, leaving?: boolean) => void;
  deleteBezierNode: (draft: Drafting) => void;
  undoable: () => boolean;
  redoable: () => boolean;
  replayBezier: (draft: Drafting, origin: "undo" | "redo") => void;
  readModifiers: (event: PointerEvent) => void;
  radialHere: () => boolean;
  handlers: InkInputOptions;
  pen: InkInput;
}

/// Monta la Curvatura sui tracciati che ci sono già.
export function installCurvatureTool(ctx: EditorContext): void {
  const {
    life, has, history, surface, selectionButton, painter, overlay, clearInk, cursorMark, editable, currentIndex, grownPage, newIds, announce, objects,
    showPage, rulersShown, guidesShown, rulerAt, showRulers, showGuideLines, localPoint, sceneAt, axisCursor, selectedUnits, curveOn, pickedIn,
    editedUnits, kindsOf, hoverNodes, frameNow, frameCursor, cornerAt, showGrip, showHandles, showShape, clearPreviews, syncControls, commit, withLabels,
    select, cancelGesture, target, guidesFor, guided, snapNote, guideUpdate, guideEnd, begin, drawInk, setSymmetry, symmetryUpdate, symmetryEnd,
    hoverSymmetry, drawShape, selectStart, selectUpdate, selectEnd, boardStart, boardUpdate, boardEnd, hoverBoard, lassoAdd, lassoUpdate, lassoEnd,
    hoverRegion, builderAdd, builderUpdate, builderEnd, hoverCut, cutAdd, cutEnd, hoverWidth, widthStart, widthUpdate, widthEnd, foreignNow, hoverDropper,
    dropperMove, takeAt, gradientStart, gradientUpdate, gradientEnd, hoverGradient, nodePoint, announceNodes, refreshNodes, setNodes, pickOf, changeOf,
    localDelta, showNodeDraft, nodesStart, nodesUpdate, nodesEnd, eraseAlong, showErased, finishInk, noteAt, watchStill, moveHeld, finishHeld, finishShape,
    hoverConnector, connectorStart, connectorUpdate, connectorEnd, drawing, bezierElem, showBezier, bezierStart, bezierUpdate, bezierStep, bezierEnd,
    options
  } = ctx;
  // --- La Curvatura sui tracciati che ci sono già ------------------------------
  //
  // Senza un tracciato in corso, la Curvatura modifica le forme scelte come
  // le disegnerebbe: un nodo trascinato si sposta e i segmenti attorno si
  // rifanno; trascinato da un segmento, vi posa un nodo e lo sposta. Un
  // tocco su un segmento vi posa un nodo senza cambiare niente, uno su un
  // nodo lo sceglie, per Canc, e due lo fanno liscio o spigolo. Le forme si
  // mostrano coi nodi, senza maniglie, come con lo strumento Nodi.

  /// Ciò che la Curvatura prende in `p` delle forme scelte: il nodo più
  /// vicino entro il raggio del puntatore, a pari distanza della forma più
  /// in alto; se no il segmento sotto il puntatore. L'asta di una freccia
  /// non si piega. `null` se niente.
  const curveGrab = (p: Point, pointer: InkPointerType): CurveGrab | null => {
    if (!curveOn()) return null;
    refreshNodes();
    const tolerance = NODE_PX[pointer] / ctx.camera.scale;
    let best: CurveGrab | null = null;
    let nearest = Infinity;
    for (let i = ctx.edits.length - 1; i >= 0; i--) {
      const edit = ctx.edits[i]!;
      const node = nodeAt(edit.subs, edit.matrix, p, tolerance);
      if (node === null) continue;
      const origin = nodePoint(edit, node);
      const apart = Math.hypot(origin[0] - p[0], origin[1] - p[1]);
      if (apart < nearest) {
        best = { edit, node, segment: null, origin };
        nearest = apart;
      }
    }
    if (best !== null) return best;
    const reach = HIT_PX[pointer] / ctx.camera.scale;
    for (let i = ctx.edits.length - 1; i >= 0; i--) {
      const edit = ctx.edits[i]!;
      if (edit.nodable.kind === "arrow") continue;
      const segment = linkAt(edit.subs, edit.matrix, p, reach);
      if (segment !== null) return { edit, node: null, segment, origin: p };
    }
    return null;
  };
  ctx.curveGrab = curveGrab;

  /// Il tracciato preso da `g` come lo lascia il trascinamento: il nodo
  /// preso, o quello posato sul segmento, dove porta il puntatore, sulla
  /// griglia o in linea con gli oggetti e con gli altri nodi, e i segmenti
  /// attorno rifatti come li disegna la Curvatura ([`recurve`]).
  const curveReshape = (g: BezierGesture): CurveDraft => {
    const { edit, node, segment } = g.path!;
    const given = ctx.nodeKinds.get(edit.key) ?? NO_KINDS;
    const inserted = segment === null ? null : insertNode(edit.subs, segment.sub, segment.link, segment.t);
    const subs = inserted?.subs ?? edit.subs;
    const key = inserted?.selected[0] ?? node!;
    const kinds = inserted === null ? given : remapped(given, inserted.moved);
    const kind = kindsOf(edit, subs, kinds);
    const [s, at] = parseKey(key);
    const origin = apply(edit.matrix, subs[s]!.nodes[at]!);
    const moved = moveNodes(subs, new Set([key]), localDelta(edit, origin, curvePathTo(g, origin)), kind);
    return { subs: recurve(moved, new Set([key]), kind), key, kinds, moved: inserted?.moved ?? null };
  };

  /// Dove il trascinamento di `g` porta il nodo che sta in `origin`, nella
  /// scena: di quanto si è mosso il puntatore, sulla griglia o in linea con
  /// gli altri oggetti e con gli altri nodi delle forme scelte.
  const curvePathTo = (g: BezierGesture, origin: Point): Point => {
    const { edit, node } = g.path!;
    const p: Point = [origin[0] + g.end![0] - g.from![0], origin[1] + g.end![1] - g.from![1]];
    const others = (): Point[] =>
      ctx.edits.flatMap((each) => each.subs.flatMap((sub, s) => sub.nodes.flatMap((at, i) => (each === edit && nodeKey(s, i) === node ? [] : [apply(each.matrix, at)]))));
    return guided(p, () => guidesFor(g, editedUnits(), others), g.pointer);
  };

  /// Il trascinamento della Curvatura su un tracciato scelto, sul foglio e
  /// nei nodi.
  const curvePathUpdate = (g: BezierGesture): void => {
    if (!g.dragging) return;
    g.reshaped = curveReshape(g);
    showNodeDraft(new Map([[g.path!.edit.key, g.reshaped.subs]]));
  };
  ctx.curvePathUpdate = curvePathUpdate;

  /// La fine di un gesto della Curvatura su un tracciato scelto, alzato al
  /// tempo `time`, con la nota `note` di ciò a cui si è agganciato.
  const curvePathEnd = (g: BezierGesture, time: number, note: string): void => {
    const { edit, node, segment } = g.path!;
    const tap = ctx.curveNodeTap;
    ctx.curveNodeTap = null;
    if (g.dragging) {
      const draft = g.reshaped ?? curveReshape(g);
      painter.setDraft(null);
      const change: NodeChange = { edit, subs: draft.subs, selected: [draft.key], kinds: draft.kinds, ...(draft.moved === null ? {} : { moved: draft.moved }) };
      if (ctx.writeEdits(segment === null ? "draw.action.nodes_move" : "draw.action.nodes_insert", [change])?.written === true) ctx.announceMoved(note);
      return;
    }
    if (segment !== null) {
      // Il nodo posato non cambia il tracciato: lo divide dov'è.
      const done = ctx.writeEdits("draw.action.nodes_insert", [changeOf(edit, insertNode(edit.subs, segment.sub, segment.link, segment.t))]);
      if (done?.written === true) announce(ctx.afterEdit(plural(done.count, "draw.nodes.inserted.one", "draw.nodes.inserted.other")));
      return;
    }
    const twice = tap !== null && tap.shape === edit.key && tap.key === node && time - tap.time <= DOUBLE_TAP_MS &&
      Math.hypot(tap.at[0] - g.from![0], tap.at[1] - g.from![1]) * ctx.camera.scale <= DOUBLE_TAP_PX[g.pointer];
    if (!twice) {
      ctx.curveNodeTap = { shape: edit.key, key: node!, at: g.from!, time };
      setNodes(pickOf(edit, [node!]));
      announceNodes();
      return;
    }
    const [s, at] = parseKey(node!);
    curveKindAt(edit, node!, kindsOf(edit)(s, at) === "corner" ? "smooth" : "corner");
  };
  ctx.curvePathEnd = curvePathEnd;

  /// Il nodo `key` della forma `edit` diventa `kind`, e i segmenti attorno si
  /// rifanno come li disegna la Curvatura: fra due spigoli, una linea. Un
  /// capo di un tracciato aperto non ha tipo.
  const curveKindAt = (edit: Editing, key: NodeKey, kind: CurveKind): void => {
    const [s, at] = parseKey(key);
    if (!innerNode(edit.subs[s]!, at)) {
      announce(t("draw.nodes.kind.none"));
      return;
    }
    const given = new Map(ctx.nodeKinds.get(edit.key) ?? NO_KINDS);
    given.set(key, kind);
    const subs = recurve(edit.subs, new Set([key]), kindsOf(edit, edit.subs, given), new Set([key]));
    const [one, other] = MADE[kind];
    if (ctx.writeEdits("draw.action.nodes_kind", [{ edit, subs, selected: [key], kinds: given, changed: 1 }])?.written === true) announce(ctx.afterEdit(plural(1, one, other)));
  };

  /// Canc con la Curvatura: i nodi scelti se ne vanno, e i segmenti attorno
  /// si rifanno come li disegna la Curvatura: dove un nodo tolto stava fra
  /// due spigoli, una linea.
  const curveDelete = (): void => {
    const chosen = ctx.noding();
    if (chosen.length === 0) return;
    const changes = chosen.map((edit): NodeChange => {
      const picked = pickedIn(edit);
      const edited = deleteNodes(edit.subs, picked);
      const given = remapped(ctx.nodeKinds.get(edit.key) ?? NO_KINDS, edited.moved);
      // I nodi che restano accanto a quelli tolti, e il primo di ogni
      // segmento che adesso passa dove erano.
      const around = new Set<NodeKey>();
      const bridges = new Set<NodeKey>();
      edit.subs.forEach((sub, s) => {
        const n = sub.nodes.length;
        const gone = (at: number): boolean => picked.has(nodeKey(s, at));
        const kept = (at: number, by: 1 | -1): number | null => {
          let i = at;
          for (let step = 0; step < n; step++) {
            i = sub.closed ? (i + by + n) % n : i + by;
            if (i < 0 || i >= n) return null;
            if (!gone(i)) return i;
          }
          return null;
        };
        for (let at = 0; at < n; at++) {
          if (!gone(at)) continue;
          const before = kept(at, -1);
          const after = kept(at, 1);
          const a = before === null ? undefined : edited.moved.get(nodeKey(s, before));
          const b = after === null ? undefined : edited.moved.get(nodeKey(s, after));
          if (a !== undefined) around.add(a);
          if (b !== undefined) around.add(b);
          if (a !== undefined && b !== undefined && a !== b) bridges.add(a);
        }
      });
      const kinds = kindsOf(edit, edited.subs, given);
      const subs = edited.subs.map((sub, s): Subpath => {
        const links = sub.links.map((link, at) => {
          const straight = bridges.has(nodeKey(s, at)) && kinds(s, at) === "corner" && kinds(s, (at + 1) % sub.nodes.length) === "corner";
          return straight ? ({ kind: "line" } as const) : link;
        });
        return { ...sub, links };
      });
      return { edit, subs: recurve(subs, around, kinds), selected: [], kinds: given, moved: edited.moved, changed: edited.changed };
    });
    const done = ctx.writeEdits("draw.action.nodes_delete", changes);
    if (done?.written !== true) return;
    const gone = changes.filter((change) => change.subs.every((sub) => sub.nodes.length < 2)).length;
    if (gone === changes.length) announce(`${plural(gone, "draw.nodes.deleted.all.one", "draw.nodes.deleted.all.other")} ${objects()}`);
    else announce(ctx.afterEdit(plural(done.count, "draw.nodes.deleted.one", "draw.nodes.deleted.other")));
  };
  ctx.curveDelete = curveDelete;

  /// Il tracciato della penna non c'è più, né la sua anteprima. `false` se
  /// non c'era.
  function dropBezier(): boolean {
    if (ctx.drafting === null) return false;
    ctx.drafting = null;
    ctx.hover = null;
    showShape(null, [1, 0, 0, 1, 0, 0]);
    showHandles();
    syncControls();
    return true;
  }
  ctx.dropBezier = dropBezier;

  /// Il tracciato della penna entra nel disegno, sul livello di adesso, in
  /// un passo solo che si annulla. Un nodo solo non fa un tracciato. Se il
  /// livello non riceve, lo si dice e il tracciato resta, da concludere
  /// quando riceverà; `leaving`, perché lo strumento cambia, lo butta.
  function finishBezier(closed: boolean, leaving = false): void {
    const draft = drawing();
    if (draft === null || draft.nodes.length < 2) {
      dropBezier();
      if (draft !== null) announce(t("draw.bezier.short"));
      return;
    }
    // Il livello di adesso: mentre il tracciato cresceva, il disegno può
    // essere cambiato.
    const ids = newIds();
    const to = target(ids);
    if (to === null) {
      if (leaving) dropBezier();
      return;
    }
    dropBezier();
    const elem = bezierElem(ids.next("object"), draft.nodes, closed, to);
    if (elem === null) {
      announce(t("draw.bezier.short"));
      return;
    }
    const ops: Op[] = [...to.prelude, addOp(to, elem)];
    const page = grownPage(elemBounds(elem, to.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.bezier", asGesture(ops)) !== null) announce(`${t(closed ? "draw.added.path.closed" : "draw.added.path")} ${objects()}`);
  }
  ctx.finishBezier = finishBezier;

  /// Canc con la penna: l'ultimo nodo se ne va, in un passo che si annulla.
  const deleteBezierNode = (draft: Drafting): void => {
    const index = draft.nodes.length;
    bezierStep(draft, draft.nodes.slice(0, -1), "draw.bezier.step.delete", index);
    showBezier();
    syncControls();
    announce(t("draw.bezier.deleted", { index }));
  };
  ctx.deleteBezierNode = deleteBezierNode;

  /// Annulla e Ripeti valgono per il tracciato della penna finché ha passi
  /// da percorrere, poi per il disegno.
  const undoable = (): boolean => (ctx.drafting !== null && ctx.drafting.done.length > 0) || history.canUndo;
  ctx.undoable = undoable;
  const redoable = (): boolean => (ctx.drafting !== null && ctx.drafting.undone.length > 0) || (drawing() === null && history.canRedo);
  ctx.redoable = redoable;

  /// Un passo del tracciato della penna, annullato o ripetuto. Senza nodi il
  /// tracciato resta, vuoto, finché Ripeti può rimetterli.
  const replayBezier = (draft: Drafting, origin: "undo" | "redo"): void => {
    const step = (origin === "undo" ? draft.done : draft.undone).pop()!;
    (origin === "undo" ? draft.undone : draft.done).push({ ...step, nodes: draft.nodes });
    draft.nodes = step.nodes;
    showBezier();
    syncControls();
    announce(t(origin === "undo" ? "draw.undone" : "draw.redone", { action: t(step.label, { index: step.index }) }));
  };
  ctx.replayBezier = replayBezier;

  const finishErase = (g: EraseGesture): void => {
    const units = g.sweep.marked();
    if (units.length === 0) {
      painter.setDraft(null);
      return;
    }
    if (commit("draw.action.erase", asGesture(removeOps(withLabels(units)))) !== null) {
      announce(`${plural(units.length, "draw.erased.one", "draw.erased.other")} ${objects()}`);
    }
  };

  const toPoint = (sample: InkSample): Point => [sample.x, sample.y];

  // Maiusc, Ctrl o ⌘, e Alt si leggono dall'evento del puntatore prima della
  // pipeline, che ascolta in cattura sullo stesso elemento: registrato prima
  // di lei, questo ascolto la precede, e il gesto vede lo stato dell'evento
  // in corso.
  const readModifiers = (event: PointerEvent): void => {
    ctx.shift = event.shiftKey;
    ctx.free = event.ctrlKey || event.metaKey;
    ctx.alt = event.altKey;
  };
  ctx.readModifiers = readModifiers;
  // Il ritaglio finisce con i modificatori dell'evento che lo lascia: la
  // pipeline ascolta `pointerup` sul documento, in cattura, e questo ascolto
  // la precede.
  life.listen(
    surface.ownerDocument,
    "pointerup",
    (event) => {
      if (ctx.current?.kind === "crop") readModifiers(event);
    },
    { capture: true },
  );
  /// La maniglia sotto il puntatore che passa senza premere, nel cursore.
  const hoverGrip = (event: PointerEvent): void => {
    if (ctx.tool === "board") {
      hoverBoard(event);
      return;
    }
    // Mentre si ritaglia: un segno tira, l'immagine si sposta.
    if (ctx.cropping !== null) {
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      showGrip(event.buttons === 0 ? ctx.cropCursor(sceneAt(event.clientX, event.clientY), pointer) : null);
      return;
    }
    const view = event.buttons === 0 ? frameNow() : null;
    if (view === null) {
      showGrip(null);
      return;
    }
    const point = sceneAt(event.clientX, event.clientY);
    const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
    const grip = gripAt(view, point, ctx.camera.scale, pointer);
    const corner = cornerAt(point, pointer, view, grip);
    showGrip(corner !== null ? cornerCursor(corner.grip, corner.unit.matrix, ctx.camera.angle) : grip === null ? null : frameCursor(view.frame, grip));
  };
  /// La guida del documento sotto il puntatore che passa, con lo strumento
  /// Selezione: si accende, e il cursore dice dove si sposta. Sopra un
  /// righello il cursore è la freccia; una maniglia della cornice viene
  /// prima.
  const hoverGuide = (event: PointerEvent): void => {
    const local = localPoint(event.clientX, event.clientY);
    const p: Point = [local.x, local.y];
    const ruler = rulerAt(p);
    if (ruler === null) delete surface.dataset.ruler;
    else surface.dataset.ruler = ruler;
    const guides = ctx.scene.root.guides;
    let hot: number | null = null;
    if (ruler === null && event.buttons === 0 && ctx.tool === "select" && editable() && guidesShown() && guides !== null && surface.dataset.grip === undefined && ctx.cropping === null) {
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      hot = guideAt(guides, ctx.camera, p, GUIDE_HIT_PX[pointer], true);
    }
    if (hot !== null) surface.dataset.grip = axisCursor(guides![hot]!.axis);
    if (hot === ctx.hotGuide) return;
    ctx.hotGuide = hot;
    showGuideLines();
  };
  /// Il puntatore porta con sé il cursore del foglio, che si nasconde: la
  /// tastiera ripartirà da lì.
  const followPointer = (event: PointerEvent): void => {
    if (ctx.pressed !== null) return;
    ctx.cursor = sceneAt(event.clientX, event.clientY);
    cursorMark.hidden = true;
  };
  life.listen(
    surface,
    "pointerdown",
    (event) => {
      readModifiers(event);
      const local = localPoint(event.clientX, event.clientY);
      ctx.downAt = [local.x, local.y];
      // Il puntatore prende il posto della tastiera: il suo gesto finisce.
      ctx.cancelPress();
      followPointer(event);
      // Il puntatore sul foglio conclude il testo che si scrive.
      ctx.closedTyping = ctx.typing !== null;
      ctx.finishText();
      // Dopo un tratto le scorciatoie valgono: il fuoco va al foglio.
      if (document.activeElement !== surface) surface.focus({ preventScroll: true });
    },
    { capture: true },
  );
  life.listen(
    surface,
    "pointermove",
    (event) => {
      readModifiers(event);
      followPointer(event);
      const point = sceneAt(event.clientX, event.clientY);
      const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
      ctx.pointerAt = { at: point, pointer };
      // Sopra il foglio, la penna di Bézier mostra il segmento che verrebbe.
      if (drawing() !== null && ctx.current === null && ctx.pressed === null) {
        ctx.hover = { at: point, pointer };
        showBezier();
      }
      // Sopra una maniglia della cornice o una guida, il cursore dice che
      // cosa fa; con lo strumento Nodi, la forma sotto mostra i suoi nodi,
      // col Costruttore la regione sotto si accende, con le Forbici si vede
      // dove tagliano, col contagocce che cosa prende, con lo strumento
      // Sfumatura che cosa sposta e col Connettore dove si aggancia.
      if (ctx.current === null && ctx.pressed === null) {
        hoverGrip(event);
        hoverGuide(event);
        hoverNodes(event.buttons === 0 ? point : null, pointer);
        hoverRegion(event.buttons === 0 ? point : null, pointer);
        hoverCut(event.buttons === 0 ? point : null, pointer);
        hoverWidth(event.buttons === 0 ? point : null, pointer);
        hoverDropper(event.buttons === 0 ? point : null, pointer);
        hoverGradient(event.buttons === 0 ? point : null, pointer);
        hoverConnector(event.buttons === 0 ? point : null, pointer);
        hoverSymmetry(event.buttons === 0 ? toScreen(ctx.camera, point) : null, pointer);
      }
      // Con Alt, le misure seguono il puntatore.
      if (ctx.current === null && ctx.pressed === null && (ctx.alt || ctx.measured)) showHandles();
      // I righelli segnano dov'è.
      else if (rulersShown()) showRulers();
    },
    { capture: true },
  );
  /// Il menu dei righelli o della guida in `p`, sulla superficie, se lì ce
  /// n'è uno.
  const menuItemsAt = (p: Point, touch: boolean): MenuItem[] | null => {
    if (rulerAt(p) !== null) return ctx.rulerItems();
    if (!guidesShown() || ctx.scene.root.guides === null) return null;
    const index = guideAt(ctx.scene.root.guides, ctx.camera, p, GUIDE_HIT_PX[touch ? "touch" : "mouse"], false);
    return index === null ? null : ctx.guideItems(index);
  };

  /// Il blocco di un altro programma che si vede nel punto `p` della scena,
  /// entro `tolerance`: il più in alto, se sta sopra `hit`, l'oggetto che il
  /// punto prende.
  const foreignAt = (p: Point, tolerance: number, hit: Unit | null): ForeignBlock | null => {
    const blocks = foreignNow();
    for (let at = blocks.length - 1; at >= 0; at--) {
      const block = blocks[at]!;
      if (block.covers(p, tolerance)) return hit === null || comparePaths(block.path, hit.path) > 0 ? block : null;
    }
    return null;
  };

  /// Vero se lo strumento di adesso ha il menu della selezione.
  const selectingTool = (): boolean => has("selection") && (ctx.tool === "select" || ctx.tool === "lasso");

  /// Vero se il clic destro apre il menu radiale: dal livello che lo offre,
  /// a chi può modificare, con gli strumenti che non hanno il menu della
  /// selezione.
  const radialHere = (): boolean => has("gestures") && editable() && !selectingTool();
  ctx.radialHere = radialHere;

  // Col tasto destro, o col tocco lungo, i righelli e le guide del
  // documento hanno il loro menu, con qualunque strumento e anche per una
  // guida bloccata, che solo da qui si sblocca col puntatore. Altrove il
  // menu della selezione o il menu radiale.
  life.listen(surface, "contextmenu", (event) => {
    // Il menu aperto dalla tastiera non si apre una seconda volta: l'evento
    // che il tasto manda dietro si consuma, uno solo.
    if (event.timeStamp - ctx.keyedMenu < KEYED_MENU_MS) {
      ctx.keyedMenu = -Infinity;
      event.preventDefault();
      return;
    }
    // Così quello che il sistema manda dietro al tasto laterale della penna,
    // che il menu radiale ha già visto.
    if (ctx.radial !== null || event.timeStamp - ctx.radialLift < RADIAL_ECHO_MS) {
      ctx.radialLift = -Infinity;
      event.preventDefault();
      return;
    }
    const local = localPoint(event.clientX, event.clientY);
    const p: Point = [local.x, local.y];
    const kind = "pointerType" in event ? (event as PointerEvent).pointerType : "mouse";
    const touch = kind === "touch";
    const items = menuItemsAt(p, touch);
    // Con gli strumenti che disegnano, il menu radiale. Il tocco lungo che lo
    // apre non lascia un punto sul foglio; un tratto del mouse a metà resta.
    if (items === null && radialHere()) {
      if (ctx.pressed !== null || (ctx.current !== null && !(touch && ctx.current.pointer === "touch"))) return;
      event.preventDefault();
      // Se il puntatore è ancora giù, il menu lo segue.
      const held = ctx.down !== null && (ctx.down.type === kind || (kind === "" && ctx.down.type === "mouse")) ? { pointerType: ctx.down.type, pointerId: ctx.down.id } : null;
      ctx.showRadial(event.clientX, event.clientY, held);
      return;
    }
    // Altrove, con gli strumenti che scelgono, il menu della selezione: sopra
    // un oggetto che non è scelto, prima lo sceglie. Un tocco lungo che non
    // ha ancora mosso niente lo apre anche lui.
    const still = ctx.current === null || (ctx.current.kind === "select" && ctx.current.mode === "pending") || (ctx.current.kind === "lasso" && !ctx.current.dragging);
    const selecting = items === null && selectingTool() && ctx.pressed === null && still;
    if (!selecting && (items === null || items.length === 0)) return;
    // Il tocco lungo che apre il menu non tira anche una guida.
    if (!selecting && ctx.current !== null && ctx.current.kind !== "guide") return;
    event.preventDefault();
    if (ctx.current !== null) cancelGesture();
    if (!selecting) {
      showContextMenu(event, items!);
      return;
    }
    const scenePoint = toScene(ctx.camera, p);
    const tolerance = HIT_PX[touch ? "touch" : "mouse"] / ctx.camera.scale;
    const hit = currentIndex().at(scenePoint, tolerance);
    if (hit !== null && !selectedUnits().some((unit) => unit.key === hit.key || holdsPath(hit.path, unit.path))) select([hit.key]);
    showContextMenu(event, ctx.selectionItems(has("editable") ? foreignAt(scenePoint, tolerance, hit) : null), { labelledBy: selectionButton.id });
  });
  // Il tasto laterale della penna apre il menu radiale dove la penna è, e la
  // penna lo guida finché il tasto è giù. Sui righelli, sulle guide e con
  // gli strumenti che scelgono resta al sistema, che ne fa un clic destro.
  life.listen(surface, "pointerdown", (event) => {
    if (event.pointerType !== "pen" || event.button !== 2 || ctx.radial !== null || ctx.current !== null || ctx.pressed !== null) return;
    const local = localPoint(event.clientX, event.clientY);
    if (menuItemsAt([local.x, local.y], false) !== null || !radialHere()) return;
    event.preventDefault();
    ctx.showRadial(event.clientX, event.clientY, { pointerType: "pen", pointerId: event.pointerId });
  });
  // L'angolo fra i righelli apre il loro menu: l'unità, le guide, e
  // nasconderli.
  life.listen(surface, "click", (event) => {
    const local = localPoint(event.clientX, event.clientY);
    if (rulerAt([local.x, local.y]) === "corner") showContextMenu(event, ctx.rulerItems());
  });
  life.listen(surface, "pointerleave", () => {
    if (ctx.current === null) showGrip(null);
    surface.removeAttribute("data-ruler");
    if (ctx.hotGuide !== null && ctx.current === null) {
      ctx.hotGuide = null;
      showGuideLines();
    }
    ctx.pointerAt = null;
    if (rulersShown()) showRulers();
    hoverNodes(null, "mouse");
    hoverRegion(null, "mouse");
    hoverCut(null, "mouse");
    hoverWidth(null, "mouse");
    hoverDropper(null, "mouse");
    hoverConnector(null, "mouse");
    if (ctx.hover !== null) {
      ctx.hover = null;
      showBezier();
    } else if (ctx.measured) {
      showHandles();
    }
  });

  /// La curva della pressione di adesso, rifatta quando la si cambia.
  let penCurve: { readonly of: PenCurve; readonly apply: (pressure: number) => number } | null = null;
  /// La pressione della penna sulla curva di chi disegna, se il livello la
  /// offre: senza, la pressione com'è.
  const penPressure = (pressure: number): number => {
    if (isDefaultCurve(ctx.grid.pen) || !has("gestures")) return pressure;
    if (penCurve?.of !== ctx.grid.pen) penCurve = { of: ctx.grid.pen, apply: pressureCurve(ctx.grid.pen) };
    return penCurve.apply(pressure);
  };

  // I gestori della pipeline, che riceve anche il cursore del foglio.
  const handlers: InkInputOptions = {
    toScene: (clientX, clientY) => {
      const [x, y] = sceneAt(clientX, clientY);
      return { x, y };
    },
    turn: () => ctx.camera.angle,
    pressure: penPressure,
    // Lo stabilizzatore che chi disegna ha scelto in «Penna e dita», se il
    // livello offre quella finestra; la corda si misura in pixel dello schermo.
    stabilizer: () => (has("gestures") ? stabilizerOf(ctx.grid.steady) : NO_STABILIZER),
    scale: () => ctx.camera.scale,
    onStart(start) {
      // Un gesto lungo che la pipeline divide al limite dei campioni
      // continua nel tratto nuovo; il tratto a penna si scrive a pezzi,
      // tranne quello diventato forma, che è ormai un gesto solo.
      if (start.continued && ctx.current !== null && ctx.current.kind !== "refused" && (ctx.current.kind !== "ink" || ctx.current.held !== null)) {
        ctx.current.stroke = start.id;
        return;
      }
      ctx.current = begin(start);
    },
    onSamples(id, samples) {
      const g = ctx.current;
      if (g === null || g.stroke !== id || samples.length === 0) return;
      switch (g.kind) {
        case "ink":
          if (g.held !== null) {
            moveHeld(g, toPoint(samples[samples.length - 1]!));
            break;
          }
          // Il contorno si rifà in `onSettled`, una volta per evento.
          for (const sample of samples) {
            g.scene.push(sample);
            g.local.push(toLocal(sample, g.to.inverse));
          }
          watchStill(g, samples);
          break;
        case "shape":
          // Il primo punto si aggancia subito, l'ultimo a ogni disegno:
          // Ctrl o ⌘ può cambiare a metà gesto.
          g.from ??= guided(toPoint(samples[0]!), () => guidesFor(g, []), g.pointer);
          g.end = toPoint(samples[samples.length - 1]!);
          drawShape(g);
          break;
        case "select":
          if (g.from === null) selectStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          selectUpdate(g);
          break;
        case "lasso":
          for (const sample of samples) lassoAdd(g, toPoint(sample));
          lassoUpdate(g);
          break;
        case "board":
          if (g.from === null) boardStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          boardUpdate(g);
          break;
        case "nodes":
          if (g.from === null) nodesStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          nodesUpdate(g);
          break;
        case "builder":
          for (const sample of samples) builderAdd(g, toPoint(sample));
          builderUpdate(g);
          break;
        case "cut":
          for (const sample of samples) cutAdd(g, toPoint(sample));
          showHandles();
          break;
        case "width":
          if (g.from === null) widthStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          widthUpdate(g);
          break;
        case "bezier":
          if (g.from === null) bezierStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          bezierUpdate(g);
          break;
        case "erase":
          for (const sample of samples) eraseAlong(g, toPoint(sample));
          showErased(g);
          break;
        case "text": {
          g.from ??= toPoint(samples[0]!);
          g.end = toPoint(samples[samples.length - 1]!);
          // Col testo in area, trascinare disegna il suo riquadro.
          const far = Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale > DRAG_PX[g.pointer];
          if (!g.dragging && far && has("typeset") && editable()) g.dragging = true;
          if (g.dragging) showHandles();
          break;
        }
        case "guide":
          guideUpdate(g, toPoint(samples[samples.length - 1]!));
          break;
        case "symmetry":
          symmetryUpdate(g, toPoint(samples[samples.length - 1]!));
          break;
        case "note":
          g.at ??= toPoint(samples[0]!);
          break;
        case "dropper":
          dropperMove(g, toPoint(samples[samples.length - 1]!));
          break;
        case "gradient":
          if (g.from === null) gradientStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          gradientUpdate(g);
          break;
        case "crop":
          if (g.from === null) ctx.cropStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          ctx.cropUpdate(g);
          break;
        case "connector":
          if (g.from === null) connectorStart(g, toPoint(samples[0]!));
          g.end = toPoint(samples[samples.length - 1]!);
          connectorUpdate(g);
          break;
        case "refused":
          break;
      }
    },
    onPredicted(id, samples) {
      const g = ctx.current;
      if (g === null || g.stroke !== id || g.kind !== "ink" || g.held !== null) return;
      g.predicted = samples.map((sample) => toLocal(sample, g.to.inverse));
    },
    onSettled(id) {
      // Campioni e predizione dello stesso evento: il contorno e il foglio si
      // rifanno una volta sola.
      const g = ctx.current;
      if (g !== null && g.stroke === id && g.kind === "ink" && g.held === null) drawInk(g);
    },
    onEnd(stroke) {
      const g = ctx.current;
      if (g === null || g.stroke !== stroke.id) return;
      if (stroke.split && (g.kind !== "ink" || g.held !== null)) return;
      switch (g.kind) {
        case "ink":
          ctx.current = null;
          clearTimeout(ctx.holdTimer);
          if (g.held !== null) {
            // La forma è già a schermo al posto del tratto: la scena la
            // disegna nello stesso gestore.
            finishHeld(g);
            showShape(null, g.to.matrix);
            return;
          }
          // Prima il tratto nella scena, poi via quello in corso: nello
          // stesso gestore, quindi a schermo non c'è un fotogramma senza
          // nessuno dei due.
          finishInk(g, stroke);
          clearInk();
          overlay.flush();
          return;
        case "shape": {
          const note = snapNote();
          ctx.current = null;
          finishShape(g, note);
          showShape(null, g.to.matrix);
          if (ctx.guiding) showHandles();
          return;
        }
        case "select":
          selectEnd(g, stroke.timeStamp);
          return;
        case "lasso":
          lassoEnd(g);
          return;
        case "board":
          boardEnd(g);
          return;
        case "nodes":
          nodesEnd(g, stroke.timeStamp);
          return;
        case "builder":
          builderEnd(g);
          return;
        case "cut":
          cutEnd(g);
          return;
        case "width":
          widthEnd(g, stroke.timeStamp);
          return;
        case "bezier":
          bezierEnd(g, stroke.timeStamp);
          return;
        case "erase":
          ctx.current = null;
          finishErase(g);
          return;
        case "text":
          ctx.current = null;
          if (g.dragging && g.from !== null && g.end !== null) {
            showHandles();
            ctx.openArea(g.from, g.end);
          } else if (g.from !== null) {
            ctx.openText(g.from, g.pointer);
          }
          return;
        case "guide":
          guideEnd(g, stroke.timeStamp);
          return;
        case "symmetry":
          symmetryEnd(g);
          return;
        case "note":
          ctx.current = null;
          noteAt(g.at, g.pointer);
          return;
        case "dropper": {
          ctx.current = null;
          const at = g.at;
          // Il puntatore resta sopra il foglio: l'anteprima torna a seguirlo.
          if (at !== null && g.pointer !== "touch") ctx.dropperHover = { index: currentIndex(), at, pointer: g.pointer, keyboard: g.stroke < 0, seen: g.seen };
          showHandles();
          // Maiusc conta quando si rilascia.
          if (at !== null) void takeAt(at, g.pointer, ctx.shift);
          return;
        }
        case "gradient":
          gradientEnd(g, stroke.timeStamp);
          return;
        case "crop":
          ctx.cropEnd(g, stroke.timeStamp);
          return;
        case "connector":
          connectorEnd(g);
          return;
        case "refused":
          ctx.current = null;
          return;
      }
    },
    onCancel(id) {
      const g = ctx.current;
      if (g === null || g.stroke !== id) return;
      ctx.current = null;
      if (g.kind === "ink") clearTimeout(ctx.holdTimer);
      if ((g.kind === "select" && g.mode === "marquee") || g.kind === "lasso" || (g.kind === "builder" && g.mode === "objects")) select(g.base);
      if (g.kind === "select" || g.kind === "guide" || g.kind === "board" || g.kind === "gradient" || g.kind === "connector" || g.kind === "symmetry") showGrip(null);
      // Il centro della simmetria torna dov'era.
      if (g.kind === "symmetry") setSymmetry({ ...ctx.symmetry, center: g.before });
      // I nodi tornano com'erano, e le forme e gli oggetti con loro.
      if (g.kind === "nodes") {
        ctx.focused = g.shapes;
        select(g.selection);
        setNodes(g.nodes);
      }
      clearPreviews();
      // Il tracciato della penna resta com'era prima del gesto, e le tavole
      // come prima del loro.
      if (g.kind === "bezier") showBezier();
      if (g.kind === "board") showPage();
      // Il ritaglio torna com'era prima del gesto.
      if (g.kind === "crop") {
        if (ctx.cropping !== null && g.start !== null) ctx.cropping.crop = g.start;
        showGrip(null);
        ctx.showCropBar(true);
        ctx.showCrop();
      }
    },
    ...(options.touch === undefined ? {} : { touch: options.touch }),
  };
  ctx.handlers = handlers;
  const pen = attachInkInput(surface, handlers, life);
  ctx.pen = pen;
}
