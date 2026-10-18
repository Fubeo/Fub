// L'editor del disegno: la selezione avanzata. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { resolvedLanguage } from "../../../../i18n/strings";
import { displayBinding } from "../../../../ui/commands";
import { promptForm, type FormField } from "../../../../ui/form-dialog";
import type { MenuItem } from "../../../../ui/menu";
import { keyOf } from "../../describe";
import { formatNumber } from "../../number";
import { BoundsBuilder, type Bounds, type Segment } from "../../scene/geometry";
import { IDENTITY } from "../../scene/matrix";
import type { ContainerNode, DocumentModel, ElementPart } from "../../scene/model";
import { SVG_NS } from "../../scene/read";
import type { LengthUnit } from "../../scene/rulers";
import { plural, t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import { gesture as asGesture } from "../edit";
import { nodeOf, type Arranged } from "../arrange";
import { CAPS, DASHES, JOINS, lookOf as outlineLook, outlineOps, outlinesOf, widthLinesOf, type OutlineChange } from "../outline";
import { boundsAfter, MAX_SCALE_PERCENT, MAX_SKEW, numericMatrix, numericOps } from "../transform";
import { CAP_LABELS, DASH_LABELS, JOIN_LABELS } from "../fields";
import { isInstance } from "../symbols";
import { attachable } from "../connectors";
import { applyOps } from "../apply";
import { pathOps } from "../topath";
import type { Join } from "../offset";
import { holdsShape, holdsStroke, inkPathOps, offsetOps, outlineStrokeOps, simplifyOps } from "../paths";
import { presetOf, PRESETS, type Preset } from "../profile";
import { holdsWidth, profileOps, widthsOf, type ProfileChange } from "../width";
import { holdsOpenPath, joinOps, type JoinRefused } from "../scissors";
import { kindOf, readNodes } from "../nodes";
import { unitSuffix } from "../guide-dialog";
import { fieldText, fromUnit, toUnit } from "../rulers";
import { screenBox, toScreen } from "../../view";
import type { ForeignBlock, Unit } from "../hit";
import { hideLayerOps, lockLayerOps } from "../layers";
import { flagged, flagOps, hasLikeness, inverseOf, nodesOf, similarTo, type Flag, type Likeness } from "../selecting";
import { copiedStyle } from "./clipboard-commands";
import { COPY_STYLE_BINDING, JOIN_NAMES, JOIN_PX, NODE_SHAPES, PASTE_STYLE_BINDING, SIMPLIFY_STEPS } from "./constants";
import type { EditorContext } from "./context";
import { innerNode, layerTitle } from "./helpers";

/// I tag SVG di altri programmi che da soli non si vedono: «Rendi
/// modificabile» non li conta fra le parti da rendere modificabili.
const UNSEEN_FOREIGN: ReadonlySet<string> = new Set(["metadata", "title", "desc"]);

/// La distanza dello scostamento la prima volta, in ogni unità: un passo
/// che si vede, a numeri tondi.
const OFFSET_START: Readonly<Record<LengthUnit, number>> = { px: 4, mm: 1, cm: 0.1, in: 0.05, pt: 3 };

const SIMPLIFY_LEAST = 1e-4;

const SIMPLIFY_MOST = 0.05;

/// I nodi che l'anteprima di «Semplifica» mostra, al più: oltre, il solo
/// contorno.
const PREVIEW_NODES = 2_000;

/// Vero se `node` è, o contiene, una parte di un altro programma che si
/// vede, o un foglio di stile: ciò che «Rendi modificabile» può riscrivere.
function holdsForeign(node: ElementPart): boolean {
  if (node.kind === "leaf") return node.details === null && node.facts.uri === SVG_NS && !UNSEEN_FOREIGN.has(node.facts.local);
  return node.parts.some((part) => typeof part !== "string" && part.kind !== "other" && holdsForeign(part));
}

/// Gli id che i `use` di altri programmi in `model` mostrano, come i cloni
/// di Inkscape: ciò che li porta diventa modificabile con loro.
function clonedIds(model: DocumentModel): Set<string> {
  const out = new Set<string>();
  const visit = (container: ContainerNode): void => {
    for (const part of container.parts) {
      if (typeof part === "string" || part.kind === "other") continue;
      if (part.kind === "container") visit(part);
      else if (part.details === null && part.facts.uri === SVG_NS && part.facts.local === "use") for (const id of part.facts.refs) out.add(id);
    }
  };
  visit(model.root);
  return out;
}

/// Gli id di `node` e di ciò che contiene.
function idsWithin(node: ElementPart): string[] {
  if (node.kind === "leaf") return [...node.ids];
  const out = node.facts.id === null ? [] : [node.facts.id];
  for (const part of node.parts) if (typeof part !== "string" && part.kind !== "other") out.push(...idsWithin(part));
  return out;
}

/// Le voci di «Seleziona simili», nell'ordine del menu.
const LIKENESSES: ReadonlyArray<{ readonly by: Likeness; readonly label: DrawKey }> = [
  { by: "fill", label: "draw.select.same_fill" },
  { by: "stroke", label: "draw.select.same_stroke" },
  { by: "width", label: "draw.select.same_width" },
  { by: "kind", label: "draw.select.same_kind" },
  { by: "tool", label: "draw.select.same_tool" },
  { by: "layer", label: "draw.select.same_layer" },
];

/// I nomi dei profili pronti, nel menu del contorno.
const PROFILE_LABELS: Readonly<Record<Preset, DrawKey>> = {
  uniform: "draw.profile.uniform",
  taper: "draw.profile.taper",
  drop: "draw.profile.drop",
  spindle: "draw.profile.spindle",
};

/// Ciò che la selezione avanzata dà agli altri pezzi dell'editor.
export interface SelectionCommandsContext {
  /// Quando il menu della selezione si è aperto dalla tastiera.
  keyedMenu: number;
  menuPoint: () => MouseEvent;
  flagSelection: (flag: Flag) => void;
  toggleRow: (key: string, flag: Flag) => void;
  selectionItems: (under?: ForeignBlock | null) => MenuItem[];
  outlineItems: () => MenuItem[];
  transformDialog: () => Promise<void>;
  applySelection: () => void;
  pathItems: () => MenuItem[];
  joinSelection: () => void;
  closePaths: () => void;
  showPaths: () => void;
  syncPaths: () => void;
  pathsHandles: () => readonly OverlayHandle[];
}

/// Monta la selezione avanzata.
export function installSelectionCommands(ctx: EditorContext): void {
  const {
    life, has, surface, pathsBar, pathsTitle, offsetInput, offsetField, joinSelect, joinField, limitInput, limitField, amountInput, amountField,
    pathsStatus, pathsApply, pathsCancel, editable, isolatedNode, currentIndex, newIds, announce, announceSelection, docUnit, lengthSpoken, fieldValue,
    selectedUnits, showHandles, outlineNow, describeNode, renameSelection, closeDescriptions, motifReason, motifFromSelection, commit, select,
    leaveIsolation, isolable, isolateSelection, makeEditable, cancelGesture, connectSelection, labelHost, cursorPoint, boundsOf, geometryOf, arranging,
    arrange, symbolFromSelection, detachSelection
  } = ctx;
  // --- La selezione avanzata -------------------------------------------------

  ctx.keyedMenu = -Infinity;

  /// Dove si apre dalla tastiera il menu della selezione: sotto la
  /// selezione, o al cursore del foglio, dentro il foglio.
  const menuPoint = (): MouseEvent => {
    const rect = surface.getBoundingClientRect();
    const bounds = boundsOf(selectedUnits());
    // Sotto la selezione come si vede, anche sul foglio girato.
    const box = bounds === null ? null : screenBox(ctx.camera, bounds);
    const [sx, sy] = box === null ? toScreen(ctx.camera, cursorPoint()) : [box.min[0], box.max[1]];
    const x = Math.min(Math.max(sx, 0), rect.width);
    const y = Math.min(Math.max(sy, 0), rect.height);
    return new MouseEvent("contextmenu", { clientX: rect.left + x, clientY: rect.top + y });
  };
  ctx.menuPoint = menuPoint;

  /// Sceglie tutto ciò che si sceglie: nel gruppo isolato, o in cima.
  const selectAll = (): void => {
    cancelGesture();
    select(currentIndex().units.map((unit) => unit.key));
    announceSelection();
  };

  /// Sceglie tutto il resto: di un gruppo con un oggetto scelto, gli altri.
  const invertSelection = (): void => {
    cancelGesture();
    select(inverseOf(currentIndex(), selectedUnits()).map((unit) => unit.key));
    announceSelection();
  };

  /// Sceglie gli oggetti simili a quelli scelti per `by`, a ogni profondità.
  const selectSimilar = (by: Likeness): void => {
    const model = ctx.engine.model;
    const similar = model === null ? null : similarTo(model, currentIndex(), selectedUnits(), by);
    if (similar === null) {
      announce(t(ctx.selection.length === 0 ? "draw.selection.empty" : by === "tool" ? "draw.select.same_tool.none" : "draw.select.same.missing"));
      return;
    }
    cancelGesture();
    select(similar.map((unit) => unit.key));
    announceSelection();
  };

  /// Blocca o nasconde gli oggetti scelti, in un passo: non si scelgono più,
  /// o non si vedono più, e la selezione si svuota.
  const flagSelection = (flag: Flag): void => {
    const units = arranging("selection");
    if (units === null) return;
    const model = ctx.engine.model!;
    const arranged = flagOps(model, nodesOf(model, units), flag, true, newIds());
    if (arrange(flag === "locked" ? "draw.action.lock" : "draw.action.hide", arranged) !== null) {
      const count = arranged.keys.length;
      announce(flag === "locked" ? plural(count, "draw.locked.one", "draw.locked.other") : plural(count, "draw.hidden.one", "draw.hidden.other"));
    }
  };
  ctx.flagSelection = flagSelection;

  /// «Sblocca tutto» e «Mostra tutto»: gli oggetti bloccati, o nascosti, che
  /// si vedono e si cambiano, nel gruppo isolato o in tutto il disegno; poi
  /// sono loro la selezione, quelli che si scelgono.
  const unflagAll = (flag: Flag): void => {
    if (!has("selection") || !editable()) return;
    ctx.settleCrop();
    const model = ctx.engine.model;
    if (model === null) return;
    const nodes = flagged(model, isolatedNode(), flag);
    if (nodes.length === 0) {
      announce(t(flag === "locked" ? "draw.unlocked.none" : "draw.shown.none"));
      return;
    }
    cancelGesture();
    if (arrange(flag === "locked" ? "draw.action.unlock" : "draw.action.show", flagOps(model, nodes, flag, false, newIds())) !== null) {
      announce(flag === "locked" ? plural(nodes.length, "draw.unlocked.one", "draw.unlocked.other") : plural(nodes.length, "draw.shown.one", "draw.shown.other"));
    }
  };

  /// Un segno dell'albero, o Ctrl+Maiusc+L e H sulla sua riga attiva: blocca
  /// o sblocca, nasconde o mostra il livello o l'oggetto di chiave `key`. La
  /// selezione resta, meno ciò che non si sceglie più.
  const toggleRow = (key: string, flag: Flag): void => {
    const model = ctx.engine.model;
    const outlined = outlineNow().byKey.get(key);
    if (model === null || outlined === undefined || !editable()) return;
    if (outlined.item.role === "layer") {
      const layer = currentIndex().layers.find((each) => keyOf(each) === key);
      if (layer === undefined || !has("layers")) return;
      const on = flag === "locked" ? !layer.locked : !layer.hidden;
      cancelGesture();
      const arranged = flag === "locked" ? lockLayerOps(model, layer, on, newIds()) : hideLayerOps(model, layer, on, newIds());
      const label: DrawKey = flag === "locked" ? (on ? "draw.action.layer_lock" : "draw.action.layer_unlock") : on ? "draw.action.layer_hide" : "draw.action.layer_show";
      const said: DrawKey = flag === "locked" ? (on ? "draw.layer.locked" : "draw.layer.unlocked") : on ? "draw.layer.hidden" : "draw.layer.shown";
      if (ctx.writeLayers(label, arranged, null)) announce(t(said, { name: layerTitle(layer) }));
      return;
    }
    if (!has("selection")) return;
    const node = nodeOf(model, outlined.item);
    const on = node.details?.[flag] !== true;
    // Il nome senza lo stato di prima: lo stato nuovo lo dice l'annuncio.
    const name = describeNode(outlined, currentIndex().get(key) ?? undefined, false);
    cancelGesture();
    const label: DrawKey = flag === "locked" ? (on ? "draw.action.lock" : "draw.action.unlock") : on ? "draw.action.hide" : "draw.action.show";
    const said: DrawKey = flag === "locked" ? (on ? "draw.object.locked" : "draw.object.unlocked") : on ? "draw.object.hidden" : "draw.object.shown";
    if (commit(label, asGesture(flagOps(model, [node], flag, on, newIds()).ops)) !== null) announce(t(said, { name }));
  };
  ctx.toggleRow = toggleRow;

  /// Le voci della selezione avanzata: gli appunti e lo stile, scegliere
  /// tutto e il resto, i simili, bloccare e nascondere, sbloccare e mostrare
  /// tutto, isolare. Una voce che adesso non serve è spenta e dice perché.
  const selectionItems = (under: ForeignBlock | null = null): MenuItem[] => {
    const model = ctx.engine.model;
    const index = currentIndex();
    const units = selectedUnits();
    const canEdit = editable();
    const none = units.length === 0;
    const empty = index.units.length === 0;
    const unselected = none ? { description: t("draw.selection.empty") } : {};
    const items: MenuItem[] = [
      { label: t("draw.cut"), hint: displayBinding("Mod-x"), disabled: !canEdit || none, ...(canEdit ? unselected : {}), run: () => ctx.clipboardCommand("cut") },
      { label: t("draw.copy"), hint: displayBinding("Mod-c"), disabled: none, ...unselected, run: () => ctx.clipboardCommand("copy") },
      { label: t("draw.paste"), hint: displayBinding("Mod-v"), disabled: !canEdit, run: () => void ctx.pasteFromMenu(false) },
      { label: t("draw.paste.in_place"), hint: displayBinding("Mod-Shift-v"), disabled: !canEdit, run: () => void ctx.pasteFromMenu(true) },
    ];
    if (has("style")) {
      const pastable = canEdit && !none && copiedStyle !== null;
      const why = copiedStyle === null ? t("draw.style.empty", { key: displayBinding(COPY_STYLE_BINDING) }) : t("draw.selection.empty");
      items.push(
        { label: t("draw.style.copy"), separator: true, hint: displayBinding(COPY_STYLE_BINDING), disabled: none, ...unselected, run: () => ctx.copyStyle() },
        { label: t("draw.style.paste"), hint: displayBinding(PASTE_STYLE_BINDING), disabled: !pastable, ...(canEdit && !pastable ? { description: why } : {}), run: () => ctx.pasteStyle() },
      );
    }
    items.push(
      { label: t("draw.select.all"), separator: true, hint: displayBinding("Mod-a"), disabled: empty, run: () => selectAll() },
      { label: t("draw.select.invert"), disabled: empty, run: () => invertSelection() },
    );
    const likenesses = LIKENESSES.filter(({ by }) => by !== "layer" || has("layers"));
    likenesses.forEach(({ by, label }, at) => {
      const usable = model !== null && !none && hasLikeness(model, index, units, by);
      const why: DrawKey = none ? "draw.selection.empty" : by === "tool" ? "draw.select.same_tool.none" : "draw.select.same.missing";
      items.push({ label: t(label), separator: at === 0, disabled: !usable, ...(usable ? {} : { description: t(why) }), run: () => selectSimilar(by) });
    });
    if (has("layers")) {
      // F2 sul foglio scrive un testo, o l'etichetta di una forma chiusa: per
      // loro il tasto non vale.
      const lone = units.length === 1;
      const text = lone && has("text") && (units[0]!.look !== null || labelHost(units[0]!));
      items.push({
        label: t("draw.rename"),
        separator: true,
        ...(lone && !text ? { hint: displayBinding("F2") } : {}),
        disabled: !canEdit || !lone,
        ...(canEdit && !lone ? { description: t("draw.rename.none") } : {}),
        run: () => renameSelection(),
      });
    }
    const unlockable = canEdit && model !== null && flagged(model, isolatedNode(), "locked").length > 0;
    const showable = canEdit && model !== null && flagged(model, isolatedNode(), "hidden").length > 0;
    items.push(
      {
        label: t("draw.lock"),
        separator: true,
        hint: displayBinding("Mod-Shift-l"),
        disabled: !canEdit || none,
        ...(canEdit && none ? { description: t("draw.selection.empty") } : {}),
        run: () => flagSelection("locked"),
      },
      {
        label: t("draw.hide"),
        hint: displayBinding("Mod-Shift-h"),
        disabled: !canEdit || none,
        ...(canEdit && none ? { description: t("draw.selection.empty") } : {}),
        run: () => flagSelection("hidden"),
      },
      { label: t("draw.unlock_all"), disabled: !unlockable, ...(canEdit && !unlockable ? { description: t("draw.unlocked.none") } : {}), run: () => unflagAll("locked") },
      { label: t("draw.show_all"), disabled: !showable, ...(canEdit && !showable ? { description: t("draw.shown.none") } : {}), run: () => unflagAll("hidden") },
    );
    if (has("connector")) {
      const few = units.filter((unit) => attachable(unit.node)).length < 2;
      items.push({ label: t("draw.connect"), separator: true, disabled: !canEdit || few, ...(canEdit && few ? { description: t("draw.connect.few") } : {}), run: () => connectSelection() });
    }
    if (has("motifs")) {
      const reason = motifReason();
      items.push({ label: t("draw.hatch.motif.make"), separator: true, disabled: reason !== null, ...(reason === null ? {} : { description: reason }), run: () => motifFromSelection() });
    }
    if (has("symbols")) {
      const instances = units.some(isInstance);
      items.push(
        { label: t("draw.symbol.make"), separator: true, disabled: !canEdit || none, ...(canEdit ? unselected : {}), run: () => symbolFromSelection() },
        { label: t("draw.symbol.detach"), disabled: !canEdit || !instances, ...(canEdit && !instances ? { description: t(none ? "draw.selection.empty" : "draw.symbol.detach.none") } : {}), run: () => detachSelection() },
      );
    }
    if (has("repeat")) {
      // Le voci del menu «Ripeti», spente se il disegno non si scrive.
      for (const [at, { description, ...item }] of ctx.repeatItems().entries()) {
        items.push({ ...item, separator: at === 0, ...(canEdit ? (description === undefined ? {} : { description }) : { disabled: true }) });
      }
    }
    if (has("editable") && model !== null) items.push(...editableItems(model, units, under));
    // Un'istanza scelta da sola apre il suo simbolo.
    const lone = units.length === 1 ? units[0]! : null;
    const single = lone !== null && isolable(lone);
    items.push({
      label: t(lone?.role === "instance" ? "draw.symbol.edit" : "draw.isolate"),
      separator: true,
      hint: displayBinding("Mod-Enter"),
      disabled: !single,
      ...(single ? {} : { description: t("draw.isolate.none") }),
      run: () => isolateSelection(),
    });
    const isolated = isolatedNode();
    if (isolated !== null) items.push({ label: t(isolated.details?.role === "symbol" ? "draw.isolate.exit.symbol" : "draw.isolate.exit"), hint: "Esc", run: () => leaveIsolation(false) });
    return items;
  };
  ctx.selectionItems = selectionItems;

  /// Le voci di «Rendi modificabile» nel menu della selezione: una per il
  /// blocco di un altro programma `under`, sotto il puntatore, o se non c'è
  /// per gli oggetti scelti `units` che ne contengono o che dei `use` di
  /// altri programmi mostrano; una per tutto il disegno. Spente, col perché,
  /// se lì non ce n'è.
  const editableItems = (model: DocumentModel, units: readonly Unit[], under: ForeignBlock | null): MenuItem[] => {
    const canEdit = editable();
    const cloned = under === null ? clonedIds(model) : new Set<string>();
    const paths = under !== null ? [under.path] : units.filter((unit) => holdsForeign(unit.node) || idsWithin(unit.node).some((id) => cloned.has(id))).map((unit) => unit.path);
    const some = holdsForeign(model.root);
    const why = units.length === 0 ? "draw.editable.item.empty" : "draw.editable.item.none";
    return [
      {
        label: t("draw.editable.item"),
        separator: true,
        disabled: !canEdit || paths.length === 0,
        ...(canEdit && paths.length === 0 ? { description: t(why) } : {}),
        run: () => void makeEditable({ kind: "units", paths }, false),
      },
      {
        label: t("draw.editable.item.all"),
        disabled: !canEdit || !some,
        ...(canEdit && !some ? { description: t("draw.editable.item.all.none") } : {}),
        run: () => void makeEditable({ kind: "all" }, true),
      },
    ];
  };

  /// Dà `change` ai contorni scelti, e dice quanti ne ha cambiati col nome
  /// della scelta.
  function outlineSelection(change: OutlineChange, style: string): void {
    const units = arranging("outline");
    if (units === null) return;
    const model = ctx.engine.model!;
    if (outlinesOf(model, units).length === 0 && ("dash" in change || widthLinesOf(model, units).length === 0)) {
      announce(t("draw.outline.none"));
      return;
    }
    const outlined = outlineOps(ctx.engine.model!, units, change, newIds());
    const label: DrawKey = "dash" in change ? "draw.action.dash" : "cap" in change ? "draw.action.cap" : "draw.action.join";
    if (arrange(label, outlined) !== null) announce(plural(outlined.changed, "draw.outlined.one", "draw.outlined.other", { style }));
  }

  /// Dà il profilo `change` ai contorni scelti, e dice quanti ne ha
  /// cambiati col nome della scelta, e quanti restano come sono.
  function profileSelection(change: ProfileChange, style: string): void {
    const units = arranging("width");
    if (units === null) return;
    const index = currentIndex();
    if (!holdsWidth(index, units)) {
      announce(t("draw.profile.none"));
      return;
    }
    const profiled = profileOps(ctx.engine.model!, index, units, change, newIds());
    const rest = [
      profiled.skipped === 0 ? "" : ` ${plural(profiled.skipped, "draw.profiled.skipped.one", "draw.profiled.skipped.other")}`,
      profiled.refused === 0 ? "" : ` ${plural(profiled.refused, "draw.profiled.refused.one", "draw.profiled.refused.other")}`,
    ].join("");
    if (profiled.ops.length === 0) {
      announce(`${t("flip" in change ? "draw.profile.flat" : "draw.unchanged")}${rest}`);
      return;
    }
    // Il punto scelto dello Spessore era di un altro profilo.
    ctx.widthPicked = null;
    if (arrange("draw.action.profile", profiled) !== null) announce(`${plural(profiled.changed, "draw.outlined.one", "draw.outlined.other", { style })}${rest}`);
  }

  /// Le voci del contorno: i tratteggi, gli estremi e gli angoli, ciascuno
  /// una scelta, segnata se i contorni scelti l'hanno tutti. Un tratteggio
  /// che non è del menu c'è, segnato e spento, col suo valore. Con lo
  /// Spessore, i profili: quelli pronti, segnati come gli altri, e i due
  /// che lo rovesciano.
  const outlineItems = (): MenuItem[] => {
    const model = ctx.engine.model;
    const units = selectedUnits();
    const outlines = model === null ? [] : outlinesOf(model, units);
    const lines = model === null ? [] : widthLinesOf(model, units);
    const look = outlineLook(outlines, lines);
    const none = outlines.length === 0;
    const choice = (label: string, checked: boolean, separator: boolean, change: OutlineChange, off: boolean): MenuItem => ({
      label,
      choice: "radio",
      checked,
      separator,
      disabled: off,
      run: () => outlineSelection(change, label),
    });
    const items: MenuItem[] = DASHES.map((dash) => choice(t(DASH_LABELS[dash]), look.dash === dash, false, { dash }, none));
    if (none) items[0]!.description = t("draw.outline.none");
    if (look.dash === "custom" && look.custom !== null) {
      items.push({ label: t("draw.outline.custom", { value: look.custom }), choice: "radio", checked: true, disabled: true, run: () => {} });
    }
    const ends = none && lines.length === 0;
    items.push(...CAPS.map((cap, at) => choice(t(CAP_LABELS[cap]), look.cap === cap, at === 0, { cap }, ends)));
    items.push(...JOINS.map((join, at) => choice(t(JOIN_LABELS[join]), look.join === join, at === 0, { join }, ends)));
    if (!has("width")) return items;
    const index = currentIndex();
    const shapes = widthsOf(index, units);
    const presets = shapes.map((shape) => presetOf(shape.profile));
    const preset = presets.length > 0 && presets.every((each) => each === presets[0]) ? presets[0]! : null;
    const off = shapes.length === 0;
    PRESETS.forEach((each, at) => {
      const label = t(PROFILE_LABELS[each]);
      items.push({
        label,
        choice: "radio",
        checked: preset === each,
        separator: at === 0,
        disabled: off,
        ...(off && at === 0 ? { description: t("draw.profile.none") } : {}),
        run: () => profileSelection({ preset: each }, label),
      });
    });
    // Rovesciare un profilo uniforme non cambia niente.
    const flat = shapes.every((shape) => presetOf(shape.profile) === "uniform");
    for (const [flip, key] of [["along", "draw.profile.flip"], ["across", "draw.profile.swap"]] as const) {
      const label = t(key);
      items.push({ label, separator: flip === "along", disabled: off || flat, run: () => profileSelection({ flip }, label) });
    }
    return items;
  };
  ctx.outlineItems = outlineItems;

  /// Ctrl+Maiusc+M, dal livello Esperto: ruota, scala e inclina gli oggetti
  /// scelti di quanto si scrive, attorno al centro del loro riquadro, in un
  /// passo solo. Il fuoco torna dov'era, come da ogni finestra.
  async function transformDialog(): Promise<void> {
    if (ctx.asking || arranging("transform") === null) return;
    const opened = ctx.loads;
    const scale = (id: string, label: DrawKey): FormField => ({
      id, label: t(label), value: "100", kind: "number", min: -MAX_SCALE_PERCENT, max: MAX_SCALE_PERCENT, nonZero: true,
    });
    const skew = (id: string, label: DrawKey): FormField => ({ id, label: t(label), value: "0", kind: "number", min: -MAX_SKEW, max: MAX_SKEW });
    ctx.asking = true;
    let answer: Readonly<Record<string, string>> | null;
    try {
      answer = await promptForm({
        title: t("draw.transform.title"),
        message: t("draw.transform.message"),
        okLabel: t("draw.transform.title"),
        fields: [
          { id: "rotate", label: t("draw.transform.rotate"), value: "0", kind: "number" },
          scale("scaleX", "draw.transform.scale_x"),
          scale("scaleY", "draw.transform.scale_y"),
          skew("skewX", "draw.transform.skew_x"),
          skew("skewY", "draw.transform.skew_y"),
        ],
      });
    } finally {
      ctx.asking = false;
    }
    if (answer === null || ctx.disposed || ctx.loads !== opened) return;
    // Mentre la finestra era aperta il disegno, o il livello, può essere
    // cambiato: valgono gli oggetti scelti adesso, attorno al loro centro.
    const units = arranging("transform");
    const from = units === null ? null : boundsOf(units);
    if (units === null || from === null) return;
    const value = (id: string, unchanged: number): number => {
      const number = Number(answer[id]);
      return Number.isFinite(number) ? number : unchanged;
    };
    const m = numericMatrix(
      {
        rotate: value("rotate", 0),
        scaleX: value("scaleX", 100) / 100,
        scaleY: value("scaleY", 100) / 100,
        skewX: value("skewX", 0),
        skewY: value("skewY", 0),
      },
      [(from.min[0] + from.max[0]) / 2, (from.min[1] + from.max[1]) / 2],
    );
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) {
      announce(t("draw.transform.unwritable"));
      return;
    }
    if (arrange("draw.action.transform", transformed, boundsAfter(units, m)) !== null) {
      announce(plural(transformed.changed, "draw.transformed.one", "draw.transformed.other"));
    }
  }
  ctx.transformDialog = transformDialog;

  /// Dal livello Esperto: porta la trasformazione degli oggetti scelti nella
  /// loro geometria, e dice quanti ne ha cambiati e quanti ne conservano una
  /// parte, che la loro forma non sa scrivere.
  function applySelection(): void {
    const units = arranging("apply");
    if (units === null) return;
    const applied = applyOps(ctx.engine.model!, units, newIds());
    const kept = applied.kept === 0 ? "" : ` ${plural(applied.kept, "draw.applied.kept.one", "draw.applied.kept.other")}`;
    if (applied.ops.length === 0) {
      announce(`${t("draw.unchanged")}${kept}`);
      return;
    }
    if (arrange("draw.action.apply_transform", applied) !== null) announce(`${plural(applied.changed, "draw.applied.one", "draw.applied.other")}${kept}`);
  }
  ctx.applySelection = applySelection;

  /// «Oggetto in tracciato», dal livello Esperto: gli oggetti scelti
  /// diventano `path`, che i nodi sanno modificare.
  function traceSelection(): void {
    const units = arranging("path");
    if (units === null) return;
    const traced = pathOps(ctx.engine.model!, units, newIds());
    const refused = traced.refused === 0 ? "" : ` ${plural(traced.refused, "draw.traced.refused.one", "draw.traced.refused.other")}`;
    if (traced.ops.length === 0) {
      announce(`${t("draw.unchanged")}${refused}`);
      return;
    }
    if (arrange("draw.action.to_path", traced) !== null) announce(`${plural(traced.changed, "draw.traced.one", "draw.traced.other")}${refused}`);
  }

  /// Le voci del menu Tracciato: spente, e dicono perché, quando fra gli
  /// oggetti scelti non c'è niente su cui lavorano.
  const pathItems = (): MenuItem[] => {
    const units = selectedUnits();
    const index = currentIndex();
    const shapes = holdsShape(index, units);
    const when = (usable: boolean, reason: DrawKey): Pick<MenuItem, "disabled" | "description"> =>
      usable ? { disabled: false } : { disabled: true, description: t(units.length === 0 ? "draw.selected.none" : reason) };
    return [
      { label: t("draw.to_path"), ...when(units.length > 0, "draw.selected.none"), run: () => traceSelection() },
      { label: t("draw.outline_stroke"), ...when(holdsStroke(index, units), "draw.outline_stroke.none"), run: () => strokeToPath() },
      { label: t("draw.ink_path"), ...when(units.some(ctx.holdsPenStroke), "draw.ink_path.none"), run: () => inkPathSelection() },
      { label: t("draw.offset"), separator: true, ...when(shapes, "draw.paths.no_shape"), run: () => openPaths("offset") },
      { label: t("draw.simplify"), ...when(shapes, "draw.paths.no_shape"), run: () => openPaths("simplify") },
      { label: t("draw.join"), separator: true, hint: displayBinding("Mod-j"), ...when(holdsOpenPath(ctx.engine.model!, units), "draw.join.none"), run: () => joinSelection() },
    ];
  };
  ctx.pathItems = pathItems;

  /// «Unisci» (Ctrl+J), dal livello Esperto: i capi più vicini dei tracciati
  /// aperti scelti si uniscono, nel più in basso, finché sono uno solo; un
  /// tracciato solo si chiude. Due capi che sullo schermo si toccano
  /// diventano un nodo solo; altrimenti li unisce una linea.
  function joinSelection(): void {
    const units = arranging("path");
    if (units === null) return;
    const done = joinOps(ctx.engine.model!, units, JOIN_PX / ctx.camera.scale, newIds());
    if ("reason" in done) {
      announce(joinRefusal(done));
      return;
    }
    if (arrange("draw.action.join_paths", done) === null) return;
    const { closed, lines } = done.joined;
    const what = units.length === 1 && closed ? "draw.join.closed" : closed ? "draw.join.joined_closed" : "draw.join.joined";
    announce(`${t(what)}${lines === 0 ? "" : ` ${plural(lines, "draw.join.lines.one", "draw.join.lines.other")}`}`);
  }
  ctx.joinSelection = joinSelection;

  /// Perché «Unisci» non si fa, a parole.
  const joinRefusal = (refused: JoinRefused): string => {
    switch (refused.reason) {
      case "none":
        return t("draw.selected.none");
      case "not_paths":
        return plural(refused.count, "draw.join.not_paths.one", "draw.join.not_paths.other");
      case "closed":
        return t("draw.join.closed_path");
      case "line":
        return t("draw.join.line");
      case "foreign":
        return t("draw.nodes.unwritable");
      case "failed":
        return t("draw.join.failed");
    }
  };

  /// «Contorno in tracciato», dal livello Esperto: il contorno di ogni forma
  /// scelta diventa una forma piena del suo colore, coi trattini, gli
  /// estremi e gli angoli. Una forma che ha anche un riempimento diventa un
  /// gruppo col suo id: il riempimento sotto, il contorno sopra.
  function strokeToPath(): void {
    const units = arranging("path");
    if (units === null) return;
    const done = outlineStrokeOps(ctx.engine.model!, currentIndex(), units, newIds());
    const notes = [
      done.refused === 0 ? "" : ` ${plural(done.refused, "draw.stroked.refused.one", "draw.stroked.refused.other")}`,
      done.skipped === 0 ? "" : ` ${plural(done.skipped, "draw.stroked.skipped.one", "draw.stroked.skipped.other")}`,
    ].join("");
    if (done.ops.length === 0) {
      announce(`${t("draw.unchanged")}${notes}`);
      return;
    }
    if (arrange("draw.action.outline_stroke", done) !== null) announce(`${plural(done.changed, "draw.stroked.one", "draw.stroked.other")}${notes}`);
  }

  /// «Inchiostro in tracciato», dal livello Esperto: ogni tratto a penna
  /// scelto diventa la sua spina, un tracciato coi nodi che lo strumento
  /// Nodi mostra, col colore dell'inchiostro e lo spessore del pennello.
  function inkPathSelection(): void {
    const units = arranging("path");
    if (units === null) return;
    const done = inkPathOps(ctx.engine.model!, currentIndex(), units, newIds());
    const refused = done.refused === 0 ? "" : ` ${plural(done.refused, "draw.inked.refused.one", "draw.inked.refused.other")}`;
    if (done.ops.length === 0) {
      announce(`${t("draw.unchanged")}${refused}`);
      return;
    }
    if (arrange("draw.action.ink_path", done) !== null) announce(`${plural(done.changed, "draw.inked.one", "draw.inked.other")}${refused}`);
  }

  /// Apre la barra di `mode` sugli oggetti scelti, coi valori dell'ultima
  /// volta, e porta il fuoco al suo campo.
  function openPaths(mode: "offset" | "simplify"): void {
    if (arranging("path") === null) return;
    closeDescriptions();
    ctx.closeTracing();
    ctx.pathsMode = mode;
    ctx.pathsShown = null;
    const unit = docUnit();
    ctx.offsetUnit = unit;
    offsetInput.value = fieldText(ctx.offsetLast ?? fromUnit(OFFSET_START[unit], unit), unit);
    joinSelect.value = ctx.joinLast;
    limitInput.value = formatNumber(ctx.limitLast, 2);
    amountInput.value = String(ctx.amountLast);
    showPaths();
    showHandles();
    if (mode === "offset") {
      offsetInput.focus({ preventScroll: true });
      offsetInput.select();
    } else {
      amountInput.focus({ preventScroll: true });
    }
  }

  /// Chiude la barra e toglie l'anteprima; il fuoco, se era nella barra,
  /// torna al foglio.
  function closePaths(): void {
    if (ctx.pathsMode === null) return;
    const focused = pathsBar.contains(document.activeElement);
    ctx.pathsMode = null;
    ctx.pathsShown = null;
    pathsBar.hidden = true;
    showHandles();
    if (focused) surface.focus({ preventScroll: true });
  }
  ctx.closePaths = closePaths;

  /// La barra com'è adesso: il titolo, i campi del suo comando, e il limite
  /// solo con gli angoli vivi. Se il documento ha cambiato unità, la
  /// distanza scritta passa alla nuova.
  function showPaths(): void {
    const unit = docUnit();
    if (unit !== ctx.offsetUnit) {
      const value = Number(offsetInput.value);
      if (offsetInput.value !== "" && Number.isFinite(value)) offsetInput.value = fieldText(fromUnit(value, ctx.offsetUnit), unit);
      ctx.offsetUnit = unit;
    }
    offsetField.name.textContent = unitSuffix(t("draw.offset.distance"), unit);
    pathsBar.hidden = ctx.pathsMode === null;
    if (ctx.pathsMode === null) return;
    const offset = ctx.pathsMode === "offset";
    pathsTitle.textContent = t(offset ? "draw.offset.title" : "draw.simplify.title");
    offsetField.field.hidden = !offset;
    joinField.field.hidden = !offset;
    limitField.field.hidden = !offset || joinNow() !== "miter";
    amountField.field.hidden = offset;
  }
  ctx.showPaths = showPaths;

  /// Dopo ogni cambio: la barra si chiude se il livello o il documento non
  /// la vogliono più.
  function syncPaths(): void {
    if (ctx.pathsMode === null) return;
    if (!has("path") || !editable()) closePaths();
    else showPaths();
  }
  ctx.syncPaths = syncPaths;

  /// La distanza scritta, in unità della scena; 0 se non si legge.
  function offsetNow(): number {
    return fieldValue(offsetInput.value);
  }

  function joinNow(): Join {
    const value = joinSelect.value as Join;
    return JOIN_NAMES.has(value) ? value : "miter";
  }

  /// Il limite degli angoli vivi scritto: quello di SVG se non si legge.
  function limitNow(): number {
    const value = Number(limitInput.value);
    return limitInput.value !== "" && Number.isFinite(value) && value >= 1 ? value : 4;
  }

  /// Lo scarto di «Semplifica» per `units`, in unità della scena: la parte
  /// della diagonale delle loro forme che il cursore dice. `null` senza
  /// geometria.
  function toleranceFor(units: readonly Unit[]): number | null {
    const bounds = geometryOf(units);
    if (bounds === null) return null;
    const diagonal = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
    const step = Math.min(SIMPLIFY_STEPS, Math.max(0, Number(amountInput.value) || 0));
    const tolerance = diagonal * SIMPLIFY_LEAST * (SIMPLIFY_MOST / SIMPLIFY_LEAST) ** (step / SIMPLIFY_STEPS);
    return tolerance > 0 && Number.isFinite(tolerance) ? tolerance : null;
  }

  /// Uno scarto, piccolo, nell'unità del documento: due cifre significative,
  /// in pixel il numero solo.
  function deviationText(value: number): string {
    const unit = docUnit();
    const number = new Intl.NumberFormat(resolvedLanguage(), { maximumSignificantDigits: 2 }).format(toUnit(value, unit));
    return unit === "px" ? number : `${number} ${unit}`;
  }

  /// Ciò che la barra farebbe agli oggetti `units`: le operazioni, le forme
  /// di dopo nella scena, la frase che lo dice nella barra e quella da dire
  /// dopo averlo fatto. Una frase sola se non c'è niente da fare.
  function pathsPlan(units: readonly Unit[]): {
    readonly arranged: Arranged;
    readonly label: DrawKey;
    readonly preview: readonly (readonly Segment[])[];
    readonly nodes: boolean;
    readonly extent: Bounds | null;
    readonly status: string;
    readonly done: string;
  } | string {
    const model = ctx.engine.model;
    const index = currentIndex();
    if (model === null || units.length === 0) return t("draw.paths.none");
    if (!holdsShape(index, units)) return t("draw.paths.no_shape");
    const note = (count: number, one: DrawKey, other: DrawKey): string[] => (count === 0 ? [] : [plural(count, one, other)]);
    if (ctx.pathsMode === "offset") {
      const distance = offsetNow();
      if (distance === 0) return t("draw.offset.zero");
      const done = offsetOps(model, index, units, distance, { join: joinNow(), miterLimit: limitNow() }, newIds());
      const notes = [
        ...note(done.vanished, "draw.offset.vanished.one", "draw.offset.vanished.other"),
        ...note(done.refused, "draw.paths.refused.one", "draw.paths.refused.other"),
        ...note(done.skipped, "draw.paths.skipped.one", "draw.paths.skipped.other"),
      ];
      const extent = new BoundsBuilder();
      for (const segments of done.preview) extent.path(segments, IDENTITY);
      return {
        arranged: done,
        label: "draw.action.offset",
        preview: done.preview,
        nodes: false,
        extent: extent.finish(),
        status: [...(done.changed === 0 ? [] : [plural(done.changed, "draw.offset.new.one", "draw.offset.new.other")]), ...notes].join(" ") || t("draw.unchanged"),
        done: [plural(done.changed, "draw.offset.done.one", "draw.offset.done.other", { distance: lengthSpoken(distance) }), ...notes].join(" "),
      };
    }
    const tolerance = toleranceFor(units);
    if (tolerance === null) return t("draw.paths.no_shape");
    const done = simplifyOps(model, index, units, tolerance, newIds());
    const length = deviationText(tolerance);
    const notes = [
      ...note(done.refused, "draw.paths.refused.one", "draw.paths.refused.other"),
      ...(units.some(ctx.holdsPenStroke) ? [t("draw.simplify.ink")] : []),
    ];
    const counts = done.after < done.before
      ? t("draw.simplify.nodes", { before: done.before, after: done.after, length })
      : plural(done.before, "draw.simplify.same.one", "draw.simplify.same.other", { length });
    return {
      arranged: done,
      label: "draw.action.simplify",
      preview: done.preview,
      nodes: done.after <= PREVIEW_NODES,
      extent: null,
      status: [counts, ...notes].join(" "),
      done: [plural(done.changed, "draw.simplified.one", "draw.simplified.other", { before: done.before, after: done.after }), ...notes].join(" "),
    };
  }

  /// L'anteprima per la selezione e l'indice di adesso: si rifà solo se
  /// sono cambiati, o se le regole della barra l'hanno tolta. Scrive anche
  /// nella barra che cosa succederà.
  function pathsNow(): NonNullable<typeof ctx.pathsShown> {
    const index = currentIndex();
    if (ctx.pathsShown !== null && ctx.pathsShown.selection === ctx.selection && ctx.pathsShown.index === index) return ctx.pathsShown;
    const units = editable() ? selectedUnits() : [];
    const plan = pathsPlan(units);
    const handles: OverlayHandle[] = [];
    if (typeof plan !== "string") {
      for (const segments of plan.preview) handles.push({ kind: "outline", segments, matrix: IDENTITY });
      if (plan.nodes) {
        for (const segments of plan.preview) {
          for (const sub of readNodes(segments)) {
            sub.nodes.forEach(([x, y], at) => {
              handles.push({ kind: "node", x, y, shape: NODE_SHAPES[innerNode(sub, at) ? kindOf(sub, at) : "corner"], selected: false, hint: true });
            });
          }
        }
      }
    }
    pathsStatus.textContent = typeof plan === "string" ? plan : plan.status;
    if (ctx.pathsMode === "simplify") {
      const tolerance = toleranceFor(units);
      if (tolerance === null) amountInput.removeAttribute("aria-valuetext");
      else amountInput.setAttribute("aria-valuetext", t("draw.simplify.tolerance", { length: deviationText(tolerance) }));
    }
    ctx.pathsShown = { selection: ctx.selection, index, handles };
    return ctx.pathsShown;
  }

  /// L'anteprima della barra aperta: le forme di dopo, e con «Semplifica»
  /// i loro nodi.
  function pathsHandles(): readonly OverlayHandle[] {
    return ctx.pathsMode === null ? [] : pathsNow().handles;
  }
  ctx.pathsHandles = pathsHandles;

  /// «Applica» e Invio: lo scostamento o la semplificazione si scrive, in un
  /// passo di annulla, e la barra si chiude. Senza niente da fare resta
  /// aperta, e dice perché.
  function applyPaths(): void {
    if (ctx.pathsMode === null) return;
    const units = arranging("path");
    if (units === null) return;
    const plan = pathsPlan(units);
    if (typeof plan === "string" || plan.arranged.ops.length === 0) {
      announce(typeof plan === "string" ? plan : plan.status);
      return;
    }
    if (ctx.pathsMode === "offset") {
      ctx.offsetLast = offsetNow();
      ctx.joinLast = joinNow();
      ctx.limitLast = limitNow();
    } else {
      ctx.amountLast = Number(amountInput.value);
    }
    closePaths();
    surface.focus({ preventScroll: true });
    if (arrange(plan.label, plan.arranged, plan.extent) !== null) announce(plan.done);
  }

  for (const control of [offsetInput, joinSelect, limitInput, amountInput]) {
    life.listen(control, "input", () => {
      ctx.pathsShown = null;
      showPaths();
      showHandles();
    });
  }
  life.listen(pathsApply, "click", () => applyPaths());
  life.listen(pathsCancel, "click", () => closePaths());
  // Invio in un campo applica; Esc chiude la barra senza cambiare niente.
  life.listen(pathsBar, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePaths();
      surface.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Enter" || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    applyPaths();
  });
}
