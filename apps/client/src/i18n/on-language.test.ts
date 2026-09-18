// @vitest-environment happy-dom
//
// `onLanguage` torna **come smettere**, e questo è il banco che lo prova.
//
// Sta in un file suo e non in `strings.test.ts` perché ha bisogno di mockare
// tre moduli — il canale dati, il router degli eventi e i segnali — e quei
// mock varrebbero per tutto il file che li dichiara: `strings.test.ts` legge
// `index.html` e i sorgenti veri, e non deve avere un mondo finto sotto.
//
// Il difetto che questo banco presidia è la durata delle iscrizioni: un mount
// smontato deve rimuovere i callback del kernel, dello store e della lingua,
// così un remount sulla stessa istanza del modulo non ridisegna più volte.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/// Cosa risponde il canale dati alla domanda «quali impostazioni ci sono»: lo
/// riscrive ogni prova, ed è l'unico modo per far cambiare lingua.
let language = "it";
type SettingReply = Array<{ spec: { key: string }; value: unknown }>;
let deferredSettings = false;
let pendingSettings: Array<(entries: SettingReply) => void> = [];

vi.mock("../host/query", () => ({
  settings: () =>
    deferredSettings
      ? new Promise<SettingReply>((resolve) => pendingSettings.push(resolve))
      : Promise.resolve([{ spec: { key: "locale.language" }, value: language }]),
}));

/// I due agganci di `mountStrings`. Li si cattura invece di simularli: chiamare
/// quello vero è il solo modo di far girare `reread` per la strada per cui
/// gira in produzione.
let onSetting: (() => void) | null = null;
let onVault: (() => void) | null = null;
vi.mock("../state/kernel", () => ({
  onEvent: (_type: string, h: () => void) => {
    onSetting = h;
    return () => {
      if (onSetting === h) onSetting = null;
    };
  },
}));
vi.mock("../state/store", () => ({
  on: (_signal: string, h: () => void) => {
    onVault = h;
    return () => {
      if (onVault === h) onVault = null;
    };
  },
}));

const { mountStrings, onLanguage } = await import("./strings");

let mounted: (() => void) | undefined;

describe("onLanguage", () => {
  beforeEach(() => {
    localStorage.clear();
    language = "it";
    deferredSettings = false;
    pendingSettings = [];
    mounted?.();
    mounted = mountStrings(() => {});
  });

  afterEach(() => {
    mounted?.();
    mounted = undefined;
  });

  /// Fa cambiare lingua per la via vera, e aspetta che `reread` abbia finito.
  async function changeLanguageIn(next: string, source: "setting" | "vault" = "setting"): Promise<void> {
    language = next;
    (source === "setting" ? onSetting : onVault)!();
    // Non un'attesa a tempo: `reread` è una catena di promesse già risolte, e
    // due giri di microtask la esauriscono.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("avvisa chi si è iscritto", async () => {
    let notices = 0;
    const unmount = onLanguage(() => notices++);
    await changeLanguageIn("en");
    expect(notices).toBe(1);
    unmount();
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
    const unmountTwo = onLanguage(() => seen.push("due"));

    unmountOne();
    await changeLanguageIn("en");
    expect(seen).toEqual(["due"]);
    unmountTwo();
  });

  it("chi si disiscrive mentre viene avvisato non fa saltare il turno a chi viene dopo", async () => {
    // Il caso storto: la lista si accorcia sotto l'iteratore. È esattamente ciò
    // che un pannello fa quando decide di smontarsi *perché* la lingua è
    // cambiata, e senza la copia in `reread` il terzo iscritto non veniva
    // chiamato.
    const seen: string[] = [];
    let unmountSecond: (() => void) | null = null;
    const unmountFirst = onLanguage(() => seen.push("primo"));
    unmountSecond = onLanguage(() => {
      seen.push("secondo");
      unmountSecond!();
    });
    const unmountThird = onLanguage(() => seen.push("terzo"));

    await changeLanguageIn("en");
    expect(seen).toEqual(["primo", "secondo", "terzo"]);
    unmountFirst();
    unmountThird();
  });
  it("rimontare dopo lo smontaggio lascia una sola reazione per evento e store", async () => {
    let staleNotices = 0;
    let notices = 0;
    mounted?.();
    mounted = mountStrings(() => staleNotices++);
    const first = mounted!;
    first();
    mounted = mountStrings(() => notices++);

    await changeLanguageIn("en");
    expect(staleNotices).toBe(0);
    expect(notices).toBe(1);
    await changeLanguageIn("it", "vault");
    expect(staleNotices).toBe(0);
    expect(notices).toBe(2);
  });
  it("scarta una risposta fuori ordine", async () => {
    const seen: string[] = [];
    onLanguage(() => seen.push(document.documentElement.lang));
    deferredSettings = true;
    onSetting!();
    onSetting!();
    expect(pendingSettings).toHaveLength(2);

    pendingSettings[1]!([{ spec: { key: "locale.language" }, value: "en" }]);
    await Promise.resolve();
    await Promise.resolve();
    pendingSettings[0]!([{ spec: { key: "locale.language" }, value: "it" }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(document.documentElement.lang).toBe("en");
    expect(seen).toEqual(["en"]);
  });

  it("ignora una risposta arrivata dopo lo smontaggio", async () => {
    deferredSettings = true;
    onSetting!();
    const resolve = pendingSettings[0]!;
    mounted?.();
    mounted = undefined;
    resolve([{ spec: { key: "locale.language" }, value: "en" }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(document.documentElement.lang).toBe("it-IT");
  });

  it("continua a cambiare lingua se la cache non è scrivibile", async () => {
    const notices: string[] = [];
    const stop = onLanguage(() => notices.push(document.documentElement.lang));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    try {
      await changeLanguageIn("en");
    } finally {
      setItem.mockRestore();
      stop();
    }
    expect(document.documentElement.lang).toBe("en");
    expect(notices).toEqual(["en"]);
  });
});
