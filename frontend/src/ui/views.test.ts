// @vitest-environment happy-dom
// **Un pannello non è una view**, e per sette superfici su otto le due cose si
// chiamano uguale.
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
import type { ViewSpec } from "../host/contract";

const renderView = vi.fn(async () => ({ node: "empty_state", label: "vuoto", key: null }));
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
  },
}));
// `panels/document` tira dentro CodeMirror e mezza shell: di lui qui serve la
// sola cosa che `ui/views` gli chiede.
vi.mock("../panels/document", () => ({ flushPendingSave: async () => {} }));

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
/// scritta a mano andrebbe tenuta d'accordo con `index.html`, cioè sarebbe una
/// seconda copia di ciò che questo test dovrebbe verificare. Presa così, se
/// qualcuno toglie un `id` dal documento il rosso arriva qui.
const CORPO = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)![1];

function preparaDom(): void {
  // Via gli `<script>`: qui i moduli li carica vitest, e un `type="module"`
  // dentro `innerHTML` non parte comunque.
  document.body.innerHTML = CORPO.replace(/<script[\s\S]*?<\/script>/gi, "");
}

async function moduli() {
  return await import("./views");
}

beforeEach(() => {
  vi.resetModules();
  renderView.mockClear();
  viewAction.mockClear();
  preparaDom();
});

describe("una view dell'area principale", () => {
  it("non si monta all'avvio: aspetta un riquadro", async () => {
    listViews.mockResolvedValueOnce([spec("graph", "main")]);
    const views = await moduli();
    await views.mountDeclaredViews();

    // Nessun contenitore della shell l'ha presa, e nessuno l'ha chiesta al
    // kernel: un riquadro non è un posto che si riempie da solo.
    expect(renderView).not.toHaveBeenCalled();
    expect(document.getElementById("views-left")!.children).toHaveLength(0);
    // …ma è **disponibile**, col titolo che finirà sulla tab.
    expect(views.viewPrincipali().map((s) => s.id)).toEqual(["graph"]);
    expect(views.viewPrincipale("graph")?.title).toBe("graph");
  });

  // La prova che mancava, ed è quella che il grafo vuoto ha fatto scoprire a
  // mano: al kernel si nomina la **view**, non il pannello.
  it("montata in un riquadro, chiede al kernel la view e non il pannello", async () => {
    listViews.mockResolvedValueOnce([spec("graph", "main")]);
    const views = await moduli();
    await views.mountDeclaredViews();

    const riquadro = document.createElement("div");
    document.body.appendChild(riquadro);
    await views.montaVistaInRiquadro("graph", "main", riquadro);

    expect(renderView).toHaveBeenCalledWith("graph", "main", null);
  });

  // L'esemplare **è** il riquadro: è la stessa identità che il `ViewContext`
  // porta di là dal confine, quindi lo stato di vista si separa esattamente
  // dove l'utente vede due cose.
  it("due riquadri sono due esemplari della stessa view", async () => {
    listViews.mockResolvedValueOnce([spec("graph", "main")]);
    const views = await moduli();
    await views.mountDeclaredViews();

    const uno = document.createElement("div");
    const due = document.createElement("div");
    document.body.append(uno, due);
    await views.montaVistaInRiquadro("graph", "main", uno);
    await views.montaVistaInRiquadro("graph", "pane-2", due);

    expect(renderView.mock.calls).toEqual([
      ["graph", "main", null],
      ["graph", "pane-2", null],
    ]);
  });

  it("una view che nessuno dichiara non si monta", async () => {
    listViews.mockResolvedValueOnce([]);
    const views = await moduli();
    await views.mountDeclaredViews();

    const riquadro = document.createElement("div");
    document.body.appendChild(riquadro);
    await views.montaVistaInRiquadro("graph", "main", riquadro);
    expect(renderView).not.toHaveBeenCalled();
  });
});

describe("le superfici che questa shell ospita da sé", () => {
  it("una view di sidebar si monta all'avvio, e pannello e view si chiamano uguale", async () => {
    listViews.mockResolvedValueOnce([spec("tags", "left_sidebar")]);
    const views = await moduli();
    await views.mountDeclaredViews();

    expect(renderView).toHaveBeenCalledWith("tags", "tags", null);
    expect(document.getElementById("views-left")!.children).toHaveLength(1);
  });
});
