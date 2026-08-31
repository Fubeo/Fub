// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Il centro notifiche si finge: qui interessa **che** la porta lo chiami e con
// che frase, non come disegna. Fingerlo tiene anche `ui/node` fuori dalla
// catena `state/kernel` → `host/ipc`, che in un banco del riconciliatore non
// c'entra niente.
const notify = vi.fn();
vi.mock("./notify", () => ({
  get notify() {
    return notify;
  },
}));
import type { ActionRef, FieldValue, UiNode } from "../host/contract";
import { pair, activeFields, mountTree, patchTree } from "./node";
import { registerCustomRenderer, type OnAction } from "./custom";

// La regola su cui poggia il §2.8, provata dove **può** essere sbagliata.
//
// Il riconciliatore fa due cose: decide quale elemento vecchio serve a quale
// nodo nuovo, e poi tocca il DOM. La prima è una funzione pura ed è quella che
// conta — se sbaglia, una riga riceve il contenuto di un'altra e con esso il
// focus, la selezione e lo scroll di qualcun altro. La seconda ha bisogno di un
// DOM e di un giro nell'app vera (§17.2), che è il debito dichiarato di questa
// shell.
//
// Le due letture da tenere a mente leggendo i casi: `{ riusa: i }` = "questo
// nodo nuovo è il vecchio in posizione i", `{ crea: true }` = "disegnalo da
// capo".
//
// Il secondo `describe` è invece la parte che tocca il DOM, e sta qui perché il
// difetto che presidia **non si vede** nella funzione pura: l'accoppiamento
// decide giusto, l'elemento si riusa giusto, e l'azione che quell'elemento
// manda è quella di ieri.

const K = (...keys: (string | undefined)[]) => keys;

describe("accoppiamento dei figli (§2.8)", () => {
  it("senza chiavi l'identità è la posizione", () => {
    expect(pair(K(undefined, undefined), K(undefined, undefined))).toEqual([
      { reuse: 0 },
      { reuse: 1 },
    ]);
  });

  it("una lista che si riordina sposta le righe invece di rimescolarne il contenuto", () => {
    // È IL caso del §2.8: le stesse tre righe in ordine diverso. Senza chiavi
    // ognuna riceverebbe i dati di un'altra.
    expect(pair(K("a", "b", "c"), K("c", "a", "b"))).toEqual([
      { reuse: 2 },
      { reuse: 0 },
      { reuse: 1 },
    ]);
  });

  it("una riga tolta di mezzo non sposta le altre", () => {
    expect(pair(K("a", "b", "c"), K("a", "c"))).toEqual([{ reuse: 0 }, { reuse: 2 }]);
  });

  it("una riga nuova si disegna, le vecchie restano loro stesse", () => {
    expect(pair(K("a", "b"), K("a", "nuova", "b"))).toEqual([
      { reuse: 0 },
      { create: true },
      { reuse: 1 },
    ]);
  });

  it("chiavi e non-chiavi non si rubano il posto a vicenda", () => {
    // La testata (senza chiave) e le righe (con chiave) convivono: la testata
    // riusa la testata, non la prima riga che capita.
    expect(pair(K(undefined, "a", "b"), K(undefined, "b", "a"))).toEqual([
      { reuse: 0 },
      { reuse: 2 },
      { reuse: 1 },
    ]);
  });

  it("i senza-chiave si accoppiano in ordine fra loro, saltando i chiavati", () => {
    expect(pair(K("a", undefined, undefined), K(undefined, undefined))).toEqual([
      { reuse: 1 },
      { reuse: 2 },
    ]);
  });

  it("una chiave doppia riusa una volta sola: il resto si disegna", () => {
    // Un albero malformato resta disegnabile — perde lo stato, che è il sintomo
    // giusto — invece di far saltare la view.
    expect(pair(K("a"), K("a", "a"))).toEqual([{ reuse: 0 }, { create: true }]);
    expect(pair(K("a", "a"), K("a"))).toEqual([{ reuse: 0 }]);
  });

  it("il primo giro disegna tutto, e svuotare non riusa niente", () => {
    expect(pair(K(), K("a", undefined))).toEqual([{ create: true }, { create: true }]);
    expect(pair(K("a", "b"), K())).toEqual([]);
  });

  it("una chiave che non c'era prima non ruba il posto di un'altra", () => {
    expect(pair(K("a", "b"), K("c", "d"))).toEqual([{ create: true }, { create: true }]);
  });
});

// Un campo riusato dal riconciliatore manda l'azione del nodo **nuovo**.
//
// La forma del difetto che questi casi difendono: gli ascoltatori si
// registravano una volta sola alla costruzione del campo, con l'`ActionRef`
// catturato nella chiusura, e la riconciliazione aggiornava il valore ma non
// l'azione. Il campo continuava a funzionare — mandava la cosa sbagliata, che è
// il modo peggiore di essere rotti.
//
// Ogni caso verifica **anche** che l'elemento sia lo stesso di prima: senza
// quella riga il presidio passerebbe a vuoto il giorno in cui qualcuno facesse
// ricostruire i campi invece di riusarli.
describe("l'azione di un campo riusato è quella del nodo nuovo (§2.8)", () => {
  const search = (action: string | null, value = ""): UiNode =>
    ({
      node: "text_input",
      field: "q",
      label: "Cerca",
      value,
      placeholder: null,
      action: action === null ? null : { action: action, payload: null },
    }) as UiNode;

  function reconciled(first: UiNode, after: UiNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mandate: string[] = [];
    const onAction = async (a: ActionRef) => {
      mandate.push(a.action);
    };
    mountTree(host, first, onAction);
    const input = host.querySelector("input")!;
    mountTree(host, after, onAction);
    // Se questo non è vero, tutto il resto del caso non prova niente.
    expect(host.querySelector("input")).toBe(input);
    return { input, mandate };
  }

  it("il cambio del valore manda l'azione nuova, non quella del primo disegno", () => {
    const { input, mandate } = reconciled(search("prima"), search("dopo"));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(mandate).toEqual(["dopo"]);
  });

  it("l'Invio manda l'azione nuova, non quella del primo disegno", () => {
    const { input, mandate } = reconciled(search("prima"), search("dopo"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(mandate).toEqual(["dopo"]);
  });

  it("riconciliare non accumula ascoltatori: un evento, un'azione", () => {
    // L'altra metà della stessa riparazione, e la diagnosi che era arrivata da
    // fuori: chi ribinda togliendo e rimettendo a mano sbaglia in un verso, chi
    // ribinda e basta sbaglia nell'altro. Qui si riconcilia tre volte.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mandate: string[] = [];
    const onAction = async (a: ActionRef) => {
      mandate.push(a.action);
    };
    mountTree(host, search("uno"), onAction);
    const input = host.querySelector("input")!;
    for (const action of ["due", "tre", "quattro"]) mountTree(host, search(action), onAction);
    expect(host.querySelector("input")).toBe(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(mandate).toEqual(["quattro", "quattro"]);
  });

  it("un campo che perde l'azione smette di mandarla", () => {
    const { input, mandate } = reconciled(search("prima"), search(null));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(mandate).toEqual([]);
  });

  it("un tasto che non è Invio non manda niente", () => {
    const { input, mandate } = reconciled(search("prima"), search("dopo"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(mandate).toEqual([]);
  });
});

// La stessa specie della 0118 **un piano più in su**: non l'azione di un nodo,
// ma l'`ActionHandler` di tutto l'albero.
//
// La coincidenza che teneva il difetto senza farlo mordere: `views.ts` fabbrica
// una chiusura nuova a ogni ridisegno, ma tutte catturano `id` e `montata`, che
// non cambiano — cioè sono oggetti diversi che fanno la stessa cosa. Nessuno
// l'aveva scritto e nessun attore lo verificava; il giorno che due montaggi
// dello stesso contenitore instradano davvero altrove, i due clienti qui sotto
// mandano al posto sbagliato.
//
// I casi montano lo stesso contenitore **due volte con due handler diversi** —
// ciò che nessun caso della 0118 fa, perché tutti riusano lo stesso `onAction`.
describe("chi instrada un albero riusato è il montaggio di adesso (§2.8)", () => {
  const field = (action: string): UiNode =>
    ({
      node: "text_input",
      field: "q",
      label: "Cerca",
      value: "",
      placeholder: null,
      key: "campo",
      action: { action: action, payload: null },
    }) as UiNode;

  const tree = (action: string): UiNode =>
    ({ node: "stack", dir: "column", gap: 4, children: [field(action)] }) as UiNode;

  /// Due montaggi dello stesso contenitore con due handler **distinti**, e i due
  /// registri separati per vedere dove è finita l'azione.
  function mountedTwice(first: UiNode, second: UiNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const old: string[] = [];
    const newItem: string[] = [];
    mountTree(host, first, async (a: ActionRef) => {
      old.push(a.action);
    });
    const input = host.querySelector("input");
    mountTree(host, second, async (a: ActionRef) => {
      newItem.push(a.action);
    });
    // Se il secondo montaggio ha ricostruito invece di riusare, il caso non
    // prova niente: il difetto vive solo nel riuso.
    expect(host.querySelector("input")).toBe(input);
    return { host, old, newItem };
  }

  it("un patch instrada al montaggio di adesso, non al primo", () => {
    const { host, old, newItem } = mountedTwice(tree("uno"), tree("due"));
    const input = host.querySelector("input")!;
    expect(patchTree(host, "campo", field("tre"))).toBe(true);
    expect(host.querySelector("input")).toBe(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(newItem).toEqual(["tre"]);
    // Il patch non riporta indietro ciò che la 0118 aveva rimesso a posto: un
    // handler ripescato risalendo dall'elemento è quello del **primo** disegno,
    // e riconciliare con lui riscriverebbe i legami del sottoalbero patchato.
    expect(old).toEqual([]);
  });

  it("una chiave ambigua non patcha il primo match: forza il full render", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const duplicate = (value: string): UiNode =>
      ({
        node: "stack",
        dir: "column",
        gap: 0,
        children: [
          { ...field(value), key: "doppia" },
          { ...field(value), key: "doppia" },
        ],
      }) as UiNode;

    mountTree(host, duplicate("prima"), async () => {});
    expect(patchTree(host, "doppia", { ...field("dopo"), key: "doppia" } as UiNode)).toBe(false);
    expect([...host.querySelectorAll("input")].map((input) => input.value)).toEqual([
      "prima",
      "prima",
    ]);
  });

  it("un renderer custom che sopravvive alla riconciliazione instrada al montaggio di adesso", () => {
    const NS = "prova.porta";
    const handlers: OnAction[] = [];
    registerCustomRenderer(NS, (_host, _payload, onAction) => {
      handlers.push(onAction);
    });
    const node = (): UiNode =>
      ({ node: "custom", ns: NS, payload: { n: 1 }, fallback: [] }) as UiNode;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const old: string[] = [];
    const newItem: string[] = [];
    mountTree(host, node(), async (a: ActionRef) => {
      old.push(a.action);
    });
    const el = host.querySelector(".ui-custom");
    mountTree(host, node(), async (a: ActionRef) => {
      newItem.push(a.action);
    });
    // Il payload non è cambiato: l'elemento resta, il widget dentro resta, e
    // resta la porta che il renderer si è tenuto. È il punto del caso.
    expect(host.querySelector(".ui-custom")).toBe(el);
    expect(handlers).toHaveLength(1);

    handlers[0]!({ action: "tocca", payload: null }, []);
    expect(newItem).toEqual(["tocca"]);
    expect(old).toEqual([]);
  });
});

// La 0118 sui **valori** invece che sulle azioni, e la sua metà mancante.
//
// Il riconciliatore riusava un campo e ne riscriveva a mano un **elenco** di
// attributi — il valore, l'azione, il testo dell'etichetta se c'era già —, e
// quell'elenco era per costruzione un secondo elenco accanto a quello che il
// disegno scrive: divergeva su `placeholder`, `rows`, `min`/`max`/`step`,
// `multiple`, le etichette delle opzioni, i valori delle opzioni di un `radio`,
// il nome del campo, l'etichetta che compare o sparisce, e il lettore del
// valore registrato da `valore`. Un campo riusato mostrava e mandava la forma
// di ieri, funzionando.
//
// Ogni caso verifica **anche** che il controllo sia lo stesso di prima: senza
// quella riga il presidio passerebbe a vuoto il giorno in cui il riconciliatore
// ricostruisse invece di riusare.
describe("un campo riusato è il nodo di adesso, tutto intero (§2.8)", () => {
  const SELECTOR = "input, textarea, select";

  function reused(first: UiNode, after: UiNode): HTMLElement {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onAction = async () => {};
    mountTree(host, first, onAction);
    const control = host.querySelector(SELECTOR);
    mountTree(host, after, onAction);
    expect(host.querySelector(SELECTOR)).toBe(control);
    return host;
  }

  /// Il campo, letto come lo leggerebbe un'azione che scatta adesso.
  const read = (host: HTMLElement) => activeFields(host.querySelector("[data-field]")!);

  const text = (over: Record<string, unknown>): UiNode =>
    ({
      node: "text_input",
      field: "q",
      label: "Cerca",
      value: "",
      placeholder: null,
      action: null,
      ...over,
    }) as UiNode;

  const number = (over: Record<string, unknown>): UiNode =>
    ({
      node: "number",
      field: "n",
      label: "Quanti",
      value: 1,
      min: null,
      max: null,
      step: null,
      action: null,
      ...over,
    }) as UiNode;

  const choice = (over: Record<string, unknown>): UiNode =>
    ({
      node: "select",
      field: "s",
      label: "Scegli",
      value: ["a"],
      options: [
        { value: "a", label: "Uno" },
        { value: "b", label: "Due" },
      ],
      multiple: false,
      action: null,
      ...over,
    }) as UiNode;

  const buttons = (over: Record<string, unknown>): UiNode =>
    ({
      node: "radio",
      field: "r",
      label: "Scegli",
      value: "a",
      options: [
        { value: "a", label: "Uno" },
        { value: "b", label: "Due" },
      ],
      action: null,
      ...over,
    }) as UiNode;

  it("il segnaposto è quello del nodo nuovo", () => {
    const host = reused(text({ placeholder: "prima" }), text({ placeholder: "dopo" }));
    expect(host.querySelector("input")!.placeholder).toBe("dopo");
  });

  it("un segnaposto che sparisce sparisce davvero", () => {
    const host = reused(text({ placeholder: "prima" }), text({ placeholder: null }));
    expect(host.querySelector("input")!.placeholder).toBe("");
  });

  it("gli estremi di un numero sono quelli del nodo nuovo", () => {
    const host = reused(
      number({ min: 0, max: 10, step: 1 }),
      number({ min: 5, max: 50, step: 5 }),
    );
    const input = host.querySelector("input")!;
    expect([input.min, input.max, input.step]).toEqual(["5", "50", "5"]);
  });

  it("le righe di un'area di testo sono quelle del nodo nuovo", () => {
    const area = (rows: number): UiNode =>
      ({ node: "text_area", field: "t", label: null, value: "", rows, action: null }) as UiNode;
    const host = reused(area(3), area(7));
    // `Number` perché `happy-dom` restituisce l'attributo com'è scritto, e in
    // un browser vero è già un numero: il presidio guarda il valore, non il
    // tipo che gli dà l'ambiente.
    expect(Number(host.querySelector("textarea")!.rows)).toBe(7);
  });

  it("un'etichetta che sparisce sparisce, e una che compare compare", () => {
    const via = reused(text({ label: "Cerca" }), text({ label: null }));
    expect(via.querySelector(".ui-field-label")).toBeNull();
    const appeared = reused(text({ label: null }), text({ label: "Cerca" }));
    const label = appeared.querySelector<HTMLLabelElement>("label.ui-field-label")!;
    expect(label.textContent).toBe("Cerca");
    // E l'etichetta arrivata **nomina** il campo: un `<label>` slegato è testo
    // che sembra un'etichetta e non lo è per chi non vede.
    expect(label.htmlFor).toBe(appeared.querySelector("input")!.id);
  });

  it("il nome del campo è quello del nodo nuovo", () => {
    const host = reused(text({ field: "prima" }), text({ field: "dopo" }));
    expect(read(host).map((f) => f.field)).toEqual(["dopo"]);
  });

  it("un select che diventa multiplo riporta una scelta multipla", () => {
    // Il caso del lettore invecchiato: la chiusura registrata da `valore`
    // catturava `node.multiple` al primo disegno, e un select diventato
    // multiplo continuava a riportare un `text`.
    const host = reused(choice({ multiple: false }), choice({ multiple: true }));
    expect(host.querySelector("select")!.multiple).toBe(true);
    expect(read(host)).toEqual([{ field: "s", value: { type: "choices", value: ["a"] } }]);
  });

  it("le etichette delle opzioni di un select sono quelle del nodo nuovo", () => {
    const host = reused(
      choice({}),
      choice({
        options: [
          { value: "a", label: "Primo" },
          { value: "b", label: "Secondo" },
        ],
      }),
    );
    const options = Array.from(host.querySelectorAll("option"));
    expect(options.map((o) => o.textContent)).toEqual(["Primo", "Secondo"]);
  });

  it("le opzioni di un radio sono quelle del nodo nuovo, valore compreso", () => {
    const host = reused(
      buttons({}),
      buttons({
        value: "x",
        options: [
          { value: "x", label: "Ics" },
          { value: "y", label: "Ipsilon" },
        ],
      }),
    );
    const choices = Array.from(host.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    expect(choices.map((i) => i.value)).toEqual(["x", "y"]);
    expect(choices.map((i) => i.checked)).toEqual([true, false]);
    expect(read(host)).toEqual([{ field: "r", value: { type: "text", value: "x" } }]);
  });
});

// A chi appartiene l'identità di un gruppo di radio.
//
// Era il **nome del campo**, cioè una stringa sola per tutto il documento: ogni
// `radio` con quel `field` finiva nello stesso gruppo nativo, dovunque fosse.
//
// La metà che `todo.md` nominava — *«due form con lo stesso `field` si
// deselezionano a vicenda»* — è **falsa**, e il caso qui sotto la tiene ferma:
// un gruppo di radio dentro un `<form>` il browser lo scopa già al form, per
// specifica, e la shell disegna un `form` vero. Vera è l'altra metà, che
// nessuno aveva guardato: due view **senza** form — due pannelli che mostrano
// lo stesso campo, che è la forma normale di una view — erano per il browser un
// gruppo solo.
//
// Il nome adesso è l'id del contenitore, cioè lo stesso elemento che porta
// `role="radiogroup"`: l'esclusività nativa e quella dichiarata sono lo stesso
// gruppo, o non sono niente.
describe("un gruppo di radio è il nodo che lo dichiara (§2.1)", () => {
  const choice = (): UiNode =>
    ({
      node: "radio",
      field: "r",
      label: "Scegli",
      value: null,
      options: [
        { value: "a", label: "Uno" },
        { value: "b", label: "Due" },
      ],
      action: null,
    }) as UiNode;

  const insideForm = (): UiNode =>
    ({
      node: "form",
      submit_label: "Vai",
      submit: { action: "vai", payload: null },
      children: [choice()],
    }) as UiNode;

  const mount = (node: UiNode) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountTree(host, node, async () => {});
    return host;
  };

  const choiceOf = (host: HTMLElement, value: string) =>
    host.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`)!;

  it("due view senza form con lo stesso campo non si deselezionano a vicenda", () => {
    const first = mount(choice());
    const second = mount(choice());

    choiceOf(first, "a").click();
    choiceOf(second, "b").click();

    expect(choiceOf(first, "a").checked).toBe(true);
    expect(activeFields(first.querySelector(".ui-radio")!)).toEqual([
      { field: "r", value: { type: "text", value: "a" } },
    ]);
  });

  it("e dentro un form non si deselezionavano già prima: il form è un gruppo", () => {
    const first = mount(insideForm());
    const second = mount(insideForm());

    choiceOf(first, "a").click();
    choiceOf(second, "b").click();

    expect(choiceOf(first, "a").checked).toBe(true);
  });
});

// Le linguette di un gruppo di schede sono un pezzo d'albero che non passa da
// `figli`: le disegna la shell, perché cambiare scheda è una piega e non serve
// un giro dal provider. Passavano da `barra.replaceChildren()`, cioè si
// ricostruivano tutte a ogni riconciliazione — che è precisamente ciò che il
// §2.8 esiste per non fare.
describe("le linguette di una barra di schede si riusano (§2.8)", () => {
  const tabs = (action: string, label = "Prima"): UiNode =>
    ({
      node: "tabs",
      active: 0,
      tabs: [
        {
          node: "tab",
          label: label,
          action: { action: action, payload: null },
          children: [{ node: "text", content: "uno" }],
        },
        { node: "tab", label: "Seconda", action: null, children: [{ node: "text", content: "due" }] },
      ],
    }) as UiNode;

  const withField = (): UiNode =>
    ({
      node: "tabs",
      active: 0,
      tabs: [
        {
          node: "tab",
          label: "Prima",
          action: { action: "apri", payload: null },
          children: [
            {
              node: "text_input",
              field: "q",
              label: "Cerca",
              value: "gatto",
              placeholder: null,
              action: null,
            },
          ],
        },
      ],
    }) as UiNode;

  function mounted(first: UiNode, after: UiNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mandate: string[] = [];
    const onAction = async (a: ActionRef) => {
      mandate.push(a.action);
    };
    mountTree(host, first, onAction);
    const tab = host.querySelector<HTMLButtonElement>(".ui-tab-button")!;
    tab.focus();
    mountTree(host, after, onAction);
    return { host, tab, mandate };
  }

  it("chi ci sta sopra col tab non perde il fuoco", () => {
    const { host, tab } = mounted(tabs("apri"), tabs("apri"));
    expect(host.querySelector(".ui-tab-button")).toBe(tab);
    expect(document.activeElement).toBe(tab);
  });

  it("l'etichetta è quella del nodo nuovo", () => {
    const { host } = mounted(tabs("apri", "Prima"), tabs("apri", "Terza"));
    expect(host.querySelector(".ui-tab-button")!.textContent).toBe("Terza");
  });

  it("una linguetta riusata manda l'azione del nodo nuovo", () => {
    // Il presidio della forma, non del difetto: finché le linguette si
    // ricostruivano, la chiusura che catturava `tab` era per forza fresca. Chi
    // le riusa senza passare da `ascolta` la fa invecchiare, ed è lo stesso
    // difetto della 0118 in un ramo che quella voce aveva lasciato scoperto.
    const { host, tab, mandate } = mounted(tabs("prima"), tabs("dopo"));
    expect(host.querySelector(".ui-tab-button")).toBe(tab);
    tab.click();
    expect(mandate).toEqual(["dopo"]);
  });

  it("e la manda coi campi in vigore, che una linguetta non è un nodo", () => {
    // Una linguetta è scocca, non un nodo disegnato: chi cerca la radice
    // dell'albero partendo da lei non la trova al primo passo, e prima di
    // guardare più su l'azione partiva **senza campi**.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const fields: FieldValue[][] = [];
    mountTree(host, withField(), async (_a: ActionRef, f: FieldValue[]) => {
      fields.push(f);
    });
    host.querySelector<HTMLElement>(".ui-tab-button")!.click();
    expect(fields).toEqual([[{ field: "q", value: { type: "text", value: "gatto" } }]]);
  });
});

// ---------------------------------------------------------------------------
// Un'azione che va storta lo dice (§20.4, decisione 0080)
// ---------------------------------------------------------------------------

describe("un'azione che va storta lo dice, e lo dice alla porta (§20.4)", () => {
  const field = (action: string): UiNode =>
    ({
      node: "text_input",
      field: "q",
      label: "Cerca",
      value: "",
      placeholder: null,
      key: "campo",
      action: { action: action, payload: null },
    }) as UiNode;

  /// Monta un albero il cui handler va storto nel modo chiesto, fa scattare
  /// l'azione, e lascia svuotare la coda dei microtask: una promessa rifiutata
  /// non si vede nello stesso giro in cui nasce.
  async function triggerAction(handler: () => void | Promise<void>): Promise<void> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountTree(host, field("mostra.tutto"), handler);
    host.querySelector("input")!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    notify.mockClear();
  });

  /// I due modi in cui un handler va storto sono due e nessuno prende l'altro.
  /// Un `throw` sincrono — che nel giro vero è una `TypeError` di qua dal
  /// confine — non arriva mai a una `.catch`.
  it("un handler che pania lo dice, con il nome dell'azione", async () => {
    await triggerAction(() => {
      throw new Error("qualcosa di qua dal confine");
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const [phrase, tone] = notify.mock.calls[0]!;
    expect(tone).toBe("guasto");
    expect(phrase).toContain("mostra.tutto");
    expect(phrase).toContain("qualcosa di qua dal confine");
  });

  /// E il verso opposto: un `view_action` che torna con un errore del backend è
  /// una **promessa rifiutata**, che non passa da un `try` già uscito. È il caso
  /// che il difetto misurato nominava, e la frase la compone `errorText` — cioè
  /// il `message` del `PluginError`, non `[object Object]`.
  it("una promessa rifiutata lo dice, con il messaggio del contratto", async () => {
    await triggerAction(() => Promise.reject({ kind: "Internal", message: "il provider è caduto" }));
    expect(notify).toHaveBeenCalledTimes(1);
    const [phrase] = notify.mock.calls[0]!;
    expect(phrase).toContain("mostra.tutto");
    expect(phrase).toContain("il provider è caduto");
  });

  /// La metà che tiene ferma la prova: un'azione che riesce **non** dice niente.
  /// Senza questo caso, un `notify` messo su ogni azione passerebbe i due casi
  /// qui sopra e riempirebbe il centro notifiche di successi.
  it("un'azione che riesce non dice niente", async () => {
    await triggerAction(async () => {});
    expect(notify).not.toHaveBeenCalled();
  });
});
