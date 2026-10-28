// L'editor del disegno: i livelli, la griglia e la pagina. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { displayBinding, modifierName } from "../../../../ui/commands";
import { promptForm } from "../../../../ui/form-dialog";
import type { MenuItem } from "../../../../ui/menu";
import { keyOf } from "../../describe";
import { sameCurve } from "../../../../ink/input/pressure";
import type { Bounds } from "../../scene/geometry";
import { ROOT } from "../../scene/ops";
import { UNITS, type LengthUnit } from "../../scene/rulers";
import { plural, t, type DrawKey } from "../../strings";
import { fittedPage, gesture as asGesture } from "../edit";
import type { Arranged } from "../arrange";
import { UNIT_NAMES } from "../fields";
import { gridStep, sameStep, unitSteps, withStep, type Grid } from "../grid";
import { nextTurn } from "../../view";
import type { LayerInfo } from "../hit";
import {
  addLayerOps,
  canShiftLayer,
  freshLayerName,
  hideLayerOps,
  layerName,
  lockLayerOps,
  MAX_LAYER_NAME,
  removeLayerOps,
  renameLayerOps,
  shiftLayerOps,
  type Shift,
} from "../layers";
import { BAR_FEATURES, RULERS_BINDING, UNITS_NOW } from "./constants";
import type { EditorContext } from "./context";
import { checkedGrid, layerRefusal, layerState, layerTitle, union } from "./helpers";

/// Quanti caratteri del nome di un livello entrano nel nome di un comando:
/// il resto, come «su» e «giù», deve restare in vista.
const LAYER_IN_COMMAND = 24;

/// Ciò che i livelli, la griglia e la pagina dà agli altri pezzi dell'editor.
export interface LayersGridContext {
  writeLayers: (label: DrawKey, arranged: Arranged, key: string | null) => boolean;
  layerItems: () => MenuItem[];
  changeGrid: (next: Grid) => void;
  guideItems: (index: number) => MenuItem[];
  rulerItems: () => MenuItem[];
  pageItems: () => MenuItem[];
}

/// Monta i livelli, la griglia e la pagina.
export function installLayersGrid(ctx: EditorContext): void {
  const {
    has, suggestions, pageButton, indexer, boardsNow, editable, currentIndex, newIds, announce, showGrid, docUnit, stepNow, lengthText, lengthSpoken,
    showGuideLines, turnView, showHandles, outlineNow, syncProperties, currentLayer, choose, syncLayers, commit, cancelGesture, lockGuide, deleteGuide,
    lockAllGuides, deleteAllGuides, touchSettings, editGuides, effectsExtent, keptLook, openMenu, settleCrop, options
  } = ctx;
  // --- Livelli -----------------------------------------------------------------

  /// Il livello su cui lavora un comando dei livelli: quello corrente, se
  /// l'interfaccia offre i livelli e il disegno si scrive.
  const layering = (): LayerInfo | null => {
    if (!has("layers") || !editable()) return null;
    cancelGesture();
    settleCrop();
    return currentLayer();
  };

  /// Scrive un comando sui livelli col nome `label`; il livello di chiave
  /// `key`, se c'è, diventa quello corrente. `false` se non c'era niente da
  /// cambiare, e lo si dice, o se il motore ha rifiutato.
  const writeLayers = (label: DrawKey, arranged: Arranged, key: string | null): boolean => {
    if (arranged.ops.length === 0) {
      announce(t("draw.unchanged"));
      return false;
    }
    // Il livello corrente è già quello di dopo quando l'editor si rinfresca.
    const before = ctx.chosen;
    if (key !== null) ctx.chosen = { key, at: ctx.chosen?.at ?? 0 };
    if (commit(label, asGesture(arranged.ops)) === null) {
      ctx.chosen = before;
      syncLayers();
      return false;
    }
    return true;
  };
  ctx.writeLayers = writeLayers;

  /// Sceglie il livello corrente; se lì non si disegna, lo dice subito.
  function chooseLayer(layer: LayerInfo): void {
    if (!has("layers")) return;
    choose(layer);
    const name = layerTitle(layer);
    const refusal = layerRefusal(layer);
    announce(refusal === null ? t("draw.layer.chosen", { name }) : `${t("draw.layer.chosen", { name })} ${t(refusal, { name })}`);
  }

  /// Un livello nuovo e vuoto sopra quello corrente, che diventa lui.
  function addLayer(): void {
    if (!has("layers") || !editable()) return;
    cancelGesture();
    settleCrop();
    const name = freshLayerName(currentIndex().layers, (n) => t("draw.layer.default", { n }));
    const arranged = addLayerOps(ctx.engine.model!, currentLayer(), name, newIds());
    if (writeLayers("draw.action.layer_add", arranged, arranged.keys[0] ?? null)) announce(t("draw.layer.added", { name }));
  }

  /// «Rinomina…»: il nome nuovo del livello corrente, mai vuoto.
  async function renameLayer(): Promise<void> {
    if (ctx.asking) return;
    const layer = layering();
    if (layer === null) return;
    ctx.asking = true;
    try {
      const answer = await promptForm({
        title: t("draw.layer.rename.dialog"),
        fields: [{ id: "name", label: t("draw.layer.name"), value: layer.name, kind: "text", required: true, maxLength: MAX_LAYER_NAME }],
      });
      if (answer === null || ctx.disposed || !editable()) return;
      const name = layerName(answer.name ?? "");
      // Mentre la finestra era aperta il disegno può essere cambiato: vale il
      // livello che ha ancora la stessa chiave.
      const now = currentIndex().layers.find((other) => keyOf(other) === keyOf(layer));
      if (name === "" || now === undefined) return;
      const arranged = renameLayerOps(ctx.engine.model!, now, name, newIds());
      if (writeLayers("draw.action.layer_rename", arranged, arranged.keys[0] ?? null)) {
        announce(t("draw.layer.renamed", { name: layerTitle({ ...now, name }) }));
      }
    } finally {
      ctx.asking = false;
    }
  }

  function hideLayer(hidden: boolean): void {
    const layer = layering();
    if (layer === null) return;
    const arranged = hideLayerOps(ctx.engine.model!, layer, hidden, newIds());
    if (writeLayers(hidden ? "draw.action.layer_hide" : "draw.action.layer_show", arranged, arranged.keys[0] ?? null)) {
      announce(t(hidden ? "draw.layer.hidden" : "draw.layer.shown", { name: layerTitle(layer) }));
    }
  }

  function lockLayer(locked: boolean): void {
    const layer = layering();
    if (layer === null) return;
    const arranged = lockLayerOps(ctx.engine.model!, layer, locked, newIds());
    if (writeLayers(locked ? "draw.action.layer_lock" : "draw.action.layer_unlock", arranged, arranged.keys[0] ?? null)) {
      announce(t(locked ? "draw.layer.locked" : "draw.layer.unlocked", { name: layerTitle(layer) }));
    }
  }

  /// Porta il livello corrente sopra quello che ha sopra, o sotto quello
  /// che ha sotto.
  function shiftLayer(shift: Shift): void {
    const layer = layering();
    if (layer === null) return;
    const layers = currentIndex().layers;
    const at = layers.findIndex((other) => other.path[0] === layer.path[0]);
    const other = layers[shift === "up" ? at + 1 : at - 1];
    const looked = keptLook(shiftLayerOps(ctx.engine.model!, layers, layer, shift, newIds()), { key: "draw.order.styled" });
    if (looked === null) return;
    if (writeLayers("draw.action.layer_order", looked, looked.keys[0] ?? null) && other !== undefined) {
      announce(`${t(shift === "up" ? "draw.layer.moved_up" : "draw.layer.moved_down", { name: layerTitle(layer), other: layerTitle(other) })}${looked.kept}`);
    }
  }

  /// Elimina il livello corrente con ciò che contiene; diventa corrente
  /// quello sotto, o quello sopra. L'unico livello, o uno bloccato, resta.
  function deleteLayer(): void {
    const layer = layering();
    if (layer === null) return;
    const layers = currentIndex().layers;
    if (layers.length < 2 || layer.locked) return;
    const at = layers.findIndex((other) => other.path[0] === layer.path[0]);
    const next = layers[at - 1] ?? layers[at + 1]!;
    // Dopo, il livello sopra ha un posto in meno.
    const nextAt = next.path[0]! > layer.path[0]! ? next.path[0]! - 1 : next.path[0]!;
    const count = outlineNow().byKey.get(keyOf(layer))?.children.length ?? 0;
    if (!writeLayers("draw.action.layer_delete", removeLayerOps(layer), next.id ?? `@${nextAt}`)) return;
    const name = layerTitle(layer);
    const gone = count === 0 ? t("draw.layer.deleted", { name }) : plural(count, "draw.layer.deleted.one", "draw.layer.deleted.other", { name });
    announce(`${gone} ${t("draw.layer.chosen", { name: layerTitle(next) })}`);
  }

  /// Il menu dei livelli: i livelli dalla cima, per scegliere quello
  /// corrente, e i comandi su quello corrente.
  const layerItems = (): MenuItem[] => {
    const layers = currentIndex().layers;
    const current = currentLayer();
    const items: MenuItem[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      const checked = current !== null && layer.path[0] === current.path[0];
      const state = layerState(layer);
      items.push({
        label: layerTitle(layer),
        choice: "radio",
        checked,
        selected: checked,
        ...(state === "" ? {} : { description: state }),
        run: () => chooseLayer(layer),
      });
    }
    items.push({ label: t("draw.layer.new"), separator: true, run: () => addLayer() });
    if (current === null) return items;
    const name = layerTitle(current, LAYER_IN_COMMAND);
    const lone = layers.length < 2;
    items.push(
      { label: t("draw.layer.rename", { name }), run: () => void renameLayer() },
      { label: t(current.hidden ? "draw.layer.show" : "draw.layer.hide", { name }), run: () => hideLayer(!current.hidden) },
      { label: t(current.locked ? "draw.layer.unlock" : "draw.layer.lock", { name }), run: () => lockLayer(!current.locked) },
      { label: t("draw.layer.up", { name }), disabled: !canShiftLayer(layers, current, "up"), run: () => shiftLayer("up") },
      { label: t("draw.layer.down", { name }), disabled: !canShiftLayer(layers, current, "down"), run: () => shiftLayer("down") },
      {
        label: t("draw.layer.delete", { name }),
        separator: true,
        danger: true,
        disabled: lone || current.locked,
        ...(lone ? { description: t("draw.layer.delete.last") } : current.locked ? { description: t("draw.layer.delete.locked") } : {}),
        run: () => deleteLayer(),
      },
    );
    return items;
  };
  ctx.layerItems = layerItems;

  // --- Griglia e pagina -------------------------------------------------------

  /// La griglia diventa `next` per scelta di chi disegna: si vede subito, si
  /// dice che cosa è cambiato, e chi monta l'editor lo sa.
  /// Vero se fra `a` e `b` cambia una scelta della penna o della gomma.
  const penChanged = (a: Grid, b: Grid): boolean =>
    a.eraser !== b.eraser || a.penId !== b.penId || a.barrel !== b.barrel || a.output !== b.output || a.fidelity !== b.fidelity;

  const changeGrid = (next: Grid): void => {
    const before = ctx.grid;
    ctx.grid = checkedGrid(next, before);
    suggestions.relabel();
    showGrid();
    showGuideLines();
    // I righelli, e la cornice che segnano.
    showHandles();
    const unit = docUnit();
    if (ctx.grid.shown !== before.shown) announce(t(ctx.grid.shown ? "draw.grid.shown" : "draw.grid.hidden"));
    else if (ctx.grid.snap !== before.snap) announce(t(ctx.grid.snap ? "draw.grid.snap.on" : "draw.grid.snap.off"));
    else if (!sameStep(gridStep(ctx.grid, unit), gridStep(before, unit))) announce(t("draw.grid.stepped", { step: lengthSpoken(stepNow()) }));
    else if (ctx.grid.guides !== before.guides) announce(t(ctx.grid.guides ? "draw.guides.on" : "draw.guides.off"));
    else if (ctx.grid.rulers !== before.rulers) announce(t(ctx.grid.rulers ? "draw.rulers.shown" : "draw.rulers.hidden"));
    else if (ctx.grid.rulerGuides !== before.rulerGuides) announce(t(ctx.grid.rulerGuides ? "draw.rulers.guides.shown" : "draw.rulers.guides.hidden"));
    else if (ctx.grid.shapes !== before.shapes) announce(t(ctx.grid.shapes ? "draw.recognize.on" : "draw.recognize.off"));
    else if (ctx.grid.bar !== before.bar) announce(t(ctx.grid.bar ? "draw.bar.beside.on" : "draw.bar.beside.off"));
    else if (ctx.grid.twist !== before.twist || ctx.grid.taps !== before.taps || !sameCurve(ctx.grid.pen, before.pen) || ctx.grid.steady?.amount !== before.steady?.amount || ctx.grid.steady?.string !== before.steady?.string) announce(t("draw.touch.changed"));
    // Il pannello aperto o chiuso, le sue sezioni, la gomma, la penna, il
    // tasto laterale e l'uscita si ricordano in silenzio: chi li cambia lo
    // dice da sé, o lo si vede.
    else if (ctx.grid.panel === before.panel && ctx.grid.closed.join("\n") === before.closed.join("\n") && !penChanged(ctx.grid, before)) return;
    syncProperties();
    options.onGridChange?.(ctx.grid);
  };
  ctx.changeGrid = changeGrid;

  /// L'unità del documento diventa `unit`: un passo di annulla, e il disegno
  /// resta com'è. I pixel non si scrivono, perché sono l'unità di serie.
  const setUnits = (unit: LengthUnit): void => {
    if (unit === docUnit() || !editable()) return;
    settleCrop();
    if (commit("draw.action.units", { op: "set", id: ROOT, attrs: { "fub:units": unit === "px" ? null : unit } }) === null) return;
    announce(t(UNITS_NOW[unit]));
  };

  /// Le unità del documento, una fra cinque.
  const unitItems = (): MenuItem[] =>
    UNITS.map((unit): MenuItem => ({
      label: t(UNIT_NAMES[unit]),
      choice: "radio",
      checked: unit === docUnit(),
      disabled: !editable(),
      run: () => setUnits(unit),
    }));

  /// Le voci di tutte le guide del documento: «Guide…», bloccarle o
  /// sbloccarle, eliminarle.
  const allGuidesItems = (): MenuItem[] => {
    const guides = ctx.scene.root.guides;
    const count = guides?.length ?? 0;
    const usable = editable() && count > 0;
    const allLocked = count > 0 && guides!.every((each) => each.locked);
    return [
      { label: t("draw.guides.dialog"), separator: true, disabled: !editable(), run: () => void editGuides(null) },
      { label: t(allLocked ? "draw.guides.unlock_all" : "draw.guides.lock_all"), disabled: !usable, run: () => lockAllGuides(!allLocked) },
      { label: t("draw.guides.delete_all"), danger: true, disabled: !usable, run: () => deleteAllGuides() },
    ];
  };

  /// Le voci di una guida, col tasto destro o col tocco lungo: bloccarla o
  /// sbloccarla, eliminarla, e quelle di tutte le guide.
  const guideItems = (index: number): MenuItem[] => {
    const guide = ctx.scene.root.guides?.[index];
    if (guide === undefined) return [];
    const canEdit = editable();
    const [dialog, ...rest] = allGuidesItems();
    return [
      { label: t(guide.locked ? "draw.guide.unlock" : "draw.guide.lock"), disabled: !canEdit, run: () => lockGuide(index, !guide.locked) },
      { label: t("draw.guide.delete"), danger: true, disabled: !canEdit, run: () => deleteGuide(index) },
      { ...dialog!, run: () => void editGuides(index) },
      ...rest,
    ];
  };
  ctx.guideItems = guideItems;

  /// Le voci dei righelli, dal loro angolo o col tasto destro: l'unità, le
  /// guide, e nasconderli. Sul foglio girato, dove i righelli aspettano,
  /// prima di tutto raddrizzarlo.
  const rulerItems = (): MenuItem[] => [
    ...(ctx.camera.angle === 0 ? [] : [{ label: t("draw.turn.straighten"), hint: "5", run: () => turnView(0) }]),
    ...unitItems().map((item, at) => (at === 0 && ctx.camera.angle !== 0 ? { ...item, separator: true } : item)),
    {
      label: t("draw.rulers.guides.show"),
      choice: "checkbox",
      checked: ctx.grid.rulerGuides,
      hint: "|",
      separator: true,
      run: () => changeGrid({ ...ctx.grid, rulerGuides: !ctx.grid.rulerGuides }),
    },
    ...allGuidesItems(),
    { label: t("draw.rulers.hide"), hint: displayBinding(RULERS_BINDING), separator: true, run: () => changeGrid({ ...ctx.grid, rulers: false }) },
  ];
  ctx.rulerItems = rulerItems;

  /// Ciò attorno a cui «Adatta la pagina al disegno» porta la pagina: tutto
  /// il disegno, livelli bloccati e nascosti compresi, e le tavole, che la
  /// pagina copre anche quando sono vuote.
  const fitExtent = (): Bounds | null => {
    if (ctx.engine.model === null) return null;
    let extent = union(indexer.extent(ctx.engine.model), effectsExtent(ctx.engine.model));
    for (const board of boardsNow()) extent = union(extent, board.box);
    return extent;
  };

  /// «Adatta la pagina al disegno»: la pagina va attorno a `fitExtent`, con
  /// un margine. È un passo di annulla, e gli oggetti restano dove sono.
  function fitPage(): void {
    if (!has("grid") || !editable()) return;
    cancelGesture();
    settleCrop();
    const extent = fitExtent();
    const viewBox = fittedPage(ctx.scene.root.page, extent);
    if (viewBox === null) {
      announce(t(extent === null ? "draw.page.fit.empty" : "draw.page.fit.already"));
      return;
    }
    if (commit("draw.action.fit_page", { op: "page", viewBox }) === null) return;
    const page = ctx.scene.root.page;
    if (page !== null) announce(t("draw.page.fitted", { width: lengthSpoken(page.width), height: lengthSpoken(page.height) }));
  }

  /// Le voci di «Pagina e griglia»: la griglia, il suo passo nell'unità del
  /// documento, le guide intelligenti, le forme dal tratto, i righelli con le
  /// loro guide e l'unità, dove sta la barra della selezione, la vista
  /// girata, e la pagina, ciascuna se il livello la offre. Adattare la
  /// pagina si spegne, e dice perché, quando non cambierebbe niente.
  const pageItems = (): MenuItem[] => {
    const unit = docUnit();
    const step = stepNow();
    const offered = unitSteps(unit);
    const steps = offered.some((each) => sameStep(each, step)) ? offered : [...offered, step].sort((a, b) => a - b);
    const extent = fitExtent();
    const viewBox = fittedPage(ctx.scene.root.page, extent);
    const fitItem: MenuItem = { label: t("draw.page.fit"), separator: true, disabled: !editable() || viewBox === null, run: () => fitPage() };
    if (extent === null) fitItem.description = t("draw.page.fit.empty");
    else if (viewBox === null) fitItem.description = t("draw.page.fit.already");
    const guidesItem: MenuItem = {
      label: t("draw.feature.guides"),
      choice: "checkbox",
      checked: ctx.grid.guides,
      separator: has("grid"),
      description: t("draw.guides.hint", { key: modifierName("Mod") ?? "Ctrl" }),
      run: () => changeGrid({ ...ctx.grid, guides: !ctx.grid.guides }),
    };
    const rulersItems: MenuItem[] = has("rulers")
      ? [
          {
            label: t("draw.rulers.show"),
            choice: "checkbox",
            checked: ctx.grid.rulers,
            hint: displayBinding(RULERS_BINDING),
            separator: true,
            run: () => changeGrid({ ...ctx.grid, rulers: !ctx.grid.rulers }),
          },
          {
            label: t("draw.rulers.guides.show"),
            choice: "checkbox",
            checked: ctx.grid.rulerGuides,
            hint: "|",
            description: t("draw.rulers.guides.hint"),
            run: () => changeGrid({ ...ctx.grid, rulerGuides: !ctx.grid.rulerGuides }),
          },
          { label: t("draw.guides.dialog"), disabled: !editable(), run: () => void editGuides(null) },
          {
            label: t("draw.units.item", { unit: t(UNIT_NAMES[unit]) }),
            description: t("draw.units.hint"),
            disabled: !editable(),
            run: () => openMenu(pageButton, unitItems()),
          },
        ]
      : [];
    // Accanto alle guide intelligenti: anche lei aiuta mentre si disegna.
    const recognizeItems: MenuItem[] = has("recognize")
      ? [
          {
            label: t("draw.feature.recognize"),
            choice: "checkbox",
            checked: ctx.grid.shapes,
            separator: has("grid") && !has("guides"),
            description: t("draw.recognize.hint"),
            run: () => changeGrid({ ...ctx.grid, shapes: !ctx.grid.shapes }),
          },
        ]
      : [];
    const barItems: MenuItem[] = BAR_FEATURES.some(has)
      ? [{ label: t("draw.bar.beside"), choice: "checkbox", checked: ctx.grid.bar, separator: true, run: () => changeGrid({ ...ctx.grid, bar: !ctx.grid.bar }) }]
      : [];
    const turnItems: MenuItem[] = has("gestures")
      ? [
          { label: t("draw.turn.left"), hint: "4", separator: true, run: () => turnView(nextTurn(ctx.camera.angle, -1)) },
          { label: t("draw.turn.right"), hint: "6", run: () => turnView(nextTurn(ctx.camera.angle, 1)) },
          { label: t("draw.turn.straighten"), hint: "5", disabled: ctx.camera.angle === 0, run: () => turnView(0) },
          { label: t("draw.touch.dialog"), run: () => void touchSettings() },
        ]
      : [];
    if (!has("grid")) return [...(has("guides") ? [guidesItem] : []), ...recognizeItems, ...rulersItems, ...barItems, ...turnItems];
    return [
      { label: t("draw.grid.show"), choice: "checkbox", checked: ctx.grid.shown, hint: "#", run: () => changeGrid({ ...ctx.grid, shown: !ctx.grid.shown }) },
      {
        label: t("draw.grid.snap"),
        choice: "checkbox",
        checked: ctx.grid.snap,
        hint: "%",
        description: t("draw.grid.snap.free", { key: modifierName("Mod") ?? "Ctrl" }),
        run: () => changeGrid({ ...ctx.grid, snap: !ctx.grid.snap }),
      },
      ...steps.map((each, at): MenuItem => ({
        label: t("draw.grid.step", { step: lengthText(each) }),
        choice: "radio",
        checked: sameStep(each, step),
        separator: at === 0,
        run: () => changeGrid(withStep(ctx.grid, unit, each)),
      })),
      ...(has("guides") ? [guidesItem] : []),
      ...recognizeItems,
      ...rulersItems,
      ...barItems,
      ...turnItems,
      fitItem,
    ];
  };
  ctx.pageItems = pageItems;
}
