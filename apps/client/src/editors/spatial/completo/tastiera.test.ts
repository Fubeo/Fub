// @vitest-environment happy-dom
// I segni per posizione (`./tastiera.ts`, `./tasti.ts`): sulla tastiera italiana i tasti di
// VectorCraft scritti coi segni americani partono dal loro tasto fisico e si leggono col segno
// che quel tasto porta.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeyChord } from "../../../ui/commands";
import { decidiTasto, risolviTasti, tastiPremuti, tastoStrumento, TASTI_DELLA_FINESTRA, type StatoTastiera } from "./tasti";
import { dimenticaLaTastiera, impara, postoDelSegno, scrittaDelTasto, segnoAmericano } from "./tastiera";

const NESSUNO: StatoTastiera = { inCampo: false, vuoleTesto: false, componendo: false };
const premuto = (key: string, code: string, mod: Partial<KeyChord> = {}): KeyChord => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mod,
});

beforeEach(() => {
  dimenticaLaTastiera();
  document.documentElement.lang = "it";
});
afterEach(() => {
  dimenticaLaTastiera();
  document.documentElement.lang = "";
});

describe("il tasto fisico", () => {
  it("dà il segno americano senza Maiusc, solo per i tasti dei segni", () => {
    expect(segnoAmericano({ code: "BracketLeft" })).toBe("[");
    expect(segnoAmericano({ code: "KeyA" })).toBeNull();
    expect(segnoAmericano({})).toBeNull();
    expect(postoDelSegno("~")).toEqual({ segno: "`", maiusc: true });
    expect(postoDelSegno("a")).toBeNull();
  });

  it("i comandi coi segni partono dal tasto fisico anche senza Maiusc", () => {
    const r = risolviTasti(
      [
        { id: "object.arrange.sendBackward", tasto: "Cmd+[" },
        { id: "object.arrange.bringForward", tasto: "Cmd+]" },
        { id: "appearance.addFill", tasto: "Cmd+/" },
      ],
      {},
      "other",
      TASTI_DELLA_FINESTRA,
    );
    // La tastiera italiana: Ctrl+È, Ctrl++ e Ctrl+- (il tasto del meno è quello di `/`).
    expect(decidiTasto(premuto("è", "BracketLeft", { ctrlKey: true }), r, NESSUNO, "other")).toEqual({ tipo: "esegue", comando: "object.arrange.sendBackward" });
    expect(decidiTasto(premuto("+", "BracketRight", { ctrlKey: true }), r, NESSUNO, "other")).toEqual({ tipo: "esegue", comando: "object.arrange.bringForward" });
    expect(decidiTasto(premuto("-", "Slash", { ctrlKey: true }), r, NESSUNO, "other")).toEqual({ tipo: "esegue", comando: "appearance.addFill" });
    // La tastiera americana, com'era.
    expect(decidiTasto(premuto("[", "BracketLeft", { ctrlKey: true }), r, NESSUNO, "other")).toEqual({ tipo: "esegue", comando: "object.arrange.sendBackward" });
    // Una lettera non passa per la posizione.
    expect(decidiTasto(premuto("q", "KeyA", { ctrlKey: true }), r, NESSUNO, "other")).toEqual({ tipo: "passa" });
  });

  it("il carattere vince sulla posizione", () => {
    const r = risolviTasti([{ id: "a", tasto: "Cmd+Alt+'" }, { id: "b", tasto: "Cmd+Alt+-" }], {}, "other", TASTI_DELLA_FINESTRA);
    // Il tasto italiano dell'apostrofo sta dove l'americana ha il meno: vale `Cmd+Alt+'`.
    expect(decidiTasto(premuto("'", "Minus", { ctrlKey: true, altKey: true }), r, NESSUNO, "other")).toEqual({ tipo: "esegue", comando: "a" });
  });

  it("i tasti nudi e degli strumenti: un segno per posizione, col Maiusc", () => {
    expect(tastiPremuti(premuto("-", "Slash"))).toEqual(["-", "/"]);
    expect(tastiPremuti(premuto("ù", "Backslash"))).toEqual(["ù", "\\"]);
    expect(tastiPremuti(premuto("+", "BracketRight"))).toEqual(["+", "]"]);
    expect(tastiPremuti(premuto("|", "Backquote", { shiftKey: true }))).toEqual(["|", "Shift-`"]);
    expect(tastiPremuti(premuto("B", "KeyB", { shiftKey: true }))).toEqual(["Shift-b"]);
    expect(tastiPremuti(premuto("/", "Slash"))).toEqual(["/"]);
    expect(tastiPremuti(premuto("x", "KeyX", { ctrlKey: true }))).toEqual([]);
    expect(tastoStrumento("Shift+~")).toBe("Shift-`");
    expect(tastoStrumento("\\")).toBe("\\");
    expect(tastoStrumento("-")).toBe("-");
    expect(tastoStrumento("+")).toBe("+");
    expect(tastoStrumento("Shift+1")).toBe("Shift-1");
    expect(tastoStrumento("Shift+é")).toBeNull();
  });
});

describe("la scritta", () => {
  it("sulla tastiera italiana un segno si legge col segno del suo tasto", () => {
    expect(scrittaDelTasto("Ctrl+[")).toBe("Ctrl+È");
    expect(scrittaDelTasto("Ctrl+Shift+]")).toBe("Ctrl+Shift++");
    expect(scrittaDelTasto("Ctrl+Alt+/")).toBe("Ctrl+Alt+-");
    expect(scrittaDelTasto("\\")).toBe("Ù");
    expect(scrittaDelTasto("~")).toBe("Shift+\\");
    expect(scrittaDelTasto("⌘[", true)).toBe("⌘È");
    // Il punto, la virgola e le lettere restano.
    expect(scrittaDelTasto("Ctrl+Shift+.")).toBe("Ctrl+Shift+.");
    expect(scrittaDelTasto("Ctrl+G")).toBe("Ctrl+G");
  });

  it("su una tastiera americana, o in una lingua senza tastiera nota, resta com'è", () => {
    document.documentElement.lang = "en";
    expect(scrittaDelTasto("Ctrl+[")).toBe("Ctrl+[");
    expect(scrittaDelTasto("~")).toBe("~");
  });

  it("un tasto premuto insegna il suo segno, e vince sulla lingua", () => {
    document.documentElement.lang = "en";
    impara(premuto("ü", "BracketLeft"));
    expect(scrittaDelTasto("Ctrl+[")).toBe("Ctrl+Ü");
    // Con un modificatore il segno è un altro: non insegna.
    impara(premuto("[", "BracketLeft", { altKey: true }));
    expect(scrittaDelTasto("Ctrl+[")).toBe("Ctrl+Ü");
  });
});
