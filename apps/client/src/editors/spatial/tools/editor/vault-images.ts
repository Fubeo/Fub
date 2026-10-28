// L'editor del disegno: le immagini del vault. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { showContextMenu } from "../../../../ui/menu";
import { t } from "../../strings";
import { nextTurn } from "../../view";
import { carriesFiles, type Decoded } from "../images";
import { toolForKey, type Feature, type ToolSpec } from "../registry";
import { ROTATE_STEP, ZOOM_STEP } from "./constants";
import type { Edge } from "../arrange";
import type { EditorContext } from "./context";
import type { NodeCommand } from "./types";

const ROTATE_STEP_SHIFT = 90;

/// Fra Ctrl+Maiusc+V e l'incolla che il browser manda dietro, al più tanti
/// millisecondi.
const IN_PLACE_MS = 1000;

/// Alt con queste lettere, per posizione, allinea la selezione.
const ALIGN_KEYS: Readonly<Record<string, Edge>> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "top",
  KeyS: "bottom",
};

const NODE_COMMANDS: Readonly<Record<string, NodeCommand>> = {
  c: "corner",
  s: "smooth",
  y: "symmetric",
  l: "line",
  u: "curve",
  b: "break",
  j: "join",
};

/// Ciò che le immagini del vault dà agli altri pezzi dell'editor.
export interface VaultImagesContext {
  insertsImages: (at: ReadonlySet<Feature>) => boolean;
  vaultImage: () => Promise<void>;
}

/// Monta le immagini del vault.
export function installVaultImages(ctx: EditorContext): void {
  const {
    life, folio, has, root, surface, selectionButton, tree, historyPanel, accessPanel, boardsPanel, libraryPanel, symbolsPanel, inspector, panel,
    titleInput, opacityInput, nodesBar, textLayer, textInput, describeBar, pathsBar, traceBar, cropBar, boardsNow, editable, currentIndex, announce,
    announceSelection, sceneAt, zoomBy, turnView, fit, selectedUnits, curveOn, chosenCount, showHandles, renameSelection, showAttributes, nestedNow,
    focusAttributes, focusTransform, undo, redo, deleteSelection, select, leaveIsolation, isolateSelection, pickTool, cancelGesture, drawInk, drawShape,
    polygonKey, rotateSelection, selectUpdate, boardUpdate, duplicateSheet, removeBoard, renameBoard, visitBoard, stepBoard, leaveBoard, builderNow,
    builderKeysOn, visitRegion, pickRegion, buildChosen, pickedWidth, widthKeysOn, deleteWidthPoint, widthDialog, takeAt, gradientNow, gradientUpdate,
    gradientKeysOn, gradientEntries, visitGradient, deleteGradientStop, insertGradientStop, unpickGradient, editGradient, announceNodes, setNodes,
    nodesUpdate, editSelectedNote, keyboardAdd, drawHeld, drawing, showBezier, bezierUpdate, curveKindKey, curveDelete, finishBezier, deleteBezierNode,
    radialHere, editLabel, editSelectedText, openText, finishText, cursorPoint, press, release, showRadial, duplicateSelection, orderSelection,
    groupSelection, ungroupSelection, linkSelection, unlinkSelection, openSelectedLink, menuPoint, flagSelection, transformDialog,
    joinSelection, cancelCrop, applyCrop, cropUpdate, maskSelection, releaseMasks, insertSelectedNodes, deleteSelectedNodes, joinSelectedNodes,
    runNodeCommand, changeGrid, focusArrange, nodeKeysOn, arrows, visit, nodeList, visitNode, selectAllNodes, walk, walkList, properties, keys, codec,
    placeImages, carriedBy, pasteCarried, copyStyle, pasteStyle, options
  } = ctx;
  // --- Le immagini del vault --------------------------------------------------

  /// Con le parti `at` l'editor inserisce immagini del vault: se le offrono,
  /// e chi lo monta le sa scegliere.
  function insertsImages(at: ReadonlySet<Feature>): boolean {
    return at.has("images") && options.images?.choose !== undefined;
  }
  ctx.insertsImages = insertsImages;

  /// Ctrl+I, o «Immagine dal vault…»: l'immagine che sceglie chi monta
  /// l'editor entra per riferimento, dove entrerebbe incollata e con la sua
  /// misura in pixel, scelta e con lo strumento della selezione. I byte si
  /// leggono soltanto per misurarla.
  async function vaultImage(): Promise<void> {
    const port = options.images;
    const choose = port?.choose;
    if (port === undefined || choose === undefined || ctx.asking || ctx.disposed) return;
    if (!insertsImages(ctx.features) || !editable()) return;
    if (codec === null) {
      announce(t("draw.image.unreadable"));
      return;
    }
    finishText();
    ctx.asking = true;
    cancelGesture();
    const loaded = ctx.loads;
    // Il posto è quello del cursore di adesso: la finestra prende il fuoco.
    const at = ctx.cursor;
    let decoded: Decoded | null = null;
    try {
      let href: string | null;
      try {
        href = await choose();
      } catch {
        // Chi sceglie dice da sé perché non ha potuto.
        href = null;
      }
      const gone = (): boolean => ctx.disposed || ctx.loads !== loaded || !editable();
      if (href === null || gone()) return;
      const blob = await port.read(href).catch(() => null);
      if (gone()) return;
      if (blob === null) {
        announce(t("draw.image.gone"));
        return;
      }
      decoded = await codec.decode(blob).catch(() => null);
      if (gone()) return;
      if (decoded === null) {
        announce(t("draw.image.unreadable"));
        return;
      }
      placeImages([{ width: decoded.width, height: decoded.height, href }], at);
    } finally {
      decoded?.close();
      ctx.asking = false;
    }
  }
  ctx.vaultImage = vaultImage;

  const onDragOver = (event: DragEvent): void => {
    if (!editable() || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
  };
  const onDrop = (event: DragEvent): void => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Un file lasciato qui non apre una pagina al posto della shell.
    event.preventDefault();
    if (!editable()) return;
    const carried = carriedBy(event.dataTransfer);
    if (carried === null) {
      announce(t("draw.drop.unreadable"));
      return;
    }
    void pasteCarried(carried, sceneAt(event.clientX, event.clientY), false);
  };
  // Anche sul campo del testo, che sta sopra il foglio: un'immagine lasciata
  // lì conclude il testo ed entra nel disegno.
  for (const target of [surface, textLayer]) {
    life.listen(target, "dragover", onDragOver);
    life.listen(target, "drop", onDrop);
  }

  /// Maiusc, Ctrl o ⌘, o Alt premuti o lasciati a metà gesto: la forma, lo
  /// spostamento e la cornice si ridisegnano subito.
  const onModifiers = (event: KeyboardEvent): void => {
    if (event.key === "Shift") ctx.shift = event.type === "keydown";
    else if (event.key === "Control" || event.key === "Meta") ctx.free = event.ctrlKey || event.metaKey;
    else if (event.key === "Alt") ctx.alt = event.type === "keydown";
    else return;
    if (ctx.current?.kind === "shape") drawShape(ctx.current);
    else if (ctx.current?.kind === "ink" && ctx.current.held !== null && event.key === "Shift") drawHeld(ctx.current);
    else if (ctx.current?.kind === "ink" && ctx.current.tool === "highlighter" && event.key === "Shift") drawInk(ctx.current);
    else if (ctx.current?.kind === "select" && (ctx.current.mode === "move" || ctx.current.mode === "resize" || ctx.current.mode === "rotate")) selectUpdate(ctx.current);
    // Maiusc o Alt a metà di un segno tirato: il ritaglio si rifà subito,
    // dall'ultimo punto del puntatore.
    else if (ctx.current?.kind === "crop" && ctx.current.dragging) cropUpdate(ctx.current);
    else if (ctx.current?.kind === "nodes" && ctx.current.dragging) nodesUpdate(ctx.current);
    else if (ctx.current?.kind === "bezier") bezierUpdate(ctx.current);
    else if (ctx.current?.kind === "board" && ctx.current.mode !== "pending") boardUpdate(ctx.current);
    else if (ctx.current?.kind === "gradient" && ctx.current.dragging) gradientUpdate(ctx.current);
    else if (ctx.hover !== null && drawing() !== null) showBezier();
    else if (ctx.current?.kind === "builder" || (ctx.current === null && ctx.regionHover >= 0)) showHandles();
    // Col contagocce Maiusc passa dall'aspetto al colore.
    else if (ctx.current?.kind === "dropper" || (ctx.current === null && ctx.dropperHover !== null)) showHandles();
    else if (ctx.current === null && (ctx.alt || ctx.measured)) showHandles();
  };

  life.listen(root, "keyup", onModifiers);
  life.listen(root, "keydown", (event) => {
    onModifiers(event);
    if (event.defaultPrevented || event.target === titleInput || event.target === textInput || event.target === opacityInput) return;
    // I campi del foglio, come il numero della pagina, tengono i loro tasti.
    if (event.target instanceof HTMLInputElement && folio?.controls?.contains(event.target) === true) return;
    // Esc ferma l'incolla in corso, da ogni parte dell'editor.
    if (event.key === "Escape" && ctx.pasting !== null) {
      ctx.pasting.stopped = true;
      event.preventDefault();
      return;
    }
    // I pannelli delle proprietà, degli attributi e dell'accessibilità, e i
    // campi dell'albero (la ricerca, il tipo e il nome), tengono i loro tasti: un `?` o un Canc
    // scritti in un valore restano lì, le frecce cambiano un numero, e un Canc
    // sul pulsante che toglie un attributo non toglie l'oggetto. Passano i
    // tasti che portano agli attributi e a «Trasforma» e, fuori da un campo
    // di testo, annulla e ripeti, raggruppa e separa.
    const treeField =
      (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) &&
      (tree.element.contains(event.target) || historyPanel.element.contains(event.target) || boardsPanel.element.contains(event.target));
    const inAccess = event.target instanceof Node && (accessPanel.element.contains(event.target) || describeBar.contains(event.target) || pathsBar.contains(event.target) || traceBar.contains(event.target) || cropBar.contains(event.target));
    if (event.target instanceof Node && (inspector.element.contains(event.target) || panel.element.contains(event.target) || libraryPanel.element.contains(event.target) || symbolsPanel.element.contains(event.target) || treeField || inAccess)) {
      const key = event.key.toLowerCase();
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (!(mod && (((key === "x" || key === "m") && event.shiftKey) || (!field && (key === "z" || key === "g" || (key === "y" && !event.shiftKey)))))) return;
    }
    const onSurface = event.target === surface;
    const inNodesBar = event.target instanceof Node && nodesBar.contains(event.target);
    const inTree = event.target instanceof Node && tree.element.contains(event.target);
    // Mentre si disegna un poligono, le frecce e i tasti di pagina sono suoi.
    if (ctx.current?.kind === "shape" && ctx.current.tool === "polygon" && !event.ctrlKey && !event.metaKey && !event.altKey && polygonKey(event)) {
      event.preventDefault();
      return;
    }
    if (onSurface && !event.altKey && arrows(event)) {
      event.preventDefault();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    // «#» e «%» valgono come si scrivono, anche con AltGr, che su Windows
    // arriva come Ctrl e Alt insieme.
    const altGraph = typeof event.getModifierState === "function" && event.getModifierState("AltGraph");
    // `[` e `]` ruotano la selezione, `{` e `}` di un angolo retto: come si
    // scrivono, anche con AltGr; con Ctrl o ⌘ cambiano l'ordine.
    // Con la Penna e l'Evidenziatore `[` e `]` cambiano la punta (P4).
    if ((event.key === "[" || event.key === "]") && onSurface && (altGraph || !mod) && ctx.stepNib(event.key === "[" ? -1 : 1)) {
      event.preventDefault();
      return;
    }
    const turn = { "[": -ROTATE_STEP, "]": ROTATE_STEP, "{": -ROTATE_STEP_SHIFT, "}": ROTATE_STEP_SHIFT }[event.key];
    if (turn !== undefined && onSurface && (altGraph || !mod) && ctx.tool !== "nodes" && ctx.tool !== "bezier") {
      if (ctx.current !== null || ctx.pressed !== null || ctx.selection.length === 0 || !editable()) return;
      rotateSelection(turn);
      event.preventDefault();
      return;
    }
    if ((event.key === "#" || event.key === "%") && (altGraph || !mod) && has("grid")) {
      if (event.key === "#") changeGrid({ ...ctx.grid, shown: !ctx.grid.shown });
      else changeGrid({ ...ctx.grid, snap: !ctx.grid.snap });
      event.preventDefault();
      return;
    }
    // Maiusc+R mostra e nasconde i righelli; «|», come si scrive, le loro
    // guide.
    if (has("rulers") && !mod && !event.altKey && event.shiftKey && event.key.toLowerCase() === "r") {
      changeGrid({ ...ctx.grid, rulers: !ctx.grid.rulers });
      event.preventDefault();
      return;
    }
    if (event.key === "|" && (altGraph || !mod) && has("rulers")) {
      changeGrid({ ...ctx.grid, rulerGuides: !ctx.grid.rulerGuides });
      event.preventDefault();
      return;
    }
    // I comandi della selezione prendono i loro tasti solo quando c'è una
    // selezione e il livello offre la loro parte: senza, Ctrl+D e gli altri
    // restano a chi li aveva. Raggruppa e separa li prendono anche senza
    // selezione, e dicono che non c'è niente di scelto: fuori dal disegno
    // `Ctrl+Maiusc+G` apre il grafo, e chi voleva separare un gruppo non
    // scelto si troverebbe altrove.
    const arranges = (feature: Feature): boolean => has(feature) && ctx.selection.length > 0 && editable();
    if (mod) {
      // Lo stile si copia e si incolla con Alt, la lettera per la sua
      // posizione dove Alt ne scrive un'altra (⌥C è «ç»).
      const letter = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.code === "KeyC" ? "c" : event.code === "KeyV" ? "v" : "";
      if (event.altKey && !event.shiftKey && (letter === "c" || letter === "v") && has("style")) {
        if (letter === "c") copyStyle();
        else pasteStyle();
        event.preventDefault();
        return;
      }
      // Ctrl+7 crea la maschera di ritaglio, Ctrl+Alt+7 la rilascia, come
      // in Illustrator: il 7 per posizione, e non con AltGr, che lì scrive
      // una graffa.
      if (event.code === "Digit7" && !event.shiftKey && !altGraph && arranges("masks")) {
        if (event.altKey) releaseMasks();
        else maskSelection("clip");
        event.preventDefault();
        return;
      }
      if (event.altKey) return;
      // Ctrl+/ cerca fra i comandi del disegno; sulla tastiera italiana la
      // barra si scrive con Maiusc.
      if (event.key === "/" || (event.code === "Slash" && !event.shiftKey)) {
        ctx.searchCommands();
        event.preventDefault();
        return;
      }
      const key = event.key.toLowerCase();
      // Ctrl+C, Ctrl+X e Ctrl+V sono del browser, che manda gli eventi degli
      // appunti; Ctrl+Maiusc+V chiede che l'incolla vada nello stesso punto.
      if (key === "v") ctx.inPlaceUntil = event.shiftKey ? event.timeStamp + IN_PLACE_MS : -Infinity;
      // Le parentesi quadre per posizione, dove le ha una tastiera americana:
      // su quella italiana sono «è» e «+», che si premono senza AltGr.
      const bracket = event.code === "BracketRight" || key === "]" || key === "}" ? 1 : event.code === "BracketLeft" || key === "[" || key === "{" ? -1 : 0;
      if (key === "z") {
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y" && !event.shiftKey && onSurface) {
        // Col foglio a fuoco Ctrl+Y è la vista dei contorni, come in
        // Illustrator; Ripeti resta Ctrl+Maiusc+Z.
        ctx.setOutline(!ctx.outline);
      } else if (key === "y" && !event.shiftKey) {
        redo();
      } else if (key === "a" && !event.shiftKey) {
        if (ctx.tool === "nodes" && ctx.pressed === null && has("nodes") && editable()) {
          selectAllNodes();
        } else {
          select(currentIndex().units.map((unit) => unit.key));
          announceSelection();
        }
      } else if (key === "x" && event.shiftKey && has("attributes")) {
        // Nel pannello, il tasto porta agli attributi e, da lì, torna al
        // foglio.
        if (!nestedNow()) showAttributes(ctx.toggles(inspector.element));
        else if (inspector.element.contains(document.activeElement)) surface.focus({ preventScroll: true });
        else focusAttributes();
      } else if (key === "m" && event.shiftKey && arranges("transform")) {
        if (!focusTransform()) void transformDialog();
      } else if (key === "d" && !event.shiftKey && ctx.tool === "board" && has("board") && editable()) {
        if (ctx.pressed === null && ctx.current === null) duplicateSheet();
      } else if (key === "d" && !event.shiftKey && arranges("arrange")) {
        duplicateSelection();
      } else if (key === "j" && !event.shiftKey && ctx.tool === "nodes" && nodeKeysOn() && chosenCount() > 0) {
        joinSelectedNodes();
      } else if (key === "j" && !event.shiftKey && arranges("path")) {
        joinSelection();
      } else if (key === "g" && has("arrange") && editable()) {
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (key === "i" && !event.shiftKey && insertsImages(ctx.features) && editable()) {
        void vaultImage();
      } else if (key === "k" && (event.shiftKey || options.links !== undefined) && arranges("links")) {
        if (event.shiftKey) unlinkSelection();
        else void linkSelection();
      } else if (bracket !== 0 && arranges("arrange")) {
        if (bracket > 0) orderSelection(event.shiftKey ? "front" : "forward");
        else orderSelection(event.shiftKey ? "back" : "backward");
      } else if (key === "enter" && !event.shiftKey && has("selection") && ctx.selection.length > 0) {
        if (ctx.pressed !== null || ctx.current !== null) return;
        isolateSelection();
      } else if ((key === "l" || key === "h") && event.shiftKey && arranges("selection") && !inTree) {
        flagSelection(key === "l" ? "locked" : "hidden");
      } else if (key === "0" && !event.shiftKey && onSurface) {
        // Col foglio a fuoco Ctrl+0 è il 100% del disegno, come «0»; col
        // fuoco altrove resta lo zoom dello Scrittoio.
        zoomBy(1 / ctx.camera.scale);
      } else if (event.key === "'" && has("grid")) {
        changeGrid({ ...ctx.grid, shown: !ctx.grid.shown });
      } else if (event.key === ";" && has("rulers")) {
        // Il punto e virgola come si scrive: sulla tastiera italiana con Maiusc.
        changeGrid({ ...ctx.grid, rulerGuides: !ctx.grid.rulerGuides });
      } else if (key === "u" && !event.shiftKey && has("guides")) {
        changeGrid({ ...ctx.grid, guides: !ctx.grid.guides });
      } else if (event.key === "." && !event.shiftKey) {
        ctx.setBare(!ctx.bare);
      } else {
        return;
      }
      event.preventDefault();
      return;
    }
    if (event.altKey) {
      if (onSurface && event.key === "Enter" && !event.shiftKey && options.links !== undefined) {
        if (ctx.pressed !== null) return;
        if (!openSelectedLink()) announce(t("draw.link.open.none"));
      } else if (onSurface && (event.key === "PageUp" || event.key === "PageDown") && !event.shiftKey && has("board")) {
        if (ctx.pressed !== null || ctx.current !== null) return;
        stepBoard(event.key === "PageDown" ? 1 : -1);
      } else if (onSurface && !event.shiftKey && ALIGN_KEYS[event.code] !== undefined && arranges("arrange")) {
        // Alt con A, D, W e S allinea, per posizione come le frecce di un
        // gioco; Alt con H e V centra, e con Maiusc distribuisce.
        if (ctx.pressed !== null || ctx.current !== null) return;
        ctx.alignSelection(ALIGN_KEYS[event.code]!);
      } else if (onSurface && (event.code === "KeyH" || event.code === "KeyV") && arranges("arrange")) {
        if (ctx.pressed !== null || ctx.current !== null) return;
        if (event.shiftKey) ctx.distributeSelection(event.code === "KeyH" ? "x" : "y");
        else ctx.alignSelection(event.code === "KeyH" ? "center" : "middle");
      } else if (event.key !== "F10" || event.shiftKey || !focusArrange()) {
        return;
      }
      event.preventDefault();
      return;
    }
    // Maiusc+F10, o il tasto del menu: il menu del clic destro, sotto la
    // selezione o al cursore, che con gli strumenti che disegnano offre in
    // fondo il menu radiale. Senza il menu della selezione, il radiale.
    const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
    if (onSurface && menuKey && radialHere() && !has("selection")) {
      if (ctx.current !== null || ctx.pressed !== null) return;
      event.preventDefault();
      ctx.keyedMenu = event.timeStamp;
      const at = menuPoint();
      showRadial(at.clientX, at.clientY, null, true);
      return;
    }
    if (onSurface && menuKey && has("selection")) {
      if (ctx.current !== null || ctx.pressed !== null) return;
      event.preventDefault();
      ctx.keyedMenu = event.timeStamp;
      const at = menuPoint();
      showContextMenu(at, ctx.canvasMenu(null, at), { labelledBy: selectionButton.id });
      return;
    }
    if (onSurface && event.key === "Tab") {
      if (!walk(event.shiftKey ? -1 : 1)) return;
    } else if (onSurface && (event.key === "PageUp" || event.key === "PageDown") && !event.shiftKey && folio !== undefined) {
      if (ctx.pressed !== null || ctx.current !== null) return;
      folio.turn(event.key === "PageDown" ? 1 : -1);
    } else if (onSurface && (event.key === "PageUp" || event.key === "PageDown") && arranges("arrange")) {
      if (ctx.pressed !== null) return;
      if (event.key === "PageUp") orderSelection(event.shiftKey ? "front" : "forward");
      else orderSelection(event.shiftKey ? "back" : "backward");
    } else if (onSurface && (event.key === "Home" || event.key === "End") && nodeKeysOn()) {
      visitNode(event.key === "Home" ? 0 : nodeList().length - 1);
    } else if (onSurface && (event.key === "Home" || event.key === "End") && gradientKeysOn()) {
      const read = gradientNow()!;
      visitGradient(event.key === "Home" ? 0 : gradientEntries(read).length - 1);
    } else if (onSurface && (event.key === "Home" || event.key === "End") && builderKeysOn()) {
      visitRegion(event.key === "Home" ? 0 : builderNow()!.regions.regions.length - 1);
    } else if (onSurface && (event.key === "Home" || event.key === "End") && ctx.tool === "board") {
      if (ctx.pressed !== null || !visitBoard(event.key === "Home" ? 0 : boardsNow().length - 1)) return;
    } else if (onSurface && (event.key === "Home" || event.key === "End")) {
      const units = walkList(ctx.selection.length === 0 ? null : currentIndex().get(ctx.selection[0]!));
      if (ctx.pressed !== null || !visit(units, event.key === "Home" ? 0 : units.length - 1)) return;
    } else if (onSurface && event.key === " ") {
      if (event.repeat) {
        // Tenuto giù: un tasto, un passo.
      } else if (ctx.pressed === null && ctx.tool === "text") openText(cursorPoint(), "mouse");
      // Il contagocce prende subito; con Maiusc il solo colore.
      else if (ctx.pressed === null && ctx.tool === "eyedropper") void takeAt(cursorPoint(), "mouse", event.shiftKey);
      else if (builderKeysOn()) pickRegion();
      else if (ctx.pressed === null) press(event.timeStamp);
      else release();
    } else if (onSurface && event.key === "F2" && folio !== undefined) {
      if (ctx.pressed !== null || !editSelectedNote()) return;
    } else if (onSurface && event.key === "F2" && ctx.tool === "board") {
      if (ctx.pressed !== null) return;
      void renameBoard();
    } else if (onSurface && event.key === "F2" && (has("text") || has("layers"))) {
      if (ctx.pressed !== null) return;
      // Un testo si scrive, e così l'etichetta di una forma chiusa; un altro
      // oggetto, coi livelli, si rinomina.
      const units = selectedUnits();
      const text = units.length === 1 && units[0]!.look !== null;
      if (units.length === 1 && !text && editLabel(units[0]!)) {
        // L'etichetta della forma scelta, nuova o da cambiare.
      } else if (has("layers") && editable() && !(text && has("text"))) renameSelection();
      else editSelectedText();
    } else if (onSurface && event.key === "Enter") {
      if (ctx.pressed !== null) release();
      else if (ctx.cropping !== null) {
        // A metà gesto il ritaglio aspetta che il gesto finisca.
        if (ctx.current === null) applyCrop();
      } else if (drawing() !== null) {
        // A metà gesto il tracciato aspetta che il gesto finisca, come per
        // Canc.
        if (ctx.current === null) finishBezier(false);
      } else if (builderKeysOn() && buildChosen(false)) {
        // Col Costruttore, le regioni scelte si uniscono.
      } else if (widthKeysOn()) {
        // Con lo Spessore, le misure del punto scelto.
        void widthDialog();
      } else if (gradientKeysOn() && has("properties")) {
        // Con lo strumento Sfumatura, il colore del punto scelto.
        editGradient();
      } else if (folio === undefined) {
        void properties();
      } else if (ctx.selection.length > 0) {
        // Sul foglio una nota scelta si cambia, e il resto mostra le sue
        // proprietà; senza niente di scelto, Invio aggiunge: il foglio non
        // ha le proprietà di un disegno.
        if (!editSelectedNote()) void properties();
      } else if (ctx.current === null) {
        keyboardAdd();
      }
    } else if (onSurface && event.key === "F5" && !mod && !event.altKey && ctx.has("present")) {
      ctx.present(event.shiftKey ? ctx.currentBoard()?.id ?? null : null);
    } else if (event.key === "?") {
      void keys();
    } else if ((event.key === "Delete" || event.key === "Backspace") && builderKeysOn() && buildChosen(true)) {
      // Col Costruttore Canc toglie le regioni scelte; senza, l'oggetto.
    } else if ((event.key === "Delete" || event.key === "Backspace") && nodeKeysOn()) {
      // Con lo strumento Nodi Canc elimina i nodi, mai l'oggetto.
      deleteSelectedNodes();
    } else if ((event.key === "Delete" || event.key === "Backspace") && widthKeysOn()) {
      // Con lo Spessore, il punto scelto, mai l'oggetto.
      if (ctx.pressed !== null || ctx.current !== null) return;
      deleteWidthPoint();
    } else if ((event.key === "Delete" || event.key === "Backspace") && gradientKeysOn()) {
      // Con lo strumento Sfumatura, il punto scelto, mai l'oggetto.
      if (ctx.current !== null) return;
      deleteGradientStop();
    } else if ((event.key === "Delete" || event.key === "Backspace") && curveOn() && ctx.pressed === null && ctx.current === null && chosenCount() > 0) {
      // Con la Curvatura, i nodi scelti, e la curva si rifà.
      curveDelete();
    } else if ((event.key === "Delete" || event.key === "Backspace") && drawing() !== null) {
      // Con la penna di Bézier, l'ultimo nodo del tracciato.
      if (ctx.current !== null) return;
      deleteBezierNode(drawing()!);
    } else if ((event.key === "Delete" || event.key === "Backspace") && ctx.tool === "board" && ctx.selection.length === 0) {
      // Con lo strumento Tavola, la tavola scelta; il disegno resta.
      if (ctx.pressed !== null || ctx.current !== null) return;
      removeBoard();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (ctx.selection.length === 0) return;
      deleteSelection();
    } else if (event.key === "Insert" && !event.shiftKey && nodeKeysOn() && (onSurface || inNodesBar)) {
      insertSelectedNodes();
    } else if (event.key === "Insert" && !event.shiftKey && onSurface && gradientKeysOn()) {
      if (ctx.current !== null) return;
      insertGradientStop();
    } else if (event.shiftKey && onSurface && (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "s") && ctx.tool === "bezier" && ctx.curvature && drawing() !== null) {
      // Con la Curvatura, il punto sotto il cursore, o l'ultimo, a spigolo
      // o liscio: le lettere dello strumento Nodi.
      if (ctx.current !== null || ctx.pressed !== null) return;
      curveKindKey(event.key.toLowerCase() === "c" ? "corner" : "smooth");
    } else if (event.shiftKey && NODE_COMMANDS[event.key.toLowerCase()] !== undefined && nodeKeysOn() && (onSurface || inNodesBar)) {
      runNodeCommand(NODE_COMMANDS[event.key.toLowerCase()]!);
    } else if (event.shiftKey && onSurface && (event.code === "KeyH" || event.code === "KeyV") && ctx.selection.length > 0 && editable()) {
      // Maiusc+H e Maiusc+V riflettono la selezione, come in Illustrator e Figma.
      if (ctx.current !== null || ctx.pressed !== null) return;
      ctx.flipSelection(event.code === "KeyH" ? "x" : "y");
    } else if (event.key === "Escape") {
      if (ctx.current !== null) cancelGesture();
      else if (ctx.cropping !== null) cancelCrop();
      else if (drawing() !== null) {
        // Esc conclude il tracciato della penna, come conclude un testo: ciò
        // che si è disegnato non si perde, e Annulla lo toglie in un passo.
        finishBezier(false);
      } else if ((ctx.tool === "nodes" || curveOn()) && chosenCount() > 0) {
        setNodes(new Map());
        announceNodes();
      } else if (pickedWidth() !== null) {
        ctx.widthPicked = null;
        showHandles();
        announce(t("draw.width.unpicked"));
      } else if (gradientKeysOn() && unpickGradient()) {
        // Con lo strumento Sfumatura, il capo o il punto scelto si lascia.
      } else if (builderNow() !== null && (ctx.regionsChosen.length > 0 || ctx.regionActive >= 0)) {
        ctx.regionsChosen = [];
        ctx.regionActive = -1;
        showHandles();
        announce(t("draw.builder.cleared"));
      } else if (ctx.tool === "board" && ctx.selection.length === 0 && leaveBoard()) {
        // Con lo strumento Tavola, la tavola scelta si lascia.
      } else if (leaveIsolation(false)) {
        // Fuori di un gruppo, scelto quello da cui si è usciti.
      } else if (ctx.selection.length > 0) {
        select([]);
        announceSelection();
      } else return;
    } else if (event.shiftKey && event.code === "Digit1") {
      fit();
    } else if (event.shiftKey && event.code === "Digit2") {
      // Maiusc+2 inquadra la selezione.
      ctx.fitSelection();
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(ZOOM_STEP);
    } else if (event.key === "-") {
      zoomBy(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      zoomBy(1 / ctx.camera.scale);
    } else if ((event.key === "4" || event.key === "6") && has("gestures")) {
      turnView(nextTurn(ctx.camera.angle, event.key === "6" ? 1 : -1));
    } else if (event.key === "5" && has("gestures")) {
      turnView(0);
    } else {
      const spec: ToolSpec | null = toolForKey(ctx.tools, event.key, event.shiftKey);
      if (spec === null || !editable()) return;
      pickTool(spec.id);
    }
    event.preventDefault();
  });
}
