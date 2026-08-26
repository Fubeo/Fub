// Lo **stato di vista** della shell (§11.2), provato senza DOM: cosa si legge
// quando il file dice una cosa strana, e cosa si scrive quando non c'è niente da
// ricordare. Sono decisioni, non cablaggio — e una decisione che si prova solo
// aprendo l'app non la prova nessuno.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadActiveSpace, loadExpanded, saveExpanded, state } from "./store";

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
    await loadExpanded();
    expect(state.expanded.size).toBe(0);
    await loadActiveSpace();
    expect(state.activeSpace).toBeNull();
  });

  it("ritrova ciò che aveva salvato", async () => {
    viewState.mockResolvedValue(["note", "note/2026"]);
    await loadExpanded();
    expect([...state.expanded]).toEqual(["note", "note/2026"]);
  });

  // La **modalità** non si prova più di qui: dal §1.2 è di ogni riquadro e vive
  // nel layout, e la stessa regola — un valore che non è una modalità vale come
  // nessun valore — è provata in `layout.test.ts`, dove adesso sta.

  it("cartelle aperte che non sono una lista non fanno cadere la sidebar", async () => {
    viewState.mockResolvedValue("note");
    await loadExpanded();
    expect(state.expanded.size).toBe(0);
  });

  // Perdere lo scroll è meglio di una shell che non parte: senza vault aperto —
  // o con un file di stato che non si è potuto leggere — si riparte dal default.
  it("un errore dell'IPC non impedisce di partire", async () => {
    viewState.mockRejectedValue(new Error("nessun vault aperto"));
    await loadExpanded();
    expect(state.expanded.size).toBe(0);
  });
});

describe("ricordare", () => {
  it("nessuna cartella aperta si dimentica, invece di scrivere una lista vuota", async () => {
    saveExpanded();
    // La scrittura passa dalla coda di `scriviStato`, e il canale si guarda a
    // lavoro partito, non nel momento in cui è stato chiesto. Quattro giri di
    // microtask: la catena della coda si riarma solo quando il lavoro di prima
    // è risolto, e il giro unico non basta.
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(setViewState).toHaveBeenCalledWith("expanded", null);

    state.expanded = new Set(["note"]);
    saveExpanded();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
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
