// @vitest-environment happy-dom
// La griglia su una cartella di Excel: gli oggetti sopra le celle e la sola lettura.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridBytesWindow, GridCommandOutcome, GridWindowRequest } from "../../host/contract";
import type { GridCommandEffect, GridHost } from "./engine";
import xlsx from "../../__fixtures__/xlsx-grid.json";
import { settle, workbookHost, workbookMounted } from "./test-support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("GridEngine con una cartella di Excel", () => {
  // Quanto basta perché i tre oggetti (colonna J, righe 2-10) si vedano. Ogni
  // disegno rifà tutte le celle visibili, e in happy-dom una cella costa: con
  // 3000×1200 un test di nove gesti passava il secondo da solo e i 5 s nella
  // corsa intera (#286).
  async function widened(viewport: HTMLElement) {
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 1_200 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 480 });
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
  }

  const objectAt = (host: HTMLElement, key: string) =>
    [...host.querySelectorAll<HTMLElement>(".grid-object")].find((element) => element.dataset.object === key);

  it("disegna gli oggetti sopra le celle, li riassume e tiene le immagini una volta", async () => {
    const plain = workbookHost();
    const requests: GridWindowRequest[] = [];
    const grid = {
      ...plain,
      host: {
        ...plain.host,
        gridBytesWindow: async (surface: string, instance: string, request: GridWindowRequest) => {
          requests.push(structuredClone(request));
          const answer = await plain.host.gridBytesWindow(surface, instance, request);
          // Come il provider: un'immagine che la shell ha già arriva senza i byte.
          for (const object of answer.objects) {
            if (object.media && request.known_media.includes(object.media.key)) object.media.data = null;
          }
          return answer;
        },
      },
    };
    const { engine, host, viewport } = await workbookMounted(grid);
    expect(requests[0].known_media).toEqual([]);
    const summary = host.querySelector<HTMLElement>("#grid-xlsx-objects")!;
    expect(viewport.getAttribute("aria-describedby")).toBe(summary.id);
    for (const name of ["Il sole", "Conti di casa", "Importi"]) expect(summary.textContent).toContain(name);

    await widened(viewport);
    const objects = [...host.querySelectorAll<HTMLElement>(".grid-object")];
    // Nell'ordine in cui si disegnano: il grafico sopra la forma e l'immagine.
    expect(objects.map((element) => element.dataset.object)).toEqual(["image:1", "shape:2", "chart:3"]);
    expect(objects.every((element) => element.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(objectAt(host, "image:1")!.querySelector("img")!.src).toMatch(/^data:image\/png;base64,iVBOR/u);
    expect(objectAt(host, "chart:3")!.querySelector("img")!.src).toMatch(/^data:image\/svg\+xml/u);
    const text = objectAt(host, "shape:2")!.querySelector<HTMLElement>(".grid-object-text")!;
    expect(text.textContent).toBe("Conti di casa");
    expect(text.style.fontWeight).toBe("700");

    // Dopo un comando la griglia rilegge, e dice all'host l'immagine che ha
    // già: arriva senza i byte, e resta.
    const media = (xlsx.windows as GridBytesWindow[])[0].objects.find((object) => object.kind === "image")!.media!.key;
    const before = requests.length;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "5", code: "Digit5", ctrlKey: true, altKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await settle();
    await settle();
    expect(requests.length).toBeGreaterThan(before);
    const last = requests.filter((request) => request.sheet === "s1").pop()!;
    expect(last.known_media).toEqual([media]);
    expect(objectAt(host, "image:1")!.querySelector("img")!.src).toMatch(/^data:image\/png;base64,/u);
    engine.destroy();
    expect(host.querySelector(".grid-object")).toBeNull();
  });

  it("seleziona gli oggetti dalla tastiera, li sposta e li cancella con i comandi", async () => {
    const grid = workbookHost();
    const { engine, host, viewport } = await workbookMounted(grid);
    await widened(viewport);
    const key = (init: KeyboardEventInit) => viewport.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    key({ key: "5", code: "Digit5", ctrlKey: true, altKey: true });
    expect(engine.selectedObject()?.kind).toBe("image");
    const announce = host.querySelector<HTMLElement>(".grid-surface [role=status]:not(.grid-notice)");
    expect(announce?.textContent).toContain("Il sole");
    const selected = objectAt(host, "image:1")!;
    expect(selected.classList.contains("selected")).toBe(true);
    expect(selected.querySelectorAll(".grid-object-handle")).toHaveLength(8);

    key({ key: "Tab" });
    expect(engine.selectedObject()?.kind).toBe("shape");
    // Una lettera non apre la cella sotto l'oggetto.
    key({ key: "x" });
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    key({ key: "ArrowRight", shiftKey: true });
    await settle();
    const shape = (xlsx.windows as GridBytesWindow[])[0].objects.find((object) => object.kind === "shape")!;
    expect(grid.given.map((request) => request.command.id)).toEqual(["object.move"]);
    expect(JSON.parse(grid.given[0].command.params)).toEqual({
      kind: "shape", id: shape.id, at: "J6", dx: 10, dy: 0, width: shape.width, height: shape.height,
    });

    key({ key: "Delete" });
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["object.move", "object.delete"]);
    expect(JSON.parse(grid.given[1].command.params)).toEqual({ kind: "shape", id: shape.id });
    expect(engine.selectedObject()).toBeNull();

    key({ key: "5", code: "Digit5", ctrlKey: true, altKey: true });
    key({ key: "Escape" });
    expect(engine.selectedObject()).toBeNull();
    expect(host.querySelector(".grid-object.selected")).toBeNull();
    engine.destroy();
  });

  it("sposta e misura un oggetto col puntatore, e un clic non lo sposta", async () => {
    const grid = workbookHost();
    const { engine, host, viewport } = await workbookMounted(grid);
    await widened(viewport);
    const pointer = (target: EventTarget, type: string, x: number, y: number, extra: PointerEventInit = {}) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, ...extra }));
    const chart = (xlsx.windows as GridBytesWindow[])[0].objects.find((object) => object.kind === "chart")!;

    pointer(objectAt(host, "chart:3")!, "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 101, 101);
    pointer(viewport, "pointerup", 101, 101);
    await settle();
    expect(engine.selectedObject()?.kind).toBe("chart");
    expect(grid.given).toEqual([]);

    pointer(objectAt(host, "chart:3")!.querySelector(".grid-object-handle.se")!, "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 100 + 14, 100 + 28);
    // Mentre si tira, l'oggetto segue il puntatore.
    expect(objectAt(host, "chart:3")!.style.width).not.toBe("");
    pointer(viewport, "pointerup", 100 + 14, 100 + 28);
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["object.move"]);
    const params = JSON.parse(grid.given[0].command.params);
    expect(params).toMatchObject({ kind: "chart", id: chart.id, at: "J10", dx: 0, dy: 0 });
    expect(params.width).toBeCloseTo(chart.width + 10, 1);
    expect(params.height).toBeCloseTo(chart.height + 20, 1);
    engine.destroy();
  });

  it("seleziona l'oggetto che un comando ha appena inserito", async () => {
    const plain = workbookHost();
    const grid = {
      ...plain,
      host: {
        ...plain.host,
        gridBytesCommand: async (...args: Parameters<GridHost["gridBytesCommand"]>) => {
          const outcome = await plain.host.gridBytesCommand(...args);
          return args[2].command.id === "insert.textBox" ? { ...outcome, result: JSON.stringify({ shape: 2 }) } : outcome;
        },
      },
    };
    const { engine, viewport } = await workbookMounted(grid);
    await widened(viewport);
    expect(engine.command("insert.textBox")).toBe(true);
    await settle();
    await settle();
    expect(engine.selectedObject()?.kind).toBe("shape");
    // Un altro comando non cambia la selezione.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(engine.command("home.bold")).toBe(true);
    await settle();
    await settle();
    expect(engine.selectedObject()).toBeNull();
    engine.destroy();
  });

  it("in sola lettura dà soltanto i comandi che leggono o mostrano, e scarta un esito con modifiche", async () => {
    const plain = workbookHost();
    // Come il provider: un comando che legge rende il risultato e non tocca
    // il giornale; `selection.set` qui finge di cambiarlo.
    const grid = {
      ...plain,
      host: {
        ...plain.host,
        gridBytesCommand: async (...args: Parameters<GridHost["gridBytesCommand"]>) => {
          const [, , request] = args;
          if (request.command.id !== "selection.stats") return plain.host.gridBytesCommand(...args);
          plain.given.push(structuredClone(request));
          return {
            commit: { revision: request.revision, edit: { from: 0, to: 0, deleted: "", inserted: "" }, invalidation: { kind: "cells", cells: [] } },
            sheets: structuredClone(xlsx.session.sheets),
            hidden: structuredClone(xlsx.session.hidden),
            selection: { sheet: request.command.sheet, selection: request.command.selection, active: request.command.active },
            result: JSON.stringify({ count: 4 }),
            dialog: null,
            commands: structuredClone(xlsx.session.commands),
            book: structuredClone(xlsx.session.book),
          } as GridCommandOutcome;
        },
      },
    };
    const { engine, changes } = await workbookMounted(grid);
    engine.setReadOnly(true);
    // Senza sapere gli effetti, in sola lettura non passa niente.
    expect(engine.command("selection.stats")).toBe(false);
    const effects: Record<string, GridCommandEffect> = { "selection.stats": "legge", "selection.set": "mostra", "home.bold": "cambia" };
    engine.setCommandEffects((id) => effects[id], ["goTo"]);
    expect(engine.servesCommands()).toBe(true);
    expect(engine.commandable()).toBe(false);

    expect(engine.command("home.bold")).toBe(false);
    await expect(engine.run("home.bold")).resolves.toEqual({ ok: false, error: null });
    await expect(engine.run("selection.stats")).resolves.toEqual({ ok: true, result: JSON.stringify({ count: 4 }) });

    const before = changes.length;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opened = plain.calls.filter((call) => call.startsWith("open")).length;
    await expect(engine.run("selection.set", JSON.stringify({ range: "B2" }))).resolves.toEqual({ ok: false, error: null });
    await settle();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("selection.set"));
    // Il giornale confermato non cambia, e il provider riparte da quello.
    expect(changes.length).toBe(before);
    expect(engine.getDoc()).toBe("");
    expect(plain.calls.filter((call) => call.startsWith("open")).length).toBe(opened + 1);
    expect(plain.given.map((request) => request.command.id)).toEqual(["selection.stats", "selection.set"]);
    engine.destroy();
  });

  it("in sola lettura apre soltanto le finestre dei comandi che non cambiano", async () => {
    const dialogs: string[] = [];
    const { engine } = await workbookMounted(workbookHost(), "", undefined, { onDialog: (asked) => dialogs.push(asked.id) });
    engine.setReadOnly(true);
    engine.setCommandEffects(() => undefined, ["goTo"]);
    expect(engine.openDialog("formatCells")).toBe(false);
    expect(engine.openDialog("goTo")).toBe(true);
    engine.setReadOnly(false);
    expect(engine.openDialog("formatCells")).toBe(true);
    expect(dialogs).toEqual(["goTo", "formatCells"]);
    engine.destroy();
  });

  it("scrive il testo di una casella sul posto con shape.setText", async () => {
    const grid = workbookHost();
    const { engine, host, viewport } = await workbookMounted(grid);
    await widened(viewport);
    objectAt(host, "shape:2")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLTextAreaElement>(".grid-object-text-editor")!;
    expect(field.value).toBe("Conti di casa");
    // Esc lascia il testo com'era.
    field.value = "Spese";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host.querySelector(".grid-object-text-editor")).toBeNull();
    expect(grid.given).toEqual([]);

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const again = host.querySelector<HTMLTextAreaElement>(".grid-object-text-editor")!;
    again.value = "Spese di casa";
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["shape.setText"]);
    expect(JSON.parse(grid.given[0].command.params)).toEqual({ id: 2, text: "Spese di casa" });
    engine.destroy();
  });
});
