// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { ActionRef, UiNode } from "../host/contract";
import { accoppia, mountTree } from "./node";

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
