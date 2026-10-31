// L'editor del disegno: la barra accanto alla selezione, il livello corrente e
// lo stato dei controlli. Un pezzo di createDrawEditor (`../editor.ts`): lavora
// sul contesto che i pezzi condividono.

import { DURATION, animate } from "../../../../moto";
import { keyOf } from "../../describe";
import { elementChildren } from "../../scene/model";
import { t } from "../../strings";
import { HANDLE_REACH_PX, LABEL_ROOM_PX } from "../../painter/overlay";
import { holdsLinks, isGroup, isLink, linkTarget, nodeOf } from "../arrange";
import { barSpot, type ScreenBox } from "../bar";
import { typedOpacity } from "../fields";
import { opacityOf } from "../look";
import { FRAME_PX } from "../frame";
import { screenBox } from "../../view";
import type { LayerInfo } from "../hit";
import { inLayer } from "../layers";
import { ARRANGE_SHOWN, BAR_FEATURES } from "./constants";
import type { EditorContext } from "./context";
import { layerState, layerTitle, union } from "./helpers";

/// I caratteri di un nome XML dopo il primo: dove uno di loro segue `#id`,
/// il testo cita un altro id.
const NAME_CHAR = /[\p{L}\p{M}\p{N}_.:-]/u;

/// Vero se `text` cita l'id `id`: un `url(#id)`, un `href="#id"`, un
/// selettore `#id` di un foglio di stile.
function cites(text: string, id: string): boolean {
  const needle = `#${id}`;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const next = String.fromCodePoint(text.codePointAt(at + needle.length) ?? 0x20);
    if (!NAME_CHAR.test(next)) return true;
  }
  return false;
}

/// Ciò che la barra accanto alla selezione, il livello corrente e lo stato dei controlli dà agli altri pezzi dell'editor.
export interface ControlsContext {
  oneRound: <T>(run: () => T) => T;
  placeBar: () => void;
  cited: (id: string) => boolean;
  currentLayer: () => LayerInfo | null;
  choose: (layer: LayerInfo) => void;
  followSelection: () => void;
  layersLabel: () => string;
  syncLayers: () => void;
  rootText: (role: "title" | "desc") => string;
  currentTitle: () => string;
  syncControls: () => void;
  refresh: () => void;
}

/// Monta la barra accanto alla selezione, il livello corrente e lo stato dei controlli.
export function installControls(ctx: EditorContext): void {
  const {
    life, has, relabels, drawingFonts, style, widthsNow, root, surface, insertGroup, imageButton,
    widthButtons, showWidthLabels, undoButton, redoButton, deleteButton, selectionButton,
    propertiesButton, layerGroup, layersButton, layerText, layerStateText, historyPanel, accessPanel, panel, pageButton, historyButton, accessButton, titleInput, arrangeBar, nameArrange,
    arrangeButtons, arrangeMore, duplicateButton, groupButton, ungroupButton, linkText, openLinkText, linkButton, openLinkButton, unlinkButton, orderButton,
    intoButton, alignButton, shapeButton, opacityField, opacityInput, linkLayer, painter, builder, paintSource, chosenSheet, editable, isolatedNode, isolationChain, currentIndex, announce, showPage,
    readFirst, showGrid, viewArea, selectedUnits, inOrder, frameNow, showHandles, outlineNow,
    syncTree, showHistory, syncHistory, showAccess, syncAccess, syncDescriptions, showPanel, syncProperties, changeField, options
  } = ctx;
  // --- La barra accanto alla selezione ---------------------------------------

  /// Le misure della barra della selezione, finché non cambiano i suoi
  /// pulsanti o la lingua: leggerle costa un layout.
  let barSize: { readonly signature: string; readonly w: number; readonly h: number } | null = null;
  relabels.push(() => {
    barSize = null;
  });

  /// Il riquadro sullo schermo della selezione con la cornice e le maniglie,
  /// che la barra non copre.
  const selectionBox = (): ScreenBox | null => {
    let band = ctx.selectionBand;
    const view = frameNow();
    if (view !== null) for (const { at } of view.spots) band = union(band, { min: at, max: at });
    if (band === null) return null;
    const box = screenBox(ctx.camera, band);
    const pad = FRAME_PX + HANDLE_REACH_PX;
    // Sotto la cornice ferma ci sono le sue misure: la barra va più in giù.
    const below = view !== null && ctx.current === null ? LABEL_ROOM_PX : 0;
    return {
      x: box.min[0] - pad,
      y: box.min[1] - pad,
      w: box.max[0] - box.min[0] + 2 * pad,
      h: box.max[1] - box.min[1] + 2 * pad + below,
    };
  };

  /// Quanti giri di `holdingBar` sono aperti, e se la barra è stata chiesta
  /// mentre duravano.
  let barHeld = 0;
  let barDue = false;

  /// Esegue `run` mettendo la barra a posto una volta sola, alla fine: chi
  /// la chiede prima, con la selezione e le cornici a metà strada, la
  /// metterebbe dove non resta.
  const holdingBar = <T,>(run: () => T): T => {
    barHeld++;
    try {
      return run();
    } finally {
      if (--barHeld === 0 && barDue) {
        barDue = false;
        placeBar();
      }
    }
  };

  /// Un giro solo per `run`: la misura del foglio si legge una volta prima di
  /// scrivere, e la barra si mette una volta a cose fatte (con la misura già
  /// letta, perciò il giro della misura è quello di fuori). È ciò che serve a
  /// un passo che cambia scelta, cornici e controlli insieme.
  const oneRound = <T,>(run: () => T): T => readFirst(() => holdingBar(run));
  ctx.oneRound = oneRound;

  /// La barra della selezione accanto alla selezione, se chi disegna la
  /// vuole lì (`bar.ts`): sotto la cornice, o sopra se sotto non c'è posto.
  /// Durante un gesto o uno zoom non si vede, perché non copra ciò che si
  /// muove.
  function placeBar(): void {
    if (barHeld > 0) {
      barDue = true;
      return;
    }
    const beside = ctx.grid.bar && !arrangeBar.hidden;
    arrangeBar.toggleAttribute("data-beside", beside);
    arrangeBar.toggleAttribute("data-gesture", beside && (ctx.current !== null || ctx.pressed !== null || ctx.zooming));
    if (!beside) {
      arrangeBar.style.removeProperty("transform");
      return;
    }
    const signature = [...arrangeButtons, opacityField].map((control) => (control.hidden || control.hasAttribute("data-more") ? "0" : "1")).join("");
    if (barSize === null || barSize.signature !== signature || barSize.w === 0) {
      barSize = { signature, w: arrangeBar.offsetWidth, h: arrangeBar.offsetHeight };
    }
    const spot = barSpot(selectionBox(), barSize, viewArea());
    arrangeBar.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
  }
  ctx.placeBar = placeBar;

  /// Vero se una parte estranea del disegno cita `id`: cambiarlo romperebbe
  /// il riferimento. Le parti che FubDraw scrive non citano niente.
  const cited = (id: string): boolean => {
    const model = ctx.engine.model;
    if (model === null) return false;
    if (cites(model.root.head, id)) return true;
    const text = ctx.engine.text;
    return ctx.engine.scene().some((item) => item.kind === "foreign" && cites(text.slice(item.utf16[0], item.utf16[1]), id));
  };
  ctx.cited = cited;

  // --- Il livello corrente ---------------------------------------------------

  /// Il livello scelto, se c'è ancora: per chiave; o allo stesso posto, se ha
  /// perso l'id con annulla o se non l'aveva e l'ha ricevuto; o, se se n'è
  /// andato, quello che gli stava sotto, o il più basso.
  const chosenIn = (layers: readonly LayerInfo[]): LayerInfo | null => {
    if (ctx.chosen === null) return null;
    const { key, at } = ctx.chosen;
    const same = layers.find((layer) => keyOf(layer) === key)
      ?? layers.find((layer) => layer.path[0] === at && (layer.id === null || key.startsWith("@")));
    if (same !== undefined) return same;
    let below: LayerInfo | null = null;
    for (const layer of layers) if (layer.path[0]! < at) below = layer;
    return below ?? layers[0] ?? null;
  };

  /// Il livello in cui si disegna, quando l'interfaccia offre i livelli:
  /// quello scelto; se
  /// nessuno l'ha scelto, il più alto che si vede e non è bloccato, o il più
  /// alto. `null` se il disegno non ha livelli.
  function currentLayer(): LayerInfo | null {
    const layers = currentIndex().layers;
    const found = chosenIn(layers);
    if (found !== null) return found;
    for (let i = layers.length - 1; i >= 0; i--) if (!layers[i]!.locked && !layers[i]!.hidden) return layers[i]!;
    return layers[layers.length - 1] ?? null;
  }
  ctx.currentLayer = currentLayer;

  /// `layer` diventa il livello corrente.
  const choose = (layer: LayerInfo): void => {
    ctx.chosen = { key: keyOf(layer), at: layer.path[0]! };
    syncLayers();
  };
  ctx.choose = choose;

  /// Quando l'interfaccia offre i livelli, il livello corrente segue la
  /// selezione: diventa quello degli oggetti scelti, se stanno tutti in uno.
  function followSelection(): void {
    if (!has("layers") || ctx.selection.length === 0) return;
    const units = selectedUnits();
    const at = units[0]?.path[0];
    if (at === undefined || units.some((unit) => unit.path.length < 2 || unit.path[0] !== at)) return;
    const layer = currentIndex().layers.find((other) => other.path[0] === at);
    if (layer !== undefined) choose(layer);
  }
  ctx.followSelection = followSelection;

  /// Il nome del pulsante dei livelli: dove si disegna e, a parole, lo stato
  /// di quel livello.
  function layersLabel(): string {
    const layer = currentLayer();
    if (layer === null) return t("draw.layers.none");
    const label = t("draw.layers.current", { name: layerTitle(layer) });
    const state = layerState(layer);
    return state === "" ? label : `${label}, ${state}`;
  }
  ctx.layersLabel = layersLabel;

  /// Il pulsante dei livelli c'è quando l'interfaccia li offre, e mostra il
  /// nome del livello corrente e il suo stato; l'albero dice qual è.
  function syncLayers(): void {
    layerGroup.hidden = !has("layers");
    layersButton.disabled = !editable();
    if (!layerGroup.hidden) {
      const layer = currentLayer();
      const name = layer === null ? t("draw.layers.none.short") : layerTitle(layer);
      const state = layer === null ? "" : layerState(layer);
      if (layerText.textContent !== name) layerText.textContent = name;
      if (layerStateText.textContent !== state) layerStateText.textContent = state;
      layerStateText.hidden = state === "";
      const label = layersLabel();
      if (layersButton.getAttribute("aria-label") !== label) {
        layersButton.setAttribute("aria-label", label);
        layersButton.title = label;
      }
    }
    syncTree();
  }
  ctx.syncLayers = syncLayers;

  // --- Stato dei controlli --------------------------------------------------

  /// Il `title` o la `desc` del disegno: i figli della radice con quel ruolo.
  const rootText = (role: "title" | "desc"): string => {
    const model = ctx.engine.model;
    if (model === null) return "";
    for (const child of elementChildren(model.root)) {
      if (child.kind === "leaf" && child.details?.role === role) return child.details.text ?? "";
    }
    return "";
  };
  ctx.rootText = rootText;
  const currentTitle = (): string => rootText("title");
  ctx.currentTitle = currentTitle;



  // --- Il campo dell'opacità della barra --------------------------------------

  /// Mostra nel campo l'opacità `opacity` degli oggetti scelti.
  const showOpacity = (opacity: { readonly value: number | null }): void => {
    const percent = opacity.value === null ? null : Math.round(opacity.value * 100);
    const text = percent === null ? "" : String(percent);
    const keys = ctx.selection.join("\n");
    const focused = document.activeElement === opacityInput;
    const draft = focused && ctx.opacityShown !== null && ctx.opacityShown.keys === keys && opacityInput.value !== ctx.opacityShown.text;
    ctx.opacityShown = { percent, text, keys };
    opacityInput.placeholder = percent === null ? t("draw.properties.mixed") : "";
    if (percent === null) opacityInput.removeAttribute("aria-valuenow");
    else opacityInput.setAttribute("aria-valuenow", String(percent));
    opacityInput.setAttribute("aria-valuetext", percent === null ? t("draw.properties.mixed") : t("draw.opacity.value", { value: percent }));
    if (draft) return;
    opacityInput.value = text;
    if (focused) opacityInput.select();
  };

  /// Riporta il campo a ciò che mostra il disegno.
  const revertOpacity = (): void => {
    if (ctx.opacityShown === null) return;
    opacityInput.value = ctx.opacityShown.text;
    if (document.activeElement === opacityInput) opacityInput.select();
  };

  /// Dà `percent` all'opacità degli oggetti scelti, come il campo del
  /// pannello: un passo di annulla, «Opacità», che si unisce a quelli di
  /// seguito.
  const giveOpacity = (percent: number): void => {
    const failure = changeField("opacity", percent);
    if (failure !== null) announce(failure);
    revertOpacity();
  };

  /// L'opacità da cui parte un passo: il numero scritto nel campo, se c'è,
  /// o quella degli oggetti scelti. Un testo dice perché ciò che è scritto
  /// non si legge; `null` se gli oggetti hanno valori diversi e niente è
  /// scritto.
  const opacityBase = (): number | string | null => {
    const shown = ctx.opacityShown;
    if (shown === null) return null;
    if (opacityInput.value !== shown.text && opacityInput.value.trim() !== "") return typedOpacity(opacityInput.value, shown.percent);
    return shown.percent;
  };

  /// Cambia l'opacità di `delta` punti, fra 0 e 100.
  const stepOpacity = (delta: number): void => {
    const shown = ctx.opacityShown;
    const base = opacityBase();
    if (shown === null) return;
    if (typeof base === "string") {
      announce(base);
      revertOpacity();
      return;
    }
    if (base === null) {
      announce(t("draw.properties.problem.mixed"));
      return;
    }
    const value = Math.min(100, Math.max(0, base + delta));
    if (value === shown.percent) revertOpacity();
    else giveOpacity(value);
  };

  /// Scrive il numero che c'è nel campo, se è cambiato; se non si legge lo
  /// dice, e il campo torna a ciò che mostra il disegno.
  const commitOpacity = (): void => {
    const shown = ctx.opacityShown;
    if (shown === null || opacityField.hidden || arrangeBar.hidden || opacityInput.value === shown.text) return;
    const typed = typedOpacity(opacityInput.value, shown.percent);
    if (typeof typed === "string") {
      announce(typed);
      revertOpacity();
    } else if (typed === shown.percent) {
      revertOpacity();
    } else {
      giveOpacity(typed);
    }
  };

  const OPACITY_STEPS: ReadonlyMap<string, number> = new Map([["ArrowUp", 1], ["ArrowDown", -1], ["PageUp", 10], ["PageDown", -10]]);
  life.listen(opacityInput, "keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || ctx.opacityShown === null) return;
    const step = OPACITY_STEPS.get(event.key);
    if (event.key === "Enter") {
      commitOpacity();
    } else if (event.key === "Escape") {
      // Con un numero scritto, Esc lo toglie; poi torna al foglio, come in
      // ogni barra.
      if (opacityInput.value === ctx.opacityShown.text) return;
      revertOpacity();
    } else if (event.key === "Home" || event.key === "End") {
      const to = event.key === "Home" ? 0 : 100;
      if (to === ctx.opacityShown.percent) revertOpacity();
      else giveOpacity(to);
    } else if (step !== undefined) {
      stepOpacity(event.shiftKey && event.key.startsWith("Arrow") ? step * 10 : step);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  life.listen(opacityInput, "focus", () => opacityInput.select());
  life.listen(opacityInput, "focusout", () => commitOpacity());

  /// La barra della selezione: c'è con qualcosa di scelto e il disegno che
  /// si scrive, e non mentre si scrive un testo, se il livello ha un suo
  /// pulsante. Ha i pulsanti delle parti che il livello offre. Un pulsante che non serve si spegne; se aveva il fuoco, il fuoco
  /// passa a quello che prende il Tab, o al foglio quando la barra se ne va.
  const syncArrange = (): void => {
    const focused = arrangeBar.contains(document.activeElement);
    const units = BAR_FEATURES.some(has) && editable() && ctx.selection.length > 0 ? selectedUnits() : [];
    deleteButton.setAttribute("aria-keyshortcuts", "Delete");
    for (const control of [duplicateButton, groupButton, ungroupButton, orderButton, alignButton]) control.hidden = !has("arrange");
    groupButton.disabled = units.length < 2;
    ungroupButton.disabled = !units.some(isGroup);
    // Un collegamento non ne contiene un altro: attorno a uno che c'è non se
    // ne crea un secondo, ma quello scelto da solo si cambia.
    const single = units.length === 1 && isLink(units[0]!) ? units[0]! : null;
    ctx.shownLink = single === null ? null : { target: linkTarget(nodeOf(ctx.engine.model!, single)) };
    linkButton.hidden = !has("links") || options.links === undefined;
    // Cercare i collegamenti fra gli oggetti scelti costa: se il pulsante non
    // c'è, non serve sapere se si spegne.
    linkButton.disabled = !linkButton.hidden && ctx.shownLink === null && units.length > 0 && holdsLinks(ctx.engine.model!, units);
    nameArrange(linkButton, linkText(), "Mod-k");
    openLinkButton.hidden = options.links === undefined || (ctx.shownLink?.target ?? null) === null;
    nameArrange(openLinkButton, openLinkText(), "Alt-Enter");
    unlinkButton.hidden = !has("links") || !units.some(isLink);
    // Con un livello solo, che ha già tutto, non c'è dove spostare.
    const layers = currentIndex().layers;
    intoButton.hidden = !has("layers") || layers.length === 0 || (layers.length === 1 && units.every((unit) => inLayer(unit, layers[0]!)));
    shapeButton.hidden = !has("recognize") || !units.some(ctx.holdsPenStroke);
    // L'opacità si scrive agli oggetti che la possono avere, e si legge
    // senza il resto dell'aspetto.
    const opacity = units.length === 0 || !has("arrange") ? null : opacityOf(ctx.engine.model!, units);
    opacityField.hidden = opacity === null || opacity.count === 0;
    if (opacity !== null && !opacityField.hidden) showOpacity(opacity);
    // Oltre la sesta, le azioni vanno nel «…».
    const shown = arrangeButtons.filter((control) => !control.hidden);
    shown.forEach((control, at) => control.toggleAttribute("data-more", at >= ARRANGE_SHOWN && shown.length > ARRANGE_SHOWN));
    for (const control of arrangeButtons) if (control.hidden) control.removeAttribute("data-more");
    arrangeMore.hidden = shown.length <= ARRANGE_SHOWN;
    const wasHidden = arrangeBar.hidden;
    arrangeBar.hidden = units.length === 0 || (opacityField.hidden && shown.length === 0);
    ctx.arrangeFocus.sync(null);
    placeBar();
    // Comparendo, la barra entra in dissolvenza (H2); riprenderla durante la
    // corsa la lascia dov'è.
    if (wasHidden && !arrangeBar.hidden) animate(arrangeBar, { from: { opacity: 0 }, duration: DURATION.state, easing: "ease-out", whenReduced: "none", lifetime: ctx.life });
    if (!focused) return;
    const active = document.activeElement;
    if (!arrangeBar.hidden && active instanceof HTMLButtonElement && arrangeBar.contains(active) && !active.disabled && !active.hidden) return;
    if (!arrangeBar.hidden && !opacityField.hidden && active === opacityInput) return;
    const next = !arrangeBar.hidden ? ctx.arrangeFocus.current() : null;
    if (next !== null) next.focus();
    else surface.focus({ preventScroll: true });
  };

  const syncControls = (): void => readFirst(syncEverything);
  ctx.syncControls = syncControls;

  const syncEverything = (): void => {
    const canEdit = editable();
    const now = style();
    root.toggleAttribute("data-readonly", !canEdit);
    surface.dataset.tool = ctx.tool;
    linkLayer.toggleAttribute("data-active", ctx.tool === "select" || !canEdit);
    ctx.syncRail(canEdit);
    ctx.colorWell.setValue(now.color);
    ctx.syncPenOptions();
    ctx.colorWell.button.disabled = !canEdit;
    if (!canEdit) ctx.colorWell.close();
    const widths = widthsNow();
    // La nota ha il suo corpo e la copertura è piena: lo spessore non vale.
    const unsized = ctx.tool === "note" || ctx.tool === "cover";
    widthButtons.forEach(({ control, bar, glyph }, at) => {
      const value = widths[at]!.value;
      bar.hidden = false;
      glyph.hidden = true;
      bar.style.setProperty("--draw-width", `${value}px`);
      control.setAttribute("aria-checked", String(value === now.width));
      control.disabled = !canEdit || unsized;
    });
    showWidthLabels();
    undoButton.disabled = !canEdit || !ctx.undoable();
    redoButton.disabled = !canEdit || !ctx.redoable();
    deleteButton.disabled = !canEdit || ctx.selection.length === 0;
    selectionButton.hidden = !has("selection");
    // Senza la selezione avanzata non si isola: si torna a tutto il disegno.
    if (ctx.isolation !== null && !has("selection")) {
      ctx.isolation = null;
      ctx.rescope(ctx.selection);
      return;
    }
    // Col pannello, «Proprietà» lo apre e lo chiude anche in sola lettura: il
    // pannello mostra com'è il disegno. Senza, apre una finestra per cambiare.
    const panelled = has("properties");
    propertiesButton.disabled = !panelled && !canEdit;
    if (panelled) {
      propertiesButton.removeAttribute("aria-haspopup");
      propertiesButton.setAttribute("aria-controls", panel.element.id);
      propertiesButton.setAttribute("aria-expanded", String(!panel.element.hidden));
    } else {
      propertiesButton.setAttribute("aria-haspopup", "dialog");
      propertiesButton.removeAttribute("aria-controls");
      propertiesButton.removeAttribute("aria-expanded");
      if (!panel.element.hidden) showPanel(false, false, false);
    }
    pageButton.hidden = !has("grid") && !has("recognize") && !has("gestures");
    insertGroup.hidden = !ctx.insertsImages(ctx.features);
    imageButton.disabled = !canEdit;
    historyButton.hidden = !has("history");
    if (historyButton.hidden && !historyPanel.element.hidden) showHistory(false);
    syncHistory();
    accessButton.hidden = !has("accessibility");
    if (accessButton.hidden && !accessPanel.element.hidden) showAccess(false);
    // Le schede dell'ispettore seguono gli strumenti offerti.
    ctx.chrome.refresh?.();
    syncAccess();
    syncDescriptions();
    syncProperties();
    // Il titolo sta nelle proprietà del documento (B6); senza il pannello,
    // nella barra in alto, come prima.
    const titleHome = has("properties") ? panel.lead : ctx.topEnd;
    if (ctx.titleField.parentElement !== titleHome) titleHome.prepend(ctx.titleField);
    if (titleHome !== panel.lead) ctx.titleField.hidden = false;
    titleInput.disabled = !canEdit;
    if (document.activeElement !== titleInput) titleInput.value = currentTitle();
    syncLayers();
    ctx.toolbarFocus.sync(null);
    syncArrange();
  };

  /// Porta la superficie alla scena del motore.
  const refresh = (): void => oneRound(refreshScene);
  ctx.refresh = refresh;

  const refreshScene = (): void => {
    ctx.scene = builder.build(paintSource());
    // L'albero degli oggetti si ricava qui, nel passo che cambia il disegno:
    // chi poi sceglie o descrive un oggetto lo trova pronto, e in un disegno
    // grande non è un clic a pagarlo.
    outlineNow();
    drawingFonts.use(ctx.scene);
    painter.setDraft(null);
    painter.update(ctx.scene);
    // Il gruppo isolato si ritrova nel disegno nuovo; se non c'è più, o lì
    // dentro non si sceglie più, si sceglie di nuovo in tutto il disegno.
    if (ctx.isolation !== null && isolatedNode() === null) ctx.isolation = null;
    painter.setFocus(isolationChain());
    ctx.showIsolation();
    // Le tavole si rileggono; quella scelta che non c'è più si lascia.
    ctx.boards = null;
    if (chosenSheet() === null) ctx.boardChosen = null;
    showPage();
    // L'unità può essere cambiata, e con lei il passo della griglia.
    showGrid();
    ctx.index = null;
    ctx.marks = null;
    ctx.selection = inOrder(ctx.selection);
    // Il livello scelto si ritrova anche se ha cambiato posto o chiave.
    if (ctx.chosen !== null) {
      const layer = chosenIn(currentIndex().layers);
      ctx.chosen = layer === null ? null : { key: keyOf(layer), at: layer.path[0]! };
    }
    syncControls();
    if (ctx.hotGuide !== null && (ctx.scene.root.guides?.[ctx.hotGuide] === undefined || ctx.scene.root.guides[ctx.hotGuide]!.locked)) ctx.hotGuide = null;
    showHandles();
    syncTree();
    syncProperties();
  };
}
