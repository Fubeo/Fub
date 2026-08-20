// @vitest-environment happy-dom
//
// Il banco del caricatore (§29.1, §31.3): **un elemento montato per canale,
// mai due**.
//
// Il caricatore (`theme/loader.ts`) monta per sostituzione: prima toglie ciò
// che c'è, poi appende il nuovo. Il vecchio modo — accatastare fogli e lasciare
// che la specificità ne decretasse il vincitore — metteva in gara due temi e ne
// faceva valere uno per una ragione che nessuno aveva scritto. Qui il banco
// resta com'è: dopo ogni montaggio, per ogni strato, c'è **un elemento solo**.
//
// I tre strati (`caratteri`, `foglio`, `pelle`) viaggiano su canali separati
// (`data-fub`), perché crescono separatamente: la pelle di un domani sarà un
// file suo, il foglio un altro, i caratteri un terzo. Il banco prova che i
// canali non si parlano: montare lo stesso testo su due di essi li conta 1+1,
// e montarne due diversi su uno solo li conta 1 (il secondo sostituisce il
// primo, non si aggiunge). Prova anche che l'ordine nel documento è quello
// dichiarato da `ORDINE` e non l'ordine di chiamata: montare la pelle prima
// dei caratteri deve comunque lasciare i caratteri prima nel DOM.
//
// Il testo arriva come stringa (`?raw`) e il caricatore lo scrive in
// `textContent` verbatim: niente parsing nostro, niente normalizzazione. Se un
// giorno il caricatore decidesse di parsare — per «ripulire» o per unIRE le
// regole — il banco lo direbbe, perché il testo di ritorno non sarebbe più
// quello di partenza.
//
// La seconda metà del banco prova `mountTheme` (`theme/theme.ts`): la scelta in
// `localStorage` decide quale foglio si monta, e la pelle e i caratteri si
// montano una volta sola. Senza scelta, `mountTheme` segue il sistema:
// `sistemaScuro()` legge `window.matchMedia`, che happy-dom implementa e
// risponde chiaro — quindi il foglio montato è il gemello chiaro. La catena di
// import di `theme.ts` (`host/query`, `state/kernel`, `state/store`, `ui/lifetime`)
// non chiama API Tauri all'import time: `api` è un oggetto di wrapper che
// invocano `invoke` solo al primo richiamo, quindi il banco la importa senza
// che la webview si accenda.
import { beforeEach, describe, expect, it } from "vitest";

import { openLifetime } from "../ui/lifetime";
import sheetScuro from "./serie/sheet-dark.css?raw";
import sheetChiaro from "./serie/sheet-light.css?raw";
import skin from "./serie/skin.css?raw";
import fonts from "./serie/fonts.css?raw";
import { count, mount, type Layer } from "./loader";
import { mountTheme } from "./theme";
function mountedStyle(layer: Layer): HTMLStyleElement | null {
  return document.head.querySelector(`style[data-fub="${layer}"]`);
}

/// L'ordine dei canali nel DOM, letto da chi c'è montato — non da `loader.ts`,
/// che è ciò che il banco vuole provare senza importarne l'interno.
function mountedOrder(): string[] {
  return [...document.head.querySelectorAll<HTMLStyleElement>("style[data-fub]")].map(
    (el) => el.dataset.fub!,
  );
}

beforeEach(() => {
  // Isolamento: ogni banco parte con la testa vuota e nessuna scelta ricordata.
  // `localStorage` in happy-dom esiste e va azzerato a mano, perché il tema ce
  // lo scrive e un test non deve ereditare la scelta di quello prima. Lo stesso
  // vale per `dataset.theme` sulla radice: `applica()` ha una guardia che skip
  // se il tema è invariato, e un residuo dal test precedente spegnerebbe il
  // montaggio del foglio senza dirlo.
  document.head.innerHTML = "";
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("il caricatore monta per sostituzione", () => {
  it("due montaggi di fila sullo stesso strato ne lasciano uno solo, col secondo testo", () => {
    mount("primo", "foglio");
    mount("secondo", "foglio");

    expect(count("foglio"), "montare due volte non accatasta: un foglio solo").toBe(1);
    expect(
      mountedStyle("foglio")?.textContent,
      "l'ultimo montato sostituisce il primo, non gli si appende",
    ).toBe("secondo");
  });

  it("lo stesso vale per la pelle", () => {
    mount("pelle-a", "pelle");
    mount("pelle-b", "pelle");

    expect(count("pelle"), "la pelle sostituisce come il foglio").toBe(1);
    expect(mountedStyle("pelle")?.textContent).toBe("pelle-b");
  });

  it("foglio e pelle convivono: uno per ciascun canale", () => {
    mount("il foglio", "foglio");
    mount("la pelle", "pelle");

    expect(count("foglio")).toBe(1);
    expect(count("pelle")).toBe(1);
  });

  it("montare lo stesso testo su entrambi gli strati li conta 1+1: canali separati", () => {
    const text = "stesso testo, due canali";
    mount(text, "foglio");
    mount(text, "pelle");

    expect(count("foglio"), "il foglio non vede ciò che monta la pelle").toBe(1);
    expect(count("pelle"), "la pelle non vede ciò che monta il foglio").toBe(1);
  });

  it("i tre canali convivono, e il DOM li ordina come dichiara ORDINE", () => {
    mount("la pelle", "pelle");
    mount("il foglio", "foglio");
    mount("i caratteri", "caratteri");

    expect(count("caratteri")).toBe(1);
    expect(count("foglio")).toBe(1);
    expect(count("pelle")).toBe(1);
    expect(
      mountedOrder(),
      "l'ordine nel DOM è caratteri, foglio, pelle — non l'ordine con cui si è chiamato monta()",
    ).toEqual(["caratteri", "foglio", "pelle"]);
  });

  it("il testo montato resta verbatim in textContent: niente parsing", () => {
    // Un CSS con commenti, regole annidate e spazi capricciosi: se il
    // caricatore lo normalizzasse, il testo di ritorno non combacerebbe.
    const css = [
      "/* un commento che un parser potrebbe togliere */",
      ":root { --a: 1px; --b: 2px; }",
      "  .rule   {   color:   var(--a)   ;   }",
      "",
    ].join("\n");
    mount(css, "foglio");

    expect(mountedStyle("foglio")?.textContent, "il caricatore scrive, non interpreta").toBe(css);
  });
});

describe("mountTheme monta il foglio della luce che vale", () => {
  it("con localStorage «light» monta il foglio chiaro, e la pelle una volta sola", () => {
    localStorage.setItem("fub.appearance.theme", "light");
    const changes = [] as string[];
    mountTheme(openLifetime(), (theme) => changes.push(theme));

    expect(count("foglio"), "una scelta esplicita monta un foglio solo").toBe(1);
    expect(count("pelle"), "la pelle si monta una volta, qualunque sia la luce").toBe(1);
    expect(
      count("caratteri"),
      "i caratteri si montano una volta, qualunque sia la luce",
    ).toBe(1);
    expect(
      mountedStyle("caratteri")?.textContent,
      "mountTheme passa al caricatore esattamente il `?raw` dei caratteri di serie",
    ).toBe(fonts);
    expect(
      mountedStyle("foglio")?.textContent ?? "",
      "«light» monta il gemello chiaro, che dichiara color-scheme: light",
    ).toContain("color-scheme: light;");
    expect(document.documentElement.dataset.theme, "il segnale sulla radice segue il foglio").toBe(
      "light",
    );
  });

  it("senza localStorage, la scelta è «come il sistema» e happy-dom risponde chiaro", () => {
    // `sistemaScuro()` legge `window.matchMedia`. happy-dom lo implementa e
    // risponde `matches: false` per `prefers-color-scheme: dark` — il sistema
    // è chiaro. Senza una scelta in `localStorage`, `temaEffettivo("", false)`
    // è "light": il foglio montato è il gemello chiaro. È la prova che la
    // risoluzione «come il sistema» passa dal caricatore, e che qualunque
    // luce `matchMedia` risponda, il foglio corrisponde.
    mountTheme(openLifetime(), () => {});

    expect(count("foglio")).toBe(1);
    expect(
      mountedStyle("foglio")?.textContent ?? "",
      "senza scelta e con sistema chiaro, si monta il chiaro: color-scheme: light",
    ).toContain("color-scheme: light;");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("un secondo mountTheme con altra scelta sostituisce il foglio, non lo accatasta", () => {
    // La scelta cambia fra due chiamate: il caricatore sostituisce, e il
    // segnale sulla radice si aggiorna. È la prova che il cambio tema non
    // lascia due fogli in gara.
    localStorage.setItem("fub.appearance.theme", "light");
    const lifetime = openLifetime();
    mountTheme(lifetime, () => {});
    expect(count("foglio")).toBe(1);

    localStorage.setItem("fub.appearance.theme", "dark");
    mountTheme(lifetime, () => {});

    expect(count("foglio"), "il cambio sostituisce: ancora un foglio solo").toBe(1);
    expect(
      mountedStyle("foglio")?.textContent ?? "",
      "il secondo mountTheme ha montato lo scuro, che dichiara color-scheme: dark",
    ).toContain("color-scheme: dark;");
    expect(document.documentElement.dataset.theme, "il segnale segue l'ultimo foglio").toBe("dark");
  });

  it("il foglio montato è uno dei due veri, non un testo di prova", () => {
    // I test sopra leggono `color-scheme` per riconoscere il foglio — e non un
    // colore, perché dalla §31.2 i colori li **ricava** la ricetta: un `--bg`
    // scritto qui dentro farebbe diventare rosso il presidio del caricatore il
    // giorno in cui qualcuno cambia il passo della scala, cioè per una ragione
    // che col montare un foglio non c'entra niente. `color-scheme` è la riga con
    // cui ciascun foglio **dichiara** in che luce sta, e quella non si ricava.
    //
    // La prova più forte è comunque questa: il testo montato coincide col `?raw`
    // del foglio di serie, cioè `mountTheme` passa al caricatore esattamente ciò
    // che importa.
    localStorage.setItem("fub.appearance.theme", "dark");
    mountTheme(openLifetime(), () => {});

    expect(mountedStyle("foglio")?.textContent).toBe(sheetScuro);

    localStorage.clear();
    localStorage.setItem("fub.appearance.theme", "light");
    mountTheme(openLifetime(), () => {});

    expect(mountedStyle("foglio")?.textContent).toBe(sheetChiaro);
  });

  it("onChange riceve il tema effettivo al cambio", () => {
    // `mountTheme` registra `onChange` dopo il primo `applica()`, quindi la
    // prima chiamata non lo invoca. Al secondo mountTheme, con una scelta
    // diversa, `applica()` monta il nuovo foglio e chiama `onChange` col tema
    // nuovo. Il banco conta le chiamate e l'ultimo argomento.
    const receivedThemes = [] as string[];
    const lifetime = openLifetime();
    localStorage.setItem("fub.appearance.theme", "light");
    mountTheme(lifetime, (theme) => receivedThemes.push(theme));

    // La prima mountTheme non chiama onChange: il commento di theme.ts dice
    // che chi montiamo dopo (l'editor) legge il tema alla nascita, e
    // avvisarlo di un cambiamento che non ha ancora visto vorrebbe dire
    // chiamarlo prima che esista.
    expect(receivedThemes, "il primo mountTheme non avvisa: il tema è iniziale, non cambio").toEqual([]);

    localStorage.setItem("fub.appearance.theme", "dark");
    mountTheme(lifetime, (theme) => receivedThemes.push(theme));

    expect(receivedThemes, "il cambio chiama onChange col tema nuovo").toEqual(["dark"]);
  });
  it("localStorage «lime» migra al foglio scuro di serie (non è un terzo tema)", () => {
    // Lime non è più un fascio: chi lo aveva scelto resta sul buio che aveva.
    // `mountTheme` riscrive la cache a `dark` prima di applicare, e la pelle
    // di serie si monta una volta sola. È una migrazione, non un terzo tema:
    // il foglio montato è il gemello scuro della serie, e il segnale sulla
    // radice dice `dark`.
    localStorage.setItem("fub.appearance.theme", "lime");
    mountTheme(openLifetime(), () => {});

    expect(count("foglio"), "la migrazione monta un foglio solo").toBe(1);
    expect(count("pelle"), "la pelle di serie si monta una volta sola").toBe(1);
    expect(mountedStyle("foglio")?.textContent, "il foglio è lo scuro di serie, non un terzo").toBe(
      sheetScuro,
    );
    expect(mountedStyle("pelle")?.textContent, "la pelle è quella di serie").toBe(skin);
    expect(document.documentElement.dataset.theme, "lime è scura: data-theme=dark").toBe("dark");
    expect(localStorage.getItem("fub.appearance.theme"), "la cache è riscritta a dark").toBe("dark");
  });
});