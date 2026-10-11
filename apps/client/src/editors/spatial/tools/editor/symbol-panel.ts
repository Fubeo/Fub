// L'editor del disegno: i simboli del pannello. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { promptForm } from "../../../../ui/form-dialog";
import { showContextMenu, type MenuItem } from "../../../../ui/menu";
import { stem, type LibraryState } from "../symbol-libraries";
import {
  LIBRARY_MAX_BYTES,
  libraryCopy,
  originSymbol,
  readOrigin,
  sheetPrint,
  symbolPicture,
  symbolSheet,
  updateChanges,
  updateOps,
  type Library,
  type LibrarySymbol,
  type Origin,
  type SymbolCopy,
  type SymbolSheet,
} from "../symbol-library";
import { symbolUpdateDialog } from "../symbol-update-dialog";
import { resolveAgainst } from "../../../../rules/mirrored";
import { selfContained } from "../../picture";
import type { Bounds } from "../../scene/geometry";
import { compose, IDENTITY, translate, type Point } from "../../scene/matrix";
import type { DocumentModel } from "../../scene/model";
import type { Op } from "../../scene/ops";
import { t, type DrawKey } from "../../strings";
import { addOp, gesture as asGesture, NewIds, roundDelta, transformValue, type Destination } from "../edit";
import { symbolLabel } from "../fields";
import { documentSymbols, instanceCounts, isInstance, renameSymbolOps, symbolNameProblem, type DocumentSymbol } from "../symbols";
import { snapDelta } from "../grid";
import { toScene } from "../../view";
import type { Unit } from "../hit";
import { refKey, type SymbolRef, type SymbolSection, type SymbolsView, type SymbolTile } from "../symbols-panel";
import { cleanName, NAME_MAX } from "../naming";
import { allUnits } from "../selecting";
import type { EditorContext } from "./context";
import { translated } from "./helpers";
import type { SymbolDrag, SymbolPictureEntry } from "./types";

/// Quanti byte delle immagini del vault entrano nell'anteprima di un simbolo
/// del pannello: oltre, un'immagine si vede come il segnaposto.
const SYMBOL_IMAGE_BYTES = 16 * 1024 * 1024;

/// Il riquadro di un simbolo che non si copia: un punto, attorno all'origine.
const NO_FRAME: Bounds = { min: [-0.5, -0.5], max: [0.5, 0.5] };

/// Ciò che i simboli del pannello dà agli altri pezzi dell'editor.
export interface SymbolPanelContext {
  symbolPictureUrl: (ref: SymbolRef, version: string) => Promise<string | null>;
  syncSymbols: () => void;
  insertSymbol: (ref: SymbolRef, box?: Bounds | null, land?: boolean) => Promise<void>;
  cancelSymbolDrag: (said?: boolean) => void;
  startSymbolDrag: (ref: SymbolRef, event: PointerEvent) => void;
  symbolMenu: (ref: SymbolRef, at: MouseEvent | HTMLElement, labelledBy: string) => void;
}

/// Monta i simboli del pannello.
export function installSymbolPanel(ctx: EditorContext): void {
  const {
    life, pictureFonts, root, surface, symbolLibraries, symbolsPanel, librarySymbols, symbolCopies, symbolPictures, previewLayer, editable, currentIndex,
    grownPage, newIds, announce, objects, announceSelection, stepNow, sceneAt, viewCenter, showHandles, showShape, commit, select, editSymbol, frameBounds,
    setTool, cancelGesture, target, gridOn, guidesOn, guidesFor, snappedDelta, onSheet, options
  } = ctx;
  // --- I simboli del pannello -------------------------------------------------
  //
  // Un simbolo del pannello entra come una forma: con un clic, o con Invio,
  // al centro di ciò che si vede, come un incolla; tirato fuori dal
  // pannello, dove lo si lascia, agganciato come un oggetto spostato e con
  // la sua anteprima sotto il puntatore. Un simbolo del disegno entra come
  // una sua istanza, in un passo. Uno di una libreria entra come la sua
  // copia, il simbolo con ciò che usa e un'istanza, in un passo; se il
  // disegno lo ha già dalla stessa libreria entra un'istanza del suo, e se
  // la libreria l'ha cambiato lo si dice. Le anteprime sono le copie dei
  // simboli, fatte una alla volta quando un riquadro sta per vedersi, e
  // tenute finché il simbolo non cambia.

  /// I testi dei simboli del disegno `model`, quello del motore, letti una
  /// volta per testo.
  function sheetNow(model: DocumentModel): SymbolSheet {
    const text = ctx.engine.text;
    if (ctx.drawingSheet?.text !== text) ctx.drawingSheet = { text, sheet: symbolSheet(model) };
    return ctx.drawingSheet.sheet;
  }

  /// Il simbolo `id` di `library`; `null` se non lo ha.
  function symbolIn(library: Library, id: string): LibrarySymbol | null {
    let byId = librarySymbols.get(library);
    if (byId === undefined) {
      byId = new Map(library.symbols.map((symbol) => [symbol.id, symbol]));
      librarySymbols.set(library, byId);
    }
    return byId.get(id) ?? null;
  }

  /// La libreria letta di `ref`; `null` per un simbolo del disegno, o per
  /// una libreria che non si è letta.
  const libraryOf = (ref: SymbolRef): Library | null => (ref.kind === "library" ? (symbolLibraries?.library(ref.path) ?? null) : null);

  /// La versione di `ref` adesso, la sua impronta; `null` se non c'è più.
  const versionOf = (ref: SymbolRef): string | null => {
    if (ref.kind === "library") {
      const library = libraryOf(ref);
      return library === null ? null : (symbolIn(library, ref.id)?.print ?? null);
    }
    const model = ctx.engine.model;
    if (model === null) return null;
    const sheet = sheetNow(model);
    return sheet.texts(ref.id) === undefined ? null : sheetPrint(sheet, ref.id);
  };

  /// La copia di `ref`: di un simbolo del disegno, quella della sua
  /// anteprima; di uno di una libreria, quella da incollare, coi suoi
  /// `fub:source`. `null` se il simbolo non c'è più, o non si copia.
  const copyOf = (ref: SymbolRef): SymbolCopy | null => {
    const version = versionOf(ref);
    if (version === null) return null;
    const key = refKey(ref);
    const known = symbolCopies.get(key);
    if (known?.version === version) return known.copy;
    const library = libraryOf(ref);
    const copy = library === null ? symbolPicture(sheetNow(ctx.engine.model!), ref.id) : libraryCopy(library, ref.id);
    symbolCopies.set(key, { version, copy });
    return copy;
  };

  /// Toglie l'anteprima di `key`, e il suo URL quando arriva.
  const dropPicture = (key: string): void => {
    const known = symbolPictures.get(key);
    if (known === undefined) return;
    symbolPictures.delete(key);
    void known.url.then((url) => {
      if (url !== null) URL.revokeObjectURL(url);
    });
  };
  life.add(() => {
    for (const key of [...symbolPictures.keys()]) dropPicture(key);
  });

  let pictureTimer: ReturnType<typeof setTimeout> | undefined;
  life.add(() => clearTimeout(pictureTimer));
  const breathe = (): Promise<void> =>
    new Promise((resolve) => {
      pictureTimer = setTimeout(resolve, 0);
    });

  /// Come si leggono le immagini del vault che la copia di `ref` cita: per
  /// un simbolo di una libreria gli `href` partono dalla libreria, e
  /// arrivano al disegno attraverso il vault.
  const imagesOf = (ref: SymbolRef): ((path: string, limit: number) => Promise<Blob | null>) => {
    const port = options.images;
    const place = options.place;
    if (port === undefined) return () => Promise.resolve(null);
    if (ref.kind === "drawing") return (path) => port.read(path);
    return (path) => {
      const doc = resolveAgainst(ref.path, path);
      return doc === null || place === undefined ? Promise.resolve(null) : port.read(place.refer(doc));
    };
  };

  /// L'anteprima di `ref` alla versione `version`: un URL, o `null` se non
  /// si fa. Le immagini del vault ci entrano coi loro byte, e i caratteri
  /// anche: un `img` non legge niente da fuori.
  function symbolPictureUrl(ref: SymbolRef, version: string): Promise<string | null> {
    const key = refKey(ref);
    const known = symbolPictures.get(key);
    if (known?.version === version) return known.url;
    dropPicture(key);
    const make = async (): Promise<string | null> => {
      if (ctx.disposed || versionOf(ref) !== version) return null;
      const copy = copyOf(ref);
      if (copy === null) return null;
      const svg = await selfContained(copy.svg, imagesOf(ref), SYMBOL_IMAGE_BYTES, pictureFonts).catch(() => null);
      return svg === null || ctx.disposed ? null : URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    };
    const url = ctx.pictureQueue.then(breathe).then(make).catch(() => null);
    ctx.pictureQueue = url;
    const entry: SymbolPictureEntry = { version, url, ready: null };
    symbolPictures.set(key, entry);
    void url.then((done) => {
      entry.ready = done;
    });
    return url;
  }
  ctx.symbolPictureUrl = symbolPictureUrl;

  /// Perché la sezione di una libreria non mostra simboli; `null` se ne ha.
  function libraryNote(state: LibraryState): string | null {
    if (state.kind === "reading") return t("draw.symbols.library.reading");
    if (state.kind === "read") return state.library.symbols.length === 0 ? t("draw.symbols.library.empty") : null;
    if (state.trouble === "too-large") return t("draw.symbols.library.too_large", { limit: ctx.sizeText(LIBRARY_MAX_BYTES) });
    return t(state.trouble === "not-drawing" ? "draw.symbols.library.not_drawing" : "draw.symbols.library.unreadable");
  }

  /// La riga in fondo al pannello: dove si cercano le librerie, e com'è
  /// andata.
  function librariesFooter(): string {
    const libraries = symbolLibraries;
    if (libraries === null) return "";
    const folder = libraries.folder;
    const none = libraries.entries.length === 0;
    if (!libraries.listed) return t(libraries.busy ? "draw.symbols.folder.reading" : "draw.symbols.folder.missing", { folder });
    if (folder === "") return t(none ? "draw.symbols.folder.root_empty" : "draw.symbols.folder.root");
    return t(none ? "draw.symbols.folder.empty" : "draw.symbols.folder", { folder });
  }

  /// Ciò che il pannello dei simboli mostra adesso: i simboli del disegno,
  /// poi una sezione per libreria.
  function symbolsView(): SymbolsView {
    const model = ctx.engine.model;
    const symbols = model === null ? [] : documentSymbols(model);
    const counts = model === null ? new Map<string, number>() : instanceCounts(model);
    // L'impronta con cui il disegno ha copiato ogni simbolo di una libreria:
    // il primo, come `originSymbol`.
    const copied = new Map<string, string>();
    const drawing = symbols.map((symbol): SymbolTile => {
      const origin = readOrigin(symbol.source);
      let stale = false;
      if (origin !== null) {
        const key = `${origin.path}#${origin.id}`;
        if (!copied.has(key)) copied.set(key, origin.print);
        const library = symbolLibraries?.library(origin.path) ?? null;
        const fresh = library === null ? null : symbolIn(library, origin.id);
        stale = fresh !== null && fresh.print !== origin.print;
      }
      return { ref: { kind: "drawing", id: symbol.id }, name: symbolLabel(symbol.name), version: sheetPrint(sheetNow(model!), symbol.id), uses: counts.get(symbol.id) ?? 0, stale };
    });
    const sections: SymbolSection[] = [{ key: "drawing", title: t("draw.symbols.here"), tiles: drawing, note: drawing.length === 0 ? t("draw.symbols.here.empty") : null }];
    for (const entry of symbolLibraries?.entries ?? []) {
      const { state } = entry;
      const tiles =
        state.kind !== "read"
          ? []
          : state.library.symbols.map((symbol): SymbolTile => {
              const print = copied.get(`${entry.path}#${symbol.id}`);
              return { ref: { kind: "library", path: entry.path, id: symbol.id }, name: symbolLabel(symbol.name), version: symbol.print, present: print !== undefined, stale: print !== undefined && print !== symbol.print };
            });
      sections.push({ key: entry.path, title: entry.name, tiles, note: libraryNote(state) });
    }
    return { editable: editable(), sections, footer: librariesFooter() };
  }

  /// Porta il pannello dei simboli al disegno e alle librerie di adesso, se
  /// è aperto e qualcosa è cambiato. Le copie e le anteprime dei simboli
  /// che non ci sono più se ne vanno.
  function syncSymbols(): void {
    if (symbolsPanel.element.hidden) return;
    const text = ctx.engine.text;
    const canEdit = editable();
    const shown = ctx.symbolsShown;
    if (shown !== null && shown.text === text && shown.round === ctx.librariesRound && shown.editable === canEdit) return;
    ctx.symbolsShown = { text, round: ctx.librariesRound, editable: canEdit };
    const view = symbolsView();
    const keys = new Set(view.sections.flatMap((section) => section.tiles.map((tile) => refKey(tile.ref))));
    for (const key of [...symbolCopies.keys()]) if (!keys.has(key)) symbolCopies.delete(key);
    for (const key of [...symbolPictures.keys()]) if (!keys.has(key)) dropPicture(key);
    symbolsPanel.update(view);
  }
  ctx.syncSymbols = syncSymbols;

  /// Il riquadro `frame` col centro su `at`, come lo mette un incolla: a
  /// centesimi, e con la griglia l'angolo in alto a sinistra sull'incrocio
  /// più vicino.
  const centredAt = (frame: Bounds, at: Point): Bounds => {
    let dx = roundDelta(at[0] - (frame.min[0] + frame.max[0]) / 2);
    let dy = roundDelta(at[1] - (frame.min[1] + frame.max[1]) / 2);
    if (gridOn()) {
      const [sx, sy] = snapDelta(translated(frame, dx, dy)!.min, 0, 0, stepNow());
      dx += sx;
      dy += sy;
    }
    return translated(frame, dx, dy)!;
  };

  /// Scrive in `to` un'istanza del simbolo `id` del disegno, che si chiama
  /// `name`, col riquadro `frame` della sua istanza nell'origine su `box`
  /// della scena, in un passo: scelta, e detta, con `more` dopo. Falso se il
  /// disegno non l'ha accettata.
  const placeInstance = (id: string, name: string, to: Destination, ids: NewIds, frame: Bounds, box: Bounds, more: string): boolean => {
    const instance = ids.next("object");
    const attrs: Record<string, string> = { id: instance };
    const at = transformValue(compose(to.inverse, translate(roundDelta(box.min[0] - frame.min[0]), roundDelta(box.min[1] - frame.min[1]))));
    if (at !== null) attrs.transform = at;
    attrs.href = `#${id}`;
    const ops: Op[] = [...to.prelude, addOp(to, { tag: "use", attrs })];
    const page = grownPage(box);
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.symbol_insert", asGesture(ops)) === null) return false;
    // Un'istanza nuova si sceglie e si muove: con lo strumento Selezione.
    if (ctx.tool !== "select") setTool("select");
    select([instance]);
    announce(`${t("draw.symbols.inserted", { name })} ${objects()}${more === "" ? "" : ` ${more}`}`);
    return true;
  };

  /// Inserisce `ref` nel riquadro `box` della scena, o al centro di ciò che
  /// si vede: un'istanza del simbolo del disegno, o la copia di quello della
  /// libreria, che entra una volta sola. Con `land`, entrato, il fuoco va
  /// al foglio.
  async function insertSymbol(ref: SymbolRef, box: Bounds | null = null, land = false): Promise<void> {
    const model = ctx.engine.model;
    if (model === null || ctx.asking || !editable()) return;
    const mine = ref.kind === "drawing" ? (documentSymbols(model).find((symbol) => symbol.id === ref.id) ?? null) : originSymbol(model, ref.path, ref.id);
    if (mine !== null) {
      ctx.settleCrop();
      const frame = copyOf({ kind: "drawing", id: mine.id })?.frame ?? NO_FRAME;
      // Il disegno ha già il simbolo della libreria: se la libreria l'ha
      // cambiato, entra quello del disegno, e lo si dice.
      let more = "";
      const library = libraryOf(ref);
      const fresh = library === null ? null : symbolIn(library, ref.id);
      const origin = readOrigin(mine.source);
      if (fresh !== null && origin !== null && fresh.print !== origin.print) more = t("draw.symbols.inserted.stale");
      const ids = newIds();
      const to = target(ids);
      if (to === null) return;
      if (placeInstance(mine.id, symbolLabel(mine.name), to, ids, frame, box ?? centredAt(frame, toScene(ctx.camera, viewCenter())), more) && land) surface.focus({ preventScroll: true });
      return;
    }
    if (ref.kind === "drawing") return;
    const library = libraryOf(ref);
    const copy = library === null ? null : copyOf(ref);
    if (copy === null) {
      announce(t("draw.symbols.insert.gone"));
      return;
    }
    const { path, id } = ref;
    await ctx.pasteSvgs([{ text: copy.svg, name: null }], null, false, {
      label: "draw.action.symbol_insert",
      box: box ?? centredAt(copy.frame, toScene(ctx.camera, viewCenter())),
      href: ctx.rebaseFrom((href) => resolveAgainst(path, href)),
      told: () => t("draw.symbols.inserted", { name: symbolLabel(ctx.engine.model === null ? "" : (originSymbol(ctx.engine.model, path, id)?.name ?? "")) }),
      done: () => {
        if (land) surface.focus({ preventScroll: true });
      },
    });
  }
  ctx.insertSymbol = insertSymbol;

  /// Dove andrebbe il simbolo tirato col puntatore dove l'evento dice: il
  /// riquadro della sua istanza nella scena; `null` fuori dal foglio, o dove
  /// niente lo riceve.
  const symbolPlace = (drag: SymbolDrag, event: PointerEvent): Bounds | null => {
    drag.over = onSheet(event.clientX, event.clientY);
    if (!drag.over || ctx.destinationNow() === null) return null;
    const [x, y] = sceneAt(event.clientX, event.clientY);
    const { frame } = drag;
    const raw = translated(frame, x - (frame.min[0] + frame.max[0]) / 2, y - (frame.min[1] + frame.max[1]) / 2)!;
    const [dx, dy] = snappedDelta(0, 0, raw.min, raw, () => guidesFor(drag, []), drag.pointer);
    return translated(raw, dx, dy)!;
  };

  /// Mostra il simbolo tirato dove andrebbe, con la sua anteprima o, finché
  /// non c'è, col suo riquadro tratteggiato; e il cursore che dice se si può
  /// lasciare.
  const showSymbolDrag = (drag: SymbolDrag, event: PointerEvent): void => {
    ctx.readModifiers(event);
    const box = symbolPlace(drag, event);
    drag.box = box;
    root.dataset.libraryDrop = box === null ? "none" : "copy";
    if (box === null) {
      showShape(null, IDENTITY);
    } else {
      const [x, y] = box.min;
      const place = { x: String(x), y: String(y), width: String(box.max[0] - x), height: String(box.max[1] - y) };
      showShape(
        drag.picture === null
          ? { tag: "rect", attrs: { ...place, fill: "none", stroke: "currentColor", "stroke-dasharray": "4 3", "vector-effect": "non-scaling-stroke" } }
          : { tag: "image", attrs: { ...place, href: drag.picture, preserveAspectRatio: "none" } },
        IDENTITY,
      );
    }
    // Le guide seguono il simbolo.
    if (guidesOn() || ctx.guiding) showHandles();
  };

  /// Finisce il trascinamento, senza scrivere: toglie il simbolo mostrato e
  /// il cursore.
  const endSymbolDrag = (): void => {
    if (ctx.symbolDrag === null) return;
    ctx.symbolDrag = null;
    delete root.dataset.libraryDrop;
    previewLayer.removeAttribute("opacity");
    showShape(null, IDENTITY);
    showHandles();
  };

  /// Esc, un puntatore annullato, o il pannello che si chiude: il simbolo
  /// tirato non entra; con `said`, lo si dice.
  function cancelSymbolDrag(said = false): void {
    if (ctx.symbolDrag === null) return;
    endSymbolDrag();
    if (said) announce(t("draw.shapes.cancelled"));
  }
  ctx.cancelSymbolDrag = cancelSymbolDrag;

  /// Comincia a tirare `ref` dal pannello: `event` è il movimento che ha
  /// superato la soglia. Un simbolo di una libreria che il disegno ha già si
  /// tira come quello del disegno, che è ciò che entra.
  function startSymbolDrag(ref: SymbolRef, event: PointerEvent): void {
    const model = ctx.engine.model;
    if (model === null || !editable() || ctx.symbolDrag !== null || ctx.shapeDrag !== null) return;
    const mine = ref.kind === "library" ? originSymbol(model, ref.path, ref.id) : null;
    const own: SymbolRef = mine === null ? ref : { kind: "drawing", id: mine.id };
    const copy = copyOf(own);
    if (copy === null) return;
    // L'anteprima del riquadro va bene se è dello stesso simbolo.
    const shown = symbolPictures.get(refKey(own))?.ready ?? null;
    const same = mine === null || readOrigin(mine.source)?.print === versionOf(ref);
    const picture = shown ?? (same ? (symbolPictures.get(refKey(ref))?.ready ?? null) : null);
    cancelGesture();
    ctx.settleCrop();
    const pointer = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
    ctx.symbolDrag = { ref, frame: copy.frame, picture, pointerId: event.pointerId, pointer, over: false, box: null };
    previewLayer.setAttribute("opacity", "0.75");
    showSymbolDrag(ctx.symbolDrag, event);
  }
  ctx.startSymbolDrag = startSymbolDrag;

  /// Rilascia il simbolo tirato: sul foglio entra dove sta; fuori no, e lo
  /// si dice. Dove il livello non riceve, si dice perché.
  const dropSymbol = (drag: SymbolDrag, event: PointerEvent): void => {
    showSymbolDrag(drag, event);
    const { ref, box, over } = drag;
    endSymbolDrag();
    if (box === null) {
      if (over) target(newIds());
      else announce(t("draw.shapes.cancelled"));
      return;
    }
    // Chi ha lasciato il simbolo sul foglio continua lì, non nel pannello.
    void insertSymbol(ref, box, true);
  };

  life.listen(surface.ownerDocument, "pointermove", (event) => {
    if (ctx.symbolDrag !== null && event.pointerId === ctx.symbolDrag.pointerId) showSymbolDrag(ctx.symbolDrag, event);
  });
  life.listen(surface.ownerDocument, "pointerup", (event) => {
    if (ctx.symbolDrag !== null && event.pointerId === ctx.symbolDrag.pointerId) dropSymbol(ctx.symbolDrag, event);
  });
  life.listen(surface.ownerDocument, "pointercancel", (event) => {
    if (ctx.symbolDrag !== null && event.pointerId === ctx.symbolDrag.pointerId) cancelSymbolDrag(true);
  });
  // Esc ferma il trascinamento prima di chiunque altro.
  life.listen(
    surface.ownerDocument,
    "keydown",
    (event) => {
      if (ctx.symbolDrag === null || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelSymbolDrag(true);
    },
    { capture: true },
  );
  life.add(() => cancelSymbolDrag());

  /// Le istanze del simbolo `id` che si scelgono adesso: nel gruppo
  /// isolato, o in tutto il disegno, a ogni profondità.
  const instancesOf = (id: string): Unit[] => allUnits(currentIndex()).filter((unit) => isInstance(unit) && unit.node.details?.symbol === id);

  /// «Scegli le istanze»: sceglie le istanze del simbolo `id` e le porta in
  /// vista; il fuoco va al foglio, dove si lavora su di loro.
  const selectInstances = (id: string): void => {
    const units = instancesOf(id);
    if (units.length === 0) {
      announce(t("draw.symbols.instances.unreachable"));
      return;
    }
    cancelGesture();
    select(units.map((unit) => unit.key));
    frameBounds(ctx.boundsOf(units));
    surface.focus({ preventScroll: true });
    announceSelection();
  };

  /// «Modifica simbolo» dal pannello: entra nel simbolo `id` da una sua
  /// istanza, quella che si vede se ce n'è una.
  const editFromPanel = (id: string): void => {
    const units = instancesOf(id);
    const seen = (unit: Unit): boolean => unit.bounds !== null && ctx.inSight([(unit.bounds.min[0] + unit.bounds.max[0]) / 2, (unit.bounds.min[1] + unit.bounds.max[1]) / 2]);
    const unit = units.find(seen) ?? units[0];
    if (unit === undefined) {
      announce(t("draw.symbols.edit.unreachable"));
      return;
    }
    cancelGesture();
    select([unit.key]);
    frameBounds(unit.bounds);
    editSymbol();
  };

  /// «Rinomina simbolo…» dal pannello: il nome nuovo in una finestra, che
  /// torna col perché finché il nome non va.
  async function renameSymbol(id: string): Promise<void> {
    if (ctx.asking || ctx.engine.model === null || !editable()) return;
    const opened = ctx.loads;
    let value = documentSymbols(ctx.engine.model).find((each) => each.id === id)?.name ?? "";
    let problem: string | null = null;
    for (;;) {
      ctx.asking = true;
      let answer: Readonly<Record<string, string>> | null;
      try {
        answer = await promptForm({
          title: t("draw.symbols.rename.title"),
          ...(problem === null ? {} : { message: problem }),
          okLabel: t("draw.rename"),
          fields: [{ id: "name", label: t("draw.symbols.rename.name"), value, kind: "text", required: true, maxLength: NAME_MAX }],
        });
      } finally {
        ctx.asking = false;
      }
      const model = ctx.engine.model;
      if (answer === null || ctx.disposed || ctx.loads !== opened || model === null || !editable()) return;
      // Mentre la finestra era aperta il disegno può essere cambiato: vale il
      // simbolo che ha ancora lo stesso id.
      const symbol = documentSymbols(model).find((each) => each.id === id);
      if (symbol === undefined) return;
      const name = cleanName(answer.name ?? "");
      const why = symbolNameProblem(model, name, id);
      if (why !== null) {
        problem = why === "empty" ? t("draw.symbols.problem.empty") : t("draw.symbols.problem.taken", { name });
        value = name;
        continue;
      }
      const renamed = renameSymbolOps(model, symbol, name, newIds());
      if (renamed === "foreign") announce(t("draw.rename.foreign"));
      else if (renamed.ops.length > 0 && commit("draw.action.symbol_rename", asGesture(renamed.ops)) !== null) announce(t("draw.symbols.renamed", { name }));
      return;
    }
  }

  /// Gli indirizzi delle immagini di un simbolo della libreria `path`, per
  /// il disegno: partono dalla libreria.
  const libraryHref = (path: string): ((href: string) => string | null) => ctx.rebaseFrom((href) => resolveAgainst(path, href));

  /// Se aggiornare il simbolo `id` del disegno `model`, quello del motore,
  /// da `library`, da cui viene secondo `origin`, lo cambierebbe; una prova
  /// per testo del disegno e per versione della libreria.
  let changesKnown: { readonly text: string; readonly key: string; readonly value: boolean | null } | null = null;
  const wouldChange = (model: DocumentModel, id: string, library: Library, origin: Origin): boolean | null => {
    const text = ctx.engine.text;
    const key = `${id} ${library.path}#${origin.id} ${symbolIn(library, origin.id)?.print ?? ""}`;
    if (changesKnown?.text === text && changesKnown.key === key) return changesKnown.value;
    const value = updateChanges(sheetNow(model), id, library, origin.id, libraryHref(library.path));
    changesKnown = { text, key, value };
    return value;
  };

  /// «Aggiorna dalla libreria…»: il simbolo `id` del disegno prende il
  /// contenuto di quello della libreria da cui viene, dopo la finestra che
  /// mostra com'è e come sarà; in un passo. Le istanze restano dove sono.
  async function updateSymbol(id: string): Promise<void> {
    const model = ctx.engine.model;
    if (ctx.asking || model === null || !editable()) return;
    const symbol = documentSymbols(model).find((each) => each.id === id);
    const origin = symbol === undefined ? null : readOrigin(symbol.source);
    const library = origin === null ? null : (symbolLibraries?.library(origin.path) ?? null);
    const fresh = library === null ? null : symbolIn(library, origin!.id);
    const version = versionOf({ kind: "drawing", id });
    if (symbol === undefined || origin === null || library === null || fresh === null || version === null) {
      announce(t("draw.symbols.update.gone"));
      return;
    }
    const opened = ctx.loads;
    const name = symbolLabel(symbol.name);
    let yes = false;
    ctx.asking = true;
    try {
      const [before, after] = await Promise.all([symbolPictureUrl({ kind: "drawing", id }, version), symbolPictureUrl({ kind: "library", path: origin.path, id: origin.id }, fresh.print)]);
      if (ctx.disposed || ctx.loads !== opened) return;
      // Se la libreria è cambiata dalla copia, non si sa se il simbolo è
      // cambiato nel disegno.
      const edited = fresh.print === origin.print ? wouldChange(model, id, library, origin) : null;
      yes = await symbolUpdateDialog({ name, library: stem(origin.path), uses: instanceCounts(model).get(id) ?? 0, edited, before, after });
    } finally {
      ctx.asking = false;
    }
    if (!yes || ctx.disposed || ctx.loads !== opened || !editable()) return;
    // Mentre la finestra era aperta il disegno, o la libreria, può essere
    // cambiato: valgono quelli di adesso.
    const now = ctx.engine.model;
    const current = now === null ? undefined : documentSymbols(now).find((each) => each.id === id);
    const source = symbolLibraries?.library(origin.path) ?? null;
    const ops = now === null || current === undefined || source === null ? null : updateOps(now, current, source, origin.id, newIds(), libraryHref(origin.path));
    if (ops === null) {
      announce(t("draw.symbols.update.gone"));
      return;
    }
    cancelGesture();
    if (commit("draw.action.symbol_update", asGesture(ops)) !== null) announce(t("draw.symbols.updated", { name }));
  }

  /// «Elimina simbolo»: toglie il simbolo `id`, che non ha istanze, in un
  /// passo; il fuoco, se era sul suo riquadro, va al campo di ricerca.
  const deleteSymbol = (id: string): void => {
    const model = ctx.engine.model;
    if (model === null || !editable()) return;
    const symbol = documentSymbols(model).find((each) => each.id === id);
    if (symbol === undefined) return;
    if ((instanceCounts(model).get(id) ?? 0) > 0) {
      announce(t("draw.symbols.delete.used"));
      return;
    }
    cancelGesture();
    if (commit("draw.action.symbol_delete", asGesture([{ op: "remove", target: id }])) === null) return;
    announce(t("draw.symbols.deleted", { name: symbolLabel(symbol.name) }));
    if (!symbolsPanel.element.hidden && !symbolsPanel.element.contains(document.activeElement)) symbolsPanel.focus();
  };

  /// La voce che aggiorna `symbol`, copiato da `origin`, dalla sua libreria:
  /// si usa se la libreria è letta, ha ancora il simbolo, e la libreria è
  /// cambiata dalla copia o l'aggiornamento cambierebbe il simbolo. La riga
  /// sotto dice com'è.
  const updateItem = (model: DocumentModel, symbol: DocumentSymbol, origin: Origin, label: DrawKey, canEdit: boolean): MenuItem => {
    const library = symbolLibraries?.library(origin.path) ?? null;
    const fresh = library === null ? null : symbolIn(library, origin.id);
    const changed = fresh !== null && fresh.print !== origin.print;
    // Una prova che non riesce lascia provare l'aggiornamento vero.
    const edited = library === null || fresh === null || changed ? false : wouldChange(model, symbol.id, library, origin) !== false;
    const why: DrawKey = fresh === null ? "draw.symbols.update.missing" : changed ? "draw.symbols.update.newer" : edited ? "draw.symbols.update.revert" : "draw.symbols.update.same";
    return { label: t(label), separator: true, disabled: !canEdit || fresh === null || !(changed || edited), description: t(why, { library: stem(origin.path) }), run: () => void updateSymbol(symbol.id) };
  };

  /// I comandi del simbolo `ref` del pannello, nel punto del gesto o sotto
  /// il suo riquadro.
  function symbolMenu(ref: SymbolRef, at: MouseEvent | HTMLElement, labelledBy: string): void {
    const model = ctx.engine.model;
    if (model === null) return;
    const canEdit = editable();
    const items: MenuItem[] = [{ label: t("draw.symbols.menu.insert"), disabled: !canEdit, run: () => void insertSymbol(ref) }];
    const mine = ref.kind === "drawing" ? (documentSymbols(model).find((each) => each.id === ref.id) ?? null) : originSymbol(model, ref.path, ref.id);
    if (mine === null) {
      if (ref.kind === "drawing") return;
      showContextMenu(at, items, { labelledBy });
      return;
    }
    const uses = instanceCounts(model).get(mine.id) ?? 0;
    const reachable = instancesOf(mine.id).length;
    const unreachable = t(uses === 0 ? "draw.symbols.instances.none_yet" : "draw.symbols.instances.unreachable");
    items.push({ label: t("draw.symbols.menu.instances"), separator: true, disabled: reachable === 0, ...(reachable === 0 ? { description: unreachable } : {}), run: () => selectInstances(mine.id) });
    if (ref.kind === "drawing") {
      items.push(
        { label: t("draw.symbol.edit"), disabled: !canEdit || reachable === 0, ...(canEdit && reachable === 0 ? { description: t("draw.symbols.edit.unreachable") } : {}), run: () => editFromPanel(mine.id) },
        { label: t("draw.symbols.rename"), disabled: !canEdit, run: () => void renameSymbol(mine.id) },
      );
    }
    const origin = readOrigin(mine.source);
    if (origin !== null) items.push(updateItem(model, mine, origin, ref.kind === "drawing" ? "draw.symbols.menu.update" : "draw.symbols.menu.update_here", canEdit));
    if (ref.kind === "drawing") {
      items.push({ label: t("draw.symbols.menu.delete"), separator: true, danger: true, disabled: !canEdit || uses > 0, ...(canEdit && uses > 0 ? { description: t("draw.symbols.delete.used") } : {}), run: () => deleteSymbol(mine.id) });
    }
    showContextMenu(at, items, { labelledBy });
  }
  ctx.symbolMenu = symbolMenu;
}
