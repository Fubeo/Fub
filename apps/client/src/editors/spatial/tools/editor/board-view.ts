// L'editor del disegno: le tavole dei disegni che le hanno, in lettura (ADR
// 0231): si guardano e si visitano, non si creano. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { t } from "../../strings";
import { boardAt, type Board } from "../boards";
import { toScene } from "../../view";
import { PAGE_SHEET } from "./constants";
import type { EditorContext } from "./context";
import { disjoint } from "./helpers";
import type { Sheet } from "./types";

/// Ciò che le tavole danno agli altri pezzi dell'editor.
export interface BoardViewContext {
  boardById: (id: string) => Board | null;
  sheetText: (sheet: Sheet) => string;
  boardInView: () => Board | null;
  currentBoard: () => Board | null;
  sheetInView: () => string | null;
  visitBoard: (at: number, fit?: boolean) => boolean;
}

/// Monta le tavole.
export function installBoardView(ctx: EditorContext): void {
  const { boardsNow, chosenSheet, announce, showPage, setCamera, lengthSpoken, viewArea, viewCenter, fitted, showHandles, frameBounds, cancelGesture } = ctx;
  /// La tavola di id `id` nel disegno di adesso, se c'è.
  const boardById = (id: string): Board | null => boardsNow().find((each) => each.id === id) ?? null;
  ctx.boardById = boardById;

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

  /// La tavola di adesso: quella scelta, o quella che si guarda.
  const currentBoard = (): Board | null => chosenSheet()?.board ?? boardInView();
  ctx.currentBoard = currentBoard;

  /// La tavola da scegliere quando non ce n'è una scelta: quella che si
  /// guarda, o la prima; in un disegno senza tavole, la pagina.
  const sheetInView = (): string | null => {
    const list = boardsNow();
    if (list.length === 0) return ctx.scene.root.page === null ? null : PAGE_SHEET;
    return (boardInView() ?? list[0]!).id;
  };
  ctx.sheetInView = sheetInView;

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
}
