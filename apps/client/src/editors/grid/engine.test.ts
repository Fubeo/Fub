// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import { GRID_BYTES_PROTOCOL_VERSION } from "../../host/contract";
import { t } from "../../i18n/strings";
import { gridJournalText, parseGridJournal, recordGridJournal } from "../../state/grid-journal";
import { fillTarget, typingOpens, type GridHost } from "./engine";
import { bytesHost, cellAt, mounted, settle, SURFACE, typeInActiveCell, written } from "./test-support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("GridEngine", () => {
  it("virtualizza entro una finestra limitata e pubblica la semantica grid", async () => {
    const { engine, host, viewport } = await mounted();
    expect(viewport.getAttribute("role")).toBe("grid");
    expect(viewport.getAttribute("aria-rowcount")).toBe("101");
    expect(viewport.getAttribute("aria-colcount")).toBe("51");
    expect(engine.renderedCellCount()).toBeLessThan(200);
    expect(host.querySelectorAll(".grid-cell").length).toBe(engine.renderedCellCount());

    viewport.scrollTop = 1_400;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    const renderedRows = [...host.querySelectorAll<HTMLElement>(".grid-cell")]
      .map((cell) => Number(cell.dataset.row));
    expect(Math.min(...renderedRows)).toBeGreaterThan(40);
    expect(engine.renderedCellCount()).toBeLessThan(200);
    engine.destroy();
  });

  it("annida ogni intestazione e cella alla propria riga semantica", async () => {
    const { engine, viewport } = await mounted();
    const rows = [...viewport.querySelectorAll<HTMLElement>('[role="row"]')];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.parentElement === viewport)).toBe(true);
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
    expect(host.querySelector(".grid-cut-mark")).not.toBeNull();
    key("Escape");
    expect(host.querySelector(".grid-cut-mark")).toBeNull();

    send("cut");
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowRight");
    send("paste");
    expect(written(engine.getDoc())).toEqual({ "0,0": "", "0,1": "", "2,1": "1", "2,2": "2" });
    expect(host.querySelector(".grid-cut-mark")).toBeNull();
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
    expect(editorHost.parentElement).toBe(cellAt(host, 0, 0));

    viewport.focus();
    await settle();
    expect(editorHost.hidden).toBe(true);
    expect(written(engine.getDoc())).toEqual({ "0,0": "q" });
    engine.destroy();
  });

  it("disegna l'intervallo con un rettangolo solo, e segna le intestazioni dopo i nascosti", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ rows: 4, columns: 4, hiddenRows: [1], hiddenColumns: [1] }));
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    // Una cella sola: il bordo è quello della cella attiva.
    expect(host.querySelector(".grid-selection")).toBeNull();
    expect(viewport.classList.contains("ranged")).toBe(false);
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    expect(host.querySelectorAll(".grid-selection")).toHaveLength(1);
    expect(viewport.classList.contains("ranged")).toBe(true);
    expect(host.querySelector(".grid-cell.active")?.classList.contains("selected")).toBe(true);
    key("Escape");
    key("ArrowLeft");
    expect(host.querySelector(".grid-selection")).toBeNull();
    expect(viewport.classList.contains("ranged")).toBe(false);
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
    expect(host.querySelectorAll(".grid-selection")).toHaveLength(2);
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    const data = new Map<string, string>();
    Object.defineProperty(copy, "clipboardData", { value: { setData: (type: string, text: string) => data.set(type, text), getData: () => "" } });
    viewport.dispatchEvent(copy);
    expect(data.size).toBe(0);
    key("Delete");
    expect(written(engine.getDoc())).toEqual({ "0,0": "", "2,2": "" });
    // Fuori dal modo, una freccia ricomincia da un intervallo solo.
    key("ArrowLeft");
    expect(host.querySelector(".grid-selection")).toBeNull();
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
