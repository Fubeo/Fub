// L'editor del disegno: gli stili, i colori, le sfumature, gli effetti e le
// campiture del pannello. Un pezzo di createDrawEditor (`../editor.ts`): lavora
// sul contesto che i pezzi condividono.

import { formatNumber } from "../../number";
import type { DocumentModel, ElementPart } from "../../scene/model";
import { MAX_GRID } from "../../scene/repeat";
import { ROOT } from "../../scene/ops";
import { UNITS } from "../../scene/rulers";
import type { Elem } from "../../scene/serialize";
import { paintReference } from "../../scene/values";
import { plural, t, type DrawKey } from "../../strings";
import type { PaintNode } from "../../painter/paint";
import { roundDelta } from "../edit";
import { nodeOf } from "../arrange";
import { carriedBy as onBoard, moveBoardOps, pageRect, rectText, renameBoardOps, resizeBoardOps } from "../boards";
import { boundsAfter, numericMatrix, numericOps } from "../transform";
import { ACTION_COMMANDS, repeatEdit, SHAPE_ACTIONS, shapeChange, sheetChange, symbolLabel, TEXT_PRESETS } from "../fields";
import { gradientOps, gradientPreview, type GradientChange, type PaintChannel } from "../gradients";
import { editedRepeat, isRepeatKind, repeatPlace, repeatTarget, rewriteOps as rewriteRepeatOps } from "../repeat-ops";
import { cyclingSymbols, documentSymbols, isInstance, renameSymbolOps, swapOps, symbolNameProblem } from "../symbols";
import {
  applyStyleOps,
  deleteStyleOps,
  differingFollowers,
  documentStyles,
  newStyleOps,
  renameStyleOps,
  revertStyleOps,
  styleNameProblem,
  updateStyleOps,
  styleRow,
  unlinkStyleOps,
  type DocumentStyle,
  type Preset as StylePreset,
  type StyleChange,
  type StyleKind,
} from "../styles";
import type { ActionId, FieldId, TransformId } from "../properties";
import {
  documentSwatches,
  linkSwatchOps,
  newSwatchOps,
  recolorSwatchOps,
  removeSwatchOps,
  renameSwatchOps,
  unitsShowing,
  type SwatchChange,
} from "../swatches";
import { connectorOps, type ConnectorChange } from "../connector-ops";
import { effectsOps, effectsStates, MAX_EFFECTS, type EffectsChange } from "../effects";
import { deleteMotifOps, documentPatterns, hatchOps, motifOps, renameMotifOps, type HatchChange } from "../patterns";
import { fromUnit } from "../rulers";
import type { Unit } from "../hit";
import { cleanName } from "../naming";
import { customColor } from "../palette";
import { shapeOps, toolWith } from "../reshape";
import { UNITS_NOW } from "./constants";
import type { EditorContext } from "./context";

/// Ciò che gli stili, i colori, le sfumature, gli effetti e le campiture del pannello dà agli altri pezzi dell'editor.
export interface StylingContext {
  applyColor: (value: string, color: string, name: string, target: "fill" | "stroke" | null) => string | null;
  createSwatch: (name: string, color: string, link: boolean) => string | null;
  linkSwatch: (id: string) => string | null;
  renameSwatch: (id: string, name: string) => string | null;
  recolorSwatch: (id: string, color: string) => string | null;
  deleteSwatch: (id: string) => string | null;
  selectShowing: (value: string) => string | null;
  changeGradient: (target: PaintChannel, change: GradientChange, label: DrawKey) => string | null;
  changeEffects: (change: EffectsChange, label: DrawKey) => string | null;
  changeConnector: (change: ConnectorChange, label: DrawKey) => string | null;
  changeHatch: (change: HatchChange, label: DrawKey) => string | null;
  renameMotif: (id: string, name: string) => string | null;
  deleteMotif: (id: string) => string | null;
  motifReason: () => string | null;
  motifFromSelection: () => void;
  previewGradient: (target: PaintChannel, change: GradientChange | null, only?: ReadonlySet<ElementPart> | null) => void;
  chooseGradientStop: (index: number | null) => void;
  changeField: (id: FieldId, value: number | string | boolean) => string | null;
  runAction: (id: ActionId) => void;
  transformFields: (values: Readonly<Record<TransformId, number>>) => string | null;
}

/// Monta gli stili, i colori, le sfumature, gli effetti e le campiture del pannello.
export function installStyling(ctx: EditorContext): void {
  const {
    has, measureText, textStyle, painter, builder, indexer, chosenSheet, editable, currentIndex, newIds, announce, announceSelection, docUnit,
    selectedUnits, showHandles, originalUnits, syncProperties, colorsNow, changeFromPanel, withFaces, panelLater, moveFromPanel, resizeFromPanel,
    rotateFromPanel, styleFromPanel
  } = ctx;
  // --- Gli stili del documento ----------------------------------------------

  /// `said`, e quanti oggetti restano com'erano perché bloccati, se ce ne
  /// sono.
  const withStyleKept = (said: string, change: StyleChange): string =>
    change.kept === 0 ? said : `${said} ${plural(change.kept, "draw.styles.kept.one", "draw.styles.kept.other")}`;

  /// Che cosa non va nel nome `name` di uno stile di tipo `kind`; `null` se
  /// va. `except` è lo stile che si rinomina.
  const styleNameFailure = (all: readonly DocumentStyle[], kind: StyleKind, name: string, except: string | null = null): string | null => {
    const problem = styleNameProblem(all, kind, name, except);
    if (problem === null) return null;
    if (problem === "empty") return t("draw.colors.problem.empty");
    return t(problem === "taken" ? "draw.styles.problem.taken" : "draw.colors.problem.reads_color", { name });
  };

  /// Un comando della riga «Simbolo»: `symbol:<id>` dà quel simbolo alle
  /// istanze scelte, al loro posto; `edit` entra nel simbolo dell'istanza
  /// scelta da sola; `rename:<nome>` rinomina il simbolo delle istanze
  /// scelte; `detach` le scollega. `null` se è fatto, altrimenti perché no.
  function symbolCommand(value: string): string | null {
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    const colon = value.indexOf(":");
    const verb = colon < 0 ? value : value.slice(0, colon);
    const rest = colon < 0 ? "" : value.slice(colon + 1);
    const instances = units.filter(isInstance);
    const all = documentSymbols(model);
    switch (verb) {
      case "symbol": {
        const symbol = all.find((each) => each.id === rest);
        if (symbol === undefined || instances.length === 0) return null;
        if (cyclingSymbols(model, instances).has(symbol.id)) return t("draw.symbols.why.cycle");
        const count = instances.filter((unit) => unit.node.details?.symbol !== symbol.id).length;
        const swapped = swapOps(model, units, symbol.id, newIds());
        const outcome = changeFromPanel("draw.action.symbol_swap", swapped.ops, swapped.keys);
        if (outcome === null && count > 0) announce(plural(count, "draw.symbols.swapped.one", "draw.symbols.swapped.other", { name: symbolLabel(symbol.name) }));
        return outcome;
      }
      case "edit":
        ctx.editSymbol();
        return null;
      case "rename": {
        const used = new Set(instances.map((unit) => unit.node.details?.symbol));
        const current = used.size === 1 ? (all.find((each) => used.has(each.id)) ?? null) : null;
        if (current === null) return t("draw.symbols.why.mixed");
        const name = cleanName(rest);
        const problem = symbolNameProblem(model, name, current.id);
        if (problem !== null) return problem === "empty" ? t("draw.symbols.problem.empty") : t("draw.symbols.problem.taken", { name });
        const renamed = renameSymbolOps(model, current, name, newIds());
        if (renamed === "foreign") return t("draw.rename.foreign");
        // La selezione resta sulle istanze: il nome sta nel simbolo.
        const outcome = changeFromPanel("draw.action.symbol_rename", renamed.ops, null);
        if (outcome === null && renamed.ops.length > 0) announce(t("draw.symbols.renamed", { name }));
        return outcome;
      }
      case "detach":
        ctx.detachSelection();
        return null;
      default:
        return null;
    }
  }

  /// Un comando della riga «Stile» di tipo `kind`: `style:<id>` dà lo
  /// stile alla selezione, `preset:<id>` fa uno stile di serie e lo dà,
  /// `new:<nome>` fa uno stile dalla selezione; `update`, `revert`,
  /// `unlink`, `rename:<nome>` e `delete` lavorano sullo stile che la
  /// selezione segue. `null` se è fatto, altrimenti perché no.
  function styleCommand(kind: StyleKind, value: string): string | null {
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    const all = documentStyles(model);
    const colon = value.indexOf(":");
    const verb = colon < 0 ? value : value.slice(0, colon);
    const rest = colon < 0 ? "" : value.slice(colon + 1);
    const current = styleRow(model, units, kind, all, measureText)?.style ?? null;
    switch (verb) {
      case "style": {
        const style = all.find((each) => each.id === rest && each.kind === kind);
        return style === undefined ? null : applyStyle(model, units, style);
      }
      case "preset": {
        const preset = TEXT_PRESETS.find((each) => each.id === rest);
        if (kind !== "text" || preset === undefined) return null;
        const name = t(preset.label);
        // Uno stile con quel nome c'è già: si dà lui.
        const named = all.find((each) => each.kind === kind && styleNameProblem([each], kind, name) === "taken");
        return named === undefined ? makeStyle(model, units, kind, name, all, { size: preset.size, weight: preset.weight }) : applyStyle(model, units, named);
      }
      case "new":
        return makeStyle(model, units, kind, cleanName(rest), all, null);
      case "update": {
        if (current === null) return null;
        return withFaces((late) => {
          const updated = updateStyleOps(model, units, current, measureText, newIds());
          if (late()) return null;
          if (updated === null) return t("draw.styles.problem.empty_look");
          if (updated.ops.length === 0) {
            announce(t("draw.styles.updated.same", { name: current.name }));
            return null;
          }
          const outcome = changeFromPanel("draw.action.style_update", updated.ops, updated.keys);
          if (outcome !== null) return outcome;
          const after = ctx.engine.model === null ? undefined : documentStyles(ctx.engine.model).find((each) => each.id === current.id);
          const differing = after === undefined ? 0 : differingFollowers(ctx.engine.model!, after, measureText);
          const said = plural(after?.followers ?? 0, "draw.styles.updated.one", "draw.styles.updated.other", { name: current.name });
          announce(withStyleKept(differing === 0 ? said : `${said} ${plural(differing, "draw.styles.updated.differing.one", "draw.styles.updated.differing.other")}`, updated));
          return null;
        }, panelLater);
      }
      case "revert": {
        if (current === null) return null;
        return withFaces((late) => {
          const reverted = revertStyleOps(model, units, current, measureText, newIds());
          if (late()) return null;
          const outcome = changeFromPanel("draw.action.style_revert", reverted.ops, reverted.keys);
          if (outcome === null) announce(withStyleKept(plural(reverted.changed, "draw.styles.reverted.one", "draw.styles.reverted.other", { name: current.name }), reverted));
          return outcome;
        }, panelLater);
      }
      case "unlink": {
        const unlinked = unlinkStyleOps(model, units, kind, all, newIds());
        const outcome = changeFromPanel("draw.action.style_unlink", unlinked.ops, unlinked.keys);
        if (outcome === null) announce(withStyleKept(plural(unlinked.changed, "draw.styles.unlinked.one", "draw.styles.unlinked.other"), unlinked));
        return outcome;
      }
      case "rename": {
        if (current === null) return null;
        const name = cleanName(rest);
        const failure = styleNameFailure(all, kind, name, current.id);
        if (failure !== null) return failure;
        const renamed = renameStyleOps(model, current, name, units, newIds());
        const outcome = changeFromPanel("draw.action.style_rename", renamed.ops, renamed.keys);
        if (outcome === null && renamed.ops.length > 0) announce(t("draw.styles.renamed", { name }));
        return outcome;
      }
      case "delete": {
        if (current === null) return null;
        const removed = deleteStyleOps(model, current, units, newIds());
        if (removed === null) return t("draw.styles.refused.locked");
        const outcome = changeFromPanel("draw.action.style_delete", removed.ops, removed.keys);
        if (outcome === null) {
          const { name } = current;
          announce(removed.changed === 0 ? t("draw.styles.deleted", { name }) : plural(removed.changed, "draw.styles.deleted.one", "draw.styles.deleted.other", { name }));
        }
        return outcome;
      }
      default:
        return null;
    }
  }

  /// Dà lo stile `style` agli oggetti scelti `units`.
  function applyStyle(model: DocumentModel, units: readonly Unit[], style: DocumentStyle): string | null {
    return withFaces((late) => {
      const applied = applyStyleOps(model, units, style, measureText, newIds());
      if (late()) return null;
      const outcome = changeFromPanel("draw.action.style_apply", applied.ops, applied.keys);
      if (outcome === null) announce(withStyleKept(plural(applied.changed, "draw.styles.applied.one", "draw.styles.applied.other", { name: style.name }), applied));
      return outcome;
    }, panelLater);
  }

  /// Fa lo stile `name` di tipo `kind` dalla selezione `units`, col corpo e
  /// il peso di `preset` se c'è, e lo fa seguire agli oggetti scelti.
  function makeStyle(model: DocumentModel, units: readonly Unit[], kind: StyleKind, name: string, all: readonly DocumentStyle[], preset: StylePreset | null): string | null {
    const failure = styleNameFailure(all, kind, name);
    if (failure !== null) return failure;
    return withFaces((late) => {
      const made = newStyleOps(model, units, kind, name, measureText, newIds(), preset);
      if (late()) return null;
      if (made === null) return t("draw.styles.problem.empty_look");
      const outcome = changeFromPanel("draw.action.style_new", made.ops, made.keys);
      if (outcome === null) announce(withStyleKept(plural(made.changed, "draw.styles.created.one", "draw.styles.created.other", { name }), made));
      return outcome;
    }, panelLater);
  }

  // --- I colori del documento ------------------------------------------------

  /// Il campione `id` del disegno di adesso, se c'è.
  const swatchNamed = (id: string): { readonly id: string; readonly name: string; readonly color: string } | null => {
    const model = ctx.engine.model;
    return (model === null ? undefined : documentSwatches(model).find((each) => each.id === id)) ?? null;
  };

  /// Quanti elementi mostrano il campione `id`, nel disegno di adesso.
  const swatchUses = (id: string): number => colorsNow().swatches.find((each) => each.id === id)?.uses ?? 0;

  /// `said`, e quanti oggetti tengono il colore scritto, se ce ne sono.
  const withKept = (said: string, change: SwatchChange): string =>
    change.kept === 0 ? said : `${said} ${plural(change.kept, "draw.colors.kept.one", "draw.colors.kept.other")}`;

  /// Un colore dalla sezione «Colori del documento»: `value` si scrive,
  /// `color` è il suo `#rrggbb` e `name` come si dice. Va al bersaglio
  /// `target` della selezione o, con `null`, a ciò che si disegna.
  function applyColor(value: string, color: string, name: string, target: "fill" | "stroke" | null): string | null {
    if (target === null) {
      ctx.setColor(color, { swatch: paintReference(value)?.id ?? null });
      announce(t("draw.announce.color", { color: name }));
      return null;
    }
    const outcome = styleFromPanel(target, value);
    if (outcome === null) {
      if (paintReference(value) === null) ctx.rememberColors(color);
      announce(t("draw.colors.applied", { target: t(target === "fill" ? "draw.properties.fill" : "draw.properties.stroke"), name }));
    }
    ctx.panelShown = null;
    syncProperties();
    return outcome;
  }
  ctx.applyColor = applyColor;

  /// Il campione nuovo `name` del colore `color`; con `link`, chi usa
  /// `color` scritto passa a lui.
  function createSwatch(name: string, color: string, link: boolean): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    if (model === null) return null;
    const made = newSwatchOps(model, color, name, link, selectedUnits(), newIds());
    const outcome = changeFromPanel(link ? "draw.action.swatch_make" : "draw.action.swatch_new", made.ops, made.keys);
    if (outcome !== null) return outcome;
    const uses = link ? swatchUses(made.id) : 0;
    announce(withKept(uses === 0 ? t("draw.colors.created", { name }) : plural(uses, "draw.colors.created.one", "draw.colors.created.other", { name }), made));
    return null;
  }
  ctx.createSwatch = createSwatch;

  /// Chi usa scritto il colore del campione `id` passa a lui.
  function linkSwatch(id: string): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const swatch = swatchNamed(id);
    if (model === null || swatch === null) return null;
    const linked = linkSwatchOps(model, id, selectedUnits(), newIds());
    const outcome = changeFromPanel("draw.action.swatch_link", linked.ops, linked.keys);
    if (outcome !== null) return outcome;
    const { name } = swatch;
    announce(withKept(linked.ops.length === 0 ? t("draw.colors.linked.none", { name }) : plural(swatchUses(id), "draw.colors.linked.one", "draw.colors.linked.other", { name }), linked));
    return null;
  }
  ctx.linkSwatch = linkSwatch;

  function renameSwatch(id: string, name: string): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    if (model === null) return null;
    const renamed = renameSwatchOps(model, id, name, selectedUnits(), newIds());
    const outcome = changeFromPanel("draw.action.swatch_rename", renamed.ops, renamed.keys);
    if (outcome === null && renamed.ops.length > 0) announce(t("draw.colors.renamed", { name }));
    return outcome;
  }
  ctx.renameSwatch = renameSwatch;

  /// Il colore nuovo `color` del campione `id`, per chi lo usa e, se viene
  /// da lui, per ciò che si disegna.
  function recolorSwatch(id: string, color: string): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const swatch = swatchNamed(id);
    if (model === null || swatch === null) return null;
    const recolored = recolorSwatchOps(model, id, color, selectedUnits(), newIds());
    const outcome = changeFromPanel("draw.action.swatch_recolor", recolored.ops, recolored.keys);
    if (outcome !== null) return outcome;
    announce(t("draw.colors.recolored", { name: swatch.name, color: ctx.colorName(color) }));
    return null;
  }
  ctx.recolorSwatch = recolorSwatch;

  /// Toglie il campione `id`: chi lo usa torna al suo colore, scritto.
  function deleteSwatch(id: string): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const swatch = swatchNamed(id);
    if (model === null || swatch === null) return null;
    const removed = removeSwatchOps(model, id, selectedUnits(), newIds());
    const outcome = changeFromPanel("draw.action.swatch_delete", removed.ops, removed.keys);
    if (outcome !== null) return outcome;
    const { name } = swatch;
    announce(removed.kept === 0 ? t("draw.colors.deleted", { name }) : plural(removed.kept, "draw.colors.deleted.kept.one", "draw.colors.deleted.kept.other", { name }));
    return null;
  }
  ctx.deleteSwatch = deleteSwatch;

  /// Sceglie gli oggetti che si scelgono e che mostrano `value`, un colore
  /// `#rrggbb` o un campione `url(#id)`, come «Scegli simili».
  function selectShowing(value: string): string | null {
    const model = ctx.engine.model;
    if (model === null) return null;
    const units = unitsShowing(model, currentIndex(), value);
    if (units.length === 0) {
      announce(t("draw.colors.selected.none"));
      return null;
    }
    ctx.cancelGesture();
    ctx.select(units.map((unit) => unit.key));
    announceSelection();
    return null;
  }
  ctx.selectShowing = selectShowing;

  // --- Le sfumature ----------------------------------------------------------

  /// La sfumatura `change` per il bersaglio `target` degli oggetti scelti,
  /// dalla sezione «Sfumatura», col nome `label` nella cronologia.
  function changeGradient(target: PaintChannel, change: GradientChange, label: DrawKey): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    previewGradient(target, null);
    const changed = gradientOps(model, units, target, change, measureText, newIds());
    // Un cambio che non arriva a nessuno è di oggetti senza una misura su
    // cui stendere la sfumatura.
    if (changed.reached === 0) return t("draw.gradient.no_place");
    const before = ctx.selection.join("\n");
    const failure = changeFromPanel(label, changed.ops, changed.keys);
    if (failure === null) ctx.rekeyGradient(before);
    return failure;
  }
  ctx.changeGradient = changeGradient;

  // --- Gli effetti -----------------------------------------------------------

  /// Il cambio `change` degli effetti degli oggetti scelti, dalla sezione
  /// «Effetti», col nome `label` nella cronologia. `null` se è fatto,
  /// altrimenti perché no.
  function changeEffects(change: EffectsChange, label: DrawKey): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    const changed = effectsOps(model, units, change, measureText, newIds());
    if (typeof changed === "string") {
      if (changed !== "full") return t(`draw.effects.refused.${changed}`);
      // Otto effetti, o una seconda sfocatura: lo dice il caso.
      const blurred =
        change.kind === "add" &&
        change.effect.kind === "blur" &&
        effectsStates(model, units.map((each) => nodeOf(model, each))).some((state) => state.kind === "effects" && state.effects.some((effect) => effect.kind === "blur"));
      return blurred ? t("draw.effects.full.blur") : t("draw.effects.full", { max: String(MAX_EFFECTS) });
    }
    return changeFromPanel(label, changed.ops, changed.keys);
  }
  ctx.changeEffects = changeEffects;

  // --- Il connettore nelle proprietà ----------------------------------------

  /// Il cambio `change` dei connettori scelti, dalla sezione «Connettore»,
  /// col nome `label` nella cronologia. Una scelta (tipo, aggancio, verso)
  /// dice a quanti connettori è arrivata; il testo di un'etichetta no, che si
  /// legge. Il tipo scelto è anche quello dei connettori che lo strumento
  /// disegna dopo. `null` se è fatto, altrimenti perché no.
  function changeConnector(change: ConnectorChange, label: DrawKey): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    if ("kind" in change) ctx.connectorKind = change.kind;
    const changed = connectorOps(model, units, change, (id) => ctx.engine.holder(id), measureText, newIds(), { color: textStyle.color, size: textStyle.width });
    const chosen = !("label" in change);
    if (changed.ops.length === 0) {
      if (chosen) announce(t("draw.unchanged"));
      return null;
    }
    const failure = changeFromPanel(label, changed.ops, changed.keys);
    if (failure !== null || !chosen) return failure;
    announce(plural(changed.reached, "draw.connector.applied.one", "draw.connector.applied.other"));
    return null;
  }
  ctx.changeConnector = changeConnector;

  // --- Le campiture e i motivi -----------------------------------------------

  /// Il cambio `change` delle campiture degli oggetti scelti, dalla sezione
  /// «Campitura», col nome `label` nella cronologia. Una scelta del menu
  /// dice a quanti oggetti è arrivata; un campo no, che si legge. `null` se
  /// è fatto, altrimenti perché no.
  function changeHatch(change: HatchChange, label: DrawKey): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return null;
    const changed = hatchOps(model, units, change, measureText, newIds());
    const chosen = "preset" in change || "none" in change || "pattern" in change;
    if (changed.ops.length === 0) {
      if (chosen) announce(t("draw.unchanged"));
      return null;
    }
    const failure = changeFromPanel(label, changed.ops, changed.keys);
    if (failure !== null || !chosen) return failure;
    if ("preset" in change) {
      announce(plural(changed.reached, "draw.hatch.applied.one", "draw.hatch.applied.other", { name: t(`draw.hatch.preset.${change.preset}`) }));
    } else if ("pattern" in change) {
      const name = documentPatterns(model).find((each) => each.id === change.pattern)?.name ?? "";
      announce(plural(changed.reached, "draw.hatch.applied.motif.one", "draw.hatch.applied.motif.other", { name }));
    } else {
      announce(plural(changed.reached, "draw.hatch.removed.one", "draw.hatch.removed.other"));
    }
    return null;
  }
  ctx.changeHatch = changeHatch;

  /// Dà il nome `name` al motivo `id` del documento, dalla sezione
  /// «Campitura». `null` se è fatto, altrimenti perché no.
  function renameMotif(id: string, name: string): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    if (model === null) return null;
    const renamed = renameMotifOps(model, id, name, selectedUnits(), newIds());
    const outcome = changeFromPanel("draw.action.motif_rename", renamed.ops, renamed.keys);
    if (outcome === null && renamed.ops.length > 0) announce(t("draw.hatch.motif.renamed", { name }));
    return outcome;
  }
  ctx.renameMotif = renameMotif;

  /// Elimina il motivo `id` del documento: chi lo usa torna al suo colore, e
  /// si dice quanti oggetti non si sono potuti cambiare.
  function deleteMotif(id: string): string | null {
    ctx.settleCrop();
    const model = ctx.engine.model;
    const motif = model === null ? undefined : documentPatterns(model).find((each) => each.id === id);
    if (model === null || motif === undefined) return null;
    const removed = deleteMotifOps(model, id, selectedUnits(), newIds());
    const outcome = changeFromPanel("draw.action.motif_delete", removed.ops, removed.keys);
    if (outcome !== null) return outcome;
    const { name } = motif;
    announce(removed.kept === 0 ? t("draw.hatch.motif.deleted", { name }) : plural(removed.kept, "draw.hatch.motif.deleted.kept.one", "draw.hatch.motif.deleted.kept.other", { name }));
    return null;
  }
  ctx.deleteMotif = deleteMotif;

  /// Perché «Motivo dalla selezione» non si fa con gli oggetti scelti, a
  /// parole; `null` se si fa. Si chiede quando un menu si apre, non a ogni
  /// cambio della selezione: fare il motivo costa quanto copiare gli oggetti.
  function motifReason(): string | null {
    if (!editable()) return t("draw.rejected", { reason: t("draw.reason.read_only") });
    const model = ctx.engine.model;
    const units = selectedUnits();
    if (model === null || units.length === 0) return t("draw.selected.none");
    const made = motifOps(model, units, t("draw.hatch.motif.base"), newIds());
    return typeof made === "string" ? t(`draw.hatch.motif.refused.${made}`) : null;
  }
  ctx.motifReason = motifReason;

  /// «Motivo dalla selezione», dal livello Esperto: gli oggetti scelti
  /// diventano un motivo del documento, col primo nome libero, che i
  /// riempimenti possono usare. Gli oggetti restano, e restano scelti.
  function motifFromSelection(): void {
    // In sola lettura il comando c'è e lo dice, invece di non fare niente.
    if (has("motifs") && !editable()) {
      announce(t("draw.rejected", { reason: t("draw.reason.read_only") }));
      return;
    }
    const units = ctx.arranging("motifs");
    if (units === null) return;
    const made = motifOps(ctx.engine.model!, units, t("draw.hatch.motif.base"), newIds());
    if (typeof made === "string") {
      announce(t(`draw.hatch.motif.refused.${made}`));
      return;
    }
    if (ctx.arrange("draw.action.motif_make", made) !== null) announce(t("draw.hatch.motif.made", { name: made.name }));
  }
  ctx.motifFromSelection = motifFromSelection;

  /// Mostra sul disegno la sfumatura `change` del bersaglio `target` degli
  /// oggetti scelti, o delle sole parti `only`, senza scriverla; `null` toglie
  /// ciò che mostrava.
  function previewGradient(target: PaintChannel, change: GradientChange | null, only: ReadonlySet<ElementPart> | null = null): void {
    const model = ctx.engine.model;
    if (change === null || model === null) {
      if (!ctx.gradientShown) return;
      ctx.gradientShown = false;
      painter.setDraft(null);
      return;
    }
    const paints = new Map<PaintNode, Partial<Record<PaintChannel, string | Elem>>>();
    for (const [node, shown] of gradientPreview(model, selectedUnits(), target, change, only)) {
      for (const paint of builder.paintsOf(node)) paints.set(paint, { [shown.name]: shown.value });
    }
    ctx.gradientShown = paints.size > 0;
    painter.setDraft(ctx.gradientShown ? { paints } : null);
  }
  ctx.previewGradient = previewGradient;

  /// Il punto `index` della sfumatura comune diventa quello scelto, nel
  /// pannello e sul foglio, dove lascia il capo scelto; `null` nessuno, e il
  /// pannello mostra il primo. Il pannello ridice dopo ogni cambio il punto
  /// che mostra: lo stesso di prima lascia le cose come stanno.
  function chooseGradientStop(index: number | null): void {
    const model = ctx.engine.model;
    const units = selectedUnits();
    const target = model === null || units.length === 0 ? null : ctx.gradientTarget(model, units);
    const keys = ctx.selection.join("\n");
    const before = ctx.gradientStop !== null && ctx.gradientStop.keys === keys && ctx.gradientStop.target === target ? ctx.gradientStop : null;
    if (index !== null && index === (before?.index ?? 0)) return;
    ctx.gradientStop = index === null || target === null ? null : { keys, target, index, group: before?.group ?? 0 };
    ctx.gradientGrip = null;
    showHandles();
    syncProperties();
  }
  ctx.chooseGradientStop = chooseGradientStop;

  /// Un campo di «Forma»: cambia i poligoni, le stelle e i rettangoli
  /// scelti, o senza selezione lo strumento Poligono.
  const shapeFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    const change = shapeChange(id, value, docUnit());
    const model = ctx.engine.model;
    if (change === null || model === null) return null;
    const units = selectedUnits();
    if (units.length === 0) {
      if (ctx.tool === "polygon") ctx.setPolygonTool(toolWith(ctx.polygonTool, change));
      return null;
    }
    const reshaped = shapeOps(model, units, change, newIds(), ctx.polygonTool);
    return changeFromPanel(SHAPE_ACTIONS[id]!, reshaped.ops, reshaped.keys);
  };

  /// Un numero di «Ripetizione», nell'unità del documento: la ripetizione
  /// della selezione cambia, con le sue copie, e il raggio sposta gli
  /// originali; la selezione resta. Una griglia con troppe o troppo poche
  /// celle non si scrive, e il campo lo dice.
  const repeatFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    const model = ctx.engine.model;
    const units = selectedUnits();
    const target = repeatTarget(units);
    const repeat = target?.details?.repeat;
    const edit = repeatEdit(id, value, docUnit());
    if (model === null || target === null || repeat === undefined || edit === null) return null;
    const place = repeatPlace(originalUnits(target));
    const next = place === null ? null : editedRepeat(repeat, place, edit);
    if (next === null) {
      const side = edit.field === "columns" || edit.field === "rows" ? Math.round(edit.value) : null;
      const cells = repeat.kind !== "grid" || side === null ? null : side * (edit.field === "columns" ? repeat.rows : repeat.columns);
      return cells !== null && (cells < 2 || cells > MAX_GRID) ? t("draw.properties.repeat.cells") : null;
    }
    const keys = units.length === 1 && units[0]!.node === target ? [] : units.map((unit) => unit.key);
    const made = rewriteRepeatOps(model, target, next.repeat, newIds(), next.move, keys);
    return changeFromPanel("draw.action.repeat_change", made.ops, made.keys);
  };

  /// Un lato della pagina, nell'unità del documento.
  const pageFromPanel = (id: "pageWidth" | "pageHeight", value: number): string | null => {
    const page = ctx.scene.root.page;
    if (page === null) return null;
    const size = fromUnit(value, docUnit());
    const viewBox = (box: readonly number[]): string => box.map((each) => formatNumber(each, ctx.PLACES)).join(" ");
    const next = viewBox([page.x, page.y, id === "pageWidth" ? size : page.width, id === "pageHeight" ? size : page.height]);
    if (next === viewBox([page.x, page.y, page.width, page.height])) return null;
    return changeFromPanel("draw.action.page_size", [{ op: "page", viewBox: next }], null);
  };

  /// Un campo della tavola scelta o della pagina: la misura pronta, il
  /// verso, il posto e le misure. Una tavola si sposta con ciò che porta,
  /// come con le frecce; le misure tengono l'angolo in alto a sinistra.
  const sheetFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    const model = ctx.engine.model;
    const page = ctx.scene.root.page;
    const board = id.startsWith("board") ? (chosenSheet()?.board ?? null) : null;
    const rect = board?.rect ?? (id.startsWith("page") && page !== null ? pageRect(page) : null);
    if (model === null || rect === null) return null;
    const next = sheetChange(id, value, rect, docUnit());
    if (next === null || rectText(next) === rectText(rect)) return null;
    if (board === null) return changeFromPanel("draw.action.page_size", [{ op: "page", viewBox: rectText(next) }], null);
    if (id === "boardX" || id === "boardY") {
      const carried = onBoard(board.box, indexer.movable(model));
      const moved = moveBoardOps(model, board, roundDelta(next[0] - rect[0]), roundDelta(next[1] - rect[1]), carried, newIds(), page);
      return changeFromPanel("draw.action.board_move", moved.ops, null);
    }
    return changeFromPanel("draw.action.board_resize", resizeBoardOps(model, board, next, newIds(), page).ops, null);
  };

  /// Il nome della tavola scelta, dal pannello: vuoto non cambia niente,
  /// come nell'elenco.
  const boardNameFromPanel = (value: string): string | null => {
    const board = chosenSheet()?.board ?? null;
    const model = ctx.engine.model;
    const name = cleanName(value);
    if (board === null || model === null || name === "" || name === board.name) return null;
    const renamed = renameBoardOps(model, board, name, newIds());
    return renamed === "foreign" ? t("draw.board.foreign") : changeFromPanel("draw.action.board_rename", renamed.ops, null);
  };

  const descFromPanel = (value: string): string | null => {
    const next = value.trim();
    if (next === ctx.rootText("desc").trim()) return null;
    return changeFromPanel("draw.action.desc", [{ op: "meta", desc: next === "" ? null : next }], null);
  };

  /// L'unità del documento, dal pannello: come dal menu, si dice.
  const unitFromPanel = (value: number | string | boolean): string | null => {
    const unit = UNITS.find((each) => each === value);
    if (unit === undefined || unit === docUnit()) return null;
    const outcome = changeFromPanel("draw.action.units", [{ op: "set", id: ROOT, attrs: { "fub:units": unit === "px" ? null : unit } }], null);
    if (outcome === null) announce(t(UNITS_NOW[unit]));
    return outcome;
  };

  /// I campi del pannello che non scrivono nel disegno.
  const SHEET_FIELDS: ReadonlySet<FieldId> = new Set<FieldId>(["grid", "snap", "guides", "rulers", "rulerGuides", "bar", "ratio", "symmetry", "symmetrySlices", "symmetryMirror", "symmetryX", "symmetryY"]);

  /// Scrive il valore di un campo del pannello: `null` se il disegno l'ha
  /// accettato, altrimenti la ragione per cui no. Dopo, il pannello mostra
  /// com'è il disegno, anche quando il valore scritto non cambiava niente.
  function changeField(id: FieldId, value: number | string | boolean): string | null {
    // Ciò che scrive nel disegno applica prima il ritaglio aperto; la griglia
    // e il lucchetto delle proporzioni sono del foglio, e lo lasciano.
    if (!SHEET_FIELDS.has(id)) ctx.settleCrop();
    const on = value === true;
    const number = typeof value === "number" ? value : Number.NaN;
    let outcome: string | null = null;
    switch (id) {
      case "grid":
        ctx.changeGrid({ ...ctx.grid, shown: on });
        break;
      case "snap":
        ctx.changeGrid({ ...ctx.grid, snap: on });
        break;
      case "guides":
        ctx.changeGrid({ ...ctx.grid, guides: on });
        break;
      case "rulers":
        ctx.changeGrid({ ...ctx.grid, rulers: on });
        break;
      case "rulerGuides":
        ctx.changeGrid({ ...ctx.grid, rulerGuides: on });
        break;
      case "bar":
        ctx.changeGrid({ ...ctx.grid, bar: on });
        break;
      case "ratio":
        ctx.ratioLock = { keys: ctx.selection.join("\n"), on };
        break;
      case "unit":
        outcome = unitFromPanel(value);
        break;
      case "desc":
        outcome = descFromPanel(String(value));
        break;
      case "pageWidth":
      case "pageHeight":
        if (Number.isFinite(number)) outcome = pageFromPanel(id, number);
        break;
      case "boardName":
        outcome = boardNameFromPanel(String(value));
        break;
      case "boardPreset":
      case "boardOrientation":
      case "boardX":
      case "boardY":
      case "boardWidth":
      case "boardHeight":
      case "pagePreset":
      case "pageOrientation":
        outcome = sheetFromPanel(id, value);
        break;
      case "x":
      case "y":
        if (Number.isFinite(number)) outcome = moveFromPanel(id === "x" ? 0 : 1, number);
        break;
      case "width":
      case "height":
        if (Number.isFinite(number)) outcome = resizeFromPanel(id === "width" ? 0 : 1, number);
        break;
      case "rotation":
        if (Number.isFinite(number)) outcome = rotateFromPanel(number);
        break;
      case "shape":
      case "count":
      case "inner":
      case "corner":
        outcome = shapeFromPanel(id, value);
        break;
      case "lookStyle":
      case "textStyle":
        outcome = styleCommand(id === "textStyle" ? "text" : "graphic", String(value));
        break;
      case "symbol":
        outcome = symbolCommand(String(value));
        break;
      case "repeat":
        // Un tipo rifà la ripetizione, «Espandi» la espande: dicono loro
        // che cosa è successo.
        if (value === "expand") ctx.expandSelection();
        else if (isRepeatKind(value)) ctx.repeatSelection(value);
        break;
      case "repeatCount":
      case "repeatRadius":
      case "repeatX":
      case "repeatY":
      case "repeatColumns":
      case "repeatRows":
      case "repeatStepX":
      case "repeatStepY":
      case "repeatAngle":
      case "repeatDistance":
        outcome = repeatFromPanel(id, value);
        break;
      case "symmetry":
      case "symmetrySlices":
      case "symmetryMirror":
      case "symmetryX":
      case "symmetryY":
        outcome = ctx.symmetryFromPanel(id, value);
        break;
      default:
        outcome = styleFromPanel(id, value);
        // Un colore scritto nel riempimento o nel contorno entra fra i
        // recenti; un campione no, perché ha la sua griglia.
        if (outcome === null && (id === "fill" || id === "stroke") && typeof value === "string") {
          const code = paintReference(value) === null ? customColor(value) : null;
          if (code !== null) ctx.rememberColors(code);
        }
    }
    ctx.panelShown = null;
    syncProperties();
    return outcome;
  }
  ctx.changeField = changeField;

  /// Un comando di «Disponi» del pannello, come dalla barra.
  function runAction(id: ActionId): void {
    const command = ACTION_COMMANDS[id];
    if (command.kind === "align") ctx.alignSelection(command.edge);
    else if (command.kind === "distribute") ctx.distributeSelection(command.axis);
    else ctx.orderSelection(command.order);
  }
  ctx.runAction = runAction;

  /// «Applica» di «Trasforma»: come la finestra, attorno al centro del
  /// riquadro degli oggetti scelti.
  function transformFields(values: Readonly<Record<TransformId, number>>): string | null {
    if (values.scaleX === 0 || values.scaleY === 0) return t("draw.properties.zero_scale");
    const units = ctx.arranging("transform");
    const from = units === null ? null : ctx.boundsOf(units);
    if (units === null || from === null) return null;
    const m = numericMatrix(
      { rotate: values.turn, scaleX: values.scaleX / 100, scaleY: values.scaleY / 100, skewX: values.skewX, skewY: values.skewY },
      [(from.min[0] + from.max[0]) / 2, (from.min[1] + from.max[1]) / 2],
    );
    const transformed = numericOps(units, m, newIds());
    if (transformed === null) return t("draw.transform.unwritable");
    if (ctx.arrange("draw.action.transform", transformed, boundsAfter(units, m)) !== null) {
      announce(plural(transformed.changed, "draw.transformed.one", "draw.transformed.other"));
    }
    return null;
  }
  ctx.transformFields = transformFields;
}
