// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { ActionRef, FieldValue, UiNode } from "../host/contract";
import { accoppia, campiInVigore, mountTree, patchTree } from "./node";
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

const K = (...chiavi: (string | undefined)[]) => chiavi;

describe("accoppiamento dei figli (§2.8)", () => {
  it("senza chiavi l'identità è la posizione", () => {
    expect(accoppia(K(undefined, undefined), K(undefined, undefined))).toEqual([
      { riusa: 0 },
      { riusa: 1 },
    ]);
  });

  it("una lista che si riordina sposta le righe invece di rimescolarne il contenuto", () => {
    // È IL caso del §2.8: le stesse tre righe in ordine diverso. Senza chiavi
    // ognuna riceverebbe i dati di un'altra.
    expect(accoppia(K("a", "b", "c"), K("c", "a", "b"))).toEqual([
      { riusa: 2 },
      { riusa: 0 },
      { riusa: 1 },
    ]);
  });

  it("una riga tolta di mezzo non sposta le altre", () => {
    expect(accoppia(K("a", "b", "c"), K("a", "c"))).toEqual([{ riusa: 0 }, { riusa: 2 }]);
  });

  it("una riga nuova si disegna, le vecchie restano loro stesse", () => {
    expect(accoppia(K("a", "b"), K("a", "nuova", "b"))).toEqual([
      { riusa: 0 },
      { crea: true },
      { riusa: 1 },
    ]);
  });

  it("chiavi e non-chiavi non si rubano il posto a vicenda", () => {
    // La testata (senza chiave) e le righe (con chiave) convivono: la testata
    // riusa la testata, non la prima riga che capita.
    expect(accoppia(K(undefined, "a", "b"), K(undefined, "b", "a"))).toEqual([
      { riusa: 0 },
      { riusa: 2 },
      { riusa: 1 },
    ]);
  });

  it("i senza-chiave si accoppiano in ordine fra loro, saltando i chiavati", () => {
    expect(accoppia(K("a", undefined, undefined), K(undefined, undefined))).toEqual([
      { riusa: 1 },
      { riusa: 2 },
    ]);
  });

  it("una chiave doppia riusa una volta sola: il resto si disegna", () => {
    // Un albero malformato resta disegnabile — perde lo stato, che è il sintomo
    // giusto — invece di far saltare la view.
    expect(accoppia(K("a"), K("a", "a"))).toEqual([{ riusa: 0 }, { crea: true }]);
    expect(accoppia(K("a", "a"), K("a"))).toEqual([{ riusa: 0 }]);
  });

  it("il primo giro disegna tutto, e svuotare non riusa niente", () => {
    expect(accoppia(K(), K("a", undefined))).toEqual([{ crea: true }, { crea: true }]);
    expect(accoppia(K("a", "b"), K())).toEqual([]);
  });

  it("una chiave che non c'era prima non ruba il posto di un'altra", () => {
    expect(accoppia(K("a", "b"), K("c", "d"))).toEqual([{ crea: true }, { crea: true }]);
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
  const cerca = (azione: string | null, value = ""): UiNode =>
    ({
      node: "text_input",
      field: "q",
      label: "Cerca",
      value,
      placeholder: null,
      action: azione === null ? null : { action: azione, payload: null },
    }) as UiNode;

  function riconciliato(prima: UiNode, dopo: UiNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mandate: string[] = [];
    const onAction = async (a: ActionRef) => {
      mandate.push(a.action);
    };
    mountTree(host, prima, onAction);
    const input = host.querySelector("input")!;
    mountTree(host, dopo, onAction);
    // Se questo non è vero, tutto il resto del caso non prova niente.
    expect(host.querySelector("input")).toBe(input);
    return { input, mandate };
  }

  it("il cambio del valore manda l'azione nuova, non quella del primo disegno", () => {
    const { input, mandate } = riconciliato(cerca("prima"), cerca("dopo"));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(mandate).toEqual(["dopo"]);
  });

  it("l'Invio manda l'azione nuova, non quella del primo disegno", () => {
    const { input, mandate } = riconciliato(cerca("prima"), cerca("dopo"));
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
    mountTree(host, cerca("uno"), onAction);
    const input = host.querySelector("input")!;
    for (const azione of ["due", "tre", "quattro"]) mountTree(host, cerca(azione), onAction);
    expect(host.querySelector("input")).toBe(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(mandate).toEqual(["quattro", "quattro"]);
  });

  it("un campo che perde l'azione smette di mandarla", () => {
    const { input, mandate } = riconciliato(cerca("prima"), cerca(null));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(mandate).toEqual([]);
  });

  it("un tasto che non è Invio non manda niente", () => {
    const { input, mandate } = riconciliato(cerca("prima"), cerca("dopo"));
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
  const campo = (azione: string): UiNode =>
    ({
      node: "text_input",
      field: "q",
      label: "Cerca",
      value: "",
      placeholder: null,
      key: "campo",
      action: { action: azione, payload: null },
    }) as UiNode;

  const albero = (azione: string): UiNode =>
    ({ node: "stack", dir: "column", gap: 4, children: [campo(azione)] }) as UiNode;

  /// Due montaggi dello stesso contenitore con due handler **distinti**, e i due
  /// registri separati per vedere dove è finita l'azione.
  function montatoDueVolte(primo: UiNode, secondo: UiNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const vecchio: string[] = [];
    const nuovo: string[] = [];
    mountTree(host, primo, async (a: ActionRef) => {
      vecchio.push(a.action);
    });
    const input = host.querySelector("input");
    mountTree(host, secondo, async (a: ActionRef) => {
      nuovo.push(a.action);
    });
    // Se il secondo montaggio ha ricostruito invece di riusare, il caso non
    // prova niente: il difetto vive solo nel riuso.
    expect(host.querySelector("input")).toBe(input);
    return { host, vecchio, nuovo };
  }

  it("un patch instrada al montaggio di adesso, non al primo", () => {
    const { host, vecchio, nuovo } = montatoDueVolte(albero("uno"), albero("due"));
    const input = host.querySelector("input")!;
    expect(patchTree(host, "campo", campo("tre"))).toBe(true);
    expect(host.querySelector("input")).toBe(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(nuovo).toEqual(["tre"]);
    // Il patch non riporta indietro ciò che la 0118 aveva rimesso a posto: un
    // handler ripescato risalendo dall'elemento è quello del **primo** disegno,
    // e riconciliare con lui riscriverebbe i legami del sottoalbero patchato.
    expect(vecchio).toEqual([]);
  });

  it("un renderer custom che sopravvive alla riconciliazione instrada al montaggio di adesso", () => {
    const NS = "prova.porta";
    const porte: OnAction[] = [];
    registerCustomRenderer(NS, (_host, _payload, onAction) => {
      porte.push(onAction);
    });
    const nodo = (): UiNode =>
      ({ node: "custom", ns: NS, payload: { n: 1 }, fallback: [] }) as UiNode;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const vecchio: string[] = [];
    const nuovo: string[] = [];
    mountTree(host, nodo(), async (a: ActionRef) => {
      vecchio.push(a.action);
    });
    const el = host.querySelector(".ui-custom");
    mountTree(host, nodo(), async (a: ActionRef) => {
      nuovo.push(a.action);
    });
    // Il payload non è cambiato: l'elemento resta, il widget dentro resta, e
    // resta la porta che il renderer si è tenuto. È il punto del caso.
    expect(host.querySelector(".ui-custom")).toBe(el);
    expect(porte).toHaveLength(1);

    porte[0]!({ action: "tocca", payload: null }, []);
    expect(nuovo).toEqual(["tocca"]);
    expect(vecchio).toEqual([]);
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
  const SELETTORE = "input, textarea, select";

  function riusato(prima: UiNode, dopo: UiNode): HTMLElement {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onAction = async () => {};
    mountTree(host, prima, onAction);
    const controllo = host.querySelector(SELETTORE);
    mountTree(host, dopo, onAction);
    expect(host.querySelector(SELETTORE)).toBe(controllo);
    return host;
  }

  /// Il campo, letto come lo leggerebbe un'azione che scatta adesso.
  const letto = (host: HTMLElement) => campiInVigore(host.querySelector("[data-campo]")!);

  const testo = (over: Record<string, unknown>): UiNode =>
    ({
      node: "text_input",
      field: "q",
      label: "Cerca",
      value: "",
      placeholder: null,
      action: null,
      ...over,
    }) as UiNode;

  const numero = (over: Record<string, unknown>): UiNode =>
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

  const scelta = (over: Record<string, unknown>): UiNode =>
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

  const bottoni = (over: Record<string, unknown>): UiNode =>
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
    const host = riusato(testo({ placeholder: "prima" }), testo({ placeholder: "dopo" }));
    expect(host.querySelector("input")!.placeholder).toBe("dopo");
  });

  it("un segnaposto che sparisce sparisce davvero", () => {
    const host = riusato(testo({ placeholder: "prima" }), testo({ placeholder: null }));
    expect(host.querySelector("input")!.placeholder).toBe("");
  });

  it("gli estremi di un numero sono quelli del nodo nuovo", () => {
    const host = riusato(
      numero({ min: 0, max: 10, step: 1 }),
      numero({ min: 5, max: 50, step: 5 }),
    );
    const input = host.querySelector("input")!;
    expect([input.min, input.max, input.step]).toEqual(["5", "50", "5"]);
  });

  it("le righe di un'area di testo sono quelle del nodo nuovo", () => {
    const area = (rows: number): UiNode =>
      ({ node: "text_area", field: "t", label: null, value: "", rows, action: null }) as UiNode;
    const host = riusato(area(3), area(7));
    // `Number` perché `happy-dom` restituisce l'attributo com'è scritto, e in
    // un browser vero è già un numero: il presidio guarda il valore, non il
    // tipo che gli dà l'ambiente.
    expect(Number(host.querySelector("textarea")!.rows)).toBe(7);
  });

  it("un'etichetta che sparisce sparisce, e una che compare compare", () => {
    const via = riusato(testo({ label: "Cerca" }), testo({ label: null }));
    expect(via.querySelector(".ui-field-label")).toBeNull();
    const arriva = riusato(testo({ label: null }), testo({ label: "Cerca" }));
    const etichetta = arriva.querySelector<HTMLLabelElement>("label.ui-field-label")!;
    expect(etichetta.textContent).toBe("Cerca");
    // E l'etichetta arrivata **nomina** il campo: un `<label>` slegato è testo
    // che sembra un'etichetta e non lo è per chi non vede.
    expect(etichetta.htmlFor).toBe(arriva.querySelector("input")!.id);
  });

  it("il nome del campo è quello del nodo nuovo", () => {
    const host = riusato(testo({ field: "prima" }), testo({ field: "dopo" }));
    expect(letto(host).map((f) => f.field)).toEqual(["dopo"]);
  });

  it("un select che diventa multiplo riporta una scelta multipla", () => {
    // Il caso del lettore invecchiato: la chiusura registrata da `valore`
    // catturava `node.multiple` al primo disegno, e un select diventato
    // multiplo continuava a riportare un `text`.
    const host = riusato(scelta({ multiple: false }), scelta({ multiple: true }));
    expect(host.querySelector("select")!.multiple).toBe(true);
    expect(letto(host)).toEqual([{ field: "s", value: { type: "choices", value: ["a"] } }]);
  });

  it("le etichette delle opzioni di un select sono quelle del nodo nuovo", () => {
    const host = riusato(
      scelta({}),
      scelta({
        options: [
          { value: "a", label: "Primo" },
          { value: "b", label: "Secondo" },
        ],
      }),
    );
    const opzioni = Array.from(host.querySelectorAll("option"));
    expect(opzioni.map((o) => o.textContent)).toEqual(["Primo", "Secondo"]);
  });

  it("le opzioni di un radio sono quelle del nodo nuovo, valore compreso", () => {
    const host = riusato(
      bottoni({}),
      bottoni({
        value: "x",
        options: [
          { value: "x", label: "Ics" },
          { value: "y", label: "Ipsilon" },
        ],
      }),
    );
    const scelte = Array.from(host.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    expect(scelte.map((i) => i.value)).toEqual(["x", "y"]);
    expect(scelte.map((i) => i.checked)).toEqual([true, false]);
    expect(letto(host)).toEqual([{ field: "r", value: { type: "text", value: "x" } }]);
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
  const scelta = (): UiNode =>
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

  const dentroUnForm = (): UiNode =>
    ({
      node: "form",
      submit_label: "Vai",
      submit: { action: "vai", payload: null },
      children: [scelta()],
    }) as UiNode;

  const monta = (nodo: UiNode) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountTree(host, nodo, async () => {});
    return host;
  };

  const sceltaDi = (host: HTMLElement, valore: string) =>
    host.querySelector<HTMLInputElement>(`input[type=radio][value="${valore}"]`)!;

  it("due view senza form con lo stesso campo non si deselezionano a vicenda", () => {
    const primo = monta(scelta());
    const secondo = monta(scelta());

    sceltaDi(primo, "a").click();
    sceltaDi(secondo, "b").click();

    expect(sceltaDi(primo, "a").checked).toBe(true);
    expect(campiInVigore(primo.querySelector(".ui-radio")!)).toEqual([
      { field: "r", value: { type: "text", value: "a" } },
    ]);
  });

  it("e dentro un form non si deselezionavano già prima: il form è un gruppo", () => {
    const primo = monta(dentroUnForm());
    const secondo = monta(dentroUnForm());

    sceltaDi(primo, "a").click();
    sceltaDi(secondo, "b").click();

    expect(sceltaDi(primo, "a").checked).toBe(true);
  });
});

// Le linguette di un gruppo di schede sono un pezzo d'albero che non passa da
// `figli`: le disegna la shell, perché cambiare scheda è una piega e non serve
// un giro dal provider. Passavano da `barra.replaceChildren()`, cioè si
// ricostruivano tutte a ogni riconciliazione — che è precisamente ciò che il
// §2.8 esiste per non fare.
describe("le linguette di una barra di schede si riusano (§2.8)", () => {
  const schede = (azione: string, etichetta = "Prima"): UiNode =>
    ({
      node: "tabs",
      active: 0,
      tabs: [
        {
          node: "tab",
          label: etichetta,
          action: { action: azione, payload: null },
          children: [{ node: "text", content: "uno" }],
        },
        { node: "tab", label: "Seconda", action: null, children: [{ node: "text", content: "due" }] },
      ],
    }) as UiNode;

  const conCampo = (): UiNode =>
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

  function montato(prima: UiNode, dopo: UiNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mandate: string[] = [];
    const onAction = async (a: ActionRef) => {
      mandate.push(a.action);
    };
    mountTree(host, prima, onAction);
    const linguetta = host.querySelector<HTMLButtonElement>(".ui-tab-button")!;
    linguetta.focus();
    mountTree(host, dopo, onAction);
    return { host, linguetta, mandate };
  }

  it("chi ci sta sopra col tab non perde il fuoco", () => {
    const { host, linguetta } = montato(schede("apri"), schede("apri"));
    expect(host.querySelector(".ui-tab-button")).toBe(linguetta);
    expect(document.activeElement).toBe(linguetta);
  });

  it("l'etichetta è quella del nodo nuovo", () => {
    const { host } = montato(schede("apri", "Prima"), schede("apri", "Terza"));
    expect(host.querySelector(".ui-tab-button")!.textContent).toBe("Terza");
  });

  it("una linguetta riusata manda l'azione del nodo nuovo", () => {
    // Il presidio della forma, non del difetto: finché le linguette si
    // ricostruivano, la chiusura che catturava `tab` era per forza fresca. Chi
    // le riusa senza passare da `ascolta` la fa invecchiare, ed è lo stesso
    // difetto della 0118 in un ramo che quella voce aveva lasciato scoperto.
    const { host, linguetta, mandate } = montato(schede("prima"), schede("dopo"));
    expect(host.querySelector(".ui-tab-button")).toBe(linguetta);
    linguetta.click();
    expect(mandate).toEqual(["dopo"]);
  });

  it("e la manda coi campi in vigore, che una linguetta non è un nodo", () => {
    // Una linguetta è scocca, non un nodo disegnato: chi cerca la radice
    // dell'albero partendo da lei non la trova al primo passo, e prima di
    // guardare più su l'azione partiva **senza campi**.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const campi: FieldValue[][] = [];
    mountTree(host, conCampo(), async (_a: ActionRef, f: FieldValue[]) => {
      campi.push(f);
    });
    host.querySelector<HTMLElement>(".ui-tab-button")!.click();
    expect(campi).toEqual([[{ field: "q", value: { type: "text", value: "gatto" } }]]);
  });
});
