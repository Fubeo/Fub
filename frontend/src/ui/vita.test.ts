// @vitest-environment happy-dom
//
// Il presidio della `Vita`, e la metà che il conto non vede.
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
import { apriVita } from "./vita";

describe("Vita", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("chiudere stacca l'ascoltatore", () => {
    const vita = apriVita();
    let colpi = 0;
    vita.ascolta(document, "click", () => colpi++);

    document.dispatchEvent(new MouseEvent("click"));
    expect(colpi).toBe(1);

    vita.chiudi();
    document.dispatchEvent(new MouseEvent("click"));
    expect(colpi).toBe(1);
  });

  // Non c'è, e la riga che dice perché vale più della prova: *le opzioni
  // tornano identiche allo smontaggio* era scritta, passava, e sarebbe passata
  // anche togliendo `opzioni` dal `removeEventListener` — `happy-dom` stacca un
  // ascoltatore in cattura anche se glielo si chiede senza. In un browser vero
  // sarebbe stata rossa, qui era un presidio a vuoto: la specie che questo repo
  // ha già incontrato più di dodici volte, scritta per difendersene. La
  // proprietà la tiene la forma di `ascolta` — una variabile letta due volte —
  // e il commento accanto.

  it("su una vita chiusa non si registra niente", () => {
    // Il ramo del menu contestuale: `setTimeout(() => vita.ascolta(…), 0)` che
    // scatta dopo che Escape ha già chiuso il menu. Senza questa riga
    // l'ascoltatore si attaccava a un menu che non c'era più e restava lì.
    const vita = apriVita();
    vita.chiudi();
    let colpi = 0;
    vita.ascolta(document, "click", () => colpi++);

    document.dispatchEvent(new MouseEvent("click"));
    expect(colpi).toBe(0);
  });

  it("su una vita chiusa uno smontaggio si esegue subito", () => {
    const vita = apriVita();
    vita.chiudi();
    let disfatto = 0;
    vita.aggiungi(() => disfatto++);
    expect(disfatto).toBe(1);
  });

  it("chiudere due volte disfa una volta sola", () => {
    const vita = apriVita();
    let disfatto = 0;
    vita.aggiungi(() => disfatto++);

    vita.chiudi();
    vita.chiudi();
    expect(disfatto).toBe(1);
    expect(vita.chiusa).toBe(true);
  });

  it("si disfa in ordine inverso", () => {
    // L'ordine di costruzione letto a ritroso: è l'unico in cui uno smontaggio
    // non gira in un mondo che un altro ha già smontato a metà. In `a11y.ts` è
    // ciò che fa tornare il fuoco **dopo** che la trappola è stata staccata.
    const vita = apriVita();
    const ordine: string[] = [];
    vita.aggiungi(() => ordine.push("primo"));
    vita.aggiungi(() => ordine.push("secondo"));
    vita.aggiungi(() => ordine.push("terzo"));

    vita.chiudi();
    expect(ordine).toEqual(["terzo", "secondo", "primo"]);
  });

  it("uno smontaggio che sbaglia non ferma gli altri", () => {
    // La regola del §20.3, la stessa di `state/store.ts` e `state/kernel.ts`:
    // metà pulizia saltata sarebbe esattamente il difetto che questa classe
    // esiste per non avere, e sarebbe invisibile.
    const vita = apriVita();
    const fatti: string[] = [];
    vita.aggiungi(() => fatti.push("sotto"));
    vita.aggiungi(() => {
      throw new Error("questo smontaggio sbaglia");
    });
    vita.aggiungi(() => fatti.push("sopra"));

    expect(() => vita.chiudi()).not.toThrow();
    expect(fatti).toEqual(["sopra", "sotto"]);
  });

  it("un ascoltatore registrato durante la chiusura non resta appeso", () => {
    // Il caso storto e vero: uno smontaggio che, disfacendo, riapre qualcosa
    // sulla stessa vita. La vita è già segnata chiusa quando i suoi smontaggi
    // girano, quindi `ascolta` non registra — e non c'è un secondo giro da
    // fare.
    const vita = apriVita();
    let colpi = 0;
    vita.aggiungi(() => vita.ascolta(document, "click", () => colpi++));

    vita.chiudi();
    document.dispatchEvent(new MouseEvent("click"));
    expect(colpi).toBe(0);
  });
});
