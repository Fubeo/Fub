// L'editor del disegno: il pannello delle proprietà, gli attributi e la
// descrizione delle immagini. Un pezzo di createDrawEditor (`../editor.ts`):
// lavora sul contesto che i pezzi condividono.

import type { VaultFamily } from "../../fonts/vault";
import type { Bounds } from "../../scene/geometry";
import { apply, IDENTITY, translate, type Matrix } from "../../scene/matrix";
import type { ContainerNode, DocumentModel } from "../../scene/model";
import type { Applied } from "../../scene/engine";
import type { Op } from "../../scene/ops";
import type { LengthUnit } from "../../scene/rulers";
import { plural, t, type DrawKey } from "../../strings";
import { gesture as asGesture, moveOps, roundDelta } from "../edit";
import { nodeOf, orderOps, type Order } from "../arrange";
import { subjectOf, type Subject } from "../attributes";
import { orderChanges } from "../order-changes";
import { lookOf as outlineLook, outlineOps, outlinesOf, widthLinesOf } from "../outline";
import { boundsAfter, numericOps } from "../transform";
import {
  lookAction,
  lookChange,
  lookUnit,
  outlineChange,
  propertiesView,
  tipChange,
  vaultFamilyOptions,
  type RepeatFacts,
  type SelectionFacts,
  type StyleFacts,
  type SymbolFacts,
} from "../fields";
import { lookOf as selectionLook, lookOps } from "../look";
import { gradientView, paintedParts, type GradientView, type PaintChannel } from "../gradients";
import type { GradientPanelView } from "../gradient-panel";
import type { HatchPanelView } from "../hatch-panel";
import { resourcesOf } from "../resources";
import { repeatPlace, repeatTarget, repeatView } from "../repeat-ops";
import { cyclingSymbols, documentSymbols, instanceCounts, isInstance } from "../symbols";
import { deleteStyleProblem, documentStyles, freshStyleName, styleRow, styleSample, styleUpdatable, type StyleKind } from "../styles";
import type { FieldId, PropertiesView } from "../properties";
import { documentColors, documentSwatches, paperColor, type DocumentColors } from "../swatches";
import { tipOps, tipsLookOf, type TipChange } from "../tips";
import { connectorView } from "../connector-ops";
import type { ConnectorPanelView } from "../connector-panel";
import { effectsView } from "../effects-panel";
import { angleOf, frameCenter, frameSize, movedFrame, normalized, resizeMatrix, rotationMatrix, scales, type Axis as FrameAxis, type Frame } from "../frame";
import { documentPatterns, filledParts, hatchView } from "../patterns";
import { fromUnit } from "../rulers";
import type { Unit } from "../hit";
import { overlaps } from "../audit";
import { cleanName, decorative } from "../naming";
import { shapeFacts, toolFacts } from "../reshape";
import type { Font } from "../measure";
import { BAR_FEATURES, ORDERS, RATIO_ROLES } from "./constants";
import type { EditorContext } from "./context";
import { translated, union } from "./helpers";
import type { PanelReading } from "./types";

/// La larghezza dell'editor, in rem, da cui il pannello delle proprietà sta
/// accanto al foglio e si apre da sé: sotto, i pannelli vanno sotto il
/// foglio (`structure.css`).
const PANEL_ROOM_REM = 36;

/// I colori di un disegno che non se ne contano: per la sezione chiusa,
/// che non li mostra.
const NO_COLORS: DocumentColors = { swatches: [], used: [], hidden: 0 };

const NO_FAMILIES: readonly string[] = [];

/// Il nome del passo d'annulla di un cambio delle punte.
function tipAction(change: TipChange): DrawKey {
  if ("swap" in change) return "draw.action.tips_swap";
  if ("size" in change) return "draw.action.tip_size";
  return change.end === "start" ? "draw.action.tip_start" : "draw.action.tip_end";
}

/// Ciò che il pannello delle proprietà, gli attributi e la descrizione delle immagini dà agli altri pezzi dell'editor.
export interface PanelContext {
  askDescriptions: (keys: readonly string[]) => void;
  closeDescriptions: () => void;
  showDescription: () => void;
  syncDescriptions: () => void;
  moveInReading: (key: string, later: boolean, confirmed: boolean) => string | null;
  showObjects: (open: boolean, focus?: boolean) => void;
  syncInspector: () => void;
  settledSubject: (subject: Subject) => Subject;
  showAttributes: (open: boolean, focus?: boolean) => void;
  changeObject: (label: DrawKey, ops: readonly Op[], id: string) => string | null;
  nestedNow: () => boolean;
  syncDock: () => void;
  nestInspector: (nested: boolean) => void;
  showPanel: (open: boolean, focus?: boolean, remember?: boolean) => void;
  /// Vero finché il pannello aspetta che l'editor abbia una misura per
  /// sapere se aprirsi.
  panelPending: boolean;
  showPanelByDefault: () => void;
  originalUnits: (container: ContainerNode) => readonly Unit[];
  syncProperties: () => void;
  colorsNow: () => DocumentColors;
  focusAttributes: () => void;
  focusTransform: () => boolean;
  changeFromPanel: (label: DrawKey, ops: readonly Op[], keys: readonly string[] | null, extent?: Bounds | null) => string | null;
  withFaces: <R>(write: (late: () => boolean) => R, then?: (result: R) => void) => R;
  panelLater: (outcome: string | null) => void;
  moveFromPanel: (axis: FrameAxis, value: number) => string | null;
  resizeFromPanel: (axis: FrameAxis, value: number) => string | null;
  rotateFromPanel: (value: number) => string | null;
  styleFromPanel: (id: FieldId, value: number | string | boolean) => string | null;
}

/// Monta il pannello delle proprietà, gli attributi e la descrizione delle immagini.
export function installPanel(ctx: EditorContext): void {
  const {
    life, has, drawingFonts, measureText, style, root, surface, propertiesButton, tree, historyPanel, accessPanel, boardsPanel, libraryPanel, symbolsPanel,
    inspector, panel, objectsButton, attributesButton, describeBar, describeLabel, describeInput, describeWrite, describeDecorative, describeSkip, dock,
    indexer, boardsNow, chosenSheet, editable, isolatedThrough, currentIndex, grownPage, newIds, announce, rereadSize, docUnit, selectedUnits, frameOf,
    showHandles, outlineNow, labelOf, syncTree, accessName, writeDescription, writeDecorative
  } = ctx;
  // --- La descrizione delle immagini appena entrate -------------------------------

  /// Le immagini appena entrate a cui la barra chiede una descrizione, e
  /// quella di adesso.
  let asked: { readonly keys: readonly string[]; at: number } | null = null;

  /// Vero se l'immagine `key` c'è, si sceglie e non ha né una descrizione né
  /// la dichiarazione di essere decorativa.
  const undescribed = (key: string): boolean => {
    const model = ctx.engine.model;
    const node = outlineNow().byKey.get(key);
    if (model === null || node === undefined || node.item.role !== "image" || currentIndex().get(key) === null) return false;
    return (node.item.title ?? "").trim() === "" && !decorative(model, node.item);
  };

  /// Chiede la descrizione delle immagini `keys`, appena entrate, se
  /// l'interfaccia ha la verifica dell'accessibilità; il fuoco va al campo.
  function askDescriptions(keys: readonly string[]): void {
    if (!has("accessibility") || !editable() || keys.length === 0) return;
    asked = { keys, at: -1 };
    nextDescription(true);
  }
  ctx.askDescriptions = askDescriptions;

  /// Passa alla prossima immagine che ha ancora bisogno di una descrizione,
  /// e la sceglie se sono più d'una; senza, chiude la barra.
  function nextDescription(focus: boolean): void {
    if (asked === null) return;
    let at = asked.at + 1;
    while (at < asked.keys.length && !undescribed(asked.keys[at]!)) at++;
    if (at >= asked.keys.length) {
      closeDescriptions();
      return;
    }
    asked.at = at;
    describeInput.value = "";
    showDescription();
    if (asked.keys.length > 1) ctx.select([asked.keys[at]!]);
    if (focus) describeInput.focus({ preventScroll: true });
  }

  /// Chiude la barra. Se si descrivevano più immagini e la scelta è ancora
  /// quella della barra, tornano scelte tutte quelle che restano.
  function closeDescriptions(): void {
    const was = asked;
    if (was === null) return;
    asked = null;
    const focused = describeBar.contains(document.activeElement);
    describeBar.hidden = true;
    const current = was.keys[was.at];
    if (was.keys.length > 1 && current !== undefined && ctx.selection.length === 1 && ctx.selection[0] === current) {
      ctx.select(was.keys.filter((key) => currentIndex().get(key) !== null));
    }
    if (focused) surface.focus({ preventScroll: true });
  }
  ctx.closeDescriptions = closeDescriptions;

  /// La barra, com'è adesso: il suo nome dice quale immagine, se sono più
  /// d'una.
  function showDescription(): void {
    if (asked === null) return;
    describeBar.hidden = false;
    describeLabel.textContent =
      asked.keys.length === 1 ? t("draw.describe") : t("draw.describe.of", { n: asked.at + 1, count: asked.keys.length });
  }
  ctx.showDescription = showDescription;

  /// Dopo ogni cambio: la barra va avanti se l'immagine di adesso non le
  /// chiede più niente (descritta altrove, tolta, annullata), e si chiude
  /// se l'interfaccia o il documento non la vogliono più.
  function syncDescriptions(): void {
    if (asked === null) return;
    if (!has("accessibility") || !editable()) {
      closeDescriptions();
      return;
    }
    const current = asked.keys[asked.at];
    if (current === undefined || !undescribed(current)) nextDescription(describeBar.contains(document.activeElement));
  }
  ctx.syncDescriptions = syncDescriptions;

  /// «Scrivi» e Invio: la descrizione del campo, e poi la prossima.
  function writeAsked(): void {
    const key = asked?.keys[asked.at];
    if (key === undefined) return;
    const text = cleanName(describeInput.value);
    if (text === "") {
      announce(t("draw.describe.empty"));
      describeInput.focus({ preventScroll: true });
      return;
    }
    if (!writeDescription(key, text)) {
      describeInput.focus({ preventScroll: true });
      return;
    }
    // Di solito il cambio stesso ha già portato la barra avanti.
    if (asked?.keys[asked.at] === key) nextDescription(true);
  }

  life.listen(describeWrite, "click", () => writeAsked());
  life.listen(describeDecorative, "click", () => {
    const key = asked?.keys[asked.at];
    if (key === undefined) return;
    if (!writeDecorative(key)) describeInput.focus({ preventScroll: true });
    else if (asked?.keys[asked.at] === key) nextDescription(true);
  });
  life.listen(describeSkip, "click", () => nextDescription(true));
  life.listen(describeInput, "keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    writeAsked();
  });
  // Esc chiude la barra: le immagini che restano senza descrizione le
  // elenca la verifica.
  life.listen(describeBar, "keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeDescriptions();
    surface.focus({ preventScroll: true });
  });

  /// Sposta l'oggetto `key` di un posto nell'ordine di lettura, dopo il
  /// vicino seguente se `later`: è anche l'ordine in cui si dipinge, e
  /// l'oggetto passa sopra o sotto il vicino. Se i due si sovrappongono e lo
  /// spostamento non è `confirmed`, non si fa: torna l'avviso.
  function moveInReading(key: string, later: boolean, confirmed: boolean): string | null {
    const model = ctx.engine.model;
    if (model === null || !editable()) return null;
    const index = currentIndex();
    const unit = index.get(key);
    if (unit === null) {
      announce(t("draw.access.unreachable", { name: accessName(key) }));
      return null;
    }
    const siblings = index.siblings(unit);
    const neighbor = siblings[siblings.findIndex((each) => each.key === key) + (later ? 1 : -1)];
    if (neighbor === undefined) {
      announce(t(later ? "draw.access.move.last" : "draw.access.move.first"));
      return null;
    }
    const names = { name: accessName(key), other: accessName(neighbor.key) };
    if (!confirmed && overlaps(unit.bounds, neighbor.bounds)) return t(later ? "draw.access.move.above" : "draw.access.move.below", names);
    ctx.cancelGesture();
    const kept = ctx.arrange("draw.action.reading", orderOps(model, index, [unit], later ? "forward" : "backward", newIds()), null, { key: "draw.order.styled" });
    if (kept === null) return null;
    announce(`${t(later ? "draw.access.moved.later" : "draw.access.moved.earlier", names)}${kept}`);
    return null;
  }
  ctx.moveInReading = moveInReading;

  /// Apre o chiude l'albero; aperto, il fuoco ci va.
  function showObjects(open: boolean, focus = true): void {
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    if (ctx.routed("layers", open)) {
      // La scheda si è appena mostrata: l'albero si porta al disegno prima
      // che l'osservatore lo veda.
      if (open && !tree.element.hidden) syncTree(true);
      if (open && focus && !tree.element.hidden) tree.focus();
      return;
    }
    if (!open && tree.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    tree.element.hidden = !open;
    objectsButton.setAttribute("aria-expanded", String(open));
    syncDock();
    if (open) {
      ctx.treeShown = null;
      syncTree();
      if (focus) tree.focus();
    }
  }
  ctx.showObjects = showObjects;

  // --- Gli attributi -----------------------------------------------------------

  /// Ciò che il pannello mostra; la chiave con cui conosce l'oggetto, che
  /// resta la stessa quando l'oggetto riceve un id o lo cambia dal pannello.
  let inspectorShown: {
    readonly subject: Subject | null;
    readonly unit: string | null;
    readonly key: string | null;
    readonly label: string;
    readonly count: number;
    readonly editable: boolean;
    readonly families: readonly string[];
  } | null = null;
  /// L'oggetto che il pannello ha appena cambiato, con la chiave di prima.
  let carried: { readonly unit: string; readonly key: string | null } | null = null;
  /// Vero mentre il pannello cambia l'oggetto: la selezione lo segue dopo.
  let changing = false;

  /// Porta il pannello degli attributi, se è aperto, all'oggetto scelto.
  function syncInspector(): void {
    if (inspector.element.hidden || changing || (nestedNow() && panel.element.hidden)) return;
    const units = selectedUnits();
    const unit = units.length === 1 ? units[0]! : null;
    const model = ctx.engine.model;
    const subject = unit === null || model === null ? null : subjectOf(nodeOf(model, unit));
    if (carried !== null && carried.unit !== unit?.key) carried = null;
    const key = unit === null ? null : carried !== null ? carried.key : unit.key;
    const label = unit === null ? "" : labelOf(unit);
    const canEdit = editable();
    const families = has("fonts") ? vaultFamilyValues() : NO_FAMILIES;
    const last = inspectorShown;
    if (last !== null && last.subject === subject && last.unit === (unit?.key ?? null) && last.key === key && last.label === label && last.count === units.length && last.editable === canEdit && last.families === families) return;
    inspectorShown = { subject, unit: unit?.key ?? null, key, label, count: units.length, editable: canEdit, families };
    inspector.update({ subject, key, label, count: units.length, editable: canEdit, families });
  }
  ctx.syncInspector = syncInspector;

  /// Le famiglie del vault come le scrive il menu «Carattere», per gli
  /// attributi: lo stesso elenco finché il catalogo non si rilegge.
  let familyValues: { readonly from: readonly VaultFamily[]; readonly values: readonly string[] } | null = null;
  function vaultFamilyValues(): readonly string[] {
    const from = drawingFonts.families();
    if (familyValues?.from !== from) familyValues = { from, values: vaultFamilyOptions(from).map((option) => option.value) };
    return familyValues.values;
  }

  // Una famiglia del vault che arriva, manca o cambia nel catalogo cambia il
  // menu «Carattere», la sua riga e il menu degli attributi.
  life.add(
    drawingFonts.watch(() => {
      ctx.panelShown = null;
      syncProperties();
      syncInspector();
    }),
  );

  /// L'oggetto di cui il pannello cambia un attributo, com'è dopo che un
  /// ritaglio aperto si è scritto: il suo percorso può essere cambiato.
  /// L'oggetto del pannello è quello scelto, e col ritaglio aperto è
  /// l'immagine.
  function settledSubject(subject: Subject): Subject {
    if (ctx.cropping === null) return subject;
    ctx.settleCrop();
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length !== 1) return subject;
    return subjectOf(nodeOf(model, units[0]!)) ?? subject;
  }
  ctx.settledSubject = settledSubject;

  /// Apre o chiude gli attributi; aperti, il fuoco ci va. Chiusi, un valore
  /// scritto a metà parte prima, come lasciando il campo.
  function showAttributes(open: boolean, focus = true): void {
    if (open && !has("attributes")) return;
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    // Nel pannello delle proprietà gli attributi sono una sua sezione.
    if (nestedNow()) {
      if (open) focusAttributes();
      return;
    }
    if (ctx.routed("design", open)) {
      if (open && focus && !inspector.element.hidden) inspector.focus();
      return;
    }
    if (!open && inspector.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    inspector.element.hidden = !open;
    attributesButton.setAttribute("aria-expanded", String(open));
    syncDock();
    if (open) {
      inspectorShown = null;
      syncInspector();
      if (focus) inspector.focus();
    }
  }
  ctx.showAttributes = showAttributes;

  /// Applica il cambio `ops` dell'oggetto che porterà l'id `id`, e lo tiene
  /// scelto: anche se l'id l'ha appena ricevuto, o cambiato. `null` se il
  /// disegno l'ha accettato, altrimenti la ragione per cui no.
  function changeObject(label: DrawKey, ops: readonly Op[], id: string): string | null {
    const before = inspectorShown?.key ?? null;
    ctx.cancelGesture();
    changing = true;
    let outcome: Applied | string | null;
    try {
      outcome = ctx.attempt(label, asGesture(ops));
    } finally {
      changing = false;
    }
    if (outcome === null) return t("draw.rejected", { reason: t("draw.reason.read_only") });
    if (typeof outcome === "string") return t("draw.rejected", { reason: outcome });
    carried = { unit: id, key: before };
    ctx.select([id]);
    return null;
  }
  ctx.changeObject = changeObject;

  // --- Il pannello delle proprietà ---------------------------------------------

  /// Vero se gli attributi stanno nel pannello delle proprietà, come una sua
  /// sezione: quando il livello offre l'uno e l'altro.
  const nestedNow = (): boolean => inspector.element.parentElement === panel.attributes;
  ctx.nestedNow = nestedNow;

  /// Il dock c'è se c'è un pannello aperto; è largo quando ci sono gli
  /// attributi, che vogliono più spazio.
  function syncDock(): void {
    const nested = nestedNow();
    dock.hidden =
      boardsPanel.element.hidden && libraryPanel.element.hidden && symbolsPanel.element.hidden && tree.element.hidden && panel.element.hidden && (nested || inspector.element.hidden) && historyPanel.element.hidden && accessPanel.element.hidden;
    dock.toggleAttribute("data-wide", nested ? !panel.element.hidden : !inspector.element.hidden);
    // Il dock occupa un lato del foglio: con lui che cambia, cambia la sua misura.
    rereadSize();
  }
  ctx.syncDock = syncDock;

  /// Mette gli attributi nel pannello delle proprietà, come una sua sezione,
  /// o li riporta nel dock, chiusi.
  function nestInspector(nested: boolean): void {
    if (nested === nestedNow()) return;
    if (inspector.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    if (nested) panel.attributes.append(inspector.element);
    else if (historyPanel.element.parentElement === dock) dock.insertBefore(inspector.element, historyPanel.element);
    else dock.append(inspector.element);
    inspector.nest(nested);
    inspector.element.hidden = !nested;
    attributesButton.setAttribute("aria-expanded", "false");
    inspectorShown = null;
    ctx.panelShown = null;
    syncDock();
  }
  ctx.nestInspector = nestInspector;

  /// Apre o chiude il pannello delle proprietà. Aperto, il fuoco ci va se
  /// `focus`; chiuso, un valore scritto a metà parte prima, come lasciando il
  /// campo. Se `remember`, è una scelta di chi disegna, e si ricorda.
  function showPanel(open: boolean, focus = open, remember = true): void {
    if (open && !has("properties")) return;
    // Nell'ispettore: la sua scheda, e il fuoco ci va.
    if (ctx.routed("design", open)) {
      if (open && focus && !panel.element.hidden) panel.focus();
      return;
    }
    if (!open && panel.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
    panel.element.hidden = !open;
    propertiesButton.setAttribute("aria-expanded", String(open));
    syncDock();
    if (open) {
      ctx.panelShown = null;
      syncProperties();
      syncInspector();
      if (focus) panel.focus();
    }
    if (remember && ctx.grid.panel !== open) ctx.changeGrid({ ...ctx.grid, panel: open });
  }
  ctx.showPanel = showPanel;

  ctx.panelPending = false;

  /// Il pannello come lo vuole chi disegna: aperto o chiuso come l'ha
  /// lasciato; se non l'ha mai toccato, aperto quando l'editor è abbastanza
  /// largo da tenerlo accanto al foglio. Finché l'editor non ha una misura,
  /// la scelta aspetta la prima; senza modo di saperla, il pannello si apre.
  function showPanelByDefault(): void {
    ctx.panelPending = false;
    // Nell'ispettore le schede le apre chi lo tiene.
    if (ctx.chrome.reveal !== undefined) return;
    if (!has("properties") || !panel.element.hidden) return;
    if (ctx.grid.panel !== null) {
      if (ctx.grid.panel) showPanel(true, false, false);
      return;
    }
    const width = root.clientWidth;
    if (width === 0 && typeof ResizeObserver !== "undefined") {
      ctx.panelPending = true;
      return;
    }
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (width === 0 || width >= PANEL_ROOM_REM * rem) showPanel(true, false, false);
  }
  ctx.showPanelByDefault = showPanelByDefault;

  /// Il lucchetto delle proporzioni: chiuso per gli oggetti che la cornice
  /// ridimensiona dagli angoli tenendo le proporzioni, o come l'ha lasciato
  /// chi l'ha toccato, per la stessa selezione.
  const ratioOn = (units: readonly Unit[]): boolean =>
    ctx.ratioLock !== null && ctx.ratioLock.keys === ctx.selection.join("\n") ? ctx.ratioLock.on : units.some((unit) => RATIO_ROLES.has(unit.role));

  /// Gli originali della ripetizione `container`: gli oggetti che si
  /// scelgono quando la si isola.
  const originalUnits = (container: ContainerNode): readonly Unit[] => indexer.index(ctx.engine.model!, container, isolatedThrough()).units;
  ctx.originalUnits = originalUnits;

  /// La sezione «Ripetizione» per gli oggetti scelti `units`: la
  /// ripetizione scelta da sola, o quella di cui sono originali.
  const repeatFactsOf = (units: readonly Unit[]): RepeatFacts | null => {
    const target = repeatTarget(units);
    const repeat = target?.details?.repeat;
    if (target === null || repeat === undefined) return null;
    const place = repeatPlace(originalUnits(target));
    return { kind: repeat.kind, view: place === null ? null : repeatView(repeat, place) };
  };

  /// La selezione come la legge il pannello.
  const selectionFacts = (units: readonly Unit[]): SelectionFacts => {
    const model = ctx.engine.model!;
    const index = currentIndex();
    const outlines = outlinesOf(model, units);
    const widths = widthLinesOf(model, units);
    // Quali ordini spostano qualcosa lo dice come stanno gli oggetti fra i
    // vicini: non servono le operazioni di ciascuno.
    const changes = has("arrange") ? orderChanges(index, units) : new Set<Order>();
    return {
      keys: ctx.selection.join("\n"),
      subject: units.length === 1 ? labelOf(units[0]!) : plural(units.length, "draw.describe.parts.one", "draw.describe.parts.other"),
      count: units.length,
      frame: frameOf(units),
      ratio: ratioOn(units),
      look: selectionLook(model, units),
      outline: outlines.length === 0 && widths.length === 0 ? null : outlineLook(outlines, widths),
      alignable: ctx.alignReference(units) !== null,
      drawn: ctx.drawn(units),
      orders: new Set(has("arrange") ? ORDERS.map(({ order }) => order).filter((order) => changes.has(order)) : []),
      shape: shapeFacts(model, units),
      tips: has("tips") ? tipsLookOf(model, units) : null,
      styles: has("styles") ? styleFactsOf(model, units) : null,
      symbols: has("symbols") ? symbolFactsOf(model, units) : null,
      repeat: has("repeat") ? repeatFactsOf(units) : null,
    };
  };

  /// La riga «Simbolo» per gli oggetti scelti `units`, se fra loro c'è
  /// un'istanza: il suo simbolo, i simboli del documento con quante istanze
  /// ha ciascuno, e quali le istanze scelte non possono avere.
  const symbolFactsOf = (model: DocumentModel, units: readonly Unit[]): SymbolFacts | null => {
    const instances = units.filter(isInstance);
    if (instances.length === 0) return null;
    const used = new Set(instances.map((unit) => unit.node.details?.symbol ?? ""));
    const counts = instanceCounts(model);
    const cycling = cyclingSymbols(model, instances);
    return {
      current: used.size === 1 ? [...used][0]! || null : null,
      symbols: documentSymbols(model).map((symbol) => ({ id: symbol.id, name: symbol.name, instances: counts.get(symbol.id) ?? 0, cycle: cycling.has(symbol.id) })),
      single: units.length === 1,
    };
  };

  /// Le due righe «Stile» per gli oggetti scelti `units`: che cosa seguono,
  /// gli stili del documento con la loro anteprima, e che cosa si può fare.
  const styleFactsOf = (model: DocumentModel, units: readonly Unit[]): NonNullable<SelectionFacts["styles"]> => {
    const all = documentStyles(model);
    let resources: ReturnType<typeof resourcesOf> | null = null;
    const facts = (kind: StyleKind): StyleFacts | null => {
      const row = styleRow(model, units, kind, all, measureText);
      if (row === null) return null;
      resources ??= resourcesOf(model);
      const shown = resources;
      return {
        row,
        styles: all.filter((style) => style.kind === kind).map((style) => ({ id: style.id, name: style.name, followers: style.followers, sample: styleSample(model, style, shown, drawingFonts.live) })),
        updatable: row.style !== null && styleUpdatable(model, units, row.style),
        undeletable: row.style === null ? null : deleteStyleProblem(model, row.style),
        fresh: freshStyleName(all, kind, t(kind === "text" ? "draw.styles.text" : "draw.styles.graphic")),
      };
    };
    return { graphic: facts("graphic"), text: facts("text") };
  };

  /// Porta il pannello, se è aperto, al disegno e alla selezione di adesso.
  function syncProperties(): void {
    // Mentre gli attributi cambiano un oggetto, la selezione lo ritrova solo
    // dopo: il pannello aspetta lei.
    if (panel.element.hidden || changing) return;
    const index = currentIndex();
    const keys = ctx.selection.join("\n");
    const unit = docUnit();
    const canEdit = editable();
    // La forma dello strumento Poligono, quando è lui lo strumento, e la
    // tavola scelta dallo strumento Tavola.
    const polygonNow = ctx.tool === "polygon" ? ctx.polygonTool : null;
    // La simmetria della penna, con la penna e l'evidenziatore.
    const symmetryPanel = (ctx.tool === "pen" || ctx.tool === "highlighter") && has("symmetry") ? ctx.symmetryNow() : null;
    const boardNow = ctx.tool === "board" ? (chosenSheet()?.board ?? null) : null;
    // Il titolo del disegno è del documento: con una selezione, no.
    ctx.titleField.hidden = ctx.selection.length > 0;
    // Il colore con cui si disegna, col campione da cui viene.
    const drawing = `${style().color} ${style().swatch ?? ""}`;
    const last = ctx.panelShown;
    if (
      last !== null &&
      last.index === index &&
      last.keys === keys &&
      last.unit === unit &&
      last.editable === canEdit &&
      last.grid === ctx.grid &&
      last.features === ctx.features &&
      last.ratio === ctx.ratioLock &&
      last.kept === ctx.kept &&
      last.polygon === polygonNow &&
      last.symmetry === symmetryPanel &&
      last.board === boardNow &&
      last.drawing === drawing &&
      last.recent === ctx.recentColors &&
      last.stop === ctx.gradientStop
    ) {
      return;
    }
    // Che cosa dicono gli oggetti scelti dipende dalla scena, da quali sono,
    // dal livello, dal lucchetto delle proporzioni e dalla cornice tenuta: se
    // sono gli stessi dell'ultima volta, e `panelShown` non è stato azzerato
    // (un cambio di lingua, un colore applicato), la lettura è ancora quella.
    const reading: PanelReading =
      last !== null && last.index === index && last.keys === keys && last.features === ctx.features && last.ratio === ctx.ratioLock && last.kept === ctx.kept
        ? last.reading
        : {};
    ctx.panelShown = { index, keys, unit, editable: canEdit, grid: ctx.grid, features: ctx.features, ratio: ctx.ratioLock, kept: ctx.kept, polygon: polygonNow, symmetry: symmetryPanel, board: boardNow, drawing, recent: ctx.recentColors, stop: ctx.gradientStop, reading };
    const list = boardsNow();
    const model = ctx.engine.model;
    const units = ctx.selection.length === 0 || model === null ? [] : selectedUnits();
    const swatches = model === null ? [] : documentSwatches(model);
    // Gli effetti, letti tutti insieme per gli oggetti scelti; la sezione
    // dice ciò che gli oggetti hanno, non il pannello dei campi.
    const effects =
      model === null || units.length === 0 || !has("effects")
        ? null
        : effectsView({ model, nodes: units.map((each) => nodeOf(model, each)), measure: measureText, key: keys, unit: lookUnit(unit), swatches });
    const facts = units.length === 0 ? null : (reading.facts ??= selectionFacts(units));
    // Il menu «Carattere» offre le famiglie del vault dall'Esperto: il
    // catalogo si legge quando c'è un testo da cambiare.
    if (has("fonts") && facts !== null && facts.look.family.count > 0) drawingFonts.catalog();
    panel.update(
      withEffects(propertiesView({
        features: ctx.features,
        unit,
        editable: canEdit,
        selection: facts,
        document: { page: ctx.scene.root.page, boards: list.length > 0, desc: ctx.rootText("desc") },
        grid: ctx.grid,
        bar: BAR_FEATURES.some(has),
        attributes: nestedNow() && units.length === 1,
        exportSelection: ctx.options.onExport !== undefined && has("export"),
        tool: polygonNow === null ? null : toolFacts(polygonNow),
        symmetry: symmetryPanel,
        board:
          boardNow === null
            ? null
            : { id: boardNow.id, name: boardNow.name, rect: boardNow.rect, index: list.indexOf(boardNow) + 1, count: list.length },
        swatches,
        recent: ctx.recentColors,
        paper: model === null ? null : paperColor(model),
        // I colori si contano soltanto con la loro sezione aperta.
        colors:
          model === null || !has("swatches")
            ? null
            : {
                document: ctx.grid.closed.includes("colors") ? (ctx.colorsCounted?.colors ?? NO_COLORS) : colorsNow(),
                drawing: style().color,
                swatch: style().swatch,
              },
        gradient: model === null || units.length === 0 || !has("gradient") ? null : gradientSection(model, units, keys, swatches, reading),
        hatch: model === null || units.length === 0 || !has("hatches") ? null : hatchSection(model, units, keys, swatches, unit),
        connector: model === null || units.length === 0 || !has("connector") ? null : connectorSection(model, units, keys),
        fonts: { families: has("fonts") ? drawingFonts.families() : [], notes: drawingFonts.fontNotes(), shown: drawingFonts.shown },
      }), effects),
    );
  }
  ctx.syncProperties = syncProperties;

  /// `shown`, con la sezione «Effetti» `effects` se c'è.
  function withEffects(shown: PropertiesView, effects: ReturnType<typeof effectsView>): PropertiesView {
    return effects === null ? shown : { ...shown, effects };
  }

  /// La sezione «Campitura» per gli oggetti scelti `units`, di chiavi `keys`;
  /// `null` se nessuna delle loro parti ha un riempimento. C'è dal livello
  /// Standard, con la parte «Campiture»; i motivi del documento, e il loro
  /// nome, sono dell'Esperto.
  function hatchSection(model: DocumentModel, units: readonly Unit[], keys: string, swatches: HatchPanelView["swatches"], unit: LengthUnit): HatchPanelView | null {
    const index = currentIndex();
    if (ctx.hatchRead?.index !== index || ctx.hatchRead.keys !== keys) ctx.hatchRead = { index, keys, view: hatchView(filledParts(model, units)) };
    const shown = ctx.hatchRead.view;
    if (shown.count === 0) return null;
    return { key: keys, hatch: shown, unit: lookUnit(unit), swatches, motifs: documentPatterns(model), expert: has("motifs") };
  }

  /// La sezione «Connettore» per gli oggetti scelti `units`, di chiavi
  /// `keys`; `null` se fra loro non c'è un connettore.
  function connectorSection(model: DocumentModel, units: readonly Unit[], keys: string): ConnectorPanelView | null {
    const index = currentIndex();
    if (ctx.connectorRead?.index !== index || ctx.connectorRead.keys !== keys) {
      ctx.connectorRead = { index, keys, view: connectorView(model, units, (id) => ctx.engine.holder(id)) };
    }
    return ctx.connectorRead.view === null ? null : { key: keys, ...ctx.connectorRead.view };
  }

  /// La sezione «Sfumatura» per gli oggetti scelti `units`, di chiavi
  /// `keys`; `null` se non hanno né riempimento né contorno.
  function gradientSection(model: DocumentModel, units: readonly Unit[], keys: string, swatches: GradientPanelView["swatches"], reading: PanelReading): GradientPanelView | null {
    // Le sfumature degli oggetti scelti si leggono una volta per lettura; il
    // bersaglio, il punto scelto e il livello cambiano senza rileggerle.
    if (reading.channels === undefined) {
      const found: Partial<Record<PaintChannel, GradientView>> = {};
      for (const target of ["fill", "stroke"] as const) {
        const shown = gradientView(paintedParts(model, units, target));
        if (shown.count > 0) found[target] = shown;
      }
      reading.channels = found;
    }
    const channels = reading.channels;
    const chosen = panel.colorTarget();
    const target = channels[chosen] !== undefined ? chosen : channels.fill !== undefined ? "fill" : channels.stroke !== undefined ? "stroke" : null;
    if (target === null) return null;
    return {
      key: keys,
      channels,
      stop: ctx.gradientStop !== null && ctx.gradientStop.keys === keys && ctx.gradientStop.target === target ? ctx.gradientStop.index : null,
      // Nel Personalizzato non c'è un livello: chi ha scelto lo strumento
      // Sfumatura ha anche «Oltre i capi», che altrimenti non avrebbe mai.
      expert: ctx.level === "expert" || ctx.level === "custom",
      swatches,
    };
  }

  /// I colori del documento, contati, per la scena di adesso.
  function colorsNow(): DocumentColors {
    const index = currentIndex();
    if (ctx.colorsCounted?.index !== index) ctx.colorsCounted = { index, colors: documentColors(ctx.engine.model!) };
    return ctx.colorsCounted.colors;
  }
  ctx.colorsNow = colorsNow;

  /// Invio e Ctrl+Maiusc+X con gli attributi nel pannello: il fuoco va alla
  /// loro sezione, se c'è un oggetto solo di cui mostrarli.
  function focusAttributes(): void {
    const count = selectedUnits().length;
    if (count !== 1) {
      announce(count === 0 ? t("draw.attributes.none") : t("draw.attributes.many", { count: String(count) }));
      return;
    }
    showPanel(true, false);
    panel.focusSection("attributes");
  }
  ctx.focusAttributes = focusAttributes;

  /// Ctrl+Maiusc+M e «Trasforma…» col pannello: il fuoco va ai campi di
  /// «Trasforma». Falso se il pannello non li ha.
  const focusTransform = (): boolean => {
    if (!has("properties")) return false;
    showPanel(true, false);
    return panel.focusSection("transform");
  };
  ctx.focusTransform = focusTransform;

  /// Scrive `ops`, un cambio chiesto dal pannello, col nome `label`; la
  /// selezione diventa `keys`, se ci sono, e la pagina cresce se `extent` ne
  /// esce. `null` se il disegno l'ha accettato, o se non c'era niente da
  /// cambiare; altrimenti la ragione per cui no, che il campo mostra.
  const changeFromPanel = (label: DrawKey, ops: readonly Op[], keys: readonly string[] | null, extent: Bounds | null = null): string | null => {
    if (!editable()) return t("draw.rejected", { reason: t("draw.reason.read_only") });
    if (ops.length === 0) return null;
    ctx.cancelGesture();
    const all: Op[] = [...ops];
    const page = grownPage(extent);
    if (page !== null) all.push({ op: "page", viewBox: page });
    const before = ctx.selection;
    const lock = ctx.ratioLock !== null && ctx.ratioLock.keys === before.join("\n") ? ctx.ratioLock.on : null;
    // La selezione è già quella di dopo quando l'editor si rinfresca, come
    // per i comandi di «Disponi».
    if (keys !== null) ctx.selection = [...keys];
    const outcome = ctx.attempt(label, asGesture(all));
    if (outcome === null || typeof outcome === "string") {
      ctx.selection = before;
      return t("draw.rejected", { reason: outcome ?? t("draw.reason.read_only") });
    }
    if (keys !== null) ctx.select(keys);
    // Il lucchetto resta com'era anche se gli oggetti hanno appena ricevuto
    // un id.
    if (lock !== null) ctx.ratioLock = { keys: ctx.selection.join("\n"), on: lock };
    return null;
  };
  ctx.changeFromPanel = changeFromPanel;

  /// L'ultima scrittura che aspetta una faccia del vault: una dopo che
  /// aspetta anche lei prende il suo posto.
  let facesTurn = 0;

  /// Fa `write`, che misura dei testi per scriverli. Se le sue misure hanno
  /// trovato una faccia del vault che sta ancora arrivando, `late()` lo dice
  /// e `write` non scrive niente: quando la faccia arriva, `write` si rifà,
  /// se il disegno e la selezione sono ancora quelli e nessuna scrittura
  /// dopo ha preso il suo posto, e `then` riceve ciò che torna. Così il file
  /// ha gli a capo e le misure del carattere vero, che un disegno aperto non
  /// rifà.
  function withFaces<R>(write: (late: () => boolean) => R, then: (result: R) => void = () => undefined): R {
    const outer = ctx.lateFonts;
    const found: Font[] = [];
    let said: boolean | null = null;
    // Le misure dopo la domanda sono quelle della scrittura, che non
    // aspettano più.
    const late = (): boolean => {
      if (said === null) {
        said = found.length > 0;
        ctx.lateFonts = outer;
      }
      return said;
    };
    ctx.lateFonts = found;
    let result: R;
    try {
      result = write(late);
    } finally {
      ctx.lateFonts = outer;
    }
    if (said !== true) return result;
    const turn = ++facesTurn;
    const index = currentIndex();
    const keys = ctx.selection.join("\n");
    void drawingFonts.ready(found).then(() => {
      if (ctx.disposed || turn !== facesTurn || currentIndex() !== index || ctx.selection.join("\n") !== keys) return;
      then(write(() => false));
    });
    return result;
  }
  ctx.withFaces = withFaces;

  /// Ciò che un campo del pannello ha cambiato quando una faccia del vault è
  /// arrivata: un rifiuto si dice, e il pannello si rinfresca.
  const panelLater = (outcome: string | null): void => {
    if (outcome !== null) announce(outcome);
    ctx.panelShown = null;
    syncProperties();
  };
  ctx.panelLater = panelLater;

  /// Più oggetti tengono la cornice `frame`, com'è diventata.
  const keepFrame = (frame: Frame): void => {
    ctx.kept = { index: currentIndex(), keys: ctx.selection.join("\n"), frame };
    showHandles();
  };

  /// La selezione si sposta lungo `axis` finché l'angolo in alto a sinistra
  /// della cornice non sta a `value`, nell'unità del documento.
  const moveFromPanel = (axis: FrameAxis, value: number): string | null => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return null;
    const delta = roundDelta(fromUnit(value, docUnit()) - apply(frame.matrix, frame.box.min)[axis]);
    if (delta === 0) return null;
    const dx = axis === 0 ? delta : 0;
    const dy = axis === 1 ? delta : 0;
    const moved = moveOps(units, dx, dy, newIds());
    let bounds: Bounds | null = null;
    for (const unit of units) bounds = union(bounds, translated(unit.bounds, dx, dy));
    const hooked = ctx.hookedIn(units);
    const outcome = changeFromPanel("draw.action.move", moved.ops, moved.keys, bounds);
    if (outcome !== null) return outcome;
    // La cornice che più oggetti tengono si sposta con loro.
    if (units.length > 1 && frame.matrix !== IDENTITY) keepFrame(movedFrame(frame, translate(dx, dy)));
    const detached = ctx.detachedNote(hooked);
    if (detached !== "") announce(detached);
    return null;
  };
  ctx.moveFromPanel = moveFromPanel;

  /// Applica `m`, una trasformazione della cornice `frame`, dal pannello.
  const transformFromPanel = (units: readonly Unit[], frame: Frame, m: Matrix, label: DrawKey): string | null => {
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) return t("draw.transform.unwritable");
    const outcome = changeFromPanel(label, transformed.ops, transformed.keys, boundsAfter(units, m));
    if (outcome === null && transformed.changed > 0) {
      if (units.length > 1) keepFrame(movedFrame(frame, m));
      else ctx.kept = null;
    }
    return outcome;
  };

  /// Il lato `axis` della cornice misura `value`, nell'unità del documento,
  /// fermo l'angolo in alto a sinistra; col lucchetto chiuso l'altro lato lo
  /// segue.
  const resizeFromPanel = (axis: FrameAxis, value: number): string | null => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null || !scales(frame, axis)) return null;
    const ratio = fromUnit(value, docUnit()) / frameSize(frame)[axis];
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const both = ratioOn(units) && scales(frame, axis === 0 ? 1 : 0);
    const { min, max } = frame.box;
    const kx = axis === 0 || both ? ratio : 1;
    const ky = axis === 1 || both ? ratio : 1;
    const m = resizeMatrix(frame, frame.box, { min, max: [min[0] + (max[0] - min[0]) * kx, min[1] + (max[1] - min[1]) * ky] });
    if (m === null) return t("draw.transform.unwritable");
    return transformFromPanel(units, frame, m, "draw.action.resize");
  };
  ctx.resizeFromPanel = resizeFromPanel;

  /// La cornice ruota attorno al suo centro finché il suo lato in alto non
  /// ha l'angolo `value`.
  const rotateFromPanel = (value: number): string | null => {
    const units = selectedUnits();
    const frame = frameOf(units);
    if (frame === null) return null;
    const turn = normalized(value - angleOf(frame.matrix));
    if (Math.abs(turn) < 1e-9) return null;
    return transformFromPanel(units, frame, rotationMatrix(frameCenter(frame), turn), "draw.action.rotate");
  };
  ctx.rotateFromPanel = rotateFromPanel;

  /// L'aspetto o il contorno degli oggetti scelti, da un campo del pannello.
  const styleFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    const look = lookChange(id, value, docUnit());
    if (look !== null) {
      return withFaces((late) => {
        const restyled = lookOps(model, units, look, measureText, newIds());
        if (late()) return null;
        const outcome = changeFromPanel(lookAction(id, value)!, restyled.ops, restyled.keys);
        if (outcome === null && restyled.overflow) announce(t("draw.text.overflow"));
        return outcome;
      }, panelLater);
    }
    const tip = tipChange(id, value);
    if (tip !== null) {
      const tipped = tipOps(model, units, tip, newIds());
      return changeFromPanel(tipAction(tip), tipped.ops, tipped.keys);
    }
    const change = outlineChange(id, value);
    if (change === null) return null;
    const outlined = outlineOps(model, units, change, newIds());
    return changeFromPanel("dash" in change ? "draw.action.dash" : "cap" in change ? "draw.action.cap" : "draw.action.join", outlined.ops, outlined.keys);
  };
  ctx.styleFromPanel = styleFromPanel;
}
