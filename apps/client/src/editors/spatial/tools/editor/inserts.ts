// L'editor del disegno: le note, Invio sul foglio e le forme delle raccolte. Un
// pezzo di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { PF1_DEFAULTS } from "../../../../ink/brush";
import { pf1Outline } from "../../../../ink/pf1";
import { quantizeInk } from "../../../../ink/sample";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { Bounds } from "../../scene/geometry";
import { apply, IDENTITY, type Point } from "../../scene/matrix";
import type { Op } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { t, type DrawKey } from "../../strings";
import { addOp, gesture as asGesture, NewIds, strokeElem, type Destination } from "../edit";
import { toScene } from "../../view";
import type { Unit } from "../hit";
import { boxAround as shapeBox, boxIn, forPreview, libraryElem } from "../library-insert";
import { libraryShape, type LibraryShape } from "../shape-library";
import { NOTE_SIZE, noteElem, noteLabel, promptNote, readNote, type NoteText } from "../note";
import { shapeElem } from "../shapes";
import { ADDED, HIT_PX } from "./constants";
import type { EditorContext } from "./context";
import { straight } from "../../../../ink/geometry";
import { nodeAtPath, translated } from "./helpers";
import type { ShapeDrag } from "./types";

/// Ciò che Invio aggiunge sul foglio delle annotazioni, in unità della
/// scena: un tratto o una linea larghi così, una forma alta la metà.
const KEYBOARD_SIZE = 96;

/// Ciò che le note, Invio sul foglio e le forme delle raccolte dà agli altri pezzi dell'editor.
export interface InsertsContext {
  noteOf: (unit: Unit) => NoteText | null;
  editNote: (unit: Unit) => Promise<void>;
  noteAt: (at: Point | null, pointer: InkPointerType) => void;
  editSelectedNote: () => boolean;
  keyboardAdd: () => void;
  onSheet: (clientX: number, clientY: number) => boolean;
  insertShape: (id: string) => void;
  cancelShapeDrag: (said?: boolean) => void;
  startShapeDrag: (id: string, event: PointerEvent) => void;
}

/// Monta le note, Invio sul foglio e le forme delle raccolte.
export function installInserts(ctx: EditorContext): void {
  const {
    life, folio, styles, style, toolLabel, root, surface, dock, previewLayer, editable, currentIndex, currentPage, grownPage, newIds, announce, objects,
    sceneAt, viewCenter, selectedUnits, showHandles, showShape, drawnPaint, commit, select, setTool, cancelGesture, target, snapped, guidesOn, guidesFor,
    snappedDelta
  } = ctx;
  // --- Le note e Invio sul foglio -----------------------------------------------
  //
  // Sul foglio delle annotazioni una nota è un testo col suo corpo: lo
  // strumento Nota ne scrive una dove si tocca, o cambia quella toccata. Invio,
  // senza niente di scelto, aggiunge nel punto della tastiera ciò che lo
  // strumento disegna.

  /// Il corpo e il testo disegnato di una nota; `null` se l'oggetto non lo è.
  const noteOf = (unit: Unit): NoteText | null => {
    if (unit.tag !== "text") return null;
    const model = ctx.engine.model;
    const node = unit.id !== null ? ctx.engine.holder(unit.id) : model === null ? null : nodeAtPath(model, unit.path);
    return node === null || node.kind !== "leaf" ? null : readNote(node);
  };
  ctx.noteOf = noteOf;

  /// Aggiunge `elem` dove dice `to`, e lo dice con `added`; con `keep`
  /// l'oggetto nuovo resta scelto, così le frecce lo spostano.
  const placeNew = (to: Destination, elem: Elem, label: DrawKey, added: DrawKey, keep: boolean): void => {
    if (commit(label, asGesture([...to.prelude, addOp(to, elem)])) === null) return;
    const id = elem.attrs.id;
    if (keep && id !== undefined) select([id]);
    announce(`${t(added)} ${objects()}`);
  };

  /// Chiede il corpo e l'etichetta di una nota, `note` se la si cambia:
  /// `null` se si annulla, o se intanto il documento è cambiato del tutto.
  const askNote = async (note?: NoteText): Promise<NoteText | null> => {
    if (ctx.asking) return null;
    const loaded = ctx.loads;
    ctx.asking = true;
    cancelGesture();
    try {
      const next = await promptNote(note === undefined ? {} : { note });
      return ctx.disposed || ctx.loads !== loaded || !editable() ? null : next;
    } finally {
      ctx.asking = false;
    }
  };

  /// Una nota nuova: la sua riga comincia in `at`, nella scena, e scende.
  /// Ha il colore della penna.
  const addNote = async (at: Point, keep: boolean): Promise<void> => {
    const note = await askNote();
    if (note === null) return;
    const ids = newIds();
    const to = target(ids);
    if (to === null) return;
    const [x, y] = apply(to.inverse, at);
    placeNew(to, noteElem(ids.next("object"), [x, y + NOTE_SIZE], styles.pen.color, note), toolLabel("note"), "draw.added.note", keep);
  };

  /// Cambia il corpo e l'etichetta di una nota. L'etichetta che segue il
  /// corpo si presenta vuota, e continua a seguirlo.
  const editNote = async (unit: Unit): Promise<void> => {
    const note = noteOf(unit);
    if (note === null || !editable()) return;
    const following = note.label === noteLabel(note.body, "");
    const next = await askNote(following ? { body: note.body, label: "" } : note);
    if (next === null || (next.body === note.body && next.label === note.label)) return;
    // Il documento può essere cambiato mentre il dialogo era aperto.
    const fresh = currentIndex().get(unit.key);
    if (fresh === null || noteOf(fresh) === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.missing_target") }));
      return;
    }
    const ops: Op[] = [];
    let id = fresh.id;
    if (id === null) {
      id = newIds().next("object");
      ops.push({ op: "ident", path: fresh.path, tag: "text", id });
    }
    ops.push({ op: "set", id, attrs: { "fub:note": next.body } }, { op: "text", id, lines: [next.label] });
    if (commit("draw.action.note", asGesture(ops)) === null) return;
    select([id]);
    announce(t("draw.note.changed"));
  };
  ctx.editNote = editNote;

  /// Un tocco con lo strumento Nota: su una nota la cambia, altrove ne
  /// scrive una.
  const noteAt = (at: Point | null, pointer: InkPointerType): void => {
    if (at === null || !editable()) return;
    const hit = currentIndex().at(at, HIT_PX[pointer] / ctx.camera.scale);
    if (hit !== null && noteOf(hit) !== null) void editNote(hit);
    else void addNote(at, false);
  };
  ctx.noteAt = noteAt;

  /// F2 o Invio sul foglio: la nota scelta, se è una sola, si cambia. Vero
  /// se c'era.
  const editSelectedNote = (): boolean => {
    const units = selectedUnits();
    if (units.length !== 1 || noteOf(units[0]!) === null || !editable()) return false;
    void editNote(units[0]!);
    return true;
  };
  ctx.editSelectedNote = editSelectedNote;

  /// Dove aggiunge la tastiera: al cursore, se qualcuno l'ha mosso, o al
  /// centro di ciò che si vede; abbastanza dentro la pagina perché un
  /// oggetto aggiunto da lì ci stia intero.
  const addSpot = (): Point => {
    const [x, y] = ctx.cursor ?? toScene(ctx.camera, viewCenter());
    const page = currentPage();
    if (page === null) return [x, y];
    const clamp = (value: number, min: number, size: number): number => {
      const margin = Math.min(KEYBOARD_SIZE / 2, size / 2);
      return Math.min(Math.max(value, min + margin), min + size - margin);
    };
    return [clamp(x, page.x, page.width), clamp(y, page.y, page.height)];
  };

  /// Invio sul foglio, senza niente di scelto: lo strumento aggiunge ciò che
  /// disegna nel punto della tastiera, e l'oggetto nuovo resta scelto. Un
  /// tratto è una riga dritta e una forma è larga [`KEYBOARD_SIZE`], attorno
  /// al punto; una nota comincia lì.
  const keyboardAdd = (): void => {
    if (folio === undefined || !editable() || ctx.asking) return;
    const [cx, cy] = addSpot();
    const half = KEYBOARD_SIZE / 2;
    const { color, width } = style();
    switch (ctx.tool) {
      case "note":
        void addNote([cx, cy], true);
        return;
      case "pen":
      case "highlighter": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return;
        const [x1, y1] = apply(to.inverse, [cx - half, cy]);
        const [x2, y2] = apply(to.inverse, [cx + half, cy]);
        // I pennelli di un tratto del puntatore senza pressione.
        const brush =
          ctx.tool === "highlighter"
            ? { ...PF1_DEFAULTS, size: width, thinning: 0, capStart: false, capEnd: false, sim: false }
            : { ...PF1_DEFAULTS, size: width, sim: true };
        let ink;
        try {
          ink = quantizeInk(straight([{ x: x1, y: y1, t: 0 }, { x: x2, y: y2, t: 250 }]));
          if (pf1Outline(ink, brush).length === 0) return;
        } catch {
          announce(t("draw.ink_failed"));
          return;
        }
        const highlight = ctx.tool === "highlighter";
        const elem = strokeElem(ids.next("object"), drawnPaint(color), brush, ink, new Date().toISOString(), ctx.tool);
        placeNew(to, elem, highlight ? "draw.action.highlight" : "draw.action.stroke", highlight ? "draw.added.highlight" : "draw.added.stroke", true);
        return;
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow":
      case "cover": {
        const ids = newIds();
        const to = target(ids);
        if (to === null) return;
        const flat = ctx.tool === "line" || ctx.tool === "arrow";
        const from = apply(to.inverse, [cx - half, flat ? cy : cy - half / 2]);
        const end = apply(to.inverse, [cx + half, flat ? cy : cy + half / 2]);
        const elem = shapeElem(ctx.tool, ids.next("object"), from, end, { color: drawnPaint(color), width }, 0);
        if (elem !== null) placeNew(to, elem, toolLabel(ctx.tool), ADDED[ctx.tool], true);
        return;
      }
      case "select":
        announce(t("draw.selected.none"));
        return;
      default:
        return;
    }
  };
  ctx.keyboardAdd = keyboardAdd;

  // --- Le forme delle raccolte ------------------------------------------------
  //
  // Una forma del pannello entra nel disegno in un passo solo, che porta il
  // nome della forma: con un clic, o con Invio, al centro di ciò che si
  // vede; trascinata fuori dal pannello, dove la si lascia. Mentre la si
  // tira il foglio la mostra com'è, alla sua misura e al zoom di adesso, col
  // centro sotto il puntatore e agganciata come un oggetto spostato (la
  // griglia e le guide, e Ctrl o ⌘ la lascia libera). Rilasciata fuori dal
  // foglio, o con Esc, non lascia traccia. Il puntatore lo tiene il riquadro
  // del pannello: i suoi eventi arrivano al documento, e il trascinamento
  // del browser, che nell'app prende i file, non c'entra.

  /// Il punto dello schermo è sul foglio, e non sotto un pannello.
  const onSheet = (clientX: number, clientY: number): boolean => {
    const rect = surface.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const top = surface.ownerDocument.elementFromPoint?.(clientX, clientY) ?? null;
    return top === null || !dock.contains(top);
  };
  ctx.onSheet = onSheet;

  /// Scrive la forma `shape` nel riquadro `box` della scena, di `to`, in un
  /// passo: scelta, e detta. Lo stile è quello delle forme che si
  /// disegnano. Falso se il documento non l'ha accettata.
  const placeShape = (shape: LibraryShape, to: Destination, ids: NewIds, box: Bounds): boolean => {
    const pen = styles.pen;
    const elem = libraryElem(shape, boxIn(box, to.inverse), { color: drawnPaint(pen.color, pen), width: pen.width }, t(shape.name), ids);
    const ops: Op[] = [...to.prelude, addOp(to, elem)];
    const half = pen.width / 2;
    const page = grownPage({ min: [box.min[0] - half, box.min[1] - half], max: [box.max[0] + half, box.max[1] + half] });
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit(shape.name, asGesture(ops)) === null) return false;
    // Una forma nuova si sceglie e si muove: con lo strumento Selezione.
    if (ctx.tool !== "select") setTool("select");
    select([elem.attrs.id!]);
    announce(`${t("draw.shapes.inserted", { name: t(shape.name) })} ${objects()}`);
    ctx.offerLabel();
    return true;
  };

  /// Inserisce la forma `id` al centro di ciò che si vede; con la griglia, il
  /// suo angolo in alto a sinistra va sull'incrocio più vicino.
  function insertShape(id: string): void {
    const shape = libraryShape(id);
    if (shape === null || !editable()) return;
    ctx.settleCrop();
    const ids = newIds();
    const to = target(ids);
    if (to === null) return;
    const [x, y] = snapped(shapeBox(shape, toScene(ctx.camera, viewCenter())).min);
    placeShape(shape, to, ids, { min: [x, y], max: [x + shape.size[0], y + shape.size[1]] });
  }
  ctx.insertShape = insertShape;

  /// La forma tirata, e dove andrebbe con il puntatore dove l'evento dice: il
  /// riquadro nella scena e il livello che la riceve; `null` fuori dal
  /// foglio, o dove niente la riceve.
  const dragPlace = (drag: ShapeDrag, event: PointerEvent): { readonly box: Bounds; readonly to: Destination } | null => {
    drag.over = onSheet(event.clientX, event.clientY);
    if (!drag.over) return null;
    const to = ctx.destinationNow();
    if (to === null) return null;
    const raw = shapeBox(drag.shape, sceneAt(event.clientX, event.clientY));
    const [dx, dy] = snappedDelta(0, 0, raw.min, raw, () => guidesFor(drag, []), drag.pointer);
    return { box: translated(raw, dx, dy)!, to };
  };

  /// Mostra la forma tirata dove andrebbe, e il cursore che dice se si può
  /// lasciare.
  const showShapeDrag = (drag: ShapeDrag, event: PointerEvent): void => {
    ctx.readModifiers(event);
    const place = dragPlace(drag, event);
    drag.box = place === null ? null : place.box;
    root.dataset.libraryDrop = place === null ? "none" : "copy";
    if (place === null) {
      showShape(null, IDENTITY);
    } else {
      const pen = styles.pen;
      const elem = libraryElem(drag.shape, boxIn(place.box, place.to.inverse), { color: drawnPaint(pen.color, pen), width: pen.width }, "", new NewIds(() => false));
      showShape(forPreview(elem), place.to.matrix);
    }
    // Le guide seguono la forma.
    if (guidesOn() || ctx.guiding) showHandles();
  };

  /// Finisce il trascinamento, senza scrivere: toglie la forma mostrata e il
  /// cursore.
  const endShapeDrag = (): void => {
    if (ctx.shapeDrag === null) return;
    ctx.shapeDrag = null;
    delete root.dataset.libraryDrop;
    previewLayer.removeAttribute("opacity");
    showShape(null, IDENTITY);
    showHandles();
  };

  /// Esc, un puntatore annullato, o il pannello che si chiude: la forma tirata
  /// non entra; con `said`, lo si dice.
  function cancelShapeDrag(said = false): void {
    if (ctx.shapeDrag === null) return;
    endShapeDrag();
    if (said) announce(t("draw.shapes.cancelled"));
  }
  ctx.cancelShapeDrag = cancelShapeDrag;

  /// Comincia a tirare la forma `id` dal pannello: `event` è il movimento che
  /// ha superato la soglia.
  function startShapeDrag(id: string, event: PointerEvent): void {
    const shape = libraryShape(id);
    if (shape === null || !editable() || ctx.shapeDrag !== null) return;
    cancelGesture();
    ctx.settleCrop();
    ctx.shapeDrag = { shape, pointerId: event.pointerId, pointer: event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse", over: false, box: null };
    previewLayer.setAttribute("opacity", "0.75");
    showShapeDrag(ctx.shapeDrag, event);
  }
  ctx.startShapeDrag = startShapeDrag;

  /// Rilascia la forma tirata: sul foglio entra dove sta; fuori no, e lo si
  /// dice. Dove il livello non riceve, si dice perché.
  const dropShape = (drag: ShapeDrag, event: PointerEvent): void => {
    showShapeDrag(drag, event);
    const { shape, box, over } = drag;
    endShapeDrag();
    if (box === null) {
      if (over) target(newIds());
      else announce(t("draw.shapes.cancelled"));
      return;
    }
    if (!editable()) return;
    ctx.settleCrop();
    const ids = newIds();
    const to = target(ids);
    // Chi ha lasciato la forma sul foglio continua lì, non nel pannello.
    if (to !== null && placeShape(shape, to, ids, box)) surface.focus({ preventScroll: true });
  };

  life.listen(surface.ownerDocument, "pointermove", (event) => {
    if (ctx.shapeDrag !== null && event.pointerId === ctx.shapeDrag.pointerId) showShapeDrag(ctx.shapeDrag, event);
  });
  life.listen(surface.ownerDocument, "pointerup", (event) => {
    if (ctx.shapeDrag !== null && event.pointerId === ctx.shapeDrag.pointerId) dropShape(ctx.shapeDrag, event);
  });
  life.listen(surface.ownerDocument, "pointercancel", (event) => {
    if (ctx.shapeDrag !== null && event.pointerId === ctx.shapeDrag.pointerId) cancelShapeDrag(true);
  });
  // Esc ferma il trascinamento prima di chiunque altro.
  life.listen(
    surface.ownerDocument,
    "keydown",
    (event) => {
      if (ctx.shapeDrag === null || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelShapeDrag(true);
    },
    { capture: true },
  );
  life.add(() => cancelShapeDrag());
}
