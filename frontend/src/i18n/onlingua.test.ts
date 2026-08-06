// @vitest-environment happy-dom
//
// `onLingua` torna **come smettere**, e questo è il banco che lo prova.
//
// Sta in un file suo e non in `strings.test.ts` perché ha bisogno di mockare
// tre moduli — il canale dati, il router degli eventi e i segnali — e quei
// mock varrebbero per tutto il file che li dichiara: `strings.test.ts` legge
// `index.html` e i sorgenti veri, e non deve avere un mondo finto sotto.
//
// Il difetto (0016) non mordeva: i quattro chiamanti di oggi sono superfici
// montate una volta che vivono quanto la finestra, e nessuna si è mai
// disiscritta perché nessuna finisce. Mordeva il **secondo chiamante** — un
// pannello, che si rimonta: ogni montaggio avrebbe lasciato la sua iscrizione
// nella lista, e alla terza apertura un cambio di lingua avrebbe ridisegnato
// tre volte, due delle quali su superfici che non ci sono più.
import { beforeEach, describe, expect, it, vi } from "vitest";

/// Cosa risponde il canale dati alla domanda «quali impostazioni ci sono»: lo
/// riscrive ogni prova, ed è l'unico modo per far cambiare lingua.
let lingua = "it";

vi.mock("../host/query", () => ({
  impostazioni: () => Promise.resolve([{ spec: { key: "locale.language" }, value: lingua }]),
}));

/// I due agganci di `mountStrings`. Li si cattura invece di simularli: chiamare
/// quello vero è il solo modo di far girare `rileggi` per la strada per cui
/// gira in produzione.
let suSetting: (() => void) | null = null;
vi.mock("../state/kernel", () => ({
  onEvent: (_tipo: string, h: () => void) => {
    suSetting = h;
  },
}));
vi.mock("../state/store", () => ({ on: () => {} }));

const { mountStrings, onLingua } = await import("./strings");

describe("onLingua", () => {
  beforeEach(() => {
    localStorage.clear();
    lingua = "it";
    mountStrings(() => {});
  });

  /// Fa cambiare lingua per la via vera, e aspetta che `rileggi` abbia finito.
  async function cambiaLinguaIn(prossima: string): Promise<void> {
    lingua = prossima;
    suSetting!();
    // Non un'attesa a tempo: `rileggi` è una catena di promesse già risolte, e
    // due giri di microtask la esauriscono.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("avvisa chi si è iscritto", async () => {
    let avvisi = 0;
    onLingua(() => avvisi++);
    await cambiaLinguaIn("en");
    expect(avvisi).toBe(1);
  });

  it("e smette di avvisarlo quando lo smontaggio è stato chiamato", async () => {
    let avvisi = 0;
    const smonta = onLingua(() => avvisi++);
    await cambiaLinguaIn("en");
    expect(avvisi).toBe(1);

    smonta();
    await cambiaLinguaIn("it");
    expect(avvisi).toBe(1);
  });

  it("smontarne uno non zittisce gli altri", async () => {
    // La prova che l'indice giusto sia quello giusto: con due iscritti, togliere
    // il primo non deve togliere il secondo — ed è la riga in cui uno `splice`
    // sull'indice sbagliato non si vedrebbe con un iscritto solo.
    const visti: string[] = [];
    const smontaUno = onLingua(() => visti.push("uno"));
    onLingua(() => visti.push("due"));

    smontaUno();
    await cambiaLinguaIn("en");
    expect(visti).toEqual(["due"]);
  });

  it("chi si disiscrive mentre viene avvisato non fa saltare il turno a chi viene dopo", async () => {
    // Il caso storto: la lista si accorcia sotto l'iteratore. È esattamente ciò
    // che un pannello fa quando decide di smontarsi *perché* la lingua è
    // cambiata, e senza la copia in `rileggi` il terzo iscritto non veniva
    // chiamato.
    const visti: string[] = [];
    let smontaSecondo: (() => void) | null = null;
    onLingua(() => visti.push("primo"));
    smontaSecondo = onLingua(() => {
      visti.push("secondo");
      smontaSecondo!();
    });
    onLingua(() => visti.push("terzo"));

    await cambiaLinguaIn("en");
    expect(visti).toEqual(["primo", "secondo", "terzo"]);
  });
});
