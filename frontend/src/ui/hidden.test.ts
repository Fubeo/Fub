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
// `#views-ribbon`/`#views-status` nella stessa forma ma senza conseguenze. Dal
// §31.4 quelle regole non nominano più un id ma una classe, e il presidio segue
// i **manici** di un elemento — id e classi — invece del solo id: cercare ciò
// che non si scrive più è il modo in cui un presidio diventa verde e vuoto.
//
// La difesa sta nella **struttura** (`theme/structure.css`) ed è una riga —
// `[hidden] { display: none !important }` — cioè l'unico posto in cui
// `!important` è la risposta giusta: ristabilisce una garanzia dell'UA che una
// regola di layout revoca senza dirlo. Sta nella struttura, e non nella pelle,
// perché una pelle di terzi che imposti `display` non può revocarla: la
// struttura non si sostituisce col tema. Questo test tiene ferma **quella
// riga** e, se qualcuno la togliesse, nomina gli elementi che tornerebbero a
// essere visibili.
// I tre file si leggono col `?raw` di Vite e non con `node:fs`, per la stessa
// ragione del presidio del §1.3: `tsconfig.json` dichiara i soli tipi di Vite,
// e un presidio della shell non deve essere il primo a usare un'API che nella
// webview non esiste.
import { describe, expect, it } from "vitest";

import html from "../../index.html?raw";
import structure from "../theme/structure.css?raw";
import skin from "../theme/serie/skin.css?raw";

/// Il CSS che il presidio attraversa: la struttura (dove sta la guardia) e la
/// pelle (dove stanno le regole di layout che la possono revocare). La prima è
/// della shell e non si sostituisce; la seconda sì, ma una pelle di terzi che
/// imposti `display` non revoca la guardia — sta in un altro strato.
const css = structure + "\n" + skin;

/// La riga di difesa: `[hidden]` con `display: none` e `!important`. Senza
/// `!important` non serve a niente — un selettore per id la batte comunque.
const HIDDEN_RULE = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important[^}]*\}/;

/// Un elemento che l'HTML nasconde con l'attributo (`<div id="x" hidden>`), coi
/// **manici** con cui il CSS lo può raggiungere: il suo id e le sue classi.
///
/// Le classi ci sono da quando la pelle ha smesso di vestire per id (§31.4):
/// prima bastava l'id perché era l'unico modo che la pelle avesse di nominare
/// una superficie, e cercare solo quello adesso vorrebbe dire un presidio che
/// non trova più niente e passa perché non guarda.
interface HiddenElement {
  id: string;
  hooks: string[];
}

function hiddenInHtml(): HiddenElement[] {
  const outside: HiddenElement[] = [];
  for (const m of html.matchAll(/<[a-z]+\s([^>]*\shidden[\s>][^>]*)>/gi)) {
    const attributes = m[1];
    const id = /\sid="([\w-]+)"/.exec(attributes)?.[1] ?? /^id="([\w-]+)"/.exec(attributes)?.[1];
    if (!id) continue;
    const classes = (/\sclass="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/).filter(Boolean);
    outside.push({ id, hooks: [`#${id}`, ...classes.map((c) => `.${c}`)] });
  }
  return outside;
}

/// I selettori su cui il CSS impone un `display` nominando *solo* quel manico
/// (`.views-modal { display: flex }`), cioè quelli su cui l'attributo `hidden`
/// perderebbe senza la guardia. I selettori discendenti
/// (`.views-bottom .panel-title`) non c'entrano: riguardano i figli.
function hooksWithImposedDisplay(): string[] {
  const matched: string[] = [];
  for (const block of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = block[1].split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim());
    if (!/(^|;|\s)display\s*:/.test(block[2])) continue;
    for (const selector of selectors) {
      if (/^[#.][\w-]+$/.test(selector)) matched.push(selector);
    }
  }
  return matched;
}

describe("l'attributo hidden", () => {
  it("è difeso da una regola che nessuna regola di layout può revocare", () => {
    expect(
      HIDDEN_RULE.test(css),
      "manca `[hidden] { display: none !important }` in structure.css: " +
        "senza, qualunque regola d'autore che imposti `display` rende di " +
        "nuovo visibile ciò che la shell crede nascosto",
    ).toBe(true);
  });

  it("protegge elementi che senza la guardia tornerebbero visibili", () => {
    // Il test sopra passerebbe anche se la guardia non servisse a nessuno, e
    // un presidio che non presidia niente è un presidio che si toglie senza
    // pensarci. Qui si nomina chi ci sta sotto: se un domani nessuno ci sta
    // più, questo test diventa rosso e la riga si può discutere sul serio.
    const hiddenElements = hiddenInHtml();
    const withDisplay = new Set(hooksWithImposedDisplay());
    const protectedElements = hiddenElements
      .filter((n) => n.hooks.some((g) => withDisplay.has(g)))
      .map((n) => n.id);

    expect(hiddenElements.length, "l'HTML non nasconde più niente: il glob legge ancora?").toBeGreaterThan(
      3,
    );
    expect(protectedElements, "gli elementi che dipendono dalla guardia").toContain("views-modal");
  });

  it("riconosce una regola che sovrascrive display quando c'è", () => {
    // La prova che il rilevatore non è sempre vuoto per una svista nella
    // regexp: `#app` ha un `display: flex` dichiarato, e va colto.
    expect(hooksWithImposedDisplay()).toContain("#app");
  });
});
