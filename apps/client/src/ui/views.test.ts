// @vitest-environment happy-dom
// **Un pannello non è una view**, e per nove superfici su dieci le due cose si
// chiamano uguale.
//
// Diceva «sette su otto», e le superfici erano dieci da prima che questa riga
// fosse scritto. Nessuno se n'era accorto perché il numero era **dedotto**: non
// c'era niente che confrontasse il conto di questo commento con l'enum del
// contratto. Adesso c'è, in fondo al file, e legge il mirror generato invece di
// ricordarselo — la §23.2 ha chiuso su questo, che è la stessa forma del §16.7
// («esaustivo a memoria, non per costruzione») vista dal lato della shell.
//
// È la trappola che la §3.3 ha aperto e in cui questo repo è caduto subito: fino
// all'area principale un pannello *era* una view — stesso id, uno per uno —
// quindi passare l'uno dove andava l'altro non si vedeva. Con un riquadro il
// pannello si chiama `graph@main` e la view si chiama `graph`, e chiedere al
// kernel di disegnare «graph@main» significa nominare una view che non esiste:
// `refreshPanel` cattura l'errore, lo scrive in console, e a schermo resta un
// riquadro vuoto. Nessun test era rosso, perché nessun test montava una view in
// un riquadro.
//
// Queste prove guardano **cosa si chiede al kernel**, che è l'unica cosa che
// questo modulo faccia di irreversibile. Il disegno è di `ui/node.ts` e ha i
// suoi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../index.html?raw";
import generatedEnums from "../host/enums.generated?raw";
import type { UiNode, ViewSpec, ViewUpdate } from "../host/contract";
import { openLifetime } from "./lifetime";

function emptyTree(title: string): UiNode {
  return { node: "empty_state", title, detail: null, action: null };
}

const renderView = vi.fn(async (): Promise<UiNode> => emptyTree("vuoto"));
const viewAction = vi.fn(async () => ({ kind: "none" }));
const listViews = vi.fn(async (): Promise<ViewSpec[]> => []);

vi.mock("../host/ipc", () => ({
  api: {
    get listViews() {
      return listViews;
    },
    get renderView() {
      return renderView;
    },
    get viewAction() {
      return viewAction;
    },
    viewState: async () => null,
    setViewState: async () => {},
  },
}));
// `state/document-session` possiede il flush senza trascinare qui CodeMirror
// e il pannello del documento.
vi.mock("../state/document-session", () => ({ flushPendingSave: async () => {} }));

function spec(id: string, surface: ViewSpec["surface"]): ViewSpec {
  return {
    id,
    title: id,
    surface,
    icon: null,
    order: 0,
    open_by_default: true,
    closable: false,
    preferred_size: null,
    refresh: { kinds: [], topics: [], subjects: [], changes: [] },
    follows: { kinds: [] },
  } as unknown as ViewSpec;
}

/// Il DOM di partenza è **`index.html` vero**, non sette `<div>` scritti qui.
///
/// Non è pignoleria: `ui/views` cerca i suoi contenitori al caricamento del
/// modulo, e con lui si carica mezza shell — l'esploratore, la ricerca, la
/// sidebar — che i propri elementi li cerca allo stesso modo. Una fixture
/// scritto a mano andrebbe tenuta d'accordo con `index.html`, cioè sarebbe una
/// seconda copia di ciò che questo test dovrebbe verificare. Presa così, se
/// qualcuno toglie un `id` dal documento il rosso arriva qui.
const BODY = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)![1];

function prepareDom(): void {
  // Via gli `<script>`: qui i moduli li carica vitest, e un `type="module"`
  // dentro `innerHTML` non parte comunque.
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, "");
}

async function loadViews() {
  return await import("./views");
}

beforeEach(() => {
  vi.resetModules();
  renderView.mockClear();
  viewAction.mockClear();
  prepareDom();
});

describe("una view dell'area principale", () => {
  it("non si monta all'avvio: aspetta un riquadro", async () => {
    listViews.mockResolvedValueOnce([spec("graph", "main")]);
    const views = await loadViews();
    await views.mountDeclaredViews();

    // Nessun contenitore della shell l'ha presa, e nessuno l'ha chiesta al
    // kernel: un riquadro non è un posto che si riempie da solo.
    expect(renderView).not.toHaveBeenCalled();
    expect(document.getElementById("views-left")!.children).toHaveLength(0);
    // …ma è **disponibile**, col titolo che finirà sulla linguetta.
    expect(views.primaryViews().map((s) => s.id)).toEqual(["graph"]);
    expect(views.primaryView("graph")?.title).toBe("graph");
  });

  // La prova che mancava, ed è quella che il grafo vuoto ha fatto scoprire a
  // mano: al kernel si nomina la **view**, non il pannello.
  it("montata in un riquadro, chiede al kernel la view e non il pannello", async () => {
    listViews.mockResolvedValueOnce([spec("graph", "main")]);
    const views = await loadViews();
    await views.mountDeclaredViews();

    const pane = document.createElement("div");
    document.body.appendChild(pane);
    await views.mountViewInPane("graph", "main", pane);

    expect(renderView).toHaveBeenCalledWith("graph", "main", null);
  });

  // L'esemplare **è** il riquadro: è la stessa identità che il `ViewContext`
  // porta di là dal confine, quindi lo stato di vista si separa esattamente
  // dove l'utente vede due cose.
  it("due riquadri sono due esemplari della stessa view", async () => {
    listViews.mockResolvedValueOnce([spec("graph", "main")]);
    const views = await loadViews();
    await views.mountDeclaredViews();

    const firstPane = document.createElement("div");
    const secondPane = document.createElement("div");
    document.body.append(firstPane, secondPane);
    await views.mountViewInPane("graph", "main", firstPane);
    await views.mountViewInPane("graph", "pane-2", secondPane);

    expect(renderView.mock.calls).toEqual([
      ["graph", "main", null],
      ["graph", "pane-2", null],
    ]);
  });

  it("una view che nessuno dichiara non si monta", async () => {
    listViews.mockResolvedValueOnce([]);
    const views = await loadViews();
    await views.mountDeclaredViews();

    const pane = document.createElement("div");
    document.body.appendChild(pane);
    await views.mountViewInPane("graph", "main", pane);
    expect(renderView).not.toHaveBeenCalled();
  });
});

describe("le superfici che questa shell ospita da sé", () => {
  it("una view di sidebar si monta all'avvio, e pannello e view si chiamano uguale", async () => {
    listViews.mockResolvedValueOnce([spec("tags", "left_sidebar")]);
    const views = await loadViews();
    await views.mountDeclaredViews();

    expect(renderView).toHaveBeenCalledWith("tags", "tags", null);
    expect(document.getElementById("views-left")!.children).toHaveLength(1);
    expect(
      document.querySelector<HTMLElement>("#views-left .declared-view-panel")!.dataset.viewId,
    ).toBe("tags");
  });
});
describe("l'inspector a tab", () => {
  it("lega tab e pannelli e muove il fuoco con frecce/Home/Fine", async () => {
    listViews.mockResolvedValueOnce([
      spec("outline", "right_sidebar"),
      spec("backlinks", "right_sidebar"),
    ]);
    const views = await loadViews();
    await views.mountDeclaredViews();

    const right = document.getElementById("views-right")!;
    const tabs = [...right.querySelectorAll<HTMLButtonElement>(".inspector-tab")];
    const panels = [...right.querySelectorAll<HTMLElement>(".declared-view-panel")];
    expect(tabs).toHaveLength(2);
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(tabs.length);

    tabs.forEach((tab, i) => {
      const panel = panels[i]!;
      expect(tab.id).not.toBe("");
      expect(tab.getAttribute("role")).toBe("tab");
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    });
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true]);

    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false]);

    tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(tabs[0]);
  });
});

/// Ogni superficie che il contratto nomina è **classificata** da questa shell:
/// ospitata in un contenitore, aperta in un riquadro, o non ospitata con una
/// ragione da dire a chi ha scritto la view.
///
/// L'elenco non è scritto qui: si estrae dal mirror generato
/// (`host/enums.generated.ts`, decisione 0053), che viene dall'`enum` di
/// `fub-abi`. È la differenza che la §23.2 ha misurato — un presidio esaustivo
/// **per costruzione** invece che a memoria — ed è la ragione per cui questo
/// blocco esiste: il `switch` di `surfaceContainer` lo tiene già onesto il
/// compilatore, ma il compilatore non vede che tre superfici tornano `null` e
/// solo due hanno una ragione scritto. Quella terza è `main`, che è ospitata da
/// un riquadro e non da un contenitore, e la differenza fra «non ancora» e «non
/// si può» è tutta lì.
///
/// Chi aggiunge una superficie al contratto trova questo rosso prima di M5.
describe("ogni superficie del contratto è classificata", () => {
  /// Le superfici lette dal mirror, nell'ordine in cui il contratto le dichiara.
  const FROM_CONTRACT = [
    .../export type ViewSurface =([\s\S]*?);/.exec(generatedEnums)![1].matchAll(/"([a-z_]+)"/g),
  ].map((m) => m[1]);

  /// Dove finisce una view che dichiara quella superficie. `null` vuol dire che
  /// la shell non la ospita e lo **dice**, invece di perderla in silenzio.
  const EXPECTED: Record<string, string | null> = {
    left_sidebar: "views-left",
    right_sidebar: "views-right",
    bottom: "views-bottom",
    status_bar: "views-status",
    ribbon: "views-ribbon",
    modal: "views-modal",
    settings_tab: "views-settings",
    main: "riquadro",
    menu: "app-menu-extra",
    context_menu: null,
  };

  it("il mirror generato e questo banco parlano delle stesse superfici", () => {
    expect(FROM_CONTRACT.length).toBeGreaterThan(0);
    expect([...FROM_CONTRACT].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const surface of Object.keys(EXPECTED)) {
    const where = EXPECTED[surface];

    it(`\`${surface}\` finisce ${where === null ? "in un avviso con la sua ragione" : `in \`${where}\``}`, async () => {
      listViews.mockResolvedValueOnce([spec("prova", surface as ViewSpec["surface"])]);
      const views = await loadViews();
      await views.mountDeclaredViews();

      if (where === "riquadro") {
        // L'area principale si dichiara e aspetta: non è montata, è
        // **disponibile**. È la strada che la 0079 ha aperto e che la §23.2 ha
        // verificato esistere davvero — un riquadro tiene una view, non per
        // forza un documento.
        expect(views.primaryViews().map((s) => s.id)).toEqual(["prova"]);
        return;
      }

      expect(views.primaryViews()).toHaveLength(0);
      if (where === null) {
        // Non ospitata: nessun contenitore la prende, e nessuno la monta di
        // nascosto altrove.
        expect(renderView).not.toHaveBeenCalled();
        return;
      }
      // `#views-ribbon` ha un figlio permanente (`#rail-shell`, §Fase 2):
      // la view si aggiunge dopo, non lo sostituisce. `#views-right` ha titolo
      // + tablist dell'inspector sopra il pannello (U38: titolo testuale preso
      // dal registro, tab come selettore).
      const expectedChildren = where === "views-ribbon" ? 2 : where === "views-right" ? 3 : 1;
      expect(document.getElementById(where)!.children).toHaveLength(expectedChildren);
    });
  }
});

describe("un rimontaggio che non riesce", () => {
  it("non svuota la shell: si chiede prima e si smonta dopo", async () => {
    // Il difetto 0088, e il caso che lo rende grave è quello **senza nessuna
    // concorrenza**: un solo rigetto. Prima, `mountDeclaredViews` buttava giù
    // pannelli, alberi, mappe e i sette contenitori, e *poi* chiedeva l'elenco;
    // se la domanda falliva non c'era nessun `catch` da nessuna parte, e la
    // shell restava vuota per sempre — nemmeno un riquadro poteva più riaprire
    // una view principale, perché `primaryViews()` era diventata vuota.
    listViews.mockResolvedValueOnce([spec("tags", "left_sidebar"), spec("graph", "main")]);
    const views = await loadViews();
    await views.mountDeclaredViews();
    const beforeSidebar = document.querySelector("#views-left")!.childElementCount;
    expect(beforeSidebar).toBeGreaterThan(0);
    expect(views.primaryViews().map((s) => s.id)).toEqual(["graph"]);

    listViews.mockRejectedValueOnce(new Error("kernel in riavvio"));
    await expect(views.mountDeclaredViews()).rejects.toThrow("kernel in riavvio");

    // Vecchio, ma vivo: è la peggiore delle due cose che si possono avere e la
    // migliore delle due che si possono scegliere.
    expect(document.querySelector("#views-left")!.childElementCount).toBe(beforeSidebar);
    expect(views.primaryViews().map((s) => s.id)).toEqual(["graph"]);
  });

  it("due rimontaggi insieme: il vecchio non smonta ciò che il nuovo ha montato", async () => {
    // L'altra metà del 0088, quella che un token chiude. L'ordine di arrivo lo
    // decide il banco, non due latenze sperate.
    const views = await loadViews();
    let resolveOld!: (v: ViewSpec[]) => void;
    listViews.mockImplementationOnce(
      () =>
        new Promise<ViewSpec[]>((res) => {
          resolveOld = res;
        }),
    );
    const old = views.mountDeclaredViews();

    listViews.mockResolvedValueOnce([spec("tags", "left_sidebar")]);
    await views.mountDeclaredViews();
    const afterTheNewItem = document.querySelector("#views-left")!.innerHTML;

    // Il vecchio risponde adesso, con un elenco diverso: se arrivasse a montare,
    // smonterebbe prima tutto ciò che il nuovo ha appena messo.
    resolveOld([spec("backlinks", "left_sidebar"), spec("stats", "right_sidebar")]);
    await old;

    expect(document.querySelector("#views-left")!.innerHTML).toBe(afterTheNewItem);
    // U42: a destra non c'è nessuna vista, e l'ispettore lo dice con una
    // tablist di stato vuoto — un figlio, non zero.
    expect(document.querySelector("#views-right")!.childElementCount).toBe(1);
  });
});
describe("lifecycle delle view dichiarate", () => {
  it("un render vecchio non riscrive il contenitore dopo un rimontaggio", async () => {
    const views = await loadViews();
    let resolveOld!: (tree: UiNode) => void;
    renderView.mockImplementationOnce(
      () =>
        new Promise<UiNode>((resolve) => {
          resolveOld = resolve;
        }),
    );
    listViews.mockResolvedValueOnce([spec("tags", "left_sidebar")]);
    const oldMount = views.mountDeclaredViews();

    // Lascia che la prima discovery arrivi fino alla chiamata lenta al provider,
    // ma non aspettare `oldMount`: il suo render è deliberatamente in volo.
    for (let i = 0; i < 12 && renderView.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(renderView).toHaveBeenCalledTimes(1);

    listViews.mockResolvedValueOnce([spec("tags", "left_sidebar")]);
    renderView.mockResolvedValueOnce(emptyTree("nuovo"));
    await views.mountDeclaredViews();
    const host = document.querySelector("#views-left .declared-view")!;
    expect(host.textContent).toContain("nuovo");

    resolveOld(emptyTree("vecchio"));
    await oldMount;
    expect(host.textContent).toContain("nuovo");
    expect(host.textContent).not.toContain("vecchio");
  });

  it("chiudere il parent invalida un render differito e svuota il pannello", async () => {
    listViews.mockResolvedValueOnce([spec("tags", "left_sidebar")]);
    let resolveRender!: (tree: UiNode) => void;
    renderView.mockImplementationOnce(
      () =>
        new Promise<UiNode>((resolve) => {
          resolveRender = resolve;
        }),
    );
    const views = await loadViews();
    const parent = openLifetime();
    const mounting = views.mountDeclaredViews(parent);
    const host = document.getElementById("views-left")!;

    for (let i = 0; i < 12 && renderView.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(renderView).toHaveBeenCalledTimes(1);

    parent.close();
    expect(host.childElementCount).toBe(0);
    expect(views.primaryViews()).toEqual([]);
    const { registeredPanels } = await import("./panel-host");
    expect(registeredPanels()).toEqual([]);

    resolveRender(emptyTree("arrivato dopo la chiusura"));
    await mounting;
    expect(host.childElementCount).toBe(0);
    expect(host.textContent).not.toContain("arrivato dopo la chiusura");
    expect(registeredPanels()).toEqual([]);
  });

  it("un'azione tardiva non riscrive un riquadro chiuso e rimontato", async () => {
    listViews.mockResolvedValueOnce([spec("graph", "main")]);
    const views = await loadViews();
    await views.mountDeclaredViews();

    const oldTree: UiNode = {
      node: "list_item",
      title: "prima",
      subtitle: null,
      action: { action: "tardi", payload: null },
      selected: false,
    };
    const newTree = emptyTree("nuovo");
    const lateTree = emptyTree("tardivo");
    let resolveAction!: (update: ViewUpdate) => void;
    const actionResponse = new Promise<ViewUpdate>((resolve) => {
      resolveAction = resolve;
    });
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    renderView.mockImplementationOnce(async () => oldTree);
    viewAction.mockImplementationOnce(() => actionResponse);
    await views.mountViewInPane("graph", "same", pane);

    pane.querySelector<HTMLElement>(".ui-list-item")!.click();
    await Promise.resolve();
    expect(viewAction).toHaveBeenCalledTimes(1);
    views.unmountViewFromPane("graph", "same");

    renderView.mockImplementationOnce(async () => newTree);
    await views.mountViewInPane("graph", "same", pane);
    expect(pane.textContent).toContain("nuovo");

    resolveAction({ kind: "replace", root: lateTree });
    await Promise.resolve();
    await Promise.resolve();
    expect(pane.textContent).toContain("nuovo");
    expect(pane.textContent).not.toContain("tardivo");
  });

  it("la trappola modale appartiene al parent e si stacca a chiusura pagina", async () => {
    listViews.mockResolvedValueOnce([spec("confirm", "modal")]);
    const views = await loadViews();
    const parent = openLifetime();
    await views.mountDeclaredViews(parent);

    const modal = document.getElementById("views-modal")!;
    expect(modal.hidden).toBe(false);
    expect(modal.querySelector(".declared-view")).not.toBeNull();
    parent.close();

    expect(modal.hidden).toBe(true);
    expect(modal.childElementCount).toBe(0);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(modal.hidden).toBe(true);
  });
});
