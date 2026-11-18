// @vitest-environment happy-dom
// La griglia su una cartella di Excel: aprire, scrivere, i comandi e le celle.
import { afterEach, describe, expect, it } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import type { GridDialog } from "../../host/contract";
import { resolvedLanguage, t } from "../../i18n/strings";
import { HOVER_OPEN_DELAY_MS } from "../../kit";
import { gridJournalText, parseGridJournal } from "../../state/grid-journal";
import { DEFAULT_SHEET_VIEW, decimalSeparator, localInput } from "./workbook";
import xlsx from "../../__fixtures__/xlsx-grid.json";
import { frames, settle, shownMarks, typeInActiveCell, workbookHost, workbookMounted } from "./test-support";
import type { GridHost } from "./engine";

afterEach(() => {
  document.body.replaceChildren();
});

describe("GridEngine con una cartella di Excel", () => {
  const decimal = () => decimalSeparator(resolvedLanguage());

  it("apre la versione 2 sui byte del documento e mostra i valori del file", async () => {
    const grid = workbookHost();
    const { engine, host, cell, notice, formula, go } = await workbookMounted(grid);
    expect(grid.calls.slice(0, 3)).toEqual(["list", "open fub.grid.xlsx conti.xlsx ∅ base", "window s1 0 0"]);
    const surface = host.querySelector<HTMLElement>(".grid-surface")!;
    expect(surface.dataset.gridProfile).toBe("workbook");
    expect(surface.dataset.gridProtocol).toBe("v2");
    expect(surface.dataset.readOnly).not.toBe("true");
    expect(cell(0, 0)?.textContent).toBe("Voce");
    expect(cell(0, 0)?.style.fontWeight).toBe("700");
    expect(cell(0, 0)?.style.textAlign).toBe("center");
    expect(cell(1, 2)?.textContent).toBe("50.00%");
    expect(cell(3, 2)?.textContent).toBe("#DIV/0!");
    expect(cell(3, 1)?.style.getPropertyValue("--file-fill")).not.toBe("");
    // La colonna D e la riga 6 sono nascoste nel file.
    expect(cell(0, 3)).toBeNull();
    expect(cell(5, 5)).toBeNull();
    // L'area versata dalla matrice ha i valori del file, e non si scrive.
    expect(cell(4, 5)?.textContent).toBe("2");
    expect(cell(4, 5)?.getAttribute("aria-readonly")).toBe("true");
    expect(cell(1, 1)?.hasAttribute("aria-readonly")).toBe(false);
    expect(notice().hidden).toBe(false);
    expect(notice().getAttribute("role")).toBe("status");
    expect(notice().textContent).not.toBe("");
    // La barra mostra l'input da scrivere, nella lingua; la cella il valore.
    go(1, 2);
    expect(formula()).toBe(localInput("0.5", decimal()));
    go(2, 2);
    expect(formula()).toBe("=B3/B4");
    expect(engine.selectedText()).toEqual({ primary: "-15.00%", secondary: [] });
    engine.destroy();
    await settle();
    expect(grid.closed).toEqual(grid.opened);
  });

  it("scrive una cella nel giornale, lo pubblica subito e lo fa controllare al provider", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, cell, notice, go } = await workbookMounted(grid);
    go(1, 1);
    typeInActiveCell(host, viewport, "9");
    // `typeInActiveCell` scrive una battuta: la cella diventa `9`, poi `900`
    // con una seconda modifica. Il giornale va alla sessione all'invio.
    expect(changes).toHaveLength(1);
    expect(changes[0].origin).toBe("input");
    expect(engine.getDoc()).toBe(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c1", before: "800", after: "9" }], commands: [] }));
    expect(cell(1, 1)?.textContent).toBe("9");
    await settle();
    expect(grid.applied[0]).toEqual({
      revision: xlsx.session.revision,
      patches: [{ cell: { sheet: "s1", row: "r1", column: "c1" }, before: "800", after: "9" }],
    });

    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "900" } });
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    // La seconda modifica tiene il `before` dei byte: è la fixture del provider.
    expect(engine.getDoc()).toBe(xlsx.edit.commit.edit.inserted);
    expect(grid.applied[1]).toEqual({ ...xlsx.edit.request, revision: grid.applied[1].revision, patches: [{ ...xlsx.edit.request.patches[0], before: "9" }] });
    // Le formule che leggono B2 mostrano il valore del file, segnato.
    expect(cell(3, 1)?.classList.contains("stale")).toBe(true);
    expect(cell(3, 1)?.textContent).toBe("680");
    expect(notice().textContent).toContain(" ");

    // Annullare riporta i byte: il giornale si svuota. La cronologia è del
    // provider, che dà il giornale di ogni passo.
    expect(engine.undo()).toBe(true);
    await settle();
    expect(changes[changes.length - 1]?.origin).toBe("undo");
    expect(engine.getDoc()).toBe(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c1", before: "800", after: "9" }], commands: [] }));
    expect(engine.undo()).toBe(true);
    await settle();
    expect(engine.getDoc()).toBe("");
    expect(grid.journal()).toBe("");
    expect(cell(1, 1)?.textContent).toBe("800");
    expect(engine.redo()).toBe(true);
    await settle();
    expect(grid.journal()).toBe(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c1", before: "800", after: "9" }], commands: [] }));
    engine.destroy();
  });

  it("scrive i numeri col separatore della lingua, e il provider li tiene col punto", async () => {
    const grid = workbookHost();
    const { engine, viewport, changes, go } = await workbookMounted(grid);
    go(1, 1);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    const typed = decimal() === "," ? "1,5\tx" : "1.5\tx";
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => typed } });
    viewport.dispatchEvent(paste);
    expect(changes).toHaveLength(1);
    await settle();
    expect(grid.applied[0].patches.map((patch) => patch.after)).toEqual(["1.5", "x"]);
    engine.destroy();
  });

  it("non scrive le celle bloccate, e dice perché", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, notice, go, formula } = await workbookMounted(grid);
    go(4, 5);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    const locked = notice().textContent;
    expect(locked).not.toBe("");
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(formula()).toBe("");

    // La selezione che prende una cella bloccata non si svuota.
    go(3, 5);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(changes).toEqual([]);

    engine.setReadOnly(true);
    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    await settle();
    expect(grid.applied).toEqual([]);
    engine.destroy();
  });

  it("una formula dove la sessione non serve i comandi non si scrive, e lo dice", async () => {
    const grid = workbookHost({ serves: false });
    const { engine, host, viewport, changes, notice, go } = await workbookMounted(grid);
    go(1, 0);
    typeInActiveCell(host, viewport, "=B2*2");
    expect(notice().textContent).toContain(t("grid.workbook.formula"));
    expect(changes).toEqual([]);
    await settle();
    expect(grid.applied).toEqual([]);
    engine.destroy();
  });

  it("la prima formula porta la sessione ai comandi: il giornale lo scrive il provider", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, cell, go } = await workbookMounted(grid);
    go(1, 1);
    typeInActiveCell(host, viewport, "7");
    await settle();
    expect(parseGridJournal(engine.getDoc()).entries).toHaveLength(1);
    go(2, 1);
    typeInActiveCell(host, viewport, "=B2*2");
    // La griglia la mostra subito, ma il giornale aspetta il provider.
    expect(cell(2, 1)?.textContent).toBe("=B2*2");
    expect(parseGridJournal(engine.getDoc()).entries).toHaveLength(1);
    await settle();
    const journal = parseGridJournal(engine.getDoc());
    expect(journal.entries).toEqual([]);
    expect(journal.commands.map((command) => [command.id, command.selection])).toEqual([
      ["range.setValues", "B2"],
      ["range.setValues", "B3"],
    ]);
    expect(changes[changes.length - 1]?.text).toBe(grid.journal());

    // Annullare la formula torna al giornale di celle di prima.
    expect(engine.undo()).toBe(true);
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["edit.undo"]);
    expect(parseGridJournal(engine.getDoc())).toMatchObject({ commands: [], entries: [{ row: "r1", column: "c1", after: "7" }] });
    expect(engine.redo()).toBe(true);
    await settle();
    expect(parseGridJournal(engine.getDoc()).commands).toHaveLength(2);
    // Niente da ripetere non è un errore da dire.
    expect(engine.redo()).toBe(true);
    await settle();
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).not.toContain("nothing to redo");
    engine.destroy();
  });

  // IMP-027: il salvataggio mette il giornale di comandi nei byte, e la
  // sessione del provider che si riapre non ha più la sua history. Una
  // formula scritta (o cancellata) resta da annullare con l'input di prima.
  it("una formula scritta si annulla e si ripete anche dopo che il salvataggio l'ha messa nei byte (IMP-027)", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, cell, go } = await workbookMounted(grid, "", () => grid.base());
    const save = async () => {
      grid.save(engine.getDoc());
      // La sessione del documento, salvato, dà il giornale vuoto sui byte nuovi.
      engine.syncDoc("");
      await settle();
      await settle();
    };
    go(8, 6);
    typeInActiveCell(host, viewport, "=B2*2");
    await settle();
    expect(parseGridJournal(engine.getDoc()).commands.map((command) => command.selection)).toEqual(["G9"]);
    await save();
    expect(grid.disk("s1", "r8", "c6")).toBe("=B2*2");
    expect(engine.getDoc()).toBe("");

    expect(engine.undo()).toBe(true);
    await settle();
    await settle();
    expect(cell(8, 6)?.textContent ?? "").toBe("");
    await save();
    expect(grid.disk("s1", "r8", "c6")).toBe("");

    expect(engine.redo()).toBe(true);
    await settle();
    await settle();
    expect(cell(8, 6)?.textContent).toBe("=B2*2");
    await save();
    expect(grid.disk("s1", "r8", "c6")).toBe("=B2*2");
    engine.destroy();
  });

  it("Canc su una formula salvata si annulla: la formula torna nella cella e sul disco (IMP-027)", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, cell, go } = await workbookMounted(grid, "", () => grid.base());
    const save = async () => {
      grid.save(engine.getDoc());
      engine.syncDoc("");
      await settle();
      await settle();
    };
    go(8, 7);
    typeInActiveCell(host, viewport, "=B2+1");
    await settle();
    await save();
    go(8, 7);
    // Prima che il salvataggio arrivi: la cancellazione entra come comando.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await settle();
    expect(cell(8, 7)?.textContent ?? "").toBe("");
    await save();
    expect(grid.disk("s1", "r8", "c7")).toBe("");

    expect(engine.undo()).toBe(true);
    await settle();
    await settle();
    expect(cell(8, 7)?.textContent).toBe("=B2+1");
    await save();
    expect(grid.disk("s1", "r8", "c7")).toBe("=B2+1");
    // E il passo prima, la formula scritta, si annulla ancora.
    expect(engine.undo()).toBe(true);
    await settle();
    await settle();
    await save();
    expect(grid.disk("s1", "r8", "c7")).toBe("");
    engine.destroy();
  });

  it("annulla e ripeti vanno al provider, prima e dopo il salvataggio (IMP-027)", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, cell, go } = await workbookMounted(grid, "", () => grid.base());
    go(8, 6);
    typeInActiveCell(host, viewport, "=B2*2");
    await settle();
    go(9, 6);
    typeInActiveCell(host, viewport, "=B2*3");
    await settle();
    expect(engine.undo()).toBe(true);
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["edit.undo"]);
    expect(cell(9, 6)?.textContent ?? "").toBe("");
    // Salvato, il primo passo si annulla con l'input di prima, e quello
    // annullato si ripete con il suo.
    grid.save(engine.getDoc());
    engine.syncDoc("");
    await settle();
    await settle();
    expect(engine.undo()).toBe(true);
    await settle();
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["edit.undo", "edit.undo"]);
    expect(cell(8, 6)?.textContent ?? "").toBe("");
    expect(engine.redo()).toBe(true);
    await settle();
    await settle();
    expect(engine.redo()).toBe(true);
    await settle();
    await settle();
    expect(cell(8, 6)?.textContent).toBe("=B2*2");
    expect(cell(9, 6)?.textContent).toBe("=B2*3");
    engine.destroy();
  });

  it("un comando del catalogo va al provider sulla selezione, e la griglia adotta l'esito", async () => {
    const grid = workbookHost({ dialog: (command) => command.id === "home.formatCells" ? { id: "formatCells", params: "{}" } : null });
    const dialogs: GridDialog[] = [];
    let catalogs = 0;
    const { engine, viewport, changes, go } = await workbookMounted(grid, "", undefined, {
      onCommands: () => { catalogs += 1; },
      onDialog: (dialog) => dialogs.push(dialog),
    });
    expect(engine.commands().some((command) => command.id === "home.bold")).toBe(true);
    const before = catalogs;
    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    await settle();
    expect(catalogs).toBeGreaterThan(before);
    expect(engine.command("home.bold")).toBe(true);
    await settle();
    expect(grid.given[0]?.command).toMatchObject({ id: "home.bold", params: "{}", sheet: "s1", selection: "B2:B3", active: "B2" });
    expect(parseGridJournal(changes[changes.length - 1]!.text).commands.map((command) => command.id)).toEqual(["home.bold"]);
    expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 1 } });

    expect(engine.command("home.formatCells")).toBe(true);
    await settle();
    expect(dialogs).toEqual([{ id: "formatCells", params: "{}" }]);
    // Un comando che il catalogo non serve non parte.
    expect(engine.command("non.esiste")).toBe(false);
    engine.setReadOnly(true);
    expect(engine.command("home.bold")).toBe(false);
    engine.destroy();
  });

  it("le scorciatoie di Excel danno i comandi del catalogo", async () => {
    const grid = workbookHost();
    const { engine, viewport, go } = await workbookMounted(grid);
    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "%", code: "Digit5", ctrlKey: true, shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "=", code: "Equal", altKey: true, bubbles: true }));
    // Ctrl+«-» su una cella sola chiede come, in Excel: qui non fa niente.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", code: "Minus", ctrlKey: true, bubbles: true }));
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["home.bold", "home.percent", "formulas.autoSum"]);
    engine.destroy();
  });

  it("disegna un'unione come una cella sola, e la selezione e il cursore la prendono tutta", async () => {
    const grid = workbookHost();
    const { engine, viewport, cell, go } = await workbookMounted(grid);
    const merged = cell(0, 6)!;
    expect(merged.classList.contains("merged")).toBe(true);
    expect(merged.getAttribute("aria-colspan")).toBe("2");
    expect(merged.getAttribute("aria-rowspan")).toBe("1");
    expect(cell(0, 7)).toBeNull();
    expect(merged.style.width).toBe(`${Number.parseFloat(cell(0, 5)!.style.width) * 2}px`);

    go(0, 6);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 0, column: 8 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 0, column: 6 });
    go(1, 5);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    // L'intervallo F1:G2 tocca G1:H1, e la prende tutta.
    expect(cell(1, 7)!.classList.contains("selected")).toBe(true);
    expect(cell(0, 6)!.classList.contains("selected")).toBe(true);
    engine.destroy();
  });

  it("blocca i riquadri, nasconde griglia e intestazioni e ingrandisce come dice la vista del foglio", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        window.view = { ...DEFAULT_SHEET_VIEW, frozen_rows: 1, frozen_columns: 1, gridlines: false, headings: false, zoom: 150 };
      },
    });
    const { engine, host, viewport, cell } = await workbookMounted(grid);
    const canvas = host.querySelector<HTMLElement>(".grid-plane")!;
    expect(canvas.style.fontSize).toBe("150.0%");
    expect(viewport.classList.contains("no-gridlines")).toBe(true);
    expect(host.querySelector(".grid-row-header")).toBeNull();
    expect(host.querySelector(".grid-column-header")).toBeNull();
    // I fili del blocco: fermi, nei livelli della testa, della colonna ferma
    // e dell'angolo.
    expect(shownMarks(host, "freeze").map((line) => `${line.parentElement!.className} ${line.dataset.mark}`).sort()).toEqual([
      "grid-marks-corner freeze-columns",
      "grid-marks-corner freeze-rows",
      "grid-marks-left freeze-columns",
      "grid-marks-top freeze-rows",
    ]);
    expect(cell(1, 0)!.classList.contains("frozen")).toBe(true);
    expect(cell(1, 1)!.classList.contains("frozen")).toBe(false);
    // Lo zoom allarga le colonne nella stessa misura.
    expect(Number.parseFloat(cell(1, 1)!.style.width)).toBeGreaterThan(100);

    // Scorrendo, la prima riga e la prima colonna restano.
    viewport.scrollTop = 1500;
    viewport.scrollLeft = 1500;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    expect(cell(0, 0)).not.toBeNull();
    expect(cell(0, 1)).toBeNull();
    expect(cell(1, 0)).toBeNull();
    engine.destroy();
  });

  // IMP-028: una formula su un riferimento circolare dice `#CIRC!`, e la
  // riga degli avvisi spiega che cosa vuol dire.
  it("una cella con #CIRC! porta l'avviso del riferimento circolare", async () => {
    const plain = await workbookMounted(workbookHost());
    expect(plain.host.querySelector<HTMLElement>(".grid-notice")?.textContent ?? "").not.toContain(t("grid.workbook.circular"));
    plain.engine.destroy();
    document.body.replaceChildren();
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        const affitto = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c0")!;
        affitto.input = "=A2+1";
        affitto.value = { kind: "error", value: "#CIRC!" };
        affitto.display = "#CIRC!";
      },
    });
    const { engine, host, cell } = await workbookMounted(grid);
    expect(cell(1, 0)?.textContent).toBe("#CIRC!");
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).toContain(t("grid.workbook.circular"));
    engine.destroy();
  });

  it("il piano a strati: le fasce ferme stanno ferme da sé, e i segni si tagliano per zona", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        window.view = { ...DEFAULT_SHEET_VIEW, frozen_rows: 1, frozen_columns: 1 };
      },
    });
    const { engine, host, viewport, cell } = await workbookMounted(grid);
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    const style = (element: Element | null) => {
      const s = (element as HTMLElement).style;
      return { position: s.position, left: s.left, top: s.top, width: s.width, height: s.height };
    };
    const scrollTo = async (left: number, top: number) => {
      viewport.scrollLeft = left;
      viewport.scrollTop = top;
      viewport.dispatchEvent(new Event("scroll"));
      await settle();
    };
    // La riga bloccata sta nella testa, le altre nel corpo; ognuna nel suo
    // gruppo di righe.
    expect(cell(0, 1)!.closest(".grid-row")!.parentElement!.className).toBe("grid-head");
    expect(cell(2, 1)!.closest(".grid-row")!.parentElement!.className).toBe("grid-rows");
    // Una cella della colonna bloccata, l'intestazione della sua riga e
    // quella della colonna stanno ferme a sinistra con `sticky`.
    expect(cell(6, 0)!.style.position).toBe("sticky");
    expect(cell(2, 1)!.style.position).toBe("absolute");
    const header = () => host.querySelector(".grid-row[data-row='6'] .grid-row-header");
    const before = {
      frozen: style(cell(6, 0)),
      corner: style(cell(0, 0)),
      header: style(header()),
      lines: shownMarks(host, "freeze").map(style),
    };
    // Scorrendo, niente di tutto questo si sposta per mano dello script.
    await scrollTo(260, 40);
    expect(style(cell(6, 0))).toEqual(before.frozen);
    expect(style(cell(0, 0))).toEqual(before.corner);
    expect(style(header())).toEqual(before.header);
    expect(shownMarks(host, "freeze").map(style)).toEqual(before.lines);
    await scrollTo(0, 0);

    // A1:C3 passa la riga e la colonna bloccate: un pezzo per zona, ognuno
    // nel livello della sua zona.
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    const rect = () => shownMarks(host, "edge").filter((mark) => mark.dataset.mark!.startsWith("rect-"));
    const layers = () => [...new Set(rect().map((mark) => mark.parentElement!.className))].sort();
    expect(layers()).toEqual(["grid-marks-body", "grid-marks-corner", "grid-marks-left", "grid-marks-top"]);
    const pieces = () => rect().map(style);
    const drawn = pieces();
    await scrollTo(0, 140);
    expect(pieces()).toEqual(drawn);

    // Il quadratino è un pezzo solo, intero, nel livello «lift» della zona
    // del suo angolo: per A3, sul filo della colonna bloccata, la colonna.
    key("Escape");
    await scrollTo(0, 0);
    key("ArrowDown");
    key("ArrowDown");
    await frames(40);
    const handles = shownMarks(host, "handle");
    expect(handles).toHaveLength(1);
    expect(handles[0]!.parentElement!.className).toBe("grid-lift-left");
    expect([handles[0]!.style.width, handles[0]!.style.height]).toEqual(["8px", "8px"]);
    // Su B1, sul filo della riga bloccata, la testa.
    key("ArrowUp");
    key("ArrowUp");
    key("ArrowRight");
    await frames(40);
    expect(shownMarks(host, "handle").map((mark) => mark.parentElement!.className)).toEqual(["grid-lift-top"]);
    engine.destroy();
  });

  it("disegna lo stile, i bordi, le barre, le icone e i commenti delle celle", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        const style = window.styles.length;
        window.styles = [...window.styles, {
          ...window.styles[1]!,
          font: "Cambria",
          font_size: 22,
          underline: "double",
          strike: true,
          vertical: "top",
          wrap: true,
          borders: {
            top: { style: "thick", color: "#112233" },
            right: null,
            bottom: { style: "dashed", color: null },
            left: null,
            diagonal_down: { style: "thin", color: "#445566" },
            diagonal_up: null,
          },
        }];
        const affitto = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c0")!;
        Object.assign(affitto, {
          style,
          comment: { author: "Ada", text: "Da rivedere", threaded: true, resolved: false, replies: [{ author: "Bea", text: "Fatto" }] },
        });
        const importo = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c1")!;
        Object.assign(importo, { data_bar: { fraction: 0.5, color: "#638EC6", gradient: false }, icon: { set: "3Arrows", index: 2 } });
        const spesa = window.cells.find((cell) => cell.key.row === "r2" && cell.key.column === "c1")!;
        spesa.link = { target: "https://example.org", tooltip: null, external: true };
      },
    });
    const { engine, host, cell } = await workbookMounted(grid);
    const affitto = cell(1, 0)!;
    expect(affitto.style.fontFamily).toContain("Cambria");
    expect(affitto.style.fontSize).toBe("2em");
    expect(affitto.style.alignContent).toBe("start");
    expect(affitto.style.whiteSpace).toBe("pre-wrap");
    const text = affitto.querySelector<HTMLElement>(".grid-cell-text")!;
    expect(text.style.textDecorationLine).toBe("underline line-through");
    expect(text.style.textDecorationStyle).toBe("double");
    expect(affitto.querySelector(".grid-comment-mark.threaded")).not.toBeNull();
    // Il thread non sta più nel `title`: lo dice la cella a chi non vede, e lo
    // mostra la scheda al passaggio.
    expect(affitto.title).toBe("");
    expect(affitto.dataset.comment).toBe("thread");
    expect(affitto.getAttribute("aria-description")).toBe("Commento: Ada: Da rivedere. Bea: Fatto");
    const border = [...host.querySelectorAll<HTMLElement>(".grid-border")]
      .find((element) => element.style.borderTop.includes("#112233") || element.style.borderTop.includes("rgb(17, 34, 51)"))!;
    expect(border).toBeDefined();
    expect(border.style.borderBottom).toContain("dashed");
    expect(border.style.backgroundImage).toContain("linear-gradient");

    const importo = cell(1, 1)!;
    const bar = importo.querySelector<HTMLElement>(".grid-data-bar")!;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.style.background.toLowerCase()).toMatch(/#638ec6|rgb\(99, 142, 198\)/u);
    expect(importo.querySelector<HTMLElement>(".grid-icon")!.textContent).toBe("⬆");
    // Un numero senza allineamento del file va a destra.
    expect(cell(2, 1)!.style.textAlign).toBe("end");
    expect(cell(2, 1)!.title).toBe("https://example.org");
    engine.destroy();
  });

  it("mostra il thread di un commento al passaggio, e i suoi gesti valgono per quella cella", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        const affitto = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c0")!;
        affitto.comment = { author: "Ada", text: "Da rivedere", threaded: true, resolved: false, replies: [{ author: "Bea", text: "Fatto" }] };
        const nota = window.cells.find((cell) => cell.key.row === "r2" && cell.key.column === "c0")!;
        nota.comment = { author: "", text: "Promemoria", threaded: false, resolved: false, replies: [] };
      },
    });
    const opened: string[] = [];
    const { engine, cell, go } = await workbookMounted(grid, "", undefined, { onDialog: (dialog) => opened.push(dialog.id) });
    go(2, 1);
    const hover = async (target: HTMLElement) => {
      target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      await new Promise((resolve) => setTimeout(resolve, HOVER_OPEN_DELAY_MS + 30));
      await settle();
      return document.body.querySelector<HTMLElement>(".grid-comment-card");
    };
    const card = (await hover(cell(1, 0)!))!;
    expect(card).not.toBeNull();
    expect(card.closest("[role=region]")?.getAttribute("aria-label")).toBe("Commento in A2");
    expect([...card.querySelectorAll(".grid-comment-post")].map((post) => post.textContent)).toEqual(["AdaDa rivedere", "BeaFatto"]);
    const field = card.querySelector<HTMLTextAreaElement>(".grid-comment-field")!;
    expect(document.body.querySelector(`label[for="${field.id}"]`)?.textContent).toBe(t("grid.comment.reply_field"));
    field.value = "Ricontrollato";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    // La risposta va alla cella indicata, non alla cella attiva (B3).
    const reply = grid.given.find((request) => request.command.id === "review.replyComment")!;
    expect(JSON.parse(reply.command.params)).toEqual({ cell: "A2", text: "Ricontrollato" });
    expect(reply.command.active).toBe("B3");
    expect(document.body.querySelector(".grid-comment-card")).toBeNull();

    const resolve = (await hover(cell(1, 0)!))!;
    const labels = [...resolve.querySelectorAll<HTMLButtonElement>(".grid-comment-action")].map((button) => button.textContent);
    expect(labels).toEqual([t("grid.comment.reply"), t("grid.comment.resolve"), t("grid.comment.edit"), t("grid.comment.delete")]);
    [...resolve.querySelectorAll<HTMLButtonElement>(".grid-comment-action")].find((button) => button.textContent === t("grid.comment.resolve"))!.click();
    await settle();
    const resolved = grid.given.find((request) => request.command.id === "review.resolveComment")!;
    expect(JSON.parse(resolved.command.params)).toEqual({ cell: "A2", resolved: true });

    // La nota: niente risposta, e Modifica seleziona la cella e apre la sua finestra.
    const note = (await hover(cell(2, 0)!))!;
    expect(note.querySelector(".grid-comment-field")).toBeNull();
    expect(note.closest("[role=region]")?.getAttribute("aria-label")).toBe("Nota in A3");
    [...note.querySelectorAll<HTMLButtonElement>(".grid-comment-action")].find((button) => button.textContent === t("grid.comment.edit"))!.click();
    await settle();
    expect(opened).toEqual(["note"]);
    expect(engine.selectionRefs().active).toBe("A3");
    engine.destroy();
    expect(document.body.querySelector(".grid-comment-card")).toBeNull();
  });

  it("in sola lettura la scheda mostra soltanto il thread", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        const affitto = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c0")!;
        affitto.comment = { author: "Ada", text: "Da rivedere", threaded: true, resolved: true, replies: [] };
      },
    });
    const { engine, cell } = await workbookMounted(grid);
    engine.setReadOnly(true);
    await settle();
    expect(cell(1, 0)!.getAttribute("aria-description")).toBe("Commento risolto: Ada: Da rivedere");
    expect(cell(1, 0)!.querySelector(".grid-comment-mark.resolved")).not.toBeNull();
    cell(1, 0)!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, HOVER_OPEN_DELAY_MS + 30));
    await settle();
    const card = document.body.querySelector<HTMLElement>(".grid-comment-card")!;
    expect(card.querySelector(".grid-comment-resolved")?.textContent).toBe(t("grid.comment.resolved"));
    expect(card.querySelector(".grid-comment-field, .grid-comment-action")).toBeNull();
    engine.destroy();
  });

  it("un testo lungo passa nelle celle vuote accanto, fino alla prima piena", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        window.cells.push(
          { ...structuredClone(window.cells[4]!), key: { sheet: "s1", row: "r7", column: "c0" }, input: "Un testo lungo che non sta", display: "Un testo lungo che non sta", value: { kind: "text", value: "Un testo lungo che non sta" } },
          { ...structuredClone(window.cells[4]!), key: { sheet: "s1", row: "r7", column: "c3" }, input: "Fine", display: "Fine", value: { kind: "text", value: "Fine" } },
          { ...structuredClone(window.cells[4]!), key: { sheet: "s1", row: "r8", column: "c0" }, style: window.styles.length, input: "A capo", display: "A capo", value: { kind: "text", value: "A capo" } },
        );
        window.styles = [...window.styles, { ...window.styles[1]!, wrap: true }];
      },
    });
    const { engine, cell } = await workbookMounted(grid);
    const long = cell(7, 0)!;
    const width = Number.parseFloat(long.style.width);
    expect(long.classList.contains("spill")).toBe(true);
    const reach = Number.parseFloat(cell(1, 1)!.style.width) + Number.parseFloat(cell(1, 2)!.style.width);
    expect(long.querySelector<HTMLElement>(".grid-cell-text")!.style.maxWidth).toBe(`calc(${width + reach}px - 0.9rem)`);
    expect(cell(8, 0)!.classList.contains("spill")).toBe(false);
    engine.destroy();
  });

  it("una modifica che il provider rifiuta esce dal giornale, e lo dice", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, cell, notice, go } = await workbookMounted(grid);
    grid.failApply({ kind: "bad_args", message: "grid cell text is too long" });
    go(1, 1);
    typeInActiveCell(host, viewport, "7");
    expect(engine.getDoc()).not.toBe("");
    await settle();
    expect(engine.getDoc()).toBe("");
    expect(changes[changes.length - 1]?.text).toBe("");
    expect(notice().textContent).toContain("grid cell text is too long");
    expect(cell(1, 1)?.textContent).toBe("800");
    // Niente da annullare: il provider lo sa, e non è un errore da dire.
    engine.undo();
    await settle();
    expect(engine.getDoc()).toBe("");
    expect(notice().textContent).not.toContain("nothing to undo");
    engine.destroy();
  });

  it("una cella che il provider dice bloccata lo dice come un blocco", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, notice, go } = await workbookMounted(grid);
    grid.failApply({ kind: "permission_denied", message: "grid cell is locked (merged)" });
    go(1, 1);
    typeInActiveCell(host, viewport, "7");
    await settle();
    expect(engine.getDoc()).toBe("");
    expect(notice().textContent).toContain(t("grid.workbook.locked", { reason: t("grid.workbook.lock.other") }));
    engine.destroy();
  });

  it("le modifiche in coda partono una dopo l'altra, e l'ultima conferma corregge il giornale", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, go } = await workbookMounted(grid);
    grid.hold(true);
    go(1, 1);
    typeInActiveCell(host, viewport, "1");
    go(2, 1);
    typeInActiveCell(host, viewport, "2");
    await settle();
    expect(grid.applied).toHaveLength(1);
    grid.release();
    await settle();
    expect(grid.applied).toHaveLength(2);
    grid.release();
    await settle();
    // Il provider tiene lo stesso giornale: niente da ripubblicare.
    expect(changes).toHaveLength(2);
    expect(grid.journal()).toBe(engine.getDoc());
    expect(parseGridJournal(engine.getDoc()).entries.map((entry) => entry.after)).toEqual(["1", "2"]);
    engine.destroy();
  });

  it("si riapre sui byte nuovi dopo un salvataggio, e chiude la sessione di prima", async () => {
    let base = xlsx.document_revision;
    const grid = workbookHost({ base: () => base });
    const { engine, host, viewport, cell, go } = await workbookMounted(grid, "", () => base);
    go(1, 1);
    typeInActiveCell(host, viewport, "5");
    await settle();
    // La sessione ha salvato: il giornale torna vuoto sui byte nuovi.
    base = "sha256:salvata";
    engine.syncDoc("");
    await settle();
    expect(grid.calls.filter((call) => call.startsWith("open"))).toEqual([
      "open fub.grid.xlsx conti.xlsx ∅ base",
      "open fub.grid.xlsx conti.xlsx ∅ sha256:salvata",
    ]);
    expect(grid.closed).toEqual([grid.opened[0]]);
    expect(engine.getDoc()).toBe("");
    // Lo stesso testo sugli stessi byte non riapre niente.
    engine.syncDoc("");
    await settle();
    expect(grid.opened).toHaveLength(2);
    expect(cell(0, 0)?.textContent).toBe("Voce");
    engine.destroy();
  });

  it("un file cambiato sotto non si apre, e la griglia non scrive", async () => {
    const grid = workbookHost({ base: () => "sha256:altra" });
    const { engine, host, viewport, changes, notice } = await workbookMounted(grid);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    expect(notice().hidden).toBe(false);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toEqual([]);
    engine.destroy();
  });

  it("senza il componente della cartella lo dice", async () => {
    const { engine, host, notice } = await workbookMounted(null);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    expect(notice().hidden).toBe(false);
    engine.destroy();
  });

  it("segna le celle che il file ha cambiato sotto il giornale", async () => {
    const grid = workbookHost();
    const { engine, cell, notice } = await workbookMounted(grid, xlsx.conflict.journal);
    expect(cell(1, 1)?.classList.contains("conflict")).toBe(true);
    expect(cell(1, 1)?.getAttribute("aria-invalid")).toBe("true");
    expect(cell(1, 1)?.textContent).toBe("900");
    expect(notice().textContent).not.toBe("");
    engine.destroy();
  });

  it("passa da un foglio all'altro con le schede, e le toglie al teardown", async () => {
    const grid = workbookHost();
    const { engine, host, cell, selections } = await workbookMounted(grid);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>(".grid-sheets [role=tab]")];
    // Il foglio nascosto non ha una scheda.
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Conti", "Note"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    tabs[1].click();
    await settle();
    expect(grid.calls).toContain("window s2 0 0");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(cell(0, 0)?.textContent).toBe("Una nota");
    expect(selections()).toBe(1);
    engine.destroy();
    expect(host.querySelector(".grid-sheets")).toBeNull();
  });

  it("Inserisci foglio rende attivo il foglio nuovo, che la cartella non conosceva ancora (IMP-033)", async () => {
    const grid = workbookHost();
    const added = { id: "s4", name: "Sheet1", row_count: 100, column_count: 26 };
    const host: GridHost = {
      ...grid.host,
      // Come il provider: il foglio entra dopo l'attivo e diventa attivo.
      gridBytesCommand: async (surface, instance, request) => {
        const outcome = await grid.host.gridBytesCommand(surface, instance, request);
        if (request.command.id !== "home.insertSheet") return outcome;
        const sheets = [...outcome.sheets];
        sheets.splice(1, 0, added);
        return { ...outcome, sheets, selection: { sheet: added.id, selection: "A1", active: "A1" } };
      },
      gridBytesWindow: async (surface, instance, request) => {
        if (request.sheet !== added.id) return grid.host.gridBytesWindow(surface, instance, request);
        const window = await grid.host.gridBytesWindow(surface, instance, { ...request, sheet: "s2" });
        return { ...window, sheet: added.id, cells: [] };
      },
    };
    const { engine, host: root, cell } = await workbookMounted({ ...grid, host });
    expect(engine.command("home.insertSheet")).toBe(true);
    await settle();
    await settle();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>(".grid-sheets [role=tab]")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Conti", "Sheet1", "Note"]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(engine.selectionRefs()).toEqual({ sheet: "Sheet1", range: "A1", active: "A1" });
    expect(cell(0, 0)?.textContent).toBe("");
    engine.destroy();
  });
});
