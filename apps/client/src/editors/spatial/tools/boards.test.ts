// Le tavole: come si leggono, le operazioni di ogni comando, che il motore le
// accetta così come sono, che le carte seguono le loro tavole e che un
// annulla riporta il testo identico.

import { describe, expect, it } from "vitest";
import type { Page } from "../painter/paint";
import { elementChildren, type ContainerNode } from "../scene/model";
import { readScene } from "../scene/read";
import { HEAD } from "../scene/test-support";
import type { Arranged } from "./arrange";
import {
  addBoardOps,
  boardAt,
  boardsOf,
  carriedBy,
  copyName,
  duplicateBoardOps,
  duplicateSpot,
  freshBoardName,
  moveBoardOps,
  nextBoardRect,
  orientationOf,
  orientedRect,
  pageBoardOps,
  pageRect,
  presetOf,
  presetRect,
  PRESETS,
  rectBounds,
  removeBoardOps,
  renameBoardOps,
  reorderBoardOps,
  resizeBoardOps,
  type Board,
  type CopyNames,
  type DuplicateRefusal,
} from "./boards";
import { gesture, NewIds } from "./edit";
import { NAME_MAX } from "./naming";
import { toUnit } from "./rulers";
import { open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);
const nameFor = (n: number): string => `Tavola ${n}`;

/// Un disegno con la pagina `viewBox`, o senza pagina se è `null`, e le
/// `parts` dentro la radice, una per riga.
function drawing(parts: readonly string[], viewBox: string | null = "0 0 400 200"): string {
  const head = HEAD.replace(' viewBox="0 0 100 100"', viewBox === null ? "" : ` viewBox="${viewBox}"`);
  return `${head}\n${parts.map((part) => `  ${part}\n`).join("")}</svg>\n`;
}

/// La pagina del disegno di adesso, letta dal `viewBox` della radice.
function pageOf(opened: Opened): Page | null {
  const match = /<svg[^>]*\sviewBox="([^"]+)"/.exec(opened.engine.text);
  if (match === null) return null;
  const [x, y, width, height] = match[1]!.split(/[ ,]+/).map(Number);
  return { x: x!, y: y!, width: width!, height: height! };
}

const boardsNow = (opened: Opened): Board[] => boardsOf(opened.engine.model!);
const board = (opened: Opened, id: string): Board => boardsNow(opened).find((each) => each.id === id)!;

/// Applica `arranged` e verifica che annulla e ripeti diano il testo di
/// prima e quello di dopo, e che dopo ogni carta vada con la sua tavola.
/// Tornano le tavole di dopo.
function applied(opened: Opened, arranged: Arranged | string): Board[] {
  if (typeof arranged === "string") throw new Error(`rifiutato: ${arranged}`);
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(arranged.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(arranged.ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  expect(readScene(after).diagnostics.filter((d) => d.code === "S015")).toEqual([]);
  opened.reindex();
  return boardsNow(opened);
}

/// Gli id dei figli della radice, in ordine.
const order = (opened: Opened): string[] => Array.from(opened.engine.text.matchAll(/^ {2}<[a-z]+ id="([^"]+)"/gm), (match) => match[1]!);

const PAPER = '<rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="200" fill="#ffffff"/>';
const LAYER = (body = ""): string => `<g id="laaaaaaaa" fub:layer="Livello 1">${body}</g>`;
const RECT = (id: string, x: number, y = 0, extra = ""): string => `<rect id="${id}" x="${x}" y="${y}" width="20" height="20"${extra}/>`;

/// Un disegno di una pagina sola, 400 × 200.
const PLAIN = drawing(["<title>Prova</title>", PAPER, LAYER(RECT("oaaaaaaaa", 10))]);

const P1 = '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa"/>';
const P2 = '<rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200" fill="#fafafa"/>';
const V1 = '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><title>Copertina</title></view>';
const V2 = '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><title>Evaporazione</title></view>';

/// Due tavole 400 × 200, la seconda a 80 unità dalla prima.
const TWO = (body = ""): string => drawing(["<title>Ciclo</title>", P1, P2, V1, V2, LAYER(body)], "0 0 1024 256");

describe("le tavole di un disegno", () => {
  it("si leggono in ordine, col nome, il rettangolo e la carta", () => {
    const boards = boardsNow(open(TWO()));
    expect(boards.map((each) => [each.id, each.name, each.rect, each.paper?.facts.id])).toEqual([
      ["b1a2b3c4d", "Copertina", [0, 0, 400, 200], "fub-paper"],
      ["b9i0j1k2l", "Evaporazione", [480, 0, 400, 200], "c5e6f7g8h"],
    ]);
    expect(boards[1]!.box).toEqual({ min: [480, 0], max: [880, 200] });
  });

  it("senza titolo si chiamano col loro id, e il titolo perde gli spazi in più", () => {
    const boards = boardsNow(open(drawing(['<view id="bzzzzzzzz" fub:role="board" viewBox="0 0 10 10"/>', '<view id="byyyyyyyy" fub:role="board" viewBox="0 0 5 5"><title>  Due\n  parole </title></view>'])));
    expect(boards.map((each) => [each.name, each.title, each.paper])).toEqual([
      ["bzzzzzzzz", "", null],
      ["Due parole", "Due parole", null],
    ]);
  });

  it("una tavola nuova si chiama col primo numero libero", () => {
    expect(freshBoardName([], nameFor)).toBe("Tavola 1");
    expect(freshBoardName(["Copertina", "Tavola 3"], nameFor)).toBe("Tavola 4");
    expect(freshBoardName(["Tavola 2", "Fine"], nameFor)).toBe("Tavola 3");
  });

  it("sotto un punto c'è la più piccola che lo contiene", () => {
    const boards = boardsNow(open(drawing(['<view id="bgrandeee" fub:role="board" viewBox="0 0 400 400"/>', '<view id="bpiccolaa" fub:role="board" viewBox="100 100 50 50"/>'])));
    expect(boardAt(boards, [120, 120])?.id).toBe("bpiccolaa");
    expect(boardAt(boards, [10, 10])?.id).toBe("bgrandeee");
    expect(boardAt(boards, [400, 400])?.id).toBe("bgrandeee");
    expect(boardAt(boards, [401, 10])).toBeNull();
  });

  it("una tavola nuova nasce a destra di tutte, alta come l'ultima o come la pagina", () => {
    const boards = boardsNow(open(TWO()));
    expect(nextBoardRect(boards, null)).toEqual([960, 0, 400, 200]);
    const small = { ...boards[0]!, rect: [0, 50, 100, 60] as const };
    expect(nextBoardRect(boards, null, small)).toEqual([960, 50, 100, 60]);
    expect(nextBoardRect([], { x: 10, y: 20, width: 300, height: 100 })).toEqual([390, 20, 300, 100]);
    expect(nextBoardRect([], null)).toBeNull();
  });
});

describe("aggiungere una tavola", () => {
  it("in un disegno senza tavole fa della pagina la tavola 1, e la nuova le nasce accanto", () => {
    const opened = open(PLAIN);
    const page = pageOf(opened)!;
    const arranged = addBoardOps(opened.engine.model!, nextBoardRect([], page)!, nameFor, ids(opened), page);
    if (typeof arranged === "string") throw new Error(arranged);
    const boards = applied(opened, arranged);
    expect(boards.map((each) => [each.name, each.rect, each.paper?.facts.id === "fub-paper"])).toEqual([
      ["Tavola 1", [0, 0, 400, 200], true],
      ["Tavola 2", [480, 0, 400, 200], false],
    ]);
    expect(arranged.keys).toEqual([boards[1]!.id]);
    expect(boards[1]!.paper!.facts.id).toMatch(/^c[0-9a-z]{8}$/);
    // Le carte, poi le tavole, poi i livelli; la pagina copre le tavole.
    expect(order(opened)).toEqual(["fub-paper", boards[1]!.paper!.facts.id, boards[0]!.id, boards[1]!.id, "laaaaaaaa"]);
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 912, height: 200 });
    expect(opened.engine.text).toMatch(new RegExp(`<rect id="${boards[1]!.paper!.facts.id}" fub:role="paper" fub:board="${boards[1]!.id}" x="480" y="0" width="400" height="200" fill="#ffffff"/>`));
    expect(readScene(opened.engine.text).summary.boards).toEqual(["Tavola 1", "Tavola 2"]);
  });

  it("la pagina da sola diventa la tavola 1, la sua carta con lei, e la tavola nuova dopo dà lo stesso disegno", () => {
    const opened = open(PLAIN);
    const page = pageOf(opened)!;
    const together = open(PLAIN);
    const once = addBoardOps(together.engine.model!, nextBoardRect([], page)!, nameFor, ids(together), page);
    const first = pageBoardOps(opened.engine.model!, nameFor, ids(opened), page);
    if (typeof first === "string") throw new Error(first);
    const boards = applied(opened, first);
    expect(boards.map((each) => [each.name, each.rect, each.paper?.facts.id])).toEqual([["Tavola 1", [0, 0, 400, 200], "fub-paper"]]);
    expect(first.keys).toEqual([boards[0]!.id]);
    // La pagina non cambia: copre già la tavola.
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    // Già con tavole, niente da fare.
    expect(pageBoardOps(opened.engine.model!, nameFor, ids(opened), pageOf(opened)!)).toEqual({ ops: [], keys: [] });
    // Poi la tavola nuova: le stesse tavole, carte e pagina del passo unico.
    applied(opened, addBoardOps(opened.engine.model!, nextBoardRect(boardsNow(opened), pageOf(opened))!, nameFor, ids(opened), pageOf(opened)));
    applied(together, once);
    const shape = (text: string): string => text.replace(/\b([bc])[0-9a-z]{8}\b/g, "$1•");
    expect(shape(opened.engine.text)).toBe(shape(together.engine.text));
  });

  it("una pagina con due carte non diventa una tavola da sola", () => {
    const opened = open(drawing([PAPER, '<rect id="fub-paper-2" fub:role="paper" x="0" y="0" width="400" height="200"/>', LAYER()]));
    expect(pageBoardOps(opened.engine.model!, nameFor, ids(opened), pageOf(opened)!)).toBe("paper");
  });

  it("la carta della pagina che non ne aveva la geometria la prende con la tavola", () => {
    const opened = open(drawing(['<rect id="fub-paper" fub:role="paper" x="0" y="0" width="300" height="200"/>', LAYER()]));
    const page = pageOf(opened)!;
    const boards = applied(opened, addBoardOps(opened.engine.model!, [500, 0, 100, 100], nameFor, ids(opened), page));
    expect(opened.engine.text).toMatch(/<rect id="fub-paper" fub:role="paper" fub:board="b[0-9a-z]{8}" x="0" y="0" width="400" height="200"\/>/);
    // La carta della pagina non scriveva un colore, e nemmeno la nuova.
    expect(opened.engine.text).toMatch(new RegExp(`<rect id="c[0-9a-z]{8}" fub:role="paper" fub:board="${boards[1]!.id}" x="500" y="0" width="100" height="100"/>`));
  });

  it("una pagina senza carta fa tavole senza carta", () => {
    const opened = open(drawing([LAYER(RECT("oaaaaaaaa", 10))]));
    const page = pageOf(opened)!;
    const boards = applied(opened, addBoardOps(opened.engine.model!, nextBoardRect([], page)!, nameFor, ids(opened), page));
    expect(boards.map((each) => [each.name, each.paper])).toEqual([
      ["Tavola 1", null],
      ["Tavola 2", null],
    ]);
    expect(order(opened)).toEqual([boards[0]!.id, boards[1]!.id, "laaaaaaaa"]);
  });

  it("un disegno senza pagina riceve la tavola sola, e resta senza pagina", () => {
    const opened = open(drawing([LAYER(RECT("oaaaaaaaa", 10))], null));
    const boards = applied(opened, addBoardOps(opened.engine.model!, [0, 0, 300, 200], nameFor, ids(opened), null));
    expect(boards.map((each) => [each.name, each.rect])).toEqual([["Tavola 1", [0, 0, 300, 200]]]);
    expect(pageOf(opened)).toBeNull();
  });

  it("dopo l'ultima, con la carta dopo l'ultima carta e del suo colore", () => {
    const opened = open(TWO());
    const page = pageOf(opened)!;
    const boards = applied(opened, addBoardOps(opened.engine.model!, nextBoardRect(boardsNow(opened), page)!, nameFor, ids(opened), page));
    expect(boards.map((each) => each.name)).toEqual(["Copertina", "Evaporazione", "Tavola 3"]);
    const added = boards[2]!;
    expect(added.rect).toEqual([960, 0, 400, 200]);
    expect(order(opened)).toEqual(["fub-paper", "c5e6f7g8h", added.paper!.facts.id, "b1a2b3c4d", "b9i0j1k2l", added.id, "laaaaaaaa"]);
    expect(opened.engine.text).toContain(`fub:board="${added.id}" x="960" y="0" width="400" height="200" fill="#fafafa"/>`);
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 1536, height: 256 });
  });

  it("come una tavola senza carta, senza carta", () => {
    const opened = open(drawing([V1, LAYER()]));
    const like = boardsNow(opened)[0]!;
    const boards = applied(opened, addBoardOps(opened.engine.model!, [480, 0, 400, 200], nameFor, ids(opened), pageOf(opened), like));
    expect(boards[1]!.paper).toBeNull();
  });

  it("non si aggiunge a una pagina con due carte, o con una carta senza id, né oltre il limite", () => {
    const two = open(drawing([PAPER, '<rect id="cdoppiaaa" fub:role="paper" x="0" y="0" width="400" height="200"/>', LAYER()]));
    expect(addBoardOps(two.engine.model!, [500, 0, 10, 10], nameFor, ids(two), pageOf(two))).toBe("paper");
    const nameless = open(drawing(['<rect fub:role="paper" x="0" y="0" width="400" height="200"/>', LAYER()]));
    expect(addBoardOps(nameless.engine.model!, [500, 0, 10, 10], nameFor, ids(nameless), pageOf(nameless))).toBe("paper");
    const views = Array.from({ length: 1000 }, (_, i) => `<view id="b${i.toString(36).padStart(8, "0")}" fub:role="board" viewBox="${i * 10} 0 5 5"/>`);
    const full = open(drawing(views));
    expect(addBoardOps(full.engine.model!, [0, 0, 10, 10], nameFor, ids(full), pageOf(full))).toBe("limit");
  });
});

describe("spostare una tavola", () => {
  const CONTENT = [
    RECT("odentroaa", 100, 50),
    // Il centro sta fuori dalla tavola 1, anche se l'oggetto la tocca.
    RECT("obordoaaa", 395, 50),
    RECT("obloccato", 120, 50, ' fub:locked="true"'),
    RECT("onascosto", 140, 50, ' display="none"'),
    RECT("oaltraaaa", 500, 50),
  ].join("");
  const MORE = [
    '<g id="lnascosto" fub:layer="Nascosto" display="none"><rect id="osottoaaa" x="10" y="10" width="20" height="20"/></g>',
    '<g id="lbloccato" fub:layer="Bloccato" fub:locked="true"><rect id="ofermoaaa" x="30" y="30" width="20" height="20"/></g>',
  ];
  const source = drawing(["<title>Ciclo</title>", P1, P2, V1, V2, LAYER(CONTENT), ...MORE], "0 0 1024 256");

  it("porta ciò che ha il centro dentro, anche nascosto, e non ciò che è bloccato", () => {
    const opened = open(source);
    const carried = carriedBy(board(opened, "b1a2b3c4d").box, opened.movable());
    expect(carried.map((unit) => unit.id).sort()).toEqual(["odentroaa", "onascosto", "osottoaaa"]);
  });

  it("sposta la tavola, la sua carta e ciò che porta, e allarga la pagina", () => {
    const opened = open(source);
    const first = board(opened, "b1a2b3c4d");
    const carried = carriedBy(first.box, opened.movable());
    const boards = applied(opened, moveBoardOps(opened.engine.model!, first, -50, 30, carried, ids(opened), pageOf(opened)));
    expect(boards[0]!.rect).toEqual([-50, 30, 400, 200]);
    expect(opened.engine.text).toContain('fub:board="b1a2b3c4d" x="-50" y="30" width="400" height="200"');
    for (const id of ["odentroaa", "onascosto", "osottoaaa"]) expect(opened.engine.text).toMatch(new RegExp(`id="${id}"[^>]*transform="matrix\\(1 0 0 1 -50 30\\)"`));
    for (const id of ["obordoaaa", "obloccato", "oaltraaaa", "ofermoaaa"]) expect(opened.engine.text).not.toMatch(new RegExp(`id="${id}"[^>]*transform`));
    expect(pageOf(opened)).toEqual({ x: -256, y: 0, width: 1280, height: 256 });
  });

  it("fermo non scrive niente", () => {
    const opened = open(TWO());
    expect(moveBoardOps(opened.engine.model!, boardsNow(opened)[0]!, 0, 0, [], ids(opened), pageOf(opened)).ops).toEqual([]);
  });
});

describe("duplicare una tavola", () => {
  const COPY: CopyNames = {
    board: (n) => `Tavola ${n}`,
    copy: (name, n) => (n === 1 ? `${name} copia` : `${name} copia ${n}`),
  };
  const STOP = '<stop offset="0" stop-color="#ffffff"/>';

  /// Gli id dei figli della radice, in ordine, letti dal modello: la copia
  /// di un oggetto entra nel suo livello, scritto qui su una riga sola.
  const roots = (opened: Opened): string[] => elementChildren(opened.engine.model!.root).flatMap((child) => child.facts.id ?? []);

  /// La copia della tavola `id`, o della pagina con `null`, come la chiede
  /// l'editor: nel posto di `duplicateSpot`, con ciò che la tavola porta.
  function duplicated(opened: Opened, id: string | null): Arranged | DuplicateRefusal {
    const page = pageOf(opened);
    const source = id === null ? null : board(opened, id);
    const rect = source?.rect ?? pageRect(page!);
    const [dx, dy] = duplicateSpot(boardsNow(opened), rect);
    const carried = carriedBy(source?.box ?? rectBounds(rect), opened.movable());
    return duplicateBoardOps(opened.engine.model!, source, dx, dy, carried, COPY, ids(opened), page);
  }

  it("copia la tavola, la sua carta e ciò che porta subito dopo di lei, e allarga la pagina per ultima", () => {
    const opened = open(TWO(RECT("odentroaa", 100, 50) + RECT("oaltraaaa", 500, 50)));
    const arranged = duplicated(opened, "b1a2b3c4d");
    if (typeof arranged === "string") throw new Error(arranged);
    expect(arranged.ops[arranged.ops.length - 1]!.op).toBe("page");
    const boards = applied(opened, arranged);
    expect(boards.map((each) => [each.name, each.rect])).toEqual([
      ["Copertina", [0, 0, 400, 200]],
      ["Copertina copia", [960, 0, 400, 200]],
      ["Evaporazione", [480, 0, 400, 200]],
    ]);
    const copy = boards[1]!;
    expect(copy.id).toMatch(/^b[0-9a-z]{8}$/);
    expect(arranged.keys).toEqual([copy.id]);
    const paper = copy.paper!.facts.id!;
    expect(paper).toMatch(/^c[0-9a-z]{8}$/);
    expect(opened.engine.text).toContain(`<rect id="${paper}" fub:role="paper" fub:board="${copy.id}" x="960" y="0" width="400" height="200" fill="#fafafa"/>`);
    // Le carte, poi le tavole, poi i livelli.
    expect(roots(opened)).toEqual(["fub-paper", "c5e6f7g8h", paper, "b1a2b3c4d", copy.id, "b9i0j1k2l", "laaaaaaaa"]);
    // Ciò che sta sulla tavola ha la sua copia sulla copia; il resto no.
    expect(opened.engine.text.match(/x="100" y="50"/g)).toHaveLength(2);
    expect(opened.engine.text).toMatch(/<rect id="o[0-9a-z]{8}" x="100" y="50" width="20" height="20" transform="matrix\(1 0 0 1 960 0\)"\/>/);
    expect(opened.engine.text.match(/x="500" y="50"/g)).toHaveLength(1);
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 1536, height: 256 });
    expect(readScene(opened.engine.text).summary.boards).toEqual(["Copertina", "Copertina copia", "Evaporazione"]);
  });

  it("ogni copia viene subito dopo la sua tavola, col primo numero libero, e non si posa su un'altra", () => {
    const opened = open(TWO());
    applied(opened, duplicated(opened, "b1a2b3c4d"));
    let boards = applied(opened, duplicated(opened, "b1a2b3c4d"));
    expect(boards.map((each) => each.name)).toEqual(["Copertina", "Copertina copia 2", "Copertina copia", "Evaporazione"]);
    // La copia di una copia è la sua copia.
    boards = applied(opened, duplicated(opened, boards[2]!.id));
    expect(boards.map((each) => [each.name, each.rect[0]])).toEqual([
      ["Copertina", 0],
      ["Copertina copia 2", 1440],
      ["Copertina copia", 960],
      ["Copertina copia copia", 1920],
      ["Evaporazione", 480],
    ]);
  });

  it("in un disegno senza tavole fa della pagina la tavola 1, e la copia le nasce accanto con ciò che porta", () => {
    const opened = open(PLAIN);
    const arranged = duplicated(opened, null);
    if (typeof arranged === "string") throw new Error(arranged);
    expect(arranged.ops[arranged.ops.length - 1]!.op).toBe("page");
    const boards = applied(opened, arranged);
    expect(boards.map((each) => [each.name, each.rect])).toEqual([
      ["Tavola 1", [0, 0, 400, 200]],
      ["Tavola 1 copia", [480, 0, 400, 200]],
    ]);
    const [first, copy] = boards as [Board, Board];
    expect(arranged.keys).toEqual([copy.id]);
    const paper = copy.paper!.facts.id!;
    expect(opened.engine.text).toContain(`<rect id="fub-paper" fub:role="paper" fub:board="${first.id}" x="0" y="0" width="400" height="200" fill="#ffffff"/>`);
    expect(opened.engine.text).toContain(`<rect id="${paper}" fub:role="paper" fub:board="${copy.id}" x="480" y="0" width="400" height="200" fill="#ffffff"/>`);
    expect(roots(opened)).toEqual(["fub-paper", paper, first.id, copy.id, "laaaaaaaa"]);
    expect(opened.engine.text).toMatch(/<rect id="o[0-9a-z]{8}" x="10" y="0" width="20" height="20" transform="matrix\(1 0 0 1 480 0\)"\/>/);
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 912, height: 200 });

    // Una pagina senza carta fa tavole senza carta.
    const bare = open(drawing([LAYER(RECT("oaaaaaaaa", 10))]));
    expect(applied(bare, duplicated(bare, null)).map((each) => [each.name, each.paper])).toEqual([
      ["Tavola 1", null],
      ["Tavola 1 copia", null],
    ]);
  });

  it("senza una tavola o una pagina da duplicare non scrive niente", () => {
    const opened = open(TWO());
    expect(duplicateBoardOps(opened.engine.model!, null, 480, 0, [], COPY, ids(opened), pageOf(opened))).toEqual({ ops: [], keys: [] });
    const pageless = open(drawing([LAYER()], null));
    expect(duplicateBoardOps(pageless.engine.model!, null, 480, 0, [], COPY, ids(pageless), null)).toEqual({ ops: [], keys: [] });
  });

  it("una tavola senza carta ha una copia senza carta", () => {
    const opened = open(drawing([V1, LAYER()]));
    const boards = applied(opened, duplicated(opened, "b1a2b3c4d"));
    expect(boards.map((each) => [each.name, each.rect, each.paper])).toEqual([
      ["Copertina", [0, 0, 400, 200], null],
      ["Copertina copia", [480, 0, 400, 200], null],
    ]);
    expect(order(opened)).toEqual(["b1a2b3c4d", boards[1]!.id, "laaaaaaaa"]);
  });

  it("la carta si copia coi suoi attributi, la tavola con la descrizione e i titoli in altre lingue", () => {
    const paper = '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="#fafafa" fill-opacity="0.5" stroke="#cccccc" stroke-width="2"/>';
    const view = '<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 400 200"><desc id="dprima000">La prima</desc><title xml:lang="it">Copertina</title><title xml:lang="en">Cover</title></view>';
    const opened = open(drawing([paper, view, LAYER()]));
    const boards = applied(opened, duplicated(opened, "b1a2b3c4d"));
    const copy = boards[1]!;
    expect([copy.name, copy.title]).toEqual(["Copertina copia", "Copertina copia"]);
    expect(opened.engine.text).toContain(`<rect id="${copy.paper!.facts.id!}" fub:role="paper" fub:board="${copy.id}" x="480" y="0" width="400" height="200" fill="#fafafa" fill-opacity="0.5" stroke="#cccccc" stroke-width="2"/>`);
    // Le parti della tavola la seguono senza id, che è della tavola di prima.
    expect(opened.engine.text).toMatch(
      new RegExp(`<view id="${copy.id}" fub:role="board" viewBox="480 0 400 200">\\s*<desc>La prima</desc>\\s*<title xml:lang="it">Copertina copia</title>\\s*<title xml:lang="en">Cover</title>\\s*</view>`),
    );
    expect(opened.engine.text.match(/id="dprima000"/g)).toHaveLength(1);

    // Una tavola senza titolo ha una copia che si chiama col suo id.
    const untitled = open(drawing(['<view id="bzzzzzzzz" fub:role="board" viewBox="0 0 10 10"/>', LAYER()]));
    expect(applied(untitled, duplicated(untitled, "bzzzzzzzz")).map((each) => [each.name, each.title])).toEqual([
      ["bzzzzzzzz", ""],
      ["bzzzzzzzz copia", "bzzzzzzzz copia"],
    ]);
  });

  it("una carta che non si sa scrivere ha una copia come la carta di una tavola nuova", () => {
    const paper = '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" xmlns:x="urn:x" x:nota="1" x="0" y="0" width="400" height="200" fill="#fafafa"/>';
    const opened = open(drawing([paper, V1, LAYER()]));
    const copy = applied(opened, duplicated(opened, "b1a2b3c4d"))[1]!;
    expect(opened.engine.text).toContain(`<rect id="${copy.paper!.facts.id!}" fub:role="paper" fub:board="${copy.id}" x="480" y="0" width="400" height="200" fill="#fafafa"/>`);
  });

  it("la carta e gli oggetti hanno le loro copie delle risorse private, in una defs sola", () => {
    const defs = `<defs><linearGradient id="rgggggggg" fub:role="private">${STOP}</linearGradient><linearGradient id="rhhhhhhhh" fub:role="private">${STOP}</linearGradient></defs>`;
    const paper = '<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="url(#rgggggggg)"/>';
    const opened = open(drawing([defs, paper, V1, LAYER(RECT("oaaaaaaaa", 10, 10, ' fill="url(#rhhhhhhhh)"'))]));
    const boards = applied(opened, duplicated(opened, "b1a2b3c4d"));
    // La defs senza id non riceve niente: ne nasce una sola per tutte e due.
    expect(opened.engine.text.match(/<defs/g)).toHaveLength(2);
    const copies = elementChildren(opened.engine.holder("fub-defs") as ContainerNode).map((each) => each.facts.id!);
    expect(copies).toHaveLength(2);
    for (const id of copies) expect(id).toMatch(/^r[0-9a-z]{8}$/);
    const [forPaper, forRect] = copies as [string, string];
    expect(opened.engine.text).toContain(`fub:board="${boards[1]!.id}" x="480" y="0" width="400" height="200" fill="url(#${forPaper})"/>`);
    expect(opened.engine.text).toMatch(new RegExp(`<rect id="o[0-9a-z]{8}" x="10" y="10" width="20" height="20" fill="url\\(#${forRect}\\)" transform="matrix\\(1 0 0 1 480 0\\)"/>`));
    // Gli originali tengono le loro.
    expect(opened.engine.text).toContain('fub:board="b1a2b3c4d" x="0" y="0" width="400" height="200" fill="url(#rgggggggg)"/>');
    expect(opened.engine.text).toContain('<rect id="oaaaaaaaa" x="10" y="10" width="20" height="20" fill="url(#rhhhhhhhh)"/>');
  });

  it("la pagina si allarga anche per ciò che la copia porta fuori dalla tavola", () => {
    const opened = open(TWO('<rect id="olungoaaa" x="100" y="150" width="20" height="100"/>'));
    const first = board(opened, "b1a2b3c4d");
    const carried = carriedBy(first.box, opened.movable());
    expect(carried.map((unit) => unit.id)).toEqual(["olungoaaa"]);
    const arranged = duplicateBoardOps(opened.engine.model!, first, 0, 280, carried, COPY, ids(opened), pageOf(opened));
    if (typeof arranged === "string") throw new Error(arranged);
    expect(arranged.ops[arranged.ops.length - 1]!.op).toBe("page");
    applied(opened, arranged);
    // La copia arriva a 480, ciò che porta a 530: la pagina supera 512.
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  });

  it("non duplica oltre il limite delle tavole, né una pagina con due carte, né un oggetto che non si copia", () => {
    const views = (count: number): string[] => Array.from({ length: count }, (_, i) => `<view id="b${i.toString(36).padStart(8, "0")}" fub:role="board" viewBox="${i * 10} 0 5 5"/>`);
    const full = open(drawing(views(1000)));
    expect(duplicateBoardOps(full.engine.model!, boardsNow(full)[0]!, 0, 10, [], COPY, ids(full), pageOf(full))).toBe("limit");
    // L'ultima che ci sta sì.
    const almost = open(drawing(views(999)));
    expect(applied(almost, duplicateBoardOps(almost.engine.model!, boardsNow(almost)[998]!, 0, 10, [], COPY, ids(almost), pageOf(almost)))).toHaveLength(1000);

    const two = open(drawing([PAPER, '<rect id="cdoppiaaa" fub:role="paper" x="0" y="0" width="400" height="200"/>', LAYER()]));
    expect(duplicated(two, null)).toBe("paper");

    // Niente copie a metà.
    const foreign = open(TWO(`<g id="ogggggggg">${RECT("oaaaaaaaa", 10)}<use href="#oaaaaaaaa"/></g>`));
    expect(duplicated(foreign, "b1a2b3c4d")).toBe("content");
  });
});

describe("il posto e il nome di una copia", () => {
  const view = (id: string, viewBox: string): string => `<view id="${id}" fub:role="board" viewBox="${viewBox}"/>`;
  const copy = (name: string, n: number): string => (n === 1 ? `${name} copia` : `${name} copia ${n}`);

  it("la copia va a destra della tavola, a BOARD_GAP, alla stessa altezza", () => {
    expect(duplicateSpot([], [10, 20, 300, 100])).toEqual([380, 0]);
    expect(duplicateSpot([], [0.1, 0, 400.2, 200])).toEqual([480.2, 0]);
  });

  it("e oltre le tavole che toccherebbe, anche una dopo l'altra", () => {
    const boards = boardsNow(open(TWO()));
    expect(duplicateSpot(boards, boards[0]!.rect)).toEqual([960, 0]);
    expect(duplicateSpot(boards, boards[1]!.rect)).toEqual([480, 0]);
  });

  it("una tavola più in basso di uno spazio intero non la ferma; una più vicina sì", () => {
    const far = boardsNow(open(drawing([view("baaaaaaaa", "0 0 400 200"), view("bbbbbbbbb", "480 280 400 200")])));
    expect(duplicateSpot(far, far[0]!.rect)).toEqual([480, 0]);
    const near = boardsNow(open(drawing([view("baaaaaaaa", "0 0 400 200"), view("bbbbbbbbb", "480 279 400 200")])));
    expect(duplicateSpot(near, near[0]!.rect)).toEqual([960, 0]);
  });

  it("il nome è quello della tavola con «copia», e un numero se c'è già", () => {
    expect(copyName(["Copertina"], "Copertina", copy)).toBe("Copertina copia");
    expect(copyName(["Copertina", "Copertina copia"], "Copertina", copy)).toBe("Copertina copia 2");
    expect(copyName(["Copertina copia", "Copertina copia 2"], "Copertina", copy)).toBe("Copertina copia 3");
    expect(copyName(["Copertina copia 2"], "Copertina", copy)).toBe("Copertina copia");
    expect(copyName(["Copertina copia"], "Copertina copia", copy)).toBe("Copertina copia copia");
  });

  it("non supera NAME_MAX caratteri: si accorcia il nome, non ciò che gli si aggiunge", () => {
    const long = "x".repeat(NAME_MAX);
    expect(copyName([], long, copy)).toBe(`${"x".repeat(NAME_MAX - 6)} copia`);
    expect(copyName([`${"x".repeat(NAME_MAX - 6)} copia`], long, copy)).toBe(`${"x".repeat(NAME_MAX - 8)} copia 2`);
    // Si contano i caratteri, non le unità di UTF-16, e dove si taglia non
    // resta uno spazio.
    expect(copyName([], "😀".repeat(NAME_MAX), copy)).toBe(`${"😀".repeat(NAME_MAX - 6)} copia`);
    expect(copyName([], `${"a".repeat(NAME_MAX - 7)} ${"b".repeat(6)}`, copy)).toBe(`${"a".repeat(NAME_MAX - 7)} copia`);
  });

  it("un nome nuovo parte dal numero chiesto", () => {
    expect(freshBoardName([], nameFor, 1)).toBe("Tavola 1");
    expect(freshBoardName(["Tavola 1"], nameFor, 1)).toBe("Tavola 2");
    expect(freshBoardName(["Tavola 5", "Tavola 6"], nameFor, 5)).toBe("Tavola 7");
  });
});

describe("cambiare la misura di una tavola", () => {
  it("cambia la tavola e la carta, non il disegno, e allarga la pagina", () => {
    const opened = open(TWO(RECT("odentroaa", 100, 50)));
    const boards = applied(opened, resizeBoardOps(opened.engine.model!, boardsNow(opened)[1]!, [480, 0, 600.004, 300], ids(opened), pageOf(opened)));
    expect(boards[1]!.rect).toEqual([480, 0, 600, 300]);
    expect(opened.engine.text).toContain('fub:board="b9i0j1k2l" x="480" y="0" width="600" height="300"');
    expect(opened.engine.text).not.toContain("transform");
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 1280, height: 512 });
  });

  it("la stessa misura non scrive niente", () => {
    const opened = open(TWO());
    expect(resizeBoardOps(opened.engine.model!, boardsNow(opened)[0]!, [0, 0, 400.001, 200], ids(opened), pageOf(opened)).ops).toEqual([]);
  });
});

describe("togliere una tavola", () => {
  it("toglie lei e la sua carta, e lascia il disegno", () => {
    const opened = open(TWO(RECT("oaltraaaa", 500, 50)));
    const boards = applied(opened, removeBoardOps(opened.engine.model!, boardsNow(opened)[1]!, opened.extent(), ids(opened)));
    expect(boards.map((each) => each.name)).toEqual(["Copertina"]);
    expect(opened.engine.text).not.toContain("c5e6f7g8h");
    expect(opened.engine.text).toContain('id="oaltraaaa"');
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 1024, height: 256 });
  });

  it("l'ultima lascia la carta alla pagina, che diventa la tavola e copre il disegno", () => {
    const opened = open(drawing([P1, V1, LAYER(RECT("oaltraaaa", 500, 50))], "0 0 1024 256"));
    const boards = applied(opened, removeBoardOps(opened.engine.model!, boardsNow(opened)[0]!, opened.extent(), ids(opened)));
    expect(boards).toEqual([]);
    // Il rettangolo che esce di 120 a destra allarga la tavola di un passo.
    expect(pageOf(opened)).toEqual({ x: 0, y: 0, width: 656, height: 200 });
    expect(opened.engine.text).toContain('<rect id="fub-paper" fub:role="paper" x="0" y="0" width="656" height="200" fill="#fafafa"/>');
  });

  it("toglie anche una seconda carta della tavola, e una senza id", () => {
    const second = '<rect fub:role="paper" fub:board="b9i0j1k2l" x="480" y="0" width="400" height="200"/>';
    const opened = open(drawing([P1, P2, second, V1, V2, LAYER()], "0 0 1024 256"));
    const boards = applied(opened, removeBoardOps(opened.engine.model!, boardsNow(opened)[1]!, opened.extent(), ids(opened)));
    expect(boards.map((each) => each.id)).toEqual(["b1a2b3c4d"]);
    expect(opened.engine.text).not.toContain("b9i0j1k2l");
  });
});

describe("rinominare una tavola", () => {
  it("cambia il titolo e tiene l'id, il posto, la descrizione e la carta", () => {
    const view = '<view id="b9i0j1k2l" fub:role="board" viewBox="480 0 400 200"><desc>Il vapore</desc><title xml:lang="it">Evaporazione</title></view>';
    const opened = open(drawing([P1, P2, V1, view, '<view id="bcoda0000" fub:role="board" viewBox="960 0 10 10"/>', LAYER()], "0 0 1024 256"));
    const arranged = renameBoardOps(opened.engine.model!, boardsNow(opened)[1]!, "La nuvola", ids(opened));
    const boards = applied(opened, arranged);
    expect(boards.map((each) => [each.id, each.name])).toEqual([
      ["b1a2b3c4d", "Copertina"],
      ["b9i0j1k2l", "La nuvola"],
      ["bcoda0000", "bcoda0000"],
    ]);
    expect(opened.engine.text).toMatch(/<desc>Il vapore<\/desc>\s*<title xml:lang="it">La nuvola<\/title>/);
    expect(boards[1]!.paper?.facts.id).toBe("c5e6f7g8h");
  });

  it("dà un titolo a chi non l'ha", () => {
    const opened = open(drawing(['<view id="bzzzzzzzz" fub:role="board" viewBox="0 0 10 10"/>', LAYER()]));
    const boards = applied(opened, renameBoardOps(opened.engine.model!, boardsNow(opened)[0]!, "Prima", ids(opened)));
    expect(boards.map((each) => [each.id, each.name])).toEqual([["bzzzzzzzz", "Prima"]]);
  });

  it("una tavola con un id non di FubDraw ne riceve uno nuovo, e la sua carta lo segue", () => {
    const opened = open(drawing(['<rect id="cpropria0" fub:role="paper" fub:board="copertina" x="0" y="0" width="400" height="200"/>', '<view id="copertina" fub:role="board" viewBox="0 0 400 200"/>', LAYER()]));
    const arranged = renameBoardOps(opened.engine.model!, boardsNow(opened)[0]!, "Copertina", ids(opened));
    if (arranged === "foreign") throw new Error("estranea");
    const boards = applied(opened, arranged);
    expect(boards[0]!.id).toMatch(/^b[0-9a-z]{8}$/);
    expect(arranged.keys).toEqual([boards[0]!.id]);
    expect(boards[0]!.paper?.facts.id).toBe("cpropria0");
  });

  it("dopo un elemento senza id resta al suo posto fra le tavole", () => {
    const opened = open(drawing(["<title>Ciclo</title>", '<view id="bprimaaaa" fub:role="board" viewBox="0 0 10 10"/>', '<view id="bsecondaa" fub:role="board" viewBox="20 0 10 10"/>', LAYER()]));
    const boards = applied(opened, renameBoardOps(opened.engine.model!, boardsNow(opened)[0]!, "Uno", ids(opened)));
    expect(boards.map((each) => each.name)).toEqual(["Uno", "bsecondaa"]);
    expect(order(opened)).toEqual(["bprimaaaa", "bsecondaa", "laaaaaaaa"]);
  });

  it("lo stesso nome, o un nome vuoto, non scrivono niente", () => {
    const opened = open(TWO());
    const first = boardsNow(opened)[0]!;
    expect(renameBoardOps(opened.engine.model!, first, "Copertina", ids(opened))).toEqual({ ops: [], keys: [] });
    expect(renameBoardOps(opened.engine.model!, first, "", ids(opened))).toEqual({ ops: [], keys: [] });
  });
});

describe("cambiare l'ordine delle tavole", () => {
  const THREE = drawing([P1, P2, V1, V2, '<view id="btrezzzzz" fub:role="board" viewBox="960 0 10 10"/>', LAYER()], "0 0 1024 256");
  const names = (boards: readonly Board[]): string[] => boards.map((each) => each.id);

  it("in avanti, dopo quella che sta al posto nuovo", () => {
    const opened = open(THREE);
    expect(names(applied(opened, reorderBoardOps(opened.engine.model!, boardsNow(opened)[0]!, 2)))).toEqual(["b9i0j1k2l", "btrezzzzz", "b1a2b3c4d"]);
  });

  it("indietro, dopo l'elemento che precede quella che sta lì", () => {
    const opened = open(THREE);
    expect(names(applied(opened, reorderBoardOps(opened.engine.model!, boardsNow(opened)[2]!, 0)))).toEqual(["btrezzzzz", "b1a2b3c4d", "b9i0j1k2l"]);
    expect(order(opened).slice(0, 2)).toEqual(["fub-paper", "c5e6f7g8h"]);
  });

  it("indietro, dopo un elemento senza id, scambiandosi con lei", () => {
    const opened = open(drawing(["<title>Ciclo</title>", V1, V2, '<view id="btrezzzzz" fub:role="board" viewBox="960 0 10 10"/>', LAYER()], "0 0 1024 256"));
    expect(names(applied(opened, reorderBoardOps(opened.engine.model!, boardsNow(opened)[2]!, 0)))).toEqual(["btrezzzzz", "b1a2b3c4d", "b9i0j1k2l"]);
  });

  it("allo stesso posto, o fuori dai posti, non si muove o va al bordo", () => {
    const opened = open(THREE);
    expect(reorderBoardOps(opened.engine.model!, boardsNow(opened)[1]!, 1).ops).toEqual([]);
    expect(names(applied(opened, reorderBoardOps(opened.engine.model!, boardsNow(opened)[0]!, 99)))).toEqual(["b9i0j1k2l", "btrezzzzz", "b1a2b3c4d"]);
  });
});

describe("le misure pronte", () => {
  it("si riconoscono nei due versi, coi numeri del file", () => {
    expect(presetOf([0, 0, 793.7, 1122.52])?.id).toBe("a4");
    expect(presetOf([10, 10, 1122.52, 793.7])?.id).toBe("a4");
    expect(presetOf([0, 0, 1920, 1080])?.id).toBe("full-hd");
    expect(presetOf([0, 0, 1080, 1920])?.id).toBe("full-hd");
    expect(presetOf([0, 0, 1024, 768])?.id).toBe("xga");
    expect(presetOf([0, 0, 390, 844])?.id).toBe("phone");
    expect(presetOf([0, 0, 1000, 1000])).toBeNull();
  });

  it("hanno numeri tondi nell'unità in cui si dicono", () => {
    for (const preset of PRESETS) {
      for (const side of [preset.width, preset.height]) {
        // Mezzo pollice al più: 8,5 × 11 pollici.
        const halves = toUnit(side, preset.unit) * 2;
        expect(Math.abs(halves - Math.round(halves))).toBeLessThan(1e-9);
      }
    }
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
  });

  it("tengono il verso e l'angolo in alto a sinistra", () => {
    const a4 = PRESETS.find((preset) => preset.id === "a4")!;
    expect(presetRect([5, 6, 300, 100], a4)).toEqual([5, 6, 1122.52, 793.7]);
    expect(presetRect([5, 6, 100, 300], a4)).toEqual([5, 6, 793.7, 1122.52]);
    expect(presetRect([5, 6, 100, 100], PRESETS.find((preset) => preset.id === "hd")!)).toEqual([5, 6, 1280, 720]);
  });

  it("il verso si legge e si cambia", () => {
    expect(orientationOf([0, 0, 300, 100])).toBe("landscape");
    expect(orientationOf([0, 0, 100, 300])).toBe("portrait");
    expect(orientationOf([0, 0, 100, 100.001])).toBe("square");
    expect(orientedRect([5, 6, 300, 100], "portrait")).toEqual([5, 6, 100, 300]);
    expect(orientedRect([5, 6, 300, 100], "landscape")).toEqual([5, 6, 300, 100]);
  });
});
