// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import { createManualDriver, setMotionDriver, type ManualDriver } from "../../moto";
import { DURATION } from "../../moto/spring";
import { GRID_BYTES_PROTOCOL_VERSION, type GridBytesCell, type GridBytesWindow } from "../../host/contract";
import { writeClipboardText } from "../../platform/clipboard";
import { t } from "../../i18n/strings";
import { gridJournalText, parseGridJournal, recordGridJournal } from "../../state/grid-journal";
import { fillTarget, openSpan, typingOpens, type GridHost } from "./engine";
import { previewSizes, resizeLabelAt } from "./engine-geometry";
import structureCss from "../../theme/scrittoio/structure.css?raw";
import { bytesHost, cellAt, frames, mounted, scrollWrites, settle, shownMarks, shownRanges, SURFACE, typeInActiveCell, workbookHost, workbookMounted, written } from "./test-support";

vi.mock("../../platform/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform/clipboard")>()),
  writeClipboardText: vi.fn(async () => {}),
}));

afterEach(() => {
  document.body.replaceChildren();
});

/// Le dichiarazioni di `structure.css` per `selector`, da tutte le regole
/// che lo nominano da solo nella loro lista di selettori.
function structureOf(selector: string): string {
  return [...structureCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors!.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((part) => part.trim()).includes(selector))
    .map(([, , body]) => body!)
    .join("\n");
}

/// Il provider con il foglio che cambia sotto la griglia: ogni finestra letta
/// passa da `read`, che la riscrive come farebbe un file cambiato altrove.
function reshaped(grid: ReturnType<typeof bytesHost>, read: (window: GridBytesWindow) => GridBytesWindow): GridHost {
  return {
    ...grid.host,
    gridBytesWindow: async (surface, instance, request) => read(await grid.host.gridBytesWindow(surface, instance, request)),
  };
}

/// Le righe di una finestra hanno l'id che `rowId` dà a ciascun indice; le
/// celle restano sul loro id, e quelle di una riga che non c'è più spariscono.
function withRows(rowId: (index: number) => string) {
  return (window: GridBytesWindow): GridBytesWindow => {
    const rows = window.rows.map((row, offset) => ({ ...row, id: rowId(window.row_start + offset) }));
    const ids = new Set(rows.map((row) => row.id));
    return { ...window, rows, cells: window.cells.filter((cell) => ids.has(cell.key.row)) };
  };
}

/// Il giornale di una riscrittura da fuori: ogni cella `"riga,colonna"` passa
/// da `[prima, dopo]` (l'input sul disco e quello nuovo) sopra `base`.
function outsideJournal(base: string, cells: Record<string, readonly [before: string, after: string]>): string {
  let journal = parseGridJournal(base);
  for (const [at, [before, after]] of Object.entries(cells)) {
    const [row, column] = at.split(",");
    journal = recordGridJournal(journal, { sheet: "main", row: `r${row}`, column: `c${column}` }, before, after);
  }
  return gridJournalText(journal);
}

const ctrlZ = () => new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true });

describe("GridEngine", () => {
  it("virtualizza entro una finestra limitata e pubblica la semantica grid", async () => {
    const { engine, host, viewport } = await mounted();
    expect(viewport.getAttribute("role")).toBe("grid");
    expect(viewport.getAttribute("aria-rowcount")).toBe("101");
    expect(viewport.getAttribute("aria-colcount")).toBe("51");
    // Il riquadro (600 × 300, meno le intestazioni) e un riquadro intero di
    // margine prima e dopo: righe di 28 px, colonne di 120.
    const span = { rows: 300 - 28, columns: 600 - 52 };
    const drawn = () => {
      const cells = [...host.querySelectorAll<HTMLElement>(".grid-cell")];
      const rows = cells.map((cell) => Number(cell.dataset.row));
      const columns = cells.map((cell) => Number(cell.dataset.column));
      return { minRow: Math.min(...rows), maxRow: Math.max(...rows), maxColumn: Math.max(...columns) };
    };
    expect(drawn()).toEqual({ minRow: 0, maxRow: Math.floor((2 * span.rows) / 28), maxColumn: Math.floor((2 * span.columns) / 120) });
    expect(host.querySelectorAll(".grid-cell").length).toBe(engine.renderedCellCount());

    viewport.scrollTop = 1_400;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    await frames();
    expect(drawn().minRow).toBe(Math.floor((1_400 - span.rows) / 28));
    expect(drawn().maxRow).toBe(Math.floor((1_400 + 2 * span.rows) / 28));
    engine.destroy();
  });

  it("le righe restano: uno scorrimento le aggiunge e le toglie solo ai bordi, nel suo gestore", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ rows: 400, cells: { "0,0": "1", "10,1": "x" } }));
    const rows = () => new Map([...host.querySelectorAll<HTMLElement>(".grid-rows > .grid-row")].map((row) => [Number(row.dataset.row), row]));
    const before = rows();
    const cell = cellAt(host, 10, 1)!;
    expect(cell.textContent).toBe("x");
    // Il gestore dello scorrimento disegna subito, senza aspettare un
    // fotogramma, le righe del riquadro e di una fascia di un decimo di
    // riquadro attorno a lui, più qualcuna del margine; il resto del margine
    // lo finiscono i fotogrammi dopo.
    viewport.scrollTop = 280;
    viewport.dispatchEvent(new Event("scroll"));
    expect(Math.max(...rows().keys())).toBeGreaterThanOrEqual(Math.floor((280 + 272 + 27) / 28));
    await frames();
    const after = rows();
    expect(Math.max(...after.keys())).toBe(Math.floor((280 + 2 * 272) / 28));
    // Le righe che c'erano e ci sono ancora sono gli stessi elementi, con le
    // stesse celle.
    const kept = [...after.keys()].filter((row) => before.has(row));
    expect(kept.length).toBeGreaterThan(10);
    for (const row of kept) expect(after.get(row)).toBe(before.get(row));
    expect(cellAt(host, 10, 1)).toBe(cell);
    // Uno scorrimento lontano è un salto: nessuna riga resta, tutte nuove.
    viewport.scrollTop = 300 * 28;
    viewport.dispatchEvent(new Event("scroll"));
    await frames();
    const far = rows();
    expect([...far.values()].some((row) => [...after.values()].includes(row))).toBe(false);
    expect(Math.min(...far.keys())).toBe(Math.floor((300 * 28 - 272) / 28));
    engine.destroy();
  });

  it("una cella che cambia si aggiorna sul posto, e una che non cambia non si tocca", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ cells: { "0,0": "1", "1,0": "2" } }));
    const changed = cellAt(host, 0, 0)!;
    const still = cellAt(host, 1, 0)!;
    const text = still.querySelector(".grid-cell-text");
    changed.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    const formula = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-formula-editor")!);
    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "uno" }, userEvent: "input" });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(cellAt(host, 0, 0)).toBe(changed);
    expect(changed.textContent).toBe("uno");
    expect(cellAt(host, 1, 0)).toBe(still);
    expect(still.querySelector(".grid-cell-text")).toBe(text);
    // La selezione si sposta sulle celle che restano, senza rifarle.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(changed.classList.contains("active")).toBe(true);
    expect(changed.getAttribute("aria-selected")).toBe("true");
    expect(still.classList.contains("active")).toBe(false);
    engine.destroy();
  });

  it("la carta sotto le righe ha un filo per ogni colonna disegnata, e la sua copia nelle fasce ferme", async () => {
    const { engine, host, viewport } = await mounted();
    const plane = host.querySelector<HTMLElement>(".grid-plane")!;
    const paper = viewport.querySelector<HTMLElement>(":scope > .grid-paper")!;
    expect(paper.getAttribute("aria-hidden")).toBe("true");
    expect(plane.querySelector(".grid-head > .grid-paper-top")).not.toBeNull();
    expect(plane.querySelector<HTMLElement>(":scope > .grid-paper-left")!.hidden).toBe(false);
    expect(viewport.style.getPropertyValue("--grid-row")).toBe("28px");
    const rules = () => [...paper.querySelectorAll<HTMLElement>(".grid-rule-column")].map((rule) => rule.style.left);
    const columns = new Set([...host.querySelectorAll<HTMLElement>(".grid-cell")].map((cell) => cell.dataset.column));
    expect(rules()).toHaveLength(columns.size);
    // Il filo sta sull'ultimo pixel della colonna, dopo le intestazioni.
    expect(rules()[0]).toBe(`${52 + 120 - 1}px`);
    // Scorrendo di lato i fili seguono le colonne disegnate.
    viewport.scrollLeft = 2_400;
    viewport.dispatchEvent(new Event("scroll"));
    expect(rules()).toContain(`${52 + 25 * 120 - 1}px`);
    expect(rules()).not.toContain(`${52 + 120 - 1}px`);
    engine.destroy();
  });

  // IMP-6600: WebKitGTK dà un livello del compositore a un elemento
  // `sticky` che scorre, e uno suo a ogni elemento posato che si dipinge dopo
  // di lui nello stesso contesto e lo copre. La carta, `sticky`, sta sotto
  // le celle: nel piano, ogni riga aggiunta o tolta ridipingeva migliaia di
  // livelli a ogni passo. Sta nel riquadro, prima del piano, e non occupa
  // posto né prende il puntatore.
  it("la carta sta nel riquadro prima del piano, non dentro, senza occupare posto né prendere il puntatore", async () => {
    const { engine, host, viewport } = await mounted();
    const plane = host.querySelector<HTMLElement>(".grid-plane")!;
    const paper = host.querySelector<HTMLElement>(".grid-paper")!;
    expect(paper.parentElement).toBe(viewport);
    expect(paper.nextElementSibling).toBe(plane);
    expect(plane.querySelector(".grid-paper")).toBeNull();
    expect(paper.style.height).toBe("300px");
    expect(paper.style.marginBottom).toBe("-300px");
    expect(structureOf(".grid-paper")).toMatch(/position:\s*sticky/);
    expect(structureOf(".grid-paper")).toMatch(/pointer-events:\s*none/);
    engine.destroy();
  });

  // IMP-6600: WebKit, quando un figlio entra o esce, ridipinge tutto il
  // riquadro del genitore. Con il corpo grande quanto il foglio, ogni riga
  // aggiunta o tolta ai bordi dello scorrimento ridipingeva il foglio intero.
  // Il corpo è senza misura, come i livelli dei segni: entra ed esce solo la
  // riga, posata dal corpo con `top` e `left`.
  it("le righe che lo scorrimento aggiunge e toglie stanno in un corpo senza misura", async () => {
    const { engine, host } = await mounted();
    const body = host.querySelector<HTMLElement>(".grid-plane > .grid-rows")!;
    const rows = [...body.children].filter((element): element is HTMLElement => element.classList.contains("grid-row"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.style.position).toBe("absolute");
    const rule = structureOf(".grid-rows");
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/(^|[;\s])width:\s*0(px)?\s*;/);
    expect(rule).toMatch(/(^|[;\s])height:\s*0(px)?\s*;/);
    engine.destroy();
  });

  // IMP-6600: a ogni passo dello scorrimento la griglia riscriveva gli
  // attributi dei gruppi di righe e del riquadro, anche uguali, e il nome
  // della cella.
  it("scorrendo in giù aggiunge e toglie solo le righe ai bordi, e su ciò che resta scrive solo la fase della carta", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ rows: 400, cells: { "0,0": "1", "29,1": "trenta", "45,2": "quarantasei" } }));
    // Una cella scelta in fondo al riquadro, che resta sullo schermo: il suo
    // segno e il suo nome restano mentre si scorre. Dalla tastiera, che
    // porta il riquadro fin lì: un clic senza rilascio sarebbe un gesto in
    // corso, che lo scorrimento allunga.
    for (const key of [...Array<string>(29).fill("ArrowDown"), "ArrowRight"]) {
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    await settle();
    await frames();
    const start = viewport.scrollTop;
    expect(start).toBeGreaterThan(2 * 272);
    const headerRow = host.querySelector(".grid-column-header-row");
    expect(host.querySelector(".grid-cell-name")!.textContent).toBe("B30");
    const drawn = () => [...host.querySelectorAll<HTMLElement>(".grid-rows > .grid-row")].map((row) => Number(row.dataset.row));
    const first = drawn();

    // Diciotto passi di mezza riga: nove righe entrano nel margine in fondo
    // e nove escono da quello in cima. Della carta, ferma nel riquadro e
    // fuori dal piano, cambia a ogni passo la fase dei fili; nient'altro si
    // tocca.
    const writes = await scrollWrites(host, viewport, 18, 14);
    expect(viewport.scrollTop).toBe(start + 252);
    const paperWrites = writes.kept.filter((write) => /^style \.grid-paper(-left-head|-left-cells)?$/.test(write));
    expect(writes.kept.filter((write) => !paperWrites.includes(write))).toEqual([]);
    expect(paperWrites.length).toBeLessThanOrEqual(3 * 18);
    const last = drawn();
    const entered = last.filter((row) => !first.includes(row)).sort((a, b) => a - b);
    const left = first.filter((row) => !last.includes(row)).sort((a, b) => a - b);
    expect(entered).toHaveLength(9);
    expect(left).toHaveLength(9);
    expect([...writes.added].sort((a, b) => a - b)).toEqual(entered);
    expect([...writes.removed].sort((a, b) => a - b)).toEqual(left);

    // Ciò che si vede è giusto: le celle, la carta, la scelta, le intestazioni.
    expect(cellAt(host, 45, 2)!.textContent).toBe("quarantasei");
    expect(cellAt(host, 29, 1)!.textContent).toBe("trenta");
    expect(cellAt(host, 29, 1)!.classList.contains("active")).toBe(true);
    expect(viewport.getAttribute("aria-activedescendant")).toBe(cellAt(host, 29, 1)!.id);
    expect(host.querySelector(".grid-cell-name")!.textContent).toBe("B30");
    expect(host.querySelector(".grid-column-header-row")).toBe(headerRow);
    expect(host.querySelector(".grid-rows")!.getAttribute("role")).toBe("rowgroup");
    engine.destroy();
  });

  it("annida ogni intestazione e cella alla propria riga semantica", async () => {
    const { engine, viewport } = await mounted();
    const rows = [...viewport.querySelectorAll<HTMLElement>('[role="row"]')];
    expect(rows.length).toBeGreaterThan(1);
    // Le righe stanno nei loro gruppi: la testa (le intestazioni e le righe
    // bloccate) e il corpo, nel piano della griglia.
    expect(rows.every((row) => row.parentElement?.getAttribute("role") === "rowgroup")).toBe(true);
    expect(rows[0]?.parentElement?.classList.contains("grid-head")).toBe(true);
    expect(rows[0]?.getAttribute("aria-rowindex")).toBe("1");

    for (const row of rows) {
      const rowIndex = row.getAttribute("aria-rowindex");
      expect(rowIndex).not.toBeNull();
      for (const child of [...row.children]) {
        const role = child.getAttribute("role");
        expect(["columnheader", "rowheader", "gridcell", "presentation"]).toContain(role);
        if (role === "columnheader") {
          expect(child.getAttribute("aria-rowindex")).toBe("1");
          expect(Number(child.getAttribute("aria-colindex"))).toBeGreaterThan(1);
        } else if (role === "rowheader") {
          expect(child.getAttribute("aria-rowindex")).toBe(rowIndex);
          expect(child.getAttribute("aria-colindex")).toBe("1");
        } else if (role === "gridcell") {
          expect(child.getAttribute("aria-rowindex")).toBe(rowIndex);
          expect(Number(child.getAttribute("aria-colindex"))).toBeGreaterThan(1);
        }
      }
    }
    expect([...viewport.querySelectorAll<HTMLElement>('[role="gridcell"]')]
      .every((cell) => cell.parentElement?.getAttribute("role") === "row")).toBe(true);
    engine.destroy();
  });

  it("tiene le battute locali e consegna al provider una sola modifica al commit", async () => {
    const grid = bytesHost();
    const { engine, host, viewport, changes } = await mounted(grid);
    const windows = grid.calls.filter((call) => call === "window").length;

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
    await settle();
    expect(grid.applied).toHaveLength(0);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    // Il giornale arriva alla sessione all'invio, prima della risposta.
    expect(changes).toHaveLength(1);
    expect(written(engine.getDoc())).toEqual({ "0,0": "X" });
    await settle();
    expect(grid.applied).toEqual([{
      revision: "rev-0",
      patches: [{ cell: { sheet: "main", row: "r0", column: "c0" }, before: "1", after: "X" }],
    }]);
    // La conferma rilegge la cella cambiata, e il provider tiene lo stesso giornale.
    expect(grid.calls.filter((call) => call === "window").length).toBeGreaterThan(windows);
    expect(changes).toHaveLength(1);
    expect(grid.journal()).toBe(engine.getDoc());
    expect(cellAt(host, 0, 0)?.textContent).toBe("X");
    engine.destroy();
  });

  it("incolla TSV come una sola modifica, e l'undo locale non tocca quella di un altro riquadro", async () => {
    const grid = bytesHost();
    const { engine, viewport, changes } = await mounted(grid);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "A\tB\nC\tD", setData: vi.fn() } });
    viewport.dispatchEvent(paste);
    expect(changes).toHaveLength(1);
    expect(written(engine.getDoc())).toEqual({ "0,0": "A", "0,1": "B", "1,0": "C", "1,1": "D" });
    await settle();
    expect(grid.applied).toHaveLength(1);
    expect(grid.applied[0].patches).toHaveLength(4);

    // Un altro riquadro scrive C3: la griglia si riapre sul suo giornale.
    const peer = recordGridJournal(parseGridJournal(engine.getDoc()), { sheet: "main", row: "r2", column: "c2" }, "", "peer");
    engine.syncDoc(gridJournalText(peer));
    await settle();
    expect(changes).toHaveLength(1);

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(changes).toHaveLength(2);
    expect(changes[1].origin).toBe("undo");
    expect(written(engine.getDoc())).toEqual({ "2,2": "peer" });
    await settle();
    expect(written(grid.journal())).toEqual({ "2,2": "peer" });
    engine.destroy();
  });

  it("le battute dell'editor della cella restano sue, e non la riaprono", async () => {
    const { engine, host, viewport } = await mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "9", bubbles: true, cancelable: true }));
    const content = host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!;
    const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
    // CodeMirror scrive un carattere dall'input, e la battuta sale libera.
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }));
    expect(editor.state.selection.main.head).toBe(1);
    editor.dispatch({ changes: { from: 1, insert: "0" } });
    // Aperta da una battuta la cella è in «Inserisci»; F2 passa a «Modifica»,
    // dove le frecce muovono il cursore e non la confermano.
    expect(engine.editMode()).toBe("insert");
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    expect(engine.editMode()).toBe("edit");
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    // Un clic dentro l'editor sposta il cursore, e la cella resta aperta;
    // copiare dall'editor copia il suo testo, non la selezione della griglia.
    content.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    const copied: string[] = [];
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", {
      value: { setData: (_type: string, text: string) => copied.push(text), clearData: () => {} },
    });
    content.dispatchEvent(copy);
    expect(editor.state.doc.toString()).toBe("90");
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
    expect(copied).toEqual(["90"]);
    engine.destroy();
  });

  it("rilegge la cella invalidata sulle coordinate globali senza degradare gli ID sconosciuti", async () => {
    const grid = bytesHost({
      rows: 512,
      columns: 256,
      cells: { "0,0": "1", "300,200": "old" },
      invalidated: [{ sheet: "main", row: "missing-row", column: "missing-column" }],
    });
    const { engine, host, viewport } = await mounted(grid);
    viewport.scrollTop = 300 * 28;
    viewport.scrollLeft = 200 * 120;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    expect(cellAt(host, 300, 200)?.textContent).toBe("old");

    cellAt(host, 300, 200)!.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    const before = grid.requests.length;
    const formula = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-formula-editor")!);
    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "new" }, userEvent: "input" });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(grid.requests.slice(before)).toEqual([{ row_start: 256, column_start: 128 }]);
    expect(cellAt(host, 300, 200)?.textContent).toBe("new");
    expect(written(engine.getDoc())).toEqual({ "300,200": "new" });
    engine.destroy();
  });

  it("estende la selezione da tastiera e ripristina il fuoco dopo Escape", async () => {
    const { engine, host, viewport } = await mounted();
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(engine.selection()).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(viewport);
    engine.destroy();
  });

  it("la formula bar conserva la bozza e gestisce commit, cancel e blur", async () => {
    const { engine, host, viewport, changes } = await mounted();
    const formula = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-formula-editor")!);

    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "7" }, userEvent: "input" });
    expect(changes).toHaveLength(0);
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(changes).toHaveLength(1);
    expect(written(engine.getDoc())).toEqual({ "0,0": "7" });
    await settle();

    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "8" }, userEvent: "input" });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(changes).toHaveLength(1);
    await settle();
    expect(written(engine.getDoc())).toEqual({ "0,0": "7" });

    // Invio ha confermato e la cella attiva è scesa: la barra scrive in A2.
    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "9" }, userEvent: "input" });
    viewport.focus();
    await settle();
    expect(changes).toHaveLength(2);
    expect(written(engine.getDoc())).toEqual({ "0,0": "7", "1,0": "9" });
    engine.destroy();
  });

  it("copia e incolla una cella multilinea al suo posto senza toccare le vicine", async () => {
    const multiline = "prima\nseconda\tterza";
    const grid = bytesHost({ rows: 2, columns: 2, cells: { "0,0": multiline, "0,1": "B1", "1,0": "A2", "1,1": "B2" } });
    const { engine, viewport, changes } = await mounted(grid);
    const copied = new Map<string, string>();
    const clipboard = {
      getData: (type: string) => copied.get(type) ?? "",
      setData: (type: string, text: string) => { copied.set(type, text); },
    };
    for (const type of ["copy", "paste"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      viewport.dispatchEvent(event);
    }
    await settle();
    expect(changes).toHaveLength(0);
    expect(grid.applied).toEqual([]);
    expect(copied.get("text/plain")).toBe('"prima\nseconda\tterza"\n');
    // La tabella HTML di Fub non vince sul TSV: incollata, porta gli input.
    expect(copied.get("text/html")).toContain("data-fub-table");
    expect(copied.get("text/html")).toContain("prima<br>seconda\tterza");
    expect(engine.selectedText()).toEqual({ primary: multiline, secondary: [] });
    engine.destroy();
  });

  it("dice l'intervallo scelto come testo da leggere, fino a un tetto", async () => {
    const { engine, viewport } = await mounted();
    expect(engine.selectedText()).toEqual({ primary: "1", secondary: [] });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(engine.selectedText()).toEqual({ primary: "1\t\n\t", secondary: [] });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    // Cento righe per cinquanta colonne: sotto il tetto di diecimila celle.
    expect(engine.selectedText()?.primary.split("\n")).toHaveLength(100);
    engine.destroy();
    expect(engine.selectedText()).toBeNull();

    const large = await mounted(bytesHost({ rows: 200, columns: 60 }));
    large.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    expect(large.engine.selectedText()).toBeNull();
    large.engine.destroy();
  });

  it("barra delle formule ed editor di cella sono campi, non documenti", async () => {
    const { engine, host } = await mounted();
    for (const selector of [".grid-formula-editor", ".grid-cell-editor"]) {
      const field = host.querySelector<HTMLElement>(selector)!;
      expect(field.querySelector(".cm-lineNumbers")).toBeNull();
      expect(field.querySelector(".cm-foldGutter")).toBeNull();
      expect(findTextEditorOrThrow(field).contentDOM.getAttribute("spellcheck")).toBe("false");
    }
    engine.destroy();
  });

  it("tiene la bozza quando un altro riquadro riapre la cartella, e chiede se la sua cella è cambiata", async () => {
    const { engine, host, viewport, changes } = await mounted();
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    const notice = host.querySelector<HTMLElement>(".grid-draft-notice")!;
    const draft = () => findTextEditorOrThrow(editorHost).state.doc.toString();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));

    // Un'altra cella cambia: la bozza resta com'è, senza domande.
    const other = gridJournalText(recordGridJournal(parseGridJournal(""), { sheet: "main", row: "r0", column: "c1" }, "", "altro"));
    engine.syncDoc(other);
    await settle();
    expect(editorHost.hidden).toBe(false);
    expect(draft()).toBe("X");
    expect(notice.hidden).toBe(true);
    expect(cellAt(host, 0, 1)?.textContent).toBe("altro");

    // La sua cella cambia: la bozza resta e si chiede quale tenere.
    const peer = gridJournalText(recordGridJournal(parseGridJournal(other), { sheet: "main", row: "r0", column: "c0" }, "1", "peer"));
    engine.syncDoc(peer);
    await settle();
    expect(editorHost.hidden).toBe(false);
    expect(draft()).toBe("X");
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("peer");
    [...notice.querySelectorAll("button")].find((button) => button.textContent === t("grid.draft.take"))!.click();
    expect(editorHost.hidden).toBe(true);
    expect(notice.hidden).toBe(true);
    expect(cellAt(host, 0, 0)?.textContent).toBe("peer");
    expect(changes).toHaveLength(0);

    // «Tieni la tua»: la bozza resta, e Invio la scrive sopra quella nuova.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Y", bubbles: true }));
    const again = gridJournalText(recordGridJournal(parseGridJournal(peer), { sheet: "main", row: "r0", column: "c0" }, "1", "peer2"));
    engine.syncDoc(again);
    await settle();
    expect(notice.hidden).toBe(false);
    [...notice.querySelectorAll("button")].find((button) => button.textContent === t("grid.draft.keep"))!.click();
    expect(notice.hidden).toBe(true);
    expect(draft()).toBe("Y");
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())["0,0"]).toBe("Y");
    engine.destroy();
  });

  it("con una cella aperta, la riscrittura da fuori tiene la bozza, aggiorna il resto del foglio e lo dice", async () => {
    const { engine, host, viewport, changes } = await mounted();
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    const notice = host.querySelector<HTMLElement>(".grid-notice")!;
    const draft = () => findTextEditorOrThrow(editorHost).state.doc.toString();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));

    engine.syncDoc(outsideJournal("", { "0,1": ["", "fuori"] }));
    await settle();
    expect(editorHost.hidden).toBe(false);
    expect(draft()).toBe("X");
    expect(cellAt(host, 0, 1)?.textContent).toBe("fuori");
    expect(notice.textContent).toContain(t("grid.external.writing"));
    expect(changes).toHaveLength(0);

    // Invio scrive la bozza sulla sua cella, sopra il valore che il resto del foglio ha.
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())).toEqual({ "0,0": "X", "0,1": "fuori" });
    engine.destroy();
  });

  it("un annulla dopo una riscrittura che ha cambiato una sua cella non riporta i dati di prima", async () => {
    const grid = bytesHost();
    const { engine, host, viewport, changes } = await mounted(grid);
    typeInActiveCell(host, viewport, "X");
    await settle();
    expect(changes).toHaveLength(1);

    engine.syncDoc(outsideJournal("", { "0,0": ["1", "P"] }));
    await settle();
    expect(cellAt(host, 0, 0)?.textContent).toBe("P");

    viewport.dispatchEvent(ctrlZ());
    await settle();
    expect(cellAt(host, 0, 0)?.textContent).toBe("P");
    expect(changes).toHaveLength(1);
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).toContain(t("grid.external.undo"));
    engine.destroy();
  });

  /// Apre la cella di sotto ad A1 con la bozza «Z», e poi fa sparire la sua riga.
  async function openThenLoseRow(clipboard: "ok" | "refused" = "ok") {
    if (clipboard === "refused") vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error("negato"));
    let gone = false;
    const mount = await mounted(reshaped(bytesHost(), withRows((index) => (gone && index === 1 ? "rperduta" : `r${index}`))));
    mount.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    mount.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Z", bubbles: true }));
    expect(mount.host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
    gone = true;
    mount.engine.syncDoc(outsideJournal("", { "0,1": ["", "altro"] }));
    await settle();
    return mount;
  }

  it("se la riga della cella aperta non c'è più, la cella si chiude e il testo battuto va negli appunti", async () => {
    vi.mocked(writeClipboardText).mockClear();
    const { engine, host, changes } = await openThenLoseRow();
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(writeClipboardText).toHaveBeenCalledWith("Z");
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).toContain(t("grid.draft.row_gone", { draft: "Z" }));
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("se gli appunti rifiutano, il testo che la riga porta via resta scritto nell'avviso", async () => {
    vi.mocked(writeClipboardText).mockClear();
    const { engine, host } = await openThenLoseRow("refused");
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).toContain(t("grid.draft.row_gone_lost", { draft: "Z" }));
    engine.destroy();
  });

  it("due riscritture di fila: la bozza resta, e Invio scrive sopra il valore nuovo di quella sola cella", async () => {
    const { engine, host, viewport } = await mounted();
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    const notice = host.querySelector<HTMLElement>(".grid-notice")!;
    const draft = () => findTextEditorOrThrow(editorHost).state.doc.toString();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));

    const first = outsideJournal("", { "0,1": ["", "uno"] });
    engine.syncDoc(first);
    await settle();
    const second = outsideJournal(first, { "0,2": ["", "due"] });
    engine.syncDoc(second);
    await settle();
    expect(editorHost.hidden).toBe(false);
    expect(draft()).toBe("X");
    expect(cellAt(host, 0, 1)?.textContent).toBe("uno");
    expect(cellAt(host, 0, 2)?.textContent).toBe("due");
    expect(notice.textContent).toContain(t("grid.external.writing"));

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())).toEqual({ "0,0": "X", "0,1": "uno", "0,2": "due" });
    engine.destroy();
  });

  it("in sola lettura una riscrittura non apre una cella, e l'annulla non riporta i dati di prima", async () => {
    const { engine, host, viewport, changes } = await mounted(bytesHost());
    typeInActiveCell(host, viewport, "X");
    await settle();
    engine.setReadOnly(true);

    engine.syncDoc(outsideJournal("", { "0,0": ["1", "P"] }));
    await settle();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Q", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);

    viewport.dispatchEvent(ctrlZ());
    await settle();
    expect(cellAt(host, 0, 0)?.textContent).toBe("P");
    expect(changes).toHaveLength(1);
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).toContain(t("grid.external.undo"));
    engine.destroy();
  });

  it("una riga inserita sopra la cella aperta porta la bozza con la sua riga", async () => {
    let inserted = false;
    const rowId = (index: number) => (inserted && index > 0 ? (index === 1 ? "rnuova" : `r${index - 1}`) : `r${index}`);
    const { engine, host, viewport, changes } = await mounted(reshaped(bytesHost(), withRows(rowId)));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));

    inserted = true;
    engine.syncDoc(outsideJournal("", { "0,1": ["", "altro"] }));
    await settle();
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(changes).toHaveLength(1);
    expect(written(engine.getDoc())).toEqual({ "0,1": "altro", "1,0": "X" });
    engine.destroy();
  });

  it("due modifiche alla stessa cella si annullano una dopo l'altra, senza avviso se nessuno l'ha toccata", async () => {
    const { engine, host, viewport } = await mounted(bytesHost());
    typeInActiveCell(host, viewport, "X");
    await settle();
    typeInActiveCell(host, viewport, "Y");
    await settle();

    viewport.dispatchEvent(ctrlZ());
    await settle();
    expect(cellAt(host, 0, 0)?.textContent).toBe("X");
    viewport.dispatchEvent(ctrlZ());
    await settle();
    expect(cellAt(host, 0, 0)?.textContent).toBe("1");
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).not.toContain(t("grid.external.undo"));
    engine.destroy();
  });

  it("l'eco di un salvataggio non svuota la storia dell'annulla, e non dice che il file è cambiato fuori", async () => {
    let saved = false;
    const onDisk = (cell: GridBytesCell): GridBytesCell => cell.key.row === "r0" && cell.key.column === "c0"
      ? { ...cell, input: "X", display: "X", value: { kind: "text", value: "X" } }
      : cell;
    const { engine, host, viewport, changes } = await mounted(reshaped(bytesHost(), (window) => (
      saved ? { ...window, cells: window.cells.map(onDisk) } : window
    )));
    typeInActiveCell(host, viewport, "X");
    await settle();

    // Il salvataggio ha messo «X» nel file, e il giornale torna vuoto.
    saved = true;
    engine.syncDoc("");
    await settle();
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).not.toContain(t("grid.external.undo"));
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).not.toContain(t("grid.external.writing"));

    viewport.dispatchEvent(ctrlZ());
    await settle();
    expect(changes.map((change) => change.origin)).toContain("undo");
    engine.destroy();
  });

  it("Invio conferma e scende, Tab va di lato e Invio torna alla colonna di partenza", async () => {
    const { engine, host, viewport } = await mounted();
    const press = (key: string, init: KeyboardEventInit = {}) => host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    const type = (key: string) => viewport.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    type("7");
    press("Enter");
    type("5");
    press("Enter");
    expect(written(engine.getDoc())).toEqual({ "0,0": "7", "1,0": "5" });
    expect(engine.selection().focus).toEqual({ row: 2, column: 0 });

    type("a");
    press("Tab");
    type("b");
    press("Tab");
    type("c");
    press("Enter");
    expect(written(engine.getDoc())).toMatchObject({ "2,0": "a", "2,1": "b", "2,2": "c" });
    expect(engine.selection().focus).toEqual({ row: 3, column: 0 });

    // In «Inserisci» una freccia conferma e si sposta; Maiusc+Invio sale.
    type("d");
    press("ArrowRight");
    expect(written(engine.getDoc())["3,0"]).toBe("d");
    expect(engine.selection().focus).toEqual({ row: 3, column: 1 });
    type("e");
    press("Enter", { shiftKey: true });
    expect(written(engine.getDoc())["3,1"]).toBe("e");
    expect(engine.selection().focus).toEqual({ row: 2, column: 1 });
    expect(engine.editMode()).toBe("ready");
    engine.destroy();
  });

  it("Invio sulla selezione sposta senza aprire, e dentro l'intervallo gira", async () => {
    const { engine, host, viewport } = await mounted();
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("Enter");
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    key("Enter", { shiftKey: true });
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });

    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    const chosen = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } };
    key("Enter");
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 1, column: 0 } });
    key("Enter");
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 0, column: 1 } });
    key("Tab");
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 1, column: 0 } });
    key("Tab", { shiftKey: true });
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 0, column: 1 } });

    // Una battuta scrive nella cella attiva, e Ctrl+Invio in tutta la selezione.
    key("z");
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())).toEqual({ "0,0": "z", "0,1": "z", "1,0": "z", "1,1": "z" });
    engine.destroy();
  });

  it("le frecce senza Maiusc partono dalla cella attiva, non dall'altro capo", async () => {
    const { engine, viewport } = await mounted();
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    expect(engine.selection()).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 0 } });
    key("ArrowRight");
    expect(engine.selection()).toEqual({ anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 } });
    engine.destroy();
  });

  it("PagGiù conta le righe vere, Alt+PagGiù va di lato, Ctrl+Backspace torna alla cella attiva", async () => {
    const { engine, viewport } = await mounted(bytesHost({ hiddenRows: [3, 4, 5] }));
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    // 272 px sotto le intestazioni: nove righe e mezza che si vedono, più le
    // tre nascoste che non contano.
    key("PageDown");
    expect(engine.selection().focus).toEqual({ row: 12, column: 0 });
    expect(viewport.scrollTop).toBe(252);
    key("PageUp");
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    expect(viewport.scrollTop).toBe(0);
    key("PageDown", { altKey: true });
    expect(engine.selection().focus.row).toBe(0);
    expect(engine.selection().focus.column).toBeGreaterThan(1);

    key("PageUp", { altKey: true });
    key("PageDown");
    viewport.scrollTop = 0;
    key("Backspace", { ctrlKey: true });
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(written(engine.getDoc())).toEqual({});
    engine.destroy();
  });

  it("incolla dall'angolo, e un valore riempie tutta la selezione", async () => {
    const { engine, viewport } = await mounted();
    const paste = (data: Record<string, string>) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => data[type] ?? "" } });
      viewport.dispatchEvent(event);
    };
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    // B2:C3 scelta dal basso: si incolla comunque da B2.
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowUp", { shiftKey: true });
    key("ArrowLeft", { shiftKey: true });
    paste({ "text/plain": "x\n" });
    expect(written(engine.getDoc())).toEqual({ "1,1": "x", "1,2": "x", "2,1": "x", "2,2": "x" });
    expect(engine.selection()).toEqual({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } });

    // La tabella HTML di un altro programma vince sul testo, con le celle unite.
    key("Home", { ctrlKey: true });
    paste({
      "text/plain": "sbagliato\n",
      "text/html": "<table><tr><td colspan=2>uno<br>due</td><td>3</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>",
    });
    expect(written(engine.getDoc())).toMatchObject({ "0,0": "uno\ndue", "0,2": "3", "1,0": "a", "1,1": "b", "1,2": "c" });
    engine.destroy();
  });

  it("taglia segna con le formiche, e l'incolla sposta in un passo", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ cells: { "0,0": "1", "0,1": "2" } }));
    const copied = new Map<string, string>();
    const clipboard = {
      getData: (type: string) => copied.get(type) ?? "",
      setData: (type: string, text: string) => { copied.set(type, text); },
    };
    const send = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      viewport.dispatchEvent(event);
    };
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("ArrowRight", { shiftKey: true });
    send("cut");
    expect(written(engine.getDoc())).toEqual({});
    expect(host.querySelector(".grid-mark-cut:not([hidden])")).not.toBeNull();
    key("Escape");
    expect(host.querySelector(".grid-mark-cut:not([hidden])")).toBeNull();

    send("cut");
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowRight");
    send("paste");
    expect(written(engine.getDoc())).toEqual({ "0,0": "", "0,1": "", "2,1": "1", "2,2": "2" });
    expect(host.querySelector(".grid-mark-cut:not([hidden])")).toBeNull();
    engine.undo();
    expect(written(engine.getDoc())).toEqual({});
    engine.destroy();
  });

  it("una battuta vera lascia scrivere il browser, una sintetica porta il suo carattere", () => {
    const event = (init: Partial<KeyboardEvent>) =>
      ({ key: "", isTrusted: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, getModifierState: () => false, ...init }) as KeyboardEvent;
    expect(typingOpens(event({ key: "a", isTrusted: true }))).toBe("browser");
    expect(typingOpens(event({ key: "Dead", isTrusted: true }))).toBe("browser");
    expect(typingOpens(event({ key: "Process", isTrusted: true }))).toBe("browser");
    expect(typingOpens(event({ key: "a" }))).toBe("seed");
    expect(typingOpens(event({ key: "Dead" }))).toBeNull();
    expect(typingOpens(event({ key: "a", ctrlKey: true, isTrusted: true }))).toBeNull();
    expect(typingOpens(event({ key: "a", altKey: true, isTrusted: true }))).toBeNull();
    // AltGr scrive (@, €, [): su Windows arriva come Ctrl+Alt.
    expect(typingOpens(event({ key: "@", ctrlKey: true, altKey: true, isTrusted: true, getModifierState: (key: string) => key === "AltGraph" }))).toBe("browser");
    expect(typingOpens(event({ key: "Enter", isTrusted: true }))).toBeNull();
  });

  it("un clic su un'altra cella conferma quella aperta, e la cella toccata resta la stessa", async () => {
    const { engine, host, viewport } = await mounted();
    const target = cellAt(host, 2, 1)!;
    target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(cellAt(host, 2, 1)).toBe(target);
    expect(engine.selection().focus).toEqual({ row: 2, column: 1 });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "5", bubbles: true }));
    const other = cellAt(host, 0, 0)!;
    other.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())).toEqual({ "2,1": "5" });
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(cellAt(host, 0, 0)).toBe(other);
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    engine.destroy();
  });

  it("il fuoco che lascia la cella aperta la conferma, e lo scorrimento non la chiude", async () => {
    const { engine, host, viewport } = await mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    viewport.scrollTop = 28;
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(editorHost.hidden).toBe(false);
    // La cella aperta scorre con la sua zona: sta nel suo livello, non nella cella.
    expect(editorHost.parentElement?.classList.contains("grid-marks-body")).toBe(true);
    expect([editorHost.dataset.row, editorHost.dataset.column]).toEqual(["0", "0"]);

    viewport.focus();
    await settle();
    expect(editorHost.hidden).toBe(true);
    expect(written(engine.getDoc())).toEqual({ "0,0": "q" });
    engine.destroy();
  });

  it("la cella aperta non sta dentro un aria-hidden, e il suo livello torna nascosto quando si chiude", async () => {
    const { engine, host, viewport } = await mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    expect(editorHost.hidden).toBe(false);
    // Un lettore di schermo non legge niente dentro un `aria-hidden`: il campo
    // col fuoco sparirebbe (axe `aria-hidden-focus`, scena `grid-large-cella-aperta`).
    expect(editorHost.closest("[aria-hidden]")).toBeNull();
    // Il campo sta nel livello, e per chi legge è dentro la sua cella: una
    // griglia contiene solo righe e celle.
    expect(editorHost.id).not.toBe("");
    expect(cellAt(host, 0, 0)!.getAttribute("aria-owns")).toBe(editorHost.id);
    const lift = editorHost.parentElement!;
    // I segni che il livello porta restano nascosti da sé.
    for (const mark of lift.querySelectorAll(".grid-mark")) expect(mark.getAttribute("aria-hidden")).toBe("true");
    editorHost.querySelector<HTMLElement>(".cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
    expect(editorHost.hidden).toBe(true);
    expect(lift.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("[aria-owns]")).toBeNull();
    for (const other of host.querySelectorAll(".grid-lift-top, .grid-lift-left, .grid-lift-corner")) expect(other.getAttribute("aria-hidden")).toBe("true");
    engine.destroy();
  });

  it("la cella aperta è la cella: nel livello della sua zona, col suo carattere, e cresce a colonne intere", async () => {
    const long = "x".repeat(40);
    const { engine, host, viewport } = await mounted(bytesHost({ cells: { "0,0": long } }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    expect(editorHost.hidden).toBe(false);
    // Non dentro la cella: in fondo al livello «lift» del corpo, sopra i segni.
    expect(cellAt(host, 0, 0)!.contains(editorHost)).toBe(false);
    expect(editorHost.parentElement?.classList.contains("grid-marks-body")).toBe(true);
    expect(editorHost.parentElement?.lastElementChild).toBe(editorHost);
    // La cornice è un pezzo a parte, e il campo scrive col carattere della cella.
    expect(editorHost.querySelector(":scope > .grid-cell-editor-frame")?.getAttribute("aria-hidden")).toBe("true");
    expect(editorHost.querySelector(":scope > .grid-cell-editor-text .cm-content")).not.toBeNull();
    expect(editorHost.style.getPropertyValue("--field-font")).not.toBe("");
    // Senza tela il testo si stima a 0,6 em per carattere: la cella (120 px)
    // cresce a destra di colonne intere, meno il filo, dentro il riquadro.
    expect(editorHost.style.left).toBe("52px");
    const width = parseFloat(editorHost.style.width) + 1;
    expect(width % 120).toBe(0);
    expect(width).toBeGreaterThan(120);
    expect(52 + width).toBeLessThanOrEqual(600);
    expect(editorHost.style.height).toBe(`${28 - 1}px`);
    expect(editorHost.classList.contains("wraps")).toBe(false);
    // Un testo più lungo del riquadro (600 px) arriva al suo bordo e va a capo.
    findTextEditorOrThrow(editorHost).dispatch({ changes: { from: long.length, insert: "y".repeat(60) } });
    expect(editorHost.style.width).toBe(`${4 * 120 - 1}px`);
    expect(editorHost.classList.contains("wraps")).toBe(true);
    // Chiusa, torna fuori dalle zone e non porta niente della cella.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    editorHost.querySelector<HTMLElement>(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle();
    expect(editorHost.hidden).toBe(true);
    expect(editorHost.classList.contains("wraps")).toBe(false);
    expect(editorHost.dataset.row).toBeUndefined();
    engine.destroy();
  });

  it("disegna l'intervallo con un rettangolo solo, e segna le intestazioni dopo i nascosti", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ rows: 4, columns: 4, hiddenRows: [1], hiddenColumns: [1] }));
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    // Una cella sola: il rettangolo è la cella attiva, senza anello né velo.
    expect(shownRanges(host)).toBe(1);
    expect(shownMarks(host, "veil")).toEqual([]);
    expect(shownMarks(host, "ring")).toEqual([]);
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    await frames(40);
    expect(shownRanges(host)).toBe(1);
    expect(shownMarks(host, "ring")).toHaveLength(4);
    expect(shownMarks(host, "veil").length).toBeGreaterThan(0);
    expect(host.querySelector(".grid-cell.active")?.classList.contains("selected")).toBe(true);
    key("Escape");
    key("ArrowLeft");
    await frames(40);
    expect(shownRanges(host)).toBe(1);
    expect(shownMarks(host, "veil")).toEqual([]);
    // La tacca dei nascosti sta sull'intestazione che li segue.
    const marked = [...host.querySelectorAll(".grid-header.after-hidden")].map((header) => header.textContent);
    expect(marked.sort()).toEqual(["3", "C"]);
    engine.destroy();
  });

  it("Maiusc+F8 aggiunge alla selezione, Canc svuota tutti gli intervalli, e copia li rifiuta", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ rows: 6, columns: 6, cells: { "0,0": "a", "2,2": "c", "1,1": "b" } }));
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("F8", { shiftKey: true });
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowRight");
    key("ArrowRight");
    key("Escape");
    // A1 resta scelta, e C3 è l'intervallo in cui si lavora; B2 no.
    expect(shownRanges(host)).toBe(2);
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    const data = new Map<string, string>();
    Object.defineProperty(copy, "clipboardData", { value: { setData: (type: string, text: string) => data.set(type, text), getData: () => "" } });
    viewport.dispatchEvent(copy);
    expect(data.size).toBe(0);
    key("Delete");
    expect(written(engine.getDoc())).toEqual({ "0,0": "", "2,2": "" });
    // Fuori dal modo, una freccia ricomincia da un intervallo solo.
    key("ArrowLeft");
    expect(shownRanges(host)).toBe(1);
    engine.destroy();
  });

  it("salta gli assi nascosti e avvolge Tab sulla riga visibile successiva", async () => {
    const { engine, viewport } = await mounted(bytesHost({ rows: 3, columns: 3, hiddenRows: [0], hiddenColumns: [1] }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    engine.destroy();
  });

  // IMP-029: nella WebView di GTK Maiusc+Tab arriva come `ISO_Left_Tab`,
  // cioè `key === "Unidentified"` con `code === "Tab"`.
  it("Maiusc+Tab torna a sinistra anche quando la WebView non dà il nome del tasto", async () => {
    const { engine, viewport } = await mounted(bytesHost({ rows: 2, columns: 3 }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 0, column: 2 });
    const backward = new KeyboardEvent("keydown", { key: "Unidentified", code: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    viewport.dispatchEvent(backward);
    expect(engine.selection().focus).toEqual({ row: 0, column: 1 });
    expect(backward.defaultPrevented).toBe(true);
    engine.destroy();
  });

  it("lascia uscire Tab ai bordi senza intrappolare il fuoco", async () => {
    const { engine, viewport } = await mounted(bytesHost({ rows: 1, columns: 2 }));
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    const backward = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    viewport.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(false);
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    viewport.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(engine.selection().focus).toEqual({ row: 0, column: 1 });
    const exit = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    viewport.dispatchEvent(exit);
    expect(exit.defaultPrevented).toBe(false);
    expect(engine.selection().focus).toEqual({ row: 0, column: 1 });
    engine.destroy();
  });

  it("non espone un discendente attivo quando ogni asse è nascosto", async () => {
    const grid = bytesHost({ rows: 1, columns: 1, hiddenRows: [0], hiddenColumns: [0] });
    const { engine, host, viewport, changes } = await mounted(grid);
    expect(viewport.hasAttribute("aria-activedescendant")).toBe(false);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("sceglie deterministicamente la prima superficie compatibile dichiarata", async () => {
    const grid = bytesHost({
      surfaces: [
        { ...SURFACE, id: "other-format", format: "ods" },
        { ...SURFACE, id: "first" },
        { ...SURFACE, id: "second" },
      ],
    });
    const { engine } = await mounted(grid);
    expect(grid.calls.filter((call) => call.startsWith("open"))).toEqual(["open first"]);
    engine.destroy();
  });

  it("rifiuta famiglia o versione sconosciuta prima di aprire una sessione", async () => {
    const grid = bytesHost({
      surfaces: [
        { ...SURFACE, id: "wrong-family", family: "other" },
        { ...SURFACE, id: "wrong-version", protocol_version: GRID_BYTES_PROTOCOL_VERSION + 1 },
      ],
    });
    const { engine, host } = await mounted(grid);
    expect(grid.opened).toEqual([]);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    engine.destroy();
  });

  it("chiude prima del teardown e riapre con un'istanza nuova senza residui", async () => {
    let mountedAtClose = false;
    const grid = bytesHost({ onClose: () => { mountedAtClose = document.querySelector(".grid-surface") !== null; } });
    const first = await mounted(grid);
    first.engine.destroy();
    expect(grid.opened).toEqual(["bytes-1"]);
    expect(grid.closed).toEqual(["bytes-1"]);
    expect(grid.active.size).toBe(0);
    expect(mountedAtClose).toBe(true);
    expect(first.host.querySelector(".grid-surface")).toBeNull();

    const second = await mounted(grid);
    expect(grid.opened).toEqual(["bytes-1", "bytes-2"]);
    expect(grid.active).toEqual(new Set(["bytes-2"]));
    const callsAfterSecondOpen = grid.calls.length;
    first.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await settle();
    expect(grid.calls.length).toBe(callsAfterSecondOpen);

    second.engine.destroy();
    expect(grid.closed).toEqual(["bytes-1", "bytes-2"]);
    expect(grid.active.size).toBe(0);
    expect(second.host.querySelector(".grid-surface")).toBeNull();
    const callsAfterDestroy = grid.calls.length;
    second.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await settle();
    expect(grid.calls.length).toBe(callsAfterDestroy);
  });

  it("legge solo il viewport anche con assi da centomila righe", async () => {
    const grid = bytesHost({ rows: 100_000, columns: 1_000, cells: {} });
    const { engine, viewport } = await mounted(grid);
    const initialWindows = grid.calls.filter((call) => call === "window").length;
    expect(initialWindows).toBeLessThanOrEqual(4);
    viewport.scrollTop = 90_000 * 28;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    expect(grid.calls.filter((call) => call === "window").length).toBeLessThanOrEqual(initialWindows + 4);
    engine.destroy();
  });

  it("chiude la sessione se il provider cade nella prima finestra", async () => {
    const grid = bytesHost();
    Object.assign(grid.host, { gridBytesWindow: async () => { throw new Error("provider trap"); } });
    const { engine, host } = await mounted(grid);
    expect(grid.opened).toHaveLength(1);
    expect(grid.closed).toEqual(grid.opened);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).toContain("provider trap");
    engine.destroy();
  });

  it("consegna il giornale alla sessione all'invio, anche se la linguetta si chiude prima della risposta", async () => {
    const grid = bytesHost();
    const answers: Array<() => void> = [];
    const apply = grid.host.applyGridBytes;
    Object.assign(grid.host, {
      applyGridBytes: async (...args: Parameters<GridHost["applyGridBytes"]>) => {
        await new Promise<void>((resolve) => answers.push(resolve));
        return apply(...args);
      },
    });
    const { engine, host, viewport, changes } = await mounted(grid);
    typeInActiveCell(host, viewport, "X");
    // Prima di ogni risposta: la sessione ha già il giornale, e diventa sporca.
    expect(changes).toHaveLength(1);
    expect(written(changes[0].text)).toEqual({ "0,0": "X" });
    await settle();
    expect(answers).toHaveLength(1);
    engine.destroy();
    answers.forEach((answer) => answer());
    await settle();
    // Dopo il teardown niente: il riquadro può già mostrare un altro documento.
    expect(changes).toHaveLength(1);
  });
});

describe("openSpan", () => {
  // Cinque colonne da 100 px, la prima a 50 px dal bordo del riquadro.
  const edge = (index: number) => 50 + index * 100;
  it("cresce a colonne intere finché il testo ci sta", () => {
    expect(openSpan(edge, 5, 1, 2, 99, 0, 600, ["after", "before"])).toEqual({ start: 1, end: 2, fits: true });
    expect(openSpan(edge, 5, 1, 2, 150, 0, 600, ["after", "before"])).toEqual({ start: 1, end: 3, fits: true });
    // Allineata a destra cresce a sinistra.
    expect(openSpan(edge, 5, 2, 3, 150, 0, 600, ["before", "after"])).toEqual({ start: 1, end: 3, fits: true });
  });
  it("si ferma al bordo del riquadro, poi cresce dall'altra parte, poi non ci sta", () => {
    expect(openSpan(edge, 5, 3, 4, 250, 0, 460, ["after", "before"])).toEqual({ start: 1, end: 4, fits: true });
    expect(openSpan(edge, 5, 3, 4, 900, 120, 460, ["after", "before"])).toEqual({ start: 1, end: 4, fits: false });
  });
  it("salta i confini nascosti sotto una fascia ferma", () => {
    // Le colonne dopo la prima sono scorse di 180 px: i confini 2 e 3 stanno
    // sotto la fascia ferma, che finisce a 150.
    const scrolled = (index: number) => (index <= 1 ? edge(index) : edge(index) - 180);
    expect(openSpan(scrolled, 5, 0, 1, 250, 150, 600, ["after"])).toEqual({ start: 0, end: 5, fits: true });
    expect(openSpan(scrolled, 5, 0, 1, 110, 150, 600, ["after"])).toEqual({ start: 0, end: 3, fits: true });
  });
});

describe("fillTarget", () => {
  const source = { rowStart: 1, rowEnd: 2, columnStart: 1, columnEnd: 1 };
  it("estende lungo l'asse su cui il puntatore è uscito di più", () => {
    expect(fillTarget(source, { row: 6, column: 3 })).toEqual({ ...source, rowEnd: 6 });
    expect(fillTarget(source, { row: 3, column: 5 })).toEqual({ ...source, columnEnd: 5 });
    expect(fillTarget(source, { row: 0, column: 1 })).toEqual({ ...source, rowStart: 0 });
    expect(fillTarget(source, { row: 2, column: 0 })).toEqual({ ...source, columnStart: 0 });
  });
  it("dentro la sorgente non riempie", () => {
    expect(fillTarget(source, { row: 2, column: 1 })).toBe(source);
  });
});

// **Ciò che si scrive o si tira si vede subito** (griglia T5): sulla cartella
// di Excel, col provider tenuto in volo (`hold`) per guardare l'anteprima.
describe("GridEngine: l'anteprima di ciò che si scrive o si tira", () => {
  const press = (target: EventTarget, type: string, x: number, y: number) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y }));
  const headerOf = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll<HTMLElement>(".grid-column-header")].find((element) => element.textContent === label)!;
  /// Tira il bordo destro dell'intestazione `label` di `by` px e lo rilascia.
  const pull = (host: HTMLElement, viewport: HTMLElement, label: string, by: number) => {
    const header = headerOf(host, label);
    const edge = parseFloat(header.style.left) + parseFloat(header.style.width);
    press(viewport, "pointermove", edge - 2, 10);
    press(viewport, "pointerdown", edge - 2, 10);
    press(viewport, "pointermove", edge - 2 + by, 10);
    press(viewport, "pointerup", edge - 2 + by, 10);
  };
  const widthOf = (host: HTMLElement, label: string) => parseFloat(headerOf(host, label).style.width);
  const rounds = async (count: number) => {
    for (let round = 0; round < count; round += 1) await settle();
  };

  it("un numero va a destra appena lo si conferma, e la cella che il provider rilegge vince", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, cell, go } = await workbookMounted(grid);
    grid.hold(true);
    go(6, 1);
    typeInActiveCell(host, viewport, "42");
    expect(cell(6, 1)!.textContent).toBe("42");
    expect(cell(6, 1)!.style.textAlign).toBe("end");
    // Un testo resta a sinistra, e un numero con l'apostrofo è un testo.
    go(7, 1);
    typeInActiveCell(host, viewport, "abc");
    go(8, 1);
    typeInActiveCell(host, viewport, "'42");
    expect(cell(7, 1)!.style.textAlign).not.toBe("end");
    expect(cell(8, 1)!.textContent).toBe("42");
    expect(cell(8, 1)!.style.textAlign).not.toBe("end");
    // Il finto rilegge ogni input come testo: la sua risposta vince
    // sull'anteprima del numero.
    grid.hold(false);
    grid.release();
    await rounds(8);
    expect(cell(6, 1)!.textContent).toBe("42");
    expect(cell(6, 1)!.style.textAlign).not.toBe("end");
    engine.destroy();
  });

  it("una formula resta com'è scritta, tenue, finché il foglio non risponde", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, cell, go } = await workbookMounted(grid);
    grid.hold(true);
    go(6, 1);
    typeInActiveCell(host, viewport, "=B2+1");
    expect(cell(6, 1)!.textContent).toBe("=B2+1");
    expect(cell(6, 1)!.classList.contains("pending")).toBe(true);
    // Tenue non è «legge celle cambiate»: niente `stale`.
    expect(cell(6, 1)!.classList.contains("stale")).toBe(false);
    grid.hold(false);
    grid.release();
    await rounds(8);
    expect(cell(6, 1)!.classList.contains("pending")).toBe(false);
    engine.destroy();
  });

  it("una larghezza tirata vale subito, e resta quando il provider dice sì", async () => {
    let wide: number | null = null;
    const grid = workbookHost({
      window: (window) => {
        const column = window.columns.find((candidate) => candidate.index === 1);
        if (column && wide !== null) column.width = wide;
      },
    });
    const { engine, host, viewport } = await workbookMounted(grid);
    const before = widthOf(host, "B");
    const after = Math.round(Math.round((before + 28) / 1.4) * 1.4);
    const left = parseFloat(headerOf(host, "C").style.left);
    grid.hold(true);
    pull(host, viewport, "B", 28);
    // Dal primo disegno dopo il rilascio: la colonna è larga quanto al
    // rilascio, e la C è già al posto nuovo.
    expect(widthOf(host, "B")).toBe(after);
    expect(parseFloat(headerOf(host, "C").style.left)).toBe(left + after - before);
    await rounds(2);
    expect(widthOf(host, "B")).toBe(after);
    expect(grid.given.map((request) => request.command.id)).toEqual(["home.columnWidth"]);
    wide = JSON.parse(grid.given[0].command.params).width;
    grid.hold(false);
    grid.release();
    await rounds(8);
    expect(widthOf(host, "B")).toBe(after);
    engine.destroy();
  });

  it("un no torna com'era, e l'avviso dice perché", async () => {
    const grid = workbookHost();
    const refusing = {
      ...grid,
      host: {
        ...grid.host,
        gridBytesCommand: async () => {
          throw { kind: "permission_denied", message: "il foglio è protetto" };
        },
      },
    };
    const { engine, host, viewport, notice } = await workbookMounted(refusing);
    const before = widthOf(host, "B");
    pull(host, viewport, "B", 28);
    expect(widthOf(host, "B")).toBeGreaterThan(before);
    await rounds(6);
    expect(widthOf(host, "B")).toBe(before);
    expect(notice().hidden).toBe(false);
    expect(notice().textContent).toContain("il foglio è protetto");
    engine.destroy();
  });

  it("una risposta vecchia non annulla un gesto più nuovo sullo stesso bordo", async () => {
    const grid = workbookHost();
    const { engine, host, viewport } = await workbookMounted(grid);
    const before = widthOf(host, "B");
    grid.hold(true);
    pull(host, viewport, "B", 28);
    const first = widthOf(host, "B");
    pull(host, viewport, "B", 42);
    const second = widthOf(host, "B");
    expect(second).toBeGreaterThan(first);
    // Il primo comando risponde (il finto non cambia le larghezze): la sua
    // anteprima esce, quella del secondo gesto resta e vince.
    await rounds(2);
    grid.release();
    await rounds(16);
    expect(grid.given.length).toBe(2);
    expect(widthOf(host, "B")).toBe(second);
    grid.hold(false);
    grid.release();
    await rounds(8);
    // Tutti e due hanno risposto: restano le misure lette.
    expect(widthOf(host, "B")).toBe(before);
    engine.destroy();
  });
});

describe("la misura di un bordo tirato e le anteprime delle misure", () => {
  it("la misura sta dopo il bordo, o prima quando dopo non c'è posto, mai fuori dal riquadro", () => {
    expect(resizeLabelAt(100, 150, 700)).toBe(106);
    expect(resizeLabelAt(600, 150, 700)).toBe(444);
    expect(resizeLabelAt(100, 150, 200)).toBe(6);
    expect(resizeLabelAt(-40, 150, 700)).toBe(6);
  });
  it("la più nuova vince, e senza anteprime le linee restano quelle", () => {
    const lines = [{ hidden: false, width: 10 }, { hidden: false }, { hidden: true, width: 5 }];
    expect(previewSizes(lines, "width", [])).toBe(lines);
    const previews = [
      { ticket: 1, sheet: "s1", axis: "column" as const, first: 0, last: 1, size: 30 },
      { ticket: 2, sheet: "s1", axis: "column" as const, first: 1, last: 1, size: 40 },
    ];
    expect(previewSizes(lines, "width", previews)).toEqual([{ hidden: false, width: 30 }, { hidden: false, width: 40 }, { hidden: true, width: 5 }]);
    expect(lines[0].width).toBe(10);
  });
});

describe("GridEngine: riempire, copiare, tagliare, incollare (griglia T6)", () => {
  const FRAME = 1000 / 60;
  let driver: ManualDriver;
  afterEach(() => {
    setMotionDriver(null);
  });
  const rounds = async (count: number) => {
    for (let round = 0; round < count; round += 1) await settle();
  };
  const shown = (host: HTMLElement, selector: string) => host.querySelectorAll<HTMLElement>(`${selector}:not([hidden])`).length;
  /// I pezzi che si vedono quando le uscite (una dissolvenza in
  /// `DURATION.swap`) sono finite.
  const faded = async (host: HTMLElement, selector: string) => {
    driver.advance(DURATION.swap + FRAME * 2);
    await settle();
    return shown(host, selector);
  };
  const walkingAnts = () => driver.plays.filter((play) => play.state === "running" && (play.el as HTMLElement).classList.contains("grid-ants"));
  async function mountedWithMotion(grid = workbookHost()) {
    driver = createManualDriver();
    setMotionDriver(driver);
    const made = await workbookMounted(grid);
    const copied = new Map<string, string>();
    const send = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (kind: string) => copied.get(kind) ?? "", setData: (kind: string, text: string) => { copied.set(kind, text); } },
      });
      made.viewport.dispatchEvent(event);
    };
    const key = (name: string) => made.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    return { ...made, grid, send, key, copied };
  }

  it("un riempimento aspetta il foglio con le formiche in cammino attorno al bersaglio; poi i valori entrano dalla sorgente", async () => {
    const { engine, host, grid, go } = await mountedWithMotion();
    go(1, 1);
    await settle();
    grid.hold(true);
    expect(engine.command("edit.autoFill", JSON.stringify({ source: "B2", target: "B2:B4" }))).toBe(true);
    await settle();
    // Il contorno resta, le formiche camminano, il quadratino non c'è e la
    // selezione resta sulla sorgente.
    expect(shown(host, ".grid-mark-ants")).toBe(4);
    expect(walkingAnts().length).toBe(4);
    expect(shown(host, ".grid-mark-handle")).toBe(0);
    expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } });
    driver.advance(1000);
    await settle();
    expect(shown(host, ".grid-mark-ants")).toBe(4);
    expect(walkingAnts().length).toBe(4);

    const before = driver.plays.length;
    grid.hold(false);
    grid.release();
    await rounds(8);
    // La risposta ferma le formiche; il provider seleziona il riempimento.
    expect(walkingAnts()).toHaveLength(0);
    expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 1 } });
    // I valori nuovi (B3, B4) entrano uno dopo l'altro, dalla sorgente.
    const entering = driver.plays.slice(before).filter((play) => (play.el as HTMLElement).classList.contains("grid-cell-text"));
    const rows = entering.map((play) => Number((play.el as HTMLElement).closest<HTMLElement>(".grid-cell")!.dataset.row));
    expect(rows).toEqual([2, 3]);
    expect(entering[1]!.timing.delay).toBeGreaterThan(entering[0]!.timing.delay);
    expect(entering.every((play) => Number(play.keyframes[0]!.opacity) === 0)).toBe(true);
    // Le formiche escono con una dissolvenza, poi non c'è più niente.
    driver.advance(DURATION.swap + FRAME * 2);
    await rounds(2);
    expect(shown(host, ".grid-mark-ants")).toBe(0);
    engine.destroy();
  });

  it("un riempimento che il foglio rifiuta toglie le formiche, e l'avviso dice perché", async () => {
    const { engine, host, grid, go, notice } = await mountedWithMotion();
    go(1, 1);
    await settle();
    grid.hold(true);
    grid.failCommand({ kind: "bad_args", message: "fill refused" });
    engine.command("edit.fillDown");
    await settle();
    expect(shown(host, ".grid-mark-ants")).toBe(4);
    grid.hold(false);
    grid.release();
    await rounds(8);
    expect(walkingAnts()).toHaveLength(0);
    driver.advance(DURATION.swap + FRAME * 2);
    await rounds(2);
    expect(shown(host, ".grid-mark-ants")).toBe(0);
    expect(notice().textContent).toContain("fill refused");
    // Il quadratino torna.
    expect(shown(host, ".grid-mark-handle")).toBe(1);
    engine.destroy();
  });

  it("lo smontaggio durante l'attesa ferma le formiche", async () => {
    const { engine, grid, go } = await mountedWithMotion();
    go(1, 1);
    await settle();
    grid.hold(true);
    engine.command("edit.fillRight");
    await settle();
    expect(walkingAnts().length).toBeGreaterThan(0);
    engine.destroy();
    expect(walkingAnts()).toHaveLength(0);
    grid.hold(false);
    grid.release();
    await rounds(4);
    driver.advance(1000);
    expect(walkingAnts()).toHaveLength(0);
  });

  it("ciò che si è copiato ha il tratteggio largo e un battito; Esc, scrivere o un'altra copia lo spostano", async () => {
    const { engine, host, viewport, send, key, go } = await mountedWithMotion();
    go(1, 1);
    send("copy");
    expect(shown(host, ".grid-mark-copy")).toBe(4);
    expect(shown(host, ".grid-mark-flash")).toBeGreaterThan(0);
    // Sul tratteggio il bordo pieno della selezione non c'è.
    expect(shown(host, ".grid-mark-edge")).toBe(0);
    driver.advance(DURATION.swap + FRAME * 2);
    await settle();
    expect(shown(host, ".grid-mark-flash")).toBe(0);
    expect(shown(host, ".grid-mark-copy")).toBe(4);
    key("Escape");
    expect(await faded(host, ".grid-mark-copy")).toBe(0);
    expect(shown(host, ".grid-mark-edge")).toBe(4);

    // Due copie: il segno segue l'ultima, e lascia la selezione di prima.
    send("copy");
    const first = host.querySelector<HTMLElement>('.grid-mark-copy[data-mark="clip-top"]:not([hidden])')!.style.cssText;
    go(2, 0);
    send("copy");
    expect(shown(host, ".grid-mark-copy")).toBe(4);
    expect(host.querySelector<HTMLElement>('.grid-mark-copy[data-mark="clip-top"]:not([hidden])')!.style.cssText).not.toBe(first);

    // Scrivere toglie il segno.
    go(8, 1);
    typeInActiveCell(host, viewport, "7");
    expect(await faded(host, ".grid-mark-copy")).toBe(0);
    engine.destroy();
  });

  it("il segno di una copia resta sul suo foglio", async () => {
    const { engine, host, send, go } = await mountedWithMotion();
    go(1, 1);
    send("copy");
    const tabs = [...host.querySelectorAll<HTMLButtonElement>(".grid-sheets [role=tab]")];
    tabs[1]!.click();
    await settle();
    expect(await faded(host, ".grid-mark-copy")).toBe(0);
    tabs[0]!.click();
    await settle();
    expect(shown(host, ".grid-mark-copy")).toBe(4);
    engine.destroy();
  });

  it("incollare mostra i valori subito; la risposta del foglio vince, e un no rimette le celle com'erano", async () => {
    const { engine, grid, send, go, cell, notice, host } = await mountedWithMotion();
    go(1, 1);
    send("copy");
    grid.hold(true);
    go(6, 2);
    send("paste");
    // Dal primo disegno, prima della risposta.
    expect(cell(6, 2)!.textContent).toBe("800");
    expect(await faded(host, ".grid-mark-copy")).toBe(0);
    grid.hold(false);
    grid.release();
    await rounds(8);
    // Il finto non scrive le celle: la sua cella vuota vince sull'anteprima.
    expect(cell(6, 2)!.textContent).toBe("");

    grid.hold(true);
    grid.failCommand({ kind: "bad_args", message: "paste refused" });
    go(7, 2);
    send("paste");
    expect(cell(7, 2)!.textContent).toBe("800");
    grid.hold(false);
    grid.release();
    await rounds(8);
    expect(cell(7, 2)!.textContent).toBe("");
    expect(notice().textContent).toContain("paste refused");
    engine.destroy();
  });

  it("un taglio incollato ha le formiche attorno a ciò che si sposta finché il foglio non risponde", async () => {
    const { engine, grid, send, go, cell, host } = await mountedWithMotion();
    go(1, 1);
    send("cut");
    expect(shown(host, ".grid-mark-cut")).toBe(4);
    grid.hold(true);
    go(7, 1);
    send("paste");
    expect(await faded(host, ".grid-mark-cut")).toBe(0);
    expect(shown(host, ".grid-mark-ants")).toBe(4);
    expect(walkingAnts().length).toBe(4);
    // L'anteprima: il valore sulla destinazione, la sorgente vuota.
    expect(cell(7, 1)!.textContent).toBe("800");
    expect(cell(1, 1)!.textContent).toBe("");
    grid.hold(false);
    grid.release();
    await rounds(8);
    expect(walkingAnts()).toHaveLength(0);
    driver.advance(DURATION.swap + FRAME * 2);
    await rounds(2);
    expect(shown(host, ".grid-mark-ants")).toBe(0);
    engine.destroy();
  });
});
