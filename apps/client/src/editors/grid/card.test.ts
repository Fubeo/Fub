// @vitest-environment happy-dom
// La scheda di foglio con un `GridHost` finto che conta aperture, finestre e
// chiusure: la superficie scelta come fa il foglio, la finestra delle sole
// celle in vista, lo scorrimento da attiva, la selezione e la copia a
// tabulazioni, la sessione chiusa da ferma e a `destroy` (una volta sola,
// anche con una finestra in volo), lo `Stale` dell'host, i fogli nascosti,
// le unioni, le due schede dello stesso file. `applyGridBytes` non si chiama mai.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "../../__fixtures__/xlsx-grid.json";
import type {
  GridBytesSession,
  GridBytesWindow,
  GridCellStyle,
  GridMerge,
  GridSurfaceSpec,
  GridWindowRequest,
  PluginError,
} from "../../host/contract";
import { t } from "../../i18n/strings";
import { declareClipboard } from "../../platform/clipboard";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { CardCache } from "../canvas/card-cache";
import type {
  CardContext,
  CardEditor,
  CardEditorOptions,
  CardEditorPort,
  CardEditorState,
  CardMode,
  CardView,
  CardWriting,
} from "../canvas/cards";
import { COMPONENT_EDITORS, type SurfaceBootstrapOptions } from "../core/bootstrap";
import { GRID_PROFILE, UI_GRID } from "../core/component-surfaces";
import type { EditorSurface, LazySurfaceFactory } from "../core/registry";
import { findTextEditorOrThrow } from "../text/test-support";
import type { CanvasNode } from "../canvas/model";
import {
  SHEET_CARD_COLUMN_HEADER,
  SHEET_CARD_COLUMN_WIDTH,
  SHEET_CARD_ROW_HEADER,
  SHEET_CARD_ROW_HEIGHT,
  sheetCardRenderer,
  type SheetCardPort,
} from "./card";
import type { GridHost } from "./engine";
import { workbookHost } from "./test-support";

const PATH = "Statistica/voti.xlsx";
const FORMAT = "xlsx";
/// Cinque colonne e quattro righe di serie, intestazioni comprese.
const WIDTH = SHEET_CARD_ROW_HEADER + SHEET_CARD_COLUMN_WIDTH * 5;
const HEIGHT = SHEET_CARD_COLUMN_HEADER + SHEET_CARD_ROW_HEIGHT * 4;

const BOOK = (fixture.session as GridBytesSession).book;
const PLAIN = (fixture.windows[0] as GridBytesWindow).styles[0]!;
const VIEW = (fixture.windows[0] as GridBytesWindow).view;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function conflict(): PluginError {
  return { kind: "conflict", message: "stale" };
}

interface SheetShape {
  readonly id: string;
  readonly rows: number;
  readonly columns: number;
}

interface FakeOptions {
  sheets?: readonly SheetShape[];
  active?: string;
  hidden?: string[];
  merges?: GridMerge[];
  /// Le righe nascoste (per indice) e quelle alte, in punti.
  hiddenRows?: ReadonlySet<number>;
  rowHeight?: (index: number) => number | null;
  styleOf?: (row: number, column: number) => GridCellStyle | null;
  surfaces?: GridSurfaceSpec[];
  /// Quante aperture rifiutare con `conflict` prima di aprire.
  stale?: number;
}

interface FakeHost extends GridHost {
  readonly opens: { surface: string; doc: string; journal: string; base: string }[];
  readonly windows: { instance: string; request: GridWindowRequest }[];
  readonly closes: string[];
  applies: number;
  commands: number;
  /// Se c'è, la prossima apertura (o finestra) aspetta questa promessa.
  holdOpen: Deferred<void> | null;
  holdWindow: Deferred<void> | null;
  revision: string;
  options: FakeOptions;
}

function display(row: number, column: number): string {
  return `R${row + 1}C${column + 1}`;
}

function fakeHost(options: FakeOptions = {}): FakeHost {
  let counter = 0;
  const sheets = () => options.sheets ?? [{ id: "s1", rows: 100, columns: 26 }];
  const host: FakeHost = {
    opens: [],
    windows: [],
    closes: [],
    applies: 0,
    commands: 0,
    holdOpen: null,
    holdWindow: null,
    revision: "rev-1",
    options,
    async listGridSurfaces() {
      return options.surfaces ?? [
        { id: "text-grid", format: FORMAT, family: "text", protocol_version: 2 },
        { id: "old-grid", format: FORMAT, family: "grid", protocol_version: 1 },
        { id: "csv-grid", format: "csv", family: "grid", protocol_version: 2 },
        { id: "xlsx-grid", format: FORMAT, family: "grid", protocol_version: 2 },
      ];
    },
    async openGridBytes(surface, doc, journal, base) {
      host.opens.push({ surface, doc, journal, base });
      const held = host.holdOpen;
      host.holdOpen = null;
      if (held) await held.promise;
      if ((options.stale ?? 0) > 0) {
        options.stale! -= 1;
        throw conflict();
      }
      const list = sheets();
      return {
        instance: `i${++counter}`,
        revision: host.revision,
        sheets: list.map((sheet) => ({ id: sheet.id, name: sheet.id, row_count: sheet.rows, column_count: sheet.columns })),
        active: options.active ?? list[0]!.id,
        hidden: options.hidden ?? [],
        notices: [],
        conflicts: [],
        commands: [],
        book: BOOK,
      };
    },
    async gridBytesWindow(_surface, instance, request) {
      host.windows.push({ instance, request });
      const held = host.holdWindow;
      host.holdWindow = null;
      if (held) await held.promise;
      const sheet = sheets().find((candidate) => candidate.id === request.sheet)!;
      const rows = Array.from({ length: request.row_count }, (_, at) => {
        const index = request.row_start + at;
        return { id: `r${index}`, index, height: options.rowHeight?.(index) ?? null, hidden: options.hiddenRows?.has(index) ?? false };
      });
      const columns = Array.from({ length: request.column_count }, (_, at) => {
        const index = request.column_start + at;
        return { id: `c${index}`, index, width: null, hidden: false };
      });
      const styles: GridCellStyle[] = [PLAIN];
      const cells = rows.flatMap((row) => columns.map((column) => {
        const own = options.styleOf?.(row.index, column.index) ?? null;
        let style = 0;
        if (own) {
          styles.push(own);
          style = styles.length - 1;
        }
        const text = display(row.index, column.index);
        return {
          key: { sheet: sheet.id, row: row.id, column: column.id },
          input: text,
          style,
          value: { kind: "text" as const, value: text },
          display: text,
          lock: null,
          stale: false,
          conflict: false,
          data_bar: null,
          icon: null,
          comment: null,
          link: null,
        };
      }));
      const merges = (options.merges ?? []).filter((merge) =>
        merge.row <= request.row_start + request.row_count - 1 && merge.row + merge.rows - 1 >= request.row_start
        && merge.column <= request.column_start + request.column_count - 1 && merge.column + merge.columns - 1 >= request.column_start);
      return {
        revision: request.revision,
        sheet: sheet.id,
        row_start: request.row_start,
        column_start: request.column_start,
        total_rows: sheet.rows,
        total_columns: sheet.columns,
        rows,
        columns,
        cells,
        styles,
        merges,
        view: VIEW,
        tables: [],
        objects: [],
      };
    },
    async applyGridBytes() {
      host.applies += 1;
      throw new Error("the sheet card never writes");
    },
    async gridBytesCommands() {
      host.commands += 1;
      return [];
    },
    async gridBytesCommand() {
      host.commands += 1;
      throw new Error("the sheet card runs no commands");
    },
    async closeGridBytes(_surface, instance) {
      host.closes.push(instance);
    },
  };
  return host;
}

interface Bench {
  readonly host: HTMLElement;
  readonly grid: FakeHost;
  readonly lifetime: Lifetime;
  readonly port: SheetCardPort & { sources: number; changed: (() => void)[]; unwatched: number; opened: string[] };
  readonly missing: { count: number };
  readonly size: { width: number; height: number };
  /// Ciò che la scheda ha detto alla tela della scrittura (T42).
  readonly writings: (CardWriting | null)[];
  readonly states: [CardEditorState | null, string | undefined][];
  mount(mode: CardMode): CardView;
  root(): HTMLElement;
}

let benches: Bench[] = [];

function bench(options: FakeOptions & {
  source?: () => Promise<{ journal: string; base: string; format: string | null } | null>;
  withOpen?: boolean;
  editors?: CardEditorPort;
} = {}): Bench {
  const element = document.createElement("div");
  document.body.append(element);
  const grid = fakeHost(options);
  const lifetime = openLifetime();
  const missing = { count: 0 };
  const size = { width: WIDTH, height: HEIGHT };
  const port: Bench["port"] = {
    host: grid,
    sources: 0,
    changed: [],
    unwatched: 0,
    opened: [],
    async source() {
      port.sources += 1;
      if (options.source) return options.source();
      return { journal: "", base: `base-${port.sources}`, format: FORMAT };
    },
    paper: () => undefined,
    watch(_path, changed) {
      port.changed.push(changed);
      return () => {
        port.unwatched += 1;
      };
    },
    ...(options.withOpen === false ? {} : {
      open(path: string) {
        port.opened.push(path);
      },
    }),
  };
  const renderer = sheetCardRenderer(port);
  const node = { id: "n1", type: "file", file: PATH, x: 0, y: 0, width: WIDTH, height: HEIGHT } as CanvasNode;
  const writings: Bench["writings"] = [];
  const states: Bench["states"] = [];
  const made: Bench = {
    host: element,
    grid,
    lifetime,
    port,
    missing,
    size,
    writings,
    states,
    mount(mode) {
      const context: CardContext = {
        path: PATH,
        subpath: null,
        documentId: "Lavagne/studio.canvas",
        lifetime,
        snapshots: new CardCache(),
        size: () => size,
        zoom: () => 1,
        missing: () => {
          missing.count += 1;
        },
        ...(options.editors ? {
          editors: options.editors,
          writing: (writing: CardWriting | null) => {
            writings.push(writing);
          },
          editState: (state: CardEditorState | null, reason?: string) => {
            states.push([state, reason]);
          },
        } : {}),
      };
      return renderer.mount(node, element, mode, context);
    },
    root: () => element.querySelector<HTMLElement>(".canvas-card-sheet")!,
  };
  benches.push(made);
  return made;
}

function cellTexts(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(".grid-cell")].map((cell) => cell.textContent ?? "");
}

function cell(root: HTMLElement, row: number, column: number): HTMLElement {
  const found = root.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);
  if (!found) throw new Error(`no cell ${row},${column}`);
  return found;
}

function pointer(target: Element, type: string, buttons = 1): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons }));
}

function wheel(target: Element, deltaY: number, extra: WheelEventInit = {}): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, ...extra });
  target.dispatchEvent(event);
  return event;
}

function copyKey(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
}

let clipboard: string[] = [];
let undeclare: (() => void) | null = null;

beforeEach(() => {
  clipboard = [];
  undeclare = declareClipboard(async (text) => {
    clipboard.push(text);
  });
});

afterEach(() => {
  for (const each of benches) {
    // Nessuna scheda scrive, né dà comandi.
    expect(each.grid.applies).toBe(0);
    expect(each.grid.commands).toBe(0);
    each.lifetime.close();
    each.host.remove();
  }
  benches = [];
  undeclare?.();
  undeclare = null;
});

describe("la scheda di foglio", () => {
  it("si apre sulla superficie grid della versione 2 del formato e chiede solo le celle in vista", async () => {
    const b = bench();
    b.mount("live");
    await settle();
    expect(b.grid.opens).toEqual([{ surface: "xlsx-grid", doc: PATH, journal: "", base: "base-1" }]);
    expect(b.grid.windows).toHaveLength(1);
    expect(b.grid.windows[0]!.request).toMatchObject({ revision: "rev-1", sheet: "s1", row_start: 0, row_count: 4, column_start: 0, column_count: 5 });
    const root = b.root();
    expect(root.dataset.cardKind).toBe("sheet");
    expect(root.dataset.cardState).toBe("content");
    expect(root.classList.contains("look-file")).toBe(true);
    expect(root.querySelectorAll(".grid-cell")).toHaveLength(20);
    expect(cell(root, 0, 0).textContent).toBe("R1C1");
    expect(cell(root, 3, 4).textContent).toBe("R4C5");
    // Le intestazioni: le lettere delle colonne e i numeri delle righe.
    expect([...root.querySelectorAll(".grid-column-header")].map((h) => h.textContent)).toEqual(["A", "B", "C", "D", "E"]);
    expect([...root.querySelectorAll(".grid-row-header")].map((h) => h.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(root.querySelector(".grid-corner")).not.toBeNull();
    expect(cell(root, 1, 2).style.left).toBe(`${SHEET_CARD_ROW_HEADER + 2 * SHEET_CARD_COLUMN_WIDTH}px`);
    expect(cell(root, 1, 2).style.top).toBe(`${SHEET_CARD_COLUMN_HEADER + SHEET_CARD_ROW_HEIGHT}px`);
  });

  it("disegna le celle con `paintCell`: i colori del file e la carta del tema", async () => {
    const styled: GridCellStyle = { ...PLAIN, bold: true, italic: false, fill_color: "#FFFF00", text_color: "#0000FF", horizontal: "end" };
    const b = bench({ styleOf: (row, column) => (row === 0 && column === 0 ? styled : null) });
    b.port.paper = () => ({ bg: "#1e1e1e", ink: "#eeeeee" });
    b.mount("live");
    await settle();
    const root = b.root();
    expect(root.classList.contains("look-adattato")).toBe(true);
    const a1 = cell(root, 0, 0);
    expect(a1.style.getPropertyValue("--file-fill")).toBe("#FFFF00");
    expect(a1.style.getPropertyValue("--file-fill-a")).not.toBe("");
    expect(a1.style.fontWeight).toBe("700");
    expect(a1.style.textAlign).toBe("end");
  });

  it("senza superficie del foglio, o con un errore, dice che non si mostra e offre «Apri»", async () => {
    const b = bench({ surfaces: [{ id: "csv-grid", format: "csv", family: "grid", protocol_version: 2 }] });
    b.mount("live");
    await settle();
    const root = b.root();
    expect(root.dataset.cardState).toBe("unavailable");
    expect(root.textContent).toContain(t("canvas.card.sheet_unavailable"));
    expect(b.grid.opens).toHaveLength(0);
    const open = root.querySelector<HTMLButtonElement>("button")!;
    expect(open.textContent).toBe(t("canvas.card.open"));
    open.click();
    expect(b.port.opened).toEqual([PATH]);

    const broken = bench();
    (broken.grid as { -readonly [K in keyof FakeHost]: FakeHost[K] }).gridBytesWindow = async () => {
      throw new Error("boom");
    };
    broken.mount("live");
    await settle();
    expect(broken.root().dataset.cardState).toBe("unavailable");
    // La sessione aperta si chiude con l'errore.
    expect(broken.grid.closes).toEqual(["i1"]);
  });

  it("un file che non c'è chiama `missing`", async () => {
    const b = bench({ source: async () => null });
    b.mount("live");
    await settle();
    expect(b.root().dataset.cardState).toBe("missing");
    expect(b.missing.count).toBe(1);
    expect(b.grid.opens).toHaveLength(0);
  });

  it("uno `Stale` all'apertura si riprova una volta con la base di adesso, poi non si mostra", async () => {
    const once = bench({ stale: 1 });
    once.mount("live");
    await settle();
    expect(once.grid.opens.map((open) => open.base)).toEqual(["base-1", "base-2"]);
    expect(once.root().dataset.cardState).toBe("content");

    const twice = bench({ stale: 2 });
    twice.mount("live");
    await settle();
    expect(twice.grid.opens).toHaveLength(2);
    expect(twice.root().dataset.cardState).toBe("unavailable");
    expect(twice.grid.closes).toEqual([]);
  });

  it("da attiva la rotella scorre il foglio e chiede le finestre nuove; da non attiva è della lavagna", async () => {
    const b = bench();
    const card = b.mount("live");
    await settle();
    const root = b.root();
    const outside = wheel(root, 3 * SHEET_CARD_ROW_HEIGHT);
    expect(outside.defaultPrevented).toBe(false);
    await settle();
    expect(b.grid.windows).toHaveLength(1);

    expect(card.enter!()).toBe(true);
    const inside = wheel(root, 3 * SHEET_CARD_ROW_HEIGHT);
    expect(inside.defaultPrevented).toBe(true);
    await settle();
    expect(b.grid.windows).toHaveLength(2);
    expect(b.grid.windows[1]!.request).toMatchObject({ row_start: 3, row_count: 4, column_start: 0 });
    expect(cell(root, 3, 0).textContent).toBe("R4C1");
    expect([...root.querySelectorAll(".grid-row-header")].map((h) => h.textContent)).toEqual(["4", "5", "6", "7"]);

    wheel(root, 0, { deltaX: SHEET_CARD_COLUMN_WIDTH });
    await settle();
    expect(b.grid.windows[2]!.request).toMatchObject({ row_start: 3, column_start: 1 });
    expect(cell(root, 3, 1).textContent).toBe("R4C2");

    // Non si va oltre l'inizio.
    wheel(root, -100 * SHEET_CARD_ROW_HEIGHT);
    await settle();
    expect(b.grid.windows[3]!.request).toMatchObject({ row_start: 0, column_start: 1 });

    // `leave` lascia lo scorrimento.
    card.leave!();
    card.resize!();
    await settle();
    expect(cell(root, 0, 1).textContent).toBe("R1C2");
  });

  it("un foglio di 1 048 576 righe chiede solo la finestra, anche in fondo", async () => {
    const b = bench({ sheets: [{ id: "big", rows: 1_048_576, columns: 16_384 }] });
    const card = b.mount("live");
    await settle();
    expect(b.grid.windows[0]!.request).toMatchObject({ row_count: 4, column_count: 5 });
    card.enter!();
    wheel(b.root(), 2_000_000 * SHEET_CARD_ROW_HEIGHT);
    await settle();
    expect(b.grid.windows[1]!.request).toMatchObject({ row_start: 1_048_575, row_count: 1 });
    expect(cell(b.root(), 1_048_575, 0).textContent).toBe("R1048576C1");
  });

  it("una riga nascosta o alta cambia le righe in vista, e la lettura dopo le porta", async () => {
    const b = bench({ hiddenRows: new Set([1]), rowHeight: (index) => (index === 2 ? 40 : null) });
    b.mount("live");
    await settle();
    // La finestra (righe 0–3) dice che la 1 è nascosta e la 2 alta: in vista 1, 3, 4.
    expect(b.grid.windows.map((w) => [w.request.row_start, w.request.row_count])).toEqual([[0, 4]]);
    const rows = [...b.root().querySelectorAll<HTMLElement>(".grid-row-header")].map((h) => h.textContent);
    expect(rows).not.toContain("2");
    expect(rows[0]).toBe("1");
    expect(rows[1]).toBe("3");
    // La riga alta prende la sua misura, come nel foglio aperto (×1,4).
    const third = b.root().querySelector<HTMLElement>('.grid-row-header[data-row="2"]')!;
    expect(third.style.height).toBe(`${40 * 1.4}px`);
  });

  it("righe nascoste oltre la finestra: la lettura dopo copre la vista", async () => {
    const b = bench({ hiddenRows: new Set([1, 2, 3]) });
    b.mount("live");
    await settle();
    expect(b.grid.windows.map((w) => [w.request.row_start, w.request.row_count])).toEqual([[0, 4], [0, 7]]);
    expect([...b.root().querySelectorAll(".grid-row-header")].map((h) => h.textContent)).toEqual(["1", "5", "6", "7"]);
  });

  it("il trascinamento sceglie un rettangolo e Ctrl+C lo copia a tabulazioni", async () => {
    const b = bench();
    const card = b.mount("live");
    await settle();
    const root = b.root();
    // Non attiva: il tasto e il puntatore sono della lavagna.
    pointer(cell(root, 0, 0), "pointerdown");
    expect(root.querySelector(".grid-selection")).toBeNull();
    expect(card.key!(copyKey())).toBe(false);

    expect(card.enter!()).toBe(true);
    pointer(cell(root, 0, 1), "pointerdown");
    pointer(cell(root, 1, 2), "pointermove");
    pointer(cell(root, 2, 3), "pointermove");
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    // Dopo il rilascio il puntatore non sceglie più.
    pointer(cell(root, 3, 4), "pointermove", 0);
    const outline = root.querySelector<HTMLElement>(".grid-selection")!;
    expect(outline).not.toBeNull();
    expect(outline.style.left).toBe(`${SHEET_CARD_ROW_HEADER + SHEET_CARD_COLUMN_WIDTH}px`);
    expect(outline.style.width).toBe(`${3 * SHEET_CARD_COLUMN_WIDTH}px`);
    expect(outline.style.height).toBe(`${3 * SHEET_CARD_ROW_HEIGHT}px`);
    expect([...root.querySelectorAll(".grid-column-header.selected")].map((h) => h.textContent)).toEqual(["B", "C", "D"]);

    expect(card.key!(copyKey())).toBe(true);
    await settle();
    expect(clipboard).toEqual(["R1C2\tR1C3\tR1C4\nR2C2\tR2C3\tR2C4\nR3C2\tR3C3\tR3C4\n"]);

    // Un tasto qualunque non è della scheda.
    expect(card.key!(new KeyboardEvent("keydown", { key: "x", ctrlKey: true }))).toBe(false);

    // `leave` toglie la selezione.
    card.leave!();
    expect(root.querySelector(".grid-selection")).toBeNull();
    expect(card.key!(copyKey())).toBe(false);
  });

  it("la selezione che esce dalla vista copia solo celle lette, mai vuote al posto di quelle vere", async () => {
    const b = bench({ sheets: [{ id: "s1", rows: 1_000, columns: 26 }] });
    const card = b.mount("live");
    await settle();
    card.enter!();
    const root = b.root();
    pointer(cell(root, 0, 0), "pointerdown");
    // Nove scatti di quattro righe: più finestre di quante se ne tengono di solito.
    for (let step = 0; step < 9; step++) {
      wheel(root, 4 * SHEET_CARD_ROW_HEIGHT);
      await settle();
    }
    expect(b.grid.windows.length).toBeGreaterThan(9);
    pointer(cell(root, 36, 1), "pointermove");
    expect(card.key!(copyKey())).toBe(true);
    await settle();
    const expected = Array.from({ length: 37 }, (_, row) => `${display(row, 0)}\t${display(row, 1)}\n`).join("");
    expect(clipboard).toEqual([expected]);
  });

  it("una selezione che perderebbe le sue celle lette si toglie, e Ctrl+C non copia niente", async () => {
    const b = bench({ sheets: [{ id: "s1", rows: 1_000, columns: 26 }] });
    const card = b.mount("live");
    await settle();
    card.enter!();
    const root = b.root();
    pointer(cell(root, 0, 0), "pointerdown");
    pointer(cell(root, 3, 0), "pointermove");
    // Lo scorrimento tiene le finestre della selezione fino al limite; oltre,
    // la selezione si toglie invece di copiare celle vuote.
    for (let step = 0; step < 40; step++) {
      wheel(root, SHEET_CARD_ROW_HEIGHT);
      await settle();
      pointer(cell(root, step + 4, 0), "pointermove");
    }
    expect(root.querySelector(".grid-selection")).toBeNull();
    expect(card.key!(copyKey())).toBe(false);
    await settle();
    expect(clipboard).toEqual([]);
  });

  it("la selezione non si allarga a un'unione che comincia fuori dalle celle lette", async () => {
    const b = bench({ sheets: [{ id: "s1", rows: 1_000, columns: 26 }], merges: [{ row: 0, column: 0, rows: 60, columns: 1 }] });
    const card = b.mount("live");
    await settle();
    card.enter!();
    const root = b.root();
    for (let step = 0; step < 12; step++) {
      wheel(root, 4 * SHEET_CARD_ROW_HEIGHT);
      await settle();
    }
    // La riga 0, dove l'unione comincia, non è più fra le finestre tenute.
    expect(b.grid.windows.length).toBeGreaterThan(8);
    pointer(cell(root, 48, 0), "pointerdown");
    expect(root.querySelector(".grid-selection")).toBeNull();
    expect(card.key!(copyKey())).toBe(false);
    pointer(cell(root, 48, 1), "pointerdown");
    pointer(cell(root, 49, 2), "pointermove");
    expect(card.key!(copyKey())).toBe(true);
    await settle();
    expect(clipboard).toEqual([`${display(48, 1)}\t${display(48, 2)}\n${display(49, 1)}\t${display(49, 2)}\n`]);
  });

  it("le celle unite si disegnano una volta e la selezione le prende intere", async () => {
    const b = bench({ merges: [{ row: 0, column: 1, rows: 2, columns: 2 }] });
    const card = b.mount("live");
    await settle();
    const root = b.root();
    const merged = cell(root, 0, 1);
    expect(merged.classList.contains("merged")).toBe(true);
    expect(merged.style.width).toBe(`${2 * SHEET_CARD_COLUMN_WIDTH}px`);
    expect(merged.style.height).toBe(`${2 * SHEET_CARD_ROW_HEIGHT}px`);
    expect(root.querySelector('.grid-cell[data-row="1"][data-column="2"]')).toBeNull();
    expect(root.querySelectorAll(".grid-cell")).toHaveLength(20 - 3);

    card.enter!();
    pointer(cell(root, 0, 0), "pointerdown");
    // Ogni disegno rifà le celle: si cerca di nuovo quella unita.
    pointer(cell(root, 0, 1), "pointermove");
    card.key!(copyKey());
    await settle();
    expect(clipboard).toEqual(["R1C1\tR1C2\t\nR2C1\t\t\n"]);
  });

  it("una cella unita che comincia sopra la vista si disegna dalla prima riga in vista", async () => {
    const b = bench({ merges: [{ row: 0, column: 0, rows: 3, columns: 1 }] });
    const card = b.mount("live");
    await settle();
    card.enter!();
    wheel(b.root(), SHEET_CARD_ROW_HEIGHT);
    await settle();
    const root = b.root();
    const shown = cell(root, 1, 0);
    expect(shown.textContent).toBe("R1C1");
    expect(shown.style.height).toBe(`${2 * SHEET_CARD_ROW_HEIGHT}px`);
  });

  it("si apre sul foglio attivo visibile, o sul primo visibile se quello è nascosto", async () => {
    const sheets = [{ id: "a", rows: 10, columns: 5 }, { id: "b", rows: 10, columns: 5 }, { id: "c", rows: 10, columns: 5 }];
    const b = bench({ sheets, active: "b" });
    b.mount("live");
    await settle();
    expect(b.grid.windows[0]!.request.sheet).toBe("b");

    const hidden = bench({ sheets, active: "a", hidden: ["a"] });
    hidden.mount("live");
    await settle();
    expect(hidden.grid.windows[0]!.request.sheet).toBe("b");

    // Tutti i fogli nascosti: la sessione non si disegna, e si chiude.
    const none = bench({ sheets, hidden: ["a", "b", "c"] });
    none.mount("live");
    await settle();
    expect(none.root().dataset.cardState).toBe("unavailable");
    expect(none.grid.windows).toHaveLength(0);
    expect(none.grid.closes).toEqual(["i1"]);
  });

  it("un foglio vuoto mostra le intestazioni e nessuna cella, senza finestre", async () => {
    const b = bench({ sheets: [{ id: "s1", rows: 0, columns: 0 }] });
    b.mount("live");
    await settle();
    const root = b.root();
    expect(root.dataset.cardState).toBe("content");
    expect(b.grid.windows).toHaveLength(0);
    expect(root.querySelectorAll(".grid-cell")).toHaveLength(0);
    expect(root.querySelector(".grid-corner")).not.toBeNull();
  });

  it("da ferma chiude la sessione e lascia le celle, inerti; riaccesa ne apre una nuova", async () => {
    const b = bench();
    const card = b.mount("live");
    await settle();
    card.enter!();
    pointer(cell(b.root(), 0, 0), "pointerdown");
    card.setMode("snapshot");
    const root = b.root();
    expect(b.grid.closes).toEqual(["i1"]);
    expect(root.inert).toBe(true);
    expect(root.dataset.cardState).toBe("content");
    expect(cellTexts(root)).toHaveLength(20);
    expect(root.querySelector(".grid-selection")).toBeNull();
    // Da ferma non si entra, e la rotella è della lavagna.
    expect(card.enter!()).toBe(false);
    expect(wheel(root, 100).defaultPrevented).toBe(false);

    card.setMode("live");
    await settle();
    expect(root.inert).toBe(false);
    expect(b.grid.opens).toHaveLength(2);
    expect(b.grid.closes).toEqual(["i1"]);
    card.destroy();
    expect(b.grid.closes).toEqual(["i1", "i2"]);
    expect(b.port.unwatched).toBe(1);
    expect(b.host.querySelector(".canvas-card-sheet")).toBeNull();
    // `destroy` due volte, o la vita della scheda chiusa dopo, non richiude.
    card.destroy();
    b.lifetime.close();
    expect(b.grid.closes).toEqual(["i1", "i2"]);
  });

  it("montata ferma non apre niente e mostra il segnaposto", async () => {
    const b = bench();
    b.mount("snapshot");
    await settle();
    const root = b.root();
    expect(root.dataset.cardState).toBe("placeholder");
    expect(root.inert).toBe(true);
    expect(root.textContent).toContain(PATH);
    expect(b.port.sources).toBe(0);
    expect(b.grid.opens).toHaveLength(0);
  });

  it("`destroy` con una finestra in volo chiude la sessione una volta sola", async () => {
    const b = bench();
    const held = deferred<void>();
    b.grid.holdWindow = held;
    const card = b.mount("live");
    await settle();
    expect(b.grid.windows).toHaveLength(1);
    card.destroy();
    expect(b.grid.closes).toEqual(["i1"]);
    held.resolve();
    await settle();
    expect(b.grid.closes).toEqual(["i1"]);
    expect(b.host.querySelector(".grid-cell")).toBeNull();
  });

  it("un'apertura che risponde dopo il cambio di modo o `destroy` si chiude subito", async () => {
    const b = bench();
    const held = deferred<void>();
    b.grid.holdOpen = held;
    const card = b.mount("live");
    await settle();
    card.setMode("snapshot");
    expect(b.grid.closes).toEqual([]);
    held.resolve();
    await settle();
    expect(b.grid.closes).toEqual(["i1"]);
    expect(b.grid.windows).toHaveLength(0);
    expect(b.root().dataset.cardState).toBe("placeholder");

    const late = bench();
    const again = deferred<void>();
    late.grid.holdOpen = again;
    const other = late.mount("live");
    await settle();
    other.destroy();
    again.resolve();
    await settle();
    expect(late.grid.closes).toEqual(["i1"]);
  });

  it("il file cambia: da viva si riapre la sessione, da ferma si segna", async () => {
    const b = bench();
    const card = b.mount("live");
    await settle();
    card.enter!();
    wheel(b.root(), 2 * SHEET_CARD_ROW_HEIGHT);
    await settle();
    b.grid.revision = "rev-2";
    b.port.changed[0]!();
    await settle();
    expect(b.grid.closes).toEqual(["i1"]);
    expect(b.grid.opens).toHaveLength(2);
    expect(b.grid.opens[1]!.base).toBe("base-2");
    const last = b.grid.windows[b.grid.windows.length - 1]!;
    // Lo scorrimento resta.
    expect(last).toMatchObject({ instance: "i2", request: { revision: "rev-2", row_start: 2 } });

    card.setMode("snapshot");
    b.port.changed[0]!();
    await settle();
    expect(b.grid.opens).toHaveLength(2);
    expect(b.root().dataset.cardStale).toBe("true");
    card.setMode("live");
    await settle();
    expect(b.grid.opens).toHaveLength(3);
    expect(b.root().dataset.cardStale).toBeUndefined();
  });

  it("due schede dello stesso file hanno due sessioni, e chiudono ognuna la sua", async () => {
    const b = bench();
    const first = b.mount("live");
    const second = b.mount("live");
    await settle();
    expect(b.grid.opens).toHaveLength(2);
    expect(new Set(b.grid.windows.map((w) => w.instance))).toEqual(new Set(["i1", "i2"]));
    first.setMode("snapshot");
    expect(b.grid.closes).toEqual(["i1"]);
    second.destroy();
    expect(b.grid.closes).toEqual(["i1", "i2"]);
    first.destroy();
    expect(b.grid.closes).toEqual(["i1", "i2"]);
  });
});

// --- Scrivere nelle celle (T42) ----------------------------------------------

/// La porta delle schede (T40) ridotta a ciò che la scheda usa, con la
/// superficie vera del foglio: quella che `mountGrid` monta in un riquadro,
/// in modo compatto, sulla cartella di Excel delle prove.
interface WritingPort extends CardEditorPort {
  readonly grid: ReturnType<typeof workbookHost>;
  readonly opened: CardEditorOptions[];
  readonly surfaces: EditorSurface[];
  state: CardEditorState;
  left: number;
  destroyed: number;
  /// Lo stato della sessione cambia (un conflitto col disco, la sola lettura).
  turn(state: CardEditorState): void;
}

function writingPort(state: CardEditorState = "salvato"): WritingPort {
  const grid = workbookHost();
  const listeners = new Set<(state: CardEditorState) => void>();
  const port: WritingPort = {
    grid,
    opened: [],
    surfaces: [],
    state,
    left: 0,
    destroyed: 0,
    turn(next) {
      port.state = next;
      for (const listener of [...listeners]) listener(next);
    },
    async open(path, host, options): Promise<CardEditor | null> {
      port.opened.push(options);
      const registration = COMPONENT_EDITORS[UI_GRID]![0]!.registration({
        gridHost: grid.host,
        onChange: () => {},
        onSelectionChange: () => {},
      } as unknown as SurfaceBootstrapOptions);
      const factory = await (registration.factory as LazySurfaceFactory).load();
      if (options.lifetime.closed) return null;
      host.dataset.cardEditor = options.compact ? "compact" : "full";
      const surface = factory.mount(GRID_PROFILE, {
        paneId: "card-editor:1",
        documentId: path,
        parent: host,
        formatId: FORMAT,
        revision: fixture.document_revision,
        compact: options.compact,
      });
      port.surfaces.push(surface);
      // happy-dom non dispone: la griglia vede una finestra della scheda.
      Object.defineProperties(host.querySelector(".grid-viewport")!, {
        clientWidth: { configurable: true, value: 600 },
        clientHeight: { configurable: true, value: 300 },
      });
      surface.buffer!.setDoc("");
      const context = () => {
        const cell = surface.activeCell?.read() ?? null;
        return cell === null ? null : { cell: cell.name, formula: cell.formula };
      };
      let gone = false;
      const destroy = (): void => {
        if (gone) return;
        gone = true;
        port.destroyed += 1;
        surface.destroy();
        host.replaceChildren();
      };
      // Come la porta vera: chiusa la vita della scheda, l'editor si smonta.
      options.lifetime.add(destroy);
      return {
        focus: () => surface.focus?.(),
        leave: async () => {
          port.left += 1;
        },
        state: () => port.state,
        onState: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        context,
        onContext: (listener) => surface.activeCell!.subscribe(() => listener(context())),
        destroy,
      };
    },
  };
  return port;
}

async function until(thing: string, cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

const writer = (made: Bench) => made.host.querySelector<HTMLElement>('.canvas-card-sheet[data-card-state="editing"]');
const cellEditor = (made: Bench) => writer(made)?.querySelector<HTMLElement>(".grid-cell-editor") ?? null;
const opened = (made: Bench) => cellEditor(made)?.hidden === false;
const lastContext = (made: Bench) => made.writings[made.writings.length - 1]?.context ?? null;

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/// Scrive `text` nella cella aperta, al posto di ciò che c'era.
function typeInCell(made: Bench, text: string): void {
  const editor = findTextEditorOrThrow(cellEditor(made)!);
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, userEvent: "input" });
}

const inCell = (made: Bench) => cellEditor(made)!.querySelector<HTMLElement>(".cm-content")!;
const gridViewport = (made: Bench) => writer(made)!.querySelector<HTMLElement>(".grid-viewport")!;

/// Una scheda viva con la porta, e la scrittura cominciata col doppio clic
/// sulla cella (`row`, `column`) della resa.
async function writingOn(row: number, column: number, state: CardEditorState = "salvato") {
  const port = writingPort(state);
  const made = bench({ editors: port });
  const view = made.mount("live");
  await settle();
  expect(view.edit!(cell(made.root(), row, column))).toBe(true);
  return { port, made, view };
}

describe("la scheda di foglio che scrive (T42)", () => {
  it("il doppio clic su una cella monta il foglio compatto sulla stessa cella, senza nastro, tavolozza né struttura", async () => {
    const { port, made } = await writingOn(1, 1);
    await until("la cella del doppio clic si apre", () => opened(made));

    expect(port.opened).toHaveLength(1);
    expect(port.opened[0]).toMatchObject({ compact: true, readOnly: false });
    const root = writer(made)!;
    expect(root.dataset.cardEditor).toBe("compact");
    // La resa resta sotto, nascosta, finché si scrive.
    expect(made.root().hidden).toBe(true);
    // La cella aperta è quella sotto il doppio clic, e la tela ne ha nome e formula.
    expect(lastContext(made)).toEqual({ cell: "B2", formula: "800" });
    expect(made.writings.every((writing) => writing?.toolbar === null)).toBe(true);
    // Niente nastro né tavolozza; un formato chiesto dalla tastiera non parte.
    expect(root.querySelector(".grid-ribbon-host")!.childElementCount).toBe(0);
    expect(port.surfaces[0]!.paletteCommands!()).toEqual([]);
    press(inCell(made), { key: "Escape" });
    press(gridViewport(made), { key: "b", ctrlKey: true });
    await settle();
    expect(port.grid.given).toEqual([]);
    // Il tasto destro non apre un menu del foglio: resta alla lavagna.
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    cell(root, 1, 1).dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("Invio conferma e scende, Tab conferma e va a destra; Invio sulla cella scelta la apre", async () => {
    const { port, made } = await writingOn(1, 1);
    await until("la cella si apre", () => opened(made));

    typeInCell(made, "900");
    press(inCell(made), { key: "Enter" });
    expect(opened(made)).toBe(false);
    await until("la scrittura arriva al file", () => port.grid.applied.length === 1);
    expect(port.grid.applied[0]!.patches).toEqual([{ cell: { sheet: "s1", row: "r1", column: "c1" }, before: "800", after: "900" }]);
    await until("la tela sa che la cella è scesa", () => lastContext(made)?.cell === "B3");
    expect(lastContext(made)).toEqual({ cell: "B3", formula: "-120" });

    // Invio sulla cella scelta la apre (in un riquadro scenderebbe).
    expect(press(gridViewport(made), { key: "Enter" }).defaultPrevented).toBe(true);
    expect(opened(made)).toBe(true);
    typeInCell(made, "-150");
    press(inCell(made), { key: "Tab" });
    expect(opened(made)).toBe(false);
    await until("la seconda scrittura arriva al file", () => port.grid.applied.length === 2);
    expect(port.grid.applied[1]!.patches[0]).toMatchObject({ cell: { sheet: "s1", row: "r2", column: "c1" }, after: "-150" });
    await until("la tela sa che la cella è a destra", () => lastContext(made)?.cell === "C3");
    expect(lastContext(made)).toEqual({ cell: "C3", formula: "=B3/B4" });
  });

  it("Esc annulla la cella e resta nella scrittura; il secondo Esc passa alla lavagna, che ne esce", async () => {
    const { port, made, view } = await writingOn(3, 1);
    await until("la cella si apre", () => opened(made));
    expect(lastContext(made)).toEqual({ cell: "B4", formula: "=SUM(B2:B3)" });

    typeInCell(made, "=1/0");
    const first = press(inCell(made), { key: "Escape" });
    expect(first.defaultPrevented).toBe(true);
    expect(opened(made)).toBe(false);
    expect(writer(made)).not.toBeNull();
    await settle();
    expect(port.grid.applied).toEqual([]);
    expect(lastContext(made)).toEqual({ cell: "B4", formula: "=SUM(B2:B3)" });

    // Il secondo Esc la griglia non lo usa: arriva alla tela, che lascia la scheda.
    const second = press(gridViewport(made), { key: "Escape" });
    expect(second.defaultPrevented).toBe(false);
    const opens = made.grid.opens.length;
    view.leave!();
    await until("la griglia si smonta", () => writer(made) === null);
    expect(port.left).toBe(1);
    expect(port.destroyed).toBe(1);
    expect(made.root().hidden).toBe(false);
    // La resa si rilegge col file di adesso.
    expect(made.grid.opens.length).toBe(opens + 1);
  });

  it("Ctrl+Z dentro la scheda annulla nel foglio, e la lavagna non lo riceve", async () => {
    const { port, made } = await writingOn(1, 1);
    await until("la cella si apre", () => opened(made));
    typeInCell(made, "7");
    press(inCell(made), { key: "Enter" });
    await until("la scrittura arriva al file", () => port.grid.applied.length === 1);
    await settle();
    const undo = press(gridViewport(made), { key: "z", ctrlKey: true });
    expect(undo.defaultPrevented).toBe(true);
    await until("il foglio torna com'era", () => cell(writer(made)!, 1, 1).textContent === "800");
  });

  it("Invio sulla cella scelta della resa apre quella cella", async () => {
    const port = writingPort();
    const made = bench({ editors: port });
    const view = made.mount("live");
    await settle();
    expect(view.enter!()).toBe(true);
    pointer(cell(made.root(), 2, 2), "pointerdown");
    pointer(cell(made.root(), 2, 2), "pointerup", 0);
    expect(view.edit!()).toBe(true);
    await until("la cella scelta si apre", () => opened(made));
    expect(lastContext(made)).toEqual({ cell: "C3", formula: "=B3/B4" });
  });

  it("un foglio di sola lettura non si scrive: la scheda resta a leggere e lo dice", async () => {
    const { port, made } = await writingOn(1, 1, "readonly");
    await until("la griglia si smonta", () => port.destroyed === 1);
    expect(writer(made)).toBeNull();
    expect(made.root().hidden).toBe(false);
    expect(made.writings[made.writings.length - 1]).toBeNull();
    const [state, reason] = made.states[made.states.length - 1]!;
    expect(state).toBe("readonly");
    expect(reason).toBe(t("canvas.card.readonly_why", { name: "voti.xlsx" }));
  });

  it("`Stale`: il conflitto col disco si dice nella riga del titolo; la resa non si rilegge sotto e si ricarica uscendo", async () => {
    const { port, made, view } = await writingOn(1, 1);
    await until("la cella si apre", () => opened(made));
    const opens = made.grid.opens.length;
    const sources = made.port.sources;

    port.turn("conflitto");
    expect(made.states[made.states.length - 1]).toEqual(["conflitto", undefined]);
    // Il file cambia mentre si scrive: la griglia segue la sessione da sé,
    // e la resa non apre una sessione sua sotto.
    for (const changed of made.port.changed) changed();
    await settle();
    expect(made.grid.opens.length).toBe(opens);

    port.turn("salvato");
    expect(made.states[made.states.length - 1]).toEqual([null, undefined]);
    view.leave!();
    await until("la griglia si smonta", () => writer(made) === null);
    // Uscendo la resa si ricarica, con la base di adesso.
    expect(made.port.sources).toBe(sources + 1);
    expect(made.grid.opens.length).toBe(opens + 1);
    expect(made.grid.opens[made.grid.opens.length - 1]!.base).toBe(`base-${sources + 1}`);
  });

  it("senza porta, da ferma o prima della resa non si scrive; fermata mentre scrive, la griglia si smonta", async () => {
    const plain = bench();
    expect(plain.mount("live").edit!()).toBe(false);

    const port = writingPort();
    const made = bench({ editors: port });
    expect(made.mount("snapshot").edit!()).toBe(false);
    expect(port.opened).toEqual([]);

    const { port: writing, made: live, view } = await writingOn(1, 1);
    await until("la cella si apre", () => opened(live));
    view.setMode("snapshot");
    expect(writing.destroyed).toBe(1);
    expect(writer(live)).toBeNull();
    expect(live.root().hidden).toBe(false);
  });

  it("distrutta mentre la griglia arriva, la griglia arrivata si smonta subito", async () => {
    const port = writingPort();
    const made = bench({ editors: port });
    const view = made.mount("live");
    await settle();
    expect(view.edit!(cell(made.root(), 1, 1))).toBe(true);
    view.destroy();
    for (let i = 0; i < 20; i++) await settle();
    // La porta non monta niente per una vita chiusa, e nessuna griglia resta.
    expect(port.opened).toHaveLength(1);
    expect(port.destroyed).toBe(port.surfaces.length);
    expect(writer(made)).toBeNull();
    expect(made.host.querySelector(".grid-surface")).toBeNull();
  });
});
