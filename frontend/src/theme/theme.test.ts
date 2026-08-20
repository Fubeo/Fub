// La regola che regge i due temi: **quale luce vale**, date la scelta e il
// sistema.
//
// È una funzione di due argomenti e tre righe, e provarla sembra eccessivo
// finché non si guarda cosa succede quando sbaglia: l'app si apre nella luce
// che l'utente non ha chiesto, e non c'è niente che diventi rosso — il tema
// «funziona», è solo l'altro. È la stessa ragione per cui questa risoluzione
// sta in TypeScript e non in una `@media (prefers-color-scheme)` (il commento
// lungo sta in `theme.ts`): una media query si prova solo aprendo l'app in due
// sistemi diversi.
import { describe, expect, it } from "vitest";
import { effectiveTheme } from "./theme";

describe("quale luce vale", () => {
  it("una scelta esplicita vince sul sistema, in entrambi i versi", () => {
    // Il caso per cui la chiave esiste: chi vuole il chiaro su un sistema
    // scuro, e chi vuole lo scuro su un sistema chiaro. Se «vince» valesse solo
    // in una direzione, metà degli utenti non se ne accorgerebbe.
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
    expect(effectiveTheme("light", false)).toBe("light");
    expect(effectiveTheme("dark", true)).toBe("dark");
  });

  it("la stringa vuota è «come il sistema», che è il default dello schema", () => {
    expect(effectiveTheme("", true)).toBe("dark");
    expect(effectiveTheme("", false)).toBe("light");
  });

  it("qualunque altra cosa è «come il sistema», e non un terzo stato", () => {
    // Il valore arriva da un `settings.json` che si può scrivere a mano, e da
    // uno schema che un domani potrebbe avere un'opzione in più con una shell
    // vecchia davanti. Nessuno dei due deve poter spegnere il tema: un'app che
    // si apre senza colori perché una stringa non è stata riconosciuta è un
    // file di configurazione con il potere di renderla illeggibile, e la 0036
    // ha già deciso che non ce l'ha.
    // `lime` è inclusa: è stata un fascio, ma `temaEffettivo` non l'ha mai
    // saputo — e anche ora che il fascio non c'è più, il valore ignoto cade
    // nel «come il sistema». La migrazione avviene prima, in `mountTheme`.
    for (const strange of ["Dark", "auto", "sepia", "lime", "", null, undefined, 3, {}, []]) {
      expect(effectiveTheme(strange, true)).toBe("dark");
      expect(effectiveTheme(strange, false)).toBe("light");
    }
  });
});
