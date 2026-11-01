// L'editor del disegno: le note e Invio sul foglio. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { INK_TOOLS } from "../../../../ink/tools/registry";
import { buildStroke } from "../../../../ink/tools/stroke";
import type { InkPointerType } from "../../../../ink/input/pointer";
import { apply, type Point } from "../../scene/matrix";
import type { Op } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { t, type DrawKey } from "../../strings";
import { addOp, gesture as asGesture, strokeElem, type Destination } from "../edit";
import { toScene } from "../../view";
import type { Unit } from "../hit";
import { NOTE_SIZE, noteElem, noteLabel, promptNote, readNote, type NoteText } from "../note";
import { shapeElem } from "../shapes";
import { ADDED, HIT_PX } from "./constants";
import type { EditorContext } from "./context";
import { straight } from "../../../../ink/geometry";
import { nodeAtPath } from "./helpers";

/// Ciò che Invio aggiunge sul foglio delle annotazioni, in unità della
/// scena: un tratto o una linea larghi così, una forma alta la metà.
const KEYBOARD_SIZE = 96;

/// Ciò che le note e Invio sul foglio danno agli altri pezzi dell'editor.
export interface InsertsContext {
  noteOf: (unit: Unit) => NoteText | null;
  editNote: (unit: Unit) => Promise<void>;
  noteAt: (at: Point | null, pointer: InkPointerType) => void;
  editSelectedNote: () => boolean;
  keyboardAdd: () => void;
}

/// Monta le note e Invio sul foglio.
export function installInserts(ctx: EditorContext): void {
  const {
    folio, styles, style, toolLabel, editable, currentIndex, currentPage, newIds, announce, objects,
    viewCenter, selectedUnits, commit, select, cancelGesture, target
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
        // Il pennello di un tratto del puntatore senza pressione.
        const tool = INK_TOOLS.stroke(ctx.tool);
        if (tool === undefined) return;
        const brush = tool.brush(width, { pressure: false, continued: false }, ctx.penId);
        const built = buildStroke(straight([{ x: x1, y: y1, t: 0 }, { x: x2, y: y2, t: 250 }]), brush, []);
        if (!built.ok) {
          if (built.reason === "failed") announce(t("draw.ink_failed"));
          return;
        }
        const highlight = ctx.tool === "highlighter";
        const elem = strokeElem(ids.next("object"), color, brush, built.ink, new Date().toISOString(), ctx.tool, ctx.tool === "highlighter" ? ctx.inkOpacity.highlighter : ctx.inkOpacity.pen);
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
        const elem = shapeElem(ctx.tool, ids.next("object"), from, end, { color: color, width }, 0);
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
}
