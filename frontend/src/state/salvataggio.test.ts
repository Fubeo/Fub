// Lo stato del salvataggio (§20.4), provato dove sta la decisione: in una
// funzione pura.
//
// Il resto — il testo nella barra, il momento in cui si ridisegna — è DOM, e il
// DOM non è dove questo si sbaglia. Ciò che si sbaglia è la **precedenza fra i
// due fatti**: un buffer sporco e un'ultima scrittura fallita sono veri insieme,
// e leggerli nell'ordine sbagliato vuol dire che la battuta successiva nasconde
// il guasto — cioè esattamente il difetto che questa voce esiste per togliere,
// rimesso al suo posto da un'altra parte.
import { describe, expect, it } from "vitest";
import { cambioSotto, statoDi } from "./salvataggio";

describe("lo stato del salvataggio", () => {
  it("non dice niente di un documento che non ha un buffer", () => {
    expect(statoDi(undefined)).toBeNull();
  });

  it("è «salvato» quando non c'è niente da scrivere e l'ultima scrittura è arrivata", () => {
    expect(statoDi({ dirty: false, esito: "ok" })).toBe("salvato");
  });

  it("è «non salvato» finché la scrittura non è partita", () => {
    expect(statoDi({ dirty: true, esito: "ok" })).toBe("non_salvato");
  });

  it("dice che sta scrivendo mentre scrive", () => {
    expect(statoDi({ dirty: true, esito: "in_corso" })).toBe("in_corso");
  });

  // Le due che contano.
  it("tiene il guasto anche se l'utente ha continuato a scrivere", () => {
    expect(statoDi({ dirty: true, esito: "fallito" })).toBe("fallito");
  });

  it("tiene il guasto anche a buffer pulito", () => {
    // È il caso che prima non aveva nome: il buffer non ha modifiche in attesa
    // perché nessuna nuova battuta è arrivata, e il testo su disco è comunque
    // vecchio. Dirlo «salvato» sarebbe la bugia peggiore che questa barra possa
    // dire.
    expect(statoDi({ dirty: false, esito: "fallito" })).toBe("fallito");
  });
});

describe("chi ha riscritto il file sotto un buffer sporco", () => {
  it("a buffer pulito non c'è niente da dire", () => {
    expect(cambioSotto({ dirty: false, echi: 0 }, false)).toBe("muto");
    expect(cambioSotto({ dirty: false, echi: 0 }, true)).toBe("muto");
    expect(cambioSotto(undefined, true)).toBe("muto");
  });

  it("riconosce l'eco del proprio salvataggio", () => {
    // Il caso che si vedeva scrivendo: autosave, si continua a battere, il
    // buffer torna sporco, e l'evento della nostra scrittura arriva adesso.
    expect(cambioSotto({ dirty: true, echi: 1 }, false)).toBe("eco");
  });

  it("un'altra applicazione non è mai un eco, nemmeno con echi in attesa", () => {
    // L'invariante: se il contatore restasse alto per un evento perso, non deve
    // poter zittire il caso in cui il lavoro coperto non è nostro.
    expect(cambioSotto({ dirty: true, echi: 3 }, true)).toBe("altra_app");
  });

  it("senza echi in attesa, un cambio non nostro è una riscrittura", () => {
    expect(cambioSotto({ dirty: true, echi: 0 }, false)).toBe("riscrittura");
  });
});
