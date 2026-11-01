// L'editor del disegno: i campi e i comandi del pannello delle proprietà. Un
// pezzo di createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { formatNumber } from "../../number";
import { ROOT } from "../../scene/ops";
import { UNITS } from "../../scene/rulers";
import { paintReference } from "../../scene/values";
import { t } from "../../strings";
import { pageRect, rectText } from "../boards";
import { ACTION_COMMANDS, sheetChange } from "../fields";
import type { ActionId, FieldId } from "../properties";
import { fromUnit } from "../rulers";
import { customColor } from "../palette";
import { UNITS_NOW } from "./constants";
import type { EditorContext } from "./context";

/// Ciò che i campi del pannello danno agli altri pezzi dell'editor.
export interface StylingContext {
  changeField: (id: FieldId, value: number | string | boolean) => string | null;
  runAction: (id: ActionId) => void;
}

/// Monta i campi e i comandi del pannello delle proprietà.
export function installStyling(ctx: EditorContext): void {
  const {
    announce, docUnit,
    syncProperties, changeFromPanel, moveFromPanel, resizeFromPanel,
    rotateFromPanel, styleFromPanel
  } = ctx;
  // --- I campi del pannello ------------------------------------------------

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

  /// Un campo della pagina: la misura pronta e il verso.
  const sheetFromPanel = (id: FieldId, value: number | string | boolean): string | null => {
    const page = ctx.scene.root.page;
    if (ctx.engine.model === null || page === null) return null;
    const rect = pageRect(page);
    const next = sheetChange(id, value, rect);
    if (next === null || rectText(next) === rectText(rect)) return null;
    return changeFromPanel("draw.action.page_size", [{ op: "page", viewBox: rectText(next) }], null);
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

  /// Scrive il valore di un campo del pannello: `null` se il disegno l'ha
  /// accettato, altrimenti la ragione per cui no. Dopo, il pannello mostra
  /// com'è il disegno, anche quando il valore scritto non cambiava niente.
  function changeField(id: FieldId, value: number | string | boolean): string | null {
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

}
