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
  /// Con `hold`, le scritture restano in volo finché non si chiama `release`.
  let gate: Promise<void> | null = null;
  let open = (): void => {};
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
      if (gate) await gate;
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
  const hold = () => {
    gate = new Promise<void>((resolve) => { open = resolve; });
  };
  const release = () => {
    gate = null;
    open();
  };
  return { api, writes, drafts, hold, release };
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
    writing: () => sessions.writing(DOC),
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

  it("l'eco del salvataggio automatico non chiude la cella in cui si sta scrivendo (IMP-310, IMP-414)", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    vi.useFakeTimers();
    // Una cella confermata arma il salvataggio automatico; intanto si scrive
    // già nella cella accanto.
    pane.typeWithoutEnter(1, 1, "Farina");
    pane.engine.commitPending();
    await vi.advanceTimersByTimeAsync(0);
    pane.typeWithoutEnter(1, 2, "Fari");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(disk.writes).toHaveLength(1);
    expect(inputIn(disk.writes[0]!.text, "1,1")).toBe("Farina");

    // L'evento del kernel per la scrittura appena fatta: l'eco, attore
    // `user` fuori da un lotto.
    const change = await sessions.handleExternalChange(DOC, { actor: { kind: "user" }, batch: null });

    expect(change.kind).toBe("echo");
    // La cella resta aperta, con ciò che si è scritto, e la sessione non ha
    // confermato niente a metà parola.
    expect(pane.engine.editMode()).not.toBe("ready");
    expect(sessions.get(DOC)!.hasPending()).toBe(true);
    expect(sessions.inspect(DOC)!.dirty).toBe(false);
    const editor = findTextEditorOrThrow(pane.parent.querySelector<HTMLElement>(".grid-cell-editor")!);
    expect(editor.state.doc.toString()).toBe("Fari");
    vi.useRealTimers();
    pane.detach();
    pane.engine.destroy();
  });

  it("cinque righe per quattro colonne scritte di fila, coi salvataggi in mezzo, arrivano tutte nei byte (IMP-310, IMP-414, IMP-512)", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    // Come l'host: ogni scrittura torna come evento del kernel, l'eco
    // dell'utente senza lotto.
    const write = disk.api.writeDocument;
    const echoes: Array<Promise<unknown>> = [];
    const sessions: DocumentSessionCollection = new DocumentSessionCollection({
      ...disk.api,
      writeDocument: async (...args) => {
        const revision = await write(...args);
        setTimeout(() => echoes.push(sessions.handleExternalChange(DOC, { actor: { kind: "user" }, batch: null })), 0);
        return revision;
      },
    });
    const pane = await openGrid(sessions, grid);
    const viewport = pane.parent.querySelector<HTMLElement>(".grid-viewport")!;
    // Da E8, sotto le celle della fixture e lontano dalla colonna D nascosta.
    const top = 7;
    const left = 4;
    const rows = [
      ["Voce", "Quantità", "Prezzo", "Totale"],
      ["Farina", "2", "3", "=F9*G9"],
      ["Farina integrale", "3", "4", "=F10*G10"],
      ["Farina", "4", "5", "=F11*G11"],
      ["Totale", "=SUM(F9:F11)", "Fari", "=SUM(H9:H11)"],
    ];
    vi.useFakeTimers();
    pane.cell(top, left)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    // Come la tastiera: ogni tasto va dove sta il fuoco, non a un elemento
    // scelto dalla prova.
    const press = (key: string) => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    };
    const cellEditor = () => pane.parent.querySelector<HTMLElement>(".grid-cell-editor")!;
    viewport.focus();
    for (const row of rows) {
      for (const [index, value] of row.entries()) {
        press(value[0]!);
        // A metà parola passa il tempo del salvataggio automatico: scrive
        // ciò che è confermato, e la sua eco torna con la cella aperta.
        await vi.advanceTimersByTimeAsync(500);
        expect(cellEditor().hidden, `la cella di «${value}» resta aperta`).toBe(false);
        expect(cellEditor().contains(document.activeElement), `il fuoco resta nella cella di «${value}»`).toBe(true);
        const editor = findTextEditorOrThrow(cellEditor());
        editor.dispatch({ changes: { from: editor.state.doc.length, insert: value.slice(1) }, userEvent: "input" });
        press(index === row.length - 1 ? "Enter" : "Tab");
        await vi.advanceTimersByTimeAsync(0);
      }
    }
    await vi.advanceTimersByTimeAsync(2_000);
    await sessions.get(DOC)!.flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all(echoes);

    expect(disk.writes.length).toBeGreaterThan(1);
    expect(echoes.length).toBe(disk.writes.length);
    expect(sessions.inspect(DOC)!.dirty).toBe(false);
    rows.forEach((row, r) => row.forEach((value, c) => {
      expect(grid.disk("s1", `r${top + r}`, `c${left + c}`), `cella ${top + r},${left + c}`).toBe(value);
    }));
    vi.useRealTimers();
    pane.detach();
    pane.engine.destroy();
  });

  it("una cella confermata mentre il salvataggio riapre la cartella a comandi non si perde (IMP-512)", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    vi.useFakeTimers();
    // Una formula porta la sessione nei comandi: il giornale si pubblica
    // quando il provider lo conferma, e il salvataggio automatico si arma.
    pane.typeWithoutEnter(1, 1, "=1+2");
    pane.engine.commitPending();
    await vi.advanceTimersByTimeAsync(0);
    expect(sessions.inspect(DOC)!.dirty).toBe(true);
    // La cella dopo parte verso il provider mentre il salvataggio scrive e
    // la griglia si riapre sui byte nuovi.
    grid.hold(true);
    pane.typeWithoutEnter(2, 1, "dopo");
    pane.engine.commitPending();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(disk.writes).toHaveLength(1);
    grid.hold(false);
    grid.release();
    await vi.advanceTimersByTimeAsync(1_000);
    await sessions.get(DOC)!.flush();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(grid.disk("s1", "r1", "c1")).toBe("=1+2");
    expect(grid.disk("s1", "r2", "c1")).toBe("dopo");
    expect(pane.cell(2, 1)?.textContent).toBe("dopo");
    expect(sessions.inspect(DOC)!.dirty).toBe(false);
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

describe("annulla di un foglio mentre si salva", () => {
  /// Una formula salvata porta la cartella nei comandi; poi `step` cambia la
  /// cartella con un comando, e la sessione comincia a scriverlo.
  async function savingCommand(step: (pane: Awaited<ReturnType<typeof openGrid>>) => void) {
    const grid = workbookHost();
    const disk = diskApi(grid);
    const sessions = new DocumentSessionCollection(disk.api);
    const pane = await openGrid(sessions, grid);
    pane.typeWithoutEnter(8, 6, "=1+2");
    pane.engine.commitPending();
    await settle();
    await sessions.get(DOC)!.flush();
    await settle();
    expect(grid.disk("s1", "r8", "c6")).toBe("=1+2");
    step(pane);
    await settle();
    expect(sessions.inspect(DOC)!.dirty).toBe(true);
    disk.hold();
    const saving = sessions.get(DOC)!.flush();
    await settle();
    expect(sessions.writing(DOC)).not.toBeNull();
    return { grid, disk, sessions, pane, saving };
  }

  async function saved(sessions: DocumentSessionCollection, saving: Promise<boolean>) {
    await saving;
    await settle();
    await settle();
    await sessions.get(DOC)!.flush();
    await settle();
    await settle();
  }

  // IMP-6400: ordinare, e annullare mentre il salvataggio scrive l'ordine.
  // Il giornale riportato sui byte nuovi perdeva l'annulla, e la sessione
  // diceva «Tutto salvato» con il file ancora ordinato.
  it("ordinare e annullare mentre il salvataggio scrive l'ordine riporta il file com'era (IMP-6400)", async () => {
    const { grid, disk, sessions, pane, saving } = await savingCommand((pane) => {
      pane.cell(8, 6)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(pane.engine.command("data.sortAscending", "{}")).toBe(true);
    });
    expect(disk.writes[disk.writes.length - 1]!.text).toContain("data.sortAscending");

    expect(pane.engine.undo()).toBe(true);
    await settle();
    disk.release();
    await saved(sessions, saving);

    expect(grid.diskStyles()).toEqual([]);
    expect(sessions.inspect(DOC)).toMatchObject({ result: "ok", dirty: false, text: "" });
    // E l'ordine si ripete, sul disco come prima.
    expect(pane.engine.redo()).toBe(true);
    await settle();
    await saved(sessions, Promise.resolve(true));
    expect(grid.diskStyles()).toEqual(["data.sortAscending@G9"]);
    pane.detach();
    pane.engine.destroy();
  });

  it("un comando annullato mentre si salva resta annullato sullo schermo e sul disco (IMP-6400)", async () => {
    const { grid, disk, sessions, pane, saving } = await savingCommand((pane) => {
      pane.typeWithoutEnter(9, 6, "=5");
      pane.engine.commitPending();
    });

    expect(pane.engine.undo()).toBe(true);
    await settle();
    // Il giornale si sta scrivendo: l'annulla lo aspetta, e lo schermo non
    // mostra ancora ciò che il disco non avrebbe.
    expect(pane.cell(9, 6)?.textContent).toBe("=5");
    disk.release();
    await saved(sessions, saving);

    expect(grid.disk("s1", "r9", "c6")).toBe("");
    expect(pane.cell(9, 6)?.textContent ?? "").toBe("");
    expect(grid.disk("s1", "r8", "c6")).toBe("=1+2");
    expect(sessions.inspect(DOC)).toMatchObject({ result: "ok", dirty: false, text: "" });
    pane.detach();
    pane.engine.destroy();
  });

  it("una cella scritta dopo l'annulla, mentre si salva, entra dopo di lui (IMP-6400)", async () => {
    const { grid, disk, sessions, pane, saving } = await savingCommand((pane) => {
      pane.typeWithoutEnter(9, 6, "=5");
      pane.engine.commitPending();
    });

    expect(pane.engine.undo()).toBe(true);
    await settle();
    pane.typeWithoutEnter(10, 6, "dopo");
    pane.engine.commitPending();
    await settle();
    disk.release();
    await saved(sessions, saving);

    expect(grid.disk("s1", "r9", "c6")).toBe("");
    expect(grid.disk("s1", "r10", "c6")).toBe("dopo");
    expect(pane.cell(9, 6)?.textContent ?? "").toBe("");
    expect(pane.cell(10, 6)?.textContent).toBe("dopo");
    expect(sessions.inspect(DOC)).toMatchObject({ result: "ok", dirty: false, text: "" });
    pane.detach();
    pane.engine.destroy();
  });

  it("se il salvataggio fallisce, l'annulla va alla sessione di prima e il salvataggio dopo lo scrive (IMP-6400)", async () => {
    const grid = workbookHost();
    const disk = diskApi(grid);
    let fail = false;
    const sessions = new DocumentSessionCollection({
      ...disk.api,
      writeDocument: async (...args) => {
        if (!fail) return disk.api.writeDocument(...args);
        await disk.api.writeDocument(args[0], "", { kind: "dictated" });
        throw { kind: "io", message: "disco pieno" } satisfies PluginError;
      },
    });
    const pane = await openGrid(sessions, grid);
    pane.typeWithoutEnter(8, 6, "=1+2");
    pane.engine.commitPending();
    await settle();
    await sessions.get(DOC)!.flush();
    await settle();
    pane.typeWithoutEnter(9, 6, "=5");
    pane.engine.commitPending();
    await settle();
    fail = true;
    disk.hold();
    const saving = sessions.get(DOC)!.flush();
    await settle();
    expect(pane.engine.undo()).toBe(true);
    await settle();
    disk.release();
    await saving;
    await settle();
    await settle();
    expect(pane.cell(9, 6)?.textContent ?? "").toBe("");
    expect(grid.disk("s1", "r9", "c6")).toBe("");
    fail = false;
    await sessions.get(DOC)!.flush();
    await settle();
    await settle();
    expect(grid.disk("s1", "r9", "c6")).toBe("");
    expect(grid.disk("s1", "r8", "c6")).toBe("=1+2");
    expect(sessions.inspect(DOC)).toMatchObject({ dirty: false, text: "" });
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

    // Il giornale non è il file: non c'è un testo da mettere nella Cronologia.
    const keep = vi.fn(async () => {});
    expect(sessions.keepsDiscardedText(DOC)).toBe(false);
    expect((await sessions.resolveConflict(DOC, "theirs", keep)).kind).toBe("discarded");
    expect(keep).not.toHaveBeenCalled();
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
