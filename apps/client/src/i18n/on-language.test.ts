// @vitest-environment happy-dom
//
// `onLanguage` torna **come smettere**, e questo è il banco che lo prova.
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
let language = "it";

vi.mock("../host/query", () => ({
  settings: () => Promise.resolve([{ spec: { key: "locale.language" }, value: language }]),
}));

/// I due agganci di `mountStrings`. Li si cattura invece di simularli: chiamare
/// quello vero è il solo modo di far girare `reread` per la strada per cui
/// gira in produzione.
let onSetting: (() => void) | null = null;
vi.mock("../state/kernel", () => ({
  onEvent: (_type: string, h: () => void) => {
    onSetting = h;
  },
}));
vi.mock("../state/store", () => ({ on: () => {} }));

const { mountStrings, onLanguage } = await import("./strings");

describe("onLanguage", () => {
  beforeEach(() => {
    localStorage.clear();
    language = "it";
    mountStrings(() => {});
  });

  /// Fa cambiare lingua per la via vera, e aspetta che `reread` abbia finito.
  async function changeLanguageIn(next: string): Promise<void> {
    language = next;
    onSetting!();
    // Non un'attesa a tempo: `reread` è una catena di promesse già risolte, e
    // due giri di microtask la esauriscono.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("avvisa chi si è iscritto", async () => {
    let notices = 0;
    onLanguage(() => notices++);
    await changeLanguageIn("en");
    expect(notices).toBe(1);
  });

  it("e smette di avvisarlo quando lo smontaggio è stato chiamato", async () => {
    let notices = 0;
    const unmount = onLanguage(() => notices++);
    await changeLanguageIn("en");
    expect(notices).toBe(1);

    unmount();
    await changeLanguageIn("it");
    expect(notices).toBe(1);
  });

  it("smontarne uno non zittisce gli altri", async () => {
    // La prova che l'indice giusto sia quello giusto: con due iscritti, togliere
    // il primo non deve togliere il secondo — ed è la riga in cui uno `splice`
    // sull'indice sbagliato non si vedrebbe con un iscritto solo.
    const seen: string[] = [];
    const unmountOne = onLanguage(() => seen.push("uno"));
    onLanguage(() => seen.push("due"));

    unmountOne();
    await changeLanguageIn("en");
    expect(seen).toEqual(["due"]);
  });

  it("chi si disiscrive mentre viene avvisato non fa saltare il turno a chi viene dopo", async () => {
    // Il caso storto: la lista si accorcia sotto l'iteratore. È esattamente ciò
    // che un pannello fa quando decide di smontarsi *perché* la lingua è
    // cambiata, e senza la copia in `reread` il terzo iscritto non veniva
    // chiamato.
    const seen: string[] = [];
    let unmountSecond: (() => void) | null = null;
    onLanguage(() => seen.push("primo"));
    unmountSecond = onLanguage(() => {
      seen.push("secondo");
      unmountSecond!();
    });
    onLanguage(() => seen.push("terzo"));

    await changeLanguageIn("en");
    expect(seen).toEqual(["primo", "secondo", "terzo"]);
  });
});
