// L'editor del disegno: la selezione avanzata. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { displayBinding } from "../../../../ui/commands";
import type { MenuItem } from "../../../../ui/menu";
import { keyOf } from "../../describe";
import { plural, t, type DrawKey } from "../../strings";
import { gesture as asGesture } from "../edit";
import { nodeOf } from "../arrange";
import { repenOps, type Repen } from "../repen";
import { screenBox, toScreen } from "../../view";
import type { Unit } from "../hit";
import { hideLayerOps, lockLayerOps } from "../layers";
import { flagged, flagOps, hasLikeness, inverseOf, nodesOf, similarTo, type Flag, type Likeness } from "../selecting";
import { copiedStyle } from "./clipboard-commands";
import { COPY_STYLE_BINDING, PASTE_STYLE_BINDING } from "./constants";
import type { EditorContext } from "./context";
import { layerTitle } from "./helpers";

/// Le voci di «Seleziona simili», nell'ordine del menu.
const LIKENESSES: ReadonlyArray<{ readonly by: Likeness; readonly label: DrawKey }> = [
  { by: "fill", label: "draw.select.same_fill" },
  { by: "stroke", label: "draw.select.same_stroke" },
  { by: "width", label: "draw.select.same_width" },
  { by: "kind", label: "draw.select.same_kind" },
  { by: "tool", label: "draw.select.same_tool" },
  { by: "layer", label: "draw.select.same_layer" },
];

/// Ciò che la selezione avanzata dà agli altri pezzi dell'editor.
export interface SelectionCommandsContext {
  /// Quando il menu della selezione si è aperto dalla tastiera.
  keyedMenu: number;
  menuPoint: () => MouseEvent;
  flagSelection: (flag: Flag) => void;
  toggleRow: (key: string, flag: Flag) => void;
  selectionItems: () => MenuItem[];
  /// Ripenna i tratti a penna scelti con `change`, in un passo di Annulla
  /// (P10). Falso, e non dice niente, se fra gli scelti non ce n'è uno.
  repenSelection: (change: Repen) => boolean;
}

/// Monta la selezione avanzata.
export function installSelectionCommands(ctx: EditorContext): void {
  const {
    has, surface, editable, isolatedNode, currentIndex, newIds, announce, announceSelection, selectedUnits, outlineNow, describeNode, renameSelection, commit, select,
    leaveIsolation, isolable, isolateSelection, cancelGesture, cursorPoint, boundsOf, arranging,
    arrange
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
  const selectionItems = (): MenuItem[] => {
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
      items.push({
        label: t("draw.rename"),
        separator: true,
        ...(lone ? { hint: displayBinding("F2") } : {}),
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






  /// I tratti a penna fra `units`, anche dentro i loro gruppi e collegamenti.
  const strokesIn = (units: readonly Unit[]): Unit[] =>
    units.flatMap((unit) => (unit.role === "group" || unit.role === "link" ? strokesIn(currentIndex().children(unit)) : ctx.holdsPenStroke(unit) ? [unit] : []));

  /// Ripenna (P10): i tratti scelti si ridisegnano dai loro campioni. La
  /// selezione resta quella, coi nomi nuovi di chi ne riceve uno.
  function repenSelection(change: Repen): boolean {
    if (!editable() || ctx.engine.model === null) return false;
    const chosen = selectedUnits();
    const strokes = strokesIn(chosen);
    if (strokes.length === 0) return false;
    cancelGesture();
    const done = repenOps(ctx.engine.model, strokes, change, newIds());
    const kept = done.kept === 0 ? "" : ` ${plural(done.kept, "draw.repen.kept.one", "draw.repen.kept.other")}`;
    if (done.ops.length === 0) {
      announce(`${t("draw.unchanged")}${kept}`);
      return true;
    }
    const renamed = new Map(strokes.map((unit, at) => [unit.key, done.keys[at]!]));
    const keys = chosen.map((unit) => renamed.get(unit.key) ?? unit.key);
    const label: DrawKey = change.smooth !== undefined ? "draw.action.smooth" : "draw.action.repen";
    if (arrange(label, { ops: done.ops, keys }) !== null) announce(`${plural(done.changed, "draw.repenned.one", "draw.repenned.other")}${kept}`);
    return true;
  }
  ctx.repenSelection = repenSelection;
}
