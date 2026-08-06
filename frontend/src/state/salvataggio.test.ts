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
import { cambioSotto, esitoDelFallimento, scriviContandoEco, statoDi } from "./salvataggio";

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

  // Le tre del conflitto (§18.1). Sta accanto a `fallito` perché è la stessa
  // domanda — quale dei fatti veri insieme vince — su un caso che si ripara in
  // un modo diverso: aspettare non lo risolve, e la barra non lo deve far
  // sembrare un guasto qualunque.
  it("dice che il file è cambiato sotto, anche se l'utente continua a scrivere", () => {
    expect(statoDi({ dirty: true, esito: "conflitto" })).toBe("conflitto");
  });

  it("tiene il conflitto anche a buffer pulito", () => {
    expect(statoDi({ dirty: false, esito: "conflitto" })).toBe("conflitto");
  });

  it("il conflitto non si lascia coprire da nessuno degli altri stati", () => {
    // L'invariante: è l'unico stato che chiede una **decisione** invece che
    // dell'attesa, e uno stato da decidere che si nasconde dietro uno da
    // aspettare non viene deciso.
    for (const dirty of [true, false]) {
      expect(statoDi({ dirty, esito: "conflitto" })).toBe("conflitto");
    }
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

describe("che specie di fallimento è un salvataggio che non è arrivato", () => {
  it("un conflitto si decide", () => {
    expect(esitoDelFallimento({ kind: "conflict", message: "cambiato sotto" })).toBe("conflitto");
  });

  it("tutto il resto si riprova", () => {
    expect(esitoDelFallimento({ kind: "io", message: "disco pieno" })).toBe("fallito");
    expect(esitoDelFallimento({ kind: "permission_denied", message: "sola lettura" })).toBe(
      "fallito",
    );
  });

  it("ciò che non viene dal backend si riprova come tutto il resto", () => {
    // Una `TypeError` della webview, una promessa rigettata da noi: non è un
    // `PluginError`, quindi non è un conflitto — e trattarla come tale
    // bloccherebbe l'autosave aspettando una decisione che nessuno può prendere.
    expect(esitoDelFallimento(new TypeError("boom"))).toBe("fallito");
    expect(esitoDelFallimento("stringa nuda")).toBe("fallito");
    expect(esitoDelFallimento(undefined)).toBe("fallito");
  });

  it("non legge la specie dalla prosa del messaggio", () => {
    // Il messaggio arriva **già tradotto** (0041): cercarci dentro «conflict»
    // funzionerebbe in inglese e smetterebbe di funzionare in italiano, cioè
    // nella lingua in cui l'app viene usata.
    expect(esitoDelFallimento({ kind: "io", message: "conflict while writing" })).toBe("fallito");
  });
});

describe("quando l'eco si conta", () => {
  // La corsa è deterministica e non serve nessuno scheduler: l'evento lo emette
  // la finta scrittura **dentro sé stessa**, cioè esattamente dove lo emette il
  // kernel — prima che la promise risolva. È il caso che il codice vecchio
  // sbagliava sempre e che un test scritto «dopo l'await» non vede mai.
  it("l'evento che arriva prima che la scrittura risolva è già un eco", async () => {
    const buf = { dirty: true, echi: 0 };
    let visto: string | undefined;
    await scriviContandoEco(buf, async () => {
      visto = cambioSotto(buf, false);
      return "rev-2";
    });
    // Contando l'eco dopo la scrittura qui si leggeva `riscrittura`, cioè «il
    // file è cambiato sotto di te» detto della nostra stessa scrittura.
    expect(visto).toBe("eco");
  });

  it("l'eco resta in attesa se l'evento non è ancora arrivato quando la scrittura torna", async () => {
    const buf = { dirty: true, echi: 0 };
    await scriviContandoEco(buf, () => Promise.resolve("rev-2"));
    expect(buf.echi).toBe(1);
    expect(cambioSotto(buf, false)).toBe("eco");
  });

  // L'altro verso, ed è il difetto simmetrico: un eco che resta appeso si
  // mangia il **prossimo** cambio vero, cioè fa sparire un avviso che doveva
  // esserci. Vale per tutte e due le specie di fallimento, che nel salvataggio
  // sono due rami diversi.
  for (const guasto of [
    { kind: "io", message: "disco pieno" },
    { kind: "conflict", message: "cambiato sotto" },
  ]) {
    it(`una scrittura rifiutata (${guasto.kind}) non lascia un eco appeso`, async () => {
      const buf = { dirty: true, echi: 0 };
      await expect(scriviContandoEco(buf, () => Promise.reject(guasto))).rejects.toBe(guasto);
      expect(buf.echi).toBe(0);
      // E la prova che serve davvero: il cambio vero che arriva dopo viene
      // ancora annunciato.
      expect(cambioSotto(buf, false)).toBe("riscrittura");
    });
  }

  it("il guasto risale a chi salva, che ha due rami e deve poterli scegliere", async () => {
    const buf = { dirty: true, echi: 0 };
    const guasto = { kind: "conflict", message: "cambiato sotto" };
    await expect(scriviContandoEco(buf, () => Promise.reject(guasto))).rejects.toBe(guasto);
    expect(esitoDelFallimento(guasto)).toBe("conflitto");
  });

  it("due scritture di fila mettono due echi, e due eventi li consumano tutti e due", async () => {
    const buf = { dirty: true, echi: 0 };
    await scriviContandoEco(buf, () => Promise.resolve("rev-2"));
    await scriviContandoEco(buf, () => Promise.resolve("rev-3"));
    expect(cambioSotto(buf, false)).toBe("eco");
    buf.echi -= 1;
    expect(cambioSotto(buf, false)).toBe("eco");
    buf.echi -= 1;
    expect(cambioSotto(buf, false)).toBe("riscrittura");
  });
});
