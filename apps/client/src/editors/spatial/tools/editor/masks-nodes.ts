// L'editor del disegno: le maschere e i comandi dei nodi. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { displayBinding } from "../../../../ui/commands";
import type { MenuItem } from "../../../../ui/menu";
import { keyOf } from "../../describe";
import { BoundsBuilder, type Bounds } from "../../scene/geometry";
import { compose, IDENTITY, type Point } from "../../scene/matrix";
import { tagName } from "../../scene/model";
import { pathData } from "../../scene/serialize";
import { plural, t, type DrawKey } from "../../strings";
import { nodeOf, plainAttributes, Plan, type Axis, type Edge } from "../arrange";
import { expandOps, expandTargets, REPEAT_KINDS, repeatOps, repeatTarget, type RepeatKind } from "../repeat-ops";
import { joinAcross, joinEnds } from "../cut";
import { cuttable } from "../scissors";
import { pooledTips } from "../endtips";
import { breakNodes, deleteNodes, insertNodes, moveNodes, parseKey, setKind, setLinks, writeNodes, type Edited, type NodeKey, type NodeKind } from "../nodes";
import { rewrite, rewriteOps } from "../nodable";
import type { Spine } from "../spine";
import { GRID_MAJOR, lineBeyond } from "../grid";
import { elemBounds, type LayerInfo } from "../hit";
import { inLayer, intoLayerOps } from "../layers";
import { clipMaskOps, opacityMaskOps, releasable, releaseOps as releaseMaskOps, releaseRefusal, type MaskRefusal } from "../masks";
import { flipOps, isAlongPath, pairOf, putOnPathOps, releaseOps, type TextPathRefused } from "../text-path";
import { AXES, CLIP_MASK_BINDING, EDGES, JOIN_PX, MADE, NO_KINDS, NUDGE, NUDGE_SHIFT, RELEASE_MASK_BINDING } from "./constants";
import type { EditorContext } from "./context";
import { comparePaths, innerNode, layerRefusal, layerState, layerTitle, linksBetween, remapped, scaleOf, sign, union } from "./helpers";
import type { Editing, NodeChange, NodeCommand } from "./types";

/// Gli effetti che creare o rilasciare una maschera scrive da sé.
const MASK_EFFECTS: readonly string[] = ["clip-path", "mask"];

/// Il percorso `path` quando se ne vanno gli elementi di `removed`, tutti
/// del modello di prima: ognuno tolto prima di lui fra i suoi fratelli, o
/// fra quelli di chi lo contiene, lo porta indietro di uno. `null` se se ne
/// va lui, o chi lo contiene.
function pathAfter(path: readonly number[], removed: readonly (readonly number[])[]): number[] | null {
  const out = [...path];
  for (const gone of removed) {
    const depth = gone.length - 1;
    if (depth >= path.length || !gone.every((at, i) => i === depth || at === path[i])) continue;
    if (gone[depth] === path[depth]) return null;
    if (gone[depth]! < path[depth]!) out[depth] = out[depth]! - 1;
  }
  return out;
}

/// Perché una modifica dei nodi non si fa, a parole.
const NODES_REFUSED: Readonly<Record<"arrow" | "stroke" | "width" | "long" | "track", DrawKey>> = {
  arrow: "draw.nodes.arrow",
  stroke: "draw.nodes.stroke",
  width: "draw.nodes.width",
  long: "draw.nodes.long",
  track: "draw.nodes.track",
};

/// Ciò che le maschere e i comandi dei nodi dà agli altri pezzi dell'editor.
export interface MasksNodesContext {
  maskSelection: (kind: "clip" | "opacity") => void;
  releaseMasks: () => void;
  maskItems: () => MenuItem[];
  repeatItems: () => MenuItem[];
  textPathItems: () => MenuItem[];
  writeEdits: (label: DrawKey, changes: readonly NodeChange[]) => { readonly written: boolean; readonly count: number } | null;
  afterEdit: (text: string) => string;
  noding: () => Editing[];
  announceMoved: (note?: string) => void;
  insertSelectedNodes: () => void;
  deleteSelectedNodes: () => void;
  kindSelectedNodes: (kind: NodeKind) => void;
  linkSelectedNodes: (kind: "line" | "curve") => void;
  breakSelectedNodes: () => void;
  joinSelectedNodes: () => void;
  runNodeCommand: (command: NodeCommand) => void;
  nudgeNodes: (x: number, y: number, fine: boolean, big: boolean) => void;
  moveSelectedNodes: (chosen: readonly Editing[], delta: Point) => void;
  nodesBox: (chosen: readonly Editing[]) => Bounds | null;
  nodesReference: () => Bounds | null;
  alignNodes: (edge: Edge) => void;
  nodeAlignItems: () => MenuItem[];
  intoItems: () => MenuItem[];
}

/// Monta le maschere e i comandi dei nodi.
export function installMasksNodes(ctx: EditorContext): void {
  const {
    measureText, kindsAt, history, indexer, editable, currentIndex, currentPage, newIds, announce, objects, stepNow, coordText, selectedUnits, remember,
    pickedIn, chosenCount, chosenEdits, kindsOf, showHandles, originalUnits, followSelection, withLabels, cancelGesture, gridOn, noted, nodePoint,
    announceTarget, refreshNodes, setNodes, changeOf, localDelta, arranging, arrange, repeatSelection, expandSelection
  } = ctx;
  // --- Le maschere ---------------------------------------------------------------

  /// Perché una maschera non si crea, a parole: chi ritaglia e chi fa da
  /// maschera non sono gli stessi oggetti.
  const maskRefusal = (refusal: MaskRefusal, kind: "clip" | "opacity"): string => {
    switch (refusal) {
      case "few":
        return t("draw.mask.few");
      case "top":
        return t(`draw.mask.top.${kind}`);
      case "line":
        return t("draw.mask.line");
      case "content":
        return t(`draw.mask.content.${kind}`);
      case "plane":
        return t("draw.mask.plane");
      // Le altre ragioni non dipendono dal tipo di maschera: ciascuna ha la
      // sua frase, `draw.mask.` e il suo nome.
      default:
        return t(`draw.mask.${refusal}`);
    }
  };

  /// «Crea maschera di ritaglio» (Ctrl+7) e «Crea maschera d'opacità», dal
  /// livello Esperto: l'oggetto più in alto fra quelli scelti ritaglia gli
  /// altri, o ne fa la trasparenza, raccolti in un gruppo nuovo che resta
  /// scelto.
  function maskSelection(kind: "clip" | "opacity"): void {
    const units = arranging("masks");
    if (units === null) return;
    const made = (kind === "clip" ? clipMaskOps : opacityMaskOps)(ctx.engine.model!, units, newIds());
    if (typeof made === "string") {
      announce(maskRefusal(made, kind));
      return;
    }
    const kept = arrange(kind === "clip" ? "draw.action.clip_mask" : "draw.action.opacity_mask", made, null, { key: "draw.mask.styled", effects: MASK_EFFECTS });
    if (kept !== null) announce(`${plural(units.length - 1, `draw.masked.${kind}.one`, `draw.masked.${kind}.other`)}${kept}`);
  }
  ctx.maskSelection = maskSelection;

  /// «Rilascia maschera» (Ctrl+Alt+7): i ritagli e le maschere degli
  /// oggetti scelti tornano oggetti, sopra di loro, e un gruppo che non
  /// aveva altro si separa.
  function releaseMasks(): void {
    const units = arranging("masks");
    if (units === null) return;
    const model = ctx.engine.model!;
    const count = units.filter((unit) => releasable(model, unit)).length;
    const released = count === 0 ? null : releaseMaskOps(model, units, newIds());
    if (released === null) {
      const refused = count === 0 ? null : releaseRefusal(model, units, newIds());
      announce(refused === null ? t("draw.release.none") : t(`draw.release.${refused}`));
      return;
    }
    const kept = arrange("draw.action.release_mask", released, null, { key: "draw.release.styled", effects: MASK_EFFECTS });
    if (kept !== null) announce(`${plural(count, "draw.released.one", "draw.released.other")}${kept}`);
  }
  ctx.releaseMasks = releaseMasks;

  /// Il menu «Maschera»: crearne una vuole almeno due oggetti, e un oggetto
  /// in cima che il comando sappia usare, rilasciarla un oggetto che ne ha
  /// una. Una voce che il comando rifiuterebbe è spenta, e dice perché con le
  /// parole che il comando direbbe.
  const maskItems = (): MenuItem[] => {
    const units = selectedUnits();
    const model = ctx.engine.model;
    const when = (reason: string | null): Pick<MenuItem, "disabled" | "description"> =>
      reason === null ? { disabled: false } : { disabled: true, description: units.length === 0 ? t("draw.selected.none") : reason };
    const creation = (kind: "clip" | "opacity"): string | null => {
      if (model === null || units.length === 0) return t("draw.mask.few");
      const made = (kind === "clip" ? clipMaskOps : opacityMaskOps)(model, units, newIds());
      return typeof made === "string" ? maskRefusal(made, kind) : null;
    };
    const releaseReason = (): string | null => {
      if (model === null || !units.some((unit) => releasable(model, unit))) return t("draw.release.none");
      const refused = releaseRefusal(model, units, newIds());
      return refused === null ? null : t(`draw.release.${refused}`);
    };
    return [
      { label: t("draw.mask.clip"), hint: displayBinding(CLIP_MASK_BINDING), ...when(creation("clip")), run: () => maskSelection("clip") },
      { label: t("draw.mask.opacity"), ...when(creation("opacity")), run: () => maskSelection("opacity") },
      { label: t("draw.mask.release"), hint: displayBinding(RELEASE_MASK_BINDING), separator: true, ...when(releaseReason()), run: () => releaseMasks() },
    ];
  };
  ctx.maskItems = maskItems;

  /// Il menu «Ripeti»: i tre tipi, col segno su quello della ripetizione
  /// scelta, ed «Espandi la ripetizione». Una voce che il comando
  /// rifiuterebbe è spenta, e dice perché con le parole che il comando
  /// direbbe.
  const repeatItems = (): MenuItem[] => {
    const units = selectedUnits();
    const model = ctx.engine.model;
    const current = repeatTarget(units)?.details?.repeat?.kind ?? null;
    const when = (reason: string | null): Pick<MenuItem, "disabled" | "description"> =>
      reason === null ? { disabled: false } : { disabled: true, description: units.length === 0 ? t("draw.selected.none") : reason };
    const refusal = (kind: RepeatKind): string | null => {
      if (model === null || units.length === 0) return t("draw.selected.none");
      if (kind === current) return null;
      const made = repeatOps(model, withLabels(units), kind, newIds(), originalUnits);
      return typeof made === "string" ? t(`draw.repeat.refused.${made}`) : null;
    };
    const expandReason = (): string | null => {
      if (model === null || expandTargets(units).length === 0) return t("draw.repeat.expand.none");
      return expandOps(model, units, newIds()) === "content" ? t("draw.repeat.expand.content") : null;
    };
    return [
      ...REPEAT_KINDS.map((kind): MenuItem => ({
        label: t(`draw.repeat.${kind}`),
        ...(current === null ? {} : { choice: "radio" as const, checked: kind === current }),
        ...when(refusal(kind)),
        run: () => repeatSelection(kind),
      })),
      { label: t("draw.repeat.expand"), separator: true, ...when(expandReason()), run: () => expandSelection() },
    ];
  };
  ctx.repeatItems = repeatItems;

  /// Perché un comando del testo su tracciato non si fa, a parole.
  const textPathRefusal = (refused: TextPathRefused): string => t(`draw.text_path.${refused.reason}` as const);

  /// «Metti sul tracciato», dal livello Esperto: la forma scelta col testo
  /// diventa il suo tracciato, e il testo ci scorre sopra.
  function putOnPath(): void {
    const units = arranging("typeset");
    if (units === null) return;
    const done = putOnPathOps(ctx.engine.model!, units, measureText, newIds());
    if ("reason" in done) {
      announce(textPathRefusal(done));
      return;
    }
    if (arrange("draw.text_path.put", done) !== null) announce(t("draw.text_path.put.done"));
  }

  /// «Togli dal tracciato», dal livello Esperto: i testi su tracciato scelti
  /// tornano righe dritte.
  function releaseFromPath(): void {
    const units = arranging("typeset");
    if (units === null) return;
    const done = releaseOps(ctx.engine.model!, units, newIds());
    if ("reason" in done) {
      announce(textPathRefusal(done));
      return;
    }
    const count = units.filter(isAlongPath).length;
    if (arrange("draw.text_path.release", done) !== null) announce(plural(count, "draw.text_path.released.one", "draw.text_path.released.other"));
  }

  /// «Rovescia sul tracciato», dal livello Esperto: i testi su tracciato
  /// scelti passano dall'altra parte, dove erano lungo il tracciato.
  function flipOnPath(): void {
    const units = arranging("typeset");
    if (units === null) return;
    const done = flipOps(ctx.engine.model!, units, measureText, newIds());
    if ("reason" in done) {
      announce(textPathRefusal(done));
      return;
    }
    const count = units.filter(isAlongPath).length;
    if (arrange("draw.text_path.flip", done) !== null) announce(plural(count, "draw.text_path.flipped.one", "draw.text_path.flipped.other"));
  }

  /// Le voci del menu Testo su tracciato: spente, e dicono perché, quando
  /// gli oggetti scelti non servono.
  const textPathItems = (): MenuItem[] => {
    const units = selectedUnits();
    const pair = pairOf(units);
    const along = units.some(isAlongPath);
    const none = t("draw.text_path.none");
    return [
      { label: t("draw.text_path.put"), ...("reason" in pair ? { disabled: true, description: textPathRefusal(pair) } : { disabled: false }), run: () => putOnPath() },
      { label: t("draw.text_path.release"), ...(along ? { disabled: false } : { disabled: true, description: none }), run: () => releaseFromPath() },
      { label: t("draw.text_path.flip"), ...(along ? { disabled: false } : { disabled: true, description: none }), run: () => flipOnPath() },
    ];
  };
  ctx.textPathItems = textPathItems;

  // --- I comandi dei nodi -----------------------------------------------------

  /// Dove arriva, nella scena, il testo su tracciato di `edit` col tracciato
  /// `d`: il tracciato, e il corpo del testo da ogni parte.
  const trackExtent = (edit: Editing, d: string): Bounds | null => {
    const local = elemBounds({ tag: "path", attrs: { d } }, IDENTITY);
    if (local === null) return null;
    const by = edit.unit.look?.size ?? 0;
    const [x, y] = [local.min[0] - by, local.min[1] - by];
    const [width, height] = [local.max[0] - local.min[0] + 2 * by, local.max[1] - local.min[1] + 2 * by];
    return elemBounds({ tag: "rect", attrs: { x: String(x), y: String(y), width: String(width), height: String(height) } }, edit.matrix);
  };

  /// Scrive i nodi nuovi di ogni forma di `changes` col nome `label`, in un
  /// passo di annulla solo, e la pagina cresce se una forma ne esce. Un
  /// tracciato scrive il suo `d`; una forma resta lei finché i nodi ne
  /// disegnano una come lei, altrimenti diventa un tracciato; una freccia
  /// sposta i capi e un tratto a penna il suo inchiostro; un testo su
  /// tracciato cambia il tracciato che segue, dove sta. Una forma rimasta
  /// senza nodi se ne va. Una forma che non accetta la modifica resta com'è,
  /// e ciò che si dice dopo aggiunge perché ([`afterEdit`]). Dopo sono scelti
  /// i nodi `selected` di ogni forma, coi tipi `kinds`; quelli di una forma
  /// rimasta com'è non cambiano. Torna se ha scritto, e quanto ha cambiato:
  /// la somma di `changed` delle forme che hanno accettato. `null` se non
  /// scrive niente, e lo dice, o il motore ha rifiutato.
  const writeEdits = (label: DrawKey, changes: readonly NodeChange[]): { readonly written: boolean; readonly count: number } | null => {
    const model = ctx.engine.model;
    ctx.converted = 0;
    ctx.skipped = null;
    if (model === null || !editable() || changes.length === 0) return null;
    const plan = new Plan(model, newIds());
    const accepted: NodeChange[] = [];
    const removed: (readonly number[])[] = [];
    const learned: Array<readonly [string, Spine]> = [];
    let written = 0;
    let conversions = 0;
    let extent: Bounds | null = null;
    let refusal: DrawKey | null = null;
    for (const change of changes) {
      const { edit } = change;
      const rewritten = pathData(writeNodes(change.subs)) === pathData(writeNodes(edit.subs)) ? null : rewrite(edit.nodable, change.subs, change.moved ?? null, change.tips);
      if (rewritten?.kind === "refused") {
        refusal ??= NODES_REFUSED[rewritten.reason];
        continue;
      }
      if (rewritten === null || rewritten.kind === "same") {
        accepted.push(change);
        continue;
      }
      if (rewritten.kind === "track") {
        plan.ops.push({ op: "set", id: rewritten.target, attrs: { d: rewritten.d } });
        extent = union(extent, trackExtent(edit, rewritten.d));
      } else if (rewritten.kind === "remove") {
        removed.push(edit.path);
      } else {
        const node = nodeOf(model, edit);
        // Una forma che non sa diventare un tracciato si prova prima a parte:
        // le sue operazioni a metà non entrano nel passo delle altre.
        if (rewritten.kind === "path" && rewriteOps(new Plan(model, newIds()), node, rewritten) === null) {
          refusal ??= "draw.nodes.unwritable";
          continue;
        }
        const after = rewriteOps(plan, node, rewritten);
        if (after === null) {
          refusal ??= "draw.nodes.unwritable";
          continue;
        }
        extent = union(extent, node.kind === "leaf" ? indexer.writtenBounds(after, edit.matrix, node) : elemBounds(after, edit.matrix));
        if (rewritten.kind === "set" && rewritten.spine !== undefined) learned.push([rewritten.attrs["fub:ink"]!, rewritten.spine]);
        if (rewritten.kind === "path" && edit.nodable.kind !== "path") conversions++;
      }
      accepted.push(change);
      written++;
    }
    if (accepted.length === 0) {
      announce(t(refusal ?? "draw.unchanged"));
      showHandles();
      return null;
    }
    // Le forme che se ne vanno, dall'ultima: i percorsi di quelle prima
    // restano quelli del modello di adesso.
    removed.sort((a, b) => comparePaths(b, a));
    for (const path of removed) {
      const node = nodeOf(model, { path });
      plan.ops.push({ op: "remove", target: node.facts.id ?? { path: [...path], tag: tagName(node) } });
    }
    // Gli oggetti scelti restano, tranne una forma sola che se ne va. Uno
    // senza id ha la chiave del suo posto, che una forma tolta prima di lui
    // sposta.
    const keys = selectedUnits().flatMap((unit) => {
      const path = pathAfter(unit.path, removed);
      return path === null ? [] : [plan.keyOf(unit.node, keyOf({ id: unit.id, path }))];
    });
    const before = ctx.edits;
    const pick = ctx.nodeSelection;
    const given = ctx.nodeKinds;
    // Le spine si ricordano prima di scrivere: i nodi dei tratti nuovi si
    // cercano appena il disegno cambia, e una volta trovati restano quelli.
    for (const [ink, spine] of learned) remember(ink, spine);
    const point = history.position;
    if (written > 0 && arrange(label, plan.finish(keys), extent) === null) return null;
    ctx.converted = conversions;
    ctx.skipped = refusal;
    // I nodi scelti e i tipi dati, per forma, dove le forme sono finite.
    const moved = (key: string): string | null => pathAfter(key.split(".").map(Number), removed)?.join(".") ?? null;
    ctx.focused = ctx.focused.flatMap((path) => {
      const next = pathAfter(path, removed);
      return next === null ? [] : [next];
    });
    const byShape = new Map(accepted.map((change) => [change.edit.key, change]));
    const nextPick = new Map<string, Iterable<NodeKey>>();
    const nextKinds = new Map<string, ReadonlyMap<NodeKey, NodeKind>>();
    for (const edit of before) {
      const key = moved(edit.key);
      if (key === null) continue;
      const change = byShape.get(edit.key);
      const chosen = change === undefined ? pick.get(edit.key) : change.selected;
      const kinds = change === undefined ? given.get(edit.key) : change.kinds;
      if (chosen !== undefined) nextPick.set(key, chosen);
      if (kinds !== undefined && kinds.size > 0) nextKinds.set(key, kinds);
    }
    refreshNodes();
    ctx.nodeKinds = nextKinds;
    if (written > 0) kindsAt.set(point, given);
    kindsAt.set(history.position, nextKinds);
    for (const at of kindsAt.keys()) if (at < history.start) kindsAt.delete(at);
    setNodes(nextPick);
    return { written: written > 0, count: accepted.reduce((sum, change) => sum + (change.changed ?? 1), 0) };
  };
  ctx.writeEdits = writeEdits;

  /// `text`, e dopo l'ultima modifica dei nodi anche quante forme sono
  /// diventate tracciati, e perché qualcuna è rimasta com'era.
  const afterEdit = (text: string): string => {
    let out = text;
    if (ctx.converted > 0) out += ` ${plural(ctx.converted, "draw.nodes.converted.one", "draw.nodes.converted.other")}`;
    if (ctx.skipped !== null) out += ` ${t(ctx.skipped)}`;
    return out;
  };
  ctx.afterEdit = afterEdit;

  /// Le forme su cui lavora un comando dei nodi: quelle coi nodi scelti.
  /// Nessuna, e lo si dice, se non ci sono forme o nodi scelti.
  const noding = (): Editing[] => {
    if (!editable()) return [];
    refreshNodes();
    if (ctx.edits.length === 0) {
      announceTarget();
      return [];
    }
    const chosen = chosenEdits();
    if (chosen.length === 0) {
      announce(t("draw.nodes.selected.none"));
      return [];
    }
    cancelGesture();
    return chosen;
  };
  ctx.noding = noding;

  /// Dice che i nodi scelti si sono spostati: dove, se è uno solo, e `note`,
  /// a che cosa si sono agganciati.
  const announceMoved = (note = ""): void => {
    const chosen = chosenEdits();
    const count = chosenCount();
    if (count === 1) {
      const [x, y] = nodePoint(chosen[0]!, [...pickedIn(chosen[0]!)][0]!);
      announce(afterEdit(noted(t("draw.nodes.moved.at", { x: coordText(x), y: coordText(y) }), note)));
      return;
    }
    announce(afterEdit(noted(plural(count, "draw.nodes.moved.one", "draw.nodes.moved.other"), note)));
  };
  ctx.announceMoved = announceMoved;

  /// Le modifiche di `edit` sulle forme `chosen`, coi loro nodi scelti, che
  /// cambiano qualcosa.
  const changesOf = (chosen: readonly Editing[], edit: (each: Editing, keys: ReadonlySet<NodeKey>) => Edited): NodeChange[] =>
    chosen.flatMap((each) => {
      const edited = edit(each, pickedIn(each));
      return edited.changed === 0 ? [] : [changeOf(each, edited)];
    });

  /// Insert, o «Aggiungi nodi»: un nodo a metà di ogni segmento fra due nodi
  /// scelti. Dopo sono scelti i nodi nuovi.
  function insertSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => insertNodes(each.subs, keys));
    if (changes.length === 0) {
      announce(t("draw.nodes.insert.none"));
      return;
    }
    const done = writeEdits("draw.action.nodes_insert", changes);
    if (done?.written === true) announce(afterEdit(plural(done.count, "draw.nodes.inserted.one", "draw.nodes.inserted.other")));
  }
  ctx.insertSelectedNodes = insertSelectedNodes;

  /// Canc, o «Elimina nodi»: i segmenti attorno si uniscono in una curva che
  /// passa vicino a dov'erano. Mai l'oggetto: senza nodi scelti non elimina
  /// niente, ma una forma rimasta senza nodi se ne va.
  function deleteSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => deleteNodes(each.subs, keys));
    const done = writeEdits("draw.action.nodes_delete", changes);
    if (done?.written !== true) return;
    const gone = changes.filter((change) => change.subs.length === 0).length;
    if (gone === changes.length) announce(`${plural(gone, "draw.nodes.deleted.all.one", "draw.nodes.deleted.all.other")} ${objects()}`);
    else announce(afterEdit(plural(done.count, "draw.nodes.deleted.one", "draw.nodes.deleted.other")));
  }
  ctx.deleteSelectedNodes = deleteSelectedNodes;

  /// Maiusc+C, S o Y: i nodi scelti a spigolo, lisci o simmetrici. Il tipo
  /// resta ai nodi anche dove la geometria non cambia, come per lo spigolo.
  function kindSelectedNodes(kind: NodeKind): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => setKind(each.subs, keys, kind)).map((change) => {
      const kinds = new Map(change.kinds);
      for (const key of change.selected) {
        const [s, at] = parseKey(key);
        if (innerNode(change.subs[s]!, at)) kinds.set(key, kind);
      }
      return { ...change, kinds };
    });
    if (changes.length === 0) {
      announce(t("draw.nodes.kind.none"));
      return;
    }
    const done = writeEdits("draw.action.nodes_kind", changes);
    if (done === null) return;
    const [one, other] = MADE[kind];
    announce(afterEdit(plural(done.count, one, other)));
  }
  ctx.kindSelectedNodes = kindSelectedNodes;

  /// Maiusc+L o U: i segmenti fra due nodi scelti in linee o in curve.
  function linkSelectedNodes(kind: "line" | "curve"): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => setLinks(each.subs, keys, kind));
    if (changes.length === 0) {
      announce(t(chosen.some((each) => linksBetween(each.subs, pickedIn(each)).any) ? "draw.unchanged" : "draw.nodes.links.none"));
      return;
    }
    const done = writeEdits("draw.action.segments", changes);
    if (done === null) return;
    announce(afterEdit(kind === "line"
      ? plural(done.count, "draw.nodes.lines.one", "draw.nodes.lines.other")
      : plural(done.count, "draw.nodes.curves.one", "draw.nodes.curves.other")));
  }
  ctx.linkSelectedNodes = linkSelectedNodes;

  /// Maiusc+B: le forme si spezzano ai nodi scelti.
  function breakSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = changesOf(chosen, (each, keys) => breakNodes(each.subs, keys));
    if (changes.length === 0) {
      announce(t("draw.nodes.break.none"));
      return;
    }
    const done = writeEdits("draw.action.nodes_break", changes);
    if (done === null) return;
    announce(afterEdit(plural(done.count, "draw.nodes.broken.one", "draw.nodes.broken.other")));
  }
  ctx.breakSelectedNodes = breakSelectedNodes;

  /// Quanto lontani due capi della forma `edit` possono stare, nelle sue
  /// coordinate, e diventare un nodo solo: [`JOIN_PX`] sullo schermo.
  const joinReach = (edit: Editing): number => (JOIN_PX / ctx.camera.scale) * scaleOf(edit.inverse);

  /// Maiusc+J o Ctrl+J: unisce i due capi scelti di ogni forma; o, con un
  /// capo scelto in ognuna di due forme, le fa una: quella più in basso
  /// prende il sottotracciato dell'altra, come «Unisci». Due capi che sullo
  /// schermo si toccano diventano un nodo solo; altrimenti li unisce una
  /// linea.
  function joinSelectedNodes(): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const changes = chosen.flatMap((each) => {
      const [a, b, ...more] = pickedIn(each);
      const edited = a === undefined || b === undefined || more.length > 0 ? null : joinEnds(each.subs, a, b, joinReach(each));
      return edited === null ? [] : [changeOf(each, edited)];
    });
    if (changes.length === 0) {
      const across = chosen.length === 2 && chosen.every((each) => pickedIn(each).size === 1) ? joinTwo(chosen) : "draw.nodes.join.none";
      if (typeof across === "string") {
        announce(t(across));
        return;
      }
      if (writeEdits("draw.action.nodes_join", across) !== null) announce(afterEdit(t("draw.nodes.joined_across")));
      return;
    }
    const closed = changes.length === 1 && changes[0]!.subs.length === changes[0]!.edit.subs.length;
    const done = writeEdits("draw.action.nodes_join", changes);
    if (done === null) return;
    announce(afterEdit(changes.length > 1
      ? plural(changes.length, "draw.nodes.joined_in.one", "draw.nodes.joined_in.other")
      : t(closed ? "draw.nodes.closed" : "draw.nodes.joined")));
  }
  ctx.joinSelectedNodes = joinSelectedNodes;

  /// I capi scelti di due forme, uno per forma, uniti nella più in basso,
  /// che prende il sottotracciato dell'altra; l'altra lo perde, e se era il
  /// solo se ne va. Perché no, se non si uniscono: una freccia e un tratto a
  /// penna restano soli.
  const joinTwo = (chosen: readonly Editing[]): NodeChange[] | DrawKey => {
    const [first, second] = [...chosen].sort((a, b) => comparePaths(a.path, b.path)) as [Editing, Editing];
    for (const each of [first, second]) {
      if (each.nodable.kind === "track") return "draw.nodes.track_join";
      if (!cuttable(each.nodable)) return each.nodable.kind === "arrow" || each.nodable.kind === "width" ? NODES_REFUSED[each.nodable.kind] : "draw.nodes.stroke";
    }
    const [a] = pickedIn(first);
    const [b] = pickedIn(second);
    const joined = joinAcross(first.subs, a!, second.subs, b!, compose(first.inverse, second.matrix), joinReach(first));
    if (joined === null) return "draw.nodes.join.none";
    const { rest } = joined;
    return [
      { ...changeOf(first, joined.kept), tips: pooledTips([plainAttributes(nodeOf(ctx.engine.model!, second))], joined.tips.kept) },
      { edit: second, subs: rest.subs, selected: [], kinds: remapped(ctx.nodeKinds.get(second.key) ?? NO_KINDS, rest.moved), moved: rest.moved, tips: joined.tips.rest },
    ];
  };

  /// Un comando dei nodi di Maiusc e una lettera.
  const runNodeCommand = (command: NodeCommand): void => {
    if (command === "line" || command === "curve") linkSelectedNodes(command);
    else if (command === "break") breakSelectedNodes();
    else if (command === "join") joinSelectedNodes();
    else kindSelectedNodes(command);
  };
  ctx.runNodeCommand = runNodeCommand;

  /// Le frecce coi nodi scelti: li spostano di 1, di 10 con Maiusc, di un
  /// pixel dello schermo con Ctrl o ⌘. Con l'aggancio l'angolo in alto a
  /// sinistra del loro riquadro va di riga in riga della griglia, cinque con
  /// Maiusc, sull'asse della freccia.
  const nudgeNodes = (x: number, y: number, fine: boolean, big: boolean): void => {
    const chosen = noding();
    if (chosen.length === 0) return;
    let delta: Point;
    if (fine) {
      delta = [x / ctx.camera.scale, y / ctx.camera.scale];
    } else if (gridOn()) {
      const [left, top] = nodesBox(chosen)!.min;
      const lines = big ? GRID_MAJOR : 1;
      delta = [x === 0 ? 0 : lineBeyond(left, stepNow(), sign(x), lines) - left, y === 0 ? 0 : lineBeyond(top, stepNow(), sign(y), lines) - top];
    } else {
      const step = big ? NUDGE_SHIFT : NUDGE;
      delta = [x * step, y * step];
    }
    moveSelectedNodes(chosen, delta);
  };
  ctx.nudgeNodes = nudgeNodes;

  /// Sposta di `delta`, nella scena, i nodi scelti delle forme `chosen`, e lo
  /// dice.
  const moveSelectedNodes = (chosen: readonly Editing[], delta: Point): void => {
    const changes = chosen.map((each): NodeChange => ({
      edit: each,
      subs: moveNodes(each.subs, pickedIn(each), localDelta(each, [0, 0], delta), kindsOf(each)),
      selected: pickedIn(each),
      kinds: ctx.nodeKinds.get(each.key) ?? NO_KINDS,
    }));
    if (writeEdits("draw.action.nodes_move", changes)?.written === true) announceMoved();
  };
  ctx.moveSelectedNodes = moveSelectedNodes;

  /// Il riquadro dei nodi scelti delle forme `chosen`, nella scena.
  const nodesBox = (chosen: readonly Editing[]): Bounds | null => {
    const box = new BoundsBuilder();
    for (const each of chosen) for (const key of pickedIn(each)) box.include(nodePoint(each, key));
    return box.finish();
  };
  ctx.nodesBox = nodesBox;

  /// Il riquadro a cui si allineano i nodi scelti: il loro, o la pagina per
  /// un nodo solo. `null` senza nodi scelti, o per un nodo solo in un
  /// disegno senza pagina.
  const nodesReference = (): Bounds | null => {
    const count = chosenCount();
    if (count > 1) return nodesBox(chosenEdits());
    const page = currentPage();
    return count === 0 || page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
  };
  ctx.nodesReference = nodesReference;

  /// «Allinea» coi nodi scelti: ognuno va sul bordo o sul centro del loro
  /// riquadro, o della pagina per un nodo solo, e porta con sé le sue
  /// maniglie. Le forme toccate si scrivono in un passo solo.
  function alignNodes(edge: Edge): void {
    const chosen = noding();
    const reference = nodesReference();
    if (chosen.length === 0 || reference === null) return;
    const axis = edge === "left" || edge === "center" || edge === "right" ? 0 : 1;
    const value = edge === "left" || edge === "top"
      ? reference.min[axis]
      : edge === "right" || edge === "bottom" ? reference.max[axis] : (reference.min[axis] + reference.max[axis]) / 2;
    const changes = chosen.flatMap((each): NodeChange[] => {
      const kinds = kindsOf(each);
      let subs = each.subs;
      for (const key of pickedIn(each)) {
        const from = nodePoint(each, key);
        if (from[axis] === value) continue;
        const to: Point = axis === 0 ? [value, from[1]] : [from[0], value];
        subs = moveNodes(subs, new Set([key]), localDelta(each, from, to), kinds);
      }
      return subs === each.subs ? [] : [{ edit: each, subs, selected: pickedIn(each), kinds: ctx.nodeKinds.get(each.key) ?? NO_KINDS }];
    });
    if (changes.length === 0) {
      announce(t("draw.unchanged"));
      return;
    }
    if (writeEdits("draw.action.nodes_align", changes)?.written === true) {
      announce(afterEdit(plural(chosenCount(), "draw.nodes.aligned.one", "draw.nodes.aligned.other")));
    }
  }
  ctx.alignNodes = alignNodes;

  /// «Distribuisci» coi nodi scelti, almeno tre: il primo e l'ultimo lungo
  /// l'asse restano dove sono, gli altri vanno fra loro a passi uguali, ognuno
  /// con le sue maniglie. Le forme toccate si scrivono in un passo solo.
  function distributeNodes(axis: Axis): void {
    const chosen = noding();
    if (chosen.length === 0) return;
    const a = axis === "x" ? 0 : 1;
    const spots = chosen.flatMap((each) => [...pickedIn(each)].map((key) => ({ each, key, at: nodePoint(each, key) })));
    if (spots.length < 3) {
      announce(t("draw.nodes.distribute.few"));
      return;
    }
    const sorted = [...spots].sort((p, q) => p.at[a] - q.at[a]);
    const start = sorted[0]!.at[a];
    const step = (sorted[sorted.length - 1]!.at[a] - start) / (sorted.length - 1);
    const target = new Map(sorted.map((spot, i) => [spot, start + step * i]));
    const changes = chosen.flatMap((each): NodeChange[] => {
      const kinds = kindsOf(each);
      let subs = each.subs;
      for (const spot of spots) {
        const value = target.get(spot)!;
        if (spot.each !== each || Math.abs(spot.at[a] - value) < 1e-9) continue;
        const to: Point = a === 0 ? [value, spot.at[1]] : [spot.at[0], value];
        subs = moveNodes(subs, new Set([spot.key]), localDelta(each, spot.at, to), kinds);
      }
      return subs === each.subs ? [] : [{ edit: each, subs, selected: pickedIn(each), kinds: ctx.nodeKinds.get(each.key) ?? NO_KINDS }];
    });
    if (changes.length === 0) {
      announce(t("draw.unchanged"));
      return;
    }
    if (writeEdits("draw.action.nodes_distribute", changes)?.written === true) announce(afterEdit(t("draw.nodes.distributed", { count: spots.length })));
  }

  /// Le voci di «Allinea» coi nodi scelti: per un nodo solo il riferimento
  /// è la pagina, e il nome lo dice. Poi quelle di «Distribuisci», che
  /// chiedono almeno tre nodi, e la voce spenta dice perché.
  const nodeAlignItems = (): MenuItem[] => {
    const count = chosenCount();
    const usable = nodesReference() !== null;
    const items: MenuItem[] = EDGES.map(({ edge, label }) => ({
      label: count === 1 ? t("draw.align.to_page", { action: t(label) }) : t(label),
      disabled: !usable,
      run: () => alignNodes(edge),
    }));
    const few = count < 3;
    for (const { axis, label } of AXES) {
      items.push({
        label: t(label),
        separator: axis === "x",
        disabled: few,
        ...(few ? { description: t("draw.nodes.distribute.few") } : {}),
        run: () => distributeNodes(axis),
      });
    }
    return items;
  };
  ctx.nodeAlignItems = nodeAlignItems;

  /// Porta gli oggetti scelti in cima a `layer`, dove si vedevano.
  function moveIntoLayer(layer: LayerInfo): void {
    const units = arranging("layers");
    if (units === null) return;
    const name = layerTitle(layer);
    const refusal = layerRefusal(layer);
    if (refusal !== null) {
      announce(t(refusal, { name }));
      return;
    }
    const arranged = intoLayerOps(ctx.engine.model!, units, layer, newIds());
    if (arranged === null) {
      announce(t("draw.layer.flat", { name }));
      return;
    }
    const moving = units.filter((unit) => !inLayer(unit, layer)).length;
    // Chi entra nel livello ne prende l'opacità e la visibilità.
    const kept = arrange("draw.action.into_layer", arranged, null, { key: "draw.layer.styled", vars: { name }, containers: "take" });
    if (kept === null) return;
    // La selezione ha le stesse chiavi, ma sta nel livello nuovo.
    followSelection();
    announce(`${plural(moving, "draw.moved_to_layer.one", "draw.moved_to_layer.other", { name })}${kept}`);
  }

  /// Le voci di «Sposta in un livello», dalla cima: spento il livello che ha
  /// già tutti gli oggetti scelti, e quello bloccato o nascosto, che lo dice.
  const intoItems = (): MenuItem[] => {
    const units = selectedUnits();
    const layers = currentIndex().layers;
    const items: MenuItem[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      const here = units.length > 0 && units.every((unit) => inLayer(unit, layer));
      const description = here ? t("draw.into_layer.here") : layerState(layer);
      items.push({
        label: layerTitle(layer),
        disabled: here || layerRefusal(layer) !== null,
        ...(description === "" ? {} : { description }),
        run: () => moveIntoLayer(layer),
      });
    }
    return items;
  };
  ctx.intoItems = intoItems;
}
