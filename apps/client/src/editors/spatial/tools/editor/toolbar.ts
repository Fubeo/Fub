// L'editor del disegno: la barra e i pannelli. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { identifier } from "../../../../ui/a11y";
import { ariaBinding, displayBinding } from "../../../../ui/commands";
import { iconEl } from "../../../../ui/icons";
import { SymbolLibraries } from "../symbol-libraries";
import type { Library, LibrarySymbol, SymbolCopy, SymbolSheet } from "../symbol-library";
import type { PenSymmetry } from "../symmetry";
import type { Point } from "../../scene/matrix";
import type { Item } from "../../scene/classify";
import type { LengthUnit } from "../../scene/rulers";
import { t, type DrawKey } from "../../strings";
import { attributeOps, heldNamer, renameOps } from "../attributes";
import type { Board } from "../boards";
import type { PaintChannel, PlaceGrip } from "../gradients";
import { createProperties, type SectionId, type Properties } from "../properties";
import type { DocumentColors } from "../swatches";
import type { ConnectorView } from "../connector-ops";
import type { HatchView } from "../patterns";
import type { Grid } from "../grid";
import { SceneIndex } from "../hit";
import { createHistoryPanel, type HistoryPanel } from "../history-panel";
import { createSuggestions, type SuggestionId, type Suggestions } from "../suggestions";
import { createBoardsPanel, type BoardRow, type BoardsPanel } from "../boards-panel";
import { createLibraryPanel, type LibraryPanel } from "../library-panel";
import { createSymbolsPanel, type SymbolsPanel } from "../symbols-panel";
import { createAccessPanel, type AccessPanel } from "../accessibility-panel";
import type { Problem } from "../audit";
import { createInspector, type Inspector } from "../inspector";
import { createObjectTree, type ObjectTree } from "../objects";
import { isLight, PALETTE, WIDTHS } from "../palette";
import { TOOLS, type Feature, type ToolId } from "../registry";
import type { PolygonTool } from "../shapes";
import { ATTRIBUTES_BINDING, BAR_FEATURES, DRAG_PX, IMAGE_BINDING, ZOOM_STEP } from "./constants";
import type { EditorContext } from "./context";
import type { GradientRead, PanelReading, ShapeDrag, SymbolDrag, SymbolPictureEntry } from "./types";

/// La lettera dei pulsanti delle dimensioni del testo, in pixel.
const SIZE_GLYPH_PX: readonly number[] = [12, 16, 22];

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
  toolButtons: Map<ToolId, HTMLButtonElement>;
  showToolMode: (id: ToolId) => void;
  insertGroup: HTMLElement;
  imageButton: HTMLButtonElement;
  colorButtons: Map<string, HTMLButtonElement>;
  customLabel: () => string;
  customButton: HTMLButtonElement;
  customChip: HTMLSpanElement;
  moreGroup: HTMLDivElement;
  moreButton: HTMLButtonElement;
  widthButtons: Array<{ readonly control: HTMLButtonElement; readonly bar: HTMLElement; readonly glyph: HTMLElement }>;
  showWidthLabels: () => void;
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
  symbolDrag: SymbolDrag | null;
  /// Cresce a ogni cambiamento delle librerie: il pannello si rifà.
  librariesRound: number;
  symbolLibraries: SymbolLibraries | null;
  symbolsPanel: SymbolsPanel;
  /// Ciò che il pannello dei simboli mostra: il testo del disegno, il giro
  /// delle librerie e se si modifica; `null` dopo un cambio di lingua.
  symbolsShown: { readonly text: string; readonly round: number; readonly editable: boolean } | null;
  /// I testi dei simboli del disegno di adesso, letti quando servono, col
  /// testo del disegno da cui vengono: il modello resta lo stesso oggetto
  /// quando il disegno cambia.
  drawingSheet: { readonly text: string; readonly sheet: SymbolSheet } | null;
  librarySymbols: WeakMap<Library, ReadonlyMap<string, LibrarySymbol>>;
  symbolCopies: Map<string, { readonly version: string; readonly copy: SymbolCopy | null; }>;
  symbolPictures: Map<string, SymbolPictureEntry>;
  /// Le anteprime si fanno una alla volta, e fra l'una e l'altra la pagina
  /// respira.
  pictureQueue: Promise<unknown>;
  inspector: Inspector;
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
  libraryButton: HTMLButtonElement;
  symbolsButton: HTMLButtonElement;
  objectsButton: HTMLButtonElement;
  historyButton: HTMLButtonElement;
  accessButton: HTMLButtonElement;
  attributesButton: HTMLButtonElement;
  titleField: HTMLLabelElement;
  titleInput: HTMLInputElement;
}

/// Monta la barra e i pannelli.
export function installToolbar(ctx: EditorContext): void {
  const {
    life, profile, folio, has, relabels, toolLabel, toolHint, widthsNow, zoomText, turnText, options
  } = ctx;
  // --- DOM ----------------------------------------------------------------

  const root = document.createElement("div");
  ctx.root = root;
  root.className = "draw-editor";
  const header = document.createElement("div");
  ctx.header = header;
  header.className = "draw-header";
  const toolbar = document.createElement("div");
  ctx.toolbar = toolbar;
  toolbar.className = "draw-toolbar";
  toolbar.setAttribute("role", "toolbar");
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

  const group = (label: DrawKey, radio: boolean): HTMLElement => {
    const element = document.createElement("div");
    element.className = "draw-group";
    element.setAttribute("role", radio ? "radiogroup" : "group");
    relabels.push(() => element.setAttribute("aria-label", t(label)));
    toolbar.append(element);
    return element;
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
    return control;
  };
  ctx.button = button;

  // Ogni strumento del registro ha il suo pulsante; quelli sopra il livello
  // restano nascosti finché il livello non sale.
  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  ctx.toolButtons = toolButtons;
  const toolGroup = group("draw.tools", true);
  /// Le parole dei pulsanti che cambiano col modo dello strumento: il
  /// Poligono con la stella, la penna di Bézier con la Curvatura.
  const relabelTool = new Map<ToolId, () => void>();
  // Gli strumenti del profilo: quelli di un altro non ci sono mai.
  for (const spec of TOOLS.filter((each) => each.levels[profile] !== undefined)) {
    const shortcut = spec.shortcut.toUpperCase();
    const control = button(toolGroup, "draw-button draw-tool", () => `${t(toolLabel(spec.id))} (${shortcut})`, spec.icon, () => ctx.pickTool(spec.id));
    control.setAttribute("role", "radio");
    control.setAttribute("aria-keyshortcuts", shortcut);
    control.dataset.tool = spec.id;
    const hint = document.createElement("span");
    hint.className = "sr-only";
    hint.id = identifier(`draw-hint-${spec.id}`);
    control.setAttribute("aria-describedby", hint.id);
    const label = (): void => {
      const text = t(toolLabel(spec.id));
      control.title = `${text} (${shortcut})`;
      control.setAttribute("aria-label", text);
      hint.textContent = t(toolHint(spec.id));
    };
    relabels.push(label);
    relabelTool.set(spec.id, label);
    control.append(hint);
    toolButtons.set(spec.id, control);
  }

  /// Il pulsante dello strumento `id` come disegna adesso: l'icona e le
  /// parole della stella o del poligono, della Curvatura o della penna.
  const showToolMode = (id: ToolId): void => {
    const control = toolButtons.get(id);
    const now = control?.querySelector("svg");
    const glyph = iconEl(ctx.toolIcon(id));
    if (now != null && glyph !== null) now.replaceWith(glyph);
    relabelTool.get(id)?.();
  };
  ctx.showToolMode = showToolMode;

  // Le immagini del vault, dal livello Standard e se chi monta l'editor le
  // sa scegliere: un pulsante accanto agli strumenti, che apre la scelta.
  const insertGroup = group("draw.insert", false);
  ctx.insertGroup = insertGroup;
  const imageButton = button(insertGroup, "draw-button", () => t("draw.image.vault"), "draw-image", () => void ctx.vaultImage());
  ctx.imageButton = imageButton;
  imageButton.setAttribute("aria-haspopup", "dialog");
  imageButton.setAttribute("aria-keyshortcuts", ariaBinding(IMAGE_BINDING));
  relabels.push(() => {
    imageButton.title = `${t("draw.image.vault")} (${displayBinding(IMAGE_BINDING)})`;
  });

  const colorButtons = new Map<string, HTMLButtonElement>();
  ctx.colorButtons = colorButtons;
  const colorGroup = group("draw.colors", true);
  for (const swatch of PALETTE) {
    const control = button(colorGroup, "draw-button draw-color", () => t(swatch.label), null, () => ctx.setColor(swatch.color));
    control.setAttribute("role", "radio");
    const frame = document.createElement("span");
    frame.className = "draw-swatch-frame";
    frame.dataset.shape = swatch.shape;
    const chip = document.createElement("span");
    chip.className = "draw-swatch";
    chip.style.setProperty("--swatch", swatch.color);
    frame.append(chip);
    control.append(frame);
    colorButtons.set(swatch.color, control);
  }
  // Il colore a piacere: il suo campione, nella stessa scelta della
  // tavolozza, e dopo il pulsante che lo chiede. Il campione ha una forma
  // sua, l'anello, e il nome dice il codice.
  const customLabel = (): string =>
    ctx.custom === null ? t("draw.color.dialog") : t(isLight(ctx.custom) ? "draw.color.custom.light" : "draw.color.custom", { code: ctx.custom });
  ctx.customLabel = customLabel;
  const customButton = button(colorGroup, "draw-button draw-color", customLabel, null, () => {
    if (ctx.custom !== null) ctx.setColor(ctx.custom);
  });
  ctx.customButton = customButton;
  customButton.setAttribute("role", "radio");
  const customFrame = document.createElement("span");
  customFrame.className = "draw-swatch-frame";
  customFrame.dataset.shape = "ring";
  const customChip = document.createElement("span");
  ctx.customChip = customChip;
  customChip.className = "draw-swatch";
  customFrame.append(customChip);
  customButton.append(customFrame);
  const moreGroup = document.createElement("div");
  ctx.moreGroup = moreGroup;
  moreGroup.className = "draw-group";
  toolbar.append(moreGroup);
  const moreButton = button(moreGroup, "draw-button", () => t("draw.color.more"), "draw-color-more", () => void ctx.chooseColor());
  ctx.moreButton = moreButton;
  moreButton.setAttribute("aria-haspopup", "dialog");

  // Gli spessori, per posizione: Sottile, Medio, Spesso valgono per la penna
  // e le forme quelli della tavolozza, per l'evidenziatore i suoi. Per il
  // testo sono le dimensioni, Piccolo, Medio e Grande, con una lettera al
  // posto della barra.
  const widthButtons: Array<{ readonly control: HTMLButtonElement; readonly bar: HTMLElement; readonly glyph: HTMLElement }> = [];
  ctx.widthButtons = widthButtons;
  const widthGroup = group("draw.widths", true);
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

  const editGroup = group("draw.edit", false);
  const undoButton = button(editGroup, "draw-button", () => t("draw.undo"), "draw-undo", () => ctx.undo());
  ctx.undoButton = undoButton;
  undoButton.setAttribute("aria-keyshortcuts", "Control+Z");
  const redoButton = button(editGroup, "draw-button", () => t("draw.redo"), "draw-redo", () => ctx.redo());
  ctx.redoButton = redoButton;
  redoButton.setAttribute("aria-keyshortcuts", "Control+Shift+Z Control+Y");
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
    if (has("properties")) ctx.showPanel(panel.element.hidden);
    else void ctx.properties();
  });
  ctx.propertiesButton = propertiesButton;
  propertiesButton.setAttribute("aria-keyshortcuts", "Enter");

  // I livelli, dal livello Standard: il pulsante dice dove si disegna e apre
  // il menu che li sceglie e li cambia.
  const layerGroup = group("draw.layers", false);
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

  // I simboli del disegno e quelli delle librerie del vault, dal livello
  // Esperto: chiusi finché qualcuno non li apre. Le librerie si leggono la
  // prima volta che si aprono; un disegno annotato su un fondo non le ha.
  // Inserire, trascinare e i comandi dei simboli sono dell'editor.
  ctx.symbolDrag = null;
  ctx.librariesRound = 0;
  const symbolLibraries =
    options.symbolLibraries === undefined || folio !== undefined
      ? null
      : new SymbolLibraries(options.symbolLibraries, () => {
          ctx.librariesRound++;
          ctx.syncSymbols();
        });
  ctx.symbolLibraries = symbolLibraries;
  if (symbolLibraries !== null) life.add(() => symbolLibraries.dispose());
  const symbolsPanel = createSymbolsPanel(life, {
    onInsert: (ref) => void ctx.insertSymbol(ref),
    onDrag: (ref, event) => ctx.startSymbolDrag(ref, event),
    onMenu: (ref, at, labelledBy) => ctx.symbolMenu(ref, at, labelledBy),
    picture: (ref, version) => ctx.symbolPictureUrl(ref, version),
    onLeave: () => surface.focus({ preventScroll: true }),
    slop: DRAG_PX,
  });
  ctx.symbolsPanel = symbolsPanel;
  symbolsPanel.element.hidden = true;
  ctx.symbolsShown = null;
  ctx.drawingSheet = null;
  /// I simboli di ogni libreria letta, per id.
  const librarySymbols = new WeakMap<Library, ReadonlyMap<string, LibrarySymbol>>();
  ctx.librarySymbols = librarySymbols;
  /// Le copie dei simboli del pannello, per riquadro, con la versione da cui
  /// vengono.
  const symbolCopies = new Map<string, { readonly version: string; readonly copy: SymbolCopy | null }>();
  ctx.symbolCopies = symbolCopies;
  /// Le anteprime, per riquadro.
  const symbolPictures = new Map<string, SymbolPictureEntry>();
  ctx.symbolPictures = symbolPictures;
  ctx.pictureQueue = Promise.resolve();
  relabels.push(() => {
    ctx.symbolsShown = null;
    symbolsPanel.relabel();
    ctx.syncSymbols();
  });

  // Gli attributi dell'oggetto scelto, dal livello Esperto: chiusi finché
  // qualcuno non li apre, sotto l'albero se è aperto anche quello.
  const inspector = createInspector(life, {
    onSet: (subject, key, value) => {
      const change = attributeOps(ctx.settledSubject(subject), key, value, ctx.newIds());
      return ctx.changeObject("draw.action.attribute", change.ops, change.id);
    },
    onRename: (subject, next) => ctx.changeObject("draw.action.rename", renameOps(ctx.settledSubject(subject), next, ctx.engine.model), next),
    taken: (id) => ctx.engine.holder(id) !== null,
    cited: (id) => ctx.cited(id),
    held: (id) => ctx.engine.model !== null && heldNamer(ctx.engine.model, id),
    announce: (text) => ctx.announce(text),
    onLeave: () => surface.focus({ preventScroll: true }),
  });
  ctx.inspector = inspector;
  inspector.element.hidden = true;
  relabels.push(() => inspector.relabel());

  // Le proprietà della selezione, o del disegno, dal livello Standard: un
  // pannello accanto al foglio, che si apre da sé se c'è posto. Al livello
  // Esperto ospita gli attributi, come una sua sezione.
  const panel = createProperties(life, {
    closed: ctx.grid.closed as readonly SectionId[],
    onChange: (id, value) => ctx.changeField(id, value),
    onAction: (id) => ctx.runAction(id),
    onTransform: (values) => ctx.transformFields(values),
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
      onMotif: () => ctx.motifFromSelection(),
      motifReason: () => ctx.motifReason(),
      onRename: (id, name) => ctx.renameMotif(id, name),
      onDelete: (id) => ctx.deleteMotif(id),
    },
    connector: {
      onChange: (change, label) => ctx.changeConnector(change, label),
    },
    effects: {
      onChange: (change, label) => ctx.changeEffects(change, label),
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
  const boardsButton = button(viewGroup, "draw-button", () => t("draw.boards"), "draw-boards", () => ctx.showBoards(boardsPanel.element.hidden));
  ctx.boardsButton = boardsButton;
  boardsButton.setAttribute("aria-expanded", "false");
  boardsButton.setAttribute("aria-controls", boardsPanel.element.id);
  // Le forme, dal livello Standard.
  const libraryButton = button(viewGroup, "draw-button", () => t("draw.library"), "draw-library", () => ctx.showLibrary(libraryPanel.element.hidden));
  ctx.libraryButton = libraryButton;
  libraryButton.setAttribute("aria-expanded", "false");
  libraryButton.setAttribute("aria-controls", libraryPanel.element.id);
  // I simboli, dal livello Esperto.
  const symbolsButton = button(viewGroup, "draw-button", () => t("draw.symbols.title"), "draw-symbols", () => ctx.showSymbols(symbolsPanel.element.hidden));
  ctx.symbolsButton = symbolsButton;
  symbolsButton.setAttribute("aria-expanded", "false");
  symbolsButton.setAttribute("aria-controls", symbolsPanel.element.id);
  const objectsButton = button(viewGroup, "draw-button", () => t("draw.objects"), "outline", () => ctx.showObjects(tree.element.hidden));
  ctx.objectsButton = objectsButton;
  objectsButton.setAttribute("aria-expanded", "false");
  objectsButton.setAttribute("aria-controls", tree.element.id);
  const historyButton = button(viewGroup, "draw-button", () => t("draw.history"), "draw-history", () => ctx.showHistory(historyPanel.element.hidden));
  ctx.historyButton = historyButton;
  historyButton.setAttribute("aria-expanded", "false");
  historyButton.setAttribute("aria-controls", historyPanel.element.id);
  const accessButton = button(viewGroup, "draw-button", () => t("draw.access"), "draw-access", () => ctx.showAccess(accessPanel.element.hidden));
  ctx.accessButton = accessButton;
  accessButton.setAttribute("aria-expanded", "false");
  accessButton.setAttribute("aria-controls", accessPanel.element.id);
  // Gli attributi, dal livello Esperto.
  const attributesButton = button(viewGroup, "draw-button", () => t("draw.attributes"), "draw-attributes", () => ctx.showAttributes(inspector.element.hidden));
  ctx.attributesButton = attributesButton;
  attributesButton.setAttribute("aria-expanded", "false");
  attributesButton.setAttribute("aria-controls", inspector.element.id);
  attributesButton.setAttribute("aria-keyshortcuts", ariaBinding(ATTRIBUTES_BINDING));
  relabels.push(() => {
    attributesButton.title = `${t("draw.attributes")} (${displayBinding(ATTRIBUTES_BINDING)})`;
  });
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
  relabels.push(() => {
    titleText.textContent = t(folio === undefined ? "draw.title" : "draw.sheet.title");
    titleInput.placeholder = t(folio === undefined ? "draw.title.placeholder" : "draw.sheet.title.placeholder");
  });
}
