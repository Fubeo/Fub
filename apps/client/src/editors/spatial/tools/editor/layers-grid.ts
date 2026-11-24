// L'editor del disegno: i livelli, la griglia e la pagina. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { modifierName } from "../../../../ui/commands";
import { promptForm } from "../../../../ui/form-dialog";
import type { MenuItem } from "../../../../ui/menu";
import { keyOf } from "../../describe";
import { sameCurve } from "../../../../ink/input/pressure";
import type { Bounds } from "../../scene/geometry";
import { plural, t, type DrawKey } from "../../strings";
import { fittedPage, gesture as asGesture } from "../edit";
import type { Arranged } from "../arrange";
import { gridStep, sameStep, unitSteps, withStep, type Grid } from "../grid";
import { nextTurn } from "../../view";
import type { LayerInfo } from "../hit";
import {
  addLayerOps,
  canShiftLayer,
  freshLayerName,
  hideLayerOps,
  layerName,
  inLayer,
  intoLayerOps,
  lockLayerOps,
  MAX_LAYER_NAME,
  removeLayerOps,
  renameLayerOps,
  shiftLayerOps,
  type Shift,
} from "../layers";
import { BAR_FEATURES } from "./constants";
import type { EditorContext } from "./context";
import { checkedGrid, layerRefusal, layerState, layerTitle, union } from "./helpers";
import type { Op } from "../../scene/ops";
import type { PortaLivelli, RichiestaLivello } from "../../completo/livelli-porta";

/// Quanti caratteri del nome di un livello entrano nel nome di un comando:
/// il resto, come «su» e «giù», deve restare in vista.
const LAYER_IN_COMMAND = 24;

/// Un comando di livello del pannello o del menu dei livelli, che `layerWrite` scrive: dal motore
/// del Completo quando è acceso (K6 T15, giro 4), se no con le operazioni native.
export interface LayerWrite {
  /// Il nome del passo nella cronologia.
  readonly label: DrawKey;
  /// Il comando per il motore del Completo.
  readonly request: RichiestaLivello;
  /// Le operazioni native e il livello corrente dopo, calcolate quando si scrivono; assenti per un
  /// comando che fa solo il motore del Completo (Duplica, Appiattisci), che senza motore non parte.
  readonly native?: () => { readonly arranged: Arranged; readonly key: string | null };
  /// Il livello corrente dopo l'esito del motore, dalle sue operazioni; `null` lo lascia com'è.
  readonly engineKey: (ops: readonly Op[]) => string | null;
  /// Ciò che si dice a comando scritto.
  readonly said: () => string;
}

/// Ciò che i livelli, la griglia e la pagina dà agli altri pezzi dell'editor.
export interface LayersGridContext {
  writeLayers: (label: DrawKey, arranged: Arranged, key: string | null) => boolean;
  /// I comandi di livello che passano dal motore del Completo aperto e acceso (K6 T15, giro 4,
  /// `completo/livelli-porta.ts`); `null`, o assente, nel Semplice e senza motore.
  livelliMotore?: () => PortaLivelli | null;
  /// Scrive un comando di livello: dal motore del Completo se è acceso, se no da sé.
  layerWrite: (write: LayerWrite) => void;
  /// Perché `layer` non si rinomina: nel Completo del motore un livello bloccato non cambia
  /// nome (la regola della famiglia `livelli`). `null` se si rinomina; nel Semplice sempre.
  layerFrozen: (layer: LayerInfo) => DrawKey | null;
  /// Il comando che rinomina `layer` in `name` (già pulito e diverso); con `current` il livello
  /// diventa quello corrente.
  layerRename: (layer: LayerInfo, name: string, current: boolean) => LayerWrite;
  /// Il comando che nasconde o mostra, blocca o sblocca `layer`; con `current` il livello diventa
  /// quello corrente.
  layerFlag: (layer: LayerInfo, flag: "hidden" | "locked", on: boolean, current: boolean) => LayerWrite;
  layerItems: () => MenuItem[];
  /// Un clic sulla riga di un livello nell'albero (Imposta livello corrente di VectorCraft): il
  /// livello di chiave `key` diventa quello corrente, e lo si annuncia.
  chooseLayerKey: (key: string) => void;
  intoItems: () => MenuItem[];
  changeGrid: (next: Grid) => void;
  pageItems: () => MenuItem[];
}

/// Monta i livelli, la griglia e la pagina.
export function installLayersGrid(ctx: EditorContext): void {
  const {
    has, suggestions, indexer, boardsNow, editable, currentIndex, newIds, announce, showGrid, docUnit, stepNow, lengthText, lengthSpoken,
    turnView, outlineNow, syncProperties, currentLayer, choose, syncLayers, commit, cancelGesture, touchSettings, effectsExtent, keptLook, selectedUnits, followSelection, arranging, arrange, options
  } = ctx;
  // --- Livelli -----------------------------------------------------------------

  /// Il livello su cui lavora un comando dei livelli: quello corrente, se
  /// l'interfaccia offre i livelli e il disegno si scrive.
  const layering = (): LayerInfo | null => {
    if (!has("layers") || !editable()) return null;
    cancelGesture();
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

  /// Il livello che le operazioni di un livello nuovo aggiungono: il suo id.
  const addedLayer = (ops: readonly Op[]): string | null => {
    for (const op of ops) {
      if (op.op === "batch") {
        const inner = addedLayer(op.ops);
        if (inner !== null) return inner;
      } else if (op.op === "add" && "elem" in op && op.elem.attrs["fub:layer"] !== undefined) {
        return op.elem.attrs.id ?? null;
      }
    }
    return null;
  };

  const layerWrite = (write: LayerWrite): void => {
    const nativeNow = (): void => {
      if (write.native === undefined) {
        announce(t("draw.livelli.senzaMotore"));
        return;
      }
      const made = write.native();
      if (writeLayers(write.label, made.arranged, made.key)) announce(write.said());
    };
    const porta = ctx.livelliMotore?.() ?? null;
    if (porta === null) {
      nativeNow();
      return;
    }
    const engine = ctx.engine;
    const text = engine.normalized;
    void porta.comando(write.request).then((esito) => {
      if (ctx.disposed || !editable()) return;
      // Mentre il motore rispondeva il disegno è cambiato: l'esito parla del disegno di prima.
      if (ctx.engine !== engine || engine.normalized !== text) {
        announce(t("draw.livelli.cambiato"));
        return;
      }
      switch (esito.kind) {
        case "nativo":
          nativeNow();
          return;
        case "rifiuto":
          announce(esito.motivo === null ? t("draw.unchanged") : t("draw.rejected", { reason: t(esito.motivo) }));
          return;
        case "fallito":
          announce(t("draw.completo.key.failed"));
          return;
        case "argomenti":
          announce(esito.frase);
          return;
        case "fatto":
          if (writeLayers(write.label, { ops: esito.ops, keys: [] }, write.engineKey(esito.ops))) announce(write.said());
      }
    });
  };
  ctx.layerWrite = layerWrite;

  const layerFrozen = (layer: LayerInfo): DrawKey | null =>
    layer.locked && (ctx.livelliMotore?.() ?? null) !== null ? "draw.livelli.bloccato" : null;
  ctx.layerFrozen = layerFrozen;

  /// Rinomina `layer` in `name`, già pulito e diverso; con `current` resta il livello corrente.
  function renameWrite(layer: LayerInfo, name: string, current: boolean): LayerWrite {
    return {
      label: "draw.action.layer_rename",
      request: { kind: "proprieta", livello: layer.id ?? "", nome: name },
      native: () => {
        const arranged = renameLayerOps(ctx.engine.model!, layer, name, newIds());
        return { arranged, key: current ? (arranged.keys[0] ?? null) : null };
      },
      engineKey: () => (current ? layer.id : null),
      said: () => t("draw.layer.renamed", { name: layerTitle({ ...layer, name }) }),
    };
  }
  ctx.layerRename = renameWrite;

  /// Nasconde o mostra, blocca o sblocca `layer`; con `current` resta il livello corrente.
  function flagWrite(layer: LayerInfo, flag: "hidden" | "locked", on: boolean, current: boolean): LayerWrite {
    const locking = flag === "locked";
    return {
      label: locking ? (on ? "draw.action.layer_lock" : "draw.action.layer_unlock") : on ? "draw.action.layer_hide" : "draw.action.layer_show",
      request: locking
        ? { kind: "proprieta", livello: layer.id ?? "", bloccato: on }
        : { kind: "proprieta", livello: layer.id ?? "", visibile: !on },
      native: () => {
        const model = ctx.engine.model!;
        const arranged = locking ? lockLayerOps(model, layer, on, newIds()) : hideLayerOps(model, layer, on, newIds());
        return { arranged, key: current ? (arranged.keys[0] ?? null) : null };
      },
      engineKey: () => (current ? layer.id : null),
      said: () =>
        t(locking ? (on ? "draw.layer.locked" : "draw.layer.unlocked") : on ? "draw.layer.hidden" : "draw.layer.shown", { name: layerTitle(layer) }),
    };
  }
  ctx.layerFlag = flagWrite;

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
    const name = freshLayerName(currentIndex().layers, (n) => t("draw.layer.default", { n }));
    layerWrite({
      label: "draw.action.layer_add",
      request: { kind: "nuovo", nome: name },
      native: () => {
        const arranged = addLayerOps(ctx.engine.model!, currentLayer(), name, newIds());
        return { arranged, key: arranged.keys[0] ?? null };
      },
      engineKey: addedLayer,
      said: () => t("draw.layer.added", { name }),
    });
  }

  /// «Rinomina…»: il nome nuovo del livello corrente, mai vuoto.
  async function renameLayer(): Promise<void> {
    if (ctx.asking) return;
    const layer = layering();
    if (layer === null) return;
    const frozen = layerFrozen(layer);
    if (frozen !== null) {
      announce(t(frozen));
      return;
    }
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
      if (name === now.name) {
        announce(t("draw.unchanged"));
        return;
      }
      layerWrite(renameWrite(now, name, true));
    } finally {
      ctx.asking = false;
    }
  }

  function hideLayer(hidden: boolean): void {
    const layer = layering();
    if (layer !== null) layerWrite(flagWrite(layer, "hidden", hidden, true));
  }

  function lockLayer(locked: boolean): void {
    const layer = layering();
    if (layer !== null) layerWrite(flagWrite(layer, "locked", locked, true));
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
    const key = next.id ?? `@${nextAt}`;
    const name = layerTitle(layer);
    const gone = count === 0 ? t("draw.layer.deleted", { name }) : plural(count, "draw.layer.deleted.one", "draw.layer.deleted.other", { name });
    layerWrite({
      label: "draw.action.layer_delete",
      request: { kind: "elimina", livello: layer.id ?? "" },
      native: () => ({ arranged: removeLayerOps(layer), key }),
      engineKey: () => key,
      said: () => `${gone} ${t("draw.layer.chosen", { name: layerTitle(next) })}`,
    });
  }

  /// Duplica il livello corrente (solo col motore del Completo): la copia va subito sopra, col
  /// nome «… copia», e diventa il livello corrente. Anche un livello bloccato si copia.
  function duplicateLayer(): void {
    const layer = layering();
    if (layer === null || !editable()) return;
    cancelGesture();
    const name = layerTitle(layer);
    layerWrite({
      label: "draw.livelli.azione.duplica",
      request: { kind: "duplica", livello: layer.id ?? "" },
      engineKey: addedLayer,
      said: () => t("draw.livelli.duplicato", { name }),
    });
  }

  /// Appiattisci grafica (solo col motore del Completo): tutto il disegno nel livello corrente, i
  /// livelli nascosti si scartano, come in VectorCraft. Il livello corrente resta lui.
  function flattenLayer(): void {
    const layer = layering();
    if (layer === null || !editable() || layer.hidden) return;
    cancelGesture();
    const name = layerTitle(layer);
    layerWrite({
      label: "draw.livelli.azione.appiattisci",
      request: { kind: "appiattisci", livello: layer.id ?? "" },
      engineKey: () => layer.id,
      said: () => t("draw.livelli.appiattito", { name }),
    });
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
    const frozen = layerFrozen(current);
    items.push(
      {
        label: t("draw.layer.rename", { name }),
        ...(frozen === null ? {} : { disabled: true, description: t(frozen) }),
        run: () => void renameLayer(),
      },
      { label: t(current.hidden ? "draw.layer.show" : "draw.layer.hide", { name }), run: () => hideLayer(!current.hidden) },
      { label: t(current.locked ? "draw.layer.unlock" : "draw.layer.lock", { name }), run: () => lockLayer(!current.locked) },
      { label: t("draw.layer.up", { name }), disabled: !canShiftLayer(layers, current, "up"), run: () => shiftLayer("up") },
      { label: t("draw.layer.down", { name }), disabled: !canShiftLayer(layers, current, "down"), run: () => shiftLayer("down") },
    );
    // Duplica e Appiattisci li fa solo il motore del Completo.
    if ((ctx.livelliMotore?.() ?? null) !== null) {
      const hiddenOthers = layers.some((other) => other.hidden && other.path[0] !== current.path[0]);
      items.push(
        { label: t("draw.livelli.duplica", { name }), run: () => duplicateLayer() },
        {
          label: t("draw.livelli.appiattisci", { name }),
          disabled: lone || current.hidden,
          ...(lone
            ? { description: t("draw.layer.delete.last") }
            : current.hidden
              ? { description: t("draw.livelli.appiattisci.nascosto") }
              : hiddenOthers
                ? { description: t("draw.livelli.appiattisci.scarta") }
                : {}),
          run: () => flattenLayer(),
        },
      );
    }
    // Individua oggetto, come nel pannello Livelli di VectorCraft: apre l'albero sulla riga
    // dell'ultimo oggetto scelto, aprendo i livelli e i gruppi che lo contengono. È solo vista.
    const scelto = ctx.selection[ctx.selection.length - 1];
    items.push({
      label: t("draw.livelli.individua"),
      separator: true,
      disabled: scelto === undefined,
      ...(scelto === undefined ? { description: t("draw.livelli.individua.niente") } : {}),
      run: () => {
        if (scelto === undefined) return;
        ctx.showObjects(true, false);
        ctx.tree.locate(scelto);
      },
    });
    items.push(
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
  ctx.chooseLayerKey = (key) => {
    const layer = currentIndex().layers.find((each) => keyOf(each) === key);
    if (layer !== undefined) chooseLayer(layer);
  };

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
    const unit = docUnit();
    if (ctx.grid.shown !== before.shown) announce(t(ctx.grid.shown ? "draw.grid.shown" : "draw.grid.hidden"));
    else if (ctx.grid.snap !== before.snap) announce(t(ctx.grid.snap ? "draw.grid.snap.on" : "draw.grid.snap.off"));
    else if (ctx.grid.snapPixel !== before.snapPixel) announce(t(ctx.grid.snapPixel ? "draw.grid.pixel.on" : "draw.grid.pixel.off"));
    else if (ctx.grid.smartGuidesOff !== before.smartGuidesOff) announce(t(ctx.grid.smartGuidesOff ? "draw.view.smartGuides.off" : "draw.view.smartGuides.on"));
    else if (ctx.grid.snapPointOff !== before.snapPointOff) announce(t(ctx.grid.snapPointOff ? "draw.view.snapPoint.off" : "draw.view.snapPoint.on"));
    else if (ctx.grid.snapGlyph !== before.snapGlyph) announce(t(ctx.grid.snapGlyph ? "draw.view.snapGlyph.on" : "draw.view.snapGlyph.off"));
    else if (!sameStep(gridStep(ctx.grid, unit), gridStep(before, unit))) announce(t("draw.grid.stepped", { step: lengthSpoken(stepNow()) }));
    else if (ctx.grid.shapes !== before.shapes) announce(t(ctx.grid.shapes ? "draw.recognize.on" : "draw.recognize.off"));
    else if (ctx.grid.bar !== before.bar) announce(t(ctx.grid.bar ? "draw.bar.beside.on" : "draw.bar.beside.off"));
    else if (ctx.grid.twist !== before.twist || ctx.grid.taps !== before.taps || !sameCurve(ctx.grid.pen, before.pen) || ctx.grid.steady?.amount !== before.steady?.amount || ctx.grid.steady?.string !== before.steady?.string) announce(t("draw.touch.changed"));
    else if (ctx.grid.transparencyGrid !== before.transparencyGrid) announce(t(ctx.grid.transparencyGrid ? "draw.view.transparency.on" : "draw.view.transparency.off"));
    else if (ctx.grid.hideEdges !== before.hideEdges) announce(t(ctx.grid.hideEdges ? "draw.view.edges.hidden" : "draw.view.edges.shown"));
    else if (ctx.grid.hideBoundingBox !== before.hideBoundingBox) announce(t(ctx.grid.hideBoundingBox ? "draw.view.boundingBox.hidden" : "draw.view.boundingBox.shown"));
    else if (ctx.grid.hideArtboards !== before.hideArtboards) announce(t(ctx.grid.hideArtboards ? "draw.view.artboards.hidden" : "draw.view.artboards.shown"));
    else if (ctx.grid.livePaintGaps !== before.livePaintGaps) announce(t(ctx.grid.livePaintGaps ? "draw.view.livePaintGaps.shown" : "draw.view.livePaintGaps.hidden"));
    // Il pannello aperto o chiuso, le sue sezioni, la gomma, la penna, il
    // tasto laterale e l'uscita si ricordano in silenzio: chi li cambia lo
    // dice da sé, o lo si vede.
    else if (ctx.grid.panel === before.panel && ctx.grid.closed.join("\n") === before.closed.join("\n") && !penChanged(ctx.grid, before)) return;
    // Bordi, riquadro e spazi vuoti sono segni sul foglio, che si rifanno con la selezione.
    if (ctx.grid.hideEdges !== before.hideEdges || ctx.grid.hideBoundingBox !== before.hideBoundingBox || ctx.grid.livePaintGaps !== before.livePaintGaps) ctx.showHandles();
    syncProperties();
    options.onGridChange?.(ctx.grid);
  };
  ctx.changeGrid = changeGrid;

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
  /// documento, le forme dal tratto, dove sta la barra della selezione, la vista
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
    // Accanto alla griglia: anche lei aiuta mentre si disegna.
    const recognizeItems: MenuItem[] = has("recognize")
      ? [
          {
            label: t("draw.feature.recognize"),
            choice: "checkbox",
            checked: ctx.grid.shapes,
            separator: has("grid"),
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
    if (!has("grid")) return [...recognizeItems, ...barItems, ...turnItems];
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
      ...recognizeItems,
      ...barItems,
      ...turnItems,
      fitItem,
    ];
  };
  ctx.pageItems = pageItems;

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
