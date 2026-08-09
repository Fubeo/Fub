// La memoria di ciò che si è cercato e aperto (§21.5, §21.7), provata senza DOM.
//
// Due cose si provano qui, e sono di due nature diverse. La prima è una regola
// pura — cosa succede a una cosa che si rivede — e si prova chiamandola. La
// seconda è **l'interruttore**, e non si prova leggendo il codice: si prova
// guardando le chiamate al canale, cioè chiedendo al doppio dell'IPC quante
// volte gli è stato detto di scrivere. È la differenza fra «nel modulo c'è un
// `if`» e «a interruttore spento sul disco non finisce niente», e per un dato
// di privacy la seconda è la sola frase che valga qualcosa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  caricaCronologia,
  CHIAVE_CRONOLOGIA,
  conInCima,
  dimenticaTutto,
  ricercheRecenti,
  ricordaRicerca,
  scordaRecenti,
} from "./recenti";

const viewState = vi.fn();
const setViewState = vi.fn();
const impostazioni = vi.fn();

vi.mock("../host/ipc", () => ({
  api: {
    viewState: (key: string) => viewState(key),
    setViewState: (key: string, value: unknown) => setViewState(key, value),
  },
}));

vi.mock("../host/query", () => ({
  impostazioni: () => impostazioni(),
  documentiEsistenti: (docs: string[]) => Promise.resolve(new Set(docs)),
}));

vi.mock("./kernel", () => ({ onEvent: () => {} }));

/// L'interruttore come lo vede la shell: una voce nell'elenco che il canale
/// dati risponde, trovata per chiave.
function interruttore(acceso: boolean) {
  return [{ spec: { key: CHIAVE_CRONOLOGIA }, value: acceso }];
}

beforeEach(async () => {
  viewState.mockReset();
  setViewState.mockReset();
  impostazioni.mockReset();
  viewState.mockResolvedValue(null);
  setViewState.mockResolvedValue(undefined);
  impostazioni.mockResolvedValue(interruttore(true));
  scordaRecenti();
  // E si riparte da acceso: l'interruttore è stato di modulo, quindi un test
  // che lo spegne lo lascerebbe spento per il prossimo — che passerebbe per la
  // ragione sbagliata, ed è la forma d'errore peggiore in una suite.
  await caricaCronologia();
  scordaRecenti();
  setViewState.mockReset();
  setViewState.mockResolvedValue(undefined);
});

describe("conInCima", () => {
  it("la cosa appena vista va in cima", () => {
    expect(conInCima(["a.md", "b.md"], "c.md")).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("una cosa già vista si SPOSTA, non si duplica", () => {
    // È la differenza fra una memoria corta e un registro di accessi: chi
    // rimbalza fra due note non deve vedere quelle due note dieci volte. Per una
    // ricerca ripetuta vale identico, ed è il motivo per cui la regola è una.
    expect(conInCima(["a.md", "b.md", "c.md"], "c.md")).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("rivedere la prima non cambia niente", () => {
    expect(conInCima(["a.md", "b.md"], "a.md")).toEqual(["a.md", "b.md"]);
  });

  it("oltre il tetto la più vecchia cade", () => {
    expect(conInCima(["a.md", "b.md", "c.md"], "d.md", 3)).toEqual(["d.md", "a.md", "b.md"]);
  });

  it("da vuota", () => {
    expect(conInCima([], "a.md")).toEqual(["a.md"]);
  });
});

describe("le ricerche recenti", () => {
  it("una ricerca conclusa si ricorda, e si scrive", async () => {
    await caricaCronologia();
    setViewState.mockClear();
    ricordaRicerca("riunione");
    expect(ricercheRecenti()).toEqual(["riunione"]);
    // La scrittura passa dalla coda di `scriviStato`, e il canale si guarda a
    // lavoro partito, non nel momento in cui è stato chiesto. Quattro giri di
    // microtask: la catena della coda si riarma solo a lavoro risolto.
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(setViewState).toHaveBeenCalledWith("history", { note: [], ricerche: ["riunione"] });
  });

  it("il testo si ricorda com'è stato scritto, meno gli spazi ai bordi", () => {
    ricordaRicerca("  Riunione con Anna  ");
    expect(ricercheRecenti()).toEqual(["Riunione con Anna"]);
  });

  it("una ricerca vuota non è una ricerca", () => {
    ricordaRicerca("   ");
    expect(ricercheRecenti()).toEqual([]);
    expect(setViewState).not.toHaveBeenCalled();
  });

  it("la stessa ricerca risale invece di comparire due volte", () => {
    ricordaRicerca("a");
    ricordaRicerca("b");
    ricordaRicerca("a");
    expect(ricercheRecenti()).toEqual(["a", "b"]);
  });

  it("si rileggono da dove erano state messe via", async () => {
    viewState.mockResolvedValue({ note: ["nota.md"], ricerche: ["ieri"] });
    await caricaCronologia();
    expect(ricercheRecenti()).toEqual(["ieri"]);
  });

  it("un file di stato che dice una cosa che non è una lista vale come vuoto", async () => {
    // Severa come `parseLayout`, e per la stessa ragione: il file lo si apre con
    // un editor di testo. Una voce non-stringa arriverebbe fino al confine come
    // se fosse un path.
    viewState.mockResolvedValue({ note: "nota.md", ricerche: [1, "ieri", null] });
    await caricaCronologia();
    expect(ricercheRecenti()).toEqual(["ieri"]);
  });
});

describe("l'interruttore", () => {
  it("a memoria spenta non si scrive NIENTE", async () => {
    impostazioni.mockResolvedValue(interruttore(false));
    await caricaCronologia();
    setViewState.mockClear();

    ricordaRicerca("una cosa privata");

    // La domanda non è «c'è un `if` nel modulo»: è se al canale sia arrivato
    // qualcosa. Non è arrivato niente — nemmeno un elenco vuoto, che sarebbe
    // comunque una riga sul disco che parla di ricerche.
    expect(setViewState).not.toHaveBeenCalled();
  });

  it("spegnerlo cancella ciò che c'era", async () => {
    // Un interruttore di privacy che lascia sul disco la traccia di prima è una
    // casella che non ha fatto quello che diceva.
    viewState.mockResolvedValue({ note: ["nota.md"], ricerche: ["ieri"] });
    impostazioni.mockResolvedValue(interruttore(false));

    await caricaCronologia();

    expect(ricercheRecenti()).toEqual([]);
    expect(setViewState).toHaveBeenCalledWith("history", null);
  });

  it("spenta da prima e col disco pulito, non si scrive nemmeno per cancellare", async () => {
    // A regime, non alla transizione: chi la spegne una cancellazione la
    // merita (il test qui sopra), ma chi riapre l'app con la memoria già spenta
    // e niente da cancellare non deve far toccare il disco a questo modulo.
    impostazioni.mockResolvedValue(interruttore(false));
    await caricaCronologia();
    setViewState.mockClear();

    await caricaCronologia();

    expect(setViewState).not.toHaveBeenCalled();
  });

  it("se il canale non risponde, l'ultimo valore letto resta quello che vale", async () => {
    // Il verso pericoloso sarebbe l'altro: dare per acceso un interruttore che
    // qualcuno ha spento, perché una domanda è fallita.
    impostazioni.mockResolvedValue(interruttore(false));
    await caricaCronologia();
    impostazioni.mockRejectedValue(new Error("nessun vault"));
    await caricaCronologia();
    setViewState.mockClear();

    ricordaRicerca("ancora privata");
    expect(setViewState).not.toHaveBeenCalled();
  });
});

describe("cancellare", () => {
  it("dimentica in RAM e sul disco, e dimentica con `null`", async () => {
    await caricaCronologia();
    ricordaRicerca("qualcosa");
    setViewState.mockClear();

    dimenticaTutto();

    expect(ricercheRecenti()).toEqual([]);
    // La scrittura passa dalla coda di `scriviStato`: quattro giri di
    // microtask, come sopra.
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    // `null` e non due liste vuote: per un dato di privacy la differenza fra
    // «assente» e «vuoto» è quella che si vede aprendo il file.
    expect(setViewState).toHaveBeenCalledWith("history", null);
  });
});
