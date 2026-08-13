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
import { consumaCambioSotto, esitoDelFallimento, scriviContandoEco, statoDi } from "./salvataggio";

// Le identità che un evento può portare (`Origin` di host/contract). Solo
// quella di una scrittura diretta della shell — attore `user` fuori da un
// lotto — può essere l'eco di una nostra scrittura; ogni altra origine è un
// cambio vero, che non consuma l'attesa.
const ecoDellaShell = { actor: { kind: "user" as const }, batch: null };
const kernel = { actor: { kind: "kernel" as const }, batch: "12" };
const plugin = { actor: { kind: "plugin" as const, id: "x" }, batch: "12" };
const watcher = { actor: { kind: "watcher" as const }, batch: null };

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
    expect(consumaCambioSotto({ dirty: false, echi: 0 }, ecoDellaShell)).toBe("muto");
    expect(consumaCambioSotto({ dirty: false, echi: 0 }, watcher)).toBe("muto");
    expect(consumaCambioSotto(undefined, watcher)).toBe("muto");
  });

  it("riconosce l'eco del proprio salvataggio", () => {
    // Il caso che si vedeva scrivendo: autosave, si continua a battere, il
    // buffer torna sporco, e l'evento della nostra scrittura arriva adesso.
    expect(consumaCambioSotto({ dirty: true, echi: 1 }, ecoDellaShell)).toBe("eco");
  });

  it("un'altra applicazione non è mai un eco, nemmeno con echi in attesa", () => {
    // L'invariante: se il contatore restasse alto per un evento perso, non deve
    // poter zittire il caso in cui il lavoro coperto non è nostro.
    expect(consumaCambioSotto({ dirty: true, echi: 3 }, watcher)).toBe("altra_app");
  });

  it("senza echi in attesa, un cambio non nostro è una riscrittura", () => {
    expect(consumaCambioSotto({ dirty: true, echi: 0 }, kernel)).toBe("riscrittura");
  });
});

describe("chi possiede il conto degli echi", () => {
  // La metà che **toglie** stava fuori: chi avvisa faceva `echi -= 1` nel suo
  // `case "eco"`. Queste sono le prove che adesso non serve più, e che chi le
  // scrive non ha modo di dimenticarsene — nessun chiamante tocca il campo.
  it("chi decide consuma: chi chiama non deve sottrarre niente", () => {
    const buf = { dirty: true, echi: 1 };
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
    expect(buf.echi).toBe(0);
    // E la prova che serve davvero: il cambio vero che arriva subito dopo non
    // viene scambiato per il nostro.
    expect(consumaCambioSotto(buf, kernel)).toBe("riscrittura");
  });

  // **Il caso che nessuna delle due metà copriva**, ed è la strada normale:
  // l'autosave parte 400 ms dopo l'ultima battuta, quindi quando la scrittura
  // torna il buffer è quasi sempre pulito. L'evento arriva, non c'è niente da
  // dire — e finché il `muto` tornava senza toccare il conto, quell'eco restava
  // appeso per sempre.
  it("un eco che arriva a buffer pulito viene consumato lo stesso", () => {
    const buf = { dirty: false, echi: 1 };
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("muto");
    expect(buf.echi).toBe(0);
    // La prova che conta: l'utente ricomincia a battere e un plugin riscrive il
    // file. Con l'eco appeso questo era `eco`, cioè silenzio — un avviso vero
    // che non compariva.
    buf.dirty = true;
    expect(consumaCambioSotto(buf, plugin)).toBe("riscrittura");
  });

  it("un evento di un'altra applicazione non consuma niente", () => {
    // L'altro verso dell'invariante: se un watcher consumasse, basterebbe una
    // scrittura esterna fra la nostra e il suo eco per far diventare la nostra
    // una «riscrittura», cioè un avviso a vuoto. E a buffer pulito il watcher
    // resta muto come prima: non c'è nessun lavoro da coprire.
    const buf = { dirty: true, echi: 1 };
    expect(consumaCambioSotto(buf, watcher)).toBe("altra_app");
    expect(buf.echi).toBe(1);
    expect(consumaCambioSotto({ dirty: false, echi: 1 }, watcher)).toBe("muto");
  });

  it("nessun eco in attesa non scende sotto zero", () => {
    const buf = { dirty: false, echi: 0 };
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("muto");
    expect(buf.echi).toBe(0);
  });

  it("le due metà si chiudono a vicenda, dalla scrittura al suo evento", async () => {
    const buf = { dirty: true, echi: 0 };
    await scriviContandoEco(buf, () => Promise.resolve("rev-2"));
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
    expect(buf.echi).toBe(0);
  });
});

// **Il difetto 0010** (issues.md): l'eco consumava anche riscritture vere. Il
// conto diceva «nostro» a ogni evento non-watcher sul path, quindi una
// riscrittura del kernel o di un plugin in volo mentre la nostra scrittura era
// in corso veniva consumata come l'eco: l'avviso spariva, e alla scrittura
// fallita il conto scendeva sotto zero. Il rimedio del todo.md — «appaiare
// l'eco all'evento, non a un contatore nudo» — è qui: l'eco si consuma solo
// con l'evento che porta l'identità di una scrittura diretta della shell.
describe("un evento con identità diversa non è il nostro eco", () => {
  it("una riscrittura del kernel non consuma l'eco e si dice", () => {
    const buf = { dirty: true, echi: 1 };
    expect(consumaCambioSotto(buf, kernel)).toBe("riscrittura");
    expect(buf.echi).toBe(1);
    // E l'eco vero, che arriva dopo, è ancora lì ad aspettarlo.
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
    expect(buf.echi).toBe(0);
  });

  it("una riscrittura di un plugin non consuma l'eco", () => {
    const buf = { dirty: true, echi: 1 };
    expect(consumaCambioSotto(buf, plugin)).toBe("riscrittura");
    expect(buf.echi).toBe(1);
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
  });

  it("una rinomina concorrente — comando utente in lotto — non consuma l'eco", () => {
    // Lo stesso attore `user` di una nostra scrittura, ma dentro un lotto: è un
    // comando che l'utente lancia (rinomina, annulla, ripristino) e che riscrive
    // il documento. Il `batch` è ciò che lo distingue dall'eco.
    const comando = { actor: { kind: "user" as const }, batch: "9" };
    const buf = { dirty: true, echi: 1 };
    expect(consumaCambioSotto(buf, comando)).toBe("riscrittura");
    expect(buf.echi).toBe(1);
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
  });

  it("l'eco esatto — attore user fuori da un lotto — si consuma", () => {
    const buf = { dirty: true, echi: 1 };
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
    expect(buf.echi).toBe(0);
  });

  it("senza echi in attesa, anche l'identità della shell è un cambio vero", () => {
    // Un evento `user` fuori da un lotto senza un'eco nostra in attesa non può
    // essere una nostra scrittura: è un'altra finestra della shell (o un eco
    // perso per coda troncata). Si dice, e il conto non scende sotto zero.
    const buf = { dirty: true, echi: 0 };
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("riscrittura");
    expect(buf.echi).toBe(0);
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
      visto = consumaCambioSotto(buf, ecoDellaShell);
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
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
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
      expect(consumaCambioSotto(buf, kernel)).toBe("riscrittura");
    });
  }

  it("il guasto risale a chi salva, che ha due rami e deve poterli scegliere", async () => {
    const buf = { dirty: true, echi: 0 };
    const guasto = { kind: "conflict", message: "cambiato sotto" };
    await expect(scriviContandoEco(buf, () => Promise.reject(guasto))).rejects.toBe(guasto);
    expect(esitoDelFallimento(guasto)).toBe("conflitto");
  });

  it("due scritture di fila mettono due echi, e due eventi li consumano tutti e due", async () => {
    // Prima questo banco sottraeva a mano fra un evento e l'altro, perché la
    // metà che toglie stava dal chiamante: il test rifaceva il lavoro del
    // chiamante, e quindi non poteva accorgersi che quel lavoro era suo.
    const buf = { dirty: true, echi: 0 };
    await scriviContandoEco(buf, () => Promise.resolve("rev-2"));
    await scriviContandoEco(buf, () => Promise.resolve("rev-3"));
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
    expect(consumaCambioSotto(buf, ecoDellaShell)).toBe("eco");
    expect(consumaCambioSotto(buf, kernel)).toBe("riscrittura");
  });
});
