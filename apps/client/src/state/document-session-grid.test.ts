// @vitest-environment happy-dom
// La griglia vera attaccata alla sessione vera, su un disco finto che tiene i
// byte salvati e la loro revisione: la cella aperta e non confermata alla
// chiusura, nelle bozze e sotto un cambio da fuori; il conflitto e la
// riapertura su byte che non ci sono più (IMP-031, IMP-034, IMP-037).
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRAFT_MS, DocumentSessionCollection, type DocumentSessionApi } from "./document-session";
import type { DocumentSource, Origin, PluginError } from "../host/contract";
import { findTextEditorOrThrow } from "../editors/text/test-support";
import { GridEngine } from "../editors/grid/engine";
import { settle, workbookHost } from "../editors/grid/test-support";
import { gridJournalText, parseGridJournal, recordGridJournal } from "./grid-journal";

const DOC = "conti.xlsx";
const WATCHER: Origin = { actor: { kind: "watcher" }, batch: null };

type Workbook = ReturnType<typeof workbookHost>;

/**
 * Il disco della sessione: gli stessi byte del provider finto. `current` è la
 * revisione sul disco, se un cambio da fuori la sposta senza toccare il
 * provider (che nel finto lega la sua revisione ai byte salvati).
 */
function diskApi(grid: Workbook, current: () => string = () => grid.base()) {
  const writes: Array<{ readonly text: string; readonly base: string }> = [];
  const drafts = new Map<string, { readonly text: string; readonly base: string | null }>();
  const read = async (): Promise<DocumentSource> => ({
    text: "",
    revision: current(),
    format_id: "xlsx",
    source_kind: "bytes",
    text_kind: "grid_journal",
  });
  const api: DocumentSessionApi = {
    readDocument: read,
    openDocument: read,
    writeDocument: async (_id, text, base) => {
      // Come l'host: la base attesa è la revisione sul disco, o niente se
      // dettata; un giornale vuoto non cambia i byte.
      if (base.kind === "descends_from" && base.value !== current()) {
        throw { kind: "conflict", message: "stale" } satisfies PluginError;
      }
      writes.push({ text, base: base.kind });
      return text === "" ? grid.base() : grid.save(text);
    },
    resourceWrite: async () => ({ revision: "rev-byte" }),
    saveDraft: async (id, text, base) => {
      drafts.set(id, { text, base });
    },
    discardDraft: async (id) => {
      drafts.delete(id);
    },
    documentClosed: async () => {},
  };
  return { api, writes, drafts };
}

/** Monta la griglia e la attacca alla sessione come fa la shell. */
async function openGrid(sessions: DocumentSessionCollection, grid: Workbook) {
  const text = await sessions.read(DOC);
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = new GridEngine(parent, {
    surfaceId: "pane",
    formatId: "xlsx",
    documentId: DOC,
    base: () => {
      const base = sessions.inspect(DOC)?.base;
      return base?.kind === "descends_from" ? base.value : null;
    },
    diskRevision: async () => grid.base(),
    onChange: (change) => {
      sessions.acceptSurfaceChange(DOC, "pane", { text: change.text, operation: change.operation });
    },
    onSelectionChange: () => {},
    grid: grid.host,
  });
  const viewport = parent.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 400 },
  });
  engine.setDoc(text);
  const detach = sessions.attachSurface(DOC, {
    id: "pane",
    sync: (update) => engine.syncDoc(update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text),
    pendingText: () => engine.pendingText(),
    commitPending: () => engine.commitPending(),
    watchPending: (listener) => engine.watchPending(listener),
  });
  await settle();
  const cell = (row: number, column: number) =>
    parent.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);
  /** Sceglie la cella e ci scrive `text` senza confermare. */
  const typeWithoutEnter = (row: number, column: number, text: string) => {
    cell(row, column)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: text[0], bubbles: true }));
    const editor = findTextEditorOrThrow(parent.querySelector<HTMLElement>(".grid-cell-editor")!);
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: text.slice(1) }, userEvent: "input" });
  };
  const surface = () => parent.querySelector<HTMLElement>(".grid-surface")!;
  return { engine, parent, cell, typeWithoutEnter, surface, detach };
}

/** L'input che il giornale `text` dà alla cella, voce o `range.setValues`. */
function inputIn(text: string, at: string): string | undefined {
  const journal = parseGridJournal(text);
  const [row, column] = at.split(",");
  const entry = journal.entries.find((candidate) => candidate.row === `r${row}` && candidate.column === `c${column}`);
  if (entry) return entry.after;
  const range = String.fromCharCode(65 + Number(column)) + String(Number(row) + 1);
  const command = journal.commands.find((candidate) => candidate.id === "range.setValues" && JSON.parse(candidate.params).range === range);
  return command ? String((JSON.parse(command.params) as { values: unknown[][] }).values[0]![0]) : undefined;
}

/** Un giornale scritto «da fuori»: un'altra app cambia una cella sul disco. */
function outside(grid: Workbook, input: string): string {
  return grid.save(gridJournalText(recordGridJournal({ entries: [], commands: [] }, { sheet: "s1", row: "r9", column: "c1" }, "", input)));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("la cella aperta di un foglio e la sessione", () => {
  it("chiudere la scheda con la cella in scrittura la conferma e la salva (IMP-037)", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    pane.typeWithoutEnter(1, 1, "chius");
    expect(sessions.get(DOC)!.hasPending()).toBe(true);

    // Ctrl+W: la shell rilascia la sessione con la superficie ancora attaccata.
    const outcome = await sessions.release(DOC);

    expect(outcome.kind).toBe("closed");
    expect(disk.writes).toHaveLength(1);
    expect(grid.disk("s1", "r1", "c1")).toBe("chius");
    pane.detach();
    pane.engine.destroy();
  });

  it("una formula non confermata passa dal provider, e la chiusura la aspetta", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    pane.typeWithoutEnter(1, 1, "=1+2");
    grid.hold(true);

    const release = sessions.release(DOC);
    await settle();
    // La conferma è dal provider: la sessione non si è ancora chiusa.
    expect(sessions.inspect(DOC)?.lifecycle).toBe("open");
    grid.hold(false);
    grid.release();

    expect((await release).kind).toBe("closed");
    expect(inputIn(disk.writes[0]!.text, "1,1")).toBe("=1+2");
    expect(grid.disk("s1", "r1", "c1")).toBe("=1+2");
    pane.detach();
    pane.engine.destroy();
  });

  it("la bozza di recupero porta il testo della cella aperta, senza confermarla", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    vi.useFakeTimers();
    pane.typeWithoutEnter(1, 1, "bozza");
    await vi.advanceTimersByTimeAsync(DRAFT_MS + 10);

    expect(inputIn(disk.drafts.get(DOC)!.text, "1,1")).toBe("bozza");
    // La cella resta aperta: la bozza non scrive nel giornale né sul disco.
    expect(pane.engine.editMode()).not.toBe("ready");
    expect(sessions.inspect(DOC)!.dirty).toBe(false);
    expect(disk.writes).toHaveLength(0);
    vi.useRealTimers();
    pane.detach();
    pane.engine.destroy();
  });

  it("un cambio da fuori con la cella in scrittura diventa una scelta, non una ricarica muta (IMP-031)", async () => {
    let moved: string | null = null;
    const grid: Workbook = workbookHost({ base: () => moved ?? grid.base() });
    const disk = diskApi(grid, () => moved ?? grid.base());
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    pane.typeWithoutEnter(1, 1, "abc");
    // Un'altra app riscrive il file mentre la cella è aperta.
    moved = "sha256:riscritto-fuori";

    const change = await sessions.handleExternalChange(DOC, WATCHER);

    expect(change).toEqual({ kind: "warning", cause: "altra_app" });
    expect(inputIn(sessions.text(DOC)!, "1,1")).toBe("abc");
    // Il salvataggio trova il disco cambiato: conflitto, e niente sovrascritto.
    await sessions.get(DOC)!.flush();
    expect(sessions.inspect(DOC)!.result).toBe("conflitto");
    expect(disk.writes).toHaveLength(0);
    expect(pane.cell(1, 1)?.textContent).toBe("abc");
    pane.detach();
    pane.engine.destroy();
  });
});

describe("il conflitto di un foglio", () => {
  async function inConflict() {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    pane.typeWithoutEnter(1, 1, "MIO");
    pane.engine.commitPending();
    await settle();
    outside(grid, "FUORI");
    await sessions.get(DOC)!.flush();
    expect(sessions.inspect(DOC)!.result).toBe("conflitto");
    return { grid, disk, sessions, pane };
  }

  it("«Tieni il mio testo» lo scrive sopra il disco nuovo e la griglia si riapre sui byte scritti (IMP-034)", async () => {
    const { grid, disk, sessions, pane } = await inConflict();

    expect((await sessions.resolveConflict(DOC, "mine")).kind).toBe("kept");
    await settle();

    expect(disk.writes.map((write) => write.base)).toEqual(["dictated"]);
    expect(grid.disk("s1", "r1", "c1")).toBe("MIO");
    expect(grid.disk("s1", "r9", "c1")).toBe("FUORI");
    expect(sessions.inspect(DOC)).toMatchObject({ result: "ok", dirty: false, text: "" });
    expect(pane.surface().dataset.gridProtocol).toBe("v2");
    expect(pane.cell(1, 1)?.textContent).toBe("MIO");
    pane.detach();
    pane.engine.destroy();
  });

  it("«Usa la versione sul disco» scarta il mio testo e mostra il disco (IMP-034)", async () => {
    const { disk, sessions, pane } = await inConflict();

    expect((await sessions.resolveConflict(DOC, "theirs")).kind).toBe("discarded");
    await settle();

    expect(disk.writes).toHaveLength(0);
    expect(sessions.inspect(DOC)).toMatchObject({ result: "ok", dirty: false, text: "" });
    expect(pane.surface().dataset.gridProtocol).toBe("v2");
    expect(pane.cell(1, 1)?.textContent).not.toBe("MIO");
    expect(pane.cell(9, 1)?.textContent).toBe("FUORI");
    pane.detach();
    pane.engine.destroy();
  });

  it("riaperta con la bozza di prima del cambio, la cartella si legge invece di restare bianca (IMP-034)", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const before = grid.base();
    const mine = gridJournalText(recordGridJournal({ entries: [], commands: [] }, { sheet: "s1", row: "r1", column: "c1" }, "", "MIO"));
    outside(grid, "FUORI");
    const sessions = new DocumentSessionCollection(disk.api);
    // La bozza ritrovata discende dai byte di prima, che il disco non ha più.
    sessions.restore(DOC, mine, { kind: "descends_from", value: before });

    const pane = await openGrid(sessions, grid);

    expect(pane.surface().dataset.gridProtocol).toBe("v2");
    expect(pane.cell(1, 1)?.textContent).toBe("MIO");
    expect(pane.cell(9, 1)?.textContent).toBe("FUORI");
    // La scelta resta alla sessione: niente è stato scritto.
    expect(disk.writes).toHaveLength(0);
    expect(sessions.text(DOC)).toBe(mine);
    pane.detach();
    pane.engine.destroy();
  });
});
