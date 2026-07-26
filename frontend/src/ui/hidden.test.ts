// Il presidio di `hidden`: **ciò che la shell nasconde deve restare nascosto**.
//
// Non è una regola di stile, è la classe di difetti che ha congelato l'app. La
// shell nasconde le cose in un modo solo — `el.hidden = …` (`ui/views.ts`, i
// pannelli, l'anteprima) — e quell'attributo è reso invisibile da una regola
// dello **user-agent**, `[hidden] { display: none }`. Basta che una regola
// d'autore imposti `display` su quell'elemento e la regola dell'UA cade: non
// perché qualcuno abbia deciso di mostrarlo, ma perché ha scritto
// `display: flex` per il layout. Il difetto è silenzioso due volte — non lo
// vede il compilatore, non lo vede un test di comportamento — e quando cade su
// un elemento `position: fixed; inset: 0` non si vede *nemmeno a schermo*: si
// vede solo che l'app non risponde più ai click, perché c'è un velo sopra.
//
// È successo con `#views-modal` (le superfici del §2.2, decisione 0016), e con
// `#views-ribbon`/`#views-status` nella stessa forma ma senza conseguenze.
//
// La difesa sta in `style.css` ed è una riga — `[hidden] { display: none
// !important }` — cioè l'unico posto in cui `!important` è la risposta giusta:
// ristabilisce una garanzia dell'UA che una regola di layout revoca senza
// dirlo. Questo test tiene ferma **quella riga** e, se qualcuno la togliesse,
// nomina gli elementi che tornerebbero a essere visibili.
// I due file si leggono col `?raw` di Vite e non con `node:fs`, per la stessa
// ragione del presidio del §1.3: `tsconfig.json` dichiara i soli tipi di Vite,
// e un presidio della shell non deve essere il primo a usare un'API che nella
// webview non esiste.
import { describe, expect, it } from "vitest";

import html from "../../index.html?raw";
import css from "../style.css?raw";

/// La riga di difesa: `[hidden]` con `display: none` e `!important`. Senza
/// `!important` non serve a niente — un selettore per id la batte comunque.
const GUARDIA = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important[^}]*\}/;

/// Gli id che l'HTML nasconde con l'attributo (`<div id="x" hidden>`).
function idNascostiNellHtml(): string[] {
  return [...html.matchAll(/id="([\w-]+)"[^>]*\shidden[\s>]/g)].map((m) => m[1]);
}

/// Gli id su cui il CSS impone un `display` con un selettore che nomina *solo*
/// quell'id (`#views-modal { display: flex }`), cioè quelli su cui l'attributo
/// `hidden` perderebbe senza la guardia. I selettori discendenti
/// (`#views-bottom .panel-title`) non c'entrano: riguardano i figli.
function idConDisplayImposto(): string[] {
  const colpiti: string[] = [];
  for (const blocco of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selettori = blocco[1].split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim());
    if (!/(^|;|\s)display\s*:/.test(blocco[2])) continue;
    for (const selettore of selettori) {
      const solo = /^#([\w-]+)$/.exec(selettore);
      if (solo) colpiti.push(solo[1]);
    }
  }
  return colpiti;
}

describe("l'attributo hidden", () => {
  it("è difeso da una regola che nessuna regola di layout può revocare", () => {
    expect(
      GUARDIA.test(css),
      "manca `[hidden] { display: none !important }` in style.css: senza, " +
        "qualunque regola d'autore che imposti `display` rende di nuovo " +
        "visibile ciò che la shell crede nascosto",
    ).toBe(true);
  });

  it("protegge elementi che senza la guardia tornerebbero visibili", () => {
    // Il test sopra passerebbe anche se la guardia non servisse a nessuno, e
    // un presidio che non presidia niente è un presidio che si toglie senza
    // pensarci. Qui si nomina chi ci sta sotto: se un domani nessuno ci sta
    // più, questo test diventa rosso e la riga si può discutere sul serio.
    const nascosti = idNascostiNellHtml();
    const conDisplay = new Set(idConDisplayImposto());
    const protetti = nascosti.filter((id) => conDisplay.has(id));

    expect(nascosti.length, "l'HTML non nasconde più niente: il glob legge ancora?").toBeGreaterThan(
      3,
    );
    expect(protetti, "gli elementi che dipendono dalla guardia").toContain("views-modal");
  });

  it("riconosce una regola che sovrascrive display quando c'è", () => {
    // La prova che il rilevatore non è sempre vuoto per una svista nella
    // regexp: `#app` ha un `display: flex` dichiarato, e va colto.
    expect(idConDisplayImposto()).toContain("app");
  });
});
