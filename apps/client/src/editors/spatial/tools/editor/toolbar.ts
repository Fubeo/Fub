// L'editor del disegno: la barra e i pannelli. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { colorWell, type ColorWell } from "../../../../kit/color/well";
import type { ColorChoice } from "../../../../kit/color/picker";
import { createOptionsBar, type OptionItem, type OptionsBar } from "../../../../kit/options-bar";
import { identifier } from "../../../../ui/a11y";
import type { MenuItem } from "../../../../ui/menu";
import { REPLAY_SPEEDS } from "./replay";
import { ariaBinding, displayBinding } from "../../../../ui/commands";
import { iconEl } from "../../../../ui/icons";
import type { PenSymmetry } from "../symmetry";
import type { Point } from "../../scene/matrix";
import type { Item } from "../../scene/classify";
import type { LengthUnit } from "../../scene/rulers";
import { t, type DrawKey } from "../../strings";
import type { Board } from "../boards";
import type { PaintChannel, PlaceGrip } from "../gradients";
import { createProperties, type SectionId, type Properties } from "../properties";
import { documentSwatches, type DocumentColors } from "../swatches";
import type { ConnectorView } from "../connector-ops";
import type { HatchView } from "../patterns";
import type { Grid } from "../grid";
import { SceneIndex } from "../hit";
import { createHistoryPanel, type HistoryPanel } from "../history-panel";
import { createSuggestions, type SuggestionId, type Suggestions } from "../suggestions";
import { createBoardsPanel, type BoardRow, type BoardsPanel } from "../boards-panel";
import { createLibraryPanel, type LibraryPanel } from "../library-panel";
import { createAccessPanel, type AccessPanel } from "../accessibility-panel";
import type { Problem } from "../audit";
import { createObjectTree, type ObjectTree } from "../objects";
import { drawPickerText } from "../color-text";
import { customColor, DEFAULT_COLOR, PALETTE, swatchOf, WIDTHS } from "../palette";
import type { Feature, ToolId } from "../registry";
import type { PolygonTool } from "../shapes";
import { BAR_FEATURES, DRAG_PX, IMAGE_BINDING, ZOOM_STEP } from "./constants";
import { installCharacter } from "./chrome/character";
import { installPenOptions } from "./chrome/pen-options";
import { installRail } from "./chrome/rail";
import type { EditorContext } from "./context";
import type { GradientRead, PanelReading, ShapeDrag } from "./types";

/// La lettera dei pulsanti delle dimensioni del testo, in pixel.
const SIZE_GLYPH_PX: readonly number[] = [12, 16, 22];

/// Un pulsante della barra, come lo legge il catalogo dei comandi.
export interface ToolbarCommand {
  readonly control: HTMLButtonElement;
  readonly label: () => string;
  readonly icon: string | null;
  readonly run: () => void;
}

/// Ciò che la barra e i pannelli dà agli altri pezzi dell'editor.
export interface ToolbarContext {
  root: HTMLDivElement;
  header: HTMLDivElement;
  toolbar: HTMLDivElement;
  surface: HTMLDivElement;
  live: HTMLDivElement;
  surfaceHint: HTMLSpanElement;
  showSurfaceHint: () => void;
  labelSurface: () => void;
  button: (parent: HTMLElement, className: string, label: () => string, iconName: string | null, run: () => void) => HTMLButtonElement;
  /// I pulsanti della barra e della colonna, per il catalogo dei comandi.
  toolbarCommands: ToolbarCommand[];
  showToolMode: (id: ToolId) => void;
  insertGroup: HTMLElement;
  imageButton: HTMLButtonElement;
  /// Il pozzo del colore dello strumento.
  colorWell: ColorWell;
  widthButtons: Array<{ readonly control: HTMLButtonElement; readonly bar: HTMLElement; readonly glyph: HTMLElement }>;
  showWidthLabels: () => void;
  /// La riga delle opzioni, che è la barra.
  optionsBar: OptionsBar;
  /// La barra in alto, ai due capi della riga delle opzioni.
  topStart: HTMLDivElement;
  topEnd: HTMLDivElement;
  menuButton: HTMLButtonElement;
  /// «Esporta», se chi monta l'editor sa esportare.
  exportButton: HTMLButtonElement | null;
  /// Le voci del menu del disegno (≡).
  drawMenuItems: () => MenuItem[];
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  selectionButton: HTMLButtonElement;
  propertiesButton: HTMLButtonElement;
  layerGroup: HTMLElement;
  layersButton: HTMLButtonElement;
  layerText: HTMLSpanElement;
  layerStateText: HTMLSpanElement;
  tree: ObjectTree;
  historyShown: { readonly revision: number; readonly editable: boolean } | null;
  historyPanel: HistoryPanel;
  suggestions: Suggestions;
  audited: { readonly text: string; readonly problems: readonly Problem[] } | null;
  accessShown: {
    readonly problems: readonly Problem[];
    readonly items: readonly Item[];
    readonly selected: string | null;
    readonly editable: boolean;
  } | null;
  auditTimer: number | undefined;
  accessPanel: AccessPanel;
  boardsShown: { readonly rows: readonly BoardRow[]; readonly current: string | null; readonly editable: boolean; readonly paged: boolean } | null;
  boardRows: { readonly list: readonly Board[]; readonly rows: readonly BoardRow[] } | null;
  boardsPanel: BoardsPanel;
  shapeDrag: ShapeDrag | null;
  libraryPanel: LibraryPanel;
  panel: Properties;
  /// Ciò che il pannello mostra: si ridisegna quando cambia il disegno, la
  /// selezione, la vista o il livello.
  panelShown: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly unit: LengthUnit;
    readonly editable: boolean;
    readonly grid: Grid;
    readonly features: ReadonlySet<Feature>;
    readonly ratio: unknown;
    readonly kept: unknown;
    readonly polygon: PolygonTool | null;
    readonly symmetry: PenSymmetry | null;
    readonly board: Board | null;
    readonly drawing: string;
    readonly recent: readonly string[];
    readonly stop: unknown;
    /// Ciò che il pannello ha letto dagli oggetti scelti, da riusare finché
    /// non cambia ciò da cui dipende (vedi `syncProperties`).
    readonly reading: PanelReading;
  } | null;
  /// I colori del documento contati per la scena `index`: si ricontano
  /// soltanto quando il disegno cambia.
  colorsCounted: { readonly index: SceneIndex; readonly colors: DocumentColors } | null;
  /// Le campiture degli oggetti scelti `keys` lette per la scena `index`:
  /// con mille oggetti scelti si rileggono soltanto quando il disegno o la
  /// selezione cambiano, non a ogni colore recente o cambio di vista.
  hatchRead: { readonly index: SceneIndex; readonly keys: string; readonly view: HatchView } | null;
  /// I connettori fra gli oggetti scelti `keys` letti per la scena `index`,
  /// come le campiture.
  connectorRead: { readonly index: SceneIndex; readonly keys: string; readonly view: ConnectorView | null } | null;
  /// Il lucchetto delle proporzioni, come l'ha lasciato chi l'ha toccato,
  /// per la selezione di chiavi `keys`.
  ratioLock: { readonly keys: string; readonly on: boolean } | null;
  /// Il punto scelto della sfumatura comune del bersaglio `target`, per la
  /// selezione di chiavi `keys`: lo stesso nel pannello e, con lo strumento
  /// Sfumatura, sul foglio, dove sta nella sfumatura `group`.
  gradientStop: { readonly keys: string; readonly target: PaintChannel; readonly index: number; readonly group: number } | null;
  /// Il capo scelto della sfumatura `group` sul foglio, con lo strumento
  /// Sfumatura, come il punto scelto: scegliere l'uno lascia l'altro.
  gradientGrip: { readonly keys: string; readonly target: PaintChannel; readonly group: number; readonly grip: PlaceGrip } | null;
  /// Le sfumature che lo strumento Sfumatura mostra, lette per la scena, la
  /// selezione, «Applica a» e lo zoom di quando le si è lette.
  gradientCache: {
    readonly index: SceneIndex;
    readonly keys: string;
    readonly chosen: PaintChannel;
    readonly scale: number;
    readonly read: GradientRead | null;
  } | null;
  /// L'ultimo tocco dello strumento Sfumatura su un punto o sulla linea, per
  /// il doppio tocco.
  gradientTap: { readonly kind: "stop" | "line"; readonly group: number; readonly index: number; readonly at: Point; readonly time: number } | null;
  /// Vero mentre la sezione «Sfumatura» mostra sul disegno un cambio che non
  /// ha ancora scritto.
  gradientShown: boolean;
  zoomLevel: HTMLButtonElement;
  turnButton: HTMLButtonElement;
  pageButton: HTMLButtonElement;
  boardsButton: HTMLButtonElement;
  presentButton: HTMLButtonElement;
  libraryButton: HTMLButtonElement;
  objectsButton: HTMLButtonElement;
  historyButton: HTMLButtonElement;
  accessButton: HTMLButtonElement;
  titleField: HTMLLabelElement;
  titleInput: HTMLInputElement;
}

/// Monta la barra e i pannelli.
export function installToolbar(ctx: EditorContext): void {
  const {
    life, folio, has, relabels, widthsNow, zoomText, turnText, options
  } = ctx;
  // --- DOM ----------------------------------------------------------------

  const root = document.createElement("div");
  ctx.root = root;
  root.className = "draw-editor";
  const header = document.createElement("div");
  ctx.header = header;
  header.className = "draw-header";
  // La riga delle opzioni (B4): i gruppi della barra, e in «…» quelli che
  // non ci stanno, i meno importanti per primi.
  const optionsBar = createOptionsBar({ label: t("draw.toolbar"), moreLabel: t("draw.chrome.options.more"), lifetime: life });
  ctx.optionsBar = optionsBar;
  const toolbar = optionsBar.element as HTMLDivElement;
  ctx.toolbar = toolbar;
  toolbar.classList.add("draw-toolbar");
  const toolbarGroups: OptionItem[] = [];
  const surface = document.createElement("div");
  ctx.surface = surface;
  surface.className = "draw-surface";
  surface.tabIndex = 0;
  surface.setAttribute("role", "application");
  const live = document.createElement("div");
  ctx.live = live;
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  // Che cosa fanno i tasti sul foglio, letto quando ci arriva il fuoco.
  const surfaceHint = document.createElement("span");
  ctx.surfaceHint = surfaceHint;
  surfaceHint.className = "sr-only";
  surfaceHint.id = identifier("draw-surface-hint");
  surface.setAttribute("aria-describedby", surfaceHint.id);
  /// Il suggerimento del foglio dice anche come si arriva ai comandi della
  /// selezione, quando il livello ne ha; sul foglio delle annotazioni, i
  /// tasti che solo lui ha.
  const showSurfaceHint = (): void => {
    surfaceHint.textContent = t(folio !== undefined ? "draw.sheet.keys" : BAR_FEATURES.some(has) ? "draw.surface.hint.arrange" : "draw.surface.hint");
  };
  ctx.showSurfaceHint = showSurfaceHint;
  /// Il nome del foglio; quello delle annotazioni dice la pagina e il
  /// documento.
  const labelSurface = (): void => surface.setAttribute("aria-label", folio === undefined ? t("draw.surface") : folio.label());
  ctx.labelSurface = labelSurface;
  relabels.push(() => {
    toolbar.setAttribute("aria-label", t("draw.toolbar"));
    labelSurface();
    showSurfaceHint();
  });

  /// Un gruppo della riga delle opzioni, con la sua priorità: un involucro
  /// lo porta, così la riga mostra e nasconde l'involucro e il gruppo resta
  /// del livello. `into` lo mette altrove.
  const group = (label: DrawKey, radio: boolean, priority = 0, into?: HTMLElement): HTMLElement => {
    const element = document.createElement("div");
    element.className = "draw-group";
    element.setAttribute("role", radio ? "radiogroup" : "group");
    relabels.push(() => element.setAttribute("aria-label", t(label)));
    if (into !== undefined) into.append(element);
    else wrap(label, element, priority);
    return element;
  };
  const wrap = (id: string, element: HTMLElement, priority: number): void => {
    const holder = document.createElement("div");
    holder.className = "draw-options-item";
    holder.append(element);
    toolbarGroups.push({ id, element: holder, priority });
  };

  const button = (parent: HTMLElement, className: string, label: () => string, iconName: string | null, run: () => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = className;
    control.tabIndex = -1;
    if (iconName !== null) {
      const svg = iconEl(iconName);
      if (svg !== null) control.append(svg);
    }
    relabels.push(() => {
      const text = label();
      control.setAttribute("aria-label", text);
      control.title = text;
    });
    life.listen(control, "click", () => run());
    parent.append(control);
    ctx.toolbarCommands.push({ control, label, icon: iconName, run });
    return control;
  };
  ctx.toolbarCommands = [];
  ctx.button = button;

  // Gli strumenti stanno nella colonna (`chrome/rail.ts`), che si monta
  // qui: il pulsante di uno strumento che cambia modo (la stella, la
  // Curvatura) si rifà da sé alla prossima sincronia.
  installRail(ctx);
  ctx.showToolMode = () => ctx.syncRail(ctx.editable());

  // Le immagini del vault, dal livello Standard e se chi monta l'editor le
  // sa scegliere: un pulsante accanto agli strumenti, che apre la scelta.
  // Stanno in fondo alla colonna degli strumenti.
  const insertGroup = group("draw.insert", false, 0, ctx.railColumn);
  ctx.insertGroup = insertGroup;
  const imageButton = button(insertGroup, "draw-button", () => t("draw.image.vault"), "draw-image", () => void ctx.vaultImage());
  ctx.imageButton = imageButton;
  imageButton.setAttribute("aria-haspopup", "dialog");
  imageButton.setAttribute("aria-keyshortcuts", ariaBinding(IMAGE_BINDING));
  relabels.push(() => {
    imageButton.title = `${t("draw.image.vault")} (${displayBinding(IMAGE_BINDING)})`;
  });

  // Il colore (§17): un pozzo col colore e il suo nome, che apre il
  // selettore del kit. Gli otto colori di Okabe–Ito sono i «Consigliati», in
  // cima, col nome; poi i colori del documento e i recenti. Un colore
  // qualunque, dal quadrato o dal codice, dalla funzione «Colori».
  const colorGroup = group("draw.colors", false, 3);
  /// Il nome di un colore: quello della tavolozza, del campione del
  /// documento, o il codice.
  const colorName = (color: string): string => {
    const swatch = swatchOf(color);
    if (swatch !== null) return t(swatch.label);
    const model = ctx.engine.model;
    const named = model === null ? undefined : documentSwatches(model).find((each) => each.color === color.toLowerCase());
    return named?.name || color.toLowerCase();
  };
  const colorChoices = (colors: readonly string[]): ColorChoice[] => colors.map((color) => ({ color, name: colorName(color) }));
  const well = colorWell({
    label: t("draw.colors"),
    mixedText: t("draw.chrome.mixed"),
    text: drawPickerText(),
    value: DEFAULT_COLOR,
    nameOf: colorName,
    lifetime: life,
    now: () => {
      const model = ctx.engine.model;
      const free = has("colors");
      return {
        recommended: PALETTE.map((swatch) => ({ color: swatch.color, name: t(swatch.label) })),
        documentColors: !free || model === null ? [] : documentSwatches(model).map((each) => ({ color: each.color, name: each.name || each.color })),
        recent: free ? colorChoices(ctx.recentColors.filter((color) => swatchOf(color) === null)) : [],
        free,
      };
    },
    onChange: (color) => {
      if (!ctx.editable()) return;
      // Il colore, scritto: un campione del documento si sceglie dal suo
      // pannello, che lo lega.
      const code = customColor(color);
      if (code === null) return;
      ctx.setColor(code);
      ctx.announce(t("draw.announce.color", { color: colorName(code) }));
      // Con la Penna o l'Evidenziatore, i tratti scelti prendono il colore (P10).
      if (ctx.tool === "pen" || ctx.tool === "highlighter") ctx.repenSelection({ color: code });
    },
  });
  ctx.colorWell = well;
  well.button.classList.add("draw-color-well");
  colorGroup.append(well.element);
  relabels.push(() => well.relabel({ label: t("draw.colors"), mixedText: t("draw.chrome.mixed"), text: drawPickerText() }));

  // Gli spessori, per posizione: Sottile, Medio, Spesso valgono per la penna
  // e le forme quelli della tavolozza, per l'evidenziatore i suoi. Per il
  // testo sono le dimensioni, Piccolo, Medio e Grande, con una lettera al
  // posto della barra.
  const widthButtons: Array<{ readonly control: HTMLButtonElement; readonly bar: HTMLElement; readonly glyph: HTMLElement }> = [];
  ctx.widthButtons = widthButtons;
  const widthGroup = group("draw.widths", true, 3);
  WIDTHS.forEach((_, at) => {
    const control = button(widthGroup, "draw-button draw-width", () => t(widthsNow()[at]!.label), null, () => ctx.setWidth(widthsNow()[at]!.value));
    control.setAttribute("role", "radio");
    const bar = document.createElement("span");
    bar.className = "draw-width-bar";
    const glyph = document.createElement("span");
    glyph.className = "draw-size-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "A";
    glyph.style.setProperty("--draw-size", `${SIZE_GLYPH_PX[at]}px`);
    control.append(bar, glyph);
    widthButtons.push({ control, bar, glyph });
  });
  /// Il nome del gruppo e dei pulsanti: spessori, o dimensioni del testo.
  const showWidthLabels = (): void => {
    const label = t(ctx.tool === "text" ? "draw.sizes" : "draw.widths");
    if (widthGroup.getAttribute("aria-label") !== label) widthGroup.setAttribute("aria-label", label);
    const widths = widthsNow();
    widthButtons.forEach(({ control }, at) => {
      const text = t(widths[at]!.label);
      if (control.getAttribute("aria-label") === text) return;
      control.setAttribute("aria-label", text);
      control.title = text;
    });
  };
  ctx.showWidthLabels = showWidthLabels;
  relabels.push(showWidthLabels);

  // Il carattere di ciò che si scrive (S5): famiglia, corpo ed enfasi,
  // soltanto mentre si scrive un testo.
  installCharacter(ctx, group("draw.character", false, 3));

  // La penna della Penna e il modo della Gomma (P3, P8).
  installPenOptions(ctx, group("draw.pen.choose", false, 3), group("draw.eraser.mode", true, 3));

  // La barra in alto (B4): a sinistra il menu del disegno, Annulla e
  // Ripeti; a destra «Esporta». Sono fuori dalla riga delle opzioni, e il
  // Tab li raggiunge uno per uno.
  const topStart = document.createElement("div");
  topStart.className = "draw-group draw-top";
  ctx.topStart = topStart;
  const topEnd = document.createElement("div");
  topEnd.className = "draw-group draw-top";
  ctx.topEnd = topEnd;
  const menuButton = button(topStart, "draw-button", () => t("draw.chrome.menu"), "draw-menu", () => ctx.openMenu(menuButton, ctx.drawMenuItems()));
  ctx.menuButton = menuButton;
  menuButton.setAttribute("aria-haspopup", "menu");
  menuButton.setAttribute("aria-expanded", "false");
  const undoButton = button(topStart, "draw-button", () => t("draw.undo"), "draw-undo", () => ctx.undo());
  ctx.undoButton = undoButton;
  undoButton.setAttribute("aria-keyshortcuts", "Control+Z");
  const redoButton = button(topStart, "draw-button", () => t("draw.redo"), "draw-redo", () => ctx.redo());
  ctx.redoButton = redoButton;
  redoButton.setAttribute("aria-keyshortcuts", "Control+Shift+Z Control+Y");
  const onExport = options.onExport;
  const exportButton =
    onExport === undefined ? null : button(topEnd, "draw-button draw-export", () => t("draw.chrome.export"), "draw-export", () => onExport());
  ctx.exportButton = exportButton;
  if (exportButton !== null) {
    const text = document.createElement("span");
    text.className = "draw-export-text";
    text.setAttribute("aria-hidden", "true");
    exportButton.append(text);
    relabels.push(() => (text.textContent = t("draw.chrome.export")));
  }
  // Fuori dal roving della riga: nel Tab come ogni pulsante, e uno spento
  // ne esce da sé.
  for (const control of [menuButton, undoButton, redoButton, exportButton]) control?.removeAttribute("tabindex");
  // Il puntatore non prende il fuoco, che resta al foglio con i suoi tasti.
  for (const bar of [topStart, topEnd]) {
    life.listen(bar, "mousedown", (event) => {
      if ((event.target as Element | null)?.closest("button")) event.preventDefault();
    });
  }

  const editGroup = group("draw.edit", false, 2);
  const deleteButton = button(editGroup, "draw-button", () => t("draw.delete"), "trash", () => ctx.deleteSelection());
  ctx.deleteButton = deleteButton;
  deleteButton.setAttribute("aria-keyshortcuts", "Delete");
  // La selezione avanzata, dal livello Standard: un menu, lo stesso del tasto
  // destro sul foglio.
  const selectionButton = button(editGroup, "draw-button", () => t("draw.selection.menu"), "draw-selection", () => ctx.openMenu(selectionButton, ctx.selectionItems()));
  ctx.selectionButton = selectionButton;
  selectionButton.id = identifier("draw-selection-button");
  selectionButton.setAttribute("aria-haspopup", "menu");
  selectionButton.setAttribute("aria-expanded", "false");
  // «Proprietà» apre e chiude il pannello, dal livello che lo offre; senza,
  // apre la finestra.
  const propertiesButton = button(editGroup, "draw-button", () => t("draw.properties"), "properties", () => {
    if (has("properties")) ctx.showPanel(ctx.toggles(panel.element));
    else void ctx.properties();
  });
  ctx.propertiesButton = propertiesButton;
  propertiesButton.setAttribute("aria-keyshortcuts", "Enter");

  // I livelli, dal livello Standard: il pulsante dice dove si disegna e apre
  // il menu che li sceglie e li cambia.
  const layerGroup = group("draw.layers", false, 1);
  ctx.layerGroup = layerGroup;
  const layersButton = button(layerGroup, "draw-button draw-layer-button", () => ctx.layersLabel(), "draw-layers", () => ctx.openMenu(layersButton, ctx.layerItems()));
  ctx.layersButton = layersButton;
  layersButton.setAttribute("aria-haspopup", "menu");
  layersButton.setAttribute("aria-expanded", "false");
  const layerText = document.createElement("span");
  ctx.layerText = layerText;
  layerText.className = "draw-layer-name";
  const layerStateText = document.createElement("span");
  ctx.layerStateText = layerStateText;
  layerStateText.className = "draw-layer-state";
  layersButton.append(layerText, layerStateText);

  // L'albero degli oggetti, chiuso finché qualcuno non lo apre.
  const tree = createObjectTree(life, {
    onSelect(keys) {
      ctx.cancelGesture();
      ctx.select(keys);
      // Le chiavi di prima, se il ritaglio le ha cambiate, non valgono più.
      const unit = keys.length === 1 && ctx.selection.length === 1 ? ctx.currentIndex().get(ctx.selection[0]!) : null;
      if (unit !== null) ctx.frameBounds(unit.bounds);
    },
    onActivate: () => void ctx.properties(),
    onDelete: () => ctx.deleteSelection(),
    onLeave: () => surface.focus({ preventScroll: true }),
    onToggle: (key, what) => ctx.toggleRow(ctx.settleCrop()(key), what === "lock" ? "locked" : "hidden"),
    canRename: (key) => ctx.canRename(key),
    onRename: (key, name) => ctx.renameRow(ctx.settleCrop()(key), name),
    canMove: (keys, drop) => {
      const plan = ctx.placing(keys, drop);
      return plan !== null && typeof plan !== "string";
    },
    onMove: (keys, drop) => {
      const rekey = ctx.settleCrop();
      return ctx.moveRows(keys.map(rekey), { ...drop, key: rekey(drop.key) });
    },
    onEdge: (key, front) => ctx.announce(t(ctx.outlineNow().byKey.get(key)?.item.role === "layer" ? (front ? "draw.layer.edge.top" : "draw.layer.edge.bottom") : front ? "draw.move.edge.front" : "draw.move.edge.back")),
    onEyedropper: (key, colorOnly) => ctx.dropFromRow(ctx.settleCrop()(key), colorOnly),
  });
  ctx.tree = tree;
  tree.element.hidden = true;
  relabels.push(() => tree.relabel());

  // La cronologia, dal livello Standard: i passi del disegno, per tornare a
  // uno qualsiasi in un colpo, e i segni. Ciò che mostra: la revisione della
  // pila e se si poteva cambiare.
  ctx.historyShown = null;
  const historyPanel = createHistoryPanel(life, {
    onGo: (at, mark) => ctx.goToPoint(at, mark),
    onMark: () => ctx.markHere(),
    onRename: (id, name) => ctx.renameMark(id, name),
    onUnmark: (id) => ctx.unmark(id),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  ctx.historyPanel = historyPanel;
  historyPanel.element.hidden = true;
  relabels.push(() => {
    historyPanel.relabel();
    ctx.historyShown = null;
    ctx.syncHistory();
  });

  // I suggerimenti brevi, sotto il foglio: uno alla volta, ognuno una volta
  // sola, dopo un gesto che somiglia a quello che dicono.
  const suggestions = createSuggestions(life, {
    text: (id) => suggestionText(id),
    onSeen: (seen) => options.onSuggestedChange?.(seen),
    onSwitch: (on) => options.onSuggestionsSwitch?.(on),
    onClose: () => surface.focus({ preventScroll: true }),
  });
  ctx.suggestions = suggestions;
  suggestions.remember(options.suggestions ?? null);
  relabels.push(() => suggestions.relabel());

  /// Il testo di un suggerimento: quello delle due dita dice anche i tocchi,
  /// dove annullano e ripetono.
  const suggestionText = (id: SuggestionId): string => {
    switch (id) {
      case "two-fingers":
        return t(has("gestures") && ctx.grid.taps ? "draw.suggestion.two_fingers.taps" : "draw.suggestion.two_fingers");
      case "hold-shape":
        return t("draw.suggestion.hold_shape");
      case "label-shape":
        return t("draw.suggestion.label_shape");
    }
  };

  // La verifica dell'accessibilità, dal livello Standard: i problemi del
  // disegno con le loro correzioni, e l'ordine di lettura. Il disegno si
  // rilegge soltanto col pannello aperto. Ciò che ha trovato nel testo
  // `text`, e ciò che il pannello mostra.
  ctx.audited = null;
  ctx.accessShown = null;
  life.add(() => clearTimeout(ctx.auditTimer));
  const accessPanel = createAccessPanel(life, {
    onGo: (key) => ctx.goToObject(key),
    onFix: (problem) => ctx.fixProblem(problem),
    onDescribe: (key, text) => ctx.describeImage(key, text),
    onDecorative: (key) => ctx.decorateImage(key),
    onMove: (key, later, confirmed) => ctx.moveInReading(ctx.settleCrop()(key), later, confirmed),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  ctx.accessPanel = accessPanel;
  accessPanel.element.hidden = true;
  relabels.push(() => {
    ctx.accessNames.clear();
    ctx.accessShown = null;
    accessPanel.relabel();
    ctx.syncAccess();
  });

  // L'elenco delle tavole, dal livello Standard: chiuso finché qualcuno non
  // lo apre. Le righe si rifanno quando cambiano le tavole, e restano le
  // stesse se dicono le stesse cose.
  ctx.boardsShown = null;
  ctx.boardRows = null;
  const boardsPanel = createBoardsPanel(life, {
    onGo: (id) => ctx.goToBoard(id),
    onAdd: () => {
      ctx.settleCrop();
      ctx.newBoard();
    },
    onRename: (id, name) => {
      ctx.settleCrop();
      void ctx.writeBoardName(id, name);
    },
    onDuplicate: (id) => {
      ctx.settleCrop();
      const board = ctx.boardById(id);
      if (board !== null) ctx.duplicateBoard(board);
    },
    onDelete: (id) => {
      ctx.settleCrop();
      const board = ctx.boardById(id);
      if (board !== null) ctx.removeBoard(board);
    },
    onMove: (id, to) => {
      ctx.settleCrop();
      ctx.orderBoard(id, to);
    },
    onLeave: () => surface.focus({ preventScroll: true }),
    onPresent: (id) => ctx.present(id),
    canPresent: () => ctx.has("present"),
  });
  ctx.boardsPanel = boardsPanel;
  boardsPanel.element.hidden = true;
  relabels.push(() => {
    ctx.boardRows = null;
    ctx.boardsShown = null;
    boardsPanel.relabel();
    ctx.syncBoards();
  });

  // Le forme delle raccolte, dal livello Standard: chiuse finché qualcuno non
  // le apre. Inserire, e trascinare, sono dell'editor.
  ctx.shapeDrag = null;
  const libraryPanel = createLibraryPanel(life, {
    onInsert: (id) => ctx.insertShape(id),
    onDrag: (id, event) => ctx.startShapeDrag(id, event),
    onLeave: () => surface.focus({ preventScroll: true }),
    slop: DRAG_PX,
  });
  ctx.libraryPanel = libraryPanel;
  libraryPanel.element.hidden = true;
  relabels.push(() => libraryPanel.relabel());

  // Le proprietà della selezione, o del disegno, dal livello Standard: un
  // pannello accanto al foglio, che si apre da sé se c'è posto.
  const panel = createProperties(life, {
    closed: ctx.grid.closed as readonly SectionId[],
    onChange: (id, value) => ctx.changeField(id, value),
    onAction: (id) => ctx.runAction(id),
    onExportSelection: () => options.onExport?.("selection"),
    onSection: (id, open) => {
      const closed = ctx.grid.closed.filter((each) => each !== id);
      ctx.changeGrid({ ...ctx.grid, closed: open ? closed : [...closed, id] });
    },
    colors: {
      onApply: (choice, target) => ctx.applyColor(choice.value, choice.color, choice.name, target),
      onCreate: (name, color, link) => ctx.createSwatch(name, color, link),
      onLink: (id) => ctx.linkSwatch(id),
      onRename: (id, name) => ctx.renameSwatch(id, name),
      onRecolor: (id, color) => ctx.recolorSwatch(id, color),
      onDelete: (id) => ctx.deleteSwatch(id),
      onSelect: (value) => ctx.selectShowing(value),
    },
    gradient: {
      onChange: (target, change, label) => ctx.changeGradient(target, change, label),
      onPreview: (target, change) => ctx.previewGradient(target, change),
      onStop: (index) => ctx.chooseGradientStop(index),
    },
    hatch: {
      onChange: (change, label) => ctx.changeHatch(change, label),
    },
    connector: {
      onChange: (change, label) => ctx.changeConnector(change, label),
    },
    // Lo strumento Sfumatura mostra le sfumature dell'altro colore.
    onTarget: () => {
      ctx.panelShown = null;
      ctx.syncProperties();
      ctx.showHandles();
    },
    announce: (text) => ctx.announce(text),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  ctx.panel = panel;
  panel.element.hidden = true;
  ctx.panelShown = null;
  ctx.colorsCounted = null;
  ctx.hatchRead = null;
  ctx.connectorRead = null;
  ctx.ratioLock = null;
  ctx.gradientStop = null;
  ctx.gradientGrip = null;
  ctx.gradientCache = null;
  ctx.gradientTap = null;
  ctx.gradientShown = false;
  relabels.push(() => {
    panel.relabel();
    ctx.panelShown = null;
    ctx.syncProperties();
  });

  const viewGroup = group("draw.view", false);
  button(viewGroup, "draw-button", () => t("draw.zoom_out"), "draw-zoom-out", () => ctx.zoomBy(1 / ZOOM_STEP));
  // Il nome contiene la percentuale che si vede (WCAG 2.5.3): chi la dice a
  // voce trova il pulsante.
  const zoomLevel = button(viewGroup, "draw-button draw-zoom-level", () => t("draw.zoom_reset", { zoom: zoomText() }), null, () => ctx.zoomBy(1 / ctx.camera.scale));
  ctx.zoomLevel = zoomLevel;
  button(viewGroup, "draw-button", () => t("draw.zoom_in"), "draw-zoom-in", () => ctx.zoomBy(ZOOM_STEP));
  const fitButton = button(viewGroup, "draw-button", () => t("draw.fit"), "draw-fit", () => ctx.fit());
  fitButton.setAttribute("aria-keyshortcuts", "Shift+1");
  // Sul foglio girato, il suo angolo: un clic lo raddrizza. Il nome contiene
  // l'angolo che si vede, come quello dello zoom.
  const turnButton = button(viewGroup, "draw-button draw-zoom-level", () => t("draw.turn.button", { angle: turnText(ctx.camera.angle) }), null, () => ctx.turnView(0));
  ctx.turnButton = turnButton;
  turnButton.dataset.turn = "";
  turnButton.setAttribute("aria-keyshortcuts", "5");
  turnButton.hidden = true;
  // La griglia e la pagina, dal livello Standard: un menu.
  const pageButton = button(viewGroup, "draw-button", () => t("draw.page_grid"), "draw-page-grid", () => ctx.openMenu(pageButton, ctx.pageItems()));
  ctx.pageButton = pageButton;
  pageButton.setAttribute("aria-haspopup", "menu");
  pageButton.setAttribute("aria-expanded", "false");
  // Le tavole, dal livello Standard.
  const boardsButton = button(viewGroup, "draw-button", () => t("draw.boards"), "draw-boards", () => ctx.showBoards(ctx.toggles(boardsPanel.element)));
  ctx.boardsButton = boardsButton;
  boardsButton.setAttribute("aria-expanded", "false");
  boardsButton.setAttribute("aria-controls", boardsPanel.element.id);
  // Presenta, dal livello Standard: lo schermo intero, tavola per tavola.
  const presentButton = button(viewGroup, "draw-button", () => t("draw.present"), "draw-present", () => ctx.present(null));
  ctx.presentButton = presentButton;
  presentButton.setAttribute("aria-keyshortcuts", "F5");
  // Le forme, dal livello Standard.
  const libraryButton = button(viewGroup, "draw-button", () => t("draw.library"), "draw-library", () => ctx.showLibrary(ctx.toggles(libraryPanel.element)));
  ctx.libraryButton = libraryButton;
  libraryButton.setAttribute("aria-expanded", "false");
  libraryButton.setAttribute("aria-controls", libraryPanel.element.id);
  const objectsButton = button(viewGroup, "draw-button", () => t("draw.objects"), "outline", () => ctx.showObjects(ctx.toggles(tree.element)));
  ctx.objectsButton = objectsButton;
  objectsButton.setAttribute("aria-expanded", "false");
  objectsButton.setAttribute("aria-controls", tree.element.id);
  const historyButton = button(viewGroup, "draw-button", () => t("draw.history"), "draw-history", () => ctx.showHistory(ctx.toggles(historyPanel.element)));
  ctx.historyButton = historyButton;
  historyButton.setAttribute("aria-expanded", "false");
  historyButton.setAttribute("aria-controls", historyPanel.element.id);
  const accessButton = button(viewGroup, "draw-button", () => t("draw.access"), "draw-access", () => ctx.showAccess(ctx.toggles(accessPanel.element)));
  ctx.accessButton = accessButton;
  accessButton.setAttribute("aria-expanded", "false");
  accessButton.setAttribute("aria-controls", accessPanel.element.id);
  const keysButton = button(viewGroup, "draw-button", () => t("draw.keys"), "keyboard", () => void ctx.keys());
  keysButton.setAttribute("aria-keyshortcuts", "?");
  keysButton.setAttribute("aria-haspopup", "dialog");

  const titleField = document.createElement("label");
  ctx.titleField = titleField;
  titleField.className = "draw-title";
  const titleText = document.createElement("span");
  titleText.className = "draw-title-label";
  const titleInput = document.createElement("input");
  ctx.titleInput = titleInput;
  titleInput.type = "text";
  titleInput.className = "draw-title-input";
  titleInput.autocomplete = "off";
  titleInput.spellcheck = true;
  titleField.append(titleText, titleInput);
  optionsBar.setItems(toolbarGroups);
  /// Il sottomenu «Vista» del menu «Disegno»: inquadrare e come si vede.
  const viewItems = (): MenuItem[] => {
    const none = ctx.selection.length === 0;
    return [
      { label: t("draw.fit"), hint: displayBinding("Shift-1"), run: () => ctx.fit() },
      { label: t("draw.fit.selection"), hint: displayBinding("Shift-2"), disabled: none, ...(none ? { description: t("draw.selection.empty") } : {}), run: () => ctx.fitSelection() },
      { label: t("draw.keys.actual"), hint: displayBinding("Mod-0"), run: () => ctx.zoomBy(1 / ctx.camera.scale) },
      { label: t("draw.outlines"), separator: true, choice: "checkbox", checked: ctx.outline, hint: displayBinding("Mod-y"), run: () => ctx.setOutline(!ctx.outline) },
      { label: t("draw.navigator"), choice: "checkbox", checked: ctx.navigator, run: () => ctx.setNavigator(!ctx.navigator) },
      { label: t("draw.bare"), choice: "checkbox", checked: ctx.bare, hint: displayBinding("Mod-."), run: () => ctx.setBare(!ctx.bare) },
      { label: t("draw.ruler"), separator: true, choice: "checkbox", checked: ctx.ruler !== null, run: () => ctx.setRuler(ctx.ruler === null) },
      ...(ctx.ruler === null
        ? []
        : [
            { label: t("draw.ruler.turn"), run: () => ctx.stepRuler(1) },
            { label: t("draw.ruler.level"), disabled: ctx.ruler.angle === -ctx.camera.angle, run: () => ctx.stepRuler(0) },
          ]),
      ...REPLAY_SPEEDS.map((speed, at): MenuItem => ({ label: t("draw.replay", { speed: String(speed) }), ...(at === 0 ? { separator: true } : {}), run: () => ctx.replay(speed) })),
    ];
  };
  ctx.drawMenuItems = (): MenuItem[] => {
    const editable = ctx.editable();
    const items: MenuItem[] = [];
    if (has("board")) items.push({ label: t("draw.boards.add"), icon: "draw-boards", disabled: !editable, run: () => ctx.newBoard() });
    if (ctx.insertsImages(ctx.features)) items.push({ label: t("draw.image.vault"), icon: "draw-image", hint: "Ctrl+I", disabled: !editable, run: () => void ctx.vaultImage() });
    if (onExport !== undefined) items.push({ label: t("draw.chrome.export.dialog"), icon: "draw-export", run: () => onExport() });
    if (has("present")) items.push({ label: t("draw.present"), icon: "draw-present", hint: "F5", run: () => ctx.present(null) });
    if (has("selection")) items.push({ label: t("draw.selection.menu"), icon: "draw-selection", separator: true, submenu: true, items: ctx.selectionItems() });
    if (!pageButton.hidden) items.push({ label: t("draw.page_grid"), icon: "draw-page-grid", submenu: true, items: ctx.pageItems() });
    items.push({ label: t("draw.view"), submenu: true, items: viewItems() });
    items.push(...ctx.workspaceItems());
    items.push({ label: t("draw.chrome.title"), separator: true, run: () => {
      if (has("properties")) ctx.showPanel(true, false);
      titleInput.focus();
      titleInput.select();
    } });
    items.push({ label: t("draw.commands.open"), hint: displayBinding("Mod-/"), run: () => ctx.searchCommands() });
    items.push({ label: t("draw.keys"), icon: "keyboard", hint: "?", run: () => void ctx.keys() });
    return items;
  };
  relabels.push(() => {
    titleText.textContent = t(folio === undefined ? "draw.title" : "draw.sheet.title");
    titleInput.placeholder = t(folio === undefined ? "draw.title.placeholder" : "draw.sheet.title.placeholder");
  });
}
