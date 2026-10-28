// L'editor del disegno: l'albero degli oggetti. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import type { Lifetime } from "../../../../ui/lifetime";
import { countObjects, describe, keyOf, outlineAll, type OutlineNode } from "../../describe";
import type { Bounds } from "../../scene/geometry";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../../scene/model";
import type { Role } from "../../scene/analysis";
import { auditScene, MAX_BOARDS } from "../../scene/read";
import type { ElementItem, Item } from "../../scene/classify";
import { plural, t, type DrawKey } from "../../strings";
import { resourcesFor, symbolsFor, type HeadInfo, type PaintNode, type PaintScene } from "../../painter/paint";
import { miniaturePicture, paintMiniature, shapeCount, type MiniatureBox } from "../../painter/svg-dom";
import { gesture as asGesture } from "../edit";
import { holdsLink, linkTarget, nodeOf } from "../arrange";
import { lookOps, type LookChange } from "../look";
import { distinguishOps, type HatchPreset } from "../patterns";
import { SceneIndex, type Unit } from "../hit";
import { HISTORY_LIMIT } from "../history";
import type { BoardRow } from "../boards-panel";
import { problemsOf, readingOrder, type AuditCode, type Problem } from "../audit";
import { layerName, renameLayerOps } from "../layers";
import { cleanName, decorativeOps, nameable, nameOps } from "../naming";
import type { TreeDrop, TreeEntry, TreeKind, TreeThumbnail } from "../objects";
import { placeOps, type Place } from "../place";
import { swatchOf } from "../palette";
import type { EditorContext } from "./context";
import { layerTitle } from "./helpers";

/// Quanto aspetta la verifica dell'accessibilità, dopo l'ultimo cambio del
/// disegno, prima di rileggerlo: rileggerlo costa quanto aprirlo.
const AUDIT_MS = 250;

/// Come si dice, nell'annuncio della verifica, ogni campitura pronta.
const HATCH_NAMES: Readonly<Record<HatchPreset, DrawKey>> = {
  diagonal: "draw.access.preset.diagonal",
  cross: "draw.access.preset.cross",
  horizontal: "draw.access.preset.horizontal",
  dots: "draw.access.preset.dots",
  grid: "draw.access.preset.grid",
};

/// Perché una voce dell'albero non si rinomina e non si sposta: è bloccata,
/// o lo è ciò che la contiene, o il suo livello.
type Refusal = "locked" | "container_locked" | "layer_locked";

/// Uno spostamento dall'albero, pronto: i nodi che vanno, il contenitore
/// che li riceve, il posto fra i suoi figli e se sono livelli.
interface Placing {
  readonly moving: readonly ElementPart[];
  readonly parent: ContainerNode;
  readonly at: Place;
  readonly layers: boolean;
}

/// Fino a quante forme una miniatura è viva, con le immagini del vault; fino
/// a quante è un'immagine ferma. Oltre, la riga non ne ha.
const THUMB_LIVE_SHAPES = 200;

const THUMB_PICTURE_SHAPES = 5000;

/// Il riquadro di una miniatura da quello di un oggetto.
function miniatureBox(bounds: Bounds | null): MiniatureBox | null {
  return bounds === null ? null : { x: bounds.min[0], y: bounds.min[1], width: bounds.max[0] - bounds.min[0], height: bounds.max[1] - bounds.min[1] };
}

/// Il tipo di un oggetto per il filtro dell'albero: le forme, i tracciati e
/// le frecce sono «Forme».
function treeKind(role: Role): TreeKind {
  switch (role) {
    case "layer":
    case "group":
    case "link":
    case "stroke":
    case "text":
    case "image":
      return role;
    default:
      return "shape";
  }
}

/// Ciò che l'albero degli oggetti dà agli altri pezzi dell'editor.
export interface TreeContext {
  outlineNow: () => NonNullable<{ readonly items: readonly Item[]; readonly nodes: OutlineNode[]; readonly symbols: ReadonlyMap<string, readonly OutlineNode[]>; readonly byKey: Map<string, OutlineNode>; } | null>;
  describeNode: (node: OutlineNode, unit: Unit | undefined, state?: boolean) => string;
  labelOf: (unit: Unit) => string;
  /// Le voci dell'albero per l'indice e il livello corrente di adesso, e la
  /// selezione mostrata.
  treeShown: {
    readonly index: SceneIndex;
    readonly layer: string | null;
    readonly mode: string;
    readonly entries: TreeEntry[];
    /// Perché una voce non si rinomina e non si sposta.
    readonly refusals: ReadonlyMap<string, Refusal>;
    readonly count: number;
    keys: string;
  } | null;
  syncTree: () => void;
  canRename: (key: string) => boolean;
  renameRow: (key: string, name: string) => string | null;
  placing: (keys: readonly string[], drop: TreeDrop) => Placing | DrawKey | null;
  moveRows: (keys: readonly string[], drop: TreeDrop) => readonly string[] | null;
  renameSelection: () => void;
  showHistory: (open: boolean, focus?: boolean) => void;
  syncHistory: () => void;
  showBoards: (open: boolean, focus?: boolean) => void;
  syncBoards: () => void;
  showLibrary: (open: boolean, focus?: boolean) => void;
  showSymbols: (open: boolean, focus?: boolean) => void;
  showAccess: (open: boolean, focus?: boolean) => void;
  accessNames: Map<string, string>;
  accessName: (key: string) => string;
  syncAccess: (now?: boolean) => void;
  goToObject: (key: string) => void;
  fixProblem: (stale: Problem) => void;
  writeDescription: (key: string, text: string) => boolean;
  writeDecorative: (key: string) => boolean;
  describeImage: (key: string, text: string) => void;
  decorateImage: (key: string) => void;
}

/// Monta l'albero degli oggetti.
export function installTree(ctx: EditorContext): void {
  const {
    has, drawingFonts, measureText, history, surface, tree, historyPanel, accessPanel, boardsPanel, libraryPanel, symbolLibraries, symbolsPanel,
    boardsButton, libraryButton, symbolsButton, historyButton, accessButton, titleInput, images, builder, indexer, boardsNow, editable, isolatedNode,
    currentIndex, newIds, announce, announceSelection, hundredthsText, selectedUnits, measuresText
  } = ctx;
  // --- L'albero degli oggetti ----------------------------------------------

  /// Il disegno in albero, ricalcolato quando cambia la scena, e i suoi nodi
  /// per chiave.
  let outlined: {
    readonly items: readonly Item[];
    readonly nodes: OutlineNode[];
    readonly symbols: ReadonlyMap<string, readonly OutlineNode[]>;
    readonly byKey: Map<string, OutlineNode>;
  } | null = null;
  const outlineNow = (): NonNullable<typeof outlined> => {
    const items = ctx.engine.scene();
    if (outlined?.items !== items) {
      const model = ctx.engine.model;
      const { nodes, symbols } = outlineAll(items, (item) => (model === null ? null : linkTarget(nodeOf(model, item))));
      const byKey = new Map<string, OutlineNode>();
      const walkNodes = (list: readonly OutlineNode[]): void => {
        for (const node of list) {
          byKey.set(node.key, node);
          walkNodes(node.children);
        }
      };
      walkNodes(nodes);
      // Anche ciò che sta in un simbolo ha il suo nome, per quando lo si
      // modifica.
      for (const content of symbols.values()) walkNodes(content);
      outlined = { items, nodes, symbols, byKey };
    }
    return outlined;
  };
  ctx.outlineNow = outlineNow;

  /// Il nome del colore di ciò che `paints` dipinge, se è uno della
  /// tavolozza: il contorno, o il riempimento se non ne ha.
  const colorOf = (paints: readonly PaintNode[]): string | null => {
    const attrs = new Map(paints[0]?.attrs ?? []);
    const stroke = attrs.get("stroke");
    const value = stroke !== undefined && stroke !== "none" ? stroke : attrs.get("fill");
    const swatch = value === undefined ? null : swatchOf(value);
    return swatch === null ? null : t(swatch.label);
  };

  /// Il nome di un oggetto col suo colore. Uno che non si sceglie, bloccato
  /// o in un livello bloccato, prende il colore da ciò che si dipinge.
  const describeNode = (node: OutlineNode, unit: Unit | undefined, state = true): string => {
    const model = ctx.engine.model;
    const paints = unit?.paints ?? (model === null ? [] : builder.paintsOf(nodeOf(model, node.item)));
    return describe(node, { parts: true, color: colorOf(paints), state });
  };
  ctx.describeNode = describeNode;

  /// Il nome a parole di un oggetto che si sceglie.
  const labelOf = (unit: Unit): string => {
    const node = outlineNow().byKey.get(unit.key);
    return node === undefined ? unit.tag : describeNode(node, unit);
  };
  ctx.labelOf = labelOf;

  /// Le voci dell'albero; il livello di chiave `current` dice che è quello
  /// corrente. Con la selezione avanzata i gruppi e i collegamenti mostrano
  /// i loro figli. I segni bloccano e nascondono, nel disegno che si scrive:
  /// un livello coi livelli, un oggetto con la selezione avanzata, se niente
  /// che lo contiene è bloccato (`under` dice che cosa). Coi livelli ogni
  /// voce si rinomina e si sposta, e ha la sua miniatura: un oggetto
  /// bloccato, o dentro qualcosa di bloccato, lascia in `refusals` il perché
  /// no.
  const entriesOf = (
    nodes: readonly OutlineNode[],
    index: SceneIndex,
    current: string | null,
    under: Refusal | null,
    refusals: Map<string, Refusal>,
    moves: boolean,
  ): TreeEntry[] =>
    nodes.map((node) => {
      const unit = index.get(node.key) ?? undefined;
      const layer = node.item.role === "layer";
      const holds = node.item.role === "group" || node.item.role === "link";
      const locked = node.item.locked === true;
      const mark = layer && node.key === current ? `, ${t("draw.state.current")}` : "";
      const refusal = layer ? null : locked ? "locked" : under;
      if (refusal !== null) refusals.set(node.key, refusal);
      const inner = under ?? (!locked ? null : layer ? "layer_locked" : "container_locked");
      const title = layer ? node.name : cleanName(node.item.title ?? "");
      return {
        key: node.key,
        layer,
        selectable: unit !== undefined,
        locked,
        hidden: node.item.hidden === true,
        toggles: editable() && (layer ? has("layers") : has("selection") && under === null),
        name: title === null || title === "" ? null : title,
        renames: editable() && has("layers"),
        moves,
        ...(has("layers") ? { thumbnail: () => thumbnailOf(node.item) } : {}),
        kind: treeKind(node.item.role),
        children: layer || (holds && has("selection")) ? entriesOf(node.children, index, current, inner, refusals, moves) : [],
        label: () => `${describeNode(node, unit)}${mark}`,
      };
    });

  /// Il riquadro delle miniature dei livelli, lo stesso per tutti perché si
  /// veda dove sta ciascuno: la pagina, o senza pagina tutto il disegno.
  let sheet: { readonly scene: PaintScene; readonly box: MiniatureBox | null } | null = null;
  const sheetOf = (model: DocumentModel): MiniatureBox | null => {
    if (sheet?.scene !== ctx.scene) sheet = { scene: ctx.scene, box: ctx.scene.root.page ?? miniatureBox(indexer.extent(model)) };
    return sheet.box;
  };

  /// La miniatura di una voce dell'albero: ciò che il disegno dipinge per
  /// lei, dentro gli stili di chi la contiene e con le risorse che usa; un
  /// oggetto inquadrato sul suo riquadro, un livello sul foglio. La chiave
  /// cambia quando cambia ciò che si vede: la voce, il testo dei tag di chi
  /// la contiene, che resta anche quando il contenitore si rifà, la radice,
  /// le risorse e il foglio.
  const thumbnailOf = (item: ElementItem): TreeThumbnail | null => {
    const model = ctx.engine.model;
    if (model === null) return null;
    const node = nodeOf(model, item);
    const paints = builder.paintsOf(node);
    if (paints.length === 0) return null;
    const heads: HeadInfo[] = [];
    for (let at = node.parent; at !== null && at !== model.root; at = at.parent) heads.unshift(builder.headInfo(at));
    const root = ctx.scene.root;
    const layer = item.role === "layer";
    const box = layer ? sheetOf(model) : null;
    if (layer && box === null) return null;
    const frame = box === null ? "" : `|${box.x} ${box.y} ${box.width} ${box.height}`;
    const chain = [root.attrs, ...heads.map((head) => head.attrs)];
    const symbols = symbolsFor(paints, ctx.scene.symbols);
    const used = resourcesFor([...paints, ...symbols], chain, ctx.scene.resources);
    const serials = (list: readonly object[]): string => list.map((paint) => builder.serialOf(paint)).join(" ");
    return {
      key: `${builder.serialOf(root)}|${heads.map((head) => head.head + (head.tail ?? "")).join("")}|${serials(paints)}|${serials(used)}|${serials(symbols)}${frame}`,
      draw: (owner) => {
        // Il contenuto dei simboli conta: un'istanza ne disegna tutte le forme.
        const count = shapeCount([...paints, ...symbols], THUMB_PICTURE_SHAPES);
        if (count > THUMB_PICTURE_SHAPES) return null;
        const framed = box ?? miniatureBox(indexer.frameOf(model, node));
        if (framed === null) return null;
        const live = count <= THUMB_LIVE_SHAPES;
        const resolve = live && images !== undefined ? (href: string, life: Lifetime) => images.url(href, life) : undefined;
        const svg = paintMiniature(paints, chain, framed, owner, resolve, used, drawingFonts.live, symbols);
        return live ? svg : miniaturePicture(svg, owner);
      },
    };
  };

  ctx.treeShown = null;

  /// Porta l'albero, se è aperto, alla scena e alla selezione di adesso.
  function syncTree(): void {
    if (tree.element.hidden) return;
    const index = currentIndex();
    const keys = ctx.selection.join("\n");
    const layer = has("layers") ? ctx.currentLayer() : null;
    const current = layer === null ? null : keyOf(layer);
    // Le voci dipendono anche da ciò che il livello offre e dal disegno che
    // si scrive.
    const mode = `${editable()} ${has("layers")} ${has("selection")}`;
    if (ctx.treeShown?.index !== index || ctx.treeShown.layer !== current || ctx.treeShown.mode !== mode) {
      // Mentre si modifica un simbolo l'albero è il suo contenuto, che non
      // sta sul foglio; le voci si spostano con «Disponi», non trascinandole.
      const isolated = isolatedNode();
      const symbol = isolated?.details?.role === "symbol" ? isolated.facts.id : null;
      const nodes = symbol === null ? outlineNow().nodes : (outlineNow().symbols.get(symbol) ?? []);
      const refusals = new Map<string, Refusal>();
      const entries = entriesOf(nodes, index, current, null, refusals, editable() && has("layers") && symbol === null);
      ctx.treeShown = { index, layer: current, mode, entries, refusals, count: countObjects(nodes), keys: "" };
    } else if (ctx.treeShown.keys === keys) {
      return;
    }
    ctx.treeShown.keys = keys;
    // Il filtro e i nomi vengono coi livelli.
    tree.setFiltering(has("layers"));
    tree.update(ctx.treeShown.entries, ctx.selection, ctx.treeShown.count);
  }
  ctx.syncTree = syncTree;

  /// Vero se la voce `key` si rinomina adesso; se no, lo dice e dice perché.
  /// Un oggetto che il disegno non sa riscrivere lo dice prima che si scriva
  /// il nome.
  function canRename(key: string): boolean {
    const model = ctx.engine.model;
    const outlined = outlineNow().byKey.get(key);
    if (model === null || outlined === undefined || !editable() || !has("layers")) return false;
    const refusal = ctx.treeShown?.refusals.get(key);
    if (refusal !== undefined) {
      announce(t(`draw.rename.${refusal}`));
      return false;
    }
    if (outlined.item.role !== "layer" && !nameable(model, outlined.item)) {
      announce(t("draw.rename.foreign"));
      return false;
    }
    return true;
  }
  ctx.canRename = canRename;

  /// Dà alla voce `key` il nome `name`, già ripulito: un livello il suo nome,
  /// mai vuoto; un oggetto il suo primo `title`, che un nome vuoto toglie. La
  /// chiave di dopo, che cambia se l'oggetto riceve un id.
  function renameRow(key: string, name: string): string | null {
    const model = ctx.engine.model;
    const outlined = outlineNow().byKey.get(key);
    if (model === null || outlined === undefined || !editable() || !has("layers")) return null;
    ctx.cancelGesture();
    if (outlined.item.role === "layer") {
      const layer = currentIndex().layers.find((each) => keyOf(each) === key);
      if (layer === undefined) return null;
      const next = layerName(name);
      if (next === "") {
        announce(t("draw.layer.name.required"));
        return null;
      }
      const arranged = renameLayerOps(model, layer, next, newIds());
      const now = arranged.keys[0] ?? key;
      // Il livello corrente resta lui anche se riceve un id.
      const before = ctx.currentLayer();
      const isCurrent = before !== null && keyOf(before) === key;
      if (!ctx.writeLayers("draw.action.layer_rename", arranged, isCurrent ? now : null)) return null;
      announce(t("draw.layer.renamed", { name: layerTitle({ ...layer, name: next }) }));
      return now;
    }
    const change = nameOps(model, outlined.item, name, newIds());
    if (change === "foreign") {
      announce(t("draw.rename.foreign"));
      return null;
    }
    if (change.ops.length === 0) return key;
    const now = change.keys[0] ?? key;
    const before = ctx.selection;
    if (ctx.commit("draw.action.name", asGesture(change.ops)) === null) return null;
    // Scelto prima, scelto dopo, anche con l'id nuovo.
    if (now !== key && before.includes(key)) ctx.select(before.map((each) => (each === key ? now : each)));
    const after = outlineNow().byKey.get(now);
    announce(name !== "" ? t("draw.named", { name }) : t("draw.unnamed", { name: after === undefined ? "" : describeNode(after, currentIndex().get(now) ?? undefined, false) }));
    return now;
  }
  ctx.renameRow = renameRow;

  /// Dove `drop` porta le voci `keys` dell'albero: i loro nodi, il
  /// contenitore che le riceve, il posto fra i suoi figli e se sono livelli;
  /// o perché no, a parole. `null` se non c'è niente da dire: il disegno non
  /// si scrive, o le voci non ci sono più.
  const placing = (keys: readonly string[], drop: TreeDrop): Placing | DrawKey | null => {
    const model = ctx.engine.model;
    if (model === null || !editable() || !has("layers") || keys.length === 0) return null;
    const outlined = outlineNow();
    const host = outlined.byKey.get(drop.key);
    if (host === undefined) return null;
    const items: OutlineNode[] = [];
    for (const key of keys) {
      const item = outlined.byKey.get(key);
      if (item === undefined) return null;
      const refusal = ctx.treeShown?.refusals.get(key);
      if (refusal !== undefined) return `draw.move.${refusal}`;
      items.push(item);
    }
    // Un livello va solo fra i livelli, e da solo; un oggetto non va fra i
    // livelli, ma dentro.
    const layers = items[0]!.item.role === "layer";
    const inside = drop.place === "top" || drop.place === "bottom";
    if (items.some((item) => (item.item.role === "layer") !== layers) || (host.item.role === "layer" ? inside === layers : layers)) return "draw.move.layers";
    const target = nodeOf(model, host.item);
    const parent = inside ? target : target.parent;
    if (parent === null || parent.kind !== "container") return null;
    const moving = items.map((item) => nodeOf(model, item.item));
    // Né dentro sé stesso, né dentro qualcosa di bloccato, né un
    // collegamento dentro un altro.
    let linked = false;
    for (let at: ContainerNode | null = parent; at !== null && at !== model.root; at = at.parent) {
      if (moving.includes(at)) return "draw.move.inside";
      if (at.details?.locked === true) return at.details.role === "layer" ? "draw.move.into_layer_locked" : "draw.move.into_locked";
      if (at.details?.role === "link") linked = true;
    }
    if (linked && moving.some((node) => holdsLink(node))) return "draw.move.link";
    let at: Place;
    if (drop.place === "top") at = "last";
    else if (drop.place === "bottom") at = "first";
    else if (drop.place === "before") at = { after: target };
    else {
      // Dietro a lui: dopo ciò che gli sta subito dietro.
      const siblings = elementChildren(parent);
      const behind = siblings[siblings.indexOf(target) - 1];
      at = behind === undefined ? "first" : { after: behind };
    }
    return { moving, parent, at, layers };
  };
  ctx.placing = placing;

  /// Porta le voci `keys` dell'albero in `drop`, in un passo della
  /// cronologia, e lo dice; la selezione le segue. Le chiavi di dopo, nello
  /// stesso ordine; `null` se non si sono spostate, e si dice perché.
  function moveRows(keys: readonly string[], drop: TreeDrop): readonly string[] | null {
    const model = ctx.engine.model;
    const plan = placing(keys, drop);
    if (model === null || plan === null) return null;
    if (typeof plan === "string") {
      announce(t(plan));
      return null;
    }
    ctx.cancelGesture();
    const arranged = placeOps(model, plan.moving, plan.parent, plan.at, newIds());
    if (arranged === null) {
      announce(t("draw.move.flat"));
      return null;
    }
    // Lasciato dov'era: niente da scrivere, e niente da dire.
    if (arranged.ops.length === 0) return arranged.keys;
    // Un livello si sposta con tutto ciò che ha; un oggetto prende l'opacità
    // e la visibilità del contenitore in cui entra.
    const looked = ctx.keptLook(arranged, { key: "draw.move.styled", containers: plan.layers ? "keep" : "take" });
    if (looked === null) return null;
    if (plan.layers) {
      // Il livello corrente resta lui, anche se riceve un id.
      const current = ctx.currentLayer();
      const at = current === null ? -1 : keys.indexOf(keyOf(current));
      if (!ctx.writeLayers("draw.action.layer_order", looked, at < 0 ? null : looked.keys[at] ?? null)) return null;
    } else {
      if (ctx.commit("draw.action.place", asGesture(looked.ops)) === null) return null;
      ctx.select(looked.keys);
    }
    announceMove(looked.keys, looked.kept);
    return looked.keys;
  }
  ctx.moveRows = moveRows;

  /// Dice dove sono arrivate le voci `keys`: un livello a che posto dalla
  /// cima, un oggetto dentro che cosa e a che posto dal davanti; poi
  /// `note`, se c'è, con lo spazio davanti.
  const announceMove = (keys: readonly string[], note = ""): void => {
    const outlined = outlineNow();
    const first = outlined.byKey.get(keys[0] ?? "");
    if (first === undefined) return;
    const find = (list: readonly OutlineNode[], parent: OutlineNode | null): { readonly parent: OutlineNode | null; readonly list: readonly OutlineNode[] } | null => {
      for (const node of list) {
        if (node === first) return { parent, list };
        const inner = find(node.children, node);
        if (inner !== null) return inner;
      }
      return null;
    };
    const spot = find(outlined.nodes, null);
    if (spot === null) return;
    if (first.item.role === "layer") {
      const layers = spot.list.filter((node) => node.item.role === "layer");
      const layer = currentIndex().layers.find((each) => keyOf(each) === first.key);
      const name = layer === undefined ? first.name ?? "" : layerTitle(layer);
      announce(`${t("draw.layer.placed", { name, position: layers.length - layers.indexOf(first), total: layers.length })}${note}`);
      return;
    }
    const index = currentIndex();
    const parent = spot.parent;
    const layer = parent?.item.role === "layer" ? index.layers.find((each) => keyOf(each) === parent.key) : undefined;
    const where = parent === null
      ? t("draw.where.root")
      : layer !== undefined
        ? t("draw.where.layer", { name: layerTitle(layer) })
        : t("draw.where.group", { name: describeNode(parent, index.get(parent.key) ?? undefined, false) });
    // I posti si contano dal davanti, come le righe; più oggetti stanno
    // vicini, dal più avanti.
    const total = spot.list.length;
    const front = outlined.byKey.get(keys[keys.length - 1] ?? "") ?? first;
    const from = total - spot.list.indexOf(front);
    const placed = keys.length === 1
      ? t("draw.placed", { name: describeNode(first, index.get(first.key) ?? undefined, false), where, position: from, total })
      : plural(keys.length, "draw.placed.one", "draw.placed.other", { where, from, to: from + keys.length - 1, total });
    announce(`${placed}${note}`);
  };

  /// «Rinomina», e F2 sul foglio su un oggetto che non è un testo: il campo
  /// del nome nell'albero, che si apre.
  function renameSelection(): void {
    if (!has("layers") || !editable()) return;
    const units = selectedUnits();
    if (units.length !== 1) {
      announce(t("draw.rename.none"));
      return;
    }
    if (tree.element.hidden) ctx.showObjects(true);
    tree.rename(units[0]!.key);
  }
  ctx.renameSelection = renameSelection;

  /// Apre o chiude la cronologia; aperta, il fuoco ci va.
  function showHistory(open: boolean, focus = true): void {
    if (open && !has("history")) return;
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    if (ctx.routed("history", open)) {
      if (open && focus && !historyPanel.element.hidden) historyPanel.focus();
      return;
    }
    if (!open && historyPanel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    historyPanel.element.hidden = !open;
    historyButton.setAttribute("aria-expanded", String(open));
    ctx.syncDock();
    if (open) {
      ctx.historyShown = null;
      syncHistory();
      if (focus) historyPanel.focus();
    }
  }
  ctx.showHistory = showHistory;

  /// Porta la cronologia, se è aperta, alla pila di adesso.
  function syncHistory(): void {
    if (historyPanel.element.hidden) return;
    const canEdit = editable();
    if (ctx.historyShown !== null && ctx.historyShown.revision === history.revision && ctx.historyShown.editable === canEdit) return;
    ctx.historyShown = { revision: history.revision, editable: canEdit };
    historyPanel.update({
      steps: history.steps(),
      done: history.done,
      start: history.start,
      trimmed: history.trimmed,
      limit: HISTORY_LIMIT,
      marks: history.marks,
      editable: canEdit,
    });
  }
  ctx.syncHistory = syncHistory;

  /// Apre o chiude l'elenco delle tavole; aperto, il fuoco ci va.
  function showBoards(open: boolean, focus = true): void {
    if (open && !has("board")) return;
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    if (ctx.routed("design", open)) {
      if (open && focus && !boardsPanel.element.hidden) boardsPanel.focus();
      return;
    }
    if (!open && boardsPanel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    boardsPanel.element.hidden = !open;
    boardsButton.setAttribute("aria-expanded", String(open));
    ctx.syncDock();
    if (open) {
      ctx.boardsShown = null;
      syncBoards();
      if (focus) boardsPanel.focus();
    }
  }
  ctx.showBoards = showBoards;

  /// Porta l'elenco delle tavole, se è aperto, alle tavole di adesso e a
  /// quella di adesso (vedi [`currentBoard`]).
  function syncBoards(): void {
    if (boardsPanel.element.hidden) return;
    const list = boardsNow();
    if (ctx.boardRows?.list !== list) {
      const rows = list.map((board): BoardRow => ({ id: board.id, name: board.name, size: measuresText([board.rect[2], board.rect[3]]) }));
      const before = ctx.boardRows?.rows;
      const same = before !== undefined && before.length === rows.length && rows.every((row, at) => before[at]!.id === row.id && before[at]!.name === row.name && before[at]!.size === row.size);
      ctx.boardRows = { list, rows: same ? before : rows };
    }
    const rows = ctx.boardRows.rows;
    const current = ctx.currentBoard()?.id ?? null;
    const canEdit = editable();
    const paged = ctx.scene.root.page !== null;
    const shown = ctx.boardsShown;
    if (shown !== null && shown.rows === rows && shown.current === current && shown.editable === canEdit && shown.paged === paged) return;
    ctx.boardsShown = { rows, current, editable: canEdit, paged };
    boardsPanel.update({ boards: rows, current, editable: canEdit, canAdd: rows.length < MAX_BOARDS, paged });
  }
  ctx.syncBoards = syncBoards;

  /// Apre o chiude le forme; aperte, il fuoco va al campo di ricerca. Un
  /// trascinamento in corso finisce.
  function showLibrary(open: boolean, focus = true): void {
    if (open && !has("library")) return;
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    if (ctx.routed("resources", open)) {
      if (open && focus && !libraryPanel.element.hidden) libraryPanel.focus();
      return;
    }
    if (!open && libraryPanel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    if (!open) ctx.cancelShapeDrag();
    libraryPanel.element.hidden = !open;
    libraryButton.setAttribute("aria-expanded", String(open));
    ctx.syncDock();
    if (open) {
      libraryPanel.update({ editable: editable() });
      if (focus) libraryPanel.focus();
    }
  }
  ctx.showLibrary = showLibrary;

  /// Apre o chiude i simboli; aperti, il fuoco va al campo di ricerca, e le
  /// librerie del vault si leggono, la prima volta. Un trascinamento in
  /// corso finisce.
  function showSymbols(open: boolean, focus = true): void {
    if (open && !has("symbols")) return;
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    if (ctx.routed("resources", open)) {
      if (open && focus && !symbolsPanel.element.hidden) symbolsPanel.focus();
      return;
    }
    if (!open && symbolsPanel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    if (!open) ctx.cancelSymbolDrag();
    symbolsPanel.element.hidden = !open;
    symbolsButton.setAttribute("aria-expanded", String(open));
    ctx.syncDock();
    if (open) {
      symbolLibraries?.start();
      ctx.syncSymbols();
      if (focus) symbolsPanel.focus();
    }
  }
  ctx.showSymbols = showSymbols;

  /// Apre o chiude la verifica dell'accessibilità; aperta, il fuoco ci va.
  /// Chiusa, dimentica ciò che ha letto.
  function showAccess(open: boolean, focus = true): void {
    if (open && !has("accessibility")) return;
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    if (ctx.routed("accessibility", open)) {
      if (open && focus && !accessPanel.element.hidden) accessPanel.focus();
      return;
    }
    if (!open && accessPanel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    accessPanel.element.hidden = !open;
    accessButton.setAttribute("aria-expanded", String(open));
    ctx.syncDock();
    ctx.accessShown = null;
    if (open) {
      syncAccess(true);
      if (focus) accessPanel.focus();
    } else {
      clearTimeout(ctx.auditTimer);
      ctx.audited = null;
      accessNames.clear();
    }
  }
  ctx.showAccess = showAccess;

  /// I problemi del testo `text`; nessuno se non si legge.
  const auditOf = (text: string): readonly Problem[] => {
    try {
      const audit = auditScene(text);
      return problemsOf(audit.scene, audit.measures);
    } catch {
      return [];
    }
  };

  /// Il nome a parole di ogni oggetto della verifica, come nell'albero, per
  /// chiave: si rifà a ogni disegno nuovo.
  const accessNames = new Map<string, string>();
  ctx.accessNames = accessNames;
  const accessName = (key: string): string => {
    let name = accessNames.get(key);
    if (name === undefined) {
      const node = outlineNow().byKey.get(key);
      name = node === undefined ? key : describeNode(node, currentIndex().get(key) ?? undefined);
      accessNames.set(key, name);
    }
    return name;
  };
  ctx.accessName = accessName;

  /// Porta la verifica, se è aperta, al disegno di adesso. L'ordine di
  /// lettura segue subito; i problemi di un disegno cambiato si rileggono un
  /// momento dopo l'ultimo cambio, o subito con `now`.
  function syncAccess(now = false): void {
    if (accessPanel.element.hidden) return;
    const text = ctx.engine.text;
    if (ctx.audited === null || ctx.audited.text !== text) {
      clearTimeout(ctx.auditTimer);
      if (now || ctx.audited === null) ctx.audited = { text, problems: auditOf(text) };
      else ctx.auditTimer = setTimeout(() => syncAccess(true), AUDIT_MS);
    }
    const { items, nodes } = outlineNow();
    const selected = ctx.selection.length === 1 ? ctx.selection[0]! : null;
    const canEdit = editable();
    if (ctx.accessShown !== null && ctx.accessShown.problems === ctx.audited.problems && ctx.accessShown.items === items && ctx.accessShown.selected === selected && ctx.accessShown.editable === canEdit) return;
    if (ctx.accessShown?.items !== items) accessNames.clear();
    ctx.accessShown = { problems: ctx.audited.problems, items, selected, editable: canEdit };
    // Un oggetto che non si sceglie, bloccato o fuori dal gruppo isolato, non
    // si corregge da qui: ci si va, e si dice perché.
    const index = currentIndex();
    const problems = ctx.audited.problems.map((problem) =>
      problem.key === null || problem.fix === null || index.get(problem.key) !== null ? problem : { ...problem, fix: null },
    );
    accessPanel.update({ problems, reading: readingOrder(nodes), nameOf: accessName, selected, editable: canEdit });
  }
  ctx.syncAccess = syncAccess;

  /// Il problema `code` dell'oggetto `key` nel disegno di adesso, letto di
  /// nuovo se è cambiato; `null` se non c'è più.
  const problemNow = (code: AuditCode, key: string | null): Problem | null => {
    syncAccess(true);
    return ctx.audited?.problems.find((problem) => problem.code === code && problem.key === key) ?? null;
  };

  /// Sceglie l'oggetto `key` e lo mostra; uno che non si sceglie lo dice.
  function goToObject(key: string): void {
    ctx.cancelGesture();
    const unit = currentIndex().get(key);
    if (unit === null) {
      announce(t("draw.access.unreachable", { name: accessName(key) }));
      return;
    }
    ctx.select([key]);
    ctx.frameBounds(unit.bounds);
    announceSelection();
  }
  ctx.goToObject = goToObject;

  /// La selezione di prima, con l'oggetto `key` che ora si chiama `now`.
  const renamedIn = (key: string, now: string): void => {
    if (now !== key && ctx.selection.includes(key)) ctx.select(ctx.selection.map((each) => (each === key ? now : each)));
  };

  /// Dà una campitura che le distingue alle aree `keys` di un colore, in un
  /// passo; quelle che non si scelgono, o che hanno già una campitura, una
  /// sfumatura o un motivo, restano.
  function hatchAreas(keys: readonly string[]): void {
    const model = ctx.engine.model;
    const index = currentIndex();
    const units = keys.flatMap((key) => {
      const unit = index.get(key);
      return unit === null ? [] : [unit];
    });
    if (model === null || units.length === 0) return;
    ctx.cancelGesture();
    const hatched = distinguishOps(model, units, measureText, newIds());
    if (hatched.ops.length === 0 || hatched.preset === null) return;
    if (ctx.commit("draw.access.action.hatch", asGesture(hatched.ops)) === null) return;
    // Le aree che ricevono un id cambiano chiave: la selezione le segue.
    const now = new Map(units.map((unit, at) => [unit.key, hatched.keys[at] ?? unit.key]));
    if (ctx.selection.some((key) => (now.get(key) ?? key) !== key)) ctx.select(ctx.selection.map((key) => now.get(key) ?? key));
    syncAccess(true);
    announce(plural(hatched.reached, "draw.access.fixed.hatch.one", "draw.access.fixed.hatch.other", { preset: t(HATCH_NAMES[hatched.preset]) }));
  }

  /// Corregge `stale`, com'è nel disegno di adesso, in un passo.
  function fixProblem(stale: Problem): void {
    const problem = problemNow(stale.code, stale.key);
    const fix = problem?.fix ?? null;
    if (problem === null || fix === null) return;
    if (fix.kind === "title") {
      if (has("properties")) ctx.showPanel(true, false);
      titleInput.focus();
      titleInput.select();
      return;
    }
    if (fix.kind === "describe" || !editable()) return;
    const rekey = ctx.settleCrop();
    const model = ctx.engine.model;
    if (fix.kind === "hatch") {
      hatchAreas(fix.keys.map(rekey));
      return;
    }
    const unit = problem.key === null ? null : currentIndex().get(rekey(problem.key));
    if (model === null || unit === null) return;
    ctx.cancelGesture();
    const change: LookChange = fix.kind === "size" ? { size: fix.size } : fix.paint === "fill" ? { fill: fix.color } : { stroke: fix.color };
    const restyled = lookOps(model, [unit], change, measureText, newIds());
    if (restyled.ops.length === 0) return;
    const name = accessName(unit.key);
    if (ctx.commit(fix.kind === "size" ? "draw.action.font_size" : fix.paint === "fill" ? "draw.action.fill" : "draw.action.outline_color", asGesture(restyled.ops)) === null) return;
    renamedIn(unit.key, restyled.keys[0] ?? unit.key);
    syncAccess(true);
    announce(
      fix.kind === "size"
        ? t("draw.access.fixed.size", { name, size: hundredthsText(fix.size) })
        : t("draw.access.fixed.color", { name, color: fix.color, ratio: hundredthsText(Math.floor(fix.ratio * 100) / 100) }),
    );
  }
  ctx.fixProblem = fixProblem;

  /// Dà all'immagine `key` la descrizione `text`, il suo titolo, in un
  /// passo. Vero se l'ha scritta.
  function writeDescription(key: string, text: string): boolean {
    const model = ctx.engine.model;
    const node = outlineNow().byKey.get(key);
    if (model === null || node === undefined || currentIndex().get(key) === null || !editable()) return false;
    ctx.cancelGesture();
    const change = nameOps(model, node.item, text, newIds());
    if (change === "foreign") {
      announce(t("draw.rename.foreign"));
      return false;
    }
    if (change.ops.length === 0 || ctx.commit("draw.action.describe", asGesture(change.ops)) === null) return false;
    renamedIn(key, change.keys[0] ?? key);
    announce(t("draw.access.described", { text }));
    return true;
  }
  ctx.writeDescription = writeDescription;

  /// Dichiara decorativa l'immagine `key`, in un passo: lo screen reader la
  /// salta. Vero se l'ha dichiarata.
  function writeDecorative(key: string): boolean {
    const model = ctx.engine.model;
    const node = outlineNow().byKey.get(key);
    if (model === null || node === undefined || currentIndex().get(key) === null || !editable()) return false;
    ctx.cancelGesture();
    const name = accessName(key);
    const change = decorativeOps(model, node.item, newIds());
    if (change.ops.length === 0 || ctx.commit("draw.action.decorative", asGesture(change.ops)) === null) return false;
    renamedIn(key, change.keys[0] ?? key);
    announce(t("draw.access.decorated", { name }));
    return true;
  }
  ctx.writeDecorative = writeDecorative;

  /// Dalla verifica: descrive l'immagine `key`, se le serve ancora.
  function describeImage(key: string, text: string): void {
    if (problemNow("S012", key) === null) return;
    if (writeDescription(ctx.settleCrop()(key), text)) syncAccess(true);
  }
  ctx.describeImage = describeImage;

  /// Dalla verifica: dichiara decorativa l'immagine `key`, se le serve
  /// ancora una descrizione.
  function decorateImage(key: string): void {
    if (problemNow("S012", key) === null) return;
    if (writeDecorative(ctx.settleCrop()(key))) syncAccess(true);
  }
  ctx.decorateImage = decorateImage;
}
