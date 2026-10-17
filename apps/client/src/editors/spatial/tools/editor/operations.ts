// L'editor del disegno: le operazioni e il gruppo isolato. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { describe, keyOf } from "../../describe";
import { editableDialog, fadedMarkup } from "../editable-dialog";
import type { EditablePlan, EditableScope } from "../make-editable";
import { selfContained } from "../../picture";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { Bounds } from "../../scene/geometry";
import { IDENTITY, translate, type Point } from "../../scene/matrix";
import { elementChildren, pathOf, tagName, titleOf, type ContainerNode, type ElementPart, type LeafNode } from "../../scene/model";
import type { Applied } from "../../scene/engine";
import type { Op, Reason } from "../../scene/ops";
import { plural, t, type DrawKey } from "../../strings";
import { gesture as asGesture, moveOps, removeOps } from "../edit";
import { instanceSymbol } from "../symbols";
import { labelsOf } from "../connectors";
import { movedFrame } from "../frame";
import { placedAt, screenBox } from "../../view";
import type { Unit } from "../hit";
import type { Mark, Replay } from "../history";
import type { DrawChange } from "../editor";
import { FIT_PAD, HIT_PX } from "./constants";
import type { EditorContext } from "./context";
import { translated, union } from "./helpers";

/// Quanti byte delle immagini del vault entrano in ciascuna anteprima della
/// finestra di «Rendi modificabile»: oltre, un'immagine si vede come il
/// segnaposto.
const EDITABLE_IMAGE_BYTES = 16 * 1024 * 1024;

/// Perché il motore ha rifiutato un gesto, detto a chi disegna.
const REASONS: Readonly<Record<Reason, DrawKey>> = {
  "missing-target": "draw.reason.missing_target",
  "missing-parent": "draw.reason.missing_parent",
  "missing-anchor": "draw.reason.missing_target",
  "duplicate-id": "draw.reason.duplicate_id",
  "in-use": "draw.reason.in_use",
  "invalid-elem": "draw.reason.invalid",
  locked: "draw.reason.locked",
  foreign: "draw.reason.foreign",
  cycle: "draw.reason.cycle",
  limit: "draw.reason.limit",
  "read-only": "draw.reason.read_only",
};

/// Ciò che le operazioni e il gruppo isolato dà agli altri pezzi dell'editor.
export interface OperationsContext {
  attempt: (label: DrawKey, op: Op | null) => Applied | string | null;
  commit: (label: DrawKey, op: Op | null) => Applied | null;
  goToPoint: (at: number, mark: Mark | null) => void;
  markHere: () => void;
  renameMark: (id: number, name: string) => void;
  unmark: (id: number) => void;
  undo: () => void;
  redo: () => void;
  withLabels: (units: readonly Unit[]) => Unit[];
  deleteSelection: () => void;
  hookedIn: (units: readonly Unit[]) => ReadonlySet<string>;
  detachedNote: (hooked: ReadonlySet<string>) => string;
  moveSelection: (units: readonly Unit[], dx: number, dy: number, note?: string) => void;
  select: (keys: readonly string[]) => void;
  keyOfNode: (node: ElementPart) => string;
  nameOfNode: (node: ElementPart) => string;
  /// Il percorso che la barra mostra adesso, per non rifarla uguale.
  isolationShown: string | null;
  showIsolation: () => void;
  rescope: (keys: readonly string[]) => void;
  isolate: (unit: Unit, at: Point | null, pointer?: InkPointerType) => boolean;
  leaveIsolation: (all: boolean) => boolean;
  isolateAt: (depth: number) => void;
  isolable: (unit: Unit) => boolean;
  isolateSelection: () => void;
  editSymbol: () => void;
  frameBounds: (bounds: Bounds | null) => void;
  reveal: (offset: number) => boolean;
  adopt: () => boolean;
  makeEditable: (scope: EditableScope, all: boolean) => Promise<boolean>;
  setReadOnly: (readOnly: boolean) => void;
}

/// Monta le operazioni e il gruppo isolato.
export function installOperations(ctx: EditorContext): void {
  const {
    folio, has, pictureFonts, kindsAt, history, surface, historyPanel, isolationBar, isolationPath, nameIsolation, painter, indexer, boardsNow,
    chosenSheet, editable, isolatedNode, isolatedThrough, isolationOf, isolationSteps, isolationChain, currentIndex, grownPage, newIds, announce, objects,
    announceSelection, showPage, setCamera, viewArea, fitted, selectedUnits, inOrder, resolveNodes, frameOf, showHandles, clearPreviews, outlineNow,
    labelOf, syncTree, syncHistory, oneRound, choose, followSelection, syncControls, refresh, options
  } = ctx;
  // --- Operazioni -----------------------------------------------------------

  const emit = (applied: Pick<Applied, "text" | "operation" | "duplicate">, origin: DrawChange["origin"]): void => {
    if (applied.duplicate) return;
    options.onChange?.({ text: applied.text, operation: applied.operation, origin });
  };

  /// Il gesto `op` con ciò che il foglio porta in coda.
  const withSheet = (op: Op): Op => {
    const extra = folio === undefined || ctx.engine.model === null ? [] : folio.extra(ctx.engine.model);
    if (extra.length === 0) return op;
    return op.op === "batch" ? { ...op, ops: [...op.ops, ...extra] } : { op: "batch", ops: [op, ...extra] };
  };

  /// Applica il gesto `op` come `commit`, in silenzio: un rifiuto rende la
  /// sua ragione, a parole.
  const attempt = (label: DrawKey, op: Op | null): Applied | string | null => {
    if (op === null || !editable()) return null;
    // La misura del foglio si legge prima che il passo tocchi il disegno: dopo
    // le scritture costerebbe una rimisura ogni volta.
    const outcome = oneRound(() => {
      const applied = ctx.engine.apply(withSheet(op));
      if (applied.outcome === "rejected") return applied;
      history.record(label, applied);
      refresh();
      return applied;
    });
    if (outcome.outcome === "rejected") {
      clearPreviews();
      return t(REASONS[outcome.reason]);
    }
    emit(outcome, "input");
    return outcome;
  };
  ctx.attempt = attempt;

  /// Applica il gesto `op` e lo mette nella cronologia col nome `label`.
  const commit = (label: DrawKey, op: Op | null): Applied | null => {
    const outcome = attempt(label, op);
    if (typeof outcome !== "string") return outcome;
    announce(t("draw.rejected", { reason: outcome }));
    return null;
  };
  ctx.commit = commit;

  /// La superficie dopo un annulla, un ripeti o un salto nella cronologia:
  /// la scena nuova, e la selezione che segue ciò che l'ultimo passo ha
  /// toccato e che c'è ancora, e così il livello corrente.
  const landed = (ids: readonly string[]): void => oneRound(() => landOn(ids));

  const landOn = (ids: readonly string[]): void => {
    // Il posto della tavola scelta, prima del passo.
    const chosenAt = ctx.tool === "board" && ctx.boardChosen !== null ? boardsNow().findIndex((each) => each.id === ctx.boardChosen) : -1;
    refresh();
    // Con lo strumento Tavola si sceglie la tavola toccata, non gli oggetti;
    // se il passo ha tolto quella scelta, quella che le stava prima, o la
    // pagina quando non ce n'è più: chi annulla la tavola nuova ritrova
    // quella da cui era partito.
    const board = ctx.tool === "board" ? boardsNow().find((each) => ids.includes(each.id)) : undefined;
    if (board !== undefined) {
      ctx.boardChosen = board.id;
      showPage();
    } else if (chosenAt >= 0 && chosenSheet() === null) {
      const list = boardsNow();
      ctx.boardChosen = list.length === 0 ? ctx.sheetInView() : list[Math.min(Math.max(chosenAt - 1, 0), list.length - 1)]!.id;
      showPage();
    }
    const touched = ctx.tool === "board" ? [] : inOrder(ids);
    if (touched.length > 0) ctx.selection = touched;
    const layer = has("layers") ? currentIndex().layers.find((other) => other.id !== null && ids.includes(other.id)) : undefined;
    if (layer !== undefined) choose(layer);
    else if (touched.length > 0) followSelection();
    syncControls();
    // I tipi dati ai nodi tornano come erano a questo punto.
    resolveNodes();
    const kinds = kindsAt.get(history.position);
    if (kinds !== undefined) ctx.nodeKinds = kinds;
    showHandles();
  };

  const replay = (step: Replay | null, origin: "undo" | "redo"): void => {
    if (step === null) return;
    const action = t(step.step.label);
    if (step.outcome.outcome === "rejected") {
      syncControls();
      announce(t(origin === "undo" ? "draw.undo.failed" : "draw.redo.failed", { action }));
      return;
    }
    landed(step.outcome.touched);
    emit(step.outcome, origin);
    announce(t(origin === "undo" ? "draw.undone" : "draw.redone", { action }));
  };

  /// Dove si è nella cronologia, a parole, per dire dove ha portato un
  /// salto: al segno `mark`, se il salto è arrivato al suo punto.
  const whereNow = (mark: Mark | null): string => {
    const at = history.position;
    if (mark !== null && mark.at === at) return t("draw.history.where.mark", { name: mark.name });
    if (at === history.start) return t(history.trimmed ? "draw.history.where.start" : "draw.history.where.opened");
    const step = history.steps()[history.done - 1]!;
    return t("draw.history.where.step", { action: t(step.label) });
  };

  /// Va al punto `at` della cronologia in un colpo, dal suo pannello: i
  /// passi in mezzo si annullano o si ripetono insieme, e il documento cambia
  /// una volta sola. Ciò che si sta scrivendo o tracciando si conclude prima,
  /// come cambiando strumento. `mark` è il segno da cui ci si va, per dirlo.
  function goToPoint(at: number, mark: Mark | null): void {
    if (!editable()) return;
    // Un salto che sposta il disegno lascia il ritaglio aperto, come annulla.
    if (at !== history.position) ctx.cancelCrop();
    ctx.finishText();
    ctx.cancelGesture();
    ctx.finishBezier(false, true);
    const jump = history.goTo(ctx.engine, at);
    if (jump === null) {
      syncControls();
      return;
    }
    const said: string[] = [];
    const undos = jump.replayed.undos;
    if (undos.length > 0) {
      // La selezione segue l'ultimo passo, quello accanto al punto d'arrivo:
      // come un annulla o un ripeti, che ne sono il salto più corto.
      landed(undos[undos.length - 1]!.touched);
      emit({ ...jump.replayed, duplicate: false }, jump.direction);
      const back = jump.direction === "undo";
      said.push(plural(undos.length, back ? "draw.history.back.one" : "draw.history.forward.one", back ? "draw.history.back.other" : "draw.history.forward.other", { where: whereNow(mark) }));
    } else {
      syncControls();
    }
    if (jump.failed !== null) said.push(t(jump.direction === "undo" ? "draw.undo.failed" : "draw.redo.failed", { action: t(jump.failed.label) }));
    announce(said.join(" "));
  }
  ctx.goToPoint = goToPoint;

  /// «Segna questo punto»: un segno dove si è adesso, col nome di partenza,
  /// e il suo campo del nome aperto.
  function markHere(): void {
    if (!editable()) return;
    const sign = history.mark(t("draw.history.mark.name", { number: history.marked + 1 }));
    syncHistory();
    historyPanel.rename(sign.id);
  }
  ctx.markHere = markHere;

  function renameMark(id: number, name: string): void {
    if (!history.rename(id, name)) return;
    syncHistory();
    announce(t("draw.history.renamed", { name }));
  }
  ctx.renameMark = renameMark;

  function unmark(id: number): void {
    const sign = history.marks.find((each) => each.id === id);
    if (sign === undefined || !history.unmark(id)) return;
    syncHistory();
    announce(t("draw.history.unmarked", { name: sign.name }));
  }
  ctx.unmark = unmark;

  function undo(): void {
    if (!editable()) return;
    // Mentre si ritaglia, annulla è il ritaglio che si lascia, come con Esc;
    // il disegno resta com'è.
    if (ctx.cropping !== null) {
      ctx.cancelCrop();
      return;
    }
    ctx.finishText();
    ctx.cancelGesture();
    if (ctx.drafting !== null && ctx.drafting.done.length > 0) {
      ctx.replayBezier(ctx.drafting, "undo");
      return;
    }
    // Un tracciato vuoto, senza passi da annullare, lascia il posto al
    // disegno, se il disegno ne ha uno.
    if (!history.canUndo) return;
    ctx.dropBezier();
    replay(history.undo(ctx.engine), "undo");
  }
  ctx.undo = undo;

  function redo(): void {
    if (!editable()) return;
    // Il ritaglio aperto si lascia, e poi si ripete come sempre.
    ctx.cancelCrop();
    ctx.finishText();
    ctx.cancelGesture();
    if (ctx.drafting !== null && ctx.drafting.undone.length > 0) {
      ctx.replayBezier(ctx.drafting, "redo");
      return;
    }
    if (ctx.drawing() !== null || !history.canRedo) return;
    ctx.dropBezier();
    replay(history.redo(ctx.engine), "redo");
  }
  ctx.redo = redo;

  /// `units` con le etichette dei connettori che contengono, che vanno con
  /// loro quando si eliminano, si copiano o si duplicano: quelle che si
  /// scelgono, cioè non bloccate né nascoste.
  const withLabels = (units: readonly Unit[]): Unit[] => {
    const model = ctx.engine.model;
    if (model === null || !units.some((unit) => unit.role === "connector" || unit.node.kind === "container")) return [...units];
    const index = currentIndex();
    const out = [...units];
    for (const label of labelsOf(model, units.map((unit) => unit.node))) {
      const unit = index.get(keyOfNode(label));
      if (unit !== null && !out.some((each) => each.key === unit.key)) out.push(unit);
    }
    return out;
  };
  ctx.withLabels = withLabels;

  function deleteSelection(): void {
    if (!editable()) return;
    ctx.settleCrop();
    const units = selectedUnits();
    if (units.length === 0) return;
    ctx.cancelGesture();
    if (commit("draw.action.delete", asGesture(removeOps(withLabels(units)))) === null) return;
    ctx.selection = [];
    syncControls();
    showHandles();
    announce(`${plural(units.length, "draw.deleted.one", "draw.deleted.other")} ${objects()}`);
  }
  ctx.deleteSelection = deleteSelection;

  /// Gli id dei connettori fra `units`, o dentro di loro, con almeno un capo
  /// agganciato: dopo uno spostamento `detachedNote` dice quanti si sono
  /// staccati.
  const hookedIn = (units: readonly Unit[]): ReadonlySet<string> => {
    const out = new Set<string>();
    const walk = (node: ElementPart): void => {
      const facts = node.details?.connector;
      if (facts !== undefined) {
        if (node.facts.id !== null && (facts.from !== null || facts.to !== null)) out.add(node.facts.id);
      } else if (node.kind === "container") {
        for (const child of elementChildren(node)) walk(child);
      }
    };
    for (const unit of units) walk(unit.node);
    return out;
  };
  ctx.hookedIn = hookedIn;

  /// Ciò che si dice dei connettori di `hooked` che uno spostamento, una
  /// rotazione o un cambio di misura ha staccato, perché fatto senza i loro
  /// oggetti: sul foglio non si vede.
  const detachedNote = (hooked: ReadonlySet<string>): string => {
    let count = 0;
    for (const id of hooked) {
      const facts = ctx.engine.holder(id)?.details?.connector;
      if (facts !== undefined && facts.from === null && facts.to === null) count++;
    }
    return count === 0 ? "" : plural(count, "draw.connector.detached.one", "draw.connector.detached.other");
  };
  ctx.detachedNote = detachedNote;

  /// Sposta gli oggetti scelti e ne tiene la selezione: un oggetto senza id
  /// lo riceve, e la sua chiave diventa quella. `note` dice, dopo, a che cosa
  /// lo spostamento si è agganciato.
  const moveSelection = (units: readonly Unit[], dx: number, dy: number, note = ""): void => {
    if (units.length === 0 || (dx === 0 && dy === 0)) return;
    // La cornice che più oggetti tengono si sposta con loro.
    const frame = units.length > 1 ? frameOf(units) : null;
    const moved = moveOps(units, dx, dy, newIds());
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, translated(unit.bounds, dx, dy));
    const page = grownPage(bounds);
    const ops: Op[] = [...moved.ops];
    if (page !== null) ops.push({ op: "page", viewBox: page });
    const hooked = hookedIn(units);
    if (commit("draw.action.move", asGesture(ops)) === null) return;
    const keys = inOrder(moved.keys);
    // Con le stesse chiavi di prima e senza una cornice da ricordare, la
    // scena nuova ha già rimesso a posto controlli e cornici: rifarlo
    // sarebbe lo stesso lavoro due volte.
    const settled = keys.join("\n") === ctx.selection.join("\n") && (frame === null || frame.matrix === IDENTITY);
    ctx.selection = keys;
    if (!settled) {
      if (frame !== null && frame.matrix !== IDENTITY) ctx.kept = { index: currentIndex(), keys: ctx.selection.join("\n"), frame: movedFrame(frame, translate(dx, dy)) };
      syncAll();
    }
    announce(ctx.noted(ctx.noted(plural(units.length, "draw.moved.one", "draw.moved.other"), note), detachedNote(hooked)));
  };
  ctx.moveSelection = moveSelection;

  function select(keys: readonly string[]): void {
    // Scegliere altro applica il ritaglio, come un tocco fuori; le chiavi per
    // percorso che si avevano in mano seguono ciò che il ritaglio ha scritto.
    if (ctx.cropping !== null && !(keys.length === 1 && keys[0] === ctx.cropping.key)) keys = keys.map(ctx.settleCrop());
    ctx.selection = inOrder(keys);
    syncAll();
  }
  ctx.select = select;

  /// I controlli e le cornici dopo un cambio di scelta, in un giro solo: la
  /// misura del foglio si legge una volta e la barra si mette alla fine.
  function syncAll(): void {
    oneRound(() => {
      syncControls();
      showHandles();
    });
  }

  // --- Il gruppo isolato -----------------------------------------------------

  /// La chiave di un contenitore del modello, come quella della selezione.
  const keyOfNode = (node: ElementPart): string => keyOf({ id: node.facts.id, path: pathOf(node) });
  ctx.keyOfNode = keyOfNode;

  /// Il nome a parole di un contenitore del modello, come nell'albero.
  const nameOfNode = (node: ElementPart): string => {
    const outlined = outlineNow().byKey.get(keyOfNode(node));
    return outlined === undefined ? tagName(node) : describe(outlined, { parts: true });
  };
  ctx.nameOfNode = nameOfNode;

  /// Il nome di un passo del percorso: quello dell'oggetto, o per un
  /// simbolo «Simbolo «Presa»».
  const crumbOf = (node: ContainerNode): string => {
    if (node.details?.role !== "symbol") return nameOfNode(node);
    const name = (titleOf(node) ?? "").replace(/\s+/g, " ").trim();
    return name === "" ? t("draw.isolation.symbol.unnamed") : t("draw.isolation.symbol", { name });
  };

  /// Ciò che si dice entrando in `node`, isolato.
  const isolatedText = (node: ContainerNode): string =>
    node.details?.role === "symbol" ? t("draw.isolated.symbol", { symbol: crumbOf(node) }) : t("draw.isolated", { name: nameOfNode(node) });

  ctx.isolationShown = null;

  /// La barra del gruppo isolato: il livello, o il disegno, e i gruppi fino
  /// a quello isolato, che è dove si è. Un gruppo del percorso è un pulsante
  /// che lo isola; il primo esce del tutto. Se la barra perde il pulsante che
  /// aveva il fuoco, il fuoco torna al foglio.
  function showIsolation(): void {
    const steps = isolationSteps();
    const focused = isolationBar.contains(document.activeElement);
    isolationBar.hidden = steps === null;
    if (steps === null) {
      ctx.isolationShown = null;
      isolationPath.replaceChildren();
      if (focused) surface.focus({ preventScroll: true });
      return;
    }
    const crumbs = steps.map(({ node }, depth) => ({ depth: node.details?.role === "layer" ? -1 : depth, text: crumbOf(node) }));
    if (steps[0]!.node.details?.role !== "layer") crumbs.unshift({ depth: -1, text: t("draw.isolation.drawing") });
    const shown = crumbs.map((crumb) => `${crumb.depth}\t${crumb.text}`).join("\n");
    if (shown === ctx.isolationShown) return;
    ctx.isolationShown = shown;
    // In un simbolo la barra e il pulsante dicono il simbolo.
    nameIsolation(steps[steps.length - 1]!.node.details?.role === "symbol");
    isolationPath.replaceChildren(...crumbs.map((crumb, at) => {
      const item = document.createElement("li");
      if (at > 0) {
        const separator = document.createElement("span");
        separator.className = "draw-isolation-sep";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "›";
        item.append(separator);
      }
      const last = at === crumbs.length - 1;
      const element = document.createElement(last ? "span" : "button");
      element.className = "draw-isolation-crumb";
      element.textContent = crumb.text;
      if (element instanceof HTMLButtonElement) {
        element.type = "button";
        element.dataset.depth = String(crumb.depth);
      } else {
        element.setAttribute("aria-current", "location");
      }
      item.append(element);
      return item;
    }));
    if (focused && !isolationBar.contains(document.activeElement)) surface.focus({ preventScroll: true });
  }
  ctx.showIsolation = showIsolation;

  /// Si sceglie in un altro posto: l'indice, l'attenuazione, la barra e
  /// l'albero lo seguono, e la selezione diventa `keys`.
  const rescope = (keys: readonly string[]): void => {
    ctx.isolatedFor = null;
    ctx.index = null;
    ctx.kept = null;
    ctx.lastTap = null;
    painter.setFocus(isolationChain());
    showIsolation();
    ctx.selection = inOrder(keys);
    syncControls();
    showHandles();
    syncTree();
  };
  ctx.rescope = rescope;

  /// Isola `unit`, un gruppo o un collegamento in cui si sceglie, o il
  /// simbolo di un'istanza, che si modifica dove lei sta: dentro si sceglie
  /// l'oggetto sotto `at`, se c'è, o con `at` nullo il primo, e lo si dice.
  const isolate = (unit: Unit, at: Point | null, pointer: InkPointerType = "mouse"): boolean => {
    const model = ctx.engine.model;
    if (!has("selection") || model === null) return false;
    const symbol = unit.role === "instance" ? instanceSymbol(model, unit.node)?.node ?? null : null;
    const node = symbol ?? (unit.node.kind === "container" ? unit.node : null);
    const through = symbol === null ? isolatedThrough() : [...isolatedThrough(), unit.node as LeafNode];
    if (node === null || !indexer.opens(model, node, through)) return false;
    ctx.cancelGesture();
    ctx.isolation = isolationOf(node, through);
    ctx.isolatedFor = null;
    ctx.index = null;
    const inside = currentIndex();
    const pick = at === null ? inside.units[0] ?? null : inside.at(at, HIT_PX[pointer] / ctx.camera.scale);
    rescope(pick === null ? [] : [pick.key]);
    const name = isolatedText(node);
    announce(pick === null ? name : `${name} ${t("draw.walk", { object: labelOf(pick), index: inside.units.indexOf(pick) + 1, count: inside.units.length })}`);
    return true;
  };
  ctx.isolate = isolate;

  /// Esce dal gruppo isolato: verso il gruppo o il simbolo che lo
  /// contiene, se ce n'è uno, o con `all` del tutto. Resta scelto il gruppo
  /// da cui si esce, o l'istanza da cui si era entrati nel simbolo.
  function leaveIsolation(all: boolean): boolean {
    if (isolatedNode() === null) return false;
    ctx.settleCrop();
    const steps = isolationSteps();
    if (steps === null) return false;
    const left = steps[steps.length - 1]!;
    const outer = steps[steps.length - 2];
    const role = outer?.node.details?.role;
    ctx.isolation = !all && outer !== undefined && (role === "group" || role === "link" || role === "symbol")
      ? isolationOf(outer.node, isolatedThrough().slice(0, outer.through))
      : null;
    rescope([keyOfNode(left.pick)]);
    const now = isolatedNode();
    announce(now === null ? leftText(left.node) : isolatedText(now));
    return true;
  }
  ctx.leaveIsolation = leaveIsolation;

  /// Ciò che si dice uscendo del tutto da `node`, il più interno.
  const leftText = (node: ContainerNode): string => t(node.details?.role === "symbol" ? "draw.isolation.left.symbol" : "draw.isolation.left");

  /// Un gruppo del percorso della barra: isola il contenitore a profondità
  /// `depth`, o con -1 esce del tutto. Resta scelto il gruppo da cui si
  /// esce, il primo del percorso dentro quello a cui si torna.
  function isolateAt(depth: number): void {
    if (isolationSteps() === null) return;
    ctx.settleCrop();
    const steps = isolationSteps();
    if (steps === null) return;
    const step = depth < 0 ? null : steps[depth];
    if (step === undefined) return;
    const left = step === null ? steps.find((each) => each.node.details?.role !== "layer") : steps[depth + 1];
    const inner = steps[steps.length - 1]!.node;
    ctx.isolation = step === null ? null : isolationOf(step.node, isolatedThrough().slice(0, step.through));
    rescope(left === undefined ? [] : [keyOfNode(left.pick)]);
    surface.focus({ preventScroll: true });
    const now = isolatedNode();
    announce(now === null ? leftText(inner) : isolatedText(now));
  }
  ctx.isolateAt = isolateAt;

  /// Si isola un gruppo, un collegamento, o il simbolo di un'istanza.
  const isolable = (unit: Unit): boolean => unit.role === "group" || unit.role === "link" || unit.role === "instance";
  ctx.isolable = isolable;

  /// Mod+Invio, o «Isola il gruppo»: il gruppo, o il collegamento, scelto
  /// da solo; con un'istanza, il suo simbolo.
  const isolateSelection = (): void => {
    const units = selectedUnits();
    const unit = units.length === 1 && isolable(units[0]!) ? units[0]! : null;
    if (unit === null || !isolate(unit, null)) announce(t("draw.isolate.none"));
  };
  ctx.isolateSelection = isolateSelection;

  /// «Modifica simbolo»: entra nel simbolo dell'istanza scelta da sola.
  const editSymbol = (): void => {
    const units = selectedUnits();
    const unit = units.length === 1 && units[0]!.role === "instance" ? units[0]! : null;
    if (unit === null || !isolate(unit, null)) announce(t("draw.symbol.edit.none"));
  };
  ctx.editSymbol = editSymbol;

  /// Porta `bounds` in vista: resta dov'è se si vede già intero, va al
  /// centro se ci sta allo zoom di adesso, altrimenti si inquadra.
  const frameBounds = (bounds: Bounds | null): void => {
    const area = viewArea();
    if (bounds === null || area.w === 0 || area.h === 0) return;
    ctx.placed = true;
    const box = screenBox(ctx.camera, bounds);
    const [left, top] = box.min;
    const [right, bottom] = box.max;
    if (left >= area.x && top >= area.y && right <= area.x + area.w && bottom <= area.y + area.h) return;
    const usable = 1 - 2 * FIT_PAD;
    if (right - left <= area.w * usable && bottom - top <= area.h * usable) {
      const cx = (bounds.min[0] + bounds.max[0]) / 2;
      const cy = (bounds.min[1] + bounds.max[1]) / 2;
      setCamera(placedAt(ctx.camera, [cx, cy], [area.x + area.w / 2, area.y + area.h / 2]));
      return;
    }
    setCamera(fitted(bounds, area));
  };
  ctx.frameBounds = frameBounds;

  function reveal(offset: number): boolean {
    if (ctx.engine.model === null) return false;
    const index = currentIndex();
    const list = boardsNow();
    // L'oggetto è il più esterno fra quelli che contengono il byte e che si
    // scelgono interi: un livello non lo è, un figlio di un gruppo nemmeno.
    // La scena è in ordine di documento: chi contiene viene prima. Una
    // tavola è una sezione del disegno, come un titolo di una nota: la si
    // sceglie e la si inquadra, e la selezione resta.
    let found: Unit | null = null;
    for (const item of ctx.engine.scene()) {
      if (item.kind !== "element" || offset < item.bytes[0] || offset >= item.bytes[1]) continue;
      const at = item.id === null ? -1 : list.findIndex((board) => board.id === item.id);
      if (at >= 0) {
        ctx.finishText();
        return ctx.visitBoard(at, true);
      }
      found = index.get(item.id ?? `@${item.path.join(".")}`) ?? null;
      if (found !== null) break;
    }
    if (found === null) return false;
    ctx.finishText();
    ctx.cancelGesture();
    select([found.key]);
    frameBounds(found.bounds);
    announceSelection();
    return true;
  }
  ctx.reveal = reveal;

  /// Applica `op`, che adotta un SVG estraneo, come un passo di annulla col
  /// nome `label`: un rifiuto si annuncia. Vero se è passato.
  function adoptWith(label: DrawKey, op: Op): boolean {
    const outcome = ctx.engine.apply(op);
    if (outcome.outcome === "rejected") {
      announce(t("draw.rejected", { reason: t(REASONS[outcome.reason]) }));
      return false;
    }
    history.record(label, outcome);
    refresh();
    emit(outcome, "input");
    return true;
  }

  function adopt(): boolean {
    if (ctx.locked || ctx.engine.status !== "foreign" || ctx.engine.model === null) return false;
    ctx.cancelGesture();
    if (!adoptWith("draw.action.adopt", { op: "adopt" })) return false;
    announce(t("draw.adopted"));
    return true;
  }
  ctx.adopt = adopt;

  /// L'anteprima del disegno `svg` per la finestra di «Rendi modificabile»,
  /// come URL, con le immagini del vault e i caratteri dentro; `null` se
  /// non si fa.
  const drawingPictureUrl = async (svg: string): Promise<string | null> => {
    const port = options.images;
    const read = port === undefined ? () => Promise.resolve(null) : (path: string) => port.read(path);
    const self = await selfContained(svg, read, EDITABLE_IMAGE_BYTES, pictureFonts).catch(() => null);
    return self === null || ctx.disposed ? null : URL.createObjectURL(new Blob([self], { type: "image/svg+xml" }));
  };

  /// «Rendi modificabile»: le parti di altri programmi di `scope` diventano
  /// oggetti del formato, dove si può senza che cambi ciò che si vede, dopo
  /// la finestra che mostra il disegno prima e dopo e dice che cosa resta e
  /// perché; in un passo, che per un SVG estraneo è anche l'adozione. Il
  /// piano lo fa un modulo che arriva la prima volta che serve. `all` dice
  /// se il comando è su tutto il disegno. Vero se il disegno è cambiato.
  async function makeEditable(scope: EditableScope, all: boolean): Promise<boolean> {
    const adopts = ctx.engine.status === "foreign";
    if (ctx.asking || ctx.locked || ctx.engine.model === null || !(adopts || editable())) return false;
    const text = ctx.engine.text;
    const opened = ctx.loads;
    ctx.finishText();
    ctx.cancelGesture();
    ctx.asking = true;
    let plan: EditablePlan | null = null;
    let yes = false;
    try {
      const { planEditable } = await import("../make-editable");
      if (ctx.disposed || ctx.loads !== opened || ctx.engine.text !== text) return false;
      plan = planEditable(text, scope);
      if (plan.ops.length === 0 && plan.leftovers.length === 0) {
        // Un SVG estraneo che è già tutto del formato si adotta e basta,
        // come con «Modifica».
        if (adopts && !ctx.locked && adoptWith("draw.action.adopt", { op: "adopt" })) {
          announce(t("draw.editable.adopted"));
          return true;
        }
        announce(t(all ? "draw.editable.none" : "draw.editable.none.here"));
        return false;
      }
      const after = plan.after;
      const urls = plan.ops.length === 0 || after === null ? [null, null] : await Promise.all([drawingPictureUrl(text), drawingPictureUrl(fadedMarkup(after, plan.leftovers.map((left) => left.path)))]);
      try {
        if (!ctx.disposed && ctx.loads === opened) yes = await editableDialog({ plan, all, adopts, before: urls[0] ?? null, after: urls[1] ?? null });
      } finally {
        for (const url of urls) if (url !== null) URL.revokeObjectURL(url);
      }
    } finally {
      ctx.asking = false;
    }
    if (!yes || plan === null || ctx.disposed) return false;
    // Mentre la finestra era aperta il disegno può essere cambiato: il piano
    // era per quello di prima.
    if (ctx.loads !== opened || ctx.engine.text !== text || ctx.locked || ctx.engine.status !== (adopts ? "foreign" : "fubdraw")) {
      announce(t("draw.editable.gone"));
      return false;
    }
    const op = asGesture(plan.ops);
    if (op === null || !(adopts ? adoptWith("draw.action.make_editable", op) : commit("draw.action.make_editable", op) !== null)) return false;
    const left = plan.leftovers.length;
    const done = plan.converted === 0 ? t("draw.editable.tidied") : plural(plan.converted, "draw.editable.done.one", "draw.editable.done.other");
    announce(left === 0 ? done : `${done} ${plural(left, "draw.editable.left.short.one", "draw.editable.left.short.other")}`);
    return true;
  }
  ctx.makeEditable = makeEditable;

  function setReadOnly(readOnly: boolean): void {
    if (readOnly === ctx.locked) return;
    // Un documento che non si scrive più non riceve il testo in corso.
    if (readOnly) ctx.finishText(false);
    ctx.locked = readOnly;
    if (ctx.locked) {
      ctx.cancelGesture();
      ctx.dropBezier();
    }
    syncControls();
  }
  ctx.setReadOnly = setReadOnly;
}
