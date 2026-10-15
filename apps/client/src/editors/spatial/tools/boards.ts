// Le tavole del disegno (livello Standard): crearle, spostarle con ciò che ci
// sta sopra, duplicarle, cambiarne la misura, il nome e l'ordine, toglierle.
// Ogni comando è un `batch` solo, come quelli di `layers.ts`, così annulla e
// ripeti lo disfano intero.
//
// - **Una tavola** è un `view` figlio della radice con `fub:role="board"`: il
//   `viewBox` è il suo rettangolo sulla tela, il primo `title` il suo nome.
//   La sua carta è il `rect` con `fub:board`, con la stessa geometria
//   (formato della scena, tavole). Un comando cambia l'una e l'altra insieme.
// - **La prima tavola nasce dalla pagina.** In un disegno senza tavole la
//   pagina diventa la tavola 1, e la sua carta la carta della tavola; la
//   tavola nuova nasce dopo. Togliere l'ultima fa il contrario: la carta
//   torna della pagina, e la pagina è la tavola, allargata quanto serve a
//   coprire il disegno.
// - **La pagina copre le tavole.** Quando una tavola, o ciò che porta, ne
//   esce, la pagina si allarga a passi come per un oggetto, con `page` per
//   ultimo: allora le carte sono già delle loro tavole, e `page` non le
//   tocca.
// - **Una tavola nuova somiglia alle altre:** ha una carta col colore di
//   quella della tavola da cui prende la misura, o della pagina; nessuna, se
//   quella non ce l'ha.
// - **Una tavola porta con sé ciò che ci sta sopra.** Spostarla sposta gli
//   oggetti che hanno il centro dentro, anche nei livelli nascosti; restano
//   dove sono quelli bloccati, o in un livello bloccato. Cambiarne la misura
//   o toglierla non tocca il disegno.
// - **La copia di una tavola è una tavola nuova con ciò che porta.** Gli
//   oggetti si copiano come li copia «Duplica», con le risorse private che
//   usano, e la carta si copia com'è; la copia sta subito dopo la tavola fra
//   le tavole, e si chiama come lei con «copia», e un numero se quel nome
//   c'è già. Un oggetto che non si copia ferma tutto: niente copie a metà.
// - **Il nome sta nel primo `title`.** Una tavola non si riscrive sul posto
//   come un oggetto, perché per un passo, senza id, non sarebbe più una
//   tavola: si toglie e si rimette al suo posto col nome nuovo, con lo stesso
//   id se ha la forma di quelli di FubDraw, se no con uno nuovo, che le sue
//   carte seguono.

import { formatNumber } from "../number";
import type { Page } from "../painter/paint";
import { collapse } from "../scene/analysis";
import type { Bounds } from "../scene/geometry";
import { isNewId } from "../scene/ids";
import type { Point } from "../scene/matrix";
import { elementChildren, pathOf, scopeOf, type DocumentModel, type ElementPart } from "../scene/model";
import { ROOT, type Op, type Pos } from "../scene/ops";
import { MAX_BOARDS } from "../scene/read";
import type { LengthUnit } from "../scene/rulers";
import { elemToOut, type Elem } from "../scene/serialize";
import { duplicateOps, elemOf, Plan, type Arranged } from "./arrange";
import { moveOps, pageFor, roundDelta, type NewIds } from "./edit";
import type { Unit } from "./hit";
import { NAME_MAX } from "./naming";
import { ResourceCopies } from "./resources";

/// Lo spazio fra la tavola più a destra e quella nuova che le nasce dopo, in
/// unità della scena.
export const BOARD_GAP = 80;

/// Il lato più corto di una tavola, in unità della scena.
export const MIN_BOARD_SIDE = 1;

/// I decimali dei numeri di una tavola, come quelli della geometria.
const PLACES = 2;

/// Un rettangolo sulla tela: l'angolo in alto a sinistra, la larghezza e
/// l'altezza.
export type Rect = readonly [x: number, y: number, width: number, height: number];

/// Una tavola del disegno.
export interface Board {
  /// L'id del `view`.
  readonly id: string;
  /// Il nome come lo dice l'editor: il titolo, o l'id se non ce l'ha.
  readonly name: string;
  /// Il testo del primo `title`, con gli spazi ridotti; vuoto se non c'è.
  readonly title: string;
  /// Il rettangolo, come lo scrive il `viewBox`.
  readonly rect: Rect;
  /// Lo stesso rettangolo come riquadro.
  readonly box: Bounds;
  /// Il `view`.
  readonly node: ElementPart;
  /// La sua carta: la prima con `fub:board` uguale al suo id; `null` se non
  /// ne ha.
  readonly paper: ElementPart | null;
}

/// Vero se `node` è una carta, della pagina o di una tavola.
function isPaper(node: ElementPart): boolean {
  return node.details?.role === "paper";
}

/// Le carte che rimandano alla tavola `id`, in ordine di documento: di solito
/// una sola.
function papersOf(model: DocumentModel, id: string): ElementPart[] {
  return elementChildren(model.root).filter((child) => isPaper(child) && child.details!.board === id);
}

/// Le tavole di `model`, nel loro ordine, ognuna con la sua carta.
export function boardsOf(model: DocumentModel): Board[] {
  const children = elementChildren(model.root);
  const papers = new Map<string, ElementPart>();
  for (const child of children) {
    const board = isPaper(child) ? child.details!.board : undefined;
    if (board !== undefined && !papers.has(board)) papers.set(board, child);
  }
  const boards: Board[] = [];
  for (const child of children) {
    const details = child.details;
    const id = child.facts.id;
    if (details?.role !== "board" || details.box === undefined || id === null) continue;
    const title = collapse(details.title ?? "");
    const rect: Rect = [details.box[0], details.box[1], details.box[2], details.box[3]];
    boards.push({ id, name: title === "" ? id : title, title, rect, box: rectBounds(rect), node: child, paper: papers.get(id) ?? null });
  }
  return boards;
}

/// Il riquadro di `rect`.
export function rectBounds([x, y, width, height]: Rect): Bounds {
  return { min: [x, y], max: [x + width, y + height] };
}

/// Il rettangolo di `bounds`.
export function boundsRect(bounds: Bounds): Rect {
  return [bounds.min[0], bounds.min[1], bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]];
}

/// Il rettangolo della pagina.
export function pageRect(page: Page): Rect {
  return [page.x, page.y, page.width, page.height];
}

/// I quattro numeri di `rect` come li scrive il file.
function numbers(rect: Rect): [string, string, string, string] {
  const [x, y, width, height] = rect.map((v) => formatNumber(v, PLACES));
  return [x!, y!, width!, height!];
}

/// Il `viewBox` di una tavola col rettangolo `rect`.
export function rectText(rect: Rect): string {
  return numbers(rect).join(" ");
}

/// `rect` coi numeri come li scrive il file, e come si rileggono.
export function roundRect(rect: Rect): Rect {
  const [x, y, width, height] = numbers(rect).map(Number);
  return [x!, y!, width!, height!];
}

function sameRect(a: Rect, b: Rect): boolean {
  return rectText(a) === rectText(b);
}

/// Il riquadro che contiene `a` e `b`.
function union(a: Bounds, b: Bounds): Bounds {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  };
}

/// Il nome di una tavola nuova: `nameFor(n)` col primo `n`, da `from`, che
/// nessuna di `taken` porta già; senza `from`, dal numero delle tavole più
/// uno.
export function freshBoardName(taken: readonly string[], nameFor: (n: number) => string, from = taken.length + 1): string {
  const names = new Set(taken);
  let n = from;
  while (names.has(nameFor(n))) n++;
  return nameFor(n);
}

/// `wrap(base)`, non oltre [`NAME_MAX`] caratteri: se è più lungo si accorcia
/// `base`, dalla fine, e non ciò che `wrap` gli mette attorno.
function fitName(base: string, wrap: (base: string) => string): string {
  const length = (text: string): number => Array.from(text).length;
  const chars = Array.from(base);
  let name = wrap(base);
  let keep = chars.length - (length(name) - NAME_MAX);
  while (length(name) > NAME_MAX && keep >= 0) {
    name = wrap(chars.slice(0, keep).join("").trimEnd());
    keep--;
  }
  return name;
}

/// Il nome della copia di una tavola che si chiama `name`: `copy(name, n)`
/// col primo `n`, da 1, che nessuna di `taken` porta già. Non supera
/// [`NAME_MAX`] caratteri: se serve si accorcia `name`, non ciò che la
/// lingua gli aggiunge.
export function copyName(taken: readonly string[], name: string, copy: (name: string, n: number) => string): string {
  return freshBoardName(taken, (n) => fitName(name, (base) => copy(base, n)), 1);
}

/// La tavola sotto il punto `p`: fra quelle che lo contengono, bordi
/// compresi, la più piccola, che è quella che si vede dentro l'altra. `null`
/// se nessuna.
export function boardAt(boards: readonly Board[], p: Point): Board | null {
  let found: Board | null = null;
  for (const board of boards) {
    const { min, max } = board.box;
    if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1]) continue;
    if (found === null || board.rect[2] * board.rect[3] < found.rect[2] * found.rect[3]) found = board;
  }
  return found;
}

/// Gli oggetti di `units` che una tavola col riquadro `box` porta con sé:
/// quelli che hanno il centro dentro, bordi compresi.
export function carriedBy(box: Bounds, units: readonly Unit[]): Unit[] {
  return units.filter((unit) => {
    const bounds = unit.bounds;
    if (bounds === null) return false;
    const x = (bounds.min[0] + bounds.max[0]) / 2;
    const y = (bounds.min[1] + bounds.max[1]) / 2;
    return x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1];
  });
}

/// Il rettangolo di una tavola nuova: della misura di `like`, o dell'ultima
/// tavola, o della pagina in un disegno senza tavole; in alto come lei, a
/// destra di tutte le tavole a [`BOARD_GAP`] unità. `null` senza tavole e
/// senza pagina.
export function nextBoardRect(boards: readonly Board[], page: Page | null, like: Board | null = null): Rect | null {
  const model = like ?? boards[boards.length - 1] ?? null;
  const base = model !== null ? model.rect : page === null ? null : pageRect(page);
  if (base === null) return null;
  const right = boards.reduce((most, board) => Math.max(most, board.box.max[0]), base[0] + base[2]);
  return roundRect([right + BOARD_GAP, base[1], base[2], base[3]]);
}

/// Dove va la copia di una tavola col rettangolo `rect` quando non la porta
/// il puntatore: lo spostamento che la mette alla sua destra, a
/// [`BOARD_GAP`] unità, e più a destra finché, con lo stesso spazio attorno,
/// non tocca nessuna di `boards`. Resta alla stessa altezza.
export function duplicateSpot(boards: readonly Board[], rect: Rect): [dx: number, dy: number] {
  const [left, top, width, height] = rect;
  let x = left + width + BOARD_GAP;
  for (;;) {
    // Oltre ogni tavola che toccherebbe, spazio compreso: una tavola
    // superata non torna davanti, perché la copia va solo a destra.
    let past = x;
    for (const { box } of boards) {
      const near = x < box.max[0] + BOARD_GAP && box.min[0] < x + width + BOARD_GAP && top < box.max[1] + BOARD_GAP && box.min[1] < top + height + BOARD_GAP;
      if (near) past = Math.max(past, box.max[0] + BOARD_GAP);
    }
    if (past === x) return [roundDelta(x - left), 0];
    x = past;
  }
}

/// Il `view` di una tavola nuova.
function boardElem(id: string, rect: Rect, name: string): Elem {
  return { tag: "view", attrs: { id, "fub:role": "board", viewBox: rectText(rect) }, children: [{ tag: "title", attrs: {}, text: name }] };
}

/// La geometria di una carta col rettangolo `rect`.
function geometry(rect: Rect): Record<"x" | "y" | "width" | "height", string> {
  const [x, y, width, height] = numbers(rect);
  return { x, y, width, height };
}

/// Il colore della carta `paper`, da dare a una carta nuova: il suo `fill`
/// se è un colore, bianco se rimanda a una risorsa, che è sua; `null` se non
/// lo scrive, come la carta nuova.
function paperFill(paper: ElementPart): string | null {
  const fill = elemOf(paper)?.attrs.fill;
  if (fill === undefined) return null;
  return fill.includes("url(") ? "#ffffff" : fill;
}

/// La carta di una tavola nuova.
function paperElem(id: string, board: string, rect: Rect, fill: string | null): Elem {
  const attrs: Record<string, string> = { id, "fub:role": "paper", "fub:board": board, ...geometry(rect) };
  if (fill !== null) attrs.fill = fill;
  return { tag: "rect", attrs };
}

/// `elem` senza id: un titolo o una descrizione che si copia.
function withoutId(elem: Elem): Elem {
  const attrs = { ...elem.attrs };
  delete attrs.id;
  return { ...elem, attrs };
}

/// La copia della carta `paper` per la tavola `board`, con l'id `id` e la
/// geometria di `rect`: gli altri attributi restano, e titoli e descrizioni
/// la seguono senza id. `null` se ha parti o nomi che un'operazione non sa
/// scrivere.
function paperCopy(model: DocumentModel, paper: ElementPart, id: string, board: string, rect: Rect): Elem | null {
  const elem = elemOf(paper);
  if (elem === null) return null;
  const attrs = { ...elem.attrs, id, "fub:board": board, ...geometry(rect) };
  const copy: Elem = elem.children === undefined ? { tag: "rect", attrs } : { tag: "rect", attrs, children: elem.children.map(withoutId) };
  return writable(copy, model) ? copy : null;
}

/// Dove va la carta di una tavola nuova: dopo l'ultima carta; in testa se
/// non ce n'è una, o se l'ultima non ha id.
function paperPlace(model: DocumentModel): Pos {
  const papers = elementChildren(model.root).filter(isPaper);
  const last = papers[papers.length - 1]?.facts.id ?? null;
  return last === null ? { first: true } : { after: last };
}

/// Vero se la carta `paper` ha già la geometria di `rect`, come valori.
function hasGeometry(paper: ElementPart, rect: Rect): boolean {
  const attrs = elemOf(paper)?.attrs;
  if (attrs === undefined) return false;
  const wanted = geometry(rect);
  return (["x", "y", "width", "height"] as const).every((key) => attrs[key] !== undefined && Number(attrs[key]) === Number(wanted[key]));
}

/// La tavola 1 che nasce dalla pagina di un disegno senza tavole.
interface PageBoard {
  readonly id: string;
  readonly rect: Rect;
  /// La carta della pagina, che diventa sua; `null` se la pagina non ne ha.
  readonly paper: ElementPart | null;
  /// Le operazioni che la creano.
  readonly ops: readonly Op[];
}

/// La pagina `page` di un disegno senza tavole che diventa la tavola 1, col
/// nome `name`: la tavola ha il rettangolo della pagina, e la carta della
/// pagina diventa la sua. `"paper"` se la pagina ha più di una carta, o una
/// carta senza id.
function pageBoard(model: DocumentModel, page: Page, name: string, ids: NewIds): PageBoard | "paper" {
  const free = elementChildren(model.root).filter((child) => isPaper(child) && child.details!.board === undefined);
  if (free.length > 1 || (free.length === 1 && free[0]!.facts.id === null)) return "paper";
  const paper = free[0] ?? null;
  const rect = roundRect(pageRect(page));
  const id = ids.next("board");
  const ops: Op[] = [{ op: "add", parent: ROOT, pos: paper === null ? { first: true } : { after: paper.facts.id! }, elem: boardElem(id, rect, name) }];
  if (paper !== null) {
    ops.push({ op: "set", id: paper.facts.id!, attrs: { "fub:board": id } });
    // Diventata di una tavola, la carta cambia anche in geometria: una che
    // non era quella della pagina la prende.
    if (!hasGeometry(paper, rect)) ops.push({ op: "set", id: paper.facts.id!, attrs: geometry(rect) });
  }
  return { id, rect, paper, ops };
}

/// Le operazioni che danno alla tavola `board` e alle sue carte il
/// rettangolo `rect`.
function placeSheets(plan: Plan, board: Board, rect: Rect): void {
  plan.ops.push({ op: "set", id: board.id, attrs: { viewBox: rectText(rect) } });
  for (const paper of papersOf(plan.model, board.id)) plan.ops.push({ op: "set", id: plan.idOf(paper, "paper"), attrs: geometry(rect) });
}

/// In fondo al comando, la pagina allargata quanto basta a coprire `cover`.
function growPage(plan: Plan, page: Page | null, cover: Bounds): void {
  const grown = pageFor(page, cover);
  if (grown !== null) plan.ops.push({ op: "page", viewBox: grown });
}

/// Perché una tavola non si aggiunge: il disegno ne ha già [`MAX_BOARDS`]
/// (`"limit"`), o la sua pagina non sa diventare la prima, perché ha più di
/// una carta, o una carta senza id (`"paper"`).
export type AddRefusal = "limit" | "paper";

/// Le operazioni che aggiungono una tavola col rettangolo `rect`, dopo
/// l'ultima. In un disegno senza tavole che ha una pagina, la pagina diventa
/// prima la tavola 1. I nomi sono `nameFor(n)` col primo `n` libero. La carta
/// della tavola nuova somiglia a quella di `like`, o dell'ultima tavola, o
/// della pagina. La chiave che torna è l'id della tavola nuova.
export function addBoardOps(
  model: DocumentModel,
  rect: Rect,
  nameFor: (n: number) => string,
  ids: NewIds,
  page: Page | null,
  like: Board | null = null,
): Arranged | AddRefusal {
  const boards = boardsOf(model);
  if (boards.length >= MAX_BOARDS) return "limit";
  const plan = new Plan(model, ids);
  const names = boards.map((board) => board.name);
  let lastBoard = boards[boards.length - 1]?.id ?? null;
  // La carta su cui la nuova prende esempio; `undefined` se non ce n'è
  // nessuna su cui prenderlo.
  let sample: ElementPart | null | undefined = like?.paper ?? boards[boards.length - 1]?.paper;
  if (like !== null && like.paper === null) sample = null;
  if (boards.length === 0 && page !== null) {
    const name = freshBoardName(names, nameFor);
    const first = pageBoard(model, page, name, ids);
    if (first === "paper") return "paper";
    names.push(name);
    plan.ops.push(...first.ops);
    lastBoard = first.id;
    sample = first.paper;
  }
  const next = roundRect(rect);
  const id = ids.next("board");
  if (sample !== undefined && sample !== null) {
    plan.ops.push({ op: "add", parent: ROOT, pos: paperPlace(model), elem: paperElem(ids.next("paper"), id, next, paperFill(sample)) });
  }
  const name = freshBoardName(names, nameFor);
  plan.ops.push({ op: "add", parent: ROOT, pos: lastBoard === null ? { first: true } : { after: lastBoard }, elem: boardElem(id, next, name) });
  growPage(plan, page, rectBounds(next));
  return plan.finish([id]);
}

/// Le operazioni che fanno della pagina `page` di un disegno senza tavole la
/// tavola 1, col nome `nameFor(1)`, e nient'altro: è il primo dei due passi
/// con cui l'editor aggiunge o duplica una tavola su una pagina, così chi
/// annulla la tavola nuova ritrova la tavola 1. La chiave che torna è l'id
/// della tavola; nessuna operazione se il disegno ha già tavole.
export function pageBoardOps(model: DocumentModel, nameFor: (n: number) => string, ids: NewIds, page: Page): Arranged | "paper" {
  if (boardsOf(model).length > 0) return { ops: [], keys: [] };
  const first = pageBoard(model, page, freshBoardName([], nameFor), ids);
  if (first === "paper") return "paper";
  const plan = new Plan(model, ids);
  plan.ops.push(...first.ops);
  return plan.finish([first.id]);
}

/// Ciò che la pagina deve coprire quando una tavola arriva al rettangolo
/// `rect` con gli oggetti di `carried`, spostati di (`dx`, `dy`) con lei.
function coverOf(rect: Rect, carried: readonly Unit[], dx: number, dy: number): Bounds {
  let cover = rectBounds(rect);
  for (const unit of carried) {
    const bounds = unit.bounds;
    if (bounds !== null) cover = union(cover, { min: [bounds.min[0] + dx, bounds.min[1] + dy], max: [bounds.max[0] + dx, bounds.max[1] + dy] });
  }
  return cover;
}

/// Le operazioni che spostano la tavola `board` di (`dx`, `dy`), già
/// arrotondati, con le sue carte e gli oggetti di `carried`. La chiave che
/// torna è l'id della tavola.
export function moveBoardOps(model: DocumentModel, board: Board, dx: number, dy: number, carried: readonly Unit[], ids: NewIds, page: Page | null): Arranged {
  if (dx === 0 && dy === 0) return { ops: [], keys: [board.id] };
  const plan = new Plan(model, ids);
  const rect = roundRect([board.rect[0] + dx, board.rect[1] + dy, board.rect[2], board.rect[3]]);
  placeSheets(plan, board, rect);
  plan.ops.push(...moveOps(carried, dx, dy, ids).ops);
  growPage(plan, page, coverOf(rect, carried, dx, dy));
  return plan.finish([board.id]);
}

/// I nomi che scrive un duplicato, nella lingua di adesso.
export interface CopyNames {
  /// Il nome della tavola `n` che nasce dalla pagina: «Tavola n».
  board(n: number): string;
  /// Il nome della copia `n` di una tavola che si chiama `name`: «{name}
  /// copia» la prima, poi «{name} copia {n}».
  copy(name: string, n: number): string;
}

/// Perché una tavola non si duplica: quelli di [`AddRefusal`], o un oggetto
/// che porta e che non si copia, perché ha parti estranee (`"content"`).
export type DuplicateRefusal = AddRefusal | "content";

/// Le operazioni che duplicano la tavola `board` con gli oggetti di
/// `carried`, ciò che porta: la copia è spostata di (`dx`, `dy`), già
/// arrotondati, e sta subito dopo di lei fra le tavole, col nome di
/// [`copyName`]; la sua carta, se ce l'ha, è una copia della sua, e gli
/// oggetti si copiano come li copia «Duplica», con le risorse private che
/// usano. Con `board` `null` si duplica la pagina di un disegno senza
/// tavole, che prima diventa la tavola 1 come in [`addBoardOps`]. La pagina
/// si allarga a coprire la copia e ciò che porta. La chiave che torna è l'id
/// della copia; nessuna operazione se non c'è una tavola o una pagina da
/// duplicare.
export function duplicateBoardOps(
  model: DocumentModel,
  board: Board | null,
  dx: number,
  dy: number,
  carried: readonly Unit[],
  names: CopyNames,
  ids: NewIds,
  page: Page | null,
): Arranged | DuplicateRefusal {
  const boards = boardsOf(model);
  if (board === null && (boards.length > 0 || page === null)) return { ops: [], keys: [] };
  // Dalla pagina nascono due tavole: lei e la copia.
  if (boards.length + (board === null ? 2 : 1) > MAX_BOARDS) return "limit";
  let made: PageBoard | null = null;
  let from: Pick<Board, "id" | "rect" | "name" | "paper">;
  if (board === null) {
    const name = freshBoardName([], (n) => names.board(n));
    const first = pageBoard(model, page!, name, ids);
    if (first === "paper") return "paper";
    made = first;
    from = { id: first.id, rect: first.rect, name, paper: first.paper };
  } else {
    from = board;
  }
  const id = ids.next("board");
  const rect = roundRect([from.rect[0] + dx, from.rect[1] + dy, from.rect[2], from.rect[3]]);
  const name = copyName(made === null ? boards.map((each) => each.name) : [from.name], from.name, (base, n) => names.copy(base, n));
  // Le risorse della carta si copiano con quelle degli oggetti: la `defs`
  // che le riceve, se manca, nasce una volta sola.
  let copies = new ResourceCopies(model, ids, elemOf);
  let sheet: Elem | null = null;
  if (from.paper !== null) {
    const paper = ids.next("paper");
    const exact = paperCopy(model, from.paper, paper, id, rect);
    sheet = exact === null ? null : copies.adopt(exact);
    if (sheet === null) {
      // Una carta che non si sa copiare somiglia alla sua, come quella di
      // una tavola nuova; le copie a metà delle sue risorse se ne vanno.
      copies = new ResourceCopies(model, ids, elemOf);
      sheet = paperElem(paper, id, rect, paperFill(from.paper));
    }
  }
  const content = duplicateOps(model, carried, dx, dy, ids, copies);
  if (content === null) return "content";
  const plan = new Plan(model, ids);
  // Prima le copie degli oggetti, che nominano col percorso chi non ha id:
  // una tavola o una carta aggiunta prima cambierebbe i percorsi.
  plan.ops.push(...content.ops);
  if (made !== null) plan.ops.push(...made.ops);
  if (sheet !== null) plan.ops.push({ op: "add", parent: ROOT, pos: paperPlace(model), elem: sheet });
  const view = board === null ? null : copiedView(model, board, id, rect, name);
  plan.ops.push({ op: "add", parent: ROOT, pos: { after: from.id }, elem: view ?? boardElem(id, rect, name) });
  growPage(plan, page, coverOf(rect, carried, dx, dy));
  return plan.finish([id]);
}

/// Le operazioni che danno alla tavola `board` il rettangolo `rect`, con le
/// sue carte; il disegno resta dov'è. La chiave che torna è l'id della
/// tavola.
export function resizeBoardOps(model: DocumentModel, board: Board, rect: Rect, ids: NewIds, page: Page | null): Arranged {
  const next = roundRect(rect);
  if (sameRect(next, board.rect) || next[2] <= 0 || next[3] <= 0) return { ops: [], keys: [board.id] };
  const plan = new Plan(model, ids);
  placeSheets(plan, board, next);
  growPage(plan, page, rectBounds(next));
  return plan.finish([board.id]);
}

/// Le operazioni che tolgono la tavola `board`; il disegno resta com'è.
/// Con lei se ne vanno le sue carte, tranne con l'ultima tavola: allora la
/// sua carta torna della pagina, e la pagina diventa il suo rettangolo,
/// allargato a passi finché copre `extent`, il riquadro di tutto il disegno.
export function removeBoardOps(model: DocumentModel, board: Board, extent: Bounds | null, ids: NewIds): Arranged {
  const plan = new Plan(model, ids);
  const last = boardsOf(model).length === 1;
  const papers = papersOf(model, board.id);
  const kept = last ? (papers[0] ?? null) : null;
  // Prima le carte, dall'ultima: chi non ha id si toglie col suo percorso,
  // che vale finché niente prima di lui se ne va.
  for (const paper of [...papers].reverse()) {
    if (paper !== kept) plan.ops.push({ op: "remove", target: paper.facts.id ?? { path: pathOf(paper), tag: "rect" } });
  }
  plan.ops.push({ op: "remove", target: board.id });
  if (last) {
    if (kept !== null) plan.ops.push({ op: "set", id: plan.idOf(kept, "paper"), attrs: { "fub:board": null } });
    const [x, y, width, height] = board.rect;
    plan.ops.push({ op: "page", viewBox: pageFor({ x, y, width, height }, extent) ?? rectText(board.rect) });
  }
  return plan.finish([]);
}

/// Vero se `elem` si scrive come figlio della radice: un'operazione non
/// dichiara namespace.
function writable(elem: Elem, model: DocumentModel): boolean {
  try {
    elemToOut(elem, scopeOf(model.root));
    return true;
  } catch {
    return false;
  }
}

/// Dove rimettere un elemento nuovo al posto di `node`, un figlio della
/// radice che se ne va prima: dopo l'elemento che lo precede, se ha un id;
/// se no dopo quello che lo segue, che poi gli torna dopo (`then`); se no in
/// testa, dopo titolo, carte e tavole.
function samePlace(node: ElementPart, id: string): { readonly pos: Pos; readonly then: readonly Op[] } {
  const siblings = elementChildren(node.parent!);
  const at = siblings.indexOf(node);
  const before = siblings[at - 1];
  if (before !== undefined && before.details !== null && before.facts.id !== null) return { pos: { after: before.facts.id }, then: [] };
  const after = siblings[at + 1];
  // La carta della pagina non si sposta.
  if (after !== undefined && after.details !== null && after.facts.id !== null && !(isPaper(after) && after.details.board === undefined)) {
    return { pos: { after: after.facts.id }, then: [{ op: "move", target: after.facts.id, parent: ROOT, pos: { after: id } }] };
  }
  return { pos: { first: true }, then: [] };
}

/// Il `view` della tavola `board` col nome `name` nel primo `title`, che
/// nasce se non c'è, e gli attributi `attrs` al posto dei suoi: la
/// descrizione, i titoli in altre lingue e il resto restano. `null` se ha
/// nomi che un'operazione non sa scrivere.
function namedView(model: DocumentModel, board: Board, name: string, attrs: Readonly<Record<string, string>>): Elem | null {
  const elem = elemOf(board.node);
  if (elem === null) return null;
  const children = [...(elem.children ?? [])];
  const at = children.findIndex((child) => child.tag === "title");
  if (at < 0) children.unshift({ tag: "title", attrs: {}, text: name });
  else children[at] = { ...children[at]!, text: name };
  const next: Elem = { tag: "view", attrs: { ...elem.attrs, ...attrs }, children };
  return writable(next, model) ? next : null;
}

/// Il `view` della copia della tavola `board`: il suo, con l'id `id`, il
/// rettangolo `rect` e il nome `name`, e i figli senza id. `null` se ha nomi
/// che un'operazione non sa scrivere.
function copiedView(model: DocumentModel, board: Board, id: string, rect: Rect, name: string): Elem | null {
  const view = namedView(model, board, name, { id, viewBox: rectText(rect) });
  return view === null ? null : { ...view, children: (view.children ?? []).map(withoutId) };
}

/// Le operazioni che danno alla tavola `board` il nome `name`, già pulito da
/// `cleanName`. Nessuna operazione se il nome è vuoto, o se è già il suo.
/// La chiave che torna è l'id della tavola dopo: lo stesso, o uno nuovo se il
/// suo non ha la forma di quelli di FubDraw. `"foreign"` se la tavola ha
/// nomi che un'operazione non sa scrivere.
export function renameBoardOps(model: DocumentModel, board: Board, name: string, ids: NewIds): Arranged | "foreign" {
  if (name === "" || name === board.title) return { ops: [], keys: [] };
  const id = isNewId(board.id, "board") ? board.id : ids.next("board");
  const next = namedView(model, board, name, { id });
  if (next === null) return "foreign";
  const plan = new Plan(model, ids);
  const place = samePlace(board.node, id);
  plan.ops.push({ op: "remove", target: board.id }, { op: "add", parent: ROOT, pos: place.pos, elem: next }, ...place.then);
  if (id !== board.id) for (const paper of papersOf(model, board.id)) plan.ops.push({ op: "set", id: plan.idOf(paper, "paper"), attrs: { "fub:board": id } });
  return plan.finish([id]);
}

/// Le operazioni che portano la tavola `board` al posto `to`, contato da 0,
/// fra le tavole: cambia l'ordine dei `view`, e basta. La chiave che torna è
/// il suo id.
export function reorderBoardOps(model: DocumentModel, board: Board, to: number): Arranged {
  const boards = boardsOf(model);
  const from = boards.findIndex((each) => each.id === board.id);
  const place = Math.max(0, Math.min(boards.length - 1, Math.trunc(to)));
  if (from < 0 || place === from) return { ops: [], keys: [board.id] };
  const there = boards[place]!;
  if (place > from) return { ops: [{ op: "move", target: board.id, parent: ROOT, pos: { after: there.id } }], keys: [board.id] };
  // Prima di quella che sta lì: dopo l'elemento che la precede, se ha un id;
  // se no le due si scambiano.
  const siblings = elementChildren(model.root);
  const before = siblings[siblings.indexOf(there.node) - 1];
  const ops: Op[] =
    before !== undefined && before.details !== null && before.facts.id !== null
      ? [{ op: "move", target: board.id, parent: ROOT, pos: { after: before.facts.id } }]
      : [
          { op: "move", target: board.id, parent: ROOT, pos: { after: there.id } },
          { op: "move", target: there.id, parent: ROOT, pos: { after: board.id } },
        ];
  return { ops, keys: [board.id] };
}

// ---------------------------------------------------------------------------
// Le misure pronte.
// ---------------------------------------------------------------------------

/// Le misure pronte di una tavola o della pagina.
export type PresetId = "a3" | "a4" | "a5" | "letter" | "legal" | "tabloid" | "hd" | "full-hd" | "xga" | "phone" | "square" | "drawing";

/// Una misura pronta, in unità della scena, nel verso in cui si usa di più:
/// in piedi la carta e il telefono, coricati gli schermi.
export interface Preset {
  readonly id: PresetId;
  readonly width: number;
  readonly height: number;
  /// L'unità in cui la misura è nata, e in cui la si dice: i millimetri
  /// dei fogli ISO, i pollici di quelli americani, i pixel degli schermi.
  readonly unit: LengthUnit;
}

/// Un millimetro e un pollice in unità della scena, che sono pixel CSS.
const MM = 96 / 25.4;
const INCH = 96;

/// Le misure pronte: i fogli ISO e americani, gli schermi 16:9 e 4:3, un
/// telefono, il quadrato dei post, e la misura di un disegno nuovo.
export const PRESETS: readonly Preset[] = [
  { id: "a3", width: 297 * MM, height: 420 * MM, unit: "mm" },
  { id: "a4", width: 210 * MM, height: 297 * MM, unit: "mm" },
  { id: "a5", width: 148 * MM, height: 210 * MM, unit: "mm" },
  { id: "letter", width: 8.5 * INCH, height: 11 * INCH, unit: "in" },
  { id: "legal", width: 8.5 * INCH, height: 14 * INCH, unit: "in" },
  { id: "tabloid", width: 11 * INCH, height: 17 * INCH, unit: "in" },
  { id: "hd", width: 1280, height: 720, unit: "px" },
  { id: "full-hd", width: 1920, height: 1080, unit: "px" },
  { id: "xga", width: 1024, height: 768, unit: "px" },
  { id: "phone", width: 390, height: 844, unit: "px" },
  { id: "square", width: 1080, height: 1080, unit: "px" },
  { id: "drawing", width: 1600, height: 1000, unit: "px" },
];

/// Il verso di un rettangolo.
export type Orientation = "portrait" | "landscape" | "square";

export function orientationOf(rect: Rect): Orientation {
  const [, , width, height] = roundRect(rect);
  return width === height ? "square" : width > height ? "landscape" : "portrait";
}

/// La misura pronta di `rect`, in un verso o nell'altro, coi numeri come li
/// scrive il file; `null` se nessuna.
export function presetOf(rect: Rect): Preset | null {
  const [, , width, height] = roundRect(rect);
  return (
    PRESETS.find((preset) => {
      const [w, h] = [Number(formatNumber(preset.width, PLACES)), Number(formatNumber(preset.height, PLACES))];
      return (w === width && h === height) || (w === height && h === width);
    }) ?? null
  );
}

/// `rect` con la misura di `preset`, nel verso di `rect`, o in quello del
/// preset se `rect` è quadrato; l'angolo in alto a sinistra resta.
export function presetRect(rect: Rect, preset: Preset): Rect {
  const orientation = orientationOf(rect);
  const long = Math.max(preset.width, preset.height);
  const short = Math.min(preset.width, preset.height);
  const [width, height] = orientation === "landscape" ? [long, short] : orientation === "portrait" ? [short, long] : [preset.width, preset.height];
  return roundRect([rect[0], rect[1], width, height]);
}

/// `rect` nel verso `orientation`: larghezza e altezza si scambiano se serve;
/// l'angolo in alto a sinistra resta.
export function orientedRect(rect: Rect, orientation: "portrait" | "landscape"): Rect {
  const [x, y, width, height] = rect;
  const wide = width > height;
  if (width === height || wide === (orientation === "landscape")) return rect;
  return [x, y, height, width];
}
