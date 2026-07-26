import { describe, expect, it } from "vitest";
import { accoppia } from "./node";

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
