// @vitest-environment happy-dom
// La griglia su una cartella di Excel: i gesti del puntatore.
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import { settle, shownRanges, workbookHost, workbookMounted } from "./test-support";

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
    const handle = (host: HTMLElement) => host.querySelector<HTMLElement>(".grid-mark-handle:not([hidden])");

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

    it("al rilascio la selezione finisce sulla cella sotto il puntatore, anche se la griglia si è spostata sotto il punto fermo", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost());
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      const end = at(cell, 3, 2);
      press(viewport, "pointermove", end.x, end.y);
      expect(engine.selection().focus).toEqual({ row: 3, column: 2 });
      // Ciò che sta sopra la griglia cresce di una riga: senza scorrere, sotto
      // il punto fermo passa la riga di prima.
      const shift = end.y - at(cell, 2, 2).y;
      const box = viewport.getBoundingClientRect();
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(box.x, box.y + shift, box.width, box.height));
      press(viewport, "pointerup", end.x, end.y);
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } });
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
      const grip = inside(handle(host)!);
      handle(host)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: grip.x, clientY: grip.y }));
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
      expect(shownRanges(host)).toBe(2);
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
      expect(shownRanges(host)).toBe(1);
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

  describe("il dito", () => {
    const finger = (target: EventTarget, type: string, x: number, y: number, pointerId = 7) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: "touch", button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1, clientX: x, clientY: y }));
    const inside = (element: HTMLElement) => {
      const row = element.parentElement?.classList.contains("grid-row") ? parseFloat(element.parentElement.style.top) : 0;
      return { x: parseFloat(element.style.left) + 8, y: row + parseFloat(element.style.top) + 8 };
    };
    const tap = (target: EventTarget, viewport: HTMLElement, point: { x: number; y: number }) => {
      finger(target, "pointerdown", point.x, point.y);
      finger(viewport, "pointerup", point.x, point.y);
    };
    const grips = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".grid-mark-touch:not([hidden])")];

    it("trascinare scorre e basta: niente intervallo, la cella attiva resta", async () => {
      const { engine, viewport, cell, go } = await workbookMounted(workbookHost());
      go(1, 1);
      const before = engine.selection();
      const start = inside(cell(2, 2)!);
      const down = finger(cell(2, 2)!, "pointerdown", start.x, start.y);
      // Il browser deve poter scorrere: il dito giù non ferma niente.
      expect(down).toBe(true);
      finger(viewport, "pointermove", start.x, start.y + 40);
      // Il browser si prende il dito per scorrere.
      finger(viewport, "pointercancel", start.x, start.y + 40);
      expect(engine.selection()).toEqual(before);
      // Anche se arriva un `pointerup` dopo uno spostamento oltre `TAP_MOVE`.
      finger(cell(2, 2)!, "pointerdown", start.x, start.y);
      finger(viewport, "pointermove", start.x + 20, start.y);
      finger(viewport, "pointerup", start.x + 20, start.y);
      expect(engine.selection()).toEqual(before);
      engine.destroy();
    });

    it("un tocco sceglie la cella, uno sull'intestazione la colonna, e il quadratino sparisce", async () => {
      const { engine, viewport, cell, host } = await workbookMounted(workbookHost());
      const point = inside(cell(3, 2)!);
      tap(cell(3, 2)!, viewport, point);
      expect(engine.selection()).toMatchObject({ anchor: { row: 3, column: 2 }, focus: { row: 3, column: 2 } });
      await settle();
      expect(host.querySelector(".grid-mark-handle:not([hidden])")).toBeNull();
      tap(viewport, viewport, { x: point.x, y: 10 });
      expect(engine.selection().focus).toEqual({ row: 0, column: 2 });
      expect(engine.selection().anchor.row).toBeGreaterThan(3);
      engine.destroy();
    });

    it("due tocchi sulla stessa cella la aprono; il doppio clic del browser non la riapre", async () => {
      const { engine, viewport, cell, host } = await workbookMounted(workbookHost());
      const point = inside(cell(1, 1)!);
      tap(cell(1, 1)!, viewport, point);
      expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
      tap(cell(1, 1)!, viewport, point);
      expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
      engine.destroy();
    });

    it("due tocchi su celle diverse non aprono niente", async () => {
      const { engine, viewport, cell, host } = await workbookMounted(workbookHost());
      tap(cell(1, 1)!, viewport, inside(cell(1, 1)!));
      tap(cell(2, 1)!, viewport, inside(cell(2, 1)!));
      expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
      expect(engine.selection().focus).toEqual({ row: 2, column: 1 });
      engine.destroy();
    });

    it("il tocco lungo mette due maniglie; tirata una, la selezione si allarga; un tocco altrove le toglie", async () => {
      const { engine, viewport, cell, host } = await workbookMounted(workbookHost());
      // I punti prima dell'orologio finto: i disegni aspettano un fotogramma.
      const point = inside(cell(2, 2)!);
      const pressed = cell(2, 2)!;
      const target = inside(cell(4, 4)!);
      const back = inside(cell(1, 1)!);
      const away = cell(6, 1)!;
      const awayPoint = inside(away);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        finger(pressed, "pointerdown", point.x, point.y);
        vi.advanceTimersByTime(449);
        expect(grips(host)).toHaveLength(0);
        vi.advanceTimersByTime(1);
        // Il menu del sistema e quello dell'editor non si aprono.
        const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y });
        viewport.dispatchEvent(menu);
        expect(menu.defaultPrevented).toBe(true);
        finger(viewport, "pointerup", point.x, point.y);
        expect(engine.selection()).toMatchObject({ anchor: { row: 2, column: 2 }, focus: { row: 2, column: 2 } });
        const shown = grips(host);
        expect(shown.map((grip) => grip.dataset.handle).sort()).toEqual(["a", "b"]);
        expect(shown.every((grip) => grip.getAttribute("aria-hidden") === "true")).toBe(true);
        // La maniglia di fine si prende al centro, sull'angolo dei fili.
        const end = shown.find((grip) => grip.dataset.handle === "b")!;
        const corner = { x: parseFloat(end.style.left) + 7, y: parseFloat(end.style.top) + 7 };
        const touch = new Event("touchstart", { bubbles: true, cancelable: true });
        Object.defineProperty(touch, "touches", { value: [{ clientX: corner.x, clientY: corner.y }] });
        viewport.dispatchEvent(touch);
        // Un dito sulla presa non fa scorrere il foglio.
        expect(touch.defaultPrevented).toBe(true);
        finger(viewport, "pointerdown", corner.x, corner.y);
        finger(viewport, "pointermove", target.x, target.y);
        finger(viewport, "pointerup", target.x, target.y);
        expect(engine.selection()).toMatchObject({ anchor: { row: 2, column: 2 }, focus: { row: 4, column: 4 } });
        // La maniglia d'inizio tirata indietro: l'angolo di fine resta.
        await vi.advanceTimersByTimeAsync(0);
        const start = grips(host).find((grip) => grip.dataset.handle === "a")!;
        finger(viewport, "pointerdown", parseFloat(start.style.left) + 7, parseFloat(start.style.top) + 7);
        finger(viewport, "pointermove", back.x, back.y);
        finger(viewport, "pointerup", back.x, back.y);
        expect(engine.selection()).toMatchObject({ anchor: { row: 4, column: 4 }, focus: { row: 1, column: 1 } });
        // La cella attiva resta dentro.
        expect(engine.selection().active ?? engine.selection().anchor).toEqual({ row: 2, column: 2 });
        // Due dita (lo zoom del sistema) passano.
        const two = new Event("touchstart", { bubbles: true, cancelable: true });
        Object.defineProperty(two, "touches", { value: [{ clientX: corner.x, clientY: corner.y }, { clientX: 300, clientY: 300 }] });
        viewport.dispatchEvent(two);
        expect(two.defaultPrevented).toBe(false);
        tap(away, viewport, awayPoint);
        await vi.advanceTimersByTimeAsync(0);
        expect(grips(host)).toHaveLength(0);
        engine.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("lo scorrimento prima del tocco lungo non mette le maniglie, e il mouse rimette il quadratino", async () => {
      const { engine, viewport, cell, host, go } = await workbookMounted(workbookHost());
      go(2, 2);
      const point = inside(cell(2, 2)!);
      const pressed = cell(2, 2)!;
      const other = cell(4, 4)!;
      const mouse = inside(other);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        finger(pressed, "pointerdown", point.x, point.y);
        finger(viewport, "pointermove", point.x, point.y + 30);
        vi.advanceTimersByTime(1000);
        expect(grips(host)).toHaveLength(0);
        finger(viewport, "pointercancel", point.x, point.y + 30);
        // Un menu col mouse si apre come sempre.
        const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        viewport.dispatchEvent(menu);
        expect(menu.defaultPrevented).toBe(false);
        other.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: mouse.x, clientY: mouse.y }));
        viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, clientX: mouse.x, clientY: mouse.y }));
        await vi.advanceTimersByTimeAsync(0);
        expect(host.querySelector(".grid-mark-handle:not([hidden])")).not.toBeNull();
        engine.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("smontata la griglia, un tocco lungo a metà non lascia niente", async () => {
      const { engine, cell } = await workbookMounted(workbookHost());
      const point = inside(cell(2, 2)!);
      const pressed = cell(2, 2)!;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        finger(pressed, "pointerdown", point.x, point.y);
        engine.destroy();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
