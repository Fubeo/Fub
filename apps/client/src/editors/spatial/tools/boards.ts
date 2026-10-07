// Le tavole del disegno (livello Standard): crearle, spostarle con ciò che ci
// sta sopra, cambiarne la misura, il nome e l'ordine, toglierle. Ogni comando
// è un `batch` solo, come quelli di `layers.ts`, così annulla e ripeti lo
// disfano intero.
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
import { elemToOut, type Elem } from "../scene/serialize";
import { elemOf, Plan, type Arranged } from "./arrange";
import { moveOps, pageFor, type NewIds } from "./edit";
import type { Unit } from "./hit";

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

/// Il nome di una tavola nuova: `nameFor(n)` col primo `n`, dal numero delle
/// tavole più uno, che nessuna di `taken` porta già.
export function freshBoardName(taken: readonly string[], nameFor: (n: number) => string): string {
  const names = new Set(taken);
  let n = taken.length + 1;
  while (names.has(nameFor(n))) n++;
  return nameFor(n);
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

/// Vero se la carta `paper` ha già la geometria di `rect`, come valori.
function hasGeometry(paper: ElementPart, rect: Rect): boolean {
  const attrs = elemOf(paper)?.attrs;
  if (attrs === undefined) return false;
  const wanted = geometry(rect);
  return (["x", "y", "width", "height"] as const).every((key) => attrs[key] !== undefined && Number(attrs[key]) === Number(wanted[key]));
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
  const children = elementChildren(model.root);
  const plan = new Plan(model, ids);
  const names = boards.map((board) => board.name);
  let lastBoard = boards[boards.length - 1]?.id ?? null;
  // La carta su cui la nuova prende esempio; `undefined` se non ce n'è
  // nessuna su cui prenderlo.
  let sample: ElementPart | null | undefined = like?.paper ?? boards[boards.length - 1]?.paper;
  if (like !== null && like.paper === null) sample = null;
  if (boards.length === 0 && page !== null) {
    const free = children.filter((child) => isPaper(child) && child.details!.board === undefined);
    if (free.length > 1 || (free.length === 1 && free[0]!.facts.id === null)) return "paper";
    const paper = free[0] ?? null;
    const first = roundRect(pageRect(page));
    const id = ids.next("board");
    const name = freshBoardName(names, nameFor);
    names.push(name);
    plan.ops.push({ op: "add", parent: ROOT, pos: paper === null ? { first: true } : { after: paper.facts.id! }, elem: boardElem(id, first, name) });
    if (paper !== null) {
      plan.ops.push({ op: "set", id: paper.facts.id!, attrs: { "fub:board": id } });
      // Diventata di una tavola, la carta cambia anche in geometria: una che
      // non era quella della pagina la prende.
      if (!hasGeometry(paper, first)) plan.ops.push({ op: "set", id: paper.facts.id!, attrs: geometry(first) });
    }
    lastBoard = id;
    sample = paper;
  }
  const next = roundRect(rect);
  const id = ids.next("board");
  if (sample !== undefined && sample !== null) {
    const papers = elementChildren(model.root).filter(isPaper);
    const last = papers[papers.length - 1]?.facts.id ?? null;
    const pos: Pos = last === null ? { first: true } : { after: last };
    plan.ops.push({ op: "add", parent: ROOT, pos, elem: paperElem(ids.next("paper"), id, next, paperFill(sample)) });
  }
  const name = freshBoardName(names, nameFor);
  plan.ops.push({ op: "add", parent: ROOT, pos: lastBoard === null ? { first: true } : { after: lastBoard }, elem: boardElem(id, next, name) });
  growPage(plan, page, rectBounds(next));
  return plan.finish([id]);
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
  let cover = rectBounds(rect);
  for (const unit of carried) {
    const bounds = unit.bounds;
    if (bounds !== null) cover = union(cover, { min: [bounds.min[0] + dx, bounds.min[1] + dy], max: [bounds.max[0] + dx, bounds.max[1] + dy] });
  }
  growPage(plan, page, cover);
  return plan.finish([board.id]);
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

/// Le operazioni che danno alla tavola `board` il nome `name`, già pulito da
/// `cleanName`. Nessuna operazione se il nome è vuoto, o se è già il suo.
/// La chiave che torna è l'id della tavola dopo: lo stesso, o uno nuovo se il
/// suo non ha la forma di quelli di FubDraw. `"foreign"` se la tavola ha
/// nomi che un'operazione non sa scrivere.
export function renameBoardOps(model: DocumentModel, board: Board, name: string, ids: NewIds): Arranged | "foreign" {
  if (name === "" || name === board.title) return { ops: [], keys: [] };
  const elem = elemOf(board.node);
  if (elem === null) return "foreign";
  const children = [...(elem.children ?? [])];
  const at = children.findIndex((child) => child.tag === "title");
  if (at < 0) children.unshift({ tag: "title", attrs: {}, text: name });
  else children[at] = { ...children[at]!, text: name };
  const id = isNewId(board.id, "board") ? board.id : ids.next("board");
  const next: Elem = { tag: "view", attrs: { ...elem.attrs, id }, children };
  if (!writable(next, model)) return "foreign";
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
export type PresetId = "a3" | "a4" | "a5" | "letter" | "legal" | "tabloid" | "hd" | "full-hd" | "square" | "drawing";

/// Una misura pronta, in unità della scena, nel verso in cui si usa di più:
/// in piedi la carta, coricato lo schermo.
export interface Preset {
  readonly id: PresetId;
  readonly width: number;
  readonly height: number;
}

/// Un millimetro e un pollice in unità della scena, che sono pixel CSS.
const MM = 96 / 25.4;
const INCH = 96;

/// Le misure pronte: i fogli ISO e americani, gli schermi, e la misura di un
/// disegno nuovo.
export const PRESETS: readonly Preset[] = [
  { id: "a3", width: 297 * MM, height: 420 * MM },
  { id: "a4", width: 210 * MM, height: 297 * MM },
  { id: "a5", width: 148 * MM, height: 210 * MM },
  { id: "letter", width: 8.5 * INCH, height: 11 * INCH },
  { id: "legal", width: 8.5 * INCH, height: 14 * INCH },
  { id: "tabloid", width: 11 * INCH, height: 17 * INCH },
  { id: "hd", width: 1280, height: 720 },
  { id: "full-hd", width: 1920, height: 1080 },
  { id: "square", width: 1080, height: 1080 },
  { id: "drawing", width: 1600, height: 1000 },
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
