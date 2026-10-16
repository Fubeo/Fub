// L'editor del disegno: i segni sul foglio: la selezione, i nodi, la cornice e
// i collegamenti. Un pezzo di createDrawEditor (`../editor.ts`): lavora sul
// contesto che i pezzi condividono.

import { iconEl } from "../../../../ui/icons";
import { linkName } from "../../describe";
import type { Ink } from "../../ink/codec";
import type { InkPointerType } from "../../../../ink/dom/pen-input";
import type { Bounds } from "../../scene/geometry";
import { apply, compose, IDENTITY, invert, type Matrix, type Point } from "../../scene/matrix";
import { pathOf, type LeafNode } from "../../scene/model";
import { SVG_NS } from "../../scene/read";
import type { Elem } from "../../scene/serialize";
import { t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import { movedMatrix } from "../edit";
import { linkTarget, nodeOf, plainAttributes } from "../arrange";
import {
  angleOf,
  FRAME_PX,
  frameSize,
  frameView,
  gripCursor,
  movedFrame,
  normalized,
  pull,
  type Frame,
  type FrameView,
  type Grip,
  type GripCursor,
} from "../frame";
import {
  handleNode,
  handleSpot,
  handlesFor,
  kindOf,
  nodeKey,
  writeNodes,
  type HandleRef,
  type KindOf,
  type NodeKey,
  type NodeKind,
  type Subpath,
} from "../nodes";
import { inkSpine, nodableOf, type Nodable, type NoNodes } from "../nodable";
import type { Spine } from "../spine";
import { screenBox } from "../../view";
import type { Unit } from "../hit";
import { cornerGrip, cornerSpot, type CornerGrip } from "../reshape";
import { trackOf } from "../text-path";
import { HIT_PX, NO_KEYS, NO_KINDS, NO_NODES, NODE_PX, NODE_SHAPES } from "./constants";
import type { EditorContext } from "./context";
import { comparePaths, holdsPath, innerNode, matrixText, samePath, scaleOf, translated, union } from "./helpers";
import type { Editing } from "./types";

/// Di quanto il segno di un collegamento scelto si scosta, in pixel CSS, in
/// alto e a destra: oltre la maniglia d'angolo, che sporge di 4 dalla cornice.
const MARK_CLEAR_PX = FRAME_PX + 4;

/// Quanto lontano dal suo nodo si mostra una maniglia ritirata, in pixel:
/// abbastanza da prenderla senza prendere il nodo.
const FOLDED_PX = 20;

/// Quanto lontano dal suo nodo deve stare sullo schermo la maniglia di una
/// linea, o una ritirata, per mostrarsi, in pixel: più vicina coprirebbe il
/// nodo. Ingrandendo il foglio, si vede.
const LATENT_PX = 8;

/// Quanto dentro il vertice sta la maniglia degli angoli oltre il centro
/// dell'arco, in pixel: lontana dalle maniglie della cornice anche quando il
/// raggio è zero.
const CORNER_INSET_PX = 16;

/// Quanto deve poter scorrere sullo schermo la maniglia degli angoli perché
/// si mostri, in pixel: su una forma più piccola coprirebbe la forma.
const CORNER_ROOM_PX = 32;

/// Un collegamento che si vede, col suo segno sul foglio.
interface LinkMark {
  readonly unit: Unit;
  /// Dove porta, com'è scritto.
  readonly target: string;
  readonly element: HTMLButtonElement;
}

/// Vero se `a` e `b` hanno gli stessi sottotracciati con gli stessi nodi:
/// le chiavi dei nodi valgono per tutti e due.
function sameNodes(a: readonly Subpath[], b: readonly Subpath[]): boolean {
  return a.length === b.length && a.every((sub, s) => sub.nodes.length === b[s]!.nodes.length && sub.closed === b[s]!.closed);
}

/// Quante spine di tratti a penna l'editor ricorda.
const SPINES = 64;

/// Ciò che i segni sul foglio: la selezione, i nodi, la cornice e i collegamenti dà agli altri pezzi dell'editor.
export interface MarksContext {
  selectedUnits: () => Unit[];
  inOrder: (keys: Iterable<string>) => string[];
  remember: (text: string, spine: Spine) => void;
  nodableAt: (leaf: LeafNode) => Nodable | NoNodes;
  curveOn: () => boolean;
  resolveNodes: () => boolean;
  shapesKey: (shapes: readonly (readonly number[])[]) => string;
  editOf: (key: string) => Editing | undefined;
  pickedIn: (edit: Editing) => ReadonlySet<NodeKey>;
  chosenCount: () => number;
  chosenEdits: () => Editing[];
  editedUnits: () => string[];
  kindsOf: (edit: Editing, subs?: readonly Subpath[], given?: ReadonlyMap<string, NodeKind>) => KindOf;
  shownHandles: (edit: Editing, subs?: readonly Subpath[], chosen?: ReadonlySet<string>) => Array<{ readonly handle: HandleRef; readonly point: Point; readonly folded: boolean; }>;
  hoverNodes: (p: Point | null, pointer: InkPointerType) => void;
  frameOf: (units: readonly Unit[]) => Frame | null;
  frameNow: () => FrameView | null;
  areaChosen: () => Unit | null;
  frameCursor: (frame: Frame, grip: Grip) => GripCursor;
  measuresText: (arg0: readonly [number, number]) => string;
  degreesText: (degrees: number) => string;
  cornerAt: (p: Point, pointer: InkPointerType, view: FrameView | null, grip: Grip | null) => ReturnType<() => { readonly unit: Unit; readonly grip: CornerGrip; readonly spot: Point; } | null>;
  showGrip: (cursor: GripCursor | "rotating" | "move" | "copy" | null) => void;
  showHandles: () => void;
  /// I collegamenti che si vedono, ognuno col suo segno: si ricostruiscono
  /// quando cambia la scena.
  marks: LinkMark[] | null;
  openLink: (target: string) => void;
  showShape: (elem: Elem | null, matrix: Matrix, defs?: readonly Elem[]) => void;
  clearPreviews: () => void;
}

/// Monta i segni sul foglio: la selezione, i nodi, la cornice e i collegamenti.
export function installMarks(ctx: EditorContext): void {
  const {
    life, has, relabels, surface, linkLayer, painter, previewLayer, overlay, clearInk, builder, indexer, editable, currentIndex, readFirst, numberText,
    coordText, lengthText, showRulers, showGuideLines, options
  } = ctx;
  // --- Selezione e anteprime ----------------------------------------------

  /// Gli oggetti di `keys` che si scelgono adesso, anche dentro i gruppi,
  /// una volta sola e in ordine di documento; di un gruppo scelto non anche
  /// ciò che contiene, che si muove già con lui.
  const unitsOf = (keys: Iterable<string>): Unit[] => {
    const index = currentIndex();
    const found = new Map<string, Unit>();
    for (const key of keys) {
      const unit = index.get(key);
      if (unit !== null) found.set(unit.key, unit);
    }
    const out: Unit[] = [];
    // In ordine di documento chi contiene viene subito prima di ciò che
    // contiene: basta guardare l'ultimo tenuto.
    for (const unit of [...found.values()].sort((a, b) => comparePaths(a.path, b.path))) {
      const last = out[out.length - 1];
      if (last === undefined || !holdsPath(last.path, unit.path)) out.push(unit);
    }
    return out;
  };

  const selectedUnits = (): Unit[] => unitsOf(ctx.selection);
  ctx.selectedUnits = selectedUnits;

  /// Le chiavi di `keys` che sono oggetti adesso, come [`unitsOf`].
  const inOrder = (keys: Iterable<string>): string[] => unitsOf(keys).map((unit) => unit.key);
  ctx.inOrder = inOrder;

  // --- I nodi -------------------------------------------------------------

  /// Le spine dei tratti a penna, per inchiostro: una modifica ricorda
  /// quella che ha scritto, così i nodi restano quelli che si toccavano,
  /// anche dopo un annulla.
  const spines = new Map<string, Spine>();
  const spineOf = (text: string, ink: Ink, tolerance: number): Spine => {
    const known = spines.get(text);
    if (known !== undefined) return known;
    const spine = inkSpine(ink, tolerance);
    remember(text, spine);
    return spine;
  };
  const remember = (text: string, spine: Spine): void => {
    spines.delete(text);
    spines.set(text, spine);
    if (spines.size > SPINES) spines.delete(spines.keys().next().value!);
  };
  ctx.remember = remember;

  /// I nodi della forma `leaf`, o perché non ne ha. Si ricordano per
  /// elemento: un elemento che cambia è un altro, e il riquadro e il
  /// passaggio del puntatore li chiedono a ogni passo. Quelli di un testo su
  /// tracciato sono del tracciato, e si ricordano per tracciato: cambia
  /// senza che cambi il testo.
  const nodables = new WeakMap<object, Nodable | NoNodes>();
  const nodableAt = (leaf: LeafNode): Nodable | NoNodes => {
    const track = ctx.engine.model === null ? null : trackOf(ctx.engine.model, leaf);
    let found = nodables.get(track ?? leaf);
    if (found === undefined) {
      found = nodableOf(leaf, spineOf, () => (track === null ? null : plainAttributes(track).get("d") ?? null));
      nodables.set(track ?? leaf, found);
    }
    return found;
  };
  ctx.nodableAt = nodableAt;

  /// La Curvatura su un tracciato che c'è già: con la penna di Bézier nel
  /// modo Curvatura e nessun tracciato in corso, i nodi delle forme scelte
  /// si spostano, si aggiungono e si tolgono come li disegna la Curvatura.
  const curveOn = (): boolean => ctx.tool === "bezier" && ctx.curvature && ctx.drafting === null && has("bezier");
  ctx.curveOn = curveOn;

  /// Le forme di cui lo strumento Nodi modifica i nodi: con lo strumento
  /// Nodi, se il livello lo offre, o con la Curvatura ([`curveOn`]), col
  /// disegno che si scrive. Di ogni oggetto scelto, le forme scelte con lo
  /// strumento, o se non ce n'è nessuna tutte quelle che hanno nodi. Ogni
  /// forma ne ha, anche un rettangolo, una freccia o un tratto a penna; un
  /// testo su tracciato quelli del suo tracciato, una volta sola se lo
  /// seguono più testi scelti; un altro testo e un'immagine no. Senza
  /// nessuna forma, una chiave dice perché; `null`, che non c'è niente da
  /// dire.
  const nodeTargets = (): readonly Editing[] | DrawKey | null => {
    if (!((ctx.tool === "nodes" && has("nodes")) || curveOn()) || !editable() || ctx.selection.length === 0) return null;
    const out: Editing[] = [];
    let first: NoNodes | "flat" | null = null;
    const tracks = new Set<string>();
    for (const unit of selectedUnits()) {
      const found: Editing[] = [];
      const chosen: Editing[] = [];
      for (const shape of unit.shapes()) {
        const nodable = nodableAt(shape.leaf);
        if (typeof nodable === "string") {
          first ??= nodable;
          continue;
        }
        if (nodable.kind === "track") {
          if (tracks.has(nodable.target)) continue;
          tracks.add(nodable.target);
        }
        const inverse = invert(shape.matrix);
        if (inverse === null) {
          first ??= "flat";
          continue;
        }
        const path = pathOf(shape.leaf);
        const edit: Editing = {
          unit,
          leaf: shape.leaf,
          path,
          key: path.join("."),
          nodable,
          subs: nodable.subs,
          matrix: shape.matrix,
          inverse,
          paints: builder.paintsOf(shape.leaf),
        };
        found.push(edit);
        if (ctx.focused.some((each) => samePath(each, path))) chosen.push(edit);
      }
      out.push(...(chosen.length > 0 ? chosen : found));
    }
    if (out.length > 0) return out;
    return first === "flat" ? "draw.nodes.flat" : NO_NODES[first ?? "other"];
  };

  /// Ritrova le forme quando cambia ciò da cui dipendono: la scena, la
  /// selezione, lo strumento, il livello, la scrittura, le forme scelte. I
  /// nodi scelti e i tipi dati di una forma restano finché la forma è la
  /// stessa, con gli stessi nodi. Vero se le ha ritrovate.
  const resolveNodes = (): boolean => {
    const index = currentIndex();
    const keys = ctx.selection.join("\n");
    const canEdit = editable();
    const last = ctx.resolvedFor;
    if (
      last !== null && last.index === index && last.keys === keys && last.tool === ctx.tool && last.curve === curveOn() && last.features === ctx.features &&
      last.editable === canEdit && last.focused === ctx.focused
    ) return false;
    const before = new Map(ctx.edits.map((edit) => [edit.key, edit]));
    const found = nodeTargets();
    ctx.edits = found === null || typeof found === "string" ? [] : found;
    ctx.noEditing = typeof found === "string" ? found : null;
    // Una forma scelta che non si modifica più, perché il suo oggetto non è
    // più scelto o lo strumento è un altro, non lo è più.
    const still = ctx.focused.filter((path) => ctx.edits.some((edit) => samePath(edit.path, path)));
    if (still.length !== ctx.focused.length) ctx.focused = still;
    ctx.resolvedFor = { index, keys, tool: ctx.tool, curve: curveOn(), features: ctx.features, editable: canEdit, focused: ctx.focused };
    const same = new Set(ctx.edits.flatMap((edit) => {
      const was = before.get(edit.key);
      return was !== undefined && sameNodes(was.subs, edit.subs) ? [edit.key] : [];
    }));
    ctx.nodeSelection = new Map([...ctx.nodeSelection].filter(([key]) => same.has(key)));
    ctx.nodeKinds = new Map([...ctx.nodeKinds].filter(([key]) => same.has(key)));
    return true;
  };
  ctx.resolveNodes = resolveNodes;

  /// Le forme che si modificano, come chiave: cambiate, un tocco le dice.
  const shapesKey = (shapes: readonly (readonly number[])[]): string => shapes.map((path) => path.join(".")).join("\n");
  ctx.shapesKey = shapesKey;

  /// La forma di chiave `key`, fra quelle che si modificano.
  const editOf = (key: string): Editing | undefined => ctx.edits.find((edit) => edit.key === key);
  ctx.editOf = editOf;

  /// I nodi scelti della forma `edit`.
  const pickedIn = (edit: Editing): ReadonlySet<NodeKey> => ctx.nodeSelection.get(edit.key) ?? NO_KEYS;
  ctx.pickedIn = pickedIn;

  /// Quanti nodi sono scelti, in tutte le forme.
  const chosenCount = (): number => {
    let count = 0;
    for (const keys of ctx.nodeSelection.values()) count += keys.size;
    return count;
  };
  ctx.chosenCount = chosenCount;

  /// Le forme che hanno nodi scelti, in ordine di documento.
  const chosenEdits = (): Editing[] => ctx.edits.filter((edit) => pickedIn(edit).size > 0);
  ctx.chosenEdits = chosenEdits;

  /// Le chiavi degli oggetti delle forme che si modificano.
  const editedUnits = (): string[] => [...new Set(ctx.edits.map((edit) => edit.unit.key))];
  ctx.editedUnits = editedUnits;

  /// Il tipo di ogni nodo di `subs`, i nodi della forma `edit`: quello dato
  /// da chi modifica, `given`, o quello che si legge. I capi di un
  /// sottotracciato aperto non ne hanno uno, e valgono come spigoli.
  const kindsOf = (edit: Editing, subs = edit.subs, given = ctx.nodeKinds.get(edit.key) ?? NO_KINDS): KindOf => (s, at) => {
    const sub = subs[s]!;
    return innerNode(sub, at) ? given.get(nodeKey(s, at)) ?? kindOf(sub, at) : "corner";
  };
  ctx.kindsOf = kindsOf;

  /// Le maniglie che si vedono di `subs`, i nodi della forma `edit`, coi
  /// nodi `chosen` scelti: ognuna dove si vede ([`handleSpot`]), anche
  /// quella di una linea o di un arco, e quella ritirata sul suo nodo
  /// accanto a lui, lunga `FOLDED_PX` sullo schermo. Quella di una linea, o
  /// una ritirata, se sta più vicina al nodo di `LATENT_PX` non si vede.
  /// L'asta di una freccia non si piega: non ne ha.
  const shownHandles = (edit: Editing, subs = edit.subs, chosen = pickedIn(edit)): Array<{ readonly handle: HandleRef; readonly point: Point; readonly folded: boolean }> => {
    if (edit.nodable.kind === "arrow" || chosen.size === 0) return [];
    const m = edit.matrix;
    // Quanto è lungo sullo schermo un passo `direction` del tracciato.
    const onScreen = (direction: Point): number => Math.hypot(m[0] * direction[0] + m[2] * direction[1], m[1] * direction[0] + m[3] * direction[1]) * ctx.camera.scale;
    const stub = (direction: Point): number => {
      const size = onScreen(direction);
      return size > 0 ? FOLDED_PX / size : 0;
    };
    return handlesFor(subs, chosen).flatMap((handle) => {
      const spot = handleSpot(subs, handle, stub);
      if (spot === null) return [];
      const sub = subs[handle.sub]!;
      if (spot.folded || sub.links[handle.link]!.kind === "line") {
        const node = sub.nodes[handleNode(sub, handle)]!;
        if (onScreen([spot.point[0] - node[0], spot.point[1] - node[1]]) < LATENT_PX) return [];
      }
      return [{ handle, ...spot }];
    });
  };
  ctx.shownHandles = shownHandles;

  /// La forma `edit` come la lascia il trascinamento in corso: i nodi, e i
  /// nodi scelti e i tipi dati, che una maniglia tirata fuori può cambiare.
  const draftOfEdit = (edit: Editing): { readonly subs: readonly Subpath[]; readonly chosen: ReadonlySet<NodeKey>; readonly kinds: KindOf } => {
    const curve = ctx.current?.kind === "bezier" && ctx.current.path?.edit.key === edit.key ? ctx.current.reshaped : null;
    if (curve !== null) return { subs: curve.subs, chosen: new Set([curve.key]), kinds: kindsOf(edit, curve.subs, curve.kinds) };
    const g = ctx.current?.kind === "nodes" ? ctx.current : null;
    const subs = g?.draft?.get(edit.key) ?? edit.subs;
    const reshaped = g?.reshaped?.shape === edit.key && g.draft?.has(edit.key) === true ? g.reshaped : null;
    return { subs, chosen: reshaped?.chosen ?? pickedIn(edit), kinds: kindsOf(edit, subs, reshaped?.kinds) };
  };

  /// Il contorno della forma `edit`, le maniglie e i nodi, come li lascia il
  /// trascinamento se ce n'è uno: prima il contorno, sopra le maniglie, sopra
  /// ancora i nodi.
  const nodeHandles = (edit: Editing): OverlayHandle[] => {
    const { subs, chosen, kinds } = draftOfEdit(edit);
    const m = edit.matrix;
    const out: OverlayHandle[] = [{ kind: "outline", segments: writeNodes(subs), matrix: m }];
    // La Curvatura non mostra maniglie: vengono dai punti.
    for (const { handle, point, folded } of curveOn() ? [] : shownHandles(edit, subs, chosen)) {
      const [x, y] = apply(m, point);
      const sub = subs[handle.sub]!;
      // Il punto di una quadratica è dei suoi due nodi: una linea per
      // ciascuno.
      const owners = handle.which === "control" ? [handle.link, (handle.link + 1) % sub.nodes.length] : [handleNode(sub, handle)];
      for (const owner of owners) out.push({ kind: "control", x, y, node: apply(m, sub.nodes[owner]!), ...(folded ? { folded } : {}) });
    }
    subs.forEach((sub, s) => {
      sub.nodes.forEach((node, at) => {
        const [x, y] = apply(m, node);
        out.push({ kind: "node", x, y, shape: NODE_SHAPES[kinds(s, at)], selected: chosen.has(nodeKey(s, at)) });
      });
    });
    return out;
  };

  /// Il contorno e i nodi della forma sotto il puntatore, più tenui, se non
  /// è una di quelle che si modificano e se nessun gesto è in corso.
  const hoverHandles = (): OverlayHandle[] => {
    const hovered = ctx.nodesHover;
    if (hovered === null || hovered.subs === null || ctx.current !== null || ctx.tool !== "nodes" || hovered.index !== currentIndex()) return [];
    if (ctx.edits.some((edit) => edit.leaf === hovered.leaf)) return [];
    const m = hovered.matrix;
    const out: OverlayHandle[] = [{ kind: "outline", segments: writeNodes(hovered.subs), matrix: m, hint: true }];
    for (const sub of hovered.subs) {
      sub.nodes.forEach((node, at) => {
        const [x, y] = apply(m, node);
        out.push({ kind: "node", x, y, shape: NODE_SHAPES[innerNode(sub, at) ? kindOf(sub, at) : "corner"], selected: false, hint: true });
      });
    }
    return out;
  };

  /// Il puntatore passa sopra `p` senza premere: la forma che tocca mostra i
  /// suoi nodi, se ne ha, con lo strumento Nodi. Il dito non passa: tocca.
  const hoverNodes = (p: Point | null, pointer: InkPointerType): void => {
    let next: typeof ctx.nodesHover = null;
    if (p !== null && pointer !== "touch" && ctx.tool === "nodes" && has("nodes") && editable()) {
      const index = currentIndex();
      const tolerance = HIT_PX[pointer] / ctx.camera.scale;
      const unit = index.at(p, tolerance);
      const leaf = unit?.shapeAt(p, tolerance) ?? null;
      if (unit !== null && leaf !== null) {
        if (ctx.nodesHover !== null && ctx.nodesHover.leaf === leaf && ctx.nodesHover.index === index) return;
        const matrix = unit.shapes().find((shape) => shape.leaf === leaf)?.matrix ?? null;
        const nodable = matrix === null ? null : nodableAt(leaf);
        if (matrix !== null) next = { index, leaf, subs: nodable === null || typeof nodable === "string" ? null : nodable.subs, matrix };
      }
    }
    if (next === null && ctx.nodesHover === null) return;
    ctx.nodesHover = next;
    showHandles();
  };
  ctx.hoverNodes = hoverNodes;

  // --- La cornice di trasformazione ------------------------------------------

  /// La cornice di `units`: quella di un oggetto solo, che ruota con lui, o
  /// il riquadro comune di più oggetti, se non ne tengono uno loro. `null`
  /// se non disegnano niente.
  const frameOf = (units: readonly Unit[]): Frame | null => {
    if (units.length === 1) {
      const unit = units[0]!;
      const box = unit.frame();
      return box === null ? null : { matrix: unit.matrix, box, geometry: unit.shapeFrame() ?? box };
    }
    if (ctx.kept !== null && ctx.kept.index === currentIndex() && ctx.kept.keys === units.map((unit) => unit.key).join("\n")) return ctx.kept.frame;
    let box: Bounds | null = null;
    let geometry: Bounds | null = null;
    for (const unit of units) {
      box = union(box, unit.bounds);
      geometry = union(geometry, unit.geometry ?? unit.bounds);
    }
    return box === null ? null : { matrix: IDENTITY, box, geometry: geometry ?? box };
  };
  ctx.frameOf = frameOf;

  /// La cornice che si vede adesso: con lo strumento Selezione, se il
  /// disegno si scrive. Durante un gesto della cornice, com'è diventata;
  /// mentre si sposta o si sceglie col riquadro, nessuna, e nemmeno mentre
  /// si ritaglia, che ha i suoi segni.
  const frameNow = (): FrameView | null => {
    if (ctx.tool !== "select" || !editable() || ctx.selection.length === 0 || ctx.cropping !== null) return null;
    const g = ctx.current?.kind === "select" ? ctx.current : null;
    if (g !== null && (g.mode === "move" || g.mode === "marquee")) return null;
    if (g?.area?.box != null) return areaView(frameView({ matrix: g.area.unit.matrix, box: g.area.box, geometry: g.area.box }, ctx.camera.scale));
    if (g !== null && g.grip !== null) return areaView(frameView(g.matrix === null ? g.grip.frame : movedFrame(g.grip.frame, g.matrix), ctx.camera.scale));
    const frame = frameOf(selectedUnits());
    return frame === null ? null : areaView(frameView(frame, ctx.camera.scale));
  };
  ctx.frameNow = frameNow;

  /// Il testo in area scelto da solo, la cui cornice ne cambia il riquadro
  /// (livello Esperto); `null` per ogni altra selezione.
  const areaChosen = (): Unit | null => {
    if (!has("typeset") || ctx.selection.length !== 1) return null;
    const unit = selectedUnits()[0];
    return unit !== undefined && unit.role === "text" && unit.look?.wrap != null ? unit : null;
  };
  ctx.areaChosen = areaChosen;

  /// La cornice `view` di un testo in area: senza le maniglie in alto e in
  /// basso, perché l'altezza la fanno le righe.
  const areaView = (view: FrameView | null): FrameView | null =>
    view === null || areaChosen() === null ? view : { ...view, spots: view.spots.filter((spot) => spot.grip !== "n" && spot.grip !== "s") };

  /// Il cursore della maniglia `grip` della cornice `frame`: su un testo in
  /// area, ogni maniglia tranne quella della rotazione tira in orizzontale.
  const frameCursor = (frame: Frame, grip: Grip): GripCursor =>
    grip !== "rotate" && areaChosen() !== null ? gripCursor(frame, pull(grip, 0) < 0 ? "w" : "e", ctx.camera.angle) : gripCursor(frame, grip, ctx.camera.angle);
  ctx.frameCursor = frameCursor;

  /// Le misure e gli angoli come si leggono sulla cornice: le misure
  /// nell'unità del documento, con la sigla una volta in fondo.
  const measuresText = ([width, height]: readonly [number, number]): string => `${coordText(width)} × ${lengthText(height)}`;
  ctx.measuresText = measuresText;
  const degreesText = (degrees: number): string => `${numberText(degrees)}°`;
  ctx.degreesText = degreesText;

  /// La cornice fra le maniglie: il riquadro comune di più oggetti, le
  /// maniglie, e mentre la si tira le misure o l'angolo, sotto di lei.
  const frameHandles = (): OverlayHandle[] => {
    const view = frameNow();
    if (view === null) return [];
    const out: OverlayHandle[] = [];
    const { min, max } = view.padded;
    if (ctx.selection.length > 1) {
      out.push({ kind: "box", x: min[0], y: min[1], width: max[0] - min[0], height: max[1] - min[1], matrix: view.frame.matrix });
    }
    for (const { grip, at } of view.spots) {
      out.push(grip === "rotate" ? { kind: "rotor", x: at[0], y: at[1], stem: view.stem } : { kind: "grip", x: at[0], y: at[1] });
    }
    const corner = cornerNow();
    if (corner !== null) {
      out.push({ kind: "corner", x: corner.spot[0], y: corner.spot[1] });
      // Mentre la si tira, il raggio sotto di lei.
      const drag = ctx.current?.kind === "select" && ctx.current.mode === "corner" ? ctx.current.corner : null;
      if (drag !== null) out.push({ kind: "label", x: corner.spot[0], y: corner.spot[1], text: lengthText(drag.radius * scaleOf(drag.unit.matrix)) });
    }
    const g = ctx.current?.kind === "select" && (ctx.current.mode === "resize" || ctx.current.mode === "rotate") ? ctx.current : null;
    if (g !== null) {
      const corners = [min, [max[0], min[1]], max, [min[0], max[1]]].map((corner) => apply(view.frame.matrix, corner as Point));
      const x = corners.reduce((sum, corner) => sum + corner[0], 0) / 4;
      const y = Math.max(...corners.map((corner) => corner[1]));
      const text = g.mode === "rotate" ? degreesText(normalized(angleOf(g.grip!.frame.matrix) + g.angle)) : measuresText(frameSize(view.frame));
      out.push({ kind: "label", x, y, text });
    }
    return out;
  };

  /// La maniglia degli angoli che si vede: con lo strumento Selezione e un
  /// poligono, una stella o un rettangolo scelto da solo, abbastanza grande
  /// sullo schermo perché la maniglia abbia dove scorrere; durante il suo
  /// gesto, dove la si tira. Mentre la cornice si tira, nessuna.
  const cornerNow = (): { readonly unit: Unit; readonly grip: CornerGrip; readonly spot: Point } | null => {
    const g = ctx.current?.kind === "select" ? ctx.current : null;
    const inset = (unit: Unit): number => CORNER_INSET_PX / (scaleOf(unit.matrix) * ctx.camera.scale);
    if (g !== null && g.corner !== null) {
      const { unit, grip, radius } = g.corner;
      return { unit, grip, spot: cornerSpot(grip, unit.matrix, radius, inset(unit)) };
    }
    if ((g !== null && g.mode !== "pending") || ctx.tool !== "select" || !editable() || !has("polygon") || ctx.selection.length !== 1) return null;
    const unit = selectedUnits()[0];
    const grip = unit === undefined ? null : cornerGrip(unit.node, unit.role, unit.matrix);
    if (unit === undefined || grip === null) return null;
    const k = scaleOf(unit.matrix) * ctx.camera.scale;
    if (!(k > 0) || grip.max * grip.reach * k < CORNER_ROOM_PX) return null;
    return { unit, grip, spot: cornerSpot(grip, unit.matrix, grip.radius, inset(unit)) };
  };

  /// La maniglia degli angoli sotto `p`, col puntatore `pointer`: se c'è, e
  /// se è più vicina della maniglia `grip` della cornice `view`, che `p`
  /// prende anche lei.
  const cornerAt = (p: Point, pointer: InkPointerType, view: FrameView | null, grip: Grip | null): ReturnType<typeof cornerNow> => {
    const corner = cornerNow();
    if (corner === null) return null;
    const away = Math.hypot(p[0] - corner.spot[0], p[1] - corner.spot[1]) * ctx.camera.scale;
    if (away > NODE_PX[pointer]) return null;
    const spot = grip === null ? undefined : view?.spots.find((each) => each.grip === grip);
    if (spot !== undefined && Math.hypot(p[0] - spot.at[0], p[1] - spot.at[1]) * ctx.camera.scale < away) return null;
    return corner;
  };
  ctx.cornerAt = cornerAt;

  /// Il cursore del foglio sopra una maniglia, o durante il suo gesto; sopra
  /// una tavola, con lo strumento Tavola, quello che sposta, o con Alt,
  /// mentre la si sposta, quello che copia.
  const showGrip = (cursor: GripCursor | "rotating" | "move" | "copy" | null): void => {
    if (cursor === null) delete surface.dataset.grip;
    else surface.dataset.grip = cursor;
  };
  ctx.showGrip = showGrip;

  /// Le cornici della selezione, i nodi del tracciato che si modifica, e il
  /// riquadro di un trascinamento sul vuoto.
  const showHandles = (): void => readFirst(placeHandles);
  ctx.showHandles = showHandles;

  const placeHandles = (): void => {
    if (resolveNodes()) ctx.syncArrange();
    const handles: OverlayHandle[] = [];
    const move = ctx.current?.kind === "select" && ctx.current.mode === "move" ? ctx.current : null;
    const delta = move === null ? null : ctx.moveDelta(move);
    const shaping = ctx.current?.kind === "select" && (ctx.current.mode === "resize" || ctx.current.mode === "rotate") ? ctx.current.matrix : null;
    // Il testo in area di cui si tira la cornice ha il riquadro di adesso.
    const area = ctx.current?.kind === "select" && ctx.current.mode === "resize" ? ctx.current.area : null;
    let band: Bounds | null = null;
    const edited = new Set(editedUnits());
    // Col Costruttore le forme si vedono nelle loro regioni; mentre si
    // scelgono gli oggetti, e per una forma che taglia soltanto, la cornice.
    const builder = ctx.current?.kind === "builder" && ctx.current.mode === "objects" ? null : ctx.builderNow();
    const built = new Set(builder === null ? [] : builder.shapes.filter((_, k) => !builder.cuts[k]).map((unit) => unit.key));
    for (const unit of selectedUnits()) {
      const cropped = ctx.cropping?.key === unit.key ? ctx.cropping.crop.rect : null;
      const frame = cropped ?? (area !== null && area.unit.key === unit.key && area.box !== null ? area.box : unit.frame());
      if (frame === null) continue;
      let matrix = unit.matrix;
      if (delta !== null) {
        const moved = movedMatrix(unit, delta[0], delta[1]);
        if (moved !== null) matrix = compose(unit.parent, moved);
      } else if (shaping !== null) {
        matrix = compose(shaping, matrix);
      }
      // I righelli segnano dove sta la selezione, anche a metà gesto.
      for (const corner of [frame.min, [frame.max[0], frame.min[1]], frame.max, [frame.min[0], frame.max[1]]] as const) {
        const [x, y] = apply(matrix, corner as Point);
        band = union(band, { min: [x, y], max: [x, y] });
      }
      // Un oggetto di cui si modificano i nodi mostra i nodi, non la
      // cornice, e un'immagine che si ritaglia i segni del ritaglio.
      if (edited.has(unit.key) || built.has(unit.key) || cropped !== null) continue;
      // Il margine è lo stesso sullo schermo lungo i due assi, anche per un
      // oggetto scalato più in un verso che nell'altro.
      const sx = Math.hypot(matrix[0], matrix[1]) * ctx.camera.scale;
      const sy = Math.hypot(matrix[2], matrix[3]) * ctx.camera.scale;
      const padX = sx > 0 ? FRAME_PX / sx : 0;
      const padY = sy > 0 ? FRAME_PX / sy : 0;
      handles.push({
        kind: "box",
        x: frame.min[0] - padX,
        y: frame.min[1] - padY,
        width: frame.max[0] - frame.min[0] + 2 * padX,
        height: frame.max[1] - frame.min[1] + 2 * padY,
        matrix,
      });
    }
    handles.push(...frameHandles());
    handles.push(...ctx.boardHandles());
    handles.push(...hoverHandles());
    handles.push(...ctx.regionHandles());
    handles.push(...ctx.cutHandles());
    handles.push(...ctx.widthHandles());
    handles.push(...ctx.dropperHandles());
    handles.push(...ctx.gradientOverlay());
    handles.push(...ctx.pathsHandles());
    handles.push(...ctx.cropHandles());
    handles.push(...ctx.connectorHandles());
    handles.push(...ctx.symmetryHandles());
    for (const edit of ctx.edits) handles.push(...nodeHandles(edit));
    if (ctx.drafting !== null || ctx.current?.kind === "bezier") handles.push(...ctx.bezierHandles());
    const lasso = ctx.current?.kind === "select" && ctx.current.mode === "marquee"
      ? ctx.current
      : (ctx.current?.kind === "nodes" && ctx.current.dragging && ctx.current.grab?.kind === "marquee") || (ctx.current?.kind === "builder" && ctx.current.mode === "objects" && ctx.current.dragging)
        ? ctx.current
        : null;
    if (lasso !== null && lasso.from !== null && lasso.end !== null) {
      const [x1, y1] = lasso.from;
      const [x2, y2] = lasso.end;
      const slanted = ctx.slantedMarquee(lasso.from, lasso.end);
      handles.push({ kind: "lasso", points: slanted === null ? [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] : [...slanted.corners] });
    }
    if (ctx.current?.kind === "lasso" && ctx.current.dragging) handles.push({ kind: "lasso", points: [...ctx.current.points] });
    if (ctx.current?.kind === "text" && ctx.current.dragging && ctx.current.from !== null && ctx.current.end !== null) {
      const [x1, y1] = ctx.current.from;
      const [x2, y2] = ctx.current.end;
      handles.push({ kind: "lasso", points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] });
    }
    if (ctx.current?.kind === "builder" && ctx.current.mode === "regions" && ctx.current.dragging) handles.push({ kind: "trail", points: [...ctx.current.trail] });
    // Sopra una regione, il cursore dice che il tocco e il trascinamento
    // uniscono; con Alt, che tolgono, lo dice il tratteggio.
    surface.toggleAttribute("data-region", ctx.tool === "builder" && !ctx.alt && (ctx.current?.kind === "builder" ? ctx.current.mode === "regions" : ctx.regionHover >= 0));
    // Le guide e le misure stanno sopra a tutto.
    const guides = ctx.guideHandles();
    const measures = ctx.measureHandles();
    ctx.guiding = guides.length > 0;
    ctx.measured = measures.length > 0;
    handles.push(...guides, ...measures, ...ctx.guideLabel());
    overlay.setHandles(handles);
    ctx.selectionBand = band;
    showRulers();
    ctx.placeBar();
    showLinks(delta);
    const keys = ctx.selection.join("\n");
    if (keys !== ctx.noticed) {
      ctx.noticed = keys;
      ctx.followSelection();
      ctx.syncTree();
      ctx.syncInspector();
      ctx.syncProperties();
      options.onSelectionChange?.();
    }
    // La tavola scelta è la selezione dello strumento Tavola.
    const board = ctx.tool === "board" ? ctx.boardChosen : null;
    if (board !== ctx.noticedBoard) {
      ctx.noticedBoard = board;
      ctx.syncProperties();
      ctx.syncBoards();
    }
  };

  // --- I segni dei collegamenti ---------------------------------------------

  ctx.marks = null;

  const labelMarks = (): void => {
    for (const { target, element } of ctx.marks ?? []) {
      const text = t("draw.link.open", { note: linkName(target) });
      element.setAttribute("aria-label", text);
      element.title = text;
    }
  };
  relabels.push(labelMarks);

  /// I segni sullo schermo. Durante uno spostamento seguono gli oggetti
  /// scelti, di `delta` nella scena, e i collegamenti che contengono; durante
  /// un ridimensionamento o una rotazione, la loro trasformazione. Con la
  /// Selezione il segno di un oggetto scelto si scosta, per lasciare libera
  /// la maniglia della cornice sul suo angolo.
  function showLinks(delta: readonly [number, number] | null = null): void {
    if (options.links === undefined) return;
    if (ctx.marks === null) {
      const model = ctx.engine.model;
      const list: LinkMark[] = [];
      for (const unit of model === null ? [] : indexer.links(model)) {
        const target = linkTarget(nodeOf(model!, unit));
        if (target === null || unit.bounds === null) continue;
        const element = document.createElement("button");
        element.type = "button";
        element.className = "draw-link-mark";
        element.tabIndex = -1;
        element.dataset.mark = String(list.length);
        const svg = iconEl("draw-link");
        if (svg !== null) element.append(svg);
        list.push({ unit, target, element });
      }
      ctx.marks = list;
      linkLayer.replaceChildren(...list.map((mark) => mark.element));
      labelMarks();
    }
    const shaping = ctx.current?.kind === "select" && (ctx.current.mode === "resize" || ctx.current.mode === "rotate") ? ctx.current.matrix : null;
    // Anche mentre si sposta, quando la cornice non si vede: il segno non salta.
    const framed = ctx.tool === "select" && editable();
    const chosen = delta !== null || shaping !== null || framed ? selectedUnits().map((unit) => unit.path) : [];
    for (const { unit, element } of ctx.marks) {
      const inside = chosen.some((path) => path.every((at, i) => unit.path[i] === at));
      let bounds = unit.bounds!;
      if (inside && delta !== null) bounds = translated(bounds, delta[0], delta[1])!;
      else if (inside && shaping !== null) bounds = unit.boundsAfter(shaping) ?? bounds;
      const clear = framed && inside ? MARK_CLEAR_PX : 0;
      // In alto a destra dell'oggetto come si vede, anche sul foglio girato.
      const box = screenBox(ctx.camera, bounds);
      element.style.transform = `translate(${box.max[0] + clear}px, ${box.min[1] - clear}px)`;
    }
  }

  /// Apre la nota a cui porta `target`: il gesto in corso si annulla, e un
  /// testo che si scrive si chiude.
  const openLink = (target: string): void => {
    const links = options.links;
    if (links === undefined) return;
    ctx.finishText();
    ctx.cancelGesture();
    links.open(target);
  };
  ctx.openLink = openLink;

  life.listen(linkLayer, "click", (event) => {
    const element = event.target instanceof Element ? event.target.closest(".draw-link-mark") : null;
    const mark = element instanceof HTMLElement ? ctx.marks?.[Number(element.dataset.mark)] : undefined;
    if (mark !== undefined) openLink(mark.target);
  });

  /// Mostra `elem`, una forma che si sta disegnando, nella scena con
  /// `matrix`; `defs` sono le risorse che usa, come la punta di un
  /// connettore.
  const showShape = (elem: Elem | null, matrix: Matrix, defs: readonly Elem[] = []): void => {
    previewLayer.replaceChildren();
    if (elem === null) return;
    previewLayer.setAttribute("transform", matrixText(matrix));
    const build = (each: Elem): SVGElement => {
      const shape = document.createElementNS(SVG_NS, each.tag);
      // I nomi con un prefisso sono dati di FubDraw: non si disegnano.
      for (const [name, value] of Object.entries(each.attrs)) if (!name.includes(":")) shape.setAttribute(name, value);
      for (const child of each.children ?? []) shape.append(build(child));
      // Il testo di una riga, come in un `tspan`.
      if (each.text !== undefined && each.text !== null) shape.textContent = each.text;
      return shape;
    };
    if (defs.length > 0) {
      const holder = document.createElementNS(SVG_NS, "defs");
      for (const each of defs) holder.append(build(each));
      previewLayer.append(holder);
    }
    previewLayer.append(build(elem));
  };
  ctx.showShape = showShape;

  const clearPreviews = (): void => {
    clearInk();
    showShape(null, [1, 0, 0, 1, 0, 0]);
    painter.setDraft(null);
    ctx.gradientShown = false;
    showGuideLines();
    showHandles();
    overlay.flush();
  };
  ctx.clearPreviews = clearPreviews;
}
