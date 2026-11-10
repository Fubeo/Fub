// @vitest-environment happy-dom
// La griglia su una cartella di Excel: i gesti del puntatore.
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import { settle, workbookHost, workbookMounted } from "./test-support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("GridEngine con una cartella di Excel", () => {
  /// Una griglia larga abbastanza da mostrare il disegno di «Conti», che sta
  /// dalla colonna J in poi.
  describe("i gesti del puntatore", () => {
    const press = (target: EventTarget, type: string, x: number, y: number, extra: PointerEventInit = {}) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, ...extra }));
    /// Il punto dentro un elemento: con la griglia a 0,0 dello schermo e niente
    /// scorrimento, le coordinate della tela sono quelle dello schermo. Una
    /// cella sta nella sua riga.
    const inside = (element: HTMLElement) => {
      const row = element.parentElement?.classList.contains("grid-row") ? parseFloat(element.parentElement.style.top) : 0;
      // Più in là dei 4 px dove il bordo di un'intestazione si tira.
      return { x: parseFloat(element.style.left) + 8, y: row + parseFloat(element.style.top) + 8 };
    };
    const at = (cell: (row: number, column: number) => HTMLElement | null, row: number, column: number) => inside(cell(row, column)!);
    const handle = (host: HTMLElement) => host.querySelector<HTMLElement>(".grid-fill-handle");

    it("trascinando si seleziona un intervallo, anche quando la cattura manda i movimenti alla griglia", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost());
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      const end = at(cell, 3, 2);
      press(viewport, "pointermove", end.x, end.y);
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } });
      press(viewport, "pointerup", end.x, end.y);
      // Dopo il rilascio il puntatore non trascina più.
      const later = at(cell, 4, 4);
      press(viewport, "pointermove", later.x, later.y, { buttons: 0 });
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } });
      engine.destroy();
    });

    it("le intestazioni prendono la colonna o la riga intera, e l'angolo il foglio", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost());
      // La cella attiva (il fuoco) resta sulla prima riga o colonna.
      const column = at(cell, 0, 2);
      press(viewport, "pointerdown", column.x, 10);
      expect(engine.selection().focus).toEqual({ row: 0, column: 2 });
      expect(engine.selection().anchor.column).toBe(2);
      expect(engine.selection().anchor.row).toBeGreaterThan(3);
      const next = at(cell, 0, 4);
      press(viewport, "pointermove", next.x, 10);
      expect(engine.selection().focus).toEqual({ row: 0, column: 4 });
      expect(engine.selection().anchor.column).toBe(2);
      press(viewport, "pointerup", next.x, 10);

      const row = at(cell, 2, 0);
      press(viewport, "pointerdown", 10, row.y);
      expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
      expect(engine.selection().anchor.row).toBe(2);
      expect(engine.selection().anchor.column).toBeGreaterThan(4);
      press(viewport, "pointerup", 10, row.y);

      press(viewport, "pointerdown", 10, 10);
      expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
      expect(engine.selection().anchor.row).toBeGreaterThan(3);
      press(viewport, "pointerup", 10, 10);
      engine.destroy();
    });

    it("il tasto destro sceglie la cella fuori dalla selezione e lascia quella dentro, come Excel", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost());
      const pointing = vi.spyOn(document, "elementFromPoint");
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      const end = at(cell, 3, 2);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      // Dentro la selezione: resta com'è.
      const inner = at(cell, 2, 2);
      pointing.mockReturnValue(cell(2, 2));
      expect(engine.pointAt(inner.x, inner.y)).toBe("cell");
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } });
      // Fuori: la cella sola.
      const outer = at(cell, 4, 4);
      pointing.mockReturnValue(cell(4, 4));
      expect(engine.pointAt(outer.x, outer.y)).toBe("cell");
      expect(engine.selection()).toMatchObject({ anchor: { row: 4, column: 4 }, focus: { row: 4, column: 4 } });
      // L'intestazione di una riga: la riga intera.
      const row = at(cell, 2, 0);
      pointing.mockReturnValue(viewport);
      expect(engine.pointAt(10, row.y)).toBe("row");
      expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
      expect(engine.selection().anchor.row).toBe(2);
      // Fuori dalla griglia, niente.
      pointing.mockReturnValue(document.body);
      expect(engine.pointAt(1, 1)).toBeNull();
      pointing.mockRestore();
      engine.destroy();
    });

    it("il quadratino tirato riempie con `edit.autoFill`, e con Ctrl nel modo alternato", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell, go } = await workbookMounted(grid);
      go(1, 1);
      await settle();
      const grip = handle(host)!;
      expect(grip).not.toBeNull();
      expect(grip.getAttribute("aria-hidden")).toBe("true");
      const start = inside(grip);
      press(grip, "pointerdown", start.x, start.y);
      const end = at(cell, 4, 1);
      press(viewport, "pointermove", end.x, end.y);
      const preview = host.querySelector<HTMLElement>(".grid-fill-preview")!;
      expect(preview).not.toBeNull();
      expect(viewport.classList.contains("filling")).toBe(true);
      press(viewport, "pointerup", end.x, end.y);
      await settle();
      expect(grid.given.map((request) => request.command.id)).toEqual(["edit.autoFill"]);
      expect(JSON.parse(grid.given[0].command.params)).toEqual({ source: "B2", target: "B2:B5" });
      expect(viewport.classList.contains("filling")).toBe(false);
      // La cella attiva resta all'àncora, la sorgente.
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 4, column: 1 } });

      go(1, 2);
      await settle();
      const again = inside(handle(host)!);
      press(handle(host)!, "pointerdown", again.x, again.y);
      const side = at(cell, 1, 5);
      press(viewport, "pointermove", side.x, side.y);
      press(viewport, "pointerup", side.x, side.y, { ctrlKey: true });
      await settle();
      expect(JSON.parse(grid.given[1].command.params)).toEqual({ source: "C2", target: "C2:F2", mode: "alternate" });
      engine.destroy();
    });

    it("rilasciato dentro la sorgente, o annullato, il quadratino non riempie", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell, go } = await workbookMounted(grid);
      go(1, 1);
      await settle();
      const start = inside(handle(host)!);
      press(handle(host)!, "pointerdown", start.x, start.y);
      press(viewport, "pointerup", start.x, start.y);
      press(handle(host)!, "pointerdown", start.x, start.y);
      const end = at(cell, 4, 1);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointercancel", end.x, end.y);
      await settle();
      expect(grid.given).toEqual([]);
      expect(host.querySelector(".grid-fill-preview")).toBeNull();
      engine.destroy();
    });

    it("il doppio clic sul quadratino riempie in giù fin dove arriva la colonna accanto", async () => {
      const grid = workbookHost();
      const { engine, host, go } = await workbookMounted(grid);
      go(1, 1);
      await settle();
      handle(host)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await settle();
      expect(grid.given.map((request) => request.command.id)).toEqual(["edit.autoFill"]);
      const params = JSON.parse(grid.given[0].command.params);
      expect(params.source).toBe("B2");
      expect(params.target).toMatch(/^B2:B\d+$/);
      engine.destroy();
    });

    it("il bordo di un'intestazione si tira con la guida e dà un comando solo; il doppio clic adatta", async () => {
      const grid = workbookHost();
      const { engine, viewport, host } = await workbookMounted(grid);
      const header = [...host.querySelectorAll<HTMLElement>(".grid-column-header")].find((element) => element.textContent === "B")!;
      const edge = parseFloat(header.style.left) + parseFloat(header.style.width);
      const width = parseFloat(header.style.width);
      press(viewport, "pointermove", edge - 2, 10);
      expect(viewport.classList.contains("resize-column")).toBe(true);
      press(viewport, "pointerdown", edge - 2, 10);
      press(viewport, "pointermove", edge + 26, 10);
      expect(host.querySelector(".grid-resize-guide")).not.toBeNull();
      expect(host.querySelector(".grid-resize-label")?.textContent).toMatch(/\(\d+ px\)$/);
      // Il movimento non scrive: si scrive al rilascio, una volta.
      expect(grid.given).toEqual([]);
      press(viewport, "pointerup", edge + 26, 10);
      await settle();
      expect(host.querySelector(".grid-resize-guide")).toBeNull();
      expect(grid.given.map((request) => request.command.id)).toEqual(["home.columnWidth"]);
      expect(JSON.parse(grid.given[0].command.params)).toEqual({ cols: "B:B", width: Math.round((width + 28) / 1.4) });
      // La selezione non è cambiata.
      expect(engine.selection().focus).toEqual({ row: 0, column: 0 });

      viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: edge - 2, clientY: 10 }));
      await settle();
      expect(grid.given[grid.given.length - 1]?.command.id).toBe("home.autofitColumnWidth");
      expect(JSON.parse(grid.given[grid.given.length - 1].command.params)).toEqual({ cols: "B:B" });
      // In mezzo all'intestazione il puntatore torna quello di sempre.
      press(viewport, "pointermove", edge - width / 2, 10);
      expect(viewport.classList.contains("resize-column")).toBe(false);
      engine.destroy();
    });

    it("Ctrl+clic aggiunge un intervallo, i comandi li ricevono tutti, e un clic semplice ricomincia", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell } = await workbookMounted(grid);
      const first = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", first.x, first.y);
      press(viewport, "pointerup", first.x, first.y);
      // La colonna D della cartella è nascosta.
      const second = at(cell, 3, 2);
      press(cell(3, 2)!, "pointerdown", second.x, second.y, { ctrlKey: true });
      const corner = at(cell, 4, 4);
      press(viewport, "pointermove", corner.x, corner.y);
      press(viewport, "pointerup", corner.x, corner.y);
      expect(host.querySelectorAll(".grid-selection")).toHaveLength(2);
      expect(cell(1, 1)!.classList.contains("selected")).toBe(true);
      expect(cell(4, 4)!.classList.contains("selected")).toBe(true);
      expect(cell(2, 2)!.classList.contains("selected")).toBe(false);
      expect(engine.command("home.bold")).toBe(true);
      await settle();
      expect(grid.given[0].command.selection).toBe("B2,C4:E5");
      expect(grid.given[0].command.active).toBe("C4");
      // Il quadratino di riempimento non regge più intervalli.
      expect(handle(host)).toBeNull();

      const again = at(cell, 2, 2);
      press(cell(2, 2)!, "pointerdown", again.x, again.y);
      press(viewport, "pointerup", again.x, again.y);
      expect(host.querySelector(".grid-selection")).toBeNull();
      expect(cell(1, 1)!.classList.contains("selected")).toBe(false);
      engine.destroy();
    });

    it("il bordo della selezione si tira per spostarla, e con Ctrl la copia", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell } = await workbookMounted(grid);
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      const end = at(cell, 2, 2);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      // Sul bordo sinistro di B2 il puntatore prende la selezione.
      const edge = { x: start.x - 8, y: start.y };
      press(viewport, "pointermove", edge.x, edge.y, { buttons: 0 });
      expect(viewport.classList.contains("move-selection")).toBe(true);
      press(viewport, "pointermove", start.x + 4, start.y, { buttons: 0 });
      expect(viewport.classList.contains("move-selection")).toBe(false);

      press(viewport, "pointerdown", edge.x, edge.y);
      const drop = at(cell, 3, 0);
      press(viewport, "pointermove", drop.x, drop.y);
      expect(host.querySelector(".grid-move-preview")).not.toBeNull();
      // La selezione non cambia finché non si lascia.
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } });
      press(viewport, "pointerup", drop.x, drop.y);
      await settle();
      expect(host.querySelector(".grid-move-preview")).toBeNull();
      const moves = () => grid.given.filter((request) => request.command.id === "fub.pasteFrom");
      expect(moves()).toHaveLength(1);
      expect(JSON.parse(moves()[0].command.params)).toEqual({ source: "B2:C3", sourceSheet: "s1", move: true });
      expect(moves()[0].command.selection).toBe("A4:B5");

      // Con Ctrl al rilascio si copia.
      const again = at(cell, 3, 0);
      press(viewport, "pointerdown", again.x - 8, again.y);
      const copy = at(cell, 1, 1);
      press(viewport, "pointermove", copy.x, copy.y);
      press(viewport, "pointerup", copy.x, copy.y, { ctrlKey: true });
      await settle();
      expect(JSON.parse(moves()[1].command.params)).toEqual({ source: "A4:B5", sourceSheet: "s1", move: false });
      engine.destroy();
    });

    it("una formula aperta prende i riferimenti col puntatore e con le frecce, e li contorna", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell, go } = await workbookMounted(grid);
      go(3, 0);
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true }));
      const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "=1+" }, selection: { anchor: 3 } });
      const content = host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!;
      const key = (name: string, init: KeyboardEventInit = {}) =>
        content.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
      // Le frecce partono dalla cella aperta; con Maiuscolo allargano.
      key("ArrowUp");
      expect(editor.state.doc.toString()).toBe("=1+A3");
      key("ArrowUp", { shiftKey: true });
      expect(editor.state.doc.toString()).toBe("=1+A2:A3");
      // Un clic sostituisce il riferimento puntato, un trascinamento lo allarga.
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      expect(editor.state.doc.toString()).toBe("=1+B2");
      const end = at(cell, 2, 2);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      expect(editor.state.doc.toString()).toBe("=1+B2:C3");
      // La cella aperta resta quella, e anche la selezione.
      expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
      expect(engine.selection()).toMatchObject({ anchor: { row: 3, column: 0 }, focus: { row: 3, column: 0 } });
      // Dopo un operatore un clic aggiunge un riferimento, di un altro colore.
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: "*" }, selection: { anchor: editor.state.doc.length + 1 } });
      const other = at(cell, 0, 2);
      press(cell(0, 2)!, "pointerdown", other.x, other.y);
      press(viewport, "pointerup", other.x, other.y);
      expect(editor.state.doc.toString()).toBe("=1+B2:C3*C1");
      await settle();
      expect(host.querySelectorAll(".grid-formula-ref-1")).toHaveLength(1);
      expect(host.querySelectorAll(".grid-formula-ref-2")).toHaveLength(1);
      expect(content.querySelector(".cm-formula-ref-2")?.textContent).toBe("C1");
      // Un altro clic cambia ancora il riferimento appena puntato.
      const first = at(cell, 0, 0);
      press(cell(0, 0)!, "pointerdown", first.x, first.y);
      press(viewport, "pointerup", first.x, first.y);
      expect(editor.state.doc.toString()).toBe("=1+B2:C3*A1");
      key("Enter");
      await settle();
      expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
      expect(host.querySelector(".grid-formula-ref-1")).toBeNull();
      expect(grid.applied[0]?.patches[0]).toMatchObject({ cell: { sheet: "s1", row: "r3", column: "c0" }, after: "=1+B2:C3*A1" });
      engine.destroy();
    });

    it("senza `fub.pasteFrom` il bordo della selezione non si tira", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost({ drop: ["fub.pasteFrom"] }));
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      press(viewport, "pointerup", start.x, start.y);
      press(viewport, "pointermove", start.x - 8, start.y, { buttons: 0 });
      expect(viewport.classList.contains("move-selection")).toBe(false);
      engine.destroy();
    });

    it("senza il comando servito il bordo delle intestazioni non si tira", async () => {
      const grid = workbookHost({ drop: ["home.columnWidth"] });
      const { engine, viewport, host } = await workbookMounted(grid);
      const header = [...host.querySelectorAll<HTMLElement>(".grid-column-header")].find((element) => element.textContent === "B")!;
      const edge = parseFloat(header.style.left) + parseFloat(header.style.width);
      press(viewport, "pointermove", edge - 2, 10);
      expect(viewport.classList.contains("resize-column")).toBe(false);
      engine.destroy();
    });

    it("copia e incolla dentro la cartella passano da `fub.pasteFrom`, e un taglio si incolla una volta", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, go } = await workbookMounted(grid);
      const copied = new Map<string, string>();
      const send = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", {
          value: { getData: (kind: string) => copied.get(kind) ?? "", setData: (kind: string, text: string) => { copied.set(kind, text); } },
        });
        viewport.dispatchEvent(event);
      };
      const pastes = () => grid.given.filter((request) => request.command.id === "fub.pasteFrom");
      go(1, 1);
      send("copy");
      go(2, 2);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(1);
      expect(JSON.parse(pastes()[0].command.params)).toEqual({ source: "B2", sourceSheet: "s1", move: false });
      expect(pastes()[0].command.selection).toBe("C3");
      // Ciò che si è copiato si incolla ancora.
      go(3, 0);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(2);

      go(1, 1);
      send("cut");
      expect(host.querySelector(".grid-cut-mark")).not.toBeNull();
      go(3, 2);
      send("paste");
      await settle();
      expect(JSON.parse(pastes()[2].command.params)).toMatchObject({ source: "B2", move: true });
      expect(host.querySelector(".grid-cut-mark")).toBeNull();
      // Il taglio è andato: un altro incolla scrive il testo, senza spostare.
      go(2, 0);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(3);

      // Un testo che non è quello copiato viene da fuori.
      go(1, 1);
      send("copy");
      copied.set("text/plain", "altro");
      go(2, 2);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(3);
      engine.destroy();
    });

    it("senza `fub.pasteFrom` l'incolla scrive gli input", async () => {
      const grid = workbookHost({ drop: ["fub.pasteFrom"] });
      const { engine, viewport, go } = await workbookMounted(grid);
      const copied = new Map<string, string>();
      const send = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", {
          value: { getData: (kind: string) => copied.get(kind) ?? "", setData: (kind: string, text: string) => { copied.set(kind, text); } },
        });
        viewport.dispatchEvent(event);
      };
      go(1, 1);
      send("copy");
      go(2, 2);
      send("paste");
      await settle();
      expect(grid.given.some((request) => request.command.id === "fub.pasteFrom")).toBe(false);
      expect(grid.applied.flatMap((request) => request.patches).some((patch) => patch.cell.row === "r2" && patch.cell.column === "c2")).toBe(true);
      engine.destroy();
    });

    it("senza `edit.autoFill` nel catalogo non c'è il quadratino", async () => {
      const { engine, host, go } = await workbookMounted(workbookHost({ drop: ["edit.autoFill"] }));
      go(1, 1);
      await settle();
      expect(handle(host)).toBeNull();
      engine.destroy();
    });
  });
});
