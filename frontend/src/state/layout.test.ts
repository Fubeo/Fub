// Il modello di layout (§1.2), provato senza DOM.
//
// Qui non si prova che i riquadri si disegnino — quello lo si vede aprendo
// l'app — si prova ciò che è **una decisione**: cosa succede all'albero quando
// si chiude un riquadro, quale tab prende il posto di quella chiusa, e cosa si
// fa di un file di stato che dice una cosa che non si può disegnare. Sono le
// tre cose che, sbagliate, si manifestano come «la finestra è strana» tre avvii
// dopo, cioè nel modo più difficile da ricondurre alla causa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apriIn,
  apriVistaIn,
  attivaTab,
  caricaLayout,
  chiudiPane,
  chiudiTab,
  coniaPaneId,
  dividi,
  docAttivo,
  documenti,
  layout,
  layoutDiDefault,
  paneConDoc,
  panes,
  parseLayout,
  rinomina,
  tabAttiva,
  togliDappertutto,
  type Layout,
} from "./layout";

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
});

/// Un layout di lavoro isolato: le funzioni prendono tutte il layout come
/// ultimo argomento apposta, così una prova non dipende da quella prima.
function nuovo(): Layout {
  return layoutDiDefault();
}

describe("l'albero dei riquadri", () => {
  it("nasce con un riquadro solo, che si chiama main", () => {
    const l = nuovo();
    expect(panes(l)).toEqual(["main"]);
    expect(l.focus).toBe("main");
  });

  // `main` resta il primo per sempre: è l'id che finisce nel `ViewContext`
  // pubblicato e nell'esemplare delle view (0037), cioè è già scritto in file
  // di stato esistenti.
  it("i riquadri nuovi prendono il primo nome libero, e main non si tocca", () => {
    const l = nuovo();
    expect(dividi("main", "row", l)).toBe("pane-2");
    expect(dividi("main", "row", l)).toBe("pane-3");
    expect(panes(l)).toEqual(["main", "pane-3", "pane-2"]);
    chiudiPane("pane-2", l);
    // Il primo libero e non un contatore che sale: un contatore persistito che
    // si disallinea dall'albero conia un id che esiste già.
    expect(coniaPaneId(l)).toBe("pane-2");
  });

  // Tre riquadri in fila sono tre figli di un nodo, non due nodi con due figli
  // ciascuno — e la differenza si vede chiudendone uno.
  it("dividere nello stesso verso allarga la fila invece di annidare", () => {
    const l = nuovo();
    dividi("main", "row", l);
    dividi("main", "row", l);
    expect(l.tree).toEqual({
      k: "split",
      dir: "row",
      children: [
        { k: "leaf", pane: "main" },
        { k: "leaf", pane: "pane-3" },
        { k: "leaf", pane: "pane-2" },
      ],
    });
  });

  // Una divisione con un figlio solo non è una divisione: è quel figlio, con un
  // livello di indirezione che al prossimo split deciderebbe il verso sbagliato.
  it("chiudere un riquadro pota la divisione che non divide più niente", () => {
    const l = nuovo();
    dividi("main", "row", l);
    expect(chiudiPane("pane-2", l)).toBe(true);
    expect(l.tree).toEqual({ k: "leaf", pane: "main" });
    expect(l.focus).toBe("main");
  });

  // «Chiudi l'ultimo riquadro» vorrebbe dire «chiudi la finestra», che è un
  // altro comando e di un altro modulo. Una finestra senza riquadri non è uno
  // stato che si possa disegnare.
  it("l'ultimo riquadro non si chiude", () => {
    const l = nuovo();
    expect(chiudiPane("main", l)).toBe(false);
    expect(panes(l)).toEqual(["main"]);
  });

  it("un riquadro nuovo eredita la modalità di chi lo ha generato", () => {
    const l = nuovo();
    l.panes.main.mode = "reading";
    const nuovoId = dividi("main", "col", l)!;
    expect(l.panes[nuovoId].mode).toBe("reading");
  });
});

describe("le tab di un riquadro", () => {
  it("aprire una nota già aperta ci si sposta sopra, non ne apre una seconda", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    apriIn("main", "b.md", l);
    apriIn("main", "a.md", l);
    expect(documenti(l.panes.main)).toEqual(["a.md", "b.md"]);
    expect(docAttivo("main", l)).toBe("a.md");
  });

  // Quella a sinistra, com'è in ogni editor a schede.
  it("chiudendo la tab davanti prende il posto quella a sinistra", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    apriIn("main", "b.md", l);
    apriIn("main", "c.md", l);
    chiudiTab("main", 2, l);
    expect(docAttivo("main", l)).toBe("b.md");
    chiudiTab("main", 0, l);
    // L'attivo era in 1 ed è sceso a 0 insieme a lui: senza il ricalcolo si
    // guarderebbe la nota sbagliata, che è il difetto che non lancia mai.
    expect(docAttivo("main", l)).toBe("b.md");
  });

  it("chiudere l'ultima tab lascia il riquadro vuoto, non lo chiude", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    chiudiTab("main", 0, l);
    expect(panes(l)).toEqual(["main"]);
    expect(docAttivo("main", l)).toBeNull();
  });

  // L'identità è il path (0043), e un rename non guarda chi sta guardando.
  it("un rename segue in tutti i riquadri", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    const secondo = dividi("main", "row", l)!;
    apriIn(secondo, "a.md", l);
    rinomina("a.md", "note/a.md", l);
    expect(paneConDoc("note/a.md", l).sort()).toEqual(["main", secondo].sort());
    expect(paneConDoc("a.md", l)).toEqual([]);
  });

  it("una nota cancellata sparisce da ogni riquadro", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    const secondo = dividi("main", "row", l)!;
    apriIn(secondo, "a.md", l);
    togliDappertutto("a.md", l);
    expect(paneConDoc("a.md", l)).toEqual([]);
  });

  // Il conto è il presidio, e guarda la porta: ogni `cambiato()` è un
  // `set_view_state`, cioè un `fsync` dall'altra parte dell'IPC (§25.6 misura
  // 2,5–5 ms l'uno). Chiudere N tab è **un** gesto e deve costare **una**
  // scrittura, non una per riquadro. Rosso con la forma di prima: cinque.
  it("una nota aperta in cinque riquadri se ne va con una scrittura sola", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    for (let i = 0; i < 4; i++) apriIn(dividi("main", "row", l)!, "a.md", l);
    expect(paneConDoc("a.md", l)).toHaveLength(5);
    setViewState.mockClear();

    togliDappertutto("a.md", l);

    expect(paneConDoc("a.md", l)).toEqual([]);
    expect(setViewState.mock.calls.map((c) => c[0])).toEqual(["layout"]);
  });

  // Il verso opposto, perché un conto che va a uno è indistinguibile da un
  // conto che va a zero: se non c'era niente da togliere non si scrive niente.
  it("togliere una nota che nessun riquadro teneva non scrive", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    setViewState.mockClear();
    togliDappertutto("b.md", l);
    expect(setViewState).not.toHaveBeenCalled();
  });

  it("attivare una tab che non c'è non fa niente", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    attivaTab("main", 7, l);
    expect(docAttivo("main", l)).toBe("a.md");
  });
});

// La §3.3: una tab può essere una **view** e non un documento. Le prove qui
// sotto guardano la cosa che si romperebbe in silenzio — un path e una view che
// si confondono — più che il fatto che una tab in più si apra.
describe("una tab che non è un documento", () => {
  it("una view sta accanto alle note e non è una di loro", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    apriVistaIn("main", "graph", l);
    expect(l.panes.main.tabs).toEqual([
      { k: "doc", doc: "a.md" },
      { k: "view", view: "graph" },
    ]);
    // La domanda «quale nota sta mostrando questo riquadro» ha una risposta
    // sola, e con il grafo davanti è «nessuna». È ciò che rende `doc: null` nel
    // `ViewContext` uno stato già previsto invece di un campo nuovo.
    expect(docAttivo("main", l)).toBeNull();
    expect(documenti(l.panes.main)).toEqual(["a.md"]);
    expect(tabAttiva("main", l)).toEqual({ k: "view", view: "graph" });
  });

  it("aprire due volte la stessa view ci si sposta sopra", () => {
    const l = nuovo();
    apriVistaIn("main", "graph", l);
    apriIn("main", "a.md", l);
    apriVistaIn("main", "graph", l);
    expect(l.panes.main.tabs).toHaveLength(2);
    expect(tabAttiva("main", l)).toEqual({ k: "view", view: "graph" });
  });

  // Un rename è un fatto dei documenti: una view che si chiamasse come una nota
  // non deve seguirlo. È il caso che un elenco di stringhe avrebbe sbagliato.
  it("un rename non tocca le view", () => {
    const l = nuovo();
    apriVistaIn("main", "a.md", l);
    apriIn("main", "a.md", l);
    rinomina("a.md", "b.md", l);
    expect(l.panes.main.tabs).toEqual([
      { k: "view", view: "a.md" },
      { k: "doc", doc: "b.md" },
    ]);
  });

  it("una nota cancellata non porta via la view omonima", () => {
    const l = nuovo();
    apriVistaIn("main", "a.md", l);
    apriIn("main", "a.md", l);
    togliDappertutto("a.md", l);
    expect(l.panes.main.tabs).toEqual([{ k: "view", view: "a.md" }]);
  });
});

// Il file si apre con un editor di testo — è la promessa fatta alle
// impostazioni nella 0036 — quindi ci si può trovare dentro qualunque cosa. La
// regola di `store.ts`: assente non è un errore, e un valore che non regge la
// forma vale come nessun valore. Si riparte dal default invece di aprire una
// finestra in uno stato che non esiste.
describe("rileggere la finestra com'era", () => {
  it("assente non è un errore", () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout("un layout")).toBeNull();
  });

  it("ritrova ciò che aveva salvato", () => {
    const l = nuovo();
    apriIn("main", "a.md", l);
    apriVistaIn("main", "graph", l);
    dividi("main", "col", l);
    const riletto = parseLayout(JSON.parse(JSON.stringify(l)));
    expect(riletto).toEqual(l);
  });

  // **La migrazione della §3.3.** Fino a ieri un riquadro teneva `docs:
  // string[]`, e quel file è già sul disco di chiunque abbia aperto questa
  // shell: una stringa nell'elenco è una tab di documento, quindi si legge
  // ancora e nessuno perde le note che aveva aperte.
  it("legge la forma di prima, in cui una tab era un path", () => {
    const riletto = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: ["a.md", "b.md"], active: 1, mode: "reading" } },
      focus: "main",
    });
    expect(riletto?.panes.main.tabs).toEqual([
      { k: "doc", doc: "a.md" },
      { k: "doc", doc: "b.md" },
    ]);
    expect(docAttivo("main", riletto!)).toBe("b.md");
  });

  it("una tab che non è né un documento né una view vale come file rovinato", () => {
    const con = (t: unknown) =>
      parseLayout({
        tree: { k: "leaf", pane: "main" },
        panes: { main: { tabs: [t], active: 0, mode: "live_preview" } },
        focus: "main",
      });
    expect(con({ k: "grafo", id: "x" })).toBeNull();
    expect(con({ k: "doc" })).toBeNull();
    expect(con({ k: "view", view: "" })).toBeNull();
    expect(con(42)).toBeNull();
    // …e la stringa vuota non è un path: era l'unico modo in cui la clemenza
    // verso la forma di prima poteva far entrare una tab senza documento.
    expect(con("")).toBeNull();
  });

  // Le tre forme di file rovinato che si possono davvero disegnare male: un
  // albero che nomina un riquadro che non sta nella mappa, una mappa con un
  // riquadro che non sta nell'albero, un fuoco che nomina il nulla.
  it("un albero e una mappa che non si corrispondono valgono come niente", () => {
    const base = {
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: [], active: -1, mode: "live_preview" } },
      focus: "main",
    };
    expect(parseLayout({ ...base, panes: {} })).toBeNull();
    expect(
      parseLayout({
        ...base,
        panes: { ...base.panes, fantasma: { docs: [], active: -1, mode: "live_preview" } },
      }),
    ).toBeNull();
    expect(parseLayout({ ...base, focus: "pane-9" })).toBeNull();
    // Una divisione con un figlio solo non è una divisione: è già potata da
    // `appiattisci` quando la produciamo noi, quindi da un file è un segno che
    // quel file non l'abbiamo scritto noi.
    expect(
      parseLayout({
        ...base,
        tree: { k: "split", dir: "row", children: [{ k: "leaf", pane: "main" }] },
      }),
    ).toBeNull();
    // Due foglie sullo stesso riquadro: lo stesso editor in due posti.
    expect(
      parseLayout({
        tree: {
          k: "split",
          dir: "row",
          children: [
            { k: "leaf", pane: "main" },
            { k: "leaf", pane: "main" },
          ],
        },
        panes: base.panes,
        focus: "main",
      }),
    ).toBeNull();
  });

  // Un indice fuori dalle tab è l'unica forma di file rovinato che si può
  // riparare invece di buttare: il riquadro c'è, le tab ci sono, non si sa quale
  // era davanti.
  it("un indice attivo impossibile si ripara, non butta tutto", () => {
    const riletto = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: ["a.md", "b.md"], active: 9, mode: "live_preview" } },
      focus: "main",
    });
    expect(docAttivo("main", riletto!)).toBe("a.md");
  });

  it("una modalità che non esiste vale come nessuna", () => {
    const riletto = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: [], active: -1, mode: "lettura" } },
      focus: "main",
    });
    expect(riletto!.panes.main.mode).toBe("live_preview");
  });

  // La migrazione, che è piccola ma vera: fino a ieri la modalità era la chiave
  // `mode`, una per vault. Chi apre la prima volta dopo l'aggiornamento non ha
  // un `layout` da leggere ma ha un `mode`, e quello diventa la modalità del
  // primo riquadro — o riaprirebbe in Live Preview chi stava leggendo.
  it("senza layout, la vecchia chiave `mode` diventa la modalità del primo riquadro", async () => {
    viewState.mockImplementation((key: string) =>
      Promise.resolve(key === "mode" ? "reading" : null),
    );
    await caricaLayout();
    expect(panes()).toEqual(["main"]);
    expect(layout.panes.main.mode).toBe("reading");
  });

  it("un errore dell'IPC non impedisce di partire", async () => {
    viewState.mockRejectedValue(new Error("nessun vault aperto"));
    await caricaLayout();
    expect(panes()).toEqual(["main"]);
    expect(layout.panes.main.mode).toBe("live_preview");
  });

  // Le due chiavi si chiedono **insieme**. Il conto delle chiamate non lo
  // vedrebbe — sono due in tutti e due i casi — quindi il predicato è
  // l'*attesa*: si tiene in volo la risposta della prima e si guarda se la
  // seconda è già partita. È la stessa forma del freno dell'host finto.
  // Rosso con la forma di prima: `mode` non veniva chiesta.
  it("le due chiavi partono insieme, non una dietro l'altra", async () => {
    viewState.mockImplementation((key: string) =>
      key === "layout" ? new Promise(() => {}) : Promise.resolve(null),
    );
    void caricaLayout();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(viewState.mock.calls.map((c) => c[0])).toEqual(["layout", "mode"]);
  });
});
