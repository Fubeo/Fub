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

/// Ciò che le immagini del vault dà agli altri pezzi dell'editor.
export interface VaultImagesContext {
  insertsImages: (at: ReadonlySet<Feature>) => boolean;
  vaultImage: () => Promise<void>;
}

/// Monta le immagini del vault.
export function installVaultImages(ctx: EditorContext): void {
  const {
    life, folio, has, root, surface, selectionButton, tree, historyPanel, accessPanel, panel,
    titleInput, opacityInput, describeBar, editable, currentIndex, announce,
    announceSelection, sceneAt, zoomBy, turnView, fit, renameSelection, undo, redo, deleteSelection, select, leaveIsolation, isolateSelection, pickTool, cancelGesture, drawInk, drawShape,
    rotateSelection, selectUpdate, editSelectedNote, keyboardAdd, drawHeld, radialHere, press, release, showRadial, duplicateSelection, orderSelection,
    groupSelection, ungroupSelection, linkSelection, unlinkSelection, openSelectedLink, menuPoint, flagSelection, changeGrid, focusArrange, arrows, visit, walk, walkList, properties, keys, codec,
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
  life.listen(surface, "dragover", onDragOver);
  life.listen(surface, "drop", onDrop);

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
  };

  life.listen(root, "keyup", onModifiers);
  life.listen(root, "keydown", (event) => {
    onModifiers(event);
    if (event.defaultPrevented || event.target === titleInput || event.target === opacityInput) return;
    // I campi del foglio, come il numero della pagina, tengono i loro tasti.
    if (event.target instanceof HTMLInputElement && folio?.controls?.contains(event.target) === true) return;
    // Esc ferma l'incolla in corso, da ogni parte dell'editor.
    if (event.key === "Escape" && ctx.pasting !== null) {
      ctx.pasting.stopped = true;
      event.preventDefault();
      return;
    }
    // I pannelli delle proprietà e dell'accessibilità, e i campi
    // dell'albero (la ricerca, il tipo e il nome), tengono i loro tasti: un
    // `?` o un Canc scritti in un valore restano lì, e le frecce cambiano un
    // numero. Passano, fuori da un campo di testo, annulla e ripeti,
    // raggruppa e separa.
    const treeField =
      (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) &&
      (tree.element.contains(event.target) || historyPanel.element.contains(event.target));
    const inAccess = event.target instanceof Node && (accessPanel.element.contains(event.target) || describeBar.contains(event.target));
    if (event.target instanceof Node && (panel.element.contains(event.target) || treeField || inAccess)) {
      const key = event.key.toLowerCase();
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (!(mod && !field && (key === "z" || key === "g" || (key === "y" && !event.shiftKey)))) return;
    }
    const onSurface = event.target === surface;
    const inTree = event.target instanceof Node && tree.element.contains(event.target);
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
    if (turn !== undefined && onSurface && (altGraph || !mod)) {
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
        select(currentIndex().units.map((unit) => unit.key));
        announceSelection();
      } else if (key === "d" && !event.shiftKey && arranges("arrange")) {
        duplicateSelection();
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
      showContextMenu(at, ctx.canvasMenu(at), { labelledBy: selectionButton.id });
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
    } else if (onSurface && (event.key === "Home" || event.key === "End")) {
      const units = walkList(ctx.selection.length === 0 ? null : currentIndex().get(ctx.selection[0]!));
      if (ctx.pressed !== null || !visit(units, event.key === "Home" ? 0 : units.length - 1)) return;
    } else if (onSurface && event.key === " ") {
      if (event.repeat) {
        // Tenuto giù: un tasto, un passo.
      } else if (ctx.pressed === null) press(event.timeStamp);
      else release();
    } else if (onSurface && event.key === "F2" && folio !== undefined) {
      if (ctx.pressed !== null || !editSelectedNote()) return;
    } else if (onSurface && event.key === "F2" && has("layers")) {
      // Coi livelli, l'oggetto scelto si rinomina; un testo non si scrive
      // più sul posto (ADR 0231).
      if (ctx.pressed !== null || !editable()) return;
      renameSelection();
    } else if (onSurface && event.key === "Enter") {
      if (ctx.pressed !== null) release();
      else if (folio === undefined) {
        void properties();
      } else if (ctx.selection.length > 0) {
        // Sul foglio una nota scelta si cambia, e il resto mostra le sue
        // proprietà; senza niente di scelto, Invio aggiunge: il foglio non
        // ha le proprietà di un disegno.
        if (!editSelectedNote()) void properties();
      } else if (ctx.current === null) {
        keyboardAdd();
      }
    } else if (event.key === "?") {
      void keys();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (ctx.selection.length === 0) return;
      deleteSelection();
    } else if (event.shiftKey && onSurface && (event.code === "KeyH" || event.code === "KeyV") && ctx.selection.length > 0 && editable()) {
      // Maiusc+H e Maiusc+V riflettono la selezione, come in Illustrator e Figma.
      if (ctx.current !== null || ctx.pressed !== null) return;
      ctx.flipSelection(event.code === "KeyH" ? "x" : "y");
    } else if (event.key === "Escape") {
      if (ctx.current !== null) cancelGesture();
      else if (leaveIsolation(false)) {
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
