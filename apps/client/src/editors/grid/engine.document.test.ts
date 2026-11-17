// @vitest-environment happy-dom
// La griglia sulla `DocumentSession` vera: il giornale che scrive va nella
// sessione, il salvataggio lo mette nei byte (il disco del provider finto) e
// la griglia si riapre sui byte nuovi, come nel riquadro. Qui si guarda ciò
// che vale fra un salvataggio e l'altro: la history (IMP-027) e la bozza di
// una cella aperta quando il file cambia fuori (IMP-031).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSource } from "../../host/contract";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import { gridJournalText } from "../../state/grid-journal";
import { findTextEditorOrThrow } from "../text/test-support";
import { GridEngine } from "./engine";
import { settle, typeInActiveCell, workbookHost } from "./test-support";

const DOC = "conti.xlsx";

afterEach(() => {
  document.body.replaceChildren();
});

/// La sessione del documento sopra il provider finto: leggere dà il giornale
/// vuoto sulla revisione dei byte, scrivere mette il giornale nei byte.
async function documentWithGrid() {
  const grid = workbookHost();
  const api: DocumentSessionApi = {
    readDocument: vi.fn(async (): Promise<DocumentSource> => ({
      text: "", revision: grid.base(), format_id: "xlsx", source_kind: "bytes", text_kind: "grid_journal",
    })),
    openDocument: vi.fn(async (id: string) => api.readDocument(id)),
    writeDocument: vi.fn(async (_id: string, text: string) => grid.save(text)),
    resourceWrite: vi.fn(async () => ({ revision: "mai" })),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    documentClosed: vi.fn(async () => {}),
  };
  const sessions = new DocumentSessionCollection(api);
  await sessions.read(DOC);
  const host = document.createElement("div");
  document.body.append(host);
  const base = (): string | null => {
    const now = sessions.inspect(DOC)?.base;
    return now?.kind === "descends_from" ? now.value : null;
  };
  const engine = new GridEngine(host, {
    surfaceId: "riquadro",
    formatId: "xlsx",
    revision: grid.base(),
    documentId: DOC,
    base,
    onChange: (change) => {
      sessions.acceptSurfaceChange(DOC, "riquadro", { text: change.text, operation: change.operation });
    },
    onSelectionChange: () => {},
    grid: grid.host,
  });
  sessions.attachSurface(DOC, {
    id: "riquadro",
    sync: (update) => engine.syncDoc(update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text),
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 400 },
  });
  engine.setDoc(sessions.text(DOC) ?? "");
  await settle();
  const cell = (row: number, column: number) =>
    host.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);
  const go = (row: number, column: number) => {
    cell(row, column)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  };
  /// Salva come il timer della sessione, e aspetta che la griglia si riapra.
  const save = async () => {
    await sessions.flush(DOC);
    await settle();
    await settle();
  };
  const drain = async () => {
    for (let round = 0; round < 4; round += 1) await settle();
  };
  return { grid, api, sessions, engine, host, viewport, cell, go, save, drain };
}

describe("la griglia sulla sessione del documento", () => {
  it("Ctrl+Z toglie dal file una formula già salvata, e Ctrl+Y la rimette (IMP-027)", async () => {
    const { grid, sessions, engine, host, viewport, cell, go, save, drain } = await documentWithGrid();
    go(8, 6);
    typeInActiveCell(host, viewport, "=B2*2");
    await drain();
    await save();
    expect(grid.disk("s1", "r8", "c6")).toBe("=B2*2");
    expect(sessions.inspect(DOC)).toMatchObject({ text: "", dirty: false });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    await drain();
    expect(cell(8, 6)?.textContent ?? "").toBe("");
    expect(sessions.isDirty(DOC)).toBe(true);
    await save();
    expect(grid.disk("s1", "r8", "c6")).toBe("");

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }));
    await drain();
    await save();
    expect(grid.disk("s1", "r8", "c6")).toBe("=B2*2");
    expect(cell(8, 6)?.textContent).toBe("=B2*2");
    engine.destroy();
  });

  it("Canc su una formula appena scritta si annulla anche dopo il salvataggio (IMP-027)", async () => {
    const { grid, engine, host, viewport, cell, go, save, drain } = await documentWithGrid();
    go(8, 7);
    typeInActiveCell(host, viewport, "=B2+1");
    await drain();
    // Prima del salvataggio, come nella prova del collaudo: la cancellazione
    // entra nel giornale a comandi, e un salvataggio solo li porta nei byte.
    go(8, 7);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await drain();
    await save();
    expect(grid.disk("s1", "r8", "c7")).toBe("");

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    await drain();
    await save();
    expect(grid.disk("s1", "r8", "c7")).toBe("=B2+1");
    expect(cell(8, 7)?.textContent).toBe("=B2+1");
    engine.destroy();
  });

  // IMP-031: la cella aperta tiene la sua bozza mentre la cartella si
  // riapre sui byte cambiati fuori; confermata, finisce nel file.
  it("una cella in scrittura resta aperta con il suo testo quando il file cambia fuori, e Invio lo salva (IMP-031)", async () => {
    const { grid, sessions, engine, host, viewport, cell, go, save, drain } = await documentWithGrid();
    go(8, 6);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: "bc" }, userEvent: "input" });
    expect(engine.editMode()).toBe("insert");

    // Un'altra app riscrive A2 nel file.
    grid.save(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c0", before: "Affitto", after: "Mutuo" }], commands: [] }));
    const outcome = await sessions.handleExternalChange(DOC, { actor: { kind: "watcher" }, batch: null });
    expect(outcome).toMatchObject({ kind: "reloaded", changed: true });
    await drain();
    expect(cell(1, 0)?.textContent).toBe("Mutuo");
    expect(engine.editMode()).toBe("insert");
    expect(editor.state.doc.toString()).toBe("abc");
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await drain();
    await save();
    expect(grid.disk("s1", "r8", "c6")).toBe("abc");
    expect(grid.disk("s1", "r1", "c0")).toBe("Mutuo");
    engine.destroy();
  });

  it("se il file cambia proprio la cella in scrittura, la griglia chiede quale testo tenere (IMP-031)", async () => {
    const { grid, sessions, engine, host, viewport, go, save, drain } = await documentWithGrid();
    go(1, 0);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    grid.save(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c0", before: "Affitto", after: "Mutuo" }], commands: [] }));
    await sessions.handleExternalChange(DOC, { actor: { kind: "watcher" }, batch: null });
    await drain();
    const notice = host.querySelector<HTMLElement>(".grid-draft-notice")!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("Mutuo");
    // «Tieni la tua»: la bozza resta e confermata va nel file.
    notice.querySelector<HTMLButtonElement>("button")!.click();
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await drain();
    await save();
    expect(grid.disk("s1", "r1", "c0")).toBe("x");
    engine.destroy();
  });
});
