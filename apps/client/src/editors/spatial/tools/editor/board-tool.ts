// L'editor del disegno: le tavole e il Lazo. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { promptForm } from "../../../../ui/form-dialog";
import type { InkPointerType } from "../../../../ink/input/pointer";
import type { Bounds } from "../../scene/geometry";
import { IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import { elementChildren, type ElementPart } from "../../scene/model";
import { plural, t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import type { PaintNode } from "../../painter/paint";
import { boxMatrix, gesture as asGesture, movedMatrix, roundDelta, transformValue } from "../edit";
import type { Arranged } from "../arrange";
import {
  addBoardOps,
  pageBoardOps,
  boardAt,
  boundsRect,
  carriedBy as onBoard,
  duplicateBoardOps,
  duplicateSpot,
  MIN_BOARD_SIDE,
  moveBoardOps,
  nextBoardRect,
  pageRect,
  rectBounds,
  rectText,
  removeBoardOps,
  renameBoardOps,
  reorderBoardOps,
  resizeBoardOps,
  roundRect,
  type Board,
  type CopyNames,
  type Rect,
} from "../boards";
import { edgeView, frameGuides, gridSnap, gripAt, gripCursor, isCorner, resized, type Frame, type FrameView } from "../frame";
import { GUIDE_PX, GuideIndex, type GuideTarget } from "../guides";
import { GRID_MAJOR, lineBeyond, nearestCorner } from "../grid";
import { toScene, type View } from "../../view";
import { SceneIndex, type Unit } from "../hit";
import { cleanName, NAME_MAX } from "../naming";
import { DRAG_PX, HIT_PX, LASSO_MAX_POINTS, LASSO_STEP_PX, MIN_SHAPE_PX, NUDGE, NUDGE_SHIFT, PAGE_SHEET } from "./constants";
import type { EditorContext } from "./context";
import { disjoint, sign } from "./helpers";
import type { BoardGesture, LassoGesture, Sheet } from "./types";

/// Ciò che le tavole e il Lazo dà agli altri pezzi dell'editor.
export interface BoardToolContext {
  boardById: (id: string) => Board | null;
  sheetText: (sheet: Sheet) => string;
  boardInView: () => Board | null;
  currentBoard: () => Board | null;
  sheetInView: () => string | null;
  boardCopies: (g: BoardGesture) => boolean;
  boardGuides: (g: BoardGesture) => GuideIndex;
  boardStart: (g: BoardGesture, p: Point) => void;
  boardDelta: (g: BoardGesture) => [number, number];
  drawnEnd: (g: BoardGesture) => Point | null;
  boardUpdate: (g: BoardGesture) => void;
  boardEnd: (g: BoardGesture) => void;
  newBoard: () => void;
  goToBoard: (id: string) => void;
  present: (from: string | null) => void;
  orderBoard: (id: string, to: number) => void;
  duplicateBoard: (board: Board | null, delta?: readonly [number, number] | null, note?: string) => void;
  duplicateSheet: () => void;
  removeBoard: (target?: Board | null) => void;
  writeBoardName: (id: string, text: string) => boolean;
  renameBoard: () => Promise<void>;
  nudgeBoard: (x: number, y: number, grow: number, fine: boolean, big: boolean) => boolean;
  visitBoard: (at: number, fit?: boolean) => boolean;
  walkBoards: (step: 1 | -1) => boolean;
  stepBoard: (step: 1 | -1) => void;
  leaveBoard: () => boolean;
  boardHandles: () => OverlayHandle[];
  hoverBoard: (event: PointerEvent) => void;
  rulerPage: () => Bounds | null;
  lassoAdd: (g: LassoGesture, p: Point) => void;
  lassoUpdate: (g: LassoGesture) => void;
  lassoEnd: (g: LassoGesture) => void;
}

/// Monta le tavole e il Lazo.
export function installBoardTool(ctx: EditorContext): void {
  const {
    boardsPanel, painter, builder, indexer, boardsNow, chosenSheet, sheetAt, editable, currentIndex, newIds, announce, announceSelection, sheetRect,
    showPage, surfaceSize, setCamera, stepNow, coordText, lengthSpoken, viewArea, sceneAt, viewCenter, fitted, inOrder, measuresText, showGrip,
    showHandles, syncBoards, syncControls, commit, select, frameBounds, cancelGesture, gridOn, smartOn, guidesOn, pageBox, seenTargets, rulerTargets,
    guided, snapNote, noted, snappedDelta, followImages
  } = ctx;
  // --- Le tavole -----------------------------------------------------------------

  /// La tavola di id `id` nel disegno di adesso, se c'è.
  const boardById = (id: string): Board | null => boardsNow().find((each) => each.id === id) ?? null;
  ctx.boardById = boardById;

  /// La cornice dritta del rettangolo `rect`, come quella di una tavola: dà
  /// il cursore alle sue maniglie.
  const sheetFrame = (rect: Rect): Frame => {
    const box = rectBounds(rect);
    return { matrix: IDENTITY, box, geometry: box };
  };

  /// La tavola scelta, o la pagina, con le sue maniglie dove le mette il
  /// gesto di adesso: se lo strumento Tavola la può cambiare.
  const sheetView = (): { readonly sheet: Sheet; readonly view: FrameView } | null => {
    const sheet = ctx.tool === "board" && editable() ? chosenSheet() : null;
    const view = sheet === null ? null : edgeView(rectBounds(sheetRect(sheet.board) ?? sheet.rect), ctx.camera.scale);
    return view === null ? null : { sheet: sheet!, view };
  };

  /// La carta della pagina di un disegno senza tavole: quella che non è di
  /// una tavola.
  const pagePaper = (): ElementPart | null => {
    const model = ctx.engine.model;
    if (model === null) return null;
    return elementChildren(model.root).find((child) => child.details?.role === "paper" && child.details.board === undefined) ?? null;
  };

  /// La tavola o la pagina, a parole: il nome, il posto fra le tavole e le
  /// misure.
  const sheetText = (sheet: Sheet): string => {
    const [, , width, height] = sheet.rect;
    const size = { width: lengthSpoken(width), height: lengthSpoken(height) };
    if (sheet.board === null) return t("draw.board.page.chosen", size);
    const list = boardsNow();
    const id = sheet.board.id;
    return t("draw.board.chosen", { ...size, name: sheet.board.name, index: list.findIndex((board) => board.id === id) + 1, count: list.length });
  };
  ctx.sheetText = sheetText;

  /// La tavola che si guarda: quella al centro della vista, o la prima che
  /// si vede; `null` se non se ne vede nessuna.
  const boardInView = (): Board | null => {
    const list = boardsNow();
    if (list.length === 0) return null;
    const here = boardAt(list, toScene(ctx.camera, viewCenter()));
    if (here !== null) return here;
    const view = ctx.viewBounds();
    return list.find((board) => !disjoint(board.box, view)) ?? null;
  };
  ctx.boardInView = boardInView;

  /// La tavola di adesso, che l'elenco delle tavole segna e accanto alla
  /// quale «Nuova tavola» ne mette una: quella scelta con lo strumento
  /// Tavola, o quella che si guarda.
  const currentBoard = (): Board | null => chosenSheet()?.board ?? boardInView();
  ctx.currentBoard = currentBoard;

  /// La tavola da scegliere quando lo strumento Tavola non ne ha una: quella
  /// che si guarda, o la prima; in un disegno senza tavole, la pagina.
  const sheetInView = (): string | null => {
    const list = boardsNow();
    if (list.length === 0) return ctx.scene.root.page === null ? null : PAGE_SHEET;
    return (boardInView() ?? list[0]!).id;
  };
  ctx.sheetInView = sheetInView;

  /// Vero se il gesto `g` sposta, con Alt, una copia della tavola presa,
  /// che resta dov'è.
  const boardCopies = (g: BoardGesture): boolean => g.mode === "move" && ctx.alt;
  ctx.boardCopies = boardCopies;

  /// I bersagli delle guide per il gesto `g` dello strumento Tavola, presi
  /// la prima volta e tenuti finché la scena e la vista restano quelle: con
  /// le guide intelligenti gli oggetti che si vedono, tranne quelli che la
  /// tavola porta, le altre tavole, e la pagina di un disegno senza tavole,
  /// se non è lei che si tira; con le guide del documento, quelle.
  let boardGuideCache: {
    readonly owner: BoardGesture;
    readonly index: SceneIndex;
    readonly view: View;
    readonly copying: boolean;
    readonly guides: GuideIndex;
  } | null = null;
  const boardGuides = (g: BoardGesture): GuideIndex => {
    const index = currentIndex();
    const copying = boardCopies(g);
    const cached = boardGuideCache;
    if (cached !== null && cached.owner === g && cached.index === index && cached.view === ctx.camera && cached.copying === copying) return cached.guides;
    const targets: GuideTarget[] = [];
    if (smartOn()) {
      const size = surfaceSize();
      const view = size.w > 0 && size.h > 0 ? ctx.viewBounds() : null;
      // La copia si allinea anche alla tavola da cui viene, che resta, e a
      // ciò che porta.
      targets.push(...seenTargets(new Set(copying ? [] : g.carried.map((unit) => unit.key)), [], view));
      // Una tavola si allinea alle altre, e si distribuisce fra loro.
      const moving = g.plan === "draw" || copying ? null : (g.sheet?.board?.id ?? null);
      for (const board of boardsNow()) {
        if (board.id !== moving && (view === null || !disjoint(board.box, view))) targets.push({ kind: "object", box: board.box, key: board.id });
      }
      const page = boardsNow().length === 0 && !(g.plan === "resize" && g.sheet?.board === null) ? pageBox() : null;
      if (page !== null) targets.push({ kind: "page", box: page, key: "" });
    }
    targets.push(...rulerTargets(null));
    const guides = new GuideIndex(targets);
    boardGuideCache = { owner: g, index, view: ctx.camera, copying, guides };
    return guides;
  };
  ctx.boardGuides = boardGuides;

  /// Il primo punto di un gesto dello strumento Tavola: su una maniglia
  /// della tavola scelta, o della pagina, la si tirerà; dentro una tavola,
  /// senza Maiusc, la si sposterà con ciò che porta; altrove, o con Maiusc,
  /// si disegnerà una tavola nuova.
  const boardStart = (g: BoardGesture, p: Point): void => {
    g.from = p;
    g.end = p;
    const shown = sheetView();
    const grip = shown === null ? null : gripAt(shown.view, p, ctx.camera.scale, g.pointer);
    if (shown !== null && grip !== null && grip !== "rotate") {
      g.plan = "resize";
      g.sheet = shown.sheet;
      g.grip = grip;
      return;
    }
    const board = boardAt(boardsNow(), p);
    if (board === null || ctx.shift) return;
    g.plan = "move";
    g.sheet = { board, rect: board.rect };
    g.carried = onBoard(board.box, indexer.movable(ctx.engine.model!));
    g.source = nearestCorner(board.box, p);
  };
  ctx.boardStart = boardStart;

  /// Lo spostamento della tavola che il gesto `g` porta, con la griglia e
  /// con le guide (vedi [`snappedDelta`]).
  const boardDelta = (g: BoardGesture): [number, number] => {
    if (g.from === null || g.end === null || g.sheet === null) return [0, 0];
    return snappedDelta(g.end[0] - g.from[0], g.end[1] - g.from[1], g.source, rectBounds(g.sheet.rect), () => boardGuides(g), g.pointer);
  };
  ctx.boardDelta = boardDelta;

  /// Il rettangolo della tavola, o della pagina, di cui il gesto `g` tira
  /// una maniglia. Un angolo con Maiusc tiene le proporzioni, Alt tiene
  /// fermo il centro; con la griglia o con le guide il bordo tirato si ferma
  /// sulla riga o sul bersaglio più vicino, se Ctrl o ⌘ non lo lascia libero.
  const boardResized = (g: BoardGesture): Rect | null => {
    if (g.sheet === null || g.grip === null || g.from === null || g.end === null) return null;
    const delta: Point = [roundDelta(g.end[0] - g.from[0]), roundDelta(g.end[1] - g.from[1])];
    const snap = gridOn() && !ctx.free ? gridSnap(IDENTITY, stepNow()) : null;
    const guides = guidesOn() && !ctx.free ? frameGuides(boardGuides(g), IDENTITY, GUIDE_PX[g.pointer], ctx.camera.scale) : null;
    const box = resized(rectBounds(g.sheet.rect), g.grip, delta, { ratio: isCorner(g.grip) && ctx.shift, fromCenter: ctx.alt, minimum: [MIN_BOARD_SIDE, MIN_BOARD_SIDE], snap, guides });
    return roundRect(boundsRect(box));
  };

  /// Il punto di adesso del gesto `g` che disegna una tavola, con la griglia
  /// e con le guide.
  const drawnEnd = (g: BoardGesture): Point | null => (g.end === null ? null : guided(g.end, () => boardGuides(g), g.pointer));
  ctx.drawnEnd = drawnEnd;

  /// La tavola che il gesto `g` disegna, dal primo punto a quello di
  /// adesso, con la griglia e con le guide. `null` finché è troppo piccola
  /// sullo schermo: allora il gesto è un tocco.
  const drawnRect = (g: BoardGesture): Rect | null => {
    const end = drawnEnd(g);
    if (g.from === null || end === null) return null;
    const from = guided(g.from, () => boardGuides(g), g.pointer);
    const width = Math.abs(end[0] - from[0]);
    const height = Math.abs(end[1] - from[1]);
    if (width * ctx.camera.scale < MIN_SHAPE_PX || height * ctx.camera.scale < MIN_SHAPE_PX) return null;
    const [x, y, w, h] = roundRect([Math.min(from[0], end[0]), Math.min(from[1], end[1]), width, height]);
    return [x, y, Math.max(w, MIN_BOARD_SIDE), Math.max(h, MIN_BOARD_SIDE)];
  };

  /// Il gesto `g` sul foglio prima di scriverlo: la carta della tavola, o
  /// della pagina, al rettangolo di adesso, e gli oggetti che la tavola
  /// spostata porta con sé. Una copia non sposta niente: la sua cornice
  /// dice dove andrà.
  const boardPreview = (g: BoardGesture): void => {
    const sheet = g.sheet;
    if (sheet === null || g.rect === null || (g.mode !== "move" && g.mode !== "resize") || boardCopies(g)) {
      painter.setDraft(null);
      return;
    }
    const transforms = new Map<PaintNode, string | null>();
    const carried = new Map<object, Matrix>();
    const paper = sheet.board === null ? pagePaper() : sheet.board.paper;
    const value = transformValue(boxMatrix(rectBounds(sheet.rect), rectBounds(g.rect)));
    for (const paint of paper === null ? [] : builder.paintsOf(paper)) transforms.set(paint, value);
    if (g.mode === "move") {
      const dx = g.rect[0] - sheet.rect[0];
      const dy = g.rect[1] - sheet.rect[1];
      for (const unit of g.carried) {
        const moved = movedMatrix(unit, dx, dy);
        if (moved === null) continue;
        const next = transformValue(moved);
        for (const paint of unit.paints) transforms.set(paint, next);
        followImages(carried, unit, moved);
      }
    }
    painter.setDraft({ transforms, carried });
  };

  const boardUpdate = (g: BoardGesture): void => {
    if (g.from === null || g.end === null) return;
    if (g.mode === "pending") {
      const distance = Math.hypot(g.end[0] - g.from[0], g.end[1] - g.from[1]) * ctx.camera.scale;
      if (distance <= DRAG_PX[g.pointer]) return;
      g.mode = g.plan;
      if (g.plan === "move") {
        // La tavola che si sposta è quella scelta.
        ctx.boardChosen = g.sheet!.board!.id;
      } else if (g.plan === "resize") {
        showGrip(gripCursor(sheetFrame(g.sheet!.rect), g.grip!, ctx.camera.angle));
      }
    }
    // Alt si prende e si lascia a metà gesto: copia, o sposta.
    if (g.mode === "move") showGrip(ctx.alt ? "copy" : "move");
    if (g.mode === "move") {
      const [dx, dy] = boardDelta(g);
      const [x, y, width, height] = g.sheet!.rect;
      g.rect = [x + dx, y + dy, width, height];
    } else {
      g.rect = g.mode === "resize" ? boardResized(g) : drawnRect(g);
    }
    boardPreview(g);
    showPage();
    showHandles();
  };
  ctx.boardUpdate = boardUpdate;

  const boardEnd = (g: BoardGesture): void => {
    // Le guide si leggono finché il gesto c'è.
    const note = g.mode === "pending" ? "" : snapNote();
    const delta = g.mode === "move" ? boardDelta(g) : null;
    painter.setDraft(null);
    ctx.current = null;
    showGrip(null);
    const board = g.sheet?.board ?? null;
    // Con Alt la tavola resta, e la copia va dove si posa; posata dov'era,
    // non c'è niente da copiare.
    if (delta !== null && board !== null && ctx.alt && (delta[0] !== 0 || delta[1] !== 0)) duplicateBoard(board, delta, note);
    else if (delta !== null && board !== null) moveBoard(board, delta[0], delta[1], g.carried, note);
    else if (g.mode === "resize" && g.sheet !== null && g.rect !== null) resizeSheet(g.sheet, g.rect, note);
    else if (g.mode === "draw" && g.rect !== null) addBoard(g.rect, note);
    // Un tocco su una maniglia non cambia niente.
    else if (g.plan !== "resize" && g.from !== null) tapBoard(g.from);
    showPage();
    showHandles();
  };
  ctx.boardEnd = boardEnd;

  /// Un tocco dello strumento Tavola in `p`: sceglie la tavola sotto, o la
  /// pagina di un disegno che non ne ha, e lo dice; fuori lascia la scelta.
  const tapBoard = (p: Point): void => {
    const sheet = sheetAt(p);
    if (sheet === null && ctx.boardChosen === null) return;
    ctx.boardChosen = sheet === null ? null : (sheet.board?.id ?? PAGE_SHEET);
    announce(sheet === null ? t("draw.board.unchosen") : sheetText(sheet));
  };

  /// Scrive `arranged`, un comando delle tavole, in un passo col nome
  /// `label`, e sceglie la tavola della sua prima chiave. Falso se non c'era
  /// niente da scrivere, o se il motore l'ha rifiutato.
  const writeBoard = (label: DrawKey, arranged: Arranged): boolean => {
    const before = ctx.boardChosen;
    ctx.boardChosen = arranged.keys[0] ?? ctx.boardChosen;
    if (commit(label, asGesture(arranged.ops)) !== null) return true;
    ctx.boardChosen = before;
    return false;
  };

  /// Sposta la tavola `board` di (`dx`, `dy`) con gli oggetti di `carried`,
  /// in un passo, e lo dice: dove sta adesso e `note`, a che cosa si è
  /// agganciata.
  const moveBoard = (board: Board, dx: number, dy: number, carried: readonly Unit[], note = ""): void => {
    const model = ctx.engine.model;
    if (model === null || !editable()) return;
    if (!writeBoard("draw.action.board_move", moveBoardOps(model, board, dx, dy, carried, newIds(), ctx.scene.root.page))) return;
    const [x, y] = boardById(board.id)?.rect ?? board.rect;
    const args = { name: board.name, x: coordText(x), y: coordText(y) };
    announce(noted(carried.length === 0 ? t("draw.board.moved", args) : plural(carried.length, "draw.board.moved.one", "draw.board.moved.other", args), note));
  };

  /// La pagina di un disegno senza tavole diventa la tavola 1, in un passo
  /// suo, e la si sceglie: chi annulla la tavola che viene dopo ritrova lei.
  /// Torna la tavola 1; `null` se non c'è.
  const pageToBoard = (): Board | null => {
    const model = ctx.engine.model;
    const page = ctx.scene.root.page;
    if (model === null || page === null) return null;
    const made = pageBoardOps(model, (n) => t("draw.board.name", { n }), newIds(), page);
    if (made === "paper") announce(t("draw.board.paper"));
    if (made === "paper" || made.keys.length === 0 || !writeBoard("draw.action.board_page", made)) return null;
    return boardById(made.keys[0]!);
  };

  /// Aggiunge una tavola col rettangolo `rect`, in un passo, la sceglie e lo
  /// dice, con `note`; in un disegno senza tavole la pagina diventa prima la
  /// tavola 1, col passo suo. La carta somiglia a quella di `like`, se ne ha
  /// una. Torna la tavola nuova; `null` se non c'è.
  const addBoard = (rect: Rect, note = "", like: Board | null = chosenSheet()?.board ?? null): Board | null => {
    const model = ctx.engine.model;
    if (model === null || !editable()) return null;
    const before = boardsNow().length;
    const nameFor = (n: number): string => t("draw.board.name", { n });
    let added = addBoardOps(model, rect, nameFor, newIds(), ctx.scene.root.page, like);
    if (added === "limit") announce(t("draw.board.limit", { count: before }));
    else if (added === "paper") announce(t("draw.board.paper"));
    if (typeof added === "string") return null;
    if (before === 0 && ctx.scene.root.page !== null) {
      // Le prove sono passate sul disegno intero: adesso la pagina, poi la
      // tavola nuova accanto a lei.
      if (pageToBoard() === null) return null;
      const paged = addBoardOps(ctx.engine.model!, rect, nameFor, newIds(), ctx.scene.root.page, like);
      if (typeof paged === "string") return null;
      added = paged;
    }
    if (!writeBoard("draw.action.board_add", added)) return null;
    const list = boardsNow();
    const board = boardById(added.keys[0]!);
    if (board === null) return null;
    const said = { name: board.name, width: lengthSpoken(board.rect[2]), height: lengthSpoken(board.rect[3]) };
    announce(noted(before === 0 && list.length > 1 ? t("draw.board.added.page", { ...said, first: list[0]!.name }) : t("draw.board.added", said), note));
    return board;
  };

  /// Il rettangolo della prima tavola di un disegno senza pagina né tavole:
  /// quello del disegno, o della vista se è vuoto, allargato alle unità
  /// intere.
  const looseRect = (): Rect => {
    const model = ctx.engine.model;
    const box = (model === null ? null : indexer.extent(model)) ?? ctx.viewBounds();
    const left = Math.floor(box.min[0]);
    const top = Math.floor(box.min[1]);
    return [left, top, Math.max(MIN_BOARD_SIDE, Math.ceil(box.max[0]) - left), Math.max(MIN_BOARD_SIDE, Math.ceil(box.max[1]) - top)];
  };

  /// «Nuova tavola», dall'elenco: una tavola della misura di quella di
  /// adesso, o dell'ultima, a destra di tutte; in un disegno senza tavole la
  /// pagina diventa la tavola 1 e la nuova le sta accanto, e senza pagina la
  /// tavola copre il disegno. La si porta in vista e, se l'elenco è aperto,
  /// se ne apre il nome.
  const newBoard = (): void => {
    const like = currentBoard();
    const board = addBoard(nextBoardRect(boardsNow(), ctx.scene.root.page, like) ?? looseRect(), "", like);
    if (board === null) return;
    frameBounds(board.box);
    syncBoards();
    if (!boardsPanel.element.hidden) boardsPanel.rename(board.id);
  };
  ctx.newBoard = newBoard;

  /// Dall'elenco: sceglie la tavola `id` e la inquadra.
  const goToBoard = (id: string): void => {
    const at = boardsNow().findIndex((board) => board.id === id);
    if (at >= 0) visitBoard(at, true);
  };
  ctx.goToBoard = goToBoard;

  /// Presenta il disegno dalla tavola `from`, o dalla prima, col modulo che
  /// arriva solo adesso. All'uscita il fuoco torna al foglio, sulla tavola
  /// dove si era arrivati, scelta e inquadrata.
  const present = (from: string | null): void => {
    const model = ctx.engine.model;
    if (model === null) return;
    const text = ctx.engine.text;
    cancelGesture();
    import("../present").then(
      (module) => {
        // L'editor se n'è andato mentre il modulo arrivava.
        if (ctx.disposed) return;
        module.present({ text, model, page: ctx.scene.root.page, extent: indexer.extent(model), from, images: ctx.options.images, onExit: (id) => {
          ctx.surface.focus({ preventScroll: true });
          if (id !== null) goToBoard(id);
        } }, ctx.life);
      },
      () => announce(t("draw.present.failed")),
    );
  };
  ctx.present = present;

  /// Dall'elenco: porta la tavola `id` al posto `to`, contato da 0, fra le
  /// tavole, in un passo, e lo dice.
  const orderBoard = (id: string, to: number): void => {
    const board = boardById(id);
    const model = ctx.engine.model;
    if (board === null || model === null || !editable()) return;
    const ordered = reorderBoardOps(model, board, to);
    if (ordered.ops.length === 0 || !writeBoard("draw.action.board_order", ordered)) return;
    const list = boardsNow();
    announce(t("draw.board.ordered", { name: board.name, index: list.findIndex((each) => each.id === id) + 1, count: list.length }));
  };
  ctx.orderBoard = orderBoard;

  /// I nomi che danno i duplicati, nella lingua di adesso.
  const copyNames: CopyNames = {
    board: (n) => t("draw.board.name", { n }),
    copy: (name, n) => (n === 1 ? t("draw.board.copy", { name }) : t("draw.board.copy.more", { name, n })),
  };

  /// Duplica la tavola `board`, o con `null` la pagina di un disegno senza
  /// tavole, con ciò che ci sta sopra, in un passo: la copia va spostata di
  /// `delta` o, senza, accanto alla sua, dove c'è posto. La si sceglie, la si
  /// porta in vista e lo si dice, con `note`; la pagina diventa prima la
  /// tavola 1, col passo suo.
  const duplicateBoard = (board: Board | null, delta: readonly [number, number] | null = null, note = ""): void => {
    const model = ctx.engine.model;
    const page = ctx.scene.root.page;
    if (model === null || !editable()) return;
    const rect = board?.rect ?? (page === null ? null : pageRect(page));
    if (rect === null) return;
    const before = boardsNow();
    const [dx, dy] = delta ?? duplicateSpot(before, rect);
    const carried = onBoard(board?.box ?? rectBounds(rect), indexer.movable(model));
    let copied = duplicateBoardOps(model, board, dx, dy, carried, copyNames, newIds(), page);
    if (copied === "limit") announce(t("draw.board.limit", { count: before.length }));
    else if (copied === "paper") announce(t("draw.board.paper"));
    else if (copied === "content") announce(t("draw.board.content"));
    if (typeof copied === "string") return;
    if (board === null) {
      // Le prove sono passate sulla pagina: adesso lei diventa la tavola 1,
      // poi la si duplica come ogni tavola.
      const first = pageToBoard();
      if (first === null) return;
      const paged = ctx.engine.model!;
      const again = duplicateBoardOps(paged, first, dx, dy, onBoard(first.box, indexer.movable(paged)), copyNames, newIds(), ctx.scene.root.page);
      if (typeof again === "string") return;
      copied = again;
    }
    if (!writeBoard("draw.action.board_duplicate", copied)) return;
    const copy = boardById(copied.keys[0]!);
    if (copy === null) return;
    frameBounds(copy.box);
    const args = { name: copy.name, x: coordText(copy.rect[0]), y: coordText(copy.rect[1]) };
    const said = carried.length === 0 ? t("draw.board.duplicated", args) : plural(carried.length, "draw.board.duplicated.one", "draw.board.duplicated.other", args);
    announce(noted(board === null ? `${t("draw.board.paged", { first: boardsNow()[0]!.name })} ${said}` : said, note));
  };
  ctx.duplicateBoard = duplicateBoard;

  /// Ctrl+D, o ⌘D, con lo strumento Tavola: duplica la tavola scelta, o la
  /// pagina; senza niente di scelto lo dice.
  const duplicateSheet = (): void => {
    const sheet = chosenSheet();
    if (sheet === null) announce(t("draw.board.unchosen"));
    else duplicateBoard(sheet.board);
  };
  ctx.duplicateSheet = duplicateSheet;

  /// Dà alla tavola, o alla pagina, di `sheet` il rettangolo `rect`, in un
  /// passo, e lo dice, con `note`.
  const resizeSheet = (sheet: Sheet, rect: Rect, note = ""): void => {
    const model = ctx.engine.model;
    if (model === null || !editable()) return;
    const said = { width: lengthSpoken(rect[2]), height: lengthSpoken(rect[3]) };
    if (sheet.board === null) {
      if (rectText(rect) === rectText(sheet.rect)) return;
      if (commit("draw.action.page_size", { op: "page", viewBox: rectText(rect) }) === null) return;
      announce(noted(t("draw.board.page.resized", said), note));
      return;
    }
    if (!writeBoard("draw.action.board_resize", resizeBoardOps(model, sheet.board, rect, newIds(), ctx.scene.root.page))) return;
    announce(noted(t("draw.board.resized", { ...said, name: sheet.board.name }), note));
  };

  /// Elimina la tavola `target`, o quella scelta, in un passo, e lo dice: il
  /// disegno resta, e si sceglie la tavola che prende il suo posto.
  /// Eliminata l'ultima, la sua carta torna della pagina, che resta scelta.
  /// La pagina non si elimina.
  const removeBoard = (target: Board | null = null): void => {
    const sheet = target === null ? chosenSheet() : { board: target, rect: target.rect };
    const model = ctx.engine.model;
    if (sheet === null || model === null || !editable()) return;
    const board = sheet.board;
    if (board === null) {
      announce(t("draw.board.page.kept"));
      return;
    }
    const at = boardsNow().findIndex((each) => each.id === board.id);
    if (!writeBoard("draw.action.board_remove", removeBoardOps(model, board, indexer.extent(model), newIds()))) return;
    const list = boardsNow();
    if (list.length === 0) {
      ctx.boardChosen = ctx.scene.root.page === null ? null : PAGE_SHEET;
      announce(t("draw.board.removed.last", { name: board.name }));
    } else {
      const next = list[Math.min(at, list.length - 1)]!;
      ctx.boardChosen = next.id;
      announce(`${t("draw.board.removed", { name: board.name })} ${sheetText({ board: next, rect: next.rect })}`);
    }
    showPage();
    showHandles();
  };
  ctx.removeBoard = removeBoard;

  /// Dà alla tavola di id `id` il nome `text`, ripulito, in un passo, e lo
  /// dice. Falso se non è cambiato niente.
  const writeBoardName = (id: string, text: string): boolean => {
    const board = boardById(id);
    const model = ctx.engine.model;
    if (board === null || model === null || !editable()) return false;
    const name = cleanName(text);
    const renamed = renameBoardOps(model, board, name, newIds());
    if (renamed === "foreign") {
      announce(t("draw.board.foreign"));
      return false;
    }
    if (!writeBoard("draw.action.board_rename", renamed)) return false;
    announce(t("draw.board.renamed", { name }));
    return true;
  };
  ctx.writeBoardName = writeBoardName;

  /// F2 con lo strumento Tavola: il nome della tavola scelta si scrive
  /// nell'elenco, se è aperto, o in una finestra.
  async function renameBoard(): Promise<void> {
    const board = chosenSheet()?.board ?? null;
    if (ctx.asking || board === null || !editable()) return;
    if (!boardsPanel.element.hidden && boardsPanel.rename(board.id)) return;
    ctx.asking = true;
    cancelGesture();
    try {
      const answer = await promptForm({
        title: t("draw.board.rename.dialog"),
        fields: [{ id: "name", label: t("draw.board.rename.field"), value: board.name, kind: "text", required: true, maxLength: NAME_MAX }],
      });
      if (answer === null || ctx.disposed) return;
      writeBoardName(board.id, answer.name ?? "");
    } finally {
      ctx.asking = false;
    }
  }
  ctx.renameBoard = renameBoard;

  /// Le frecce con lo strumento Tavola: spostano la tavola scelta di 1, o di
  /// 10 con Maiusc, con ciò che porta; con Ctrl o ⌘ allargano o stringono
  /// il suo lato destro o quello in basso, o quello della pagina. Con
  /// l'aggancio vanno di riga in riga della griglia, cinque con Maiusc.
  /// `x` e `y` dicono l'asse del disegno, `grow` se allargare. Falso se non
  /// c'è niente da muovere: allora le frecce muovono il cursore.
  const nudgeBoard = (x: number, y: number, grow: number, fine: boolean, big: boolean): boolean => {
    const sheet = chosenSheet();
    const model = ctx.engine.model;
    if (sheet === null || model === null) return false;
    const [left, top, width, height] = sheet.rect;
    const step = big ? NUDGE_SHIFT : NUDGE;
    const lines = big ? GRID_MAJOR : 1;
    if (fine) {
      // Il lato non passa la prima riga dopo quello opposto, né la misura
      // più piccola di una tavola.
      const edge = (min: number, size: number, direction: number): number => {
        if (direction === 0) return min + size;
        if (gridOn()) return Math.max(lineBeyond(min + size, stepNow(), sign(direction), lines), lineBeyond(min, stepNow(), 1, 1));
        return Math.max(min + size + direction * step, min + MIN_BOARD_SIDE);
      };
      const right = edge(left, width, x === 0 ? 0 : grow);
      const bottom = edge(top, height, y === 0 ? 0 : grow);
      resizeSheet(sheet, roundRect([left, top, right - left, bottom - top]));
      return true;
    }
    if (sheet.board === null) return false;
    const dx = x === 0 ? 0 : gridOn() ? lineBeyond(left, stepNow(), sign(x), lines) - left : x * step;
    const dy = y === 0 ? 0 : gridOn() ? lineBeyond(top, stepNow(), sign(y), lines) - top : y * step;
    moveBoard(sheet.board, roundDelta(dx), roundDelta(dy), onBoard(sheet.board.box, indexer.movable(model)));
    return true;
  };
  ctx.nudgeBoard = nudgeBoard;

  /// Sceglie la tavola `at`, la porta in vista, o con `fit` la inquadra, e la
  /// dice. Falso se non c'è.
  const visitBoard = (at: number, fit = false): boolean => {
    const board = boardsNow()[at];
    if (board === undefined) return false;
    cancelGesture();
    ctx.boardChosen = board.id;
    const area = viewArea();
    if (!fit) frameBounds(board.box);
    else if (area.w > 0 && area.h > 0) {
      ctx.placed = true;
      setCamera(fitted(board.box, area));
    }
    showPage();
    showHandles();
    announce(sheetText({ board, rect: board.rect }));
    return true;
  };
  ctx.visitBoard = visitBoard;

  /// Tab con lo strumento Tavola: la tavola dopo quella scelta, o con Maiusc
  /// quella prima; senza una tavola scelta, la prima o l'ultima. Oltre le
  /// estremità il Tab esce dal foglio.
  const walkBoards = (step: 1 | -1): boolean => {
    const list = boardsNow();
    const at = list.findIndex((board) => board.id === ctx.boardChosen);
    return visitBoard(at < 0 ? (step > 0 ? 0 : list.length - 1) : at + step);
  };
  ctx.walkBoards = walkBoards;

  /// Alt+Pag↓ e Alt+Pag↑, con ogni strumento: la tavola dopo o prima di
  /// quella scelta, o di quella al centro della vista, scelta e inquadrata.
  /// Oltre le estremità lo si dice.
  const stepBoard = (step: 1 | -1): void => {
    const list = boardsNow();
    if (list.length === 0) {
      announce(t("draw.board.none"));
      return;
    }
    let at = list.findIndex((board) => board.id === ctx.boardChosen);
    if (at < 0) {
      const here = boardAt(list, toScene(ctx.camera, viewCenter()));
      at = here === null ? -1 : list.indexOf(here);
    }
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : at + step;
    if (next >= 0 && next < list.length) visitBoard(next, true);
    else announce(t(step > 0 ? "draw.board.last" : "draw.board.first", { name: list[at]!.name }));
  };
  ctx.stepBoard = stepBoard;

  /// Esc con lo strumento Tavola: la tavola scelta si lascia. Falso se non
  /// ce n'era una.
  const leaveBoard = (): boolean => {
    if (ctx.boardChosen === null) return false;
    ctx.boardChosen = null;
    showPage();
    showHandles();
    announce(t("draw.board.unchosen"));
    return true;
  };
  ctx.leaveBoard = leaveBoard;

  /// Le maniglie dello strumento Tavola: la cornice della tavola scelta, o
  /// della pagina, al rettangolo di adesso, con le maniglie e, mentre la si
  /// tira, le misure; mentre se ne disegna una, il suo riquadro e le misure.
  const boardHandles = (): OverlayHandle[] => {
    if (ctx.tool !== "board" || !editable()) return [];
    const g = ctx.current?.kind === "board" ? ctx.current : null;
    const sizeLabel = ([x, y, width, height]: Rect): OverlayHandle => ({ kind: "label", x: x + width / 2, y: y + height, text: measuresText([width, height]) });
    if (g !== null && g.mode === "draw") {
      if (g.rect === null) return [];
      const [x, y, width, height] = g.rect;
      return [{ kind: "box", x, y, width, height, matrix: IDENTITY }, sizeLabel(g.rect)];
    }
    const shown = sheetView();
    if (shown === null) return [];
    const rect = sheetRect(shown.sheet.board) ?? shown.sheet.rect;
    const [x, y, width, height] = rect;
    const out: OverlayHandle[] = [{ kind: "box", x, y, width, height, matrix: IDENTITY }];
    // Mentre la tavola si sposta, le maniglie non servono.
    if (g?.mode !== "move") {
      for (const { grip, at } of shown.view.spots) if (grip !== "rotate") out.push({ kind: "grip", x: at[0], y: at[1] });
    }
    if (g?.mode === "resize") out.push(sizeLabel(rect));
    // La copia che Alt porta: la sua cornice, dove andrà.
    if (g !== null && g.rect !== null && boardCopies(g)) {
      const [left, top, wide, high] = g.rect;
      out.push({ kind: "box", x: left, y: top, width: wide, height: high, matrix: IDENTITY });
    }
    return out;
  };
  ctx.boardHandles = boardHandles;

  /// Con lo strumento Tavola, il cursore sopra una maniglia della tavola
  /// scelta, o della pagina, dice dove tira; sopra una tavola, senza Maiusc,
  /// che la si sposta.
  const hoverBoard = (event: PointerEvent): void => {
    if (event.buttons !== 0 || !editable()) {
      showGrip(null);
      return;
    }
    const point = sceneAt(event.clientX, event.clientY);
    const pointer: InkPointerType = event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse";
    const shown = sheetView();
    const grip = shown === null ? null : gripAt(shown.view, point, ctx.camera.scale, pointer);
    if (shown !== null && grip !== null && grip !== "rotate") showGrip(gripCursor(shown.view.frame, grip, ctx.camera.angle));
    else showGrip(!ctx.shift && boardAt(boardsNow(), point) !== null ? (ctx.alt ? "copy" : "move") : null);
  };
  ctx.hoverBoard = hoverBoard;

  /// La pagina che i righelli segnano: senza tavole la pagina, anche mentre
  /// la si tira; con le tavole, quella scelta.
  const rulerPage = (): Bounds | null => {
    if (boardsNow().length === 0) {
      const rect = sheetRect(null);
      return rect === null ? pageBox() : rectBounds(rect);
    }
    const sheet = chosenSheet();
    return sheet === null ? null : rectBounds(sheetRect(sheet.board) ?? sheet.rect);
  };
  ctx.rulerPage = rulerPage;

  // --- Il Lazo -----------------------------------------------------------------

  /// Il punto `p` entra nel lazo se è abbastanza lontano dall'ultimo; oltre
  /// i punti che il lazo tiene, ne resta uno ogni due.
  const lassoAdd = (g: LassoGesture, p: Point): void => {
    const last = g.points[g.points.length - 1];
    if (last !== undefined && Math.hypot(p[0] - last[0], p[1] - last[1]) * ctx.camera.scale < LASSO_STEP_PX) return;
    g.points.push(p);
    if (g.points.length > LASSO_MAX_POINTS) {
      const kept = g.points.filter((_, at) => at % 2 === 0 || at === g.points.length - 1);
      g.points.splice(0, g.points.length, ...kept);
    }
    const first = g.points[0]!;
    if (!g.dragging && Math.hypot(p[0] - first[0], p[1] - first[1]) * ctx.camera.scale > DRAG_PX[g.pointer]) g.dragging = true;
  };
  ctx.lassoAdd = lassoAdd;

  /// La selezione mentre il lazo si tira: ciò che racchiude per intero, al
  /// posto di quella di prima, o aggiunto con Maiusc, o tolto con Alt.
  const lassoUpdate = (g: LassoGesture): void => {
    if (!g.dragging) return;
    const inside = new Set(currentIndex().inside(g.points).map((unit) => unit.key));
    ctx.selection = inOrder(g.mode === "replace" ? inside : g.mode === "add" ? [...g.base, ...inside] : g.base.filter((key) => !inside.has(key)));
    syncControls();
    showHandles();
  };
  ctx.lassoUpdate = lassoUpdate;

  /// Il lazo si chiude: la selezione resta quella che ha fatto. Un tocco
  /// sceglie l'oggetto sotto, o con Maiusc lo aggiunge o lo toglie, o con
  /// Alt lo toglie.
  const lassoEnd = (g: LassoGesture): void => {
    ctx.current = null;
    const first = g.points[0];
    if (!g.dragging && first !== undefined) {
      const hit = currentIndex().at(first, HIT_PX[g.pointer] / ctx.camera.scale);
      const key = hit?.key ?? null;
      if (g.mode === "replace") select(key === null ? [] : [key]);
      else if (key !== null && (g.mode === "remove" || g.base.includes(key))) select(g.base.filter((each) => each !== key));
      else if (key !== null) select([...g.base, key]);
    } else {
      lassoUpdate(g);
    }
    showHandles();
    announceSelection();
  };
  ctx.lassoEnd = lassoEnd;
}
