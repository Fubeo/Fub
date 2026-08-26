// @vitest-environment happy-dom
//
// Il presidio della `Lifetime`, e la metà che il conto non vede.
//
// `.github/scripts/check-ascoltatori.mjs` prende una domanda sola — *nessuno
// registra su `document` scavalcando la porta* — e la prende leggendo del testo.
// Quello che non può prendere è se la porta **funziona**: che chiudere una vita
// stacchi davvero, che chiuderla due volte non disfi due volte, e soprattutto
// che registrare *dopo* la chiusura non registri niente, che è il ramo da cui
// entrava il difetto del menu contestuale.
//
// Ogni prova è costruita, non aspettata: si emette l'evento e si guarda chi
// risponde. Un ascoltatore che non c'è più non si dimostra col tempo.
import { beforeEach, describe, expect, it } from "vitest";
import { openLifetime } from "./lifetime";

describe("Lifetime", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("chiudere stacca l'ascoltatore", () => {
    const lifetime = openLifetime();
    let hits = 0;
    lifetime.listen(document, "click", () => hits++);

    document.dispatchEvent(new MouseEvent("click"));
    expect(hits).toBe(1);

    lifetime.close();
    document.dispatchEvent(new MouseEvent("click"));
    expect(hits).toBe(1);
  });

  // Non c'è, e la riga che dice perché vale più della prova: *le opzioni
  // tornano identiche allo smontaggio* era scritto, passava, e sarebbe passata
  // anche togliendo `opzioni` dal `removeEventListener` — `happy-dom` stacca un
  // ascoltatore in cattura anche se glielo si chiede senza. In un browser vero
  // sarebbe stata rossa, qui era un presidio a vuoto: la specie che questo repo
  // ha già incontrato più di dodici volte, scritto per difendersene. La
  // proprietà la tiene la forma di `ascolta` — una variabile letta due volte —
  // e il commento accanto.

  it("su una vita chiusa non si registra niente", () => {
    // Il ramo del menu contestuale: `setTimeout(() => vita.ascolta(…), 0)` che
    // scatta dopo che Escape ha già chiuso il menu. Senza questa riga
    // l'ascoltatore si attaccava a un menu che non c'era più e restava lì.
    const lifetime = openLifetime();
    lifetime.close();
    let hits = 0;
    lifetime.listen(document, "click", () => hits++);

    document.dispatchEvent(new MouseEvent("click"));
    expect(hits).toBe(0);
  });

  it("su una vita chiusa uno smontaggio si esegue subito", () => {
    const lifetime = openLifetime();
    lifetime.close();
    let undone = 0;
    lifetime.add(() => undone++);
    expect(undone).toBe(1);
  });

  it("chiudere due volte disfa una volta sola", () => {
    const lifetime = openLifetime();
    let undone = 0;
    lifetime.add(() => undone++);

    lifetime.close();
    lifetime.close();
    expect(undone).toBe(1);
    expect(lifetime.closed).toBe(true);
  });

  it("si disfa in ordine inverso", () => {
    // L'ordine di costruzione letto a ritroso: è l'unico in cui uno smontaggio
    // non gira in un mondo che un altro ha già smontato a metà. In `a11y.ts` è
    // ciò che fa tornare il fuoco **dopo** che la trappola è stata staccata.
    const lifetime = openLifetime();
    const order: string[] = [];
    lifetime.add(() => order.push("primo"));
    lifetime.add(() => order.push("secondo"));
    lifetime.add(() => order.push("terzo"));

    lifetime.close();
    expect(order).toEqual(["terzo", "secondo", "primo"]);
  });

  it("uno smontaggio che sbaglia non ferma gli altri", () => {
    // La regola del §20.3, la stessa di `state/store.ts` e `state/kernel.ts`:
    // metà pulizia saltata sarebbe esattamente il difetto che questa classe
    // esiste per non avere, e sarebbe invisibile.
    const lifetime = openLifetime();
    const doneItems: string[] = [];
    lifetime.add(() => doneItems.push("sotto"));
    lifetime.add(() => {
      throw new Error("questo smontaggio sbaglia");
    });
    lifetime.add(() => doneItems.push("sopra"));

    expect(() => lifetime.close()).not.toThrow();
    expect(doneItems).toEqual(["sopra", "sotto"]);
  });

  it("un ascoltatore registrato durante la chiusura non resta appeso", () => {
    // Il caso storto e vero: uno smontaggio che, disfacendo, riapre qualcosa
    // sulla stessa vita. La vita è già segnata chiusa quando i suoi smontaggi
    // girano, quindi `ascolta` non registra — e non c'è un secondo giro da
    // fare.
    const lifetime = openLifetime();
    let hits = 0;
    lifetime.add(() => lifetime.listen(document, "click", () => hits++));

    lifetime.close();
    document.dispatchEvent(new MouseEvent("click"));
    expect(hits).toBe(0);
  });
});
