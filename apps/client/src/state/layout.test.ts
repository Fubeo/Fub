// Il modello di layout (§1.2), provato senza DOM.
//
// Qui non si prova che i riquadri si disegnino — quello lo si vede aprendo
// l'app — si prova ciò che è **una decisione**: cosa succede all'albero quando
// si chiude un riquadro, quale linguetta prende il posto di quella chiusa, e cosa si
// fa di un file di stato che dice una cosa che non si può disegnare. Sono le
// tre cose che, sbagliate, si manifestano come «la finestra è strana» tre avvii
// dopo, cioè nel modo più difficile da ricondurre alla causa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openIn,
  openViewIn,
  activateTab,
  loadLayout,
  closePane,
  closeTab,
  mintPaneId,
  split,
  activeDoc,
  documents,
  layout,
  defaultLayout,
  panesWithDoc,
  panes,
  parseLayout,
  rename,
  activeTab,
  removeEverywhere,
  normalizedSizes,
  setSplitSizes,
  setMode,
  setPaneLink,
  setPinnedTab,
  setTabStack,
  type Layout,
  type SplitNode,
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
function newItem(): Layout {
  return defaultLayout();
}

describe("l'albero dei riquadri", () => {
  it("nasce con un riquadro solo, che si chiama main", () => {
    const l = newItem();
    expect(panes(l)).toEqual(["main"]);
    expect(l.focus).toBe("main");
  });

  // `main` resta il primo per sempre: è l'id che finisce nel `ViewContext`
  // pubblicato e nell'esemplare delle view (0037), cioè è già scritto in file
  // di stato esistenti.
  it("i riquadri nuovi prendono il primo nome libero, e main non si tocca", () => {
    const l = newItem();
    expect(split("main", "row", l)).toBe("pane-2");
    expect(split("main", "row", l)).toBe("pane-3");
    expect(panes(l)).toEqual(["main", "pane-3", "pane-2"]);
    closePane("pane-2", l);
    // Il primo libero e non un contatore che sale: un contatore persistito che
    // si disallinea dall'albero conia un id che esiste già.
    expect(mintPaneId(l)).toBe("pane-2");
  });

  // Tre riquadri in fila sono tre figli di un nodo, non due nodi con due figli
  // ciascuno — e la differenza si vede chiudendone uno.
  it("dividere nello stesso verso allarga la fila invece di annidare", () => {
    const l = newItem();
    split("main", "row", l);
    split("main", "row", l);
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
    const l = newItem();
    split("main", "row", l);
    expect(closePane("pane-2", l)).toBe(true);
    expect(l.tree).toEqual({ k: "leaf", pane: "main" });
    expect(l.focus).toBe("main");
  });

  // «Chiudi l'ultimo riquadro» vorrebbe dire «chiudi la finestra», che è un
  // altro comando e di un altro modulo. Una finestra senza riquadri non è uno
  // stato che si possa disegnare.
  it("l'ultimo riquadro non si chiude", () => {
    const l = newItem();
    expect(closePane("main", l)).toBe(false);
    expect(panes(l)).toEqual(["main"]);
  });

  it("un riquadro nuovo eredita le modalità di chi lo ha generato", () => {
    const l = newItem();
    setMode("main", "text", "reading", l);
    setMode("main", "canvas", "source", l);
    const newItemId = split("main", "col", l)!;
    expect(l.panes[newItemId].modes).toEqual({ text: "reading", canvas: "source" });
    // Una copia, non lo stesso oggetto: cambiare modalità a destra non la
    // cambia a sinistra.
    setMode(newItemId, "text", "source", l);
    expect(l.panes.main.modes.text).toBe("reading");
  });

  // Gli id valgono dentro la famiglia: il `source` della tela non è quello
  // del testo, e sceglierne uno non tocca l'altro.
  it("la modalità si ricorda per famiglia di superfici", () => {
    const l = newItem();
    setMode("main", "text", "source", l);
    setMode("main", "canvas", "canvas", l);
    expect(l.panes.main.modes).toEqual({ text: "source", canvas: "canvas" });
  });
});

describe("le tab di un riquadro", () => {
  it("aprire una nota già aperta ci si sposta sopra, non ne apre una seconda", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    openIn("main", "b.md", l);
    openIn("main", "a.md", l);
    expect(documents(l.panes.main)).toEqual(["a.md", "b.md"]);
    expect(activeDoc("main", l)).toBe("a.md");
  });

  // Quella a sinistra, com'è in ogni editor a schede.
  it("chiudendo la tab davanti prende il posto quella a sinistra", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    openIn("main", "b.md", l);
    openIn("main", "c.md", l);
    closeTab("main", 2, l);
    expect(activeDoc("main", l)).toBe("b.md");
    closeTab("main", 0, l);
    // L'attivo era in 1 ed è sceso a 0 insieme a lui: senza il ricalcolo si
    // guarderebbe la nota sbagliata, che è il difetto che non lancia mai.
    expect(activeDoc("main", l)).toBe("b.md");
  });

  it("chiudere l'ultima tab lascia il riquadro vuoto, non lo chiude", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    closeTab("main", 0, l);
    expect(panes(l)).toEqual(["main"]);
    expect(activeDoc("main", l)).toBeNull();
  });

  // L'identità è il path (0043), e un rename non guarda chi sta guardando.
  it("un rename segue in tutti i riquadri", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    const secondPane = split("main", "row", l)!;
    openIn(secondPane, "a.md", l);
    rename("a.md", "note/a.md", l);
    expect(panesWithDoc("note/a.md", l).sort()).toEqual(["main", secondPane].sort());
    expect(panesWithDoc("a.md", l)).toEqual([]);
  });

  it("una nota cancellata sparisce da ogni riquadro", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    const secondPane = split("main", "row", l)!;
    openIn(secondPane, "a.md", l);
    removeEverywhere("a.md", l);
    expect(panesWithDoc("a.md", l)).toEqual([]);
  });

  // Il conto è il presidio, e guarda la porta: ogni `cambiato()` è un
  // `set_view_state`, cioè un `fsync` dall'altra parte dell'IPC (§25.6 misura
  // 2,5–5 ms l'uno). Chiudere N linguetta è **un** gesto e deve costare **una**
  // scrittura, non una per riquadro. Rosso con la forma di prima: cinque.
  it("una nota aperta in cinque riquadri se ne va con una scrittura sola", async () => {
    const l = newItem();
    openIn("main", "a.md", l);
    for (let i = 0; i < 4; i++) openIn(split("main", "row", l)!, "a.md", l);
    expect(panesWithDoc("a.md", l)).toHaveLength(5);
    setViewState.mockClear();

    removeEverywhere("a.md", l);

    // Le scritture passano dalla coda di `scriviStato` (che le coalesce per
    // chiave), e il conto si guarda a lavoro partito, non nel momento in cui è
    // stato chiesto. Le cinque aperture di sopra e la chiusura di qui sono
    // comunque **una** scrittura sola: la coda fonde ciò che è ancora in
    // attesa. Quattro giri di microtask, perché la catena della coda si riarma
    // solo a lavoro risolto.
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(panesWithDoc("a.md", l)).toEqual([]);
    expect(setViewState.mock.calls.map((c) => c[0])).toEqual(["layout"]);
  });

  // Il verso opposto, perché un conto che va a uno è indistinguibile da un
  // conto che va a zero: se non c'era niente da togliere non si scrive niente.
  it("togliere una nota che nessun riquadro teneva non scrive", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    setViewState.mockClear();
    removeEverywhere("b.md", l);
    expect(setViewState).not.toHaveBeenCalled();
  });

  it("attivare una tab che non c'è non fa niente", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    activateTab("main", 7, l);
    expect(activeDoc("main", l)).toBe("a.md");
  });
});

// La §3.3: una linguetta può essere una **view** e non un documento. Le prove qui
// sotto guardano la cosa che si romperebbe in silenzio — un path e una view che
// si confondono — più che il fatto che una linguetta in più si apra.
describe("una tab che non è un documento", () => {
  it("una view sta accanto alle note e non è una di loro", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    openViewIn("main", "graph", l);
    expect(l.panes.main.tabs).toEqual([
      { k: "doc", doc: "a.md" },
      { k: "view", view: "graph" },
    ]);
    // La domanda «quale nota sta mostrando questo riquadro» ha una risposta
    // sola, e con il grafo davanti è «nessuna». È ciò che rende `doc: null` nel
    // `ViewContext` uno stato già previsto invece di un campo nuovo.
    expect(activeDoc("main", l)).toBeNull();
    expect(documents(l.panes.main)).toEqual(["a.md"]);
    expect(activeTab("main", l)).toEqual({ k: "view", view: "graph" });
  });

  it("aprire due volte la stessa view ci si sposta sopra", () => {
    const l = newItem();
    openViewIn("main", "graph", l);
    openIn("main", "a.md", l);
    openViewIn("main", "graph", l);
    expect(l.panes.main.tabs).toHaveLength(2);
    expect(activeTab("main", l)).toEqual({ k: "view", view: "graph" });
  });

  // Un rename è un fatto dei documenti: una view che si chiamasse come una nota
  // non deve seguirlo. È il caso che un elenco di stringhe avrebbe sbagliato.
  it("un rename non tocca le view", () => {
    const l = newItem();
    openViewIn("main", "a.md", l);
    openIn("main", "a.md", l);
    rename("a.md", "b.md", l);
    expect(l.panes.main.tabs).toEqual([
      { k: "view", view: "a.md" },
      { k: "doc", doc: "b.md" },
    ]);
  });

  it("una nota cancellata non porta via la view omonima", () => {
    const l = newItem();
    openViewIn("main", "a.md", l);
    openIn("main", "a.md", l);
    removeEverywhere("a.md", l);
    expect(l.panes.main.tabs).toEqual([{ k: "view", view: "a.md" }]);
  });

  // `OpenView` porta gli argomenti dell'istanza: stanno sulla linguetta, così
  // il riquadro li ridà al kernel a ogni disegno e dopo un riavvio.
  it("una view aperta con argomenti li tiene sulla linguetta", () => {
    const l = newItem();
    openViewIn("main", "links", l, { doc: "a.md" });
    expect(activeTab("main", l)).toEqual({ k: "view", view: "links", params: { doc: "a.md" } });
    // Senza argomenti (o con `null`) la linguetta non ne ha.
    openViewIn("main", "graph", l, null);
    expect(activeTab("main", l)).toEqual({ k: "view", view: "graph" });
  });

  it("riaprire la view con altri argomenti la riporta su quelli, senza una seconda linguetta", () => {
    const l = newItem();
    openViewIn("main", "links", l, { doc: "a.md" });
    openIn("main", "b.md", l);
    openViewIn("main", "links", l, { doc: "b.md" });
    expect(l.panes.main.tabs).toEqual([
      { k: "view", view: "links", params: { doc: "b.md" } },
      { k: "doc", doc: "b.md" },
    ]);
    expect(l.panes.main.active).toBe(0);
    // Riaprirla senza argomenti ci si sposta sopra e tiene i suoi.
    openIn("main", "b.md", l);
    openViewIn("main", "links", l);
    expect(activeTab("main", l)).toEqual({ k: "view", view: "links", params: { doc: "b.md" } });
  });

  it("appuntare, raggruppare e rileggere non perdono gli argomenti", () => {
    const l = newItem();
    openIn("main", "a.md", l);
    openViewIn("main", "links", l, { doc: "a.md" });
    setPinnedTab("main", 1, true, l);
    expect(l.panes.main.tabs[0]).toEqual({ k: "view", view: "links", params: { doc: "a.md" }, pinned: true });
    setTabStack("main", 0, "ricerca", l);
    expect(l.panes.main.tabs[0]).toEqual({
      k: "view",
      view: "links",
      params: { doc: "a.md" },
      pinned: true,
      stack: "ricerca",
    });
    expect(parseLayout(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });

  it("un riquadro collegato segue anche gli argomenti nuovi", () => {
    const l = newItem();
    split("main", "row", l);
    const [left, right] = panes(l);
    setPaneLink(left!, "coppia", l);
    setPaneLink(right!, "coppia", l);
    openViewIn(left!, "links", l, { doc: "a.md" });
    openViewIn(left!, "links", l, { doc: "b.md" });
    expect(activeTab(right!, l)).toEqual({ k: "view", view: "links", params: { doc: "b.md" } });
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
    const l = newItem();
    openIn("main", "a.md", l);
    openViewIn("main", "graph", l);
    split("main", "col", l);
    const reread = parseLayout(JSON.parse(JSON.stringify(l)));
    expect(reread).toEqual(l);
  });

  // **La migrazione della §3.3.** Fino a ieri un riquadro teneva `docs:
  // string[]`, e quel file è già sul disco di chiunque abbia aperto questa
  // shell: una stringa nell'elenco è una linguetta di documento, quindi si legge
  // ancora e nessuno perde le note che aveva aperte.
  it("legge la forma di prima, in cui una tab era un path", () => {
    const reread = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: ["a.md", "b.md"], active: 1, mode: "reading" } },
      focus: "main",
    });
    expect(reread?.panes.main.tabs).toEqual([
      { k: "doc", doc: "a.md" },
      { k: "doc", doc: "b.md" },
    ]);
    expect(activeDoc("main", reread!)).toBe("b.md");
  });

  it("una tab che non è né un documento né una view vale come file rovinato", () => {
    const withLayout = (t: unknown) =>
      parseLayout({
        tree: { k: "leaf", pane: "main" },
        panes: { main: { tabs: [t], active: 0, mode: "live_preview" } },
        focus: "main",
      });
    expect(withLayout({ k: "grafo", id: "x" })).toBeNull();
    expect(withLayout({ k: "doc" })).toBeNull();
    expect(withLayout({ k: "view", view: "" })).toBeNull();
    expect(withLayout(42)).toBeNull();
    // …e la stringa vuota non è un path: era l'unico modo in cui la clemenza
    // verso la forma di prima poteva far entrare una linguetta senza documento.
    expect(withLayout("")).toBeNull();
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
        panes: { ...base.panes, ghost: { docs: [], active: -1, mode: "live_preview" } },
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

  // Un indice fuori dalle linguetta è l'unica forma di file rovinato che si può
  // riparare invece di buttare: il riquadro c'è, le linguetta ci sono, non si sa quale
  // era davanti.
  it("un indice attivo impossibile si ripara, non butta tutto", () => {
    const reread = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: ["a.md", "b.md"], active: 9, mode: "live_preview" } },
      focus: "main",
    });
    expect(activeDoc("main", reread!)).toBe("a.md");
  });

  it("conserva una modalità non vuota dichiarata da una superficie", () => {
    const reread = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { tabs: [], active: -1, modes: { grid: "grid.navigate", text: "reading" } } },
      focus: "main",
    });
    expect(reread!.panes.main.modes).toEqual({ grid: "grid.navigate", text: "reading" });
  });

  // Una voce rovinata costa soltanto sé stessa: quella famiglia torna alla
  // modalità predefinita della sua superficie, il resto del riquadro resta.
  it("una modalità vuota o non testuale torna al default della superficie", () => {
    const reread = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { tabs: [], active: -1, modes: { text: "   ", canvas: 3, grid: "sheet", " ": "x" } } },
      focus: "main",
    });
    expect(reread!.panes.main.modes).toEqual({ grid: "sheet" });
  });

  // La forma di prima: una `mode` sola per riquadro. Era la modalità delle
  // note — l'unica famiglia che ne aveva più d'una — e resta quella.
  it("la `mode` di un riquadro di prima diventa la modalità delle note", () => {
    const reread = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: [], active: -1, mode: "reading" } },
      focus: "main",
    });
    expect(reread!.panes.main.modes).toEqual({ text: "reading" });
    const blank = parseLayout({
      tree: { k: "leaf", pane: "main" },
      panes: { main: { docs: [], active: -1, mode: "   " } },
      focus: "main",
    });
    expect(blank!.panes.main.modes).toEqual({});
  });

  // La migrazione, che è piccola ma vera: fino a ieri la modalità era la chiave
  // `mode`, una per vault. Chi apre la prima volta dopo l'aggiornamento non ha
  // un `layout` da leggere ma ha un `mode`, e quello diventa la modalità del
  // primo riquadro — o riaprirebbe in Live Preview chi stava leggendo.
  it("senza layout, la vecchia chiave `mode` diventa la modalità del primo riquadro", async () => {
    viewState.mockImplementation((key: string) =>
      Promise.resolve(key === "mode" ? "reading" : null),
    );
    await loadLayout();
    expect(panes()).toEqual(["main"]);
    expect(layout.panes.main.modes).toEqual({ text: "reading" });
  });

  // `editor.default-mode` nomina una modalità delle note: vale per il testo e
  // basta, o una tela aperta nel riquadro nuovo partirebbe dal suo `source`.
  it("senza niente da ricordare, la modalità preferita vale per le note", async () => {
    viewState.mockResolvedValue(null);
    await loadLayout(Promise.resolve("source"));
    expect(layout.panes.main.modes).toEqual({ text: "source" });
  });

  it("un errore dell'IPC non impedisce di partire", async () => {
    viewState.mockRejectedValue(new Error("nessun vault aperto"));
    await loadLayout();
    expect(panes()).toEqual(["main"]);
    expect(layout.panes.main.modes).toEqual({});
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
    void loadLayout();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(viewState.mock.calls.map((c) => c[0])).toEqual(["layout", "mode"]);
  });
});

describe("le proporzioni di una divisione", () => {
  const splitOf = (l: Layout): SplitNode => {
    if (l.tree.k !== "split") throw new Error("la radice non è una divisione");
    return l.tree;
  };

  it("si ricordano, e una forma che non regge vale parti uguali", () => {
    const l = defaultLayout();
    split("main", "row", l);
    const saved = JSON.parse(JSON.stringify(l)) as { tree: { sizes?: unknown } };
    saved.tree.sizes = [0.7, 0.3];
    expect(splitOf(parseLayout(saved)!).sizes).toEqual([0.7, 0.3]);
    for (const wrong of [[0.5], [1, -1], ["a", "b"], [0.5, Number.NaN]]) {
      saved.tree.sizes = wrong;
      expect(splitOf(parseLayout(saved)!).sizes).toBeUndefined();
    }
  });

  it("un riquadro in più o in meno nella stessa fila riparte da parti uguali", () => {
    const l = defaultLayout();
    const second = split("main", "row", l)!;
    splitOf(l).sizes = [0.8, 0.2];
    split(second, "row", l);
    expect(splitOf(l).children).toHaveLength(3);
    expect(splitOf(l).sizes).toBeUndefined();
    splitOf(l).sizes = [0.5, 0.25, 0.25];
    closePane(second, l);
    expect(splitOf(l).sizes).toBeUndefined();
  });

  it("dividere dentro un figlio in verso diverso lascia le proporzioni della fila", () => {
    const l = defaultLayout();
    const second = split("main", "row", l)!;
    splitOf(l).sizes = [0.8, 0.2];
    split(second, "col", l);
    expect(splitOf(l).sizes).toEqual([0.8, 0.2]);
  });

  it("normalizza a somma uno e non lascia un riquadro sotto il minimo", () => {
    expect(normalizedSizes([2, 2], 2)).toEqual([0.5, 0.5]);
    const clamped = normalizedSizes([0.99, 0.01], 2)!;
    expect(clamped[1]).toBeGreaterThan(0.08);
    expect(clamped[0]! + clamped[1]!).toBeCloseTo(1);
    const l = defaultLayout();
    split("main", "col", l);
    setSplitSizes(splitOf(l), [3, 1]);
    expect(splitOf(l).sizes).toEqual([0.75, 0.25]);
  });
});
