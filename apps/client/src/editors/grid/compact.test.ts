// @vitest-environment happy-dom
// Il foglio in modo compatto (N6 T42), sulla griglia vera e la cartella di
// Excel delle prove: il catalogo ridotto ai comandi che scrivono valori,
// Invio che apre la cella scelta, Ctrl+PagGiù che non cambia foglio, la
// cella attiva e la sua formula come dati, la cella aperta come col doppio
// clic.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridCommandState } from "../../host/contract";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { activeCellSource, COMPACT_COMMANDS, compactGridHost, editCellIn, guardCompactKeys } from "./compact";
import { settle, workbookHost, workbookMounted } from "./test-support";

let life: Lifetime | null = null;

afterEach(() => {
  life?.close();
  life = null;
  document.body.replaceChildren();
});

/// La cartella delle prove, vista dalla griglia attraverso l'host compatto.
async function compactMounted() {
  const grid = workbookHost();
  const mounted = await workbookMounted({ ...grid, host: compactGridHost(grid.host) });
  life = openLifetime();
  return { grid, life, ...mounted };
}

const key = (target: Element, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe("il foglio in una scheda", () => {
  it("il catalogo che arriva alla griglia ha solo i comandi che scrivono valori o leggono", async () => {
    const { grid, engine } = await compactMounted();
    const ids = engine.commands().map((command: GridCommandState) => command.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(COMPACT_COMMANDS.has(id)).toBe(true);
    // I comandi di struttura e di formato non ci sono, anche se il file li serve.
    for (const id of ["home.insertRows", "home.deleteRows", "home.mergeCells", "home.bold", "home.columnWidth"]) {
      expect(ids).not.toContain(id);
      expect(engine.command(id)).toBe(false);
    }
    // Un comando chiesto lo stesso (da una scorciatoia) non arriva al file.
    await expect(compactGridHost(grid.host).gridBytesCommand("fub.grid.xlsx", "xlsx-1", {
      revision: "r",
      command: { id: "home.insertRows", params: "{}", sheet: "s1", selection: [] },
    } as never)).rejects.toThrow("home.insertRows");
  });

  it("Invio sulla cella scelta la apre, come F2; dentro la cella Invio è suo", async () => {
    const { host, viewport, engine, go, life } = await compactMounted();
    guardCompactKeys(host, () => engine.editMode(), life);
    go(1, 1);
    const enter = key(viewport, { key: "Enter" });
    expect(enter.defaultPrevented).toBe(true);
    expect(engine.editMode()).toBe("edit");
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
    // Nella cella aperta Invio non passa di qui: conferma e scende, ed è della griglia.
    const inCell = key(host.querySelector(".grid-cell-editor .cm-content")!, { key: "Enter" });
    expect(engine.editMode()).toBe("ready");
    expect(engine.selection().focus).toEqual({ row: 2, column: 1 });
    expect(inCell.defaultPrevented).toBe(true);
  });

  it("Ctrl+PagGiù e Ctrl+PagSu non cambiano foglio: si scrive solo quello attivo", async () => {
    const { host, viewport, engine, life } = await compactMounted();
    guardCompactKeys(host, () => engine.editMode(), life);
    const sheet = engine.selectionRefs().sheet;
    expect(key(viewport, { key: "PageDown", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key(viewport, { key: "PageUp", ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(engine.selectionRefs().sheet).toBe(sheet);
  });

  it("dà la cella attiva e la sua formula come dati, e avvisa una volta per giro", async () => {
    const { host, engine, go, life } = await compactMounted();
    const source = activeCellSource(engine, host, life);
    expect(source.read()).toEqual({ name: "A1", formula: "Voce" });

    const heard = vi.fn();
    const stop = source.subscribe(heard);
    go(3, 1);
    // Più richiami del motore nello stesso giro: un avviso solo, dopo.
    source.changed();
    source.changed();
    expect(heard).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(source.read()).toEqual({ name: "B4", formula: "=SUM(B2:B3)" });

    // Una formula con un errore la dice la cella, e qui c'è la formula com'è.
    go(3, 2);
    expect(source.read()).toEqual({ name: "C4", formula: "#DIV/0!" });

    stop();
    source.changed();
    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(1);

    // Chiusa la vita, niente più dati né avvisi.
    source.subscribe(heard);
    life.close();
    source.changed();
    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(source.read()).toBeNull();
  });

  it("prima che la cartella si mostri non c'è cella attiva", async () => {
    const grid = workbookHost();
    const { host, engine } = await workbookMounted({ ...grid, host: compactGridHost(grid.host) });
    engine.destroy();
    life = openLifetime();
    const fresh = { book: () => null, selectionRefs: () => engine.selectionRefs() };
    expect(activeCellSource(fresh, host, life).read()).toBeNull();
  });

  it("`editCellIn` apre la cella disegnata come il doppio clic, e dice no a una cella fuori vista", async () => {
    const { host, engine } = await compactMounted();
    expect(editCellIn(host, { row: 3, column: 1 })).toBe(true);
    expect(engine.editMode()).toBe("edit");
    expect(engine.selection().focus).toEqual({ row: 3, column: 1 });
    expect(editCellIn(host, { row: 900, column: 1 })).toBe(false);
  });

  it("`editCellIn` dà il punto nelle misure della griglia, anche con la lavagna in zoom", () => {
    // La griglia a metà della sua misura (zoom 50%): 800 × 400 disegnati in 400 × 200.
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    viewport.className = "grid-viewport";
    const cell = document.createElement("div");
    cell.className = "grid-cell";
    cell.dataset.row = "1";
    cell.dataset.column = "1";
    viewport.append(cell);
    root.append(viewport);
    document.body.append(root);
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    viewport.getBoundingClientRect = () => rect(100, 50, 400, 200);
    Object.defineProperty(viewport, "offsetWidth", { value: 800 });
    Object.defineProperty(viewport, "offsetHeight", { value: 400 });
    cell.getBoundingClientRect = () => rect(140, 70, 20, 10);
    const points: [string, number, number][] = [];
    for (const type of ["pointerdown", "pointerup", "dblclick"]) {
      cell.addEventListener(type, (event) => points.push([type, (event as MouseEvent).clientX, (event as MouseEvent).clientY]));
    }
    expect(editCellIn(root, { row: 1, column: 1 })).toBe(true);
    // Il centro della cella è a (50, 25) dal bordo disegnato: (100, 50) nelle misure della griglia.
    expect(points).toEqual([["pointerdown", 200, 100], ["pointerup", 200, 100], ["dblclick", 200, 100]]);
  });
});
