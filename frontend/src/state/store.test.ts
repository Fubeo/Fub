// Lo **stato di vista** della shell (§11.2), provato senza DOM: cosa si legge
// quando il file dice una cosa strana, e cosa si scrive quando non c'è niente da
// ricordare. Sono decisioni, non cablaggio — e una decisione che si prova solo
// aprendo l'app non la prova nessuno.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadActiveSpace, loadExpanded, loadMode, saveExpanded, state } from "./store";

const viewState = vi.fn();
const setViewState = vi.fn();

vi.mock("../host/ipc", () => ({
  api: {
    viewState: (key: string) => viewState(key),
    setViewState: (key: string, value: unknown) => setViewState(key, value),
  },
}));

beforeEach(() => {
  viewState.mockReset();
  setViewState.mockReset();
  setViewState.mockResolvedValue(undefined);
  state.expanded = new Set();
  state.activeSpace = null;
});

describe("rileggere dove si era rimasti", () => {
  it("la prima volta non c'è niente, e non è un errore", async () => {
    viewState.mockResolvedValue(null);
    expect(await loadMode()).toBe("live_preview");
    await loadExpanded();
    expect(state.expanded.size).toBe(0);
    await loadActiveSpace();
    expect(state.activeSpace).toBeNull();
  });

  it("ritrova ciò che aveva salvato", async () => {
    viewState.mockResolvedValue("reading");
    expect(await loadMode()).toBe("reading");

    viewState.mockResolvedValue(["note", "note/2026"]);
    await loadExpanded();
    expect([...state.expanded]).toEqual(["note", "note/2026"]);
  });

  // Il file si apre con un editor di testo — è la promessa fatta alle
  // impostazioni nella 0036 — quindi ci si può trovare dentro qualunque cosa. Un
  // valore che non è una modalità vale come nessun valore: una shell che parte
  // in uno stato che non esiste è peggio di una che parte al default.
  it("un valore che non è una modalità vale come nessuno", async () => {
    viewState.mockResolvedValue("lettura");
    expect(await loadMode()).toBe("live_preview");
    viewState.mockResolvedValue(42);
    expect(await loadMode()).toBe("live_preview");
  });

  it("cartelle aperte che non sono una lista non fanno cadere la sidebar", async () => {
    viewState.mockResolvedValue("note");
    await loadExpanded();
    expect(state.expanded.size).toBe(0);
  });

  // Perdere lo scroll è meglio di una shell che non parte: senza vault aperto —
  // o con un file di stato che non si è potuto leggere — si riparte dal default.
  it("un errore dell'IPC non impedisce di partire", async () => {
    viewState.mockRejectedValue(new Error("nessun vault aperto"));
    expect(await loadMode()).toBe("live_preview");
    await loadExpanded();
    expect(state.expanded.size).toBe(0);
  });
});

describe("ricordare", () => {
  it("nessuna cartella aperta si dimentica, invece di scrivere una lista vuota", () => {
    saveExpanded();
    expect(setViewState).toHaveBeenCalledWith("expanded", null);

    state.expanded = new Set(["note"]);
    saveExpanded();
    expect(setViewState).toHaveBeenLastCalledWith("expanded", ["note"]);
  });

  // Chi apre una cartella nell'albero non deve fermarsi per una scrittura su
  // disco, e un salvataggio fallito non deve fermarlo nemmeno dopo: si scrive in
  // console, perché l'unico modo di raccontarlo sarebbe un avviso a ogni click.
  it("una scrittura fallita non propaga", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setViewState.mockRejectedValue(new Error("file illeggibile"));
    expect(() => saveExpanded()).not.toThrow();
    warn.mockRestore();
  });
});
